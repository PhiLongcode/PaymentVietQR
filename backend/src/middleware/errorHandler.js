function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const code = err.code || "INTERNAL_ERROR";
  if (status >= 500) {
    require("../logger").error("http.error", {
      code,
      message: err.message,
      path: req.path,
    });
  }
  const payload = {
    error: code,
    message: err.message,
  };
  if (err.data && typeof err.data === "object") {
    payload.cas = {
      errorType: err.data.errorType,
      errorCode: err.data.errorCode,
      errorMessage: err.data.errorMessage,
      requestId: err.data.requestId,
    };
  }
  res.status(status).json(payload);
}

module.exports = { asyncHandler, errorHandler };
