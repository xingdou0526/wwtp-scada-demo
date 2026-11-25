import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatClock } from "@/lib/time";

export interface SecondarySeries {
  points: (number | null)[];
  label: string;
  color?: string;
}

export interface ChartMarker {
  tick: number;
  label: string;
}

interface TrendProps {
  title: string;
  unit: string;
  points: (number | null)[];
  color: string;
  current: string;
  reference?: { value: number; label: string };
  referenceSeries?: (number | null)[];
  secondary?: SecondarySeries;
  ticks?: number[];
  markers?: ChartMarker[];
  clockMinutes?: number[];
}

const WIDTH = 360;
const HEIGHT = 82;
const PADDING = 7;

interface Point {
  x: number;
  y: number;
}

function buildPaths(points: (number | null)[], step: number, getY: (value: number) => number) {
  const positions: (Point | null)[] = points.map((value, index) =>
    value !== null && Number.isFinite(value) ? { x: index * step, y: getY(value) } : null,
  );
  const segments: Point[][] = [];
  let segment: Point[] = [];
  for (const point of [...positions, null]) {
    if (point) {
      segment.push(point);
    } else if (segment.length) {
      segments.push(segment);
      segment = [];
    }
  }
  const lines = segments.map((line) =>
    line.map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
  );
  const area = lines
    .map((line, index) => {
      const seg = segments[index];
      const last = seg[seg.length - 1];
      return `${line} L${last.x.toFixed(1)},${HEIGHT} L${seg[0].x.toFixed(1)},${HEIGHT} Z`;
    })
    .join(" ");
  return { line: lines.join(" "), area, positions };
}

function plotTrend(
  points: (number | null)[],
  reference?: number,
  referenceSeries?: (number | null)[],
  secondaryPoints?: (number | null)[],
) {
  const values = [
    ...points,
    ...(referenceSeries ?? []),
    ...(secondaryPoints ?? []),
  ].filter((point): point is number => point !== null && Number.isFinite(point));
  if (reference !== undefined && Number.isFinite(reference)) values.push(reference);
  let min = values.length ? Math.min(...values) : 0;
  let max = values.length ? Math.max(...values) : 1;
  const range = Math.max(max - min, 0.5);
  const padding = range * 0.12;
  min -= padding;
  max = Number.isFinite(max + padding) ? max + padding : max;
  const getY = (value: number) => HEIGHT - PADDING - ((value - min) / (max - min)) * (HEIGHT - 2 * PADDING);
  const step = WIDTH / Math.max(1, points.length - 1);
  const primary = buildPaths(points, step, getY);
  const refPath = referenceSeries ? buildPaths(referenceSeries, step, getY).line : "";
  const secondary = secondaryPoints ? buildPaths(secondaryPoints, step, getY) : null;
  return {
    ...primary,
    step,
    refPath,
    secondaryLine: secondary?.line ?? "",
    min,
    max,
    refY: reference === undefined ? undefined : getY(reference),
  };
}

export function TrendChart({
  title,
  unit,
  points,
  color,
  current,
  reference,
  referenceSeries,
  secondary,
  ticks,
  markers,
  clockMinutes,
}: TrendProps) {
  const gradient = useId();
  const [index, setIndex] = useState<number | null>(null);
  const plot = useMemo(
    () => plotTrend(points, reference?.value, referenceSeries, secondary?.points),
    [points, reference?.value, referenceSeries, secondary?.points],
  );

  const markerPoints = useMemo(() => {
    if (!markers?.length || !ticks?.length) return [];
    const tickToIndex = new Map(ticks.map((tick, idx) => [tick, idx]));
    return markers
      .map((marker) => {
        const idx = tickToIndex.get(marker.tick);
        return idx === undefined ? null : { ...marker, index: idx, x: idx * plot.step };
      })
      .filter((item): item is ChartMarker & { index: number; x: number } => item !== null);
  }, [markers, ticks, plot.step]);

  const activeIndex = index === null || !points.length ? null : Math.min(index, points.length - 1);
  const sample = activeIndex === null ? null : plot.positions[activeIndex];
  const currentIndex = activeIndex ?? Math.max(0, points.length - 1);
  const digits = unit === "m³/h" ? 0 : 2;
  const sampleValue = points[currentIndex];
  const secondaryValue = secondary?.points[currentIndex];
  const sampleTime = clockMinutes?.[currentIndex];
  const activeMarker = activeIndex === null ? null : markerPoints.find((m) => Math.abs(m.index - activeIndex) <= 1) ?? null;
  const sampleLabel = typeof sampleValue === "number" && Number.isFinite(sampleValue)
    ? `${sampleValue.toFixed(digits)} ${unit}`
    : "无有效测量";
  const secondaryLabel = secondary && typeof secondaryValue === "number" && Number.isFinite(secondaryValue)
    ? `${secondary.label} ${secondaryValue.toFixed(digits)} ${unit}`
    : null;

  function handlePointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!points.length || !bounds.width) return;
    const fraction = (event.clientX - bounds.left) / bounds.width;
    setIndex(Math.max(0, Math.min(points.length - 1, Math.round(fraction * (points.length - 1)))));
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    const last = points.length - 1;
    if (last < 0) return;
    const from = activeIndex ?? last;
    const positions: Record<string, number> = { ArrowLeft: Math.max(0, from - 1), ArrowRight: Math.min(last, from + 1), Home: 0, End: last };
    if (!Object.hasOwn(positions, event.key)) return;
    event.preventDefault();
    setIndex(positions[event.key]);
  }

  const firstTime = clockMinutes?.[0];
  const lastTime = clockMinutes?.at(-1);
  const secondaryColor = secondary?.color ?? "var(--success)";

  return (
    <figure className="flex min-w-0 flex-col gap-2.5 rounded-xl border bg-card p-3.5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <span className="font-semibold tabular-nums" style={{ color }}>
          {current}<span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>
        </span>
      </figcaption>
      <div
        className="chart-grid relative cursor-crosshair overflow-hidden rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        role="slider"
        aria-label={`${title}历史采样`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, points.length - 1)}
        aria-valuenow={currentIndex}
        aria-valuetext={sampleTime === undefined ? sampleLabel : `${formatClock(sampleTime)}，${sampleLabel}`}
        tabIndex={0}
        onPointerMove={handlePointer}
        onPointerLeave={() => setIndex(null)}
        onFocus={() => setIndex(points.length ? points.length - 1 : null)}
        onBlur={() => setIndex(null)}
        onKeyDown={handleKeys}
      >
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-24 w-full" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1" gradientUnits="objectBoundingBox">
              <stop offset="0%" stopColor={color} stopOpacity=".20" />
              <stop offset="100%" stopColor={color} stopOpacity=".015" />
            </linearGradient>
          </defs>
          {plot.refPath ? (
            <path d={plot.refPath} fill="none" stroke="var(--muted-foreground)" strokeOpacity=".65" strokeWidth="1.2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          ) : reference && (
            <line x1="0" x2={WIDTH} y1={plot.refY} y2={plot.refY} stroke="var(--muted-foreground)" strokeOpacity=".65" strokeWidth="1" strokeDasharray="4 4" />
          )}
          <path d={plot.area} fill={`url(#${gradient})`} />
          {secondary && plot.secondaryLine && (
            <path d={plot.secondaryLine} fill="none" stroke={secondaryColor} strokeWidth="1.5" strokeDasharray="3 3" strokeOpacity=".85" vectorEffect="non-scaling-stroke" />
          )}
          <path d={plot.line} fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {markerPoints.map((marker) => (
            <g key={marker.tick}>
              <line x1={marker.x} x2={marker.x} y1="0" y2={HEIGHT} stroke="var(--critical)" strokeOpacity=".55" strokeWidth="1.2" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
              <circle cx={marker.x} cy="5" r="2.8" fill="var(--critical)" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {sample && (
            <>
              <line x1={sample.x} x2={sample.x} y1="0" y2={HEIGHT} stroke="var(--muted-foreground)" strokeOpacity=".7" strokeDasharray="3 3" />
              <circle cx={sample.x} cy={sample.y} r="3.8" fill={color} stroke="var(--background)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
        <div
          aria-hidden={activeIndex === null}
          className="pointer-events-none absolute top-1.5 right-1.5 flex flex-wrap justify-end gap-x-1.5 gap-y-0.5 rounded border border-border bg-popover/95 px-2 py-1 text-[10px] font-medium tabular-nums transition-opacity"
          style={{ opacity: activeIndex === null ? 0 : 1 }}
        >
          {sampleTime !== undefined && <span className="text-muted-foreground">{formatClock(sampleTime)}</span>}
          <span>{sampleLabel}</span>
          {secondaryLabel && <span style={{ color: secondaryColor }}>{secondaryLabel}</span>}
          {activeMarker && <span className="text-critical">{activeMarker.label}</span>}
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-1 text-[10px] tabular-nums text-muted-foreground">
        <span>{firstTime === undefined ? "较早" : formatClock(firstTime)}</span>
        <span className="flex flex-wrap items-center gap-2">
          {reference && (
            <span className="flex items-center gap-1"><span className="w-3 border-t border-dashed border-muted-foreground" />{reference.label} {reference.value} {unit}</span>
          )}
          {secondary && (
            <span className="flex items-center gap-1" style={{ color: secondaryColor }}>
              <span className="w-3 border-t border-dashed border-current" />{secondary.label}
            </span>
          )}
          {markerPoints.length > 0 && (
            <span className="flex items-center gap-1 text-critical">
              <span className="size-1.5 rounded-full bg-critical" />调节点 {markerPoints.length}
            </span>
          )}
          {!reference && !secondary && markerPoints.length === 0 && <span>{plot.min.toFixed(1)} – {plot.max.toFixed(1)} {unit}</span>}
        </span>
        <span>{lastTime === undefined ? "当前" : formatClock(lastTime)}</span>
      </div>
    </figure>
  );
}
