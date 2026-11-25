import { useEffect, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requestJson } from "@/lib/api";
import type { CompareResponse, CompareScenario } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatDelta(value: number, unit: string, digits: number, suffix = "") {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)} ${unit}${suffix}`;
}

function ScenarioCompareCard({ item }: { item: CompareScenario }) {
  const { fixed, assisted, delta } = item;
  const savedEnergy = delta.kwh < 0;
  const reducedOver = delta.overLimitMinutes < 0;

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">{item.title}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {savedEnergy && (
            <Badge variant="secondary" className="bg-success/10 text-success">
              节电 {Math.abs(delta.kwhPct).toFixed(1)}%（{delta.kwh.toFixed(2)} kWh）
            </Badge>
          )}
          {reducedOver && (
            <Badge variant="secondary" className="bg-success/10 text-success">
              超内控减少 {Math.abs(delta.overLimitMinutes)} min
            </Badge>
          )}
          <Badge variant="outline" className="tabular-nums">人工确认 {assisted.operations} 次</Badge>
        </div>
      </header>
      <div className="rounded-lg border">
        <Table className="text-xs tabular-nums sm:text-sm">
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead scope="col" className="h-9 px-2.5">评估指标</TableHead>
              <TableHead scope="col" className="h-9 px-2.5 text-right">固定目标（{fixed.finalSetpoint.toFixed(1)}）</TableHead>
              <TableHead scope="col" className="h-9 px-2.5 text-right">AI 辅助采纳</TableHead>
              <TableHead scope="col" className="h-9 px-2.5 text-right">差值</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <th scope="row" className="px-2.5 py-2 text-left font-medium">累计风机电耗</th>
              <TableCell className="px-2.5 py-2 text-right">{fixed.kwh.toFixed(2)} kWh</TableCell>
              <TableCell className="px-2.5 py-2 text-right font-semibold">{assisted.kwh.toFixed(2)} kWh</TableCell>
              <TableCell className={cn("px-2.5 py-2 text-right font-medium", delta.kwh < 0 ? "text-success" : delta.kwh > 0 ? "text-warning" : "")}>
                {formatDelta(delta.kwh, "kWh", 2, ` (${delta.kwhPct > 0 ? "+" : ""}${delta.kwhPct.toFixed(1)}%)`)}
              </TableCell>
            </TableRow>
            <TableRow>
              <th scope="row" className="px-2.5 py-2 text-left font-medium">好氧区最低 DO</th>
              <TableCell className="px-2.5 py-2 text-right">{fixed.minDo.toFixed(2)} mg/L</TableCell>
              <TableCell className="px-2.5 py-2 text-right font-semibold">{assisted.minDo.toFixed(2)} mg/L</TableCell>
              <TableCell className="px-2.5 py-2 text-right">{formatDelta(delta.minDo, "mg/L", 2)}</TableCell>
            </TableRow>
            <TableRow>
              <th scope="row" className="px-2.5 py-2 text-left font-medium">出水氨氮峰值</th>
              <TableCell className="px-2.5 py-2 text-right">{fixed.maxNh4.toFixed(2)} mg/L</TableCell>
              <TableCell className="px-2.5 py-2 text-right font-semibold">{assisted.maxNh4.toFixed(2)} mg/L</TableCell>
              <TableCell className={cn("px-2.5 py-2 text-right font-medium", delta.maxNh4 < 0 ? "text-success" : "")}>
                {formatDelta(delta.maxNh4, "mg/L", 2)}
              </TableCell>
            </TableRow>
            <TableRow>
              <th scope="row" className="px-2.5 py-2 text-left font-medium">出水超内控时长</th>
              <TableCell className="px-2.5 py-2 text-right">{fixed.overLimitMinutes} min</TableCell>
              <TableCell className="px-2.5 py-2 text-right font-semibold">{assisted.overLimitMinutes} min</TableCell>
              <TableCell className={cn("px-2.5 py-2 text-right font-medium", delta.overLimitMinutes < 0 ? "text-success" : "")}>
                {delta.overLimitMinutes > 0 ? `+${delta.overLimitMinutes}` : delta.overLimitMinutes} min
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function CompareBody() {
  const [data, setData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    requestJson<CompareResponse>("/api/compare", { signal: controller.signal })
      .then((res) => { if (!controller.signal.aborted) setData(res); })
      .catch((cause) => { if (!controller.signal.aborted) setError((cause as Error).message); });
    return () => controller.abort();
  }, [attempt]);

  if (error) {
    return (
      <div className="flex items-center gap-3 py-6">
        <p role="alert" className="text-sm text-critical">{error}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>重试</Button>
      </div>
    );
  }
  if (!data) {
    return <p role="status" className="py-12 text-center text-sm text-muted-foreground">正在运行同随机种子基线仿真对比…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        <span>
          基于当前后台规则参数（氨氮内控 {data.nh4InternalLimit} mg/L），在相同随机种子（{data.seed}）与相同进水负荷下各运行 {data.durationMinutes} 仿真分钟。
        </span>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setAttempt((n) => n + 1)}>
          <RefreshCw aria-hidden className="size-3.5" /> 重新测算
        </Button>
      </div>
      <div className="space-y-4">
        {data.scenarios.map((item) => <ScenarioCompareCard key={item.key} item={item} />)}
      </div>
    </div>
  );
}

export function EffectCompareDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5 text-xs">
          <BarChart3 aria-hidden className="size-3.5 text-primary" /> 效果对比
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>固定目标 vs AI 辅助效果对比</DialogTitle>
          <DialogDescription>同进水负荷、同随机种子下的量化对照，用于评估节能潜力与抗冲击达标收益。</DialogDescription>
        </DialogHeader>
        <CompareBody />
      </DialogContent>
    </Dialog>
  );
}
