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
| Today | `modules/Health/today/TodayView.jsx` | the day log — equation strip, meal-bucketed rows, capture affordances |
| Progress | `modules/Health/progress/ProgressView.jsx` | weight trend chart, 14-day budget-adherence bars, goals editor |
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
5. Sums `exercise` from that date's workout sessions (`calories`, tolerant of an array or a
   keyed object).
6. Returns `{ date, budget, food, exercise, net, remaining, status, stale, sessions, goals }`
   — `status` is `'under'` when `remaining >= 0`, else `'over'`.

Both 409 codes are UI signal, not failure: `EquationStrip` shows a "Set up goals" button
on `GOALS_NOT_CONFIGURED`/`NO_WEIGHT_DATA` rather than an error state.

`GET/PUT /api/v1/health/goals` round-trip the goals document unmodified — `PUT` replaces
the whole object and echoes it back.

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
`EntryEditSheet`'s "Move to" row.

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

## Capture funnels

Four ways to get a food onto the log, all reachable from Today's per-bucket
"+ Add food…" row and the footer's photo/barcode/voice icons.

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

**There is no confirmation gate.** Those use cases still build a `pending` NutriLog
internally, but the router commits it before returning: an auto-commit seam in
`NutribotInputRouter` stamps `settled: false` on every item and runs the same accept path
`AcceptFoodLog` uses (status → `accepted`, `acceptedAt` stamped, NutriList synced), so the
entry is visible and counted straight away. The same seam decorates the response context
the use case sends through, so the inline keyboard that reaches the client offers **Undo**
and **Edit** — never Accept. Those two buttons reuse the existing `x` (discard) and `r`
(revise) callback commands, and Undo now *deletes*: `DiscardFoodLog` marks the log
`deleted` and removes its NutriList rows. The message copy itself matches: a text or image
capture's reply opens with "Logged ✓ — *n* items, *k* kcal" rather than a question, so the
words read as a confirmation and not just the buttons. This applies to every transport —
web, Telegram, and the coach's `log_food` alike.

Two flows are deliberately exempt from the accept half of the seam:

- **Scale** captures keep their multi-step composition flow (tare → density → describe)
  and still mint a `pending` NutriLog for the duration of that flow. A pending row never
  syncs into the day's NutriList, so it doesn't appear among Today's normal rows and
  doesn't count toward the budget; `GET /nutrition/pending?date=` surfaces it separately,
  and Today renders it in a **NEEDS REVIEW** banner above the meal buckets, with its own
  Accept/Discard. That endpoint returns pending rows regardless of origin, but every
  other capture commits on arrival now, so Today filters the banner to scale-origin rows.
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
useCount, favorite, lastUsed, createdAt`. `source` is `'manual' | 'nutritionix' | 'custom'`
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
14 parallel `GET /budget?date=` calls.

---

## API surface

All under `/api/v1/health/`, from `backend/src/4_api/v1/routers/health.mjs`:

| Endpoint | Purpose |
|---|---|
| `GET /budget?date=` | the equation (see above) |
| `GET /goals`, `PUT /goals` | goals document |
| `GET /nutrilist/:date`, `POST /nutrilist`, `PUT /nutrilist/:uuid`, `DELETE /nutrilist/:uuid` | day-log rows (legacy-parity NutriList CRUD) |
| `GET /nutrition/catalog?q=`, `GET /nutrition/catalog/recent` | plain catalog search/recents |
| `GET /nutrition/catalog/suggest?q=` | ranked combobox suggestions |
| `POST /nutrition/catalog/quickadd` | deterministic log from a catalog entry |
| `POST /nutrition/catalog` | create a custom food (optionally `barcodeUpc`-mapped) |
| `PUT /nutrition/catalog/favorite` | toggle favorite by id or name |
| `POST /nutrition/catalog/backfill` | seed the catalog from existing log history |
| `GET /nutrition/meals`, `POST /nutrition/meals`, `POST /nutrition/meals/:id/log`, `DELETE /nutrition/meals/:id` | saved meals |
| `POST /nutrition/input` | unified capture entry point (`type: text\|image\|voice\|barcode`) |
| `POST /nutrition/callback` | resolve a capture's Undo/Edit/portion choice, or a scale-pending Accept/Discard |
| `GET /nutrition/pending?date=` | pending NutriLogs for a date (the scale's NEEDS REVIEW banner) |
| `GET /nutrition/photos/:photoRef` | serve a captured photo (see [Photo persistence](#photo-persistence) below) |
| `GET /medical`, `POST /medical`, `DELETE /medical/:id` | medical readings |
| `GET /dashboard` | aggregate summary (weight/nutrition/sessions/goals) consumed by `TodayView`'s coach-line footer |
| `GET /mentions/all` (separate router, `health-mentions.mjs`) | `@`-mention autocomplete for the coach chat composer (periods, recent days, metrics) |

---

## Related

- [`docs/reference/nutrition/README.md`](../nutrition/README.md) — the fridge-scale/barcode
  scan pipeline that feeds the same NutriList log from the kitchen, independent of this app.
- [`docs/reference/frontend/design-system.md`](../frontend/design-system.md) — the `@/lib/ui`
  primitives and pack theming this app is built on.
