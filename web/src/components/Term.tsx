import { createContext, useContext, useMemo, type ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createTermMatcher, type Term } from "@/lib/terms";

const TermMatcher = createContext(createTermMatcher([]));

// These describe the rule itself. Historical values come from the advice snapshot.
const ruleTerms: Term[] = [
  { id: "minExecuteInterval", term: "最小调节间隔", aliases: ["距上次调节间隔不足"], definition: "两次执行曝气调节之间需要等待的最短仿真时间。" },
  { id: "reviewAfter", term: "复评约束", aliases: ["复评时间"], definition: "上次调节执行后，先等待规定的仿真时间并采样复评，再决定是否继续调节。" },
  { id: "doSetpointStep", term: "单次步长", aliases: [], definition: "一次调节允许改变的 DO 目标值幅度，单位为 mg/L。" },
  { id: "doSetpointRange", term: "允许范围", aliases: [], definition: "调节后的 DO 目标值须落在当时规则设置的下限和上限之间。" },
];

export function TermProvider({ terms, children }: { terms: Term[]; children: ReactNode }) {
  const match = useMemo(() => createTermMatcher([...terms, ...ruleTerms]), [terms]);
  return <TermMatcher.Provider value={match}>{children}</TermMatcher.Provider>;
}

function TermTip({ word, term, insideButton }: { word: string; term: Term; insideButton?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={insideButton ? undefined : 0}
          className="inline cursor-help border-b border-dashed border-primary/60 font-medium text-primary focus-visible:outline-ring"
        >{word}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs p-3" side={insideButton ? "right" : "top"}>
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
export function ExplainText({ text, insideButton }: { text: string; insideButton?: boolean }) {
  const match = useContext(TermMatcher);
  const parts = match(text);
  return (
    <>
      {parts.map((p, i): ReactNode =>
        p.term ? <TermTip key={i} word={p.text} term={p.term} insideButton={insideButton} /> : <span key={i}>{p.text}</span>
      )}
    </>
  );
}
