import { useMemo } from "react";

interface TrendProps {
  title: string;
  unit: string;
  points: (number | null)[];
  color: string;
  current: string;
  reference?: { value: number; label: string };
  height?: number;
}

// 轻量 SVG 趋势图，无第三方图表依赖
export function TrendChart({ title, unit, points, color, current, reference, height = 90 }: TrendProps) {
  const W = 360;
  const H = height;
  const PAD = 4;

  const { path, refY, min, max } = useMemo(() => {
    const nums = points.filter((p): p is number => p !== null && Number.isFinite(p));
    if (reference) nums.push(reference.value);
    if (!nums.length) return { path: "", refY: 0, min: 0, max: 1 };
    let min = Math.min(...nums);
    let max = Math.max(...nums);
    if (max - min < 0.5) {
      const mid = (max + min) / 2;
      min = mid - 0.25;
      max = mid + 0.25;
    }
    const range = max - min;
    min -= range * 0.1;
    max += range * 0.1;
    const y = (v: number) => H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);
    const step = W / Math.max(1, points.length - 1);
    let d = "";
    let started = false;
    points.forEach((p, i) => {
      if (p === null || !Number.isFinite(p)) {
        started = false;
        return;
      }
      d += `${started ? " L" : "M"}${(i * step).toFixed(1)},${y(p).toFixed(1)}`;
      started = true;
    });
    return { path: d, refY: reference ? y(reference.value) : 0, min, max };
  }, [points, reference, H]);

  return (
    <figure className="flex flex-col gap-1 rounded-lg border bg-card p-3">
      <figcaption className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <span className="font-mono text-sm font-semibold" style={{ color }}>
          {current}
          <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{unit}</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label={title}>
        {reference && (
          <line
            x1="0" x2={W} y1={refY} y2={refY}
            stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3"
          />
        )}
        <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>较早</span>
        <span>
          {min.toFixed(1)} ~ {max.toFixed(1)} {unit}
        </span>
        <span>当前</span>
      </div>
    </figure>
  );
}
