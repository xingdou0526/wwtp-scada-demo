import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, RefreshCw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DO_ADJUSTMENT, type DoAdjustmentAdvice } from "@/lib/advice";
import { postJson } from "@/lib/api";

export function DoAdjustment({ advice, currentSetpoint, available, hasNewAdvice, onSwitchToLatest, onRefresh, onClose, children }: {
  advice: DoAdjustmentAdvice | null;
  currentSetpoint: number;
  available: boolean;
  hasNewAdvice: boolean;
  onSwitchToLatest: () => void;
  onRefresh: () => Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [executed, setExecuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = !available || busy;
  const unavailableMessage = hasNewAdvice
    ? "检测到新的可执行调节建议，可立即切换核对。"
    : advice
      ? "当前建议已不可执行，请查看 AI 侧栏的最新状态。"
      : "暂无可执行的调节建议。AI 给出可执行建议后，可在此核对并确认。";

  useEffect(() => {
    panel.current?.focus();
  }, []);

  async function execute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!advice || disabled || executed) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/advice/${encodeURIComponent(advice.id)}/execute`, { operatorNote: note });
      setExecuted(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      await onRefresh();
      setBusy(false);
    }
  }

  return (
    <section
      id={DO_ADJUSTMENT.panelId}
      ref={panel}
      tabIndex={-1}
      aria-labelledby="biological-adjustment-title"
      className="advice-enter scroll-m-4 space-y-3 rounded-xl border border-primary/25 bg-card p-4 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="biological-adjustment-title" className="flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal aria-hidden className="size-4 text-primary" /> {DO_ADJUSTMENT.stageName} · {DO_ADJUSTMENT.label}调节
        </h4>
        <div className="flex items-center gap-2">
          {children}
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>收起</Button>
        </div>
      </header>
      {advice ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2 text-sm tabular-nums">
            <span className="text-muted-foreground">调节前 <strong className="ml-1 text-foreground">{advice.from.toFixed(1)}</strong> mg/L</span>
            <ArrowRight aria-hidden className="size-4 text-primary" />
            <span className="text-muted-foreground">{executed ? "已调至" : "建议调至"} <strong className="ml-1 text-foreground">{advice.to.toFixed(1)}</strong> mg/L</span>
            <span className="ml-auto text-xs text-muted-foreground">{advice.id}</span>
          </div>
          {executed ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status" className="flex items-center gap-2 text-sm font-semibold text-success">
                <CheckCircle2 aria-hidden className="size-4 shrink-0" /> 已执行调节，{advice.reviewMinutes} 仿真分钟后复评。
              </p>
              {hasNewAdvice && (
                <Button type="button" size="sm" variant="outline" onClick={onSwitchToLatest}>
                  <RefreshCw aria-hidden className="size-3.5" /> 加载最新建议
                </Button>
              )}
            </div>
          ) : (
            <form className="space-y-3" onSubmit={execute}>
              <div className="space-y-1.5">
                <Label htmlFor="biological-operator-note">人工备注（可选）</Label>
                <Textarea
                  id="biological-operator-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="备注将写入操作记录"
                  rows={2}
                  maxLength={1000}
                  disabled={disabled}
                />
              </div>
              {error && <p role="alert" className="text-sm text-critical">{error}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" size="sm" className="w-24" disabled={disabled}>{busy ? "执行中…" : "确认调节"}</Button>
                {hasNewAdvice && (
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onSwitchToLatest}>
                    <RefreshCw aria-hidden className="size-3.5" /> 加载最新建议
                  </Button>
                )}
                <p className={available || busy ? "text-xs text-muted-foreground" : "text-xs text-warning"}>
                  {available || busy ? `确认后联动调整风量，${advice.reviewMinutes} 仿真分钟后复评。` : unavailableMessage}
                </p>
              </div>
            </form>
          )}
        </>
      ) : (
        <>
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground tabular-nums">
            当前{DO_ADJUSTMENT.label} <strong className="ml-1 text-foreground">{currentSetpoint.toFixed(1)}</strong> mg/L
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-muted-foreground">{unavailableMessage}</p>
            {hasNewAdvice && (
              <Button type="button" size="sm" variant="outline" onClick={onSwitchToLatest}>
                <RefreshCw aria-hidden className="size-3.5" /> 加载最新建议
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
