import { useState, type FormEvent } from "react";
import { EditorActions, type CatalogActions } from "@/components/admin/Catalog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Term } from "@/lib/terms";

export function TermEditor({ entry, save, remove, busy }: CatalogActions & { entry?: Term }) {
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
