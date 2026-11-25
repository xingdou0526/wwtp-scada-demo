import { createApp } from "./app.js";

const PORT = Number(process.env.WWTP_PORT ?? 3001);
const instance = createApp();
const server = instance.app.listen(PORT, "127.0.0.1", () => {
  console.log(`[server] API listening on http://127.0.0.1:${PORT}`);
});

function shutdown() {
  instance.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
