import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveLimits, type RuleLimits } from "@/lib/admin";

const RULE_FIELDS = [
  { key: "doSetpointMin", label: "DO 目标下限", unit: "mg/L", step: "0.1" },
  { key: "doSetpointMax", label: "DO 目标上限", unit: "mg/L", step: "0.1" },
  { key: "doSetpointStep", label: "DO 单次调整步长", unit: "mg/L", step: "0.1" },
  { key: "nh4InternalLimit", label: "出水氨氮内控值", unit: "mg/L", step: "any" },
  { key: "airflowMin", label: "风量下限", unit: "m³/h", step: "1" },
  { key: "airflowMax", label: "风量上限", unit: "m³/h", step: "1" },
  { key: "minExecuteInterval", label: "最小调节间隔", unit: "仿真分钟", step: "1" },
  { key: "reviewAfter", label: "执行后复评等待时间", unit: "仿真分钟", step: "1" },
] as const;

function ruleDraft(limits: RuleLimits) {
  return Object.fromEntries(RULE_FIELDS.map(({ key }) => [key, String(limits[key])])) as Record<keyof RuleLimits, string>;
}

export function RuleEditor({ limits, setpoint, onSaved }: { limits: RuleLimits; setpoint?: number; onSaved: (limits: RuleLimits) => void }) {
  const [draft, setDraft] = useState(() => ruleDraft(limits));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean }>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(undefined);
    if (Object.values(draft).some((value) => !value.trim())) {
      setFeedback({ message: "请填写所有规则参数", error: true });
      return;
    }
    setBusy(true);
    try {
      const next = Object.fromEntries(RULE_FIELDS.map(({ key }) => [key, Number(draft[key])])) as unknown as RuleLimits;
      const saved = await saveLimits(next);
      setDraft(ruleDraft(saved));
      onSaved(saved);
      setFeedback({ message: "规则参数已生效" });
    } catch (cause) {
      setFeedback({ message: (cause as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="max-w-4xl space-y-5 p-4 sm:p-6" noValidate onSubmit={submit}>
      <header className="space-y-1">
        <h3 className="font-semibold">曝气仿真规则</h3>
        <p className="text-sm text-muted-foreground">保存后按新参数生成建议，现有复评按执行时的时间安排。</p>
        {setpoint !== undefined && <Badge variant="secondary">当前 DO 目标值 {setpoint.toFixed(1)} mg/L</Badge>}
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {RULE_FIELDS.map(({ key, label, unit, step }) => (
          <div key={key} className="space-y-2 rounded-lg border bg-muted p-3">
            <Label htmlFor={`rule-${key}`}>{label}</Label>
            <div className="flex items-center gap-2">
              <Input id={`rule-${key}`} type="number" min={0} step={step} value={draft[key]} disabled={busy}
                className="bg-card tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                onChange={(event) => setDraft((previous) => ({ ...previous, [key]: event.target.value }))} />
              <span className="shrink-0 text-xs text-muted-foreground">{unit}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="submit" className="w-30" disabled={busy}><Save aria-hidden /> {busy ? "保存中…" : "保存规则"}</Button>
        {feedback && <p role={feedback.error ? "alert" : "status"} className={`text-sm ${feedback.error ? "text-critical" : "text-success"}`}>{feedback.message}</p>}
      </div>
    </form>
  );
}
