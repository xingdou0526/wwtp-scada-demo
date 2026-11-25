import { constants, createGzip } from "node:zlib";

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg\+xml)/i;

// 零依赖 Gzip 响应压缩中间件，覆盖 /api/* JSON 与前端静态资源
export function gzipMiddleware(req, res, next) {
  if (req.method === "HEAD") return next();
  const accept = req.headers["accept-encoding"];
  if (typeof accept !== "string" || !/\bgzip\b/i.test(accept)) return next();

  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  let gzip = null;
  let decided = false;

  function decide() {
    if (decided) return Boolean(gzip);
    decided = true;
    const type = String(res.getHeader("Content-Type") || "");
    if (/^text\/event-stream/i.test(type)) return false;
    const existing = res.getHeader("Content-Encoding");
    const status = res.statusCode;
    const length = Number(res.getHeader("Content-Length"));
    const tooSmall = Number.isFinite(length) && length > 0 && length < 1024;
    if (existing || status === 204 || status === 206 || status === 304 || tooSmall || !COMPRESSIBLE.test(type)) {
      return false;
    }
    res.removeHeader("Content-Length");
    res.setHeader("Content-Encoding", "gzip");
    res.vary("Accept-Encoding");
    gzip = createGzip({ level: constants.Z_DEFAULT_COMPRESSION });
    let waitingForSocket = false;
    gzip.on("data", (chunk) => {
      if (res.writableEnded || res.destroyed) return;
      if (origWrite(chunk) === false) {
        waitingForSocket = true;
        gzip.pause();
      }
    });
    gzip.on("drain", () => {
      if (!waitingForSocket && !res.writableEnded && !res.destroyed) {
        res.emit("drain");
      }
    });
    gzip.on("end", () => {
      if (!res.writableEnded && !res.destroyed) origEnd();
    });
    gzip.on("error", () => {
      gzip?.destroy();
      if (!res.destroyed) res.destroy();
    });
    res.on("drain", () => {
      if (waitingForSocket && gzip && !gzip.destroyed) {
        waitingForSocket = false;
        gzip.resume();
      }
    });
    const destroyGzip = () => {
      if (gzip && !gzip.destroyed) gzip.destroy();
    };
    res.once("close", destroyGzip);
    res.once("error", destroyGzip);
    return true;
  }

  res.write = (...args) => {
    if (!decide()) return origWrite(...args);
    if (gzip.destroyed) return false;
    return gzip.write(...args);
  };
  res.end = (...args) => {
    if (!decide()) return origEnd(...args);
    if (!gzip.destroyed) gzip.end(...args);
    return res;
  };

  next();
}
