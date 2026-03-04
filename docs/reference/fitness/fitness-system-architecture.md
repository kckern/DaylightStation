# Fitness System Architecture

A comprehensive reference for the DaylightStation fitness system — from physical heart rate sensors through session management, video playback, governance enforcement, and data persistence.

For governance-specific details, see `governance-engine.md` and `governance-system-architecture.md`.
For pose detection and exercise recognition, see `semantic-pose-pipeline.md`.

---

## System Overview

The fitness system enables family workout sessions on a large touchscreen TV. Heart rate monitors broadcast data over ANT+ wireless, which a backend service relays to the browser via WebSocket. The frontend orchestrates sessions, tracks zones and coins, enforces governance rules (requiring exercise to watch certain content), and persists session data for historical review.

### High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                            PHYSICAL LAYER                                          │
│                                                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ ANT+ HR  │  │ ANT+ HR  │  │ ANT+ HR  │  │BLE Rope  │  │ Vibration│            │
│  │ Monitor 1│  │ Monitor 2│  │ Monitor 3│  │ Sensor   │  │ Sensor   │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       └──────────────┴──────────────┴──────────────┴──────────────┘                 │
│                                     │                                              │
└─────────────────────────────────────┼──────────────────────────────────────────────┘
                                      │ ANT+ / BLE
┌─────────────────────────────────────┼──────────────────────────────────────────────┐
│                            BACKEND (Node.js)                                       │
│                                     │                                              │
│  ┌─────────────────────────────┐    │                                              │
│  │ FitSyncAdapter              │◀───┘                                              │
│  │ (ANT+ USB → event bus)      │                                                   │
│  └────────────┬────────────────┘                                                   │
│               │ eventBus.broadcast('fitness', {...})                                │
│  ┌────────────▼────────────────┐                                                   │
│  │ WebSocketEventBus           │───────────────────────┐                            │
│  │ (pub/sub + WS server)       │                       │                            │
│  └─────────────────────────────┘                       │                            │
│                                                        │                            │
│  ┌─────────────────────────────┐  ┌────────────────────▼───┐                       │
│  │ FitnessConfigService        │  │ FitnessAPI (REST)       │                       │
│  │ (zones, users, devices)     │  │ GET /api/fitness        │                       │
│  └─────────────────────────────┘  │ POST /api/fitness/save  │                       │
│                                   │ GET /api/fitness/session │                       │
│  ┌─────────────────────────────┐  └────────────────────────┘                       │
│  │ SessionDatastore            │                                                   │
│  │ (YAML session persistence)  │                                                   │
│  └─────────────────────────────┘                                                   │
│                                                                                    │
└─────────────────────────────────┬──────────────────────────────────────────────────┘
                                  │ WebSocket (ws://.../ws)
                                  │ topic: 'fitness'
┌─────────────────────────────────┼──────────────────────────────────────────────────┐
│                            FRONTEND (React)                                        │
│                                  │                                                 │
│  ┌───────────────────────────────▼───────────────────────────────────┐              │
│  │                     WebSocketService                              │              │
│  │              subscribe(['fitness', 'vibration'])                   │              │
│  └───────────────────────────────┬───────────────────────────────────┘              │
│                                  │                                                 │
│  ┌───────────────────────────────▼───────────────────────────────────┐              │
│  │                     FitnessContext (React Provider)                │              │
│  │                                                                   │              │
│  │  ┌─────────────────────────────────────────────────────────┐      │              │
│  │  │                  FitnessSession                          │      │              │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │      │              │
│  │  │  │DeviceManager │  │ UserManager  │  │ZoneProfile   │  │      │              │
│  │  │  │(raw sensors) │─▶│(device→user) │─▶│Store (zones) │  │      │              │
│  │  │  └──────────────┘  └──────────────┘  └──────┬───────┘  │      │              │
│  │  │                                             │           │      │              │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────▼───────┐  │      │              │
│  │  │  │FitnessTime-  │  │ TreasureBox  │  │ Governance   │  │      │              │
│  │  │  │line (series) │  │ (coins/zones)│  │ Engine       │  │      │              │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘  │      │              │
│  │  │                                                         │      │              │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │      │              │
│  │  │  │Persistence   │  │ Timeline     │  │ Participant  │  │      │              │
│  │  │  │Manager       │  │ Recorder     │  │ Roster       │  │      │              │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘  │      │              │
│  │  └─────────────────────────────────────────────────────────┘      │              │
│  └───────────────────────────────┬───────────────────────────────────┘              │
│                                  │                                                 │
│  ┌───────────────────────────────▼───────────────────────────────────┐              │
│  │                         FitnessApp                                │              │
│  │  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐        │              │
│  │  │FitnessPlayer │  │FitnessPlayer     │  │FitnessSidebar│        │              │
│  │  │(video)       │  │Overlay (lock UI) │  │(users/chart) │        │              │
│  │  └──────────────┘  └──────────────────┘  └──────────────┘        │              │
│  └───────────────────────────────────────────────────────────────────┘              │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Components

### Backend

| Component | File | Responsibility |
|-----------|------|----------------|
| **FitSyncAdapter** | `backend/src/1_adapters/FitSyncAdapter.mjs` | Connects to ANT+ USB stick, reads HR sensor data, publishes to event bus |
| **WebSocketEventBus** | `backend/src/0_system/eventbus/WebSocketEventBus.mjs` | Pub/sub event bus with WebSocket server. Broadcasts `fitness` and `vibration` topics to browser clients |
| **FitnessConfigService** | `backend/src/3_applications/fitness/FitnessConfigService.mjs` | Reads fitness config (users, devices, zones, governance policies) from YAML |
| **FitnessPlayableService** | `backend/src/3_applications/fitness/FitnessPlayableService.mjs` | Resolves playable content for fitness (Plex media with governed labels) |
| **SessionService** | `backend/src/2_domains/fitness/services/SessionService.mjs` | Session CRUD operations with format normalization (v2/v3) |
| **SessionDatastore** | `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs` | Persists session data as YAML files at `household/history/fitness/{date}/{sessionId}.yml` |
| **SessionStatsService** | `backend/src/2_domains/fitness/services/SessionStatsService.mjs` | Computes participant statistics (peak/avg HR, total coins, zone durations) from decoded timeline data |
| **ZoneService** | `backend/src/2_domains/fitness/services/ZoneService.mjs` | Zone resolution, group zone computation, threshold defaults, priority ordering |
| **TimelineService** | `backend/src/2_domains/fitness/services/TimelineService.mjs` | Delta-encodes/decodes heart rate series for efficient YAML storage |
| **AmbientLedAdapter** | `backend/src/1_adapters/fitness/AmbientLedAdapter.mjs` | Controls ambient LED strips via Home Assistant scenes (rate-limited, circuit-breaker protected) |
| **VoiceMemoTranscription** | `backend/src/1_adapters/fitness/VoiceMemoTranscriptionService.mjs` | Two-stage transcription: Whisper (with fitness context hints) → GPT-4o cleanup |
| **ScreenshotService** | `backend/src/3_applications/fitness/services/ScreenshotService.mjs` | Saves session screenshots (base64 decode → file storage) |
| **FitnessProgressClassifier** | `backend/src/2_domains/fitness/services/FitnessProgressClassifier.mjs` | Classifies workout viewing progress (50% for short, 95% for long workouts) |
| **FitnessAPI** | `backend/src/4_api/v1/routers/fitness.mjs` | REST endpoints (see API Reference below) |

### Frontend — Session Layer (`frontend/src/hooks/fitness/`)

| Component | File | Responsibility |
|-----------|------|----------------|
| **FitnessSession** | `FitnessSession.js` | Central orchestrator. Owns all subsystems. Routes device data through the processing pipeline. Manages session lifecycle (start, tick, end). |
| **DeviceEventRouter** | `DeviceEventRouter.js` | Routes incoming device payloads to type-specific handlers (ANT+ HR, BLE jumprope, vibration sensors) via a registry pattern |
| **DeviceManager** | `DeviceManager.js` | Tracks physical devices and their current sensor readings. Handles device timeout/stale detection |
| **UserManager** | `UserManager.js` | Maps devices to users (via config). Resolves `deviceId → userId`. Provides `getAllUsers()` with current vitals |
| **ZoneProfileStore** | `ZoneProfileStore.js` | **SSoT for current zone per user.** Derives zones from HR + zone thresholds. Applies hysteresis to prevent jitter near boundaries |
| **TreasureBox** | `TreasureBox.js` | Coin accumulation engine. Awards coins based on HR zone on each tick. Tracks per-user coin totals and per-zone buckets |
| **GovernanceEngine** | `GovernanceEngine.js` | Phase state machine (pending/unlocked/warning/locked). Enforces exercise requirements for governed video content. Manages challenges |
| **FitnessTimeline** | `FitnessTimeline.js` | Time-series data store. Holds `series` (keyed arrays of HR, zone, coins per user) and `events` (discrete session events) |
| **TimelineRecorder** | `TimelineRecorder.js` | Records per-tick data snapshots into FitnessTimeline. Collects device metrics, user metrics, cumulative values |
| **SessionLifecycle** | `SessionLifecycle.js` | Manages session timing: tick timer, autosave timer, empty roster timeout. Separated from FitnessSession for SRP |
| **PersistenceManager** | `PersistenceManager.js` | Validates session data, encodes timeline series (run-length encoding), calls REST API to persist |
| **ParticipantRoster** | `ParticipantRoster.js` | Builds the participant roster from devices, users, and activity monitor data |
| **DisplayNameResolver** | `DisplayNameResolver.js` | SSoT for resolving display names (handles group labels, guest names, primary/secondary distinction) |
| **GuestAssignmentService** | `GuestAssignmentService.js` | Handles temporary device reassignment to guest users |
| **ActivityMonitor** | (in FitnessSession) | Tracks which users are actively broadcasting HR data vs. idle/dropped out |
| **EventJournal** | `EventJournal.js` | Structured event log for session events (zone changes, coin awards, governance transitions) |
| **DeviceAssignmentLedger** | `DeviceAssignmentLedger.js` | Tracks device-to-user assignments including guest overrides |

### Frontend — UI Layer (`frontend/src/modules/Fitness/`)

| Component | File | Responsibility |
|-----------|------|----------------|
| **FitnessApp** | `Apps/FitnessApp.jsx` | Top-level route component. Loads config from API. Manages navigation (menu/show/player/plugin). Wraps everything in `FitnessProvider` |
| **FitnessContext** | `context/FitnessContext.jsx` | React context provider. Bridges WebSocket data to session. Provides state to all UI components |
| **FitnessPlayer** | `FitnessPlayer.jsx` | Video player. Manages play queue, video element, playback controls. Enforces governance lock (pause/mute when locked) |
| **FitnessPlayerOverlay** | `FitnessPlayerOverlay.jsx` | Overlay UI shown during governance lock. Displays participant zones, target requirements, countdown timers |
| **FitnessSidebar** | `FitnessSidebar.jsx` | Side panel showing user avatars, HR readings, zone colors, coin counts |
| **FitnessChart** | `FitnessSidebar/FitnessChart.jsx` | Real-time race chart (SVG) showing cumulative coin progress per participant |
| **FitnessPluginContainer** | `FitnessPlugins/FitnessPluginContainer.jsx` | Plugin system for fitness mini-apps (chart, session browser, vibration monitor, pose detection) |
| **FitnessNavbar** | `FitnessNavbar.jsx` | Navigation bar with content categories |
| **FitnessPlayerFooter** | `FitnessPlayerFooter.jsx` | Seek bar, playback controls, timestamp display |
| **VolumeProvider** | `VolumeProvider.jsx` | Context for coordinating video and music volume levels |

---

## Sequence Diagrams

### Sequence 1: Sensor Data → UI Update (Happy Path)

The primary data flow for a single heart rate reading.

```
ANT+ Sensor          Backend              WebSocket        FitnessContext      FitnessSession
    │                    │                    │                  │                    │
    │  HR=130 bpm        │                    │                  │                    │
    ├───────────────────▶│                    │                  │                    │
    │                    │  broadcast         │                  │                    │
    │                    │  ('fitness',       │                  │                    │
    │                    │   {deviceId,HR})   │                  │                    │
    │                    ├───────────────────▶│                  │                    │
    │                    │                    │  onMessage()      │                    │
    │                    │                    ├─────────────────▶│                    │
    │                    │                    │                  │                    │
    │                    │                    │                  │  ingestData()      │
    │                    │                    │                  ├───────────────────▶│
    │                    │                    │                  │                    │
    │                    │                    │                  │         ┌──────────┤
    │                    │                    │                  │         │ 1. DeviceEventRouter.route()
    │                    │                    │                  │         │ 2. recordDeviceActivity()
    │                    │                    │                  │         │ 3. DeviceManager.registerDevice()
    │                    │                    │                  │         │ 4. UserManager.resolveUserForDevice()
    │                    │                    │                  │         │ 5. user.updateFromDevice()
    │                    │                    │                  │         │ 6. TreasureBox.recordHeartRateForDevice()
    │                    │                    │                  │         │ 7. ZoneProfileStore.syncFromUsers()
    │                    │                    │                  │         │ 8. [if zone changed]
    │                    │                    │                  │         │    GovernanceEngine.notifyZoneChange()
    │                    │                    │                  │         └──────────┤
    │                    │                    │                  │                    │
    │                    │                    │                  │  batchedForceUpdate()
    │                    │                    │                  │◀───────────────────┤
    │                    │                    │                  │                    │
    │                    │                    │                  │  [next rAF]        │
    │                    │                    │                  │  version++         │
    │                    │                    │                  │  React re-render   │
    │                    │                    │                  │                    │
    │                    │                    │                  │  useEffect([version])
    │                    │                    │                  ├───────────────────▶│
    │                    │                    │                  │  updateSnapshot()   │
    │                    │                    │                  │                    │
```

**Key invariant:** `batchedForceUpdate()` uses `requestAnimationFrame` to coalesce multiple WebSocket messages within the same frame into a single React render.

---

### Sequence 2: Session Lifecycle

```
                        HR Data Arrives
                             │
                             ▼
                    ┌────────────────────┐
                    │  Pre-Session Buffer│
                    │  (threshold: 3)    │
                    └────────┬───────────┘
                             │ 3 valid HR samples from distinct devices
                             ▼
                    ┌────────────────────┐
                    │  ensureStarted()   │
                    │  Creates session   │
                    │  ID, timeline,     │
                    │  timebase          │
                    └────────┬───────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ Tick Timer  │  │ Autosave   │  │ Timeline   │
     │ (5s)       │  │ Timer (15s)│  │ Recording  │
     │            │  │            │  │            │
     │ Each tick: │  │ Each save: │  │ Per HR:    │
     │ • collect  │  │ • validate │  │ • append   │
     │   metrics  │  │ • encode   │  │   to series│
     │ • award    │  │ • POST     │  │ • track    │
     │   coins    │  │   /save    │  │   events   │
     │ • check    │  │            │  │            │
     │   empty    │  │            │  │            │
     │   roster   │  │            │  │            │
     └──────┬─────┘  └──────┬─────┘  └────────────┘
            │               │
            │ empty roster  │ 60s timeout
            │ timeout       │
            ▼               ▼
     ┌────────────────────────────┐
     │      endSession()          │
     │  • Stop timers             │
     │  • Final autosave          │
     │  • Clear state             │
     └────────────────────────────┘
```

---

### Sequence 3: Tick Processing (Every 5 Seconds)

```
Tick Timer fires
     │
     ▼
_collectTimelineTick()
     │
     ├──▶ TimelineRecorder.recordTick()
     │       │
     │       ├──▶ For each active device:
     │       │       • Read HR from DeviceManager
     │       │       • Read zone from UserManager
     │       │       • Append to timeline series
     │       │       •   series["userId:hr"][tickIndex] = 130
     │       │       •   series["userId:zone"][tickIndex] = "active"
     │       │
     │       ├──▶ TreasureBox.processTick()
     │       │       │
     │       │       ├── For each user with HR:
     │       │       │     • Determine zone from HR
     │       │       │     • Check if user is active (ActivityMonitor)
     │       │       │     • Award coins based on zone rate
     │       │       │     • Update cumulative coin series
     │       │       │
     │       │       └── _notifyMutation()
     │       │             └── mutation callback → forceUpdate()
     │       │
     │       └──▶ Return tick result
     │
     ├──▶ Update timebase (intervalCount, lastTickTimestamp)
     │
     └──▶ _checkEmptyRosterTimeout()
            • If no active devices for 60s → endSession()
```

---

### Sequence 4: Video Playback with Governance

```
User selects workout video
     │
     ▼
FitnessApp.handlePlayFromUrl()
     │
     ├──▶ Fetch media metadata (labels, type)
     ├──▶ Set play queue [{media, labels, governed: true}]
     │
     ▼
FitnessPlayer mounts
     │
     ├──▶ Check: labels ∩ governedLabelSet ≠ ∅ ?
     │       │
     │       YES → playIsGoverned = true
     │       │
     │       ├──▶ GovernanceEngine.setMedia({id, labels})
     │       │
     │       └──▶ Video starts PAUSED + MUTED
     │
     ▼
GovernanceEngine.evaluate() [on next pulse/zone change]
     │
     ├──▶ Read zone data from ZoneProfileStore
     ├──▶ Evaluate base requirements (e.g., "active: all")
     │
     ├── Requirements NOT met → phase: 'pending' → video LOCKED
     │       │
     │       ▼
     │   FitnessPlayerOverlay renders lock screen:
     │   ┌─────────────────────────────────────────────┐
     │   │  ┌────┐                                     │
     │   │  │ 🧑 │ Felix    Cool ●━━━━━▶ Active ●     │
     │   │  ├────┤                                     │
     │   │  │ 👦 │ Alan     Cool ●━━━━━▶ Active ●     │
     │   │  ├────┤                                     │
     │   │  │ 👨 │ KC       Cool ●━━━━━▶ Active ●     │
     │   │  └────┘                                     │
     │   │       Get your heart rates up to continue!  │
     │   └─────────────────────────────────────────────┘
     │
     ├── Requirements MET for 500ms → phase: 'unlocked' → video PLAYS
     │       │
     │       ├──▶ Challenge timer scheduled (random 30-120s)
     │       └──▶ Overlay dismissed
     │
     ├── Requirements BREAK (after unlocked) → phase: 'warning'
     │       │
     │       ├──▶ Grace period countdown starts
     │       ├──▶ Video keeps playing (with warning tint)
     │       │
     │       ├── Re-satisfied → back to 'unlocked'
     │       └── Grace expires → phase: 'locked' → video PAUSED
     │
     └── Challenge triggered during 'unlocked'
            │
            ├──▶ Overlay shows challenge target (e.g., "warm zone")
            ├──▶ Timer counts down (pauses if base requirements break)
            ├── Success → dismiss, schedule next
            └── Failure → phase: 'locked'
```

---

### Sequence 5: Session Persistence

```
Autosave timer fires (every 15s) OR session ends
     │
     ▼
PersistenceManager._persistSession()
     │
     ├──▶ 1. Validate session
     │       • Duration >= 60s?
     │       • Has participants?
     │       • Has timeline data?
     │       [FAIL → skip save, log reason]
     │
     ├──▶ 2. Build session payload
     │       │
     │       ├── sessionId, startTime, endTime, duration
     │       ├── participants: { userId: { display_name, is_primary, hr_device } }
     │       ├── media: [{ title, plex_id, duration_seconds, labels }]
     │       ├── timeline: {
     │       │     timebase: { startTime, intervalMs, tickCount },
     │       │     series: { "userId:hr": [...], "userId:zone": [...] },
     │       │     events: [{ type, tick, data }]
     │       │   }
     │       ├── treasureBox: { totalCoins, buckets: { green: N, yellow: N } }
     │       └── summary: { participants: { userId: { peakHr, avgHr, totalCoins } } }
     │
     ├──▶ 3. Encode series (run-length encoding for compression)
     │
     ├──▶ 4. POST /api/fitness/save
     │       │
     │       └──▶ Backend: SessionDatastore.save()
     │               └── Write to household/history/fitness/{YYYY-MM-DD}/{sessionId}.yml
     │
     └──▶ 5. Log save result
```

#### Session Storage Format

Sessions are stored as YAML with two format versions:

```yaml
# V3 (current) — nested session block with human-readable times
version: 3
sessionId: "20260215190302"
session:
  start: "2026-02-15 7:03:02 pm"
  end: "2026-02-15 7:45:18 pm"
  duration_seconds: 2536
timezone: "America/Denver"
participants:
  felix: { display_name: "Felix", is_primary: true, hr_device: "28688" }
  alan:  { display_name: "Alan",  is_primary: true, hr_device: "28689" }
timeline:
  interval_seconds: 5
  tick_count: 507
  series:                          # Delta-encoded by TimelineService
    "felix:hr": [120, 1, -2, 3, ...] # First value absolute, rest are deltas
    "felix:zone": ["a", "", "", "w", ...] # Run-length: empty = same as previous
    "felix:coins": [0, 1, 1, 3, ...]
  events:
    - { type: "zone_change", tick: 42, data: { user: "felix", from: "cool", to: "active" } }
treasureBox:
  totalCoins: 1847
  buckets: { green: 450, yellow: 620, orange: 500, red: 277 }
media:
  - { title: "30 Min HIIT", plex_id: 12345, duration_seconds: 1800 }

# V2 (legacy) — root-level fields, normalized to v3 on read
startTime: 1739664182000
endTime: 1739666718000
durationMs: 2536000
roster: [{ name: "felix", isPrimary: true, hrDeviceId: "28688" }]
```

**Storage paths:**
- Session YAML: `household/history/fitness/{YYYY-MM-DD}/{sessionId}.yml`
- Screenshots: `{mediaRoot}/apps/fitness/sessions/{YYYY-MM-DD}/{sessionId}/screenshots/`

---

### Sequence 6: WebSocket Connection and Reconnection

```
Browser loads FitnessApp
     │
     ▼
WebSocketService.connect()
     │
     ├──▶ ws = new WebSocket('ws://host:port/ws')
     │
     ├──▶ ws.onopen → subscribe(['fitness', 'vibration'])
     │       Send: { type: 'subscribe', topics: ['fitness', 'vibration'] }
     │
     ├──▶ ws.onmessage → route by topic
     │       │
     │       ├── topic: 'fitness' → session.ingestData(payload)
     │       │                      batchedForceUpdate()
     │       │
     │       └── topic: 'vibration' → handleVibrationEvent()
     │
     ├──▶ ws.onclose → reconnect with exponential backoff
     │       (100ms → 200ms → 400ms → ... → 30s max)
     │
     └──▶ ws.onerror → log, attempt reconnect
```

---

## Data Flow: HR Reading End-to-End

The complete path for a single heart rate reading, naming every component it touches:

```
1.  ANT+ HR Monitor broadcasts HR=130 bpm over wireless
         │
2.  FitSyncAdapter (backend) receives via USB ANT+ stick
         │
3.  WebSocketEventBus.broadcast('fitness', {
         deviceId: '28688', type: 'heart_rate', heartRate: 130
    })
         │
4.  WebSocket delivers to browser client
         │
5.  WebSocketService.onMessage() → callback
         │
6.  FitnessContext subscription handler:
    │   session.ingestData(payload)
    │   batchedForceUpdate()
         │
7.  FitnessSession.ingestData()
    │   → DeviceEventRouter.route(payload)
    │     → ANT+ handler: DeviceManager.registerDevice()
         │
8.  FitnessSession.recordDeviceActivity()
    │   ├── DeviceManager.registerDevice()          → device.heartRate = 130
    │   ├── UserManager.resolveUserForDevice()       → user = "felix"
    │   ├── user.updateFromDevice()                  → user.currentData.heartRate = 130
    │   ├── TreasureBox.recordHeartRateForDevice()   → acc.highestZone = "active"
    │   ├── ZoneProfileStore.syncFromUsers()          → profile.currentZoneId = "active"
    │   └── [if zone changed]
    │       GovernanceEngine.notifyZoneChange("felix", {fromZone: "cool", toZone: "active"})
    │       → debounce 100ms → evaluate()
         │
9.  batchedForceUpdate() → requestAnimationFrame → version++
         │
10. React re-render → useEffect([version]) → updateSnapshot()
         │
11. UI components read from FitnessContext:
    ├── FitnessSidebar: "Felix: 130 bpm [Active ●]"
    ├── FitnessChart: coin line moves up
    ├── FitnessPlayerOverlay: zone progress bar updates
    └── FitnessPlayer: governance lock/unlock decision
```

---

## Zone System

Zones map heart rate ranges to exercise intensity levels. Each zone has a coin rate (coins earned per tick).

```
Zone Hierarchy (lowest → highest):

  ┌──────────┬───────────────┬────────┬───────────┐
  │   Zone   │  Default Min  │ Color  │ Coin Rate │
  ├──────────┼───────────────┼────────┼───────────┤
  │ rest     │      0 bpm    │ gray   │     0     │
  │ cool     │     60 bpm    │ blue   │     0     │
  │ active   │    100 bpm    │ green  │     1     │
  │ warm     │    120 bpm    │ yellow │     3     │
  │ hot      │    140 bpm    │ orange │     5     │
  │ fire     │    160 bpm    │ red    │     7     │
  └──────────┴───────────────┴────────┴───────────┘

Per-user overrides can adjust thresholds (e.g., Felix's "warm" starts at 110).
```

### Zone Hysteresis (ZoneProfileStore)

Prevents visual jitter when HR hovers near a zone boundary:

```
HR oscillating: 99 → 101 → 99 → 101

WITHOUT hysteresis:     cool → active → cool → active  (flickering)
WITH hysteresis:        cool ──────────────────────────  (stable for 3s before committing)

Rules:
  • First zone transition: instant (no wait)
  • Subsequent transitions: require 3s of continuous new zone
  • Cooldown after commit: 5s before next transition allowed
```

---

## Coin System (TreasureBox)

Coins are awarded per-user based on their current zone at each tick:

```
Every 5-second tick:
  For each active user:
    1. Get their current HR zone (from ZoneProfileStore)
    2. Look up coin rate for that zone
    3. Award coins: user.totalCoins += zone.coinRate
    4. Update cumulative series: series["userId:coins"][tick] = user.totalCoins
    5. Update zone bucket: buckets[zone.color] += zone.coinRate

The race chart visualizes cumulative coins per user over time.
Flat segments = rest/cool zone (no coins).
Steep segments = hot/fire zone (high coin rate).
```

---

## Render Update Model

The fitness UI uses a version-counter pattern instead of React's standard prop-based reactivity:

```
┌──────────────────────────────────────────────────────────┐
│                    Version Counter Pattern                │
│                                                          │
│  WebSocket msg ──▶ session.ingestData() ──┐              │
│                                           │              │
│  Governance pulse ──▶ onPulse() ──────────┤              │
│                                           │              │
│  TreasureBox mutation ──▶ callback() ─────┤              │
│                                           ▼              │
│                                   forceUpdate()          │
│                                   setVersion(v+1)        │
│                                        │                 │
│                                        ▼                 │
│                                   React render           │
│                                        │                 │
│                                        ▼                 │
│                              useEffect([version])        │
│                              updateSnapshot()            │
│                                                          │
│  Why: FitnessSession stores state in plain JS objects    │
│  (Maps, arrays), not React state. React can't detect     │
│  mutations to these. The version counter forces renders. │
│                                                          │
│  Performance: batchedForceUpdate() uses rAF to coalesce  │
│  multiple WebSocket messages within a frame.             │
│  Governance callbacks currently use direct forceUpdate() │
│  (not batched — potential render amplification issue).    │
└──────────────────────────────────────────────────────────┘
```

---

## API Reference

All endpoints are under `GET/POST /api/fitness/...` (router: `backend/src/4_api/v1/routers/fitness.mjs`).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/fitness` | Load fitness config (users, devices, zones, governance, playlists with Plex thumbnails) |
| `GET` | `/api/fitness/governed-content` | Content catalog with governance labels |
| `GET` | `/api/fitness/show/:id` | Resolve Plex show by ID |
| `GET` | `/api/fitness/show/:id/playable` | Playable episodes with watch state and progress classification |
| `POST` | `/api/fitness/save_session` | Save session data (handles v2/v3 format normalization) |
| `POST` | `/api/fitness/save_screenshot` | Store base64 session screenshot |
| `GET` | `/api/fitness/sessions/dates` | List all dates with saved sessions |
| `GET` | `/api/fitness/sessions` | Query sessions by date or date range |
| `GET` | `/api/fitness/sessions/:sessionId` | Session detail with decoded timeline |
| `POST` | `/api/fitness/voice_memo` | Transcribe voice memo (Whisper → GPT-4o cleanup) |
| `POST` | `/api/fitness/zone_led` | Sync ambient LED with current zone state |
| `GET` | `/api/fitness/zone_led/status` | LED controller status |
| `GET` | `/api/fitness/zone_led/metrics` | LED controller metrics (uptime, request rates, scene histogram) |
| `POST` | `/api/fitness/zone_led/reset` | Reset LED controller state |
| `GET` | `/api/fitness/receipt/:sessionId` | Generate fitness receipt |
| `GET` | `/api/fitness/receipt/:sessionId/print` | Print fitness receipt |
| `POST` | `/api/fitness/simulate` | Start fitness session simulation (testing) |
| `DELETE` | `/api/fitness/simulate` | Stop simulation |
| `GET` | `/api/fitness/simulate/status` | Simulation status |

---

## Ambient LED System

The `AmbientLedAdapter` controls physical LED strips that change color with the group HR zone, creating an immersive workout environment.

```
HR Zone Change (ZoneProfileStore)
     │
     ▼
FitnessContext → POST /api/fitness/zone_led
     │
     ▼
AmbientLedAdapter
     │
     ├── Rate limiter (2s throttle) — prevents rapid scene switching
     ├── Deduplication — skip if same scene as last
     ├── Grace period (30s) — delay "off" to avoid flicker during transient drops
     ├── Circuit breaker (5 max failures, exponential backoff up to 60s)
     │
     ▼
Home Assistant API → scene.activate()
     │
     Zone → Scene mapping:
     ├── cool    → scene.fitness_cool
     ├── active  → scene.fitness_active
     ├── warm    → scene.fitness_warm
     ├── hot     → scene.fitness_hot
     ├── fire    → scene.fitness_fire
     ├── fire_all → scene.fitness_breathing  (ALL users in fire zone)
     └── off     → scene.fitness_off
```

---

## Configuration

Fitness configuration is loaded from `data/household/config/fitness.yml` via `GET /api/fitness`:

```yaml
devices:
  heart_rate:
    "28688": felix          # ANT+ device ID → user ID mapping
    "28689": alan
    "28690": kckern
  cadence:
    "54321": equipment_bike

users:
  primary:                  # Always shown in sidebar
    - id: felix
      name: Felix
      hr: 28688
    - id: alan
      name: Alan
      hr: 28689
  secondary:                # Shown only when device is active
    - id: milo
      name: Milo
      hr: 28691

zones:                      # Heart rate zone definitions
  - id: cool
    name: Cool
    min: 0
    color: "#6ab8ff"
    coins: 0
  - id: active
    name: Active
    min: 100
    color: "#51cf66"
    coins: 1
  # ... etc

governance:
  grace_period_seconds: 30
  governed_labels: ["Aerobics", "Kids Fitness"]
  policies:
    default:
      base_requirement:
        - active: all       # All participants in Active zone or higher
      challenges:
        - interval: [30, 120]
          minParticipants: 2
          selections:
            - zone: warm
              time_allowed: 45
              min_participants: 1

ambient_led:
  scenes:
    off: scene.fitness_off
    cool: scene.fitness_cool
    active: scene.fitness_active
    warm: scene.fitness_warm
    hot: scene.fitness_hot
    fire: scene.fitness_fire
    fire_all: scene.fitness_breathing   # All participants in fire zone
  throttle_ms: 2000                      # Minimum time between HA API calls

equipment:
  - id: bike_001
    name: Exercise Bike
    type: bike
    cadence_device: "54321"

progressClassification:
  shortThresholdPercent: 50              # Short workouts (<45 min): 50% = watched
  longThresholdPercent: 95               # Long workouts (>45 min): 95% = watched
  longDurationSeconds: 2700              # 45 minutes
```

---

## File Reference (Complete)

### Backend

| File | Layer | Purpose |
|------|-------|---------|
| `backend/src/0_system/eventbus/WebSocketEventBus.mjs` | System | Pub/sub event bus with WebSocket server |
| `backend/src/0_system/bootstrap.mjs` | System | Wiring: creates fitness router with injected dependencies |
| `backend/src/1_adapters/FitSyncAdapter.mjs` | Adapter | ANT+ USB → event bus bridge |
| `backend/src/1_adapters/fitness/AmbientLedAdapter.mjs` | Adapter | Zone → LED scene control via Home Assistant |
| `backend/src/1_adapters/fitness/VoiceMemoTranscriptionService.mjs` | Adapter | Whisper + GPT-4o voice memo transcription |
| `backend/src/1_adapters/fitness/StravaClientAdapter.mjs` | Adapter | Strava API OAuth + activity streams |
| `backend/src/1_adapters/harvester/fitness/FitnessSyncerAdapter.mjs` | Adapter | FitnessSyncer OAuth, token cache, circuit breaker |
| `backend/src/1_adapters/harvester/fitness/FitnessSyncerHarvester.mjs` | Adapter | Activity harvesting, incremental merge, archival |
| `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs` | Adapter | YAML session persistence at `household/history/fitness/{date}/` |
| `backend/src/2_domains/fitness/entities/Session.mjs` | Domain | Session entity (v2/v3 format, timeline, participants) |
| `backend/src/2_domains/fitness/entities/Zone.mjs` | Domain | Zone entity (HR range, priority, color) |
| `backend/src/2_domains/fitness/entities/Participant.mjs` | Domain | Participant entity |
| `backend/src/2_domains/fitness/value-objects/SessionId.mjs` | Domain | SessionId format validation (YYYYMMDDHHmmss) |
| `backend/src/2_domains/fitness/value-objects/ZoneName.mjs` | Domain | Zone name enum |
| `backend/src/2_domains/fitness/services/SessionService.mjs` | Domain | Session CRUD, format normalization, date queries |
| `backend/src/2_domains/fitness/services/ZoneService.mjs` | Domain | Zone resolution, group zone, threshold defaults |
| `backend/src/2_domains/fitness/services/SessionStatsService.mjs` | Domain | Participant stats (peak/avg HR, coins, zone durations) |
| `backend/src/2_domains/fitness/services/TimelineService.mjs` | Domain | Delta encoding/decoding for timeline series |
| `backend/src/2_domains/fitness/services/FitnessProgressClassifier.mjs` | Domain | Media progress classification (50%/95% thresholds) |
| `backend/src/3_applications/fitness/FitnessConfigService.mjs` | Application | Config loading, playlist enrichment, member names |
| `backend/src/3_applications/fitness/FitnessPlayableService.mjs` | Application | Content resolution with watch state |
| `backend/src/3_applications/fitness/services/ScreenshotService.mjs` | Application | Screenshot persistence (base64 → file) |
| `backend/src/3_applications/fitness/ports/ISessionDatastore.mjs` | Port | Session persistence contract |
| `backend/src/3_applications/fitness/ports/IZoneLedController.mjs` | Port | Ambient LED control contract |
| `backend/src/3_applications/fitness/ports/IFitnessSyncerGateway.mjs` | Port | FitnessSyncer API contract |
| `backend/src/4_api/v1/routers/fitness.mjs` | API | REST endpoints |

### Frontend — Hooks/Session

| File | Purpose |
|------|---------|
| `frontend/src/hooks/fitness/FitnessSession.js` | Session orchestrator (central node) |
| `frontend/src/hooks/fitness/DeviceEventRouter.js` | Device payload routing |
| `frontend/src/hooks/fitness/DeviceManager.js` | Raw device tracking |
| `frontend/src/hooks/fitness/UserManager.js` | Device → user mapping |
| `frontend/src/hooks/fitness/ZoneProfileStore.js` | Zone stabilization (SSoT: current zone) |
| `frontend/src/hooks/fitness/TreasureBox.js` | Coin engine |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Governance state machine |
| `frontend/src/hooks/fitness/FitnessTimeline.js` | Time-series data structure |
| `frontend/src/hooks/fitness/TimelineRecorder.js` | Tick recording into timeline |
| `frontend/src/hooks/fitness/SessionLifecycle.js` | Timer management (tick, autosave) |
| `frontend/src/hooks/fitness/PersistenceManager.js` | Session validation + API persistence |
| `frontend/src/hooks/fitness/ParticipantRoster.js` | Roster building |
| `frontend/src/hooks/fitness/DisplayNameResolver.js` | Display name SSoT |
| `frontend/src/hooks/fitness/GuestAssignmentService.js` | Guest device reassignment |
| `frontend/src/hooks/fitness/DeviceAssignmentLedger.js` | Device ownership tracking |
| `frontend/src/hooks/fitness/ActivityMonitor.js` | Active/idle/dropout detection |
| `frontend/src/hooks/fitness/EventJournal.js` | Structured session event log |
| `frontend/src/hooks/fitness/SessionSerializerV3.js` | Session payload serialization |
| `frontend/src/hooks/fitness/buildSessionSummary.js` | Post-session summary computation |
| `frontend/src/hooks/fitness/zoneMetadata.js` | Zone system metadata helpers |
| `frontend/src/hooks/fitness/participantDisplayMap.js` | Participant rendering config |

### Frontend — UI

| File | Purpose |
|------|---------|
| `frontend/src/Apps/FitnessApp.jsx` | App entry point, routing, config load |
| `frontend/src/context/FitnessContext.jsx` | React context provider |
| `frontend/src/modules/Fitness/FitnessPlayer.jsx` | Video player + governance lock |
| `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx` | Lock screen overlay |
| `frontend/src/modules/Fitness/FitnessSidebar.jsx` | Users, zones, coins sidebar |
| `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.jsx` | Real-time race chart |
| `frontend/src/modules/Fitness/FitnessPlayerFooter.jsx` | Seek bar and controls |
| `frontend/src/modules/Fitness/FitnessPlugins/FitnessPluginContainer.jsx` | Plugin host |
| `frontend/src/modules/Fitness/VolumeProvider.jsx` | Volume coordination |
| `frontend/src/modules/Fitness/frames/FitnessFrame.jsx` | Layout frame |

---

## Addendum: Recurring Bug Patterns

Analysis of 14 audit/bug documents, 72 fix commits (Dec 2025 – Feb 2026), and 2 production postmortems reveals six recurring categories of issues. Each category has produced multiple bugs and absorbed significant debugging effort. Understanding these patterns is essential context for any future fitness work.

---

### Category 1: Timer & Render Lifecycle (CRITICAL — 2 production crashes)

**Pattern:** `setInterval` / `forceUpdate` / `requestAnimationFrame` interactions create runaway feedback loops on low-power hardware.

| Incident | Date | Impact | Root Cause |
|----------|------|--------|------------|
| Tick timer runaway (1,198 starts/min) | Feb 16 | Page crash, 338 renders/sec, 12 min outage on garage TV | `_startTickTimer()` called from `updateSnapshot()` on every render. No guard against duplicate interval. |
| Timer thrashing on startup (137 events in 10 min) | Jan 31 | Competing state updates, UI jank | Multiple timer starts within milliseconds from React re-mounting without cleanup. |
| Scrollbar thrashing during music | Jan 31 | Visual flicker in sidebar | Marquee text measurement loop (100ms timeout) triggering layout recalculation. |
| CSS filter FPS drop | Jan 31 | Choppy video during governance warning | `filter: blur()` on video element forced GPU compositing every frame. |

**Structural cause:** FitnessSession stores state in plain JS objects (Maps, arrays). React can't detect mutations, so the system uses a `version` counter + `forceUpdate()` to trigger renders. Multiple sources (`onPulse`, `onStateChange`, TreasureBox mutation, WebSocket data) can all call `forceUpdate()` independently. The `batchedForceUpdate()` mechanism (rAF coalescing) exists but isn't used by all callers. When unbatched callers fire rapidly, each render can restart timers and trigger more state changes — a positive feedback loop.

**Lessons:**
- Any code path that calls `forceUpdate()` MUST use `batchedForceUpdate()` — never direct.
- Timer starts MUST be idempotent (`if (this._timer) return`).
- Render frequency telemetry (`fitness.render_thrashing`) detects the problem but doesn't prevent it; consider a circuit breaker.

---

### Category 2: SSOT Violations (HIGH — 22 commits to fix display names alone)

**Pattern:** The same value is derived/cached/stored in multiple places with different logic, leading to inconsistent UI.

| Instance | Commits to Fix | Scope |
|----------|---------------|-------|
| Display names (7 sources of truth) | 22 (full refactor: `DisplayNameResolver` module) | FitnessUsers, FitnessContext, ParticipantRoster, UserManager, governance overlay |
| Governance `videoLocked` (overlay re-derived vs engine state) | 4 (`unify SSoT`, `eliminate overlay re-derivation`, `sync _composeState`) | FitnessPlayerOverlay, GovernanceEngine, FitnessPlayer |
| Zone data (ZoneProfileStore vs TreasureBox vs GovernanceEngine) | 5 | Three subsystems each maintained independent zone state |
| `preferGroupLabels` trigger | 3 | Sidebar, getUserVitals, card visibility — each checked independently |

**Structural cause:** FitnessSession has 15+ subsystems, each with its own internal state. UI components often reach into multiple subsystems and combine their data with local logic. When the combination logic differs between components (e.g., sidebar says "KC Kern" while overlay says "Dad"), the user sees inconsistency.

**Lessons:**
- New derived values must have exactly ONE computation site, exposed via a single accessor.
- If two components need the same derived value, extract it into a shared selector — don't let each component derive it.
- The `DisplayNameResolver` refactor (22 commits) is the canonical example of the cost of fixing an SSOT violation after the fact.

---

### Category 3: Config Propagation Failures (HIGH — 12 commits)

**Pattern:** Configuration loaded at startup doesn't reach all subsystems, especially after re-configuration or in historical/replay modes.

| Instance | Symptom | Root Cause |
|----------|---------|------------|
| `zoneConfig` not reaching TreasureBox | Coins awarded at wrong rates | `updateSnapshot()` didn't pass `zoneConfig` to `TreasureBox.configure()` |
| `zoneConfig` not reaching GovernanceEngine | Lock screen shows wrong thresholds | GovernanceEngine.configure() didn't accept zoneConfig directly |
| `zoneConfig` null in historical chart mode | Zone slopes not enforced, flat lines | Chart app didn't propagate config in replay path |
| Zone abbreviation map missing `rest`/`fire` | Zone colors wrong on chart edges | Abbreviation map only had 4 of 6 zones |
| `DEFAULT_ZONE_COIN_RATES` wrong zone names | Coin slope calculations incorrect | Used internal IDs instead of display names |
| Governance lock screen hydration race | Lock screen briefly shows wrong users | Governance state propagates slower than participant data |

**Structural cause:** Configuration flows through a signature-change detection pattern: `configurationSignature` (JSON-stringified config) triggers a `useEffect` that calls `session.configure(...)`. But `configure()` must propagate to all 15 subsystems, and it's easy to miss one. Historical/replay modes bypass the normal config path entirely, so they need their own propagation logic.

**Lessons:**
- When adding a new subsystem or config field, audit ALL consumers — not just the primary path.
- Historical/replay modes MUST receive the same config as live mode. Test both paths.
- The "signature change" pattern is fragile — consider a centralized config bus where subsystems subscribe to changes.

---

### Category 4: Persistence & Format Drift (HIGH — 10 commits, 2 audits)

**Pattern:** Frontend and backend disagree on the session data contract, causing data loss or bloat during save/load cycles.

| Instance | Date | Impact |
|----------|------|--------|
| Events dropped (v2/v3 contract break) | Feb 6 | Media, challenge, and voice memo events silently lost. Frontend writes root `events`, backend only reads `timeline.events`. |
| Readable timestamps replaced with unix ms | Feb 6 | Session files no longer human-readable. Backend normalizer dropped `session.start`/`session.end` strings. |
| Event duplication (10x file bloat) | Feb 12 | 70KB files (vs 7KB normal). Events stored in BOTH `timeline.events` AND root `events`. UI state events (overlay changes) fire on every join/leave. |
| Zone abbreviation not expanded on read | Feb 15 | Historical chart shows wrong zone colors. `"a"` not mapped back to `"active"` for `getZoneColor()`. |
| Cumulative vs instantaneous confusion | Feb 15 | Coin lines drop to zero mid-chart. Sparse cumulative series treated as instantaneous, causing gaps instead of flat lines. |

**Structural cause:** The session format evolved from v2 (flat, legacy) to v3 (nested, structured) during the DDD migration. The frontend `PersistenceManager` and backend `SessionService` were updated independently, creating contract mismatches. Zone data uses abbreviations (`a`, `w`, `h`) for storage efficiency but the expansion map was incomplete.

**Lessons:**
- Frontend and backend MUST share a schema definition (or at least a round-trip test).
- Any storage optimization (abbreviations, delta encoding) needs a complete, tested expansion map.
- Cumulative metrics (coins, beats) need forward-fill on read — a null means "same as previous", not zero.

---

### Category 5: Governance State Machine Instability (HIGH — 26 governance fix commits)

**Pattern:** The governance engine resets, thrashes, or enters unwinnable states, causing spurious video lock/unlock cycles.

| Instance | Date | Impact |
|----------|------|--------|
| 21 governance resets in 10 minutes | Jan 31 | Video locks/unlocks repeatedly. Each page reload resets governance to `null`, which cycles through `null → pending → unlocked`. |
| 60-70s pending phase (expected but confusing) | Jan 31 | User perceives governance as broken when one participant is in cool zone. Lock screen briefly shows wrong users. |
| Challenge target unachievable | Feb 16 | Challenge required "hot" zone but all participants were 20+ bpm below threshold. Challenge auto-failed. |
| `onStateChange` → unbatched `forceUpdate()` | Feb 16 | Every `_invalidateStateCache()` call triggered a direct `forceUpdate()`, bypassing rAF batching. Combined with tick timer restart, caused the Feb 16 crash. |

**Structural cause:** Governance depends on data from multiple async sources (ZoneProfileStore, TreasureBox, participant roster) that arrive at different times. The engine evaluates on every pulse and zone change, but the evaluation can trigger state changes that trigger more evaluations. The `onStateChange` callback was added without using the batched update mechanism.

**Lessons:**
- ALL governance callbacks MUST use `batchedForceUpdate()`.
- Challenges need a feasibility check before activation (are any participants within reach of the target zone?).
- The governance engine should never reset to `null` on transient media unavailability — add a debounce/grace period before resetting.

---

### Category 6: Page Reload & Crash Loops (MEDIUM — 2 incidents)

**Pattern:** Errors trigger page reloads, which trigger re-initialization, which triggers the same errors — creating a crash loop.

| Instance | Date | Impact |
|----------|------|--------|
| 17 reloads in 10 minutes (11 within 6 seconds) | Jan 31 | Complete session loss. Error boundary or memory pressure triggers reload. Governance resets on each reload. State never stabilizes. |
| 2 crash-reloads from render thrashing | Feb 16 | Firefox main thread saturated at 338 renders/sec. Page crashes and reloads. Thrashing resumes immediately because the same conditions exist after reload. |

**Structural cause:** The fitness app initializes eagerly on mount — WebSocket subscribes, session starts, timers begin, governance evaluates. If the conditions that caused the crash persist (e.g., rapid HR data + unbatched forceUpdate), the crash recurs immediately. There's no backoff or degraded mode after a crash-reload.

**Lessons:**
- Add a reload counter/backoff: if the page has reloaded N times within M seconds, enter a degraded mode that skips heavy initialization.
- The render thrashing detector should become a circuit breaker — not just log the problem but actively stop timers and pause WebSocket processing.
- Consider persisting a "crash flag" in sessionStorage that prevents immediate re-initialization.

---

### Bug Category Heatmap

```
                           Incidents   Fix Commits   Production Crashes
                           ─────────   ───────────   ──────────────────
Timer & Render Lifecycle      4+           8              2
SSOT Violations               4+          22              0
Config Propagation            6+          12              0
Persistence & Format          5+          10              0
Governance State Machine      4+          26              1
Page Reload / Crash Loops     2            3              2
                           ─────────   ───────────   ──────────────────
Total                        25+          81              5
```

**Key insight:** The timer/render and governance categories overlap significantly — the Feb 16 crash was caused by governance callbacks (Category 5) triggering unbatched renders (Category 1) that restarted timers (Category 1) in a feedback loop. This overlap is the system's most dangerous failure mode.

---

### Source Documents

| Document | Date | Category |
|----------|------|----------|
| `docs/_wip/audits/2026-02-16-fitness-session-crash-postmortem.md` | Feb 16 | Timer, Governance, Crash Loop |
| `docs/_wip/bugs/2026-01-31-fitness-state-machine-audit.md` | Jan 31 | Governance, SSOT, Timer, Crash Loop |
| `docs/_wip/audits/2026-02-15-session-chart-historical-rendering-audit.md` | Feb 15 | Config Propagation, Persistence |
| `docs/_wip/audits/2026-02-12-fitness-events-deduplication-audit.md` | Feb 12 | Persistence |
| `docs/_wip/audits/2026-02-06-fitness-session-persistence-nerf-audit.md` | Feb 6 | Persistence |
| `docs/_wip/audits/2026-02-03-fitness-module-architecture-audit.md` | Feb 3 | SSOT, Architectural Debt |
| `docs/_wip/audits/2026-02-03-fitness-display-name-architecture-problems.md` | Feb 3 | SSOT |
| `docs/_wip/bugs/2026-02-03-fitness-music-player-scrollbar-thrashing.md` | Feb 3 | Timer/Render |
| `docs/_wip/bugs/2026-02-03-fitness-music-player-not-playable.md` | Feb 3 | Config Propagation |
| `docs/_wip/bugs/2026-02-02-fitness-zoom-seek-offset-bug.md` | Feb 2 | State Machine |
| `docs/_wip/bugs/2026-01-27-fitness-watch-history-not-syncing.md` | Jan 27 | Persistence |

---

## See Also

- `governance-engine.md` — Governance API reference, configuration, testing patterns
- `governance-system-architecture.md` — Governance event flow, SSoT boundaries, hysteresis details
- `voice-memo.md` — Voice memo recording/transcription system
- `assign-guest.md` — Guest device reassignment feature
- `display-name-resolver.md` — Display name resolution logic
