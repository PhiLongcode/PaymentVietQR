const REDACT_KEYS = [
  "x-secret-key",
  "secretkey",
  "secret_key",
  "accesstoken",
  "access_token",
  "authorization",
  "clientsecret",
  "client_secret",
];

function redact(value, key = "") {
  if (value == null) return value;
  if (REDACT_KEYS.includes(String(key).toLowerCase())) return "***";
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  return value;
}

function log(level, message, extra) {
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(extra ? { extra: redact(extra) } : {}),
  };
  const fn = level === "error" ? console.error : console.log;
  fn(JSON.stringify(line));
}

module.exports = {
  info: (message, extra) => log("info", message, extra),
  warn: (message, extra) => log("warn", message, extra),
  error: (message, extra) => log("error", message, extra),
  redact,
};
