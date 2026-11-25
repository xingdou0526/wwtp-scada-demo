import { useState, type ReactNode } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteEntry, saveEntry } from "@/lib/admin";

export interface CatalogActions {
  busy: boolean;
  save: (form: unknown) => Promise<void>;
  remove?: () => Promise<void>;
}

export function EditorActions({ title, busy, remove }: { title: string; busy: boolean; remove?: () => Promise<void> }) {
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

export function Catalog<T extends { id: string }>({ items, resource, singular, describe, changeItems, children }: {
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
