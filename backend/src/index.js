const express = require("express");
const cors = require("cors");
const { config } = require("./config");
const logger = require("./logger");
const { errorHandler } = require("./middleware/errorHandler");
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
    origin: [config.frontendUrl, "http://localhost:3000", "http://localhost:3001"],
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true, env: config.nodeEnv });
});

app.get("/", (req, res) => {
  res.redirect("/api/docs");
});

app.use("/api/docs", swaggerUi.serve);
app.get("/api/docs", swaggerUi.setup(spec, { explorer: true }));

app.use("/api/v1/cas", casRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/webhooks", webhookRoutes);
app.use("/api/v1/dev", devRoutes);

app.get("/api/v1/unmatched", (req, res, next) => {
  try {
    res.json({ items: matchingService.listUnmatched() });
  } catch (err) {
    next(err);
  }
});

app.use(errorHandler);

app.listen(config.port, () => {
  logger.info("server.started", {
    port: config.port,
    env: config.nodeEnv,
    casBaseUrl: config.cas.baseUrl,
  });
});
