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
  History,
  ChevronDown,
  CircleCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExplainText, TermProvider } from "@/components/Term";
import { KnowledgeReference } from "@/components/KnowledgeReference";
import { OperationRecords } from "@/components/OperationRecords";
import { postJson } from "@/lib/api";
import { DO_ADJUSTMENT, type DoAdjustmentAdvice } from "@/lib/advice";
import type { Term } from "@/lib/terms";
import { cn } from "@/lib/utils";

const TYPE_META: Record<string, { label: string; icon: any; className: string }> = {
  adjust: { label: "调节建议", icon: Gauge, className: "text-primary" },
  inspect: { label: "排查建议", icon: Wrench, className: "text-warning" },
  observe: { label: "观察提示", icon: Eye, className: "text-muted-foreground" },
};

const PRIORITY_META: Record<string, { label: string; variant: "destructive" | "default" | "secondary" }> = {
  high: { label: "高优先级", variant: "destructive" },
  medium: { label: "中优先级", variant: "default" },
  low: { label: "低优先级", variant: "secondary" },
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  executed: { label: "已执行", className: "text-success" },
  ignored: { label: "已忽略", className: "text-muted-foreground" },
  expired: { label: "已过期", className: "text-muted-foreground" },
  pending: { label: "待处理", className: "text-primary" },
};

function Section({ title, icon, children }: { title: string; icon: any; children: any }) {
  const Icon = icon;
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
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

function AdviceBubble({ advice, doAdjustment, remainingSeconds, onAction }: {
  advice: any;
  doAdjustment: DoAdjustmentAdvice | null;
  remainingSeconds: number;
  onAction: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeMeta = TYPE_META[advice.type] ?? TYPE_META.observe;
  const TypeIcon = typeMeta.icon;
  const priority = PRIORITY_META[advice.priority] ?? PRIORITY_META.low;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const remaining = minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;

  async function handleIgnore() {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/advice/${advice.id}/ignore`);
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
            <span className={cn("flex items-center gap-1 text-xs font-semibold", typeMeta.className)}>
              <TypeIcon className="size-4" /> {typeMeta.label}
            </span>
            <Badge variant={priority.variant}>{priority.label}</Badge>
          </div>
          <h3 className="text-sm font-bold leading-snug">{advice.title}</h3>
          <p className="text-[11px] text-muted-foreground tabular-nums">{advice.id} · 现实时间剩余约 {remaining}</p>
        </header>

        {advice.action && (
          <div className="flex items-center justify-center gap-3 rounded-md bg-primary/5 px-3 py-2">
            <span className="text-xs text-muted-foreground">DO 目标值</span>
            <span className="text-lg font-bold tabular-nums">{advice.action.from.toFixed(1)}</span>
            <ArrowRight className="size-4 text-primary" />
            <span className="text-lg font-bold text-primary tabular-nums">{advice.action.to.toFixed(1)}</span>
            <span className="text-xs text-muted-foreground">mg/L</span>
          </div>
        )}
        {doAdjustment ? (
          <p className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2 text-xs leading-relaxed">
            请点击主处理流程中的「
            <a
              href={`#${DO_ADJUSTMENT.nodeId}`}
              className="rounded-sm font-bold text-primary underline underline-offset-2"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(DO_ADJUSTMENT.nodeId)?.focus();
              }}
            >{DO_ADJUSTMENT.stageName}</a>
            」卡片上的「{DO_ADJUSTMENT.buttonLabel}」，核对并确认将{DO_ADJUSTMENT.label}调至 <strong className="whitespace-nowrap tabular-nums">{doAdjustment.to.toFixed(1)} mg/L</strong>。
          </p>
        ) : advice.type === "adjust" && (
          <p className="text-xs text-warning">
            {advice.blocked ? "约束未满足，暂不可调节。" : "当前建议暂不可调节，请等待状态更新。"}
          </p>
        )}

        <Section title="判断依据" icon={Info}>
          <ul className="flex flex-col gap-1.5">
            {advice.reasons.map((r: any, i: number) => (
              <li key={i} className="rounded bg-muted px-2 py-1.5 text-xs">
                <span className="font-medium">{r.label}：</span>
                <ExplainText text={r.value} />
              </li>
            ))}
          </ul>
        </Section>

        <Section title="预计效果" icon={CheckCircle2}>
          <div className="flex flex-col gap-1 text-xs leading-relaxed">
            {advice.forecast.doRange && <p><ExplainText text={`DO 预计区间：${advice.forecast.doRange}（${advice.forecast.responseMinutes}）`} /></p>}
            {advice.forecast.nh4Trend && <p><ExplainText text={`氨氮趋势：${advice.forecast.nh4Trend}`} /></p>}
            {advice.forecast.energyDeltaPct && <p><ExplainText text={`能耗变化：${advice.forecast.energyDeltaPct}`} /></p>}
            {advice.forecast.note && <p><ExplainText text={advice.forecast.note} /></p>}
          </div>
        </Section>

        <Section title="约束检查" icon={ShieldCheck}>
          <ul className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
            {advice.constraints.map((c: string, i: number) => (
              <li key={i} className="flex gap-1.5">
                <span aria-hidden>·</span>
                <ExplainText text={c} />
              </li>
            ))}
          </ul>
        </Section>

        {advice.risks.length > 0 && (
          <Section title="风险提示" icon={AlertTriangle}>
            <ul className="flex flex-col gap-0.5 text-[11px] text-warning">
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

export function AdvicePanel({ activeAdvice, doAdjustment, advices, remainingSeconds, onAction, terms }: {
  activeAdvice: any;
  doAdjustment: DoAdjustmentAdvice | null;
  advices: any[];
  remainingSeconds: number;
  onAction: () => void;
  terms: Term[];
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = advices.filter((a) => a.status !== "pending").slice(0, 10);

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

      {/* 历史建议（顶部折叠） */}
      <div className="border-b bg-card">
        <div className="flex items-center gap-1 px-2 py-1">
          <Button
            size="sm"
            variant="ghost"
            className="min-w-0 flex-1 justify-start gap-2 px-2 text-xs text-muted-foreground"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
            aria-controls="advice-history"
          >
            <History className="size-3.5" />
            历史建议
            <Badge variant="secondary" className="text-[10px]">{history.length}</Badge>
            <ChevronDown className={cn("ml-auto size-3.5 transition-transform", historyOpen && "rotate-180")} />
          </Button>
          <OperationRecords />
        </div>
        <div id="advice-history" className="disclosure-grid" data-open={historyOpen} aria-hidden={!historyOpen} inert={!historyOpen}>
          <div className="min-h-0 overflow-hidden">
            <ul className="flex max-h-52 flex-col gap-1.5 overflow-y-auto px-4 pb-3">
            {history.length === 0 ? (
              <li className="text-xs text-muted-foreground">暂无历史建议</li>
            ) : (
              history.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-2 rounded bg-muted px-2 py-1.5 text-xs">
                  <span className="flex-1 leading-snug">
                    <span className="mr-1 text-muted-foreground">{a.id}</span>
                    {a.title}
                  </span>
                  <span className={cn("shrink-0 font-medium", STATUS_META[a.status]?.className)}>
                    {a.invalidatedBy === "limits" ? "规则已更新" : a.invalidatedBy === "conditions" ? "工况已变化" : STATUS_META[a.status]?.label}
                  </span>
                </li>
              ))
            )}
            </ul>
          </div>
        </div>
      </div>

      {/* 对话消息区 */}
      <div className="flex min-h-[280px] flex-1 flex-col gap-3 overflow-y-auto p-3 lg:min-h-0">
        {activeAdvice ? (
          <TermProvider terms={terms}>
            <AdviceBubble key={activeAdvice.id} advice={activeAdvice} doAdjustment={doAdjustment} remainingSeconds={remainingSeconds} onAction={onAction} />
          </TermProvider>
        ) : (
          <article className="flex gap-2">
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
      </div>

      {/* 底部声明 */}
      <footer className="flex items-center justify-center gap-1.5 border-t bg-card px-3 py-2 text-center text-xs font-bold text-critical">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        <span>AI 仅提供建议，执行由人工确认</span>
      </footer>
    </aside>
  );
}
