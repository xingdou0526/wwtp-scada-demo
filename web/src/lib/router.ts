import { useCallback, useEffect, useState, type MouseEvent } from "react";

export type AppRoute = "control" | "admin";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");

export function routeHref(route: AppRoute): string {
  if (route === "admin") return `${BASE_PATH}/admin`;
  return BASE_PATH ? `${BASE_PATH}/` : "/";
}

export function resolveRoute(pathname: string, hash = ""): AppRoute {
  const relative = BASE_PATH && pathname.startsWith(BASE_PATH)
    ? pathname.slice(BASE_PATH.length)
    : pathname;
  const normalized = relative.replace(/\/+$/, "") || "/";
  if (normalized === "/admin") return "admin";
  if (normalized === "/" && hash === "#admin") return "admin";
  return "control";
}

export function useAppRoute() {
  const [route, setRoute] = useState<AppRoute>(() => resolveRoute(window.location.pathname, window.location.hash));

  useEffect(() => {
    // 兼容旧哈希书签（/#admin、/#control），自动规整为 History 路径
    if (window.location.hash === "#admin" || window.location.hash === "#control") {
      const next: AppRoute = window.location.hash === "#admin" ? "admin" : "control";
      const target = routeHref(next);
      if (window.location.pathname !== target || window.location.hash) {
        window.history.replaceState(null, "", target);
      }
      setRoute(next);
    }

    const sync = () => setRoute(resolveRoute(window.location.pathname));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const navigate = useCallback((next: AppRoute, event?: MouseEvent<HTMLAnchorElement>) => {
    if (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
    }
    const target = routeHref(next);
    if (window.location.pathname !== target || window.location.search || window.location.hash) {
      window.history.pushState(null, "", target);
    }
    setRoute(next);
  }, []);

  return { route, navigate };
}
