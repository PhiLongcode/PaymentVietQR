# Demo Payment VietQR (Cas QR Pay)

Demo checkout: **Next.js** + **Express** + **SQLite**. Luồng Cas Link đầy đủ theo [QR Pay](https://cas.so/en/product/qr-pay/) và [Cas Link](https://cas.so/en/general/link/).

```
Grant token (scopes=qrpay,transaction)
  → Cas Link → publicToken
  → POST /grant/exchange
  → GET /qr-pay/identity
  → POST /qr-pay
  → hiện QR trên app
  → webhook TRANSACTIONS
  → match + idempotent → PAID
```

## Chạy local

1. Copy env:

```bash
copy .env.example backend\.env
copy .env.example frontend\.env.local
```

Điền `CAS_CLIENT_ID` và `CAS_SECRET_KEY` vào `backend/.env`. Không commit file này.

2. Cài và chạy:

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

- App: http://localhost:3000 (nếu cổng 3000 bận, `npx next dev --port 3001`)  
- API: http://localhost:4000  
- Health: http://localhost:4000/health  
- Swagger: http://localhost:4000/api/docs (Render: https://paymentvietqr.onrender.com/api/docs) 

`CAS_REDIRECT_URI` phải **trùng khớp tuyệt đối** một URL đã được phép trên Cas Console (Grant → Redirect URI). Cas sandbox từ chối URI lạ với `INVALID_PARAM` (`... not allowed`).

Thêm đúng `http://localhost:3000/cas/callback` vào allowlist Console, hoặc đổi `CAS_REDIRECT_URI` thành URL bạn đã đăng ký (và FE phải nhận `publicToken` tại URL đó).

## Webhook CAS

Endpoint: `POST /api/v1/webhooks/cas/transactions`

Sandbox cần URL **HTTPS công khai** (ngrok / Cloudflare Tunnel) trỏ về máy bạn. Cấu hình trên Cas Console. CAS sandbox gửi từ IP `20.2.69.168`. Retry nếu không nhận HTTP 2xx trong 10 giây ([webhook docs](https://cas.so/en/general/api/webhook/)).

Localhost **không nhận webhook Cas**. App poll/SSE mỗi 2 giây và gọi `GET /transactions` để đối soát. Grant cũ chỉ có `qrpay` thì Cas từ chối API này — **Kết nối lại tài khoản** (scope `qrpay,transaction`), tạo đơn mới rồi thanh toán.

Local không tunnel: dùng `POST /api/v1/dev/simulate-webhook` (chỉ `NODE_ENV=DEV`).

Local matching (không cần Cas):

```bash
cd backend && node scripts/smoke-matching.js
```

Không giả định `paymentMeta.referenceNumber`. Thứ tự:

1. Idempotent theo `transaction.id`
2. `paymentMeta.qrPayId` / `referenceNumber` nếu có
3. `accountNumber` = `virtualAccountNumber` và đúng **một** Payment PENDING
4. `description` chứa mã đơn 9 ký tự (khi tạo QR, backend gửi `description` = mã đơn, tối đa 9 ký tự theo Cas)
5. Ambiguous / không khớp → bảng unmatched, **không** mark Order PAID
6. Amount đúng → PAID; thiếu/0/null → REJECT; thừa → REVIEW

## Test cases (DEV)

Tạo đơn + QR trên UI trước, copy `orderId`.

**TC-01** — Generate QR: tạo đơn 2000 → QR hiện, payment PENDING.

**TC-04** — Duplicate webhook:

```bash
curl -X POST http://localhost:4000/api/v1/dev/simulate-webhook ^
  -H "Content-Type: application/json" ^
  -d "{\"transactionId\":\"ABC123\",\"amount\":2000,\"description\":\"ORDER-xxx\",\"accountNumber\":\"VA-cua-payment\"}"
```

Gửi lần 2 cùng `transactionId=ABC123` → vẫn SUCCESS, không cộng tiền.

**TC-05** — Wrong amount: `amount: 1000` với description/VA của đơn 2000 → không PAID (`REJECT`).

**TC-06** — Unknown transaction: description và accountNumber không map → `unmatched: true`.

**TC-03** — Thanh toán thật: quét QR banking sandbox, CAS gửi webhook production-like.

## API nội bộ

| Method | Path |
|---|---|
| POST | `/api/v1/cas/grant` |
| POST | `/api/v1/cas/exchange` |
| GET | `/api/v1/cas/status` |
| POST | `/api/v1/orders` |
| POST | `/api/v1/payments/qr` |
| GET | `/api/v1/orders/:orderId/payment` |
| GET | `/api/v1/orders/:orderId/payment-status` |
| POST | `/api/v1/orders/:orderId/cancel` |
| POST | `/api/v1/webhooks/cas/transactions` |
| GET | `/api/v1/unmatched` |
| POST | `/api/v1/dev/simulate-webhook` |

SQLite: `backend/data/app.db`. Token Cas lưu trong `cas_grants`, **không** trả về FE, **không** log `secretKey` / `accessToken`.
