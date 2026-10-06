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

function isLoopbackUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return /localhost|127\.0\.0\.1/i.test(url);
  }
}

function publicApiBase() {
  const raw = process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || "";
  return raw.replace(/\/$/, "");
}

function resolveCasRedirectUri(frontendUrl) {
  const explicit = (process.env.CAS_REDIRECT_URI || "").trim();
  const apiBase = publicApiBase();
  if (apiBase && (!explicit || isLoopbackUrl(explicit))) {
    return `${apiBase}/cas/callback`;
  }
  if (explicit) return explicit;
  return `${String(frontendUrl).replace(/\/$/, "")}/cas/callback`;
}

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: NODE_ENV,
  isDev: NODE_ENV === "DEV",
  frontendUrl,
  casRedirectUri: resolveCasRedirectUri(frontendUrl),
  mongoUri: process.env.MONGODB_URI || "",
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

module.exports = { config, assertCasCredentials, isLoopbackUrl };
