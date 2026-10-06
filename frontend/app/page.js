"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./lib/api";
import { formatVnd, statusLabel } from "./lib/format";

export default function HomePage() {
  const router = useRouter();
  const [grant, setGrant] = useState(null);
  const [hasActive, setHasActive] = useState(false);
  const [orders, setOrders] = useState([]);
  const [amount, setAmount] = useState(2000);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const status = await api.casStatus();
      setGrant(status.grant);
      setHasActive(status.hasActiveGrant);
      if (status.hasActiveGrant) {
        const list = await api.listOrders();
        setOrders(list.orders || []);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function connectBank() {
    setBusy(true);
    setError("");
    try {
      const data = await api.startGrant();
      window.location.href = data.linkUrl;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function createAndPay(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const order = await api.createOrder(Number(amount));
      await api.createQr(order.id, order.amount);
      router.push(`/orders/${order.id}/pay`);
    } catch (err) {
      if (err.code === "CAS_REAUTH_REQUIRED" || err.status === 401) {
        setHasActive(false);
      }
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <section className="hero card">
        <p className="eyebrow">CAS QR Pay · Sandbox</p>
        <h1>Thu tiền qua VietQR, đối soát tự động.</h1>
        <p className="lede">
          Liên kết tài khoản nhận tiền qua Cas Link, tạo đơn, hiện QR từ backend
          rồi xác nhận thanh toán bằng webhook.
        </p>
      </section>

      {error ? <div className="alert">{error}</div> : null}

      {!hasActive ? (
        <section className="card">
          <h2>Bước 1 — Kết nối tài khoản nhận tiền</h2>
          <p>
            Tạo grant <code>qrpay</code>, mở Cas Link, đổi <code>publicToken</code>{" "}
            lấy access token, rồi gọi <code>GET /qr-pay/identity</code>.
          </p>
          {grant?.status === "INVALID" ? (
            <p className="muted">Grant hiện không còn hiệu lực. Hãy kết nối lại.</p>
          ) : null}
          <button className="btn" disabled={busy} onClick={connectBank}>
            {busy ? "Đang tạo grant…" : "Kết nối tài khoản"}
          </button>
        </section>
      ) : (
        <>
          <section className="card">
            <h2>Tài khoản nhận tiền</h2>
            <dl className="facts">
              <div>
                <dt>Chủ TK</dt>
                <dd>{grant?.accountName || "—"}</dd>
              </div>
              <div>
                <dt>Số TK</dt>
                <dd>{grant?.accountNumber || "—"}</dd>
              </div>
              <div>
                <dt>Ngân hàng</dt>
                <dd>{grant?.fiName || "—"}</dd>
              </div>
            </dl>
            <button className="btn secondary" disabled={busy} onClick={connectBank}>
              Kết nối lại
            </button>
          </section>

          <section className="card">
            <h2>Tạo đơn hàng</h2>
            <form className="row-form" onSubmit={createAndPay}>
              <label>
                Số tiền (VND)
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </label>
              <button className="btn" disabled={busy} type="submit">
                {busy ? "Đang tạo QR…" : "Tạo QR thanh toán"}
              </button>
            </form>
          </section>

          <section className="card">
            <h2>Đơn gần đây</h2>
            {orders.length === 0 ? (
              <p className="muted">Chưa có đơn nào.</p>
            ) : (
              <ul className="order-list">
                {orders.map((o) => (
                  <li key={o.id}>
                    <a href={`/orders/${o.id}/pay`}>
                      <strong>{o.id}</strong>
                      <span>{formatVnd(o.amount)}</span>
                      <em>{statusLabel(o.status)}</em>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
