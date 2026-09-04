# Health — log-first food logging, budget, medical

A daily food log in the LoseIt mold: four tabs (Today, Progress, Health, Coach), one
calorie equation computed exactly once on the server, and a set of capture funnels — type,
speak, photograph, or scan a barcode — that all converge on the same day log. Existing
NutriLog/NutriList machinery (built for the Telegram nutrition bot) is reused, not
rebuilt; the web app is a second transport onto the same pipeline.

**Status: shipped and live at `/health`.** `frontend/src/Apps/HealthApp.jsx` is the entry
point.

---

## The four tabs

`HealthApp.jsx` mounts `AppChrome` with a fixed tab set and a global `⌘K` shortcut:

| Tab | Component | Shows |
|-----|-----------|-------|
| Today | `modules/Health/today/TodayView.jsx` | the day log — equation strip, macro/watch-micro bars, the weight chip, the week strip, meal-bucketed rows with per-meal `P · C · F` subtotals, capture affordances |
| Progress | `modules/Health/progress/ProgressView.jsx` | weight trend chart, 14-day budget-adherence bars, 30-day intake-vs-burn chart, goals editor (including macro targets and watch micros) |
| Health | `modules/Health/medical/MedicalView.jsx` | medical readings (blood pressure, labs, etc.), grouped by metric |
| Coach | `modules/Health/CoachChat/index.jsx` | the health-coach agent chat, full height |

`⌘K` (`useHotkey('mod+k', …)`) opens `ChatOverlay` — a scrim + panel that mounts a second
`CoachChat` instance (`variant="overlay"`) over whichever tab is active, so the coach is
reachable without leaving the day log. `Esc` or the scrim closes it.

`Weight.jsx` in this module is unrelated to the tabs above — it stays as the `health`
screen-framework panel widget (kiosk/ambient display), a separate consumer of the same
weight data.

---

## The budget equation — one server-side home

```
remaining = budget − food + exercise
```

`GET /api/v1/health/budget?date=YYYY-MM-DD` is the **only** place this is computed —
`backend/src/3_applications/health/BudgetService.mjs`. Every surface that shows the
equation (`EquationStrip` on Today, the adherence bars on Progress, the `log_food` coach
tool indirectly) reads this endpoint; none of them do arithmetic on the result beyond
formatting. `EquationStrip.jsx` is proof by absence: it destructures `budget.budget`,
`budget.food`, `budget.exercise`, `budget.remaining`, `budget.status`, `budget.stale` and
renders them verbatim — the only computation left client-side is `Math.abs()` for display
sign and `.toLocaleString()` for grouping.

`BudgetService.getBudget(userId, date)`:

1. Loads goals (`apps/health/goals.yml`). No goals → `409 { code: 'GOALS_NOT_CONFIGURED' }`.
2. Finds the latest known adjusted-average weight at or before `date` from weight history.
   No usable weight → `409 { code: 'NO_WEIGHT_DATA' }`. A reading older than 7 days sets
   `stale: true` but the budget still computes from it (a week-old weight beats no weight).
3. Computes `budget` via `computeDailyBudget` (Mifflin-St Jeor, see [Goals](#goals) below),
   using that weight and the goals' height/sex/activity/rate/floor.
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
   keyed object).
8. Returns `{ date, budget, food, exercise, net, remaining, status, stale, sessions, goals,
   macros, microCoverage }` — `status` is `'under'` when `remaining >= 0`, else `'over'`.

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

Every stored food row carries `fiber`, `sugar`, `sodium` and `cholesterol` as numbers.
`validateFoodItem` defaults each one to `0`, which means **a micronutrient nobody ever
measured is stored as a real `0`, indistinguishable from a measured zero.** Summing those
numbers produces arithmetic over ignorance: a sodium total of 40 mg across a day of rows
with no micro data reads as "you barely had any sodium" when the truth is "we have no idea".

`microsSource` is the field that tells the two apart, and it is the only one that can:

| Value | Meaning |
|---|---|
| `'ai'` | an AI capture returned at least one micronutrient number for this row |
| `'catalog'` | the row was quick-added from a catalog entry that carries micros |
| `null` / absent | nothing measured this row's micros; its numbers are structural zeros |

The rules that keep it honest:

- **Coverage keys off `microsSource`, never off the values.** `getBudget` counts a row as
  covered when it carries provenance, full stop. `covered` and `total` both exclude
  `kind: 'group'` rows — a dish header carries no nutrition and no provenance, so counting
  it would report missing data that does not exist.
- **A capture claims provenance only when it actually has micros.** A parse that answered
  with macros alone leaves its structural zeros unclaimed rather than asserting a
  measurement that never happened. A measured `0` does count as data.
- **The catalog is never laundered.** `FoodCatalogService.recordUsage` copies micros onto a
  catalog entry per key, and only off a row that carries provenance — so a capture that
  answered sodium alone donates sodium alone. Both gates are needed: the capture use cases
  therefore hand `recordUsage` the model's own micros rather than `?? 0`-defaulted ones
  (the storage default is applied later, at the persistence boundary, where it belongs).
  Without the per-key half, one partially-answered capture writes a hard `fiber: 0` into
  the catalog that every later quick-add of that food inherits as a `'catalog'` reading —
  permanently, and self-propagating. `backfill` donates **no** micros at all: a stored row's
  micros have already been defaulted, so per-key provenance is gone by the time history can
  be read.
- **The UI says so out loud.** `MacroBarRow` renders "based on {covered} of {total} items
  with any micro data" under any watch-micro bar whose day is not fully covered, and the
  text is in the bar's accessible name as well. That caption is the honesty mechanism, not
  decoration. Coverage that is *unknown* — a payload with no `microCoverage` at all, as in
  a frontend-ahead-of-backend deploy window — is captioned too, and says so; it never
  resolves to "fully covered".

**Coverage is per ROW, not per micro — and this is a real limit, not a nicety.**
`microsSource` is one flag for all four micronutrients. A model that answers `sodium: 1900`
and says nothing about fiber produces a row that is *covered*, so a day made only of such
rows reports `fiber: { covered: 1, total: 1 }`, the caption is correctly suppressed, and a
watched fiber bar renders a confident `0 / 30 g`. The numbers are honest about the row and
silent about the micro. This is why the caption reads "items with any micro data" rather
than implying a per-micro count. Closing it properly needs per-key provenance on the row —
four fields where there is now one — which the stored shape does not have; until then, treat
a fully-covered micro bar as "every row was measured for *something*", not "every row was
measured for this".

A second, narrower edge: provenance means the model *emitted the key*, not that it knew the
answer. An LLM returning `0` for a micro it is unsure of is the likeliest failure mode here,
and it is indistinguishable from a genuine zero — by design, because a measured zero must
count as data. The guarantee `'ai'` carries is "the model answered", nothing stronger.

Macros (`protein`/`carbs`/`fat`) are not coverage-gated: every capture path writes them,
and the per-meal `P · C · F` subtotals and macro-goal bars show them unqualified.

---

## Meal buckets

Internal values and UI labels are declared once, in `today/mealBuckets.js`, and reused by
`LogTable`, `useHealthDay`, and `EntryEditSheet` so they can never drift:

| Data value (`mealTime`) | UI label |
|---|---|
| `morning` | Breakfast |
| `afternoon` | Lunch |
| `evening` | Dinner |
| `night` | Snacks |
| *(missing / unrecognized)* | Ungrouped |

`useHealthDay`'s `byBucket` grouping falls any row whose `mealTime` isn't one of the four
known ids into the `null` key; `LogTable` renders that as a fifth section labeled
"Ungrouped," shown only when non-empty and — unlike the four named buckets — with no
"+ Add food…" affordance (there's no bucket to add into).

**`mealTime` is denormalized directly onto the NutriList row**, not derived on read. It's
set at write time from the current hour (`h < 11 → morning`, `h < 15 → afternoon`,
`h < 20 → evening`, else `night`) in quick-add (`FoodCatalogService.quickAdd`) and in
saved-meal logging (`SavedMealsService.logToDate`, when no explicit `mealTime` is passed);
either path accepts an explicit override — the bucket the user tapped "+ Add food…" in, or
a `mealTime` chosen when moving a saved meal to a specific meal. Moving an already-logged
row to a different bucket is a plain `PUT /nutrilist/{uuid} { mealTime }` from
`EntryEditSheet`'s "Move to" row. The Today view's quick-capture bar (below) defaults to
this exact same hour mapping when it has no other meal to target.

A second, disagreeing hour→meal split exists elsewhere in the pipeline: 5–11 morning,
12–16 afternoon, 17–20 evening, else night. That mapping backs the clock default an AI
capture's own parse is stamped with before any declared bucket or explicitly named meal
is applied (see [Capture funnels](#capture-funnels) below), and the client-side guess used
only to position an in-flight capture's loading placeholder before a result is known. The
two mappings are deliberately independent; a future change to one is not a bug in the
other, and a third one is never the fix for a mismatch between them.

---

## Loading and refresh

Today's structure is permanent. `LogTable`'s four meal-bucket headings, their
kcal subtotals, and each bucket's "+ Add food…" row render regardless of
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
[`docs/reference/frontend/design-system.md`](../frontend/design-system.md#data-fetching)
for how the primitive itself works.

The Exercise section's header follows the same discipline for a different
reason: it appears once the day's budget has loaded, whether or not any
workout is logged, so a workout-free day gets a stable header rather than one
that pops in and out as sessions come and go.

---

## Viz and layout

Every bar on the Today and Progress tabs is plain CSS or inline SVG. There is no
chart library outside the Progress weight chart, and nothing animates the CSS
`filter` property — it is a known paint-cost trap in this codebase (low frame
rates with zero long tasks).

### One shared range endpoint

`GET /budget/range?from=&to=` returns one entry per day for an inclusive range,
in a single request. Every multi-day surface reads it through one client hook,
`today/useBudgetRange.js`:

| Surface | Window |
|---|---|
| Week strip (`today/WeekStrip.jsx`) | the viewed date and the six days before it |
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

A surface shown more than once on a page does **not** fetch more than once. The
shared fetch hook's cache dedupes a second page *load*, not two simultaneous
mounts, so a range that several widgets need is fetched once high in the tree
and handed down as `days`. The desktop sidebar's month block and its
intake-vs-burn chart share one 30-day request this way.

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

**Week strip and month block.** Bar height is the day's food as a fraction of
that day's budget, clamped at 1.25×; the reference line sits at 1/1.25 of the
box, so a day exactly on budget lands on the line and the space above it is
overshoot headroom. Hue is under/over. The accessible name announces the *true*
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

The Today column is capped at 720px and centred — every measurement in this app
was tuned against a phone-width column, and log rows spanning a 2560px monitor
are unreadable. At 1100px the page becomes a grid of that column plus a 320px
sticky aside holding the weight chip, the month block and the intake-vs-burn
chart.

There is **one** instance of each of those widgets in the markup. On a narrow
viewport the aside is simply the next block in the stack, which is what puts the
weight chip directly under the macro bars; the wide layout moves that same
element into the second column. Nothing is rendered twice and hidden.

The 30-day widgets' *mount* is gated on the breakpoint, not merely their
visibility: CSS alone cannot stop a phone fetching a month of budgets for a
column it will never draw. That puts the breakpoint in JavaScript
(`today/layout.js`) as well as in the stylesheet, and
`today/layout.contract.test.js` reads the compiled stylesheet and fails if the
two ever disagree. Layout itself is verified with real Playwright screenshots at
390px and 1440px — jsdom cannot see layout, and an assertion about widths or
grid placement made under it is vacuous.

---

## Capture funnels

Four ways to get a food onto the log — type, speak, photograph, or scan a barcode — start
from one of two places on Today.

Each of the four meal sections carries its own voice, photo, and barcode buttons in its
header, scoped to that meal — one tap from Breakfast's row starts a capture that targets
Breakfast — alongside the "+ Add food…" row underneath for a typed sentence or type-ahead
pick against the same meal.

A single quick-capture bar (`QuickCaptureBar.jsx`) is fixed on Today independent of scroll
position, offering the same four capture types with no meal of its own — it defaults to
whichever meal the current time of day implies (the hour mapping in
[Meal buckets](#meal-buckets) above). This is the day view's only such affordance: the
footer below the log carries the macro summary and coach line, never capture controls.

### Type-ahead suggest (`AddCombobox`)

Typing debounces 250 ms into `GET /nutrition/catalog/suggest?q=`
(`FoodCatalogService.suggest`) — the ranked list behind every combobox:

1. Filter to entries whose normalized name contains the query (empty query = everything).
2. Sort: **favorites first** (`favorite === true` descending), then by a recency-weighted
   frequency score `useCount / (1 + daysSinceLastUsed / 30)` descending, then alphabetically
   as a final tiebreak.

Arrow keys move a `highlight` index over the results; **Enter with a suggestion
highlighted** or a click both call `pick(entry)`.

### Deterministic paths — skip the funnel entirely

`pick(entry)` is the fast path: `POST /nutrition/catalog/quickadd { catalogEntryId }`
followed by a `PUT` to set the bucket, then done — no pending state, no confirmation step.
The same shape repeats everywhere a value is already known and doesn't need interpreting:

- **Custom-food creation** (`CustomFoodSheet`, below) — create, then quickadd.
- **Saved-meal logging** (`SavedMealsSheet`, "Copy to today", below) — `POST
  /nutrition/meals/:id/log` writes NutriList rows directly.

None of these touch the AI parsing pipeline.

### Free-text sentence, photo, voice, barcode — the AI capture path

Everything else — a typed sentence with nothing highlighted, a photo of a plate, a voice
note, or a barcode scan — goes through the **same unified endpoint**,
`POST /api/v1/health/nutrition/input { type: 'text'|'image'|'voice'|'barcode', content }`,
which is the web transport onto the pre-existing Telegram nutrition-bot pipeline
(`WebNutribotAdapter` → `NutribotInputRouter.handleText/handleImage/handleVoice/handleUpc`
→ `LogFoodFromText`/`LogFoodFromImage`/`LogFoodFromVoice`/`LogFoodFromUPC`).

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

Two flows are deliberately exempt from the accept half of the seam:

- **Scale** captures keep their multi-step composition flow (weight → tare → density) and
  mint a `pending` NutriLog for the duration of it. The composition completing is what
  commits: the scale path applies the scanned density and then runs the same accept seam
  every other funnel runs, so a finished placement lands `accepted` with `settled: false`
  and is indistinguishable from a typed entry. What stays `pending` is a placement that
  never completed — a weight with no density scanned, which nothing can price. A pending
  row never syncs into the day's NutriList, so it doesn't appear among Today's normal rows
  and doesn't count toward the budget; `GET /nutrition/pending?date=` surfaces it
  separately, and Today renders it in a **NEEDS REVIEW** banner above the meal buckets,
  with its own Accept/Discard. That endpoint returns pending rows regardless of origin, but
  every other capture commits on arrival (above), so Today filters the banner to
  scale-origin rows.

  **A NEEDS REVIEW row is not permanent.** The prompt behind it is still the scale's live
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
surfaces the message text as a one-line notice instead, so a miss is still visible rather
than silently dropped. `AddCombobox`'s sentence submit follows the same shape directly:
on success it just reloads — no confirmation step of its own.

A captured entry appears in the day's log (`GET /nutrilist/:date` returns every status,
unfiltered) and counts toward the budget immediately, carrying `settled: false`. It
renders like any other row: tapping it opens `EntryEditSheet` to edit or delete, and its
"Unconfirmed" badge carries the one-tap settle button (see
[Unsettled vs. settled](#unsettled-vs-settled) below). Photo and voice captures
(`PhotoCapture`/`VoiceCapture` → `TodayView`) and a known-barcode hit (`BarcodeCapture` →
`TodayView`, when the result isn't `unknownUpc`) submit through the identical
`/nutrition/input` call and follow the same reload-or-notice handling.

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

Today's log renders a group collapsed by default, showing a rolled-up calorie total
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
the AI call. `PhotoStore` (`backend/src/1_adapters/persistence/PhotoStore.mjs`) writes the
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
(`backend/src/1_adapters/persistence/IconManifestStore.mjs`). No filename appears in code,
in a stylesheet, or in a response body: a client only ever holds a slug.

```yaml
icons:                       # the OFFERED vocabulary
  carrot: { path: img/nutrition/icons/vegetables/carrot.png }
aliases:                     # resolvable, never offered
  apple_sauce: { path: img/icons/food/apple_sauce.png }
```

**Two maps, because there are two audiences.** `icons` is what the capture agent may
choose from and what the edit sheet's picker lists. `aliases` exist because the original
flat icon set's basenames are **already stored on rows** as `FoodItem.icon`; dropping one
would break a stored row silently — it would render its fallback glyph and nothing would
log. So every legacy slug still resolves, pointed at its hi-res counterpart where one
exists and at the original file otherwise, while none of them is offered as a new choice.

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
response into rows — text, image, and the revision re-parse — CONFINE the model's answer to
that vocabulary (`backend/src/2_domains/nutrition/services/icons.mjs`). A slug that is not
in the vocabulary becomes `default`, the neutral sentinel, rather than a stored name that
404s forever afterwards.

**`default` is not a picture.** It resolves to a real file so nothing renders broken, but
it means "nobody chose one". The UI treats it as no icon and shows the Noom colour dot;
the catalog never accepts it as a food's icon, because donating it would pin that food to
the fallback glyph and block every real icon proposed afterwards.

**The icon sticks to the food, not to the row.** `FoodCatalogEntry.icon` is filled by the
first capture that names one and is **never overwritten by a later capture** — "always for
this food" is a human choice that has to outlive the next time that food is logged. A
quick-add copies the catalog's icon onto the row it writes. A group row shows its own icon
if it has one, else the first child's.

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
size, and the row shows its neutral dot. Smaller sources are still served unrendered, which
keeps the ~4 KB legacy vocabulary working when only the hi-res half is affected. A missing
picture is a far smaller harm than a 3 MB one, and it is loud.

**When the file is not there.** A Dropbox conflicted copy once emptied a media directory
while leaving it in place, and the illustrations 404'd in production with nothing logging
an error anywhere. The only thing that could catch it was a test asserting every basename
the code can name exists as a file. `IconManifestStore.media.test.mjs` is that test for
this vocabulary: it walks the INSTALLED manifest against the REAL media mount and fails if
any slug — offered or alias — names a file that is not there. Where the mount is
unavailable it skips **visibly**, never passing on nothing.

### Barcode → unknown UPC → custom food

`BarcodeCapture` decodes via the native `BarcodeDetector` API, falling back to
`@zxing/browser`, and always offers a manual-UPC text field as the same submit path (and
the deterministic test seam). A decode calls `nutrition.submit('barcode', upc)`:

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

An unsettled row also **auto-settles by age**: once it's more than three days old it
presents as settled even though the stored value is still `false`. This is computed each
time the day is read, not written back — nothing ever mutates the row to auto-settle it,
and no scheduled job runs the check.

A person settles a row two ways: any successful edit (a `PUT` on the row, from
`EntryEditSheet` or elsewhere) stamps `settled: true, settledBy: 'user'` alongside
whatever else changed, and an unsettled row's "Unconfirmed" badge carries its own
one-tap confirm button that sends that same stamp with no other field changed.

---

## Custom foods and favorites

A `FoodCatalogEntry` (`backend/src/2_domains/health/entities/FoodCatalogEntry.mjs`) carries
`id, name, normalizedName, nutrients{calories,protein,carbs,fat}, source, barcodeUpc,
useCount, favorite, icon, lastUsed, createdAt`. `icon` is a manifest slug or null — see
[Food icons](#food-icons). `source` is `'manual' | 'nutritionix' | 'custom'`
depending on origin; entries created via `createCustom` (the barcode-mapping flow, or any
direct `POST /nutrition/catalog`) are always `source: 'custom'`. `favorite` is a persisted
boolean, toggled from `EntryEditSheet`'s star button via `PUT /nutrition/catalog/favorite {
id?, name?, favorite }` (resolves by id or by normalized name), and is the top sort key in
`suggest()`. The catalog lives at `lifelog/nutrition/food_catalog.yml` per user — the
pre-existing nutribot path, not a new `apps/health/` file, since quick-add and Telegram
logging already read from it.

---

## Saved meals

A saved meal is a named, multi-item template. Two ways to create one, both `POST
/nutrition/meals { name, items }`:

- **"Save as meal"** on a single logged entry's edit sheet (`EntryEditSheet`).
- **"Save as meal"** on a whole bucket, from `LogTable`'s per-bucket header action (today's
  buckets only) — prompts for a name, snapshots every row currently in that bucket.

`SavedMealsService.create` snapshots each item's `name/calories/protein/carbs/fat/color` at
save time — **items are immutable snapshots**; a later edit to a `FoodCatalogEntry`'s
nutrients never mutates a saved meal or retroactively changes anything already logged from
it. New meals start `useCount: 0, lastUsed: null`.

**Logging a saved meal** — `POST /nutrition/meals/:id/log { date?, mealTime? }` — builds
fresh NutriList rows from the snapshot (`log_uuid: 'SAVEDMEAL'`, the same direct-write
mechanism quick-add uses, no pending step), defaults `date` to today and `mealTime` from
the current hour when not passed, and bumps the meal's `useCount`/`lastUsed`. `list()`
sorts by `lastUsed` descending. `SavedMealsSheet` is the picker UI, opened from the
combobox's "Saved meals ▸" link.

**Copy-to-today** (viewing a past date, per-bucket header action) reuses this same
create→log→delete sequence purely as transport: it creates a throwaway saved meal from
that bucket's rows, immediately logs it to today, then `DELETE`s the template — there is no
dedicated "copy" endpoint. It only ever targets today; there's no "copy to another specific
day" affordance.

---

## Medical readings

A deliberately dumb store — validation only, no interpretation
(`backend/src/3_applications/health/MedicalReadingsService.mjs`,
`apps/health/medical.yml`, `{ readings: [{ id, metric, value, value2, unit, date, note }] }`).
`metric` is a free-form string, not an enum; `MedicalView.jsx` suggests a fixed set (`bp`,
`resting_hr`, `glucose`, `a1c`, `cholesterol_total`, `ldl`, `hdl`, `triglycerides`) via an
`Autocomplete`, but any string is accepted. `value2` exists specifically for blood
pressure's diastolic reading — the "Diastolic" field only appears in the add-reading sheet
when `metric === 'bp'`.

Endpoints: `GET /api/v1/health/medical` (`listGrouped` — one entry per metric, each with its
sorted reading history and `latest`), `POST /api/v1/health/medical` (add), `DELETE
/api/v1/health/medical/:id` (remove). **There is no update endpoint** — a reading is
corrected by deleting and re-adding, never edited in place; `MedicalView.jsx` offers no
edit UI to match.

---

## Coach `log_food`

`backend/src/3_applications/agents/health-coach/tools/NutritionActionToolFactory.mjs`
registers `log_food` — the coach's only write path into nutrition. It takes `{ userId,
description }` and calls the identical text pipeline the web combobox's sentence path
uses (`nutritionInput.process({ type: 'text', content: description, userId })` —
`nutritionInput` is `WebNutribotAdapter`). It reaches `handleText`, which means it goes
through the same auto-commit seam as every other transport: **the coach's entries are
logged immediately as `accepted` + `settled: false`**, with no separate acceptance gate
for this transport — it behaves exactly like a typed sentence submitted from the combobox.
It returns
`{ status: 'logged', summary }` (`summary` is the parsed itemization's first response line,
e.g. "🟡 2 eggs — 140 kcal"), which lets the model tell the user what landed; the user
reviews or undoes it in the app.

---

## Goals

`backend/src/2_domains/health/services/BudgetMath.mjs` — pure, no IO, no clock — implements
Mifflin-St Jeor:

```
BMR  = 10·kg + 6.25·cm − 5·age + (male: +5 | female: −161)
TDEE = BMR × activityBaseline
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
| `activityBaseline` | TDEE multiplier |
| `weeklyRateLbs` | the deficit subtracted from TDEE |
| `budgetFloor` | the hard minimum |
| `targetWeightLbs` | **display only** — the Progress weight chart's goal line; `BudgetService` never reads it |
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
/goals` on save — alongside the weight-trend chart and a 14-day adherence strip built from
14 parallel `GET /budget?date=` calls. Its macro-goal and watch-micro fields build their
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

- **Unmatched signals appear at the top of the day** ("82 g on the kitchen scale at
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

All under `/api/v1/health/`, from `backend/src/4_api/v1/routers/health.mjs`:

| Endpoint | Purpose |
|---|---|
| `GET /budget?date=` | the equation, the day's macro/micro sums, and micro coverage (see above) |
| `GET /budget/range?from=&to=` | the same equation per day over an inclusive range, in one request — `{ days: [...] }`, a day that cannot be computed appearing as `{ date, error }` rather than failing the range. 62-day cap; a bad range is `400 { code: 'RANGE_INVALID' }` (see [Viz and layout](#viz-and-layout)) |
| `GET /goals`, `PUT /goals` | goals document; a malformed `macroGoals`/`watchMicros` shape is `400 { code: 'GOALS_INVALID' }` |
| `GET /nutrilist/:date`, `POST /nutrilist`, `PUT /nutrilist/:uuid`, `DELETE /nutrilist/:uuid` | day-log rows (legacy-parity NutriList CRUD) |
| `GET /nutrition/catalog?q=`, `GET /nutrition/catalog/recent` | plain catalog search/recents |
| `GET /nutrition/catalog/suggest?q=` | ranked combobox suggestions |
| `POST /nutrition/catalog/quickadd` | deterministic log from a catalog entry |
| `POST /nutrition/catalog` | create a custom food (optionally `barcodeUpc`-mapped) |
| `PUT /nutrition/catalog/favorite` | toggle favorite by id or name |
| `PUT /nutrition/catalog/icon` | pin a food's icon by id or name — the "always for this food" override |
| `POST /nutrition/catalog/backfill` | seed the catalog from existing log history |
| `GET /nutrition/meals`, `POST /nutrition/meals`, `POST /nutrition/meals/:id/log`, `DELETE /nutrition/meals/:id` | saved meals |
| `POST /nutrition/input` | unified capture entry point (`type: text\|image\|voice\|barcode`) |
| `POST /nutrition/callback` | resolve a capture's Undo/Edit/portion choice, or a scale-pending Accept/Discard |
| `GET /nutrition/pending?date=` | pending NutriLogs for a date (the scale's NEEDS REVIEW banner) |
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

## Related

- [`docs/reference/nutrition/README.md`](../nutrition/README.md) — the fridge-scale/barcode
  scan pipeline that feeds the same NutriList log from the kitchen, independent of this app.
- [`docs/reference/frontend/design-system.md`](../frontend/design-system.md) — the `@/lib/ui`
  primitives and pack theming this app is built on.
