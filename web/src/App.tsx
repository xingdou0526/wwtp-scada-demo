import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Droplets, Clock3, LayoutDashboard, Settings2, ChartNoAxesCombined } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminPage } from "@/components/AdminPage";
import { ScenarioBar } from "@/components/ScenarioBar";
import { ProcessFlow } from "@/components/ProcessFlow";
import { TrendChart } from "@/components/TrendChart";
import { AdvicePanel } from "@/components/AdvicePanel";
import type { DoAdjustmentAdvice } from "@/lib/advice";
import { fetchState, postJson, formatClock } from "@/lib/api";

export default function App() {
  const [adminOpen, setAdminOpen] = useState(() => window.location.hash === "#admin");
  const [data, setData] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const syncPage = () => setAdminOpen(window.location.hash === "#admin");
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

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
  const activeAdvice = data?.activeAdvice;
  const tickSeconds = data?.timing?.secondsPerTick ?? 1;
  const doAdjustment: DoAdjustmentAdvice | null =
    connected && state && activeAdvice?.type === "adjust" && activeAdvice.status === "pending" &&
    !activeAdvice.blocked && activeAdvice.expiresAtTick > state.tick &&
    activeAdvice.action?.param === "doSetpoint" && activeAdvice.action.from === state.bio.doSetpoint
      ? {
          id: activeAdvice.id,
          from: activeAdvice.action.from,
          to: activeAdvice.action.to,
          reviewMinutes: activeAdvice.reviewAfterTick - activeAdvice.createdTick,
        }
      : null;
  const history = data?.history ?? [];
  const clockMinutes = history.map((sample: any) => sample.clockMinutes);

  return (
    <div className="app-canvas flex h-dvh flex-col overflow-hidden">
      <header className="app-header shrink-0 border-b">
        <div className="mx-auto flex max-w-[1720px] flex-col gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/35 bg-primary/10 text-primary">
                <Droplets aria-hidden className="size-5" />
              </span>
              <div>
                <h1 className="text-base font-semibold leading-tight tracking-tight sm:text-lg">水质净化厂智能曝气辅助决策</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-4">
              {state && !adminOpen && (
                <span className="flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-card px-2.5 py-1 text-xs font-medium tabular-nums">
                  <Clock3 aria-hidden className="size-3.5 text-primary" />
                  仿真时间 {formatClock(state.clockMinutes)}
                  <span className="text-xs text-muted-foreground">（{state.tick} min）</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={`每 ${tickSeconds} 秒推进 1 仿真分钟`}>
                    {tickSeconds > 1 && "审阅 "}{60 / tickSeconds}×
                  </span>
                </span>
              )}
              <Badge variant="outline" className={connected ? "border-success/30 bg-success/10 text-success" : "border-critical/40 bg-critical/10 text-critical"}>
                <Activity aria-hidden className="size-3" />
                {connected ? "服务已连接" : "服务未连接"}
              </Badge>
              <nav aria-label="工作区" className="flex items-center gap-1">
                <Button asChild size="sm" variant={adminOpen ? "ghost" : "secondary"}>
                  <a href="#control" aria-current={adminOpen ? undefined : "page"}><LayoutDashboard aria-hidden /> 中控台</a>
                </Button>
                <Button asChild size="sm" variant={adminOpen ? "secondary" : "ghost"}>
                  <a href="#admin" aria-current={adminOpen ? "page" : undefined}><Settings2 aria-hidden /> 后台管理</a>
                </Button>
              </nav>
            </div>
          </div>
          {state && !adminOpen && (
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

      <main className="mx-auto flex w-full max-w-[1720px] min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-4 sm:px-6">
        {!adminOpen && error && (
          <p role="alert" className="advice-enter rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </p>
        )}
        {adminOpen ? (
          <AdminPage setpoint={state?.bio.doSetpoint} onChange={load} />
        ) : !state ? (
          <p className="py-20 text-center text-sm text-muted-foreground">正在连接仿真服务…</p>
        ) : (
          <div className="page-enter flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scroll-smooth lg:flex-row lg:overflow-hidden">
            <div className="flex min-w-0 flex-1 flex-col lg:overflow-y-auto lg:pr-2">
              <ProcessFlow state={state} limits={data.limits} history={history} adjustment={doAdjustment} onRefresh={load}>
                <section aria-labelledby="trend-heading" className="space-y-2.5">
                  <h3 id="trend-heading" className="flex items-center gap-2 text-sm font-semibold"><ChartNoAxesCombined aria-hidden className="size-4 text-primary" /> 关键参数趋势</h3>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
                    <TrendChart
                      title="好氧区 DO（测量值）"
                      unit="mg/L"
                      color="var(--chart-do)"
                      points={history.map((h: any) => h.measuredDo)}
                      current={state.measured.do === null ? "—" : state.measured.do.toFixed(2)}
                      reference={{ value: state.bio.doSetpoint, label: "目标" }}
                      clockMinutes={clockMinutes}
                    />
                    <TrendChart
                      title="曝气风量（反馈）"
                      unit="m³/h"
                      color="var(--chart-airflow)"
                      points={history.map((h: any) => h.measuredAirflow ?? h.airflow)}
                      current={(state.measured.airflow ?? state.bio.airflow).toFixed(0)}
                      clockMinutes={clockMinutes}
                    />
                    <TrendChart
                      title="出水氨氮"
                      unit="mg/L"
                      color="var(--chart-nh4)"
                      points={history.map((h: any) => h.effNh4)}
                      current={state.effluent.nh4.toFixed(2)}
                      reference={{ value: data.limits.nh4InternalLimit, label: "内控" }}
                      clockMinutes={clockMinutes}
                    />
                    <TrendChart
                      title="风机功率"
                      unit="kW"
                      color="var(--chart-power)"
                      points={history.map((h: any) => h.power)}
                      current={state.blower.power.toFixed(1)}
                      clockMinutes={clockMinutes}
                    />
                  </div>
                </section>
              </ProcessFlow>
            </div>
            <AdvicePanel
              activeAdvice={activeAdvice}
              doAdjustment={doAdjustment}
              advices={data.advices}
              remainingSeconds={data.timing?.adviceRemainingSeconds ?? Math.max(0, (activeAdvice?.expiresAtTick ?? state.tick) - state.tick)}
              onAction={load}
              terms={data.terms ?? []}
            />
          </div>
        )}
      </main>
    </div>
  );
}
