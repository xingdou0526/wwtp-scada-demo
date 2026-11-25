import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const PORT = Number(process.env.WWTP_PORT ?? 3001);
const HOST = process.env.WWTP_HOST ?? "127.0.0.1";
const defaultStaticDir = fileURLToPath(new URL("../web/dist", import.meta.url));
const candidateStaticDir = process.env.WWTP_STATIC_DIR ? resolve(process.env.WWTP_STATIC_DIR) : defaultStaticDir;
const staticDir = existsSync(resolve(candidateStaticDir, "index.html")) ? candidateStaticDir : undefined;

const instance = createApp({ staticDir });
const server = instance.app.listen(PORT, HOST, () => {
  console.log(`[server] API listening on http://${HOST}:${PORT}`);
  if (staticDir) console.log(`[server] Serving frontend from ${staticDir}`);
});

function shutdown() {
  instance.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
