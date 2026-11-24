import { fileURLToPath } from "node:url";
import { readJsonFile, writeJsonFile } from "./json-file.js";

const defaultFile = fileURLToPath(new URL("./data/advices.json", import.meta.url));
const statuses = new Set(["pending", "executed", "ignored", "expired", "invalidated", "interrupted", "superseded"]);

export class AdviceStorageError extends Error {
  constructor(cause) {
    super("历史建议保存失败，请重试", { cause });
  }
}

export function openAdviceStore(file = process.env.WWTP_ADVICE_FILE || defaultFile) {
  const initialAdvices = readJsonFile(file, []);
  if (!Array.isArray(initialAdvices) || initialAdvices.some((advice) => !advice?.id || !statuses.has(advice.status)) ||
    new Set(initialAdvices.map(({ id }) => id)).size !== initialAdvices.length) {
    throw new Error(`建议历史文件格式无效 ${file}`);
  }

  function saveAdvices(advices) {
    try {
      writeJsonFile(file, advices);
    } catch (error) {
      throw new AdviceStorageError(error);
    }
  }

  return { initialAdvices, saveAdvices };
}
