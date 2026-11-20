# Health — log-first food logging, budget, medical

A daily food log in the LoseIt mold: four tabs (Today, Progress, Medical, Coach), one
calorie equation computed exactly once on the server, and a set of capture funnels — type,
speak, photograph, or scan a barcode — that all converge on the same day log. Existing
NutriLog/NutriList machinery (built for the Telegram nutrition bot) is reused, not
rebuilt; the web app is a second transport onto the same pipeline.

**Status: shipped and live at `/health`.** `frontend/src/Apps/HealthApp.jsx` is the entry
point.

---

## Current ledger and interaction contract

- **Minimize actions:** direct text/voice/photo/barcode controls; clear captures log
  immediately. Known foods and all-core meals are one-tap. Ambiguous variants are
  preselected from the last choice for that bucket, then tweak/confirm.
- **One consumed-food authority:** NutriList hot and archive files are the editable
  ledger. NutriLogs are capture evidence. Ordinary replay imports unseen IDs only;
  it cannot overwrite a correction or resurrect a tombstoned deletion. An explicit
  full-capture revision conflicts if its entries have since been corrected.
- **Truthful portions:** `grams: number | null`, `schemaVersion: 2`, row `version`,
  preserved `originalQuantity`, optional stable `foodId`, and per-key provenance.
  Legacy counts/volumes are never treated as grams at read time. The one
  exception is written, not inferred: the scan repair's `legacy-quantity` rule
  stores an old nutribot gram figure as `grams` with
  `quantityProvenance: {source: 'legacy-amount', label}` (the household label it
  was mis-filed under) — see `__docs/runbooks/health-ledger-repair.md`.
- **Durable commands:** group edits, moves, deletes, copies and restores validate all
  targets before a journaled, fsynced multi-file commit. Source and destination
  summaries are rebuilt, including empty days. Recovery replays a prepared journal.
  This is a **single-writer-process** contract; never run dev and production writers
  against the same nutrition directory.
- **Retry identity:** modern web creation requests carry an `operationId`.
  Identical retries coalesce and recover committed rows after a lost response.
  Reusing an ID for a different payload returns 409. Older clients without IDs
  remain compatible but do not receive that duplicate-submission guarantee.
- **Corrections:** a centered desktop dialog / mobile bottom sheet leads with the
  current portion and its unit. Preview all nutrient scaling, make several changes,
  then Save once with `expectedVersion` and an idempotent `operationId`. Group
  commands carry the exact displayed membership in `expectedVersions`; any stale
  member or membership change rejects the entire command. Delete offers Undo. Focus is contained and restored; scroll
  locks are shared with Coach. Replacing the entry dialog with Coach preserves
  the original focus-return target; overlay Escape closes without clearing a draft.
- **Confirmation is explicit:** only Confirm ends review early. Editing a name,
  artwork, portion or nutrient protects the changed fields without ratifying the
  rest. Unconfirmed captures count immediately and retain their 72-hour deadline.
- **Inline nutrition:** grams, calories, density, protein, carbs and fat are drag
  targets on foods and grouped dishes. Grams/calories scale the serving; density
  holds mass fixed and scales calories and known macros. A macro correction holds
  mass and other macros fixed and changes existing calories by its delta (4 kcal/g
  for protein/carbs, 9 for fat), preserving any original calorie discrepancy.
  Groups distribute macro targets in proportion to ingredient macro amounts, or
  by mass when the macro is known zero throughout. Unknown ingredients require
  exact values before distributing an edit; unknown nutrition is never filled
  with zero. Invalid edits explain the missing data or negative result.
  `shared/contracts/health/foodNumericEdit.mjs` supplies the arithmetic to both
  preview and server. The `numericEdit: {field, value}` command travels through the
  existing versioned entry PUT and updates ingredients atomically, without adding
  nutrients to the group parent. Composition corrections record user provenance.
  Primary-button horizontal drag previews all row, group,
  meal and day totals from one draft overlay. The threshold is 5px, sensitivity
  1g per 2px (Shift: one tenth speed, still snapping to whole grams); click opens direct entry, arrows adjust and
  Enter commits. Release sends one command; Escape/pointer cancellation sends
  none. Polls preserve the gesture's baseline. Conflicts require explicit reload
  and apply, and unseen group members require discarding the draft first.
  Density uses 0.01 kcal/g per 2px; other new targets use one unit per 2px.
  The draft retains its operation ID across response-loss retries.
- **Voice gateway contract:** meal instruction interpretation wraps its string
  prompt in a user-message array before calling `IAIGateway.chat`. The Whisper
  transcription request remains multipart. A regression test exercises the meal
  service through the real OpenAI adapter and inspects the outgoing request body.
  The deferred Web Nutribot proxy forwards capture, callbacks, pending reads and
  read-only meal suggestions to the initialized adapter.
- **Context:** Today stays mounted across tabs to preserve drafts, capture retries
  and scroll. Hidden Today stops polling; leaving during a recording stops and
  submits that recording to its original target. Closing the app discards unsent
  local drafts. Date and viewport are in the URL.
- **Freshness:** mutations revalidate mounted health resources together. Visible
  Today also refreshes on focus/visibility and every 30 seconds for external writes.
  Different date keys never expose the previous day's rows as actionable.
- **Reuse:** saved-food definitions support rename, explicit gram/nutrient basis,
  favorites and removal. Templates support component/role/portion editing.
  These edits affect future logging, never past snapshots. Capture resolves catalog
  identity and explicit icon pins before writing. Entry favorite reads/writes use
  stable `foodId`, so a catalog rename cannot redirect an old snapshot's action.
- **Coach:** the tab and overlay share one runtime, persistent conversation
  provider, and resolved Health user ID. The provider must stay mounted in the
  shell: sharing a hook while remounting providers recreates the internal thread.
  It receives selected day/entry context and reads the authoritative ledger.
  Recent visible messages (last 80) survive remount/reload in this browser session;
  this is not cross-device history synchronization.
- **Analytics:** unlogged days are gaps, not claims of zero consumption. Historical
  budgets are explicitly evaluated using current goals. Weight axes use calendar
  spacing and sparse trends label their actual comparison interval.

Historical conversion requires the [repair runbook](../../runbooks/health-ledger-repair.md);
it is never an implicit startup migration.

---

## The four tabs

`HealthApp.jsx` mounts `AppChrome` with a fixed tab set and a global `⌘K` shortcut:

| Tab | Component | Shows |
|-----|-----------|-------|
| Today | `__app_modules/Health/today/TodayView.jsx` | the day log — equation strip, macro/watch-micro bars, the weight chip, the week strip, meal-bucketed rows with per-meal `P · C · F` subtotals, capture affordances |
| Progress | `__app_modules/Health/progress/ProgressView.jsx` | weight trend chart, 14-day budget-adherence bars, 30-day intake-vs-burn chart, goals editor (including macro targets and watch micros) |
| Medical | `__app_modules/Health/medical/MedicalView.jsx` | medical readings (blood pressure, labs, etc.), grouped by metric |
| Coach | `__app_modules/Health/CoachChat/index.jsx` | the health-coach agent chat, full height |

`⌘K` (`useHotkey('mod+k', …)`) opens `ChatOverlay` — a scrim + panel that mounts a second
`CoachChat` instance (`variant="overlay"`) over whichever tab is active, so the coach is
reachable without leaving the day log. `Esc` or the scrim closes it.

`Weight.jsx` in this module is unrelated to the tabs above — it stays as the `health`
screen-framework panel widget (kiosk/ambient display), a separate consumer of the same
weight data.

---

## The budget equation — one server-side home

Each day has a goal **range**, not a single goal:

```
floor = budgetFloor                        compared against FOOD eaten (logging completeness)
top   = max(floor, maintenance − deficit)  compared against NET (food − exercise)
even  = maintenance (break-even, TDEE)     compared against NET
```

**The floor is a trust check, not a nutrition target.** Logs under-report, so a day
logged below the floor is presumed **incomplete**, not a deficit. A day is
**complete** when food ≥ floor, or when it was declared **Done logging** or
**Fasted** (see [Closing a day](#closing-a-day--done-logging--fasted)). Nothing
infers completeness from the time of day.

**The deficit** (`solveDailyDeficit` in `BudgetMath.mjs`) is solved per day, from
that day's resolved weight:

| `deficitSource` | When | Deficit |
|---|---|---|
| `at-target` | weight ≤ `targetWeightLbs` | 0 (eat at break-even) |
| `target-date` | `targetDate` is set and the day is before it | (weight − target) × 3500 ÷ days left, capped at `maxWeeklyRateLbs` × 3500 ÷ 7 (default 2 lb/week) |
| `weekly-rate` | otherwise (no date, date passed or reached) | `weeklyRateLbs` × 3500 ÷ 7 (500 per lb/week) |

**Zones** come from one shared rule, `shared/contracts/health/budgetZone.mjs`
(`zoneFor`), used by the server and by the client's drag preview. They are
evaluated in this order:

| Zone | Condition | `remaining` (the headline value) | Headline |
|---|---|---|---|
| `past-even` | net > maintenance | net − maintenance | "N kcal past break even" |
| `over` | net > top | net − top | "N kcal over" |
| `in-range` | food ≥ floor | top − net | "N kcal left" |
| `declared` | food < floor, day closed or a meal skipped | top − net | "N kcal left" (the pill shows the status) |
| `incomplete` | food < floor, not closed | top − net | "N kcal left" (blue: the log is not trustworthy yet) |

`remaining` is never negative. `over`/`past-even` win even on an under-logged day;
`complete` reports the logging fact separately. With a big workout, net can be
negative and an in-range `remaining` can exceed the top (that much really is left).

**Compatibility aliases:** `budget` = `range.top`, and `status` = `'over'` for
`over`/`past-even`, else `'under'`. Both are kept until the bar and the coach read
`range`/`zone` directly.

**History:** goals apply as *current* to every day (`goalBasis: 'current'`), so
changing `targetDate` or `targetWeightLbs` recolours past days.

`__app_modules/wellness/health/server/application/health/BudgetService.mjs` is the only calculation owner.
It serves `/budget`, `/budget/range`, and the budget portion of `/day`. Today reads
one `/day?date=` snapshot containing entries, their ledger revision, and a budget
computed from those exact entries. A budget setup error does not hide the food log.

### Shared daily and period assessments

`portable/contracts/health/budgetAssessment.mjs` projects assembled BudgetService
rows into shared energy facts using `budgetLines` and `zoneFor`. It takes explicit
`date` and `today` values and never reads a clock. `trustworthy` means the log is
complete; `finished` means a past date or an explicit done/fasting closure. A
skipped meal can establish completeness without finishing today. The Today card
uses the same finished-day projection and retains its existing tier ladder.

Plan and maintenance states are independent: food of 1,800 against a 1,600 plan
and 2,000 maintenance is over plan by 200 and below maintenance. Exercise shifts
both food-scale limits once, in full; the shared tier rules cap the food plan at
food break-even if the configured floor/plan would exceed it. Equality is neither
over plan nor surplus;
passing the logging floor alone never establishes a surplus. An incomplete log
retains its known boundaries but has unknown verdicts. Missing budgets are
unavailable; missing numeric facts remain null. Unknown maintenance preserves
known plan facts while leaving maintenance verdicts unknown. A complete live day
can show its current position without being included in a finished-period verdict.

`portable/contracts/health/budgetPeriod.mjs` summarizes the same finished,
trustworthy rows for every energy average and verdict count. Coverage records all
requested dates, including unavailable dates; gaps never become zero intake or
exercise. Plan and maintenance deltas are signed differences from each day's own
exercise-adjusted limits. If any eligible row lacks a metric, that metric's
average is null so compared averages never use different day counts.
Verdict coverage separately records `planKnown` and `maintenanceKnown` within
that eligible set. The within/over-plan counts describe `planKnown` rows; the
surplus count describes `maintenanceKnown` rows. Weekly text qualifies partial
verdict coverage and marks wholly unknown comparisons unavailable, so a zero
known surplus count never implies unknown days were below maintenance.
`proteinKnown` coverage counts eligible rows with a finite measured protein macro
and non-reconstructed provenance. Protein averages belong to callers and use only
those rows, with a separate `proteinDays` denominator. In coaching, the evidence
reader excludes reconstructed and unknown-provenance rows from intake verdicts
and period comparisons; reconstructed calories remain separately labelled estimates
with unknown protein, even after a day closure. Unknown nutrition provenance
keeps logging status unavailable before closure or completeness is considered;
known numeric budget fields remain available separately and do not justify
missing-meal verdicts or closure prompts.
The projections retain an explicit `goalBasis`; absent or mixed bases stay null.
Historical API rows currently use `goalBasis: 'current'`, not recovered historical
goals.

Automated coach assignments, agent budget tools and Nutribot captions consume the
same assessments. Caption food ranges end at the exercise-adjusted food plan and
label the exercise adjustment; missing budgets display logged totals with
assessment unavailable. Activity burn is separate from daily synchronized credit,
and unknown/reconstructed provenance supports no intake verdict. Automated
nutrition prose is rendered from supported observations; model prose is discarded.
Assignment reasoning receives no tools and disables SDK memory per request;
programmatic gathering retains its tools. Legacy notification assignments return
validated results, the lightweight orchestrator sends scheduled notifications, and
HealthCoachAgent persists dashboard output only after validation. Dashboard coach
assessment prose is deterministic while curated fitness rationale and interactive
chat retain their existing domain/conversational behavior. Delivery and repetition
limits are documented in [Health coaching](coaching-system.md).

### The Today budget card — one job at a time

Design: `ops:docs/_wip/plans/2026-09-25-health-budget-card-jobs.md`. The card is read
in four situations, and its headline answers whichever one applies
(`today/budgetStory.js`, pinned by `budgetStory.test.js`):

| Job | When it leads | Headline / sub-line |
|---|---|---|
| **Trust** | live day, `zone: incomplete` (under the floor, not closed) | "991 kcal free" / "400 under the 1,200 floor · prices assume the log is complete"; available-room fills are dimmed |
| **Afford** | live day, within the plan | "321 kcal free" / "then 311 workout · 500 deficit · 1,132 to break even"; eating into the workout: "202 kcal of workout left" / "used 109 of 311 · …" |
| **Contain** | live day, past the ceiling | "302 kcal to break even" / "198 over plan"; past it: "198 kcal past break even" |
| **Judge** | a past date, or today closed as Done/Fasted | "On plan" / "workout banked (311) · ended 1,132 under break even"; "ate back N of M workout"; "Missed plan by N"; "Surplus of N"; "Fasted"; an unclosed past day under the floor reads "Incomplete log … no verdict" |

A skipped meal makes a day trustworthy (`zone: declared`) but does **not** finish it.
Trust still leads with the free number while there is base-plan room; at an exact
capped limit it names that limit instead of saying "0 free". Dimming and the
sub-line carry the doubt. At exact plan end or break even, the live headline
names the boundary rather than reporting "0 left". A finished day at break even
says it ended there.
While a portion is dragged, the sub-line prices the change instead:
"this costs 321 free + 109 workout" (`priceOf`), or "gives back 200".
The card logs `budget-card.job` (debug) once per change of leading job.

**One vocabulary** across bar, sub-line and drag price: *free*, *workout*,
*deficit*, *to break even*, *over plan*.

**The tiers** (`shared/contracts/health/budgetTiers.mjs`, `priceLadder`) are what
is left, on the FOOD scale:

```
free     0 → top                          costs nothing
workout  top → top + exercise (ceiling)   costs the workout's benefit
deficit  ceiling → maintenance + exercise costs the day's progress
```

Every line is capped at break even (a floor above maintenance pushes `top` past
it; `zoneFor` tests break even first), zero-width tiers are dropped, and the
workout's *room* (`ceiling − top`) is what the wording uses, not the raw
exercise. `priceLadder`'s region (`free`/`workout`/`over`/`gain`) agrees with
`zoneFor` — a 1-kcal sweep test pins it, including the capped cases. The zone
contract itself is unchanged: `reportCaption` (nutribot), `CoachingMessageBuilder`,
the week strip, the month block and the health-coach tool still read `zone`,
`remaining` and `headlineFor`.

The ranged path of `EquationStrip.jsx` reads `range`, `zone`, `food`, `exercise`,
`maintenance` and `declared`. Its terms line is only "1,470 eaten · 311 burned":
net and the deficit are tiers on the ruler now.

**The single budget bar** (`RulerScale` in `EquationStrip.jsx`, geometry in
`today/budgetGeometry.js`, pinned by `budgetGeometry.test.js`):

- The bar uses FOOD calories from zero. Its axis includes food, the logging
  floor, every drawn plan boundary and break even, with 12% headroom rounded up
  to a 500 kcal step. A portion preview holds the baseline axis steady. A
  preview beyond its right edge shows an overflow pointer and exact text value.
- Solid consumed spans keep fixed boundaries: green through the usable base
  limit (blue while the log is incomplete), green/blue through workout room,
  amber after the adjusted plan end, and red only past known break even. Adding
  food does not move or recolour earlier boundaries. Live available base and
  workout room are pale green and blue. A finished day removes those
  available-looking fills.
- The eaten cursor stays at the true food value. The floor is a small logging
  marker, the distinct base limit is dashed, plan end is solid, and break even
  has an end mark. A labelled bracket and green band show the complete goal
  range from logging floor through the adjusted plan end. The exercise-earned
  extension from base target to plan end uses diagonal hatching above both its
  spent and available portions, so the bonus remains legible after it is eaten.
  The bar has no internal number pill or arbitrary numeric ticks. A wrapping key
  names every marker and exact value; markers within six rendered pixels form a
  visual cluster but keep their separate values in the key.
- The configured pre-workout target can exceed the usable capped limit. In that
  case the key shows the usable plan limit and a detail line names the configured
  target. The detail line also explains a partially capped exercise boost, a log
  floor beyond the plan, or an unavailable break-even estimate.

While the summary (`.health-equation`, a size container) is under 761 px wide, the
head stacks: headline, sub-line, then the terms. From 761 px it is a
grid: the headline spans two rows on the left, the sub-line and the terms stack
beside it, and the day-close pill takes a third column.

A budget without `range`/`zone` (an older server) still gets the legacy two-mark
bar of NET calories, its two-way headline ("N kcal left" / "N kcal over goal"),
and a terms line that states net and the deficit/surplus against break even, so
no term is ever printed as a negative. `maintenance` comes from
`computeDailyEnergy` in `BudgetMath.mjs`, which `/budget`, `/budget/range` and `/day`
all carry; a response without it draws only the goal mark. Protein, carbs and fat sit beside
the bar (under it below ~1050px of column): grams, with a thin bar against
`goals.macroGoals` when one is set; the partial "+" marker survives. `MacroBarRow`
on Today now renders only the watch-micros. During portion editing, `portionPreview.js` overlays the
shared counting contract's calorie delta on this server snapshot and re-runs
`zoneFor` on it, so the row, meal, zone and remaining allowance move exactly as the
reloaded day will. It does not recalculate goals, burn or the range. The overlay retires when the read model contains the saved versions.

`BudgetService.getBudget(userId, date)`:

1. Loads goals (`apps/health/goals.yml`). No goals → `409 { code: 'GOALS_NOT_CONFIGURED' }`.
2. Finds the latest known adjusted-average weight at or before `date` from weight history.
   No usable weight → `409 { code: 'NO_WEIGHT_DATA' }`. A reading older than 7 days sets
   `stale: true` but the budget still computes from it (a week-old weight beats no weight).
3. Solves the day's `deficit` (`solveDailyDeficit`), then computes `maintenance` and the
   range top via `computeDailyEnergy` (Mifflin-St Jeor, see [Goals](#goals) below), using
   that weight and the goals' height/sex/activity/floor. Goal keys: `budgetFloor`
   (default 1200), `targetWeightLbs`, `targetDate` (`YYYY-MM-DD`), `weeklyRateLbs`
   (> 0, default 1), `maxWeeklyRateLbs` (> 0, default 2).
4. Sums `food` from that date's NutriList rows, **excluding** any row with
   `status: 'pending' | 'rejected' | 'deleted'`. AI captures are committed
   `accepted` the moment they are parsed (see [Capture funnels](#capture-funnels)),
   so they count immediately; `settled` is an orthogonal review axis and never
   affects the total.
5. Sums `macros` over that same filtered list — `protein`, `carbs`, `fat`, and the four
   micronutrients `fiber`, `sugar`, `sodium`, `cholesterol`. One predicate, one filtered
   list: the macro bars and the kcal number are folded together, so they cannot disagree
   on screen. Group rows carry zero nutrition by design, so an unconditional sum counts
   each food exactly once with no special-casing.
6. Builds `microCoverage` — `{ [micro]: { covered, total } }` — over the counted non-group
   rows. See [Micro coverage](#micro-coverage--why-a-stored-0-is-not-a-zero) below.
7. Sums `exercise` from that date's workout sessions (`calories`, tolerant of an array or a
   keyed object). The ledger is ONE source: Strava `activity`, else the Garmin `fitness`
   rollup. Home Fitness-app sessions the user took part in (`home`, read from the fitness
   session store by `YamlHealthDatastore`) are then added for any session no ledger row
   covers — linked by `homeSessionId`, named by the session's `stravaActivityId`, or
   overlapping in clock time. Such a row is `source: 'home'`, `estimated: true`, with
   calories from the participant's average heart rate (Keytel, via
   `CalorieReconciliationService.estimateCaloriesFromHR`, using the day's weight and the
   goals' `birthYear`/`sex`). When Strava catches up and links the activity, the ledger
   row replaces the estimate. Merge rules: `3_applications/health/homeWorkouts.mjs`.
8. Reads the day's closure (`users/{id}/day_closed.yml`) for `declared`; an unreadable
   closure file logs `health.budget.closures_unreadable` and reads as not declared.
9. Returns `{ date, budget, maintenance, deficit, deficitSource, range: {floor, top},
   food, exercise, net, zone, complete, declared, remaining, status, stale, sessions,
   goals, macros, microCoverage }`. `/budget/range` returns the same per-day fields
   (minus `sessions`/`goals`), from the same private assembler.

A one-off CLI, `ops:retired/cli/health-budget-settings-migrate.cli.mjs --user <id> [--apply]`,
reports every legacy floor/target setting (profile `calories_min/max`, the coach's
`goals.yml`, the coaching `min_calories`) and their conflicts. `--apply` only fills an
**unset** `budgetFloor`; it never sets a `targetDate`.

Both 409 codes are UI signal, not failure: `EquationStrip` shows a "Set up goals" button
on `GOALS_NOT_CONFIGURED`/`NO_WEIGHT_DATA` rather than an error state.

`GET/PUT /api/v1/health/goals` round-trip the goals document unmodified — `PUT` replaces
the whole object and echoes it back. The goals datastore is a raw pass-through, so
`BudgetService.setGoals` is the only gate on what reaches the file: it validates the shape
of `macroGoals` and `watchMicros` and refuses anything off-shape with
`400 { code: 'GOALS_INVALID' }`. It never rewrites what it accepts — a document without
those keys is saved without them.

---

## Micro coverage — why a stored `0` is not a zero

`nutrientProvenance` records availability per key, with source and gram basis.
A supplied zero is known; a storage-default zero without provenance is unknown.
Legacy `microsSource` is only a compatibility hint: an old nonzero numeric
value with that hint counts as covered, but an ambiguous old zero does not.

`BudgetService` counts coverage separately for fiber, sugar, sodium and
cholesterol, excluding group headers. Each watch bar names its coverage.
Provenance means the source supplied a value, not independent verification
that the estimate is correct.

All extensive nutrients scale through
`shared/contracts/health/foodQuantity.mjs`. Catalog micronutrients have
independent `microBasis` records; a micro is reused at another portion only
when its own mass basis is known. Catalog serialization retains base values
and observations separately, rather than feeding a derived serving back into
the source record. Explicit corrections are stamped as user-supplied per key.

---

## Closing a day — Done logging / Fasted

The health coach treats a day that is not closed and is under the logging-completeness
threshold (household `coaching/config.yml` `logging_completeness.min_calories`,
default 1200) as **missing data**: meals were not logged. It does not treat that day as low intake. See
[coaching-system.md](coaching-system.md#logging-completeness). A person
tells it otherwise by closing the day, from either surface:

- **Day view:** `today/DayClosePill.jsx`, a small outline pill at the right of the budget
  headline (not a row under the meals). It opens a two-item menu.
  - **Today:** reads "Close day" and offers **Done logging** (fasting is per meal, below). It is never flagged, because an in-progress day is expected to be low.
  - **A past day under the threshold (and no skipped meal):** the pill is tinted blue (the under-logged zone colour) and reads "Only 460 cal logged" or "Nothing logged", with the same choice.
  - **A closed day:** the pill reads "Logging done" / "Fasted" (green) and its menu offers **Reopen day**.
  - **A complete past day:** shows nothing, because the coach already trusts it.
  - "Today" is the server's date (`dayStatus.today`), so a phone in another timezone is never offered a day the server would refuse as future.
  - The POST response patches the cached day (`showDayStatus`), so the row shows exactly what the server stored. A `/fast` sent from Telegram overrides it on the next refetch.
- **Nutribot chat:** `/done`, `/fast` and `/reopen`, each taking an optional `yesterday` or `YYYY-MM-DD`.

**Meal fasts (skipped meals).** Fasting is per meal. Each empty meal's heading has a small ⊘
icon (`today/MealFastToggle.jsx`): "didn't eat anything here". Tapping it closes that meal as
skipped (the meal reads "Skipped"); tapping again undoes it. A meal marked skipped that
later gets food keeps its undo and says "marked skipped". Nutribot takes `/fast breakfast`,
`/fast lunch yesterday` (meal and date in either order; breakfast, lunch, dinner, snacks) and
`/reopen breakfast`. **A day with any skipped meal is trusted** — its total is taken as what
was eaten, the same as "Done logging": the budget's zone is `declared` and `complete` is
true, the coach classifies it as trusted, and reconstruction never fills it. It is still not
a day closure: `status` stays empty, and reopening the day does not erase meal skips. The
day-close pill offers only **Done logging** (a whole-day `/fast` from Telegram still shows
on it as "Fasted" and can be reopened).

Both surfaces write the same record, `users/{id}/day_closed.yml`
(`{date: {status?: done|fasting, at?, meals?: {<bucketId>: {status: fasting, at}}}}`).
**Only a day `status` closes a day** (`closureStatus`, `isDayClosed`, the reconstruction
skip and CLI all apply this): a record holding only `meals` is not a closure. Closing a
day merges into the record and keeps its meal fasts; reopening clears only the day status
(the record goes when nothing is left). `POST /api/v1/health/nutrition/meal-fast` takes
`{date, meal, fasted}`. `GET /api/v1/health/day` returns
`dayStatus: {status, minCalories, today, fastedMeals}`, where `minCalories` is the user's
`budgetFloor` (falling back to the coaching `min_calories` when goals have none). `POST /api/v1/health/nutrition/day-status`
takes `{date, status: 'done'|'fasting'|null}`, where `null` reopens the day. It refuses a
malformed date or a future day.

## Untracked-intake reconstruction

History has unlogged and partly logged days. They read as eating far less than was eaten, which skews every average, trend and coaching comparison built on the log.
Past days can be backfilled with ONE synthetic row each:

| Field | Value |
|---|---|
| name | `Untracked (reconstructed)` |
| `logId` / `log_uuid` | `untracked-reconstruction` (the marker; `shared/contracts/nutrition/reconstruction.mjs`) |
| calories | weight-derived estimate − logged |
| macros | none. Protein is **unknown**, not zero |
| `captureEvidence` | method and every input of that day's estimate |
| `mealTime` | `null` (Ungrouped) |
| `settled` | `true` |

- **Daily summary:** a day's nutriday summary gains `reconstructed_calories`.
- **Coaching** classifies such a day as `reconstructed`:
  - its calories are trusted;
  - its protein never enters an average (`hasKnownProtein`);
  - the model is told there are no foods to mention.
- **Longitudinal:** `protein` for the day is `null`.
- **`PatternDetector`:** protein primitives skip it.

`POST /api/v1/health/nutrition/reconstruction` writes a reviewed plan through the
ledger, one row per day. It skips days already reconstructed and supports a dry run.
`DELETE` removes the whole backfill. The plan comes from
`cli/health-reconstruct-untracked.cli.mjs`. The procedure is in
[the runbook](../../runbooks/health-untracked-reconstruction.md).

## Meal buckets

`shared/contracts/health/mealBuckets.mjs` owns both labels and clock defaults.
The frontend's `today/mealBuckets.js` re-exports that contract.

| Stored value | Label | Clock default |
|---|---|---|
| `morning` | Breakfast | 05:00–11:59 |
| `afternoon` | Lunch | 12:00–16:59 |
| `evening` | Dinner | 17:00–20:59 |
| `night` | Snacks | Otherwise |
| Missing/unrecognized | Ungrouped | Never inferred on read |

Explicitly named meals take precedence over the selected capture bucket;
the clock is only a fallback. On a historical date, the default is Breakfast,
not the current hour. The resolved bucket is stored on each entry.

### Moving food between meals (`mealDrag.jsx`)

- **One food:** drag its row onto another meal. The row is the handle except the
  controls that already take the pointer — portion and kcal sliders, macro badges,
  confirm/delete, the dish triangle (`DRAG_DEAD_ZONE`). Mouse/pen start after 6 px of
  travel, touch after a 300 ms hold; a plain click still opens the editor. A dish
  carries its ingredients; an ingredient never drags on its own. Rows and meal headers
  are not draggable while "Select foods" is picking.
- **A whole meal:** drag the meal's header onto another meal, or ⋯ → "Move all to".
  Every top-level entry moves.
- Each gesture is one atomic `POST /nutrition/foods-move`: every row moves or none do
  ([server rules](meal-commands.md#moving-foods-foods-move)). Foods already in the
  destination meal are left out, and a gesture with nothing left to move sends nothing.
- The move is optimistic: the row wears its new meal until the day reloads with it, and
  highlights briefly. A food that is still saving or busy with an earlier change is
  refused before anything changes on screen.
- A failure puts every row back and drops the highlight. **A refusal** (any 4xx except 408, 425 and 429) means
  nothing happened, so the foods are free at once and the toast says why. **Any other
  failure leaves the outcome unknown:** the foods stay reserved, and a toast offers **Try
  again**, under the same operation ID, or **Dismiss**, which frees them. A Try again that
  succeeds still offers Undo.
- Success offers one Undo through `POST /nutrition/meal-undo`. A failed Undo leaves the
  foods moved, says so on the Undo's toast, and retries under the same operation ID. Logs:
  `entry.move`, `meal.move`, `*.undo`, `entry.move.blocked`, `entry.move.failed`,
  `entry.move.undo-blocked`, `entry.move.undo-failed`, `entry.move.retried`,
  `entry.move.retry-failed`, `entry.move.unresolved-dismissed`.
- **One report per failure.** Moves and their Undos never appear in a meal's status rows,
  and people never see a status line or a payload. The surface that started the action
  reports it: the sheet, the capture toast or the Undo toast. Any move or Undo with an
  unknown outcome that no surface is showing, because it was closed, dismissed or replaced,
  falls to the page's toast (`moves.unresolved`), newest first, so the retry and the way to
  free the foods are always reachable. A change that committed and only failed to refresh
  offers **Try again** alone.

### Day input (`DayInputBar.jsx`)

One row directly above the meals logs a whole day or corrects it, by typing or by
voice: "eggs for breakfast, burrito at lunch", "move the drinks to snacks", "that was
whole milk". It posts to `POST /nutrition/day-input`. The server reads the words, acts on
its best reading and returns one Undo, asking only when it cannot tell which food or
which day. The request contract, the gateway questions and the correction rules are in
[Day-level commands](meal-commands.md#day-level-commands).

- **The day belongs to the request.** A request keeps the day it was made on, and so
  does its question or error, which names that day if the page has moved on. A
  recording belongs to the day it was started on.
- **One at a time.** While a request runs the field is read-only and keeps focus, Send
  shows its spinner, and a second send is ignored. A recording that ends while a request
  runs, or while a question or failure is open, waits and says so on screen and in the
  status region. It goes once the person has answered, cancelled, retried or dismissed,
  so it never replaces either. Recordings still waiting when the bar unmounts are lost,
  and `day-input.recording-dropped` logs how many.
- **Operation IDs.** Every submission and every answer gets a new ID. Trying a failed
  request again (**Try again**, or Send with the same words on the same day) reuses its
  ID, so a request that did commit is replayed and not done twice. The last typed request
  with an unknown outcome is remembered apart from the visible error, so this holds after
  Dismiss. Different words get a new ID.
- **Questions.** "Which food did you mean?" lists the candidates, and "Which day should
  this go to?" offers a date field that stops at today. They open under the bar, are
  announced through the bar's status region, and take focus unless the person has moved
  elsewhere. An answer resends the same words with every answer so far: the text the
  server reports, else the words that were sent. A recording with no reported words is
  sent again. A day answer also sends back the foods the question named, so it
  [cannot land on different ones](meal-commands.md#answering-which-day).
- **Failures.** The server's sentence is shown and typed words stay in the field. A
  refusal offers no retry, and neither do words over the length limit, typed or
  transcribed. Any other failure carrying `audioRef` retries from the saved recording
  under the same ID, so nothing is recorded twice. The upload stays in memory, and if the
  saved copy has gone (`AUDIO_NOT_FOUND`) it is sent instead, under that ID. A 503 affects
  only this bar.
- **Focus after a request.** A request can take the focused control with it (an answered
  question, a replaced **Try again**, a microphone busy with its recording). When it ends
  with focus on nothing, focus goes to the error panel's first action (**Try again**, or
  **Dismiss** after a refusal), else the microphone, else the field. Focus left in the
  field stays there, and a press anywhere outside the bar during the request leaves focus
  alone.
- **No keyboard by surprise.** Wherever focus falls back to the field (`dayBarFallback`),
  a touch screen (`(pointer: coarse)`) gets the microphone instead, or the bar itself
  (`tabindex="-1"`) while the microphone is busy, because focusing a text field raises
  the on-screen keyboard. Desktop keeps the field.
- **"That" follows the food.** It means the viewed day's most recent capture, including
  one made that day and filed on another day, and the reply names that day. The words are read on an empty day too, so
  a correction there is not logged as food. See
  [What "that" means](meal-commands.md#what-that-means).
- **Results.** Added food gets the capture toast with its day buttons. A move or change
  gets the service's sentence and an Undo through `POST /nutrition/meal-undo`, and a move
  retires capture toasts for the food it took. The capture toast names a meal only when
  every added food is in it. "No change" and "no food" are their own notice, which leaves
  a meal recording's saved retry alone, and the words stay to be edited. Committed work
  refreshes the viewed day and every other loaded Health day.
- **Layout.** The bar is one row of constant height. Questions and errors open over the
  page below it, and its requests never appear in a meal's status rows. On a phone, every
  control, including the sheet's close button and date field, is at least 44 px and the
  whole-day move shows as an icon.
- **Move this day's food.** The button appears when the day has real food and opens a
  sheet of its top-level rows, all ticked: each meal as the page groups it, then
  Ungrouped, so a broken-link row is its own line and a dish is one line. Foods still
  saving, rejected or pending rows and weight-derived estimates are left out.
  - **Stranded parts:** a dish part sitting in another meal travels with its dish. While
    the dish is ticked the part reads "Moves with <dish>" and cannot be unticked. With the
    dish unticked the part stays unless it is ticked itself.
  - **Results:** one atomic move with one Undo, and the sheet closes only after it. A
    refusal shows its reason and keeps the choices. Foods already on that day say so. An
    unknown outcome (`MoveResult.UNKNOWN`) locks the choices and offers **Try again**
    under the same operation ID. A failed move leaves selection mode and its ticks alone.
    The sheet alone reports its failures and sits above the toast layer. Closing it with a
    move unresolved hands the retry to the page's toast. Closing it while a move is still
    running hands that move over too: the sheet neither claims it nor owns its failure
    (`ownsFailure` on `moveFromDay`), so an unknown outcome shows the page's toast with
    **Try again** and a refusal shows its reason in the page's error toast. A late result
    never closes a sheet opened since.
  - **Keyboard:** Escape closes an open day menu first, then the sheet. Closing returns
    focus to the button, or to the field if the button has gone with the food (the
    microphone on a touch screen). Closing on
    an unresolved move puts focus on the page toast's **Try again** as soon as it can be
    pressed (`handedBackMove`), unless focus has gone elsewhere. When Try again replaces
    the move control, focus goes to it. When a move ends with a note and the control that
    was used is busy or gone, focus goes to the note.
- Logs (`health` / `day-input`): `day-input.submit`, `.result`, `.clarification`,
  `.failed`, `.recording-fallback`, `.recording-dropped`, `.move-day.open`, `.move-day.result`.

### Moving food to another day

Same rows, different `date` (the meal is kept; a dish moves with its ingredients). Every
route sends one atomic `foods-move` through `useMealMoves()` in `mealDrag.jsx`:
`moveToDay` for the viewed day, `moveFromDay` when the caller supplies the options or the
rows of another day.

- **Drag:** while a food or a meal header is being dragged, the week ending today
  docks at the right edge (`DayDropDock`, `MoveDayControl.jsx`; fixed-position, only
  exists during a drag, so it cannot shift the page). Drop on a day chip.
- **Select foods:** see below. It also moves the ticked foods to a meal.
- **Meal ⋯ menu:** "Move all to day" moves the whole meal.
- **Move this day's food:** the day input's [sheet](#day-input-dayinputbarjsx).
- **Capture toast:** one tap after adding food. See [Capture toast](#capture-toast).

Words in the day input ("move that to yesterday") reach the same server command without
this hook.

The rows leave the viewed day at once (`gone`), unless they are being moved from another
day, and one `foods-move` follows. Every failure brings them back on screen. A refusal
frees the foods and resolves `MoveResult.NOT_MOVED`. With no definite answer the move
resolves `MoveResult.UNKNOWN` and the foods stay reserved. The capture toast and the sheet
then offer **Try again**, and the other routes use the page's toast, all under the same
operation ID, so a move that did commit is replayed and not done twice.
Success offers one server Undo. Logs: `entry.move-day`, `entry.move-day.undo`,
`entry.move-day.failed`. Day choices live in `moveDays.js`.

#### Select foods

"Select foods" in any meal turns on selection for every meal of the viewed day. It ends
with **Done selecting**, after a successful move, or when the day changes. Ticks on foods
that have left the day are dropped.

- **Tap to tick:** a tap anywhere on a food ticks it, picture and name included. A dish
  ticks all its parts, and shows as mixed when only some are ticked. The row's editor, ⋯
  menu, portion and number edits and dragging are off until selection ends.
- **The bar:** it stays stuck under the app header for the whole of selection mode, at one
  height, so ticks and replies never move the log. It counts what is selected and offers
  "Move N to another day…" (recent days, or a date picker for anything older) and "Move N
  to a meal…", each one atomic command across all the meals. On touch its controls are at
  least 44 px. It spans the page's side padding, so ticks scroll under it.
- **Nothing jumps:** opening and closing the bar adjust the scroller by the bar's height,
  so the tapped meal and its foods hold their place, from the top of the page too. A day
  too short to scroll that far gets the missing room below the log
  (`--health-selection-room` on `.health-log-frame`) while the bar is open, and loses it
  when the bar closes, so no blank space stays behind. The one
  exception is a control the bar would land on, which moves just clear of it. Scroll
  anchoring is off for that moment so the two corrections never add up. Rows keep their
  height: a dish's add line holds its space and the meal's tool line scrolls instead of
  wrapping.
- **On a phone:** a row is its picture, name and calories. The macros, portion and empty
  menu track give their width to the name, and normal mode is unchanged. No preview card
  opens while picking.
- **Dishes:** a dish moves whole, so it counts only when every one of its ingredients is
  ticked. A partly-ticked dish is skipped with a note.
- **Outcomes:** a move that is refused, fails or has an unknown outcome keeps the ticks.
  Choosing where the foods already are keeps them too and says "Already in Breakfast" or
  "Already on <day>".
- **Meal commands:** each meal's mic and group commands see only that meal's ticks, and a
  command in one meal leaves the other meals' ticks.

#### Capture toast

Every add made from this page that puts new food on a day gets a toast saying where it
landed ("Added 3 foods to Today, Lunch"), with **Move to Yesterday** (**Move to Today**
when it landed on an earlier day) and **Other day…**. That covers voice, photo, a typed
sentence, the day input, a barcode, a food created for an unknown barcode, a picked
suggestion, a saved meal (template) and a Needs Review confirmation.

- **No toast:** food that was not added from this page: the coach's `log_food`, Telegram
  captures and entries the kitchen scale composes. A Telegram or scale capture waiting in
  Needs Review does get one when it is confirmed here. Copy to today is a deliberate copy,
  so it keeps its plain notice. Meal instructions, amends, and captures that put no food
  on the day (no food found, barcode held for review or refused) get no offer either.
- **Undo:** captures with a server Undo (voice, photo, sentence, day input, barcode) show
  it beside the day buttons. Suggestions, created foods, saved meals and confirmations
  have none, so no Undo button appears.
- **Several at once:** one toast holds an Undo. When a newer action takes that Undo
  over, the toast loses only the Undo and keeps its day buttons. A failure of that Undo
  leaves with it: the page's toast reports the unconfirmed Undo once, and when its **Try
  again** finishes, the day offer retires as well, because the food may be gone. Offers without an Undo
  stay until used or dismissed. The newest two are kept, and a newer result about the
  same food replaces its older offer. With two offers showing, each button's accessible
  name includes the food ("Move Eggs to Yesterday").
- **Finding the rows:** by the capture's log ID plus the exact IDs its result returned.
  A shared log ID (`QUICKADD`, `TEMPLATE` and the others in `sharedLogIds.mjs`) counts
  only through those exact IDs, so earlier foods are never caught.
- **Cross-day moves:** food on the viewed day is read from the page. Food filed on another
  day ("I had eggs yesterday") is fetched from that day and moved from there by
  `moveFromDay`, which leaves the viewed day's rows alone.
- **Dishes:** a dish moves only when every part is from this capture, so a move never
  carries food from another log. A captured part of any other dish stays, and the toast
  says it is part of a dish and can't move alone; the rest of the capture still moves.
- **After the tap:** a move leaves only the move's Undo, because a capture's Undo stops
  working once its rows change. A refused move keeps the toast and its day buttons, and
  gives the server's reason (a refusal never says to try again when connected). A
  day that will not load, or food no longer on it, is reported and the toast stays.
- **Unknown outcome:** the food stays reserved, so the toast says it could not confirm the
  move and swaps its day buttons for **Try again**, which resends the same operation ID. If
  the first attempt had committed, the server replays it and the move finishes normally.
  Dismissing the toast leaves the retry on the page's toast.
- **Focus:** when a toast's action removes the focused button, focus goes to the next
  action in that toast, then another toast, then the day bar's move button, then the
  day bar's fallback (the field, or the microphone on a touch screen). Picking from
  **Other day…** puts focus on the toast's **Move to …** button, which then behaves as if
  it had been pressed. After a move from a meal's `⋯` menu, whether it finished or failed,
  focus that was left on nothing goes to the same next action, such as **Undo** or **Try
  again**. A **Try again** whose retry fails again gets focus back once it is no longer
  busy, since the browser drops focus from a busy button. The date field in these menus
  ignores a half-typed year. A meal's `⋯` menu items are 44 px tall on touch, like the
  other move menus (`health-move-menu__item`).
- **Room to scroll:** while toasts show, the page gains that much space at its end, so the
  last foods can be scrolled clear of them. The space is added below everything and kept
  until the view leaves it, so neither a toast arriving nor one leaving moves the page.
- **Moves from anywhere:** every finished move reports its row IDs and destination
  (`moves.undo.moved`), whether it came from the toast, a drag, a meal menu, selection
  or the page's Try again toast. A move to another day retires any toast about those foods. A
  move to another meal keeps the day buttons and drops the meal from the toast's text.
  Toasts about other foods are untouched.
- **One report:** the toast replaces the "Moved to Lunch" cue and the add row's "Added
  to Lunch" line for the same add.
- Logs: `capture.offer` (every path), `capture.move-day`, `capture.move-day.result`,
  `capture.move-day.retry`, `capture.move-day.load_failed`.

### Calorie bars under each kcal figure

One absolute scale for the whole day (`dayCalorieScale`, `groupRows.js`): the
largest figure any row shows — an entry, a dish's rollup, or an ingredient. A bar's
length means the same kcal on every row in every meal, ingredients included.

---

## Loading and refresh

Today's structure is permanent. All four meals always render, empty or not:
Breakfast then Lunch in the left column, Dinner then Snacks in the right; an
empty meal is its heading and add row. Every meal's heading, kcal subtotal
and add row render regardless of
whether the day's data has arrived, is mid-refresh, or failed to load; only a
bucket's entry list can be swapped for a loading placeholder, and only on a
genuine cold start — the first time a date is opened in the tab, before
anything has ever loaded for it. A bucket that already holds rows, or a day
that has loaded once before, never shows that placeholder again, including
during a background refresh.

Reopening a day already seen in this tab renders it instantly from a small
client-side cache while the real values load quietly behind it; when the
fetch resolves, the displayed rows are replaced with no loading state ever
reappearing. The same holds after any change made from the day view itself —
logging, editing, confirming, or deleting an entry all trigger the identical
quiet reload, never a spinner. This comes from the shared fetch hook's
stale-while-revalidate mode; see
[`__docs/reference/frontend/design-system.md`](../frontend/design-system.md#data-fetching)
for how the primitive itself works.

**Reopening Health paints from disk.** Every `api/v1/health/*` read is also kept in
IndexedDB (`healthCache.js`, database `daylight-health-cache`). Before its first render
the app restores those entries into the in-memory cache. That takes tens of
milliseconds, and it gives up after 400 ms, so a slow disk just means a normal network
load. The context gate, the day, the budget headline, weight and the coach line
therefore paint from the last visit on the first frame, and each one revalidates
quietly. Restored entries are always treated as stale: every reader refetches them and
the prefetcher does not skip them. The snapshots belong to one person. When the
server's `/context` names a different user than the one recorded on disk, everything
restored is dropped and refetched (`claimApiResourceOwner`). Measured on the LAN: a
warm reopen went from 4.2 s to 0.2 s until the day's rows appeared.

**The day on screen goes first.** On opening, the coach line's `/dashboard`
(Health's slowest call, about 2.8 s), the sidebar's 30-day range and the
neighbouring-day prefetch all wait until the viewed day has come back from the
server and the browser has had an idle moment (`useAfterFirstPaint`). A snapshot
already cached still shows in the meantime. After that, each date flip starts its
prefetch pass only once the new day has loaded. A slow request therefore never holds the page, and never takes one of the
browser's six connections while the day is still waiting for one.

**Days around the viewed day are already loaded.** Once the viewed day is on screen,
`useHealthDayPrefetch` warms a ±7-day buffer of the per-day resources (`/day`,
`/nutrition/pending`, `/nutrition/observations`), nearest first and, at equal
distance, in the direction the user is moving. The same queue also warms every meal's
add-row shortlist, the sidebar's 30-day range and the neighbouring weeks. It pre-decodes
the icons of prefetched rows too. Each flip replaces the queue with the new
neighbourhood (`prefetchApiResources` in `useApiResource.js`: two requests at a time,
fresh entries skipped, a newer reader response never overwritten; mutations mark cached
health paths stale so the next pass refreshes them). A cached day paints in the SAME
render as the date change (the hook reads the cache during render, so there is no empty
frame), and icons already decoded in the page session render at once instead of fading
in from the placeholder. Days after today are never requested. Each viewed date logs
`day.view` once (`fromCache`, `paintMs`), and each drained prefetch pass logs
`prefetch.summary` (cumulative `queued`/`completed`/`failed`) — see the observability
table in [health-app-frontend.md](health-app-frontend.md#observability--artwork-and-day-data-quality).

The Exercise section's header follows the same discipline for a different
reason: it appears once the day's budget has loaded, whether or not any
workout is logged, so a workout-free day gets a stable header rather than one
that pops in and out as sessions come and go.

### Feedback never moves the day

Nothing on Today may push the meal log down on its own schedule. Every message
has one of three homes, chosen by what it is about:

| Kind | Examples | Home |
|---|---|---|
| **Reaction to what you just did** | "Moved to Lunch", "Breakfast copied to today", a capture that found no food, the [capture toast](#capture-toast) with **Move to …** and **Other day…**, the day input's replies, Undo for a move / meal change / delete, a move that failed, a recording that didn't send | A **toast** (`TodayToasts.jsx` over `lib/ui` `Toast`): floats out of flow, just above the tab bar on a phone, bottom-right on desktop, never over the headline number. Hidden while the coach chat is open. |
| **Waiting on you, arrived on its own** | Nutrition-cleanup follow-up questions (15 s poll), unmatched kitchen-scale readings | The **follow-ups bell** (`FollowUpTray.jsx`) in the app header, next to settings. It takes no space on the page at all. The header slot is a fixed size (`followUpTarget`, portalled into from TodayView), and when something is waiting a red count floats over the bell, so an arrival moves nothing. Tapping the bell drops down a short list: each question by the food it is about (up to five, then "N more"), and "N scale readings to match". Picking an item opens a **sheet**. Questions come as a card deck (`cleanup/QuestionDeck.jsx`), opened on the question you picked: ONE compact card at a time, headed by the food, choices as big buttons (with the auditor's one-line reason), swipe / arrow keys / Back–Skip to move, answering moves on by itself, free text behind "Other answer…", "Leave as is" to dismiss. The sheet also holds any unclaimed scale readings. With nothing waiting, the bell is muted and its dropdown says "Nothing waiting". The dropdown has no focus trap: its aria-hider raced the sheet a pick opens and left the page, sheet included, `aria-hidden`. |
| **About one entry** | A portion/number edit that failed or is invalid | **On that entry's row** (`PortionDraftAlert` in `EntryRow`). A dish cannot be collapsed while a draft is open, so a member's error cannot be hidden. Only a draft whose entry has left the day falls back to a toast. |

Section load failures (`ErrorState` for the day, review queue, measurements) stay
in flow: a section that failed should occupy its space.

Toast rules:

- **Information retires itself** after 6 s (paused while pointed at or focused) —
  if it is short (≤ 80 characters). A capture can answer with the model's own
  paragraph; that stays until dismissed.
- **Anything with an action stays** until used or dismissed. Delete's confirmation
  promises "You can undo this straight after"; an Undo that expired while the phone
  was in a pocket breaks that promise.
- **One Undo at a time.** A move, an AI meal change, a capture and a delete can each
  hold an Undo; the newest supersedes and *retires* the older ones, so dismissing it never
  brings back a stale Undo for something else. A capture toast that loses its Undo keeps
  its day buttons.
- A failed Undo shows its error and the Undo offer side by side, so it can be tried
  again.

The toast region portals into the app's `.ds-root` (where the theme's `--ds-*`
colours are set), not `<body>`.

Why: `ui.layout-shift` (`useLayoutShiftLog.js`) showed `div.health-log`, the whole
meal list, moving with no user input, in bursts about 10 s apart, while notices and
questions came and went above it. Those events name the elements that *moved*, not
the cause; `.health-suggest--inline` shows up there only because the add rows
ride along with the list.

---

## Viz and layout

Every bar on the Today and Progress tabs is plain CSS or inline SVG. There is no
chart library outside the Progress weight chart, and nothing animates the CSS
`filter` property — it is a known paint-cost trap in this codebase (low frame
rates with zero long tasks).

The Today tab is deliberately ledger-dense: its type is one step below the app
default, meal and row whitespace is compact, and the 44 px capture controls keep
their touch-target floor even though the surrounding chrome is tighter. The
inline Add food surface is a bordered, height-capped panel rather than loose
text; suggestions use one column on the narrowest screens and two from 480 px,
with a real catalog icon or a reserved Noom-dot fallback on every row. It opens
under a meal's add row only while that row has focus or text, and **overlays** what
follows (absolutely positioned under the input, full row width, the row card's look,
scrolling inside its own max-height) rather than sitting in document flow — in flow,
focusing a row pushed the page down by up to the list's height and blur/commit
yanked it back. When the visible viewport (`visualViewport`, so a phone keyboard counts)
has less room below the input than the popup needs and more above, it opens upward
(`popupPlacement`, re-evaluated on viewport resize/scroll). The sheet (non-inline) mode
keeps its in-flow layout. Suggestion rows
are 32 px under a fine pointer and keep the 44 px floor under `(pointer: coarse)`.

Food rows use the shared `foodPortion` contract: known mass first, otherwise the
current amount/unit, never stale `originalQuantity`. Millilitres and servings
remain those units; they do not imply grams. Group mass is the sum of known
child masses, unknown if any child mass is unknown. Unknown nutrients show `—`,
known zero shows `0`, and partially covered totals show `+`. Macro intake remains
visible even without goals. Each row has one artwork slot, inline estimate and
macro badges, an independently actionable portion and an explicit Confirm button.
Food names stay on one line (ellipsis with the full name on hover and in the edit
button's accessible name). Protein, carbs and fat occupy aligned numeric badge
columns in rose, sage green and gold; the day's labelled totals carry matching
color dots. Badges omit letters and units, with full nutrient names and grams in
their tooltips and accessible names. Meal totals use the same badges. Grams and
calories display as whole numbers, including portion previews and editor fields;
gram adjustments snap to positive integers. Stored nutrient precision is retained
for proportional scaling, and non-mass portions can still use fractional units.

Exercise rows show a program poster, title, start time, duration, average heart
rate when supplied, and calorie credit. An estimated row (a home session not on
Strava yet) shows its credit as `+~N kcal est.`. One optional fitness session index request
for the selected date resolves `homeSessionId` against session and segment IDs.
Matched rows use the primary video's program artwork and link to
`/fitness/home/session-{id}`; unlinked workouts keep a neutral exercise icon.
Missing artwork falls back in place, and a failed index request offers Retry
without hiding exercise credit. The fitness index never adds workouts or changes
the calorie equation.

The week strip separates its seven-day viewport from the selected day. Picking
a visible day changes only the selection; explicit 44 px previous/next-week
controls page contiguous Monday–Sunday weeks without changing the selected date.
The `date` and `week` query parameters preserve both selection and viewport through Back and tab navigation. It names weekdays
with three letters, labels the visible date range, marks month boundaries, and
uses a bordered accent state for the selected day (distinct from today's inset
ring). Future navigation stops at today.

### One shared range endpoint

`GET /budget/range?from=&to=` returns one entry per day for an inclusive range,
in a single request. Every multi-day surface reads it through one client hook,
`today/useBudgetRange.js`:

| Surface | Window |
|---|---|
| Week strip (`today/WeekStrip.jsx`) | the visible viewport's final day and the six days before it |
| Month block (`today/MonthBlock.jsx`), desktop sidebar | last 30 days |
| Intake vs burn (`progress/IntakeBurnChart.jsx`), desktop sidebar | the same 30 days |
| Adherence bars, Progress tab | last 14 days |
| Intake vs burn, Progress tab | last 30 days |

The endpoint exists because each of those surfaces previously fired one request
per day — seven from the week strip and fourteen from Progress, in parallel, on
mount. The service loads goals once, the weight history once, the range's
nutrilist rows in a single `findByDateRange` folded into per-day buckets, and
the workout ledger once through `getWorkoutsForRange`. That last one is separate
from the per-date `getWorkoutsForDate` because the per-date call re-reads both
whole lifelog files every time: a 62-day range through it would be 124
whole-file reads on one request. Range length changes the size of the response,
never the number of times storage is touched.

The range is capped at 62 days and the dates must be real calendar dates;
anything else is `400 { code: 'RANGE_INVALID' }`. Unset goals are a property of
the account rather than of a day, so they fail the whole range with
`409 { code: 'GOALS_NOT_CONFIGURED' }`, matching `GET /budget`.

A surface shown more than once on a page does **not** fetch more than once. Two
readers that mount together on one path share one in-flight request (and a
prefetch in flight is joined, not repeated); an explicit `reload()` never
joins. A range several widgets need is still fetched once high in the tree and
handed down as `days`. The desktop sidebar's month block and its
intake-vs-burn chart share one 30-day request this way.

### One rule for which day a row belongs to

`findByDate` and `findByDateRange` are the same lookup at two widths, and they
resolve a row's day identically: by `date`, falling back to `createdAt`'s day,
across the hot log **and** the monthly archives. That is the same predicate the
archiver uses to decide where a row is stored, and it has to be — a row filed
into an archive by one rule and looked up by a narrower one is a row nobody can
find.

This was a live defect, not a hypothetical. `findByDate` used to read only the
hot file and match `item.date` exactly, so once a day passed the 30-day
retention window the week strip drew a real bar for it while the equation and
the meal list both reported that nothing had been eaten — the day view being the
wrong half. A row carrying only `createdAt` diverged the same way without any
archive involved. Both reads now go through one private window helper, so the
fix is in the store rather than in each of its five callers.

Two consequences worth knowing. Archived rows are **readable but not editable**:
the write path is hot-file only, so editing a row older than the retention
window fails with `NOT_FOUND` rather than silently succeeding. And a lookup for
a date inside the retention window still touches no archive at all, so the
common case costs exactly what it always did.

### A hole is not a zero

Every bar surface distinguishes three states, not two:

- **a computed day** — a real track with a fill sized from the data;
- **a computed day where nothing was logged** — the same real track, with a
  zero-height fill and a real `0` in the readout;
- **a gap** — a day the server could not compute (no usable weight at or before
  it, returned as `{ date, error: 'NO_WEIGHT_DATA' }`) — drawn hollow: a dashed
  outline with no track and no fill, `—` instead of a number, and "no data" in
  the accessible name.

Rendering a gap as a zero-height bar would say "you ate nothing" about a day
nobody has any information about. It is the same class of statement as a
confident `0 / 30 g` fibre bar, which the [micro coverage](#micro-coverage--why-a-stored-0-is-not-a-zero)
rules exist to prevent. Counts of gaps are stated in each block's caption rather
than left to be read as good days, and gaps are excluded from every average.

### Encodings

**Week strip and month block.** Bar height is the day's **net** calories
(`food − exercise`) as a fraction of that day's goal (`budget`) — the same
quantity the server's status judges, so height and hue can never disagree. (The
Today ruler plots food instead, with exercise raising its ceiling; the zones are
the same.) The box is `cap` goals tall
(`dayBars.js` `barScale`): at least 1.25×, raised for the whole strip so its
highest break-even (`maintenance / budget`) fits under the top, at most 2×. A
solid line marks the goal at `1/cap` of the box; a dashed line marks break even.
Both positions are set inline and shared by every cell, so they sit level.

Hue is the server's zone (`day.zone`, the shared budgetZone rule): info for an
under-logged (`incomplete`) day, success in range or declared, warning over the
top, danger past break-even. A shaded **goal band** runs from `floor − exercise`
(`barModel.floorPct`) up to the goal line, so each cell shows where "logged
enough" starts. The month block's caption counts days over plan, past break-even
and under-logged separately; an under-logged day is not a deficit. A day from an
older payload without a zone keeps the legacy hue: success up to the goal,
warning past the goal but under break even (still losing, just slower), danger
past break even — or past the goal when no break even is known. A day you ate 114% of goal and trained off is drawn
at its net, under the line, green: the old food-height encoding needed an extra
"offset by exercise" cue to explain that, and it is gone. The accessible name
still states every term as one claim ("ate 2040, burned 530, 1510 net of 1791
kcal goal, 84%, break even 2291, 281 kcal left"), saying "no exercise logged"
rather than dropping the term.

The accessible name announces the *true*
percentage — 140%, not the clamped paint — because a spoken clamped number is a
false statement. There are deliberately **no macro segments** in these bars:
four pixels of colour in a 34px cell is not a composition readout, and macros
have an honest home in the tapped day. The arithmetic lives in
`today/dayBars.js`, as a function rather than inline, because jsdom cannot
measure a rendered bar — what a test can assert is the number the component
computes and sets.

**Weight chip** (`today/WeightChip.jsx`). The latest adjusted average, a 7-day
delta, and a 30-day sparkline of two inline-SVG polylines — the raw daily
readings and the smoothed `lbs_adjusted_average` the budget is computed from —
on one shared vertical scale, so they cross where they really cross. The delta
compares adjusted average to adjusted average; raw-to-raw would report a day of
salt as progress. A history too short to have a 7-day delta says so rather than
printing `±0.0`, and a single reading draws no line rather than a flat segment
implying a month of stability. Direction carries an arrow as well as a hue —
never colour alone.

**Intake vs burn** (`progress/IntakeBurnChart.jsx`). Food hangs down from a
baseline, exercise stands up from it, on ONE shared kcal scale: the two halves
of the box are sized in proportion to their maxima, so a kcal is worth the same
number of pixels above the line as below. Separate scales would draw a 300 kcal
walk as tall as a 2,400 kcal day and make burn look like it cancels intake. A
quiet exercise month therefore shows a thin strip of up-bars, which is the truth
about it.

### Column and sidebar

At 1200px the existing AppChrome left rail expands to 320px on Today only and
holds week, dated weight and thirty-day context. The main log is capped at
1440px with two populated meal columns in chronological order. Other apps keep
their existing 200px rail. Below 1200px the log uses one column and week/weight
history is collapsed below it; month charts mount only on wide screens.
Empty meals use an add strip, and exceptional uncounted captures have a closed
disclosure below the log. Group expansion survives refresh, with the final
child's tree connector ending at its own row. Six-viewport browser tests
(`health-portion.runtime.test.mjs`, touch emulated at 390, 768 and 1024 wide)
enforce no horizontal overflow; 44px row targets on a coarse pointer or a
phone-width column and the compact 28px rows on a fine pointer; the two meal
columns with Breakfast and Dinner level at the top; and position bounds of the
first meal (≤210px wide, ≤280px at 390×844) and first food (≤360px at 1366×768
and wider, ≤430px at 390×844). The first food sits below the always-shown
Breakfast strip, so those bounds are looser than the first meal's.

**Exercise** closes the late column, under Snacks, at meal width. Each workout
is one food-shaped row on the shared meal tracks (`ExerciseSection.jsx`): a
program poster, the title, and one truncated line holding the first voice memo
(the episode description only when there is no memo); minutes sit in the
portion track and the calorie credit, larger than a food's, in the kcal track.
The credit comes from the nutrition workout ledger; the fitness sessions index
only supplies posters, memos and the session link. Clicking the row opens the
fitness session. Hovering it (or, on touch, tapping the poster) shows the
page's one preview card with start time, minutes, average heart rate, the
credit (`est.` for a heart-rate estimate), every memo and the description.

---

## Capture funnels

Four ways to get a food onto the log — type, speak, photograph, or scan a barcode — start
from one of two places on Today: the [day input](#day-input-dayinputbarjsx) above the
meals, which takes words typed or spoken about the whole day, or a meal's own add row,
which takes all four.

All four meals always render; an empty meal is its header and its add row. Each meal's
add row (`MealAddRow.jsx`) is the capture surface for that meal: a slim inline
"Add to {meal}…" field with voice, photo, barcode and saved-meal actions beside it (muted
until the row is hovered or focused on a mouse; always full strength on touch). There is
no mic in the meal header. The add line's text starts where the food
names start (LogTable measures a top-level row's name and shares it as
`--health-name-inset`, so an empty meal lines up too); its suggestion list keeps the
meal's full width. Hovering a row's picture or name shows the food's preview card. There is ONE
card for the whole page (`RowPreviewProvider`, hosted by `LogTable`): it sits
above-right of the cursor, follows it, never takes the pointer, and swaps content
when you move to another row — two cards can never overlap. Keyboard focus anchors it
to the name; on touch, a tap on the picture opens it and a tap elsewhere closes it.
A suggestion shows the barcode product photo when the saved food
has one (`photoRef`), else its icon, and a label serving ("325 ml") when it has no grams.

The add row's mic adds by default ("Speak foods to Lunch"). While foods in that meal are
selected ("Select foods"), the same mic carries the selection and edits those foods
("Speak changes to 2 selected to Lunch") — the route the header mic used to own.
The footer below the log carries the macro summary and coach line, never capture controls.

### Quick add — suggestions before the first keystroke (`AddCombobox`)

Opening the add row shows a list immediately: the combobox fetches
`GET /nutrition/catalog/suggest?bucket={bucketId}&limit=16` on focus, undebounced (and
the day prefetch has usually cached it already), so Breakfast's regulars are one tap
away with nothing typed. Typing switches to
`?q=` on a 250 ms debounce; clearing the text returns to the bucket list. Both share one
request-id guard, so a slow response can never overwrite a newer one.

The opening list is capped at **16** (`SHORTLIST_LIMIT`, `healthResources.js`). It was 8
while it was the only fetch with no user intent behind it and every row fired a cold icon
request; the shortlist is now prefetched with the day and its icons pre-decoded then, so
opening a row no longer pays that burst. The typed list keeps the server default of 12;
there the person is steering.

**Icons for foods that have none.** A catalog entry with no offered icon (`null`,
`'default'`, or a slug the manifest no longer offers — typically a UPC product) gets the
closest OFFERED slug by name at suggest time (`guessIconForName`,
`2_domains/nutrition/services/icons.mjs`): a reviewed `foodNames` alias or an exact-only
name decides outright; otherwise the longest run of whole words that is a slug wins, head
noun first ("Organic Fuji Apple" → `apple`). No substring matches (`shake` never finds
`salt-and-pepper-shakers`), no lone modifier words, never an alias to retired flat art.
The icon is display-only and **not persisted**, so a later real capture can still donate
a better one. Nothing matching keeps the placeholder — "Premier Protein Shake" and
"Scrambled Eggs" have no honest slug in today's manifest (the latter is exact-only on
purpose); a manifest `foodNames` entry is how either gets a picture.

Arrow keys move a `highlight` index over the results; **Enter with a suggestion
highlighted** or a click both call `pick(entry)`. Rows show the food's icon (where the
catalog entry has one), its name, and its calories, with the same `<img>` + `onError`
fallback the log rows use. A row that is a **meal** rather than a food carries its item
count as a badge (see [Meal templates](#meal-templates)).

#### The ranking

`FoodCatalogService.suggest(query, userId, limit, { bucket })` filters by the query, then
hands the candidates to `bucketSuggestRanking.mjs` — a pure domain module that takes the
clock as an argument, because the domain layer forbids an ambient one.

**Nothing typed: half common, half recent (`blendShortlist`).** The zero-keystroke list
interleaves two lists — the ranking below ("what I usually have here") and a
most-recently-used list ("what I had lately": entries with history in this bucket by that
bucket's `lastUsed`, then the rest by global `lastUsed`) — common first, then recent,
alternating, each skipping what the other already placed, until the limit. Frequency
alone buried a food eaten twice this week under years of staples. Same admission rule as
the ranking (the backfill stays out of both halves once the bucket is thick), ties on
name, so the list is deterministic. A typed query uses the ranking alone. Three tiers:

| Tier | Who | Ordered by |
|---|---|---|
| 0 | **Favorites** | blended bucket score, then global score |
| 1 | Entries with history **in this bucket** | blended bucket score |
| 2 | Everything else — *the backfill* | global score |

The blended bucket score is

```
0.6 * min(1, countInBucket / 90)  +  0.4 * 0.5 ** (daysSinceLastUsedInBucket / 14)
```

— frequency normalised over a 90-day window (a food eaten every day for 90 days scores
1.0, and more uses cannot score higher), recency decaying by half every 14 days. The
global score is the older bucket-blind one, `useCount / (1 + daysSinceLastUsed / 30)`,
kept verbatim. Ties break on normalized name, so the order is total and the same input
always yields the same list.

**Tier 2 is admitted only while fewer than five catalog entries have any history in the
bucket.** Once a bucket knows five foods, the list is that bucket's foods plus favorites —
a global list wearing a bucket label is what the tier exists to stop. Favorites are never
what the threshold cuts. With no `bucket` supplied, no entry has bucket history, so tier 2
is always admitted and the result is exactly the shipped favorites → global-score → name
ordering.

#### Where bucket history comes from

`FoodCatalogEntry.usageByBucket` maps a bucket id to `{ count, lastUsed, quantity }` and is
persisted with the entry. Two writers, both of which know the *resolved* meal:

- **A quick-add** records against the bucket it was logged into.
- **`POST /nutrition/catalog/backfill`** replays stored nutrilist rows, whose `mealTime` is
  the resolved meal — an explicit "for lunch", or the row a capture was launched from,
  having already beaten the clock upstream.

The three Telegram/coach capture use-cases deliberately do **not** record a bucket. At the
point where they record catalog usage, the meal they hold is the *clock's* guess; the
precedence that lets a spoken meal or a launch row override it is applied downstream, in
the input router. Donating the pre-override value would write a wrong bucket that no later
correction can undo, so those callers record a use with no bucket at all and the backfill
picks the history up from the finished rows. A caller that cannot name a bucket never
advances bucket history and never guesses one.

`quantity` is the portion the food was last logged with in that bucket, which is what a
one-tap quick-add defaults to. A quantity with neither grams nor an amount is never
recorded (`null` is unknown, not `0`), and a stored `{grams: 0, amount: 0}` from before
that fix reads as absent. A bucket the food has never been eaten in falls back to the
canonical grams, then the label serving, then one serving — never a null amount.

**Barcode foods keep their serving and photo.** A UPC capture records into the catalog
the label `serving` (`{amount, unit, grams|null}` — a 325 ml shake keeps `325 ml` with
no invented grams), the product `photoRef`, the resolved icon (never `default`), the
meal and the capture id. These FILL an entry that lacks them and never overwrite. A
quick-add of such a food logs that serving and carries the photo; with no icon, it
takes the closest offered slug by name and persists it on the entry. A later scan of a
known product reuses the stored serving and photo instead of re-fetching.
`cli/health-catalog-serving-repair.cli.mjs` backfills older entries from their original
scan rows (dry run by default; `--apply --backup NEW_DIR --offline`).

### Deterministic paths — skip the funnel entirely

**After an add.** A typed sentence shows an in-place "Adding “…”…" row in its meal (the
same `captureTasks` placeholder voice and photo use, labelled with the text) from submit
until the parsed rows are actually on the day, so they replace the placeholder instead of
popping in seconds later. The new row(s) then carry a short accent highlight
(`useAddedRowHighlight`, 1.5 s from first appearance), because the heaviest-first sort can
land them mid-list. Both come from `today/addFlow.js`, which matches the add response's
row ids (`item.uuid` for a quick-add, `entryIds` for a sentence) against the day's rows and
logs `add.flow` (`submitToCommittedMs`, `committedToVisibleMs`).

**An inline pick is optimistic.** The row appears and the field clears at once, with no
spinner: the client builds a provisional row from the suggestion (`provisionalFoodRow`,
id prefixed `pending-`) and puts it on the day, then saves behind it. The server's row
replaces it (`settleProvisionalRow`); a failed save removes it, restores the typed text
and shows the error. `onDone` (the day reload) waits for the save, because a reload that
beat it would drop a row the server has not seen yet. Logs: `quickadd.optimistic`,
`quickadd.done` (`saveMs`), `quickadd.failed`. The sheet surface still waits.

`pick(entry)` is the fast path: **one** request, `POST /nutrition/catalog/quickadd
{ catalogEntryId, mealTime }`, then done — no pending state, no confirmation step. The
meal travels with the quick-add; there is no follow-up `PUT` to move the row afterwards.
The response is the saved row, and it goes straight onto its day
(`showCommittedFoodRows` in `healthResources.js`, over `patchApiResource` in
`lib/hooks/useApiResource.js`). The row does not wait for the day refetch. On a busy
page that refetch queued for seconds behind icons, photo thumbnails and neighbour-day
prefetches on the browser's six HTTP/1.1 connections, while the add row had already
cleared. The refetch still follows and brings the budget and totals. A request issued
before the patch cannot write the pre-add day back over it.

A write's refresh (`refreshHealthResources`) leaves `/dashboard` out. That endpoint
re-aggregates 730 days and runs the 730-day reconciliation on every request, about 2 s of
server work that blocks every other request, and a food write changes nothing Today reads
from it (the coach line). A coach turn refreshes it (`refreshHealthResourcesWithDashboard`).
The row lands `settled: true, settledBy: 'user'`, because a one-tap pick of a known food is
a deliberate choice, not a machine estimate. Its portion is the last one logged for that
food in that bucket, else its canonical gram portion, else its label serving, else one
serving. The row carries the food's product photo when it has one. The suggestion shows the
same proposed grams and scaled calories that the command will log. Unknown mass stays unknown.

The same shape repeats everywhere a value is already known and doesn't need interpreting:

- **Custom-food creation** (`CustomFoodSheet`, below) — create, then quickadd.
- **Template instantiation** (`TemplatePicker`, below) — `POST
  /nutrition/templates/:id/instantiate` writes a dish group and its children directly.
- **Copy-to-today** ("Copy to today", below) — `POST /nutrition/copy` writes
  NutriList rows directly.

None of these touch the AI parsing pipeline.

### Free-text sentence, photo, voice, barcode — the AI capture path

Everything else — a typed sentence with nothing highlighted, a photo of a plate, a voice
note, or a barcode scan — goes through the **same unified endpoint**,
`POST /api/v1/health/nutrition/input { type: 'text'|'image'|'voice'|'barcode', content }`,
which is the web transport onto the pre-existing Telegram nutrition-bot pipeline
(`WebNutribotAdapter` → `NutribotInputRouter.handleText/handleImage/handleVoice/handleUpc`
→ `LogFoodFromText`/`LogFoodFromImage`/`LogFoodFromVoice`/`LogFoodFromUPC`).

**Which day a sentence or a voice note lands on.** The viewed day (`date` on the request) is
the answer unless the person NAMES a day. The prompt's "today" is the viewed day (the live
clock when that is today; a fixed 12:00 PM only for a past day), and the model's `date` is
honoured only when it also returns `dateExplicit: true` ("yesterday", "last night", "on
Wednesday"). A meal word or a time of day is not a day: before this rule a pinned noon
clock made "for dinner I had…" a future meal, and the model filed it under the day
before (2026-09-28, spoken at 23:40 while viewing today). The same flag rule applies with
no viewed day (Telegram): the wall clock decides. `LogFoodFromText.mjs`,
`usecases/viewedDate.test.mjs`.

An optional `bucket` field on that same request declares the meal the capture was
launched from — a meal section's own header trigger sends that meal's id, the
quick-capture bar sends its clock-derived default. A value outside the four meal ids is
rejected with `400` before it reaches the pipeline at all — never guessed at, never
passed through. Where the capture actually lands is one precedence, applied once
regardless of transport: a meal named explicitly in what was said or captioned wins;
failing that, the declared bucket; failing that, the clock default the capture was
already parsed with. Only the first case — an explicit meal overriding a *different*
declared bucket — is worth telling the person about, since every other outcome is just
the capture landing where it was asked to: Today surfaces that one case as a "Moved to
{meal}" notice on reload.

**There is no confirmation gate.** Those use cases still build a `pending` NutriLog
internally, but the router commits it before returning: an auto-commit seam in
`NutribotInputRouter` stamps `settled: false` on every item and runs the same accept path
`AcceptFoodLog` uses (status → `accepted`, `acceptedAt` stamped, NutriList synced), so the
entry is visible and counted straight away. The same seam decorates the response context
the use case sends through, so the inline keyboard that reaches the client offers **Undo**
and **Edit** — never Accept. Those two buttons reuse the existing `x` (discard) and `r`
(revise) callback commands, and Undo *deletes*: `DiscardFoodLog` marks the log
`deleted` and removes its NutriList rows. The message copy itself matches: a text or image
capture's reply opens with "Logged ✓ — *n* items, *k* kcal" rather than a question, so the
words read as a confirmation and not just the buttons. This applies to every transport —
web, Telegram, and the coach's `log_food` alike.

**Recovering from failures (Telegram).**

- **Undo is reversible.** An undone receipt reads "↩️ Removed from food log" and carries a **↩️ Restore** button (callback `rs`). `RestoreFoodLog` restores the log's tombstoned rows (`restoreByLogId`), marks the log `accepted`, refreshes the receipt and re-arms post-meal coaching. A second tap is harmless.
- **A failed transcription offers 🔄 Retry** (callback `vr`). Telegram voice files stay fetchable by id, so the retry re-runs the same recording.
- **Transient failures retry automatically first.** HTTP 429/5xx and network cuts are retried with backoff inside `retryTransient`, including raw axios errors, which carry the status on `error.response`.
- **Retry state never replaces the conversation's root flow.** A photo retry (`ir`) and a voice retry (`vr`) are each stored in a *session keyed to their own failure message* (`conversationStateStore.set(id, state, messageId)`). A failure during an open revision leaves that revision open.
- **An open text flow expires after 30 minutes.** A revision or a scale "describe it" owns the next thing said, spoken or typed, only while it is fresh: each flow stamps `flowState.openedAt` when it opens, and `NutribotInputRouter` closes a flow older than `OPEN_FLOW_TTL_MS` (or one with no stamp) before routing, logging `nutribot.flow.expired`. After that, the next message logs a new meal. Without the bound, a revision whose own reply failed stayed open indefinitely: on 2026-09-25 a dinner voice note, 31 hours after Revise was tapped on the previous day's lunch, replaced that lunch.
- **Voice follows the open flow.** A voice note sent while a revision or a scale "describe it" is open is transcribed and routed exactly like typed text, so it revises the pending log rather than logging a new meal. Before 2026-09-24 voice bypassed the flow: a spoken revision would have been logged as a new meal.

Two flows are deliberately exempt from the accept half of the seam:

- **Scale** captures keep their multi-step composition flow (weight → tare → density) and
  mint a `pending` NutriLog for the duration of it. The composition completing is what
  commits: the scale path applies the scanned density and then runs the same accept seam
  every other funnel runs, so a finished placement lands `accepted` with `settled: false`
  and is indistinguishable from a typed entry. What stays `pending` is a placement that
  never completed — a weight with no density scanned, which nothing can price. A pending
  row never syncs into the day's NutriList, so it doesn't appear among Today's normal rows
  and doesn't count toward the budget; `GET /nutrition/pending?date=` surfaces it
  separately, and Today renders it in a **NEEDS REVIEW** banner below the meal buckets,
  with its own Accept/Discard. Both the endpoint and the banner include pending logs
  from every capture surface, including scanner/Telegram barcode entries awaiting
  portion confirmation. Health can accept the stored portion or discard the entry
  directly; Telegram is an optional capture surface, not a required confirmation step.
  Confirmation refreshes the pending list and the day's rows and budget together.

  **A scale-origin NEEDS REVIEW row is not permanent.** The prompt behind it is still the scale's live
  one, and the next thing put on that pan supersedes it — the row is marked `rejected`, its
  message is deleted, and the banner entry disappears with nobody having acted on it. This
  is the one place the value below is written. So the banner is a "before the next meal"
  affordance, not a queue that waits: answer it, or it goes. An entry somebody has already
  engaged with is never superseded.
- **Barcode** has no Accept gate to retire — it commits at its portion-selection step
  (`SelectUPCPortion`). The seam still stamps its items unsettled so the rows that step
  writes land the same way.

Messages are captured as `{ messages: [...] }` in the JSON response (the same shape
Telegram's `choices`/`callback_data` protocol uses).

The accept path runs with `autoReport: false`. Every capture that reaches it already commits
on arrival (above), so `findPending` is essentially always empty by the time it runs — firing
the daily report on every request would otherwise render an image, send messages, and kick the
coaching orchestrator inside *every* capture. Manual Accept paths (the scale's own Accept
button) keep the default, so the report still fires normally when the day's last pending item
is confirmed by hand.

While an AI capture is being analyzed, Today shows a placeholder row inline in
the meal bucket the result will land in — never a page-level spinner — so the
wait is visible exactly where the outcome will appear. It clears once the
capture resolves, whether that means food was found, none was, or the request
failed outright.

There is no post-capture review card on web. A response's messages carry choices (the
Undo/Edit keyboard) only when food was actually detected — `TodayView` reloads the day
when it sees any choices, and otherwise (an empty detection, e.g. "no food found")
surfaces the message text as a toast instead (see
[Feedback never moves the day](#feedback-never-moves-the-day)), so a miss is still
visible rather than silently dropped. `AddCombobox`'s sentence submit follows the same shape directly:
on success it just reloads — no confirmation step of its own.

A captured entry appears in the day's log (`GET /nutrilist/:date` returns every status,
unfiltered) and counts toward the budget immediately, carrying `settled: false`. It
renders like any other row: tapping it opens `EntryEditSheet` to edit or delete, and its
"Unconfirmed" badge carries the one-tap settle button (see
[Unsettled vs. settled](#unsettled-vs-settled) below). Photo and voice captures
(`PhotoCapture`/`VoiceCapture` → `TodayView`) and a known-barcode hit (`BarcodeCapture` →
`TodayView`, when the result isn't `unknownUpc`) submit through the identical
`/nutrition/input` call and follow the same reload-or-notice handling.

### Row actions — the ⋮ menu

Every Today row, dish parts included, has one control: a vertical **⋮** that opens
**Details · Verify · Revise · Remove** (`EntryRow.jsx`). The old per-row icons (✓
confirm, ✕ delete, − take out of dish) are gone (2026-10-01).

- **A tap anywhere on the row opens Details** (the edit sheet), the same as the menu's
  Details. A control that owns its own click keeps it: portion and kcal scrubbers,
  macro and density badges, the dish triangle, the photo preview, the ⋮ itself. A
  click that bubbles out of a portalled menu or popover is ignored.
- **Verify** appears only on an unverified estimate (`settled: false`) and PUTs
  `settled: true`; a brief ✓ shows beside the ⋮.
- **Revise** opens a correction field in place under the row (`RowRevise.jsx`), typed
  or spoken (the mic transcribes server-side), and applies in one gesture:
  - **A food** is re-derived by `POST /nutrilist/:uuid/revise` (`ReviseEntryService`,
    a proposal the client PUTs), with an Undo that writes the previous values back.
  - **A dish** has its PARTS rebuilt by `POST /nutrilist/:uuid/revise-dish`
    (`ReviseDishService`): "the soup didn't have noodles, the base was broth, chicken
    and tofu" keeps, adjusts, removes and adds parts. Every id the model names is
    checked against the dish's real parts, a part it forgets to mention is kept, a
    part may not share the dish's name, and the change commits through the meal
    command's `amend` (with its `removals`), so the page's "Meal updated · Undo"
    banner reverses the whole thing.
- **Remove** asks the view's delete dialog, on a dish part too. It deletes; taking a
  part out of its dish but keeping it in the meal was retired because the part,
  often named like its dish, read as the dish logged twice. Deleting a dish's last
  part retires the empty header with it.

### Groups (composite dishes)

A **group** is a dish or course within a meal, not the meal itself — a smoothie and its
ingredients, spaghetti with its noodles/sauce/cheese, or an appetizer/main/dessert logged
as siblings in one dinner. Meal buckets (Breakfast/Lunch/Dinner/Snacks, above) are the
coarse container a day's food falls into; a group is a finer subdivision inside one
bucket, and grouping never changes which bucket anything lands in.

A group is a NutriList row like any other — its own `uuid`, its own `mealTime`, present in
the same flat per-date array as everything else — but it carries `kind: 'group'` and every
nutrition field (`calories`, `protein`, `carbs`, `fat`, …) pinned to zero. Its members are
ordinary rows (`kind: 'item'`, the default) carrying `parentId` set to the group's id. A
group row never holds nutrition itself: day and meal totals sum every row in the flat
list, so the group's zero contributes nothing and each food is counted exactly once, on
its own member row.

The AI capture path (free text or photo) is the only producer of groups. When the parse
tags two or more items with the same `dish` name, the parser synthesizes one group entry
ahead of them and stamps that group's id onto each member's `parentId`; an item with no
`dish` stays standalone. A parse where nothing carries a `dish` produces an ordinary flat
list of items — grouping is additive, never a mode the rest of the pipeline branches on.

Today's log remembers a group's expansion in session storage, showing a rolled-up calorie total
computed by summing its members at read time (never a stored value on the group row
itself); tapping it expands the row to show its members indented beneath it. A member
whose `parentId` doesn't resolve to any row on the day — a deleted or otherwise missing
parent — still renders as its own top-level row rather than disappearing: no logged food
is ever hidden for having a broken group link.

Editing a group, from its own edit sheet:

- **Rename** changes the group's own label.
- **Move to** another meal bucket cascades the same `mealTime` to every member
  server-side, so the whole dish moves together instead of leaving members behind in the
  old bucket — provided the group row itself carries a `date`. A group somehow missing one
  cascades to nothing, and the edit sheet surfaces a warning naming the stranded item count
  rather than closing as if the move fully succeeded.
- **Scale** (a coarser ×½/×¾/×1½/×2 set than a single item gets) scales every member's
  amount and nutrition; the group row itself has nothing to scale.
- **Delete** prompts first with a count ("Delete Spaghetti and its 3 items?"), then removes
  every member and, once all of them are confirmed gone, the group row itself.

### Photo persistence

A photo capture that produces at least one food item is persisted, not thrown away after
the AI call. `PhotoStore` (`__backend/src/1_adapters/persistence/PhotoStore.mjs`) writes the
original under the capturing user's own data tree —
`users/{userId}/lifelog/nutrition/photos/{photoRef}.jpg` — plus a best-effort
`{photoRef}.thumb.jpg` thumbnail (via `jimp`; a decode failure there is logged and
swallowed, never blocking the save). `photoRef` is a short opaque id (`ph_` + base62) minted
fresh per photo, written exclusively (a collision throws rather than silently overwriting).

**Where the ref lands.** A grouped (multi-dish) parse stamps `photoRef` on each synthesized
GROUP row, not on its members — one photo can produce two sibling groups (two plates in
one frame) plus a standalone item, and all three top-level rows share the same ref. A
single ungrouped item gets the ref directly. A group's members never carry their own
`photoRef`; the row above them already does.

**Failure posture.** Photo persistence can never block food logging. A `PhotoStore`
failure (disk error, an undecodable buffer, no store configured at all) is caught, logged
as a warning, and the entry is saved exactly as if no photo had been supplied — no
`photoRef`, nothing else different.

**Serving.** `GET /nutrition/photos/:photoRef` streams the file back, resolved through the
same `PhotoStore`. An optional `?size=thumb` query param serves the 320px thumbnail
variant, falling back to the original photo when no thumbnail file exists on disk (the
same jimp failure at capture time that can skip writing one); rows in the day log request
this variant, so a missing thumbnail file never breaks the row's image, only its size. The
route always resolves the photo under the household's own user —
there is no `userId` query parameter, deliberately: this program is single-user, nothing
sends one, and honoring a client-supplied value would let it point the containment check
at an attacker-chosen base directory. `photoRef` is checked against a strict `ph_`+base62
allowlist before it touches any path, and the resolved path is independently confirmed to
stay inside the user's photo directory after the join. Content-Type is always set
explicitly to `image/jpeg` (plus `X-Content-Type-Options: nosniff`) from the fixed
`.jpg`/`.thumb.jpg` naming PhotoStore always writes — never taken from the client, and
never left to Express's extension-sniffing to get right on its own. `save()` does not
inspect magic bytes, so "the stored file is actually a JPEG" is an assumption the fixed
extension makes true in practice, not something enforced at write time.

**Retention.** Photos are kept indefinitely alongside the log — there is no deletion path
and no garbage collection. A photo may be referenced by more than one entry, so deleting a
log entry never deletes its photo file.

### Food icons

Every log row carries a picture of the food where one has been chosen. The pictures
themselves live on the media mount; **which slug points at which file is decided by one
hand-reviewed manifest and nowhere else** —
`data/household/apps/health/icon-manifest.yml`, read by `IconManifestStore`
(`__backend/src/1_adapters/persistence/IconManifestStore.mjs`). No filename appears in code,
in a stylesheet, or in a response body: a client only ever holds a slug.

```yaml
icons:                       # the OFFERED vocabulary
  carrot: { path: img/nutrition/icons/vegetables/carrot.png }
aliases:                     # resolvable, never offered
  honest-old-name: { path: img/nutrition/icons/category/equivalent.png }
```

**Two maps, because there are two audiences.** `icons` is what the capture agent may
choose from and what the edit sheet's picker lists. `aliases` keep reviewed alternate
names requestable without offering them as new choices. **The hi-res set is the only
set.** Every entry points under `img/nutrition/icons/`; the retired 20 px flat set
(`img/icons/food/`) is never served: `IconManifestStore` drops any entry pointing there
at load (`health.icons.manifest.retired_art_dropped`), and `curate-nutrition-icons.mjs`
never proposes one. A legacy basename survives only as an alias to an honest hi-res
equivalent. With no manifest installed the capture vocabulary is just `default`; the flat
directory is never read as a fallback. Rows and catalog entries that still held retired
names are re-iconed by food name (reviewed table → offered slug or `default`) with
`cli/health-scan-repair.cli.mjs`; a stored alias becomes the offered slug that shares its
file, or stays as it is.

`foodNames:` maps a normalized food name to an offered slug and is consulted before any
model answer (`confineIcon`). It is merged, reviewed, with
`cli/health-icon-manifest-merge.cli.mjs`; the backend reads the manifest once, so a
restart is needed after a merge.

**Renames happen in the manifest, never by moving files.** Correcting a food's picture
means editing the path a slug points at. The draft is regenerated by
`cli/curate-nutrition-icons.mjs`, which recurses the icon tree, skips Dropbox's
`(Case Conflict)` **directories** (they duplicate their properly-named twins) along with
per-directory contact sheets, slugifies basenames, and resolves cross-directory slug
collisions deterministically — shallower path wins, ties break lexicographically — printing
every loser. The draft is reviewed by hand and installed; only the script is versioned, so
the manifest has exactly one home.

**The agent cannot invent a name.** The composition root builds the capture prompt's
vocabulary from the manifest's offered slugs, and all three mappers that turn a model
response into rows — text, image, UPC and the revision re-parse — CONFINE the model's answer to
that vocabulary (`__backend/src/2_domains/nutrition/services/icons.mjs`). A slug that is not
in the vocabulary becomes `default`, the neutral sentinel, rather than a stored name that
404s forever afterwards.

**`default` is not a picture.** It resolves to a real file so nothing renders broken, but
it means "nobody chose one". The UI treats it as no icon and shows a neutral food symbol;
the catalog never accepts it as a food's icon, because donating it would pin that food to
the fallback glyph and block every real icon proposed afterwards.

**The icon sticks to the food, not to the row.** `FoodCatalogEntry.icon` is filled by the
first capture that names one and is **never overwritten by a later capture** — "always for
this food" is a human choice that has to outlive the next time that food is logged. A
quick-add copies the catalog's icon onto the row it writes. Explicit pins also persist
as `iconOverride`, separately from inferred artwork, and every presented catalog entry
carries both: `icon` is the picture, `iconOverride` says a person chose it. The same slug
in both fields is a pin; a slug with a null override is a guess the first capture supplied. A legacy `default` catalog value
cannot mask suitable capture artwork. A catalog icon — learned or pinned — reaches a new
row only when the manifest OFFERS it (`FoodCatalogService` `iconOffered`); a retired name
on an old catalog entry never outranks the capture's own icon, and `setIcon` refuses a
non-offered slug (`400 ICON_NOT_OFFERED`). Reviewed manifest aliases and observed mismatch
guards reject misleading art (such as diced ham → cheeseburger); absent suitable assets,
the neutral symbol is intentional. A group shows its own photo or artwork, not both.
Artwork that cannot be shown is not left that way: see the
[artwork remediation queue](nutrition-cleanup.md#artwork-remediation-queue).

**Override, and its two scopes.** The edit sheet's picker writes nothing when a picture is
tapped; it asks first. *Just this entry* PUTs `icon` on the row alone. *Always for this
food* pins the catalog entry **and** corrects the row on screen — a row's icon is a copy
taken at log time, so pinning the catalog alone would leave the row the user is looking at
unchanged. **Rows logged in the past keep the picture they were logged with**; the pinned
icon applies to this row and to everything logged afterwards. A group row is offered the
per-entry scope only: a dish name is a label the parse invented, not a catalog food.

**Serving.** `GET /nutrition/icons/:slug` streams the file. The slug is user-controllable
and reaches the filesystem, so it is gated the way `photoRef` is: a strict allowlist
(`^[a-z0-9][a-z0-9_-]*$`) at the HTTP boundary *before* the store sees it, and again inside
the store. Critically the slug is **never concatenated onto a path** — it can only select a
manifest entry — and the entry's own path is then validated independently (no absolute
paths, no `..` segments, a closed extension allowlist) and containment-checked after the
join. `..`, encoded traversal and absolute paths are simply not slugs.

Containment is checked on the **real** path, not the lexical one: `path.resolve` collapses
`..` but knows nothing about symlinks, so a link planted inside the media root pointing
outside it used to pass and content from outside the root was served (found in review,
through both a symlinked file and a symlinked directory). Both ends are realpath'd before
comparison, which also subsumes the existence check — a dangling link reads as a miss. A
symlink that stays inside the root is still served; the rule is containment, not a ban on
links. **The honest limit:** that hole required write access to the media mount, which no
request can obtain. These checks defend against a hostile manifest entry and a hostile
slug; nothing here defends against someone who can already write into the media tree.

Content-Type comes
from the manifest entry's extension with `nosniff`; the cache is a year and `immutable`,
since a slug's bytes never change (a correction repoints the slug). A miss — unknown slug,
no manifest installed, or a file that is not there — is a 404, and the row falls back to
the dot.

**Never the source file.** The hi-res art averages ~3 MB per PNG (median 3.0 MB; 528 of
the 534 offered icons exceed 1 MB, largest 6.7 MB) while a row renders one at 24 CSS px and
the picker shows up to 60 at 40 CSS px. Serving the sources verbatim would cost tens of
megabytes for one day's log and well over a hundred for one open picker, so every request
serves a **96 px** downscale — enough for both consumers at 2× device pixel ratio.
Derivatives are generated once with `jimp` and cached on disk under the **data** mount at
`data/household/apps/health/icon-cache/`, never written back into `media/`, which is
Dropbox-synced and read-only as far as this app is concerned. Measured on the installed
manifest: five representative icons totalling 13.4 MB serve as 44 KB; a full warm cache is
~12 KB per icon.

**Cache keying.** The filename is `{slug}.{hash}.png`, where the hash covers the resolved
source path, its size and its **mtime**. Repointing a slug in the manifest — or editing the
file under it — therefore produces a new key rather than serving stale art from behind the
year-long immutable header. Superseded entries are orphaned; at ~12 KB each, nothing sweeps
them.

**Rendering is bounded, because it is loop-bound work.** `jimp` is pure JavaScript: one
render is ~250–500 ms of *synchronous* CPU on the event loop. The picker asks for 60 icons
at once, and before this was bounded, 60 cold renders took 16.3 s wall and dragged an
unrelated lightweight endpoint from 2.1 ms to 3.35 s — the whole backend, since school,
media and fitness share that loop. Three things bound it now:

- **One render at a time.** Raising the limit buys no parallelism (there is one loop) and
  only lets more synchronous work queue back-to-back.
- **A yield between renders**, so everything queued behind one gets a turn before the next
  seizes the loop. Without it the gate merely reorders one long stall.
- **In-flight de-duplication**, keyed by cache path: N simultaneous requests for the same
  icon share one decode.

Measured after: the unrelated endpoint's worst case fell from 3,353 ms to 540 ms and its
p95 from 3,353 ms to 262 ms. The burst's own wall time is unchanged — the CPU cost is the
same however it is spread — which is why the cache is also **pre-warmed**.

**Pre-warming.** The composition root kicks off `warmCache()` once at boot,
fire-and-forget: it renders every offered icon that is not already cached, one at a time,
pausing between each for roughly a 50 % duty cycle, giving up on a budget, swallowing every
error. Nothing waits for it; it exists so the picker never discovers a cold cache. It
matters because the cache key includes source mtime — a Dropbox re-sync that only touches
timestamps invalidates all 534 at once and re-arms exactly that herd. Warm versus cold, 60
concurrent requests: **13.14 s → 0.01 s** (2,074×), and over HTTP a warm picker is 0.21 s
wall with the unrelated endpoint unaffected at 9 ms.

**When rendering is impossible, large sources are REFUSED, not shipped.** Falling back to
the original looked like the safe choice — an icon is decoration, so serve something — and
it is not: it silently re-creates the multi-megabyte payload the renderer exists to
prevent. Observed for real during this work: an ACL on the data mount made the cache
unwritable and 124 consecutive renders each quietly served their source, one of them
6.7 MB, announced only by a `warn` among 124 identical ones. So a source over **64 KB** is
now refused with a `health.icons.render.unavailable` **error** naming the reason and the
size, and the row shows its neutral dot. Smaller sources (including any deliberately
retained legacy aliases) are still served unrendered when only hi-res rendering is
affected. A missing picture is a far smaller harm than a 3 MB one, and it is loud.

**When the file is not there.** A Dropbox conflicted copy once emptied a media directory
while leaving it in place, and the illustrations 404'd in production with nothing logging
an error anywhere. The only thing that could catch it was a test asserting every basename
the code can name exists as a file. `IconManifestStore.media.test.mjs` is that test for
this vocabulary: it walks the INSTALLED manifest against the REAL media mount and fails if
any slug — offered or alias — names a file that is not there. Where the mount is
unavailable it skips **visibly**, never passing on nothing.

### Barcode → unknown UPC → custom food

`BarcodeCapture` decodes through the shared `useBarcodeScanner` hook
(`frontend/src/lib/camera/`): the native `BarcodeDetector` API, falling back to a lazily
loaded `@zxing/browser`, both limited to retail formats. The scanner is full screen
(`Sheet placement="fullscreen"`), like a barcode app: the camera fills the screen with
`object-fit: cover` (cropped, never squashed), an aiming box sits in the middle, and the
close button floats at the top. It always offers a
manual-UPC text field along the bottom as the same submit path (and the deterministic test seam). A decode calls `nutrition.submit('barcode', upc)`:

- **Known UPC** (catalog or gateway hit) — proceeds through the portion-pick path above.
- **Unknown UPC** (`result.unknownUpc === true`) — opens `CustomFoodSheet` with that UPC.

`CustomFoodSheet.save()` does two calls: `POST /nutrition/catalog { name, calories,
protein, carbs, fat, barcodeUpc }` (creates a `FoodCatalogEntry` with `source: 'custom'`,
mapped to the UPC), then `POST /nutrition/catalog/quickadd` to log it immediately —
deterministic, no review step.

**Catalog-first UPC resolution.** `LogFoodFromUPC` checks `catalogService.getByUpc(upc,
userId)` (`FoodCatalogEntry.barcodeUpc` index) **before** calling the external product
gateway — a user's custom mapping wins and can override bad upstream data. Rescanning the
same UPC after creating a custom food resolves from the catalog with no gateway round trip
and no "unknown" sheet. A UPC that still misses both the catalog and the gateway returns
`{ success: false, unknownUpc: true, upc }`.

### Barcode intake gate, quarantine and label data

Every UPC path — kitchen relay, Health web camera/manual field, Telegram, and
`/api/v1/nutribot/upc` — runs `LogFoodFromUPC`, which checks the code's shape before any
lookup (`parseGtin`, `__backend/src/2_domains/nutrition/services/gtin.mjs`):

- GTIN-8/12/13/14 with a valid mod-10 check digit. UPC-E (8 digits, as phone cameras
  return it) is expanded to UPC-A; an 11-digit UPC-A missing its leading zero is padded —
  each only when the result validates.
- Two reads glued together (`XX`, a held trigger) collapse to one.
- 13-digit `978`/`979` codes are books from the shared reader, never food.
- A refusal throws `InvalidInputError` `NUTRIBOT_UPC_REJECTED` with a readable reason.
  The relay logs `barcode.nutribot.rejected`, Telegram replies one line, the web shows it
  as a capture notice (`rejected-barcode`), the HTTP route answers 400.

The relay also drops the **same code from the same reader within 30 s** of an accepted
scan (`barcode.nutribot.repeat`, `ScanIngressCoordinator.handleProduct`); a failed lookup
releases the window so a rescan works. A deliberate second serving is a portion edit.

**Quarantine.** A product whose calories are unknown is not a food the budget can count.
It is saved as a **pending** log stamped `metadata.quarantined: true`
(`quarantineReason: 'no-calories'`) and never accepted into the ledger by capture, replay,
`FoodLogReview.recover`, the Telegram report's auto-accept or ConfirmAllPending, and it
does not hold back reports. It shows in Needs Review ("Calories need review"); confirming
it requires calories and clears the marker. The web reports it as `needs-review`.

**No calories, no per-100 basis: estimate before quarantining.** The classifier call that
already picks the icon and Noom colour is asked, for such a product, whether it is food at
all (`isFood`) and for one typical serving's `estimate: { servingGrams, calories, protein,
carbs, fat }`. **Every number on the row shares one basis:** when the label names a
measurable serving (`30 g`, `240 ml`) the model is asked for exactly that serving, the label's
own values stay as facts and the estimate only fills what is missing; when it does not, the
estimate is for a typical serving of the model's stated mass, and label-only values (which
describe a serving of unknown mass) are dropped — null, no provenance, listed in
`nutritionLookup.droppedLabelNutrients`; a rejected mass logs "1 serving", never a gram mass
the numbers do not describe (`aiEstimateBasis: 'label-serving' | 'typical-serving'`). Food with
calories a finite number in 0–2000 is logged as an **unconfirmed AI estimate** instead of
quarantined: `nutrientProvenance` `{ source: 'ai' }` on the estimated nutrients only,
`nutritionLookup.aiEstimate: true` (plus `servingEstimate` when the mass is usable: ≤ 500 g
and ≤ the package), `captureEvidence.assumption: 'ai-nutrition-estimate'`, the usual
provisional review, and it never seeds the catalog's UPC entry. The result carries
`aiEstimate: true` and Health says "No calories on the label — estimated for one serving.
Check the row." Not food (a magazine), or no usable number: quarantine as below.
Logs `upc.nutrition.estimated` / `upc.nutrition.estimateRejected`.

**Label data** (`normalizeProductNutrition`): a gram figure printed on the label ("1/4 cup
(28 g)") beats Open Food Facts' `ml` unit guess; real volumes (ml, cl, L, fl oz, gallon,
quart, pint — in the pack size or the serving text) stay volumes. With no usable serving
but per-100 values, the capture logs 100 g/ml so known values (a diet soda's 0 kcal)
stay known (`servingFallback: 'per100'`); for a gram fallback the classifier also estimates
the label serving's mass ("2 tbsp") — or, when the label gives no serving text at all, the
mass of one typical serving (shredded cheese ≈ 28 g, not 100 g = 393 kcal) — accepted only
up to 500 g and the pack mass, recorded as `servingEstimate: { source: 'ai' }` on an
unconfirmed row. The gateway no longer stamps
an icon, so the classifier's manifest slug is used; barcodespider's "image coming soon"
placeholder is refused by content hash (`upc.image.placeholder`); product names are
normalized once at ingest (`shared/contracts/health/productName.mjs`: shouting words
title-cased, brand casing and short acronyms kept).

---

## Unsettled vs. settled

Every nutrition-log row carries two independent axes. `status` decides whether the row
exists and counts toward the day's calories — `accepted` counts, `pending`/`rejected`/
`deleted` don't (see [the budget equation](#the-budget-equation--one-server-side-home)
above). `settled` decides whether a person has ratified the machine's estimate; it never
affects whether a row counts.

`rejected` is reachable from exactly **one** path: a fresh kitchen-scale placement
superseding an earlier scale prompt nobody ever answered. Untouched means untouched — no
container picked, no density picked — and the supersede deletes that prompt's message along
with it. A prompt the person engaged with is left entirely alone, however stale. No user
action produces the value: discarding a row marks it `deleted`, not `rejected`. It stays in
the `status` enum because rows already carry it.

A row reads as **settled** when `settled` is `true`, or when the field is **absent** — no
write path ever defaults it in, so a row with no `settled` key at all (every row that
predates this tracking) reads as already-ratified with no backfill needed. A row reads as
**unsettled** only when `settled` is explicitly `false`, which is the state every AI
capture is stamped into the moment it's parsed (see [Capture funnels](#capture-funnels)
above).

New captures now carry an exact 72-hour `review` deadline. A deterministic worker
persists `settled: true, settledBy: auto` after that deadline, including after
downtime; totals do not change and no message is sent. Legacy rows without a
`review` record retain their older read-time date-only behavior. See
[Nutrition cleanup](nutrition-cleanup.md) for the current capture, reconciliation,
notification and recovery contracts; older prompt-flow descriptions above describe
the legacy implementation.

A person confirms a provisional row with its optional one-tap Confirm button.
That sends an explicit `{ settled: true }` versioned command. A group confirms
only the root and exact displayed children, atomically. Ordinary `PUT` edits and
AI revisions do not confirm; they preserve the deadline and protect only the
fields actually corrected. A **quick-add** remains confirmed at creation because
picking a known food off the suggestion list is an explicit logging choice.

---

## Custom foods and favorites

A `FoodCatalogEntry` (`__backend/src/2_domains/health/entities/FoodCatalogEntry.mjs`) carries
`id, name, normalizedName, nutrients{calories,protein,carbs,fat}, source, barcodeUpc,
useCount, usageByBucket, favorite, icon, lastUsed, createdAt`. `icon` is a manifest slug or
null — see [Food icons](#food-icons). `usageByBucket` is per-meal-bucket history —
see [the quick-add ranking](#the-ranking) — and defaults to `{}`, never null. `source` is `'manual' | 'nutritionix' | 'custom'`
depending on origin; entries created via `createCustom` (the barcode-mapping flow, or any
direct `POST /nutrition/catalog`) are always `source: 'custom'`. `favorite` is a persisted
boolean, toggled from `EntryEditSheet`'s star button via `PUT /nutrition/catalog/favorite {
id?, name?, favorite }` (resolves by id or by normalized name), and is the top sort key in
`suggest()`. Entries carrying `foodId` read current state with
`GET /nutrition/catalog/:id` and always toggle by ID. Name fallback is for legacy
entries without that identity; the historical display name is not a catalog key
after a rename. The catalog lives at `lifelog/nutrition/food_catalog.yml` per user — the
pre-existing nutribot path, not a new `apps/health/` file, since quick-add and Telegram
logging already read from it.

---

## Meal templates

A **template** is a named set of component foods, each marked **core** (always there) or
**variant** (rotates). Instantiating one drops a *dish group* into a bucket: one
`kind: 'group'` header plus the core components as `parentId` children, plus whichever
variants were toggled on. The picker (`TemplatePicker`, opened from the combobox's
"Meals & templates ▸" link) is the **only** surface that lists kept meals.

**The group header carries zero nutrition.** Rollups are computed on read, so a header that
also held the meal's calories would make every bucket count the meal twice. Every fold in
the app — the equation, the macro bars, the per-meal subtotals, the footer — sums the flat
row list through `shared/contracts/nutrition/countedRows.mjs`, and the header contributes
nothing to it.

Template rows are born `settled: true, settledBy: 'user'`: picking a template is a
deliberate human choice, not a machine estimate. `settled` is written **verbatim** on every
row — an absent `settled` means "legacy row, treat as settled", so a default anywhere on
this path would change what every pre-existing row means.

Components are **snapshots**, exactly as saved meals were: a later catalog edit never
reaches back into a template, and never retroactively changes anything logged from one.

**Micros travel with them.** A component carries `fiber/sugar/sodium/cholesterol` and
`microsSource` under the same rules as everywhere else — *per key* (an unmeasured key is not
written as a structural zero claiming to be a reading), *only from a provenanced source*,
and *provenance without numbers is not provenance*. So a template built from a scanned food
instantiates rows that still report **covered**: logging a meal from a template is never
less rich than logging its foods one at a time. The group header carries none of it and is
excluded from both sides of the coverage fraction, as every group header is.

### Creating one

- **"Save as meal"** on a logged entry's edit sheet — a one-component all-core template.
- **"Save as meal"** on a whole bucket, from `LogTable`'s per-bucket header action (today
  only) — prompts for a name, snapshots every row in that bucket, all core. Nothing here
  knows which parts rotate, and guessing would drop food out of the meal next time.
- **Approving a mined proposal** (below).

All three are `POST /nutrition/templates { name, icon?, components }`.

### Logging one

`POST /nutrition/templates/:id/instantiate { date?, mealTime?, variantNames? }` →
`{ groupUuid, items }`. `date` defaults to the **local** day and `mealTime` to the clock;
an unknown name in `variantNames` selects nothing rather than inventing a component. Core
is never optional — omitting it from `variantNames` cannot drop it. A selection that would
write nothing at all (an all-variant template with nothing toggled) is refused with
`400 { code: 'TEMPLATE_NO_COMPONENTS' }` rather than filed as a lone empty group; the
picker's Log button is dead until something is chosen. The template's
`useCount`/`lastUsed` bump on each instantiation.

A template with no variants logs on the first tap: there is no decision in it, so there is
no step asking for one. A template with variants shows its toggles first, and the Log
button states the kcal the current selection adds up to.

### Mining — proposals, never auto-created templates

`TemplateMiner` (pure, `2_domains/nutrition/services/`, takes `today` as an argument
because the domain layer forbids an ambient clock) reads a rolling window of day-log rows
and returns proposals. `TemplateCurationJob` runs it weekly (Sundays 04:10) and files the
results with `status: 'proposed'`.

| Parameter | Value | Meaning |
|---|---|---|
| window | **90 days** | rows older than this contribute nothing |
| occurrence | same `parentId`, else same bucket **on the same day** | one eating event |
| threshold | **≥ 6 occurrences** | how often a combo must have happened |
| core | present in **≥ 70 %** of the combo's occurrences | always logged |
| variant | present in **20–70 %** | offered as a toggle |
| dropped | below **20 %** | omitted entirely |
| minimum core | **2 components** | a one-item "combo" is just a frequent food |

Every food occurring at least six times **anchors** a candidate: the occurrences containing
it *are* the combo's occurrences, and the presence rates are measured against them. Two
anchors inside one stack land on the same core set, so candidates dedup themselves without
a clustering pass.

A component's numbers are the **most recent portion actually logged** for that food, never
an average — an averaged portion is one nobody ate. The suggested name is the dominant
bucket plus the highest-presence, then most substantial, core food ("Morning oatmeal").

**Identity is the sorted, normalized CORE names** — variants are excluded, so a smoothie
whose fruit rotates stays one combo, and a dismissal keeps matching it. Dedup is against
the keys of existing templates, of live proposals, and of the permanent dismissal ledger,
plus against the names already in the picker.

`POST /nutrition/templates/:id/approve { name? }` turns a proposal into a template;
`POST /nutrition/templates/:id/dismiss` deletes it and records its key **forever**, so it
can never be proposed again. Nothing is auto-created without approval.

The job is **safe to re-run**: a key already held by a template, a live proposal, or the
dismissal ledger is skipped, so a second run over the same history is a no-op. (This is
explicitly *unlike* `POST /nutrition/catalog/backfill`, which increments a usage counter
per row per run and is a one-shot seeding tool.)

### Suggestions

`GET /nutrition/catalog/suggest` merges templates into the combobox list per **favorites →
templates → the rest**. Every entry carries `type: 'food' | 'template'`; a template also
carries `itemCount`, `variantCount` and its core `calories`, and renders with the item
count as a non-colour cue. Picking one opens the picker on that template so its variants
are still offered, rather than logging one silent arrangement of the meal. The
zero-keystroke list shows at most **three** templates; a typed query shows every match.

## Saved meals — compatibility only

The old saved-meal endpoints remain for existing integrations. Today no longer
creates temporary saved meals to copy food: `POST /nutrition/copy` accepts
entry IDs, destination date/bucket, and an operation ID, then copies complete
snapshots in one ledger command. Children retain their hierarchy under new IDs;
mass, micronutrients, provenance, icons and evidence references travel with them.

Kept meals are templates. Existing saved meals can be migrated with
`ops:retired/cli/migrate-saved-meals-to-templates.mjs` using its dry-run option first.

---

## Medical readings

`MedicalReadingsService` validates records against
`shared/contracts/health/medicalMetrics.mjs`: supported metrics, allowed
units, finite values, real dates, and paired systolic/diastolic values.
No medical interpretation is performed. Each history row displays its own unit;
the app never relabels an older reading with the newest reading's unit.

Endpoints remain `GET/POST /medical` and `DELETE /medical/:id`.
There is no medical update endpoint; correction is delete then add.
Failures remain visible rather than appearing as empty history.

---

## Coach `log_food`

`__app_modules/wellness/health/server/application/agents/health-coach/tools/NutritionActionToolFactory.mjs`
registers `log_food` — the coach's only write path into nutrition. It takes `{ userId,
description }` and calls the identical text pipeline the web combobox's sentence path
uses (`nutritionInput.process({ type: 'text', content: description, userId })` —
`nutritionInput` is `WebNutribotAdapter`). It reaches `handleText`, which means it goes
through the same auto-commit seam as every other transport: **the coach's entries are
logged immediately as `accepted` + `settled: false`**, with no separate acceptance gate
for this transport — it behaves exactly like a typed sentence submitted from the combobox.
Its entries get no capture toast or day buttons in Today; "move that to yesterday" in the
day input corrects the latest one. It returns
`{ status: 'logged', summary }` (`summary` is the parsed itemization's first response line,
e.g. "🟡 2 eggs — 140 kcal"), which lets the model tell the user what landed; the user
reviews or undoes it in the app.

---

## Goals

`__app_modules/wellness/health/server/domain/health/services/BudgetMath.mjs` — pure, no IO, no clock — implements
Mifflin-St Jeor:

```
BMR  = 10·kg + 6.25·cm − 5·age + (male: +5 | female: −161)
TDEE = maintenanceKcal ?? (BMR × activityBaseline)
budget = round(TDEE − weeklyRateLbs × 3500 / 7)
budget = max(budget, round(budgetFloor))
```

Non-finite numeric inputs or an unrecognized `sex` throw `INVALID_BUDGET_INPUT` — no
coercion. The floor is a hard bound: a weekly-rate deficit steep enough to undercut it is
clamped rather than silently starving the number.

A goals document (`apps/health/goals.yml`, `GET`/`PUT /api/v1/health/goals`) holds:

| Field | Feeds |
|---|---|
| `sex` | BMR offset |
| `heightIn` | BMR |
| `birthYear` | `ageYears` (computed at request time from the current year, not stored) |
| `activityBaseline` | TDEE multiplier (ignored while `maintenanceKcal` is set) |
| `maintenanceKcal` | optional fixed break-even — replaces `BMR × activityBaseline` outright, for when the formula disagrees with what the scale does. Absent = formula. Edited as "Break even" on the Progress goals sheet |
| `weeklyRateLbs` | the deficit subtracted from TDEE |
| `budgetFloor` | the hard minimum |
| `targetWeightLbs` | the Progress weight chart's goal line; also zeroes the deficit once reached, and with `targetDate` solves the deficit (`solveDailyDeficit`) |
| `macroGoals` | **display only** — `{ proteinG, carbsG, fatG }`, grams, each a number or `null`. `null` is a *cleared* target, not a zero one: a macro with no target draws no bar. Optional; a document without the key is valid and is never backfilled |
| `watchMicros` | **display only** — a list of `{ key, limit, direction }`, where `key` is one of `fiber`/`sugar`/`sodium`/`cholesterol`, `limit` is a positive number in that micro's stored unit (g for fiber and sugar, mg for sodium and cholesterol), and `direction` is `'ceiling'` (stay under) or `'floor'` (reach). One entry per key. Optional, on the same absent-stays-absent terms |

Weight itself is never part of the goals document — `getBudget` reads the latest
adjusted-average weight from weight history, so the number the equation uses moves with
every new weigh-in without the user touching goals at all.

**Exercise credit.** A day's logged workout sessions (`getWorkoutsForDate`) sum their
`calories` and add straight into `remaining = budget − food + exercise` — an active day
raises the ceiling rather than lowering `food`, matching LoseIt's exercise-as-credit model.
The `sessions` array returned alongside the equation is what the Today view's "Exercise"
section (read-only rows, `LogTable.jsx`) renders.

`ProgressView.jsx` is the goals-editing surface — a form seeded from `GET /goals`, `PUT
/goals` on save — alongside the calendar-spaced weight-trend chart and a 14-day logged-intake strip
built from one `/budget/range` request. An absent goals document opens an initial
form; a failed request shows Retry. Its macro-goal and watch-micro fields build their
payload through `progress/goalFields.js`, which enforces the same absence rules the server
does: clearing every macro target removes `macroGoals` outright, and clearing a watch
micro's limit removes that watch (there is no "watched with no limit" state).

---

## Scale measurements

Every raw kitchen-scale signal — a settled weight, a scanned caloric-density level, a
scanned container tare, a scanned barcode — is a durable row in the OBSERVATION ledger
(`users/{id}/lifelog/nutrition/observations.yml`, plus monthly archives). Those rows are
what the automatic scale path composes food-log entries from; the day view is where a
person sees and corrects them.

- **Unmatched signals appear in the Today follow-up tray** — counted on its one line
  ("1 scale reading"), listed in its sheet when it is tapped ("82 g on the kitchen scale at
  18:04"), each with a **Dismiss** action. Nothing in the automatic path resolves a signal
  that aged out of the 900 s composition window, and an unresolved row is never archived —
  so dismissing is also what keeps the ledger's hot file, which sits on the scale's own
  frame path, from growing without bound.
- **An entry backed by a measurement shows it** — `82 g · scale ✓` next to the row. One
  entry can carry several observations (a placement appends a new weight row per ≥5 g
  change, plus a container and a density), so the badge reports the LATEST weight.
- **The edit sheet's Measurements section attaches** a measurement to the entry being
  edited. Dismissed measurements are not offered. The entry's grams are recomputed from the
  measurement's own net weight (gross minus a scanned container's tare, via the same domain
  arithmetic the automatic path uses); calories are recomputed too, but ONLY when a density
  scan is part of the evidence — without a measured kcal/g the grams are corrected and the
  calories are left as the person entered them.

**A measurement is a PLACEMENT, and it moves whole.** A weight, the container it sat in and
the density card that described it are one piece of evidence; attaching any of them attaches
all of them (its open siblings on the same scale inside the same 900 s window, or — for a
measurement that already backs an entry — that entry's whole evidence set). An entry is
never recomputed from a fragment, so it can never show an untared gross with no calories
under a "measured" badge.

**Moving a measurement that still backs a living entry is refused.** Its numbers came from
this placement; move it away and either that entry keeps numbers nothing measured (and the
day counts the food twice) or the app silently rewrites an entry the person did not name.
There is no third option that invents nothing. So the app answers `409` naming the entry and
its calories — *"delete or correct “Soup” first, then attach the measurement here"* — and
writes nothing. Once that entry is gone the same action succeeds. Attaching an UNMATCHED
measurement is unaffected: an open row backs nothing.

**A dish header is never a target.** A group row ("Curry") carries zero nutrition by design —
its children hold the real values, which is what lets the day view sum every row and still
count each gram once. Attaching a measurement there would count the same food twice inside
one dish, so the edit sheet offers no Measurements section for a group and the API refuses it
(`409`, *"“Curry” is a dish, not an item … attach it to one of its items instead"*). A
measurement that another entry was already calculated from is likewise shown disabled, with
the reason, instead of offering a button that only refuses.

**A re-pair never certifies the entry.** The write goes through
`HealthOperations.updateNutritionItem` with `ratify: false`: correcting which meal a
measurement belongs to is not a review of that meal's calorie estimate, so an unreviewed row
keeps its `settled: false`, its "Unconfirmed" badge and its Confirm affordance.

A re-pair that would require rewriting the hot file and a monthly archive together is
REFUSED with a `409` and nothing written: the store writes one file atomically and has no
rollback across two, so a clean refusal is preferred over a half-repaired ledger. Act on
such rows one at a time.

---

## API surface

All under `/api/v1/health/`, from `__app_modules/wellness/health/server/api/routers/health.mjs`:

| Endpoint | Purpose |
|---|---|
| `GET /context` | resolved Health user identity |
| `GET /day?date=` | coherent ledger snapshot and budget, with revision |
| `POST /nutrition/copy`, `POST /nutrition/restore` | lossless copy and deletion Undo |
| `PUT /nutrition/catalog/:id` | update a future food definition, not history |
| `PUT /nutrition/templates/:id` | edit a future meal definition |
| `GET /budget?date=` | the equation, the day's macro/micro sums, and micro coverage (see above) |
| `GET /budget/range?from=&to=` | the same equation per day over an inclusive range, in one request — `{ days: [...] }`, a day that cannot be computed appearing as `{ date, error }` rather than failing the range. 62-day cap; a bad range is `400 { code: 'RANGE_INVALID' }` (see [Viz and layout](#viz-and-layout)) |
| `GET /goals`, `PUT /goals` | goals document; a malformed `macroGoals`/`watchMicros` shape is `400 { code: 'GOALS_INVALID' }` |
| `GET /nutrilist/:date`, `POST /nutrilist`, `PUT /nutrilist/:uuid`, `DELETE /nutrilist/:uuid` | day-log rows (legacy-parity NutriList CRUD) |
| `GET /nutrition/catalog?q=`, `GET /nutrition/catalog/recent` | plain catalog search/recents |
| `GET /nutrition/catalog/suggest?q=&bucket=&limit=` | ranked combobox suggestions; `bucket` makes the ranking per-meal (400 on a bucket outside the four) |
| `POST /nutrition/catalog/quickadd` | deterministic log from a catalog entry; body `{ catalogEntryId, mealTime? }`, 400 on a `mealTime` outside the four |
| `POST /nutrition/catalog` | create a custom food (optionally `barcodeUpc`-mapped) |
| `PUT /nutrition/catalog/favorite` | toggle favorite by id or name |
| `PUT /nutrition/catalog/icon` | pin a food's icon by id or name — the "always for this food" override; answers with the presented entry, `iconOverride` included, so the caller can read back what it set |
| `POST /nutrition/catalog/backfill` | seed the catalog from existing log history |
| `GET /nutrition/meals`, `POST /nutrition/meals`, `POST /nutrition/meals/:id/log`, `DELETE /nutrition/meals/:id` | legacy saved-meal compatibility; no surface lists them |
| `GET /nutrition/templates?includeProposed=` | meal templates; proposals are hidden unless asked for |
| `POST /nutrition/templates` | create a template (`{ name, icon?, components }`), 400 on an invalid shape |
| `POST /nutrition/templates/:id/instantiate` | log it as a dish group (`{ date?, mealTime?, variantNames? }`); 404 unknown, **409** for a proposal nobody approved, **400** for a selection that would write nothing |
| `POST /nutrition/templates/:id/approve` | turn a mined proposal into a template (`{ name? }`) |
| `POST /nutrition/templates/:id/dismiss` | refuse a proposal; its key is remembered forever |
| `DELETE /nutrition/templates/:id` | remove a template |
| `POST /nutrition/input` | unified capture entry point (`type: text\|image\|voice\|barcode`) |
| `POST /nutrition/day-input` | one day-level instruction in words: log, move or correct food ([contract](meal-commands.md#day-input-day-input)) |
| `POST /nutrition/foods-move` | move foods to another day and/or meal, all or none ([contract](meal-commands.md#moving-foods-foods-move)) |
| `POST /nutrition/meal-command`, `POST /nutrition/meal-undo` | atomic meal commands and their durable Undo ([contract](meal-commands.md)) |
| `POST /nutrition/callback` | resolve a capture's Undo/Edit/portion choice, or a scale-pending Accept/Discard |
| `GET /nutrition/pending?date=` | pending NutriLogs from every capture surface for a date (Health's NEEDS REVIEW banner) |
| `POST /nutrition/pending/:id/review` | save, confirm, or discard with `expectedVersion` and `operationId`; optional portion factor, item edits, date, meal, and nutrition-warning acknowledgement |
| `GET /nutrition/photos/:photoRef` | serve a captured photo (see [Photo persistence](#photo-persistence) below) |
| `GET /nutrition/icons` | the offered icon vocabulary for the picker (`?q=`, `?limit=`) — slugs only |
| `GET /nutrition/icons/:slug` | serve one food icon (see [Food icons](#food-icons) above) |
| `GET /nutrition/observations?date=` | the day's kitchen-scale signals (see [Scale measurements](#scale-measurements) below) |
| `POST /nutrition/observations/:id/pair` | attach a measurement to a log row (`{ entryUuid }`) and recompute that row |
| `POST /nutrition/observations/:id/dismiss` | resolve a measurement nobody is logging |
| `GET /medical`, `POST /medical`, `DELETE /medical/:id` | medical readings |
| `GET /dashboard` | aggregate summary (weight/nutrition/sessions/goals) consumed by `TodayView`'s coach-line footer |
| `GET /mentions/all` (separate router, `health-mentions.mjs`) | `@`-mention autocomplete for the coach chat composer (periods, recent days, metrics) |

---

## Optional messaging-surface synchronization

Health can confirm pending captures from any source. The original messaging
service is not required to complete that confirmation, and app confirmation
does not wait for report rendering or delivery.

`NutritionSurfaceSync` is a 15-second polling trigger, with no formatting or
transport code. It calls the same `NutritionReceiptPublisher` used by captures,
confirmations, portion choices, Undo and revision interactions. The publisher
loads the current authoritative ledger inside a serialized per-user queue and
passes a domain read model to `1_rendering/nutribot/NutritionReceiptRenderer`.
Accepted receipts never use the old parser's items. Group headings organize
children without adding consumption. Compact colored food lines use actual
stored grams; unknown mass stays a serving/volume, never fabricated grams.

New Telegram captures hand their known processing message to the publisher;
in-flight animations drain before handoff. Later weight/density evidence, Health
edits and guarded Mastra repairs edit that same message. ✅ means saved, not
user-confirmed. Internal evidence changes and silent 72-hour stabilization do
not alter receipt copy or controls. No automatic new headless receipts, daily
reports, repair announcements or settlement reminders are generated here.
Explicit report commands remain separate from capture receipts. Health's
visible-tab 15-second polling, focus refresh and mutation invalidation read the
same ledger, without Telegram logic in `HealthApp.jsx`.

Delivery fingerprints are persisted separately in
`users/{userId}/lifelog/nutrition/surface-sync.yml` (schema 2). Each receipt owns
a durable text/photo message binding, interaction state and fingerprint of its
rendered text AND controls. Binding intent persists before delivery; successful
edits are acknowledged afterward. Known-message edits retry after failure or
restart; Telegram's "not modified" response counts as success. Uncertain sends
are not repeated as new messages. Deleted/uneditable receipts are recorded as
unavailable, never silently replaced. Telegram delivery never rolls back food.
Unchanged store revisions skip archive reads; metadata-only changes do not edit
messages. First attachment/migration establishes a quiet history baseline.

Selective reformatting uses `POST /nutrition/receipts/reconcile` with 1–20 exact
`logIds`. `dryRun` defaults true and returns rendered previews/fingerprints.
Applying requires `dryRun:false` and `expectedFingerprints:{logId:fingerprint}`;
all selected previews are checked before any edit. A changed preview returns
409, an unknown/unlinked receipt 404, and unavailable messaging 503. Inspect
each result's `delivery` status; retry is not reported as delivered. This endpoint
never modifies food records or rewrites unselected history. Relevant events:
`nutrition.receipt.updated`, `.retry`, `.bind_retry`, `.interaction_retry`.

Hardware UPC scans persist headlessly; connected messaging delivery is a later,
optional projection. Web review and Telegram portion/confirm callbacks share
`FoodLogReview`: a durable intent precedes the idempotent ledger append, and
acceptance is marked only afterward. Retries resume the stored operation;
stale app edits fail with 409. Changing a request requires a new operation ID.
Telegram text revisions likewise read a fresh ledger snapshot and commit only
if every original entry version still matches. Stable IDs, groups, unknown
nutrients and existing Health placement survive; a failed revision cannot fall
through into a new food capture. Revision mode/cancel controls belong to the
receipt publisher and remain intact during background reviewer corrections.

Food-group and lifecycle fields round-trip through capture YAML. Group records
remain non-additive; Health renders totals from their children. Expand/collapse
is remembered by stable dish ID for the browser session. All artwork uses a fixed
24px slot with a neutral circle until decoded, or when missing/failed. Optional
reviewed name-to-slug overrides live in the icon manifest's `foodNames` map.

For the evidence-backed September 4 taco repair, use
`cli/health-group-repair.cli.mjs` to generate a dry-run manifest, then review it
before an offline apply with a new backup directory. The repair never changes
nutrition or portions. Historical shake nutrition still needs label verification.

## Related

- [`__docs/reference/nutrition/README.md`](../nutrition/README.md) — the fridge-scale/barcode
  scan pipeline that feeds the same NutriList log from the kitchen, independent of this app.
- [`__docs/reference/frontend/design-system.md`](../frontend/design-system.md) — the `@/lib/ui`
  primitives and pack theming this app is built on.

## Nutrition cleanup

Health Settings now includes an optional nutrition auditor, preview mode, shared
Health/Telegram questions, and conflict-safe repair history/Undo. See
[Nutrition cleanup](nutrition-cleanup.md) and the
[rollout runbook](../../runbooks/nutrition-cleanup-rollout.md). Automatic cleanup is
off by default; historical records are reference-only.

The auditor itself (what starts a run, the trigger/gap/cap gates, permissions,
the run journal, how its spend reaches the AI usage ledger) and the
`/health/auditor` page with the Health AI usage card are in
[Nutrition auditor](nutrition-auditor.md).

Meal interaction and command contracts: [Meal food commands](meal-commands.md).
