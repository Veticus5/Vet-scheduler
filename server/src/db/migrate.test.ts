import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { legacyLevelToTier, runMigrations } from "./migrate";

// The numeric-level → tier mapping used to backfill pre-existing employees.
describe("legacyLevelToTier", () => {
  test("reception maps by rank", () => {
    expect(legacyLevelToTier("reception", 1)).toBe("niedoswiadczony");
    expect(legacyLevelToTier("reception", 2)).toBe("doswiadczony");
    expect(legacyLevelToTier("reception", 3)).toBe("zastepca-kierownika");
    expect(legacyLevelToTier("reception", 4)).toBe("kierownik");
  });

  test("reception clamps out-of-range levels", () => {
    expect(legacyLevelToTier("reception", 0)).toBe("niedoswiadczony");
    expect(legacyLevelToTier("reception", 9)).toBe("kierownik");
  });

  test("other groups collapse to their placeholder tier", () => {
    expect(legacyLevelToTier("technicians", 2)).toBe("podstawowy");
    expect(legacyLevelToTier("doctors", 5)).toBe("podstawowy");
  });
});

// Migration 3 adds the `recurrence` column to requests without breaking
// pre-existing rows.
describe("runMigrations — requests.recurrence (v3)", () => {
  function freshDb(): Database {
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db);
    return db;
  }

  test("requests table has a recurrence column", () => {
    const db = freshDb();
    const cols = db
      .query<{ name: string }, []>("PRAGMA table_info(requests)")
      .all()
      .map((c) => c.name);
    expect(cols).toContain("recurrence");
    db.close();
  });

  test("a request row without recurrence reads back with recurrence NULL", () => {
    const db = freshDb();
    db.query(
      "INSERT INTO employees (id, name, staff_group, qualification_tier, contract_hours, default_availability, active) VALUES ('e1', 'Ala', 'reception', 'doswiadczony', 160, '{}', 1)",
    ).run();
    db.query(
      "INSERT INTO requests (id, month, employee_id, type, dates) VALUES ('r1', '2026-07', 'e1', 'time-off', '[\"2026-07-01\"]')",
    ).run();
    const row = db
      .query<{ recurrence: string | null; dates: string | null }, []>(
        "SELECT recurrence, dates FROM requests WHERE id = 'r1'",
      )
      .get();
    expect(row?.recurrence).toBeNull();
    expect(row?.dates).toBe('["2026-07-01"]');
    db.close();
  });
});

// Migration 4 adds the `staffs_reception` column to shift definitions; existing
// definitions default to staffing the reception desk.
describe("runMigrations — shift_definitions.staffs_reception (v4)", () => {
  function freshDb(): Database {
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(db);
    return db;
  }

  test("shift_definitions table has a staffs_reception column", () => {
    const db = freshDb();
    const cols = db
      .query<{ name: string }, []>("PRAGMA table_info(shift_definitions)")
      .all()
      .map((c) => c.name);
    expect(cols).toContain("staffs_reception");
    db.close();
  });

  test("a shift inserted without staffs_reception defaults to 1 (reception desk)", () => {
    const db = freshDb();
    db.query(
      "INSERT INTO shift_definitions (id, staff_group, name, start_time, end_time) VALUES ('s1', 'reception', 'Poranna', '07:30', '15:30')",
    ).run();
    const row = db
      .query<{ staffs_reception: number }, []>(
        "SELECT staffs_reception FROM shift_definitions WHERE id = 's1'",
      )
      .get();
    expect(row?.staffs_reception).toBe(1);
    db.close();
  });
});
