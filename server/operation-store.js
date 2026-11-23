import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const defaultFile = fileURLToPath(new URL("./data/operations.json", import.meta.url));

export class OperationStorageError extends Error {
  constructor(cause) {
    super("操作记录保存失败，请重试", { cause });
  }
}

export function openOperationStore(file = process.env.WWTP_OPERATIONS_FILE || defaultFile) {
  let initialOperations = [];
  try {
    initialOperations = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`无法读取操作记录文件 ${file}`, { cause: error });
  }
  if (!Array.isArray(initialOperations) || initialOperations.some((op) => typeof op?.id !== "string")) {
    throw new Error(`操作记录文件格式无效 ${file}`);
  }

  function saveOperations(operations) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(temporary, `${JSON.stringify(operations, null, 2)}\n`, { encoding: "utf8", flush: true });
      renameSync(temporary, file);
    } catch (error) {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // Keep the original write error.
      }
      throw new OperationStorageError(error);
    }
  }

  return { initialOperations, saveOperations };
}
