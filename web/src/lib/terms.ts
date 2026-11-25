export interface Term {
  id: string;
  term: string;
  aliases: string[];
  definition: string;
}

export function createTermMatcher(terms: Term[]) {
  const matchers = terms
    .flatMap((term) => [term.term, ...term.aliases].map((word) => ({ word, lower: word.toLowerCase(), term })))
    .filter(({ word }) => word.length > 0)
    .sort((a, b) => b.word.length - a.word.length);

  return (text: string) => {
    const parts: { text: string; term?: Term }[] = [];
    let rest = text;
    while (rest.length) {
      const lowerRest = rest.toLowerCase();
      let best: { index: number; length: number; term: Term } | null = null;
      for (const matcher of matchers) {
        const index = lowerRest.indexOf(matcher.lower);
        if (index >= 0 && (!best || index < best.index)) {
          best = { index, length: matcher.word.length, term: matcher.term };
        }
      }
      if (!best) {
        parts.push({ text: rest });
        break;
      }
      if (best.index > 0) parts.push({ text: rest.slice(0, best.index) });
      parts.push({ text: rest.slice(best.index, best.index + best.length), term: best.term });
      rest = rest.slice(best.index + best.length);
    }
    return parts;
  };
}
