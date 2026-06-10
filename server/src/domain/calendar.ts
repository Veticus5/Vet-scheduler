import type { ShiftDefinition, ShiftInstance, Weekday } from "@vet/shared";

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(y, m, 0).getDate();
}

export function datesOfMonth(month: string): string[] {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function weekdayOf(isoDate: string): Weekday {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getDay() as Weekday;
}

/**
 * Expand a weekday recurrence (e.g. `[3]` = "every Wednesday") into the concrete
 * YYYY-MM-DD dates of `month` that fall on those weekdays. Sorted ascending,
 * never includes dates outside the month; empty `weekdays` → empty list.
 */
export function expandRecurrence(month: string, weekdays: Weekday[]): string[] {
  if (!weekdays.length) return [];
  const wanted = new Set(weekdays);
  return datesOfMonth(month).filter((date) => wanted.has(weekdayOf(date)));
}

/** Pure expansion of shift definitions into per-date instances for a month. */
export function expandInstances(
  defs: ShiftDefinition[],
  month: string,
  group?: string,
): ShiftInstance[] {
  const filtered = defs.filter((d) => !group || d.staffGroup === group);
  const instances: ShiftInstance[] = [];
  for (const date of datesOfMonth(month)) {
    const wd = weekdayOf(date);
    for (const def of filtered) {
      if (def.weekdays.includes(wd)) {
        instances.push({ date, shiftDefId: def.id, staffGroup: def.staffGroup });
      }
    }
  }
  return instances;
}
