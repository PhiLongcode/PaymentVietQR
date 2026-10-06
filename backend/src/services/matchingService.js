const { EventEmitter } = require("events");
const { nowIso } = require("../db");
const { Payment, WebhookEvent, UnmatchedTransaction, plain } = require("../db/models");
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

async function insertWebhookEvent({
  transactionId,
  webhookType,
  environment,
  payload,
  status,
}) {
  await WebhookEvent.create({
    transaction_id: transactionId || null,
    webhook_type: webhookType || null,
    environment: environment || null,
    payload_json: JSON.stringify(payload),
    processing_status: status,
    created_at: nowIso(),
  });
}

async function insertUnmatched({ transaction, reason, payload }) {
  await UnmatchedTransaction.create({
    transaction_id: transaction?.id || null,
    amount: transaction?.amount ?? null,
    account_number: transaction?.accountNumber || null,
    description: transaction?.description || null,
    reference: transaction?.reference || payload?.transaction?.paymentMeta?.referenceNumber || null,
    reason,
    payload_json: JSON.stringify(payload),
    created_at: nowIso(),
  });
}

async function listUnmatched() {
  const rows = await UnmatchedTransaction.find({}).sort({ _id: -1 }).limit(100);
  return rows.map((r) => {
    const o = plain(r);
    return { ...o, id: o.mongo_id };
  });
}

const ORDER_CODE_RE = /\bDH\d{7}\b/gi;

function extractOrderCodes(...texts) {
  const found = [];
  for (const text of texts) {
    if (!text) continue;
    const hits = String(text).match(ORDER_CODE_RE) || [];
    for (const hit of hits) found.push(hit.toUpperCase());
  }
  return [...new Set(found)];
}

function pickPaymentFromRows(rows, strategy) {
  const usable = rows.filter((p) => p.status === "PENDING" || p.status === "SUCCESS");
  const pending = usable.filter((p) => p.status === "PENDING");
  if (pending.length === 1) return { payment: pending[0], strategy };
  if (pending.length > 1) {
    return { payment: null, strategy: `ambiguous_${strategy}`, ambiguous: true };
  }
  if (usable.length === 1) return { payment: usable[0], strategy };
  return null;
}

async function matchPayment(transaction, paymentMeta) {
  const meta = paymentMeta || {};
  const qrPayId = meta.qrPayId || meta.qrPayID || meta.id;
  const ref = meta.referenceNumber || meta.reference;

  if (qrPayId) {
    const byId = await paymentService.getPaymentByProviderId(qrPayId);
    if (byId) return { payment: byId, strategy: "paymentMeta.qrPayId" };
  }
  if (ref) {
    const byRef = await paymentService.findByOrderOrReference(ref);
    const picked = pickPaymentFromRows(byRef, "paymentMeta.referenceNumber");
    if (picked) return picked;
  }

  const codes = extractOrderCodes(
    transaction.description,
    ref,
    transaction.reference,
    transaction.virtualAccountNumber
  );
  if (codes.length) {
    const rows = [];
    for (const code of codes) {
      rows.push(...(await paymentService.findByOrderOrReference(code)));
    }
    const byId = new Map(rows.map((p) => [p.id, p]));
    const picked = pickPaymentFromRows([...byId.values()], "order_code_in_description");
    if (picked) return picked;
  }

  const vaHits = await paymentService.findPendingByVirtualAccount(transaction.accountNumber);
  if (vaHits.length === 1) {
    return { payment: vaHits[0], strategy: "virtualAccountNumber" };
  }
  if (vaHits.length > 1) {
    return { payment: null, strategy: "ambiguous_virtual_account", ambiguous: true };
  }

  const descHits = await paymentService.findPendingByDescription(transaction.description || "");
  if (descHits.length === 1) {
    return { payment: descHits[0], strategy: "description" };
  }
  if (descHits.length > 1) {
    return { payment: null, strategy: "ambiguous_description", ambiguous: true };
  }

  const vaInDesc = await paymentService.findPendingByVirtualAccountInText(
    `${transaction.description || ""} ${transaction.virtualAccountNumber || ""}`
  );
  if (vaInDesc.length === 1) {
    return { payment: vaInDesc[0], strategy: "va_in_description" };
  }

  return { payment: null, strategy: "none" };
}

function validateAmount(expected, received, { casConfirmedRef } = {}) {
  if (received == null || Number.isNaN(Number(received))) {
    if (casConfirmedRef) return { result: "OK", reason: "cas_reference_no_amount" };
    return { result: "REJECT", reason: "amount_null_or_zero" };
  }
  if (Number(received) <= 0) {
    return { result: "REJECT", reason: "amount_null_or_zero" };
  }
  const got = Number(received);
  if (got === expected) return { result: "OK", reason: "amount_match" };
  if (got < expected) return { result: "REJECT", reason: "amount_underpaid" };
  return { result: "REVIEW", reason: "amount_overpaid" };
}

async function applyPaid(payment, transaction) {
  const ts = nowIso();
  await Payment.updateOne(
    { id: payment.id },
    {
      $set: {
        status: "SUCCESS",
        transaction_id: transaction.id,
        transaction_reference: transaction.reference || null,
        paid_at: transaction.transactionDateTime || ts,
        updated_at: ts,
      },
    }
  );
  await orderService.setOrderStatus(payment.order_id, "PAID");
  notifyPayment(payment.order_id);
  await paymentService.audit({
    paymentId: payment.id,
    orderId: payment.order_id,
    providerPaymentId: payment.provider_payment_id,
    transactionId: transaction.id,
    amount: transaction.amount ?? payment.amount,
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
    amount: transaction.amount ?? payment.amount,
    status: "SUCCESS",
    paidAt: ts,
  });
}

async function applyFailed(payment, transaction, reason) {
  const ts = nowIso();
  await Payment.updateOne(
    { id: payment.id },
    {
      $set: {
        status: "FAILED",
        transaction_id: transaction.id,
        transaction_reference: transaction.reference || null,
        updated_at: ts,
      },
    }
  );
  await paymentService.audit({
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

async function processTransactionWebhook(payload) {
  const webhookType = payload?.webhookType || payload?.type;
  const environment = payload?.environment;
  const transaction = payload?.transaction || payload?.data?.transaction;

  if (!webhookType || !transaction || !transaction.id) {
    logger.info("webhook.ping", {
      hasType: Boolean(webhookType),
      hasTransaction: Boolean(transaction?.id),
    });
    return { ok: true, ping: true };
  }
  const type = String(webhookType || "").toUpperCase();
  if (!["TRANSACTIONS", "TRANSACTION", "QRPAY", "QR_PAY"].includes(type)) {
    await insertWebhookEvent({
      webhookType,
      environment,
      payload,
      status: "IGNORED",
    });
    return { ok: true, ignored: true, reason: "unsupported_webhookType" };
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
    referenceNumber: transaction.paymentMeta?.referenceNumber,
  });

  const existingPaid = await paymentService.getPaymentByTransactionId(transaction.id);
  if (existingPaid && existingPaid.status === "SUCCESS") {
    await insertWebhookEvent({
      transactionId: transaction.id,
      webhookType,
      environment,
      payload,
      status: "DUPLICATE",
    });
    return {
      ok: true,
      duplicate: true,
      paymentId: existingPaid.id,
      orderId: existingPaid.order_id,
      status: existingPaid.status,
    };
  }

  const priorEvent = plain(
    await WebhookEvent.findOne({ transaction_id: transaction.id }).sort({ _id: -1 })
  );
  if (priorEvent && priorEvent.processing_status === "PAID") {
    return {
      ok: true,
      duplicate: true,
      status: priorEvent.processing_status,
    };
  }

  const matched = await matchPayment(
    transaction,
    transaction.paymentMeta || payload.paymentMeta
  );
  if (!matched.payment) {
    const reason = matched.ambiguous
      ? `ambiguous:${matched.strategy}`
      : "unmatched";
    await insertUnmatched({ transaction, reason, payload });
    await insertWebhookEvent({
      transactionId: transaction.id,
      webhookType,
      environment,
      payload,
      status: "UNMATCHED",
    });
    await paymentService.audit({
      transactionId: transaction.id,
      amount: transaction.amount,
      toStatus: "UNMATCHED",
      reason,
    });
    logger.warn("webhook.unmatched", {
      transactionId: transaction.id,
      amount: transaction.amount,
      referenceNumber: transaction.paymentMeta?.referenceNumber,
      orderCodes: extractOrderCodes(transaction.description, transaction.reference),
      reason,
    });
    return { ok: true, unmatched: true, reason };
  }

  const payment = matched.payment;
  if (payment.status === "SUCCESS") {
    await insertWebhookEvent({
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
      orderId: payment.order_id,
      status: payment.status,
    };
  }

  const casConfirmedRef = Boolean(
    transaction.paymentMeta?.referenceNumber || payload.paymentMeta?.referenceNumber
  );
  const amountCheck = validateAmount(payment.amount, transaction.amount, {
    casConfirmedRef,
  });
  if (amountCheck.result !== "OK") {
    await applyFailed(payment, transaction, amountCheck.reason);
    await insertWebhookEvent({
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

  await applyPaid(payment, transaction);
  await insertWebhookEvent({
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
  const payment = await paymentService.getPaymentByOrderId(orderId);
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
    await processTransactionWebhook({
      webhookType: "TRANSACTIONS",
      environment: config.cas.environment,
      transaction: tx,
    });
    const latest = await paymentService.getPaymentByOrderId(orderId);
    if (latest && latest.status === "SUCCESS") break;
  }
}

module.exports = {
  processTransactionWebhook,
  syncPendingFromCas,
  paymentEvents,
  listUnmatched,
  validateAmount,
  extractOrderCodes,
};
