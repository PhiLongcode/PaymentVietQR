const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (${res.status})`);
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  casStatus: () => request("/api/v1/cas/status"),
  startGrant: () => request("/api/v1/cas/grant", { method: "POST", body: "{}" }),
  exchange: (publicToken) =>
    request("/api/v1/cas/exchange", {
      method: "POST",
      body: JSON.stringify({ publicToken }),
    }),
  listOrders: () => request("/api/v1/orders"),
  createOrder: (amount) =>
    request("/api/v1/orders", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  createQr: (orderId, amount) =>
    request("/api/v1/payments/qr", {
      method: "POST",
      body: JSON.stringify({ orderId, amount }),
    }),
  getPayment: (orderId) => request(`/api/v1/orders/${orderId}/payment`),
  getPaymentStatus: (orderId) =>
    request(`/api/v1/orders/${orderId}/payment-status`),
  paymentEventsUrl: (orderId) =>
    `${API_URL}/api/v1/orders/${orderId}/events`,
  cancelOrder: (orderId) =>
    request(`/api/v1/orders/${orderId}/cancel`, { method: "POST", body: "{}" }),
  unmatched: () => request("/api/v1/unmatched"),
};
