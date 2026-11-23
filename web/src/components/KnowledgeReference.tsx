import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { fetchKnowledge, type KnowledgeEntry } from "@/lib/admin";

export function KnowledgeReference({ id }: { id: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="link" size="sm" className="h-auto self-start p-0 text-xs">
          <BookOpen aria-hidden className="size-3.5" /> 知识条目 {id}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <KnowledgeArticle id={id} />
      </DialogContent>
    </Dialog>
  );
}

function KnowledgeArticle({ id }: { id: string }) {
  const [entry, setEntry] = useState<KnowledgeEntry>();
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchKnowledge(id, controller.signal).then(setEntry).catch((cause) => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return () => controller.abort();
  }, [id]);

  return (
    <>
      <DialogHeader className="pr-6">
        <DialogTitle>{entry?.title ?? "建议引用的知识条目"}</DialogTitle>
        <DialogDescription>{id}{entry?.updatedAt && ` · 更新于 ${new Date(entry.updatedAt).toLocaleString("zh-CN")}`}</DialogDescription>
      </DialogHeader>
      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
      {!entry && !error && <p role="status" className="text-sm text-muted-foreground">正在读取知识条目…</p>}
      {entry && (
        <section className="space-y-3 rounded-lg border bg-muted p-4">
          {entry.format === "markdown" && <Badge variant="outline">Markdown 原文</Badge>}
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{entry.content}</p>
        </section>
      )}
    </>
  );
}
