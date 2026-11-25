import { useEffect, useId, useRef, useState } from "react";
import type { DateRange } from "@daypicker/react";
import { History, Inbox, RefreshCw, RotateCcw, SearchX, X } from "lucide-react";
import { AdviceHistoryDetail, StatusBadge, TimeStamp } from "@/components/advice-history/AdviceHistoryDetail";
import { HistoryDateFilter } from "@/components/advice-history/HistoryDateFilter";
import { STATUS_LABELS, type AdviceHistoryRecord } from "@/components/advice-history/types";
import { ExplainText } from "@/components/Term";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { requestJson } from "@/lib/api";
import { formatCalendarDay } from "@/lib/time";
import { cn } from "@/lib/utils";

export function AdviceHistoryLog() {
  const fieldId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<AdviceHistoryRecord[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange>();
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    requestJson<{ advices: AdviceHistoryRecord[] }>("/api/advice/history", { signal: controller.signal })
      .then(({ advices }) => {
        if (!Array.isArray(advices)) throw new Error("历史建议格式无效");
        if (!controller.signal.aborted) setRecords(advices);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("无法读取历史建议，请重试。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);

  const keyword = query.trim().toLowerCase();
  const start = dateRange?.from ? formatCalendarDay(dateRange.from) : "";
  const end = dateRange?.to ? formatCalendarDay(dateRange.to) : "";
  const matches = records?.filter((record) => {
    if (status !== "all" && record.status !== status) return false;
    if (start || end) {
      const timestamp = record.createdAt ?? record.endedAt;
      if (!timestamp) return false;
      const day = formatCalendarDay(timestamp);
      if ((start && day < start) || (end && day > end)) return false;
    }
    return !keyword || [record.id, record.title, record.knowledgeRef, record.operationId, record.supersededBy]
      .some((value) => value?.toLowerCase().includes(keyword));
  }) ?? [];
  const selected = matches.find((record) => record.id === selectedId) ?? matches[0];
  const empty = records
    ? records.length ? "没有符合条件的建议" : "暂无历史建议"
    : loading ? "正在读取历史建议…" : error;

  function triggerRefresh() {
    if (!loading) setRefresh((current) => current + 1);
  }

  function resetFilters() {
    setQuery("");
    setStatus("all");
    setDateRange(undefined);
    setSelectedId("");
    triggerRefresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-[17rem_minmax(0,1fr)] md:grid-rows-1 md:overflow-hidden">
      <section aria-label="历史建议列表" className="flex min-h-0 min-w-0 shrink-0 flex-col border-b bg-muted md:border-r md:border-b-0">
        <div className="shrink-0 space-y-2.5 p-3">
          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Label htmlFor={`${fieldId}-search`} className="sr-only">搜索历史建议</Label>
              <Input
                ref={searchInput} id={`${fieldId}-search`} className={cn("bg-card", query && "pr-9")}
                type="search" placeholder="搜索编号或标题" value={query} onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <Button
                  type="button" variant="ghost" size="icon" aria-label="清空搜索" title="清空搜索"
                  className="absolute inset-y-0 right-1 my-auto size-7 text-muted-foreground"
                  onClick={() => {
                    setQuery("");
                    searchInput.current?.focus();
                  }}
                >
                  <X aria-hidden />
                </Button>
              )}
            </div>
            <Button
              type="button" variant="outline" size="icon" className="size-9 shrink-0" aria-label="刷新列表" title="刷新列表"
              disabled={loading} onClick={triggerRefresh}
            >
              <RefreshCw aria-hidden className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
            <Button
              type="button" variant="outline" size="icon" className="size-9 shrink-0" aria-label="重置筛选" title="重置筛选"
              onClick={resetFilters}
            >
              <RotateCcw aria-hidden className="size-3.5" />
            </Button>
          </div>
          <Label htmlFor={`${fieldId}-status`} className="sr-only">处理状态</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id={`${fieldId}-status`} className="bg-card"><SelectValue /></SelectTrigger>
            <SelectContent position="item-aligned">
              <SelectItem value="all">全部状态</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <HistoryDateFilter id={`${fieldId}-date`} range={dateRange} onChange={setDateRange} />
        </div>
        {error && records && <p role="status" className="px-3 pb-3 text-xs text-warning">{error}</p>}
        {matches.length > 0 && (
          <ul className="max-h-48 min-h-0 space-y-1.5 overflow-y-auto px-3 pb-3 md:max-h-none">
            {matches.map((record) => (
              <li key={record.id}>
                <Button
                  type="button" variant="outline" aria-pressed={selected?.id === record.id}
                  className="h-auto w-full min-w-0 flex-col items-start gap-1 whitespace-normal bg-card p-2.5 text-left aria-pressed:border-primary/40 aria-pressed:bg-primary/10"
                  onClick={() => setSelectedId(record.id)}
                >
                  <span className="flex w-full flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
                    {record.id} <StatusBadge status={record.status} />
                  </span>
                  <span className="text-sm leading-snug break-words"><ExplainText text={record.title} insideButton /></span>
                  <span className="text-xs font-normal text-muted-foreground"><TimeStamp value={record.createdAt ?? record.endedAt} /></span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="建议详情" className="flex min-w-0 flex-1 flex-col md:min-h-0 md:overflow-y-auto">
        {selected ? <AdviceHistoryDetail key={selected.id} record={selected} /> : (
          <div role="status" className="flex min-h-40 flex-1 flex-col items-center justify-center gap-3 px-5 py-6 text-center">
            {records && (
              <span className="grid size-12 place-items-center rounded-xl border bg-muted text-muted-foreground">
                {records.length ? <SearchX aria-hidden className="size-6" /> : <Inbox aria-hidden className="size-6" />}
              </span>
            )}
            <p className={cn("text-sm text-muted-foreground", !records && !loading && "text-warning")}>{empty}</p>
          </div>
        )}
      </section>
    </div>
  );
}

export function AdviceHistoryButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="w-27 shrink-0 text-xs text-muted-foreground">
          <History aria-hidden /> 历史建议
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[44rem] max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle>历史建议</DialogTitle>
          <DialogDescription>按日期、处理结果或关键词查找建议，选择一条记录查看详情。</DialogDescription>
        </DialogHeader>
        <AdviceHistoryLog />
      </DialogContent>
    </Dialog>
  );
}
