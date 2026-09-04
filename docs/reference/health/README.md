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
  Legacy counts/volumes are never treated as grams.
- **Durable commands:** group edits, moves, deletes, copies and restores validate all
  targets before a journaled, fsynced multi-file commit. Source and destination
  summaries are rebuilt, including empty days. Recovery replays a prepared journal.
  This is a **single-writer-process** contract; never run dev and production writers
  against the same nutrition directory.
- **Retry identity:** modern web creation requests carry an `operationId`.
  Identical retries coalesce and recover committed rows after a lost response.
  Reusing an ID for a different payload returns 409. Older clients without IDs
  remain compatible but do not receive that duplicate-submission guarantee.
- **Corrections:** a centered desktop dialog / mobile bottom sheet leads with exact
  grams. Preview all nutrient scaling, make several changes, then Save once with
  `expectedVersion`. Delete offers Undo. Focus is contained and restored; scroll
  locks are shared with Coach.
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
  identity and explicit icon pins before writing.
- **Coach:** the tab and overlay share one runtime and resolved Health user ID.
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
| Today | `modules/Health/today/TodayView.jsx` | the day log — equation strip, macro/watch-micro bars, the weight chip, the week strip, meal-bucketed rows with per-meal `P · C · F` subtotals, capture affordances |
| Progress | `modules/Health/progress/ProgressView.jsx` | weight trend chart, 14-day budget-adherence bars, 30-day intake-vs-burn chart, goals editor (including macro targets and watch micros) |
| Medical | `modules/Health/medical/MedicalView.jsx` | medical readings (blood pressure, labs, etc.), grouped by metric |
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

`backend/src/3_applications/health/BudgetService.mjs` is the only calculation owner.
It serves `/budget`, `/budget/range`, and the budget portion of `/day`. Today reads
one `/day?date=` snapshot containing entries, their ledger revision, and a budget
computed from those exact entries. A budget setup error does not hide the food log. `EquationStrip.jsx` is proof by absence: it destructures `budget.budget`,
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

The Today tab is deliberately ledger-dense: its type is one step below the app
default, meal and row whitespace is compact, and the 44 px capture controls keep
their touch-target floor even though the surrounding chrome is tighter. The
inline Add food surface is a bordered, height-capped panel rather than loose
text; suggestions use one column on the narrowest screens and two from 480 px,
with a real catalog icon or a reserved Noom-dot fallback on every row.

Food rows expose one portion vocabulary: a valid positive `grams` value is
shown as `N g`, and no portion is shown when grams are absent. Capture-specific
`amount`/`unit` prose (cups, tablespoons, servings, and similar) is retained in
the data model but never mixed into the Today ledger. Scaling an entry in its
edit sheet scales `grams` with its nutrient values so that displayed mass stays
truthful.

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

A surface shown more than once on a page does **not** fetch more than once. The
shared fetch hook's cache dedupes a second page *load*, not two simultaneous
mounts, so a range that several widgets need is fetched once high in the tree
and handed down as `days`. The desktop sidebar's month block and its
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

**Week strip and month block.** Bar height is the day's food as a fraction of
that day's budget, clamped at 1.25×; the reference line sits at 1/1.25 of the
box, so a day exactly on budget lands on the line and the space above it is
overshoot headroom. Hue is under/over.

These are **two different denominators, deliberately**: the height is
`food / budget`, the hue is the outcome of `budget − food + exercise`. That is
informative — a day you ate 114% of budget and trained off really is an under
day, and collapsing the hue onto the food-only denominator would throw the
exercise offset away — but it means a cell can sit above the reference line and
still be green. Two things therefore always name the reconciling term. The
accessible name states intake, exercise and outcome as one claim ("ate 2040 of
1791 kcal, 114% of budget, with 530 kcal exercise, 281 kcal left"), saying "with
no exercise logged" rather than dropping the term; and such a cell carries a
capped top edge, a non-colour cue that the overshoot is real and something
offset it. A sentence asserting "114% of budget" and "under budget" with nothing
between them is a self-contradiction, not a summary.

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

A single compact quick-capture bar (`QuickCaptureBar.jsx`) sits in normal document flow
below the week strip, offering the same four capture types with no meal of its own — it defaults to
whichever meal the current time of day implies (the hour mapping in
[Meal buckets](#meal-buckets) above). This is the day view's only such affordance: the
footer below the log carries the macro summary and coach line, never capture controls.

### Quick add — suggestions before the first keystroke (`AddCombobox`)

Opening the add row shows a list immediately: the combobox fetches
`GET /nutrition/catalog/suggest?bucket={bucketId}&limit=8` on mount, undebounced, so
Breakfast's regulars are one tap away with nothing typed. Typing switches to
`?q=` on a 250 ms debounce; clearing the text returns to the bucket list. Both share one
request-id guard, so a slow response can never overwrite a newer one.

The opening list is capped at **8** deliberately. It is the only fetch that happens with
no user intent behind it, and every row it draws fires an icon request — a short list keeps
that burst nowhere near the render-herd shape the icon route had to be bounded against.
The typed list keeps the server default of 12; there the person is steering.

Arrow keys move a `highlight` index over the results; **Enter with a suggestion
highlighted** or a click both call `pick(entry)`. Rows show the food's icon (where the
catalog entry has one), its name, and its calories, with the same `<img>` + `onError`
fallback the log rows use. A row that is a **meal** rather than a food carries its item
count as a badge (see [Meal templates](#meal-templates)).

#### The ranking

`FoodCatalogService.suggest(query, userId, limit, { bucket })` filters by the query, then
hands the candidates to `bucketSuggestRanking.mjs` — a pure domain module that takes the
clock as an argument, because the domain layer forbids an ambient one. Three tiers:

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
one-tap quick-add defaults to. A bucket the food has never been eaten in falls back to the
catalog default of one serving.

### Deterministic paths — skip the funnel entirely

`pick(entry)` is the fast path: **one** request, `POST /nutrition/catalog/quickadd
{ catalogEntryId, mealTime }`, then done — no pending state, no confirmation step. The
meal travels with the quick-add; there is no follow-up `PUT` to move the row afterwards.
The row lands `settled: true, settledBy: 'user'`, because a one-tap pick of a known food is
a deliberate choice, not a machine estimate. Its portion is the last one logged for that
food in that bucket, else its canonical gram portion. The suggestion shows the
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
  honest-old-name: { path: img/nutrition/icons/category/equivalent.png }
```

**Two maps, because there are two audiences.** `icons` is what the capture agent may
choose from and what the edit sheet's picker lists. `aliases` keep reviewed alternate
names requestable without offering them as new choices. A legacy basename is retained
only when the hi-res vocabulary has an honest equivalent; an unmapped old slug renders
the neutral fallback rather than showing the wrong food. The installed hi-res-only
manifest therefore does not promise complete coverage of the retired flat vocabulary.

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

A person settles a row three ways: any successful edit (a `PUT` on the row, from
`EntryEditSheet` or elsewhere) stamps `settled: true, settledBy: 'user'` alongside
whatever else changed; an unsettled row's "Unconfirmed" badge carries its own one-tap
confirm button that sends that same stamp with no other field changed; and a **quick-add**
writes the stamp at creation, since picking a known food off the suggestion list is itself
the ratification.

---

## Custom foods and favorites

A `FoodCatalogEntry` (`backend/src/2_domains/health/entities/FoodCatalogEntry.mjs`) carries
`id, name, normalizedName, nutrients{calories,protein,carbs,fat}, source, barcodeUpc,
useCount, usageByBucket, favorite, icon, lastUsed, createdAt`. `icon` is a manifest slug or
null — see [Food icons](#food-icons). `usageByBucket` is per-meal-bucket history —
see [the quick-add ranking](#the-ranking) — and defaults to `{}`, never null. `source` is `'manual' | 'nutritionix' | 'custom'`
depending on origin; entries created via `createCustom` (the barcode-mapping flow, or any
direct `POST /nutrition/catalog`) are always `source: 'custom'`. `favorite` is a persisted
boolean, toggled from `EntryEditSheet`'s star button via `PUT /nutrition/catalog/favorite {
id?, name?, favorite }` (resolves by id or by normalized name), and is the top sort key in
`suggest()`. The catalog lives at `lifelog/nutrition/food_catalog.yml` per user — the
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
`cli/migrate-saved-meals-to-templates.mjs` using its dry-run option first.

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
| `PUT /nutrition/catalog/icon` | pin a food's icon by id or name — the "always for this food" override |
| `POST /nutrition/catalog/backfill` | seed the catalog from existing log history |
| `GET /nutrition/meals`, `POST /nutrition/meals`, `POST /nutrition/meals/:id/log`, `DELETE /nutrition/meals/:id` | legacy saved-meal compatibility; no surface lists them |
| `GET /nutrition/templates?includeProposed=` | meal templates; proposals are hidden unless asked for |
| `POST /nutrition/templates` | create a template (`{ name, icon?, components }`), 400 on an invalid shape |
| `POST /nutrition/templates/:id/instantiate` | log it as a dish group (`{ date?, mealTime?, variantNames? }`); 404 unknown, **409** for a proposal nobody approved, **400** for a selection that would write nothing |
| `POST /nutrition/templates/:id/approve` | turn a mined proposal into a template (`{ name? }`) |
| `POST /nutrition/templates/:id/dismiss` | refuse a proposal; its key is remembered forever |
| `DELETE /nutrition/templates/:id` | remove a template |
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
