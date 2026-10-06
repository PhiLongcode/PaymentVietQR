const express = require("express");
const { asyncHandler } = require("../middleware/errorHandler");
const paymentService = require("../services/paymentService");

const router = express.Router();

router.post(
  "/qr",
  asyncHandler(async (req, res) => {
    const { orderId, amount } = req.body || {};
    if (!orderId) {
      const err = new Error("orderId is required");
      err.status = 400;
      err.code = "INVALID_REQUEST";
      throw err;
    }
    const payment = await paymentService.createQr({ orderId, amount });
    res.status(201).json(paymentService.toPublicPayment(
      payment,
      require("../services/orderService").getOrder(orderId)
    ));
  })
);

module.exports = router;
