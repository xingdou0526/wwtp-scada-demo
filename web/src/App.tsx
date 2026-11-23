import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Droplets, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScenarioBar } from "@/components/ScenarioBar";
import { ProcessFlow } from "@/components/ProcessFlow";
import { TrendChart } from "@/components/TrendChart";
import { AdvicePanel } from "@/components/AdvicePanel";
import { fetchState, postJson, formatClock } from "@/lib/api";

export default function App() {
  const [data, setData] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchState();
      setData(d);
      setConnected(true);
      setError(null);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 2000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  const handleScenario = useCallback(
    async (key: string, enabled: boolean) => {
      try {
        await postJson("/api/scenario", { key, enabled });
        await load();
      } catch (e: any) {
        setError(e.message);
      }
    },
    [load]
  );

  const handleFault = useCallback(
    async (key: string, enabled: boolean) => {
      try {
        await postJson("/api/fault", { type: key, enabled });
        await load();
      } catch (e: any) {
        setError(e.message);
      }
    },
    [load]
  );

  const handleReset = useCallback(async () => {
    try {
      await postJson("/api/reset");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }, [load]);

  const state = data?.state;
  const history = data?.history ?? [];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <header className="shrink-0 border-b bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Droplets className="size-7 text-primary" />
              <div>
                <h1 className="text-lg font-bold leading-tight">水质净化厂智能中控仿真平台</h1>
                <p className="text-xs text-muted-foreground">曝气环节 AI 辅助决策 · 预研 Demo（模拟数据，不连接真实设备）</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {state && (
                <span className="flex items-center gap-1.5 whitespace-nowrap text-sm font-medium">
                  <Clock3 className="size-4 text-muted-foreground" />
                  仿真时间 {formatClock(state.clockMinutes)}
                  <span className="text-xs text-muted-foreground">（{state.tick} min）</span>
                </span>
              )}
              <Badge variant={connected ? "default" : "destructive"}>
                <Activity className="size-3" />
                {connected ? "服务已连接" : "服务未连接"}
              </Badge>
            </div>
          </div>
          {state && (
            <ScenarioBar
              scenario={state.scenario}
              fault={state.fault}
              onScenario={handleScenario}
              onFault={handleFault}
              onReset={handleReset}
            />
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1600px] min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
        {error && (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {!state ? (
          <p className="py-20 text-center text-sm text-muted-foreground">正在连接仿真服务…</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto lg:flex-row lg:overflow-hidden">
            <div className="flex min-w-0 flex-1 flex-col gap-4 lg:overflow-y-auto lg:pr-1">
              <ProcessFlow state={state} limits={data.limits} />
              <section aria-label="关键参数趋势" className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
                <TrendChart
                  title="好氧区 DO（测量值）"
                  unit="mg/L"
                  color="#1d4ed8"
                  points={history.map((h: any) => h.measuredDo)}
                  current={state.measured.do === null ? "--" : state.measured.do.toFixed(2)}
                  reference={{ value: state.bio.doSetpoint, label: "目标" }}
                />
                <TrendChart
                  title="曝气风量"
                  unit="m³/h"
                  color="#0d9488"
                  points={history.map((h: any) => h.airflow)}
                  current={state.bio.airflow.toFixed(0)}
                />
                <TrendChart
                  title="出水氨氮"
                  unit="mg/L"
                  color="#dc2626"
                  points={history.map((h: any) => h.effNh4)}
                  current={state.effluent.nh4.toFixed(2)}
                  reference={{ value: data.limits.nh4InternalLimit, label: "内控" }}
                />
                <TrendChart
                  title="风机功率"
                  unit="kW"
                  color="#d97706"
                  points={history.map((h: any) => h.power)}
                  current={state.blower.power.toFixed(1)}
                />
              </section>
            </div>
            <AdvicePanel
              activeAdvice={data.activeAdvice}
              advices={data.advices}
              tick={state.tick}
              onAction={load}
            />
          </div>
        )}
      </main>
    </div>
  );
}
