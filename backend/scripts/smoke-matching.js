/**
 * Matching smoke test against MongoDB (no Cas API).
 * Run: node scripts/smoke-matching.js
 */
const { connectDb, nowIso, newId, mongoose } = require("../src/db");
const { Payment } = require("../src/db/models");
const orderService = require("../src/services/orderService");
const matchingService = require("../src/services/matchingService");
const paymentService = require("../src/services/paymentService");

async function seedPayment(order, extras = {}) {
  const id = newId("PAY");
  const ts = nowIso();
  await Payment.create({
    id,
    order_id: order.id,
    provider: "CAS",
    provider_payment_id: extras.providerId || newId("QRP"),
    amount: order.amount,
    currency: "VND",
    qr_code: "000201",
    account_name: "DEMO",
    account_number: "0349134490",
    virtual_account_number: extras.va || `VA-${order.id}`,
    reference_number: extras.ref || order.id,
    fi_name: "MBBank",
    status: "PENDING",
    created_at: ts,
    updated_at: ts,
  });
  return paymentService.getPaymentByOrderId(order.id);
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

(async () => {
  await connectDb();
  const order = await orderService.createOrder(2000);
  const payment = await seedPayment(order, { va: "VA-SMOKE-1" });
  const txnId = `SMOKE-PAY-${Date.now()}`;

  const paid = await hook({
    txnId,
    amount: 2000,
    description: order.id,
    accountNumber: "VA-SMOKE-1",
  });
  const dup = await hook({
    txnId,
    amount: 2000,
    description: order.id,
    accountNumber: "VA-SMOKE-1",
  });

  const metaOrder = await orderService.createOrder(2000);
  await seedPayment(metaOrder, { va: "VA-META" });
  const casStyle = await hook({
    txnId: `SMOKE-META-${Date.now()}`,
    accountNumber: "0349134490",
    paymentMeta: { referenceNumber: metaOrder.id },
  });

  const order2 = await orderService.createOrder(2000);
  await seedPayment(order2, { va: "VA-SMOKE-2" });
  const under = await hook({
    txnId: `SMOKE-UNDER-${Date.now()}`,
    amount: 1000,
    description: order2.id,
    accountNumber: "VA-SMOKE-2",
  });

  const unknown = await hook({
    txnId: `SMOKE-UNK-${Date.now()}`,
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
        casReference: casStyle.status,
        underpaid: under.result,
        unknown: unknown.unmatched,
      },
      null,
      2
    )
  );

  const ok =
    paid.status === "SUCCESS" &&
    dup.duplicate === true &&
    casStyle.status === "SUCCESS" &&
    under.result === "REJECT" &&
    unknown.unmatched === true;

  await mongoose.disconnect();
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
