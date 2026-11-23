import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { matchTerms, type Term } from "@/lib/terms";

export function TermTip({ word, term }: { word: string; term: Term }) {
  return (
    <Tooltip>
      <TooltipTrigger
        className="inline cursor-help border-b border-dashed border-primary/60 font-medium text-primary"
        aria-label={`术语解释：${word}`}
      >
        {word}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs p-3" side="top">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1 text-xs font-semibold text-primary">
            <BookOpen className="size-3" /> {term.term}
          </span>
          <span className="text-xs leading-relaxed">{term.definition}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// 自动识别文本中的术语并附加悬浮解释
export function ExplainText({ text }: { text: string }) {
  const parts = matchTerms(text);
  return (
    <>
      {parts.map((p, i): ReactNode =>
        p.term ? <TermTip key={i} word={p.text} term={p.term} /> : <span key={i}>{p.text}</span>
      )}
    </>
  );
}
