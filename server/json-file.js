import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readJsonFile(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error(`无法读取本地数据文件 ${file}`, { cause: error });
  }
}

export function writeJsonFile(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", flush: true });
    renameSync(temporary, file);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Retain the original write error.
    }
    throw error;
  }
}
