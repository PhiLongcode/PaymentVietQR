const express = require("express");
const { asyncHandler } = require("../middleware/errorHandler");
const matchingService = require("../services/matchingService");
const { config } = require("../config");

const router = express.Router();

router.post(
  "/simulate-webhook",
  asyncHandler(async (req, res) => {
    if (!config.isDev) {
      const err = new Error("simulate-webhook is only available in DEV");
      err.status = 403;
      err.code = "FORBIDDEN";
      throw err;
    }
    const body = req.body || {};
    const payload = body.webhookType
      ? body
      : {
          webhookType: "TRANSACTIONS",
          webhookCode: "DEFAULT_UPDATE",
          error: null,
          grantId: "sim",
          environment: config.cas.environment,
          transaction: {
            id: body.transactionId || `sim-${Date.now()}`,
            accountNumber: body.accountNumber,
            transactionDate: new Date().toISOString().slice(0, 10),
            transactionDateTime: new Date().toISOString(),
            amount: body.amount,
            description: body.description || "",
            reference: body.reference || `FT-SIM-${Date.now()}`,
            currency: "VND",
            paymentMeta: body.paymentMeta || {},
          },
        };
    const result = await matchingService.processTransactionWebhook(payload);
    res.json(result);
  })
);

router.get(
  "/unmatched",
  asyncHandler(async (req, res) => {
    res.json({ items: await matchingService.listUnmatched() });
  })
);

module.exports = router;
