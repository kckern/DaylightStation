# Session History Chart Design

**Date:** 2026-02-14
**Status:** Approved

## Goal

Enable the fitness race chart to render both live sessions and completed past sessions. Users access historical charts through the existing Session Browser app in the fitness plugin menu.

## Architecture

Three layers, no backend changes required:

### 1. Session Data Adapter

A pure function (no React) that transforms a `/api/v1/fitness/sessions/:id` response into the same interface the live chart consumes.

**File:** `FitnessChartApp/sessionDataAdapter.js`

```
createChartDataSource(sessionResponse) → { getSeries, roster, timebase }
```

**Key mapping:**

| API key | Chart key |
|---------|-----------|
| `hr` | `heart_rate` |
| `zone` | `zone_id` |
| `coins` | `coins_total` |
| `beats` | `heart_beats` |

- `getSeries(userId, metric, options)` — Looks up `timeline.participants[userId][shortKey]`, returns a cloned array. Matches the signature of the live `getUserTimelineSeries`.
- `roster` — Built from `session.participants` (v3) or `session.roster` (legacy). Each entry: `{ profileId, name, displayLabel, isActive: true, zoneColor }`. All participants marked `isActive: true` since we're showing the completed snapshot.
- `timebase` — `timeline.interval_seconds * 1000` → `intervalMs`, `timeline.tick_count` → `tickCount`.

### 2. FitnessChartApp Dual-Mode

The existing component accepts a new `sessionData` prop:

```jsx
const FitnessChartApp = ({ mode, onClose, config, onMount, sessionData }) => {
```

**When `sessionData` is provided (history mode):**
- Skip `useFitnessPlugin()` — no live subscriptions, no activityMonitor, no lifecycle registration
- Call `createChartDataSource(sessionData)` to produce `getSeries`, `roster`, `timebase`
- Pass into `useRaceChartData` directly (not `useRaceChartWithHistory` — no dropout tracking or cache management needed for static data)
- `historicalParticipants` is empty — everyone is "present"

**When `sessionData` is absent (live mode):**
- Existing behavior unchanged

The branching produces the same `{ entries, maxValue, maxIndex }` shape. Everything downstream (paths, layout, SVG) stays identical.

### 3. SessionBrowserApp Upgrade

Replace the raw JSON dump in the right panel with the chart:

```jsx
<div className="session-detail">
  <FitnessChartApp
    sessionData={sessionDetail}
    mode="standalone"
    onClose={() => setSelectedSessionId(null)}
  />
</div>
```

- Calendar, session list, date/session fetching — all unchanged
- `fetchSessionDetail` already calls the right endpoint and stores result
- Wrapper container designed for future tab expansion (stats, media, events)
- Detail header (date, duration) can remain above the chart

## Data Flow

**Historical:**
```
SessionBrowser → fetch /sessions/:id → sessionDataAdapter →
  { getSeries, roster, timebase } → useRaceChartData → RaceChartSvg
```

**Live (unchanged):**
```
useFitnessPlugin → { getUserTimelineSeries, participants, timebase } →
  useRaceChartWithHistory → RaceChartSvg
```

## Files Changed

| File | Change |
|------|--------|
| `FitnessChartApp/sessionDataAdapter.js` | **New** — pure adapter function |
| `FitnessChartApp/FitnessChartApp.jsx` | Add `sessionData` prop, conditional branching |
| `SessionBrowserApp/SessionBrowserApp.jsx` | Replace JSON dump with chart component |

## Out of Scope (Future)

- Tabs for stats, media events, voice memos
- Session comparison (overlay two sessions)
- Session screenshots in browser
- Export/share session chart
