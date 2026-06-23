/**
 * gtalkClient.js
 * ------------------------------------------------------------------
 * Client gọi GHN GTalk REST API, dựa theo gtalk-integration-guide.md
 * và swagger.yaml do bạn cung cấp.
 *
 * Yêu cầu biến môi trường (xem .env.example):
 *   GTALK_BASE_URL   - https://mbff.ghn.vn (prod) hoặc https://test-api.mbff.ghn.tech (test)
 *   GTALK_OA_ID       - OA ID dùng cho send-message-receipt / get-user-simple-profile
 *   GTALK_USERNAME    - phần username của oaToken
 *   GTALK_PASSWORD    - phần password của oaToken
 *   GTALK_CHANNEL_ID  - kênh GTalk của Giám đốc vùng TNB nhận cảnh báo
 * ------------------------------------------------------------------
 */

require('dotenv').config();

const BASE_URL = process.env.GTALK_BASE_URL || 'https://test-api.mbff.ghn.tech';
const OA_TOKEN = `${process.env.GTALK_USERNAME}:${process.env.GTALK_PASSWORD}`;

async function post(path, body) {
  const url = `${BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, oaToken: OA_TOKEN }),
    });
  } catch (networkErr) {
    // Lỗi tầng mạng: sai URL, không có internet, bị proxy/firewall chặn, DNS không phân giải được...
    console.error(`[gtalkClient] Không kết nối được tới ${url}`);
    console.error(`[gtalkClient] Nguyên nhân gốc:`, networkErr.cause || networkErr.message);
    throw new Error(`Network error khi gọi ${url}: ${networkErr.cause?.code || networkErr.message}`);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`GTalk trả về dữ liệu không phải JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} từ GTalk: ${JSON.stringify(json)}`);
  }
  if (json.errorCode && json.errorCode !== 'success') {
    const err = new Error(`GTalk API error [${json.errorCode}]: ${JSON.stringify(json.error)}`);
    err.payload = json;
    throw err;
  }
  return json.data;
}

/** Gửi tin nhắn văn bản (hỗ trợ Markdown) tới một kênh GTalk */
async function sendText(channelId, text, { parseMode = 'MARKDOWN' } = {}) {
  return post('/api/gtalk/send-message', {
    channelId,
    clientMsgId: String(Date.now()),
    content: { text, parseMode },
  });
}

/** Gửi tin nhắn dạng template card (tiêu đề + nội dung + nút hành động) */
async function sendTemplate(channelId, { templateId = 'tmpl_alert', shortMessage, title, content, actions = [] }) {
  return post('/api/gtalk/send-message', {
    channelId,
    clientMsgId: String(Date.now()),
    content: {
      template: {
        templateId,
        shortMessage,
        data: JSON.stringify({ title, content, actions }),
      },
    },
  });
}

/** Gửi receipt SEEN + TYPING khi nhận tin nhắn inbound (theo Plugin Behavior trong guide) */
async function sendReceipt(channelId, globalMsgId) {
  return post('/api/gtalk/send-message-receipt', {
    oaId: process.env.GTALK_OA_ID,
    receiptMessage: {
      channelId,
      receipts: [
        { status: 2, receiptedTs: Date.now(), globalMsgId }, // SEEN
        { status: 3, receiptedTs: Date.now(), globalMsgId }, // TYPING
      ],
    },
  });
}

module.exports = { sendText, sendTemplate, sendReceipt };
