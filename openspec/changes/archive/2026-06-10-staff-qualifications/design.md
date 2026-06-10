## Context

Model pracownika niesie dziś `qualificationLevel: number` ([index.ts:26-42](shared/src/index.ts#L26-L42)) — wolną liczbę („wyżej = lepiej", znaczenie definiowane przez klinikę), w UI renderowaną jako pole liczbowe 1–5 ([StaffPage.tsx:77-85](ui/src/pages/StaffPage.tsx#L77-L85)). Liczba ta jest używana w dwóch miejscach walidatora — `qualification-coverage` (≥N osób o poziomie ≥X na zmianie) i `pairing` (każdy o poziomie ≥X musi mieć parę), oba przez `e.qualificationLevel >= p.minQualificationLevel` ([validator.ts:210,234](server/src/domain/validator.ts#L210)). Trafia też do kontekstu AI ([generate.ts:65](server/src/ai/generate.ts#L65), [draft-rules.ts:261](server/src/ai/draft-rules.ts#L261)).

Klinika nie myśli liczbą — myśli rolami, i **każdy dział ma własny podział**. Recepcja: kierownik / zastępca kierownika / doświadczony / niedoświadczony ([docs/department-rules/reception.md:13-15](docs/department-rules/reception.md#L13-L15)). Technicy i lekarze będą mieli swoje, jeszcze nieznane kategorie. Architektura jest celowo „foundation generyczny + warstwy per grupa" — ta zmiana wprowadza generyczny mechanizm tierów i zasiewa tylko recepcję.

## Goals / Non-Goals

**Goals:**
- Nazwane kategorie kwalifikacji definiowane **osobno per grupa**, czytelne w UI i dla AI.
- Zachowanie porządku senioralności (`rank`), żeby reguły progowe (`≥ poziom`) działały bez zmiany logiki walidatora.
- Bezpieczna migracja istniejących danych (liczba → tier) i zasianie recepcji.
- Tiery techników/lekarzy łatwe do dodania później bez kolejnej zmiany schematu.

**Non-Goals:**
- Definiowanie właściwych tierów techników i lekarzy (osobne, przyszłe zmiany).
- Reguły zależne od *stanowiska* (dni biurowe kierownika/zastępcy, kolejność na górze grafiku, „<3 mies. nie sam w weekend") — to warstwa reception-scheduling, nie ta zmiana.
- UI do edycji samej listy tierów (CRUD tierów) — na razie tiery są zasiane/migracyjne, nie edytowalne z poziomu aplikacji.

## Decisions

### D1: Tier = `{ key, label, rank }` per grupa; pracownik trzyma klucz tieru
Każda grupa ma uporządkowaną listę tierów. `rank` (1 = najniższy) wyznacza senioralność. `Employee.qualificationLevel: number` → `Employee.qualificationTier: string` (klucz tieru, unikalny w obrębie grupy).

Recepcja (rank rosnąco): `niedoswiadczony` (1), `doswiadczony` (2), `zastepca-kierownika` (3), `kierownik` (4).
Technicy/lekarze: pojedynczy domyślny tier `podstawowy` (rank 1) — placeholder do czasu ich zmian.

- *Alternatywa A — globalny enum ról*: odrzucona; user wprost chce osobny podział per dział.
- *Alternatywa B — zostawić liczbę, dołożyć osobne pole „stanowisko"*: odrzucona; user traktuje te cztery kategorie jako *kwalifikacje*, nie osobny wymiar.

### D2: Reguły referują **rank**, nie klucz tieru
`RuleParamsPairing.minQualificationLevel` i `RuleParamsQualificationCoverage.minQualificationLevel` pozostają liczbą, ale **redefiniujemy znaczenie**: to minimalny `rank` tieru w obrębie grupy reguły. Walidator rozwiązuje `employee.qualificationTier` → `rank` (mapa per grupa) i porównuje jak dziś.

Uzasadnienie: te reguły są już skalowane do grupy (`inScope` filtruje instancje po `staffGroup`, a `assignedAt` zwraca tylko pracowników tej grupy — [validator.ts:204-243](server/src/domain/validator.ts#L204-L243)), więc próg rankowy jest jednoznaczny w kontekście grupy. Zachowujemy nazwę pola, by nie ruszać niepowiązanych typów i testów ponad konieczność — zmienia się tylko warstwa rozwiązywania tier→rank.

- *Alternatywa — `minQualificationTier: string` (klucz)*: czytelniejsze, ale klucze są per grupa, więc dla reguł cross-group dwuznaczne; rank jest porównywalny w obrębie grupy i wystarcza. Zostawiamy rank.

### D3: Definicje tierów w DB, ładowane do pamięci; nowy endpoint dla UI
Nowa tabela `qualification_tiers(group, key, label, rank)` zasiana w migracji ze stałej `QUALIFICATION_TIERS` w shared (jedno źródło prawdy, wzór `seedStaffGroups` — [migrate.ts:113-118](server/src/db/migrate.ts#L113-L118)). Repo `qualifications.ts` czyta tiery (z mapą group→key→rank dla walidatora). Endpoint `GET /api/qualifications` zwraca tiery dla UI, by lista wyboru zależała od grupy. Walidator dostaje mapę rozwiązującą przez `ValidationContext` (analogicznie do `employees`/`shiftDefs`), a nie odczytuje DB sam.

### D4: Migracja danych liczba → tier (recepcja)
Mapowanie istniejących `qualification_level` recepcji na klucz tieru po rank: 1→niedoświadczony, 2→doświadczony, 3→zastępca, ≥4→kierownik (clamp). Dla pozostałych grup wszystko → `podstawowy`. Realizowane w SQL migracji (kolumna `qualification_tier TEXT`, backfill z `qualification_level`, potem kolumna liczbowa zostaje osierocona lub usunięta — patrz Migration Plan).

## Risks / Trade-offs

- **Kierownik/zastępca to stanowiska, nie tylko „wyższy staż"** → Mitygacja: na potrzeby harmonogramu są też najwyżej wykwalifikowani, więc ranking ich obejmuje; reguły *stanowiskowe* (dni biurowe, kolejność) świadomie odłożone do reception-scheduling (Non-Goal). Tier nie wymusza unikalności „dokładnie jeden kierownik" — to walidacja na później, jeśli będzie potrzebna.
- **Redefinicja `minQualificationLevel` jako rank** → Mitygacja: liczby w istniejących regułach/seedach mapują się 1:1 na ranki recepcji (1–4), więc zachowanie nie zmienia się dla obecnych danych; udokumentowane w spec.
- **Migracja kolumny w SQLite** (brak prostego DROP COLUMN w starszych wersjach) → Mitygacja: dodać `qualification_tier`, zrobić backfill; `qualification_level` zostawić jako nieużywaną (NULLowalną) lub przebudować tabelę w transakcji. Wybór w Migration Plan; bun:sqlite wspiera nowszy SQLite z `DROP COLUMN`, ale zostawienie kolumny jest bezpieczniejsze i wystarczające.
- **AI dostaje teraz nazwy tierów** → mała zmiana promptu; ryzyko, że model poda klucz zamiast ranku w regule → Mitygacja: normalizator reguł i tak waliduje liczby (`minQualificationLevel`), a kontekst podaje pary nazwa↔rank.

## Migration Plan

1. Dodanie stałej `QUALIFICATION_TIERS` (per grupa) i typów w shared; zmiana pola pracownika.
2. Migracja DB (nowa wersja w `MIGRATIONS`):
   - `CREATE TABLE qualification_tiers (group, key, label, rank, PRIMARY KEY(group,key))`;
   - `ALTER TABLE employees ADD COLUMN qualification_tier TEXT`;
   - backfill `qualification_tier` z `qualification_level` wg D4;
   - `qualification_level` pozostaje (nieużywana) — bez ryzykownego DROP.
3. Seed tierów ze stałej (idempotentny upsert, jak staff_groups).
4. Repo/API/validator/UI/AI przełączone na tier; testy zaktualizowane (ranki tierów).
5. Rollback: usunąć migrację nie można po zastosowaniu — rollback = wcześniejszy build; dane `qualification_level` nadal obecne, więc powrót do starej logiki możliwy bez utraty danych.

## Open Questions

- Czy lista tierów ma być w przyszłości edytowalna z UI (CRUD), czy pozostaje konfiguracją zasiewaną kodem? (Na teraz: kodem.)
- Czy walidator ma kiedyś egzekwować unikalność stanowisk (dokładnie jeden `kierownik` w recepcji)? Odłożone do reception-scheduling.
