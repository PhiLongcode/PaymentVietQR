import "./globals.css";

export const metadata = {
  title: "VietQR Pay Demo",
  description: "CAS QR Pay sandbox checkout",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <div className="shell">
          <header className="topbar">
            <a className="brand" href="/">
              <span className="brand-mark">QR</span>
              VietQR Pay Demo
            </a>
            <nav>
              <a href="/">Thanh toán</a>
              <a href="/admin/unmatched">Đối soát</a>
            </nav>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
