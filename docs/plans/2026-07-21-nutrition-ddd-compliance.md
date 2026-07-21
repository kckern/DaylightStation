# Nutrition DDD Compliance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the three shipped `2_domains/nutrition` scan modules into compliance with `docs/reference/core/layers-of-abstraction/ddd-reference.md` before Tasks 4-12 of the scan-enriched food logging plan build on their current shape.

**Architecture:** Two stateless modules move into `services/` with the documented `{Name}Service.mjs` naming. The stateful `CompositionBuffer` splits in two: an immutable `Composition` **value object** in the domain, and a `CompositionStore` holding the `Map<scaleId, …>` in `3_applications/nutribot/`, mirroring the existing `GameShowSessionStore` precedent. The domain stops having an opinion about where compositions live, which is what lets the Telegram and scan paths share it.

**Tech Stack:** Node ESM (`.mjs`), vitest, existing `ValidationError` from `#domains/core/errors/index.mjs`.

**Parent plan:** `docs/plans/2026-07-21-scan-enriched-food-logging.md` (Tasks 1-3 shipped; this remediates them).
**Reference:** `docs/reference/core/layers-of-abstraction/ddd-reference.md`.

---

## Why this exists

Three violations, found by auditing the shipped code against the DDD reference:

1. **File locations.** The reference's File Locations table puts domain services at `2_domains/{domain}/services/{Service}Service.mjs`. Nutrition is already organized that way (`services/FoodLogService.mjs`, `services/CalorieColorService.mjs`, `entities/NutriLog.mjs`), but `ScanVocabulary.mjs`, `scanNutrition.mjs` and `CompositionBuffer.mjs` all sit at the domain root.

2. **`CompositionBuffer` is stateful.** It holds `const scales = new Map()` in closure state, mutated across calls (`CompositionBuffer.mjs:137`). The reference says `2_domains` contains "Entities, Value Objects, Domain Services, Rules," and that domain services are "**Stateless** — all data via parameters." A mutable in-memory per-scale store is none of the four.

3. **Naming.** `scanNutrition.mjs` is camelCase where the convention is PascalCase `{Name}Service.mjs`.

**Why it matters beyond tidiness:** `CompositionBuffer` is a scan-shaped store keyed by `scaleId`, which is exactly why the Telegram path can't share it. An immutable `Composition` is modality-agnostic — a Telegram density tap and a `dl:4` scan both produce `composition.withDensity(4)`, and the application layer decides whether that lives in a `Map` keyed by `scaleId` or in the food log keyed by `logUuid`.

---

## Before You Start

**Branch:** work on `main`. **Verify `git branch --show-current` returns `main` immediately before every commit** — this checkout is shared with another active worker and the branch has flipped mid-task several times. Run `git checkout main` if it isn't. Never create a branch.

**Do not touch `docs/plans/*`** — the orchestrator owns those.

**Preserve the existing test suite.** `tests/unit/domains/nutrition/CompositionBuffer.test.mjs` is a strong suite — 51 tests, and 27 non-equivalent mutants were killed against it across three sweeps. It encodes hard-won behaviour (slot consumption at placement end, heartbeat excluded from window refresh, strict finite-number contract, `now` required). **Port it, do not rewrite it from scratch.** Every behaviour it asserts must still be asserted somewhere after the split.

**House style for value objects:** read `backend/src/2_domains/fitness/value-objects/LockdownState.mjs` first. Private `#fields`, validation in the constructor, `Object.freeze(this)`, getters, `toData()`, `static fromData()`, `static create()`.

**Precedent for the store:** `backend/src/3_applications/gameshow/GameShowSessionStore.mjs`.

**Error convention:** `ValidationError` from `#domains/core/errors/index.mjs` — the explicit `/index.mjs` is REQUIRED (`#domains/*` has no directory resolution; the bare form throws `ERR_UNSUPPORTED_DIR_IMPORT`).

**Behaviour must not change.** This is a structural refactor. If you find a behavioural bug, report it — do not fix it silently in the same commit.

---

## Task 1: Relocate `ScanVocabulary` into `services/`

**Files:**
- Move: `backend/src/2_domains/nutrition/ScanVocabulary.mjs` → `backend/src/2_domains/nutrition/services/ScanVocabularyService.mjs`
- Move: `tests/unit/domains/nutrition/ScanVocabulary.test.mjs` → `tests/unit/domains/nutrition/services/ScanVocabularyService.test.mjs`
- Modify: `backend/src/2_domains/nutrition/index.mjs`

**Step 1: Move both files with `git mv`** so rename history is preserved (`git log --follow` must still trace them).

```bash
mkdir -p backend/src/2_domains/nutrition/services tests/unit/domains/nutrition/services
git mv backend/src/2_domains/nutrition/ScanVocabulary.mjs \
       backend/src/2_domains/nutrition/services/ScanVocabularyService.mjs
git mv tests/unit/domains/nutrition/ScanVocabulary.test.mjs \
       tests/unit/domains/nutrition/services/ScanVocabularyService.test.mjs
```

**Step 2: Update the barrel** `backend/src/2_domains/nutrition/index.mjs` — change the source path only. Exported names do not change: `parseScan`, `encodeDensity`, `encodeContainer`, `RESET_CODE`, `MAX_DENSITY_LEVEL`.

**Step 3: Find every other importer.**

```bash
grep -rn "ScanVocabulary" backend/ tests/ --include=*.mjs | grep -v node_modules
```

`CompositionBuffer.mjs` imports `MAX_DENSITY_LEVEL` directly from it (not via the barrel, to avoid a cycle). Update that path. Leave the direct-import decision alone — it is correct.

**Step 4: Run.**

```bash
npx vitest run tests/unit/domains/nutrition/
```
Expected: same test count as before the move, all passing.

**Step 5: Commit.**

```bash
git add -A backend/src/2_domains/nutrition tests/unit/domains/nutrition
git commit -m "refactor(nutrition): move scan grammar into services/ per the DDD file-location table"
```

---

## Task 2: Relocate `scanNutrition` into `services/`

**Files:**
- Move: `backend/src/2_domains/nutrition/scanNutrition.mjs` → `backend/src/2_domains/nutrition/services/ScanNutritionService.mjs`
- Move: `tests/unit/domains/nutrition/scanNutrition.test.mjs` → `tests/unit/domains/nutrition/services/ScanNutritionService.test.mjs`
- Modify: `backend/src/2_domains/nutrition/index.mjs`

Same procedure as Task 1. Exported names unchanged: `computeNet`, `computeNutrition`. Check for importers with `grep -rn "scanNutrition" backend/ tests/ --include=*.mjs | grep -v node_modules`.

Run `npx vitest run tests/unit/domains/nutrition/`, confirm the count is unchanged, then commit:

```bash
git commit -m "refactor(nutrition): move scan nutrition math into services/ per the DDD file-location table"
```

---

## Task 3: The `Composition` value object

**Files:**
- Create: `backend/src/2_domains/nutrition/value-objects/Composition.mjs`
- Create: `backend/src/2_domains/nutrition/value-objects/index.mjs`
- Test: `tests/unit/domains/nutrition/value-objects/Composition.test.mjs`
- Modify: `backend/src/2_domains/nutrition/index.mjs`

TDD. Failing test first, confirm it fails for the right reason, implement, confirm pass.

**What it is:** an immutable snapshot of one in-progress food composition — the three slots and nothing else. **No window, no expiry, no `now`, no Map.** Those are the store's concern (Task 4).

**Required surface:**

| Member | Contract |
|--------|----------|
| `static empty()` | all slots null |
| `static fromData(data)` | reconstitute from a plain object |
| `withWeight({ grams, unit })` | returns a NEW Composition; `grams` must be a finite number; `unit` absent/null defaults to `'g'`, present-but-unusable throws |
| `withDensity(level)` | returns a NEW Composition; integer 1..`MAX_DENSITY_LEVEL`, else `ValidationError` |
| `withContainer(containerId)` | returns a NEW Composition; non-empty string, else `ValidationError` |
| `grams` / `unit` / `density` / `container` | getters |
| `isComplete` | getter — `grams !== null && density !== null` |
| `equals(other)` | value equality across all four slots |
| `toData()` | plain object, safe to persist |

**Carry these behaviours across verbatim from `CompositionBuffer`** — they were each pinned by mutation testing:

- **Strict finite numbers, no coercion.** `Number(x) || 0` and bare `Number(x)` are forbidden. A numeric string is a defect, not an input — Task 2's `computeNet` throws on strings, so accepting them here would promise a completeness the pipeline can't deliver.
- **Validate before constructing.** A rejected `withDensity` must not produce a mutated or half-built instance.
- **`unit` never gates `isComplete`.** The composition carries `'ml'` faithfully; the refusal belongs to the application layer.
- **Density validated against `MAX_DENSITY_LEVEL`**, imported from `services/ScanVocabularyService.mjs` **directly, not via the barrel** — the barrel re-exports this module, so a barrel import would cycle.

**Immutability is the point.** `Object.freeze(this)` in the constructor, every `with*` returns a new instance, and a test must assert the original is unchanged after a `with*` call. That test is what makes this a value object rather than a renamed mutable bag.

**Test the equality contract too:** two compositions built by different paths but with identical slots must be `equals`, and any single differing slot must not be.

**Step: barrel.** Create `value-objects/index.mjs` re-exporting `Composition` (see `2_domains/fitness/value-objects/index.mjs` for the style), and export it from the domain barrel.

**Commit:** `feat(nutrition): Composition value object — immutable, modality-agnostic slots`

---

## Task 4: `CompositionStore` in the application layer

**Files:**
- Create: `backend/src/3_applications/nutribot/CompositionStore.mjs`
- Test: `tests/unit/applications/nutribot/CompositionStore.test.mjs`

TDD. Model the file on `backend/src/3_applications/gameshow/GameShowSessionStore.mjs`.

**What it is:** the `Map<scaleId, { composition, touchedAt }>` plus the window/expiry rules. It holds `Composition` values and never reimplements their validation.

**Required surface — keep the names, so the ported tests stay legible:**

`setWeight(scaleId, { grams, unit })`, `setDensity(scaleId, level)`, `setContainer(scaleId, containerId)`, `endPlacement(scaleId)`, `clear(scaleId)`, `read(scaleId)`.

`read()` returns `{ grams, unit, density, container, complete, active }` — the same shape `CompositionBuffer.read()` returns today, so downstream tasks are unaffected.

**Behaviours that MUST survive the port.** Each was pinned by a killed mutant; a port that loses one is a regression:

1. **`now` is required** — throw if absent. No `Date.now()` default. `Date.now` must not appear in executable code.
2. **Slots are consumed unconditionally at `endPlacement`** — no weight-gate. The relay's suspicion filter (`_extensions/food-scale-relay/config.example.yml:70-79`) routinely ends sessions with no weight posted, so a gate lets scans survive into the next placement and auto-accept a wrong entry.
3. **The window refresh set is `{setWeight, setDensity, setContainer}` only.** `read()` must NOT refresh. The firmware heartbeats at 0.5 Hz while the scale rests on its shelf; a refreshing read would mean the buffer never expires.
4. **Expiry is `now() - touchedAt > windowMs`** — strictly greater. The exact-boundary case is tested.
5. **A rejected setter leaves the store untouched** — no slot created, no window refreshed. Validate (by constructing the new `Composition`, which throws) before writing to the Map.
6. **Scales are independent** — one scale's slots never affect another's.
7. **`endPlacement` and `clear` both return a boolean** indicating whether anything was live, and both return `false` on an already-expired entry.
8. **`read()` never returns internal state** — a caller mutating the returned object must not affect the store.

**Port the test file.** Start from `tests/unit/domains/nutrition/CompositionBuffer.test.mjs`, move it to the new path, and adjust construction (`new CompositionStore({ windowMs, now })`) and imports. Do not drop cases. Cases that are now about `Composition` rather than the store (slot validation, immutability) belong in Task 3's suite — move them there rather than deleting them.

**Layer check:** `3_applications` may import `2_domains` — that direction is legal. Run `npm run audit:layers` and confirm no NEW regressions in any counter. The `apps-*` and `api-*` counters are already red from pre-existing work; note their values before and after and confirm they are unchanged.

**Commit:** `feat(nutribot): CompositionStore — per-scale composition state with window expiry`

---

## Task 5: Delete `CompositionBuffer`

**Files:**
- Delete: `backend/src/2_domains/nutrition/CompositionBuffer.mjs`
- Delete: `tests/unit/domains/nutrition/CompositionBuffer.test.mjs` (already ported in Tasks 3-4)
- Modify: `backend/src/2_domains/nutrition/index.mjs` — drop the `createCompositionBuffer` export

**Step 1: Confirm nothing imports it.**

```bash
grep -rn "CompositionBuffer\|createCompositionBuffer" backend/ tests/ docs/ --include=*.mjs --include=*.md | grep -v node_modules
```

Only `docs/` hits are acceptable at this point; the orchestrator updates those.

**Step 2:** Delete, update the barrel, run the full nutrition and nutribot suites.

```bash
npx vitest run tests/unit/domains/nutrition/ tests/unit/applications/nutribot/
```

**Step 3: Verify no behaviour was lost.** Sum the assertions: the pre-refactor `CompositionBuffer.test.mjs` had 51 tests. Confirm the combined `Composition` + `CompositionStore` suites cover every behaviour listed in Task 4's numbered list, and say explicitly in your report which test now covers each of the eight.

**Step 4: Mutation-check the port.** Reintroduce, one at a time, and confirm each is killed:
- the `endPlacement` weight-gate
- a `Date.now()` default for `now`
- `read()` refreshing the window
- `>` → `>=` in the expiry comparison
- `Number(x) || 0` coercion in `withWeight`

Restore the source after each and re-verify the suites are green. Report the kill counts.

**Commit:** `refactor(nutrition): retire CompositionBuffer for Composition + CompositionStore`

---

## Task 6: Domain barrel tidy

**Files:**
- Modify: `backend/src/2_domains/nutrition/index.mjs`

Group the exports by building block with a comment header per group — Entities, Value Objects, Services — matching the structure of `2_domains/fitness/index.mjs`. No behaviour change, no new exports.

Run `npx vitest run tests/unit/domains/nutrition/ tests/unit/applications/nutribot/` and `npm run audit:layers`.

**Commit:** `refactor(nutrition): group domain barrel exports by DDD building block`

---

## Out of scope — do NOT do these here

- **Converting `{ netG, tared, clamped }` to value objects.** The DDD reference lists Weight as a value-object candidate, and returning plain objects is a knowing deviation. It is recorded, not accidental. Leave it.
- **Converging the Telegram and scan paths.** That is separate work in the parent plan (revising Tasks 5-6 there). This plan only makes it *possible* by removing the domain's opinion about storage.
- **The per-scale serialization primitive.** Still unowned, still assigned to the parent plan's Task 6. `CompositionStore` is synchronous and safe in isolation; it does not solve the cross-path race.
- **Fixing any behavioural bug you find.** Report it instead.

---

## Definition of done

- `backend/src/2_domains/nutrition/` root contains only `index.mjs`; everything else is under `entities/`, `services/`, or `value-objects/`.
- No stateful module remains in `2_domains/nutrition`.
- `npm run audit:layers` shows no new regressions in any counter.
- Every one of the eight numbered behaviours in Task 4 is covered by a named test, and the five mutants in Task 5 Step 4 are all killed.
- `git log --follow` still traces both moved modules through the rename.
