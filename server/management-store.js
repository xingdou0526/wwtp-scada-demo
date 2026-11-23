import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readJsonFile, writeJsonFile } from "./json-file.js";
import { DEFAULT_KNOWLEDGE, DEFAULT_TERMS, KNOWLEDGE_REFS } from "./management-defaults.js";
import { LIMITS, MAX_SIMULATED_DO } from "./simulator.js";

const defaultFile = fileURLToPath(new URL("./data/management.json", import.meta.url));
const linkedIds = Object.values(KNOWLEDGE_REFS);

export class ManagementError extends Error {
  constructor(message, status = 400, options) {
    super(message, options);
    this.status = status;
  }
}

function requiredText(value, label, length) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > length) {
    throw new ManagementError(`${label}须为 1 至 ${length} 个字符`);
  }
  return value.trim();
}

function knowledgeEntry(id, input, updatedAt = new Date().toISOString()) {
  if (typeof id !== "string" || !/^KB(?:-[A-Z0-9]+)+$/.test(id) || id.length > 40) {
    throw new ManagementError("条目编号须以 KB- 开头，仅使用大写字母、数字和短横线，最多 40 个字符");
  }
  const title = requiredText(input?.title, "条目标题", 100);
  const { content, format } = input;
  if (!["text", "markdown"].includes(format)) throw new ManagementError("请选择文本或 Markdown 格式");
  if (typeof content !== "string" || !content.trim() || content.includes("\0") || Buffer.byteLength(content) > 65536) {
    throw new ManagementError("正文须为不超过 64 KB 的 UTF-8 文本");
  }
  return { id, title, content, format, updatedAt, ruleLinked: linkedIds.includes(id) };
}

function termEntry(id, input) {
  const term = requiredText(input?.term, "术语", 60);
  const definition = requiredText(input.definition, "释义", 2000);
  const { aliases = [] } = input;
  if (!Array.isArray(aliases) || aliases.length > 12) throw new ManagementError("每个术语最多可填写 12 个别名");
  return { id, term, definition, aliases: aliases.map((alias) => requiredText(alias, "别名", 60)) };
}

function checkTermNames(terms) {
  const used = new Set();
  for (const { term, aliases } of terms) {
    for (const word of [term, ...aliases]) {
      const key = word.normalize("NFKC").toLowerCase();
      if (used.has(key)) throw new ManagementError(`术语或别名「${word}」重复`, 409);
      used.add(key);
    }
  }
}

export function validateLimits(input) {
  const limits = Object.fromEntries(Object.keys(LIMITS).map((key) => [key, input?.[key]]));
  const { doSetpointMin, doSetpointMax, doSetpointStep, airflowMin, airflowMax, nh4InternalLimit, minExecuteInterval, reviewAfter } = limits;
  if (![doSetpointMin, doSetpointMax, doSetpointStep].every((value) => Number.isFinite(value) && Number.isInteger(value * 10))) {
    throw new ManagementError("DO 范围与步长最多保留一位小数");
  }
  if (doSetpointMin < 0 || doSetpointMax > MAX_SIMULATED_DO || doSetpointMin >= doSetpointMax) {
    throw new ManagementError(`DO 上下限须在 0 至 ${MAX_SIMULATED_DO} mg/L 之间，且上限须大于下限`);
  }
  if (doSetpointStep <= 0 || doSetpointStep > doSetpointMax - doSetpointMin + 1e-9) {
    throw new ManagementError("DO 调整步长须大于零且不超过可调范围");
  }
  if (![airflowMin, airflowMax].every(Number.isSafeInteger) || airflowMin < 0 || airflowMax <= airflowMin) {
    throw new ManagementError("风量上下限须为非负整数，且上限须大于下限");
  }
  if (!Number.isFinite(nh4InternalLimit) || nh4InternalLimit <= 0) throw new ManagementError("出水氨氮内控值须大于零");
  if (![minExecuteInterval, reviewAfter].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new ManagementError("最小调节间隔和复评等待时间须为正整数");
  }
  return limits;
}

function replaceEntry(entries, id, entry) {
  if (!entries.some((previous) => previous.id === id)) throw new ManagementError("条目不存在", 404);
  return entry ? entries.map((previous) => previous.id === id ? entry : previous) : entries.filter((previous) => previous.id !== id);
}

export function openManagementStore(file = process.env.WWTP_MANAGEMENT_FILE || defaultFile) {
  const saved = readJsonFile(file, { knowledge: DEFAULT_KNOWLEDGE, terms: DEFAULT_TERMS, limits: LIMITS });
  let data;
  try {
    const knowledge = saved.knowledge.map((entry) => knowledgeEntry(entry.id, entry, entry.updatedAt ?? null));
    const terms = saved.terms.map((entry) => termEntry(entry.id, entry));
    if (new Set(knowledge.map(({ id }) => id)).size !== knowledge.length || !linkedIds.every((id) => knowledge.some((entry) => entry.id === id))) {
      throw new Error("缺少规则引用条目或条目编号重复");
    }
    if (terms.some(({ id }) => typeof id !== "string" || !id) || new Set(terms.map(({ id }) => id)).size !== terms.length) {
      throw new Error("术语编号无效或重复");
    }
    checkTermNames(terms);
    data = { knowledge, terms, limits: validateLimits(saved.limits) };
  } catch (error) {
    throw new Error(`后台管理数据格式无效 ${file}`, { cause: error });
  }

  function save(changes) {
    const next = { ...data, ...changes };
    try {
      writeJsonFile(file, next);
    } catch (error) {
      throw new ManagementError("后台配置保存失败，请重试", 503, { cause: error });
    }
    data = next;
  }

  return {
    get data() { return data; },
    getKnowledge(id) { return data.knowledge.find((entry) => entry.id === id); },
    createKnowledge(input) {
      const id = typeof input?.id === "string" ? input.id.trim() : undefined;
      const entry = knowledgeEntry(id, input);
      if (data.knowledge.some(({ id }) => id === entry.id)) throw new ManagementError("知识条目编号已存在", 409);
      save({ knowledge: [...data.knowledge, entry] });
      return entry;
    },
    updateKnowledge(id, input) {
      const entry = knowledgeEntry(id, input);
      save({ knowledge: replaceEntry(data.knowledge, id, entry) });
      return entry;
    },
    deleteKnowledge(id) {
      if (linkedIds.includes(id)) throw new ManagementError("该条目仍被建议规则引用，可编辑正文或标题", 409);
      save({ knowledge: replaceEntry(data.knowledge, id) });
    },
    createTerm(input) {
      const entry = termEntry(randomUUID(), input);
      const terms = [...data.terms, entry];
      checkTermNames(terms);
      save({ terms });
      return entry;
    },
    updateTerm(id, input) {
      const entry = termEntry(id, input);
      const terms = replaceEntry(data.terms, id, entry);
      checkTermNames(terms);
      save({ terms });
      return entry;
    },
    deleteTerm(id) { save({ terms: replaceEntry(data.terms, id) }); },
    updateLimits(input, currentSetpoint) {
      const limits = validateLimits(input);
      if (currentSetpoint < limits.doSetpointMin || currentSetpoint > limits.doSetpointMax) {
        throw new ManagementError(`DO 范围须包含当前目标值 ${currentSetpoint.toFixed(1)} mg/L`);
      }
      if (Object.keys(limits).every((key) => limits[key] === data.limits[key])) return data.limits;
      save({ limits });
      return limits;
    },
  };
}
