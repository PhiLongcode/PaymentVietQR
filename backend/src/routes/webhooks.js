const express = require("express");
const { asyncHandler } = require("../middleware/errorHandler");
const matchingService = require("../services/matchingService");

const router = express.Router();

router.post(
  "/cas/transactions",
  asyncHandler(async (req, res) => {
    const result = matchingService.processTransactionWebhook(req.body || {});
    res.status(200).json(result);
  })
);

module.exports = router;
