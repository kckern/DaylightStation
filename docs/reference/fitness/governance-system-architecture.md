# Governance System Architecture

A detailed event-driven architecture reference for the fitness governance system. Covers data flow sequences, SSoT boundaries, stabilization mechanisms, and known violation patterns.

For API reference and configuration, see `governance-engine.md`.

---

## System Overview

The governance system enforces exercise participation requirements during video playback. When media tagged with governed labels plays, participants must maintain prescribed heart rate zones or playback locks.

The system is **event-driven and reactive**: heart rate sensor data flows through a pipeline of transforms (device → user → zone → governance decision), with hysteresis at two layers to prevent jitter from noisy biometric data.

### Component Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Governance System Components                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐    ┌─────────────┐    ┌──────────────────┐            │
│  │ ANT+/BLE │───▶│ DeviceManager│───▶│   UserManager    │            │
│  │ Sensors  │    │  (raw HR)   │    │ (device → user)  │            │
│  └──────────┘    └─────────────┘    └────────┬─────────┘            │
│                                               │                      │
│                                     ┌─────────▼──────────┐          │
│                                     │  ZoneProfileStore   │          │
│                                     │  (hysteresis layer) │          │
│                                     │  ══════════════════ │          │
│                                     │  SSOT: Current Zone │          │
│                                     └─────────┬──────────┘          │
│                                               │                      │
│                                     ┌─────────▼──────────┐          │
│  ┌──────────────┐                   │ GovernanceEngine    │          │
│  │ Media Labels │──────────────────▶│  (state machine)   │          │
│  │ (from Plex)  │                   │  ════════════════   │          │
│  └──────────────┘                   │  SSOT: Phase +     │          │
│                                     │  Lock Decision      │          │
│                                     └─────────┬──────────┘          │
│                                               │                      │
│                    ┌──────────────────────────┼──────────────┐       │
│                    │                          │              │       │
│              ┌─────▼──────┐  ┌────────▼──────┐  ┌──────▼──────┐    │
│              │ FitnessPlayer│ │ PlayerOverlay │  │FitnessUsers │    │
│              │ (pause/mute)│  │ (lock screen) │  │ (sidebar)   │    │
│              └─────────────┘  └───────────────┘  └─────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Event Flow Sequences

### Sequence 1: Heart Rate → Zone → Governance Decision

The primary reactive loop. Triggered every time a sensor reports new HR data.

```
ANT+/BLE Sensor
    │
    ▼
WebSocket message arrives
    │  FitnessContext.jsx — wsService.subscribe()
    │
    ├──▶ session.ingestData(payload)
    │       │
    │       ├──▶ DeviceManager.updateDevice()
    │       │       Stores: raw HR, timestamp
    │       │
    │       ├──▶ UserManager.resolveUserForDevice()
    │       │       Maps: deviceId → userId
    │       │       Stores: user.currentData = { heartRate, zone }
    │       │
    │       ├──▶ ZoneProfileStore.syncFromUsers(allUsers)
    │       │       Derives: raw zone from HR + zone thresholds
    │       │       Applies: hysteresis (5s cooldown, 3s stability)
    │       │       Stores: profile.currentZoneId (stabilized)
    │       │       Returns: true if zone signature changed
    │       │
    │       └──▶ [if zone changed] GovernanceEngine.notifyZoneChange()
    │               Debounces: 100ms
    │               Calls: evaluate()
    │
    └──▶ batchedForceUpdate()
            Increments: version counter
            Triggers: React re-render
                │
                └──▶ useEffect([..., version])
                        Calls: session.updateSnapshot()
                            │
                            └──▶ GovernanceEngine.evaluate()
                                    Reads: ZoneProfileStore (not raw vitals)
                                    Evaluates: policy requirements
                                    Updates: phase, challenge state
                                    Calls: onPhaseChange callback
```

**Timing budget:**

| Step | Latency | Cumulative |
|------|---------|------------|
| Sensor → WebSocket | ~50ms | 50ms |
| ingestData pipeline | ~5ms | 55ms |
| Zone hysteresis | 0ms (or 3-5s if jittering) | 55ms |
| notifyZoneChange debounce | 100ms | 155ms |
| evaluate() | ~5ms | 160ms |
| React render | ~16ms | 176ms |
| UI update visible | ~0ms | 176ms |

**Total: ~176ms sensor-to-UI** (when zone is stable). Up to **5 seconds** when zone is jittering near a boundary (by design — hysteresis prevents flicker).

---

### Sequence 2: Media Load → Governance Lock

Triggered when a new media item begins playing.

```
currentItem changes (FitnessPlayer.jsx)
    │
    ▼
useEffect([currentItem])
    │
    ├──▶ setGovernanceMedia({ id, labels, type })
    │       │  FitnessContext.jsx
    │       │
    │       ├──▶ GovernanceEngine.setMedia(media)
    │       │       Stores: this.media = { id, labels, type }
    │       │       ⚠ Does NOT call evaluate()
    │       │
    │       └──▶ forceUpdate()
    │               Triggers: React re-render
    │
    └──▶ [player reads governance state — sole lock authority]
            Reads: effectiveGovernanceState.videoLocked (engine SSoT, bypass-aware)
            Sets: pause decision from that lock flag only
                │
                ▼
            pauseDecision = resolvePause({ governance: { locked } })
                │
                ▼
            Video paused + muted (if locked)
```

**Critical gap:** `setMedia()` does not trigger `evaluate()`. The GovernanceEngine re-evaluates on the next trigger: WebSocket snapshot update, zone change notification, or pulse timer. This creates a brief window (~0-2 seconds) after a new item loads where the engine state (requirements, zone labels for the lock screen) may lag the new media.

The player no longer keeps a local label-matching fast path: `videoLocked` from the engine state is the sole lock authority (the local check was removed during SSoT consolidation). During the lag window the engine reports its prior decision until the next evaluation catches up.

---

### Sequence 3: Phase Transitions

The GovernanceEngine is a four-phase state machine:

```
                    ┌──────────────────────────────────────────────────┐
                    │                                                  │
                    ▼                                                  │
              ┌──────────┐                                             │
              │ PENDING  │ ◀──── No participants / never satisfied     │
              │ (locked) │                                             │
              └────┬─────┘                                             │
                   │                                                   │
                   │ requirements satisfied                            │
                   │ + 500ms hysteresis hold                           │
                   │                                                   │
              ┌────▼─────┐                                             │
    ┌────────▶│ UNLOCKED │ ◀───── Video plays, challenges can trigger  │
    │         │ (playing) │                                             │
    │         └────┬─────┘                                             │
    │              │                                                   │
    │              │ requirements break                                │
    │              │ (satisfiedOnce = true)                            │
    │              │                                                   │
    │         ┌────▼─────┐                                             │
    │         │ WARNING  │ ◀───── Grace period countdown               │
    │         │ (playing) │       Challenge timers PAUSED               │
    │         └────┬─────┘                                             │
    │              │                                                   │
    │              ├──── requirements re-satisfied ────────────────┐    │
    │              │                                               │    │
    │              │ grace period expires                          │    │
    │              │ OR challenge fails                            │    │
    │              │                                               │    │
    │         ┌────▼─────┐                                        │    │
    │         │ LOCKED   │                                        │    │
    │         │ (locked) │                                        │    │
    │         └────┬─────┘                                        │    │
    │              │                                               │    │
    │              │ requirements satisfied + 500ms hysteresis     │    │
    │              │                                               │    │
    └──────────────┘                                     ┌────────┘    │
                                                         │             │
                                                         └─────────────┘
```

**Key transitions:**

| From | To | Condition |
|------|----|-----------|
| pending → unlocked | All requirements met for 500ms continuously |
| unlocked → warning | Requirements break AND `satisfiedOnce = true` |
| unlocked → locked | Challenge failure (absolute — base requirements irrelevant) |
| warning → unlocked | Requirements re-satisfied |
| warning → locked | Grace period expires OR challenge fails |
| locked → unlocked | Requirements met for 500ms AND no active failed challenge |
| any → pending | No media, no participants, or engine reset |

---

### Sequence 4: Challenge Lifecycle

Challenges are timed tasks overlaid on base requirements.

```
GovernanceEngine (unlocked phase)
    │
    ▼
_schedulePulse(intervalMs)
    │  Random interval from policy config: [30, 120] seconds
    │
    ▼
Timer fires → _triggerPulse()
    │
    ├──▶ Select challenge from policy
    │       Zone: e.g., "warm"
    │       RequiredCount: e.g., 1
    │       TimeLimit: e.g., 45 seconds
    │
    ├──▶ challengeState.activeChallenge = { zone, requiredCount, ... }
    │
    └──▶ _schedulePulse(50ms)  ← Rapid re-evaluation during challenge
            │
            ▼
        evaluate() on each pulse
            │
            ├── Participants meet challenge zone?
            │       YES (for 500ms) → status: 'success'
            │           Clear challenge, schedule next
            │           _schedulePulse(nextInterval)
            │
            ├── Timer expired?
            │       YES → status: 'failed'
            │           videoLocked = true
            │           phase → locked
            │
            └── Phase changed to warning/locked?
                    Challenge timer PAUSES
                    challenge.pausedAt = now
                    challenge.pausedRemainingMs = remaining
                    Timer resumes when phase returns to unlocked
```

**Challenge timer pausing rule:** Challenge timers only count down during `unlocked` phase. If the user drops below base requirements (entering `warning`), the challenge clock freezes. This prevents double-penalizing users who are already being warned about base requirements.

---

### Sequence 5: Lock Screen Display Resolution

When governance locks playback, the overlay shows each participant's current zone, target zone, and progress.

```
FitnessPlayerOverlay renders
    │
    ├──▶ For each participant in lockRows:
    │       │
    │       ├──▶ resolveParticipantVitals(name, participant)
    │       │       Reads: getUserVitals(name) from FitnessContext
    │       │       Returns: { heartRate, zoneId, profileId, ... }
    │       │
    │       ├──▶ getParticipantZone(participant, vitals)
    │       │       1. Try ZoneProfileStore (SSOT — stabilized)    ← Added 2026-02-13
    │       │       2. Fallback: raw vitals zoneId
    │       │       3. Fallback: zone label lookup
    │       │       Returns: { id, name, color, min }
    │       │
    │       ├──▶ buildTargetInfo(requirement)
    │       │       Reads: requirement.zone from GovernanceEngine
    │       │       Looks up: zoneMetadata.map[normalizedZoneId]
    │       │       Returns: { label, color, targetHeartRate }
    │       │
    │       └──▶ computeProgressData()
    │               Reads: zone progress snapshot OR raw HR
    │               Calculates: % progress toward target zone
    │               Returns: { progress: 0.0-1.0 }
    │
    └──▶ Renders lock row:
            [Avatar] [Name] [Current: Cool ●] ━━━━━━━▶ [Target: Active ●]
```

Current lock overlay behavior:

- The lock panel uses a wide, horizontal layout (16:9 target envelope) to prioritize per-participant row density.
- Each participant renders in a single row: avatar/name, current pill, progress track, target pill.
- The header includes challenge completion blocks (dark when incomplete, bright when complete) plus summary text (`actual/target` and participant pool size when available).
- The `current` pill is frozen when lock/pending starts and remains static until the lock snapshot changes, preventing distracting mid-lock zone label jumps.
- When the participant pool is empty, the overlay switches to an explicit waiting state (no `0 of 0` challenge summary and no "Meet these conditions" copy), with actionable guidance to connect/start participants.

### Bypass-Aware Effective State

The lock overlay reflects an **effective** governance state, not the raw engine state. The player derives an effective state that collapses to fully-unlocked whenever a bypass is in effect: a sticky session-wide `nogovern` flag, a runtime fingerprint unlock granted for the current item, or a per-item `nogovern` tag. When bypassed, the effective state sets `videoLocked: false`, `isGoverned: false`, and nulls the lock side-channels (`audioDuck`, `challenge`, `deadline`) so nothing downstream keeps acting on the released lock.

The overlay host accepts this effective state as an override and prefers it over the raw context state when present. Because the overlay's display derivation returns nothing when `isGoverned` is false, a bypass cleanly suppresses the lock panel. This corrects an earlier defect where the lock panel persisted on screen after a fingerprint unlock because the overlay read the raw engine state directly.

The bypass is a **downstream override, not engine SSoT**: the GovernanceEngine itself has no knowledge of these bypasses and continues to evaluate normally. A runtime fingerprint bypass is scoped to the currently-playing item and is cleared when the item changes, so a single unlock cannot disable governance for the rest of the session.

**Residual sidebar seam:** the sidebar's governance panel still reads `isGoverned` from the raw context state, not the player's effective state. A bypass that suppresses the lock overlay therefore does not suppress the sidebar governance panel. Folding the bypass into a shared source (or into the engine) remains a deferred follow-up.

---

## SSoT Boundaries

### Authoritative Sources

Each piece of data has exactly one authoritative source. All other components must read from that source.

| Data | Authoritative Source | Read By |
|------|---------------------|---------|
| Raw heart rate | DeviceManager | UserManager, ZoneProfileStore |
| Current zone (stabilized) | **ZoneProfileStore** | GovernanceEngine, PlayerOverlay, FitnessUsers |
| Governance phase | **GovernanceEngine.phase** | FitnessContext → all consumers |
| Media governed? | **GovernanceEngine._mediaIsGoverned()** | FitnessPlayer (via state) |
| Lock decision | **GovernanceEngine.state.videoLocked** | FitnessPlayer pauseDecision |
| Governed labels | FitnessContext (from config) | GovernanceEngine, FitnessPlayer |
| Participant roster | FitnessSession.roster | GovernanceEngine, FitnessContext |
| Zone config | fitnessConfiguration (from API) | ZoneProfileStore, GovernanceEngine |
| Challenge state | **GovernanceEngine.challengeState** | FitnessContext → overlay |
| Audio cue / duck descriptor | **GovernanceEngine** (composed state) | Audio duck hook (plays the SFX, ducks/restores video volume) |
| Effective (bypass-aware) state | **FitnessPlayer** (derived from raw state + bypass) | PlayerOverlay (lock screen), player autoplay/pause gating |

### Dual-Write Antipattern

The system historically suffered from data being written to multiple stores independently, leading to contradictions. The primary vectors:

**Zone data** is the most common violation. A user's zone exists in:
1. `DeviceManager.device.zone` — raw, from device firmware
2. `UserManager.user.currentData.zone` — raw, copied from device
3. `ZoneProfileStore.profile.currentZoneId` — stabilized via hysteresis
4. `getUserVitals().zoneId` — merged from UserManager + participant roster

The **authoritative** source is #3 (ZoneProfileStore). All UI components and governance evaluation must read from it.

---

## Hysteresis & Stabilization

### Layer 1: ZoneProfileStore (Zone Jitter Prevention)

Prevents rapid visual toggling when HR hovers near zone boundaries (e.g., 99-101 BPM flickering between Cool and Active).

**Algorithm:**

```
For each HR update:
  1. Derive rawZoneId from HR + zone thresholds
  2. If rawZoneId === committedZoneId → no change
  3. If timeSinceLastCommit > 5000ms → commit immediately (first transition)
  4. If rawZoneStableDuration >= 3000ms → commit (stable long enough)
  5. Else → suppress change, keep showing committedZoneId
```

**Parameters:**
- Cooldown window: 5 seconds after last zone commit
- Stability requirement: 3 seconds of continuous new zone
- First transition: instant (no stability wait)

### Layer 2: GovernanceEngine (Phase Flap Prevention)

Prevents rapid phase cycling between unlocked/warning when requirements hover at boundary.

**Algorithm:**

```
For each evaluate():
  If challengeForcesRed (active challenge with status 'failed'):
    phase = 'locked'   (recovery only via challenge satisfaction check)
  Else if allSatisfied:
    If satisfiedSince is null → set satisfiedSince = now
    If (now - satisfiedSince) >= 500ms:
      satisfiedOnce = true
      phase = 'unlocked'
    Else:
      Keep current phase (don't flap back to pending)
  Else:
    Clear satisfiedSince
    If satisfiedOnce → phase = 'warning'
    Else → phase = 'pending'
```

**Parameters:**
- Unlock hysteresis: 500ms sustained satisfaction required
- Grace period: configurable per-policy (default from `grace_period_seconds`)

---

## Historical Bug Patterns

The following patterns have caused repeated failures. Understanding them prevents regression.

### Pattern 1: React Dependency Array Stale Closures

**Symptom:** WebSocket data arrives but governance never re-evaluates.

**Root cause:** `fitnessDevices` is a `Map` reference. React's dependency comparison uses `Object.is()`, which returns `true` for the same Map reference even when its contents change.

**Fix:** Include a `version` counter in dependency arrays, incremented by `batchedForceUpdate()`:
```javascript
useEffect(() => {
  session.updateSnapshot();
}, [users, fitnessDevices, ..., version]);
//                                ↑ Forces re-run when WebSocket data arrives
```

**Lesson:** Maps and Sets need wrapper state for React change detection.

### Pattern 2: Zone Config Hydration Cascade

**Symptom:** Lock screen shows "Target zone" placeholder for ~1 second before displaying actual zone name (e.g., "Active").

**Root cause:** GovernanceEngine.configure() ran before zone config was available. The zoneInfoMap was empty during the first evaluate(), so requirement labels couldn't be resolved.

**Fix:** Pre-seed `_latestInputs.zoneInfoMap` and `zoneRankMap` during `configure()` from the provided `zoneConfig`:
```javascript
configure(config, policies, options) {
  // Seed zone maps BEFORE first evaluate
  if (config.zoneConfig) {
    this._latestInputs.zoneRankMap = buildRankMap(config.zoneConfig);
    this._latestInputs.zoneInfoMap = buildInfoMap(config.zoneConfig);
  }
  this.evaluate(); // Now has zone data for proper labels
}
```

**Lesson:** Static configuration should be available synchronously at initialization, not deferred to async effects.

### Pattern 3: setMedia() Without evaluate()

**Symptom:** Governance doesn't lock when media loads from URL route.

**Root cause:** `GovernanceEngine.setMedia(media)` stores the media object but does not trigger `evaluate()`. The engine waits for the next external trigger (WebSocket snapshot, zone change, or pulse timer).

The player relies on the engine's `videoLocked` flag as the sole lock authority (the earlier local label-matching fast path was removed during SSoT consolidation). Until the next evaluation, the engine reports its prior decision, so lock screen details (requirements, target zone labels, participant progress) can be stale for up to 2 seconds after a new item loads.

**Current status:** Lock/unlock follows the engine state directly; only the lock screen detail rendering lags during the brief catch-up window.

### Pattern 4: Info API Missing Labels at Top Level

**Symptom:** Governance doesn't trigger when content is loaded via direct URL route (`/fitness/play/:id`).

**Root cause:** The info API's `transformToInfoResponse()` nests labels inside `metadata.labels`, but `handlePlayFromUrl()` reads `response.labels` (top level). Falls back to empty array.

**Fix applied 2026-02-13:**
```javascript
labels: response.labels || response.metadata?.labels || []
```

**Lesson:** API response shape must match consumer expectations. When adding new consumers, verify field paths.

### Pattern 5: Timer Survival Across Phase Transitions

**Symptom:** Challenge timer fires after phase has changed, causing impossible state.

**Root cause:** `setTimeout` references aren't cleaned up when phase transitions occur. A timer scheduled during `unlocked` phase fires after the engine has moved to `warning`.

**Fix:** `_clearTimers()` called on every phase transition. Challenge timers store `pausedAt` and `pausedRemainingMs` to support pause/resume.

### Pattern 6: CSS Filter Performance Cliff

**Symptom:** FPS drops from 50 to 9-11 during governance warning phase.

**Root cause:** Stacking CSS `filter` on video element + `backdrop-filter` on overlay + `backdrop-filter` on panel creates 3 compositing layers. GPU cost is multiplicative, not additive.

**Fix:** Replace CSS filters on video with a semi-transparent tinted overlay using single `backdrop-filter`.

---

## Resolved SSoT Violations

All previously documented SSoT violations have been addressed:

| # | Violation | Resolution |
|---|-----------|-----------|
| 1 | `getUserVitals().zoneId` raw zone | Now reads from ZoneProfileStore first, falls back to raw zone for initial state |
| 2 | FitnessPlayer dual governance check | Removed local label check from `pauseDecision` and `playObject.autoplay`; `governanceState.videoLocked` is sole lock authority |
| 3 | Heart rate triple-storage | Documented propagation chain in `ingestData()`; removed stale snapshot fallback in ZoneProfileStore |
| 4 | Progress bar data source split | Fallback path now prefers `progressEntry.currentHR` over raw `heartRate` |
| 5 | Heart rate structure inconsistency | Removed dead `hr.value` checks; standardized on flat `heartRate` (the only shape the roster produces) |

### Design Decisions

- **Triple HR storage retained:** DeviceManager, UserManager, and ZoneProfileStore each serve different roles. The three stores update synchronously in `ingestData()`. If any path becomes async, this must be collapsed to a single authoritative store.
- **Raw zone fields retained in vitals:** `getUserVitals().zoneId` now prefers ZoneProfileStore but falls back to raw zone for initial state before first stabilization cycle.
- **`computeProgressData` two paths retained:** Zone-based and HR-based are fundamentally different algorithms for different scenarios. The fix ensures both use the same HR source (snapshot preferred over raw).

---

## Persistence & Recovery

### What Survives a Page Refresh

| State | Persisted? | Recovery Source |
|-------|-----------|----------------|
| Session history | Yes | Backend database |
| Governance phase | **No** | Resets to `pending` |
| `satisfiedOnce` flag | Yes (in payload) | Not used to restore phase |
| Active challenge | **No** | Clears |
| Zone profiles | **No** | Rebuilt from fresh sensor data |
| Challenge history | Yes (in payload) | Not used to restore |
| Media queue | **No** | Must re-navigate to content |

**Design decision:** Governance state is intentionally **not** recovered. After a page refresh, participants must re-earn their unlocked status. This prevents stale governance decisions from persisting after environmental changes (different participants, different content).

### Autosave Cadence

FitnessSession triggers persistence:
- On session end (explicit)
- On autosave interval (configurable, typically 60s)
- On page unload (best-effort `beforeunload`)

Payload is validated before API call (minimum 60s duration, valid roster, series length checks).

---

## File Reference

| File | Role | SSoT Responsibility |
|------|------|-------------------|
| `frontend/src/hooks/fitness/GovernanceEngine.js` | State machine, phase transitions, challenges | Phase, lock decision |
| `frontend/src/hooks/fitness/ZoneProfileStore.js` | Zone stabilization via hysteresis | Current zone per user |
| `frontend/src/hooks/fitness/FitnessSession.js` | Session orchestration, data routing | Roster, session lifecycle |
| `frontend/src/hooks/fitness/PersistenceManager.js` | Validation, encoding, API persistence | Session payload format |
| `frontend/src/hooks/fitness/DeviceManager.js` | Raw device tracking | Device readings |
| `frontend/src/hooks/fitness/UserManager.js` | Device → user mapping | User-device associations |
| `frontend/src/context/FitnessContext.jsx` | React context, WebSocket → session bridge | Governed labels config |
| `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` | Video control, bypass-aware effective state | Playback state, effective governance state |
| `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx` | Overlay host; honors `governanceStateOverride` | Overlay dispatch |
| `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.jsx` | Lock / warning screen UI, zone display | Display rendering |
| `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js` | Cue SFX + duck/restore lifecycle | Audio duck session |
| `frontend/src/modules/Fitness/player/FitnessSidebar.jsx` | Sidebar governance panel (reads raw context state) | Sidebar display |
| `frontend/src/Apps/FitnessApp.jsx` | URL routing, config loading, queue management | Content source |
| `backend/src/4_api/v1/routers/info.mjs` | Content metadata API | Media metadata |

---

## See Also

- `governance-engine.md` — API reference, configuration, testing patterns
- `docs/_wip/bugs/2026-02-03-governance-test-flakiness.md` — Test flakiness investigation
