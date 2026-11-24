import { lazy, Suspense, useEffect, useId, useRef, useState, type ComponentProps } from "react";
import type { DateRange } from "@daypicker/react";
import { ArrowRight, CalendarDays, History, Inbox, RotateCcw, SearchX, X } from "lucide-react";
import { KnowledgeReference } from "@/components/KnowledgeReference";
import { OperationRecords } from "@/components/OperationRecords";
import { ExplainText } from "@/components/Term";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DO_ADJUSTMENT } from "@/lib/advice";
import { formatClock, formatTick, requestJson } from "@/lib/api";
import { cn } from "@/lib/utils";

const historyTimeZone = "Asia/Shanghai";
const HistoryCalendar = lazy(async () => {
  const [{ Calendar }, { zhCN }] = await Promise.all([
    import("@/components/ui/calendar"),
    import("@daypicker/react/locale/zh-CN"),
  ]);
  return {
    default: (props: ComponentProps<typeof Calendar>) => (
      <Calendar {...props} locale={zhCN} timeZone={historyTimeZone} />
    ),
  };
});

const STATUS_LABELS = {
  executed: "已执行",
  ignored: "主动忽略",
  expired: "到期未处理",
  invalidated: "已失效",
  interrupted: "已中断",
  superseded: "已升级",
} as const;

const END_REASONS: Record<string, string> = {
  conditions: "工况或测量数据质量发生变化",
  limits: "规则参数已更新",
  reset: "仿真已复位",
  restart: "服务已重启",
  upgraded: "同一工艺问题已生成更高优先级的建议",
};

const ADVICE_TYPES: Record<string, string> = {
  adjust: "调节建议",
  inspect: "排查建议",
  observe: "观察提示",
};

const PRIORITY_LABELS: Record<string, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};

type HistoryStatus = keyof typeof STATUS_LABELS;

interface AdviceHistoryRecord {
  id: string;
  title: string;
  status: HistoryStatus;
  type: string;
  priority?: string | null;
  createdAt?: string | null;
  endedAt?: string | null;
  createdTick?: number | null;
  endedTick?: number | null;
  createdClockMinutes?: number | null;
  endedClockMinutes?: number | null;
  endReason?: string | null;
  invalidatedBy?: string | null;
  supersededBy?: string | null;
  action?: { from: number; to: number } | null;
  reasons?: { label: string; value: string }[];
  constraints?: string[];
  risks?: string[];
  forecast?: {
    note?: string;
    doRange?: string;
    responseMinutes?: string;
    nh4Trend?: string;
    energyDeltaPct?: string;
  };
  knowledgeRef?: string | null;
  operationId?: string | null;
}

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: historyTimeZone,
  dateStyle: "short",
  timeStyle: "medium",
});
const calendarDay = new Intl.DateTimeFormat("sv-SE", {
  timeZone: historyTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function HistoryDateFilter({ id, range, onChange }: {
  id: string;
  range: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>();
  const trigger = useRef<HTMLButtonElement>(null);
  const from = range?.from ? calendarDay.format(range.from) : "";
  const to = range?.to ? calendarDay.format(range.to) : "";
  const summary = from && to && from !== to ? `${from} 至 ${to}` : from;

  function applyRange(next: DateRange | undefined) {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="block text-xs">日期范围</Label>
      <Popover open={open} onOpenChange={(nextOpen) => {
        if (nextOpen) setDraft(range);
        setOpen(nextOpen);
      }}>
        <PopoverTrigger asChild>
          <Button ref={trigger} id={id} type="button" variant="outline" className="w-full justify-start gap-2 bg-card px-2.5 text-left text-xs font-normal tabular-nums">
            <CalendarDays aria-hidden className="text-muted-foreground" />
            <span className={cn(!summary && "text-muted-foreground")}>{summary || "全部日期"}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} collisionPadding={8} aria-label="选择日期范围"
          className="w-auto max-h-(--radix-popover-content-available-height) overflow-y-auto rounded-lg p-3">
          <Suspense fallback={<p role="status" className="grid h-64 w-63 place-items-center text-sm text-muted-foreground">正在加载日历…</p>}>
            <HistoryCalendar
              className="[--cell-size:--spacing(9)]"
              mode="range"
              resetOnSelect
              defaultMonth={range?.from}
              selected={draft}
              onSelect={setDraft}
            />
          </Suspense>
          <div className="mt-2 flex justify-between gap-2 border-t pt-2">
            <Button type="button" size="sm" variant="ghost" disabled={!range && !draft?.from} onClick={() => applyRange(undefined)}>清除日期</Button>
            <Button type="button" size="sm" disabled={!draft?.from} onClick={() => {
              if (draft?.from) applyRange({ from: draft.from, to: draft.to ?? draft.from });
            }}>应用筛选</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function StatusBadge({ status }: { status: HistoryStatus }) {
  return (
    <Badge variant="secondary" className={cn(
      status === "executed" && "bg-success/10 text-success",
      (status === "invalidated" || status === "interrupted") && "bg-warning/10 text-warning",
    )}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function TimeStamp({ value }: { value?: string | null }) {
  return value ? <time dateTime={value} className="tabular-nums">{dateTime.format(new Date(value))}</time> : <>—</>;
}

function TimelineItem({ label, timestamp, tick, clockMinutes }: {
  label: string;
  timestamp?: string | null;
  tick?: number | null;
  clockMinutes?: number | null;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm"><TimeStamp value={timestamp} /></dd>
      {(tick != null || clockMinutes != null) && (
        <dd className="text-xs text-muted-foreground tabular-nums">
          {clockMinutes != null && `仿真 ${formatClock(clockMinutes)}`}
          {clockMinutes != null && tick != null && " · "}
          {tick != null && formatTick(tick)}
        </dd>
      )}
    </div>
  );
}

function AdviceHistoryDetail({ record }: { record: AdviceHistoryRecord }) {
  const { action, forecast, reasons, constraints, risks, endReason, invalidatedBy } = record;
  const forecastRows = [
    { label: "预计 DO", value: forecast?.doRange },
    { label: "响应时间", value: forecast?.responseMinutes },
    { label: "氨氮趋势", value: forecast?.nh4Trend },
    { label: "电耗变化", value: forecast?.energyDeltaPct },
    { label: "说明", value: forecast?.note },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));
  const endExplanation = END_REASONS[endReason ?? invalidatedBy ?? ""];

  return (
    <article className="advice-enter min-w-0 space-y-4 p-4 sm:p-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{record.id}</span>
          <StatusBadge status={record.status} />
          <span className="text-xs text-muted-foreground">{ADVICE_TYPES[record.type]}</span>
          {record.priority && <span className="text-xs text-muted-foreground">{PRIORITY_LABELS[record.priority]}</span>}
        </div>
        <h3 className="text-lg font-semibold break-words"><ExplainText text={record.title} /></h3>
        {endExplanation && (
          <p className="text-sm text-muted-foreground">
            {endExplanation}。{record.supersededBy && `后续建议为 ${record.supersededBy}。`}
          </p>
        )}
      </header>

      <dl className="grid gap-3 rounded-lg border bg-muted/60 p-3 sm:grid-cols-2">
        <TimelineItem label="生成时间" timestamp={record.createdAt} tick={record.createdTick} clockMinutes={record.createdClockMinutes} />
        <TimelineItem label="结束时间" timestamp={record.endedAt} tick={record.endedTick} clockMinutes={record.endedClockMinutes} />
      </dl>

      {action && (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">建议调节</h4>
          <p className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/60 px-3 py-2 text-sm">
            <span><ExplainText text={`${DO_ADJUSTMENT.stageName}${DO_ADJUSTMENT.label}`} /></span>
            <span className="inline-flex items-center gap-2 whitespace-nowrap font-semibold tabular-nums">
              {action.from.toFixed(1)} <ArrowRight className="size-4" aria-label="调至" /> {action.to.toFixed(1)} mg/L
            </span>
          </p>
        </section>
      )}

      {!!reasons?.length && (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">判断依据</h4>
          <ul className="space-y-1.5 text-sm leading-relaxed">
            {reasons.map(({ label, value }, index) => (
              <li key={index} className="rounded bg-muted/60 px-2.5 py-1.5">
                <span className="mr-2 font-semibold"><ExplainText text={label} /></span><ExplainText text={value} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {forecastRows.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">预计效果</h4>
          <dl className="space-y-1 text-sm leading-relaxed">
            {forecastRows.map(({ label, value }) => (
              <div key={label}>
                <dt className="mr-2 inline font-medium"><ExplainText text={label} /></dt>
                <dd className="inline text-muted-foreground"><ExplainText text={value} /></dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {!!constraints?.length && (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">约束检查</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
            {constraints.map((constraint, index) => <li key={index}><ExplainText text={constraint} /></li>)}
          </ul>
        </section>
      )}

      {!!risks?.length && (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">风险提示</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-warning">
            {risks.map((risk, index) => <li key={index}><ExplainText text={risk} /></li>)}
          </ul>
        </section>
      )}

      {(record.knowledgeRef || record.operationId) && (
        <footer className="flex flex-wrap items-center gap-2 border-t pt-3">
          {record.knowledgeRef && <KnowledgeReference id={record.knowledgeRef} />}
          {record.operationId && <OperationRecords operationId={record.operationId} />}
        </footer>
      )}
    </article>
  );
}

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
  const start = dateRange?.from ? calendarDay.format(dateRange.from) : "";
  const end = dateRange?.to ? calendarDay.format(dateRange.to) : "";
  const matches = records?.filter((record) => {
    if (status !== "all" && record.status !== status) return false;
    if (start || end) {
      const timestamp = record.createdAt ?? record.endedAt;
      if (!timestamp) return false;
      const day = calendarDay.format(new Date(timestamp));
      if ((start && day < start) || (end && day > end)) return false;
    }
    return !keyword || [record.id, record.title, record.knowledgeRef, record.operationId, record.supersededBy]
      .some((value) => value?.toLowerCase().includes(keyword));
  }) ?? [];
  const selected = matches.find((record) => record.id === selectedId) ?? matches[0];
  const empty = records
    ? records.length ? "没有符合条件的建议" : "暂无历史建议"
    : loading ? "正在读取历史建议…" : error;

  function resetFilters() {
    setQuery("");
    setStatus("all");
    setDateRange(undefined);
    setSelectedId("");
    if (!loading) setRefresh((current) => current + 1);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-[17rem_minmax(0,1fr)] md:grid-rows-1 md:overflow-hidden">
      <section aria-label="历史建议列表" className="flex min-h-0 min-w-0 shrink-0 flex-col border-b bg-muted md:border-r md:border-b-0">
        <div className="shrink-0 space-y-2.5 p-3">
          <div className="flex items-center gap-2">
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
              type="button" variant="outline" className="shrink-0 gap-1.5 px-2.5 text-xs" aria-label="重置筛选"
              onClick={resetFilters}
            >
              <RotateCcw aria-hidden /> 重置
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
