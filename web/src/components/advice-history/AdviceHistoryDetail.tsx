import { ArrowRight } from "lucide-react";
import { KnowledgeReference } from "@/components/KnowledgeReference";
import { OperationRecords } from "@/components/OperationRecords";
import { ExplainText } from "@/components/Term";
import { Badge } from "@/components/ui/badge";
import {
  ADVICE_TYPES, END_REASONS, PRIORITY_LABELS, STATUS_LABELS,
  type AdviceHistoryRecord, type HistoryStatus,
} from "@/components/advice-history/types";
import { DO_ADJUSTMENT } from "@/lib/advice";
import { formatClock, formatDateTime, formatTick } from "@/lib/time";
import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: HistoryStatus }) {
  return (
    <Badge variant="secondary" className={cn(
      status === "executed" && "bg-success/10 text-success",
      (status === "invalidated" || status === "interrupted") && "bg-warning/10 text-warning",
    )}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function TimeStamp({ value }: { value?: string | null }) {
  return value ? <time dateTime={value} className="tabular-nums">{formatDateTime(value)}</time> : <>—</>;
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

export function AdviceHistoryDetail({ record }: { record: AdviceHistoryRecord }) {
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
