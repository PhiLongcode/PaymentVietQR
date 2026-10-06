export function formatVnd(amount) {
  return `${Number(amount || 0).toLocaleString("vi-VN")} VND`;
}

export function isPaid(payment) {
  return (
    payment?.status === "PAID" ||
    payment?.paymentStatus === "SUCCESS" ||
    payment?.orderStatus === "PAID"
  );
}

export function statusLabel(status) {
  const map = {
    PENDING: "Chờ thanh toán",
    PENDING_PAYMENT: "Chờ thanh toán",
    PAYMENT_PROCESSING: "Đang xử lý",
    PAID: "Đã thanh toán",
    SUCCESS: "Thành công",
    FAILED: "Thất bại",
    EXPIRED: "Hết hạn",
    CANCELLED: "Đã hủy",
    UNMATCHED: "Chưa đối soát",
  };
  return map[status] || status || "—";
}
