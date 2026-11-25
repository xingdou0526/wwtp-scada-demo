import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveOperationFeedback, type OperationRecord } from "@/lib/api";

export function FeedbackForm({ operation, onSaved }: { operation: OperationRecord; onSaved: (record: OperationRecord) => void }) {
  const [note, setNote] = useState(operation.operatorNote ?? "");
  const [evaluation, setEvaluation] = useState(operation.feedback?.evaluation ?? "");
  const [effectiveness, setEffectiveness] = useState(String(operation.feedback?.effective ?? "unknown"));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const saved = await saveOperationFeedback(operation.id, {
        operatorNote: note,
        evaluation,
        effective: effectiveness === "unknown" ? null : effectiveness === "true",
      });
      setNote(saved.operatorNote);
      setEvaluation(saved.feedback?.evaluation ?? "");
      onSaved(saved);
      setMessage("已保存人工反馈");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form aria-labelledby="feedback-heading" className="space-y-3 border-t pt-4" onSubmit={handleSubmit} onChange={() => setMessage("")}>
      <h4 id="feedback-heading" className="text-sm font-semibold">人工反馈</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="operation-note">人工备注</Label>
          <Textarea id="operation-note" rows={3} maxLength={1000} disabled={saving} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="operation-evaluation">实际效果评价</Label>
          <Textarea id="operation-evaluation" rows={3} maxLength={1000} disabled={saving} value={evaluation} onChange={(event) => setEvaluation(event.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="operation-effective" className="block">建议有效性</Label>
        <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,7rem)] items-stretch gap-3">
          <Select value={effectiveness} disabled={saving} onValueChange={(value) => { setEffectiveness(value); setMessage(""); }}>
            <SelectTrigger id="operation-effective"><SelectValue /></SelectTrigger>
            <SelectContent position="item-aligned">
              <SelectItem value="unknown">未判断</SelectItem>
              <SelectItem value="true">有效</SelectItem>
              <SelectItem value="false">无效</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={saving}><Save aria-hidden />{saving ? "保存中…" : "保存反馈"}</Button>
        </div>
      </div>
      {message && <p role="status" className="text-sm text-success">{message}</p>}
      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
    </form>
  );
}
