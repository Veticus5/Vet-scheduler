import { STAFF_GROUPS, type QualificationTier, type StaffGroupKey } from "@vet/shared";
import { getDb } from "../db";

interface Row {
  staff_group: string;
  key: string;
  label: string;
  rank: number;
}

/** Tiers grouped by staff group, ordered by rank — for the UI and AI context. */
export function listTiers(): Record<StaffGroupKey, QualificationTier[]> {
  const rows = getDb()
    .query<Row, []>("SELECT * FROM qualification_tiers ORDER BY staff_group, rank")
    .all();
  const out = Object.fromEntries(
    STAFF_GROUPS.map((g) => [g.key, [] as QualificationTier[]]),
  ) as Record<StaffGroupKey, QualificationTier[]>;
  for (const r of rows) {
    (out[r.staff_group as StaffGroupKey] ??= []).push({ key: r.key, label: r.label, rank: r.rank });
  }
  return out;
}

/** group → (tier key → rank), used by the validator to compare qualifications. */
export function rankMap(): Map<StaffGroupKey, Map<string, number>> {
  const map = new Map<StaffGroupKey, Map<string, number>>();
  const tiers = listTiers();
  for (const group of Object.keys(tiers) as StaffGroupKey[]) {
    map.set(group, new Map(tiers[group].map((t) => [t.key, t.rank])));
  }
  return map;
}
