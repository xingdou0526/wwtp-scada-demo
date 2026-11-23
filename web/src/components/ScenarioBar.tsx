import { useState } from "react";
import {
  Activity, ChevronDown, CloudRain, Fan, FlaskConical, Gauge, GaugeCircle, Moon,
  RotateCcw, Snowflake, Sun, Unplug, Waves, Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
  scenario: Record<string, boolean>;
  fault: Record<string, boolean>;
  onScenario: (key: string, enabled: boolean) => Promise<void> | void;
  onFault: (key: string, enabled: boolean) => Promise<void> | void;
  onReset: () => Promise<void> | void;
}

const SEASONS = {
  normal: { label: "季节：常温", icon: Sun },
  winter: { label: "冬季低温", icon: Snowflake },
  summer: { label: "夏季高温", icon: Sun },
} as const;

export function ScenarioBar({ scenario, fault, onScenario, onFault, onReset }: Props) {
  const [expanded, setExpanded] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const [busy, setBusy] = useState(false);
  const season = scenario.winter ? "winter" : scenario.summer ? "summer" : "normal";
  const { icon: SeasonIcon, label: seasonLabel } = SEASONS[season];
  const active = Object.values(scenario).filter(Boolean).length + Object.values(fault).filter(Boolean).length;

  async function apply(action: () => Promise<void> | void) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  function cycleSeason() {
    if (season === "normal") return onScenario("winter", true);
    if (season === "winter") return onScenario("summer", true);
    return onScenario("summer", false);
  }

  return (
    <section aria-label="工况模拟控制" className="control-panel rounded-xl border">
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2.5">
          <Waves aria-hidden className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">工况模拟</h2>
          {active > 0 && <Badge variant="secondary">已启用 {active}</Badge>}
        </div>
        <Button
          type="button" size="sm" variant="ghost" className="w-25 text-muted-foreground"
          aria-controls="scenario-controls" aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起控制" : "展开控制"}
          <ChevronDown aria-hidden className={expanded ? "size-3.5 rotate-180 transition-transform" : "size-3.5 transition-transform"} />
        </Button>
      </header>
      <div id="scenario-controls" className="disclosure-grid" data-open={expanded} aria-hidden={!expanded} inert={!expanded}>
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-t px-3 py-3 sm:px-4" aria-busy={busy}>
            <section aria-label="外部因素" className="space-y-1.5">
              <h3 className="text-[11px] font-medium text-muted-foreground">外部因素</h3>
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant={season === "normal" ? "outline" : "secondary"} className="w-29"
                  disabled={busy} onClick={() => void apply(cycleSeason)} title="常温、冬季、夏季循环切换">
                  <SeasonIcon aria-hidden /> {seasonLabel}
                </Button>
                {SCENARIOS.map(({ key, label, icon: Icon }) => (
                  <Button key={key} type="button" size="sm" variant={scenario[key] ? "secondary" : "outline"} className="w-29"
                    aria-pressed={Boolean(scenario[key])} disabled={busy} onClick={() => void apply(() => onScenario(key, !scenario[key]))}>
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
                    aria-pressed={Boolean(fault[key])} disabled={busy} onClick={() => void apply(() => onFault(key, !fault[key]))}>
                    <Icon aria-hidden /> {label}
                  </Button>
                ))}
              </div>
            </section>
            <Button type="button" size="sm" variant="ghost" className="w-19" disabled={busy} onClick={() => void apply(onReset)}>
              <RotateCcw aria-hidden /> 复位
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
