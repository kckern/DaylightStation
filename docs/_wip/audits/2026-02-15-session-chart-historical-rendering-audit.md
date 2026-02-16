# Session Chart Historical Rendering Audit (2026-02-15)

## Scope

Audit the full data pipeline from fitness session persistence (write) through API retrieval (read) to chart rendering in historical/standalone mode. The objective is to make the session chart for historical sessions visually match what the user saw during the live/realtime session.

Sessions examined:
- 2026-02-04 ~8:54am — Mario Kart Wii, multi-user (includes early dropout)
- 2026-02-13 ~6:24am — Single-user session (broken coins data)
- Multiple sessions via HomeApp dashboard click-to-detail flow

## Executive Summary

Historical session charts have **significant rendering degradation** compared to their live counterparts. Five bugs were found and fixed during this investigation; at least four more remain open. The root causes span three categories:

1. **Data format mismatches** — The adapter that converts API responses to chart data didn't handle the V2 flat series format or zone abbreviations.
2. **Missing runtime context** — Historical mode explicitly nulls out `zoneConfig`, which the chart needs for slope enforcement. The `DEFAULT_ZONE_COIN_RATES` fallback has incorrect zone-to-name mappings.
3. **Cumulative metric handling** — `fillEdgesOnly` preserves interior nulls (correct for HR dropout detection) but wrong for cumulative metrics like `coins_total` where nulls mean "no update this tick" not "user dropped out".

## Data Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ WRITE PATH (Live Session → YAML)                                │
│                                                                 │
│ FitnessSession ──→ PersistenceManager ──→ Backend API ──→ YAML  │
│                                                                 │
│ Key transforms:                                                 │
│   • Zone IDs abbreviated: cool→c, active→a, warm→w, hot→h      │
│   • Series keys compacted: user:alan:heart_rate → alan:hr       │
│   • Series RLE-encoded: [131, 124, 146, 146] → [131, 124, [146, 2]] │
│   • Values rounded (HR→int, beats→1 decimal)                   │
│   • All-null and all-zero series dropped                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ READ PATH (YAML → API → Chart)                                  │
│                                                                 │
│ YAML ──→ YamlSessionDatastore ──→ prepareTimelineForApi ──→ API │
│                                                                 │
│ API response:                                                   │
│   session.timeline.series = { "alan:hr": [...], "alan:zone": [...] } │
│   session.participants = { alan: { display_name, hr_device } }  │
│   session.timeline.tick_count, interval_seconds                 │
│                                                                 │
│ Key transforms:                                                 │
│   • RLE decoded back to arrays                                  │
│   • Timestamps parsed to unix ms                                │
│   • Zone abbreviations NOT expanded (still c/a/w/h)             │
│   • Series keys remain compact (alan:hr, alan:zone, alan:coins) │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ RENDER PATH (API response → SVG chart)                          │
│                                                                 │
│ sessionDataAdapter.createChartDataSource(session)               │
│   → { getSeries, roster, timebase }                             │
│                                                                 │
│ FitnessChartApp:                                                │
│   useRaceChartData(roster, getSeries, timebase, options)        │
│     → buildBeatsSeries() → buildSegments() → enforceZoneSlopes()│
│     → createPaths() → SVG rendering                             │
│                                                                 │
│ Key issues:                                                     │
│   • chartZoneConfig = isHistorical ? null : zoneConfig          │
│   • chartActivityMonitor = isHistorical ? null : activityMonitor│
│   • No zone abbreviation expansion on API read (fixed in adapter)│
│   • Cumulative metrics (coins) get same null-handling as HR     │
└─────────────────────────────────────────────────────────────────┘
```

## Issues Found

### FIXED: F1 — Flat series format not recognized by adapter

**Severity:** Critical (no chart data at all)
**Status:** Fixed
**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/sessionDataAdapter.js`

The API returns timeline series in V2 flat format:
```
timeline.series = { "alan:hr": [...], "alan:zone": [...], "kckern:coins": [...] }
```

The adapter only looked for `timeline.participants` (V1 nested format). Added grouping logic that parses `userId:metric` flat keys into per-user objects.

### FIXED: F2 — Session object unwrapping picked shallow metadata

**Severity:** Critical (no chart data at all)
**Status:** Fixed
**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx:699-706`

When HomeApp passed `sessionData` containing both `.session` (shallow metadata: `{id, date, start, end}`) and `.timeline`, the unwrapping logic `sessionData.session || sessionData` picked the shallow `.session` sub-object (which has no `.timeline`). Fixed to check for `.timeline` presence:
```js
const session = sessionData.timeline ? sessionData
  : (sessionData.session?.timeline ? sessionData.session : sessionData);
```

### FIXED: F3 — Zone abbreviations not expanded on read

**Severity:** High (all zone colors showed as gray/default)
**Status:** Fixed
**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/sessionDataAdapter.js:19`

PersistenceManager abbreviates zone IDs on write (`cool→c`, `active→a`, `warm→w`, `hot→h`). The backend does NOT expand them on read. The adapter now expands via `ZONE_ABBREV_MAP` when building `timelineParticipants`.

### FIXED: F4 — Permanent dropout line not drawn

**Severity:** Medium (user's line disappears after dropout)
**Status:** Fixed
**File:** `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js:462-478`

`buildSegments` only emitted gap segments when a user *rejoined* after dropout. If a user dropped out permanently (e.g., Alan at tick 46 of 409), the gap was opened but never closed, so no flat line was drawn from dropout point to end. Fixed by flushing open gaps at end of the loop.

### FIXED: F5 — "Timeline warming up" shown for historical sessions

**Severity:** Low (incorrect UX message)
**Status:** Fixed
**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx:1142-1143`

Added `!isHistorical` guard. Historical sessions with no data now show "No timeline data for this session" instead of the live-only warming message.

---

### OPEN: O1 — zoneConfig is null in historical mode

**Severity:** High
**Status:** Open
**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx:715`

```js
const chartZoneConfig = isHistorical ? null : zoneConfig;
```

This explicitly discards zoneConfig for historical sessions. The `enforceZoneSlopes` function falls back to `DEFAULT_ZONE_COIN_RATES`, which has incorrect mappings (see O2). The fix should either:
- Pass zoneConfig through for historical mode (derive from session data or household config), OR
- Fix `DEFAULT_ZONE_COIN_RATES` to be correct (see O2) so the fallback works properly

### OPEN: O2 — DEFAULT_ZONE_COIN_RATES has wrong zone names

**Severity:** High
**Status:** Open
**File:** `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js:16-21`

```js
const DEFAULT_ZONE_COIN_RATES = {
  active: 0,    // comment says "blue" but active is GREEN (#51cf66)
  warm: 1,      // yellow
  hot: 3,       // orange
  fire: 5       // red — never appears in persisted data
};
```

Problems:
1. **`active` is NOT blue.** Per `fitness.js` constants: `cool` = blue (#6ab8ff), `active` = green (#51cf66). The comment is wrong and the mapping is misleading.
2. **`cool` is missing.** The actual blue zone (`cool`) is not listed. It falls through to `|| 0` which accidentally gives the right result (0 coins), but this is fragile.
3. **`fire` is listed but never persisted.** PersistenceManager's `ZONE_SYMBOL_MAP` only maps `cool/active/warm/hot`. The `fire` zone is never written to YAML.
4. **`active` should likely have a non-zero coin rate.** In the live system, the active (green) zone earns coins. Setting it to 0 means historical green segments are incorrectly flattened.

**Correct mapping should be:**
```js
const DEFAULT_ZONE_COIN_RATES = {
  cool: 0,      // blue — no coins
  active: 1,    // green — earns coins
  warm: 3,      // yellow
  hot: 5,       // orange
  fire: 7       // red
};
```
*(Actual values should be verified against live zoneConfig from household config.)*

### OPEN: O3 — Sparse coins_total doesn't fall back to heart_beats

**Severity:** High
**Status:** Open
**File:** `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js:258-263`

`buildBeatsSeries` picks `coins_total` as primary source if the array is non-empty and has length > 0:
```js
const coinsRaw = getSeriesForParticipant('coins_total');
if (Array.isArray(coinsRaw) && coinsRaw.length > 0) {
  const beats = fillEdgesOnly(coinsRaw.map(...), { startAtZero: true });
  return { beats, zones, active };
}
```

The Feb 13 6:24am session has `coins = [0, null, null, ..., null]` (1 non-null out of 273 ticks). The array passes the `length > 0` check, but `fillEdgesOnly` produces `[0, 0, 0, ..., 0]` (all zeros since `startAtZero` fills leading, and the single value at index 0 forward-fills trailing). The chart draws a flat line at zero even though `heart_beats` has 273 real values with meaningful data.

**Fix:** Add a quality check before accepting coins_total:
```js
const nonNullCount = coinsRaw.filter(v => Number.isFinite(v)).length;
const qualityThreshold = Math.max(3, coinsRaw.length * 0.05); // at least 5% non-null
if (Array.isArray(coinsRaw) && nonNullCount >= qualityThreshold) {
  // use coins
}
// else fall through to heart_beats
```

### OPEN: O4 — fillEdgesOnly preserves interior nulls in cumulative metrics

**Severity:** Medium
**Status:** Open
**File:** `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js:111-153`

`fillEdgesOnly` was designed for HR data where interior nulls mean "user dropped out". But `coins_total` is cumulative — interior nulls mean "no update this tick" (the value should be forward-filled to the previous value). Using `fillEdgesOnly` on coins creates gaps in the rendered line because `buildSegments` treats null-value ticks as `ABSENT`.

The live system doesn't hit this because TreasureBox updates every tick. But persisted data may have sparse coins (e.g., only recorded on zone transitions or at intervals).

**Fix:** Use `forwardFill` (already exists in the file) for cumulative metrics, or add a dedicated fill pass after `fillEdgesOnly`:
```js
if (Array.isArray(coinsRaw) && coinsRaw.length > 0) {
  const mapped = coinsRaw.map(v => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null));
  const beats = forwardFill(fillEdgesOnly(mapped, { startAtZero: true }));
  return { beats, zones, active };
}
```

### OPEN: O5 — Dual getZoneColor implementations with different hex values

**Severity:** Low (visual inconsistency)
**Status:** Open
**Files:**
- `frontend/src/modules/Fitness/domain/types.js:155-171` — Used by chart helpers
- `frontend/src/modules/Fitness/shared/constants/fitness.js:94-119` — Used elsewhere

| Zone | `domain/types.js` (ZoneColors) | `shared/constants/fitness.js` (ZONE_COLORS) |
|------|-------------------------------|----------------------------------------------|
| cool | `#4fb1ff` | `#6ab8ff` |
| active | `#4ade80` | `#51cf66` |
| warm | `#facc15` | `#ffd43b` |
| hot | `#fb923c` | `#ff922b` |
| fire | `#f87171` | `#ff6b6b` |
| default | `#9ca3af` | `#888888` |

The chart uses `domain/types.js` colors. Other parts of the fitness module use `shared/constants/fitness.js`. This means the same zone shows different colors in different UI locations.

**Fix:** Consolidate to a single source of truth. The `shared/constants/fitness.js` version is more complete (includes aliases like `blue`, `green`, `yellow`, etc.) and should be canonical. Update `domain/types.js` ZoneColors to import from constants.

### OPEN: O6 — Incomplete zone set in persistence

**Severity:** Low
**Status:** Open
**File:** `frontend/src/hooks/fitness/PersistenceManager.js:29-34`

`ZONE_SYMBOL_MAP` only maps 4 of 6 zones:
```js
const ZONE_SYMBOL_MAP = { cool: 'c', active: 'a', warm: 'w', hot: 'h' };
```

Missing: `rest` and `fire`. If a user's HR zone is `rest` or `fire` during a session, it gets passed through unabbreviated (e.g., stored as `"rest"` instead of `"r"`). The read-side `ZONE_ABBREV_MAP` won't need to expand these, but it creates inconsistent encoding. More importantly, `fire` zones in persisted data won't be abbreviated, so the `zone` series has mixed formats: `["c", "a", "w", "h", "fire"]`.

### OPEN: O7 — Blue zone vertical jumps (staircase pattern)

**Severity:** Medium
**Status:** Open — root cause not fully confirmed
**Files:** `FitnessChart.helpers.js` (enforceZoneSlopes, buildSegments)

User reported visible vertical steps/jumps on blue (cool) segments in historical chart. `enforceZoneSlopes` should flatten these (coinRate=0 → all points set to startValue). Potential causes:

1. **O2 + O1 combined:** With null zoneConfig, the fallback to DEFAULT_ZONE_COIN_RATES is used. `cool` → undefined → `|| 0` → 0 (accidentally correct). But if the zone stored was something unexpected (e.g., `"c"` not expanded due to a code path that skips the adapter), it would fall through to 0 anyway. Need to verify via data inspection.

2. **Continuity pass creating micro-jumps:** When enforceZoneSlopes flattens a blue segment, the continuity pass adjusts the first point to match the previous segment's end value. If the previous non-blue segment ended higher than the blue segment's flattened startValue, the first point gets bumped UP, creating a visible step down to the flattened value at the second point.

3. **Rapid zone transitions:** If zones alternate every 1-2 ticks, each segment has very few points. Single-point segments bypass enforceZoneSlopes (< 2 points check). This creates many tiny segments that staircase upward.

4. **Coins awarded during cool zone (TreasureBox lag):** If TreasureBox finalizes coins a tick after zone transition, the persisted `coins_total` may increase during a tick marked as `cool`. The raw data has slope, enforceZoneSlopes flattens it, but the value at the START of the blue segment is already elevated.

**Investigation needed:** Dump the raw segment data for a session exhibiting this pattern (pre- and post-enforceZoneSlopes) to identify which mechanism is causing the visual steps.

### OPEN: O8 — Historical mode has no ActivityMonitor

**Severity:** Low
**Status:** Open
**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx:714`

```js
const chartActivityMonitor = isHistorical ? null : activityMonitor;
```

Without an ActivityMonitor, `buildBeatsSeries` falls back to deriving activity from `heart_rate` nulls. This is correct for detecting dropouts but may differ from what the live ActivityMonitor would have produced (e.g., grace periods, device reconnection handling). This is acceptable for now but means historical charts may show slightly different dropout behavior than what was seen live.

## Data Integrity Assessment

### What is preserved correctly:
- Heart rate series (per-user, per-tick)
- Zone series (per-user, per-tick, abbreviated)
- Coins total series (per-user, per-tick, cumulative)
- Heart beats series (per-user, per-tick, cumulative)
- Participant metadata (display name, HR device, primary/guest)
- Session timing (start, end, duration, interval, tick count)
- Equipment metrics (bike RPM, rotations)
- Events (challenges, media, governance, voice memos)

### What is lost or degraded:
- **Zone config** — Not persisted with session data. The live zoneConfig (coin rates per zone) is only available at runtime from household config. Historical rendering cannot reconstruct it.
- **ActivityMonitor state** — Grace periods, device reconnection timing not persisted.
- **TreasureBox internal state** — Interval progress, partial coin awards.
- **Live edge data** — Sub-tick interpolation between recorded points.
- **Roster isActive transitions** — Only final state is recorded, not when each user's device went inactive.

## Recommended Fix Priority

| # | Issue | Effort | Impact | Priority |
|---|-------|--------|--------|----------|
| O3 | Sparse coins fallback | Small | High — fixes blank charts | **P0** |
| O4 | fillEdgesOnly for cumulative | Small | High — fixes gap artifacts | **P0** |
| O2 | DEFAULT_ZONE_COIN_RATES wrong names | Small | High — fixes slope enforcement | **P1** |
| O1 | zoneConfig null in historical | Medium | High — enables correct slopes | **P1** |
| O7 | Blue zone vertical jumps | Medium | Medium — visual polish | **P1** (likely fixed by O1+O2) |
| O5 | Dual getZoneColor hex values | Small | Low — visual consistency | **P2** |
| O6 | Incomplete zone set in persistence | Small | Low — encoding consistency | **P2** |
| O8 | No ActivityMonitor in historical | Large | Low — minor behavior diff | **P3** |

### Suggested implementation order:
1. Fix O3 + O4 together (coins quality check + forward-fill for cumulative)
2. Fix O2 (correct DEFAULT_ZONE_COIN_RATES zone names and values)
3. Fix O1 (pass zoneConfig to historical mode — derive from household config or embed in session data)
4. Verify O7 is resolved by O1+O2 fixes
5. Fix O5 (consolidate zone colors)
6. Fix O6 (add rest/fire to ZONE_SYMBOL_MAP)

### Long-term recommendation:
Persist the active zoneConfig with each session's YAML file so historical rendering has the exact same configuration that was used during the live session. This eliminates the need for DEFAULT_ZONE_COIN_RATES entirely.

## Related Files

### Write path
- `frontend/src/hooks/fitness/PersistenceManager.js` — Encodes and sends session data
- `frontend/src/hooks/fitness/SessionSerializerV3.js` — V3 serialization format
- `backend/src/2_domains/fitness/services/SessionService.mjs` — Backend save orchestration
- `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs` — YAML persistence
- `backend/src/2_domains/fitness/services/TimelineService.mjs` — RLE encode/decode

### Read path
- `backend/src/4_api/v1/routers/fitness.mjs` — API routes (GET /sessions/:id)
- `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/sessionDataAdapter.js` — API response → chart data interface

### Chart rendering
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js` — buildBeatsSeries, buildSegments, enforceZoneSlopes, createPaths
- `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx` — React component, data source selection
- `frontend/src/modules/Fitness/domain/types.js` — ZoneColors, ParticipantStatus
- `frontend/src/modules/Fitness/shared/constants/fitness.js` — Zone definitions, ZONE_COLORS

### Related audits
- `2026-02-06-fitness-session-persistence-nerf-audit.md` — Events and timestamp regression
- `2026-02-03-fitness-module-architecture-audit.md` — Module architecture overview
