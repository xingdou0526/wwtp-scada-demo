import {
  CloudRain,
  Snowflake,
  Sun,
  Moon,
  Zap,
  RotateCcw,
  FlaskConical,
  Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const SCENARIOS = [
  { key: "storm", label: "暴雨冲击", icon: CloudRain },
  { key: "night", label: "夜间低负荷", icon: Moon },
  { key: "shock", label: "进水氨氮冲击", icon: Zap },
] as const;

const FAULTS = [
  { key: "doDrift", label: "DO 探头漂移" },
  { key: "doStuck", label: "DO 数值卡死" },
  { key: "doOffline", label: "DO 数据中断" },
] as const;

interface Props {
  scenario: Record<string, boolean>;
  fault: Record<string, boolean>;
  onScenario: (key: string, enabled: boolean) => Promise<void> | void;
  onFault: (key: string, enabled: boolean) => Promise<void> | void;
  onReset: () => void;
}

// 季节单按钮三态循环：常温 → 冬季 → 夏季 → 常温
const SEASON_META = {
  normal: { label: "季节：常温", icon: Sun, active: false },
  winter: { label: "冬季低温", icon: Snowflake, active: true },
  summer: { label: "夏季高温", icon: Sun, active: true },
} as const;

export function ScenarioBar({ scenario, fault, onScenario, onFault, onReset }: Props) {
  const season = scenario.winter ? "winter" : scenario.summer ? "summer" : "normal";
  const seasonMeta = SEASON_META[season];
  const SeasonIcon = seasonMeta.icon;

  async function handleSeason() {
    if (season === "normal") {
      await onScenario("winter", true);
    } else if (season === "winter") {
      await onScenario("summer", true); // 后端自动关闭冬季
    } else {
      await onScenario("summer", false);
    }
  }

  return (
    <section aria-label="工况模拟控制" className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Waves className="size-3.5" /> 外部因素
      </span>
      <Button
        size="sm"
        variant={seasonMeta.active ? "default" : "outline"}
        className="w-[132px] justify-center"
        onClick={handleSeason}
        title="点击在 常温 → 冬季 → 夏季 之间切换"
      >
        <SeasonIcon /> {seasonMeta.label}
      </Button>
      {SCENARIOS.map(({ key, label, icon: Icon }) => (
        <Button
          key={key}
          size="sm"
          variant={scenario[key] ? "default" : "outline"}
          className="w-[132px] justify-center"
          onClick={() => onScenario(key, !scenario[key])}
        >
          <Icon /> {label}
        </Button>
      ))}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <FlaskConical className="size-3.5" /> 数据异常
      </span>
      {FAULTS.map(({ key, label }) => (
        <Button
          key={key}
          size="sm"
          variant={fault[key] ? "destructive" : "outline"}
          className="w-[124px] justify-center"
          onClick={() => onFault(key, !fault[key])}
        >
          {label}
        </Button>
      ))}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Button size="sm" variant="secondary" onClick={onReset}>
        <RotateCcw /> 复位
      </Button>
    </section>
  );
}
