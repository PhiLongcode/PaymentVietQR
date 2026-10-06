const mongoose = require("mongoose");
const { config } = require("../config");
const logger = require("../logger");

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${rand}`;
}

async function connectDb() {
  const uri = config.mongoUri;
  if (!uri) {
    throw new Error("Missing MONGODB_URI. Set Atlas connection string in env.");
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  logger.info("mongo.connected", {
    host: mongoose.connection.host,
    db: mongoose.connection.name,
  });
}

module.exports = { connectDb, nowIso, newId, mongoose };
