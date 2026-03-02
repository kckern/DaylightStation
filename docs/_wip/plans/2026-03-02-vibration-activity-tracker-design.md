# Vibration Activity Tracker — Design

**Date:** 2026-03-02
**Status:** Draft

## Problem

Vibration sensors (punching bag, step platform, pull-up bar) are already streaming data through the full MQTT → backend → WebSocket → frontend pipeline. The data arrives in `FitnessContext.handleVibrationEvent()` and updates React state, but is NOT fed into FitnessSession's timeline or governance system. There is no activity accumulation, no session tracking, and no way to set governance challenges based on vibration equipment.

### Sensor Data Characteristics

| Property | Pull-up Bar | Punching Bag | Step Platform |
|----------|-------------|--------------|---------------|
| Burst-mode rate | ~0.5 Hz | ~0.5 Hz | ~0.33 Hz |
| Idle heartbeat | ~600s | ~600s | ~600s |
| Activity signal-to-noise | 1.5-2.1x | 2.5-3.4x | 30-48x |
| Peak magnitude | 2095 | 2719 | 3445 (clipping) |
| Power differentiation | Minimal | Yes (lateral X/Y) | No (all impacts clip) |
| Individual rep counting | Not feasible | Not feasible | Not feasible |
| Session detection | Reliable | Reliable | Reliable |

**Key constraint:** ~0.5 Hz sample rate means individual reps cannot be counted. Challenges must be duration-based, burst-count-based, or intensity-threshold-based.

## Architecture

### New: VibrationActivityTracker

A per-equipment stateful object owned by `FitnessSession`, following the same pattern as `GovernanceEngine` and `TreasureBox`.

**State machine:**

```
idle → active → idle  (cycle on each burst)
```

- **idle**: No vibration detected for `idle_timeout_seconds`. Session timer paused. Counters hold until `session_reset_seconds` elapses, then zero.
- **active**: Receiving vibration events. Session timer running. Impact counter incrementing.

**Snapshot properties (exposed to UI and governance):**

| Property | Type | Description |
|----------|------|-------------|
| `status` | `'idle'` \| `'active'` | Current state |
| `sessionDurationMs` | `number` | Current activity session duration |
| `sessionStartedAt` | `number \| null` | When current session began |
| `detectedImpacts` | `number` | Raw impacts detected this session |
| `estimatedImpacts` | `number` | Detected x multiplier |
| `currentIntensity` | `number` | Latest magnitude (0 = idle) |
| `intensityLevel` | `'none'` \| `'low'` \| `'medium'` \| `'high'` | Bucketed from config |
| `peakIntensity` | `number` | Highest magnitude this session |
| `recentIntensityHistory` | `number[]` | Rolling window for activity bar chart |

### New: VibrationActivityAvatar

A single generic presentational component (like `RpmDeviceAvatar`) that renders either device type via props:

| Prop | Punching Bag | Stepper |
|------|-------------|---------|
| `showIntensityRing` | `true` (color = magnitude) | `false` (simple active/idle glow) |
| `showActivityBar` | `true` (sparkline) | `false` |
| `showTimer` | `true` | `true` |
| `ringColorMap` | `{low: green, med: orange, high: red}` | `{active: blue}` |

Uses Web Animations API for all animations (TVApp kills CSS transitions via `!important`).

## Configuration

### Equipment YAML (extends existing)

```yaml
equipment:
  - id: punching_bag
    name: Punching Bag
    type: punching_bag
    sensor:
      type: vibration
      mqtt_topic: home/fitness/bag/vibration
    activity:
      idle_timeout_seconds: 5
      session_reset_seconds: 30
      impact_magnitude_threshold: 500
      impact_multiplier: 2.0
      intensity_levels: [500, 1000, 1500]
      history_window_seconds: 30

  - id: step_platform
    name: Step Platform
    type: step_platform
    sensor:
      type: vibration
      mqtt_topic: home/fitness/stepper/vibration
    activity:
      idle_timeout_seconds: 3
      session_reset_seconds: 20
      impact_magnitude_threshold: 300
      impact_multiplier: 1.0
      intensity_levels: []           # empty = binary only, no intensity tracking
      history_window_seconds: 30
```

### Hardcoded Fallbacks

```js
const DEFAULTS = {
  idle_timeout_seconds: 5,
  session_reset_seconds: 30,
  impact_magnitude_threshold: 400,
  impact_multiplier: 1.5,
  intensity_levels: [400, 800, 1200],
  history_window_seconds: 30
};
```

## Data Flow

### Ingestion

```
MQTT → MQTTSensorAdapter → WebSocket → FitnessContext
                                            │
                                  handleVibrationEvent()
                                            │
                              ┌─────────────┴──────────────┐
                              │                            │
                    vibrationState (existing)    session.ingestVibration()
                    (React UI snapshots)              │
                                          VibrationActivityTracker.ingest()
                                                      │
                                              burst detection
                                              magnitude calc
                                              impact counting
                                              state transitions
```

### Timeline Recording

During `_collectTimelineTick()` (every 5s), TimelineRecorder reads each tracker's snapshot:

| Series key | Value | Description |
|------------|-------|-------------|
| `vib:{equipmentId}:active` | `1` or `0` | Binary activity flag |
| `vib:{equipmentId}:intensity` | `number` | Current magnitude (punching bag only) |
| `vib:{equipmentId}:impacts` | `number` | Cumulative estimated impacts this session |

Same pattern as `bike:{id}:rpm` and `user:{id}:hr`.

### Governance

GovernanceEngine queries `session.getVibrationTracker(equipmentId).snapshot` during `_evaluateChallenges()`.

## Governance Challenge Config

New vibration-based challenge selections alongside existing zone-based ones:

```yaml
policies:
  family_workout:
    challenges:
      - interval: [120, 300]
        selections:
          - vibration: punching_bag
            criteria: duration
            target: 60
            time_allowed: 90
            label: "Bag Work"

          - vibration: punching_bag
            criteria: impacts
            target: 10
            time_allowed: 45
            label: "Hit the Bag"

          - vibration: punching_bag
            criteria: intensity
            target: 1500
            count: 3
            time_allowed: 60
            label: "Power Punches"

          - vibration: step_platform
            criteria: duration
            target: 45
            time_allowed: 60
            label: "Stepper"
```

### Evaluation Logic

- **duration**: `tracker.snapshot.sessionDurationMs >= target * 1000`
- **impacts**: `tracker.snapshot.estimatedImpacts >= target`
- **intensity**: count of entries in `recentIntensityHistory` exceeding `target` magnitude >= `count`

Vibration challenges are **equipment-scoped** (not participant-scoped). No `missingUsers` — just met/not-met. Challenge still has `time_allowed` as deadline; failure triggers lock like zone challenges.

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/hooks/fitness/VibrationActivityTracker.js` | Core state machine |
| `frontend/src/modules/Fitness/components/VibrationActivityAvatar.jsx` | Generic presentational component |

### Modified Files

| File | Change |
|------|--------|
| `FitnessSession.js` | Add `_vibrationTrackers` Map, `ingestVibration()`, create trackers in `configure()`, read snapshots in timeline tick, cleanup on reset/destroy |
| `GovernanceEngine.js` | Vibration challenge evaluation in `_evaluateChallenges()` — duration/impacts/intensity criteria |
| `DeviceEventRouter.js` | Extend `'vibration'` handler to call `session.ingestVibration()` |
| `FitnessContext.jsx` | Wire `handleVibrationEvent()` to also call `session.ingestVibration()` |
| `TimelineRecorder.js` | Record `vib:*` series from tracker snapshots during tick |

### Not Changed

- `MQTTSensorAdapter` — already handles backend pipeline
- `WebSocketService` — already subscribed to vibration topic
- Equipment YAML structure — just new optional `activity:` block
