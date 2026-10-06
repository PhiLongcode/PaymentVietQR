"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../../../lib/api";
import { formatVnd, statusLabel, isPaid } from "../../../lib/format";

export default function PayPage() {
  const { id } = useParams();
  const router = useRouter();
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  async function refreshFull() {
    const data = await api.getPayment(id);
    setPayment(data);
    if (isPaid(data)) router.replace(`/orders/${id}/success`);
  }

  useEffect(() => {
    let cancelled = false;
    refreshFull().catch((err) => {
      if (!cancelled) setError(err.message);
    });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const timer = setInterval(() => {
      refreshFull().catch(() => {});
    }, 2000);

    let source;
    try {
      source = new EventSource(api.paymentEventsUrl(id));
      source.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data?.error) return;
          setPayment(data);
          if (isPaid(data)) {
            source.close();
            router.replace(`/orders/${id}/success`);
          }
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* EventSource unavailable */
    }

    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(tick);
      if (source) source.close();
    };
  }, [id, router]);

  const remaining = useMemo(() => {
    if (!payment?.expiresAt) return null;
    const ms = new Date(payment.expiresAt).getTime() - now;
    if (ms <= 0) return "Hết hạn";
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${String(s).padStart(2, "0")}`;
  }, [payment, now]);

  async function cancel() {
    setBusy(true);
    try {
      const data = await api.cancelOrder(id);
      setPayment(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!payment && !error) return <section className="card">Đang tải QR…</section>;

  return (
    <section className="pay-card card">
      <p className="eyebrow">Thanh toán</p>
      <h1>{formatVnd(payment?.amount)}</h1>
      {error ? <div className="alert">{error}</div> : null}

      {payment?.qrCode && payment.status === "PENDING" ? (
        <div className="qr-wrap">
          <QRCodeSVG value={payment.qrCode} size={220} />
        </div>
      ) : (
        <p className="muted">Không có QR để hiển thị.</p>
      )}

      <dl className="facts">
        <div>
          <dt>Ngân hàng</dt>
          <dd>{payment?.fiName || "—"}</dd>
        </div>
        <div>
          <dt>Số tài khoản</dt>
          <dd>{payment?.accountNumber || "—"}</dd>
        </div>
        <div>
          <dt>Chủ TK</dt>
          <dd>{payment?.accountName || "—"}</dd>
        </div>
        <div>
          <dt>Nội dung CK</dt>
          <dd>{payment?.description || payment?.orderId || "—"}</dd>
        </div>
        <div>
          <dt>Trạng thái</dt>
          <dd className="status">{statusLabel(payment?.status)}</dd>
        </div>
      </dl>

      {remaining ? <p className="countdown">Hiệu lực QR: {remaining}</p> : null}
      <p className="muted wait">Đang chờ xác nhận — tự cập nhật mỗi 2 giây.</p>

      {payment?.status === "PENDING" ? (
        <button className="btn danger" disabled={busy} onClick={cancel}>
          Hủy thanh toán
        </button>
      ) : null}
    </section>
  );
}
