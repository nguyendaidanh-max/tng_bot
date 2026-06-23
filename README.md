# GHN TNB OPS Bot — Dashboard + Cảnh báo KPI + Tự động trả lời qua GTalk

Bộ ứng dụng cho Giám đốc Vùng Tây Nam Bộ (GHN), gồm 3 phần chạy chung trong **1 server Node.js**:

1. **Dashboard web** (`public/index.html`) — đăng nhập bằng **GHN SSO v2**, hiển thị KPI: doanh thu SME ngày/lũy kế tháng, tăng trưởng MoM, GTC TTS, Ontime GTC TTS (KPI 96%), tỷ lệ trả hàng FD TTS, Top 10 bưu cục rớt luân chuyển, xếp hạng %OPR TTS AM.
2. **Cảnh báo KPI tự động hằng ngày trước 9h00**, gửi vào kênh GTalk.
3. **Tự động trả lời** khi có người hỏi trong kênh GTalk.

> Dashboard và bot **dùng chung một nguồn dữ liệu** (`src/data.js`) — đây là phần "kết nối HTML với bot": sửa số liệu ở một chỗ, cả web lẫn tin nhắn GTalk đều cập nhật theo.

## Cấu trúc thư mục

```
tnb-bot/
├── package.json
├── .env.example
├── public/
│   └── index.html        # Dashboard — gọi /api/kpi/* để lấy dữ liệu
└── src/
    ├── data.js            # Lớp dữ liệu KPI (demo) — thay bằng API thật ở đây
    ├── composeReport.js   # Ghép dữ liệu thành nội dung tin nhắn GTalk
    ├── gtalkClient.js     # Client gọi GTalk REST API (send-message, receipt...)
    ├── sso.js             # Client GHN SSO v2 (OpenID Connect) — đăng nhập/đăng xuất
    ├── scheduler.js       # Cron job gửi cảnh báo trước 9h
    └── server.js          # Web server: SSO auth, API KPI, webhook GTalk, static dashboard
```

## Cài đặt

```bash
cd tnb-bot
npm install
cp .env.example .env
```

Điền vào `.env`:
- `GTALK_USERNAME / GTALK_PASSWORD / GTALK_OA_ID / GTALK_CHANNEL_ID` — lấy từ team quản trị GTalk nội bộ.
- `SSO_CLIENT_ID / SSO_CLIENT_SECRET / SSO_REDIRECT_URI` — liên hệ **PhatLV (3079900)** để đăng ký app trên GHN SSO v2 (theo `sso-v2-oidc-integration-guide`). `SSO_REDIRECT_URI` phải khai báo đúng y hệt lúc đăng ký, vd. `http://localhost:3000/auth/callback` khi chạy local, hoặc `https://domain-that-cua-ban.com/auth/callback` khi deploy thật (SSO yêu cầu HTTPS ở production).
- `SESSION_SECRET` — đổi sang chuỗi random dài.

## Chạy

```bash
npm start
```
- Mở `http://localhost:3000` → tự động chuyển hướng sang trang đăng nhập GHN SSO nếu chưa đăng nhập.
- Sau khi đăng nhập thành công, quay lại dashboard, thấy tên + chức danh thật (từ SSO `userinfo`) ở góc trên bên phải, có nút đăng xuất (⏻).
- Dashboard tự gọi `/api/kpi/summary`, `/api/kpi/drop-offices`, `/api/kpi/opr`, `/api/kpi/trends` để vẽ biểu đồ/bảng — không còn số liệu cứng trong HTML.
- Nút "Gửi thử cảnh báo vào GTalk" trên dashboard gọi thẳng `POST /test/send-morning-alert` — gửi tin nhắn **thật** vào kênh GTalk đã cấu hình.

```bash
# Chỉ chạy lịch gửi cảnh báo, không cần web/SSO
npm run scheduler

# Gửi thử cảnh báo ngay lập tức từ terminal
npm run send-now
```

## Luồng đăng nhập SSO (tóm tắt theo tài liệu)

```
GET /auth/login      -> tạo state+nonce, redirect sang GHN SSO /oauth2/authorize
GET /auth/callback   -> nhận code, đổi lấy token (/oauth2/token),
                         verify ID token qua JWKS (/oauth2/jwks),
                         lấy hồ sơ (/oauth2/userinfo), lưu vào session
GET /auth/logout     -> huỷ session local + redirect sang /oauth2/logout (RP-Initiated Logout)
```
Toàn bộ dashboard (`/`) và API KPI (`/api/*`) đều đi qua middleware `requireAuth` — chưa đăng nhập sẽ không xem được số liệu.



## Bước tiếp theo để tích hợp dữ liệu thật

Mở `src/data.js`, mỗi hàm `fetchBusinessKPI`, `fetchOperationsKPI`,
`fetchTopDropOffices`, `fetchOprRanking` đang trả về dữ liệu demo.
Thay phần `return {...}` bằng lệnh gọi tới API/DB nội bộ của bạn
(SME Sales API, TTS Fulfillment API, OPR Tracking API). Không cần
sửa `composeReport.js`, `scheduler.js`, hay `server.js` — các phần
đó chỉ phụ thuộc vào cấu trúc dữ liệu trả về, không phụ thuộc nguồn dữ liệu.

## Bước tiếp theo để nhận tin nhắn inbound thật từ GTalk

1. Gọi `POST /api/gtalk/config-channel-processing` (xem mục 13 trong
   `gtalk-integration-guide.md`) để khai báo `webhookURL` trỏ về
   `https://<domain-cua-ban>/webhooks/gtalk` cho kênh GTalk của bạn.
2. Kiểm tra payload thật mà GTalk gửi tới webhook (có thể khác đôi
   chút so với giả định trong `server.js`), rồi chỉnh lại 3 trường
   `channelId`, `globalMsgId`, `content.text` trong route
   `/webhooks/gtalk` cho khớp.
3. Nếu `config-channel-processing` có bật `webhookSecret`, thêm bước
   xác thực chữ ký SHA-256 (`oaId + jsonPayload + timestamp + webhookSecret`)
   trước khi xử lý request, để tránh giả mạo webhook.

## Chạy thử ngay khi CHƯA có GTalk / SSO credentials

Nếu bạn đang đợi xin thông tin GTalk hoặc đăng ký app SSO, vẫn xem được dashboard ngay:

```bash
npm install
cp .env.example .env
```

Mở `.env`, sửa dòng:
```
DEV_BYPASS_AUTH=true
```
(các dòng `GTALK_*` và `SSO_*` cứ để nguyên giá trị mẫu, không cần điền)

```bash
npm start
```

Mở `http://localhost:3000` → vào thẳng dashboard, **không cần đăng nhập**, thấy badge "Người dùng Test (DEV_BYPASS_AUTH)". Dashboard sẽ gọi đúng API `/api/kpi/*` thật (dữ liệu demo từ `src/data.js`), bạn thấy pill 🟢 "Dữ liệu trực tiếp từ bot" — tức là phần kết nối HTML ↔ bot đã chạy đúng, chỉ riêng SSO/GTalk là chưa nối.

Nút "Gửi thử cảnh báo vào GTalk" lúc này sẽ báo lỗi (vì chưa có `GTALK_*` thật) — đúng như dự kiến, không phải lỗi code.

⚠️ **Nhớ đổi lại `DEV_BYPASS_AUTH=false`** ngay khi có SSO credentials thật, và tuyệt đối không bật cờ này khi deploy lên server thật — nó bỏ qua hoàn toàn bước xác thực.

## Xử lý lỗi "fetch failed"

Lỗi này nghĩa là máy bạn **không kết nối được tới server GTalk** (chưa phải lỗi từ API). Kiểm tra theo thứ tự:

1. **Test kết nối thuần mạng** (PowerShell):
   ```powershell
   curl https://test-api.mbff.ghn.tech/api/gtalk/send-message -Method POST -Body '{}' -ContentType "application/json"
   ```
   - Nếu lệnh này cũng lỗi (timeout / không phân giải DNS) → máy/mạng công ty đang chặn, không phải lỗi code. Cần xin mở firewall hoặc cấu hình proxy (xem mục 3).
   - Nếu lệnh này chạy được (trả về JSON báo thiếu field) → vấn đề nằm ở phía Node, xem mục 2.

2. **Kiểm tra `GTALK_BASE_URL` trong `.env`** — không được có dấu `/` thừa ở cuối, không được để trống. Mặc định nên là:
   ```
   GTALK_BASE_URL=https://test-api.mbff.ghn.tech
   ```

3. **Nếu máy bạn phải qua proxy công ty mới ra internet được**, Node 18/20 mặc định KHÔNG tự đọc biến `HTTP_PROXY`/`HTTPS_PROXY` cho `fetch`. Cần cài thêm:
   ```bash
   npm install undici
   ```
   rồi sửa đầu file `src/gtalkClient.js` thêm:
   ```js
   const { setGlobalDispatcher, ProxyAgent } = require('undici');
   if (process.env.HTTPS_PROXY) {
     setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
   }
   ```
   và thêm `HTTPS_PROXY=http://proxy-cong-ty:port` vào `.env`.

4. **Kiểm tra phiên bản Node** (cần ≥ 18 để có `fetch` sẵn):
   ```bash
   node -v
   ```
   Nếu < 18, nâng cấp Node hoặc cài `node-fetch` và import thủ công.

Sau khi sửa, chạy lại `npm run send-now` — log lỗi giờ sẽ in rõ nguyên nhân gốc (DNS, timeout, connection refused...) thay vì chỉ "fetch failed".

## Mở rộng nhanh

- Thêm từ khóa mới cho bot: sửa mảng `INTENTS` trong `src/server.js`.
- Đổi giờ gửi cảnh báo: sửa `ALERT_CRON` trong `.env` (cú pháp cron chuẩn).
- Thêm cảnh báo khi vi phạm ngưỡng khác (vd: FD TTS > 5%): thêm khối
  `if (...)` tương tự đoạn kiểm tra Ontime trong `scheduler.js`, dùng
  `gtalk.sendTemplate(...)` để có nút bấm "Xem dashboard chi tiết".
