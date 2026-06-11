"""
Tests for the art. 130 KP monthly-norm calculation.

Run:  solver/.venv/Scripts/python.exe -m pytest solver/test_norm.py   (or)
      solver/.venv/Scripts/python.exe solver/test_norm.py

The full 2026 table is the ground truth; June 2026 = 168h is independently
confirmed by the real schedule Daria produced (PDF header), and July 2026 = 184h
is the value the step-1 solver target must use (NOT the old hardcoded 160).
"""
from norm import monthly_norm_hours, target_hours

# art. 130 norm for every month of 2026 (hours).
NORM_2026 = {
    1: 160, 2: 160, 3: 176, 4: 168, 5: 160, 6: 168,
    7: 184, 8: 160, 9: 176, 10: 176, 11: 160, 12: 160,
}


def test_full_year_2026():
    for month, expected in NORM_2026.items():
        assert monthly_norm_hours(2026, month) == expected, (
            f"month {month}: got {monthly_norm_hours(2026, month)}, expected {expected}"
        )


def test_june_2026_matches_real_schedule():
    # Daria's real June 2026 schedule header: "liczba godzin pracy: 168".
    assert monthly_norm_hours(2026, 6) == 168


def test_july_2026_is_184_not_160():
    # The bug we're fixing: the app hardcoded 160; July's true norm is 184.
    assert monthly_norm_hours(2026, 7) == 184


def test_target_subtracts_only_workday_vacation():
    # Full-time July (184h), 3 vacation days on Mon–Fri -> 184 - 24 = 160h.
    assert target_hours(2026, 7, 1.0, 3) == 160
    # No vacation -> full norm.
    assert target_hours(2026, 7, 1.0, 0) == 184
    # Half-time post -> half the norm.
    assert target_hours(2026, 7, 0.5, 0) == 92


if __name__ == "__main__":
    test_full_year_2026()
    test_june_2026_matches_real_schedule()
    test_july_2026_is_184_not_160()
    test_target_subtracts_only_workday_vacation()
    print("OK — all norm tests pass; 2026:", NORM_2026)
