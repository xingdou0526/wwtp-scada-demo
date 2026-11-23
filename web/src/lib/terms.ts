export interface Term {
  id: string;
  term: string;
  aliases: string[];
  definition: string;
}

export function createTermMatcher(terms: Term[]) {
  const matchers = terms.flatMap((term) => [term.term, ...term.aliases].map((word) => ({ word, term })))
    .sort((a, b) => b.word.length - a.word.length);

  return (text: string) => {
    const parts: { text: string; term?: Term }[] = [];
    let rest = text;
    while (rest.length) {
      let best: { index: number; word: string; term: Term } | null = null;
      for (const matcher of matchers) {
        const index = rest.indexOf(matcher.word);
        if (index >= 0 && (!best || index < best.index)) best = { index, ...matcher };
      }
      if (!best) {
        parts.push({ text: rest });
        break;
      }
      if (best.index > 0) parts.push({ text: rest.slice(0, best.index) });
      parts.push({ text: best.word, term: best.term });
      rest = rest.slice(best.index + best.word.length);
    }
    return parts;
  };
}
