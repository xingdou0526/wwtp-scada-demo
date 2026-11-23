import type { ReactNode } from "react";
import {
  ArrowRight,
  ArrowDownToDot,
  Filter,
  Grid2x2,
  Biohazard,
  Layers,
  ShieldCheck,
  Fan,
  FlaskConical,
  Recycle,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "normal" | "warning" | "danger";

const statusStyles: Record<Status, string> = {
  normal: "border-emerald-500/40 bg-emerald-500/5",
  warning: "border-amber-500/50 bg-amber-500/10",
  danger: "border-red-500/50 bg-red-500/10",
};

const statusDot: Record<Status, string> = {
  normal: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

function DataRow({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 whitespace-nowrap text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">
        {value}
        {unit && <span className="ml-0.5 text-[10px] text-muted-foreground">{unit}</span>}
      </span>
    </div>
  );
}

function StageCard({
  title,
  icon,
  status = "normal",
  children,
  highlight = false,
}: {
  title: string;
  icon: ReactNode;
  status?: Status;
  children: ReactNode;
  highlight?: boolean;
}) {
  return (
    <article
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-2 rounded-lg border p-3",
        statusStyles[status],
        highlight && "ring-1 ring-primary/40"
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold">
          <span className="text-primary">{icon}</span>
          {title}
        </h3>
        <span className={cn("size-2 rounded-full", statusDot[status])} aria-label={status} />
      </header>
      <div className="flex flex-col gap-1">{children}</div>
    </article>
  );
}

function FlowArrow() {
  return <ArrowRight className="size-4 shrink-0 self-center text-muted-foreground" aria-hidden />;
}

function doStatus(doVal: number | null, setpoint: number, quality: string): Status {
  if (quality === "bad" || doVal === null) return "danger";
  if (quality === "suspect") return "warning";
  const diff = Math.abs(doVal - setpoint);
  if (diff > 0.8) return "danger";
  if (diff > 0.35) return "warning";
  return "normal";
}

function nh4Status(nh4: number, limit: number): Status {
  if (nh4 >= limit) return "danger";
  if (nh4 >= limit * 0.5) return "warning";
  return "normal";
}

export function ProcessFlow({ state, limits }: { state: any; limits: any }) {
  const { influent, bio, measured, membrane, effluent, blower } = state;
  const doSt = doStatus(measured.do, bio.doSetpoint, measured.doQuality);
  const outSt = nh4Status(effluent.nh4, limits.nh4InternalLimit);

  return (
    <section aria-label="工艺流程监控" className="flex flex-col gap-3">
      <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
        <div className="flex min-w-[1180px] flex-1 items-stretch gap-1.5">
        <StageCard title="进水口" icon={<ArrowDownToDot className="size-4" />}>
          <DataRow label="瞬时流量" value={influent.flow.toFixed(0)} unit="m³/h" />
          <DataRow label="COD" value={influent.cod.toFixed(1)} unit="mg/L" />
          <DataRow label="氨氮" value={influent.nh4.toFixed(1)} unit="mg/L" />
          <DataRow label="水温" value={influent.temp.toFixed(0)} unit="℃" />
        </StageCard>
        <FlowArrow />
        <StageCard title="预处理" icon={<Filter className="size-4" />}>
          <DataRow label="粗格栅" value="运行正常" />
          <DataRow label="细格栅" value="运行正常" />
          <DataRow label="膜格栅" value="运行正常" />
          <DataRow label="栅前后液位差" value="0.12" unit="m" />
        </StageCard>
        <FlowArrow />
        <StageCard title="生化池" icon={<Biohazard className="size-4" />} status={doSt} highlight>
          <div className="flex items-center justify-between gap-1">
            <DataRow label="DO(测量)" value={measured.do === null ? "--" : measured.do.toFixed(2)} unit="mg/L" />
            {measured.doQuality !== "good" && (
              <Badge variant={measured.doQuality === "bad" ? "destructive" : "secondary"} className="text-[10px]">
                <AlertTriangle className="size-3" />
                {measured.doQuality === "bad" ? "数据异常" : "数据可疑"}
              </Badge>
            )}
          </div>
          <DataRow label="DO 目标值" value={bio.doSetpoint.toFixed(1)} unit="mg/L" />
          <DataRow label="MLSS" value={bio.mlss.toFixed(0)} unit="mg/L" />
          <DataRow label="曝气风量" value={bio.airflow.toFixed(0)} unit="m³/h" />
          <DataRow label="需氧量" value={bio.our.toFixed(0)} unit="kgO₂/h" />
        </StageCard>
        <FlowArrow />
        <StageCard
          title="MBR 膜池"
          icon={<Layers className="size-4" />}
          status={membrane.tmp >= 35 ? "danger" : membrane.tmp >= 25 ? "warning" : "normal"}
        >
          <DataRow label="跨膜压差 TMP" value={membrane.tmp.toFixed(1)} unit="kPa" />
          <DataRow label="膜通量" value={membrane.flux.toFixed(1)} unit="LMH" />
          <DataRow label="运行模式" value="抽吸产水" />
        </StageCard>
        <FlowArrow />
        <StageCard title="消毒出水" icon={<ShieldCheck className="size-4" />} status={outSt} highlight>
          <DataRow label="出水氨氮" value={effluent.nh4.toFixed(2)} unit="mg/L" />
          <DataRow label="出水 COD" value={effluent.cod.toFixed(1)} unit="mg/L" />
          <DataRow label="总氮" value={effluent.tn.toFixed(1)} unit="mg/L" />
          <DataRow label="总磷" value={effluent.tp.toFixed(2)} unit="mg/L" />
        </StageCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <StageCard title="风机房（曝气供氧）" icon={<Fan className="size-4" />}>
          <div className="grid grid-cols-1 gap-x-4 2xl:grid-cols-2">
            <DataRow label="瞬时功率" value={blower.power.toFixed(1)} unit="kW" />
            <DataRow label="累计电耗" value={blower.energyKwh.toFixed(1)} unit="kWh" />
            <DataRow label="出口压力" value={blower.pressure.toFixed(1)} unit="kPa" />
            <DataRow label="电机电流" value={blower.current.toFixed(0)} unit="A" />
          </div>
        </StageCard>
        <StageCard title="加药间" icon={<FlaskConical className="size-4" />}>
          <div className="grid grid-cols-1 gap-x-4 2xl:grid-cols-2">
            <DataRow label="碳源投加" value="60.0" unit="L/h" />
            <DataRow label="除磷剂投加" value="62.2" unit="L/h" />
            <DataRow label="次氯酸钠" value="2.51" unit="L/min" />
            <DataRow label="储罐液位" value="正常" />
          </div>
        </StageCard>
        <StageCard title="污泥处理线" icon={<Recycle className="size-4" />}>
          <div className="grid grid-cols-1 gap-x-4 2xl:grid-cols-2">
            <DataRow label="浓缩池" value="运行正常" />
            <DataRow label="脱水机" value="运行正常" />
            <DataRow label="泥饼含水率" value="78.5" unit="%" />
            <DataRow label="处置方式" value="委外处置" />
          </div>
        </StageCard>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Grid2x2 className="size-3" />
        工艺主线：进水 → 粗/细格栅 → 膜格栅 → 生化池(A²/O) → MBR 膜池 → 消毒出水；污泥线：浓缩 → 脱水 → 委外处置
      </div>
    </section>
  );
}
