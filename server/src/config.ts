import { basename, dirname, join } from "node:path";

/**
 * Whether we're running inside a `bun build --compile` single-file executable.
 * In a compiled binary process.execPath is our own exe; under `bun run` it is
 * the bun runtime itself.
 */
const execBase = basename(process.execPath).toLowerCase();
export const isCompiled = execBase !== "bun" && execBase !== "bun.exe" && execBase !== "bun-debug.exe";

export const PORT = Number(process.env.VET_PORT ?? 8787);

/**
 * Directory for the local SQLite database file.
 * - Compiled exe: a `data/` folder next to the executable.
 * - Dev: repo-root `data/` folder.
 */
export function dataDir(): string {
  if (isCompiled) return join(dirname(process.execPath), "data");
  // server/src/config.ts -> repo root is two levels up from src
  return join(import.meta.dir, "..", "..", "data");
}

export function dbPath(): string {
  return process.env.VET_DB_PATH ?? join(dataDir(), "vet-scheduler.db");
}
