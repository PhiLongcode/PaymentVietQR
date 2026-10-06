const mongoose = require("mongoose");

const grantSchema = new mongoose.Schema(
  {
    grant_id: { type: String, unique: true, sparse: true },
    access_token: String,
    status: { type: String, default: "PENDING_LINK", index: true },
    identity_json: String,
    account_name: String,
    account_number: String,
    fi_name: String,
    created_at: String,
    updated_at: String,
  },
  { collection: "cas_grants" }
);

const orderSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "VND" },
    status: { type: String, required: true, index: true },
    created_at: String,
    updated_at: String,
  },
  { collection: "orders" }
);

const paymentSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, required: true },
    order_id: { type: String, required: true, index: true },
    provider: { type: String, default: "CAS" },
    provider_payment_id: { type: String, unique: true, sparse: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "VND" },
    qr_code: String,
    account_name: String,
    account_number: String,
    virtual_account_number: { type: String, index: true },
    reference_number: { type: String, index: true },
    fi_name: String,
    status: { type: String, required: true, index: true },
    transaction_id: { type: String, unique: true, sparse: true },
    transaction_reference: String,
    expires_at: String,
    paid_at: String,
    created_at: String,
    updated_at: String,
  },
  { collection: "payments" }
);

const webhookEventSchema = new mongoose.Schema(
  {
    transaction_id: { type: String, index: true },
    webhook_type: String,
    environment: String,
    payload_json: String,
    processing_status: String,
    created_at: String,
  },
  { collection: "webhook_events" }
);

const unmatchedSchema = new mongoose.Schema(
  {
    transaction_id: String,
    amount: Number,
    account_number: String,
    description: String,
    reference: String,
    reason: String,
    payload_json: String,
    created_at: String,
  },
  { collection: "unmatched_transactions" }
);

const auditSchema = new mongoose.Schema(
  {
    payment_id: String,
    order_id: String,
    provider: { type: String, default: "CAS" },
    provider_payment_id: String,
    transaction_id: String,
    amount: Number,
    from_status: String,
    to_status: String,
    reason: String,
    created_at: String,
  },
  { collection: "audit_logs" }
);

function plain(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  if (o._id) o.mongo_id = String(o._id);
  delete o._id;
  delete o.__v;
  return o;
}

const CasGrant = mongoose.models.CasGrant || mongoose.model("CasGrant", grantSchema);
const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
const Payment = mongoose.models.Payment || mongoose.model("Payment", paymentSchema);
const WebhookEvent =
  mongoose.models.WebhookEvent || mongoose.model("WebhookEvent", webhookEventSchema);
const UnmatchedTransaction =
  mongoose.models.UnmatchedTransaction ||
  mongoose.model("UnmatchedTransaction", unmatchedSchema);
const AuditLog = mongoose.models.AuditLog || mongoose.model("AuditLog", auditSchema);

module.exports = {
  CasGrant,
  Order,
  Payment,
  WebhookEvent,
  UnmatchedTransaction,
  AuditLog,
  plain,
};
