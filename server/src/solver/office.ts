/**
 * Phase 1 of office-day scheduling (krok 3): a DETERMINISTIC proposal of which
 * days the manager and deputy spend on office duty (B), from the role rules in
 * zasady_grafiku_recepcja.md §5. The solver (phase 2) treats these as a
 * high-reward soft preference — it places the rest of the desk around them and
 * silently drops a proposed office day only when desk coverage couldn't hold
 * otherwise. Heuristic and approximate by design; the eventual UI lets Daria
 * tweak the proposal before generating.
 *
 * §5 rules encoded:
 *   Deputy (Daria): office in week 1 and the last week (rozliczenia lekarskie),
 *     plus 3 days in week 2 (układanie grafików lekarskich).
 *   Manager (Justyna): office AFTER the deputy's early-month blocks, and most of
 *     her time in the office (raporty) — proposed on her remaining Mon–Fri days.
 *   B/2 (half office days) are NOT modelled (the schema has no half-shift).
 */
import { datesOfMonth, weekdayOf } from "../domain/calendar";

export interface OfficeProposal {
  employeeId: string;
  date: string;
}

const isWorkday = (date: string) => {
  const wd = weekdayOf(date);
  return wd >= 1 && wd <= 5; // Mon–Fri
};

export function proposeOfficeDays(
  month: string,
  managerId: string | null,
  deputyId: string | null,
  blocked: (employeeId: string, date: string) => boolean,
): OfficeProposal[] {
  const days = datesOfMonth(month);
  const last = days[days.length - 1]!;
  const dayNum = (d: string) => Number(d.slice(-2));
  const lastWeekStart = dayNum(last) - 6; // final 7 calendar days

  const week1 = days.filter((d) => dayNum(d) <= 7);
  const week2 = days.filter((d) => dayNum(d) >= 8 && dayNum(d) <= 14);
  const lastWeek = days.filter((d) => dayNum(d) >= lastWeekStart);

  const proposals: OfficeProposal[] = [];
  const add = (employeeId: string | null, date: string) => {
    if (employeeId && isWorkday(date) && !blocked(employeeId, date)) {
      proposals.push({ employeeId, date });
    }
  };

  // Deputy: full week 1 + first 3 workdays of week 2 + full last week.
  if (deputyId) {
    for (const d of week1) add(deputyId, d);
    let inWeek2 = 0;
    for (const d of week2) {
      if (inWeek2 >= 3) break;
      if (isWorkday(d) && !blocked(deputyId, d)) {
        proposals.push({ employeeId: deputyId, date: d });
        inWeek2++;
      }
    }
    for (const d of lastWeek) add(deputyId, d);
  }

  // Manager: most of her time in the office, from week 2 onward (after the
  // deputy's early blocks). Proposed on every remaining Mon–Fri; the solver
  // keeps only those that don't starve desk coverage.
  if (managerId) {
    for (const d of days) {
      if (dayNum(d) >= 8) add(managerId, d);
    }
  }

  return proposals;
}
