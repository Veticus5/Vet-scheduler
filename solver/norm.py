"""
Monthly working-time norm (wymiar czasu pracy) per art. 130 of the Polish
Labour Code. The norm is NOT a constant — it varies month to month (160–184h in
2026) — so the per-employee hours target must be computed from the calendar, not
hardcoded.

art. 130 §1–2:
  norm = (full weeks x 40h) + (leftover Mon–Fri days x 8h)
         − 8h for every public holiday falling on a day OTHER than Sunday.

Summing 8h per Mon–Fri day equals (40 x full_weeks + 8 x leftover_weekdays),
so the two forms are identical. A holiday on a workday (Mon–Fri) is added then
subtracted (net 0); a holiday on a Saturday is only subtracted (net −8, the
art. 130 reduction); a holiday on a Sunday changes nothing.

Movable feasts (Easter Monday, Corpus Christi) and statutory changes (Christmas
Eve became a holiday in PL from 2025) come from the `holidays` library, so there
is no hand-maintained date list to drift.
"""
from calendar import monthrange
from datetime import date

import holidays


def monthly_norm_hours(year: int, month: int) -> int:
    """Statutory monthly working-time norm in hours for a full-time post."""
    pl = holidays.Poland(years=year)
    hours = 0
    for day in range(1, monthrange(year, month)[1] + 1):
        if date(year, month, day).weekday() < 5:  # Mon–Fri
            hours += 8
    for holiday_date in pl:
        if holiday_date.month == month and holiday_date.weekday() != 6:  # not Sunday
            hours -= 8
    return hours


def target_hours(year: int, month: int, fte: float, workday_vacation_days: int) -> int:
    """
    Per-employee monthly target: the statutory norm scaled by the post's FTE,
    minus 8h for each VACATION (urlop) day that falls on a working day (Mon–Fri).
    Vacation overlapping a weekend deducts nothing — urlop is counted in Mon–Fri
    days. `unavailable` requests are NOT vacation and do not reduce the norm.
    """
    norm = monthly_norm_hours(year, month)
    return round(norm * fte) - 8 * workday_vacation_days
