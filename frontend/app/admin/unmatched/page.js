"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatVnd } from "../../lib/format";

export default function UnmatchedPage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .unmatched()
      .then((d) => setItems(d.items || []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <section className="card">
      <h1>Giao dịch chưa khớp</h1>
      <p className="lede">
        Webhook CAS không map được Payment (thiếu paymentMeta, VA trùng, hoặc mô tả mơ hồ).
      </p>
      {error ? <div className="alert">{error}</div> : null}
      {items.length === 0 ? (
        <p className="muted">Không có giao dịch UNMATCHED.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Txn</th>
              <th>Số tiền</th>
              <th>STK</th>
              <th>Mô tả</th>
              <th>Lý do</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td>{row.transaction_id}</td>
                <td>{formatVnd(row.amount)}</td>
                <td>{row.account_number}</td>
                <td>{row.description}</td>
                <td>{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
