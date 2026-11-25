import { Clock3, FastForward, Pause, Play } from "lucide-react";
import { EffectCompareDialog } from "@/components/EffectCompareDialog";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/time";

export function SimClockControls({ clockMinutes, tick, tickSeconds, paused, onTogglePause, onFastForward }: {
  clockMinutes: number;
  tick: number;
  tickSeconds: number;
  paused: boolean;
  onTogglePause: () => void;
  onFastForward: (minutes: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-card px-2.5 py-1 text-xs font-medium tabular-nums">
        <Clock3 aria-hidden className="size-3.5 text-primary" />
        仿真时间 {formatClock(clockMinutes)}
        <span className="text-xs text-muted-foreground">（{tick} min）</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={paused ? "仿真已暂停" : `每 ${tickSeconds} 秒推进 1 仿真分钟`}>
          {paused ? "已暂停" : `${tickSeconds > 1 ? "审阅 " : ""}${60 / tickSeconds}×`}
        </span>
      </span>
      <Button
        type="button"
        size="sm"
        variant={paused ? "secondary" : "outline"}
        className="h-7 gap-1 px-2 text-xs"
        onClick={onTogglePause}
        title={paused ? "恢复仿真推进" : "暂停仿真以便讲解"}
      >
        {paused ? <Play aria-hidden className="size-3" /> : <Pause aria-hidden className="size-3" />}
        {paused ? "继续" : "暂停"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1 px-2 text-xs tabular-nums"
        onClick={() => onFastForward(30)}
        title="快进 30 仿真分钟（便于直接查看复评与趋势变化）"
      >
        <FastForward aria-hidden className="size-3" /> +30m
      </Button>
      <EffectCompareDialog />
    </div>
  );
}
