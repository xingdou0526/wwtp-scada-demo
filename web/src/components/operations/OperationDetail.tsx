import { ArrowRight } from "lucide-react";
import { KnowledgeReference } from "@/components/KnowledgeReference";
import { FeedbackForm } from "@/components/operations/FeedbackForm";
import { ExplainText } from "@/components/Term";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { OperationRecord } from "@/lib/api";
import { formatTick } from "@/lib/time";
import { cn } from "@/lib/utils";

export const REVIEW_LABELS = {
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

export function reviewStatus(operation: OperationRecord) {
  if (operation.after) return "reviewed";
  return operation.reviewInterrupted ? "interrupted" : "pending";
}

export function ReviewBadge({ operation }: { operation: OperationRecord }) {
  const status = reviewStatus(operation);
  return (
    <Badge variant="secondary" className={cn(
      status === "reviewed" && "bg-success/10 text-success",
      status === "pending" && "bg-warning/10 text-warning",
    )}>
      {REVIEW_LABELS[status]}
    </Badge>
  );
}

export function OperationDetail({ operation, onSaved }: { operation: OperationRecord; onSaved: (record: OperationRecord) => void }) {
  const { before, during, after } = operation;
  const { doRange, responseMinutes, nh4Trend, energyDeltaPct } = during.forecast;

  return (
    <article className="space-y-5 p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{operation.id} · 执行于 {formatTick(before.tick)}</p>
          <h3 className="font-semibold"><ExplainText text={operation.title} /></h3>
        </div>
        <ReviewBadge operation={operation} />
      </header>

      <section className="space-y-2 rounded-lg border bg-muted p-3">
        <h4 className="text-sm font-semibold">执行动作与依据</h4>
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-primary">
          <ExplainText text="DO 目标值" /> {during.from.toFixed(1)} <ArrowRight className="size-4" aria-label="调整为" /> {during.to.toFixed(1)} mg/L
        </p>
        <ul className="space-y-1 text-sm leading-relaxed text-muted-foreground">
          {during.reasons.map(({ label, value }, index) => (
            <li key={`${label}-${index}`}>
              <span className="mr-2 font-medium text-foreground"><ExplainText text={label} /></span>
              <ExplainText text={value} />
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t pt-2 text-sm leading-relaxed">
          {doRange && <div><dt className="mr-2 inline font-medium"><ExplainText text="预计 DO" /></dt><dd className="inline"><ExplainText text={`${doRange}${responseMinutes ? `（${responseMinutes}）` : ""}`} /></dd></div>}
          {nh4Trend && <div><dt className="mr-2 inline font-medium"><ExplainText text="预计氨氮趋势" /></dt><dd className="inline"><ExplainText text={nh4Trend} /></dd></div>}
          {energyDeltaPct && <div><dt className="mr-2 inline font-medium"><ExplainText text="预计能耗变化" /></dt><dd className="inline"><ExplainText text={energyDeltaPct} /></dd></div>}
        </dl>
        {operation.knowledgeRef && <KnowledgeReference id={operation.knowledgeRef} />}
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
            <TableHeader className="bg-muted">
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
                      <ExplainText text={label} /><span className="ml-1 text-muted-foreground">{unit}</span>
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
