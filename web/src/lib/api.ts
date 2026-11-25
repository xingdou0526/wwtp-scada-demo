// API 封装
import type { StateResponse } from "@/lib/types";
export { formatClock, formatDateTime, formatTick } from "@/lib/time";

export async function fetchState(signal?: AbortSignal): Promise<StateResponse> {
  const r = await fetch("/api/state", { signal });
  if (!r.ok) throw new Error("state fetch failed");
  return r.json();
}

export async function requestJson<T>(url: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const { method, body, signal } = options;
  const r = await fetch(url, {
    method,
    signal,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || data === null) throw new Error(data?.error || "请求失败，请检查仿真服务后重试");
  return data;
}

export function postJson<T = unknown>(url: string, body?: unknown) {
  return requestJson<T>(url, { method: "POST", body });
}

export interface OperationSnapshot {
  tick: number;
  clockMinutes?: number;
  do: number;
  doSetpoint: number;
  airflow: number;
  power: number;
  effNh4: number;
}

export interface OperationFeedbackInput {
  operatorNote: string;
  evaluation: string;
  effective: boolean | null;
}

export interface OperationRecord {
  id: string;
  adviceId: string;
  title: string;
  knowledgeRef?: string;
  executeTime: string;
  before: OperationSnapshot;
  during: {
    from: number;
    to: number;
    reasons: { label: string; value: string }[];
    forecast: {
      doRange?: string;
      responseMinutes?: string;
      nh4Trend?: string;
      energyDeltaPct?: string;
    };
  };
  after: OperationSnapshot | null;
  reviewDueTick: number;
  reviewInterrupted?: "reset" | "restart";
  operatorNote: string;
  feedback: (Omit<OperationFeedbackInput, "operatorNote"> & { updatedAt: string }) | null;
}

export async function fetchOperations(signal: AbortSignal): Promise<OperationRecord[]> {
  const response = await fetch("/api/operations", { signal });
  if (!response.ok) throw new Error("读取操作记录失败");
  const data = await response.json();
  return data.operations;
}

export async function saveOperationFeedback(id: string, feedback: OperationFeedbackInput): Promise<OperationRecord> {
  const data = await postJson<{ ok: true; operation: OperationRecord }>(`/api/operations/${encodeURIComponent(id)}/feedback`, feedback);
  return data.operation;
}
