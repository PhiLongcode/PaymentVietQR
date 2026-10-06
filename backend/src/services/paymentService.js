const { nowIso, newId } = require("../db");
const { Payment, AuditLog, plain } = require("../db/models");
const logger = require("../logger");
const cas = require("./casClient");
const grantService = require("./grantService");
const orderService = require("./orderService");

async function getPaymentByOrderId(orderId) {
  return plain(await Payment.findOne({ order_id: orderId }).sort({ created_at: -1 }));
}

async function getPaymentById(id) {
  return plain(await Payment.findOne({ id }));
}

async function getPaymentByProviderId(providerPaymentId) {
  return plain(await Payment.findOne({ provider_payment_id: providerPaymentId }));
}

async function getPaymentByTransactionId(transactionId) {
  return plain(await Payment.findOne({ transaction_id: transactionId }));
}

async function findPendingByVirtualAccount(va) {
  if (!va) return [];
  const rows = await Payment.find({ virtual_account_number: va, status: "PENDING" });
  return rows.map(plain);
}

async function findPendingByVirtualAccountInText(text) {
  if (!text) return [];
  const pending = await Payment.find({
    status: "PENDING",
    virtual_account_number: { $nin: [null, ""] },
  });
  return pending.map(plain).filter((p) => text.includes(p.virtual_account_number));
}

async function findPendingByDescription(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const pending = await Payment.find({ status: "PENDING" });
  return pending
    .map(plain)
    .filter(
      (p) =>
        (p.reference_number && lower.includes(String(p.reference_number).toLowerCase())) ||
        (p.order_id && lower.includes(String(p.order_id).toLowerCase()))
    );
}

async function findByOrderOrReference(code) {
  if (!code) return [];
  const rows = await Payment.find({
    $or: [{ order_id: code }, { reference_number: code }],
  }).sort({ created_at: -1 });
  return rows.map(plain);
}

async function audit({
  paymentId,
  orderId,
  providerPaymentId,
  transactionId,
  amount,
  fromStatus,
  toStatus,
  reason,
}) {
  await AuditLog.create({
    payment_id: paymentId || null,
    order_id: orderId || null,
    provider: "CAS",
    provider_payment_id: providerPaymentId || null,
    transaction_id: transactionId || null,
    amount: amount ?? null,
    from_status: fromStatus || null,
    to_status: toStatus || null,
    reason: reason || null,
    created_at: nowIso(),
  });
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
  const order = await orderService.getOrder(orderId);
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

  const existing = await getPaymentByOrderId(orderId);
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

  const casData = await grantService.withAccessToken((token) =>
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
  const grant = await grantService.getActiveGrant();

  await Payment.create({
    id,
    order_id: order.id,
    provider: "CAS",
    provider_payment_id: q.id,
    amount: order.amount,
    currency: "VND",
    qr_code: q.qrCode,
    account_name: q.accountName || grant?.account_name || null,
    account_number: q.accountNumber || grant?.account_number || null,
    virtual_account_number: q.virtualAccountNumber || null,
    reference_number: transferContent,
    fi_name: q.fiName || grant?.fi_name || null,
    status: "PENDING",
    expires_at: q.expiredAt || null,
    created_at: ts,
    updated_at: ts,
  });

  await orderService.setOrderStatus(order.id, "PAYMENT_PROCESSING");
  await audit({
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

async function getOrderPayment(orderId) {
  const order = await orderService.getOrder(orderId);
  if (!order) {
    const err = new Error("Order not found");
    err.status = 404;
    err.code = "ORDER_NOT_FOUND";
    throw err;
  }
  const payment = await getPaymentByOrderId(orderId);
  return (
    toPublicPayment(payment, order) || {
      orderId: order.id,
      description: order.id,
      amount: order.amount,
      currency: order.currency,
      status: mapAppStatus(order.status, null),
      paymentStatus: null,
      orderStatus: order.status,
      qrCode: null,
    }
  );
}

async function cancelOrder(orderId) {
  const order = await orderService.getOrder(orderId);
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

  const payment = await getPaymentByOrderId(orderId);
  const ts = nowIso();
  if (payment && payment.status === "PENDING") {
    await Payment.updateOne(
      { id: payment.id },
      { $set: { status: "FAILED", updated_at: ts } }
    );
    await audit({
      paymentId: payment.id,
      orderId,
      providerPaymentId: payment.provider_payment_id,
      amount: payment.amount,
      fromStatus: "PENDING",
      toStatus: "FAILED",
      reason: "user_cancelled",
    });
  }
  await orderService.setOrderStatus(orderId, "CANCELLED");
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
  findByOrderOrReference,
  audit,
  toPublicPayment,
};
