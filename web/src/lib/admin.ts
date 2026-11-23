import { requestJson } from "@/lib/api";
import type { Term } from "@/lib/terms";

export const KNOWLEDGE_FILE_LIMIT = 64 * 1024;

export interface KnowledgeInput {
  id: string;
  title: string;
  content: string;
  format: "text" | "markdown";
}

export interface KnowledgeEntry extends KnowledgeInput {
  ruleLinked: boolean;
  updatedAt: string | null;
}

export interface RuleLimits {
  doSetpointMin: number;
  doSetpointMax: number;
  doSetpointStep: number;
  airflowMin: number;
  airflowMax: number;
  nh4InternalLimit: number;
  minExecuteInterval: number;
  reviewAfter: number;
}

export interface ManagementData {
  knowledge: KnowledgeEntry[];
  terms: Term[];
  limits: RuleLimits;
}

export function fetchManagement(signal: AbortSignal) {
  return requestJson<ManagementData>("/api/admin", { signal });
}

export function fetchKnowledge(id: string, signal: AbortSignal) {
  return requestJson<KnowledgeEntry>(`/api/knowledge/${encodeURIComponent(id)}`, { signal });
}

export function saveEntry<T>(resource: "knowledge" | "terms", input: unknown, id?: string) {
  const path = `/api/admin/${resource}${id ? `/${encodeURIComponent(id)}` : ""}`;
  return requestJson<T>(path, { method: id ? "PUT" : "POST", body: input });
}

export function deleteEntry(resource: "knowledge" | "terms", id: string) {
  return requestJson<{ ok: true }>(`/api/admin/${resource}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function saveLimits(limits: RuleLimits) {
  return requestJson<RuleLimits>("/api/admin/limits", { method: "PUT", body: limits });
}
