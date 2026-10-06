# Tài liệu kỹ thuật — Backend Cas QR Pay (ASP.NET + SQL Server)

Phiên bản: 1.0  
Nguồn: demo Node.js/Express + MongoDB (`backend/`) trong repo này.  
Đích: triển khai production-ready trên **ASP.NET Core 8** và **SQL Server**.

---

## 1. Mục đích và phạm vi

Hệ thống tạo đơn hàng, gọi Cas QR Pay để sinh VietQR, nhận webhook giao dịch ngân hàng, **khớp (match)** về Payment/Order, cập nhật PAID realtime cho web/mobile.

**Trong phạm vi**

- Grant Cas Link (nối STK nhận tiền): `grant/token` → Cas Link web → `publicToken` → `grant/exchange` → `GET /qr-pay/identity`
- Tạo Order + Payment, `POST /qr-pay`
- Webhook `TRANSACTIONS`, matching, idempotency, UNMATCHED, audit
- Polling / SignalR (thay SSE)
- Cấu hình DEV / STAGING / PRODUCTION

**Ngoài phạm vi**

- Tự build chuỗi VietQR ở client (cấm)
- Hard-code `clientId` / `secretKey` / `accessToken`
- Giả định `paymentMeta.referenceNumber` luôn có
- Match chỉ bằng `amount` hoặc chỉ bằng STK thật `accountNumber`

**Hai vai trò**

| Vai trò | Việc | Cas Link |
|---|---|---|
| Merchant (app/web nội bộ) | Nối STK, tạo QR | Có — mở **web Cas Link**, rồi deep link về app |
| Người mua | Quét VietQR / MoMo / NH | Không |

---

## 2. Stack đề xuất

| Lớp | Demo hiện tại | Đích |
|---|---|---|
| API | Express 5 | ASP.NET Core Web API |
| ORM | Mongoose | EF Core + SQL Server |
| Realtime | SSE `GET /orders/{id}/events` | **SignalR** hub `paymentHub` (tương đương) + polling |
| HTTP Cas | Axios | `HttpClient` + typed client, timeout 15s |
| Docs | swagger-js | Swashbuckle / OpenAPI |
| Secret | `.env` | User Secrets / Azure Key Vault / env IIS |
| Host | Render | IIS / Azure App Service (HTTPS bắt buộc cho webhook) |

Project gợi ý:

```
src/
  VietQr.Api/                 # Controllers, Program.cs, middleware
  VietQr.Application/         # Grant, Order, Payment, Matching use-cases
  VietQr.Infrastructure/      # EF, CasHttpClient, SQL
  VietQr.Domain/              # Entities, enums
```

---

## 3. Cấu hình môi trường

Không commit secret. Map 1:1 với demo:

| Key | Ý nghĩa |
|---|---|
| `ASPNETCORE_ENVIRONMENT` | Development / Staging / Production |
| `Cas:BaseUrl` | DEV/STG: `https://sandbox.bankhub.dev` — PROD: `https://production.bankhub.dev` |
| `Cas:LinkUrl` | DEV: `https://dev.link.bankhub.dev` — PROD: `https://link.bankhub.dev` |
| `Cas:ApiVersion` | `2023-01-01` |
| `Cas:Environment` | `dev` / `prod` (so với `payload.environment` webhook) |
| `Cas:ClientId` | Header `x-client-id` |
| `Cas:SecretKey` | Header `x-secret-key` — **không log** |
| `Cas:RedirectUri` | Local: `http://localhost:3000/cas/callback`. Production: `https://{api-host}/cas/callback` — **không** dùng localhost. Trùng whitelist Cas Console. |
| `Cas:TimeoutMs` | `15000` |
| `FrontendUrl` | CORS origin FE |
| `ConnectionStrings:Sql` | SQL Server |

Header Cas mỗi request:

```
Content-Type: application/json
X-BankHub-Api-Version: 2023-01-01
x-client-id: {ClientId}
x-secret-key: {SecretKey}
Authorization: {accessToken}     // khi đã exchange; Cas dùng raw token, không bắt buộc "Bearer "
```

Cas Console:

- Grant Redirect URI = `Cas:RedirectUri` (web: `https://fe/cas/callback`; mobile: Universal Link / App Link cùng path, hoặc custom scheme **nếu Console cho phép**)
- Webhook HTTPS: `POST https://{api}/api/v1/webhooks/cas/transactions`
- Verify URL: endpoint phải **HTTP 200** với GET/HEAD và POST body rỗng / JSON lỗi parse

---

## 4. Tích hợp Cas (HTTP)

Gói trong `ICasClient`. Mọi lỗi mạng/timeout/4xx/5xx map sang exception có `Status` + `Code` (xem §12). **Không log** secret/token; log `path`, `status`, `errorCode`, `requestId`.

| Method | Path Cas | Body / ghi chú |
|---|---|---|
| POST | `/grant/token` | `{ scopes: "qrpay,transaction", language: "vi", redirectUri }` |
| POST | `/grant/exchange` | `{ publicToken }` → `accessToken`, `grantId` |
| GET | `/qr-pay/identity` | Authorization accessToken. **Không** dùng `GET /identity` |
| POST | `/grant/remove` | `{ grantId }` khi identity invalid / 401 |
| POST | `/qr-pay` | `{ amount, description, referenceNumber }` — `description` **tối đa 9 ký tự** |
| GET | `/transactions?fromDate&toDate&pageSize=50` | Bổ sung khi poll (localhost không nhận webhook) |

Cas Link URL:

```
{LinkUrl}?grantToken={grantToken}&redirectUri={RedirectUri}&iframe=false
```

`redirectUri` localhost bị Cas từ chối `INVALID_PARAM` nếu chưa whitelist.

Unwrap `POST /qr-pay` (field có thể lồng `qrPay` / `data`):

- `id` / `qrPayId`
- `qrCode` (chuỗi EMV — FE chỉ render)
- `accountNumber`, `virtualAccountNumber`, `referenceNumber`
- `accountName` / `accountHolderName`
- `fiName` / `bankName`
- `expiredAt` / `expiresAt`

Sandbox thường **không** điền `paymentMeta` trên webhook; `virtualAccountNumber` có thể null; `accountNumber` là **STK thật**, không dùng làm khóa match duy nhất.

---

## 5. SQL Server — schema

Collation: `Vietnamese_CI_AS` hoặc `SQL_Latin1_General_CP1_CI_AS` (mã `DH` ASCII). Tiền: `BIGINT` (VND nguyên, không lẻ). Thời điểm: `datetimeoffset(7)`.

### 5.1. Bảng

```sql
CREATE TABLE dbo.cas_grants (
  id                BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  grant_id          NVARCHAR(64)  NOT NULL,
  access_token      NVARCHAR(MAX) NOT NULL, -- mã hóa at-rest (Data Protection / Always Encrypted)
  status            NVARCHAR(32)  NOT NULL, -- ACTIVE | INVALID | PENDING_LINK
  identity_json     NVARCHAR(MAX) NULL,
  account_name      NVARCHAR(256) NULL,
  account_number    NVARCHAR(64)  NULL,
  fi_name           NVARCHAR(128) NULL,
  created_at        DATETIMEOFFSET NOT NULL,
  updated_at        DATETIMEOFFSET NOT NULL
);
CREATE UNIQUE INDEX UX_cas_grants_grant_id ON dbo.cas_grants(grant_id);
CREATE INDEX IX_cas_grants_status ON dbo.cas_grants(status);

CREATE TABLE dbo.orders (
  id                CHAR(9)       NOT NULL PRIMARY KEY, -- DH0000001
  amount            BIGINT        NOT NULL,
  currency          CHAR(3)       NOT NULL CONSTRAINT DF_orders_ccy DEFAULT ('VND'),
  status            NVARCHAR(32)  NOT NULL,
  created_at        DATETIMEOFFSET NOT NULL,
  updated_at        DATETIMEOFFSET NOT NULL,
  CONSTRAINT CK_orders_amount CHECK (amount > 0)
);
CREATE INDEX IX_orders_status ON dbo.orders(status);

CREATE TABLE dbo.order_seq (
  last_n INT NOT NULL -- một dòng, sinh mã DH
);

CREATE TABLE dbo.payments (
  id                      NVARCHAR(32)  NOT NULL PRIMARY KEY, -- PAY-...
  order_id                CHAR(9)       NOT NULL,
  provider                NVARCHAR(16)  NOT NULL CONSTRAINT DF_pay_prov DEFAULT ('CAS'),
  provider_payment_id     NVARCHAR(64)  NULL, -- qrPay.id
  amount                  BIGINT        NOT NULL,
  currency                CHAR(3)       NOT NULL CONSTRAINT DF_pay_ccy DEFAULT ('VND'),
  qr_code                 NVARCHAR(MAX) NULL,
  account_name            NVARCHAR(256) NULL,
  account_number          NVARCHAR(64)  NULL,
  virtual_account_number  NVARCHAR(64)  NULL,
  reference_number        NVARCHAR(16)  NULL, -- = order.id (DH#######)
  fi_name                 NVARCHAR(128) NULL,
  status                  NVARCHAR(32)  NOT NULL, -- PENDING | SUCCESS | FAILED | EXPIRED
  transaction_id          NVARCHAR(64)  NULL, -- Cas transaction.id
  transaction_reference   NVARCHAR(64)  NULL, -- FT...
  expires_at              DATETIMEOFFSET NULL,
  paid_at                 DATETIMEOFFSET NULL,
  created_at              DATETIMEOFFSET NOT NULL,
  updated_at              DATETIMEOFFSET NOT NULL,
  CONSTRAINT FK_payments_order FOREIGN KEY (order_id) REFERENCES dbo.orders(id),
  CONSTRAINT CK_payments_amount CHECK (amount > 0)
);
CREATE UNIQUE INDEX UX_payments_provider_id ON dbo.payments(provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE UNIQUE INDEX UX_payments_txn_id ON dbo.payments(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IX_payments_order ON dbo.payments(order_id);
CREATE INDEX IX_payments_status ON dbo.payments(status);
CREATE INDEX IX_payments_va ON dbo.payments(virtual_account_number) WHERE virtual_account_number IS NOT NULL;
CREATE INDEX IX_payments_ref ON dbo.payments(reference_number);

CREATE TABLE dbo.webhook_events (
  id                  BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  transaction_id      NVARCHAR(64)  NULL,
  webhook_type        NVARCHAR(64)  NULL,
  environment         NVARCHAR(16)  NULL,
  payload_json        NVARCHAR(MAX) NOT NULL,
  processing_status   NVARCHAR(32)  NOT NULL, -- PAID | UNMATCHED | DUPLICATE | REJECT | REVIEW | IGNORED
  created_at          DATETIMEOFFSET NOT NULL
);
CREATE INDEX IX_wh_txn ON dbo.webhook_events(transaction_id);

CREATE TABLE dbo.unmatched_transactions (
  id                  BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  transaction_id      NVARCHAR(64)  NULL,
  amount              BIGINT        NULL,
  account_number      NVARCHAR(64)  NULL,
  description         NVARCHAR(512) NULL,
  reference           NVARCHAR(64)  NULL,
  reason              NVARCHAR(128) NOT NULL,
  payload_json        NVARCHAR(MAX) NOT NULL,
  created_at          DATETIMEOFFSET NOT NULL
);

CREATE TABLE dbo.audit_logs (
  id                      BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  payment_id              NVARCHAR(32)  NULL,
  order_id                CHAR(9)       NULL,
  provider                NVARCHAR(16)  NOT NULL CONSTRAINT DF_aud_prov DEFAULT ('CAS'),
  provider_payment_id     NVARCHAR(64)  NULL,
  transaction_id          NVARCHAR(64)  NULL,
  amount                  BIGINT        NULL,
  from_status             NVARCHAR(32)  NULL,
  to_status               NVARCHAR(32)  NULL,
  reason                  NVARCHAR(128) NULL,
  created_at              DATETIMEOFFSET NOT NULL
);
CREATE INDEX IX_audit_order ON dbo.audit_logs(order_id);
```

Toàn bộ bước **match + cập nhật PAID + ghi webhook + audit** trong **một `BEGIN TRAN`** (isolation `READ COMMITTED SNAPSHOT` khuyến nghị). Unique `transaction_id` chặn cộng tiền lần 2.

### 5.2. Sinh mã đơn `DHxxxxxxx` (đúng 9 ký tự)

Cas `description` tối đa 9 ký tự → mã đơn **chính là nội dung CK**.

- Prefix `DH` + 7 chữ số: `DH0000001` … `DH9999999`
- Tăng `order_seq.last_n` với `UPDLOCK, ROWLOCK` trong transaction tạo order
- `referenceNumber` và `description` gửi Cas = `orders.id`

Không dùng UUID / `ORDER-001` (dài hơn 9 ký tự).

---

## 6. State machine

**Order**

```
PENDING_PAYMENT → PAYMENT_PROCESSING → PAID
                → CANCELLED
                → EXPIRED
```

- Không tạo QR nếu `PAID` / `CANCELLED`
- Không hủy nếu `PAID`

**Payment**

```
PENDING → SUCCESS | FAILED | EXPIRED
```

Hủy đơn: Payment `PENDING` → `FAILED` (`reason=user_cancelled`), Order → `CANCELLED`.

**Grant**

```
(tạo token, chưa lưu DB) → ACTIVE  (sau exchange + identity OK)
ACTIVE → INVALID         (401 Cas, hoặc grant mới thay thế — invalidate mọi ACTIVE cũ)
```

Chỉ **một** grant `ACTIVE`. `access_token` không trả về FE.

---

## 7. Matching webhook (bắt buộc đúng)

Sandbox thực tế: MoMo bọc nội dung CK; `paymentMeta` có thể `{}` hoặc có `referenceNumber`; STK webhook = STK thật.

Ví dụ description:

```
Qamomf3244  CASSO12397 4 ... 150359607111-DH0000001-CHUYEN TIEN-...MOMO
```

Regex mã đơn: `\bDH\d{7}\b` (ignore case).

### 7.1. Thứ tự tìm Payment

1. `paymentMeta.qrPayId` / `qrPayID` / `id` → `payments.provider_payment_id`
2. `paymentMeta.referenceNumber` hoặc `paymentMeta.reference` → `order_id` **hoặc** `reference_number`
3. Trích mọi `DH#######` từ `description` + `reference` (FT **không** phải mã đơn) + VA text → lookup như bước 2
4. `transaction.accountNumber` == `virtual_account_number` **và** status `PENDING` (không dùng STK thật)
5. `description` chứa `reference_number` hoặc `order_id` (PENDING)
6. VA xuất hiện trong description

Nếu **0** hit → `UNMATCHED`.  
Nếu **>1** PENDING cùng chiến lược → `ambiguous:*` → UNMATCHED, **không** đoán.

Ưu tiên bản ghi `PENDING`; nếu chỉ còn `SUCCESS` → coi **duplicate**, không cộng tiền.

**Cấm:** match chỉ bằng `amount`; match chỉ bằng `accountNumber` STK thật.

### 7.2. Validate số tiền (sau khi đã match)

| Expected | Received | Kết quả |
|---|---|---|
| 2000 | 2000 | PAID (`amount_match`) |
| 2000 | 1000 | Payment FAILED, webhook `REJECT` (`amount_underpaid`) — Order **không** PAID |
| 2000 | 3000 | FAILED / `REVIEW` (`amount_overpaid`) |
| 2000 | 0 / null | `REJECT` (`amount_null_or_zero`) |
| 2000 | null **và** có `paymentMeta.referenceNumber` | Demo: cho qua `cas_reference_no_amount` (sandbox thiếu amount). Production: cân nhắc bắt buộc amount |

### 7.3. Idempotency

Trước khi match:

1. `payments.transaction_id` = `transaction.id` và status `SUCCESS` → `{ duplicate: true }` HTTP 200
2. `webhook_events` cùng txn đã `PAID` → duplicate 200

Cas retry không được 5xx (trừ sự cố hạ tầng). Ping / body rỗng / JSON hỏng → **200** `{ ok, ping }` để Console verify.

Webhook `environment` khác config: **log warn**, vẫn xử lý (sandbox `dev`).

`webhookType` chấp nhận: `TRANSACTIONS`, `TRANSACTION`, `QRPAY`, `QR_PAY`. Khác → `IGNORED` + 200.

Luồng:

```
Webhook → ping? → duplicate txn? → Match → UNMATCHED | amount check → SUCCESS+Order PAID
         → SignalR group order:{id}
```

Ghi `unmatched_transactions` + `audit_logs` (`to_status=UNMATCHED`). Alert ops khi UNMATCHED tăng.

**Không** tự gán webhook cũ UNMATCHED vào đơn `DH0000001` mới tạo sau này (mã trùng sequence). Reconciliation thủ công.

---

## 8. API nội bộ (giữ path demo)

Prefix `/api/v1`. CORS cho FE. JSON error:

```json
{ "error": "ORDER_NOT_FOUND", "message": "...", "cas": { "errorCode": "", "requestId": "" } }
```

| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | `{ ok, env, sql: "up" }` |
| POST | `/cas/grant` | Cas `/grant/token` → `{ grantToken, linkUrl, redirectUri }` |
| POST | `/cas/exchange` | `{ publicToken }` → grant public (không token) |
| GET | `/cas/status` | `{ hasActiveGrant, grant }` |
| GET | `/orders` | `{ orders: [] }` |
| POST | `/orders` | `{ amount }` integer > 0 → 201 Order |
| GET | `/orders/{orderId}/payment` | Public QR; nếu PENDING thì `GET /transactions` Cas rồi match |
| GET | `/orders/{orderId}/payment-status` | Poll ngắn |
| POST | `/orders/{orderId}/cancel` | 409 nếu PAID |
| POST | `/payments/qr` | `{ orderId, amount? }` — amount phải = order |
| GET/HEAD/POST | `/webhooks/cas/transactions` | Luôn 200 với ping; POST xử lý match |
| GET | `/unmatched` | Admin list |
| POST | `/dev/simulate-webhook` | Chỉ Development |

**SSE** demo: `GET /orders/{id}/events`. Trên ASP.NET dùng **SignalR**:

- Client subscribe `JoinOrder(orderId)`
- Server `Clients.Group($"order:{id}").PaymentUpdated(dto)` khi PAID
- Fallback poll 2–5s `payment-status` (mobile tắt app vẫn PAID khi mở lại)

Public payment DTO (không lộ grant token):

```json
{
  "orderId": "DH0000005",
  "description": "DH0000005",
  "paymentId": "PAY-...",
  "amount": 2000,
  "currency": "VND",
  "status": "PENDING | PAID | CANCELLED | FAILED | EXPIRED",
  "paymentStatus": "PENDING | SUCCESS | ...",
  "orderStatus": "PAYMENT_PROCESSING",
  "qrCode": "000201...",
  "accountName": "...",
  "accountNumber": "...",
  "virtualAccountNumber": null,
  "fiName": "MBBank",
  "referenceNumber": "DH0000005",
  "expiresAt": null,
  "paidAt": null
}
```

Map hiển thị: Order `PAID` hoặc Payment `SUCCESS` → `status=PAID`.

---

## 9. Use-case chi tiết

### 9.1. Grant

1. `POST /grant/token` scopes `qrpay,transaction`
2. FE/mobile mở `linkUrl` (mobile: Custom Tabs / SFSafariViewController)
3. Cas redirect `RedirectUri?publicToken=`
4. `POST /grant/exchange` → `GET /qr-pay/identity`
5. Parse `accountName` / `accountNumber` / `fiName` từ `identity` | `qrPayIdentity`
6. Identity không hợp lệ → `POST /grant/remove`, 400 `IDENTITY_INVALID`
7. Invalidate grant ACTIVE cũ; insert ACTIVE mới
8. Cas 401 khi dùng token → grant `INVALID`, API 401 `CAS_REAUTH_REQUIRED` (bắt nối lại Link)

`withAccessToken`: mọi gọi QR/transactions dùng grant ACTIVE; 401 → invalidate + reauth.

### 9.2. Tạo QR

1. Order tồn tại, chưa PAID/CANCELLED
2. Amount request = amount order, integer > 0
3. Nếu đã có Payment `PENDING` + `qr_code` → trả lại (idempotent)
4. Cas `{ amount, description: orderId, referenceNumber: orderId }`
5. Thiếu `id`/`qrCode` → 502 `CAS_ERROR`
6. Insert Payment `PENDING`, `reference_number = orderId`
7. Order → `PAYMENT_PROCESSING`
8. Audit `qr_created`

Cas timeout → 504 `CAS_TIMEOUT`; 4xx Cas → `CAS_CLIENT_ERROR`; 5xx → `CAS_SERVER_ERROR`.

### 9.3. Đồng bộ khi poll

`fromDate`/`toDate` = ngày tạo payment → hôm nay. Duyệt `transactions[]` / `data.transactions`. Gọi cùng pipeline webhook (idempotent). Dừng khi order PAID.

---

## 10. Mobile

Cas Link **là web**. App merchant:

1. `POST /cas/grant`
2. Mở in-app browser `linkUrl`
3. Bắt `https://fe/cas/callback?publicToken=` (App Link) — URI trùng Console
4. `POST /cas/exchange`
5. Màn hình bán chỉ tạo đơn + hiện `qrCode` từ API

Người mua không đi Cas Link.

IIS/Kestrel: webhook public HTTPS; GET+POST 200. Không sleep cold-start quá lâu (Cas verify fail).

---

## 11. Bảo mật và vận hành

- Secret: Key Vault; `access_token` cột encrypt
- Không log `x-secret-key`, `accessToken`, `CAS_SECRET_KEY`
- Log tối thiểu: `paymentId`, `orderId`, `providerPaymentId`, `transactionId`, `amount`, `status`, `matchStrategy`, `orderCodes`
- Webhook: có thể thêm IP allowlist Cas nếu vendor công bố; vẫn phải 200 với ping
- CORS: origin FE; webhook không cần CORS
- Unique SQL = hàng rào idempotency khi 2 worker
- Alert UNMATCHED / Cas 5xx / grant INVALID
- Reconciliation: so `GET /transactions` với `payments` PENDING quá hạn
- PROD: `Cas:BaseUrl` production, credentials production, webhook URL production

---

## 12. Mã lỗi API

| Code | HTTP | Khi nào |
|---|---|---|
| `INVALID_REQUEST` | 400 | Thiếu publicToken / orderId |
| `INVALID_AMOUNT` | 400 | amount không nguyên dương |
| `AMOUNT_MISMATCH` | 400 | amount QR ≠ order |
| `INVALID_DESCRIPTION` | 400 | mã đơn ≠ 9 ký tự |
| `IDENTITY_INVALID` | 400 | identity Cas không parse được STK |
| `ORDER_NOT_FOUND` | 404 | |
| `ORDER_ALREADY_PAID` | 409 | |
| `ORDER_CANCELLED` | 409 | |
| `PAYMENT_ALREADY_SUCCESS` | 409 | |
| `GRANT_REQUIRED` | 409 | Chưa Link STK |
| `CAS_REAUTH_REQUIRED` | 401 | Token Cas hết hạn |
| `CAS_NOT_CONFIGURED` | 503 | Thiếu client/secret |
| `CAS_TIMEOUT` | 504 | |
| `CAS_NETWORK` / `CAS_ERROR` | 502 | |
| `CAS_CLIENT_ERROR` | 4xx Cas | Kèm `cas.errorCode` (vd `INVALID_PARAM` redirectUri) |
| `FORBIDDEN` | 403 | simulate-webhook ngoài DEV |
| `ORDER_CODE_EXHAUSTED` | 500 | Hết DH9999999 |

---

## 13. Test (Definition of Done)

| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| TC-01 | Tạo order + QR | Payment PENDING, có `qrCode` |
| TC-02 | Quét QR NH | Đúng STK, amount, description `DH#######` |
| TC-03 | CK đúng tiền + webhook | Payment SUCCESS, Order PAID, SignalR/poll PAID |
| TC-04 | Webhook trùng `transaction.id` | `duplicate`, không cộng tiền |
| TC-05 | CK underpay | REJECT, không PAID |
| TC-06 | Tx không map đơn | UNMATCHED, không PAID đơn khác |
| TC-07 | API 500 rồi Cas retry | Lần 2 PAID hoặc duplicate |
| TC-08 | Cas timeout lúc tạo QR | 504, có thể tạo lại |
| TC-09 | Đóng app khi PENDING | Mở lại GET status → PAID sau webhook |
| TC-10 | Description MoMo bọc `-DH0000005-CHUYEN TIEN` | Match `order_code_in_description` |
| TC-11 | `paymentMeta: {}` | Vẫn match bằng DH trong description |
| TC-12 | GET/POST webhook rỗng | HTTP 200 ping (Console) |
| TC-13 | Hai PENDING cùng VA | UNMATCHED ambiguous |
| TC-14 | 401 Cas khi tạo QR | Grant INVALID, FE bắt Link lại |

Simulate (DEV): `POST /dev/simulate-webhook` `{ transactionId, amount, description, accountNumber, paymentMeta }`.

---

## 14. Bài học sandbox (bắt buộc khi port)

1. `paymentMeta` thường rỗng; matching phải đọc **description**.
2. MoMo/Casso chèn prefix/suffix quanh `DH#######`.
3. `accountNumber` webhook = STK merchant, **không** phải VA.
4. `description` Cas QR max **9** ký tự.
5. Webhook Cas Console fail nếu không HTTPS hoặc không 200 (kể cả ping).
6. Grant/QR và webhook **phải cùng database**; tách SQLite local / Mongo cloud từng gây UNMATCHED dù CK đúng.
7. Sequence `DH0000001` sau khi wipe DB **trùng mã cũ** — không auto-replay UNMATCHED lịch sử.
8. Swagger server URL = relative `/`, không hard-code localhost trên production.

---

## 15. Mapping file demo → lớp .NET

| Demo JS | Lớp ASP.NET |
|---|---|
| `src/config/index.js` | `CasOptions` + `IOptions` |
| `src/services/casClient.js` | `CasHttpClient` |
| `src/services/grantService.js` | `GrantService` |
| `src/services/orderService.js` | `OrderService` + `IOrderCodeGenerator` |
| `src/services/paymentService.js` | `PaymentService` |
| `src/services/matchingService.js` | `MatchingService` + `IPaymentNotifier` |
| `src/routes/*.js` | Controllers |
| `src/db/models.js` | EF entities + `VietQrDbContext` |
| SSE `paymentEvents` | SignalR `IHubContext<PaymentHub>` |

FE Next.js hiện tại giữ nguyên contract JSON; chỉ đổi `NEXT_PUBLIC_API_URL` sang host ASP.NET.

---

## 16. Checklist triển khai

- [ ] SQL script + EF migration
- [ ] Unique filtered indexes `provider_payment_id`, `transaction_id`
- [ ] `order_seq` lock khi sinh DH
- [ ] Encrypt `cas_grants.access_token`
- [ ] Cas client timeout + map lỗi
- [ ] Matching đủ 6 bước + regex DH
- [ ] Webhook GET/HEAD/POST ping 200
- [ ] Idempotency txn
- [ ] Amount under/over/null
- [ ] SignalR + poll
- [ ] DEV simulate-webhook
- [ ] Swagger
- [ ] Cas Console: redirect URI + webhook HTTPS
- [ ] Key Vault
- [ ] TC-01…TC-14 trên sandbox rồi production credentials
