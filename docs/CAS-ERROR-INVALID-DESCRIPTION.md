# Cas QR Pay — Mã lỗi `INVALID_PARAM` / `invalid description`

Dành cho đội Backend (Node hiện tại / ASP.NET port).  
Nguồn: sandbox Cas `POST https://sandbox.bankhub.dev/qr-pay` (API version `2023-01-01`), kiểm tra thực tế 2026-10-14.

---

## 1. Triệu chứng phía app

Khi FE gửi nội dung CK có **dấu gạch ngang**, ví dụ `DH-01234`:

- Order có thể tạo thành công trong DB (nếu app chưa validate charset).
- Gọi Cas `POST /qr-pay` **fail**.
- API nội bộ trả về ~400 với payload dạng:

```json
{
  "error": "INVALID_PARAM",
  "message": "invalid description",
  "cas": {
    "errorType": "GRANT_ERROR",
    "errorCode": "INVALID_PARAM",
    "errorMessage": "invalid description",
    "requestId": "LdvZXnLUgaEFGTjm"
  }
}
```

| Field | Giá trị |
|---|---|
| HTTP (Cas) | `400` |
| `error` / `errorCode` | `INVALID_PARAM` |
| `errorType` | `GRANT_ERROR` |
| `errorMessage` | `invalid description` |
| API gây lỗi | `POST /qr-pay` |
| Body field lỗi | `description` (và thường gửi kèm `referenceNumber`) |

Đây **không phải** lỗi grant hết hạn (`CAS_UNAUTHORIZED` / 401). Grant vẫn dùng được; chỉ **nội dung `description` không hợp lệ** theo rule Cas/NH.

---

## 2. Nguyên nhân gốc

Cas giới hạn `description` (nội dung CK trên QR):

1. **Tối đa 9 ký tự** (đã biết từ tài liệu / checklist demo).
2. **Không chấp nhận một số ký tự đặc biệt** — đặc biệt **dấu `-` (hyphen)**.

Request thực tế bị reject:

```json
{
  "amount": 2000,
  "description": "DH-01234",
  "referenceNumber": "DH-01234"
}
```

→ Cas: `INVALID_PARAM` / `invalid description`.

Cùng sandbox, **bỏ dấu `-`** thì OK:

```json
{
  "amount": 2000,
  "description": "DH01234",
  "referenceNumber": "DH01234"
}
```

→ `200` / tạo QR thành công.

---

## 3. Kết quả probe sandbox (bắt buộc khi fix)

| `description` | Kết quả Cas |
|---|---|
| `DH-01234` | **FAIL** `invalid description` |
| `DH-00001` | **FAIL** |
| `DH_01234` | **FAIL** |
| `DH.01234` | **FAIL** |
| `DH01234!` | **FAIL** |
| `DH01234#` | **FAIL** |
| `@BC12XYZ` | **FAIL** |
| `DH01234` | **OK** |
| `DH0001234` | **OK** (9 ký tự) |
| `DH012345` | **OK** |
| `DH0123456` | **OK** (9 ký tự) |
| `ABC12XYZ` | **OK** |
| `test123` | **OK** |
| `dh01234` | **OK** (chữ thường) |
| `123456789` | **OK** |
| `A1B2C3D4E` | **OK** |

**Kết luận charset an toàn (khuyến nghị enforce phía BE):**

```text
^[A-Za-z0-9]{1,9}$
```

- Chỉ chữ cái Latin + số.
- Độ dài 1–9.
- **Cấm** `-` `_` `.` `@` `!` `#` và các ký tự đặc biệt khác.
- Không dựa vào việc Cas “chấp nhận khoảng trắng” trong vài case sandbox — **không dùng space** trong nội dung CK product.

`referenceNumber` có thể dài hơn `description` trong ví dụ docs Cas (`"1234455811acbc"`), nhưng demo hiện tại set cả hai = cùng nội dung CK ngắn. Khi custom content: giữ `description` theo rule trên; `referenceNumber` nên cùng giá trị đó (hoặc order id alphanumeric) để matching webhook đơn giản.

---

## 4. Mapping lỗi cho API nội bộ

| Situation | HTTP API | `error` | Ghi chú |
|---|---|---|---|
| FE gửi `DH-01234` / có `-` | **400** (validate trước) | `INVALID_DESCRIPTION` | Không gọi Cas |
| FE gửi > 9 ký tự | 400 | `INVALID_DESCRIPTION` | |
| FE gửi khoảng trắng / ký tự lạ | 400 | `INVALID_DESCRIPTION` | |
| Lọt xuống Cas vẫn reject | 400 | `INVALID_PARAM` (+ block `cas`) | Log `requestId` |
| Grant thiếu / 401 Cas | 401 | `CAS_REAUTH_REQUIRED` | Khác hẳn lỗi này |

Message gợi ý trả FE:

```text
Nội dung CK chỉ gồm chữ và số, tối đa 9 ký tự (không dùng dấu -). Ví dụ: DH01234
```

---

## 5. Việc BE cần sửa

### 5.1. Validate trước khi gọi Cas

Trong `CreateOrder` / `CreateQr`:

```csharp
// Pseudo
const int CasDescMax = 9;
static readonly Regex CasDescRe = new(@"^[A-Za-z0-9]{1,9}$", RegexOptions.CultureInvariant);

string NormalizeTransferContent(string? raw) {
  if (string.IsNullOrWhiteSpace(raw)) return null; // fallback order id
  var text = raw.Trim();
  if (text.Length > CasDescMax || !CasDescRe.IsMatch(text))
    throw ApiException(400, "INVALID_DESCRIPTION",
      "Transfer content: A-Z, a-z, 0-9 only, max 9 chars (no hyphen). Example: DH01234");
  return text;
}
```

Node tương đương: reject sớm nếu không khớp `/^[A-Za-z0-9]{1,9}$/`.

### 5.2. Đổi format mã đơn mặc định

| Cũ (sai với Cas) | Mới (OK) |
|---|---|
| `DH-01234` (8, có `-`) | `DH01234` (7, alphanumeric) |

- Prefix `DH` + 5 số: `DH00001` … `DH99999` (hoặc pad theo product).
- `orders.id` / `orders.description` / Cas `description` / `referenceNumber` / matching webhook dùng **cùng** chuỗi alphanumeric.

### 5.3. Matching webhook

- Regex mã đơn: `\bDH\d{5,7}\b` (hoặc đúng độ dài product).
- Vẫn hỗ trợ legacy `DH0000001` nếu còn data cũ.
- **Không** expect `DH-01234` trong description ngân hàng nếu Cas không cho đưa `-` vào QR.
- Custom content (FE): match bằng `paymentMeta.referenceNumber` **hoặc** `description` bank chứa `payments.reference_number` (substring), vì MoMo vẫn có thể bọc thêm prefix/suffix quanh mã alphanumeric.

### 5.4. FE / contract

```json
POST /api/v1/orders
{
  "amount": 2000,
  "description": "DH01234"
}
```

- Placeholder / ví dụ: `DH01234`, **không** `DH-01234`.
- `maxLength: 9`, pattern `[A-Za-z0-9]+`.

### 5.5. SQL / domain (ASP.NET)

- Cột `orders.description` / `orders.id`: `VARCHAR(9)`, check constraint charset nếu cần.
- Tài liệu kỹ thuật tổng: cập nhật mọi chỗ ghi `DH-01234` → `DH01234`.

---

## 6. Test plan (Definition of Done cho fix)

| ID | Input `description` | Kỳ vọng |
|---|---|---|
| E-01 | `DH-01234` | API **400** `INVALID_DESCRIPTION` — **không** gọi Cas |
| E-02 | `DH01234` | Tạo QR OK, UI hiện nội dung `DH01234` |
| E-03 | `ABC12XYZ` | Tạo QR OK |
| E-04 | `DH0123456` (9) | Tạo QR OK |
| E-05 | `TOOLONG123` (>9) | 400 `INVALID_DESCRIPTION` |
| E-06 | `DH_01234` | 400 `INVALID_DESCRIPTION` |
| E-07 | (để trống) | Dùng mã đơn auto `DH#####`, QR OK |
| E-08 | Webhook description chứa `...DH01234...` | Match → PAID |

Reproduce Cas trực tiếp (sau khi có `accessToken`):

```bash
curl -sS 'https://sandbox.bankhub.dev/qr-pay' \
  -H 'X-BankHub-Api-Version: 2023-01-01' \
  -H 'Authorization: <ACCESS_TOKEN>' \
  -H 'x-client-id: <CLIENT_ID>' \
  -H 'x-secret-key: <SECRET_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"amount":2000,"description":"DH-01234","referenceNumber":"DH-01234"}'
# → 400 invalid description

curl -sS 'https://sandbox.bankhub.dev/qr-pay' \
  -H 'X-BankHub-Api-Version: 2023-01-01' \
  -H 'Authorization: <ACCESS_TOKEN>' \
  -H 'x-client-id: <CLIENT_ID>' \
  -H 'x-secret-key: <SECRET_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"amount":2000,"description":"DH01234","referenceNumber":"DH01234"}'
# → 200 + qrCode
```

---

## 7. Liên quan tài liệu khác

- Tổng hợp port ASP.NET + SQL: `docs/KY-THUAT-BACKEND-ASPNET-SQLSERVER.md` — cập nhật format mã đơn / charset theo doc này.
- Cas docs mẫu dùng `description: "cassotest"` (alphanumeric): https://cas.so/en/product/qr-pay/

---

## 8. Tóm tắt một dòng cho ticket BE

> Cas `POST /qr-pay` trả `INVALID_PARAM` / `invalid description` khi `description` chứa dấu `-` (vd `DH-01234`). Fix: chỉ cho phép `[A-Za-z0-9]{1,9}`, đổi mã mặc định thành `DH01234`, validate trước khi gọi Cas, cập nhật matching + FE placeholder.
