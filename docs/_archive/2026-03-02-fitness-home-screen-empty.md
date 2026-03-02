# Fitness Home Screen Renders Empty

**Date:** 2026-03-02
**Severity:** High — home screen is completely non-functional
**Status:** Open

## Symptom

Navigating to `/fitness/home` shows the fitness navbar (with the Home icon active) but the main content area is completely empty. No widgets render — no sessions list, no weight chart, no nutrition panel, no up-next, no coach.

## Root Cause

`home_screen` is missing from the `unifyKeys` normalization array in `FitnessApp.jsx`.

### Data Flow

1. **Config** (`data/household/config/fitness.yml`) defines `home_screen` at the top level with `theme`, `data`, and `layout`.
2. **Backend** (`backend/src/4_api/v1/routers/fitness.mjs:93-114`) reads this config via `loadRawConfig()` and returns it flat — `home_screen` is a top-level key in the API response alongside `plex`, `users`, etc.
3. **Frontend normalization** (`FitnessApp.jsx:863`) moves top-level keys into `response.fitness` via `unifyKeys`:
   ```javascript
   const unifyKeys = ['ant_devices','equipment','users','coin_time_unit_ms',
                      'zones','plex','governance','ambient_led','device_colors','devices'];
   ```
   **`home_screen` is not in this list.** It stays at `response.home_screen` and never reaches `response.fitness.home_screen`.
4. **Config derivation** (`FitnessApp.jsx:648-651`) reads from `fitnessConfiguration.fitness.home_screen` — which is `undefined`:
   ```javascript
   const homeScreenConfig = useMemo(() => {
     const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
     return root?.home_screen || null;
   }, [fitnessConfiguration]);
   ```
   Result: `homeScreenConfig` is always `null`.
5. **Render guard** (`FitnessApp.jsx:1124`) checks `homeScreenConfig && ...` — since it's `null`, the entire `<PanelRenderer>` tree is never mounted.

### Cascade Effects

- **`homeScreenSources`** (`FitnessApp.jsx:654-664`) is always `{}` because it's guarded by `homeScreenConfig?.data`.
- **Auto-navigation** (`FitnessApp.jsx:978-983`) that defaults to home view when no collection is selected also checks `homeScreenConfig` — never fires.
- All home widgets (`FitnessSessionsWidget`, `FitnessUpNextWidget`, `FitnessCoachWidget`, `FitnessWeightWidget`, `FitnessNutritionWidget`) never mount.

## Fix

Add `'home_screen'` to the `unifyKeys` array in `FitnessApp.jsx:863`:

```javascript
const unifyKeys = ['ant_devices','equipment','users','coin_time_unit_ms',
                   'zones','plex','governance','ambient_led','device_colors',
                   'devices','home_screen'];
```

## Secondary Issue: `since=30d` Not Parsed

The config specifies a sessions data source with relative date notation:

```yaml
sessions:
  source: /api/v1/fitness/sessions?since=30d&limit=20
```

The backend sessions endpoint (`fitness.mjs:280-284`) passes `since` directly to `listSessionsInRange(since, endDate, household)` without parsing relative date strings. `"30d"` will be treated as an invalid date, yielding either an error or empty results. The `ScreenDataProvider` silently swallows fetch errors, so the sessions widget would render empty even after the primary fix.

**Options:**
- Parse relative dates (e.g. `30d` → 30 days ago) in the backend sessions endpoint.
- Have the frontend compute the absolute date before fetching in `ScreenDataProvider`.
- Change the config to use a dynamic source resolver that computes dates at fetch time.

## Files Involved

| File | Lines | Role |
|------|-------|------|
| `frontend/src/Apps/FitnessApp.jsx` | 863 | `unifyKeys` array missing `home_screen` |
| `frontend/src/Apps/FitnessApp.jsx` | 648-651 | `homeScreenConfig` derivation reads wrong path |
| `frontend/src/Apps/FitnessApp.jsx` | 1124 | Render guard blocks entire home view |
| `frontend/src/Apps/FitnessApp.jsx` | 978-983 | Auto-nav to home also blocked |
| `data/household/config/fitness.yml` | 4-40 | `home_screen` config (correctly defined) |
| `backend/src/4_api/v1/routers/fitness.mjs` | 93-114 | API returns flat config (correct) |
| `backend/src/4_api/v1/routers/fitness.mjs` | 280-284 | Sessions endpoint doesn't parse relative dates |

## How to Verify

1. Apply the `unifyKeys` fix.
2. Navigate to `/fitness/home`.
3. Confirm the panel layout renders with widget placeholders.
4. Check browser network tab for data source fetches (`/api/v1/health/weight`, `/api/v1/health/daily`, `/api/v1/fitness/sessions`, `/api/v1/health-dashboard/{userId}`).
5. If sessions widget is empty, investigate the `since=30d` parsing issue separately.
