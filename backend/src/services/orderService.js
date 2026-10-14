const { nowIso } = require("../db");
const { Order, plain } = require("../db/models");

/** Cas description max 9 chars. Default auto id: DH-01234 (8). */
const ORDER_CODE_LEN = 8;
const ORDER_CODE_PREFIX = "DH-";
const ORDER_CODE_DIGITS = 5;
const ORDER_CODE_RE = /^DH-\d{5}$/;
const CAS_DESC_MAX = 9;
const ACTIVE_ORDER_STATUSES = ["PENDING_PAYMENT", "PAYMENT_PROCESSING"];

async function generateOrderCode() {
  const row = await Order.findOne({ id: { $regex: /^DH-\d{5}$/ } })
    .sort({ id: -1 })
    .lean();
  const last = row?.id ? Number(row.id.slice(ORDER_CODE_PREFIX.length)) : 0;
  const next = Number.isFinite(last) ? last + 1 : 1;
  if (next > 10 ** ORDER_CODE_DIGITS - 1) {
    const err = new Error("Order code sequence exhausted");
    err.status = 500;
    err.code = "ORDER_CODE_EXHAUSTED";
    throw err;
  }
  const code = `${ORDER_CODE_PREFIX}${String(next).padStart(ORDER_CODE_DIGITS, "0")}`;
  if (code.length !== ORDER_CODE_LEN || !ORDER_CODE_RE.test(code)) {
    const err = new Error("Generated order code must match DH-01234");
    err.status = 500;
    err.code = "INVALID_ORDER_CODE";
    throw err;
  }
  return code;
}

/**
 * Normalize FE transfer content for Cas description / referenceNumber.
 * Empty → null (caller uses order id). Max 9 chars.
 */
function normalizeTransferContent(raw) {
  if (raw == null || raw === "") return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.length > CAS_DESC_MAX) {
    const err = new Error(
      `Transfer content (description) must be at most ${CAS_DESC_MAX} characters`
    );
    err.status = 400;
    err.code = "INVALID_DESCRIPTION";
    throw err;
  }
  if (/\s/.test(text)) {
    const err = new Error("Transfer content must not contain spaces");
    err.status = 400;
    err.code = "INVALID_DESCRIPTION";
    throw err;
  }
  return text;
}

async function findActiveDescriptionClash(description, excludeOrderId) {
  if (!description) return null;
  const q = {
    status: { $in: ACTIVE_ORDER_STATUSES },
    $or: [{ id: description }, { description }],
  };
  if (excludeOrderId) q.id = { $ne: excludeOrderId };
  return plain(await Order.findOne(q));
}

async function createOrder(amount, { description } = {}) {
  const n = Number(amount);
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error("amount must be an integer > 0");
    err.status = 400;
    err.code = "INVALID_AMOUNT";
    throw err;
  }

  const custom = normalizeTransferContent(description);
  const id = await generateOrderCode();
  const transfer = custom || id;

  const clash = await findActiveDescriptionClash(transfer);
  if (clash && clash.id !== id) {
    const err = new Error(
      `Transfer content "${transfer}" is already used by an active order`
    );
    err.status = 409;
    err.code = "DESCRIPTION_IN_USE";
    throw err;
  }

  const ts = nowIso();
  await Order.create({
    id,
    amount: n,
    currency: "VND",
    status: "PENDING_PAYMENT",
    description: transfer,
    created_at: ts,
    updated_at: ts,
  });
  return getOrder(id);
}

async function getOrder(id) {
  return plain(await Order.findOne({ id }));
}

async function setOrderStatus(id, status) {
  const ts = nowIso();
  await Order.updateOne({ id }, { $set: { status, updated_at: ts } });
  return getOrder(id);
}

async function setOrderDescription(id, description) {
  const order = await getOrder(id);
  if (!order) {
    const err = new Error("Order not found");
    err.status = 404;
    err.code = "ORDER_NOT_FOUND";
    throw err;
  }
  if (order.status === "PAID" || order.status === "CANCELLED") {
    const err = new Error("Cannot change description for this order");
    err.status = 409;
    err.code = "ORDER_NOT_EDITABLE";
    throw err;
  }
  const custom = normalizeTransferContent(description);
  const transfer = custom || order.id;
  const clash = await findActiveDescriptionClash(transfer, id);
  if (clash) {
    const err = new Error(
      `Transfer content "${transfer}" is already used by an active order`
    );
    err.status = 409;
    err.code = "DESCRIPTION_IN_USE";
    throw err;
  }
  const ts = nowIso();
  await Order.updateOne(
    { id },
    { $set: { description: transfer, updated_at: ts } }
  );
  return getOrder(id);
}

async function listOrders() {
  const rows = await Order.find({}).sort({ created_at: -1 }).limit(50);
  return rows.map(plain);
}

module.exports = {
  generateOrderCode,
  normalizeTransferContent,
  ORDER_CODE_LEN,
  ORDER_CODE_PREFIX,
  ORDER_CODE_RE,
  CAS_DESC_MAX,
  createOrder,
  getOrder,
  setOrderStatus,
  setOrderDescription,
  listOrders,
};
