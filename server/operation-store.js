import { fileURLToPath } from "node:url";
import { readJsonFile, writeJsonFile } from "./json-file.js";

const defaultFile = fileURLToPath(new URL("./data/operations.json", import.meta.url));

export class OperationStorageError extends Error {
  constructor(cause) {
    super("操作记录保存失败，请重试", { cause });
  }
}

export function openOperationStore(file = process.env.WWTP_OPERATIONS_FILE || defaultFile) {
  const initialOperations = readJsonFile(file, []);
  if (!Array.isArray(initialOperations) || initialOperations.some((op) => typeof op?.id !== "string")) {
    throw new Error(`操作记录文件格式无效 ${file}`);
  }

  function saveOperations(operations) {
    try {
      writeJsonFile(file, operations);
    } catch (error) {
      throw new OperationStorageError(error);
    }
  }

  return { initialOperations, saveOperations };
}
