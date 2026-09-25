# Health budget as a range — design

**Status:** revision 2, 2026-09-24. Revision 1 was rejected in a stern review
(all findings adopted below). Awaiting review; next step after approval is an
implementation plan per phase.

## Why

The Today budget bar (`.health-budget`, `frontend/src/modules/Health/today/EquationStrip.jsx`)
shows a net fill against a single Goal line and a Break-even line. It is hard to read:

- There is no scale, so nothing can be read off the bar's length.
- The headline ("648 kcal left") is not a visible segment.
- The goal is a point, not a range.
- Exercise is drawn to the right of the net fill, cluttering the one edge that
  matters.

There is also a logging problem. Logs usually under-report, by about 40% even on
careful days, so a day logged at 600–800 kcal is almost certainly incomplete,
not a real deficit. The coach has praised "keeping intake down" on days that
were simply under-logged. One cause is in the code today:
`EndOfDayReport.mjs:87` declares the day complete at 20:00 local time.

## Goals

1. The bar is a **labelled ruler**: ticks, a goal **range**, break-even, and a
   single **frontier** (net calories) whose zone sets the colour.
2. Every headline number is a **drawn segment**.
3. The range floor is a **logging-completeness check** (food eaten). The range
   top is the **plan** (net against a daily deficit).
4. A day is trusted as complete only when it reaches the floor or is
   **explicitly declared** done or fasted. **Nothing infers completeness from
   the clock.**
5. **One source** for floor, top, zone and completeness, used by the Today bar,
   the week strip, the month block, every coach surface and Nutribot.

## Non-goals

- Correcting for under-reporting (e.g. a +40% factor).
- Meal-level fasting changing the floor, the zone or the bar. It is information
  for the coach only.
- Supporting weight gain: `weeklyRateLbs` must be > 0 (validation tightened).

## Phases

Each phase ships and deploys on its own, in this order.

| Phase | Delivers | Depends on |
|---|---|---|
| **1. Budget contract** | range, deficit solver, zone, completeness in `BudgetService`; shared zone function; one floor/top source | — |
| **2. Bar and charts** | Today bar, week strip, month block, drag preview | 1 |
| **3. Coach and reports** | every coach/report reader moves to the budget contract; clock inference removed | 1 |
| **4. Meal fasts** | closure record `meals`, web toggles, `/fast <meal>` | 3 |

---

## Phase 1 — Budget contract

### Settings

There are three sources for the same numbers today. They collapse into one:

| Today | Where | Becomes |
|---|---|---|
| `budgetFloor` (per-user health goals, default 1200) | `BudgetMath.mjs:30` | **the floor**, sole source |
| `nutrition.calories_min` / `calories_max` (per-user goals config) | `CoachingOrchestrator.mjs:74,216`, `EndOfDayReport.mjs:99`, `MorningBrief.mjs:705,732`, `WeeklyDigest`, `patterns.mjs`, `GenerateDailyReport`, `NutriBotConfig`/`NutribotRuntimeConfig`, `DataServiceHealthCoachWorkspaceRepository` | read from the budget contract (Phase 3) |
| `min_calories` (household coaching config, completeness threshold) | `dayCompleteness.mjs:11,33`, `bootstrap.mjs:2845`, `healthApi.mjs:113`, `snapshots.mjs:104` | the per-user floor, resolved **per call** (Phase 3) |

Not touched: the exercise-reaction `min_calories` at `app.mjs:3751`. It is a
different setting with the same name.

Per-user goals gain:

| Key | Meaning |
|---|---|
| `targetDate` (new, `YYYY-MM-DD`) | date to reach `targetWeightLbs` |
| `maxWeeklyRateLbs` (new, default 2) | cap on the solved rate |
| `weeklyRateLbs` (existing) | fallback rate; validation tightened to > 0 (`BudgetService.mjs:59`) |

**Migration** (a one-off CLI, dry run first): for each user, if `budgetFloor` is
unset, set it from `nutrition.calories_min`, else the household `min_calories`,
else leave it at 1200. `calories_min`/`calories_max`/`min_calories` stay in the
files until Phase 3 has moved every reader, then are removed in that phase.

### Deficit solver (`BudgetMath`)

Evaluated for the **computed day**, with that day's resolved weight (the weight
resolution `#budgetForDate` already does, `BudgetService.mjs:207-237`):

```
if weight ≤ targetWeightLbs:           deficit = 0                  source = 'at-target'
elif targetDate set and day < targetDate:
    deficit = (weight − targetWeightLbs) × 3500 ÷ daysBetween(day, targetDate)
    deficit = min(deficit, maxWeeklyRateLbs × 3500 ÷ 7)             source = 'target-date'
else:                                    deficit = weeklyRateLbs × 3500 ÷ 7   source = 'weekly-rate'
```

`3500 ÷ 7 = 500` kcal/day per lb/week, which is what the current code uses
(`BudgetMath.mjs:48`). Days are whole calendar days in the user's timezone.

**History.** Goals are applied as **current** to every day, matching today's
`goalBasis: 'current'` (`BudgetService.mjs:269`). Changing `targetDate` or
`targetWeightLbs` therefore recolours past days. This is intended and is stated
in the docs; `goalBasis` stays in the response so a UI can say so.

Days with no usable weight keep today's behaviour (`NO_WEIGHT_DATA`). Days
without goals keep `GOALS_NOT_CONFIGURED`.

### Zone and completeness — one shared function

`shared/contracts/health/budgetZone.mjs` exports a pure function used by
`BudgetService` **and** by the frontend drag preview (`portionPreview.js:18-20`,
which today recomputes `remaining`/`status` on its own):

```
zoneFor({ food, exercise, maintenance, range, declared }) → { zone, remaining, complete }
net = food − exercise            (may be negative)
complete = food ≥ range.floor || declared ∈ {done, fasting}
```

Zones are evaluated in this order:

| Zone | Condition | `remaining` (headline) |
|---|---|---|
| `past-even` | net > maintenance | net − maintenance |
| `over` | net > range.top | net − range.top |
| `in-range` | food ≥ floor | range.top − net |
| `declared` | food < floor, declared | range.top − net (no headline) |
| `incomplete` | food < floor, not declared | floor − food |

`over` and `past-even` win even on an incomplete day; `complete` still reports
the logging fact separately. With negative net and food ≥ floor, `remaining`
exceeds `range.top`. That is correct: that much really is left.

### Response fields (`/day`, `/budget`, `/budget/range`)

Added: `deficit`, `deficitSource`, `range {floor, top}` (top = max(floor,
maintenance − deficit)), `zone`, `complete`, `declared`, and `net` without the
`Math.max(0, …)` clamp.

Kept for compatibility, then retired once Phase 2 and 3 have moved every reader:
- `budget` = `range.top`
- `status` = `'over'` when zone ∈ {over, past-even}, else `'under'`

Readers of `status` today: `EquationStrip.jsx:92`, `dayBars.js:70,93`,
`MonthBlock.jsx:22,58`, `portionPreview.js`.

`remaining` **changes meaning** to the zone's headline value. Today's README
(124-178) defines it as `budget − food + exercise`. That section is rewritten,
and every reader of `remaining` is listed and moved in Phases 2 and 3.

`readDayStatus` keeps its wire field `minCalories` (now = the per-user floor),
because `DayCloseRow.jsx:50-53` reads it.

---

## Phase 2 — Bar and charts

The geometry is a new pure module, `today/budgetGeometry.js`, tested in a new
`budgetGeometry.test.js`. The existing `EquationStrip.geometry.test.js` (a
Playwright layout test of `health.scss`) is kept and extended. `BudgetBar` only
renders.

**Ruler.** It maps `[left, right]` onto the full track width:
- `left = −ceil250(exercise)` (0 with no exercise).
- `right = max(maintenance, food − exercise, range.top) × 1.12`.

On exercise days everything compresses slightly: **marks keep their values but
move in pixels**. Ticks every 250, numbered on 1,000s under 600 px wide and on
500s from 600 px. No tick within 12 px of a named mark.

**Named marks.**
- **Goal band** from `floor − exercise` to `top`, labelled once, e.g.
  "Goal 1,200–1,791". The left edge shifts because the floor measures food:
  `food ≥ floor ⇔ net ≥ floor − exercise`.
- **Break-even** line, "Break even 2,291". Labels past 50% anchor right.
- If top and break-even are within 40 px, keep the numbers and drop the words.
  If `floor − exercise ≥ top`, collapse the band to one Goal line.

**Fill.**
- A **hatched "earned" block** from −exercise to 0, with its number inside.
- A **solid food block** from −exercise, length = food, labelled "N eaten" when
  it is ≥ 70 px wide. Its right edge is net: the **frontier**. A negative net
  ends short of 0, and the hatch left over is unused credit.
- **Colour follows the zone:** blue-grey for `incomplete`; green for `in-range`
  and `declared`; amber for `over`; red for `past-even`. The colours are ordered
  by lightness so they still read as a ramp for colour-blind viewers, and
  position against the band is the primary signal.

**Remaining run.** A dotted, bracketed run carries the headline:

| Zone | Headline | Run |
|---|---|---|
| incomplete | "N to floor" | frontier → band's left edge |
| in-range | "N left" | frontier → top |
| over | "N over" | top → frontier |
| past-even | "N past break even" | break-even → frontier |
| declared | "Fasted" / "Logging done" | none |

The terms line stays. The `aria-label` states the zone and the headline in words.

**Week strip and month block** (`dayBars.js`, `WeekStrip.jsx`, `MonthBlock.jsx`)
draw the band and the four zone colours from `/budget/range`. MonthBlock's
"over budget" count becomes two counts, over the top and past break-even.
Incomplete days are blue-grey.

**Drag preview** (`portionPreview.js`) calls `zoneFor` so a live portion drag
recolours the bar exactly as the server would.

---

## Phase 3 — Coach and reports

A **budget provider** backed by `BudgetService.getBudgetRange` (the counted
fold, `isCountedRow`) is injected into every surface that judges a day. Each one
drops its own sums and thresholds:

| Surface | Today | Change |
|---|---|---|
| `CoachingOrchestrator.mjs` | `goal_max` from `getUserGoals` (`:74,216`); `#sumItems` ignores `isCountedRow` (`:247`); `buildCalendarDays` reads nutriday; `min_calories` resolved once in the constructor (`:30`) | zone/complete/remaining/range from the provider, per call |
| `EndOfDayReport.mjs` | `dayComplete = localHour ≥ 20` (`:87`); prompt "CHECK THE TIME" (`:119`); floor `calories_min ‖ 1200` (`:99`) | **delete the clock rule.** Prompt gets `zone`, `complete`, `declared`, `fastedMeals`. An incomplete day is described as missing data. |
| `MorningBrief.mjs` | floor from `calories_min` (`:705,732`) | provider range |
| `WeeklyDigest.mjs`, `patterns.mjs` | `calories_min/max` | provider |
| `GenerateDailyReport.mjs`, `NutriBotConfig`/`NutribotRuntimeConfig` | `calories_min/max` | provider |
| `DataServiceHealthCoachWorkspaceRepository.mjs` | `calories_min/max` | provider |
| `snapshots.mjs:104` | sends `min_calories` to the LLM | sends `range` and `zone` |

**Rules for the coach:**
1. Completeness comes only from `complete` (floor or declaration). Never from
   time of day.
2. Comments about a deficit require `complete`, or a gap explained by
   `fastedMeals` (Phase 4).
3. Any "remaining" quoted is the zone's `remaining`.

After this phase, `calories_min`/`calories_max`/household `min_calories` are
removed from config and code (with their tests), and `budget`/`status` aliases
are removed once `grep` shows no readers.

---

## Phase 4 — Meal fasts

**Record shape.** `{ status?, at?, meals?: { <bucketId>: { status: 'fasting', at } } }`.
A record may hold meal fasts **without** a day status.

**Readers fixed:**
- `closureStatus` (`dayCompleteness.mjs:43-48`) returns `done`/`fasting` **only
  when `record.status` is one of them**. `true` stays `done`. Anything else is
  `null`. Today it returns `done` for any object, which would silently close a
  day holding only meal fasts.
- `markDayStatus` (`YamlHealthDatastore.mjs:268`) **merges** `status`/`at` and
  keeps `meals`. `clearDayStatus` (`:281`) clears only `status`/`at`, and
  deletes the record when nothing is left.
- New: `markMealFast(userId, date, bucket)` and `clearMealFast(…)`.
- Every reader is checked against the new shape: `HealthOperations.mjs:152,207`
  (reconstruction skip), `CoachingOrchestrator.mjs:77,217,263`, `isDayClosed`
  (agent tool `is_day_closed`), `cli/health-reconstruct-untracked.cli.mjs:39`.
  A meal-fast-only record must not count as closed in any of them.

**Web.** Each meal's ⋯ menu gets "Fasted this meal" / "Undo fast". An empty
fasted meal shows "Fasted" in place of its rows.

**Nutribot grammar** (`NutribotInputRouter.mjs:925-935`, which today parses the
whole argument as a date):

```
/fast [meal] [date]     /reopen [meal] [date]
meal ∈ breakfast|lunch|dinner|snacks (case-insensitive)
date ∈ today|yesterday|YYYY-MM-DD (default today)
```

Either argument may be omitted, in either order. No meal means the whole day
(today's behaviour). An unrecognised word is refused with the grammar in the
reply. The help text (`HandleHelpCommand.mjs`) is updated.

**Effect:** none on the floor, zone or bar. The coach reads `fastedMeals`.

---

## Docs

- `docs/reference/health/README.md`: rewrite the budget-equation section
  (124-178) for range, deficit solver, zones, the new `remaining`, and history
  recolouring. Update the bar, strip and month sections.
- `docs/reference/health/coaching-system.md`: completeness from the floor,
  declarations, meal fasts, no clock inference, the retired settings.
- Nutribot command help and reference for `/fast` and `/reopen`.

## Testing

- **Phase 1:**
  - `BudgetMath`: the solver (target date, the cap, at-target = 0, date passed,
    no date, stale weight).
  - `budgetZone`: every boundary, including negative net, over on an incomplete
    day, and declared.
  - `BudgetService`: the fields on all three endpoints, the aliases, and
    `minCalories` = floor on `readDayStatus` (update `health.dayStatus.test.mjs`,
    which asserts `minCalories: 1300`).
  - Migration CLI dry run and apply.
- **Phase 2:**
  - `budgetGeometry.test.js`: tick steps by width, suppression, the exercise
    margin and compression, band-edge shift, collapse and collision rules,
    negative net, label fit.
  - Component: headline and run per zone, declared state, `aria-label`, drag
    preview recolouring via `zoneFor`.
  - Extend the Playwright layout test.
  - Headless phone and desktop screenshots of a real day and a staged
    exercise/negative-net day before deploy.
- **Phase 3:**
  - Each surface reads the provider (no `calories_min` left, checked by grep in
    a test).
  - `EndOfDayReport` has no time-based completeness.
  - No deficit praise on an incomplete day (prompt-input test).
- **Phase 4:**
  - `closureStatus` on meal-only records.
  - Merge/clear semantics.
  - Every listed reader.
  - `NutribotInputRouter.dayStatus.test.mjs` for the grammar, including order,
    omission and refusal.
