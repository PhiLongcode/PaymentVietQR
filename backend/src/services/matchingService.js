const { EventEmitter } = require("events");
const { db, nowIso } = require("../db");
const logger = require("../logger");
const { config } = require("../config");
const orderService = require("./orderService");
const paymentService = require("./paymentService");
const grantService = require("./grantService");
const cas = require("./casClient");

const paymentEvents = new EventEmitter();
paymentEvents.setMaxListeners(100);

function notifyPayment(orderId) {
  if (orderId) paymentEvents.emit(`order:${orderId}`);
}

function expectedEnvironment() {
  return config.cas.environment;
}

function insertWebhookEvent({ transactionId, webhookType, environment, payload, status }) {
  db.prepare(
    `INSERT INTO webhook_events (
      transaction_id, webhook_type, environment, payload_json, processing_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    transactionId || null,
    webhookType || null,
    environment || null,
    JSON.stringify(payload),
    status,
    nowIso()
  );
}

function insertUnmatched({ transaction, reason, payload }) {
  db.prepare(
    `INSERT INTO unmatched_transactions (
      transaction_id, amount, account_number, description, reference, reason, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    transaction?.id || null,
    transaction?.amount ?? null,
    transaction?.accountNumber || null,
    transaction?.description || null,
    transaction?.reference || null,
    reason,
    JSON.stringify(payload),
    nowIso()
  );
}

function listUnmatched() {
  return db
    .prepare(
      `SELECT id, transaction_id, amount, account_number, description, reference, reason, created_at
       FROM unmatched_transactions ORDER BY id DESC LIMIT 100`
    )
    .all();
}

function matchPayment(transaction, paymentMeta) {
  const meta = paymentMeta || {};
  const qrPayId = meta.qrPayId || meta.qrPayID || meta.id;
  const ref = meta.referenceNumber || meta.reference;

  if (qrPayId) {
    const byId = paymentService.getPaymentByProviderId(qrPayId);
    if (byId) return { payment: byId, strategy: "paymentMeta.qrPayId" };
  }
  if (ref) {
    const byRef = db
      .prepare(
        `SELECT * FROM payments WHERE reference_number = ? AND status = 'PENDING'`
      )
      .all(ref);
    if (byRef.length === 1) {
      return { payment: byRef[0], strategy: "paymentMeta.referenceNumber" };
    }
    if (byRef.length > 1) return { payment: null, strategy: "ambiguous_reference", ambiguous: true };
  }

  const vaHits = paymentService.findPendingByVirtualAccount(transaction.accountNumber);
  if (vaHits.length === 1) {
    return { payment: vaHits[0], strategy: "virtualAccountNumber" };
  }
  if (vaHits.length > 1) {
    return { payment: null, strategy: "ambiguous_virtual_account", ambiguous: true };
  }

  const descHits = paymentService.findPendingByDescription(transaction.description || "");
  if (descHits.length === 1) {
    return { payment: descHits[0], strategy: "description" };
  }
  if (descHits.length > 1) {
    return { payment: null, strategy: "ambiguous_description", ambiguous: true };
  }

  const vaInDesc = paymentService.findPendingByVirtualAccountInText(
    `${transaction.description || ""} ${transaction.virtualAccountNumber || ""}`
  );
  if (vaInDesc.length === 1) {
    return { payment: vaInDesc[0], strategy: "va_in_description" };
  }

  return { payment: null, strategy: "none" };
}

function validateAmount(expected, received) {
  if (received == null || Number.isNaN(Number(received)) || Number(received) <= 0) {
    return { result: "REJECT", reason: "amount_null_or_zero" };
  }
  const got = Number(received);
  if (got === expected) return { result: "OK", reason: "amount_match" };
  if (got < expected) return { result: "REJECT", reason: "amount_underpaid" };
  return { result: "REVIEW", reason: "amount_overpaid" };
}

function applyPaid(payment, transaction) {
  const ts = nowIso();
  db.prepare(
    `UPDATE payments
     SET status = 'SUCCESS',
         transaction_id = ?,
         transaction_reference = ?,
         paid_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    transaction.id,
    transaction.reference || null,
    transaction.transactionDateTime || ts,
    ts,
    payment.id
  );
  orderService.setOrderStatus(payment.order_id, "PAID");
  notifyPayment(payment.order_id);
  paymentService.audit({
    paymentId: payment.id,
    orderId: payment.order_id,
    providerPaymentId: payment.provider_payment_id,
    transactionId: transaction.id,
    amount: transaction.amount,
    fromStatus: payment.status,
    toStatus: "SUCCESS",
    reason: "webhook_paid",
  });
  logger.info("payment.paid", {
    paymentId: payment.id,
    orderId: payment.order_id,
    provider: "CAS",
    providerPaymentId: payment.provider_payment_id,
    transactionId: transaction.id,
    amount: transaction.amount,
    status: "SUCCESS",
    paidAt: ts,
  });
}

function applyFailed(payment, transaction, reason) {
  const ts = nowIso();
  db.prepare(
    `UPDATE payments SET status = 'FAILED', transaction_id = ?, transaction_reference = ?, updated_at = ? WHERE id = ?`
  ).run(transaction.id, transaction.reference || null, ts, payment.id);
  paymentService.audit({
    paymentId: payment.id,
    orderId: payment.order_id,
    providerPaymentId: payment.provider_payment_id,
    transactionId: transaction.id,
    amount: transaction.amount,
    fromStatus: payment.status,
    toStatus: "FAILED",
    reason,
  });
}

function processTransactionWebhook(payload) {
  const webhookType = payload?.webhookType || payload?.type;
  const environment = payload?.environment;
  const transaction = payload?.transaction || payload?.data?.transaction;

  if (!webhookType) {
    const err = new Error("webhookType is required");
    err.status = 400;
    err.code = "INVALID_WEBHOOK";
    throw err;
  }
  const type = String(webhookType || "").toUpperCase();
  if (!["TRANSACTIONS", "TRANSACTION", "QRPAY", "QR_PAY"].includes(type)) {
    insertWebhookEvent({
      webhookType,
      environment,
      payload,
      status: "IGNORED",
    });
    return { ok: true, ignored: true, reason: "unsupported_webhookType" };
  }
  if (!transaction || !transaction.id) {
    const err = new Error("transaction payload is required");
    err.status = 400;
    err.code = "INVALID_WEBHOOK";
    throw err;
  }
  if (environment && environment !== expectedEnvironment()) {
    logger.warn("webhook.environment_mismatch", {
      expected: expectedEnvironment(),
      got: environment,
      transactionId: transaction.id,
    });
  }

  logger.info("webhook.received", {
    transactionId: transaction.id,
    amount: transaction.amount,
    webhookType,
  });

  const priorEvent = db
    .prepare(
      `SELECT processing_status FROM webhook_events WHERE transaction_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(transaction.id);
  if (priorEvent) {
    logger.info("webhook.duplicate", {
      transactionId: transaction.id,
      status: priorEvent.processing_status,
    });
    return {
      ok: true,
      duplicate: true,
      status: priorEvent.processing_status,
    };
  }

  const existing = paymentService.getPaymentByTransactionId(transaction.id);
  if (existing) {
    insertWebhookEvent({
      transactionId: transaction.id,
      webhookType,
      environment,
      payload,
      status: "DUPLICATE",
    });
    logger.info("webhook.duplicate", {
      transactionId: transaction.id,
      paymentId: existing.id,
      orderId: existing.order_id,
      status: existing.status,
    });
    return {
      ok: true,
      duplicate: true,
      paymentId: existing.id,
      orderId: existing.order_id,
      status: existing.status,
    };
  }

  const matched = matchPayment(transaction, transaction.paymentMeta || payload.paymentMeta);
  if (!matched.payment) {
    const reason = matched.ambiguous
      ? `ambiguous:${matched.strategy}`
      : "unmatched";
    insertUnmatched({ transaction, reason, payload });
    insertWebhookEvent({
      transactionId: transaction.id,
      webhookType,
      environment,
      payload,
      status: "UNMATCHED",
    });
    paymentService.audit({
      transactionId: transaction.id,
      amount: transaction.amount,
      toStatus: "UNMATCHED",
      reason,
    });
    logger.warn("webhook.unmatched", {
      transactionId: transaction.id,
      amount: transaction.amount,
      reason,
    });
    return { ok: true, unmatched: true, reason };
  }

  const payment = matched.payment;
  if (payment.status === "SUCCESS") {
    insertWebhookEvent({
      transactionId: transaction.id,
      webhookType,
      environment,
      payload,
      status: "DUPLICATE",
    });
    return {
      ok: true,
      duplicate: true,
      paymentId: payment.id,
      status: payment.status,
    };
  }

  const amountCheck = validateAmount(payment.amount, transaction.amount);
  if (amountCheck.result !== "OK") {
    applyFailed(payment, transaction, amountCheck.reason);
    insertWebhookEvent({
      transactionId: transaction.id,
      webhookType,
      environment,
      payload,
      status: amountCheck.result,
    });
    logger.warn("webhook.amount_rejected", {
      paymentId: payment.id,
      orderId: payment.order_id,
      expected: payment.amount,
      received: transaction.amount,
      result: amountCheck.result,
    });
    return {
      ok: true,
      paymentId: payment.id,
      orderId: payment.order_id,
      result: amountCheck.result,
      reason: amountCheck.reason,
    };
  }

  applyPaid(payment, transaction);
  insertWebhookEvent({
    transactionId: transaction.id,
    webhookType,
    environment,
    payload,
    status: "PAID",
  });
  return {
    ok: true,
    paymentId: payment.id,
    orderId: payment.order_id,
    status: "SUCCESS",
    matchStrategy: matched.strategy,
  };
}

function extractTransactions(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.transactions)) return data.transactions;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.data?.transactions)) return data.data.transactions;
  if (data.transaction) return [data.transaction];
  return [];
}

async function syncPendingFromCas(orderId) {
  const payment = paymentService.getPaymentByOrderId(orderId);
  if (!payment || payment.status !== "PENDING") return;

  const fromDate = (payment.created_at || nowIso()).slice(0, 10);
  const toDate = nowIso().slice(0, 10);

  let data;
  try {
    data = await grantService.withAccessToken((token) =>
      cas.listTransactions(token, { fromDate, toDate })
    );
  } catch (err) {
    logger.warn("cas.transactions.sync_skipped", {
      orderId,
      code: err.code,
      message: err.message,
    });
    return;
  }

  const txs = extractTransactions(data);
  for (const tx of txs) {
    if (!tx?.id) continue;
    processTransactionWebhook({
      webhookType: "TRANSACTIONS",
      environment: config.cas.environment,
      transaction: tx,
    });
    const latest = paymentService.getPaymentByOrderId(orderId);
    if (latest && latest.status === "SUCCESS") break;
  }
}

module.exports = {
  processTransactionWebhook,
  syncPendingFromCas,
  paymentEvents,
  listUnmatched,
  validateAmount,
};
