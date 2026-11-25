import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Eye,
  Gauge,
  Info,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { KnowledgeReference } from "@/components/KnowledgeReference";
import { ExplainText } from "@/components/Term";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DO_ADJUSTMENT, type ActiveAdvice, type DoAdjustmentAdvice } from "@/lib/advice";
import { postJson } from "@/lib/api";
import { cn } from "@/lib/utils";

export const TYPE_META: Record<ActiveAdvice["type"], { label: string; icon: LucideIcon; className: string }> = {
  adjust: { label: "调节建议", icon: Gauge, className: "text-critical" },
  inspect: { label: "排查建议", icon: Wrench, className: "text-warning" },
  observe: { label: "观察提示", icon: Eye, className: "text-primary" },
};

export const PRIORITY_META: Record<ActiveAdvice["priority"], { label: string; shortLabel: string; variant: "destructive" | "default" | "secondary" }> = {
  high: { label: "高优先级", shortLabel: "高", variant: "destructive" },
  medium: { label: "中优先级", shortLabel: "中", variant: "default" },
  low: { label: "低优先级", shortLabel: "低", variant: "secondary" },
};

export function adviceTone(advice: ActiveAdvice) {
  const isEnergySaving = advice.type === "adjust" && advice.action && advice.action.to < advice.action.from;
  if (isEnergySaving) {
    return {
      title: "text-success",
      type: "text-success",
      actionBox: "border-success/25 bg-success/5 text-success",
      accentBar: "bg-success",
    };
  }
  if (advice.type === "observe") {
    return {
      title: "text-primary",
      type: "text-primary",
      actionBox: "border-primary/25 bg-primary/5 text-primary",
      accentBar: "bg-primary",
    };
  }
  if (advice.type === "inspect" && advice.priority !== "high") {
    return {
      title: "text-warning",
      type: "text-warning",
      actionBox: "border-warning/25 bg-warning/5 text-warning",
      accentBar: "bg-warning",
    };
  }
  return {
    title: "text-critical",
    type: TYPE_META[advice.type].className,
    actionBox: "border-critical/25 bg-critical/5 text-critical",
    accentBar: advice.type === "inspect" ? "bg-warning" : "bg-critical",
  };
}

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="flex items-center gap-1 text-sm font-semibold text-muted-foreground">
        <Icon className="size-3.5" /> {title}
      </h4>
      {children}
    </section>
  );
}

export function AiAvatar() {
  return (
    <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/15 text-primary">
      <Bot className="size-4" />
    </span>
  );
}

export function AdviceCard({ advice, doAdjustment, onFocusAdjustment, onAction }: {
  advice: ActiveAdvice;
  doAdjustment: DoAdjustmentAdvice | null;
  onFocusAdjustment: () => void;
  onAction: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeMeta = TYPE_META[advice.type] ?? TYPE_META.observe;
  const TypeIcon = typeMeta.icon;
  const priority = PRIORITY_META[advice.priority] ?? PRIORITY_META.low;
  const tone = adviceTone(advice);
  const minutes = Math.floor(advice.remainingSeconds / 60);
  const seconds = advice.remainingSeconds % 60;
  const remaining = minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;

  async function handleIgnore() {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/advice/${encodeURIComponent(advice.id)}/ignore`);
      onAction();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="advice-enter flex gap-2">
      <AiAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl rounded-tl-sm border bg-card p-3 shadow-sm">
        <header className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className={cn("flex items-center gap-1 text-sm font-semibold", tone.type)}>
              <TypeIcon className="size-4" /> {typeMeta.label}
            </span>
            <Badge variant={priority.variant}>{priority.label}</Badge>
          </div>
          <h3 className={cn("text-lg font-bold leading-snug", tone.title)}>
            <ExplainText text={advice.title} />
          </h3>
          <p className="text-xs text-muted-foreground tabular-nums">{advice.id} · 现实时间剩余约 {remaining}</p>
        </header>

        {advice.action && (
          <div className={cn("flex flex-wrap items-baseline justify-center gap-x-2.5 gap-y-1.5 rounded-lg border px-2.5 py-3", tone.actionBox)}>
            <span className="text-sm font-semibold">DO 目标值</span>
            <div className="inline-flex items-baseline gap-2 whitespace-nowrap tabular-nums">
              <span className="text-3xl leading-none font-bold">{advice.action.from.toFixed(1)}</span>
              <ArrowRight aria-hidden className="size-4 shrink-0 self-center" />
              <span className="sr-only">调至</span>
              <strong className="text-3xl leading-none font-extrabold">{advice.action.to.toFixed(1)}</strong>
              <span className="text-sm">mg/L</span>
            </div>
          </div>
        )}
        {doAdjustment ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/60 px-3 py-2.5 text-sm leading-relaxed text-foreground">
            <p>
              请核对并确认将{DO_ADJUSTMENT.stageName}{DO_ADJUSTMENT.label}调至{" "}
              <strong className="whitespace-nowrap tabular-nums">{doAdjustment.to.toFixed(1)} mg/L</strong>。
            </p>
            <Button type="button" size="sm" className="w-full" onClick={onFocusAdjustment}>
              <SlidersHorizontal aria-hidden className="size-3.5" /> 前往{DO_ADJUSTMENT.stageName}核对并{DO_ADJUSTMENT.buttonLabel}
            </Button>
          </div>
        ) : advice.type === "adjust" && (
          <p className="rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning">
            {advice.blocked ? "约束未满足，暂不可调节（仍可查看依据或忽略）。" : "当前建议暂不可调节，请等待状态更新。"}
          </p>
        )}

        <Section title="判断依据" icon={Info}>
          <ul className="flex flex-col gap-1.5">
            {advice.reasons.map((r, i) => (
              <li key={i} className="rounded bg-muted px-2 py-1.5 text-sm leading-relaxed">
                <span className="font-medium"><ExplainText text={r.label} />：</span>
                <ExplainText text={r.value} />
              </li>
            ))}
          </ul>
        </Section>

        <Section title="预计效果" icon={CheckCircle2}>
          <div className="flex flex-col gap-1 text-sm leading-relaxed">
            {advice.forecast.doRange && <p><ExplainText text={`DO 预计区间：${advice.forecast.doRange}（${advice.forecast.responseMinutes}）`} /></p>}
            {advice.forecast.nh4Trend && <p><ExplainText text={`氨氮趋势：${advice.forecast.nh4Trend}`} /></p>}
            {advice.forecast.energyDeltaPct && <p><ExplainText text={`能耗变化：${advice.forecast.energyDeltaPct}`} /></p>}
            {advice.forecast.note && <p><ExplainText text={advice.forecast.note} /></p>}
          </div>
        </Section>

        <Section title="约束检查" icon={ShieldCheck}>
          <ul className="list-disc space-y-0.5 pl-4 text-sm leading-relaxed text-muted-foreground">
            {advice.constraints.map((c, i) => (
              <li key={i}><ExplainText text={c} /></li>
            ))}
          </ul>
        </Section>

        {advice.risks.length > 0 && (
          <Section title="风险提示" icon={AlertTriangle}>
            <ul className="flex flex-col gap-0.5 text-sm leading-relaxed text-warning">
              {advice.risks.map((r, i) => (
                <li key={i}><ExplainText text={r} /></li>
              ))}
            </ul>
          </Section>
        )}

        <footer className="flex flex-col gap-2 border-t pt-2">
          {advice.knowledgeRef && <KnowledgeReference id={advice.knowledgeRef} />}
          <Button size="sm" variant="outline" disabled={busy} onClick={handleIgnore}>
            忽略建议
          </Button>
          {error && <p role="alert" className="text-xs text-critical">{error}</p>}
        </footer>
      </div>
    </article>
  );
}
