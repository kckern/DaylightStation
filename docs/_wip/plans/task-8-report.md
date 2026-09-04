# Phase 8 — Viz & Layout — implementation report

Branch `feat/health-usability`, worktree `.claude/worktrees/health-usability`.
Merged `main` first: fast-forward `bc5c4f9c0..788a34833` (one piano commit; no conflicts).

**Not deployed.** Dev server on 3112/3113 only.

---

## Status per task

| Task | Status | Commit |
|---|---|---|
| 8.1 Batched budget range endpoint | done | `bbcafcc65` |
| 8.2 WeekStrip → per-day bars | done | `ce681bbc1` |
| 8.3 Weight widget | done | `ee4c5a735` |
| 8.4 Layout — max width + right sidebar | done | `77e5c64d1` |
| 8.5 Intake-vs-burn over time | done | `40a7733a8` |
| 8.6 Docs | done | `6f7778347` |

---

## Test counts (command's own exit code)

| Command | Exit | Result |
|---|---|---|
| `npx vitest run backend/src/3_applications/health/ backend/src/4_api/v1/routers/health.budgetRange.test.mjs frontend/src/modules/Health/` | **0** | 50 files, **461 tests passed** |
| `npm run audit:ui` | **0** | every counter at or under baseline (raw-color 546/548, raw-motion 74/75) |
| pre-commit chain (each commit) | 0 | ESM link, parse, SCSS build (314 entrypoints), composition contracts |
| `node scripts/gate-vitest.mjs` (whole repo) | **0** | 3010 files, 32535 tests — 32443 pass, 37 fail, 52 skipped; 11 failing files, all in the 12-entry baseline. "OK (no new failures vs baseline)", and 1 baseline file now passes |

New test files: `health.budgetRange.test.mjs`, `dayBars.test.js`, `weightSeries.test.js`,
`WeightChip.test.jsx`, `useBudgetRange.test.jsx`, `layout.test.js`,
`layout.contract.test.js`, `MonthBlock.test.jsx`, `intakeBurn.test.js`,
`IntakeBurnChart.test.jsx`, `ProgressView.range.test.jsx`. Extended:
`BudgetService.test.mjs`, `WeekStrip.test.jsx`.

All colocated under `backend/src/**` / `frontend/src/**` → vitest, which is the runner
that actually executes them.

---

## Falsification results

Every new behaviour was broken deliberately, the matching test confirmed failing, then
restored. Restore verified green after each.

| # | Break | Result |
|---|---|---|
| F1 | gap day rethrows instead of returning a gap object | 3 failed |
| F2 | range fans out to per-day `getWorkoutsForDate` | 3 failed |
| F3 | COUNTED filter dropped from the shared fold | 4 failed |
| F4 | 62-day cap removed | 2 failed |
| F5 | rows no longer bucketed by date | 3 failed |
| F6 | router maps `RANGE_INVALID` to 500 | 3 failed |
| F7 | a gap renders as a zero-height bar (the honesty lie) | 11 failed |
| F8 | bar height not clamped at the overshoot cap | 2 failed |
| F9 | accessible name announces the clamped, not the true, percentage | 1 failed |
| F10 | week strip back to a per-day fan-out | 2 failed |
| F11 | macro segments added to the strip (PRD F7.1 violation) | 1 failed |
| F12 | weight trend computed raw-to-raw instead of average-to-average | 3 failed |
| F13 | too-short history prints a confident `±0.0` | 3 failed |
| F14 | each sparkline series normalized to its own scale | 1 failed |
| F15 | a single reading draws a flat line across the box | 2 failed |
| F16 | direction cue is colour only (arrow removed) | 1 failed |
| F17 | a missing reading plotted as zero instead of skipped | 1 failed |
| F18 | JS breakpoint drifts from the stylesheet's | 1 failed |
| F19 | the 720px column cap removed | 1 failed |
| F20 | aside hidden on narrow instead of repositioned | 1 failed |
| F21 | grid rule overwrites the quick-capture clearance padding | 1 failed |
| F22 | month block hides its holes | 1 failed |
| F23 | month caption stops reporting holes | 1 failed |
| F24 | absent `matchMedia` reports WIDE (would fetch a month on a phone) | 1 failed |
| F25 | `useBudgetRange` ignores `enabled` and always fetches | 1 failed |
| F26 | intake/burn halves fixed at 50/50 instead of one shared scale | 3 failed |
| F27 | a gap drawn as a pair of zero-height bars | 4 failed |
| **F28** | gaps counted into the scale | **PASSED — finding against me** |
| F29 | negative food inverts the bar instead of clamping | 1 failed |
| F30 | intake/burn caption stops reporting holes | 1 failed |
| F31 | intake/burn columns shrink-wrap again (the empty-chart bug) | 2 failed |
| **F32** | ProgressView back to the 14-parallel-request fan-out | **PASSED — finding against me** |
| F28b | gaps counted into the AVERAGES (after fix) | 3 failed |
| F32b | ProgressView back to the fan-out (after fix) | failed |
| F33 | the 30-day intake/burn range dropped | failed |

### The two that passed, and what was done about them

**F28.** My "a gap contributes nothing to the scale" assertion could not detect the
mutation, because a real gap row carries no `food`/`exercise` at all — including gaps in
the maxima computation is a genuine no-op. The assertion was not wrong, it was inert.
The real risk it was meant to cover is holes diluting the *averages*, so that is now its
own test (`does not let holes dilute the averages`), and F28b confirms it fails when the
denominator includes gaps.

**F32.** `ProgressView.jsx` had **no test file at all** — the pre-existing gap recorded in
decision log §6.13 (it mounts Highcharts). So the headline refactor of Task 8.5 was
verified only by the live measurement. Fixed: `ProgressView.range.test.jsx` stubs
Highcharts and pins the network shape (two range requests, zero per-day ones). F32b and
F33 confirm it fails on the regression.

---

## Measured request count on a real page load

Playwright, dev server on 3112, all requests to `/api/v1/*` counted per navigation.

**Today (`/health`)**

| Viewport | total | `budget/range` | legacy `budget?date=` fan-out |
|---|---|---|---|
| 390 × 844 | 10 (9 app + 1 dev-server `boot-error`) | **1** (7-day) | 0 |
| 1440 × 900 | 10 | **2** (7-day + 30-day), each exactly once | 0 |

The 1440 count includes `GET /budget?date=2026-09-04` — that is `useHealthDay`'s own
single request for the *viewed day's* full budget (sessions, microCoverage), not a
fan-out. The desktop sidebar's month block and intake-vs-burn chart share ONE 30-day
request: adding the chart in Task 8.5 changed the count by zero.

**Progress (`/health/progress`)**: 2 `budget/range` requests, **0** legacy per-day
requests, at both 390 and 1440. Before this phase that page fired 14 parallel
`GET /budget?date=` calls on mount.

The three-consumers-at-once risk was closed structurally rather than by hoping the cache
would absorb it: `useApiResource`'s per-path cache dedupes a second page *load*, not two
simultaneous mounts, so `TodayView` owns the single 30-day fetch and passes `days` down.
The 30-day widgets' mount is additionally gated on the breakpoint, so a phone makes no
30-day request at all.

---

## What the screenshots showed

Real Playwright screenshots, `deviceScaleFactor: 2`, against the compiled stylesheet.
Kept in the scratchpad, not committed.

**390 × 844 (Today).** Single column, `.health-today` 358px wide (viewport-limited, under
the 720 cap). Equation strip, then the weight chip (`171.6 lb ■ ±0.0 / 7d` with a 30-point
two-line sparkline) at y=129, then the week strip at y=171 — i.e. the chip lands directly
under the macro bars as Task 8.3 requires. Seven narrow centred bars with a visible budget
reference line; the three days with food show green fills at 12.7% / 16.6% / 40.4%, the
four 0 kcal days show real empty tracks with a `0` readout. No month block mounted. No
horizontal scroll.

**1440 × 900 (Today).** `.health-today` 1064px wide (720 + 320 + 24 gap), centred at
x=288. Main column 720px carries equation, week strip and the meal log; the aside at
x=1032, w=320 carries the weight chip and the 30-day block (30 bars, mixed green/red,
caption "3 over budget"). No horizontal scroll.

**390 (Progress).** Weight chart, the 14-day adherence block (14 bars, "1 over budget"),
and the intake-vs-burn chart: blue down-bars for intake, green up-bars for burn around a
baseline, halves at 87.9% / 12.1% — the burn strip is visibly thin, which is the honest
shape of a month where intake dominates. Caption "avg 573 in · 218 out".

**Two defects the screenshots caught that jsdom could not**, both fixed and then pinned by
compiled-CSS assertions:

1. The aside pinned to `grid-row: 1` **stretched that row to its own height**, opening a
   ~150px hole under the equation strip in the main column (`.health-today` 822px → 745px
   after the fix).
2. The budget reference line was painted **under** the bar track — both are positioned
   siblings and the track comes later in the DOM — so it was invisible.
3. (Also caught) the intake/burn columns shrink-wrapped their bars, giving each bar a
   percentage height against an auto-height parent, which resolves to zero: the chart
   rendered completely empty while every jsdom assertion about the numbers passed.

---

## Deviations from the plan, and why

**1. `getWorkoutsForRange` added to `YamlHealthDatastore` (Task 8.1).** The plan said
"workouts per day via the existing store call". `getWorkoutsForDate` re-reads BOTH whole
lifelog files (`lifelog/strava`, `lifelog/fitness`) on every call, so a 62-day range
through it is 124 whole-file loads on one request — precisely the shape of the defect that
stalled the backend last phase. The range method reads each file once. `getBudget`'s
per-date path is unchanged.

**2. Range validation lives in the service, not the router (Task 8.1).** The plan put it
at the route. Putting it in `BudgetService.getBudgetRange` makes it unit-testable and
keeps one owner; the route maps `RANGE_INVALID` → 400. The user-visible contract is what
the plan asked for.

**3. `MacroBarRow`'s "expanded detail" is NOT duplicated into the aside (Task 8.4).** A
second macro surface on the same screen is a second thing to keep in sync, and the bars
already sit directly under the equation on both viewports, which is where they belong.
Decided rather than deferred.

**4. The aside's heavy widgets are gated in JS, not hidden in CSS (Task 8.4).** The plan
said "hidden via CSS, single source in JSX". Hiding still mounts, and mounting still
fetches — a phone would pull a month of budgets for a column it never draws. The JSX is
still single-source (one `<aside>`, one instance of each widget); the CSS repositions it,
and the breakpoint is asserted against the compiled stylesheet so the JS and SCSS copies
cannot drift.

**5. Progress's adherence bars reuse `MonthBlock` (Task 8.5).** The plan only said to move
the effect onto the range endpoint. Reusing the component also deleted `barHeightPx` — a
fourth local copy of the bar arithmetic — so there is now one bar geometry
(`today/dayBars.js`) behind the week strip, the month block and the adherence bars.

Nothing in the plan contradicted the code badly enough to refuse.

---

## Fixes made outside the task list

**A latent `RangeError` in date validation, on both sides of the wire.** `2026-08-32`
parses to `Invalid Date`, so the `toISOString()` round-trip both validators use *throws*
rather than returning a wrong day. Server-side that turned a `400 { RANGE_INVALID }` into
a 500; client-side one malformed weight row would have crashed the chip. Both now guard
`Number.isNaN(getTime())` first. Verified live: `?from=2026-08-32` returns 400.

---

## Concerns

1. **Two different weight endpoints are live on one app.** `WeightChip` reads
   `GET /api/v1/health/weight`; `ProgressView`'s chart reads `GET /api/v1/lifelog/weight`.
   They appear to serve the same file, but nothing pins that, and a divergence would show
   as two different current weights on two tabs. Not touched this phase.
2. **`useApiResource` has no in-flight dedupe.** Two simultaneous mounts of the same path
   still make two requests; only a later page load hits the cache. This phase works around
   it structurally (fetch high, pass `days` down), which is correct here but is a trap for
   the next person who drops a second `useBudgetRange` for the same window into a subtree.
   The hook is where the real fix belongs.
3. **`getBudgetRange` requires `getWorkoutsForRange` on the injected health store.** There
   is exactly one implementation, and the constructor does not check for it, so a future
   fake store that omits it fails at call time rather than at construction.
4. **The 62-day cap is enforced but the response is unbounded in width** — 62 days ×
   ~15 fields is small, but a caller asking for 62 days gets 62 full macro objects even
   when it only draws bar heights. Acceptable now; worth a `fields=` parameter if a third
   window appears.
5. **`MonthBlock` is not interactive.** 30 targets across 320px cannot be honest 44px tap
   targets (A2), so day navigation stays with the week strip. If someone later wants to
   tap a month bar, the answer is a bigger surface, not smaller targets.
6. **`scripts/audit-direct-fs-imports.mjs` crashes on a file that vanishes mid-run.** It
   lists the tree, then `readFileSync`s each entry, so a transient file removed between the
   two steps is an unhandled ENOENT rather than a skip. Hit once here when a commit's
   pre-commit hook raced a concurrently running `gate-vitest` that had created and deleted a
   `__sabotage_*.mjs` probe. Nothing to do with this phase's changes — the commit succeeded
   unchanged once the gate finished — but it will bite anyone who commits while a gate runs.
7. **The dev server logs a wall of `health.icons.render.failed` EACCES warnings** on this
   host — the icon cache directory is owned by uid 1000 and the dev process runs as 1001.
   Pre-existing, environment-only, unrelated to this phase, but it makes `dev.log` noisy.

---

# Fix round (review response) — commit `f8897c1fe`

## Status

| Item | Status |
|---|---|
| **C1** `getBudget`/day view archive-blind (live prod bug) | fixed — at the **store**, not at five call sites |
| **M1** fold-equality test hand-fed identical rows | fixed — one service, one store fake, one row set |
| **I2** vacuous F7.1 guard (reviewer broke it) | fixed — structural assertion; reviewer's exact break now fails |
| **I1** bar's two denominators / self-contradicting name | fixed — both encodings kept, words reconciled, non-colour cue added |
| **M4** duplicate React keys on undated gaps | fixed |
| **M5** no constructor check for `getWorkoutsForRange` | fixed |
| **M3** two weight endpoints | closed by the reviewer's evidence — downgraded to a documented note |
| **M2** zero-day track invisible on the active cell | deliberately deferred, recorded in decision log §6.15 |

## Test counts (command's own exit code)

| Command | Exit | Result |
|---|---|---|
| `npx vitest run frontend/src/modules/Health/ backend/src/3_applications/health/ backend/src/4_api/v1/routers/health.budgetRange.test.mjs` | **0** | 51 files, **484 tests passed** |
| `npm run audit:ui` | **0** | all counters at/under baseline |
| `node scripts/gate-vitest.mjs` (whole repo) | **not obtained — stood down** | see note |
| pre-commit chain | 0 | ESM link, parse, SCSS build, composition contracts |

New: `dayArchiveBoundary.test.mjs` (8 tests, real `YamlNutriListDatastore` on a temp
directory). Extended: `BudgetService.test.mjs`, `dayBars.test.js`, `WeekStrip.test.jsx`,
`MonthBlock.test.jsx`, `intakeBurn.test.js`, `layout.contract.test.js`.

## Falsification — every new/changed test

| # | Break | Result |
|---|---|---|
| G1 | revert `findByDate` to the shipped hot-file-only version (**the bug**) | 5 failed |
| G2 | archive-aware but without the `createdAt` fallback | 1 failed |
| G3 | drop the uuid dedupe (a lingering hot copy double-counts) | 1 failed |
| G4 | `findByDate` re-sorts like the range (reshuffles the day log) | 1 failed |
| G5 | read archives even inside retention (cost regression) | 1 failed |
| G6 | remove the `getWorkoutsForRange` constructor check (M5) | 1 failed |
| G7 | **the reviewer's exact break** — segments under a different class name | 1 failed |
| G8 | a segment smuggled in beside the bar, inside the box | 1 failed |
| G9 | a gap given a fill child (hollow cue destroyed) | 1 failed |
| G10 | label drops the reconciling exercise term (the shipped contradiction) | 4 failed |
| G11 | label announces the clamped percentage | 5 failed |
| G12 | "no exercise logged" omitted instead of stated | 2 failed |
| G13 | offset flag never set (green bar above the line, unexplained) | 3 failed |
| G14 | offset cue reduced to hue only (border removed) | 1 failed |
| G15 | M4 reverted — undated gaps share one key | 1 failed |

All 15 failed as intended; restore verified green after each. **No falsification came
back green this round.**

## Day and range now agree across the archive boundary

Driven against the running dev build, 62 days ending 2026-09-04, comparing
`GET /budget?date=` against the matching entry of `GET /budget/range`:

```
days compared: 62
MISMATCHES:     0
archived-side days with non-zero food seen by BOTH paths: 27
2026-07-30  day food: 248   range food: 248   day rows: 7
```

Against the **unfixed production container** at the same moment, the same day answers
`day food: 0`, `day rows: 0` — and 248 is exactly the figure the reviewer read off the
week strip. Both the totals and the rows that justify them now come from the same place.

In-browser after the fix: 0 bars with more than one child at either width, the offset cue
present on the one live day that needs it (1440 sidebar), reconciled label reading
`"Saturday, August 29, ate 0 of 1788 kcal, 0% of budget, with 355 kcal exercise, 2143
kcal left"`, request counts unchanged (390: 1 range; 1440: 2 ranges; Progress: 2 ranges,
0 legacy), no horizontal scroll.

## Which call sites changed, and why

Fixed at the store, so all five are correct with no call-site edits. Judged individually
first — the reasoning is in decision log §2.22:

- `HealthOperations:98` (day rows) — **must** match; it is the other half of the bug. A
  correct headline over an empty meal list is a worse lie than a consistent zero.
- `HealthOperations:214` (group siblings) — **must** match the day view, or editing a
  group on an archived day half-works.
- `BudgetService:279` — **must** match the range.
- `FoodCatalogService.backfill` — its `daysBack: 90` contract has always silently seen
  only 30 days; now it does what it says. Costs more on days 31–90; accepted (rare manual
  POST, correctness over speed).
- `CoachingOrchestrator:32` — one recent date, so no archive is touched; free and correct.

Nobody depended on hot-file-only behaviour: the write path is separately hot-file-only
and untouched.

## Concerns after this round

1. **Archived rows are now readable but not editable.** The write path (`update`,
   `findByUuid`, `remove*`, `updatePortion`) is hot-file only, so editing a row older
   than 30 days throws `NOT_FOUND`. Honest, but a newly *reachable* error — before, the
   row was invisible so nobody could try. Recorded as decision-log §6.16. Making writes
   archive-aware is a separate piece of work with its own risks.
2. **`FoodCatalogService.backfill` got slower** for days 31–90 (it now lists and parses
   archive months per day). Correct, but if it is ever moved onto a schedule it should
   read one range instead of 90 single days.
3. **M2 stands deferred**: on the active week-strip cell the zero-day track colour equals
   the active-cell background, so the "a real track exists" cue is weakened there. The
   `0` vs `—` readout and the dashed gap border still carry the distinction.
4. `useApiResource` still has no in-flight dedupe (unchanged from the first round).
5. Seven `backend/src/1_adapters/persistence/yaml/*.test.mjs` files report "No test suite
   found" under vitest — pre-existing wrong-runner files already in the gate baseline,
   not touched by this work.


## Note on the whole-repo gate for this fix round — no verdict was obtained

Run 1 exited **2**, and the number matters twice over. The background-task summary
reported "exit code 0"; that was the *wrapper's* exit, not the gate's. The gate's own
output said:

```
gate-vitest: chunk 5/6 produced no JSON report (600 files).
gate-vitest: population/run MISMATCH — 3011 files in population, 2400 in the report.
```

A whole chunk died without emitting a report, so 611 files never ran. That is not a
test failure, but it is also not a pass, and it was NOT assumed to be merely
infrastructural: seven of the 611 unrun files touch code changed in this round, so they
were run directly, on the correct runner:

| Files | Runner | Exit | Result |
|---|---|---|---|
| `datastore-date-guard`, `CoachingOrchestrator`, `FoodLogService`, `ReconciliationProcessor.adjustment` | vitest | **0** | 4 files, 24 tests passed |
| `YamlNutriListDatastore.test.mjs`, `SelectUPCPortion` | jest (`--experimental-vm-modules`) | **0** | 2 suites, 11 tests passed |

The store's own suite — the one most likely to catch a `findByDate` regression — passes.
Three of those files fail under *vitest* only because they are jest-tree files
(`Do not import @jest/globals outside of the Jest test environment`), plus one missing
fixture; pre-existing, already in the gate baseline, unrelated to this work.

Run 2 was killed at the coordinator's instruction: it was competing with their gate on
`main` for one machine (13 gate processes between the two), which is the same contention
that killed chunk 5/6 in run 1, so neither result would have been trustworthy. Its log
ends `GATE_OWN_EXIT=137` — SIGKILL from that stand-down, **not a verdict**. `main`
(`6d93ca52a`) carries the authoritative gate run.

**Process rule carried forward:** for anything whose verdict matters, use
`cmd > log 2>&1; echo "EXIT=$?" >> log` and read the number out of the log. Never take a
verdict from a task-completion summary — it reports the wrapper, not the command.
