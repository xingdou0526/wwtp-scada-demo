import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { BookOpen, ClipboardList, History, LibraryBig, Plus, Save, Settings2, Trash2 } from "lucide-react";
import { AdviceHistoryLog } from "@/components/AdviceHistory";
import { TermProvider } from "@/components/Term";
import { OperationLog } from "@/components/OperationRecords";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteEntry, fetchManagement, KNOWLEDGE_FILE_LIMIT, saveEntry, saveLimits,
  type KnowledgeEntry, type KnowledgeInput, type ManagementData, type RuleLimits,
} from "@/lib/admin";
import type { Term } from "@/lib/terms";

export function AdminPage({ setpoint, onChange }: { setpoint?: number; onChange: () => void }) {
  const [data, setData] = useState<ManagementData>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchManagement(controller.signal).then(setData).catch((cause) => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return () => controller.abort();
  }, [attempt]);

  const unavailable = error ? (
    <div className="flex flex-wrap items-center gap-3 p-5">
      <p role="alert" className="text-sm text-critical">{error}</p>
      <Button type="button" size="sm" variant="outline" onClick={() => { setError(""); setAttempt((current) => current + 1); }}>重试</Button>
    </div>
  ) : <p role="status" className="p-5 text-sm text-muted-foreground">正在读取后台配置…</p>;

  const paneClass = "flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm data-[state=inactive]:hidden";
  return (
    <section aria-labelledby="admin-title" className="page-enter flex min-h-0 flex-1 flex-col gap-4">
      <header className="shrink-0">
        <h2 id="admin-title" className="text-xl font-semibold tracking-tight">后台管理</h2>
        <p className="mt-1 text-sm text-muted-foreground">维护建议引用、术语解释和仿真规则，查询历史建议与操作记录。</p>
      </header>
      <Tabs defaultValue="knowledge" className="min-h-0 flex-1 gap-3">
        <TabsList aria-label="后台管理模块" className="grid w-full shrink-0 grid-cols-2 gap-1 sm:inline-flex sm:w-fit">
          <TabsTrigger value="knowledge" className="gap-2"><BookOpen aria-hidden className="size-4" /> 知识库</TabsTrigger>
          <TabsTrigger value="terms" className="gap-2"><LibraryBig aria-hidden className="size-4" /> 术语库</TabsTrigger>
          <TabsTrigger value="limits" className="gap-2"><Settings2 aria-hidden className="size-4" /> 规则参数</TabsTrigger>
          <TabsTrigger value="advice-history" className="gap-2"><History aria-hidden className="size-4" /> 历史建议</TabsTrigger>
          <TabsTrigger value="operations" className="gap-2"><ClipboardList aria-hidden className="size-4" /> 操作记录</TabsTrigger>
        </TabsList>
        <TabsContent value="knowledge" className={paneClass}>
          {data ? (
            <Catalog
              items={data.knowledge}
              resource="knowledge"
              singular="条目"
              describe={(entry) => ({ title: entry.title, detail: entry.id, linked: entry.ruleLinked })}
              changeItems={(knowledge) => setData((current) => ({ ...current, knowledge }))}
            >
              {(entry, actions) => <KnowledgeEditor entry={entry} {...actions} />}
            </Catalog>
          ) : unavailable}
        </TabsContent>
        <TabsContent value="terms" className={paneClass}>
          {data ? (
            <Catalog
              items={data.terms}
              resource="terms"
              singular="术语"
              describe={(entry) => ({ title: entry.term, detail: entry.aliases.join("、") })}
              changeItems={(terms) => {
                setData((current) => ({ ...current, terms }));
                onChange();
              }}
            >
              {(entry, actions) => <TermEditor entry={entry} {...actions} />}
            </Catalog>
          ) : unavailable}
        </TabsContent>
        <TabsContent value="limits" className={`${paneClass} overflow-y-auto`}>
          {data ? (
            <RuleEditor limits={data.limits} setpoint={setpoint} onSaved={(limits) => {
              setData((current) => ({ ...current, limits }));
              onChange();
            }} />
          ) : unavailable}
        </TabsContent>
        <TabsContent value="advice-history" className={paneClass}>
          <TermProvider terms={data?.terms ?? []}><AdviceHistoryLog /></TermProvider>
        </TabsContent>
        <TabsContent value="operations" className={paneClass}>
          <OperationLog />
        </TabsContent>
      </Tabs>
    </section>
  );
}

interface CatalogActions {
  busy: boolean;
  save: (form: unknown) => Promise<void>;
  remove?: () => Promise<void>;
}

function Catalog<T extends { id: string }>({ items, resource, singular, describe, changeItems, children }: {
  items: T[];
  resource: "knowledge" | "terms";
  singular: string;
  describe: (item: T) => { title: string; detail: string; linked?: boolean };
  changeItems: (items: T[]) => void;
  children: (item: T | undefined, actions: CatalogActions) => ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean }>();
  const [editorVersion, setEditorVersion] = useState(0);
  const selected = items.find(({ id }) => id === selectedId);
  const keyword = query.trim().toLowerCase();
  const visible = items.filter((item) => {
    const { title, detail } = describe(item);
    return `${title} ${detail}`.toLowerCase().includes(keyword);
  });

  function select(id: string | null) {
    setSelectedId(id);
    setFeedback(undefined);
    setEditorVersion((version) => version + 1);
  }

  async function save(form: unknown) {
    setBusy(true);
    setFeedback(undefined);
    try {
      const entry = await saveEntry<T>(resource, form, selected?.id);
      changeItems(selected ? items.map((item) => item.id === entry.id ? entry : item) : [...items, entry]);
      select(entry.id);
      setFeedback({ message: `已保存${singular}` });
    } catch (cause) {
      setFeedback({ message: (cause as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      await deleteEntry(resource, selected.id);
      const remaining = items.filter((item) => item.id !== selected.id);
      changeItems(remaining);
      select(remaining[0]?.id ?? null);
      setFeedback({ message: `已删除${singular}` });
    } catch (cause) {
      setFeedback({ message: (cause as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[17rem_minmax(0,1fr)] md:overflow-hidden">
      <section aria-label={`${singular}列表`} className="flex min-h-0 flex-col border-b bg-muted md:border-r md:border-b-0">
        <div className="shrink-0 space-y-3 border-b p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{singular}列表 <span className="ml-1 text-xs font-normal text-muted-foreground">{items.length}</span></h3>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setQuery(""); select(null); }}>
              <Plus aria-hidden className="size-3.5" /> 新增{singular}
            </Button>
          </div>
          <Label htmlFor={`${resource}-search`} className="sr-only">搜索{singular}</Label>
          <Input id={`${resource}-search`} type="search" className="bg-card" placeholder={`搜索${singular}`} value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <ul className="max-h-36 flex-1 space-y-1.5 overflow-y-auto p-3 md:max-h-none">
          {visible.length === 0 && <li className="p-2 text-sm text-muted-foreground">{keyword ? "没有匹配的结果" : `暂无${singular}`}</li>}
          {visible.map((item) => {
            const { title, detail, linked } = describe(item);
            return (
              <li key={item.id}>
                <Button type="button" variant="outline" disabled={busy} aria-pressed={item.id === selectedId}
                  className="h-auto w-full flex-col items-start gap-1 whitespace-normal p-2.5 text-left aria-pressed:border-primary/40 aria-pressed:bg-primary/10" onClick={() => select(item.id)}>
                  <span className="max-w-full break-words text-sm leading-snug">{title}</span>
                  {(detail || linked) && <span className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">{detail}</span>{linked && <Badge variant="secondary" className="shrink-0">规则引用</Badge>}
                  </span>}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
      <div className="min-h-0 min-w-0 p-4 sm:p-6 md:overflow-y-auto">
        <div className="advice-enter max-w-3xl" key={editorVersion}>
          {children(selected, { busy, save, remove: selected && !describe(selected).linked ? remove : undefined })}
          {feedback && <p role={feedback.error ? "alert" : "status"} className={`mt-3 text-sm ${feedback.error ? "text-critical" : "text-success"}`}>{feedback.message}</p>}
        </div>
      </div>
    </div>
  );
}

function EditorActions({ title, busy, remove }: { title: string; busy: boolean; remove?: () => Promise<void> }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
      <Button className="w-28" type="submit" disabled={busy}><Save aria-hidden /> {busy ? "保存中…" : "保存"}</Button>
      {remove && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" disabled={busy} className="text-critical"><Trash2 aria-hidden /> 删除</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除？</AlertDialogTitle>
              <AlertDialogDescription>将从后台管理中删除「{title}」。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => void remove()} className="bg-destructive text-white hover:bg-destructive/90">确认删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function KnowledgeEditor({ entry, save, remove, busy }: CatalogActions & { entry?: KnowledgeEntry }) {
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

function TermEditor({ entry, save, remove, busy }: CatalogActions & { entry?: Term }) {
  const [term, setTerm] = useState(entry?.term ?? "");
  const [aliases, setAliases] = useState(entry?.aliases.join("\n") ?? "");
  const [definition, setDefinition] = useState(entry?.definition ?? "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save({ term, definition, aliases: aliases.split("\n").map((alias) => alias.trim()).filter(Boolean) });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <h3 className="font-semibold">{entry ? "编辑术语" : "新增术语"}</h3>
      <div className="space-y-1.5">
        <Label htmlFor="term-name">术语</Label>
        <Input id="term-name" required maxLength={60} disabled={busy} value={term} onChange={(event) => setTerm(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="term-aliases">别名（每行一个，可选）</Label>
        <Textarea id="term-aliases" rows={3} disabled={busy} value={aliases} onChange={(event) => setAliases(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="term-definition">释义</Label>
        <Textarea id="term-definition" rows={5} required maxLength={2000} disabled={busy} value={definition} onChange={(event) => setDefinition(event.target.value)} />
      </div>
      <EditorActions title={entry?.term ?? ""} busy={busy} remove={remove} />
    </form>
  );
}

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

function RuleEditor({ limits, setpoint, onSaved }: { limits: RuleLimits; setpoint?: number; onSaved: (limits: RuleLimits) => void }) {
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
