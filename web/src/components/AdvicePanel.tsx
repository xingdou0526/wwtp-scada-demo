import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, CircleCheck, Clock3 } from "lucide-react";
import { AdviceCard, AiAvatar, adviceTone, PRIORITY_META, TYPE_META } from "@/components/AdviceCard";
import { AdviceHistoryButton } from "@/components/AdviceHistory";
import { OperationRecords } from "@/components/OperationRecords";
import { TermProvider } from "@/components/Term";
import { Badge } from "@/components/ui/badge";
import type { ActiveAdvice, DoAdjustmentAdvice } from "@/lib/advice";
import type { Term } from "@/lib/terms";
import type { MonitorStatus, StateResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AdvicePanel({ activeAdvices, doAdjustment, monitorStatus, onFocusAdjustment, onAction, terms }: {
  activeAdvices: ActiveAdvice[];
  doAdjustment: DoAdjustmentAdvice | null;
  monitorStatus?: MonitorStatus;
  onFocusAdjustment: () => void;
  onAction: (snapshot?: StateResponse) => void;
  terms: Term[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(activeAdvices.map((advice) => advice.id));
    const top = activeAdvices[0];
    if (!top) {
      setSelectedId(null);
    } else if (selectedId && currentIds.has(selectedId)) {
      if (top.id !== selectedId && !prevIdsRef.current.has(top.id)) {
        setSelectedId(top.id);
      }
    } else {
      setSelectedId(top.id);
    }
    prevIdsRef.current = currentIds;
  }, [activeAdvices, selectedId]);

  const selectedAdvice = activeAdvices.find((advice) => advice.id === selectedId) ?? activeAdvices[0] ?? null;
  const selectedIndex = selectedAdvice ? activeAdvices.findIndex((advice) => advice.id === selectedAdvice.id) : -1;
  const hasHighUrgency = activeAdvices.some((advice) => advice.priority === "high" || doAdjustment?.id === advice.id);

  return (
    <aside
      id="advice-panel"
      aria-label="AI 辅助决策"
      className="flex w-full shrink-0 flex-col overflow-hidden rounded-xl border bg-muted shadow-lg lg:h-full lg:w-[352px]"
    >
      <header className="flex items-center gap-2.5 border-b border-primary/20 bg-secondary px-4 py-3 text-secondary-foreground">
        <span className="flex size-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
          <Bot className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">智能辅助曝气决策助手</h2>
        </div>
        {activeAdvices.length > 0 ? (
          <Badge
            variant="outline"
            className={cn(
              "whitespace-nowrap tabular-nums text-[11px]",
              hasHighUrgency
                ? "border-critical/40 bg-critical/10 text-critical"
                : "border-warning/40 bg-warning/10 text-warning",
            )}
          >
            待处理 {activeAdvices.length} 条
          </Badge>
        ) : (
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px]">
            <span className="size-2 animate-pulse rounded-full bg-success" aria-hidden />
            监测中
          </span>
        )}
      </header>

      <TermProvider terms={terms}>
        <div className="flex items-center justify-between gap-1 border-b bg-card px-2 py-1">
          <AdviceHistoryButton />
          <OperationRecords />
        </div>

        {activeAdvices.length > 1 && (
          <section aria-label="待处理建议队列" className="shrink-0 space-y-1.5 border-b bg-card px-3 py-2.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="font-semibold">并发建议队列（按紧急度排序）</span>
              <span className="tabular-nums">{selectedIndex + 1} / {activeAdvices.length}</span>
            </div>
            <ul className="space-y-1">
              {activeAdvices.map((advice) => {
                const active = selectedAdvice?.id === advice.id;
                const tone = adviceTone(advice);
                const typeMeta = TYPE_META[advice.type] ?? TYPE_META.observe;
                const TypeIcon = typeMeta.icon;
                const priority = PRIORITY_META[advice.priority] ?? PRIORITY_META.low;
                const isExecutable = doAdjustment?.id === advice.id;

                return (
                  <li key={advice.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedId(advice.id)}
                      className={cn(
                        "relative flex w-full items-center gap-2 overflow-hidden rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
                        active
                          ? "border-primary/50 bg-primary/10 text-foreground shadow-xs"
                          : "border-border/80 bg-background/80 text-muted-foreground hover:border-primary/30 hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", tone.accentBar)} />
                      <TypeIcon aria-hidden className={cn("ml-0.5 size-3.5 shrink-0", tone.type)} />
                      <span className={cn("min-w-0 flex-1 truncate", active ? "font-semibold" : "font-medium")}>
                        {advice.title}
                      </span>
                      {isExecutable ? (
                        <Badge variant="default" className="shrink-0 px-1.5 py-0 text-[10px]">可调节</Badge>
                      ) : advice.blocked ? (
                        <Badge variant="outline" className="shrink-0 border-warning/40 bg-warning/10 px-1.5 py-0 text-[10px] text-warning">暂不可调</Badge>
                      ) : (
                        <Badge variant={priority.variant} className="shrink-0 px-1.5 py-0 text-[10px]">{priority.shortLabel}</Badge>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="flex min-h-[280px] flex-1 flex-col lg:min-h-0 lg:overflow-hidden">
          {selectedAdvice ? (
            <div role="region" aria-label="当前查看建议" className="min-h-0 flex-1 p-3 lg:overflow-y-auto">
              <AdviceCard
                key={selectedAdvice.id}
                advice={selectedAdvice}
                doAdjustment={doAdjustment?.id === selectedAdvice.id ? doAdjustment : null}
                onFocusAdjustment={onFocusAdjustment}
                onAction={onAction}
              />
            </div>
          ) : (
            <article className="flex flex-1 items-start gap-2 p-3">
              <AiAvatar />
              <div className={cn(
                "flex flex-1 flex-col gap-1.5 rounded-xl rounded-tl-sm border bg-card p-3 shadow-sm",
                monitorStatus?.level === "warning"
                  ? "border-warning/35"
                  : monitorStatus?.level === "info"
                    ? "border-primary/25"
                    : "border-success/30",
              )}>
                <p className={cn(
                  "flex items-center gap-1.5 text-sm font-medium",
                  monitorStatus?.level === "warning"
                    ? "text-warning"
                    : monitorStatus?.level === "info"
                      ? "text-primary"
                      : "text-success",
                )}>
                  {monitorStatus && monitorStatus.level !== "normal"
                    ? <Clock3 className="size-4 shrink-0" />
                    : <CircleCheck className="size-4 shrink-0" />}
                  {monitorStatus?.title ?? "暂无待处理建议"}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {monitorStatus?.detail ?? "我会持续监测 DO、进水负荷与出水氨氮。出现异常时，将在此给出调节建议、判断依据和预计效果。"}
                </p>
              </div>
            </article>
          )}
        </div>
      </TermProvider>

      <footer className="flex items-center justify-center gap-1.5 border-t bg-card px-3 py-2 text-center text-xs font-bold text-critical">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        <span>AI 仅提供建议，执行由人工确认</span>
      </footer>
    </aside>
  );
}
