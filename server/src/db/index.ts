import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "../config";
import { runMigrations } from "./migrate";

let db: Database | null = null;

/** Open (once) the local SQLite database, ensuring the data dir + schema exist. */
export function getDb(): Database {
  if (db) return db;
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  return db;
}

/** Close the database connection (used by tests for cleanup). */
export function closeDb(): void {
  db?.close();
  db = null;
}

/** For tests: open an isolated in-memory database with the schema applied. */
export function createMemoryDb(): Database {
  const mem = new Database(":memory:");
  mem.exec("PRAGMA foreign_keys = ON;");
  runMigrations(mem);
  return mem;
}
