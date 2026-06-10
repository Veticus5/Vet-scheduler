## Why

Dzisiejszy model kwalifikacji to abstrakcyjna liczba 1–5 (`qualificationLevel`, „wyżej = lepiej", znaczenie definiowane przez klinikę). Dla kierownika kliniki ta skala nic nie znaczy — klinika myśli rolami, a **każdy dział ma własny podział**: recepcja to kierownik / zastępca kierownika / doświadczony / niedoświadczony, a technicy i lekarze będą mieli swoje, inne kategorie. Nazwane kwalifikacje per grupa są czytelne dla użytkownika i dla AI (która mapuje opisy w stylu „min. 2 doświadczonych na zmianie" na konkretne reguły), a jednocześnie muszą zachować porządek senioralności, żeby reguły „≥ dany poziom" dalej działały.

## What Changes

- **BREAKING**: zastąpienie wolnej liczby `qualificationLevel` modelem **nazwanych, uporządkowanych tierów kwalifikacji definiowanych per grupa**. Każda `StaffGroup` ma własną listę tierów; pozycja na liście (`rank`) wyznacza senioralność.
- Recepcja zostaje zasiana czterema tierami (od najniższego): `niedoświadczony` → `doświadczony` → `zastępca kierownika` → `kierownik`. Technicy i lekarze dostają na razie pojedynczy domyślny tier (placeholder) — ich właściwy podział powstanie w osobnych zmianach.
- Pracownik niesie **klucz tieru** ważny dla swojej grupy zamiast liczby. Zmiana grupy wymusza wybór tieru z nowej grupy.
- Reguły `qualification-coverage` i `pairing` dalej operują na **progu senioralności**, ale wyrażonym jako `rank` tieru w obrębie grupy reguły — semantyka walidatora („≥ próg") pozostaje bez zmian.
- UI [StaffPage.tsx](ui/src/pages/StaffPage.tsx): zamiast pola liczbowego — lista wyboru tierów zależna od wybranej grupy.
- Kontekst dla AI ([generate.ts](server/src/ai/generate.ts), [draft-rules.ts](server/src/ai/draft-rules.ts)) przekazuje **nazwy tierów** (z rankiem) zamiast nieprzejrzystych liczb, żeby AI mogła mapować „doświadczeni"/„kierownik" na właściwy próg/tier.
- Migracja DB: tabela definicji tierów per grupa + zasianie recepcji; przeniesienie istniejących pracowników z liczby na tier.

## Capabilities

### New Capabilities
- `staff-qualifications`: nazwane, uporządkowane kategorie kwalifikacji definiowane osobno dla każdej grupy personelu (recepcja/technicy/lekarze), przypisywane pracownikom i wykorzystywane jako próg senioralności w regułach harmonogramowania.

### Modified Capabilities
<!-- Brak. Capability staff-management należy do wciąż aktywnej (niezarchiwizowanej) zmiany schedule-generator, więc nie tworzymy delty wobec nieistniejącego spec bazowego. Nowa zdolność staff-qualifications zastępuje dotychczasowe ujęcie „poziomu kwalifikacji" i będzie scalona przy archiwizacji. -->

## Impact

- **Shared** ([index.ts](shared/src/index.ts)): nowy typ `QualificationTier` (`key`/`label`/`rank`), definicje tierów per grupa, zamiana `Employee.qualificationLevel: number` na klucz tieru; doprecyzowanie, że `minQualificationLevel` w `pairing`/`qualification-coverage` to `rank`.
- **DB** ([migrate.ts](server/src/db/migrate.ts)): nowa migracja — tabela `qualification_tiers` (per grupa, z rankiem), zasianie recepcji + domyślnych tierów techników/lekarzy, migracja kolumny pracownika z liczby na klucz tieru.
- **Server**: [repos/employees.ts](server/src/repos/employees.ts) i [api/employees.ts](server/src/api/employees.ts) (odczyt/zapis/walidacja tieru), [validator.ts](server/src/domain/validator.ts) (rozwiązanie tier→rank przy porównaniach), nowy odczyt definicji tierów (repo + endpoint dla UI).
- **UI**: [StaffPage.tsx](ui/src/pages/StaffPage.tsx) (lista tierów zależna od grupy), [api.ts](ui/src/api.ts) (pobranie definicji tierów).
- **AI**: [generate.ts](server/src/ai/generate.ts) i [draft-rules.ts](server/src/ai/draft-rules.ts) — przekazywanie nazw tierów w kontekście.
- **Testy**: walidator (`qualification-coverage`/`pairing` na rankach tierów), integracja (tworzenie pracownika z tierem), normalizator reguł AI.
- **Zależności**: brak nowych.
