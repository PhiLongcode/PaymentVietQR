CAS QR Pay — Development & Test Checklist
1. CAS / Sandbox Configuration
Grant & Authentication
- [x] Tạo Grant với scope qrpay
- [x] CAS Login thành công
- [x] Lấy publicToken
- [x] Exchange publicToken → accessToken
- [x] Gọi QR Pay Identity thành công
- [ ] Xử lý access token hết hạn
- [ ] Xử lý refresh/re-authentication
- [ ] Không hard-code clientId, secretKey, accessToken
Environment
- [x] Sandbox URL:
https://sandbox.bankhub.dev

- [x] API version:
2023-01-01

- [ ] Tách config:
DEV
STAGING
PRODUCTION

- [ ] Secret lưu bằng environment variables / Secret Manager
- [ ] Không log secretKey
- [ ] Không log accessToken
2. QR Generation
Backend cần có API nội bộ, ví dụ:
POST /api/v1/payments/qr

Request:
{
  "orderId": "ORDER-001",
  "amount": 2000
}

Backend:
Order
  ↓
Create Payment
  ↓
CAS POST /qr-pay

Checklist
- [x] Gọi CAS /qr-pay
- [x] Generate QR thành công
- [x] Nhận qrPay.id
- [x] Nhận qrCode
- [x] Nhận accountNumber
- [x] Nhận virtualAccountNumber
- [x] Nhận referenceNumber
- [ ] Validate amount > 0
- [ ] Validate order tồn tại
- [ ] Không cho tạo QR cho Order đã PAID
- [ ] Không cho tạo QR với Order đã CANCELLED
- [ ] Xử lý CAS timeout
- [ ] Xử lý CAS 4xx
- [ ] Xử lý CAS 5xx
3. Database — Payment
Mình khuyên tạo bảng riêng:
payments

Ví dụ:
Field	Ý nghĩa
id	Payment ID nội bộ
order_id	Order tương ứng
provider	CAS
provider_payment_id	qrPay.id
amount	Số tiền
currency	VND
qr_code	Chuỗi QR
account_number	STK nhận
virtual_account_number	Virtual Account
reference_number	Reference
status	PENDING / PAID / FAILED / EXPIRED
transaction_id	CAS transaction ID
transaction_reference	Bank reference
paid_at	Thời gian thanh toán
created_at	Thời gian tạo
updated_at	Thời gian cập nhật


Checklist
- [ ] Tạo Payment khi generate QR
- [ ] status = PENDING
- [ ] Lưu qrPay.id
- [ ] Lưu qrCode
- [ ] Lưu virtualAccountNumber
- [ ] Lưu amount
- [ ] Lưu reference
- [ ] Unique provider_payment_id
- [ ] Unique transaction_id
4. App — Hiển thị QR
API:
GET /api/v1/orders/{orderId}/payment

Response:
{
  "orderId": "ORDER-001",
  "amount": 2000,
  "status": "PENDING",
  "qrCode": "...",
  "accountName": "NGUYEN PHI LONG",
  "accountNumber": "0349134490"
}

App:
┌─────────────────────────┐
│      Thanh toán         │
│                         │
│        ███████          │
│        █ QR  █          │
│        ███████          │
│                         │
│ Số tiền                 │
│ 2.000 VND               │
│                         │
│ MBBank                  │
│ 0349134490              │
│                         │
│ ⏳ Chờ thanh toán        │
└─────────────────────────┘

Checklist
- [ ] Render QR chính xác
- [ ] Hiển thị amount
- [ ] Hiển thị bank
- [ ] Hiển thị account
- [ ] Hiển thị trạng thái
- [ ] Có nút Hủy thanh toán
- [ ] Có countdown nếu payment có expiry
- [ ] Không cho user chỉnh amount
- [ ] Không tự generate QR ở frontend
Quan trọng: App nên nhận qrCode từ Backend. Không nên tự build QR string ở mobile/frontend.
5. Webhook — Quan trọng nhất
Endpoint:
POST /api/v1/webhooks/cas/transactions

CAS gửi:
{
  "webhookType": "TRANSACTIONS",
  "webhookCode": "DEFAULT_UPDATE",
  "error": null,
  "grantId": "...",
  "environment": "dev",
  "transaction": {
    "id": "...",
    "accountNumber": "0349134490",
    "transactionDate": "2026-10-06",
    "transactionDateTime": "2026-10-06T12:08:20+07:00",
    "amount": 2000,
    "description": "...",
    "reference": "FT26279224909306",
    "counterAccountNumber": "2281072020614",
    "fiName": "MBBank",
    "fiServiceName": "MBBank VietQR Official",
    "currency": "VND",
    "paymentMeta": {}
  }
}

Checklist
- [ ] Endpoint public HTTPS
- [ ] Nhận POST
- [ ] Parse JSON
- [ ] Validate webhookType
- [ ] Validate environment
- [ ] Validate transaction
- [ ] Log request ID / transaction ID
- [ ] Không log secret/token
- [ ] Trả HTTP 200 khi xử lý thành công
- [ ] Trả lỗi phù hợp khi payload invalid
6. Payment Matching — CỰC KỲ QUAN TRỌNG
Đây là phần bạn vừa phát hiện trong Sandbox.
Bạn tạo:
referenceNumber = ORDER-001

nhưng webhook thực tế:
"paymentMeta": {}

Do đó không được thiết kế backend với giả định:
paymentMeta.referenceNumber luôn tồn tại

Thay vào đó cần xác định chiến lược matching chính thức với CAS.
Các dữ liệu hiện có:
qrPay.id
virtualAccountNumber
accountNumber
amount
description
transaction.id
transaction.reference

Với transaction thực tế của bạn:
QR Pay ID:
ghwyGM9hULDZt9xDgoHhjSZ8

Amount:
2000

Description:
PX00002

Transaction ID:
f30b1647c14311f1ae22fa163e5398eb

Bank reference:
FT26279224909306

Checklist
- [ ] Xác định primary key để match Payment
- [ ] Xác định fallback matching
- [ ] Không match chỉ bằng amount
- [ ] Không match chỉ bằng accountNumber
- [ ] Không match transaction vào Order nếu ambiguity
- [ ] Có trạng thái UNMATCHED để xử lý thủ công
- [ ] Có audit log
Quy tắc nên hướng tới
Webhook
   ↓
Find Payment
   ↓
Payment found?
 ┌───────┴───────┐
YES              NO
 ↓                ↓
Validate       UNMATCHED
amount
 ↓
Validate
account
 ↓
Mark PAID

7. Amount Validation
Ví dụ Order:
ORDER-001
Expected = 2,000

CAS:
Received = 2,000

→ OK.
Test cases
Expected	Received	Kết quả
2,000	2,000	✅ PAID
2,000	1,000	❌ REJECT
2,000	3,000	❌ REVIEW
2,000	0	❌ REJECT
2,000	null	❌ REJECT


8. Idempotency
Cực kỳ quan trọng vì webhook có thể được gửi lại.
Test:
Webhook #1
transaction.id = ABC123

→ Order:
PENDING → PAID

Gửi lại:
Webhook #2
transaction.id = ABC123

Kết quả phải:
PAID → PAID

Không tạo Payment thứ hai.
Checklist
- [ ] Unique transaction ID
- [ ] Check transaction đã tồn tại
- [ ] Duplicate webhook không gây lỗi
- [ ] Duplicate webhook không cộng tiền lần 2
- [ ] Duplicate webhook không tạo Order event lần 2
9. Order State Machine
Đừng chỉ dùng boolean:
isPaid = true

Nên có:
PENDING_PAYMENT
       ↓
PAYMENT_PROCESSING
       ↓
PAID

Các nhánh:
PENDING_PAYMENT
      ├──→ PAID
      ├──→ EXPIRED
      └──→ CANCELLED

Payment:
PENDING
  ├──→ SUCCESS
  ├──→ FAILED
  └──→ EXPIRED

10. App cập nhật trạng thái
Sau khi CAS webhook:
CAS
 ↓
Backend
 ↓
Payment = PAID
 ↓
Order = PAID

App phải biết trạng thái mới.
Có 3 cách:
Cách 1 — Polling
GET /orders/{id}/payment-status

mỗi 2–5 giây.
Dễ implement nhất cho MVP.
Cách 2 — WebSocket
CAS
 ↓
Webhook
 ↓
Backend
 ↓
WebSocket
 ↓
Mobile

Realtime hơn.
Cách 3 — SSE
Nếu architecture của bạn phù hợp.
MVP mình khuyên Polling trước.
11. Test End-to-End
Đây là checklist test quan trọng nhất.
TC-01 — Generate QR
Create Order
↓
Generate QR
↓
Payment PENDING

Expected:
HTTP 200
QR xuất hiện

TC-02 — Scan QR
Mobile banking
↓
Scan QR

Expected:
Bank
Amount
Receiver
Description

đúng.
TC-03 — Successful payment
Pay 2,000
↓
CAS
↓
TRANSACTIONS
↓
Backend
↓
Payment PAID
↓
Order PAID

TC-04 — Duplicate webhook
Gửi cùng transaction 2 lần.
Expected:
Payment vẫn PAID
Không duplicate

TC-05 — Wrong amount
Order:
2,000

Payment:
1,000

Expected:
Không PAID

TC-06 — Unknown transaction
CAS gửi transaction không map được Order.
Expected:
UNMATCHED

Không tự động mark Order.
TC-07 — Webhook retry
Giả lập:
CAS → Backend
HTTP 500

Sau đó CAS retry.
Expected:
Backend nhận lại
↓
Xử lý thành công

TC-08 — CAS timeout
CAS request timeout.
Expected:
Backend vẫn xử lý idempotent

TC-09 — User đóng app
QR displayed
↓
User đóng app
↓
Payment
↓
CAS webhook
↓
Order PAID

Khi mở lại app:
GET payment status
↓
PAID

12. Logging / Monitoring
Log tối thiểu:
paymentId
orderId
provider
providerPaymentId
transactionId
amount
status
createdAt
paidAt

Không log:
❌ x-secret-key
❌ accessToken
❌ client secret

13. Production Checklist
Trước khi production:
- [ ] Production CAS credentials
- [ ] Production endpoint
- [ ] HTTPS
- [ ] Webhook production URL
- [ ] Secret Manager
- [ ] Database transaction
- [ ] Idempotency
- [ ] Amount validation
- [ ] Payment matching
- [ ] Webhook retry handling
- [ ] Timeout handling
- [ ] Monitoring
- [ ] Alert khi UNMATCHED
- [ ] Alert khi webhook failure
- [ ] Audit log
- [ ] Payment reconciliation
- [ ] Manual transaction reconciliation
- [ ] Security review
🎯 Definition of Done
Mình đề xuất bạn chỉ coi CAS QR Payment Integration DONE khi test được case này:
┌───────────────────────────────┐
│          CREATE ORDER         │
│          ORDER-001            │
│          2,000 VND            │
└───────────────┬───────────────┘
                ↓
          Generate QR
                ↓
       CAS /qr-pay SUCCESS
                ↓
          Show QR in App
                ↓
       Customer scans QR
                ↓
        Customer pays 2,000
                ↓
             MBBank
                ↓
              CAS
                ↓
       TRANSACTIONS webhook
                ↓
             Backend
                ↓
       Validate + Idempotency
                ↓
        Find corresponding
             Payment
                ↓
          Payment = PAID
                ↓
           Order = PAID
                ↓
             Mobile
                ↓
       🎉 Thanh toán thành công