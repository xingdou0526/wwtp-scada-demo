// 术语库（预研静态数据，第 6 步后台可维护）
export interface Term {
  term: string;
  aliases?: string[];
  definition: string;
}

export const TERMS: Term[] = [
  { term: "DO", aliases: ["溶解氧"], definition: "溶解氧（Dissolved Oxygen）：水中溶解的氧气含量，好氧微生物的“口粮”。好氧区通常控制 2~4 mg/L，过低硝化受抑制，过高浪费曝气能耗。" },
  { term: "MLSS", definition: "混合液悬浮固体浓度：生化池中活性污泥的浓度，反映微生物“兵力”多少，MBR 工艺一般 8000~15000 mg/L。" },
  { term: "曝气", definition: "通过风机向生化池好氧区供氧的过程，是全厂能耗最高的环节（约占 40~60%），由 DO 目标值联动控制。" },
  { term: "硝化", definition: "硝化作用：好氧条件下，硝化细菌将氨氮转化为硝酸盐氮。需要充足 DO 和适宜水温，低温、低 DO 都会使其受抑制。" },
  { term: "反硝化", definition: "反硝化作用：缺氧条件下，反硝化细菌将硝酸盐氮转化为氮气排出，实现生物脱氮，需要碳源。" },
  { term: "氨氮", definition: "水中以游离氨和铵离子形式存在的氮，是导致水体富营养化的主要污染物之一，出水需稳定达标。" },
  { term: "COD", definition: "化学需氧量：衡量水中有机物污染程度的核心指标，数值越高污染越重，一级 A 出水标准 ≤50 mg/L。" },
  { term: "TMP", aliases: ["跨膜压差"], definition: "跨膜压差（Trans-Membrane Pressure）：MBR 膜两侧压力差，反映膜污染程度，是膜运行核心监控参数，达到清洗阈值需维护。" },
  { term: "MBR", definition: "膜生物反应器：将膜分离与生物处理结合的工艺，用超滤膜替代二沉池实现泥水分离，出水水质好、占地小。" },
  { term: "A²/O", definition: "厌氧-缺氧-好氧组合工艺：厌氧释磷、缺氧反硝化脱氮、好氧硝化及降解有机物，是生化池的核心分区设计。" },
  { term: "需氧量", definition: "OUR（Oxygen Uptake Rate）：微生物氧化有机物和硝化氨氮所消耗的氧气量，随进水负荷和水温变化。" },
  { term: "内控", definition: "企业内部控制限值：比国家排放标准更严格的运行管理阈值，用于提前预警，本 Demo 出水氨氮内控为 1.0 mg/L（可配置）。" },
  { term: "污泥龄", definition: "SRT：污泥在系统中的平均停留天数，影响微生物种群结构；硝化菌增殖慢，低温时需更长泥龄。" },
  { term: "膜通量", definition: "单位时间通过单位膜面积的水量（LMH），反映 MBR 膜产水负荷。" },
  { term: "风量", definition: "鼓风机单位时间输送的空气量，本 Demo 单位 m³/h，风量与风机功率近似呈三次方关系。" },
  { term: "DO 目标值", definition: "好氧区溶解氧的控制设定值。现场自动联动系统据此调节风量；AI 只建议调整该目标值，不直接控制风机。" },
];

// 匹配词表（含别名，长词优先避免短词截断）
const MATCHERS = TERMS.flatMap((t) => [t.term, ...(t.aliases ?? [])].map((m) => ({ match: m, def: t })))
  .sort((a, b) => b.match.length - a.match.length);

export function findTerm(word: string): Term | undefined {
  return MATCHERS.find((m) => m.match === word)?.def;
}

export function matchTerms(text: string) {
  // 将文本拆分为 术语/普通文本 片段
  const parts: { text: string; term?: Term }[] = [];
  let rest = text;
  while (rest.length) {
    let best: { index: number; match: string; def: Term } | null = null;
    for (const m of MATCHERS) {
      const idx = rest.indexOf(m.match);
      if (idx >= 0 && (!best || idx < best.index)) {
        best = { index: idx, match: m.match, def: m.def };
      }
    }
    if (!best) {
      parts.push({ text: rest });
      break;
    }
    if (best.index > 0) parts.push({ text: rest.slice(0, best.index) });
    parts.push({ text: best.match, term: best.def });
    rest = rest.slice(best.index + best.match.length);
  }
  return parts;
}
