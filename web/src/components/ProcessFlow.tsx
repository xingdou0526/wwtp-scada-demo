import type { CSSProperties, ReactNode } from "react";
import {
  Activity, ArrowDownToDot, ArrowUpRight, Biohazard, Fan, Filter, FlaskConical,
  Layers, Recycle, ShieldCheck, type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TrendChart } from "@/components/TrendChart";

type Status = "normal" | "warning" | "danger";
type Metric = [label: string, value: string, unit?: string];

interface Stage {
  id: string;
  title: string;
  icon: LucideIcon;
  description: string;
  status?: Status;
  featured?: boolean;
  note?: string;
  metrics: Metric[];
  trend?: {
    key: string;
    color: string;
    reference?: { value: number; label: string };
  };
}

const STATUS_LABEL: Record<Status, string> = { normal: "正常", warning: "关注", danger: "异常" };

function StageStatus({ status }: { status: Status }) {
  return (
    <Badge variant="outline" data-status={status} className="stage-status gap-1.5 px-2 py-0.5 text-[11px]">
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function StageCard({ stage, history, order }: { stage: Stage; history: any[]; order?: number }) {
  const { title, icon: Icon, metrics, status = "normal" } = stage;
  const [label, value, unit] = metrics[0];
  const trend = stage.trend;

  return (
    <article
      className="stage-card stage-enter relative flex min-w-0 flex-col gap-2.5 rounded-xl border p-3.5 sm:p-4"
      data-status={status}
      data-featured={stage.featured || undefined}
      style={{ "--stage-order": order ?? 0 } as CSSProperties}
    >
      <header className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary"><Icon aria-hidden className="size-3.5" /></span>
          <h4 className="text-sm font-semibold leading-snug">{title}</h4>
        </div>
        <StageStatus status={status} />
      </header>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
          <span className="text-lg font-semibold tracking-tight tabular-nums xl:text-xl">{value}</span>
          {unit && <span className="text-[11px] text-muted-foreground">{unit}</span>}
        </p>
      </div>
      <dl className="flex-1 space-y-1.5 border-t pt-2.5">
        {metrics.slice(1, 4).map(([metric, reading, suffix]) => (
          <div key={metric} className="flex flex-wrap items-baseline justify-between gap-x-1 text-xs">
            <dt className="text-muted-foreground">{metric}</dt>
            <dd className="font-medium tabular-nums">{reading}{suffix && <span className="ml-1 text-[10px] text-muted-foreground">{suffix}</span>}</dd>
          </div>
        ))}
      </dl>
      <footer aria-hidden className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
        {order !== undefined && <span>{"流程 " + String(order + 1).padStart(2, "0")}</span>}
        <span className="stage-open ml-auto flex items-center gap-1 text-primary">详情 <ArrowUpRight className="size-3.5" /></span>
      </footer>
      <Dialog>
        <DialogTrigger asChild>
          <Button
            type="button" variant="ghost"
            aria-label={"查看" + title + "详情"}
            className="absolute inset-0 z-10 h-full w-full rounded-xl p-0 hover:bg-transparent"
          />
        </DialogTrigger>
        <DialogContent className="gap-5 bg-card sm:max-w-[42rem]">
          <DialogHeader className="pr-6 text-left">
            <DialogTitle className="flex items-center gap-2"><Icon aria-hidden className="size-5 text-primary" /> {title}</DialogTitle>
            <DialogDescription>{stage.description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <StageStatus status={status} />
            {stage.note && <p className="text-sm text-muted-foreground">{stage.note}</p>}
          </div>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {metrics.map(([metric, reading, suffix]) => (
              <div key={metric} className="rounded-lg border bg-muted p-3">
                <dt className="text-xs text-muted-foreground">{metric}</dt>
                <dd className="mt-1 font-semibold tabular-nums">{reading}{suffix && <span className="ml-1 text-xs font-normal text-muted-foreground">{suffix}</span>}</dd>
              </div>
            ))}
          </dl>
          {trend && (
            <TrendChart
              title={label} unit={unit ?? ""} current={value} color={trend.color} reference={trend.reference}
              points={history.map((sample) => sample[trend.key] ?? null)}
              clockMinutes={history.map((sample) => sample.clockMinutes)}
            />
          )}
        </DialogContent>
      </Dialog>
    </article>
  );
}

function doStatus(value: number | null, target: number, quality: string): Status {
  if (quality === "bad" || value === null) return "danger";
  if (quality === "suspect") return "warning";
  const difference = Math.abs(value - target);
  if (difference > 0.8) return "danger";
  return difference > 0.35 ? "warning" : "normal";
}

function nh4Status(value: number, limit: number): Status {
  if (value >= limit) return "danger";
  return value >= limit * 0.5 ? "warning" : "normal";
}

export function ProcessFlow({ state, limits, history, children }: { state: any; limits: any; history: any[]; children?: ReactNode }) {
  const { influent, bio, measured, membrane, effluent, blower } = state;
  const airflowBad = measured.airflowQuality === "bad";
  const feedbackAirflow = measured.airflow ?? bio.airflow;
  const doValue = measured.do === null ? "—" : measured.do.toFixed(2);
  const process: Stage[] = [
    {
      id: "inlet", title: "进水口", icon: ArrowDownToDot, description: "观察进水流量、水质与水温，识别负荷变化。",
      metrics: [
        ["瞬时流量", influent.flow.toFixed(0), "m³/h"], ["COD", influent.cod.toFixed(1), "mg/L"],
        ["进水氨氮", influent.nh4.toFixed(1), "mg/L"], ["水温", influent.temp.toFixed(0), "℃"],
      ],
      trend: { key: "flow", color: "var(--primary)" },
    },
    {
      id: "pretreatment", title: "预处理", icon: Filter, description: "粗格栅、细格栅及膜格栅按流程截留进水杂物。",
      metrics: [["栅前后液位差", "0.12", "m"], ["粗格栅", "运行正常"], ["细格栅", "运行正常"], ["膜格栅", "运行正常"]],
    },
    {
      id: "biological", title: "生化池", icon: Biohazard, description: "好氧区 DO 目标值由人工确认，风量由仿真联动系统调节。",
      featured: true,
      status: doStatus(measured.do, bio.doSetpoint, measured.doQuality),
      note: measured.doQuality === "bad" ? "DO 数据异常" : measured.doQuality === "suspect" ? "DO 数据可疑" : "DO 测量正常",
      metrics: [
        ["DO 测量值", doValue, "mg/L"], ["DO 目标值", bio.doSetpoint.toFixed(1), "mg/L"],
        ["曝气风量", bio.airflow.toFixed(0), "m³/h"], ["MLSS", bio.mlss.toFixed(0), "mg/L"],
        ["需氧量", bio.our.toFixed(0), "kgO₂/h"],
      ],
      trend: { key: "measuredDo", color: "var(--primary)", reference: { value: bio.doSetpoint, label: "DO 目标" } },
    },
    {
      id: "membrane", title: "MBR 膜池", icon: Layers, description: "监测跨膜压差与膜通量，观察膜产水状态。",
      status: membrane.tmp >= 35 ? "danger" : membrane.tmp >= 25 ? "warning" : "normal",
      metrics: [["跨膜压差 TMP", membrane.tmp.toFixed(1), "kPa"], ["膜通量", membrane.flux.toFixed(1), "LMH"], ["运行模式", "抽吸产水"]],
      trend: { key: "tmp", color: "var(--primary)" },
    },
    {
      id: "outlet", title: "消毒出水", icon: ShieldCheck, description: "对照当前内控值观察出水氨氮及相关水质指标。",
      status: nh4Status(effluent.nh4, limits.nh4InternalLimit),
      metrics: [
        ["出水氨氮", effluent.nh4.toFixed(2), "mg/L"], ["氨氮内控值", String(limits.nh4InternalLimit), "mg/L"],
        ["出水 COD", effluent.cod.toFixed(1), "mg/L"], ["总氮", effluent.tn.toFixed(1), "mg/L"],
        ["总磷", effluent.tp.toFixed(2), "mg/L"],
      ],
      trend: { key: "effNh4", color: "var(--warning)", reference: { value: limits.nh4InternalLimit, label: "氨氮内控" } },
    },
  ];

  const support: Stage[] = [
    {
      id: "blower", title: "风机房", icon: Fan, description: "核对曝气风量反馈与风机电耗。反馈故障只影响测量链路。",
      status: airflowBad ? "danger" : "normal",
      note: airflowBad ? "风量反馈异常" : "风量反馈正常",
      metrics: [
        ["反馈风量", feedbackAirflow.toFixed(0), "m³/h"], ["风量仿真真值", bio.airflow.toFixed(0), "m³/h"],
        ["瞬时功率", blower.power.toFixed(1), "kW"], ["累计电耗", blower.energyKwh.toFixed(1), "kWh"],
        ["出口压力", blower.pressure.toFixed(1), "kPa"], ["电机电流", blower.current.toFixed(0), "A"],
      ],
      trend: { key: "measuredAirflow", color: "var(--success)" },
    },
    {
      id: "chemicals", title: "加药间", icon: FlaskConical, description: "查看加药系统的预设模拟数据及储罐状态。",
      metrics: [["碳源投加", "60.0", "L/h"], ["除磷剂投加", "62.2", "L/h"], ["次氯酸钠", "2.51", "L/min"], ["储罐液位", "正常"]],
    },
    {
      id: "sludge", title: "污泥处理线", icon: Recycle, description: "查看污泥浓缩、脱水及委外处置的预设状态。",
      metrics: [["泥饼含水率", "78.5", "%"], ["浓缩池", "运行正常"], ["脱水机", "运行正常"], ["处置方式", "委外处置"]],
    },
  ];
  const attention = [...process, ...support].filter(({ status }) => status && status !== "normal").length;

  return (
    <section aria-labelledby="process-heading" className="monitor-layout flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="process-heading" className="text-xl font-semibold tracking-tight">工艺总览</h2>
          <p className="mt-1 text-xs text-muted-foreground">点击卡片查看完整指标与对应趋势。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={attention ? "border-warning/40 bg-warning/10 text-warning" : "border-success/35 bg-success/10 text-success"}>
            <Activity aria-hidden className="size-3.5" /> {attention ? attention + " 个环节需关注" : "环节状态正常"}
          </Badge>
          <Button asChild variant="outline" size="sm" className="lg:hidden">
            <a href="#advice-panel">查看建议</a>
          </Button>
        </div>
      </header>
      <section aria-labelledby="main-process" className="space-y-2.5">
        <h3 id="main-process" className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground"><Layers aria-hidden className="size-3.5 text-primary" /> 主处理流程</h3>
        <div className="process-grid">{process.map((stage, order) => <StageCard key={stage.id} stage={stage} history={history} order={order} />)}</div>
      </section>
      {children}
      <section aria-labelledby="support-process" className="space-y-2.5">
        <h3 id="support-process" className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground"><Fan aria-hidden className="size-3.5 text-primary" /> 配套设施</h3>
        <div className="support-grid">{support.map((stage) => <StageCard key={stage.id} stage={stage} history={history} />)}</div>
      </section>
    </section>
  );
}
