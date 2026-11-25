import type { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={key++} className="rounded bg-background/80 px-1 py-0.5 font-mono text-xs">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key++} className="font-semibold text-foreground">{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

// 轻量无依赖 Markdown 渲染器，仅输出受控 React 节点，无 XSS 风险
export function MarkdownView({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre key={blocks.length} className="overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs leading-relaxed">
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      const level = heading[1].length;
      const cls = level === 1 ? "text-base font-bold" : level === 2 ? "text-sm font-bold" : "text-sm font-semibold";
      blocks.push(<h4 key={blocks.length} className={cls}>{renderInline(heading[2])}</h4>);
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={blocks.length} className="border-border" />);
      i += 1;
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        quoteLines.push(lines[i].trimStart().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote key={blocks.length} className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
          {renderInline(quoteLines.join(" "))}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
          {items.map((item, idx) => <li key={idx}>{renderInline(item)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol key={blocks.length} className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
          {items.map((item, idx) => <li key={idx}>{renderInline(item)}</li>)}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s+|```|---+$|>|\s*[-*]\s+|\s*\d+\.\s+)/.test(lines[i].trimStart())
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={blocks.length} className="whitespace-pre-wrap break-words text-sm leading-relaxed">
        {renderInline(paragraph.join("\n"))}
      </p>,
    );
  }

  return <div className="space-y-2.5">{blocks}</div>;
}
