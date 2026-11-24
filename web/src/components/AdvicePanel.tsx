import { useState } from "react";
import {
  Bot,
  CheckCircle2,
  ArrowRight,
  AlertTriangle,
  Info,
  Eye,
  Wrench,
  Gauge,
  ShieldCheck,
  ChevronDown,
  CircleCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdviceHistoryButton } from "@/components/AdviceHistory";
import { ExplainText, TermProvider } from "@/components/Term";
import { KnowledgeReference } from "@/components/KnowledgeReference";
import { OperationRecords } from "@/components/OperationRecords";
import { postJson } from "@/lib/api";
import { DO_ADJUSTMENT, type ActiveAdvice, type DoAdjustmentAdvice } from "@/lib/advice";
import type { Term } from "@/lib/terms";
import { cn } from "@/lib/utils";

const TYPE_META: Record<string, { label: string; icon: any; className: string }> = {
  adjust: { label: "调节建议", icon: Gauge, className: "text-critical" },
  inspect: { label: "排查建议", icon: Wrench, className: "text-warning" },
  observe: { label: "观察提示", icon: Eye, className: "text-muted-foreground" },
};

const PRIORITY_META: Record<string, { label: string; variant: "destructive" | "default" | "secondary" }> = {
  high: { label: "高优先级", variant: "destructive" },
  medium: { label: "中优先级", variant: "default" },
  low: { label: "低优先级", variant: "secondary" },
};

function Section({ title, icon, children }: { title: string; icon: any; children: any }) {
  const Icon = icon;
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="flex items-center gap-1 text-sm font-semibold text-muted-foreground">
        <Icon className="size-3.5" /> {title}
      </h4>
      {children}
    </section>
  );
}

// AI 头像（对话气泡左侧）
function AiAvatar() {
  return (
    <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/15 text-primary">
      <Bot className="size-4" />
    </span>
  );
}

function AdviceCard({ advice, doAdjustment, main, onAction }: {
  advice: ActiveAdvice;
  doAdjustment: DoAdjustmentAdvice | null;
  main: boolean;
  onAction: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeMeta = TYPE_META[advice.type] ?? TYPE_META.observe;
  const TypeIcon = typeMeta.icon;
  const priority = PRIORITY_META[advice.priority] ?? PRIORITY_META.low;
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
    <article className={main ? "advice-enter flex gap-2" : "px-2.5 pt-1 pb-2.5"}>
      {main && <AiAvatar />}
      <div className={cn("flex min-w-0 flex-1 flex-col gap-3", main && "rounded-xl rounded-tl-sm border bg-card p-3 shadow-sm")}>
        <header className="flex flex-col gap-1.5">
          {main && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className={cn("flex items-center gap-1 text-sm font-semibold", typeMeta.className)}>
                  <TypeIcon className="size-4" /> {typeMeta.label}
                </span>
                <Badge variant={priority.variant}>{priority.label}</Badge>
              </div>
              <h3 className="text-lg font-bold leading-snug text-critical">{advice.title}</h3>
            </>
          )}
          <p className="text-xs text-muted-foreground tabular-nums">{advice.id} · 现实时间剩余约 {remaining}</p>
        </header>

        {advice.action && (
          <div className="flex flex-wrap items-baseline justify-center gap-x-2.5 gap-y-1.5 rounded-lg border border-critical/25 bg-critical/5 px-2.5 py-3 text-critical">
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
          <p className="rounded-lg border border-border bg-muted/60 px-3 py-2.5 text-sm leading-relaxed text-foreground">
            请点击主处理流程中的「
            <a
              href={`#${DO_ADJUSTMENT.nodeId}`}
              className="rounded-sm font-bold underline underline-offset-2"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(DO_ADJUSTMENT.nodeId)?.focus();
              }}
            >{DO_ADJUSTMENT.stageName}</a>
            」卡片上的「<strong>{DO_ADJUSTMENT.buttonLabel}</strong>」，核对并确认将{DO_ADJUSTMENT.label}调至 <strong className="whitespace-nowrap tabular-nums">{doAdjustment.to.toFixed(1)} mg/L</strong>。
          </p>
        ) : advice.type === "adjust" && (
          <p className="text-sm text-warning">
            {advice.blocked ? "约束未满足，暂不可调节。" : "当前建议暂不可调节，请等待状态更新。"}
          </p>
        )}

        <Section title="判断依据" icon={Info}>
          <ul className="flex flex-col gap-1.5">
            {advice.reasons.map((r, i) => (
              <li key={i} className="rounded bg-muted px-2 py-1.5 text-sm leading-relaxed">
                <span className="font-medium">{r.label}：</span>
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
            {advice.constraints.map((c: string, i: number) => (
              <li key={i}><ExplainText text={c} /></li>
            ))}
          </ul>
        </Section>

        {advice.risks.length > 0 && (
          <Section title="风险提示" icon={AlertTriangle}>
            <ul className="flex flex-col gap-0.5 text-sm leading-relaxed text-warning">
              {advice.risks.map((r: string, i: number) => (
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

export function AdvicePanel({ activeAdvices, doAdjustment, onAction, terms }: {
  activeAdvices: ActiveAdvice[];
  doAdjustment: DoAdjustmentAdvice | null;
  onAction: () => void;
  terms: Term[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mainAdvice, ...otherAdvices] = activeAdvices;

  return (
    <aside
      id="advice-panel"
      aria-label="AI 辅助决策"
      className="flex w-full shrink-0 flex-col overflow-hidden rounded-xl border bg-muted shadow-lg lg:h-full lg:w-[352px]"
    >
      {/* AI 助手标题栏 */}
      <header className="flex items-center gap-2.5 border-b border-primary/20 bg-secondary px-4 py-3 text-secondary-foreground">
        <span className="flex size-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
          <Bot className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">AI 曝气决策助手</h2>
          <p className="text-[11px] opacity-80">规则引擎 v0.1 · 人工确认执行</p>
        </div>
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px]">
          <span className="size-2 animate-pulse rounded-full bg-success" aria-hidden />
          监测中
        </span>
      </header>

      <TermProvider terms={terms}>
        <div className="flex items-center justify-between gap-1 border-b bg-card px-2 py-1">
          <AdviceHistoryButton />
          <OperationRecords />
        </div>
        <div className="flex min-h-[280px] flex-1 flex-col lg:min-h-0 lg:overflow-hidden">
          {mainAdvice ? (
            <div role="region" aria-label="主建议" className="min-h-0 flex-1 p-3 lg:overflow-y-auto">
              <AdviceCard
                key={mainAdvice.id}
                advice={mainAdvice}
                main
                doAdjustment={doAdjustment?.id === mainAdvice.id ? doAdjustment : null}
                onAction={onAction}
              />
            </div>
          ) : (
            <article className="flex flex-1 items-start gap-2 p-3">
              <AiAvatar />
              <div className="flex flex-1 flex-col gap-1.5 rounded-xl rounded-tl-sm border border-success/30 bg-card p-3 shadow-sm">
                <p className="flex items-center gap-1.5 text-sm font-medium text-success">
                  <CircleCheck className="size-4" /> 暂无待处理建议
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  我会持续监测 DO、进水负荷与出水氨氮。出现异常时，将在此给出调节建议、判断依据和预计效果。
                </p>
              </div>
            </article>
          )}
          {otherAdvices.length > 0 && (
            <section aria-labelledby="other-advice-title" className="shrink-0 space-y-2 border-t bg-card p-3 lg:max-h-[44%] lg:overflow-y-auto">
              <h3 id="other-advice-title" className="text-xs font-semibold text-muted-foreground">其他提醒</h3>
              <ul className="space-y-1.5">
                {otherAdvices.map((advice) => {
                  const expanded = expandedId === advice.id;
                  const priority = PRIORITY_META[advice.priority] ?? PRIORITY_META.low;
                  const detailsId = `additional-advice-${advice.id}`;
                  return (
                    <li key={advice.id} className="rounded-lg border bg-background">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto min-h-9 w-full justify-start gap-2 px-2.5 py-2 text-left whitespace-normal"
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        onClick={() => setExpandedId((current) => current === advice.id ? null : advice.id)}
                      >
                        <span className="min-w-0 flex-1 font-semibold leading-snug">{advice.title}</span>
                        <Badge variant={priority.variant} className="text-[10px]">{priority.label}</Badge>
                        <ChevronDown aria-hidden className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")} />
                      </Button>
                      <div id={detailsId} className="disclosure-grid" data-open={expanded} aria-hidden={!expanded} inert={!expanded}>
                        <div className="min-h-0 overflow-hidden">
                          <AdviceCard
                            advice={advice}
                            main={false}
                            doAdjustment={doAdjustment?.id === advice.id ? doAdjustment : null}
                            onAction={onAction}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </TermProvider>

      {/* 底部声明 */}
      <footer className="flex items-center justify-center gap-1.5 border-t bg-card px-3 py-2 text-center text-xs font-bold text-critical">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        <span>AI 仅提供建议，执行由人工确认</span>
      </footer>
    </aside>
  );
}
