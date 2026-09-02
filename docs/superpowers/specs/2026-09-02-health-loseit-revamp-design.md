# Health App LoseIt-Style Revamp — Design

**Date:** 2026-09-02
**Status:** Approved design, pre-implementation
**Scope:** Big-bang rebuild of the Health frontend around a log-first daily food
log, plus small additive backend pieces. No consumers of the old UI exist; the
HealthHub card grid, hero cards, `HealthDetail` routing, and `Nutrition.jsx`
are retired outright.

## Goal

Approximate the LoseIt (loseit.com) experience: **the daily log table is the
centerpiece** — per-meal sections, per-meal add, a budget equation strip — with
weight, fitness calories, goals, and trends as sidebar window dressing. Food
logging must be fast (benchmark: four taps, no page loads), reuse-friendly
(favorites, saved meals, copy-a-meal), and feed the existing coach agent.

## What exists (build on, do not rebuild)

- **Capture pipelines** — text / voice / image / UPC via nutribot use cases,
  already web-exposed at `POST /api/v1/health/nutrition/input` +
  `/nutrition/callback` (Accept / Revise / Discard).
- **FoodCatalog** — `FoodCatalogEntry` with `barcodeUpc`, `useCount`,
  `recordUsage`, search, recents, quick-add (`FoodCatalogService`).
- **NutriList day CRUD** — `GET/POST/PUT/DELETE /api/v1/health/nutrilist...`.
- **NutriLog** — `meal.time ∈ morning|afternoon|evening|night`, `status ∈
  pending|accepted|rejected|deleted`; per-user YAML stores (hot + archives).
- **Weight** — Withings harvest → `WeightProcessor` → adjusted averages,
  trends; served at `/api/v1/health/weight` and `/api/v1/lifelog/weight`.
- **Coach** — `HealthCoachAgent` on MastraAdapter, read-only tools, dashboard
  assignments, `POST /api/v1/agents/health-coach/run[-stream]`.
- **Scale/Telegram nutribot** — keeps working unchanged; this app reads the
  same log.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Surface | Personal phone (PWA-style) + desktop browser |
| Budget model | Full LoseIt model: goal + weekly rate → daily budget; exercise credits back |
| Capture methods | NL sentence, camera barcode, photo AI, food-DB search — all via existing pipelines; **new**: recents/common combobox |
| Mental health | Skipped for v1 |
| Medical | Simple readings store (BP, labs) as YAML |
| Meal grouping | Loose/optional buckets from existing `meal.time`, flat fallback, no schema change |
| Coach role | Logging copilot (`log_food` write tool) + inline daily insight |
| IA | Log-first; **log table is the screen**, rest is window dressing |
| Approach | A: incremental on existing endpoints, big-bang frontend, plus one new server-side budget endpoint |

## User stories

### Epic 1: The daily loop (core)

- **US-1.1** Opening the app shows **today**: equation strip (budget − food +
  exercise = net, under/over), meal sections, macro totals. No navigation.
- **US-1.2** Log food in under 10 seconds: per-meal "+ Add food" → combobox of
  favorites/recents/catalog matches → pick → portion → done.
- **US-1.3** Type a free sentence ("2 eggs, toast with butter, OJ") → AI parses
  into itemized pending entries → one-tap confirm.
- **US-1.4** Snap a plate photo or scan a UPC with the phone camera → same
  confirm-or-revise flow.
- **US-1.5** Entries group under loose meal buckets (from `meal.time`); items
  can be moved between buckets; flat chronological list is one toggle away;
  unmappable items render in UNGROUPED.
- **US-1.6** Inline edit portion/macros or delete; totals + equation update
  instantly (optimistic, with rollback).

### Epic 2: Reuse & speed

- **US-2.1** Star a catalog food as **favorite**; favorites rank above recents
  in the combobox.
- **US-2.2** Multi-select logged items → **save as named meal**; logging a
  saved meal is one tap and adds all items.
- **US-2.3** Viewing a past day, **copy a meal to today**.
- **US-2.4** Unknown barcode → **create custom food** form (optionally
  AI-prefilled from a label photo) → saved to catalog mapped to that barcode;
  next scan hits instantly.

### Epic 3: Budget & progress

- **US-3.1** Goal config: current weight (Withings) + target weight + weekly
  rate → server-computed daily calorie budget.
- **US-3.2** Fitness session calories credit back into today's budget, visible
  as an EXERCISE section in the log.
- **US-3.3** Progress tab: weight trend vs. goal projection, weekly calorie
  adherence, workout volume (absorbs old Weight chart / hero cards).

### Epic 4: Coach

- **US-4.1** "Log a chipotle bowl, no rice" in chat → coach's `log_food` tool
  creates **pending** entries → same confirm flow. Coach never auto-accepts.
- **US-4.2** Today screen footer shows a 1–2 line coach insight (from existing
  dashboard assignments); tap → full chat.

### Epic 5: Medical readings

- **US-5.1** Record simple readings (BP, resting HR, labs) with date + note
  into `medical.yml`; view as per-metric list + sparkline on the Health tab.

### Benchmark journeys (acceptance)

1. **Fast log:** 12:40pm, phone. Open → Today shows 1,140 remaining → tap
   Lunch "+ Add food" → type "chick" → ⭐ Chicken breast 6oz → tap → portion
   defaults to last-used → Log. Four taps, no page loads.
2. **Barcode lifecycle:** unknown barcode → CustomFoodSheet → create → next
   week the same scan logs it in two taps.

## Screens & IA

**Shell:** `HealthApp.jsx` becomes a thin router-shell with four tabs — bottom
tab bar on phone, left rail on desktop (same components, CSS-driven). Mantine
stays, dark theme stays, ⌘K chat overlay stays global.

### Today (home) — the log table IS the screen

```
┌──────────────────────────────────────────────────────┐
│ ‹  Tue, Sep 2  ›   2,100 − 1,280 + 320 = 1,140 under │  equation strip
├──────────────────────────────────────────────────────┤
│ BREAKFAST                                   420 kcal │
│   🍳 Scrambled eggs         2 lg      140  🟢  ⋯     │
│   + Add food…                                        │  per-meal add (inline combobox)
│ LUNCH / DINNER / SNACKS …                            │
│ EXERCISE                                   +320 kcal │
│   🚴 Zwift ride             42 min   +320   (auto)   │  read-only fitness rows
│ UNGROUPED                                            │  flat fallback
├──────────────────────────────────────────────────────┤
│ 💬 coach one-liner · P 82 C 110 F 41 · [📷] [▦] [🎤] │  footer
└──────────────────────────────────────────────────────┘
```

- **Equation strip** header: `Budget − Food + Exercise = Net, under/over`
  (LoseIt's signature). No ring. Date stepper navigates/edits any day.
- **Per-meal "+ Add food"**: expands an inline combobox in place (favorites →
  recents/frequents → catalog matches; footer row "Saved meals ▸"). Free
  sentence with no pick → NL pipeline → PendingConfirmCard lands **inside that
  meal section**. Bucket is never ambiguous.
- **Exercise section**: fitness sessions as read-only rows with calorie
  credit, feeding the equation visibly.
- **Footer**: macro totals, coach one-liner (tap → chat), camera / barcode /
  voice buttons (results land in the time-of-day default bucket).
- **Row tap** → edit sheet: portion stepper, macro fields, move bucket, star,
  delete, "save items as meal". Multi-select → save-as-meal / copy-to-today.
- **Desktop**: same table, wider, more columns; **right rail** carries weight
  (current, trend, goal projection), fitness calories this week, goal/target
  status — built last. On phone these collapse into a strip under the footer
  or live in Progress.

### Other tabs

- **Progress:** weight chart + goal projection line, weekly calorie adherence
  bars (intake vs budget), workout volume; goal editor (target weight, weekly
  rate) lives here.
- **Health:** medical readings grouped by metric — latest value, sparkline,
  history; one "add reading" form.
- **Coach:** full-screen chat (existing `CoachChat` + `log_food`); ⌘K overlay
  is a shortcut to the same surface.

### Retired

HealthHub card grid, hero cards, `HealthDetail` routing, `Nutrition.jsx`
(20-parallel-fetch grid). `NutritionDay`'s CRUD logic is absorbed into the
Today log components.

## Data model & new backend pieces

All new stores are per-user YAML under `users/{userId}/`, matching existing
nutrition file patterns. **NutriLog / NutriList / FoodCatalog schemas
unchanged** — big bang is frontend + additive backend.

### 1. Budget (`BudgetService`, application layer)

- Config `users/{id}/apps/health/goals.yml`:
  `{ targetWeightLbs, weeklyRateLbs, activityBaseline, budgetFloor,
  heightIn, birthYear, sex }`.
- `GET /api/v1/health/budget?date=` →
  `{ budget, food, exercise, net, remaining, status }`.
  - `budget` = Mifflin-St Jeor BMR from latest Withings weight × activity
    baseline − (weeklyRateLbs × 3500 ÷ 7), floored at `budgetFloor`
    (default 1,200).
  - `food` = accepted NutriList calories for the date; `exercise` = fitness
    session calories (existing health aggregates).
- Coach reads the same endpoint via existing query/compute tools — the math
  has exactly one home; the UI never computes it.

### 2. Favorites + saved meals (extend FoodCatalog domain)

- `FoodCatalogEntry` gains `favorite: boolean` (default false);
  `PUT /nutrition/catalog/:id/favorite`.
- New `SavedMeal` store `users/{id}/apps/health/meals.yml`:
  `{ id, name, items: [FoodItem-shaped], createdAt, useCount, lastUsed }`.
  Endpoints: list / create-from-log-items / log-to-date / delete. Saved meals
  **snapshot** item values (later catalog edits don't mutate them). Logging
  one writes a single NutriLog (`status: accepted`, `source: api`).
- New `GET /nutrition/catalog/suggest?q=` — one server-side ranked list:
  favorites first, then frequents (useCount × recency), then name matches;
  empty `q` = favorites + recents.

### 3. Unknown barcode → custom food

- `LogFoodFromUPC` miss: web response gains `{ unknownUpc: true, upc }` → UI
  opens CustomFoodSheet → `POST /nutrition/catalog` (entry with `barcodeUpc`,
  `source: 'custom'`) → quick-add.
- Catalog is checked **by UPC before** OpenFoodFacts/Nutritionix, so custom
  mappings win and bad upstream data can be overridden.
- Optional AI prefill: label photo → `chatWithImage` → prefilled macro fields,
  user confirms.

### 4. Medical readings

- `users/{id}/apps/health/medical.yml`:
  `{ readings: [{ id, metric, value, value2?, unit, date, note? }] }` —
  `value2` for BP diastolic. Free-form `metric` with suggested vocabulary
  (bp, resting_hr, glucose, a1c, cholesterol…).
- Router: GET (grouped by metric) / POST / DELETE. Validation only — no domain
  logic, deliberately dumb.

### 5. Coach `log_food` tool

- New `NutritionActionToolFactory` tool wrapping `LogFoodFromText` with the
  user's id (existing decorator chain injects userId). Returns the pending-log
  summary for the coach to narrate. Entries land `pending` → standard confirm
  surface. Never auto-accepts.

### 6. Meal buckets

- No schema change. UI groups by `meal.time`: morning→Breakfast,
  afternoon→Lunch, evening→Dinner, night→Snacks. "Move to bucket" = PUT
  updating `meal.time`. Missing/unmappable → UNGROUPED.

## Capture flows & error handling

**Pending-confirm lifecycle (the one funnel).** Every AI-mediated capture
(sentence, photo, voice, coach `log_food`) produces a NutriLog
`status: pending`, rendered as a PendingConfirmCard inside the target meal
section (itemized rows, Accept / Revise / Discard) via the existing
`/nutrition/input` + `/nutrition/callback` pipeline. Revise → free text →
`ProcessRevisionInput`. Pending items are visible but **don't count** in the
equation strip until accepted. Combobox picks and saved meals are
deterministic and log directly as `accepted`, skipping the funnel.

**Barcode in browser.** Native `BarcodeDetector` where available (the phone
case), `zxing-js` fallback. Decode → `POST /nutrition/input {type: barcode}`.
Miss → CustomFoodSheet. Camera permission denied → toast + manual-UPC field.

**Photo & voice.** Photo → existing image pipeline; "No food detected" →
retry or switch-to-text offer, never a silent drop. Voice: MediaRecorder →
existing transcribe → text parse. Both land pending cards.

**Failure modes.**

- AI parse fails/times out → card shows error with original text preserved +
  retry; input never lost.
- Lookup services down → catalog-by-UPC still works locally; miss falls to
  CustomFoodSheet with "lookup unavailable" note.
- Write fails → optimistic update rolls back, row flashes error state.
- Budget endpoint fails → equation strip renders `—` with food totals still
  shown; the log never blocks on the header.
- **No offline queue in v1** — failed submit keeps the input text in the
  field. Revisit only if it bites.

**Concurrency with nutribot/scale.** Telegram and scale entries appear on next
fetch; Today refetches on focus + after every mutation. No websocket in v1.

**Observability.** Structured logger, `context.app: 'health'`, child
components (`log-table`, `add-combobox`, `barcode-capture`, `pending-card`,
`budget-strip`). Events: capture started/submitted/parsed/accepted/discarded,
combobox suggest latency, barcode decode success/miss, budget fetch fail. All
new backend endpoints log via the framework.

## Testing

**Backend unit (vitest — the `test:unit:vitest` gate):**

- `BudgetService`: BMR fixtures, weekly-rate deduction, 1,200 floor,
  missing-weight fallback (last known + stale flag), exercise credit sum.
- `suggest` ranking: favorites > frequents > matches; empty-query; ties
  deterministic.
- UPC order: catalog `barcodeUpc` short-circuits before OpenFoodFacts; custom
  mapping overrides a known product.
- SavedMeal: snapshot semantics; log-to-date writes one accepted NutriLog.
- Medical validation: shapes, rejects non-finite numbers (no coercion).
- Coach `log_food`: produces `pending`, never `accepted`; userId injection.

**API integration (`tests/live/api/`):** round-trip budget (seeded date),
favorite toggle, saved-meal CRUD + log, medical CRUD, suggest.

**Playwright flows (`tests/live/flow/health/`):**

- *Fast log:* per-meal add → prefix → pick → row appears in that section,
  equation updates. Layout/grouping asserted here (jsdom cannot see layout).
- *Sentence parse:* submit → PendingConfirmCard itemized → Accept → totals
  move. AI gateway down = test **fails** (no-skip policy).
- *Barcode:* headless camera impossible — inject decoded UPC via the same code
  path the scanner calls (a seam, not a pipeline mock). Covers known-hit,
  unknown → CustomFoodSheet → create → re-scan hits catalog.

**Frontend component (vitest/jsdom):** combobox keyboard nav, pending-card
state machine, optimistic rollback, bucket move. No layout assertions.

**Manual before done:** phone (real camera barcode + photo), desktop sidebar,
kitchen-scale commit appearing on refetch.

## Out of scope (v1)

Mental health / mood, social features, reports, challenges, offline queue,
websocket live updates, multi-user switching, water/measurement goals.
