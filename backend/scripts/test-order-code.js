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

const sample = "DH01234";
assert(ORDER_CODE_LEN === 7, "len must be 7");
assert(ORDER_CODE_PREFIX === "DH", "prefix DH");
assert(ORDER_CODE_RE.test(sample), "regex accepts DH01234");
assert(sample.length === 7, "DH01234 is 7 chars (<= Cas 9)");
assert(sample.length <= 9, "Cas description max 9");

const codes = matchingService.extractOrderCodes(
  `Qamomf3244 CASSO xxx 150359607111-${sample}-CHUYEN TIEN-MOMO`,
  "legacy DH0000001 text",
  "hyphen form DH-01234",
  "noise"
);
assert(codes.includes("DH01234"), `expected DH01234 in ${JSON.stringify(codes)}`);
assert(codes.includes("DH0000001"), `expected legacy in ${JSON.stringify(codes)}`);
assert(
  codes.some((c) => c.replace("-", "") === "DH01234"),
  `expected hyphen variant in ${JSON.stringify(codes)}`
);

console.log(
  JSON.stringify(
    {
      ok: true,
      format: "DH01234",
      length: sample.length,
      casMax: 9,
      extracted: codes,
      note: "Cas rejects hyphen in description",
    },
    null,
    2
  )
);
