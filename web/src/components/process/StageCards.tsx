import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TrendChart } from "@/components/TrendChart";
import type { HistoryPoint } from "@/lib/types";
import { STATUS_LABEL, type Stage, type Status } from "@/components/process/stages";

export function StageStatus({ status }: { status: Status }) {
  return (
    <Badge variant="outline" data-status={status} className="stage-status gap-1.5 px-2 py-0.5 text-[11px]">
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function StageDetails({ stage, history, children }: { stage: Stage; history: HistoryPoint[]; children: ReactNode }) {
  const { title, icon: Icon, metrics, status = "normal", trend } = stage;
  const [label, value, unit] = metrics[0];
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto bg-card sm:max-w-[42rem]">
        <DialogHeader className="pr-6 text-left">
          <DialogTitle className="flex items-center gap-2"><Icon aria-hidden className="size-5 text-primary" /> {title}</DialogTitle>
          <DialogDescription>{stage.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <StageStatus status={status} />
          {stage.note && <p className="text-sm text-muted-foreground">{stage.note}</p>}
        </div>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {metrics.map(([metric, reading, suffix]) => (
            <div key={metric} className="rounded-lg border bg-muted p-3">
              <dt className="text-xs text-muted-foreground">{metric}</dt>
              <dd className="mt-1 font-semibold tabular-nums">{reading}{suffix && <span className="ml-1 text-xs font-normal text-muted-foreground">{suffix}</span>}</dd>
            </div>
          ))}
        </dl>
        {trend && (
          <TrendChart
            title={label}
            unit={unit ?? ""}
            current={value}
            color={trend.color}
            reference={trend.reference}
            secondary={trend.secondary ? {
              points: history.map((sample) => sample[trend.secondary!.key] ?? null),
              label: trend.secondary.label,
              color: trend.secondary.color,
            } : undefined}
            points={history.map((sample) => sample[trend.key] ?? null)}
            clockMinutes={history.map((sample) => sample.clockMinutes)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StageCard({ stage, history }: { stage: Stage; history: HistoryPoint[] }) {
  const { title, icon: Icon, metrics, status = "normal" } = stage;
  const [label, value, unit] = metrics[0];

  return (
    <article
      className="stage-card stage-enter relative flex min-w-0 flex-col gap-2.5 rounded-xl border p-3.5 sm:p-4"
      data-status={status}
    >
      <header className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary"><Icon aria-hidden className="size-3.5" /></span>
          <h4 className="text-sm font-semibold leading-snug">{title}</h4>
        </div>
        <StageStatus status={status} />
      </header>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
          <span className="text-lg font-semibold tracking-tight tabular-nums xl:text-xl">{value}</span>
          {unit && <span className="text-[11px] text-muted-foreground">{unit}</span>}
        </p>
      </div>
      <dl className="flex-1 space-y-1.5 border-t pt-2.5">
        {metrics.slice(1, 4).map(([metric, reading, suffix]) => (
          <div key={metric} className="flex flex-wrap items-baseline justify-between gap-x-1 text-xs">
            <dt className="text-muted-foreground">{metric}</dt>
            <dd className="font-medium tabular-nums">{reading}{suffix && <span className="ml-1 text-[10px] text-muted-foreground">{suffix}</span>}</dd>
          </div>
        ))}
      </dl>
      <footer aria-hidden className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
        <span className="stage-open ml-auto flex items-center gap-1 text-primary">详情 <ArrowUpRight className="size-3.5" /></span>
      </footer>
      <StageDetails stage={stage} history={history}>
        <Button
          type="button" variant="ghost"
          aria-label={`查看${title}详情`}
          className="absolute inset-0 z-10 h-full w-full rounded-xl p-0 hover:bg-transparent"
        />
      </StageDetails>
    </article>
  );
}
