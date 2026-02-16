# Fitness Sessions API Redesign

## Problem

The `GET /api/v1/fitness/sessions` endpoint returns incomplete data:
- `stats: {}` is always empty at both session and participant level
- `media` is a single nullable object, but sessions can have multiple media items
- Per-participant HR metrics (avg/max/min) and coins are not surfaced
- Coin breakdown by zone color is not surfaced
- Challenge and voice memo data is not available in the list view

Rich data exists in the session YAML files (RLE-encoded timeline series, events array, treasureBox) but the list endpoint doesn't expose it.

## Design

### 1. Compute `summary` block at save time

Add a `summary` block to each session YAML, computed by `PersistenceManager` before persisting. This avoids RLE decoding at query time.

**New function:** `buildSessionSummary(sessionData)` — pure function, takes raw session data (with un-encoded series), returns the summary block.

**Location:** New file alongside PersistenceManager (e.g., `frontend/src/hooks/fitness/buildSessionSummary.js`), importable by both PersistenceManager and the backfill script.

**Summary block shape:**

```yaml
summary:
  participants:
    alan:
      coins: 1051
      hr_avg: 132
      hr_max: 178
      hr_min: 88
      zone_minutes: { cool: 2, active: 5, warm: 12, hot: 11 }
    milo:
      coins: 1051
      hr_avg: 125
      hr_max: 165
      hr_min: 92
      zone_minutes: { cool: 3, active: 8, warm: 10, hot: 9 }
  media:
    - mediaId: "606442"
      title: "Mario Kart 8"
      showTitle: "Game Cycling"
      seasonTitle: "Mario Kart"
      grandparentId: 603407
      parentId: 603408
      durationMs: 900000
      primary: true
    - mediaId: "606443"
      title: "Sonic Racing"
      showTitle: "Game Cycling"
      grandparentId: 603407
      parentId: 603409
      durationMs: 500000
  coins:
    total: 2102
    buckets: { blue: 0, green: 255, yellow: 480, orange: 732, red: 635 }
  challenges:
    total: 5
    succeeded: 4
    failed: 1
  voiceMemos:
    - transcript: "Good job everybody. First time doing Mario Kart 7 in a while."
      durationSeconds: 23
      timestamp: 1771039208872
```

**Computation details:**

- **Per-participant HR:** Decode `{slug}:hr` RLE series, compute avg/max/min (exclude nulls)
- **Per-participant coins:** Take final value from `{slug}:coins` series (cumulative)
- **Zone minutes:** Decode `{slug}:zone` series, count ticks per zone symbol, multiply by `interval_seconds`, convert to minutes
- **Media:** Extract from `events` array (type: `media`), compute duration per media item from start/end timestamps, mark longest as `primary: true`. Include mediaId, title, showTitle, seasonTitle, grandparentId, parentId for thumbnail resolution.
- **Coins total/buckets:** Read from `treasureBox`
- **Challenges:** Count events of type `challenge`, partition by `result === 'success'`
- **Voice memos:** Extract from events of type `voice_memo`, include transcript, durationSeconds, timestamp

### 2. API List Endpoint Changes

**Endpoint:** `GET /api/v1/fitness/sessions?since=YYYY-MM-DD&limit=N`

**Trimmed response per session (for list view):**

```json
{
  "sessionId": "20260213185600",
  "date": "2026-02-13",
  "startTime": 1771066560000,
  "durationMs": 1775000,
  "timezone": "America/Los_Angeles",
  "participants": {
    "alan": { "displayName": "Alan", "coins": 1051, "hrAvg": 132, "hrMax": 178 },
    "milo": { "displayName": "Milo", "coins": 1051, "hrAvg": 125, "hrMax": 165 }
  },
  "media": {
    "primary": {
      "mediaId": "606442",
      "title": "Mario Kart 8",
      "showTitle": "Game Cycling",
      "seasonTitle": "Mario Kart",
      "grandparentId": 603407,
      "parentId": 603408
    },
    "others": [
      { "mediaId": "606443", "title": "Sonic Racing", "showTitle": "Game Cycling", "grandparentId": 603407, "parentId": 603409 },
      { "mediaId": "606444", "title": "Forza Horizon 5", "showTitle": "Game Cycling", "grandparentId": 603410, "parentId": 603411 }
    ]
  },
  "totalCoins": 2102,
  "challengeCount": 5,
  "voiceMemoCount": 1
}
```

**Changes from current response:**
- `participants` is now an **object keyed by ID** (was array of `{ id, displayName, stats }`)
- Per-participant stats inlined: `coins`, `hrAvg`, `hrMax`
- `media` is now `{ primary, others }` (was single nullable object)
- All media items include `mediaId`, `grandparentId`, `parentId` for thumbnail resolution
- `stats: {}` removed (was always empty)
- `rosterCount` removed (derivable from `Object.keys(participants).length`)
- `endTime` removed from list (derivable from `startTime + durationMs`)
- `challengeCount` and `voiceMemoCount` added

**Query params unchanged:** `since`, `date`, `limit`, `household`. Flat array, frontend groups by date.

**Detail endpoint** (`GET /sessions/:id`): unchanged, returns full session including the `summary` block via `session.toJSON()`.

### 3. YamlSessionDatastore Changes

`findByDate()` and `findInRange()` read from the `summary` block instead of constructing their own projection. The trimming (list vs detail) happens in the datastore's summary builder.

If a session YAML lacks a `summary` block (pre-backfill), fall back to the current behavior for backwards compatibility.

### 4. Backfill Script

**File:** `cli/backfill-session-summaries.mjs`

**Behavior:**
1. Scans all session YAML files across all households
2. For each session missing a `summary` block:
   - Reads the full YAML
   - Decodes RLE timeline series using an RLE decoder (inverse of PersistenceManager's encoder)
   - Calls `buildSessionSummary()` to compute the summary
   - Writes the `summary` block back to the YAML
3. Dry-run mode by default (`--write` flag to actually persist)
4. Reports: `N sessions scanned, M summaries added, K already had summaries`

Uses the same `buildSessionSummary()` function as PersistenceManager — single source of truth.

**RLE decoder:** New utility function `decodeRLE(encoded)` that reverses the RLE encoding. The backfill script needs this because stored series are RLE-encoded strings; PersistenceManager has access to raw arrays before encoding.

### 5. Frontend Impact: DashboardWidgets.jsx + useDashboardData.js

The API shape change requires updates to two frontend files that consume the sessions list.

#### 5a. `useDashboardData.js` — `fetchRecentSessions()`

**Current behavior** (lines 120-148):
- Fetches `/api/v1/fitness/sessions?since=...&limit=...`
- Filters sessions where `s.media` is truthy (skips sessions without content)
- Passes through `s.participants` (array), `s.media` (flat object), `s.stats`, `s.totalCoins`

**Required changes:**
- Filter check: `s.media` → `s.media?.primary` (sessions without media now have `media: { primary: null, others: [] }` or no media key)
- `s.participants` is now an object keyed by ID, not an array — convert to array for the UI:
  ```js
  participants: Object.entries(s.participants || {}).map(([id, p]) => ({
    id,
    displayName: p.displayName,
    coins: p.coins,
    hrAvg: p.hrAvg,
    hrMax: p.hrMax,
  }))
  ```
- `s.media` is now `{ primary, others }` — flatten for backward compat or pass through as-is (see 5b)
- `s.stats` removed — drop from the passthrough
- `s.totalCoins` unchanged

**Decision: adapt in hook or in component?**
Adapt in the hook (`fetchRecentSessions`). The hook is the data boundary — it already reshapes API data for the UI. The component shouldn't care about API shape changes.

#### 5b. `DashboardWidgets.jsx` — `WorkoutsCard`

**Current field access patterns and their migration:**

| Line(s) | Current Access | New Access | Notes |
|---------|---------------|------------|-------|
| 144 | `s.media.mediaId` | `s.media.mediaId` | No change if hook flattens `primary` into `s.media` |
| 155-156 | `s.media.title` | `s.media.title` | Same |
| 158-163 | `s.media.showTitle` | `s.media.showTitle` | Same |
| 173 | `s.startTime` | `s.startTime` | Unchanged |
| 181 | `s.durationMs` | `s.durationMs` | Unchanged |
| 187 | `s.totalCoins` | `s.totalCoins` | Unchanged |
| 193 | `s.participants?.length` | `s.participants?.length` | Works if hook converts object → array |
| 196-199 | `p.id`, `p.displayName` | `p.id`, `p.displayName` | Works if hook maps entries |
| 204 | `p.stats?.avgHr` | `p.hrAvg` | **Breaking change** — field renamed and promoted |
| 217-225 | `s.media.grandparentId` | `s.media.grandparentId` | Same if hook flattens primary |

**Recommended approach — hook flattens `primary` into `s.media` for backward compat:**

```js
// In fetchRecentSessions(), after getting the API response:
media: {
  ...s.media.primary,           // mediaId, title, showTitle, seasonTitle, grandparentId, parentId
  others: s.media.others || [], // secondary media items (new data, not consumed yet)
}
```

This means `WorkoutsCard` keeps accessing `s.media.title`, `s.media.mediaId`, `s.media.grandparentId` with zero changes. The `others` array is available for future UI enhancements (e.g., showing secondary media thumbnails).

**One breaking change in the component:**
- Line 204: `p.stats?.avgHr` → `p.hrAvg` (the hook now provides `hrAvg` directly on the participant object, not nested under `stats`)

**New UI opportunities (not required, but now possible):**
- Show per-participant coins next to avatars (data now available as `p.coins`)
- Show secondary media thumbnails in the session row
- Show challenge count badge
- Show voice memo indicator icon

#### Summary of frontend changes

| File | Effort | Changes |
|------|--------|---------|
| `useDashboardData.js` | Medium | Reshape `participants` object→array, flatten `media.primary`, map HR field names |
| `DashboardWidgets.jsx` | Minimal | Change `p.stats?.avgHr` → `p.hrAvg` (1 line) |

The hook absorbs the API shape change so the component is minimally impacted.

## Files Modified

| File | Change |
|------|--------|
| `frontend/src/hooks/fitness/buildSessionSummary.js` | **NEW** — pure function to compute summary from raw session data |
| `frontend/src/hooks/fitness/PersistenceManager.js` | Import `buildSessionSummary`, call it in `persistSession()` before encoding series |
| `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs` | Update `findByDate()`/`findInRange()` to read from `summary` block |
| `backend/src/4_api/v1/routers/fitness.mjs` | No changes needed (datastore handles the new shape) |
| `cli/backfill-session-summaries.mjs` | **NEW** — backfill script |
| `frontend/src/modules/Fitness/.../useDashboardData.js` | Reshape API response: participants object→array, flatten media.primary, map field names |
| `frontend/src/modules/Fitness/.../DashboardWidgets.jsx` | Change `p.stats?.avgHr` → `p.hrAvg` |

## Implementation Order

1. `buildSessionSummary.js` — the core computation function
2. Update `PersistenceManager.js` — hook in summary computation at save time
3. `backfill-session-summaries.mjs` — backfill existing sessions (includes RLE decoder)
4. Run backfill on prod data
5. Update `YamlSessionDatastore.mjs` — read from summary block
6. Update `useDashboardData.js` — adapt to new API response shape
7. Update `DashboardWidgets.jsx` — fix `avgHr` field access
8. Verify API response shape and UI rendering match design
