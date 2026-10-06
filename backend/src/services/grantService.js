const { db, nowIso } = require("../db");
const logger = require("../logger");
const cas = require("./casClient");

function getActiveGrant() {
  return db
    .prepare(
      `SELECT * FROM cas_grants WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1`
    )
    .get();
}

function getLatestGrant() {
  return db.prepare(`SELECT * FROM cas_grants ORDER BY id DESC LIMIT 1`).get();
}

function publicGrant(row) {
  if (!row) return null;
  let identity = null;
  try {
    identity = row.identity_json ? JSON.parse(row.identity_json) : null;
  } catch {
    identity = null;
  }
  return {
    grantId: row.grant_id,
    status: row.status,
    accountName: row.account_name,
    accountNumber: row.account_number,
    fiName: row.fi_name,
    identity,
    updatedAt: row.updated_at,
  };
}

function markGrantInvalid(grantId, reason) {
  const ts = nowIso();
  db.prepare(
    `UPDATE cas_grants SET status = 'INVALID', updated_at = ? WHERE grant_id = ?`
  ).run(ts, grantId);
  logger.warn("grant.invalidated", { grantId, reason });
}

function parseIdentity(data) {
  const src = data?.identity || data?.qrPayIdentity || data || {};
  const accountName =
    src.accountName ||
    src.legalName ||
    src.ownerName ||
    src.name ||
    src.companyName ||
    null;
  const accountNumber =
    src.accountNumber || src.account_number || src.account || null;
  const fiName = src.fiName || src.bankName || src.fiServiceName || null;
  const valid = Boolean(accountNumber || accountName);
  return { valid, accountName, accountNumber, fiName, raw: data };
}

async function startGrant() {
  const data = await cas.createGrantToken();
  const grantToken = data.grantToken || data.token || data.linkToken;
  if (!grantToken) {
    const err = new Error("Cas did not return grantToken");
    err.status = 502;
    err.code = "CAS_ERROR";
    throw err;
  }
  return {
    grantToken,
    linkUrl: cas.buildLinkUrl(grantToken),
    redirectUri: require("../config").config.casRedirectUri,
  };
}

async function completeExchange(publicToken) {
  if (!publicToken) {
    const err = new Error("publicToken is required");
    err.status = 400;
    err.code = "INVALID_REQUEST";
    throw err;
  }

  const exchanged = await cas.exchangePublicToken(publicToken);
  const accessToken = exchanged.accessToken || exchanged.access_token;
  const grantId = exchanged.grantId || exchanged.grant_id;
  if (!accessToken || !grantId) {
    const err = new Error("Cas exchange did not return accessToken/grantId");
    err.status = 502;
    err.code = "CAS_ERROR";
    throw err;
  }

  let identityData;
  try {
    identityData = await cas.getQrPayIdentity(accessToken);
  } catch (err) {
    if (err.code === "CAS_UNAUTHORIZED" || err.status === 401) {
      try {
        await cas.removeGrant(accessToken, grantId);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }

  const parsed = parseIdentity(identityData);
  if (!parsed.valid) {
    try {
      await cas.removeGrant(accessToken, grantId);
    } catch {
      /* ignore */
    }
    const err = new Error("QR Pay identity is invalid; grant was revoked");
    err.status = 400;
    err.code = "IDENTITY_INVALID";
    throw err;
  }

  const ts = nowIso();
  db.prepare(`UPDATE cas_grants SET status = 'INVALID', updated_at = ? WHERE status = 'ACTIVE'`).run(
    ts
  );

  db.prepare(
    `INSERT INTO cas_grants (
      grant_id, access_token, status, identity_json,
      account_name, account_number, fi_name, created_at, updated_at
    ) VALUES (?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`
  ).run(
    grantId,
    accessToken,
    JSON.stringify(identityData),
    parsed.accountName,
    parsed.accountNumber,
    parsed.fiName,
    ts,
    ts
  );

  logger.info("grant.activated", {
    grantId,
    accountNumber: parsed.accountNumber,
    fiName: parsed.fiName,
  });

  return publicGrant(getActiveGrant());
}

async function withAccessToken(fn) {
  const grant = getActiveGrant();
  if (!grant) {
    const err = new Error("No active Cas grant. Link a receiving account first.");
    err.status = 409;
    err.code = "GRANT_REQUIRED";
    throw err;
  }
  try {
    return await fn(grant.access_token, grant);
  } catch (err) {
    if (err.code === "CAS_UNAUTHORIZED" || err.status === 401) {
      markGrantInvalid(grant.grant_id, "401");
      const reauth = new Error("Cas token expired. Please re-link the account.");
      reauth.status = 401;
      reauth.code = "CAS_REAUTH_REQUIRED";
      throw reauth;
    }
    throw err;
  }
}

module.exports = {
  getActiveGrant,
  getLatestGrant,
  publicGrant,
  startGrant,
  completeExchange,
  withAccessToken,
  markGrantInvalid,
};
