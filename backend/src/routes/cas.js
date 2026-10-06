const express = require("express");
const { asyncHandler } = require("../middleware/errorHandler");
const grantService = require("../services/grantService");
const { config, isLoopbackUrl } = require("../config");

const router = express.Router();

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function callbackHtml({ ok, message }) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cas Link</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 12vh auto; padding: 1.5rem; line-height: 1.5; }
  </style>
</head>
<body>
  <h1>${ok ? "Đã kết nối tài khoản" : "Cas Link lỗi"}</h1>
  <p>${escapeHtml(message)}</p>
  <p>Có thể đóng trang này và mở lại ứng dụng.</p>
</body>
</html>`;
}

async function handleCasBrowserCallback(req, res) {
  const publicToken =
    req.query.publicToken || req.query.public_token || req.query.token;
  const casError = req.query.error;
  if (casError) {
    res
      .status(400)
      .type("html")
      .send(callbackHtml({ ok: false, message: String(casError) }));
    return;
  }
  if (!publicToken) {
    res
      .status(400)
      .type("html")
      .send(
        callbackHtml({
          ok: false,
          message: "Không nhận được publicToken từ Cas Link.",
        })
      );
    return;
  }

  try {
    await grantService.completeExchange(String(publicToken));
  } catch (err) {
    res
      .status(err.status || 500)
      .type("html")
      .send(callbackHtml({ ok: false, message: err.message || "Exchange thất bại" }));
    return;
  }

  const fe = String(config.frontendUrl || "").replace(/\/$/, "");
  const host = req.hostname || "";
  const requestIsLocal = host === "localhost" || host === "127.0.0.1";
  if (fe && !isLoopbackUrl(fe)) {
    res.redirect(302, `${fe}/?cas=linked`);
    return;
  }
  if (fe && requestIsLocal) {
    res.redirect(302, `${fe}/?cas=linked`);
    return;
  }
  res.type("html").send(
    callbackHtml({
      ok: true,
      message:
        "Định danh tài khoản thành công. Mở lại app hoặc trang thanh toán.",
    })
  );
}

router.post(
  "/grant",
  asyncHandler(async (req, res) => {
    const result = await grantService.startGrant();
    res.json(result);
  })
);

router.post(
  "/exchange",
  asyncHandler(async (req, res) => {
    const publicToken = req.body?.publicToken;
    const grant = await grantService.completeExchange(publicToken);
    res.json({ grant });
  })
);

router.get("/callback", asyncHandler(handleCasBrowserCallback));

router.get(
  "/status",
  asyncHandler(async (req, res) => {
    const row = (await grantService.getActiveGrant()) || (await grantService.getLatestGrant());
    res.json({
      grant: grantService.publicGrant(row),
      hasActiveGrant: Boolean(await grantService.getActiveGrant()),
    });
  })
);

module.exports = router;
module.exports.handleCasBrowserCallback = handleCasBrowserCallback;
