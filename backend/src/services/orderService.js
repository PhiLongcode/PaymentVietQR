const { db, nowIso } = require("../db");

const ORDER_CODE_LEN = 9;
const ORDER_CODE_PREFIX = "DH";

function generateOrderCode() {
  const prefix = ORDER_CODE_PREFIX;
  const seqWidth = ORDER_CODE_LEN - prefix.length;
  const row = db
    .prepare(
      `SELECT id FROM orders
       WHERE id GLOB 'DH[0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
       ORDER BY id DESC LIMIT 1`
    )
    .get();
  const last = row?.id ? Number(row.id.slice(prefix.length)) : 0;
  const next = Number.isFinite(last) ? last + 1 : 1;
  if (next > 10 ** seqWidth - 1) {
    const err = new Error("Order code sequence exhausted");
    err.status = 500;
    err.code = "ORDER_CODE_EXHAUSTED";
    throw err;
  }
  const code = `${prefix}${String(next).padStart(seqWidth, "0")}`;
  if (code.length !== ORDER_CODE_LEN) {
    const err = new Error("Generated order code must be 9 characters");
    err.status = 500;
    err.code = "INVALID_ORDER_CODE";
    throw err;
  }
  return code;
}

function createOrder(amount) {
  const n = Number(amount);
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error("amount must be an integer > 0");
    err.status = 400;
    err.code = "INVALID_AMOUNT";
    throw err;
  }
  const id = generateOrderCode();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO orders (id, amount, currency, status, created_at, updated_at)
     VALUES (?, ?, 'VND', 'PENDING_PAYMENT', ?, ?)`
  ).run(id, n, ts, ts);
  return getOrder(id);
}

function getOrder(id) {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
}

function setOrderStatus(id, status) {
  const ts = nowIso();
  db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`).run(
    status,
    ts,
    id
  );
  return getOrder(id);
}

function listOrders() {
  return db.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 50`).all();
}

module.exports = {
  generateOrderCode,
  ORDER_CODE_LEN,
  createOrder,
  getOrder,
  setOrderStatus,
  listOrders,
};
