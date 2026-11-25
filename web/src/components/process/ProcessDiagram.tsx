import { useId } from "react";
import { ArrowUpRight, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StageDetails } from "@/components/process/StageCards";
import { STATUS_LABEL, type Stage } from "@/components/process/stages";
import { DO_ADJUSTMENT } from "@/lib/advice";
import type { HistoryPoint } from "@/lib/types";

const NODE = { width: 180, height: 138, left: 20, top: 60, gap: 38 };
const RETURN_Y = 24;
const SLUDGE_Y = 224;
const CANVAS_HEIGHT = 246;

function PipeLabel({ x, y, width, children }: { x: number; y: number; width: number; children: string }) {
  const height = 24;
  return (
    <g className="process-pipe-label">
      <rect x={x} y={y - height / 2} width={width} height={height} rx={5} />
      <text x={x + width / 2} y={y} dy="0.35em" textAnchor="middle">{children}</text>
    </g>
  );
}

export function ProcessDiagram({ stages, history, adjustmentOpen, onOpenAdjustment }: {
  stages: Stage[];
  history: HistoryPoint[];
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
                    <button type="button" className="process-node-trigger" aria-label={`查看${stage.title}详情`} />
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
