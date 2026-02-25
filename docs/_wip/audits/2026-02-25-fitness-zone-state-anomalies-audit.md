# Fitness Zone/Color State Anomalies Audit

**Date:** 2026-02-25
**Source:** Session log analysis of `media/logs/fitness/2026-02-25T13-33-09.jsonl`
**Session:** ~30 min workout (13:33–14:04), 1 user (kckern), 3,723 log events

---

## Executive Summary

Three interrelated anomalies were identified in the zone/color state pipeline. They share a common root: **high-frequency state churn in the tick/snapshot loop** that propagates through zone profile builds, governance evaluation, and LED updates. The exit margin hysteresis is functioning correctly but is being bypassed by a data-flow mismatch between TreasureBox and ZoneProfileStore.

---

## Anomaly 1: `build_profile` Called 5x Per Tick

### Observation

155 `zoneprofilestore.build_profile` events in 30 minutes, consistently 4–5 per second, all for the same user (`kckern`) with identical output (`zones=5`, `thresholds=None`).

### Root Cause

`ZoneProfileStore.syncFromUsers()` rebuilds **all user profiles from scratch** on every call, then checks a signature to detect changes. The signature check comes *after* the rebuild loop — it prevents downstream propagation but not the rebuild work itself.

**Call chain (hot path):**
```
FitnessSession.recordDeviceActivity()     [every HR sample, ~5/sec]
  → _syncZoneProfiles(activeUsersForZones)
    → ZoneProfileStore.syncFromUsers()
      → #buildProfileFromUser(user)          [per user, per call]
        → logs 'zoneprofilestore.build_profile'
      → #computeSignature(nextMap)
      → if (signature === this._signature) return false   ← check AFTER rebuild
```

**Secondary caller:** `FitnessSession.updateSnapshot()` (line 1486) also calls `_syncZoneProfiles()` on every snapshot update, compounding the frequency.

### Key Files

| File | Lines | Role |
|------|-------|------|
| `frontend/src/hooks/fitness/ZoneProfileStore.js` | 79–96 | `syncFromUsers()` — rebuild loop without early exit |
| `frontend/src/hooks/fitness/ZoneProfileStore.js` | 146–207 | `#buildProfileFromUser()` — individual profile build + log |
| `frontend/src/hooks/fitness/ZoneProfileStore.js` | 329–339 | `#computeSignature()` — post-build change detection |
| `frontend/src/hooks/fitness/FitnessSession.js` | 520–531 | Hot path: HR ingestion triggers sync |
| `frontend/src/hooks/fitness/FitnessSession.js` | 1486 | `updateSnapshot()` secondary trigger |

### Impact

- ~25 profile rebuilds/second (5 users × 5 HR samples/sec) with zero functional change
- CPU waste on JSON serialization, zone config resolution, and signature hashing
- Contributes to the 1,400–1,700 force updates per 30-second profiling window

### Recommended Fix

Add per-user input memoization before the rebuild:

```javascript
syncFromUsers(usersIterable) {
  const nextMap = new Map();
  for (const user of usersIterable) {
    const inputSig = `${user.id}:${JSON.stringify(user.zoneConfig)}`;
    const cached = this._profileCache?.get(inputSig);
    if (cached) { nextMap.set(cached.id, cached); continue; }
    const profile = this.#buildProfileFromUser(user);
    if (profile) {
      nextMap.set(profile.id, profile);
      this._profileCache.set(inputSig, profile);
    }
  }
  // ... existing signature check
}
```

---

## Anomaly 2: Tick Timer Start/Stop Churn

### Observation

| Metric | Value |
|--------|-------|
| Timer starts | 296 |
| Timer stops | 434 |
| Rapid stop→start cycles (same minute) | 295 |

The tick timer is being torn down and recreated ~10x/minute instead of running continuously.

### Root Cause

`FitnessSession.updateSnapshot()` (line 1401) unconditionally calls `_startTickTimer()`, which calls `_stopTickTimer()` first, then creates a new timer. `updateSnapshot()` is triggered by a React `useEffect` whose dependency array includes `version` — a counter that increments on every `batchedForceUpdate()`.

**Trigger chain:**
```
GovernanceEngine._triggerPulse()
  → callbacks.onPulse()
    → FitnessContext: batchedForceUpdate()
      → setVersion(v => v + 1)
        → useEffect dependency change
          → updateSnapshot()
            → _startTickTimer()
              → _stopTickTimer()   ← timer torn down
              → setInterval(...)   ← timer recreated
```

Every governance re-evaluation (multiple times per second during active gameplay) triggers this chain.

### Why More Stops Than Starts

The 4-second rate limiter in `_startTickTimer()` (line 2116–2124) causes some starts to be skipped (`fitness.tick_timer.rate_limited`), but the preceding `_stopTickTimer()` still executes. This means: stop without start = net timer destruction.

### Key Files

| File | Lines | Role |
|------|-------|------|
| `frontend/src/hooks/fitness/FitnessSession.js` | 2112–2165 | `_startTickTimer()` with rate limiting |
| `frontend/src/hooks/fitness/FitnessSession.js` | 2167–2187 | `_stopTickTimer()` |
| `frontend/src/hooks/fitness/FitnessSession.js` | 1401 | Unconditional timer restart in `updateSnapshot()` |
| `frontend/src/context/FitnessContext.jsx` | 1999–2018 | `useEffect` with `version` dependency |
| `frontend/src/context/FitnessContext.jsx` | 574–576 | Governance callbacks → `batchedForceUpdate()` |

### Impact

- Timer interval resets on every restart, causing drift in tick timing
- 434 `clearInterval` + 296 `setInterval` calls in 30 minutes
- Log noise: 296 start events + 434 stop events = 730 events (20% of total log)
- Potential for missed ticks during the restart gap

### Recommended Fix

Guard `_startTickTimer()` with an existence check:

```javascript
_startTickTimer() {
  if (this._tickTimer) return;  // Already running, don't restart
  // ... existing implementation minus the _stopTickTimer() call
}
```

Or remove the `_startTickTimer()` call from `updateSnapshot()` entirely — the `SessionLifecycle._tickTimer` already provides continuous ticking.

---

## Anomaly 3: LED Zone Thrashing + TreasureBox/ZoneProfileStore Mismatch

### Observation

54 LED zone change events in 30 minutes. Notable patterns:

| Time Window | Pattern | Frequency |
|-------------|---------|-----------|
| 13:38–13:43 | warm ↔ active oscillation | 6 changes / 5 min |
| 13:44:00–13:44:59 | warm→active→cool→active→cool→active | 6 changes / 60 sec |
| 13:57–14:00 | warm ↔ active flip | 6 changes / 3 min |
| 14:03–14:04 | cool → [] → cool → [] → cool → [] | 4 blank/restore cycles |

Meanwhile, 170 `exit_margin_suppressed` events show the Schmitt trigger working:
- 100x `warm → active` suppressed (HR 116–119, threshold 120, exit at 115)
- 70x `active → cool` suppressed (HR 95–99)

### Root Cause: TreasureBox and ZoneProfileStore Are Out of Sync

The hysteresis in `ZoneProfileStore` correctly suppresses zone downgrades via the Schmitt trigger (5 BPM exit margin). But the participant roster is built from **TreasureBox data**, not ZoneProfileStore:

```
HR sample arrives (120 BPM, warm/active boundary)
  │
  ├── ZoneProfileStore.#applyHysteresis()
  │     → committedZoneId stays "warm" (exit margin suppresses downgrade)
  │     → Logs exit_margin_suppressed
  │     → Returns committed zone ← CORRECT
  │
  └── TreasureBox.recordHeartRate()
        → perUser.lastZoneId = "active"  ← EAGERLY UPDATED
        → getUserZoneSnapshot() returns "active"
        → ParticipantRoster uses this for zone display
        → LED payload built from roster ← USES WRONG ZONE
```

**The mismatch:** ZoneProfileStore says "still warm" (hysteresis), but TreasureBox says "now active" (raw). The roster and LED system consume TreasureBox's value, bypassing the hysteresis entirely.

### Blank Zones at Session End

The `zones=[]` events at 14:03–14:04 are **expected behavior**. `useZoneLedSync.js` (lines 169–179) sends an immediate LED-off when `sessionActive` transitions from `true` to `false`. The repeated blank/restore pattern suggests the session is oscillating between active/inactive states during teardown — likely related to the tick timer churn (Anomaly 2) causing `sessionActive` to flicker.

### Key Files

| File | Lines | Role |
|------|-------|------|
| `frontend/src/hooks/fitness/useZoneLedSync.js` | 18–19 | Throttle (5s) and debounce (1s) constants |
| `frontend/src/hooks/fitness/useZoneLedSync.js` | 106–149 | `scheduleUpdate()` — signature-based change detection |
| `frontend/src/hooks/fitness/useZoneLedSync.js` | 162–188 | Session end handler — sends `zones=[]` |
| `frontend/src/hooks/fitness/ZoneProfileStore.js` | 265–282 | Schmitt trigger / exit margin suppression |
| `frontend/src/hooks/fitness/TreasureBox.js` | 521–527 | Eager `lastZoneId` update (bypasses hysteresis) |
| `frontend/src/hooks/fitness/ParticipantRoster.js` | 335 | Reads zone from TreasureBox, not ZoneProfileStore |
| `frontend/src/context/FitnessContext.jsx` | 1462–1465 | `zoneLedPayload` built from roster |

### Impact

- LED color changes visible to user at ~2x the intended rate
- Hysteresis is computed but not honored in the display/LED path
- Session-end LED flicker (cosmetic, brief)

### Recommended Fix

Have the roster read committed zones from ZoneProfileStore instead of raw zones from TreasureBox:

```javascript
// ParticipantRoster — use ZoneProfileStore's committed zone
const zone = this.zoneProfileStore?.getCommittedZone(userId)
  ?? this.treasureBox?.getUserZoneSnapshot(trackingId)?.lastZoneId;
```

Or have TreasureBox consult ZoneProfileStore before updating `lastZoneId`:

```javascript
// TreasureBox.recordHeartRate()
const committedZone = this.zoneProfileStore?.getCommittedZone(userId);
acc.lastZoneId = committedZone ?? rawZoneId;
```

---

## Cross-Cutting Observations

### The Three Anomalies Are Connected

```
                   HR sample arrives (~5/sec)
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
      build_profile    TreasureBox   tick timer
      (5x/tick)        eagerly       restart
      [Anomaly 1]      updates       [Anomaly 2]
              │         lastZoneId        │
              │           │               │
              │     roster gets           │
              │     wrong zone      batchedForceUpdate
              │           │               │
              │     LED payload     updateSnapshot()
              │     changes              │
              │           │         _startTickTimer()
              │     LED thrash           │
              │     [Anomaly 3]    _stopTickTimer()
              │                          │
              └──────────────────────────┘
                    shared: excessive renders
                    (1,400–1,700 per 30s window)
```

### Priority Ordering

1. **Tick timer churn (Anomaly 2)** — Highest impact. Fixing this reduces render frequency, which reduces Anomaly 1 and 3 severity. Smallest change (guard clause or remove one line).
2. **TreasureBox/ZoneProfileStore mismatch (Anomaly 3)** — User-visible. LED colors should honor hysteresis. Medium complexity.
3. **build_profile redundancy (Anomaly 1)** — Performance waste. Per-user memoization. Lowest urgency but straightforward.
