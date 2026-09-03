# Health UI: routed tabs, week-strip navigator, richer weight chart

2026-09-02

## Summary

Three bundled Health-app UI improvements, implemented and verified in dev
(vite 3112 / backend 3113) against real prod-shared data.

## 1. Real react-router routes for the tabs

- `frontend/src/main.jsx` — added `/health/*` alongside the existing `/health`
  route (LifeApp `/life/*` precedent).
- `frontend/src/Apps/HealthApp.jsx` — dropped `useState` tab state. Active tab
  now derives from `useLocation().pathname` via `tabForPath()`; `AppChrome`'s
  `onTabChange` calls `useNavigate()` through a `TAB_PATH` map
  (`today → /health`, `progress → /health/progress`, `health → /health/medical`,
  `coach → /health/coach`). Tab bodies are now `<Route>`s inside an internal
  `<Routes>` (`index` = Today, `progress`, `medical`, `coach`), with a
  catch-all `path="*"` that `<Navigate to="/health" replace>`s — any unknown
  subpath renders Today rather than a blank/404 tab. The ⌘K `ChatOverlay` is
  unchanged, still rendered as a sibling outside the routed tab body.

## 2. Week strip day-navigator in TodayView

- New `frontend/src/modules/Health/today/WeekStrip.jsx` — 7 cells (6 days
  before the viewed date + the viewed date, capped at `today`), each showing
  a weekday letter, day number, compact food-kcal total (`1.2k` style), and
  an under/over/no-data status dot. The viewed date is highlighted; tapping a
  cell calls `onDateChange`. Data fetch mirrors ProgressView's 14-day
  adherence effect exactly: one `Promise.all` over
  `api/v1/health/budget?date=`, 409 (`NO_WEIGHT_DATA`) tolerated as a gap, and
  the in-flight batch discarded on unmount via a `live` flag.
- Wired into `frontend/src/modules/Health/today/TodayView.jsx` directly under
  `EquationStrip`; `DateStepper` (inside EquationStrip) is unchanged and
  still reaches beyond the strip's 7-day window.
- SCSS added to `frontend/src/modules/Health/health.scss` — `--ds-*` tokens
  only; `audit:ui` gate confirmed clean (no new raw-color/raw-motion
  violations vs. baseline).
- Test: `frontend/src/modules/Health/today/WeekStrip.test.jsx` — 5 cases
  (cell count, kcal + status-dot rendering incl. an `over` day, a real 409
  gap day, tap → `onDateChange`, unmount-mid-flight doesn't throw).

## 3. ProgressView chart upgraded to Weight.jsx's treatment

`frontend/src/modules/Health/progress/ProgressView.jsx` — ported from
`Weight.jsx` (left untouched, per instructions):
- Weekly vertical `xAxis.plotLines` (Monday boundaries across the 84-day
  window — Weight.jsx's month-boundary plotLines, at week cadence to match
  the `tickInterval: 7` grid already in place).
- Visible point markers on the areaspline series (`marker.enabled: true`,
  small filled circles), replacing the previous `marker.enabled: false`.
- Matching per-point tooltip (`<b>date</b>: N.N lbs`).
- Kept unchanged: ProgressView's token-derived colors (`readTokens()` off
  `--ds-*`), the goal dashed line, and the 84-day window.

## Verification

- `npx vitest run frontend/src/modules/Health frontend/src/Apps --reporter=dot`
  — **28 files / 121 tests, all passed** (includes the 2 new test files).
- `node scripts/audit-ui-tokens.mjs` — clean, no new violations.
- Browser (Playwright, 390×844 and 1280×900, settled captures against the
  running dev server):
  - `/health/progress` direct URL loads Progress with the upgraded chart.
    Screenshots confirm faint weekly vertical gridlines across the plot and
    small circular markers along the blue areaspline line at every data
    point; the green dashed goal line at 180 lbs and token colors are intact.
  - `/health/medical` direct URL loads MedicalView directly (confirmed "No
    medical readings yet" empty state, Health tab highlighted).
  - `/health` renders the week strip with real totals (e.g. `T27 1.5k`,
    `M31 283`, viewed day `W2 370`) and correct status dots; tapping the
    earliest cell (Aug 27) moved `DateStepper` from "Today" to "Thu, Aug 27"
    and the ledger below switched to that day's real rows (Grilled Beef,
    Teriyaki Chicken, etc.).
  - Deep-link `/health/progress` + `page.reload()` stayed on
    `http://localhost:3112/health/progress` (no bounce to Today).
- `BASE_URL=http://localhost:3112 npx playwright test tests/live/flow/health/ --reporter=line`
  — **3 passed** (`health-barcode-lifecycle`, `health-fast-log`,
  `health-sentence-parse`), confirming `page.goto('/health')` still lands on
  Today.

No data created during verification required cleanup — all browser checks
were read-only navigations against real GET endpoints; no POST/PUT/DELETE was
issued outside the Playwright flow suite's own self-cleaning tests.
