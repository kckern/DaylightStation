# Health App Observability Sweep

**Date:** 2026-09-02
**Scope:** frontend/src/modules/Health/**, frontend/src/lib/hooks/useApiResource.js, backend/src/{3_applications,4_api}/health/**
**Method:** full read of every capture/edit/saved-meal/medical/progress source file + live VictoriaLogs queries against the prod store (port 9428) + git/build.txt cross-check.

## Verdict

**Mostly.** The bulk of the new Health surface (capture funnel, edit sheet, saved meals, medical, progress, catalog) follows the house `createAppLogger('health').child(...)` convention correctly and logs the right things at the right levels. But there are real gaps: two components construct their own logger without the `app: 'health'` tag (invisible to `context.app:health` queries even though they ship), a handful of catch blocks swallow errors with no log call at all, one backend soft-fail path logs nothing, and — most importantly for "will this actually be seen" — **zero `context.app:health` events have landed in VictoriaLogs since the current build went live** (2026-09-02 16:28 PDT), so the pipeline is unverified end-to-end in production as of this audit.

## Live verification (VictoriaLogs, port 9428)

```
curl -s http://localhost:9428/select/logsql/query -d 'query=context.app:health AND _time:24h | stats count()'
→ {"n":"0"}
```

Zero. Broadened the search (`_msg:~"health"`, any app) and found the real picture:

| Source | `_msg` | count (24h) | Notes |
|---|---|---:|---|
| backend, `context.app:api` | `health.daily.success` | 212 | cron/dashboard polling, not user action |
| backend, `context.app:api` | `health.coaching.schema.loaded` | 23 | schema fetch, not the save path |
| backend, `context.app:api` | `health.catalog.quickadd` | 1 | one real quickadd |
| backend, `context.app:api` | `health.nutrition.input.error` | 1 | **a real production bug**, see below |
| frontend, `context.app:frontend` (not `health`) | `nutrition.input.submit` / `.failed`, `nutrition.quickadd.success` | 3 | see root-cause below — **pre-refactor code**, `NutritionCard` component |
| frontend, `context.app:frontend` | `schema-fetch-start/success`, `mounted`, `save-start/success` (CoachingComplianceCard) | 44 | **real production traffic, mistagged** — see Gap #1 |

Note that backend health events land under `context.app:"api"` (all backend routers share that app label; the health-specific tag is `context.module:"health-api"` or the event-name prefix `health.*`), so `context.app:health` was never going to match backend traffic — that part is expected and fine. The interesting result is the **frontend** side: `context.app:health` never appears because two different problems compound:

**Root cause 1 — stale traffic.** The 3 `nutrition.*` events (18:42–18:43 UTC) came from a `HeadlessChrome` user agent (automated test), and their component name is `NutritionCard` — a component **retired earlier today** (commit `189afa984 feat(health-ui): progress and medical tabs; retire hub-era surfaces`). Deployed `build.txt` shows the current container was built at **16:28 PDT (23:28 UTC)**, i.e. *after* those test events fired. So those 3 events are pre-refactor traffic against the old container; they say nothing about whether today's `createAppLogger('health')` code round-trips.

**Root cause 2 — nothing has exercised the app since the redeploy.** Queried `_time:[2026-09-02T23:28:00Z, now]` (since the current build went live) for `context.app:health` or any of the new component names (`add-combobox`, `entry-edit`, `barcode-capture`, `capture`, `medical`, `progress`, `pending-card`, `saved-meals`, `custom-food`, `voice-capture`) — **zero rows**. Nobody has used the current Health build's Today/Medical/Progress views yet, so the new logging code is unverified in production. Recommend a real click-through (combobox pick, one quickadd, one delete) followed by re-running the query above.

The 44 `CoachingComplianceCard` events *are* real, current, post-deploy production traffic (coaching-compliance saves) — but per Gap #1 below they land under `context.app:"frontend"`, not `health`, so they would never surface in a `context.app:health` query despite being the single largest slice of real Health-adjacent usage today.

## Findings — frontend

| Key behavior | File | Event name(s) | Level | Ships? | Verdict |
|---|---|---|---|---|---|
| Text/photo/voice/barcode capture submit | `capture/useNutritionInput.js` | `capture.submit` / `capture.result` / `capture.failed` | info/info/error | Yes | OK |
| Barcode camera decode (native + zxing) | `capture/BarcodeCapture.jsx` | `decode.native` / `decode.zxing` / `camera.unavailable` | info/info/warn | Yes | OK |
| Voice record start / mic denied | `capture/VoiceCapture.jsx` | `voice.start` / `voice.mic_unavailable` | info/warn | Yes | OK |
| Custom food creation (unknown UPC) | `capture/CustomFoodSheet.jsx` | `custom.created` / `custom.failed` | info/error | Yes | OK |
| Combobox suggest (debounced typeahead) | `today/AddCombobox.jsx` | `suggest.failed` | warn | Yes | OK (success path intentionally quiet — high-frequency, correct call) |
| Combobox quickadd pick | `today/AddCombobox.jsx` | `quickadd.done` / `quickadd.failed` | info/error | Yes | OK |
| Combobox free-text sentence submit | `today/AddCombobox.jsx` | `sentence.submit` / `sentence.failed` | info/error | Yes | OK |
| Accept/Discard an AI-parsed entry | `today/PendingConfirmCard.jsx` | `pending.action` / `pending.action_failed` | info/error | Yes | OK |
| **Revise an AI-parsed entry** (resubmit corrected text) | `today/PendingConfirmCard.jsx` `submitRevision()` | *none* | — | **No** | **GAP** — no `logger.info`/`.error` call at all on success or failure; error is caught and swallowed into local `setError()` only, so it never even reaches the global `unhandledrejection` net. One-line fix: add `logger.info('revision.submit', {})` before the call and `logger.error('revision.failed', { error: err?.message })` in the catch. |
| Portion scale / move bucket / save-as-meal / delete an entry | `today/EntryEditSheet.jsx` `run()` | `portion`/`move`/`save-as-meal`/`delete` (+ `.failed`) | info/error | Yes | OK |
| **Favorite an entry from the edit sheet** | `today/EntryEditSheet.jsx` (inline handler, not via `run()`) | `favorite` on success only | info (success) | **No log on failure** | **GAP** — `catch (err) { setError(err); }` has no `logger.error` call. One-line fix: add `logger.error('favorite.failed', { name: row.name, error: err?.message })` in the catch. |
| Log a saved meal into today | `today/SavedMealsSheet.jsx` | `meal.logged` / `meal.log_failed` | info/error | Yes | OK |
| **TodayView dashboard load** (drives the morning-brief coach line) | `today/TodayView.jsx` line 47, `useApiResource('api/v1/health/dashboard', { label: 'dashboard' })` | `api.loaded`(debug)/`api.failed`(warn) | debug/warn | Failures ship, but **mistagged** | **GAP** — no `logger` option passed, so it falls back to `useApiResource`'s `defaultLogger = createAppLogger('ds')`. A dashboard-load failure ships as `context.app:"ds"`, not `health`. One-line fix: pass the module's own `logger` (there isn't one at module scope in TodayView yet — add `const logger = createAppLogger('health').child('today');` and pass it). |
| **Copy a past day's bucket to today / save a bucket as a named meal** | `today/TodayView.jsx` `copyMealToToday()` / `saveBucketAsMeal()` | *none* | — | Ships only via the global `unhandledrejection` handler (generic, unattributed) | **GAP (minor)** — no local try/catch or logging; a failure is only visible as a generic `window.error`/`unhandledrejection` event, not queryable as a health behavior. Recommend wrapping both in try/catch with `logger.info`/`logger.error` under `today`-scoped events (`copy-to-today`, `save-bucket-as-meal`). |
| Weight/goals load, goal edit save | `progress/ProgressView.jsx` | `goals.saved` / `goals.save.failed` | info/error | Yes | OK |
| 14-day adherence bar fetch gaps (expected 404s) | `progress/ProgressView.jsx` | `adherence.day.gap` | debug | No (by design) | OK — correctly kept off the wire; high-frequency/expected, not a failure |
| Medical reading add/remove | `medical/MedicalView.jsx` | `reading.added`/`.add.failed`, `reading.removed`/`.remove.failed` | info/error | Yes | OK |
| **Coaching-compliance card** — schema load, mount, save | `widgets/CoachingComplianceCard.jsx` | `schema-fetch-start/success/fail`, `mounted`, `save-start/success/fail` | info/error | Ships, but **mistagged** — this is the #1 live GAP | **GAP** — uses `getLogger().child({ component: 'coaching-compliance-card' })` directly instead of `createAppLogger('health').child(...)`. Confirmed live: 44 events in the last 24h, all under `context.app:"frontend"`, none under `health`. This is the single largest slice of real Health traffic today and it's invisible to any `context.app:health` query. One-line fix: `const logger = createAppLogger('health').child('coaching-compliance-card');` in place of the direct `getLogger().child(...)` call. |
| Coach chat overlay / chat panel (message send, tool calls) | `ChatOverlay/index.jsx`, `CoachChat/index.jsx` | *none present* | — | No | **GAP (secondary, out of primary sweep scope)** — no `logger`/`createAppLogger` import in either file; both are thin ~40-line wrapper components with no direct fetch/catch of their own (the actual chat networking presumably lives in a shared agent-chat component not covered by this sweep). Flagging for a follow-up pass rather than a one-line fix — need to locate where the actual send/receive happens before prescribing a change. |

`useApiResource.js` itself: `api.loaded` at debug (correct — high-frequency, console-only by design) and `api.failed` at warn (ships) — **OK**, matches the house rubric. The only issue is call sites that don't pass their own `logger` (see TodayView gap above), which is a call-site problem, not a hook problem.

## Findings — backend

| Key behavior | File | Event name(s) | Level | Ships? | Verdict |
|---|---|---|---|---|---|
| Daily aggregate fetch | `routers/health.mjs` | `health.daily.request`(debug) / `health.daily.success`(info) | debug/info | Success ships | OK |
| Coaching schema load/save | `routers/health.mjs` | `health.coaching.schema.loaded`/`.load_failed`, `health.coaching.saved`/`.save_failed` | info/warn | Yes | OK |
| Nutrilist item create/update/delete (CRUD) | `routers/health.mjs` lines 446/469/491 | `health.nutrilist.create`/`.update`/`.delete` | **debug** | **No — never ships** | **GAP** — per the house rule ("debug-level events are NEVER shipped"), the create/update/delete of a food-log line item — arguably the most frequent write in the whole app — is invisible server-side. The frontend side of delete (`EntryEditSheet`'s `run()`) does ship its own `delete`/`delete.failed` events, so the *user-facing* delete action is covered from the client — but there is no server-side confirmation event, and any success/failure that happens purely server-side (e.g. a delete triggered by another surface later) would be silent. Recommend bumping at least `health.nutrilist.delete` to `info` — deletes are destructive and infrequent enough not to be a volume concern. |
| **Nutrilist delete "found but not deleted" branch** | `routers/health.mjs` line 493-500 | *none* | — | **No — total silence** | **GAP** — when `healthOperations.deleteNutritionItem()` returns `{found:true, deleted:false}` (a soft store-write failure, not a thrown error), the router calls `sendInternalError(res, {...})` and nothing else. `sendInternalError` (`backend/src/4_api/utils/internalError.mjs`) is a pure HTTP responder with **zero logging** — it doesn't call the global error middleware either, since no exception was thrown. This is the only backend failure path in the whole sweep with no log event whatsoever. One-line fix: add `logger.error?.('health.nutrilist.delete.write_failed', { userId, uuid })` right before the `sendInternalError` call. |
| Catalog quickadd | `FoodCatalogService.mjs` + router | `health.catalog.quickadd`(info) / `health.catalog.quickadd.error`(error, router) | info/error | Yes | OK — confirmed live (1 real event today) |
| Catalog usage-bump / entry-create (internal, from quickadd/backfill) | `FoodCatalogService.mjs` | `health.catalog.usage_recorded`, `health.catalog.entry_created` | debug | No | OK by design — these are internal bookkeeping steps of the already-logged `quickadd`/`backfill` calls, not standalone user actions |
| Catalog favorite toggle (star an entry) | `routers/health.mjs` line 580-592 | *none on failure* | — | **No** | **GAP** — `catch (err) { return res.status(404).json(...) }` has no `logger.error` call. Same shape as the frontend favorite gap — both ends of this feature are silent on failure. One-line fix: add `logger.error?.('health.catalog.favorite.error', { id, name, error: err.message })`. |
| Custom food creation, catalog search/recent/suggest | `routers/health.mjs` lines 514-604 | *none locally* | — | Ships via global `http.error.unexpected`/`http.error.domain` (generic) | **GAP (minor)** — no local try/catch, so failures fall through to the global `errorHandlerMiddleware`, which DOES log (`context.app:"http"`, `context.module:"middleware"`, error/warn level) — so nothing is silently lost, but the event carries no `health.*` name and no route/path field, making it hard to isolate "catalog create failed" from any other unhandled router error. Acceptable as a safety net; not worth a change unless catalog-create failures start showing up and are hard to find. |
| Goals save, saved-meal create/log/remove, medical add/remove ("honest-write throws") | `BudgetService.mjs`, `SavedMealsService.mjs`, `MedicalReadingsService.mjs` (throw) + `routers/health.mjs` catch blocks (log `write_failed` at error) | `health.budget.goals_saved`(info) + `health.goals.put.write_failed`/`health.meals.create.write_failed`/`.log.write_failed`/`.remove.write_failed`/`health.medical.add.write_failed`/`.remove.write_failed` (error) | info/error | Yes | OK — clean pattern: datastores throw honestly, services set no false success, router catches and logs every one at error level |
| `GOALS_NOT_CONFIGURED` / `NO_WEIGHT_DATA` budget errors (expected, not bugs) | `BudgetService.getBudget()` → router `/budget` | *none* | — | No (by design — router returns 409 before the generic error path) | **GAP (minor)** — these are common first-use states ("you haven't set goals yet"), not a bug, so skipping `error` level is reasonable, but there's currently no breadcrumb at all (not even debug) to distinguish "budget widget is blank because goals aren't set" from any other blank state during support debugging. Low priority; consider a `logger.debug?.('health.budget.not_configured', { userId, code: err.code })` if this becomes a support question. |
| LogFoodFromUPC (nutribot barcode pipeline) | `LogFoodFromUPC.mjs` | `logUPC.start`(debug), `logUPC.catalogHit`(info), various `.*Failed`(warn), `logUPC.complete`(info), `logUPC.error`(error) | mixed, mostly right | Yes for the ones that matter | OK — start is debug (fine, high-frequency), the two outcomes that matter (`complete`, `error`) are info/error |

## Ranked GAP list (highest impact first)

1. **CoachingComplianceCard mistags `context.app`** — `widgets/CoachingComplianceCard.jsx:208`. Uses `getLogger().child({component:...})` instead of `createAppLogger('health').child(...)`. Confirmed live: 44 real events today, none visible under `context.app:health`. Fix: swap the logger construction to `createAppLogger('health').child('coaching-compliance-card')`.
2. **Backend nutrilist delete soft-fail is fully silent** — `routers/health.mjs:493-500`. `sendInternalError` has zero logging; add a `logger.error?.()` call before it.
3. **PendingConfirmCard "Revise" path has no logging at all** — `today/PendingConfirmCard.jsx:30-37`. Error is caught and swallowed with no log call, so it doesn't even reach the global `unhandledrejection` net. Add `logger.info('revision.submit', {})` / `logger.error('revision.failed', {...})`.
4. **Favorite-an-entry is silent on failure, both ends** — `today/EntryEditSheet.jsx:64-73` (frontend) and `routers/health.mjs:580-592` (backend catalog favorite route). Both catch and drop the error with no log call. Add one `logger.error` line to each.
5. **TodayView's dashboard load uses the wrong app tag** — `today/TodayView.jsx:47`, no `logger` passed to `useApiResource`, defaults to `createAppLogger('ds')`. Failures ship but under `context.app:"ds"`, invisible to health queries. Add a `today`-scoped logger and pass it.
6. **Backend nutrilist create/update/delete are debug-only** — `routers/health.mjs:446/469/491`. Per the house rule, debug never ships; the single most frequent write in the app (logging/editing/deleting a food entry) has no server-side confirmation event in the store. Bump at least `delete` (destructive, low-volume) to info.
7. **Copy-to-today / save-bucket-as-meal have no local logging** — `today/TodayView.jsx`, `copyMealToToday`/`saveBucketAsMeal`. Relies entirely on the generic `unhandledrejection` net. Add try/catch + named events.
8. **ChatOverlay / CoachChat have no logging at all** — thin wrapper components, no `logger` import. Needs a follow-up pass to find where the actual chat network calls live (not in these two files) before prescribing a fix.
9. **Catalog create/search/suggest/recent have no local try/catch** — falls through to the generic `http.error.unexpected` safety net (does ship, just not name-attributable to health). Low priority.
10. **`GOALS_NOT_CONFIGURED`/`NO_WEIGHT_DATA` have zero breadcrumb** — reasonable to skip error-level (expected states), but no debug trace either. Low priority, only worth fixing if it becomes a support question.

## Bottom line

- **Backend**: solid. The "honest-write throws → service doesn't swallow → router catches and logs at error" pattern is followed almost everywhere; the one clean miss is the nutrilist-delete soft-fail branch (#2), and CRUD success events are debug-throttled (#6) which is defensible but means the store has no direct record of "an entry was deleted" from the server side.
- **Frontend**: the convention (`createAppLogger('health').child(component)`, info for success, error for failure) is used correctly in the large majority of call sites (capture funnel, edit-sheet actions, saved meals, medical, progress/goals). The exceptions are concrete and small: one component that never adopted the convention (#1, and it's the one with real live traffic), a couple of swallowed catches (#3, #4), one mistagged hook call (#5), and two unwrapped fire-and-forget handlers (#7).
- **Live confirmation**: not yet possible for the *current* build — no `context.app:health` traffic exists since the 16:28 PDT redeploy. The only post-deploy Health-adjacent traffic (CoachingComplianceCard, 44 events) is mistagged per #1. Recommend a short manual click-through (one combobox quickadd, one delete, one medical add) followed by re-running `context.app:health AND _time:1h | stats by ("_msg") count()` to confirm the pipeline round-trips for the refactored code, not just prove it in theory from reading `Logger.js`/`FrontendLogIngestion.mjs`.

## Bonus finding (unrelated to logging coverage, found while sweeping)

Live in the store: `nutrition.input.failed` / `health.nutrition.input.error` at 18:42 UTC today —
```
data.error: "this[#inputRouter].handleText is not a function"
```
A real production error on the text-input submit path (pre-refactor `NutritionCard`, so may or may not still reproduce on the current build — worth a quick manual check of `AddCombobox`'s `sentence.submit` path, since it hits the same `POST /api/v1/health/nutrition/input` endpoint). Reporting only, per audit scope — not fixed here.
