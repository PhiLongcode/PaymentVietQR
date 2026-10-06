const express = require("express");
const { asyncHandler } = require("../middleware/errorHandler");
const grantService = require("../services/grantService");

const router = express.Router();

router.post(
  "/grant",
  asyncHandler(async (req, res) => {
    const result = await grantService.startGrant();
    res.json(result);
  })
);

router.post(
  "/exchange",
  asyncHandler(async (req, res) => {
    const publicToken = req.body?.publicToken;
    const grant = await grantService.completeExchange(publicToken);
    res.json({ grant });
  })
);

router.get(
  "/status",
  asyncHandler(async (req, res) => {
    const row = grantService.getActiveGrant() || grantService.getLatestGrant();
    res.json({
      grant: grantService.publicGrant(row),
      hasActiveGrant: Boolean(grantService.getActiveGrant()),
    });
  })
);

module.exports = router;
