const axios = require("axios");
const { config } = require("../config");
const logger = require("../logger");

class CasHttpError extends Error {
  constructor(message, { status, code, data } = {}) {
    super(message);
    this.name = "CasHttpError";
    this.status = status || 502;
    this.code = code || "CAS_ERROR";
    this.data = data;
  }
}

function casErrorMessage(data) {
  if (!data) return null;
  return (
    data.errorMessage ||
    data.message ||
    data.error?.errorMessage ||
    data.error?.message ||
    (typeof data.error === "string" ? data.error : null)
  );
}

function headers(accessToken) {
  const h = {
    "Content-Type": "application/json",
    "X-BankHub-Api-Version": config.cas.apiVersion,
    "x-client-id": config.cas.clientId,
    "x-secret-key": config.cas.secretKey,
  };
  if (accessToken) h.Authorization = accessToken;
  return h;
}

async function casRequest(method, urlPath, { body, accessToken } = {}) {
  if (!config.cas.clientId || !config.cas.secretKey) {
    throw new CasHttpError("Missing CAS_CLIENT_ID / CAS_SECRET_KEY", {
      status: 503,
      code: "CAS_NOT_CONFIGURED",
    });
  }
  const url = `${config.cas.baseUrl}${urlPath}`;
  try {
    const res = await axios.request({
      method,
      url,
      headers: headers(accessToken),
      data: body,
      timeout: config.cas.timeoutMs,
      validateStatus: () => true,
    });

    if (res.status >= 200 && res.status < 300) return res.data;

    const status = res.status;
    const casMessage = casErrorMessage(res.data);
    let code = res.data?.errorCode || "CAS_ERROR";
    let message = casMessage || `CAS request failed (${status})`;
    if (status === 401) {
      code = "CAS_UNAUTHORIZED";
      message = casMessage || "Cas access token expired or invalid";
    } else if (status >= 400 && status < 500) {
      code = res.data?.errorCode || "CAS_CLIENT_ERROR";
    } else if (status >= 500) {
      code = "CAS_SERVER_ERROR";
      message = casMessage || "Cas service unavailable";
    }

    logger.warn("cas.request.failed", {
      method,
      path: urlPath,
      status,
      code,
      errorType: res.data?.errorType,
      errorMessage: casMessage,
      requestId: res.data?.requestId,
    });
    throw new CasHttpError(message, { status, code, data: res.data });
  } catch (err) {
    if (err instanceof CasHttpError) throw err;
    if (err.code === "ECONNABORTED") {
      throw new CasHttpError("Cas request timeout", {
        status: 504,
        code: "CAS_TIMEOUT",
      });
    }
    logger.error("cas.request.network", { path: urlPath, error: err.message });
    throw new CasHttpError("Cas network error", {
      status: 502,
      code: "CAS_NETWORK",
    });
  }
}

function createGrantToken() {
  return casRequest("post", "/grant/token", {
    body: {
      scopes: "qrpay,transaction",
      language: "vi",
      redirectUri: config.casRedirectUri,
    },
  });
}

function exchangePublicToken(publicToken) {
  return casRequest("post", "/grant/exchange", {
    body: { publicToken },
  });
}

function getQrPayIdentity(accessToken) {
  return casRequest("get", "/qr-pay/identity", { accessToken });
}

function removeGrant(accessToken, grantId) {
  return casRequest("post", "/grant/remove", {
    accessToken,
    body: grantId ? { grantId } : {},
  });
}

function createQrPay(accessToken, payload) {
  return casRequest("post", "/qr-pay", { accessToken, body: payload });
}

function listTransactions(accessToken, { fromDate, toDate } = {}) {
  const q = new URLSearchParams();
  if (fromDate) q.set("fromDate", fromDate);
  if (toDate) q.set("toDate", toDate);
  q.set("pageSize", "50");
  return casRequest("get", `/transactions?${q.toString()}`, { accessToken });
}

function buildLinkUrl(grantToken) {
  const u = new URL(config.cas.linkUrl);
  u.searchParams.set("grantToken", grantToken);
  u.searchParams.set("redirectUri", config.casRedirectUri);
  u.searchParams.set("iframe", "false");
  return u.toString();
}

module.exports = {
  CasHttpError,
  createGrantToken,
  exchangePublicToken,
  getQrPayIdentity,
  removeGrant,
  createQrPay,
  buildLinkUrl,
  listTransactions,
};
