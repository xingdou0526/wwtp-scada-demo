declare global {
  interface Window {
    __WWTP_BASE_PATH__?: string;
  }
}

export function normalizeBasePath(raw?: string | null): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "/" || trimmed === "." || trimmed === "./") return "";
  const stripped = trimmed.replace(/^\/+|\/+$/g, "");
  return stripped ? `/${stripped}` : "";
}

export function getBasePath(): string {
  if (typeof window !== "undefined" && typeof window.__WWTP_BASE_PATH__ === "string") {
    return normalizeBasePath(window.__WWTP_BASE_PATH__);
  }
  return normalizeBasePath(import.meta.env.BASE_URL);
}

export function withBasePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = getBasePath();
  if (!base) return normalized;
  if (normalized === base || normalized.startsWith(`${base}/`)) return normalized;
  return `${base}${normalized}`;
}
