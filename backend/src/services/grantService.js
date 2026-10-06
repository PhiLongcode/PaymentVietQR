const { nowIso } = require("../db");
const { CasGrant, plain } = require("../db/models");
const logger = require("../logger");
const cas = require("./casClient");

async function getActiveGrant() {
  const row = await CasGrant.findOne({ status: "ACTIVE" }).sort({ _id: -1 });
  return plain(row);
}

async function getLatestGrant() {
  const row = await CasGrant.findOne({}).sort({ _id: -1 });
  return plain(row);
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

async function markGrantInvalid(grantId, reason) {
  const ts = nowIso();
  await CasGrant.updateOne(
    { grant_id: grantId },
    { $set: { status: "INVALID", updated_at: ts } }
  );
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
  await CasGrant.updateMany(
    { status: "ACTIVE" },
    { $set: { status: "INVALID", updated_at: ts } }
  );
  await CasGrant.create({
    grant_id: grantId,
    access_token: accessToken,
    status: "ACTIVE",
    identity_json: JSON.stringify(identityData),
    account_name: parsed.accountName,
    account_number: parsed.accountNumber,
    fi_name: parsed.fiName,
    created_at: ts,
    updated_at: ts,
  });

  logger.info("grant.activated", {
    grantId,
    accountNumber: parsed.accountNumber,
    fiName: parsed.fiName,
  });

  return publicGrant(await getActiveGrant());
}

async function withAccessToken(fn) {
  const grant = await getActiveGrant();
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
      await markGrantInvalid(grant.grant_id, "401");
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
