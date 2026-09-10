# School status board + reading surfaces — implementation plan

> (the user asked for `docs/plans/`; plan mode allows edits only to this file).

## Context

Two things prompted this, both found live on 2026-09-09.

**The status board card is two partitions pretending to be one.** `AgendaStatusBoard`
renders a `__rail` (name + avatar) and an `__info` block that stacks a count readout,
the fitness rings and a strip of subject discs. The count sits top-right, away from the
discs it counts; a busy day makes the strip longer, not taller; and there is no view of
the term at all. The user wants **four partitions, time widening left to right —
identity · day · week · term** — with a bowling-pin triangle of discs for the day, the
rings for the week, and a GitHub-contribution-style grid for the term (from Sept 1,
backfilled).

**The reading surfaces have one recurring defect in several places: a count sitting
apart from the thing it counts.** The check-ins chip floats above "Reading now"; the
x-of-y readout floats above the discs; the history card wore a date its group header
already said. Same fix each time — put the count inside the thing.

Plus two genuine breakages: an enrolled learner with no progress is invisible on the
board (`todayStatus` skips untouched courses — chicken-and-egg, made visible today
when both learners' Glossika test data was moved to `_deleteme`), and there is no
shared header, so three School screens each invented one.

## Decisions already made (do not re-open)

- Four partitions, order **identity → day → week → term**.
- Term grid: **7 rows (days) × one column per week**, GitHub orientation. Colours:
  green all / yellow partial / grey none / **blue exempt**. Weekends are ordinary days
  for now. Term = **2026-09-01 → 2026-12-31**. **Backfill from Sept 1.**
- **8th row is reserved SPACE for week-level work.** Build the model for a weekly
  obligation (satisfied by evidence on any day of the Mon–Sun week); render the row when
  such entries exist; no authoring UI yet.
- Reading streak wall and term grid are **one concept, two presentations**: one
  multi-day-grid abstraction, orientation as a prop; judging stays with each domain.
- Exempt days come from `schoolCalendar`'s existing `except` spans — no second mechanism.
- Reading obligation renders as **pips** inside the Today group. "Book history" is one
  horizontally-scrolling shelf per day, infinite-scrolling down by day; no "See all
  history".
- **School convention honoured: rollups are derived, never stored**
  (`docs/reference/school/README.md:260`). Any per-day cache is rebuildable, versioned,
  and safe to delete. The convention accepts that editing a course re-colours the past.
- Do NOT retheme `--school-*` tokens.

## Discovery that shapes the design (facts, with paths)

- **Plan replay for a past day exists but is contaminated.**
  `GET /school/lifecycle/learners/:id/agenda/preview?studyDay=&format=json` →
  `BuildAgenda.execute` (`usecases/BuildAgenda.mjs:211-243`) → `PlanProjection.project`
  (`PlanProjection.mjs:206-290`). `#project` reads the learner's **entire** session
  history (including after the day), `curriculumExceptions.active()` (current), and
  program launcher `status()` which takes **no day** — so a past-day replay carries
  today's program state and later evidence. Fix is a seam, not a rewrite (Stream 1).
- **Per-day evidence is queryable.** Work sessions carry `studyDay` (bucket by
  `studyDay ?? day`, logic already in `GetTeacherToday.mjs:159-201`); reading log is
  sharded by day (`YamlReadingLogStore.listForDay`); attempts are day-sharded; piano
  completions carry `userCompletedAt` on items.
- **A day verdict already exists for today:** `resolveDayCompletion`
  (`2_domains/school/completion.mjs`) folds section `obligation.state`s
  (`served|obligated|excused|faulted`, reasons incl. `not_a_school_day`) into
  complete/incomplete. `GetLearnerDayCompletion` takes no `studyDay` — extend it.
- **Week math to reuse:** `2_domains/measures/weeklyWindow.mjs#weekWindowFor(day)` is
  Monday→Sunday and is what the fitness rings use — so the Week partition and the term
  grid's columns agree by construction. (`schoolCalendar`'s `isoWeekday` is private;
  book-log's `per: week` is a *trailing* 7 days — left alone, divergence recorded.)
- **A Monday-first day-grid builder already exists on the frontend:**
  `School/books/dayGrid.js#buildDayGrid` (pure, UTC keys, `WEEKDAY_LABELS`). The shared
  grid extracts from this plus my `School/reading/StreakWall.jsx` / `streak.scss`.
- **Rings:** `ringsByLearner` (`status/agendaStatusModel.js:235-252`) discards `target`;
  the `fitness.weekly-rings` gate's `progress` is `{current, target, unit, ratio}` but
  `target` is **1** (a gte-1 gate), not a weekly quota. An "x of y" week readout needs a
  real target or shows the count alone.
- **Board geometry:** `.school-lock-split__board` on the 1280×800 Portal ≈ **576px** of
  content width; `.school-status-board__row` is `flex: 1 1 0` (rows split the height —
  4 learners ≈ 150px each, ~104px inner). `--count` divides width by disc count and
  goes away with the triangle (inherited design, `_wip/plans/2026-09-09-status-board-
  triangle-design.md` §1-3: `triangleRows`, fixed disc size, nested row pitch 0.78×).
- **The IME badge uses emoji flags** (`ime/HangulTypingProvider.jsx:34`). Portal WebView
  renders emoji as tofu (memory: icons must be inline SVG). The small flag disc must be
  SVG.
- **Glossika:** `LanguageStudyService.todayStatus` (`:646-`) `continue`s when
  `!rawProgress && log.length === 0` — an enrolled learner with no progress produces no
  section. `#fullDayQueue` can already build a day-1 queue from empty progress.

---

## Stream 0 — Unblock Glossika (independent; ships first) — **DONE 2026-09-09**

Turned out to be TWO gaps, not one. `todayStatus` skipping untouched courses was real
but secondary: `assignedProgramPlan` had never heard of `sentence-ladder` at all, so the
enrolment produced no plan entry in the first place (the August design routed the ladder
through an authored curriculum unit that was never written). Both fixed; verified live
against a fresh dev backend — both learners get an obligated `language` section, Day 1,
with a queue sized to their `lessonSize`.

**Follow-on (added at the user's request):** the ladder's own screens
(`Programs/SentenceLadder/`) were early work and read as templated — low consideration
of layout, spacing, balance, colour and transitions. Add a **design review of the
sentence-ladder UI** to Stream 6, using the `frontend-design` skill: a rendered pass at
1280×800 against the same harness, with the header primitive from Stream 5 applied.

**Files:** `backend/src/3_applications/school/LanguageStudyService.mjs` (`todayStatus`),
its test; `SentenceLadderProgram.test.jsx` unaffected.

- In `todayStatus`, when `corpusId` is **given** (the launcher always passes the
  enrollment's corpus) and the corpus loads but there is no progress and no log, do NOT
  `continue`. Treat it as **day 1, untouched**: build `#fullDayQueue(userId, corpusId,
  corpus, [], {day: 1, ...emptyProgress})`, `doneToday: false`, `progressLabel: 'Day 1'`,
  `obligationProgress: {completed: 0, total: summary.total}`. Keep the skip only for the
  *discovery* path (no `corpusId` → iterating all corpora), where "never touched" is
  correct.
- Test (falsifiable): enrolled + empty progress + empty log → status is obligated with a
  non-empty queue; the agenda preview for that learner contains a `language` section
  with `next`. The pre-fix behaviour returns no section.
- Verify live: `GET …/learners/<learner>/agenda/preview?format=json` shows `language`.

## Stream 1 — Honest past-day verdicts (the foundation)

> **Done 2026-09-09.** See `docs/reference/school/term-grid.md`.

**Principle:** evidence is filtered by time; config is not. Replaying day D counts only
evidence stamped before the end of D's study-day window. A course edited since D
re-colours D — accepted, per the derived-not-stored convention.

**The seam (signature changes):**

| File | Change |
|---|---|
| `1_adapters/persistence/yaml/YamlWorkSessionDatastore.mjs` | rows carry `outcome: {result, at}` (`at` = the `outcome_recorded` event's time, unchanged by a later grade adjustment). Port doc updated. |
| `3_applications/school/PlanProjection.mjs` | `project({…, now, historyUntil = null, day = null})`. `historyUntil` filters sessions (`outcome.at ?? updatedAt < until`) and attestations; exceptions via new `curriculumExceptions.activeAsOf(until)`; `day` forwarded to program status collection; `shareable` false when either is set. Constructor gains `householdSchedule` (from `school.yml → calendar`). |
| `1_adapters/persistence/yaml/YamlCurriculumExceptionStore.mjs` | `activeAsOf(untilIso)` — applied before `until`, minus retractions before `until`. |
| `3_applications/school/programStatusCollection.mjs` | `collectProgramStatuses({…, day})`. With `day`: launchers exposing `get replayable()` are called `status({userId, programInstance, day})`; others are **not called** and get `{doneToday: null, unknowable: true, reason: 'no_history'}`. |
| `ports/IProgramLauncher.mjs` | documents optional `day` on `status()` and the `replayable` getter (default false). |
| `PianoCourseProgramLauncher`, `BookLogProgramLauncher`, `StoryTimeProgramLauncher`, `SurfaceProgramLauncher` | accept `day`; `nowMs = day ? midpoint(studyDayWindowForDate(day)) : now`; `replayable = true`. Language/flashcards/reels/rubiks stay non-replayable (current-state only) → excused `no_history` on past days. |
| `2_domains/school/agenda.mjs` `planDailyAgenda` | gains `householdSchedule`; `noSchoolToday` also true when the household calendar says so. An `unknowable` status never obligates, serves or faults; a section left with nothing required reads `excused: no_history`. |
| `3_applications/school/GetLearnerDayCompletion.mjs` | `execute({learnerId, studyDay = null})`; with `studyDay` projects with `now = midpoint`, `historyUntil = window.endAtMs`, `day = studyDay`. Returns `sections` compacted (`{subject, state, reason, cadence, servedOn, unknowable}`) and `householdSchoolDay`. |

`BuildAgenda`, `ResolveSubjectNext`, `ResolveAccessCode`, `CloseSessionOutcome` are untouched.

**The verdict ladder** — new pure module `2_domains/school/termVerdict.mjs`
(`VERDICT_VERSION = 1`; `dayVerdict`, `weekVerdict`, `termDaysFor`, `resolveTermFor`;
export `isoWeekday` from `schoolCalendar.mjs`). Inputs per day: `completion =
resolveDayCompletion(sections)`, `served` = sections `served`, `asked` = served +
`obligated`.

| # | Condition | state / reason |
|---|---|---|
| 1 | row missing / pending / day > today | `unknown` / `pending` |
| 2 | completion `indeterminate` (any `faulted`) | `unknown` / first fault; `retryAfter = +6h` |
| 2b | asked 0 and every excuse is `no_history` (only non-replayable programs were assigned) | `unknown` / `no_history` — **never blue**: "can't tell" is not "day off" |
| 3 | asked 0 and household calendar says off | `exempt` / `household_calendar` |
| 4 | asked 0 and every excuse is `not_a_school_day` | `exempt` / `not_a_school_day` |
| 5 | asked 0 and no sections | `exempt` / `no_work` |
| 6 | asked 0 (all excused for other reasons) | `exempt` / `nothing_owed` |
| 7 | served === asked | `met` |
| 8 | 0 < served < asked | `partial` |
| 9 | served 0 | `none` |

Work done on an exempt day still reads `met` (the `not_a_school_day` override never
un-serves). `unknown` always carries a `reason`.

**The cache** — `1_adapters/persistence/yaml/YamlTermVerdictCache.mjs`:
`<userDir>/apps/school/verdicts/<termId>.yml`, `schema: school.term-verdicts/v1`,
`version`, `computedAt`, `days: {'YYYY-MM-DD': {state, reason, served, asked, weekday,
computedAt, retryAfter, sections[], weekly[]}}`. Missing/corrupt reads as empty (warn).
Deleting it is always safe. **Read rule:** today and yesterday recomputed synchronously on
every read; older rows only when missing, `unknown` past `retryAfter`, or version
mismatch — and those are enqueued on a per-learner serialized background queue (the
`SchoolCompletionBridge` `#enqueue` pattern), returning `unknown/pending` until written.

**Backfill** — `usecases/RebuildLearnerTerm.mjs` `execute({learnerId, termId, from?, to?,
force})`, oldest-first, writes every 10 days (crash-safe); route `POST
/school/lifecycle/learners/:id/term/rebuild` (teacher-gated, action `term.rebuild`);
CLI `cli/school/ops.mjs`: `term <learner>` (read) and `term-rebuild <learner|--all>
[--from] [--to] [--force] [--apply]` (dry-run by default). Cost: a piano learner is
~1s/day (Plex), so ~2 min per learner for the term — run once.

**Tests that falsify each rule:** a session passed D+1 must not appear in D's replay and
its unit reads `available`; an attestation dated D+2 unlocks nothing on D; an exception
applied D+3 is absent; `outcome.at` is unchanged by a later grade event; a non-replayable
launcher is never called with `day` and reads `unknowable`; launchers with `day: D`
ignore a row dated D+1 and count one at 03:59 next morning; one `termVerdict` test per
ladder rung incl. served-on-exempt-Saturday → `met`; cache: yesterday rewritten on read
while D−5 is served from file, `version: 0` discarded, delete-then-rebuild is identical;
`force` recomputes a matching row; a throw mid-rebuild leaves earlier rows written.

## Stream 2 — Model: term, weekly cadence, exempt

> **Done 2026-09-09.** See `docs/reference/school/term-grid.md`.

- **Term = the existing academic period.** `school.yml → progress.academicPeriods`
  (validated at boot, promoted to `plans/periods.yml`, served by `GET /periods`). Seed
  `{periodId: '2026-fall', kind: 'term', label: 'Fall 2026', startsAt: '2026-09-01',
  endsAt: '2027-01-01'}`; term day bounds `from = startsAt`, `to = endsAt − 1 day`. A
  day outside every period → an empty term envelope, nothing cached. No new `terms`
  block: a second calendar beside a runtime-editable one is the wrong shape.
- **Household exemptions** — new `school.yml → calendar:` block in the exact
  `validateSchedule` shape (`except`/`also`; `daysOfWeek` permitted but absent — weekends
  are ordinary). Applied **inside** `planDailyAgenda` via `householdSchedule`, so the
  live paper honours a vacation too and the grid can never disagree with it. Blue reads
  off ladder rows 3–4.
- **`cadence: 'weekly'`** — `curriculum/unitValidation.mjs:46` `CADENCES = ['daily',
  'weekly', 'once']` (still program-only). Satisfied by evidence on any day of
  `weekWindowFor(day)` (Mon–Sun, the rings' week). `collectProgramStatuses` folds
  `status({day: d})` for `d` from the window's Monday through `day` (never future); first
  `doneToday` wins and records `servedOn`. `planDailyAgenda`: a weekly entry is offered
  every day until satisfied; the day it was done reads `served`, later days of that week
  read `excused: weekly_satisfied` (new reason, ahead of `caught_up`). Day rows record
  `weekly: [{unitId, subject, state: served|satisfied|open}]`; `weekVerdict` folds them
  per week → `met|partial|none|exempt(no_weekly_work)|unknown`, with `open: to > today`.
- **Recorded divergence, not fixed:** book-log `per: 'week'` is a *trailing* 7-day window
  (`BookLogProgramLauncher.mjs:69`) and `assignedProgramPlan.mjs:117` maps it to
  `cadence: 'daily'`. Left exactly as is; a comment at that line names this plan. A test
  pins that `per: week` still yields `daily` so the divergence cannot flip silently.
- **Read model** — `usecases/GetLearnerTerm.mjs` `execute({learnerId, termId?, today?})`
  → `{termId, from, to, today, version, days: [{studyDay, state, reason, served, asked,
  weekday, computedAt}], weeks: [{weekId (Monday key), from, to, state, reason, open}]}`.
  `days` runs `from..today`; `to` lets the board draw the empty tail. Route `GET
  /school/lifecycle/learners/:id/term?termId=` (`no-store`), composed beside
  `getLearnerDayCompletion` in `5_composition/modules/schoolLifecycle.mjs`; client
  `schoolApi.learnerTerm(learnerId, termId)`.
- Today's term cell must equal `GetLearnerDayCompletion.execute({learnerId})` mapped
  through the ladder — one test pins this so the grid and the `school.day.complete`
  assertion can never disagree.

## Stream 3 — The shared multi-day grid

> **Done 2026-09-09.** See `docs/reference/school/term-grid.md`.

**Goal:** one component renders both the reading streak (7 cols × 4 rows, column card)
and the term grid (7 rows × N week cols, row card). Judging stays outside.

**New files:** `frontend/src/modules/School/shared/dayGrid/dayGridModel.js` (pure),
`DayGrid.jsx`, `dayGrid.scss`, tests beside each.
**Ported:** `School/reading/StreakWall.jsx` becomes a thin wrapper over `DayGrid`;
`School/reading/streak.scss` folds into `dayGrid.scss`; `School/books/dayGrid.js`'s
`isoWeekday`/`buildDayGrid`/`WEEKDAY_LABELS` move to the shared model (books imports
from there; no behaviour change).

- **Model:** `layoutDayGrid(days, {orientation: 'weeks-as-rows'|'weeks-as-columns',
  from, to, todayKey})` → `{cells: [{studyDay, row, col, state, count?, today}],
  rows, cols, weekIds}`. Week alignment is Monday-first everywhere. Days outside
  `[from,to]` are `null` cells (grid stays rectangular). Pure; tested for both
  orientations, a week that starts mid-term, and a term ending mid-week.
- **State vocabulary** (one, shared): `met | partial | none | exempt | unknown | rest`
  (`rest` = reading's "not asked" from today; keep it — the term grid uses `exempt`).
  Palette: green/amber/grey + **blue** for `exempt`, near-transparent for `rest`.
- **Component props:** `days`, `orientation`, `from`, `to`, `studyDay`, `showCount`,
  `extraRow` (an optional 8th row of `{weekId, state}` for weekly work), `className`,
  `testId`. Sizes via `--grid-cell`/`--grid-gap` from the host, as today.
- **Consumers:** reading `open`/`celebrating` (orientation `weeks-as-rows`, showCount);
  board Term partition (orientation `weeks-as-columns`, no counts, `extraRow`).
- Falsify: reading tests keep passing unchanged through the wrapper; a snapshot of
  `layoutDayGrid` for a known 28-day input in both orientations.

## Stream 4 — The status board card

> **Done 2026-09-09.** Four partitions live on the Portal; measured at 1280×800 (rail 120 · day 164 · week 46 · term 169, no overflow).

**Files:** `frontend/src/modules/School/status/AgendaStatusBoard.jsx`,
`status/agendaStatusModel.js`, `School.scss` (`.school-status-board__*`, ~2889-3150),
tests beside.

- **`triangleRows(count)`** in `agendaStatusModel.js`, exactly per the inherited design
  table (1→[1], 2→[2], 3→[1,2] … 9→[2,3,4]; capped at 3 rows, base widens past 9).
  Segments fill rows in `summarize` order. Test the table.
- **Four partitions** as flex siblings inside `__row`:
  `__rail` (identity — keep; avatar grows: `clamp(4rem, 15vh, 8rem)` and the nameplate
  clamps with it) · `__day` (cluster of `<ul>` per triangle row, centred both axes,
  **x-of-y readout under the pins** in tabular figures; at 100% the readout reads
  DONE) · `__week` (RingIcon + count. **No weekly ring quota exists anywhere** — the
  `fitness.weekly-rings` gate is `gte 1` and `fitness.yml` has no weekly goal — so the
  readout is the count alone, sized like the day readout. Extend `ringsByLearner` to
  return `{current, target}` so an "x of y" appears the day a real target is authored,
  without a code change.) · `__term`
  (`DayGrid` weeks-as-columns, `extraRow` for weekly work, cell ≈ 11–12px on the Portal).
  Delete `--count`; disc diameter fixed board-wide by the 3-row worst case; row pitch
  `0.78 × disc`.
- **Data:** the board fetches `GET /school/lifecycle/learners/:id/term` (Stream 1/2) once
  per learner alongside the plan, settles independently like the rings, and renders
  the term grid blank-but-present while loading (skeleton cells).
- Widths on the 576px pane: rail ~110 · day ~150 · week ~70 · term ~230 (18 weeks × 11px
  + gaps). Verify with the Playwright harness at 1280×800 (below).
- The count readout moves *under the pins* — this is the taxonomy fix (a count inside
  the thing it counts).

## Stream 5 — School design system: header + toggle registers

> **Done 2026-09-09.** `shared/ScreenHeader` on the shelf and its four sub-views; `HangulTypingProvider` exposes `register`, `LanguageDisc` sits by the clock; flags are SVG.

**Files:** new `frontend/src/modules/School/shared/ScreenHeader.jsx` + scss;
consumers `books/BookShelf.jsx` (header), `books/NumberPad.jsx`, `selfService/Keypad.jsx`,
`books/History.jsx`, `books/UpdateBook.jsx` (back buttons); `ime/HangulTypingProvider.jsx`
(badge registers); `status/BoardHeader.jsx` (flag disc by the clock).

- **`ScreenHeader({title, identity?, onBack?, onDone?, doneLabel?})`** — one row: back
  (icon + "Back", sentence case, `school-selfservice__key` sizing) · title · identity chip
  · single primary exit. Rule: a screen has **one** exit affordance in the header; "Done"
  and "Back" never both appear unless Back is a step within the screen. Same height,
  padding and type across every School screen. BookShelf's ad-hoc header, the
  lowercase `‹ back`, and the capitalised `Done` all go through it.
- **Language toggle, two registers**, driven by whether a text field is on screen
  (`HangulTypingProvider` already knows `declared`/focus):
  - `status` register (no text input): a **small SVG flag disc** immediately right of
    the clock in `BoardHeader` (`…__time` + `__lang`), ~1.1em, no label, no F6 hint.
    Replace the emoji flags with two inline SVGs in `home/icons/svg/` (`flag-us.svg`,
    `flag-kr.svg`) — Portal WebView tofu.
  - `prominent` register (a text field is focused/present): the existing badge with
    label + F6 hint, positioned in reserved space (not absolutely over content).
  - The provider exposes `register` via context; `BoardHeader` and the badge read it.
- Tests: header renders one exit; register flips when a field declares a language.

## Stream 6 — Reading screen corrections + density

> **Done 2026-09-09** (reading screen + density). Book history groups the shelf's own items by day client-side and reveals a week at a time — no `/shelf/history` endpoint was needed, the shelf read already carries every item. Ladder design review below.

**Files:** `books/BookShelf.jsx` + `School.scss` (`.school-books*`), `books/History.jsx`
(retired), `books/ShelfTile.jsx`, `schoolApi.js`, backend `routers/schoolBooks.mjs` +
`usecases/GetBookShelf.mjs` (history page), `books/NumberPad.jsx`/`selfService/Keypad.jsx`
scss, `books/LearnerChoice.jsx` scss.

- **Taxonomy fix:** the obligation renders as `ReadingPips` (`School/reading/ReadingPips.jsx`
  — the notation reading already uses) **inside the "Today" group heading row**, and
  the chip is deleted. "Reading now" is retitled **"Today"** (it means today).
- **"Book history"** replaces "Finished and set aside": one heading per day (group by
  study day of the outcome), each day a horizontally-scrolling shelf, days stacked
  vertically; the page **infinite-scrolls by day**. New endpoint
  `GET /school/books/:learnerId/shelf/history?before=<studyDay>&days=7` returning day
  groups (server does the grouping; reuse `recentOutcomes`' sort); the client appends
  on scroll (IntersectionObserver sentinel). `History.jsx` and "See all history" are
  removed.
- **Card rebuild** (`ShelfTile` history mode): cover-first — square/portrait art at
  ~2× today's size, title beneath at up to 3 lines (no `-webkit-line-clamp: 2` cut),
  **no date on the card** (the day heading carries it), outcome mark stays on the art.
  Reading-now cards keep the progress bar.
- **Density:** `.school-selfservice__entry` ↔ `__pad` gap tightened; `.school-books-pad__keys`
  gap reduced and keys `aspect-ratio: 4 / 3` (taller); the pad's prompt
  `white-space: nowrap` + a size clamp so "Type the number under the barcode" never
  wraps at 1280; `LearnerChoice` faces grow to fill (`clamp(6rem, 22vh, 10rem)`).
- Verify each with the harness at 960×540 and 1280×800.

## Verification (every stream)

- **Pixels:** `scratchpad/*.html` harness with `npx sass` over the real stylesheets, rendered
  by Playwright at 1280×800 (Portal) and 960×540 (living room) — the technique that caught
  the shelf plank twice today. Every visual task gets a render and a measured assertion
  (square cells, no overflow past the pane, one header height across screens).
- **Falsification:** every guard/rule gets a test proving it fails without the change.
- **Suites:** `npx vitest run --config vitest.config.mjs frontend/src/modules/School/
  backend/src/3_applications/school/ backend/src/2_domains/school/`; `npm run check:scss`.
  Baseline: 9 pre-existing router failures on `origin/main` (unrelated; do not "fix" by
  deleting).
- **Live:** deploy through `./scripts/deploy-gate.sh` → build → gate again → deploy;
  reload the Portal (`cli/fkb.cli.mjs reload`) and check `…/agenda/preview?format=json`
  shows `language`, and `…/learners/:id/term` returns 100+ days with mixed states.

## Sequencing and delivery

Two plans in one document, delivered as two PR-sized batches:

1. **Foundation (Streams 0–3):** Glossika fix; the `asOf` seam + day/week verdict use
   cases + cache + backfill CLI; term/cadence model; the shared grid with reading ported.
   Ships with the term endpoint live and the reading wall unchanged visually.
2. **Surfaces (Streams 4–6):** the four-partition card; the header + toggle registers;
   the reading screen corrections and density pass.

Each task: write the failing test, make it pass, render if visual, commit. Follow the
repo's per-commit gates.
