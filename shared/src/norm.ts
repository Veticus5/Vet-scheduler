// Monthly working-time norm (wymiar czasu pracy) per art. 130 of the Polish
// Labour Code. The norm is NOT constant — it varies month to month (160–184h in
// 2026) — so the per-employee hours target must be computed from the calendar,
// not hardcoded to 160.
//
// This is the TypeScript twin of `solver/norm.py`; both MUST agree. The shared
// 2026 ground-truth table (see norm.test.ts) is the contract that keeps them in
// sync — the solver computes targets in Python, the UI/LLM context here, and a
// drift would surface as a failing test on either side.
//
// art. 130 §1–2:
//   norm = (Mon–Fri days × 8h) − 8h for every public holiday on a day other
//          than Sunday (a holiday on Saturday also reduces the norm).

/** Easter Sunday (Gregorian, Anonymous/Meeus algorithm). Returns 1-based month/day. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Polish statutory public holidays for a year, as Date objects (local time). */
function polishHolidays(year: number): Date[] {
  // Fixed-date holidays. Christmas Eve (24 Dec) became a public holiday in 2025.
  const fixed: [number, number][] = [
    [1, 1], // Nowy Rok
    [1, 6], // Trzech Króli
    [5, 1], // Święto Pracy
    [5, 3], // Konstytucji 3 Maja
    [8, 15], // Wniebowzięcie NMP
    [11, 1], // Wszystkich Świętych
    [11, 11], // Niepodległości
    [12, 25],
    [12, 26],
  ];
  if (year >= 2025) fixed.push([12, 24]); // Wigilia

  const dates = fixed.map(([m, d]) => new Date(year, m - 1, d));

  // Movable feasts, all offsets from Easter Sunday.
  const e = easterSunday(year);
  const easter = new Date(year, e.month - 1, e.day);
  const plus = (n: number) => new Date(year, easter.getMonth(), easter.getDate() + n);
  dates.push(easter); // Wielkanoc (niedziela)
  dates.push(plus(1)); // Poniedziałek Wielkanocny
  dates.push(plus(49)); // Zielone Świątki (niedziela)
  dates.push(plus(60)); // Boże Ciało

  return dates;
}

/** Statutory monthly working-time norm in hours for a full-time post. `month` is 1–12. */
export function monthlyNormHours(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let hours = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const wd = new Date(year, month - 1, d).getDay(); // 0 = Sun … 6 = Sat
    if (wd >= 1 && wd <= 5) hours += 8;
  }
  for (const h of polishHolidays(year)) {
    if (h.getMonth() + 1 === month && h.getDay() !== 0) hours -= 8; // not Sunday
  }
  return hours;
}

/**
 * Per-employee monthly target: the statutory norm scaled by FTE, minus 8h for
 * each VACATION (urlop) day on a working day (Mon–Fri). Vacation overlapping a
 * weekend deducts nothing; `unavailable` is not vacation and is not passed here.
 */
export function monthlyTargetHours(
  year: number,
  month: number,
  fte: number,
  workdayVacationDays: number,
): number {
  return Math.round(monthlyNormHours(year, month) * fte) - 8 * workdayVacationDays;
}

/** Count the dates (YYYY-MM-DD) that fall on a working day (Mon–Fri). */
export function countWorkdayVacationDays(dates: Iterable<string>): number {
  let n = 0;
  for (const iso of dates) {
    const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
    const wd = new Date(y, m - 1, d).getDay();
    if (wd >= 1 && wd <= 5) n++;
  }
  return n;
}
