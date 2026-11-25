import {
  ArrowDownToDot, Biohazard, Fan, Filter, FlaskConical,
  Layers, Recycle, ShieldCheck, type LucideIcon,
} from "lucide-react";
import { DO_ADJUSTMENT } from "@/lib/advice";
import type { RuleLimits } from "@/lib/admin";
import type { DoFaultType, HistoryPoint, Quality, SimState } from "@/lib/types";

export type Status = "normal" | "warning" | "danger";
export type Metric = [label: string, value: string, unit?: string];

export interface Stage {
  id: string;
  title: string;
  icon: LucideIcon;
  description: string;
  status?: Status;
  note?: string;
  metrics: Metric[];
  trend?: {
    key: keyof HistoryPoint;
    color: string;
    reference?: { value: number; label: string };
    secondary?: { key: keyof HistoryPoint; label: string; color?: string };
  };
}

export const STATUS_LABEL: Record<Status, string> = { normal: "正常", warning: "关注", danger: "异常" };

function doStatus(value: number | null, target: number, quality: Quality): Status {
  if (quality === "bad" || value === null) return "danger";
  if (quality === "suspect") return "warning";
  const difference = Math.abs(value - target);
  if (difference > 0.8) return "danger";
  return difference > 0.35 ? "warning" : "normal";
}

function doQualityNote(value: number | null, target: number, quality: Quality, faultType: DoFaultType, airflowBad: boolean) {
  let doNote = "DO 测量正常";
  if (faultType === "offline") doNote = "DO 数据中断";
  else if (faultType === "stuck") doNote = "DO 数值卡死";
  else if (faultType === "spike") doNote = "DO 瞬时跳变（可疑）";
  else if (faultType === "drift") doNote = "DO 探头漂移（可疑）";
  else if (quality === "bad" || value === null) doNote = "DO 数据异常";
  else if (quality === "suspect") doNote = "DO 数据可疑";
  else {
    const diff = value - target;
    if (diff < -0.8) doNote = "DO 明显偏低（低于目标值）";
    else if (diff < -0.35) doNote = "DO 偏低，关注供氧";
    else if (diff > 0.8) doNote = "DO 明显偏高（暂态过冲或低负荷）";
    else if (diff > 0.35) doNote = "DO 偏高";
  }
  return airflowBad ? `${doNote} · 风量反馈异常` : doNote;
}

function nh4Status(value: number, limit: number): Status {
  if (value >= limit) return "danger";
  return value >= limit * 0.5 ? "warning" : "normal";
}

export function buildProcessStages(state: SimState, limits: RuleLimits) {
  const { influent, bio, measured, membrane, effluent, blower } = state;
  const airflowBad = measured.airflowQuality === "bad";
  const doAbnormal = measured.doQuality !== "good";
  const feedbackAirflow = measured.airflow ?? bio.airflow;
  const doValue = measured.do === null ? "—" : measured.do.toFixed(2);

  const biologicalStage: Stage = {
    id: DO_ADJUSTMENT.stageId,
    title: DO_ADJUSTMENT.stageName,
    icon: Biohazard,
    description: "好氧区 DO 目标值由人工确认，风量由仿真联动系统调节。详情中区分测量值与仿真真值。",
    status: doStatus(measured.do, bio.doSetpoint, measured.doQuality),
    note: doQualityNote(measured.do, bio.doSetpoint, measured.doQuality, measured.doFaultType, airflowBad),
    metrics: [
      ["DO 测量值", doValue, "mg/L"],
      ["DO 目标值", bio.doSetpoint.toFixed(1), "mg/L"],
      ["DO 仿真真值", bio.do.toFixed(2), "mg/L"],
      ["反馈风量", feedbackAirflow.toFixed(0), "m³/h"],
      ["MLSS", bio.mlss.toFixed(0), "mg/L"],
      ["需氧量", bio.our.toFixed(0), "kgO₂/h"],
    ],
    trend: {
      key: "measuredDo",
      color: "var(--chart-do)",
      reference: { value: bio.doSetpoint, label: "DO 目标" },
      secondary: doAbnormal ? { key: "do", label: "DO 仿真真值", color: "var(--success)" } : undefined,
    },
  };

  const process: Stage[] = [
    {
      id: "inlet",
      title: "进水口",
      icon: ArrowDownToDot,
      description: "观察进水流量、水质与水温，识别负荷变化。",
      metrics: [
        ["瞬时流量", influent.flow.toFixed(0), "m³/h"],
        ["COD", influent.cod.toFixed(1), "mg/L"],
        ["进水氨氮", influent.nh4.toFixed(1), "mg/L"],
        ["水温", influent.temp.toFixed(0), "℃"],
      ],
      trend: { key: "flow", color: "var(--primary)" },
    },
    {
      id: "pretreatment",
      title: "预处理",
      icon: Filter,
      description: "粗格栅、细格栅及膜格栅按流程截留进水杂物。",
      metrics: [
        ["格栅液位差", "0.12", "m"],
        ["来水流量", influent.flow.toFixed(0), "m³/h"],
        ["粗格栅", "运行正常"],
        ["细格栅", "运行正常"],
        ["膜格栅", "运行正常"],
      ],
    },
    biologicalStage,
    {
      id: "membrane",
      title: "MBR 膜池",
      icon: Layers,
      description: "监测跨膜压差与膜通量，观察膜产水状态。",
      status: membrane.tmp >= 35 ? "danger" : membrane.tmp >= 25 ? "warning" : "normal",
      metrics: [
        ["跨膜压差 TMP", membrane.tmp.toFixed(1), "kPa"],
        ["膜通量", membrane.flux.toFixed(1), "LMH"],
        ["运行模式", "抽吸产水"],
      ],
      trend: { key: "tmp", color: "var(--primary)" },
    },
    {
      id: "outlet",
      title: "消毒出水",
      icon: ShieldCheck,
      description: "对照当前内控值观察出水氨氮及相关水质指标。",
      status: nh4Status(effluent.nh4, limits.nh4InternalLimit),
      metrics: [
        ["出水氨氮", effluent.nh4.toFixed(2), "mg/L"],
        ["氨氮内控值", String(limits.nh4InternalLimit), "mg/L"],
        ["出水 COD", effluent.cod.toFixed(1), "mg/L"],
        ["总氮", effluent.tn.toFixed(1), "mg/L"],
        ["总磷", effluent.tp.toFixed(2), "mg/L"],
      ],
      trend: { key: "effNh4", color: "var(--chart-nh4)", reference: { value: limits.nh4InternalLimit, label: "氨氮内控" } },
    },
  ];

  const support: Stage[] = [
    {
      id: "blower",
      title: "风机房",
      icon: Fan,
      description: "核对曝气风量反馈与风机电耗。反馈故障只影响测量链路。",
      status: airflowBad ? "danger" : "normal",
      note: airflowBad ? "风量反馈异常" : "风量反馈正常",
      metrics: [
        ["反馈风量", feedbackAirflow.toFixed(0), "m³/h"],
        ["风量仿真真值", bio.airflow.toFixed(0), "m³/h"],
        ["瞬时功率", blower.power.toFixed(1), "kW"],
        ["累计电耗", blower.energyKwh.toFixed(1), "kWh"],
        ["出口压力", blower.pressure.toFixed(1), "kPa"],
        ["电机电流", blower.current.toFixed(0), "A"],
      ],
      trend: {
        key: "measuredAirflow",
        color: "var(--chart-airflow)",
        secondary: airflowBad ? { key: "airflow", label: "风量仿真真值", color: "var(--success)" } : undefined,
      },
    },
    {
      id: "chemicals",
      title: "加药间",
      icon: FlaskConical,
      description: "查看加药系统的预设模拟数据及储罐状态。",
      metrics: [["碳源投加", "60.0", "L/h"], ["除磷剂投加", "62.2", "L/h"], ["次氯酸钠", "2.51", "L/min"], ["储罐液位", "正常"]],
    },
    {
      id: "sludge",
      title: "污泥处理线",
      icon: Recycle,
      description: "查看污泥浓缩、脱水及委外处置的预设状态。",
      metrics: [["泥饼含水率", "78.5", "%"], ["浓缩池", "运行正常"], ["脱水机", "运行正常"], ["处置方式", "委外处置"]],
    },
  ];

  return { biologicalStage, process, support };
}
