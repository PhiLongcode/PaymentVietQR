/**
 * Test generateOrderCode with mocked Mongo (no Atlas).
 * Run: node scripts/test-generate-order-code.js
 */
const { Order } = require("../src/db/models");
const orderService = require("../src/services/orderService");

function chain(result) {
  return {
    sort() {
      return this;
    },
    lean: async () => result,
  };
}

async function run() {
  const cases = [
    { last: null, expect: "DH-00001" },
    { last: { id: "DH-00001" }, expect: "DH-00002" },
    { last: { id: "DH-01234" }, expect: "DH-01235" },
    { last: { id: "DH-99998" }, expect: "DH-99999" },
  ];

  for (const c of cases) {
    Order.findOne = () => chain(c.last);
    const code = await orderService.generateOrderCode();
    if (code !== c.expect) {
      throw new Error(`expected ${c.expect}, got ${code}`);
    }
    if (!/^DH-\d{5}$/.test(code) || code.length !== 8) {
      throw new Error(`invalid shape ${code}`);
    }
  }

  Order.findOne = () => chain({ id: "DH-99999" });
  let exhausted = false;
  try {
    await orderService.generateOrderCode();
  } catch (err) {
    exhausted = err.code === "ORDER_CODE_EXHAUSTED";
  }
  if (!exhausted) throw new Error("expected ORDER_CODE_EXHAUSTED");

  console.log(
    JSON.stringify(
      {
        ok: true,
        samples: cases.map((c) => c.expect),
        format: "DH-01234",
      },
      null,
      2
    )
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
