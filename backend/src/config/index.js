const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
require("dotenv").config({ path: path.join(__dirname, "../../../.env") });

const NODE_ENV = (process.env.NODE_ENV || "DEV").toUpperCase();

const envDefaults = {
  DEV: {
    CAS_BASE_URL: "https://sandbox.bankhub.dev",
    CAS_LINK_URL: "https://dev.link.bankhub.dev",
    CAS_ENVIRONMENT: "dev",
  },
  STAGING: {
    CAS_BASE_URL: "https://sandbox.bankhub.dev",
    CAS_LINK_URL: "https://dev.link.bankhub.dev",
    CAS_ENVIRONMENT: "dev",
  },
  PRODUCTION: {
    CAS_BASE_URL: "https://production.bankhub.dev",
    CAS_LINK_URL: "https://link.bankhub.dev",
    CAS_ENVIRONMENT: "prod",
  },
};

const defaults = envDefaults[NODE_ENV] || envDefaults.DEV;

const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: NODE_ENV,
  isDev: NODE_ENV === "DEV",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  casRedirectUri:
    process.env.CAS_REDIRECT_URI || "http://localhost:3000/cas/callback",
  dbPath: process.env.DB_PATH || path.join(__dirname, "../../data/app.db"),
  cas: {
    baseUrl: process.env.CAS_BASE_URL || defaults.CAS_BASE_URL,
    linkUrl: process.env.CAS_LINK_URL || defaults.CAS_LINK_URL,
    apiVersion: process.env.CAS_API_VERSION || "2023-01-01",
    environment: process.env.CAS_ENVIRONMENT || defaults.CAS_ENVIRONMENT,
    clientId: process.env.CAS_CLIENT_ID || "",
    secretKey: process.env.CAS_SECRET_KEY || "",
    timeoutMs: Number(process.env.CAS_TIMEOUT_MS || 15000),
  },
};

function assertCasCredentials() {
  if (!config.cas.clientId || !config.cas.secretKey) {
    throw new Error(
      "Missing CAS_CLIENT_ID / CAS_SECRET_KEY. Copy .env.example to backend/.env"
    );
  }
}

module.exports = { config, assertCasCredentials };
