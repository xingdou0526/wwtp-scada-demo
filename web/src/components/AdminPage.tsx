import { useEffect, useState } from "react";
import { BookOpen, ClipboardList, History, LibraryBig, Settings2 } from "lucide-react";
import { AdviceHistoryLog } from "@/components/AdviceHistory";
import { Catalog } from "@/components/admin/Catalog";
import { KnowledgeEditor } from "@/components/admin/KnowledgeEditor";
import { RuleEditor } from "@/components/admin/RuleEditor";
import { TermEditor } from "@/components/admin/TermEditor";
import { OperationLog } from "@/components/OperationRecords";
import { TermProvider } from "@/components/Term";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchManagement, type ManagementData } from "@/lib/admin";

export function AdminPage({ setpoint, onChange }: { setpoint?: number; onChange: () => void }) {
  const [data, setData] = useState<ManagementData>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchManagement(controller.signal).then(setData).catch((cause) => {
      if (!controller.signal.aborted) setError((cause as Error).message);
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
              changeItems={(knowledge) => setData((current) => current ? { ...current, knowledge } : current)}
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
                setData((current) => current ? { ...current, terms } : current);
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
              setData((current) => current ? { ...current, limits } : current);
              onChange();
            }} />
          ) : unavailable}
        </TabsContent>
        <TabsContent value="advice-history" className={paneClass}>
          <TermProvider terms={data?.terms ?? []}><AdviceHistoryLog /></TermProvider>
        </TabsContent>
        <TabsContent value="operations" className={paneClass}>
          <TermProvider terms={data?.terms ?? []}><OperationLog /></TermProvider>
        </TabsContent>
      </Tabs>
    </section>
  );
}
