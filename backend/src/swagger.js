const { config } = require("./config");

const spec = {
  openapi: "3.0.3",
  info: {
    title: "VietQR Pay Demo API",
    version: "1.0.0",
    description:
      "Internal APIs for Cas QR Pay: grant, orders, QR, webhook, unmatched.",
  },
  servers: [
    { url: "http://localhost:" + config.port, description: "Local" },
    {
      url: "https://paymentvietqr.onrender.com",
      description: "Render",
    },
  ],
  tags: [
    { name: "Health" },
    { name: "Cas Grant" },
    { name: "Orders" },
    { name: "Payments" },
    { name: "Webhook" },
    { name: "Dev" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                example: { ok: true, env: "DEV" },
              },
            },
          },
        },
      },
    },
    "/api/v1/cas/grant": {
      post: {
        tags: ["Cas Grant"],
        summary: "Tạo grantToken + Cas Link URL (scopes qrpay,transaction)",
        responses: { 200: { description: "grantToken, linkUrl" } },
      },
    },
    "/api/v1/cas/exchange": {
      post: {
        tags: ["Cas Grant"],
        summary: "Đổi publicToken → accessToken, gọi GET /qr-pay/identity",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["publicToken"],
                properties: { publicToken: { type: "string" } },
              },
            },
          },
        },
        responses: { 200: { description: "grant ACTIVE (không trả accessToken)" } },
      },
    },
    "/api/v1/cas/status": {
      get: {
        tags: ["Cas Grant"],
        summary: "Grant hiện tại",
        responses: { 200: { description: "hasActiveGrant + identity tóm tắt" } },
      },
    },
    "/api/v1/orders": {
      get: {
        tags: ["Orders"],
        summary: "Danh sách đơn",
        responses: { 200: { description: "orders[]" } },
      },
      post: {
        tags: ["Orders"],
        summary: "Tạo đơn — mã DH0000001 (9 ký tự = nội dung CK)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["amount"],
                properties: { amount: { type: "integer", example: 2000 } },
              },
            },
          },
        },
        responses: { 201: { description: "Order PENDING_PAYMENT" } },
      },
    },
    "/api/v1/orders/{orderId}/payment": {
      get: {
        tags: ["Orders"],
        summary: "Chi tiết QR / payment (poll Cas transactions nếu PENDING)",
        parameters: [
          {
            name: "orderId",
            in: "path",
            required: true,
            schema: { type: "string", example: "DH0000001" },
          },
        ],
        responses: { 200: { description: "qrCode, status, account" } },
      },
    },
    "/api/v1/orders/{orderId}/payment-status": {
      get: {
        tags: ["Orders"],
        summary: "Status ngắn cho polling",
        parameters: [
          {
            name: "orderId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { 200: { description: "status PAID | PENDING | ..." } },
      },
    },
    "/api/v1/orders/{orderId}/cancel": {
      post: {
        tags: ["Orders"],
        summary: "Hủy đơn nếu chưa PAID",
        parameters: [
          {
            name: "orderId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { 200: { description: "CANCELLED" } },
      },
    },
    "/api/v1/payments/qr": {
      post: {
        tags: ["Payments"],
        summary: "Gọi Cas POST /qr-pay, lưu Payment PENDING",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["orderId"],
                properties: {
                  orderId: { type: "string", example: "DH0000001" },
                  amount: { type: "integer", example: 2000 },
                },
              },
            },
          },
        },
        responses: { 201: { description: "QR public payload" } },
      },
    },
    "/api/v1/webhooks/cas/transactions": {
      get: {
        tags: ["Webhook"],
        summary: "Ping cho Cas Console verify URL",
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                example: { ok: true, ping: true },
              },
            },
          },
        },
      },
      post: {
        tags: ["Webhook"],
        summary: "Cas TRANSACTIONS webhook (ping body rỗng vẫn 200)",
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object" },
              example: {
                webhookType: "TRANSACTIONS",
                environment: "dev",
                transaction: {
                  id: "txn-1",
                  accountNumber: "VQRQAMOKR7314",
                  amount: 2000,
                  description: "DH0000001",
                  reference: "FT123",
                  paymentMeta: {},
                },
              },
            },
          },
        },
        responses: { 200: { description: "paid | unmatched | ping | duplicate" } },
      },
    },
    "/api/v1/unmatched": {
      get: {
        tags: ["Webhook"],
        summary: "Giao dịch chưa khớp Payment",
        responses: { 200: { description: "items[]" } },
      },
    },
    "/api/v1/dev/simulate-webhook": {
      post: {
        tags: ["Dev"],
        summary: "Giả lập webhook (chỉ NODE_ENV=DEV)",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  transactionId: { type: "string" },
                  amount: { type: "integer", example: 2000 },
                  description: { type: "string", example: "DH0000001" },
                  accountNumber: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Kết quả matching" },
          403: { description: "Không phải DEV" },
        },
      },
    },
  },
};

module.exports = { spec };
