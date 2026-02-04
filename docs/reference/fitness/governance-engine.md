# Governance Engine Reference

This document covers the GovernanceEngine, FitnessSession, and related subsystems that control content access based on exercise requirements.

---

## Overview

The Governance Engine controls video playback based on heart rate zone requirements. When users watch "governed" content (tagged with specific Plex labels), they must maintain certain heart rate zones to continue watching.

**Key concept**: Governance is about zone requirements, not raw heart rate values. A user at 130 BPM might be in different zones depending on their personal zone configuration.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Data Flow                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  WebSocket (HR Data)                                                │
│       ↓                                                             │
│  DeviceManager.updateDevice()                                       │
│       ↓                                                             │
│  FitnessContext (React state)                                       │
│       ↓                                                             │
│  FitnessSession.updateSnapshot()                                    │
│       ↓                                                             │
│  UserManager → ZoneProfileStore.syncFromUsers()                     │
│       ↓                                                             │
│  GovernanceEngine.evaluate()                                        │
│       ↓                                                             │
│  Phase: pending → unlocked → warning → locked                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### GovernanceEngine (`frontend/src/hooks/fitness/GovernanceEngine.js`)

The state machine that determines content access. Manages:
- Phase transitions (pending/unlocked/warning/locked)
- Requirement evaluation
- Challenge timers
- Grace period countdowns

### FitnessSession (`frontend/src/hooks/fitness/FitnessSession.js`)

Orchestrates the fitness experience:
- Coordinates between DeviceManager, UserManager, GovernanceEngine
- Manages the `snapshot` object used by UI components
- Handles `updateSnapshot()` calls that trigger re-evaluation

### ZoneProfileStore (`frontend/src/hooks/fitness/ZoneProfileStore.js`)

Stable, tick-aligned zone state for each user:
- Derives zones from heart rate + zone config
- Provides `getProfile(userId)` for zone lookup
- Source of truth for GovernanceEngine zone data

### DeviceManager (`frontend/src/hooks/fitness/DeviceManager.js`)

Tracks physical devices and their current readings:
- Maps device IDs to device objects
- Stores current HR, zone, activity status
- Handles device timeout/inactive detection

### UserManager (`frontend/src/hooks/fitness/UserManager.js`)

Maps users to their devices:
- Resolves device ID → user ID
- Provides `getAllUsers()` with current data
- Handles user profiles and zone configs

---

## Phases

The GovernanceEngine has four phases:

| Phase | Meaning | Video State |
|-------|---------|-------------|
| `pending` | Waiting for requirements | Locked |
| `unlocked` | Requirements met | Playing |
| `warning` | Grace period active | Playing (with warning) |
| `locked` | Requirements failed | Locked |

### Phase Transition Logic

```javascript
if (challengeForcesRed) {
  phase = 'locked';           // Failed challenge locks immediately
} else if (allSatisfied) {
  if (satisfiedDuration >= 500) {
    phase = 'unlocked';       // Hysteresis: 500ms sustained
  }
} else if (!satisfiedOnce) {
  phase = 'pending';          // Never unlocked before
} else {
  phase = 'warning';          // Was unlocked, now failing → grace period
}
```

---

## Critical Concepts

### Hysteresis (500ms)

Requirements must be satisfied **continuously for 500ms** before:
- `satisfiedOnce` is set to `true`
- Phase transitions to `unlocked`

**Why this matters**: Prevents rapid phase cycling when HR hovers around zone threshold.

```javascript
// GovernanceEngine.js:147
this._hysteresisMs = 500;

// GovernanceEngine.js:1366-1376
if (!this.meta.satisfiedSince) {
  this.meta.satisfiedSince = now;
}
const satisfiedDuration = now - this.meta.satisfiedSince;
if (satisfiedDuration >= this._hysteresisMs) {
  this.meta.satisfiedOnce = true;
  this._setPhase('unlocked');
}
```

### satisfiedOnce Flag

This boolean determines behavior when requirements fail:
- `satisfiedOnce = false` → phase goes to `pending`
- `satisfiedOnce = true` → phase goes to `warning` (grace period)

**Gotcha**: If you reset the engine or clear state, `satisfiedOnce` is lost, and you'll get `pending` instead of `warning` on requirement failure.

### Zone Hierarchy

Zones are ranked from lowest to highest activity level:

```yaml
zones:
  - id: cool    # rank 0, min: 0 BPM
  - id: active  # rank 1, min: 100 BPM
  - id: warm    # rank 2, min: 120 BPM
  - id: hot     # rank 3, min: 140 BPM
  - id: fire    # rank 4, min: 160 BPM
```

**Key rule**: A user at zone X satisfies any requirement for zone Y where X >= Y.

Example: User at `warm` (rank 2) satisfies `active: all` (rank 1).

### Challenge Timer Pausing

**Critical**: Challenge timers only run when `phase === 'unlocked'`.

```javascript
// GovernanceEngine.js:1884-1891
if (!isGreenPhase) {
  if (!challenge.pausedAt) {
    challenge.pausedAt = now;
    challenge.pausedRemainingMs = Math.max(0, challenge.expiresAt - now);
  }
  // Timer is PAUSED - won't expire
  return;
}
```

This means:
- Users must meet BASE requirements for challenge timer to run
- If phase is `warning` or `pending`, challenge pauses
- Challenge can never timeout while video is locked

---

## Common Gotchas

### 1. React Dependency Array Bug

**Problem**: `fitnessDevices` is a Map reference that doesn't change when items are updated.

**Symptom**: WebSocket data arrives but GovernanceEngine never re-evaluates.

**Solution**: Include `version` state in dependency array:

```javascript
// FitnessContext.jsx
useEffect(() => {
  session.updateSnapshot();
}, [users, fitnessDevices, fitnessPlayQueue, participantRoster, zoneConfig, version]);
//                                                                          ↑ REQUIRED
```

The `version` is incremented by `batchedForceUpdate()` when WebSocket data arrives.

### 2. Zone Data Source Mismatch

**Problem**: UI shows one zone, GovernanceEngine evaluates different zone.

**Cause**: Multiple sources of zone data:
- `DeviceManager.getDevice(id).zone` - raw device zone
- `ZoneProfileStore.getProfile(id).currentZoneId` - stable, tick-aligned zone

**Rule**: GovernanceEngine uses `ZoneProfileStore`, not raw device data:

```javascript
// GovernanceEngine.js:1226-1232
if (this.session?.zoneProfileStore) {
  activeParticipants.forEach((participantId) => {
    const profile = this.session.zoneProfileStore.getProfile(participantId);
    if (profile?.currentZoneId) {
      userZoneMap[participantId] = profile.currentZoneId.toLowerCase();
    }
  });
}
```

### 3. Pre-populated Devices

**Problem**: DeviceManager has devices registered before any HR data arrives.

**Cause**: Devices are pre-populated from config for UI purposes.

**Gotcha**: `deviceManager.getAllDevices().length` may return 5 even when only 1 device is actively sending HR.

**Solution**: Filter by activity status:
```javascript
const activeDevices = devices.filter(d =>
  !d.inactiveSince && Number.isFinite(d.heartRate) && d.heartRate > 0
);
```

### 4. Challenge vs Base Requirements

**Problem**: Confusion about what triggers `warning` phase during challenges.

**Rule**: `allSatisfied` evaluates BASE requirement only:
```javascript
// GovernanceEngine.js:1343-1344
const baseRequirement = activePolicy.baseRequirement || {};
const { summaries, allSatisfied } = this._evaluateRequirementSet(baseRequirement, ...);
```

Challenge satisfaction is tracked separately. When a challenge is active:
- Base satisfied + challenge not satisfied → `unlocked` phase, challenge timer runs
- Base not satisfied → `warning` phase, challenge timer pauses

### 5. Overlay vs Phase Discrepancy

**Problem**: Lock overlay disappears before `phase === 'unlocked'`.

**Cause**: Overlay visibility may be controlled by different logic than GovernanceEngine phase.

**Symptom in tests**:
```
Video unlocked!                    ← Overlay disappeared
WARNING: Governance phase is pending, not 'unlocked'  ← Engine hasn't completed hysteresis
```

**Solution**: Always verify governance phase, not just overlay visibility:
```javascript
const govState = await extractGovernanceState(page);
if (govState?.phase !== 'unlocked') {
  // Not actually unlocked yet - wait longer
}
```

### 6. Zone Propagation Delays

**Problem**: Multiple rapid `setZone()` calls don't all propagate.

**Cause**: WebSocket message batching or React state update batching.

**Solution**: Add delays between zone changes:
```javascript
for (const device of devices) {
  await sim.setZone(device.deviceId, zone);
  await page.waitForTimeout(100);  // Allow propagation
}
await page.waitForTimeout(500);  // Final settle time
```

---

## Testing Patterns

### Verify Governance State

```javascript
async function extractGovernanceState(page) {
  return page.evaluate(() => {
    const gov = window.__fitnessGovernance;
    if (!gov) return null;
    return {
      phase: gov.phase,
      satisfiedOnce: gov.satisfiedOnce,
      userZoneMap: gov.userZoneMap || {},
      activeParticipants: gov.activeParticipants || [],
    };
  });
}
```

### Wait for Phase

```javascript
async function waitForPhase(page, targetPhase, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await extractGovernanceState(page);
    if (state?.phase === targetPhase) return true;
    await page.waitForTimeout(100);
  }
  return false;
}
```

### Unlock Video Properly

```javascript
async function unlockVideo(page, sim, devices) {
  // Set zones with delays
  for (const device of devices) {
    await sim.setZone(device.deviceId, 'warm');
    await page.waitForTimeout(100);
  }

  // Wait for both overlay AND phase
  for (let i = 0; i < 30; i++) {
    const state = await extractState(page);
    const govState = await extractGovernanceState(page);

    if (!state.visible && govState?.phase === 'unlocked') {
      return { unlocked: true, phaseUnlocked: true };
    }

    // Keep sending HR through hysteresis
    for (const device of devices) {
      await sim.setZone(device.deviceId, 'warm');
    }
    await page.waitForTimeout(100);
  }

  return { unlocked: false, phaseUnlocked: false };
}
```

---

## Exposed Debug State

The GovernanceEngine exposes state for testing via `window.__fitnessGovernance`:

```javascript
// GovernanceEngine.js:252-261
window.__fitnessGovernance = {
  phase: this.phase,
  warningDuration: ...,
  lockDuration: ...,
  activeChallenge: ...,
  videoLocked: ...,
  mediaId: ...,
  // Test diagnostics
  satisfiedOnce: this.meta?.satisfiedOnce || false,
  userZoneMap: { ...(this._latestInputs?.userZoneMap || {}) },
  activeParticipants: [...(this._latestInputs?.activeParticipants || [])],
  zoneRankMap: { ...(this._latestInputs?.zoneRankMap || {}) }
};
```

---

## Configuration

### Governance Policies

Located in `data/household/apps/fitness/config.yml`:

```yaml
governance:
  grace_period_seconds: 30
  superusers:
    - kckern
  exemptions:
    - soren  # Excluded from "all" requirements
  policies:
    default:
      base_requirement:
        - active: all  # All participants must be at 'active' zone or higher
      challenges:
        - interval: [30, 120]
          minParticipants: 2
          selections:
            - zone: warm
              time_allowed: 45
              min_participants: 1
```

### Zone Configuration

```yaml
zones:
  - name: Cool
    id: cool
    min: 0
    color: blue
  - name: Active
    id: active
    min: 100
    color: green
  # ... etc
```

---

## File Reference

| File | Purpose |
|------|---------|
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Core state machine |
| `frontend/src/hooks/fitness/FitnessSession.js` | Session orchestration |
| `frontend/src/hooks/fitness/ZoneProfileStore.js` | Stable zone state |
| `frontend/src/hooks/fitness/DeviceManager.js` | Device tracking |
| `frontend/src/hooks/fitness/UserManager.js` | User-device mapping |
| `frontend/src/context/FitnessContext.jsx` | React context provider |
| `frontend/src/modules/Fitness/FitnessLockOverlay.jsx` | Lock screen UI |
| `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs` | Test suite |

---

## See Also

- `docs/_wip/bugs/2026-02-03-governance-test-flakiness.md` - Bug investigation
- `docs/_wip/bugs/2026-02-03-governance-test-skipped-items.md` - Skipped test details
- `docs/plans/2026-02-03-governance-test-hysteresis-fix.md` - Implementation plan
