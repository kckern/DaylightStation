# Fitness Sessions Feature

> **Related code:** `frontend/src/hooks/fitness/FitnessSession.js`, `frontend/src/hooks/fitness/SessionEntity.js`, `backend/routers/fitness.mjs`

Complete specification for fitness session lifecycle, data model, and session entity architecture.

---

## Overview

`FitnessSession` is the core data model for tracking workout sessions. It captures real-time biometric data from ANT+ devices, manages participant rosters, records voice memos, tracks "coins" (gamification), and persists session data to YAML files.

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

### Series Key Convention

```
{entity_type}:{identifier}:{metric_name}
```

| Entity Type | Identifier | Metrics |
|-------------|------------|---------|
| `user` | userId | `heart_rate`, `zone_id`, `coins_total`, `heart_beats` |
| `entity` | entityId | Same as user (entity-specific) |
| `device` | deviceId | `heart_rate`, `rpm`, `rotations` |
| `global` | N/A | `coins_total` |

### Series Storage (RLE Encoding)

```javascript
// In-memory during session:
[128, 128, 128, 135, 135, 140, 140, 140, 140, null, 145]

// After RLE encoding for storage:
'[[128,3],[135,2],[140,4],[null,1],[145,1]]'
```

### Zone ID Compression

| Zone Name | Symbol | Color |
|-----------|--------|-------|
| `cool` | `c` | Blue |
| `active` | `a` | Green |
| `warm` | `w` | Yellow |
| `hot` | `h` | Orange/Red |

---

## Saved Data Format (YAML)

```yaml
sessionId: '20251220133514'
startTime: 1766266514976
endTime: 1766267414976
durationMs: 900000

roster:
  - name: Alan
    profileId: alan
    isGuest: false
    hrDeviceId: '28676'
    heartRate: 128
    zoneId: active

entities:
  - entityId: "entity-1735689000000-abc12"
    profileId: "alan-001"
    status: "active"
    coins: 50
    durationMs: 600000

deviceAssignments:
  - deviceId: '28676'
    occupantSlug: alan
    entityId: "entity-1735689000000-abc12"

treasureBox:
  totalCoins: 180
  buckets: { blue: 45, green: 90, yellow: 30, orange: 15 }

timeline:
  timebase:
    startTime: 1766266514976
    intervalMs: 5000
    tickCount: 180
  series:
    'user:alan:heart_rate': '[[128,5],[135,10],...]'
    'entity:entity-1735689000000-abc12:coins_total': '[[0,1],[5,1],...]'
  events:
    - type: challenge_start
      tickIndex: 30
      data: { challengeId: 'sprint_1' }
```

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
