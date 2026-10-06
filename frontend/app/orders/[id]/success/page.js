"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { formatVnd } from "../../../lib/format";

export default function SuccessPage() {
  const { id } = useParams();
  const [payment, setPayment] = useState(null);

  useEffect(() => {
    api.getPayment(id).then(setPayment).catch(() => {});
  }, [id]);

  return (
    <section className="card success">
      <p className="eyebrow">Đơn {id}</p>
      <h1>Thanh toán thành công</h1>
      <p className="lede">
        {formatVnd(payment?.amount)} đã được đối soát từ webhook CAS.
      </p>
      <a className="btn" href="/">
        Tạo đơn khác
      </a>
    </section>
  );
}
