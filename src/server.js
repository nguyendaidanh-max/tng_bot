/**
 * server.js
 * ------------------------------------------------------------------
 * Web server cho bộ TNB OPS:
 *   - Đăng nhập bằng GHN SSO v2 (OpenID Connect) — chỉ nhân viên GHN
 *     mới xem được dashboard.
 *   - Phục vụ dashboard tại "/" (public/index.html), dashboard gọi
 *     các API /api/kpi/* bên dưới để lấy dữ liệu — đây chính là phần
 *     "kết nối HTML với bot": dashboard không còn dùng số liệu cứng
 *     trong JS nữa, mà luôn lấy từ cùng một nguồn dữ liệu (src/data.js)
 *     với bot cảnh báo GTalk.
 *   - Webhook nhận tin nhắn inbound từ GTalk + tự động trả lời.
 *   - Cron gửi cảnh báo KPI trước 9h00 (xem scheduler.js).
 * ------------------------------------------------------------------
 */

require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const gtalk = require('./gtalkClient');
const { composeDailySummary, composeDropOfficesAlert, composeOprAlert } = require('./composeReport');
const { fetchBusinessKPI, fetchOperationsKPI, fetchTopDropOffices, fetchOprRanking, fetchTrends } = require('./data');
const { start: startScheduler, runMorningAlert } = require('./scheduler');

const app = express();
app.use(express.json());

app.set('trust proxy', 1);
app.use(
  session({
    name: 'tnb_ops_sid',
    secret: process.env.SESSION_SECRET || 'change-me-in-env',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production', // bật true khi chạy HTTPS thật
      maxAge: 8 * 60 * 60 * 1000, // 8 giờ
    },
  })
);

const PORT = process.env.PORT || 3000;

/* ===================== AUTH (PASSWORD PROTECTED) ===================== */

/** Chặn truy cập nếu chưa đăng nhập bằng mật khẩu */
function requireAuth(req, res, next) {
  if (req.path === '/login.html') {
    return next();
  }
  if (req.session && req.session.authenticated) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  return res.redirect('/login.html');
}

app.post('/auth/login', (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.DASHBOARD_PASSWORD || "Anh điền mật khẩu chỗ này";
  
  if (password === correctPassword) {
    req.session.authenticated = true;
    req.session.user = {
      name: 'Nguyễn Đại Danh',
      jobtitle_name: 'Giám Đốc Vùng TNB',
      preferred_username: 'danh.nguyen',
    };
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Mật khẩu truy cập không chính xác' });
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

app.get('/api/me', requireAuth, (req, res) => res.json(req.session.user));

/* ===================== DASHBOARD (KPI API) =====================
 * Dùng chung data.js với bot GTalk — sửa số liệu ở src/data.js
 * là cả dashboard lẫn cảnh báo GTalk đều tự cập nhật theo. */

app.get('/api/kpi/summary', requireAuth, async (req, res, next) => {
  try {
    const [biz, ops] = await Promise.all([fetchBusinessKPI(), fetchOperationsKPI()]);
    res.json({ ...biz, ...ops });
  } catch (err) {
    next(err);
  }
});

app.get('/api/kpi/drop-offices', requireAuth, async (req, res, next) => {
  try {
    res.json(await fetchTopDropOffices());
  } catch (err) {
    next(err);
  }
});

app.get('/api/kpi/opr', requireAuth, async (req, res, next) => {
  try {
    res.json(await fetchOprRanking());
  } catch (err) {
    next(err);
  }
});

app.get('/api/kpi/trends', requireAuth, async (req, res, next) => {
  try {
    res.json(await fetchTrends());
  } catch (err) {
    next(err);
  }
});

/** Nút "Gửi thử cảnh báo" trên dashboard gọi endpoint này — bắn cảnh báo thật vào GTalk */
app.post('/test/send-morning-alert', requireAuth, async (req, res) => {
  try {
    await runMorningAlert();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ===================== GTALK WEBHOOK (auto-reply) ===================== */

const INTENTS = [
  { keywords: ['doanh thu', 'sme', 'kinh doanh', 'ontime', 'on time', 'gtc'], handler: composeDailySummary },
  { keywords: ['top rớt', 'rớt luân chuyển', 'top 10', 'bưu cục rớt'], handler: composeDropOfficesAlert },
  { keywords: ['opr', 'tỉ lệ opr', 'tỷ lệ opr'], handler: composeOprAlert },
];
const DEFAULT_HELP = [
  'Xin chào 👋 Tôi là Bot vận hành Vùng TNB. Bạn có thể hỏi tôi:',
  '• "doanh thu hôm nay" — tổng quan kinh doanh & vận hành',
  '• "top rớt luân chuyển" — Top 10 bưu cục rớt luân chuyển TTS',
  '• "tỷ lệ OPR" — xếp hạng %OPR TTS AM theo nhân viên',
].join('\n');

function matchIntent(text) {
  const lower = text.toLowerCase();
  const found = INTENTS.find((i) => i.keywords.some((k) => lower.includes(k)));
  return found ? found.handler : null;
}

/** Webhook nhận inbound message từ GTalk — điều chỉnh tên trường cho khớp payload thật */
app.post('/webhooks/gtalk', async (req, res) => {
  res.status(200).send('ok'); // ack ngay, xử lý bất đồng bộ phía dưới
  try {
    const { channelId, globalMsgId, content } = req.body || {};
    const text = content?.text || '';
    if (!channelId || !text) return;

    if (globalMsgId) {
      await gtalk.sendReceipt(channelId, globalMsgId).catch((e) => console.error('[receipt]', e.message));
    }
    const handler = matchIntent(text);
    const reply = handler ? await handler() : DEFAULT_HELP;
    await gtalk.sendText(channelId, reply);
  } catch (err) {
    console.error('[webhook] Lỗi xử lý tin nhắn inbound:', err.message);
  }
});

/* ===================== STATIC DASHBOARD ===================== */

// Toàn bộ dashboard (public/) yêu cầu đăng nhập GHN SSO trước khi xem
app.use('/', requireAuth, express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Error handler chung cho các route /api/*
app.use((err, req, res, next) => {
  console.error('[server] Lỗi:', err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`[server] TNB OPS đang chạy tại http://localhost:${PORT}`);
  if (process.env.DEV_BYPASS_AUTH === 'true') {
    console.warn('⚠️  [server] DEV_BYPASS_AUTH=true — đăng nhập SSO đang bị BỎ QUA, chỉ dùng cho test local. KHÔNG deploy production với cờ này bật.');
  } else {
    console.log(`[server] Đăng nhập GHN SSO tại http://localhost:${PORT}/auth/login`);
  }
  startScheduler();
});
