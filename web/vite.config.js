import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig(({ command }) => {
  const rawBase = (process.env.WWTP_BASE_PATH || "").trim().replace(/^\/+|\/+$/g, "");
  const devBase = rawBase ? `/${rawBase}/` : "/";
  const apiPrefix = rawBase ? `/${rawBase}/api` : "/api";

  return {
    base: command === "build" ? "./" : devBase,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        [apiPrefix]: {
          target: `http://127.0.0.1:${process.env.WWTP_PORT ?? 3001}`,
          changeOrigin: true,
        },
      },
    },
  };
});
