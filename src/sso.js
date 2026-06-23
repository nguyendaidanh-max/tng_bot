/**
 * sso.js
 * ------------------------------------------------------------------
 * Client OpenID Connect cho GHN SSO v2, theo đúng flow trong
 * "GHN SSO v2 — OpenID Connect Integration Guide" (file bạn đã gửi):
 *   1. buildAuthorizeUrl()  -> /oauth2/authorize (kèm state + nonce chống CSRF/replay)
 *   2. exchangeCode()       -> /oauth2/token     (client_secret_basic)
 *   3. verifyIdToken()      -> verify chữ ký qua /oauth2/jwks + check iss/aud/exp/nonce
 *   4. getUserInfo()        -> /oauth2/userinfo  (Bearer access_token)
 *   5. buildLogoutUrl()     -> /oauth2/logout    (RP-Initiated Logout)
 * ------------------------------------------------------------------
 */

require('dotenv').config();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const SSO_BASE = process.env.SSO_BASE_URL || 'https://dev-online-gateway.ghn.vn/sso-v2/public-api';
const CLIENT_ID = process.env.SSO_CLIENT_ID;
const CLIENT_SECRET = process.env.SSO_CLIENT_SECRET;
const REDIRECT_URI = process.env.SSO_REDIRECT_URI;

const jwks = jwksClient({ jwksUri: `${SSO_BASE}/oauth2/jwks` });

function getSigningKey(header) {
  return new Promise((resolve, reject) => {
    jwks.getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey ? key.getPublicKey() : key.publicKey || key.rsaPublicKey);
    });
  });
}

/** Bước 1: tạo URL đăng nhập + state/nonce random (lưu vào session, không lưu cookie thường) */
function buildAuthorizeUrl() {
  const state = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomBytes(32).toString('hex');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email',
    state,
    nonce,
  });
  return { url: `${SSO_BASE}/oauth2/authorize?${params.toString()}`, state, nonce };
}

/** Bước 3: đổi authorization code lấy access_token + id_token (client_secret_basic) */
async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const res = await fetch(`${SSO_BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error_description || json.error || 'Đổi authorization code thất bại');
  }
  return json; // { access_token, id_token, token_type, expires_in }
}

/** Bước 4: verify chữ ký + iss/aud/exp/nonce theo checklist trong tài liệu */
async function verifyIdToken(idToken, expectedNonce) {
  const decodedHeader = jwt.decode(idToken, { complete: true });
  if (!decodedHeader) throw new Error('ID token không hợp lệ (không decode được)');

  const publicKey = await getSigningKey(decodedHeader.header);
  const claims = jwt.verify(idToken, publicKey, {
    issuer: SSO_BASE,
    audience: CLIENT_ID,
    algorithms: ['RS256'],
  });

  if (expectedNonce && claims.nonce !== expectedNonce) {
    throw new Error('Nonce không khớp — nghi ngờ replay attack, từ chối đăng nhập');
  }
  return claims;
}

/** Bước 5: lấy thông tin nhân viên (tên, chức danh, team...) */
async function getUserInfo(accessToken) {
  const res = await fetch(`${SSO_BASE}/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Không lấy được thông tin người dùng từ SSO');
  return res.json();
}

/** Bước 6: RP-Initiated Logout — kết thúc session SSO cùng lúc với app */
function buildLogoutUrl(idToken) {
  const params = new URLSearchParams({
    post_logout_redirect_uri: process.env.SSO_POST_LOGOUT_REDIRECT_URI || `${REDIRECT_URI.replace('/auth/callback', '')}/`,
  });
  if (idToken) params.set('id_token_hint', idToken);
  return `${SSO_BASE}/oauth2/logout?${params.toString()}`;
}

module.exports = { buildAuthorizeUrl, exchangeCode, verifyIdToken, getUserInfo, buildLogoutUrl };
