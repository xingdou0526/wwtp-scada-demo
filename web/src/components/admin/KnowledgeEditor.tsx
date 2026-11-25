import { useState, type ChangeEvent } from "react";
import { EditorActions, type CatalogActions } from "@/components/admin/Catalog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { KNOWLEDGE_FILE_LIMIT, type KnowledgeEntry, type KnowledgeInput } from "@/lib/admin";

export function KnowledgeEditor({ entry, save, remove, busy }: CatalogActions & { entry?: KnowledgeEntry }) {
  const [draft, setDraft] = useState<KnowledgeInput>(entry ?? { id: "", title: "", format: "text", content: "" });
  const [importing, setImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{ message: string; error?: boolean }>();

  function change<K extends keyof KnowledgeInput>(key: K, value: KnowledgeInput[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    setImporting(true);
    setImportFeedback(undefined);
    try {
      if (!/\.(txt|md|markdown)$/i.test(file.name)) throw new Error("请选择 .txt、.md 或 .markdown 文件");
      if (file.size > KNOWLEDGE_FILE_LIMIT) throw new Error("单个文件不能超过 64 KB");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (!content.trim() || content.includes("\0")) throw new Error("文件须包含有效文本");
      const format = /\.txt$/i.test(file.name) ? "text" : "markdown";
      setDraft((previous) => ({ ...previous, format, content, title: previous.title || file.name.replace(/\.[^.]+$/, "").slice(0, 100) }));
      setImportFeedback({ message: `已读取 ${file.name}，保存后入库` });
    } catch (cause) {
      setImportFeedback({ message: cause instanceof TypeError ? "无法读取该文件，请使用 UTF-8 编码的文本" : (cause as Error).message, error: true });
    } finally {
      setImporting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(draft); }}>
      <header className="space-y-1">
        <h3 className="font-semibold">{entry ? "编辑知识条目" : "新增知识条目"}</h3>
        {entry?.ruleLinked && <p className="text-sm text-muted-foreground">该条目由仿真建议引用，编号固定。</p>}
      </header>
      <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor="knowledge-id">条目编号</Label>
          <Input id="knowledge-id" required maxLength={40} placeholder="KB-AER-005" value={draft.id} readOnly={Boolean(entry)} disabled={busy} onChange={(event) => change("id", event.target.value.toUpperCase())} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="knowledge-title">标题</Label>
          <Input id="knowledge-title" required maxLength={100} value={draft.title} disabled={busy} onChange={(event) => change("title", event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="knowledge-format">正文格式</Label>
          <Select value={draft.format} disabled={busy || importing} onValueChange={(value: KnowledgeInput["format"]) => change("format", value)}>
            <SelectTrigger id="knowledge-format"><SelectValue /></SelectTrigger>
            <SelectContent position="item-aligned"><SelectItem value="text">纯文本</SelectItem><SelectItem value="markdown">Markdown</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="knowledge-file">导入文本或 Markdown</Label>
          <Input id="knowledge-file" type="file" accept=".txt,.md,.markdown" disabled={busy || importing} onChange={(event) => void readFile(event)} />
        </div>
      </div>
      {importFeedback && <p role={importFeedback.error ? "alert" : "status"} className={`break-words text-sm ${importFeedback.error ? "text-critical" : "text-success"}`}>{importFeedback.message}</p>}
      <div className="space-y-1.5">
        <Label htmlFor="knowledge-content">正文</Label>
        <Textarea id="knowledge-content" rows={9} required disabled={busy} value={draft.content} onChange={(event) => change("content", event.target.value)} />
      </div>
      <EditorActions title={entry?.title ?? ""} busy={busy || importing} remove={remove} />
    </form>
  );
}
