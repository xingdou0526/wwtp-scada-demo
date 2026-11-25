import { useEffect, useRef, useState } from "react";
import { ClipboardList, Inbox, SearchX } from "lucide-react";
import { OperationDetail, REVIEW_LABELS, ReviewBadge, reviewStatus } from "@/components/operations/OperationDetail";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchOperations, type OperationRecord } from "@/lib/api";
import { formatDateTime } from "@/lib/time";

export function OperationRecords({ operationId }: { operationId?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant={operationId ? "outline" : "ghost"} size="sm"
          className={operationId ? undefined : "w-27 shrink-0 text-xs text-muted-foreground"}
        >
          <ClipboardList aria-hidden /> {operationId ? "查看关联操作记录" : "操作记录"}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[44rem] max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle>操作记录</DialogTitle>
          <DialogDescription>查看已执行建议的调节依据、复评结果和人工反馈。</DialogDescription>
        </DialogHeader>
        <OperationLog operationId={operationId} />
      </DialogContent>
    </Dialog>
  );
}

function matchesOperation(operation: OperationRecord, status: string, query: string) {
  if (status !== "all" && reviewStatus(operation) !== status) return false;
  const keyword = query.trim().toLowerCase();
  return !keyword || [operation.id, operation.adviceId, operation.title, operation.operatorNote, operation.feedback?.evaluation]
    .some((value) => value?.toLowerCase().includes(keyword));
}

export function OperationLog({ operationId }: { operationId?: string }) {
  const [records, setRecords] = useState<OperationRecord[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(operationId ?? null);
  const initializedRef = useRef(Boolean(operationId));
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;

    async function refresh() {
      if (disposed || document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await fetchOperations(controller.signal);
        if (controller.signal.aborted || disposed) return;
        setRecords(next);
        if (!initializedRef.current) {
          setSelectedId(next[0]?.id ?? null);
          initializedRef.current = true;
        }
        setLoadError("");
      } catch {
        if (!controller.signal.aborted && !disposed) setLoadError("读取操作记录失败，正在重试。");
      } finally {
        if (!disposed && !document.hidden) {
          timer = window.setTimeout(() => { void refresh(); }, 3000);
        }
      }
    }

    const onVisibility = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (document.hidden) controller?.abort();
      else void refresh();
    };

    void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const hasFilter = filter !== "all" || Boolean(query.trim());
  const visibleRecords = records?.filter((operation) => matchesOperation(operation, filter, query)) ?? [];
  const selected = hasFilter
    ? visibleRecords.find((operation) => operation.id === selectedId) ?? visibleRecords[0]
    : visibleRecords.find((operation) => operation.id === selectedId) ?? (operationId ? undefined : visibleRecords[0]);
  const hasRecords = Boolean(records && records.length > 0);
  const emptyTitle = records === null
    ? "正在加载操作记录…"
    : !hasRecords
      ? "暂无操作记录"
      : operationId && !hasFilter && selectedId === operationId
        ? "找不到关联操作记录"
        : "没有符合条件的操作记录";
  const emptyHint = records === null
    ? ""
    : !hasRecords
      ? "在生化池确认执行曝气调节建议后，记录与自动复评结果将显示在这里。"
      : operationId && !hasFilter && selectedId === operationId
        ? "请在左侧列表选择其他操作记录。"
        : "可调整搜索关键词或复评状态后重试。";

  function handleFilters(nextStatus: string, nextQuery: string) {
    setFilter(nextStatus);
    setQuery(nextQuery);
    setSelectedId((current) => {
      const matches = records?.filter((operation) => matchesOperation(operation, nextStatus, nextQuery)) ?? [];
      return matches.find(({ id }) => id === current)?.id ?? matches[0]?.id ?? null;
    });
  }

  function handleSaved(saved: OperationRecord) {
    setRecords((current) => current?.map((operation) => operation.id === saved.id ? saved : operation) ?? [saved]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {loadError && <p role="status" className="shrink-0 border-b bg-warning/10 px-5 py-2 text-sm text-warning">{loadError}</p>}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-[16rem_minmax(0,1fr)] md:grid-rows-1 md:overflow-hidden">
        <section aria-label="记录列表" className="flex min-h-0 shrink-0 flex-col border-b bg-muted md:border-r md:border-b-0">
          <div className="shrink-0 space-y-2 p-3">
            <Label htmlFor="operation-search" className="sr-only">搜索操作记录</Label>
            <Input
              id="operation-search"
              type="search"
              className="bg-card"
              placeholder="搜索编号、建议或备注"
              value={query}
              onChange={(event) => handleFilters(filter, event.target.value)}
            />
            <Label htmlFor="operation-filter" className="sr-only">复评状态</Label>
            <Select value={filter} onValueChange={(status) => handleFilters(status, query)}>
              <SelectTrigger id="operation-filter" className="bg-card"><SelectValue /></SelectTrigger>
              <SelectContent position="item-aligned">
                <SelectItem value="all">全部记录</SelectItem>
                {Object.entries(REVIEW_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {visibleRecords.length > 0 && (
            <ul className="max-h-44 min-h-0 space-y-1.5 overflow-y-auto px-3 pb-3 md:max-h-none">
              {visibleRecords.map((operation) => (
                <li key={operation.id}>
                  <Button
                    variant="outline"
                    className="h-auto w-full flex-col items-start gap-1.5 whitespace-normal bg-card p-2.5 text-left aria-pressed:border-primary/40 aria-pressed:bg-primary/10"
                    aria-pressed={selected?.id === operation.id}
                    onClick={() => setSelectedId(operation.id)}
                  >
                    <span className="flex w-full items-center justify-between gap-1 text-xs text-muted-foreground">
                      {operation.adviceId}
                      <ReviewBadge operation={operation} />
                    </span>
                    <span className="text-sm leading-snug">{operation.title}</span>
                    <time className="text-xs font-normal tabular-nums text-muted-foreground" dateTime={operation.executeTime}>
                      {formatDateTime(operation.executeTime)}
                    </time>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="记录详情" className="flex min-w-0 flex-1 flex-col md:min-h-0 md:overflow-y-auto">
          {selected ? (
            <div key={selected.id} className="advice-enter">
              <OperationDetail operation={selected} onSaved={handleSaved} />
            </div>
          ) : (
            <div role="status" className="flex min-h-40 flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
              {records !== null && (
                <span className="grid size-12 place-items-center rounded-xl border bg-muted text-muted-foreground">
                  {hasRecords ? <SearchX aria-hidden className="size-6" /> : <Inbox aria-hidden className="size-6" />}
                </span>
              )}
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
                {emptyHint && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{emptyHint}</p>}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
