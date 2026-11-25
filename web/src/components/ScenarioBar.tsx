import { useState } from "react";
import {
  Activity, ChevronDown, CloudRain, Fan, FlaskConical, Gauge, GaugeCircle, Moon,
  RotateCcw, Snowflake, Sparkles, Sun, Unplug, Waves, Zap,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FaultState, PresetKey, ScenarioState } from "@/lib/types";

const PRESETS: { key: PresetKey; label: string; title: string }[] = [
  { key: "shock", label: "① 冲击保达标", title: "复位并进入进水氨氮冲击待调节状态" },
  { key: "night", label: "② 夜间节能", title: "复位并进入夜间低负荷待节能下调状态" },
  { key: "fault", label: "③ 异常防误调", title: "复位并进入多仪表异常拦截调节并发排查状态" },
];

const SCENARIOS = [
  { key: "storm", label: "暴雨冲击", icon: CloudRain },
  { key: "night", label: "夜间低负荷", icon: Moon },
  { key: "shock", label: "进水氨氮冲击", icon: Zap },
] as const;

const FAULTS = [
  { key: "doDrift", label: "DO 探头漂移", icon: Gauge },
  { key: "doStuck", label: "DO 数值卡死", icon: GaugeCircle },
  { key: "doSpike", label: "DO 瞬时跳变", icon: Activity },
  { key: "doOffline", label: "DO 数据中断", icon: Unplug },
  { key: "airflowFeedback", label: "风量反馈异常", icon: Fan },
] as const;

interface Props {
  scenario: ScenarioState;
  fault: FaultState;
  activePreset: PresetKey | null;
  onScenario: (key: keyof ScenarioState, enabled: boolean) => Promise<void> | void;
  onFault: (key: keyof FaultState, enabled: boolean) => Promise<void> | void;
  onPreset: (preset: PresetKey) => Promise<void> | void;
  onReset: () => Promise<void> | void;
}

const SEASONS = {
  normal: { label: "季节：常温", icon: Sun },
  winter: { label: "冬季低温", icon: Snowflake },
  summer: { label: "夏季高温", icon: Sun },
} as const;

export function ScenarioBar({ scenario, fault, activePreset, onScenario, onFault, onPreset, onReset }: Props) {
  const [expanded, setExpanded] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const [resetting, setResetting] = useState(false);
  const season = scenario.winter ? "winter" : scenario.summer ? "summer" : "normal";
  const { icon: SeasonIcon, label: seasonLabel } = SEASONS[season];
  const active = Object.values(scenario).filter(Boolean).length + Object.values(fault).filter(Boolean).length;

  function cycleSeason() {
    if (season === "normal") return onScenario("winter", true);
    if (season === "winter") return onScenario("summer", true);
    return onScenario("summer", false);
  }

  async function confirmReset() {
    if (resetting) return;
    setResetting(true);
    try {
      await onReset();
    } finally {
      setResetting(false);
    }
  }

  return (
    <section aria-label="工况模拟控制" className="control-panel rounded-xl border">
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2.5">
          <Waves aria-hidden className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">工况模拟</h2>
          {active > 0 && <Badge variant="secondary">已启用 {active}</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" disabled={resetting}>
                <RotateCcw aria-hidden className="size-3.5" /> 复位
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认复位仿真工况？</AlertDialogTitle>
                <AlertDialogDescription>
                  复位将清空当前外部因素与仪表异常、重置 DO 目标值与仿真时钟，并中断当前待处理建议和待复评操作（历史记录仍会保留）。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => void confirmReset()}>确认复位</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            type="button" size="sm" variant="ghost" className="w-25 text-muted-foreground"
            aria-controls="scenario-controls" aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起控制" : "展开控制"}
            <ChevronDown aria-hidden className={expanded ? "size-3.5 rotate-180 transition-transform" : "size-3.5 transition-transform"} />
          </Button>
        </div>
      </header>
      <div id="scenario-controls" className="disclosure-grid" data-open={expanded} aria-hidden={!expanded} inert={!expanded}>
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2.5 border-t px-3 py-2.5 sm:px-4">
            <section aria-label="快捷剧本" className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Sparkles aria-hidden className="size-3 text-primary" /> 快捷演示剧本
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map(({ key, label, title }) => {
                  const isActive = activePreset === key;
                  return (
                    <Button
                      key={key}
                      type="button"
                      size="sm"
                      variant={isActive ? "default" : "outline"}
                      aria-pressed={isActive}
                      title={title}
                      onClick={() => void onPreset(key)}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            </section>
            <section aria-label="外部因素" className="space-y-1.5">
              <h3 className="text-[11px] font-medium text-muted-foreground">外部因素</h3>
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant={season === "normal" ? "outline" : "secondary"} className="w-29"
                  onClick={() => void cycleSeason()} title="常温、冬季、夏季循环切换">
                  <SeasonIcon aria-hidden /> {seasonLabel}
                </Button>
                {SCENARIOS.map(({ key, label, icon: Icon }) => (
                  <Button key={key} type="button" size="sm" variant={scenario[key] ? "secondary" : "outline"} className="w-29"
                    aria-pressed={Boolean(scenario[key])} onClick={() => void onScenario(key, !scenario[key])}>
                    <Icon aria-hidden /> {label}
                  </Button>
                ))}
              </div>
            </section>
            <section aria-label="数据异常" className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><FlaskConical aria-hidden className="size-3" /> 数据异常</h3>
              <div className="flex flex-wrap gap-1.5">
                {FAULTS.map(({ key, label, icon: Icon }) => (
                  <Button key={key} type="button" size="sm" variant={fault[key] ? "destructive" : "outline"} className="w-28"
                    aria-pressed={Boolean(fault[key])} onClick={() => void onFault(key, !fault[key])}>
                    <Icon aria-hidden /> {label}
                  </Button>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
