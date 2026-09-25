# Health budget as a range — design

**Status:** design approved in conversation 2026-09-24; this spec awaits review.
Next step after approval: an implementation plan.

## Why

The Today budget bar (`.health-budget`, `frontend/src/modules/Health/today/EquationStrip.jsx`)
shows a net fill against a single Goal line and a Break-even line. It is hard to read:

- There is no scale, so nothing can be read off the bar's length.
- The headline ("648 kcal left") is not a visible segment, so it is unclear what
  it measures.
- The goal is a single computed point, not a range.
- Exercise is drawn as a band to the right of the net fill, which clutters the
  one edge that matters.

There is also a logging problem the bar should help with. Logs usually
under-report, by about 40% even on careful days. A day logged at 600–800 kcal is
almost certainly incomplete, not a real deficit. The coach has praised
"keeping intake down" on days that were simply under-logged.

## Goals

1. The bar is a **labelled ruler**: ticks, a goal **range**, break-even, and a
   single **frontier** (net calories) whose zone sets the colour.
2. Every headline number is a **drawn segment** on the bar.
3. The range floor is a **logging-completeness check** (food eaten). The range
   top is the **plan** (net against a daily deficit).
4. A day is trusted as complete only when it reaches the floor, or when it is
   **explicitly declared** done or fasted. Completeness is never inferred from
   the clock.
5. The same range, zones and completeness apply everywhere: the Today bar, the
   week strip, the month block and the coach.

## Non-goals

- Correcting for under-reporting (e.g. a +40% factor). The bar reports what was
  logged; the floor only says whether the log can be trusted.
- Meal-level fasting changing the floor or the bar. It is information for the
  coach only (see below).

## Settings (goals YAML)

The goals already hold `targetWeightLbs`, `weeklyRateLbs` and `budgetFloor`. This design:

| Key | Status | Meaning |
|---|---|---|
| `budgetFloor` | existing, default 1200 | Range floor, **compared against food eaten**. The single completeness threshold for the app. |
| `targetWeightLbs` | existing | Target weight used by the deficit solver. |
| `targetDate` | **new**, `YYYY-MM-DD` | Date to reach `targetWeightLbs`. |
| `weeklyRateLbs` | existing, default 1 | Fallback rate when the target-date solver cannot run. |
| `maxWeeklyRateLbs` | **new**, default 2 | Safety cap on the solved rate. |

`assertGoalsShape` (`BudgetService.mjs`) validates the new keys: `targetDate` is a
valid ISO date and `maxWeeklyRateLbs` is positive. The goals form in Progress
edits them.

The coaching config's `min_calories` (`dayCompleteness.mjs`,
`DEFAULT_MIN_CALORIES = 1200`) is **retired**. Completeness reads `budgetFloor`.
A migration moves any configured `min_calories` into `budgetFloor` if the latter
is unset, then removes it. The reader keeps a one-release fallback that logs a
warning when only `min_calories` is present.

## Budget math (backend, one computation)

Everything lives in `BudgetMath` / `BudgetService`. `/day`, `/budget` and
`/budget/range` return the same fields for a day, because the strip and the
Today bar must never disagree.

**Daily deficit:**
```
if targetDate is set, the day is before targetDate, and latest weight > targetWeightLbs:
  deficit = (latestWeight − targetWeightLbs) × 3500 ÷ daysUntil(targetDate)
  deficit = min(deficit, maxWeeklyRateLbs × 500)
  deficitSource = 'target-date'
else:
  deficit = weeklyRateLbs × 500
  deficitSource = 'weekly-rate'
```
"Latest weight" is the same resolved weight the budget already uses, including
its `stale` flag.

**Per-day fields returned:**

| Field | Definition |
|---|---|
| `maintenance` | break-even (TDEE), unchanged |
| `deficit`, `deficitSource` | as above |
| `range` | `{ floor: budgetFloor, top: max(floor, maintenance − deficit) }` |
| `food`, `exercise`, `net` | unchanged (`net = food − exercise`, **may be negative**) |
| `complete` | `food ≥ floor` OR the day is declared `done`/`fasting` |
| `declared` | `'done' \| 'fasting' \| null` (the day-level closure) |
| `fastedMeals` | bucket ids declared fasted, e.g. `['morning']` |
| `zone` | see below |
| `remaining` | the headline value for the zone (see below) |
| `budget` | **alias of `range.top`**, kept for compatibility until readers move to `range` in this change |

**Zones** are evaluated in this order:

| Zone | Condition | `remaining` |
|---|---|---|
| `past-even` | `net > maintenance` | `net − maintenance` |
| `over` | `net > range.top` | `net − range.top` |
| `in-range` | `food ≥ floor` | `range.top − net` |
| `declared` | `food < floor` and day declared | `range.top − net` (not shown as a headline) |
| `incomplete` | `food < floor`, not declared | `floor − food` |

`over` and `past-even` take precedence over completeness: a day can be over plan
and still under-logged. The coach sees both, through `zone` and `complete`.

## The Today bar (frontend)

The geometry moves into a pure module, `today/budgetGeometry.js`: values in,
x positions, ticks, segments and labels out. `BudgetBar` in `EquationStrip.jsx`
only renders it.

**Ruler:**
- Fixed right end at `max(maintenance, food, range.top) × 1.12`.
- On exercise days a left margin opens: the left end is `−ceil250(exercise)`.
  The 0 line moves left; the named marks do not move.
- Ticks every 250. Numbers on 1,000s at phone width and 500s at ≥ 600 px. No
  tick within ~12 px of a named mark.

**Named marks:**
- **Goal band** from `floor − exercise` to `range.top`, labelled once:
  "Goal 1,200–1,791" (the label uses the configured floor, not the shifted
  position). The left edge shifts by exercise because the floor measures food:
  `food ≥ floor` ⇔ `net ≥ floor − exercise`.
- **Break-even** line, "Break even 2,291". Labels past 50% of the bar anchor
  right (current behaviour).
- Collisions: if top and break-even are within ~40 px, drop the words and keep
  the numbers. If floor − exercise ≥ top, collapse the band to one Goal line.

**Fill:**
- A **hatched "earned" block** from `−exercise` to `0`, with its number inside.
- A **solid food block** from `−exercise`, length = food, labelled "N eaten" if
  it is ≥ ~70 px (otherwise the number stays in the terms line). Its right edge
  is `net`: the **frontier**.
- Negative net needs no special case: the block ends short of 0, and the hatch
  left between it and 0 is unused credit.
- **Colour follows the server's `zone`:**

| Zone | Colour |
|---|---|
| `incomplete` | blue-grey |
| `in-range`, `declared` | green |
| `over` | amber |
| `past-even` | red |

  The four colours are ordered by lightness so they still read as a ramp for
  colour-blind viewers. Position against the band is the primary signal.

**Remaining run.** A dotted run from the frontier to the relevant mark carries
the headline number, bracketed:

| Zone | Headline | Run |
|---|---|---|
| `incomplete` | "N to floor" | frontier → band's left edge |
| `in-range` | "N left" | frontier → top |
| `over` | "N over" | top → frontier (drawn as an overrun) |
| `past-even` | "N past break even" | break-even → frontier |
| `declared` | "Fasted" / "Logging done" | none |

The terms line stays: eaten · burned · net · deficit (or surplus).

**Accessibility.** The track's `aria-label` states the zone and the headline in
words, e.g. "1,143 net, in goal range, 648 left before 1,791".

## Week strip and month block

`dayBars.js`, `WeekStrip.jsx` and `MonthBlock.jsx` switch from the single goal
line to the band and to the four `zone` colours, using the same `range`/`zone`
fields from `/budget/range`. Incomplete days show blue-grey, so a run of
under-logged days reads as a logging problem, not as good days. Break-even stays
a dashed line.

## Meal-level fasting

- **Storage:** the day-closure record (`{ status, at }` per date, read through
  `loadDayClosedData`) gains
  `meals: { <bucketId>: { status: 'fasting', at } }`. Legacy records (bare
  `true`, or no `meals`) read unchanged.
- **Web:** each meal's ⋯ menu gets "Fasted this meal" / "Undo fast". An empty
  fasted meal shows a quiet "Fasted" in place of its rows.
- **Nutribot:** `/fast <meal>` (breakfast, lunch, dinner, snacks) sets a meal
  fast. `/fast` alone keeps its whole-day meaning. `/reopen <meal>` clears a
  meal fast. The help text is updated (`HandleHelpCommand.mjs`).
- **Effect:** none on the floor, zone or bar. It is read only by the coach.

## Coach

`dayCompleteness.mjs` and `CoachingMessageBuilder.mjs` receive, per day:
`{ zone, complete, declared, fastedMeals, remaining }`.

Rules:
1. **Never infer completeness from the time of day.** An undeclared day under
   the floor is `incomplete`: the coach says data is missing and does not
   praise or criticise the intake.
2. Commentary on a **deficit** requires `complete`, or that the uncovered gap is
   explained by `fastedMeals`. Example of the allowed message on an incomplete
   day: "Breakfast fasted; lunch and dinner not logged yet."
3. Any "remaining" the coach quotes is the zone's `remaining`, so it matches the
   bar.

## Docs to update

- `docs/reference/health/README.md`: budget equation (range, deficit solver,
  zones, completeness), the Today bar, week strip and month block.
- `docs/reference/health/coaching-system.md`: completeness from `budgetFloor`,
  declarations, meal fasts, the no-inference rule, `min_calories` retired.
- Nutribot help and any command reference that lists `/fast` and `/reopen`.

## Testing

- **Backend unit:**
  - The deficit solver: target date, the cap, and each fallback (no date, date
    passed, target reached, stale weight).
  - Zone and `remaining` at every boundary, including negative net, and `over`
    on an incomplete day.
  - Completeness with and without declarations; the `min_calories` migration
    and fallback.
- **Geometry unit** (`budgetGeometry.test.js`): tick steps by width, tick
  suppression near marks, the exercise margin, band-edge shift, collapse and
  collision rules, negative net, and label fit.
- **Component:** the headline and run per zone; the declared state; the
  `aria-label`; meal fast toggles (menu, "Fasted" placeholder, undo).
- **Nutribot:** `/fast <meal>`, `/reopen <meal>`, and `/fast` with no argument
  unchanged.
- **Coach:** no deficit praise on an incomplete day; the fasted-meal message.
- **Render check:** headless phone and desktop screenshots of a real day and a
  staged exercise/negative-net day, before deploy.
