/**
 * Pure checks for DH-01234 format (no Mongo).
 * Run: node scripts/test-order-code.js
 */
const matchingService = require("../src/services/matchingService");
const { ORDER_CODE_LEN, ORDER_CODE_PREFIX, ORDER_CODE_RE } =
  require("../src/services/orderService");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sample = "DH-01234";
assert(ORDER_CODE_LEN === 8, "len must be 8");
assert(ORDER_CODE_PREFIX === "DH-", "prefix DH-");
assert(ORDER_CODE_RE.test(sample), "regex accepts DH-01234");
assert(sample.length === 8, "DH-01234 is 8 chars (<= Cas 9)");
assert(sample.length <= 9, "Cas description max 9");

const codes = matchingService.extractOrderCodes(
  `Qamomf3244 CASSO xxx 150359607111-${sample}-CHUYEN TIEN-MOMO`,
  "legacy DH0000001 text",
  "noise"
);
assert(codes.includes("DH-01234"), `expected DH-01234 in ${JSON.stringify(codes)}`);
assert(codes.includes("DH0000001"), `expected legacy in ${JSON.stringify(codes)}`);

const padded = "DH-00001";
assert(ORDER_CODE_RE.test(padded), "accepts DH-00001");

console.log(
  JSON.stringify(
    {
      ok: true,
      format: "DH-01234",
      length: sample.length,
      casMax: 9,
      extracted: codes,
    },
    null,
    2
  )
);
