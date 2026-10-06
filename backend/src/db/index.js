const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { config } = require("../config");
const { initSchema } = require("./schema");

const dir = path.dirname(config.dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(config.dbPath);
initSchema(db);

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${rand}`;
}

module.exports = { db, nowIso, newId };
