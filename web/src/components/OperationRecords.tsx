import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, ClipboardList, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fetchOperations, formatTick, saveOperationFeedback, type OperationRecord } from "@/lib/api";
import { cn } from "@/lib/utils";

const REVIEW_LABELS = {
  pending: "待复评",
  reviewed: "已复评",
  interrupted: "复评中断",
} as const;

const METRICS = [
  { key: "doSetpoint", label: "DO 目标值", unit: "mg/L", digits: 1 },
  { key: "do", label: "好氧区 DO（仿真真值）", unit: "mg/L", digits: 2 },
  { key: "airflow", label: "曝气风量", unit: "m³/h", digits: 0 },
  { key: "effNh4", label: "出水氨氮", unit: "mg/L", digits: 2 },
  { key: "power", label: "风机功率", unit: "kW", digits: 1 },
] as const;

const dateTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium" });

function reviewStatus(operation: OperationRecord) {
  if (operation.after) return "reviewed";
  return operation.reviewInterrupted ? "interrupted" : "pending";
}

function ReviewBadge({ operation }: { operation: OperationRecord }) {
  const status = reviewStatus(operation);
  return (
    <Badge variant="secondary" className={cn(
      status === "reviewed" && "bg-emerald-50 text-emerald-800",
      status === "pending" && "bg-amber-50 text-amber-800",
    )}>
      {REVIEW_LABELS[status]}
    </Badge>
  );
}

export function OperationRecords() {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<OperationRecord[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>();
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let loading = false;

    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const next = await fetchOperations(controller.signal);
        if (controller.signal.aborted) return;
        setRecords(next);
        setSelectedId((current) => current === undefined ? next[0]?.id : current);
        setLoadError("");
      } catch {
        if (!controller.signal.aborted) setLoadError("读取操作记录失败，正在重试。");
      } finally {
        loading = false;
      }
    }

    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [open, refreshKey]);

  const visibleRecords = records?.filter((operation) => filter === "all" || reviewStatus(operation) === filter) ?? [];
  const selected = records?.find((operation) => operation.id === selectedId) ?? visibleRecords[0];

  function handleFilter(next: string) {
    setFilter(next);
    setSelectedId(records?.find((operation) => next === "all" || reviewStatus(operation) === next)?.id ?? null);
  }

  function handleSaved(saved: OperationRecord) {
    setRecords((current) => current?.map((operation) => operation.id === saved.id ? saved : operation) ?? [saved]);
    setRefreshKey((key) => key + 1);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="w-27 shrink-0 text-xs text-muted-foreground">
          <ClipboardList aria-hidden /> 操作记录
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle>操作记录</DialogTitle>
          <DialogDescription>查看已执行建议的调节依据、复评结果和人工反馈。</DialogDescription>
        </DialogHeader>
        {loadError && <p role="status" className="border-b bg-amber-50 px-5 py-2 text-sm text-amber-800">{loadError}</p>}
        {records === null || records.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">
            {records === null ? "正在加载操作记录…" : "执行曝气调节建议后，记录将显示在这里。"}
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[16rem_minmax(0,1fr)] md:overflow-hidden">
            <section aria-label="记录列表" className="flex flex-col border-b bg-slate-50 md:min-h-0 md:border-r md:border-b-0">
              <div className="p-3">
                <Label htmlFor="operation-filter" className="sr-only">复评状态</Label>
                <Select value={filter} onValueChange={handleFilter}>
                  <SelectTrigger id="operation-filter" className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent position="item-aligned">
                    <SelectItem value="all">全部记录</SelectItem>
                    {Object.entries(REVIEW_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <ul className="max-h-44 space-y-1.5 overflow-y-auto px-3 pb-3 md:max-h-none">
                {visibleRecords.length === 0 && <li className="p-2 text-sm text-muted-foreground">没有符合条件的记录</li>}
                {visibleRecords.map((operation) => (
                  <li key={operation.id}>
                    <Button
                      variant="outline"
                      className="h-auto w-full flex-col items-start gap-1.5 whitespace-normal bg-white p-2.5 text-left aria-pressed:border-primary/40 aria-pressed:bg-blue-50"
                      aria-pressed={selected?.id === operation.id}
                      onClick={() => setSelectedId(operation.id)}
                    >
                      <span className="flex w-full items-center justify-between gap-1 text-xs text-muted-foreground">
                        {operation.adviceId}
                        <ReviewBadge operation={operation} />
                      </span>
                      <span className="text-sm leading-snug">{operation.title}</span>
                      <time className="text-xs font-normal tabular-nums text-muted-foreground" dateTime={operation.executeTime}>
                        {dateTime.format(new Date(operation.executeTime))}
                      </time>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
            {selected && (
              <div className="min-h-0 md:overflow-y-auto">
                <OperationDetail key={selected.id} operation={selected} onSaved={handleSaved} />
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OperationDetail({ operation, onSaved }: { operation: OperationRecord; onSaved: (record: OperationRecord) => void }) {
  const { before, during, after } = operation;
  const { doRange, responseMinutes, nh4Trend, energyDeltaPct } = during.forecast;
  return (
    <article className="space-y-5 p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{operation.id} · 执行于 {formatTick(before.tick)}</p>
          <h3 className="font-semibold">{operation.title}</h3>
        </div>
        <ReviewBadge operation={operation} />
      </header>

      <section className="space-y-2 rounded-lg border bg-slate-50 p-3">
        <h4 className="text-sm font-semibold">执行动作与依据</h4>
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-primary">
          DO 目标值 {during.from.toFixed(1)} <ArrowRight className="size-4" aria-label="调整为" /> {during.to.toFixed(1)} mg/L
        </p>
        <ul className="space-y-1 text-sm leading-relaxed text-muted-foreground">
          {during.reasons.map(({ label, value }) => <li key={label}><span className="mr-2 font-medium text-foreground">{label}</span>{value}</li>)}
        </ul>
        <dl className="space-y-1 border-t pt-2 text-sm leading-relaxed">
          {doRange && <div><dt className="mr-2 inline font-medium">预计 DO</dt><dd className="inline">{doRange}{responseMinutes && `（${responseMinutes}）`}</dd></div>}
          {nh4Trend && <div><dt className="mr-2 inline font-medium">预计氨氮趋势</dt><dd className="inline">{nh4Trend}</dd></div>}
          {energyDeltaPct && <div><dt className="mr-2 inline font-medium">预计能耗变化</dt><dd className="inline">{energyDeltaPct}</dd></div>}
        </dl>
      </section>

      <section aria-labelledby="comparison-heading" className="space-y-2">
        <h4 id="comparison-heading" className="text-sm font-semibold">执行前后对比</h4>
        <p className="text-xs text-muted-foreground">
          {after ? `复评采样于 ${formatTick(after.tick)}，执行后 ${after.tick - before.tick} 仿真分钟。`
            : operation.reviewInterrupted
              ? `复评前${operation.reviewInterrupted === "reset" ? "仿真已复位" : "服务已重启"}，缺少执行后快照。`
              : `预计执行后 ${operation.reviewDueTick - before.tick} 仿真分钟自动复评。`}
        </p>
        <div className="rounded-lg border">
          <Table aria-labelledby="comparison-heading" className="text-xs tabular-nums sm:text-sm">
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead scope="col" className="h-9 px-2">指标</TableHead>
                <TableHead scope="col" className="h-9 px-2 text-right">执行前</TableHead>
                <TableHead scope="col" className="h-9 px-2 text-right">复评时</TableHead>
                <TableHead scope="col" className="h-9 px-2 text-right">变化</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {METRICS.map(({ key, label, unit, digits }) => {
                const delta = after ? Number((after[key] - before[key]).toFixed(digits)) : null;
                return (
                  <TableRow key={key}>
                    <th scope="row" className="px-2 py-2 text-left font-medium">
                      {label}<span className="ml-1 text-muted-foreground">{unit}</span>
                    </th>
                    <TableCell className="px-2 py-2 text-right">{before[key].toFixed(digits)}</TableCell>
                    <TableCell className="px-2 py-2 text-right">{after?.[key].toFixed(digits) ?? "—"}</TableCell>
                    <TableCell className="px-2 py-2 text-right">{delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(digits)}`}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <FeedbackForm operation={operation} onSaved={onSaved} />
    </article>
  );
}

function FeedbackForm({ operation, onSaved }: { operation: OperationRecord; onSaved: (record: OperationRecord) => void }) {
  const [note, setNote] = useState(operation.operatorNote ?? "");
  const [evaluation, setEvaluation] = useState(operation.feedback?.evaluation ?? "");
  const [effectiveness, setEffectiveness] = useState(String(operation.feedback?.effective ?? "unknown"));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const saved = await saveOperationFeedback(operation.id, {
        operatorNote: note,
        evaluation,
        effective: effectiveness === "unknown" ? null : effectiveness === "true",
      });
      setNote(saved.operatorNote);
      setEvaluation(saved.feedback?.evaluation ?? "");
      onSaved(saved);
      setMessage("已保存人工反馈");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form aria-labelledby="feedback-heading" className="space-y-3 border-t pt-4" onSubmit={handleSubmit} onChange={() => setMessage("")}>
      <h4 id="feedback-heading" className="text-sm font-semibold">人工反馈</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="operation-note">人工备注</Label>
          <Textarea id="operation-note" rows={3} maxLength={1000} disabled={saving} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="operation-evaluation">实际效果评价</Label>
          <Textarea id="operation-evaluation" rows={3} maxLength={1000} disabled={saving} value={evaluation} onChange={(event) => setEvaluation(event.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32 space-y-1.5">
          <Label htmlFor="operation-effective">建议有效性</Label>
          <Select value={effectiveness} disabled={saving} onValueChange={(value) => { setEffectiveness(value); setMessage(""); }}>
            <SelectTrigger id="operation-effective"><SelectValue /></SelectTrigger>
            <SelectContent position="item-aligned">
              <SelectItem value="unknown">未判断</SelectItem>
              <SelectItem value="true">有效</SelectItem>
              <SelectItem value="false">无效</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" className="w-28" disabled={saving}><Save aria-hidden />{saving ? "保存中…" : "保存反馈"}</Button>
        {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
