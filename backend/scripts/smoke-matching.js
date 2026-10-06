/**
 * Local matching smoke test (no Cas API).
 * Run from backend/: node scripts/smoke-matching.js
 */
const { db, nowIso, newId } = require("../src/db");
const orderService = require("../src/services/orderService");
const matchingService = require("../src/services/matchingService");

function seedPayment(order, extras = {}) {
  const id = newId("PAY");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO payments (
      id, order_id, provider, provider_payment_id, amount, currency,
      qr_code, account_name, account_number, virtual_account_number,
      reference_number, fi_name, status, created_at, updated_at
    ) VALUES (?, ?, 'CAS', ?, ?, 'VND', '000201', 'DEMO', '0349134490', ?, ?, 'MBBank', 'PENDING', ?, ?)`
  ).run(
    id,
    order.id,
    extras.providerId || newId("QRP"),
    order.amount,
    extras.va || `VA-${order.id}`,
    extras.ref || order.id,
    ts,
    ts
  );
  return require("../src/services/paymentService").getPaymentByOrderId(order.id);
}

function hook(overrides) {
  return matchingService.processTransactionWebhook({
    webhookType: "TRANSACTIONS",
    environment: "dev",
    transaction: {
      id: overrides.txnId,
      accountNumber: overrides.accountNumber,
      amount: overrides.amount,
      description: overrides.description || "",
      reference: "FT-SMOKE",
      paymentMeta: overrides.paymentMeta || {},
    },
  });
}

const order = orderService.createOrder(2000);
const payment = seedPayment(order, { va: "VA-SMOKE-1" });

const paid = hook({
  txnId: "ABC123",
  amount: 2000,
  description: order.id,
  accountNumber: "VA-SMOKE-1",
});
const dup = hook({
  txnId: "ABC123",
  amount: 2000,
  description: order.id,
  accountNumber: "VA-SMOKE-1",
});

const order2 = orderService.createOrder(2000);
seedPayment(order2, { va: "VA-SMOKE-2" });
const under = hook({
  txnId: "UNDER1",
  amount: 1000,
  description: order2.id,
  accountNumber: "VA-SMOKE-2",
});

const unknown = hook({
  txnId: "UNK1",
  amount: 2000,
  description: "NO-SUCH-ORDER",
  accountNumber: "999999",
});

console.log(
  JSON.stringify(
    {
      createdPayment: payment.id,
      paid: paid.status,
      duplicate: dup.duplicate,
      underpaid: under.result,
      unknown: unknown.unmatched,
    },
    null,
    2
  )
);

if (
  paid.status !== "SUCCESS" ||
  dup.duplicate !== true ||
  under.result !== "REJECT" ||
  unknown.unmatched !== true
) {
  process.exit(1);
}
