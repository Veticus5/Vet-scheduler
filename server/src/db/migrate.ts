import type { Database } from "bun:sqlite";
import { QUALIFICATION_TIERS, STAFF_GROUPS, type StaffGroupKey } from "@vet/shared";

/**
 * Ordered migrations. Each runs once; applied versions are tracked in
 * `schema_migrations`. Append new migrations — never edit an applied one.
 */
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE staff_groups (
        key   TEXT PRIMARY KEY,
        label TEXT NOT NULL
      );

      CREATE TABLE employees (
        id                   TEXT PRIMARY KEY,
        name                 TEXT NOT NULL,
        staff_group          TEXT NOT NULL REFERENCES staff_groups(key),
        qualification_level  INTEGER NOT NULL DEFAULT 1,
        contract_hours       REAL NOT NULL DEFAULT 0,
        default_availability TEXT NOT NULL DEFAULT '{}',
        active               INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE shift_definitions (
        id           TEXT PRIMARY KEY,
        staff_group  TEXT NOT NULL REFERENCES staff_groups(key),
        name         TEXT NOT NULL,
        start_time   TEXT NOT NULL,
        end_time     TEXT NOT NULL,
        weekdays     TEXT NOT NULL DEFAULT '[]',
        required_min INTEGER NOT NULL DEFAULT 1,
        required_max INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE rules (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        kind        TEXT NOT NULL,
        hard        INTEGER NOT NULL DEFAULT 1,
        scope       TEXT NOT NULL,
        params      TEXT NOT NULL DEFAULT '{}',
        description TEXT NOT NULL DEFAULT '',
        enabled     INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE requests (
        id           TEXT PRIMARY KEY,
        month        TEXT NOT NULL,
        employee_id  TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        type         TEXT NOT NULL,
        dates        TEXT,
        shift_def_ids TEXT,
        text         TEXT
      );
      CREATE INDEX idx_requests_month ON requests(month);

      CREATE TABLE schedules (
        id         TEXT PRIMARY KEY,
        month      TEXT NOT NULL UNIQUE,
        status     TEXT NOT NULL DEFAULT 'draft',
        violations TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE assignments (
        schedule_id  TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
        date         TEXT NOT NULL,
        shift_def_id TEXT NOT NULL,
        employee_id  TEXT NOT NULL,
        PRIMARY KEY (schedule_id, date, shift_def_id, employee_id)
      );

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    // Per-group named qualification tiers replace the free numeric level.
    version: 2,
    sql: `
      CREATE TABLE qualification_tiers (
        staff_group TEXT NOT NULL REFERENCES staff_groups(key),
        key         TEXT NOT NULL,
        label       TEXT NOT NULL,
        rank        INTEGER NOT NULL,
        PRIMARY KEY (staff_group, key)
      );

      ALTER TABLE employees ADD COLUMN qualification_tier TEXT;
    `,
    // Backfill of qualification_tier from the legacy numeric column runs in JS
    // (see backfillQualificationTiers) so the mapping stays unit-testable.
  },
  {
    // Recurring requests: store the weekday pattern (JSON) alongside the
    // expanded `dates`. Existing rows keep NULL and stay valid.
    version: 3,
    sql: `ALTER TABLE requests ADD COLUMN recurrence TEXT;`,
  },
  {
    // Office duty: a shift either staffs the reception desk (1) or is office
    // duty (0). Existing rows default to 1 (reception desk), preserving behavior.
    version: 4,
    sql: `ALTER TABLE shift_definitions ADD COLUMN staffs_reception INTEGER NOT NULL DEFAULT 1;`,
  },
];

/**
 * Map a legacy numeric qualification level to a tier key for its group.
 * Reception maps by rank; every other group collapses to its placeholder tier.
 */
export function legacyLevelToTier(group: StaffGroupKey, level: number): string {
  if (group === "reception") {
    if (level <= 1) return "niedoswiadczony";
    if (level === 2) return "doswiadczony";
    if (level === 3) return "zastepca-kierownika";
    return "kierownik";
  }
  return QUALIFICATION_TIERS[group][0]?.key ?? "podstawowy";
}

export function runMigrations(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);

  const applied = new Set<number>(
    db.query<{ version: number }, []>("SELECT version FROM schema_migrations")
      .all()
      .map((r) => r.version),
  );

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        m.version,
        new Date().toISOString(),
      );
    });
    tx();
  }

  seedStaffGroups(db);
  seedQualificationTiers(db);
  backfillQualificationTiers(db);
}

/** Assign a tier to any employee still on the legacy numeric level. Idempotent. */
function backfillQualificationTiers(db: Database): void {
  const rows = db
    .query<{ id: string; staff_group: string; qualification_level: number }, []>(
      "SELECT id, staff_group, qualification_level FROM employees WHERE qualification_tier IS NULL",
    )
    .all();
  if (rows.length === 0) return;
  const update = db.query("UPDATE employees SET qualification_tier = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (const r of rows) {
      update.run(legacyLevelToTier(r.staff_group as StaffGroupKey, r.qualification_level), r.id);
    }
  });
  tx();
}

/** Staff groups are first-class but fixed for the foundation; keep them in sync. */
function seedStaffGroups(db: Database): void {
  const upsert = db.query(
    "INSERT INTO staff_groups (key, label) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET label = excluded.label",
  );
  for (const g of STAFF_GROUPS) upsert.run(g.key, g.label);
}

/** Qualification tiers are configured in code; keep the table in sync on boot. */
function seedQualificationTiers(db: Database): void {
  const upsert = db.query(
    `INSERT INTO qualification_tiers (staff_group, key, label, rank) VALUES (?, ?, ?, ?)
     ON CONFLICT(staff_group, key) DO UPDATE SET label = excluded.label, rank = excluded.rank`,
  );
  for (const group of Object.keys(QUALIFICATION_TIERS) as StaffGroupKey[]) {
    for (const t of QUALIFICATION_TIERS[group]) upsert.run(group, t.key, t.label, t.rank);
  }
}
