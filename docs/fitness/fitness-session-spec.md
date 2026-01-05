# Fitness Session Data Specification

> **Status:** Draft  
> **Last Updated:** 2025-12-31  
> **Author:** Copilot (Audit)

## Overview

`FitnessSession` is the core data model for tracking workout sessions in the Fitness app. It captures real-time biometric data from ANT+ devices, manages participant rosters, records voice memos, tracks "coins" (gamification), and persists session data to YAML files for historical analysis.

---

## Architecture

### Core Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `FitnessSession` | `FitnessSession.js` | Main session orchestrator |
| `VoiceMemoManager` | `VoiceMemoManager.js` | Voice memo lifecycle |
| `DeviceManager` | `DeviceManager.js` | ANT+ device registration |
| `UserManager` | `UserManager.js` | Participant roster & assignments |
| `FitnessTimeline` | `FitnessTimeline.js` | Time-series data storage |
| `TreasureBox` | `TreasureBox.js` | Coin/gamification tracking |
| `ActivityMonitor` | `ActivityMonitor.js` | Participant activity detection |

### Data Flow

```
ANT+ Device → DeviceManager → FitnessSession.recordDeviceActivity()
                                      ↓
                              _collectTimelineTick()
                                      ↓
                              FitnessTimeline.tick()
                                      ↓
                              _maybeAutosave() → _persistSession() → Backend API
```

---

## Session Lifecycle

### 1. Session Start

**Trigger:** First `recordDeviceActivity()` call or explicit `ensureStarted()`

**Expected Behavior:**
- Generate unique `sessionId` in format `fs_YYYYMMDDHHmmss`
- Set `startTime` to current timestamp
- Initialize `FitnessTimeline` with 5-second intervals
- Start tick timer (5s) and autosave timer (15s)
- `endTime` should remain `null` until session ends

**Current Issues:**
- ✅ Session starts correctly
- ✅ Timers initialize properly

### 2. Active Session

**Data Collection (every 5s tick):**
- Heart rate from HR monitors → `user:{slug}:heart_rate`
- Zone classification → `user:{slug}:zone_id`
- Cumulative heartbeats → `user:{slug}:heart_beats`
- Coin totals → `user:{slug}:coins_total`
- Device metrics → `device:{id}:heart_rate`, `device:{id}:rpm`

**Autosave (every 15s):**
- Call `summary` getter to build payload
- Validate payload with `_validateSessionPayload()`
- Encode series with RLE compression
- POST to `/api/fitness/save_session`

**Expected Behavior:**
- Each autosave should capture the CURRENT state
- `endTime` in autosave should be the current timestamp
- `durationMs` should grow with each autosave

**🐛 BUG FOUND: Duration Always 1ms**

The `summary` getter was mutating `this.endTime`:
```javascript
// BEFORE (buggy)
this.endTime = derivedEndTime;

// AFTER (fixed)
// Do not mutate this.endTime during summary generation
```

This caused the first autosave to lock `endTime` to `startTime + 1ms`, making all subsequent saves report `durationMs: 1`.

### 3. Session End

**Triggers:**
- Manual end (user action)
- Inactivity timeout (3 minutes no device activity)
- Empty roster timeout (1 minute with no participants)

**Expected Behavior:**
- Set `endTime` to current timestamp
- Final `_collectTimelineTick()` to capture last data point
- Force persist with `_persistSession(sessionData, { force: true })`
- Reset all state for next session

**Current Issues:**
- ✅ End triggers work correctly
- ✅ Final persist happens
- 🐛 Duration bug affects final save too

## Timeline Data Structure (Deep Dive)

The timeline is the heart of session data collection. It provides a time-indexed grid of metrics that can be visualized as charts and used for historical analysis.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FitnessTimeline                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│  timebase: {                                                                     │
│    startTime: 1766266514976    // Unix timestamp (ms) when session started      │
│    intervalMs: 5000            // Tick interval (5 seconds)                      │
│    tickCount: 180              // Total number of ticks recorded                 │
│    lastTickTimestamp: 17662... // Timestamp of most recent tick                  │
│  }                                                                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│  series: {                     // Grid of time-series data (columns)             │
│    'user:alan:heart_rate': [128, 130, 135, null, 140, ...],  // 180 elements    │
│    'user:alan:zone_id':    ['a', 'a', 'a', null, 'w', ...],  // 180 elements    │
│    'device:28676:heart_rate': [128, 130, 135, null, ...],    // 180 elements    │
│    ...                                                                           │
│  }                                                                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│  events: [                     // Point-in-time events                           │
│    { tickIndex: 4, type: 'media_start', data: {...} },                          │
│    { tickIndex: 30, type: 'challenge_start', data: {...} },                     │
│    ...                                                                           │
│  ]                                                                               │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Series Grid Conceptual Model

Think of the timeline as a spreadsheet where:
- **Rows** = Time ticks (every 5 seconds)
- **Columns** = Metric series (heart rate, zone, coins, etc.)
- **Cells** = Value at that point in time (or `null` if no data)

```
Tick │ Time     │ user:alan:hr │ user:alan:zone │ user:milo:hr │ device:28676:hr
─────┼──────────┼──────────────┼────────────────┼──────────────┼─────────────────
  0  │ 00:00:00 │     128      │      'a'       │     null     │      128
  1  │ 00:00:05 │     130      │      'a'       │     null     │      130
  2  │ 00:00:10 │     135      │      'a'       │      95      │      135
  3  │ 00:00:15 │     null     │      null      │      98      │      null    ← dropout
  4  │ 00:00:20 │     140      │      'w'       │     102      │      140
  5  │ 00:00:25 │     145      │      'w'       │     105      │      145
 ... │   ...    │      ...     │       ...      │      ...     │       ...
179  │ 00:14:55 │     120      │      'a'       │     null     │      120
```

### Series Key Naming Convention

Series keys follow a hierarchical naming pattern:

```
{entity_type}:{identifier}:{metric_name}
```

| Entity Type | Identifier | Metric Names |
|-------------|------------|--------------|
| `user` | Slug (e.g., `alan`, `milo`) | `heart_rate`, `zone_id`, `coins_total`, `heart_beats` |
| `device` | Device ID (e.g., `28676`) | `heart_rate`, `rpm`, `rotations` |

**Examples:**
- `user:alan:heart_rate` - Alan's heart rate over time
- `user:alan:zone_id` - Alan's zone classification over time
- `user:alan:coins_total` - Alan's cumulative coin count
- `user:alan:heart_beats` - Alan's cumulative heartbeat count
- `device:28676:heart_rate` - Raw device HR reading
- `device:28676:rpm` - Cadence sensor RPM

### Data Collection Per Tick

Every 5 seconds, `_collectTimelineTick()` executes and:

1. **Iterates all registered users** from `UserManager`
2. **Iterates all active devices** from `DeviceManager`
3. **Collects metrics** for each user/device pair:
   ```javascript
   tickPayload = {
     'user:alan:heart_rate': 135,
     'user:alan:zone_id': 'active',
     'user:alan:coins_total': 45,
     'user:alan:heart_beats': 2847,  // cumulative
     'device:28676:heart_rate': 135,
     // ...
   }
   ```
4. **Calls `timeline.tick(tickPayload)`** which:
   - Creates new series arrays if they don't exist
   - Pads existing series with `null` if they're behind
   - Appends the new value to each series
   - Increments `tickCount`

### Handling Dropout (null values)

When a user's device stops transmitting:

```javascript
// Tick 3: Device data received
tickPayload['user:alan:heart_rate'] = 135;

// Tick 4: No device data - user dropped out
// Code detects this and EXPLICITLY records null:
tickPayload['user:alan:heart_rate'] = null;
```

This creates "holes" in the data that charts can render as:
- Dotted/dashed lines (indicating data gap)
- Breaks in the line chart
- Visual indication of inactivity

**Critical:** The system must explicitly record `null` for dropouts. If a key is simply omitted, `FitnessTimeline.tick()` will backfill with `null`, but explicit nulls ensure dropout detection works correctly.

### Series Storage Format (RLE Encoding)

Before persistence, series arrays are Run-Length Encoded for compactness:

```javascript
// In-memory during session:
series['user:alan:heart_rate'] = [128, 128, 128, 135, 135, 140, 140, 140, 140, null, 145]

// After RLE encoding for storage:
series['user:alan:heart_rate'] = '[[128,3],[135,2],[140,4],[null,1],[145,1]]'
```

**Encoding process:**
```javascript
_encodeSeries(series, tickCount) {
  // For each series:
  // 1. Run-length encode the array
  // 2. JSON.stringify the RLE array
  // 3. Store metadata (original length, encoded length)
  
  return {
    encodedSeries: {
      'user:alan:heart_rate': '[[128,3],[135,2],[140,4],[null,1],[145,1]]'
    },
    seriesMeta: {
      'user:alan:heart_rate': {
        encoding: 'rle',
        originalLength: 11,
        encodedLength: 5,
        tickCount: 11
      }
    }
  }
}
```

### Zone ID Compression

Zone IDs are further compressed to single characters:

| Zone Name | Symbol | Color |
|-----------|--------|-------|
| `cool` | `c` | Blue |
| `active` | `a` | Green |
| `warm` | `w` | Yellow |
| `hot` | `h` | Orange/Red |

```javascript
// In-memory:
['cool', 'cool', 'active', 'active', 'warm', 'hot']

// After encoding:
'[["c",2],["a",2],["w",1],["h",1]]'
```

### Events Array

Events capture point-in-time occurrences that don't fit the regular tick cadence:

```yaml
events:
  - timestamp: 1766266536108    # Absolute timestamp
    offsetMs: 21132             # Milliseconds since session start
    tickIndex: 4                # Which tick this occurred during
    type: media_start           # Event type
    data:                       # Event-specific payload
      source: music_player
      mediaId: '140608'
      title: Cotton Eyed Joe (Workout Mix)
      artist: ESPN
      durationSeconds: 190
      
  - timestamp: 1766267000000
    offsetMs: 485024
    tickIndex: 97
    type: challenge_start
    data:
      challengeId: sprint_1
      targetZone: hot
      durationSeconds: 60
```

**Event Types:**
| Type | Description |
|------|-------------|
| `media_start` | Music/video playback started |
| `media_stop` | Media playback stopped |
| `challenge_start` | Challenge initiated |
| `challenge_end` | Challenge completed/cancelled |
| `voice_memo_start` | Voice memo recording began |
| `screenshot` | Screenshot captured |
| `user_join` | User joined session |
| `user_leave` | User left session |

### Timeline Validation

Before persistence, timelines are validated:

```javascript
FitnessTimeline.validateSeriesLengths(timebase, series) {
  // All series arrays MUST have length === tickCount
  // If not, the session is rejected with 'series-tick-mismatch'
}
```

**Common Validation Errors:**
| Error | Cause | Solution |
|-------|-------|----------|
| `series-tick-mismatch` | Series array length ≠ tickCount | Bug in tick collection |
| `series-size-cap` | Total points > 200,000 | Session too long or too many users |
| `series-empty-signal` | All values are null/zero | Device never transmitted valid data |

### 🐛 CRITICAL BUG: Series Data Not Persisted

**Observed Issue:** In production YAMLs, `timeline.series` is `{}` (empty) while `timeline.seriesMeta` contains correct metadata.

**Root Cause Analysis:**

The save flow is:
1. Frontend calls `summary` getter → builds sessionData with `timeline.series`
2. Frontend sends to `/api/fitness/save_session`
3. Backend calls `stringifyTimelineSeriesForFile()` to JSON-encode series
4. Backend saves to YAML

Looking at the actual saved files:
```yaml
timeline:
  series: {}        # ← EMPTY!
  seriesMeta:       # ← HAS DATA
    user:alan:heart_rate:
      encoding: rle
      originalLength: 180
      ...
```

**Hypothesis:** The series data is being stripped somewhere. Likely causes:
1. `_encodeSeries()` returns `encodedSeries` correctly, but assignment fails
2. Backend `stringifyTimelineSeriesForFile()` is corrupting the data
3. YAML serialization is failing for stringified JSON values

**Investigation Needed:**
```javascript
// In _persistSession, add logging:
console.log('Before encode:', Object.keys(sessionData.timeline.series).length);
const { encodedSeries, seriesMeta } = this._encodeSeries(sessionData.timeline.series, tickCount);
console.log('After encode:', Object.keys(encodedSeries).length);
sessionData.timeline.series = encodedSeries;
console.log('After assign:', Object.keys(sessionData.timeline.series).length);
```

### Timeline Memory vs Storage

| Aspect | In-Memory (Runtime) | Stored (YAML) |
|--------|---------------------|---------------|
| Series values | Raw arrays: `[128, 130, 135]` | RLE JSON strings: `'[[128,1],[130,1],[135,1]]'` |
| Zone IDs | Full names: `['cool', 'active']` | Symbols: `'[["c",1],["a",1]]'` |
| Timebase | Live, updating | Frozen at save time |
| Events | Live array | Frozen array |

### Decoding for Analysis

To decode stored series for charting/analysis:

```javascript
function decodeRLE(encodedString) {
  const rle = JSON.parse(encodedString);
  const decoded = [];
  rle.forEach(([value, count]) => {
    for (let i = 0; i < count; i++) {
      decoded.push(value);
    }
  });
  return decoded;
}

// Usage:
const encoded = '[[128,3],[135,2],[null,1]]';
const decoded = decodeRLE(encoded);
// Result: [128, 128, 128, 135, 135, null]
```

### Timeline Size Limits

| Limit | Value | Rationale |
|-------|-------|-----------|
| Max tick count | ~14,400 (20 hours) | Practical session limit |
| Max series points total | 200,000 | Prevent memory bloat |
| Max events | Unlimited | Events are small |
| Tick interval | 5,000 ms | Balance between granularity and data volume |

**Calculation:**
- 1 hour session = 720 ticks
- 10 users × 4 metrics each = 40 series
- Total points = 720 × 40 = 28,800 (well under limit)

---

## Saved Data Format (YAML)

### Schema

```yaml
sessionId: '20251220133514'        # Unique session identifier
startTime: 1766266514976           # Unix timestamp (ms)
endTime: 1766267414976             # Unix timestamp (ms) - SHOULD be > startTime
durationMs: 900000                 # SHOULD be (endTime - startTime)

roster:
  - name: Alan
    displayLabel: Alan
    profileId: alan
    isGuest: false
    hrDeviceId: '28676'
    heartRate: 128                 # Last known HR
    zoneId: active
    zoneColor: green

deviceAssignments:
  - deviceId: '28676'
    occupantSlug: alan
    occupantName: Alan

voiceMemos:
  - memoId: memo_1735123456789_abc123
    createdAt: 1735123456789
    sessionElapsedSeconds: 120
    durationSeconds: 15
    transcriptRaw: "raw speech-to-text output"
    transcriptClean: "Cleaned up transcript"
    author: kc

treasureBox:
  coinTimeUnitMs: 5000
  totalCoins: 180
  buckets:
    blue: 45
    green: 90
    yellow: 30
    orange: 15
    red: 0

timeline:
  timebase:
    startTime: 1766266514976
    intervalMs: 5000
    tickCount: 180
    lastTickTimestamp: 1766267414976
  series:
    'user:alan:heart_rate': '[[128,5],[135,10],[140,8],...]'  # RLE encoded
    'user:alan:zone_id': '[["a",180]]'                        # "active" for all 180 ticks
    'user:alan:coins_total': '[[0,1],[5,1],[10,1],...]'
  events:
    - type: challenge_start
      tickIndex: 30
      data: { challengeId: 'sprint_1' }
  seriesMeta:
    'user:alan:heart_rate':
      encoding: rle
      originalLength: 180
      encodedLength: 45
      tickCount: 180

snapshots:
  sessionId: '20251220133514'
  captures:
    - index: 6
      filename: 20251220133514_0006.jpg
      path: fitness/sessions/2025-12-20/20251220133514/screenshots/...
      timestamp: 1766266541183
      size: 155897
```

### Series Encoding (RLE)

Time-series data is Run-Length Encoded for compact storage:

```javascript
// Raw: [128, 128, 128, 135, 135, 140]
// RLE: [[128, 3], [135, 2], [140, 1]]
// Stored as: '[[128,3],[135,2],[140,1]]'
```

Zone IDs use single-character symbols:
- `c` = cool (blue)
- `a` = active (green)  
- `w` = warm (yellow)
- `h` = hot (orange/red)

---

## Validation Rules

### `_validateSessionPayload()` Checks

| Check | Failure Reason | Action |
|-------|----------------|--------|
| No sessionData | `missing-session` | Reject |
| Invalid startTime | `invalid-startTime` | Reject |
| User series with empty roster | `roster-required` | Reject |
| User series with no assignments | `device-assignments-required` | Reject |
| **NEW** Duration < 10s + empty | `session-too-short-and-empty` | Reject |
| Series length mismatch | `series-tick-mismatch` | Reject |
| Series > 200k points | `series-size-cap` | Reject |

### Spam Prevention (NEW)

Sessions are rejected if ALL of the following are true:
- `durationMs < 10000` (under 10 seconds)
- No user series data
- No voice memos
- No timeline events

This prevents the flood of 1ms "ghost" sessions seen in production.

---

## Known Issues & Improvements

### 🐛 Critical Bugs

#### 1. Duration Always Shows 1ms ✅ FIXED
**Root Cause:** `summary` getter mutated `this.endTime` on first call  
**Fix:** Removed mutation, use local `derivedEndTime` variable  
**Status:** Fixed in this audit

#### 2. Voice Memos Not Triggering Save ✅ FIXED
**Root Cause:** `addVoiceMemo()` didn't call `_maybeAutosave()`  
**Fix:** Added autosave trigger to all voice memo mutations  
**Status:** Fixed in this audit

#### 3. Ghost Sessions Flooding Storage ✅ PARTIALLY FIXED
**Root Cause:** Sessions start on any device ping, even spurious ones  
**Fix:** Added validation to reject short/empty sessions  
**Status:** Prevents persistence, but sessions still start unnecessarily

### 🔧 Recommended Improvements

#### 1. Delayed Session Start
**Problem:** Session starts immediately on first device activity  
**Impact:** Ghost sessions from spurious ANT+ pings  
**Recommendation:** Require 2-3 consecutive ticks with valid HR data before starting session

```javascript
// Proposed: Add grace period before committing to session
_maybeStartSession(deviceData) {
  if (!this._preSessionBuffer) this._preSessionBuffer = [];
  this._preSessionBuffer.push(deviceData);
  
  // Require 3 valid readings before starting
  if (this._preSessionBuffer.length >= 3) {
    this.ensureStarted();
    this._preSessionBuffer.forEach(d => this.recordDeviceActivity(d));
    this._preSessionBuffer = null;
  }
}
```

#### 2. Compute Duration from Timeline
**Problem:** Duration relies on `startTime`/`endTime` which can be wrong  
**Recommendation:** Derive duration from timeline tick count

```javascript
// In _validateSessionPayload or summary getter
const tickCount = sessionData.timeline?.timebase?.tickCount || 0;
const intervalMs = sessionData.timeline?.timebase?.intervalMs || 5000;
const computedDurationMs = tickCount * intervalMs;

// Use computed duration if it's significantly different
if (Math.abs(sessionData.durationMs - computedDurationMs) > 10000) {
  sessionData.durationMs = computedDurationMs;
  sessionData.endTime = sessionData.startTime + computedDurationMs;
}
```

#### 3. Historical Data Repair Script
**Problem:** Existing sessions have incorrect `durationMs: 1`  
**Recommendation:** Create backfill script to repair historical data

```javascript
// scripts/repair-session-durations.mjs
// For each session:
// 1. Read timeline.timebase.tickCount and intervalMs
// 2. Compute actual duration = tickCount * intervalMs
// 3. Update endTime = startTime + duration
// 4. Update durationMs = duration
```

#### 4. Media Playlist Persistence
**Problem:** `mediaPlaylists` structure exists but unclear if videos/music played are saved  
**Recommendation:** Verify playback events are captured in `timeline.events`

#### 5. Screenshot Consistency
**Problem:** Screenshot indices have gaps (6-23, then 34-37, etc.)  
**Recommendation:** Investigate why screenshots are missed during session

#### 6. Better Session Recovery
**Problem:** If browser crashes, session state is lost  
**Recommendation:** Persist session state to localStorage for recovery

---

## File Storage Structure

```
data/households/{hid}/apps/fitness/sessions/
├── 2025-12-30/
│   ├── 20251230084008.yml      # Session data
│   └── 20251230084008/
│       └── screenshots/
│           ├── 20251230084008_0006.jpg
│           └── ...
├── 2025-12-29/
│   └── ...
```

Media files are stored separately in:
```
media/fitness/sessions/{date}/{sessionId}/screenshots/
```

---

## Testing Recommendations

### Unit Tests Needed

1. **Duration Calculation**
   - Session started at T, data collected for 15 minutes, verify `durationMs ≈ 900000`

2. **Voice Memo Persistence**
   - Add memo → verify autosave triggered → verify memo in payload

3. **Spam Prevention**
   - Start session, immediately end → verify save rejected
   - Start session, wait 15s, end → verify save accepted

4. **Series Encoding**
   - Verify RLE encoding/decoding roundtrips correctly
   - Verify zone symbols map correctly

5. **Roster Consistency**
   - User joins → leaves → rejoins → verify timeline reflects gaps

### Integration Tests Needed

1. Full session lifecycle with mock ANT+ data
2. Session recovery after simulated crash
3. Multi-user session with concurrent activity

---

## API Endpoints

### Save Session
```
POST /api/fitness/save_session
Body: { sessionData: { ... } }
Response: { ok: true, path: "..." }
```

### List Sessions (needed)
```
GET /api/fitness/sessions?date=2025-12-30
Response: { sessions: [...] }
```

### Get Session Detail (needed)
```
GET /api/fitness/sessions/:sessionId
Response: { session: { ... } }
```

---

## Summary of Fixes Made in This Audit

| Issue | Status | Change |
|-------|--------|--------|
| Duration always 1ms | ✅ Fixed | Removed `this.endTime` mutation in `summary` getter |
| Voice memos not saved | ✅ Fixed | Added `_maybeAutosave()` to voice memo methods |
| Ghost sessions | ✅ Partial | Added validation to reject short/empty sessions |

## Remaining Work

1. [ ] Implement delayed session start (grace period)
2. [ ] Create historical data repair script
3. [ ] Verify media playlist capture
4. [ ] Investigate screenshot gaps
5. [ ] Add session recovery mechanism
6. [ ] Implement session listing/detail APIs
7. [ ] Add comprehensive test suite
8. [ ] Fix chart data model (see below)

---

## FitnessChart Data Model & Rendering Issues

The `FitnessChart` component renders a "race chart" showing cumulative progress (coins or heartbeats) over time, with zone-colored line segments and user avatars. The chart consumes data from `FitnessTimeline` but has several architectural issues causing rendering bugs.

### Current Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Data Flow                                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  FitnessTimeline.series                                                              │
│        ↓                                                                             │
│  getSeries(slug, metric) → raw array                                                │
│        ↓                                                                             │
│  buildBeatsSeries() → { beats[], zones[], active[] }                                │
│        ↓                                                                             │
│  buildSegments() → [ { zone, color, points[], isGap } ]                             │
│        ↓                                                                             │
│  createPaths() → [ { d: "M...", color, opacity, isGap } ]                           │
│        ↓                                                                             │
│  <svg><path d="..." /></svg>                                                        │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Structures

#### Input: Timeline Series
```javascript
// From FitnessTimeline.series via getSeries()
getSeries('alan', 'heart_rate')   → [128, 130, null, null, 135, 140, ...]
getSeries('alan', 'zone_id')      → ['a', 'a', null, null, 'w', 'w', ...]
getSeries('alan', 'coins_total')  → [0, 5, 5, 5, 10, 15, ...]  // cumulative
```

#### Intermediate: buildBeatsSeries Output
```javascript
{
  beats: [0, 5, 5, 5, 10, 15, ...],   // Y-axis values (filled for continuity)
  zones: ['a', 'a', null, null, 'w', 'w', ...],  // Zone at each tick
  active: [true, true, false, false, true, true, ...]  // HR present at tick?
}
```

#### Intermediate: buildSegments Output
```javascript
[
  { zone: 'a', color: 'green', isGap: false, points: [{i:0, v:0}, {i:1, v:5}] },
  { zone: null, color: 'grey', isGap: true, points: [{i:1, v:5}, {i:4, v:5}] },  // dropout
  { zone: 'w', color: 'yellow', isGap: false, points: [{i:4, v:5}, {i:5, v:10}] }
]
```

#### Output: createPaths Output
```javascript
[
  { d: "M0,240 L50,230", color: 'green', opacity: 1, isGap: false },
  { d: "M50,230 L150,230", color: 'grey', opacity: 0.5, isGap: true },  // dashed
  { d: "M150,230 L200,220", color: 'yellow', opacity: 1, isGap: false }
]
```

### Known Rendering Issues

#### 1. Dropout Detection Inconsistency

**Problem:** Multiple sources of truth for "is user active":
- `roster.isActive` (from DeviceManager.inactiveSince)
- `active[]` array (derived from heart_rate nulls)
- `segments[].isGap` (derived from active[])
- `ActivityMonitor` (separate tracking system)

**Impact:** Avatar shows present while line shows dropout, or vice versa.

**Current Workaround:** Code has many `console.warn()` guards to detect mismatches.

**Recommended Fix:**
```javascript
// SINGLE SOURCE OF TRUTH: Derive everything from heart_rate series
const isActiveAtTick = (slug, tickIndex) => {
  const hr = timeline.series[`user:${slug}:heart_rate`]?.[tickIndex];
  return hr != null && Number.isFinite(hr) && hr > 0;
};
```

#### 2. Forward-Fill Masking Dropouts

**Problem:** `fillEdgesOnly()` fills leading/trailing nulls but preserves interior nulls. However, `coins_total` is cumulative and never has nulls - it just stays flat during dropout.

```javascript
// coins_total during dropout:
[0, 5, 10, 10, 10, 10, 15, 20]  // No nulls! Just flat values at [3,4,5]
```

**Impact:** `buildSegments()` can't detect dropout from coins_total alone - it needs the parallel `active[]` array from heart_rate.

**Recommended Fix:** Always derive `active[]` from `heart_rate`, never from the cumulative metric.

#### 3. Late Join Handling

**Problem:** When a user joins mid-session, their line should start at (tick N, value 0), not from the chart origin.

**Current Code:**
```javascript
// fillEdgesOnly with startAtZero anchors to origin
result[0] = 0; // Forces everyone to start at 0,0
```

**Impact:** Late joiners have a diagonal "ramp up" line from origin to their first real data point.

**Recommended Fix:**
```javascript
// Track firstActiveTick per user
const firstActiveTick = active.findIndex(a => a === true);
// Start line at (firstActiveTick, 0), not (0, 0)
```

#### 4. Segment Color Bleeding

**Problem:** When zone changes mid-tick, the segment boundary can be off by one tick.

```javascript
// Zone change at tick 5:
zones = ['a', 'a', 'a', 'a', 'a', 'w', 'w', 'w']
//                            ^--- change here
```

**Current behavior:** Previous segment may include tick 5, causing color to "bleed" into wrong zone.

**Recommended Fix:** Use inclusive start, exclusive end for segment boundaries.

#### 5. Avatar/Badge Position Jitter

**Problem:** Avatar positions are computed from `lastSeenTick`, which can jump around as data updates.

**Impact:** Avatars visibly jump when new data arrives or user dropouts are detected.

**Recommended Fix:** Smooth avatar transitions with CSS or lerping.

### Proposed Improved Data Model

Instead of deriving data through multiple transformations, use a cleaner model:

```javascript
// NEW: ChartDataPoint structure
interface ChartDataPoint {
  tick: number;           // X-axis: tick index
  value: number;          // Y-axis: cumulative value
  zone: string | null;    // Zone at this tick
  isActive: boolean;      // HR was present at this tick
}

// NEW: ChartParticipant structure
interface ChartParticipant {
  id: string;
  name: string;
  avatarUrl: string;
  
  // Raw data (one entry per tick)
  data: ChartDataPoint[];
  
  // Computed once
  firstActiveTick: number;   // When they joined
  lastActiveTick: number;    // Most recent activity
  currentValue: number;      // Latest cumulative value
  currentZone: string;       // Current zone
  isCurrentlyActive: boolean; // Are they broadcasting NOW?
  
  // For rendering
  segments: Segment[];       // Pre-computed path segments
  avatarPosition: {x, y};    // Pre-computed position
}
```

### Recommended Refactor Steps

1. **Create `ChartDataBuilder` class** (partially exists in domain/)
   - Single method: `buildParticipantData(slug, timeline, timebase)`
   - Returns `ChartParticipant` with all data pre-computed
   - No separate `buildBeatsSeries`, `buildSegments`, `createPaths` chain

2. **Derive activity from heart_rate only**
   - Remove fallback to roster.isActive for segment rendering
   - roster.isActive only controls avatar presence, not line style

3. **Fix cumulative value handling**
   - Don't force `startAtZero` for late joiners
   - Track `firstActiveTick` and start line there

4. **Add memoization**
   - Cache segment computations by tick count
   - Only recompute affected segments when new data arrives

5. **Separate concerns**
   - `ChartDataModel`: Pure data computation (testable)
   - `ChartRenderer`: SVG rendering only
   - `ChartAvatarManager`: Avatar position logic

### Testing Scenarios for Chart

| Scenario | Expected Behavior |
|----------|-------------------|
| Single user, full session | Solid colored line, avatar at end |
| User drops out mid-session | Line stops, dashed continuation, badge at dropout point |
| User rejoins after dropout | Dashed gap, then solid line resumes |
| Late joiner | Line starts at join tick, not origin |
| Zone change | Color transition at correct tick |
| Multiple users overlapping | Avatars stacked to avoid overlap |
| User removed from roster | Avatar disappears, badge remains at last position |

### Chart Debug Logging

The current code has extensive debug logging. Key console outputs:

```javascript
// Avatar mismatch between roster and chart
console.warn('[FitnessChart] Avatar mismatch', { rosterCount, chartCount, ... });

// Status corrected from roster
console.warn('[FitnessChart] Status corrected from roster.isActive', { ... });

// Segment shows gap but roster says active
console.warn('[FitnessChart] Segment shows gap but roster says active', { ... });

// buildSegments dropout detection
console.log('[buildSegments] DEBUG:', { totalSegs, gapSegs, activeFalseCount, ... });
```

To enable verbose debugging, check dev.log for these patterns during a live session.

---

## Phased Implementation Plan

This section outlines a prioritized roadmap to address the issues identified in this audit. Work is organized into phases based on dependencies and impact.

### Phase 1: Critical Data Integrity Fixes (Week 1)

**Goal:** Ensure session data is saved correctly and completely.

#### 1.1 Fix Series Data Not Persisting ⚠️ CRITICAL
**Priority:** P0 - Data loss in production  
**Effort:** 2-4 hours  
**Files:** `FitnessSession.js`, `fitness.mjs`

```
Tasks:
[ ] Add logging in _persistSession before/after _encodeSeries
[ ] Verify encodedSeries object has keys after encoding
[ ] Check backend stringifyTimelineSeriesForFile isn't stripping data
[ ] Test YAML serialization with JSON string values
[ ] Deploy fix and verify next session saves series data
```

#### 1.2 Verify Duration Fix Works in Production
**Priority:** P0 - Already deployed, needs verification  
**Effort:** 30 minutes

```
Tasks:
[ ] Run a test session after deploy
[ ] Check saved YAML has correct durationMs
[ ] Verify endTime > startTime
[ ] Confirm durationMs ≈ tickCount × intervalMs
```

#### 1.3 Clean Up Ghost Sessions
**Priority:** P1 - Storage bloat  
**Effort:** 1 hour

```
Tasks:
[ ] Create script to identify sessions with durationMs: 1
[ ] Delete or archive spam sessions from 2025-12-30
[ ] Verify validation rejects new short/empty sessions
```

Phase 2 Cancelled.


### Phase 3: Session Lifecycle Hardening (Week 2-3)

**Goal:** Prevent ghost sessions and improve reliability.

#### 3.1 Implement Delayed Session Start
**Priority:** P1  
**Effort:** 3-4 hours  
**File:** `FitnessSession.js`

```javascript
// Add pre-session buffer
_preSessionBuffer = [];
_preSessionThreshold = 3; // Require 3 valid readings

recordDeviceActivity(deviceData) {
  if (!this.sessionId) {
    this._preSessionBuffer.push(deviceData);
    if (this._preSessionBuffer.length >= this._preSessionThreshold) {
      this.ensureStarted();
      this._preSessionBuffer.forEach(d => this._processDeviceData(d));
      this._preSessionBuffer = [];
    }
    return;
  }
  this._processDeviceData(deviceData);
}
```

```
Tasks:
[ ] Add pre-session buffer logic
[ ] Configure threshold (3 readings = 15 seconds)
[ ] Test with spurious ANT+ pings
[ ] Test normal session start still works
[ ] Deploy and monitor for ghost sessions
```

#### 3.2 Add Session Recovery
**Priority:** P2  
**Effort:** 4-6 hours  
**Files:** `FitnessSession.js`, `FitnessContext.jsx`

```
Tasks:
[ ] Serialize session state to localStorage on each autosave
[ ] On page load, check for orphaned session state
[ ] Prompt user to recover or discard
[ ] If recover, restore session and continue
[ ] Clear localStorage on clean session end
```

#### 3.3 Improve Autosave Reliability
**Priority:** P2  
**Effort:** 2 hours

```
Tasks:
[ ] Add retry logic to _persistSession (3 attempts with backoff)
[ ] Log failed save attempts to eventLog
[ ] Show user notification on persistent save failures
[ ] Queue failed saves for retry when connection restored
```

### Phase 4: Chart Data Model Refactor (Week 3-4)

**Goal:** Fix chart rendering issues with cleaner architecture.

#### 4.1 Create ChartDataBuilder Class
**Priority:** P1  
**Effort:** 6-8 hours  
**File:** `frontend/src/modules/Fitness/domain/ChartDataBuilder.js`

```
Tasks:
[ ] Define ChartDataPoint and ChartParticipant interfaces
[ ] Implement buildParticipantData(slug, timeline, timebase)
[ ] Derive active[] solely from heart_rate series
[ ] Compute firstActiveTick for late joiner handling
[ ] Unit test all data transformations
```

#### 4.2 Fix Late Joiner Rendering
**Priority:** P1  
**Effort:** 2-3 hours

```
Tasks:
[ ] Remove startAtZero forcing for late joiners
[ ] Start line at (firstActiveTick, 0)
[ ] Add test case for late joiner scenario
[ ] Verify visual rendering
```

#### 4.3 Unify Activity Source of Truth
**Priority:** P1  
**Effort:** 3-4 hours

```
Tasks:
[ ] Remove roster.isActive fallback in buildBeatsSeries
[ ] Use heart_rate nulls as sole source for active[]
[ ] roster.isActive only controls avatar visibility
[ ] Remove redundant ActivityMonitor checks
[ ] Verify avatar/line consistency in test session
```

#### 4.4 Fix Dropout Segment Rendering
**Priority:** P2  
**Effort:** 2-3 hours

```
Tasks:
[ ] Ensure dropout creates dashed segment correctly
[ ] Badge appears at dropout point
[ ] Line resumes correctly after rejoin
[ ] Test multiple dropout/rejoin cycles
```

### Phase 5: API & Analysis Features (Week 4-5)

**Goal:** Enable session browsing and analysis.

#### 5.1 Implement Session List API
**Priority:** P2  
**Effort:** 2-3 hours  
**File:** `backend/routers/fitness.mjs`

```javascript
// GET /api/fitness/sessions?date=2025-12-30
fitnessRouter.get('/sessions', (req, res) => {
  const { date } = req.query;
  const sessions = listSessionsForDate(date);
  res.json({ sessions });
});
```

#### 5.2 Implement Session Detail API
**Priority:** P2  
**Effort:** 2-3 hours

```javascript
// GET /api/fitness/sessions/:sessionId
fitnessRouter.get('/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = loadSession(sessionId);
  // Decode RLE series for client consumption
  session.timeline.series = decodeSeries(session.timeline.series);
  res.json({ session });
});
```

#### 5.3 Create Session Browser UI
**Priority:** P3  
**Effort:** 8-12 hours

```
Tasks:
[ ] Calendar view of sessions by date
[ ] Session card showing duration, participants, coins
[ ] Click to view session detail
[ ] Replay chart animation from saved data
[ ] Export session data as CSV
```

### Phase 6: Testing & Documentation (Ongoing)

#### 6.1 Unit Test Suite
**Priority:** P2  
**Effort:** 8-12 hours

```
Test files to create:
[ ] FitnessSession.test.mjs - Session lifecycle
[ ] FitnessTimeline.test.mjs - Timeline operations
[ ] ChartDataBuilder.test.mjs - Chart data transformations
[ ] RLEEncoding.test.mjs - Encode/decode roundtrips
```

#### 6.2 Integration Test Suite
**Priority:** P3  
**Effort:** 6-8 hours

```
[ ] Full session with mock ANT+ data
[ ] Multi-user session with dropouts
[ ] Session recovery after crash
[ ] Autosave under network failures
```

#### 6.3 Update Documentation
**Priority:** P3  
**Effort:** 2-3 hours

```
[ ] Keep this spec document updated as work progresses
[ ] Add API documentation to README
[ ] Create troubleshooting guide for common issues
```

---

## Implementation Timeline Summary

| Phase | Focus | Duration | Key Deliverables |
|-------|-------|----------|------------------|
| **1** | Critical Fixes | Week 1 | Series persistence, duration verification |
| **2** | Data Repair | Week 1-2 | Historical duration repair, cleanup |
| **3** | Lifecycle Hardening | Week 2-3 | Delayed start, recovery, retry logic |
| **4** | Chart Refactor | Week 3-4 | ChartDataBuilder, unified activity source |
| **5** | API & Analysis | Week 4-5 | Session list/detail APIs, browser UI |
| **6** | Testing | Ongoing | Unit tests, integration tests, docs |

### Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Ghost sessions per day | ~14 | 0 |
| Sessions with correct duration | ~0% | 100% |
| Sessions with series data | ~0% | 100% |
| Chart dropout accuracy | ~60% | 95% |
| Autosave success rate | Unknown | >99% |

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Series data unrecoverable | Accept data loss for affected sessions, prevent future loss |
| Delayed start breaks real sessions | Make threshold configurable, start with conservative 3 readings |
| Chart refactor introduces bugs | Comprehensive test suite before migration |
| Recovery causes duplicate sessions | Use session ID + timestamp to detect duplicates |

---

## Appendix: Quick Reference

### Key Files

| Component | File Path |
|-----------|-----------|
| Session Core | `frontend/src/hooks/fitness/FitnessSession.js` |
| Timeline | `frontend/src/hooks/fitness/FitnessTimeline.js` |
| Chart Helpers | `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js` |
| Chart Component | `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/` |
| Backend Router | `backend/routers/fitness.mjs` |
| Session Storage | `data/households/{hid}/apps/fitness/sessions/` |

### Key Constants

```javascript
// Timeouts (ms)
FITNESS_TIMEOUTS.inactive = 60000;   // 1 min - mark user idle
FITNESS_TIMEOUTS.remove = 180000;    // 3 min - remove from roster
FITNESS_TIMEOUTS.emptySession = 60000; // 1 min - end empty session

// Intervals
TICK_INTERVAL_MS = 5000;             // 5 sec - data collection
AUTOSAVE_INTERVAL_MS = 15000;        // 15 sec - persist to backend

// Limits
MAX_SERIALIZED_SERIES_POINTS = 200000;
MIN_SESSION_DURATION_MS = 10000;     // Spam threshold
```

### Validation Rejection Reasons

| Reason | Meaning |
|--------|---------|
| `missing-session` | No sessionData provided |
| `invalid-startTime` | startTime not a valid number |
| `roster-required` | Has user series but empty roster |
| `device-assignments-required` | Has user series but no device assignments |
| `session-too-short-and-empty` | Under 10s with no data/memos/events |
| `series-tick-mismatch` | Series length ≠ tickCount |
| `series-size-cap` | Total points > 200k |
