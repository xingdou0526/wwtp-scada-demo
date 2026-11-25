import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Activity, ChartNoAxesCombined, Droplets, LayoutDashboard, Settings2 } from "lucide-react";
import { AdvicePanel } from "@/components/AdvicePanel";
import { ProcessFlow } from "@/components/ProcessFlow";
import { ScenarioBar } from "@/components/ScenarioBar";
import { SimClockControls } from "@/components/SimClockControls";
import { TrendChart } from "@/components/TrendChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ActiveAdvice, DoAdjustmentAdvice } from "@/lib/advice";
import { fetchState, postJson } from "@/lib/api";
import type { FaultState, PresetKey, ScenarioState, StateResponse } from "@/lib/types";

const AdminPage = lazy(async () => ({
  default: (await import("@/components/AdminPage")).AdminPage,
}));

export default function App() {
  const [adminOpen, setAdminOpen] = useState(() => window.location.hash === "#admin");
  const [data, setData] = useState<StateResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusAdjustmentTick, setFocusAdjustmentTick] = useState(0);
  const [sessionVersion, setSessionVersion] = useState(0);
  const requestSeq = useRef(0);

  useEffect(() => {
    const syncPage = () => setAdminOpen(window.location.hash === "#admin");
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const next = await fetchState();
      if (seq !== requestSeq.current) return;
      setData(next);
      setConnected(true);
      setError(null);
    } catch {
      if (seq === requestSeq.current) setConnected(false);
    }
  }, []);

  const applyMutation = useCallback(async (url: string, body?: unknown, optimistic?: (prev: StateResponse) => StateResponse) => {
    const seq = ++requestSeq.current;
    if (optimistic) setData((prev) => (prev ? optimistic(prev) : prev));
    try {
      const res = await postJson<{ ok: true; snapshot?: StateResponse }>(url, body);
      if (seq !== requestSeq.current) return;
      if (res.snapshot) {
        setData(res.snapshot);
        setConnected(true);
        setError(null);
      } else {
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
      void load();
    }
  }, [load]);

  // 仅在中控台页面维持 2 秒轮询，进入后台管理时仅加载一次以减少无效传输
  useEffect(() => {
    void load();
    if (adminOpen) return;
    const timer = window.setInterval(() => { void load(); }, 2000);
    return () => window.clearInterval(timer);
  }, [adminOpen, load]);

  const handleScenario = useCallback((key: keyof ScenarioState, enabled: boolean) => (
    applyMutation("/api/scenario", { key, enabled }, (prev) => {
      const scenario = { ...prev.state.scenario, [key]: enabled };
      if (key === "winter" && enabled) scenario.summer = false;
      if (key === "summer" && enabled) scenario.winter = false;
      return { ...prev, activePreset: null, state: { ...prev.state, scenario } };
    })
  ), [applyMutation]);

  const handleFault = useCallback((key: keyof FaultState, enabled: boolean) => (
    applyMutation("/api/fault", { type: key, enabled }, (prev) => ({
      ...prev,
      activePreset: null,
      state: { ...prev.state, fault: { ...prev.state.fault, [key]: enabled } },
    }))
  ), [applyMutation]);

  const handlePreset = useCallback((preset: PresetKey) => {
    setSessionVersion((v) => v + 1);
    return applyMutation("/api/preset", { preset }, (prev) => ({ ...prev, activePreset: preset }));
  }, [applyMutation]);
  const handleReset = useCallback(() => {
    setSessionVersion((v) => v + 1);
    return applyMutation("/api/reset", undefined, (prev) => ({ ...prev, activePreset: null }));
  }, [applyMutation]);
  const handleTogglePause = useCallback(() => {
    const nextPaused = !(data?.timing?.paused ?? false);
    void applyMutation("/api/sim/pause", { paused: nextPaused }, (prev) => ({
      ...prev,
      timing: { ...prev.timing, paused: nextPaused },
    }));
  }, [applyMutation, data?.timing?.paused]);
  const handleFastForward = useCallback((minutes: number) => {
    void applyMutation("/api/sim/fast-forward", { minutes });
  }, [applyMutation]);

  const state = data?.state;
  const activeAdvices: ActiveAdvice[] = data?.activeAdvices ?? (data?.activeAdvice ? [{
    ...data.activeAdvice,
    remainingSeconds: data.timing?.adviceRemainingSeconds ?? Math.max(0, data.activeAdvice.expiresAtTick - (state?.tick ?? 0)),
  }] : []);
  const tickSeconds = data?.timing?.secondsPerTick ?? 1;
  const paused = Boolean(data?.timing?.paused);
  const adjustable = connected && state ? activeAdvices.find((advice) =>
    advice.type === "adjust" && advice.status === "pending" && !advice.blocked &&
    advice.expiresAtTick > state.tick && advice.action?.param === "doSetpoint" &&
    advice.action.from === state.bio.doSetpoint,
  ) : undefined;
  const doAdjustment: DoAdjustmentAdvice | null = adjustable?.action ? {
    id: adjustable.id,
    from: adjustable.action.from,
    to: adjustable.action.to,
    reviewMinutes: adjustable.reviewAfterTick - adjustable.createdTick,
  } : null;
  const history = data?.history ?? [];
  const clockMinutes = history.map((sample) => sample.clockMinutes);
  const ticks = history.map((sample) => sample.tick);
  const chartMarkers = (data?.markers ?? []).map((marker) => ({
    tick: marker.tick,
    label: `执行 ${marker.from.toFixed(1)}→${marker.to.toFixed(1)}`,
  }));
  const doAbnormal = state ? state.measured.doQuality !== "good" : false;
  const airflowAbnormal = state ? state.measured.airflowQuality !== "good" : false;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="app-canvas flex h-dvh flex-col overflow-hidden">
        <header className="app-header shrink-0 border-b">
          <div className="mx-auto flex max-w-[1720px] flex-col gap-3 px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/35 bg-primary/10 text-primary">
                  <Droplets aria-hidden className="size-5" />
                </span>
                <h1 className="text-base font-semibold leading-tight tracking-tight sm:text-lg">水质净化厂智能曝气辅助决策</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                {state && !adminOpen && (
                  <SimClockControls
                    clockMinutes={state.clockMinutes}
                    tick={state.tick}
                    tickSeconds={tickSeconds}
                    paused={paused}
                    onTogglePause={handleTogglePause}
                    onFastForward={handleFastForward}
                  />
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
                activePreset={data.activePreset ?? null}
                onScenario={handleScenario}
                onFault={handleFault}
                onPreset={handlePreset}
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
            <Suspense fallback={<p role="status" className="py-20 text-center text-sm text-muted-foreground">正在加载后台管理…</p>}>
              <AdminPage setpoint={state?.bio.doSetpoint} onChange={load} />
            </Suspense>
          ) : !state || !data ? (
            <p className="py-20 text-center text-sm text-muted-foreground">正在连接仿真服务…</p>
          ) : (
            <div className="page-enter flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scroll-smooth lg:flex-row lg:overflow-hidden">
              <div className="flex min-w-0 flex-1 flex-col lg:overflow-y-auto lg:pr-2">
                <ProcessFlow
                  state={state}
                  limits={data.limits}
                  history={history}
                  adjustment={doAdjustment}
                  focusAdjustmentTick={focusAdjustmentTick}
                  sessionVersion={sessionVersion}
                  onRefresh={load}
                >
                  <section aria-labelledby="trend-heading" className="space-y-2.5">
                    <h3 id="trend-heading" className="flex items-center gap-2 text-sm font-semibold"><ChartNoAxesCombined aria-hidden className="size-4 text-primary" /> 关键参数趋势</h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
                      <TrendChart
                        title="好氧区 DO（测量值）"
                        unit="mg/L"
                        color="var(--chart-do)"
                        points={history.map((h) => h.measuredDo)}
                        current={state.measured.do === null ? "—" : state.measured.do.toFixed(2)}
                        reference={{ value: state.bio.doSetpoint, label: "目标" }}
                        referenceSeries={history.map((h) => h.doSetpoint)}
                        secondary={doAbnormal ? { points: history.map((h) => h.do), label: "仿真真值", color: "var(--success)" } : undefined}
                        ticks={ticks}
                        markers={chartMarkers}
                        clockMinutes={clockMinutes}
                      />
                      <TrendChart
                        title="曝气风量（反馈）"
                        unit="m³/h"
                        color="var(--chart-airflow)"
                        points={history.map((h) => h.measuredAirflow ?? h.airflow)}
                        current={(state.measured.airflow ?? state.bio.airflow).toFixed(0)}
                        secondary={airflowAbnormal ? { points: history.map((h) => h.airflow), label: "仿真真值", color: "var(--success)" } : undefined}
                        ticks={ticks}
                        markers={chartMarkers}
                        clockMinutes={clockMinutes}
                      />
                      <TrendChart
                        title="出水氨氮"
                        unit="mg/L"
                        color="var(--chart-nh4)"
                        points={history.map((h) => h.effNh4)}
                        current={state.effluent.nh4.toFixed(2)}
                        reference={{ value: data.limits.nh4InternalLimit, label: "内控" }}
                        ticks={ticks}
                        markers={chartMarkers}
                        clockMinutes={clockMinutes}
                      />
                      <TrendChart
                        title="风机功率"
                        unit="kW"
                        color="var(--chart-power)"
                        points={history.map((h) => h.power)}
                        current={state.blower.power.toFixed(1)}
                        ticks={ticks}
                        markers={chartMarkers}
                        clockMinutes={clockMinutes}
                      />
                    </div>
                  </section>
                </ProcessFlow>
              </div>
              <AdvicePanel
                activeAdvices={activeAdvices}
                doAdjustment={doAdjustment}
                monitorStatus={data.monitorStatus}
                onFocusAdjustment={() => setFocusAdjustmentTick((tick) => tick + 1)}
                onAction={load}
                terms={data.terms ?? []}
              />
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
