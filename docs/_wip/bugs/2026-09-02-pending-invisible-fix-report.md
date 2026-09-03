# Pending NutriLogs invisible on web Today view + no catalog delete route

2026-09-02 · hotfix, shipped same-day on `main`

## Incident timeline (root cause)

- **11:42** — an old frontend build hit `handleText` on the nutribot input
  pipeline and it 500'd. The NutriLog it was mid-way through creating still
  landed on disk with `status: pending` (the write happens before the
  response is composed), but the browser never received or rendered the
  Accept/Discard card — the response that would have carried it never made
  it back.
- **All morning** — further Telegram-originated logs (breakfast, a
  snack) also sat `pending`. Telegram surfaces pending logs itself (the
  Accept/Discard inline keyboard on the bot message), so those were never
  *lost* — but the web Today view had **no way to query pending logs at
  all**. A pending NutriLog never syncs into the nutrilist (that only
  happens on Accept), so nothing about it showed up in `day.byBucket`,
  `budget`, or any other Today-view data source.
- **Result**: by evening the user's actual food logged over Telegram that
  morning was invisible in the web app — the ledger looked blank/wrong even
  though the data existed on disk in `pending` status the whole time.

## Root cause

The web Today view (`TodayView.jsx` / `useHealthDay.js`) only ever reads
**accepted** data — nutrilist rows and the budget/dashboard endpoints derived
from them. Pending NutriLogs created on any other surface (Telegram, the
scale bridge, a failed AI call that still persisted before erroring) had no
query surface reachable from the web app at all. The existing
`PendingConfirmCard` only renders a pending log that the *current browser
session itself just created* (it's fed straight from the `/nutrition/input`
response, held in React state) — it was never a general "what's pending"
view.

Separately: `POST /api/v1/health/nutrition/catalog` had no matching
`DELETE`, so every live/Playwright test run that created a custom food
(`ZZZ Integration Food`, `Playwright Chicken …`, `Playwright Granola …`)
permanently accreted an entry in the live food catalog with no way to clean
it up — confirmed via the "no delete route" comments already left in
`tests/live/api/health/loseit-endpoints.api.test.mjs` and both Playwright
flow specs before this fix.

## Fix

### 1. `GET /api/v1/health/nutrition/pending?date=YYYY-MM-DD`

Surfaces pending-status NutriLogs for one meal.date, regardless of
originating surface.

- `YamlFoodLogDatastore.findPendingByDate(userId, date)` (new) —
  `findAll(userId, { status: 'pending', date })`, matching the tolerant-read
  behavior of its siblings (`findPending`, `findByDate`).
- **Seam**: the food-log store lives inside the nutribot container
  (`createNutribotServices` → `foodLogStore`), not in `healthServices`. The
  cleanest path onto it without threading a whole nutribot use case through
  the health domain was `WebNutribotAdapter` — it's already the health
  router's one doorway into the nutribot pipeline
  (`healthOperations.nutritionInput`), and `nutribotApi.mjs` already holds
  `nutribotServices.foodLogStore` at construction time. Added
  `WebNutribotAdapter.listPendingByDate(userId, date)` and passed
  `foodLogStore` into its constructor; extended the lazy
  `webNutribotAdapterProxy` in `app.mjs` (nutribot services are wired after
  the health router, hence the proxy) with the same method; added
  `HealthOperations.pendingNutritionAvailable` / `listPendingNutrition`.
- Presenter `PendingNutritionLogPresenter.mjs` projects
  `{ id, createdAt, source, mealTime, items: [{label, calories}] }`.
  `source` (`telegram` | `scale` | `web`) is derived, not stored directly:
  `metadata.source` on a NutriLog records the *input type*
  (text/image/upc/voice/scale), not the platform, since text/image/upc/voice
  all run through both Telegram and the web UI. Scale is the one
  platform-exclusive input type (`metadata.source === 'scale'`), checked
  first; otherwise platform is read off `conversationId`, which
  `WebNutribotAdapter` always stamps `web:{userId}` and the Telegram webhook
  always stamps a bare chat id.

### 2. `DELETE /api/v1/health/nutrition/catalog/:id`

- `IFoodCatalogDatastore.removeById` (port) →
  `YamlFoodCatalogDatastore.removeById` — returns `false` for a missing id
  (caller maps to 404), throws a coded `CATALOG_WRITE_FAILED` error on a
  failed write (same honest-write pattern as `YamlMedicalReadingsDatastore`,
  `YamlHealthGoalsDatastore`).
- `FoodCatalogService.remove(id, userId)` → `NOT_FOUND` when absent.
- Router: 200 `{ ok: true }` / 404 / 500-with-code, matching the
  `/medical/:id` and `/nutrition/meals/:id` sibling routes.

### 3. Frontend — "NEEDS REVIEW" section

`NeedsReviewSection.jsx`, rendered in `TodayView.jsx` above BREAKFAST
whenever `GET /nutrition/pending` returns a non-empty list. Each row: items
summary, total kcal, a source tag (Telegram/Scale/Web), Accept/Discard —
both POST the existing `/nutrition/callback` with
`{"cmd":"a"|"x","id":<logId>}` (the same wire format Telegram's inline
keyboard and `PendingConfirmCard` already use) and reload both the pending
list and the day.

### 4. Scope addition found during live verification: Accept dropped `mealTime`

While verifying the Accept flow live, the coordinator flagged a related live
incident: accepting a pending log through the web callback path was writing
nutrilist rows with `mealTime: null` (landing in "Ungrouped" instead of
their bucket) even though the NutriLog carries `meal.time` — live examples
`c5PtjVxcfl` (morning) and `FG5uhf8IJP` (afternoon), both needing manual
`PUT` fixes.

Root cause: `AcceptFoodLog.execute()` (the use case behind
`{"cmd":"a"}`) builds its own `listItems` array and calls
`nutriListStore.saveMany(listItems)` directly — a **different** write path
from `YamlNutriListDatastore.syncFromLog` (which a prior change, B8, had
already taught to stamp `mealTime: nutriLog.meal?.time ?? null`).
`AcceptFoodLog`'s own item-mapping never carried `mealTime` at all, so
`saveMany`'s `item.mealTime ?? null` always fell through to `null`.

Fix: `AcceptFoodLog.mjs` now stamps
`mealTime: nutriLog.meal?.time ?? null` in the same spot, mirroring
`syncFromLog`.

## Files touched

Backend:
- `backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs` (mealTime fix)
- `backend/src/3_applications/nutribot/ports/IFoodLogDatastore.mjs` (+`findPendingByDate`)
- `backend/src/1_adapters/persistence/yaml/YamlFoodLogDatastore.mjs` (+`findPendingByDate`)
- `backend/src/1_adapters/nutribot/WebNutribotAdapter.mjs` (+`listPendingByDate`, +`foodLogStore` dep)
- `backend/src/5_composition/modules/nutribotApi.mjs` (wires `foodLogStore` into `WebNutribotAdapter`)
- `backend/src/app.mjs` (`webNutribotAdapterProxy.listPendingByDate`)
- `backend/src/3_applications/health/HealthOperations.mjs` (+`pendingNutritionAvailable`, `listPendingNutrition`)
- `backend/src/4_api/v1/routers/health.mjs` (`GET /nutrition/pending`, `DELETE /nutrition/catalog/:id`)
- `backend/src/4_api/v1/presenters/PendingNutritionLogPresenter.mjs` (new)
- `backend/src/3_applications/health/ports/IFoodCatalogDatastore.mjs` (+`removeById`)
- `backend/src/1_adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs` (+`removeById`)
- `backend/src/3_applications/health/FoodCatalogService.mjs` (+`remove`)

Frontend:
- `frontend/src/modules/Health/today/NeedsReviewSection.jsx` (new)
- `frontend/src/modules/Health/today/TodayView.jsx` (wires the section in)
- `frontend/src/modules/Health/health.scss` (`.health-pending` row/tag/heading styles)

Tests (new/updated):
- `AcceptFoodLog.test.mjs`, `FoodCatalogService.remove.test.mjs`,
  `YamlFoodCatalogDatastore.removeById.test.mjs`,
  `HealthOperations.pendingNutrition.test.mjs`,
  `WebNutribotAdapter.listPendingByDate.test.mjs`,
  `PendingNutritionLogPresenter.test.mjs`,
  `NeedsReviewSection.test.jsx` (all new)
- `tests/live/api/health/loseit-endpoints.api.test.mjs` (catalog test now
  deletes its entry; asserts 404 on redelete)
- `tests/live/flow/health/health-fast-log.runtime.test.mjs`,
  `tests/live/flow/health/health-barcode-lifecycle.runtime.test.mjs` (both
  now delete the catalog entries they seed/create; the barcode test also
  discards the pending NutriLog its rescan step silently created — a second
  instance of exactly the "invisible pending" failure mode this fix targets)

## Verification

- `npx vitest run backend/src/3_applications/health backend/src/3_applications/nutribot backend/src/1_adapters/nutribot backend/src/4_api/v1/presenters frontend/src/modules/Health …` — 31 files / 112 tests, all green.
- `npx jest tests/live/api/health/loseit-endpoints.api.test.mjs` (BACKEND_PORT=3112) — 5/5 passing, catalog entry confirmed deleted (second DELETE → 404).
- `npx playwright test tests/live/flow/health/` (BASE_URL=http://localhost:3112) — 3/3 passing; confirmed no `Playwright *` residue left in the live catalog or pending-log store afterward.
- Live, against the dev server (backend 3113 / vite 3112, same data tree as prod):
  1. `POST /nutrition/input {type:'text', content:'one test apple'}` → pending NutriLog created.
  2. `GET /nutrition/pending` returned it (`source: "web"`).
  3. Loaded `/health` at 390×844 — NEEDS REVIEW section rendered above BREAKFAST with the item, kcal, and source tag (screenshot captured).
  4. Clicked Discard in the UI → section disappeared; `GET /nutrition/pending` confirmed empty.
  5. Repeated with `'one test banana'` (mealTime `evening`) and clicked **Accept** in the UI instead — the resulting nutrilist row landed in **DINNER** with `mealTime: "evening"` (not Ungrouped), confirming the AcceptFoodLog fix end-to-end through the real Needs-review UI. Row deleted afterward via `DELETE /nutrilist/:uuid`.
  6. Confirmed the `ZZZ Integration Food` / `Playwright *` catalog test entries were removed via the new DELETE route (empty search results after each suite run).

## Known follow-up (not fixed here, flagged only)

`health-barcode-lifecycle.runtime.test.mjs`'s rescan step calls
`LogFoodFromUPC` against a now-known catalog UPC, which — like every UPC
lookup — always creates a **pending** NutriLog (never auto-accepted). The
test never opened/acted on that resulting PendingConfirmCard, so every prior
run of this suite silently left an orphaned pending log behind (found live,
during this fix, sitting in `GET /nutrition/pending` from an earlier run).
The test now discards it in `afterEach`. This wasn't a hidden data-loss bug
(Telegram/scale pendings are still on-disk and now visible), just further
evidence that "a pending log was created and nobody was watching" is a
recurring shape here — the same shape the NEEDS REVIEW surface exists to
close off for good.
