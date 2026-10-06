const express = require("express");
const { asyncHandler } = require("../middleware/errorHandler");
const matchingService = require("../services/matchingService");

const router = express.Router();

function ack(_req, res) {
  res.status(200).json({ ok: true, ping: true });
}

router.get("/cas/transactions", ack);
router.head("/cas/transactions", (req, res) => res.status(200).end());

router.post(
  "/cas/transactions",
  asyncHandler(async (req, res) => {
    const result = matchingService.processTransactionWebhook(req.body || {});
    res.status(200).json(result);
  })
);

module.exports = router;
