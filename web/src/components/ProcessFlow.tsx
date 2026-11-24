import { useId, useState, type ReactNode } from "react";
import {
  Activity, ArrowDownToDot, ArrowUpRight, Biohazard, Fan, Filter, FlaskConical,
  Layers, Recycle, ShieldCheck, type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TrendChart } from "@/components/TrendChart";
import { DoAdjustment } from "@/components/DoAdjustment";
import { DO_ADJUSTMENT, type DoAdjustmentAdvice } from "@/lib/advice";

type Status = "normal" | "warning" | "danger";
type Metric = [label: string, value: string, unit?: string];

interface Stage {
  id: string;
  title: string;
  icon: LucideIcon;
  description: string;
  status?: Status;
  note?: string;
  metrics: Metric[];
  trend?: {
    key: string;
    color: string;
    reference?: { value: number; label: string };
  };
}

const STATUS_LABEL: Record<Status, string> = { normal: "正常", warning: "关注", danger: "异常" };
const NODE = { width: 180, height: 138, left: 20, top: 60, gap: 38 };
const RETURN_Y = 24;
const SLUDGE_Y = 224;
const CANVAS_HEIGHT = 246;

function StageStatus({ status }: { status: Status }) {
  return (
    <Badge variant="outline" data-status={status} className="stage-status gap-1.5 px-2 py-0.5 text-[11px]">
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function StageDetails({ stage, history, children }: { stage: Stage; history: any[]; children: ReactNode }) {
  const { title, icon: Icon, metrics, status = "normal", trend } = stage;
  const [label, value, unit] = metrics[0];
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
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
  );
}

function StageCard({ stage, history }: { stage: Stage; history: any[] }) {
  const { title, icon: Icon, metrics, status = "normal" } = stage;
  const [label, value, unit] = metrics[0];

  return (
    <article
      className="stage-card stage-enter relative flex min-w-0 flex-col gap-2.5 rounded-xl border p-3.5 sm:p-4"
      data-status={status}
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
        <span className="stage-open ml-auto flex items-center gap-1 text-primary">详情 <ArrowUpRight className="size-3.5" /></span>
      </footer>
      <StageDetails stage={stage} history={history}>
        <Button
          type="button" variant="ghost"
          aria-label={"查看" + title + "详情"}
          className="absolute inset-0 z-10 h-full w-full rounded-xl p-0 hover:bg-transparent"
        />
      </StageDetails>
    </article>
  );
}

function PipeLabel({ x, y, width, children }: { x: number; y: number; width: number; children: string }) {
  const height = 24;
  return (
    <g className="process-pipe-label">
      <rect x={x} y={y - height / 2} width={width} height={height} rx={5} />
      <text x={x + width / 2} y={y} dy="0.35em" textAnchor="middle">{children}</text>
    </g>
  );
}

function ProcessDiagram({ stages, history, adjustmentOpen, onOpenAdjustment }: {
  stages: Stage[];
  history: any[];
  adjustmentOpen: boolean;
  onOpenAdjustment: () => void;
}) {
  const id = useId();
  const nodes = stages.map((stage, index) => {
    const x = NODE.left + index * (NODE.width + NODE.gap);
    return { stage, x, center: x + NODE.width / 2 };
  });
  const trunkY = NODE.top + NODE.height / 2;
  const width = NODE.left * 2 + NODE.width * nodes.length + NODE.gap * (nodes.length - 1);
  const pretreatmentX = nodes.find(({ stage }) => stage.id === "pretreatment")!.center;
  const membraneX = nodes.find(({ stage }) => stage.id === "membrane")!.center;
  const returnLabelWidth = 104;
  const sludgeLabelWidth = 100;
  const sludgeLabelX = width - NODE.left - (NODE.width + sludgeLabelWidth) / 2;

  return (
    <section aria-labelledby="main-process" className="space-y-2">
      <h3 id="main-process" className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground"><Layers aria-hidden className="size-3.5 text-primary" /> 主处理流程</h3>
      <div className="process-canvas" role="region" aria-label="主处理流程画布" tabIndex={0}>
        <svg
          className="process-diagram"
          viewBox={`0 0 ${width} ${CANVAS_HEIGHT}`}
          width={width}
          height={CANVAS_HEIGHT}
          role="group"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-description`}
        >
          <title id={`${id}-title`}>主处理流程图</title>
          <desc id={`${id}-description`}>{stages.map(({ title }) => title).join("，流向")}。膜池排空水返回预处理，剩余污泥进入污泥处理线。</desc>
          <defs>
            {["water", "auxiliary"].map((kind) => (
              <marker key={kind} id={`${id}-${kind}`} markerWidth={10} markerHeight={10} viewBox="0 0 10 10" refX={10} refY={5} markerUnits="userSpaceOnUse" orient="auto">
                <path className={`process-marker-${kind}`} d="M 0 0 L 10 5 L 0 10 Z" />
              </marker>
            ))}
          </defs>
          <g aria-hidden="true">
            {nodes.slice(0, -1).map(({ stage, x }, index) => (
              <g key={stage.id}>
                <path className="process-pipe" d={`M ${x + NODE.width} ${trunkY} H ${nodes[index + 1].x}`} markerEnd={`url(#${id}-water)`} />
                <path className="process-pipe-motion" d={`M ${x + NODE.width} ${trunkY} H ${nodes[index + 1].x - 10}`} />
              </g>
            ))}
            <path className="process-pipe-auxiliary" d={`M ${membraneX} ${NODE.top} V ${RETURN_Y} H ${pretreatmentX} V ${NODE.top}`} markerEnd={`url(#${id}-auxiliary)`} />
            <path className="process-pipe-auxiliary" d={`M ${membraneX} ${NODE.top + NODE.height} V ${SLUDGE_Y} H ${sludgeLabelX}`} markerEnd={`url(#${id}-auxiliary)`} />
            <PipeLabel x={(pretreatmentX + membraneX - returnLabelWidth) / 2} y={RETURN_Y} width={returnLabelWidth}>膜池排空回流</PipeLabel>
            <PipeLabel x={sludgeLabelX} y={SLUDGE_Y} width={sludgeLabelWidth}>污泥处理线</PipeLabel>
          </g>
          {nodes.map(({ stage, x }, index) => {
            const isAdjustmentTarget = stage.id === DO_ADJUSTMENT.stageId;
            return (
              <foreignObject key={stage.id} x={x} y={NODE.top} width={NODE.width} height={NODE.height}>
                <article className="process-node" data-status={stage.status ?? "normal"}>
                  <header className="flex items-center justify-between text-xs font-semibold tabular-nums text-muted-foreground">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <span aria-hidden="true" className="process-node-dot" />
                  </header>
                  <h4 className="text-base leading-tight font-semibold">{stage.title}</h4>
                  <dl className="process-node-metrics">
                    {stage.metrics.slice(0, 2).map(([label, value, unit]) => (
                      <div key={label} className="flex items-baseline justify-between gap-1">
                        <dt className="truncate text-muted-foreground">{label}</dt>
                        <dd className="max-w-[64%] shrink-0 truncate font-semibold tabular-nums">{value}{unit && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>}</dd>
                      </div>
                    ))}
                  </dl>
                  <footer className="flex items-center justify-between">
                    <span className="process-node-status">{STATUS_LABEL[stage.status ?? "normal"]}</span>
                    {isAdjustmentTarget ? (
                      <Button
                        id={DO_ADJUSTMENT.nodeId}
                        type="button"
                        size="sm"
                        className="relative z-10 h-6 px-2 font-semibold"
                        aria-label={`${DO_ADJUSTMENT.buttonLabel}（${DO_ADJUSTMENT.stageName}）`}
                        aria-expanded={adjustmentOpen}
                        aria-controls={adjustmentOpen ? DO_ADJUSTMENT.panelId : undefined}
                        onClick={onOpenAdjustment}
                      >
                        {DO_ADJUSTMENT.buttonLabel}
                      </Button>
                    ) : <ArrowUpRight aria-hidden className="size-3.5 text-muted-foreground" />}
                  </footer>
                  <StageDetails stage={stage} history={history}>
                    <button type="button" className="process-node-trigger" aria-label={"查看" + stage.title + "详情"} />
                  </StageDetails>
                </article>
              </foreignObject>
            );
          })}
        </svg>
      </div>
      <p className="process-scroll-hint text-xs text-muted-foreground">横向滑动查看完整流程</p>
    </section>
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

export function ProcessFlow({ state, limits, history, adjustment, onRefresh, children }: {
  state: any;
  limits: any;
  history: any[];
  adjustment: DoAdjustmentAdvice | null;
  onRefresh: () => Promise<void>;
  children?: ReactNode;
}) {
  const [selection, setSelection] = useState<{ advice: DoAdjustmentAdvice | null } | null>(null);
  const openedAdvice = selection?.advice ?? null;
  const { influent, bio, measured, membrane, effluent, blower } = state;
  const airflowBad = measured.airflowQuality === "bad";
  const feedbackAirflow = measured.airflow ?? bio.airflow;
  const doValue = measured.do === null ? "—" : measured.do.toFixed(2);
  const biologicalStage: Stage = {
    id: DO_ADJUSTMENT.stageId, title: DO_ADJUSTMENT.stageName, icon: Biohazard, description: "好氧区 DO 目标值由人工确认，风量由仿真联动系统调节。",
    status: doStatus(measured.do, bio.doSetpoint, measured.doQuality),
    note: measured.doQuality === "bad" ? "DO 数据异常" : measured.doQuality === "suspect" ? "DO 数据可疑" : "DO 测量正常",
    metrics: [
      ["DO 测量值", doValue, "mg/L"], ["DO 目标值", bio.doSetpoint.toFixed(1), "mg/L"],
      ["曝气风量", bio.airflow.toFixed(0), "m³/h"], ["MLSS", bio.mlss.toFixed(0), "mg/L"],
      ["需氧量", bio.our.toFixed(0), "kgO₂/h"],
    ],
    trend: { key: "measuredDo", color: "var(--chart-do)", reference: { value: bio.doSetpoint, label: "DO 目标" } },
  };
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
      metrics: [["格栅液位差", "0.12", "m"], ["来水流量", influent.flow.toFixed(0), "m³/h"], ["粗格栅", "运行正常"], ["细格栅", "运行正常"], ["膜格栅", "运行正常"]],
    },
    biologicalStage,
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
      trend: { key: "effNh4", color: "var(--chart-nh4)", reference: { value: limits.nh4InternalLimit, label: "氨氮内控" } },
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
      trend: { key: "measuredAirflow", color: "var(--chart-airflow)" },
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
            点击「生化池」卡片上的「调节 DO」打开调节区。点击卡片可查看完整指标。
          </p>
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
      <ProcessDiagram
        stages={process}
        history={history}
        adjustmentOpen={selection !== null}
        onOpenAdjustment={openAdjustment}
      />
      {selection && (
        <DoAdjustment
          key={openedAdvice?.id}
          advice={openedAdvice}
          currentSetpoint={bio.doSetpoint}
          available={openedAdvice !== null && adjustment?.id === openedAdvice.id && adjustment.from === openedAdvice.from && adjustment.to === openedAdvice.to}
          hasNewAdvice={adjustment !== null && adjustment.id !== openedAdvice?.id}
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
