# Reception scheduling rules — draft input for a future OpenSpec change

> Status: **draft / not yet specced.** This file captures the clinic's reception (recepcja)
> scheduling rules as provided, plus a first categorization. It is the prepared input for a
> future `reception-scheduling` OpenSpec change that will build on the `schedule-generator`
> foundation. Doctors (lekarze) and technicians (technicy) will get their own files/changes.
> Rules for those groups are not yet known.

## Raw rules (as provided)

1. Two shifts Mon–Fri: 7:30–15:30 and 14:30–22:30. A mid-shift 10:00–18:00 sometimes occurs but not always — depends on employee requests and headcount.
2. Mon–Fri: 3–4 people per shift (there are 4 stations); never fewer than 3 Mon–Fri. Weekends: 2 in the morning, 2 in the afternoon. If not possible during the week, Justyna or Daria may take a weekend office day.
3. Mondays and Thursdays require 4 people on the morning shift (especially Mondays); the afternoon is also heavy.
4. Sat & Sun: 2 people morning, 2 afternoon; there is also a mid-shift 10:00–18:00.
5. Schedules must comply with labor law — i.e. respect the "doba pracownicza" (employee working day).
6. Manager and deputy manager must have designated **office days** marked **orange** in the schedule. For **Daria**: must be the first and last week of the month (doctor settlements / rozliczenia lekarskie), plus 3 days in the second week for making schedules, and occasionally ½ days for admin duties in the remaining weeks.
7. For **Justyna**: it is very important she has office time after Daria finishes the doctor schedule, and that she is mostly in the office (checking sales and statistical reports).
8. On weekend shifts, employees working at the clinic for less than 3 months must not be alone.
9. The clinic uses an equivalent working-time system (system równoważny), meaning an employee may legally work up to 11 days in a row, but we don't do that — max work stretch is about 7 days, unless requests force otherwise; for **Daria** and **Beata** it may be more.
10. Average number of working weekends is 2–2.5 depending on the month and requests; weekends should be distributed fairly evenly, unless someone is on vacation.
11. Mandatory: one weekend per month must be free.
12. Morning shifts are marked **pink**, afternoon shifts **blue**.
13. Employees: Justyna Fraszczyk (reception manager), Daria Kopacka (deputy manager), Monika Klorek-Markiewicz, Kinga Pieczyńska, Zuzanna Głuchowska, Beata Siecińska, Kaja Carter, Wiktoria Purol, Julita Groblica, Patrycja Wysocka, Zuzanna Wojna.
14. Experienced employees: Justyna Fraszczyk, Daria Kopacka, Monika Klorek-Markiewicz, Kinga Pieczyńska, Zuzanna Głuchowska, Beata Siecińska, Kaja Carter, Wiktoria Purol, Julita Groblica.
15. Inexperienced: Patrycja Wysocka, Zuzanna Wojna.
16. The schedule must show, above it: number of hours to work for the month, number of days off, and the month + year the schedule covers.
17. For Monika Klorek-Markiewicz: office until the 18th, then vacation until the end of the month.
18. Employees should have an equal number of morning and afternoon shifts — except Beata.
19. When building next month's schedule, account for the end of the previous month, so that the run of working days doesn't get too long.
20. Employees are listed alphabetically by surname, vertically. However, the manager must be at the very top and the deputy right below. It's good if on Tuesdays the deputy and manager are on different shifts.

## First categorization (to refine when speccing)

- **Shift definitions (reception):** rules 1, 4 — Mon–Fri morning 7:30–15:30 / afternoon 14:30–22:30 / optional mid 10–18; weekend morning+afternoon (2 each) + mid 10–18.
- **Coverage (hard, weekday-dependent):** rules 2, 3, 4, 8 — Mon–Fri 3–4/shift; Mon & Thu 4 morning; weekend 2+2; <3-month tenure not alone on weekend.
- **Working time / labor law (hard):** rules 5, 9, 11, 19 — doba pracownicza, equivalent system, max ~7 consecutive days (Daria/Beata more, legal cap 11), one free weekend/month, cross-month carryover.
- **Fairness (soft):** rules 10, 18 — ~2–2.5 weekends/month evenly distributed; equal AM/PM split per person except Beata.
- **Office days (special assignment, orange):** rules 6, 7, 17 — Daria (weeks 1 & last + 3 days week 2 + occasional ½ days); Justyna (office after Daria's doctor schedule, mostly office); Monika (office until 18th then vacation — likely a per-month request, not a permanent rule).
- **Display / output:** rules 6, 12, 16, 20 — colors (morning=pink, afternoon=blue, office=orange); header with monthly target hours, days-off count, month+year; ordering alphabetical by surname with manager top, deputy second; Tuesdays manager/deputy on different shifts (soft).
- **Staff data:** rules 13–15 — 11 employees, roles, experienced vs inexperienced.

## Open questions to resolve when speccing reception

- **Labor-law depth:** how strictly to enforce "doba pracownicza" + equivalent system — full automatic hard enforcement, warnings-only, or AI guidance? (Biggest scope driver.)
- **Tenure vs experience:** is the "not alone on weekend" rule (8) based on actual hire date (<3 months) or on the experienced/inexperienced flag? Need employee hire date if the former.
- **Office days:** full days only or also ½ days? Counted toward worked hours? Is Monika's case (17) a permanent rule or a per-month request?
- **Monthly target hours (rule 16):** computed automatically from the month's working-day calendar (per FTE/contract) or entered manually?
