# Fitness Sessions Feature

> **Related code:** `frontend/src/hooks/fitness/FitnessSession.js`, `frontend/src/hooks/fitness/PersistenceManager.js`, `backend/routers/fitness.mjs`

Complete specification for fitness session lifecycle, data model, and session entity architecture.

---

## Overview

`FitnessSession` is the core data model for tracking workout sessions. It captures real-time biometric data from ANT+ devices, manages participant rosters, records voice memos, tracks "coins" (gamification), and persists session data to YAML files.

**Current Format Version:** v3 (as of January 2026)

---

## Core Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `FitnessSession` | `FitnessSession.js` | Main session orchestrator |
| `SessionEntity` | `SessionEntity.js` | Per-participation tracking |
| `VoiceMemoManager` | `VoiceMemoManager.js` | Voice memo lifecycle |
| `DeviceManager` | `DeviceManager.js` | ANT+ device registration |
| `UserManager` | `UserManager.js` | Participant roster & assignments |
| `FitnessTimeline` | `FitnessTimeline.js` | Time-series data storage |
| `TreasureBox` | `TreasureBox.js` | Coin/gamification tracking |

---

## Session Lifecycle

### 1. Session Start

**Trigger:** First `recordDeviceActivity()` call or explicit `ensureStarted()`

**Behavior:**
- Generate unique `sessionId` in format `fs_YYYYMMDDHHmmss`
- Set `startTime` to current timestamp
- Initialize `FitnessTimeline` with 5-second intervals
- Start tick timer (5s) and autosave timer (15s)
- `endTime` remains `null` until session ends

### 2. Active Session

**Data Collection (every 5s tick):**
- Heart rate from HR monitors → `user:{userId}:heart_rate`
- Zone classification → `user:{userId}:zone_id`
- Cumulative heartbeats → `user:{userId}:heart_beats`
- Coin totals → `user:{userId}:coins_total`
- Device metrics → `device:{id}:heart_rate`

**Autosave (every 15s):**
- Build payload via `summary` getter
- Validate with `_validateSessionPayload()`
- Encode series with RLE compression
- POST to `/api/fitness/save_session`

### 3. Session End

**Triggers:**
- Manual end (user action)
- Inactivity timeout (3 minutes no device activity)
- Empty roster timeout (1 minute with no participants)

**Behavior:**
- Set `endTime` to current timestamp
- Final `_collectTimelineTick()` to capture last data point
- Force persist with `_persistSession(sessionData, { force: true })`
- Reset all state for next session

---

## Session Entity Architecture

### Core Concept

A **Session Entity** represents a distinct participation instance, separate from a **User Profile**:

```
Profile (who someone is)          Entity (a participation instance)
├── profileId: "alan-123"         ├── entityId: "entity-1735689600000-abc12"
├── name: "Alan"                  ├── profileId: "alan-123" (reference)
├── zones: [...]                  ├── deviceId: "42"
└── avatarUrl: "..."              ├── startTime: 1735689600000
                                  ├── endTime: null
                                  ├── status: "active"
                                  └── coins: 50
```

**Key insight:** A single profile can have multiple session entities (if they leave and rejoin, or use different devices). Timeline data is attributed to entities, not profiles.

### Why Entities?

The Session Entity pattern solves guest management problems:

| Scenario | Before Entities | After Entities |
|----------|-----------------|----------------|
| Guest takes over | Inherits owner's coins | Starts at 0 |
| Owner returns | Sees guest's coins added | Fresh entity, clean slate |
| Multiple guests | All coins conflated | Each guest tracked separately |

### Entity Status Values

| Status | Meaning |
|--------|---------|
| `active` | Currently participating |
| `dropped` | Left session (≥ grace period) |
| `transferred` | Brief session merged into successor (< grace period) |

### Grace Period Transfer

If user A was active < 1 minute before user B takes over:
- Transfer A's coins to B
- Transfer A's session start time to B
- Mark A as "transferred" (excluded from saved session data)
- B inherits A's brief segment

---

## Timeline Data Model

### In-Memory Series Keys (during session)

During an active session, timeline series use prefixed keys:

```
{entity_type}:{identifier}:{metric_name}
```

| Entity Type | Identifier | Metrics |
|-------------|------------|---------|
| `user` | userId | `heart_rate`, `zone_id`, `coins_total`, `heart_beats` |
| `device` | deviceId | `heart_rate`, `rpm`, `rotations` |
| `global` | N/A | `coins_total` |

### Persisted Series Structure (v3)

When saved to YAML, series are reorganized into a nested structure under `timeline`:

```yaml
timeline:
  participants:
    {userId}:
      hr: '...'      # heart rate
      beats: '...'   # cumulative beats
      coins: '...'   # cumulative coins
      zone: '...'    # zone ID
  equipment:
    {deviceId}:
      rpm: '...'     # cadence
      rotations: '...' # cumulative rotations
  global:
    coins: '...'     # total coins
```

### Series Storage (RLE Encoding)

```javascript
// In-memory during session:
[128, 128, 128, 135, 135, 140, 140, 140, 140, null, 145]

// After RLE encoding for storage:
'[[128,3],[135,2],[140,4],null,145]'
```

**Note:** In v3, single occurrences are stored as bare values (not `[value,1]`), and empty series (all null) are omitted entirely.

### Zone ID Compression

| Zone Name | Symbol | Color |
|-----------|--------|-------|
| `cool` | `c` | Blue |
| `active` | `a` | Green |
| `warm` | `w` | Yellow |
| `hot` | `h` | Orange |
| `fire` | `f` | Red |

---

## Saved Data Format (YAML v3)

Session files use a versioned YAML format. Version 3 introduces semantic organization, nested structure, and storage optimizations.

### Top-Level Structure

```yaml
version: 3

session:
  id: '20260106194853'
  date: '2026-01-06'
  start: '2026-01-06 19:48:53'
  end: '2026-01-06 20:48:53'
  duration_seconds: 3600
  first_hr: '2026-01-06 19:48:58'
  last_hr: '2026-01-06 20:31:42'
  active_seconds: 2564
  timezone: America/Los_Angeles

totals:
  coins: 913
  buckets:
    blue: 0
    green: 270
    yellow: 400
    orange: 228
    red: 15

participants:
  kckern:
    display_name: Keith
    is_primary: true
    is_guest: false
    hr_device: '40475'
    cadence_device: '49904'
    coins_earned: 563
    active_seconds: 2564
    zone_summary:
      blue: 0
      green: 270
      yellow: 200
      orange: 93
      red: 0
    zone_time_seconds:
      blue: 90
      green: 810
      yellow: 1200
      orange: 464
      red: 0
    hr_stats:
      min: 71
      max: 134
      avg: 108
    total_beats: 4797

timeline:
  interval_seconds: 5
  tick_count: 721
  encoding: rle
  participants:
    kckern:
      hr: '[[71,2],75,74,76,77,...]'
      beats: '[5.9,11.8,18.1,...]'
      coins: '[[0,17],1,2,3,...]'
      zone: '[["c",18],["a",5],...]'
  equipment:
    bike-49904:
      rpm: '[[null,417],54,60,...]'
      rotations: '[[null,417],4.5,9.5,...]'
  global:
    coins: '[[0,17],1,2,3,...]'

events:
  audio:
    - at: '2026-01-06 19:52:33'
      title: Everybody Dance Now (Rock This Party) [Workout Mix]
      artist: ESPN
      album: Stadium Anthems
      plex_id: '140598'
      duration_seconds: 271
  video:
    - at: '2026-01-06 20:22:46'
      title: Schliersee Alpine Descent (Bavaria)
      show: Scenic Cycling
      season: Season 1
      plex_id: '672429'
      duration_seconds: 3
      labels:
        - NoMusic
  voice_memos:
    - at: '2026-01-06 20:22:15'
      id: memo_1767730935589_v4h6stfn9
      duration_seconds: 133
      transcript: >
        I got distracted in the middle because of a screaming baby...

snapshots:
  updated_at: '2026-01-06 20:45:00'
  captures:
    - index: 6
      filename: 20260106194853_0006.jpg
      at: '2026-01-06 19:55:23'
      size_bytes: 45230
```

### Block Reference

#### session

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Session ID (YYYYMMDDHHmmss format) |
| `date` | string | Date portion (YYYY-MM-DD) |
| `start` | string | Wall-clock start time |
| `end` | string | Wall-clock end time (updated on each save) |
| `duration_seconds` | int | Wall-clock duration |
| `first_hr` | string | First valid HR reading timestamp |
| `last_hr` | string | Last valid HR reading timestamp |
| `active_seconds` | int | Duration between first/last HR |
| `timezone` | string | IANA timezone (e.g., America/Los_Angeles) |

#### totals

| Field | Type | Description |
|-------|------|-------------|
| `coins` | int | Total coins earned across all participants |
| `buckets` | object | Coins breakdown by zone color |

#### participants.{userId}

| Field | Type | Description |
|-------|------|-------------|
| `display_name` | string | Human-readable name |
| `is_primary` | bool | Primary session owner |
| `is_guest` | bool | Not a household member (derived from membership) |
| `hr_device` | string | HR monitor device ID |
| `cadence_device` | string | Cadence sensor device ID (optional) |
| `coins_earned` | int | Total coins earned by participant |
| `active_seconds` | int | Time with valid HR data |
| `zone_summary` | object | Coins earned per zone |
| `zone_time_seconds` | object | Seconds spent in each zone |
| `hr_stats` | object | `{min, max, avg}` heart rate statistics |
| `total_beats` | float | Cumulative heartbeats |

#### timeline

| Field | Type | Description |
|-------|------|-------------|
| `interval_seconds` | int | Tick interval (default: 5) |
| `tick_count` | int | Total ticks in session |
| `encoding` | string | Series encoding method (`rle`) |
| `participants.{userId}.hr` | string | RLE-encoded heart rate series |
| `participants.{userId}.beats` | string | RLE-encoded cumulative beats |
| `participants.{userId}.coins` | string | RLE-encoded cumulative coins |
| `participants.{userId}.zone` | string | RLE-encoded zone ID series |
| `equipment.{deviceId}.rpm` | string | RLE-encoded cadence series |
| `equipment.{deviceId}.rotations` | string | RLE-encoded cumulative rotations |
| `global.coins` | string | RLE-encoded total coins across all participants |

#### events

| Section | Fields |
|---------|--------|
| `audio[]` | `at`, `title`, `artist`, `album`, `plex_id`, `duration_seconds` |
| `video[]` | `at`, `title`, `show`, `season`, `plex_id`, `duration_seconds`, `labels[]` |
| `voice_memos[]` | `at`, `id`, `duration_seconds`, `transcript` |

#### snapshots

| Field | Type | Description |
|-------|------|-------------|
| `updated_at` | string | Last snapshot save time |
| `captures[].index` | int | Screenshot index |
| `captures[].filename` | string | File name |
| `captures[].at` | string | Capture timestamp |
| `captures[].size_bytes` | int | File size |

### RLE Encoding Format

Timeline series use Run-Length Encoding (RLE) for compression:

```javascript
// In-memory during session:
[128, 128, 128, 135, 135, 140, 140, 140, 140, null, 145]

// After RLE encoding for storage:
'[[128,3],[135,2],[140,4],null,145]'
```

**Rules:**
- Consecutive identical values compress to `[value, count]`
- Single occurrences remain as bare values
- `null` values represent gaps/dropouts
- Empty series (all null) are omitted entirely

### Zone ID Encoding

| Zone Name | Symbol | Color |
|-----------|--------|-------|
| `cool` | `c` | Blue |
| `active` | `a` | Green |
| `warm` | `w` | Yellow |
| `hot` | `h` | Orange |
| `fire` | `f` | Red |

### v3 Design Goals

1. **Storage efficiency:** ~40-50% reduction through deduplication and empty series filtering
2. **Queryability:** Semantic grouping enables reports, dashboards, thermal printer outputs
3. **Human-readable:** Timestamps in wall-clock format with timezone
4. **Derived stats:** Participant summaries pre-computed (no RLE parsing needed for reports)

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
```

Media files:
```
media/fitness/sessions/{date}/{sessionId}/screenshots/
```

---

## Validation Rules

| Check | Failure Reason | Action |
|-------|----------------|--------|
| No sessionData | `missing-session` | Reject |
| Invalid startTime | `invalid-startTime` | Reject |
| User series with empty roster | `roster-required` | Reject |
| Duration < 10s with no data | `session-too-short-and-empty` | Reject |
| Series length ≠ tickCount | `series-tick-mismatch` | Reject |
| Series > 200k points | `series-size-cap` | Reject |

---

## Key Constants

```javascript
// Timeouts (ms)
FITNESS_TIMEOUTS.inactive = 60000;     // 1 min - mark user idle
FITNESS_TIMEOUTS.remove = 180000;      // 3 min - remove from roster
FITNESS_TIMEOUTS.emptySession = 60000; // 1 min - end empty session

// Intervals
TICK_INTERVAL_MS = 5000;               // 5 sec - data collection
AUTOSAVE_INTERVAL_MS = 15000;          // 15 sec - persist to backend

// Limits
MAX_SERIALIZED_SERIES_POINTS = 200000;
MIN_SESSION_DURATION_MS = 10000;       // Spam threshold
GRACE_PERIOD_MS = 60000;               // Entity transfer threshold
```

---

## API Endpoints

```
POST /api/fitness/save_session
Body: { sessionData: { ... } }
Response: { ok: true, path: "..." }
```

---

**Merged from:**
- fitness-session-spec.md
- guest-switch-session-transition.md
- session-entity-justification.md
- session-yaml-v3-schema-design.md (January 2026)
