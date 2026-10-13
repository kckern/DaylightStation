# Phase 6 — Macro & Micro Surfacing — execution report

Branch `feat/health-usability`, base `65c2df680`.

| Task | Status | Commit |
|---|---|---|
| 6.1 goals + budget macros/coverage | done | `586aeba1b` |
| 6.2 parse/catalog micro provenance | done | `d27279f3c` |
| 6.3 MacroBarRow + per-meal subtotals | done | `78bbaba79` |
| 6.4 docs | done | `36402bc02` |

## Test counts (suites touched)

| Suite | Tests | Note |
|---|---|---|
| `BudgetService.test.mjs` | 35 (was 11) | +24 |
| `health.goals.test.mjs` | 3 | new |
| `goalFields.test.js` | 17 | new |
| `micros.test.mjs` | 5 | new |
| `LogFoodFromText.micros.test.mjs` | 6 | new |
| `LogFoodFromImage.micros.test.mjs` | 3 | new |
| `FoodCatalogService.micros.test.mjs` | 7 | new |
| `microProvenance.roundtrip.test.mjs` | 3 | new, real YAML store |
| `MacroBarRow.test.jsx` | 15 | new |
| `MacroBarRow.styles.test.js` | 6 | new, compiled SCSS |
| `LogTable.test.jsx` | 24 (was 20) | +4 |

`frontend/src/modules/Health` — 24 files, 222 tests, all pass.
`npm run test:unit:vitest` — 2990 files, 32271 tests, 32162 pass. No health or
nutrition file fails. The 5 files reported "not in baseline" are pre-existing:
4 of 5 (PianoApp ×2, Life PlanCreate, fitness-timeline-pruning) fail identically
at `65c2df680` in a clean worktree; the 5th (`voiceArt.test.js`) *skips* without a
`.env` and fails wherever `DAYLIGHT_BASE_PATH` resolves, because the illustration
pack on the media mount is missing SVGs the module can name. Nothing Phase 6
touches is imported by any of them.

## Falsification results — every new test broken deliberately

| # | Break | Test(s) that failed |
|---|---|---|
| F1 | macro fold over all items instead of COUNTED | macro sum |
| F2 | groups left in the coverage denominator | group-coverage |
| F3 | coverage keyed off micro values | 4 coverage tests |
| F4 | `assertGoalsShape` not called | 17 refusal tests |
| F5 | unknown `macroGoals` key tolerated | unknown-key |
| F6 | absent `macroGoals`/`watchMicros` backfilled on save | absence |
| F7 | NaN guard removed from the macro summer | garbage-tolerance |
| F-router | `GOALS_INVALID` → 400 mapping removed | 400 envelope |
| F8 | `macroGoals` written even when every target cleared | 2 absence tests |
| F9 | cleared limit no longer removes the watch | 3 tests |
| F10 | fiber defaults to ceiling | 2 tests |
| F11 | unknown micro key accepted | unknown-micro |
| G1 | text mapper stamps `'ai'` unconditionally | macros-only |
| G2 | image mapper omits `microsSource` | 3 tests |
| G3 | dish header claims `'ai'` | 2 tests |
| G4 | catalog stores micros from unprovenanced rows | laundering |
| G5 | `quickAdd` always claims `'catalog'` | 2 tests |
| G6 | `microsSource` removed from `saveMany` whitelist | 2 round-trip tests |
| G7 | `hasMicroData` coerces (`null` reads as data) | strict-typing |
| H1 | coverage caption never rendered | 2 tests |
| H2 | caption suppressed at zero coverage | zero-coverage |
| H3 | over-goal macro painted as danger | tone |
| H4 | bar fill not clamped at 100% | tone/clamp |
| H5 | macro aria-label loses its numbers | 2 tests |
| H6 | per-meal subtotal double-counts children | 2 tests |
| H7 | legacy meal renders `P 0 · C 0 · F 0` | 2 tests |
| H8 | coverage caption hidden via `display:none` | stylesheet |
| H9 | over-limit painted warning instead of danger | stylesheet |

Every break failed exactly the test written to catch it and nothing else of
consequence; all were reverted and the suites re-run green.

## Manual check (6.3)

jsdom cannot see layout, so the bar row was rendered in a real browser
(Playwright, compiled `health.scss`, real `--ds-*` values) at 390 px and 1440 px.
Measured at 390 px: 8 px tracks, 234 px wide, a 55 %-goal fill measuring 129 px,
the caption present, and six fills painting accent / warning / accent / danger /
text-low / accent as intended. The label column was widened to 5.5 rem after that
check because "Cholesterol" would otherwise have widened one item's grid and
knocked its bar out of alignment with the rest.

## Refusals / plan corrections

1. **The plan's Task 6.2 prompt work was already done.** The detection prompts in
   both `LogFoodFromText` and `LogFoodFromImage` already ask for
   `fiber/sugar/sodium/cholesterol` by name (Task 2.1). No second prompt site was
   created. What was actually missing was provenance, which is what shipped.
2. **All four field whitelists already carried `microsSource`.** Verified rather
   than assumed, and now guarded end-to-end: deleting it from `saveMany` fails
   `microProvenance.roundtrip.test.mjs` (falsification G6).
3. **Groups excluded from micro coverage** — deviation from the plan's literal
   `total` = counted items. Reasoning in decision log §2.8.
4. **`microsSource: 'ai'` is conditional** — deviation from "set `'ai'` in the
   mapper". Reasoning in decision log §2.9.

## Concerns

1. `microsSource` is one flag covering all four micros. A model that returns
   sodium but omits fiber marks the row covered for both. Per-key provenance
   would need per-key fields; the flag is what the stored shape supports.
2. `ProgressView.jsx` still has no test file (Highcharts). Its new fields are
   covered indirectly through the pure `progress/goalFields.js`.
3. `MacroBarRow` renders nothing until macro goals or watch micros are
   configured, so the feature is invisible on prod until goals are edited in
   Progress. That is deliberate, but it means a deploy alone will not show it.
4. The catalog only gains micros going forward. Existing catalog entries have
   none, so quick-adds stay uncovered until a provenanced capture of the same
   food re-donates. `POST /nutrition/catalog/backfill` will now carry micros from
   any historical row that has provenance — most do not.
5. `npm run test:unit:vitest` printed "5 NEW failing file(s) (not in baseline)"
   and still exited 0. Whatever the intended behaviour, the baseline file is
   stale relative to `main` and should be refreshed by whoever owns that gate.

---

# Fix round — review response

Commit `2b746a88c` (single commit; the four Phase 6 commits are unchanged).

## What was fixed

| Item | Fix |
|---|---|
| **C2** catalog laundering | Capture mappers now carry only the micros the model answered (`pickMicros` on the model's own item); the `?? 0` storage default moves to the persistence boundary, where `FoodItem`/`validateFoodItem` already applied it. `recordUsage` gates per key *and* per row. `backfill` donates no micros at all. |
| **C1** per-row granularity | README gains an explicit paragraph naming the limit, with the driven example. Caption reworded to "based on N of M items with any micro data". Component docblock states the guarantee. |
| **C3** an all-zero response still claims `'ai'` | Documented beside C1: `'ai'` means "the model answered", nothing stronger. |
| **C4** silent confident zero | Unknown coverage now renders "micro coverage unknown — this may be missing data, not a low number", in the caption and the accessible name. |
| **Finding 3** `syncFromLog` unguarded | New round-trip case drives a NutriLog through `syncFromLog`; deleting `dehydrateNutriListItem`'s `microsSource` fails it. |
| **Q1** three folds | `COUNTED` moved to `shared/contracts/nutrition/countedRows.mjs`, imported verbatim by `BudgetService`, `LogTable` and `MacroFooter`. |
| **aria clamp** | `fillPct` (clamped, paints the bar) split from `truePct` (unclamped, spoken). 300/150 g now announces "200 percent". |
| **Q3** ragged right edge | Value column fixed at 8.5rem and right-aligned. Re-measured at 390px: all 7 tracks span 104→238px. |
| **Q2** raw JSON in the goals form | `progress/goalSaveError.js` turns the coded refusal into a sentence. Fixed at the consumer, not in shared `api.mjs`. |
| **S1** goal tick / over-goal segment | Not built; accepted by the coordinator. Recorded as decision §2.11, with Q1 as §2.12, C1 as §2.13, C2 as §2.14. |

## What the catalog now donates

- **Live capture:** only the micro keys the model actually emitted, and only when
  the row carries `microsSource`. `{sodium: 1900, microsSource: 'ai'}` donates
  `{sodium: 1900}` — `fiber`/`sugar`/`cholesterol` stay **absent** on the entry.
- **Across captures:** keys accumulate; a later capture that omits a key never
  clears it, and never writes a zero it was not given.
- **Backfill:** nothing. A stored row's micros were defaulted at the persistence
  boundary, so per-key provenance is gone before history can be read.
- **Quick-add:** inherits exactly the keys the entry holds, stamped `'catalog'`
  when the entry holds any; an unheld micro stays absent on the row.
- The stored day-log row is unchanged: it still carries all four micros as
  numbers, because that is the schema. Only the donation is per key.

## Test counts (real, exit code of the command itself)

- Health / nutrition / nutribot / shared-contracts / touched adapters + all of
  `frontend/src/modules/Health`: **58 files, 597 tests, all pass, exit 0.**
- Full gate `npm run test:unit:vitest`: **exit 1** — 2992 files, 32297 tests,
  32188 pass, 16 files failing (12 baseline + 4 not in baseline: `PianoApp` ×2,
  `PlanCreate`, `fitness-timeline-pruning`). No health, nutrition,
  macro, budget or catalog file appears anywhere in the failure output. Those 4
  are the ones reproduced at `65c2df680`; the coordinator's `vi.mock` fix for two
  of them is on `main` and this branch predates it. `voiceArt` is gone from the
  list now that the asset outage is fixed.
- **Correction:** my earlier "the gate exits 0" was wrong. `gate-vitest.mjs`
  exits 1 unconditionally on a non-baseline failure; I had read a pipeline's
  status through `| tail`. Every count above comes from `$?` of the command
  itself, captured before any pipe.

## Falsification — fix round (each break reverted, suites re-run green)

Baseline for this round: 12 files / 143 tests, all passing.

| # | Break | Test(s) that failed |
|---|---|---|
| R1 | text mapper re-defaults micros before the catalog sees them (the C2 bug) | catalog-donation |
| R2 | catalog donation gated per row only, not per key | 3 catalog tests |
| R3 | backfill donates already-defaulted history micros | backfill |
| R4 | `microsSource` deleted from `dehydrateNutriListItem` | syncFromLog round-trip (**Finding 3 closed**) |
| R5 | unknown coverage treated as fully covered (C4 bug) | 3 hedge tests |
| R6 | caption reverted to per-micro-implying wording | 3 caption tests |
| R7 | accessible name announces a clamped 100 percent | true-percentage |
| R8 | `MacroFooter` folds `day.items` unfiltered (Q1 bug) | footer fold |
| R9 | per-meal kcal + macro subtotals fold raw rows (Q1 bug) | 2 fold tests |
| R10 | `'deleted'` dropped from the shared uncounted set | 6 tests, server and client |
| R11 | `GOALS_INVALID` surfaces as raw JSON (Q2) | 3 error-sentence tests |
| R12 | value column back to `auto` (Q3) | stylesheet column |

R10 is the one worth noting: a single edit to the shared contract failed tests on
**both** sides of the wire, which is the property Q1 was asking for.

## Visual re-check

390px and 1440px, real Chromium, compiled `health.scss`. Seven bars including
Cholesterol: every track left edge 104px, every right edge 238px (was
238/232/244/204/250/222). Caption present and legible; tones unchanged.

## Concerns

1. **Catalog entries written before this fix may already hold donated structural
   zeros.** Nothing sweeps them, and a `fiber: 0` already in an entry keeps being
   inherited as a `'catalog'` reading. A fresh provenanced capture overwrites the
   keys it answers but never clears one it does not. Recorded as open item 15.
2. **Per-row provenance remains.** C1 is now documented and worded honestly, but
   a watched fiber bar can still read `0 / 30 g` with no caption on a day of
   sodium-only captures. The real fix is four provenance fields where there is
   one; that is a stored-shape change and out of this program's scope.
3. `ProgressView.jsx` still has no test file (Highcharts). Its two new pure
   helpers — `goalFields.js` and `goalSaveError.js` — are tested; the rendering
   is not.
4. The 4 non-baseline gate failures are pre-existing on this branch and fixed on
   `main`; they will clear on merge. The baseline file itself is stale relative
   to `main`.
