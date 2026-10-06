"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "../../lib/api";

function CallbackInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [message, setMessage] = useState("Đang đổi publicToken…");

  useEffect(() => {
    const publicToken =
      params.get("publicToken") ||
      params.get("public_token") ||
      params.get("token");
    const error = params.get("error");
    if (error) {
      setMessage(`Cas Link lỗi: ${error}`);
      return;
    }
    if (!publicToken) {
      setMessage("Không nhận được publicToken từ Cas Link.");
      return;
    }
    api
      .exchange(publicToken)
      .then(() => {
        setMessage("Định danh tài khoản thành công. Đang chuyển về trang chính…");
        setTimeout(() => router.replace("/"), 800);
      })
      .catch((err) => setMessage(err.message));
  }, [params, router]);

  return (
    <section className="card">
      <h1>Cas Link</h1>
      <p>{message}</p>
    </section>
  );
}

export default function CasCallbackPage() {
  return (
    <Suspense fallback={<section className="card">Đang tải…</section>}>
      <CallbackInner />
    </Suspense>
  );
}
