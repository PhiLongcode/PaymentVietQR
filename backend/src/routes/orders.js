const express = require("express");
const { asyncHandler } = require("../middleware/errorHandler");
const orderService = require("../services/orderService");
const paymentService = require("../services/paymentService");
const matchingService = require("../services/matchingService");

const router = express.Router();

function isPaidPayload(data) {
  return (
    data?.status === "PAID" ||
    data?.paymentStatus === "SUCCESS" ||
    data?.orderStatus === "PAID"
  );
}

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const order = orderService.createOrder(req.body?.amount);
    res.status(201).json(order);
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ orders: orderService.listOrders() });
  })
);

router.get(
  "/:orderId/payment",
  asyncHandler(async (req, res) => {
    await matchingService.syncPendingFromCas(req.params.orderId);
    res.json(paymentService.getOrderPayment(req.params.orderId));
  })
);

router.get(
  "/:orderId/payment-status",
  asyncHandler(async (req, res) => {
    await matchingService.syncPendingFromCas(req.params.orderId);
    const data = paymentService.getOrderPayment(req.params.orderId);
    res.json({
      orderId: data.orderId,
      status: data.status,
      paymentStatus: data.paymentStatus,
      orderStatus: data.orderStatus,
      paidAt: data.paidAt,
      amount: data.amount,
    });
  })
);

router.get("/:orderId/events", async (req, res, next) => {
  try {
    const orderId = req.params.orderId;
    if (!orderService.getOrder(orderId)) {
      const err = new Error("Order not found");
      err.status = 404;
      err.code = "ORDER_NOT_FOUND";
      throw err;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    let timer;
    const send = async () => {
      try {
        await matchingService.syncPendingFromCas(orderId);
        const data = paymentService.getOrderPayment(orderId);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (isPaidPayload(data)) {
          if (timer) clearInterval(timer);
          res.end();
        }
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      }
    };

    await send();
    const onPaid = () => {
      send();
    };
    matchingService.paymentEvents.on(`order:${orderId}`, onPaid);
    timer = setInterval(send, 2000);
    req.on("close", () => {
      if (timer) clearInterval(timer);
      matchingService.paymentEvents.off(`order:${orderId}`, onPaid);
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:orderId/cancel",
  asyncHandler(async (req, res) => {
    res.json(paymentService.cancelOrder(req.params.orderId));
  })
);

module.exports = router;
