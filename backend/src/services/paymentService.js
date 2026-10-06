const { db, nowIso, newId } = require("../db");
const logger = require("../logger");
const cas = require("./casClient");
const grantService = require("./grantService");
const orderService = require("./orderService");

function getPaymentByOrderId(orderId) {
  return db
    .prepare(
      `SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(orderId);
}

function getPaymentById(id) {
  return db.prepare(`SELECT * FROM payments WHERE id = ?`).get(id);
}

function getPaymentByProviderId(providerPaymentId) {
  return db
    .prepare(`SELECT * FROM payments WHERE provider_payment_id = ?`)
    .get(providerPaymentId);
}

function getPaymentByTransactionId(transactionId) {
  return db
    .prepare(`SELECT * FROM payments WHERE transaction_id = ?`)
    .get(transactionId);
}

function findPendingByVirtualAccount(va) {
  if (!va) return [];
  return db
    .prepare(
      `SELECT * FROM payments WHERE virtual_account_number = ? AND status = 'PENDING'`
    )
    .all(va);
}

function findPendingByVirtualAccountInText(text) {
  if (!text) return [];
  return db
    .prepare(
      `SELECT * FROM payments
       WHERE status = 'PENDING'
         AND virtual_account_number IS NOT NULL
         AND virtual_account_number != ''
         AND instr(?, virtual_account_number) > 0`
    )
    .all(text);
}

function findPendingByDescription(text) {
  if (!text) return [];
  return db
    .prepare(
      `SELECT * FROM payments
       WHERE status = 'PENDING'
         AND (
           instr(lower(?), lower(reference_number)) > 0
           OR instr(lower(?), lower(order_id)) > 0
         )`
    )
    .all(text, text);
}

function audit({
  paymentId,
  orderId,
  providerPaymentId,
  transactionId,
  amount,
  fromStatus,
  toStatus,
  reason,
}) {
  db.prepare(
    `INSERT INTO audit_logs (
      payment_id, order_id, provider, provider_payment_id, transaction_id,
      amount, from_status, to_status, reason, created_at
    ) VALUES (?, ?, 'CAS', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    paymentId || null,
    orderId || null,
    providerPaymentId || null,
    transactionId || null,
    amount ?? null,
    fromStatus || null,
    toStatus || null,
    reason || null,
    nowIso()
  );
}

function unwrapQrPay(data) {
  const q = data?.qrPay || data?.data || data || {};
  return {
    id: q.id || q.qrPayId,
    qrCode: q.qrCode,
    accountNumber: q.accountNumber,
    virtualAccountNumber: q.virtualAccountNumber,
    referenceNumber: q.referenceNumber,
    accountName: q.accountName || q.accountHolderName,
    fiName: q.fiName || q.bankName,
    amount: q.amount,
    expiredAt: q.expiredAt || q.expiresAt || q.expiredTime,
  };
}

async function createQr({ orderId, amount }) {
  const order = orderService.getOrder(orderId);
  if (!order) {
    const err = new Error("Order not found");
    err.status = 404;
    err.code = "ORDER_NOT_FOUND";
    throw err;
  }
  if (order.status === "PAID") {
    const err = new Error("Cannot create QR for a PAID order");
    err.status = 409;
    err.code = "ORDER_ALREADY_PAID";
    throw err;
  }
  if (order.status === "CANCELLED") {
    const err = new Error("Cannot create QR for a CANCELLED order");
    err.status = 409;
    err.code = "ORDER_CANCELLED";
    throw err;
  }

  const requestedAmount = amount != null ? Number(amount) : order.amount;
  if (!Number.isInteger(requestedAmount) || requestedAmount <= 0) {
    const err = new Error("amount must be an integer > 0");
    err.status = 400;
    err.code = "INVALID_AMOUNT";
    throw err;
  }
  if (requestedAmount !== order.amount) {
    const err = new Error("amount must match the order");
    err.status = 400;
    err.code = "AMOUNT_MISMATCH";
    throw err;
  }

  const existing = getPaymentByOrderId(orderId);
  if (existing && existing.status === "PENDING" && existing.qr_code) {
    return existing;
  }
  if (existing && existing.status === "SUCCESS") {
    const err = new Error("Order already has a successful payment");
    err.status = 409;
    err.code = "PAYMENT_ALREADY_SUCCESS";
    throw err;
  }

  const transferContent = order.id;
  if (!transferContent || transferContent.length > 9) {
    const err = new Error("Order code (transfer description) must be at most 9 characters");
    err.status = 400;
    err.code = "INVALID_DESCRIPTION";
    throw err;
  }

  const casPayload = {
    amount: order.amount,
    description: transferContent,
    referenceNumber: transferContent,
  };

  const casData = await grantService.withAccessToken((token, grant) =>
    cas.createQrPay(token, casPayload)
  );
  const q = unwrapQrPay(casData);
  if (!q.id || !q.qrCode) {
    const err = new Error("Cas QR Pay response missing qrPay.id or qrCode");
    err.status = 502;
    err.code = "CAS_ERROR";
    throw err;
  }

  const id = newId("PAY");
  const ts = nowIso();
  const grant = grantService.getActiveGrant();

  db.prepare(
    `INSERT INTO payments (
      id, order_id, provider, provider_payment_id, amount, currency,
      qr_code, account_name, account_number, virtual_account_number,
      reference_number, fi_name, status, expires_at, created_at, updated_at
    ) VALUES (?, ?, 'CAS', ?, ?, 'VND', ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`
  ).run(
    id,
    order.id,
    q.id,
    order.amount,
    q.qrCode,
    q.accountName || grant?.account_name || null,
    q.accountNumber || grant?.account_number || null,
    q.virtualAccountNumber || null,
    q.referenceNumber || transferContent,
    q.fiName || grant?.fi_name || null,
    q.expiredAt || null,
    ts,
    ts
  );

  orderService.setOrderStatus(order.id, "PAYMENT_PROCESSING");
  audit({
    paymentId: id,
    orderId: order.id,
    providerPaymentId: q.id,
    amount: order.amount,
    fromStatus: null,
    toStatus: "PENDING",
    reason: "qr_created",
  });

  logger.info("payment.created", {
    paymentId: id,
    orderId: order.id,
    provider: "CAS",
    providerPaymentId: q.id,
    amount: order.amount,
    status: "PENDING",
    createdAt: ts,
  });

  return getPaymentById(id);
}

function toPublicPayment(payment, order) {
  if (!payment) return null;
  return {
    orderId: order.id,
    description: order.id,
    paymentId: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    status: mapAppStatus(order.status, payment.status),
    paymentStatus: payment.status,
    orderStatus: order.status,
    qrCode: payment.qr_code,
    accountName: payment.account_name,
    accountNumber: payment.account_number,
    virtualAccountNumber: payment.virtual_account_number,
    fiName: payment.fi_name,
    referenceNumber: payment.reference_number,
    expiresAt: payment.expires_at,
    paidAt: payment.paid_at,
  };
}

function mapAppStatus(orderStatus, paymentStatus) {
  if (orderStatus === "PAID" || paymentStatus === "SUCCESS") return "PAID";
  if (orderStatus === "CANCELLED") return "CANCELLED";
  if (paymentStatus === "EXPIRED" || orderStatus === "EXPIRED") return "EXPIRED";
  if (paymentStatus === "FAILED") return "FAILED";
  return "PENDING";
}

function getOrderPayment(orderId) {
  const order = orderService.getOrder(orderId);
  if (!order) {
    const err = new Error("Order not found");
    err.status = 404;
    err.code = "ORDER_NOT_FOUND";
    throw err;
  }
  const payment = getPaymentByOrderId(orderId);
  return toPublicPayment(payment, order) || {
    orderId: order.id,
    description: order.id,
    amount: order.amount,
    currency: order.currency,
    status: mapAppStatus(order.status, null),
    paymentStatus: null,
    orderStatus: order.status,
    qrCode: null,
  };
}

function cancelOrder(orderId) {
  const order = orderService.getOrder(orderId);
  if (!order) {
    const err = new Error("Order not found");
    err.status = 404;
    err.code = "ORDER_NOT_FOUND";
    throw err;
  }
  if (order.status === "PAID") {
    const err = new Error("Cannot cancel a PAID order");
    err.status = 409;
    err.code = "ORDER_ALREADY_PAID";
    throw err;
  }
  if (order.status === "CANCELLED") return getOrderPayment(orderId);

  const payment = getPaymentByOrderId(orderId);
  const ts = nowIso();
  if (payment && payment.status === "PENDING") {
    db.prepare(
      `UPDATE payments SET status = 'FAILED', updated_at = ? WHERE id = ?`
    ).run(ts, payment.id);
    audit({
      paymentId: payment.id,
      orderId,
      providerPaymentId: payment.provider_payment_id,
      amount: payment.amount,
      fromStatus: "PENDING",
      toStatus: "FAILED",
      reason: "user_cancelled",
    });
  }
  orderService.setOrderStatus(orderId, "CANCELLED");
  return getOrderPayment(orderId);
}

module.exports = {
  createQr,
  getOrderPayment,
  cancelOrder,
  getPaymentByOrderId,
  getPaymentByProviderId,
  getPaymentByTransactionId,
  findPendingByVirtualAccount,
  findPendingByVirtualAccountInText,
  findPendingByDescription,
  audit,
  toPublicPayment,
};
