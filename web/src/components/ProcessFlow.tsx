import { useEffect, useState, type ReactNode } from "react";
import { Activity, Fan } from "lucide-react";
import { DoAdjustment } from "@/components/DoAdjustment";
import { ProcessDiagram } from "@/components/process/ProcessDiagram";
import { StageCard, StageDetails } from "@/components/process/StageCards";
import { buildProcessStages } from "@/components/process/stages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DO_ADJUSTMENT, type DoAdjustmentAdvice } from "@/lib/advice";
import type { RuleLimits } from "@/lib/admin";
import type { HistoryPoint, SimState } from "@/lib/types";

export function ProcessFlow({ state, limits, history, adjustment, focusAdjustmentTick = 0, sessionVersion = 0, onRefresh, children }: {
  state: SimState;
  limits: RuleLimits;
  history: HistoryPoint[];
  adjustment: DoAdjustmentAdvice | null;
  focusAdjustmentTick?: number;
  sessionVersion?: number;
  onRefresh: () => Promise<void>;
  children?: ReactNode;
}) {
  const [selection, setSelection] = useState<{ advice: DoAdjustmentAdvice | null } | null>(null);
  const openedAdvice = selection?.advice ?? null;
  const { biologicalStage, process, support } = buildProcessStages(state, limits);
  const attention = [...process, ...support].filter(({ status }) => status && status !== "normal").length;

  useEffect(() => {
    setSelection(null);
  }, [sessionVersion]);

  useEffect(() => {
    if (!focusAdjustmentTick) return;
    setSelection({ advice: adjustment });
    window.requestAnimationFrame(() => {
      const panel = document.getElementById(DO_ADJUSTMENT.panelId);
      panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      panel?.focus();
    });
  }, [focusAdjustmentTick]);

  function openAdjustment() {
    if (!selection || (adjustment && adjustment.id !== openedAdvice?.id)) {
      setSelection({ advice: adjustment });
    } else {
      document.getElementById(DO_ADJUSTMENT.panelId)?.focus();
    }
  }

  function closeAdjustment() {
    setSelection(null);
    document.getElementById(DO_ADJUSTMENT.nodeId)?.focus();
  }

  return (
    <section aria-labelledby="process-heading" className="monitor-layout flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="process-heading" className="text-xl font-semibold tracking-tight">工艺总览</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            点击「生化池」卡片上的「调节 DO」打开调节区。点击卡片可查看完整指标与仿真真值对照。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={attention ? "border-warning/40 bg-warning/10 text-warning" : "border-success/35 bg-success/10 text-success"}>
            <Activity aria-hidden className="size-3.5" /> {attention ? `${attention} 个环节需关注` : "环节状态正常"}
          </Badge>
          <Button asChild variant="outline" size="sm" className="lg:hidden">
            <a href="#advice-panel">查看建议</a>
          </Button>
        </div>
      </header>
      <ProcessDiagram
        stages={process}
        history={history}
        adjustmentOpen={selection !== null}
        onOpenAdjustment={openAdjustment}
      />
      {selection && (
        <DoAdjustment
          key={openedAdvice?.id ?? "none"}
          advice={openedAdvice}
          currentSetpoint={state.bio.doSetpoint}
          available={openedAdvice !== null && adjustment?.id === openedAdvice.id && adjustment.from === openedAdvice.from && adjustment.to === openedAdvice.to}
          hasNewAdvice={adjustment !== null && adjustment.id !== openedAdvice?.id}
          onSwitchToLatest={() => setSelection({ advice: adjustment })}
          onRefresh={onRefresh}
          onClose={closeAdjustment}
        >
          <StageDetails stage={biologicalStage} history={history}>
            <Button type="button" variant="outline" size="sm">查看完整指标</Button>
          </StageDetails>
        </DoAdjustment>
      )}
      {children}
      <section aria-labelledby="support-process" className="space-y-2.5">
        <h3 id="support-process" className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground"><Fan aria-hidden className="size-3.5 text-primary" /> 配套设施</h3>
        <div className="support-grid">{support.map((stage) => <StageCard key={stage.id} stage={stage} history={history} />)}</div>
      </section>
    </section>
  );
}
