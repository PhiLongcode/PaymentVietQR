const { nowIso } = require("../db");
const { Order, plain } = require("../db/models");

/** Cas description max 9 chars. Format: DH-01234 (8). */
const ORDER_CODE_LEN = 8;
const ORDER_CODE_PREFIX = "DH-";
const ORDER_CODE_DIGITS = 5;
const ORDER_CODE_RE = /^DH-\d{5}$/;

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

async function createOrder(amount) {
  const n = Number(amount);
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error("amount must be an integer > 0");
    err.status = 400;
    err.code = "INVALID_AMOUNT";
    throw err;
  }
  const id = await generateOrderCode();
  const ts = nowIso();
  await Order.create({
    id,
    amount: n,
    currency: "VND",
    status: "PENDING_PAYMENT",
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

async function listOrders() {
  const rows = await Order.find({}).sort({ created_at: -1 }).limit(50);
  return rows.map(plain);
}

module.exports = {
  generateOrderCode,
  ORDER_CODE_LEN,
  ORDER_CODE_PREFIX,
  ORDER_CODE_RE,
  createOrder,
  getOrder,
  setOrderStatus,
  listOrders,
};
