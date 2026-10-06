const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { config } = require("./config");
const logger = require("./logger");
const { connectDb } = require("./db");
const { errorHandler, asyncHandler } = require("./middleware/errorHandler");
const casRoutes = require("./routes/cas");
const orderRoutes = require("./routes/orders");
const paymentRoutes = require("./routes/payments");
const webhookRoutes = require("./routes/webhooks");
const devRoutes = require("./routes/dev");
const swaggerUi = require("swagger-ui-express");
const { spec } = require("./swagger");
const matchingService = require("./services/matchingService");

const app = express();
app.use(
  cors({
    origin: true,
    credentials: false,
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    env: config.nodeEnv,
    mongo: mongoose.connection.readyState === 1 ? "up" : "down",
  });
});

app.get("/", (req, res) => {
  res.redirect("/api/docs");
});

app.use("/api/docs", swaggerUi.serve);
app.get("/api/docs", swaggerUi.setup(spec, { explorer: true }));

app.use("/api/v1/cas", casRoutes);
app.get("/cas/callback", asyncHandler(casRoutes.handleCasBrowserCallback));
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/webhooks", webhookRoutes);
app.use("/api/v1/dev", devRoutes);

app.get(
  "/api/v1/unmatched",
  asyncHandler(async (req, res) => {
    res.json({ items: await matchingService.listUnmatched() });
  })
);

app.use(errorHandler);

connectDb()
  .then(() => {
    app.listen(config.port, () => {
      logger.info("server.started", {
        port: config.port,
        env: config.nodeEnv,
        casBaseUrl: config.cas.baseUrl,
        casRedirectUri: config.casRedirectUri,
      });
    });
  })
  .catch((err) => {
    logger.error("mongo.connect.failed", { message: err.message });
    process.exit(1);
  });
