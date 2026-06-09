import {
  DEFAULT_AI_MODEL,
  DEFAULT_MAX_REPAIR_ATTEMPTS,
  type Settings,
} from "@vet/shared";
import { getDb } from "../db";

const KEY_API = "anthropic_api_key";
const KEY_MODEL = "ai_model";
const KEY_MAX_REPAIR = "max_repair_attempts";

function readRaw(key: string): string | null {
  const row = getDb()
    .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
    .get(key);
  return row?.value ?? null;
}

function writeRaw(key: string, value: string): void {
  getDb()
    .query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

/** Public settings — never includes the API key itself. */
export function getSettings(): Settings {
  return {
    hasApiKey: !!readRaw(KEY_API),
    aiModel: readRaw(KEY_MODEL) ?? DEFAULT_AI_MODEL,
    maxRepairAttempts: Number(readRaw(KEY_MAX_REPAIR) ?? DEFAULT_MAX_REPAIR_ATTEMPTS),
  };
}

/** The raw API key, for server-side AI calls only. */
export function getApiKey(): string | null {
  return readRaw(KEY_API);
}

export function setApiKey(key: string): void {
  writeRaw(KEY_API, key.trim());
}

export function updateSettings(patch: { aiModel?: string; maxRepairAttempts?: number }): void {
  if (patch.aiModel !== undefined) writeRaw(KEY_MODEL, patch.aiModel);
  if (patch.maxRepairAttempts !== undefined) {
    writeRaw(KEY_MAX_REPAIR, String(Math.max(0, Math.floor(patch.maxRepairAttempts))));
  }
}
