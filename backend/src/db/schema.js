function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS cas_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grant_id TEXT UNIQUE,
      access_token TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING_LINK',
      identity_json TEXT,
      account_name TEXT,
      account_number TEXT,
      fi_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'VND',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'CAS',
      provider_payment_id TEXT UNIQUE,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'VND',
      qr_code TEXT,
      account_name TEXT,
      account_number TEXT,
      virtual_account_number TEXT,
      reference_number TEXT,
      fi_name TEXT,
      status TEXT NOT NULL,
      transaction_id TEXT UNIQUE,
      transaction_reference TEXT,
      expires_at TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT,
      webhook_type TEXT,
      environment TEXT,
      payload_json TEXT NOT NULL,
      processing_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS unmatched_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT,
      amount INTEGER,
      account_number TEXT,
      description TEXT,
      reference TEXT,
      reason TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id TEXT,
      order_id TEXT,
      provider TEXT,
      provider_payment_id TEXT,
      transaction_id TEXT,
      amount INTEGER,
      from_status TEXT,
      to_status TEXT,
      reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_va ON payments(virtual_account_number);
    CREATE INDEX IF NOT EXISTS idx_payments_ref ON payments(reference_number);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
  `);
}

module.exports = { initSchema };
