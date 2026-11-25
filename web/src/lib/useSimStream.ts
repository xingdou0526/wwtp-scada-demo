import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, fetchState, postJson } from "@/lib/api";
import type { HistoryPoint, StateDelta, StateResponse } from "@/lib/types";

const MAX_HISTORY = 240;
const POLL_INTERVAL_MS = 2000;
const SSE_MAX_FAILURES = 3;
const SSE_RECOVERY_MS = 60_000;

function samePoint(a: HistoryPoint, b: HistoryPoint) {
  return (
    a.tick === b.tick &&
    a.do === b.do &&
    a.measuredDo === b.measuredDo &&
    a.doSetpoint === b.doSetpoint &&
    a.airflow === b.airflow &&
    a.measuredAirflow === b.measuredAirflow &&
    a.effNh4 === b.effNh4 &&
    a.power === b.power
  );
}

function parseEventData<T>(event: Event): T | null {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as T;
  } catch {
    return null;
  }
}

function mergeDelta(prev: StateResponse | null, delta: StateDelta): StateResponse | null {
  if (!prev) return null;
  let history = prev.history;
  if (delta.latestPoint) {
    const last = history[history.length - 1];
    if (!last || delta.latestPoint.tick > last.tick) {
      history = [...history, delta.latestPoint];
      if (history.length > MAX_HISTORY) history = history.slice(history.length - MAX_HISTORY);
    } else if (delta.latestPoint.tick === last.tick && !samePoint(last, delta.latestPoint)) {
      history = [...history.slice(0, -1), delta.latestPoint];
    }
  }
  return {
    ...prev,
    state: delta.state,
    limits: delta.limits,
    markers: delta.markers,
    activePreset: delta.activePreset,
    activeAdvice: delta.activeAdvice,
    activeAdvices: delta.activeAdvices,
    monitorStatus: delta.monitorStatus,
    timing: delta.timing,
    history,
  };
}

// 优先通过 SSE 接收实时增量推送；若代理/网关不支持 SSE，则自动降级为带 AbortController 的串行轮询并在恢复后尝试重连 SSE
export function useSimStream(active: boolean) {
  const [data, setData] = useState<StateResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"sse" | "poll">(() => (typeof EventSource === "function" ? "sse" : "poll"));
  const requestSeq = useRef(0);
  const inFlightMutations = useRef(0);
  const fetchAbort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    fetchAbort.current?.abort();
    const controller = new AbortController();
    fetchAbort.current = controller;
    const seq = ++requestSeq.current;
    try {
      const next = await fetchState(controller.signal);
      if (controller.signal.aborted || seq !== requestSeq.current) return false;
      setData(next);
      setConnected(true);
      setError(null);
      return true;
    } catch {
      if (!controller.signal.aborted && seq === requestSeq.current) setConnected(false);
      return false;
    }
  }, []);

  const syncState = useCallback(async (snapshot?: StateResponse) => {
    if (snapshot) {
      fetchAbort.current?.abort();
      requestSeq.current += 1;
      setData(snapshot);
      setConnected(true);
      setError(null);
      return;
    }
    await load();
  }, [load]);

  const applyMutation = useCallback(async (url: string, body?: unknown, optimistic?: (prev: StateResponse) => StateResponse) => {
    fetchAbort.current?.abort();
    const seq = ++requestSeq.current;
    inFlightMutations.current += 1;
    if (optimistic) setData((prev) => (prev ? optimistic(prev) : prev));
    try {
      const res = await postJson<{ ok: true; snapshot?: StateResponse }>(url, body);
      if (seq !== requestSeq.current) return;
      if (res.snapshot) {
        setData(res.snapshot);
        setConnected(true);
        setError(null);
      } else {
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
      void load();
    } finally {
      inFlightMutations.current = Math.max(0, inFlightMutations.current - 1);
    }
  }, [load]);

  // 后台管理页仅单次拉取最新状态，不保持长连接或轮询
  useEffect(() => {
    if (!active) {
      void load();
      return () => fetchAbort.current?.abort();
    }

    if (mode === "sse") {
      let source: EventSource | null = null;
      let failures = 0;

      const closeSource = () => {
        source?.close();
        source = null;
      };

      const connect = () => {
        if (document.hidden || source) return;
        const es = new EventSource(apiUrl("/api/events"));
        source = es;

        es.addEventListener("snapshot", (event) => {
          failures = 0;
          if (inFlightMutations.current > 0) return;
          const snapshot = parseEventData<StateResponse>(event);
          if (!snapshot) return;
          requestSeq.current += 1;
          setData(snapshot);
          setConnected(true);
          setError(null);
        });

        es.addEventListener("update", (event) => {
          failures = 0;
          if (inFlightMutations.current > 0) return;
          const delta = parseEventData<StateDelta>(event);
          if (!delta) return;
          setData((prev) => mergeDelta(prev, delta));
          setConnected(true);
        });

        es.onerror = () => {
          failures += 1;
          setConnected(false);
          if (failures >= SSE_MAX_FAILURES) {
            closeSource();
            setMode("poll");
          }
        };
      };

      const onVisibility = () => {
        if (document.hidden) closeSource();
        else connect();
      };

      connect();
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        closeSource();
      };
    }

    // 降级模式：串行 setTimeout + AbortController，严格等上一次返回再安排下一次，并在服务恢复后定时重试 SSE
    let disposed = false;
    let timer: number | null = null;
    let recoveryTimer: number | null = null;

    const scheduleRecovery = () => {
      if (disposed || recoveryTimer !== null || typeof EventSource !== "function") return;
      recoveryTimer = window.setTimeout(() => {
        recoveryTimer = null;
        if (!disposed && !document.hidden) setMode("sse");
      }, SSE_RECOVERY_MS);
    };

    const schedule = () => {
      if (disposed || document.hidden) return;
      timer = window.setTimeout(run, POLL_INTERVAL_MS);
    };

    const run = async () => {
      if (disposed || document.hidden) return;
      const ok = await load();
      if (ok) scheduleRecovery();
      schedule();
    };

    const onVisibility = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (document.hidden) fetchAbort.current?.abort();
      else void run();
    };

    void run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
      fetchAbort.current?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, load, mode]);

  return { data, connected, error, load, syncState, applyMutation };
}
