# DaylightStation Fitness System: Deep Architectural Analysis

**Date:** December 24, 2025  
**Status:** Critical architecture issues identified  
**Trigger:** The "frozen coins hack" reveals systemic data model flaws

---

## Executive Summary

The fitness system suffers from **four interconnected architectural problems** that compound each other. The "frozen coins hack" (storing coin values at dropout to prevent jumps on rejoin) is a band-aid that treats symptoms, not causes. The root issues are:

1. **No Single Source of Truth for Activity** - 5 different mechanisms determine if a user is "active"
2. **Timer-Driven TreasureBox** - Runs independently of session ticks, causing race conditions
3. **Cached Stale Data** - User/Device objects cache metrics that persist past dropout
4. **Split Timelines** - TreasureBox maintains its own timeline separate from the main one

---

## 1. TreasureBox: Independent Timer Problem

### Current Design

TreasureBox runs on its **own timer** (`_autoInterval`) that ticks independently:

```javascript
// TreasureBox.js lines 75-81
_startAutoTicker() {
  const tickMs = Math.max(1000, Math.min(this.coinTimeUnitMs / 2, 5000));
  this._autoInterval = setInterval(() => {
    try { this._processIntervals(); } catch(_){}
  }, tickMs);
}
```

**Time Source Misalignment:**

| Component | Time Source | Tick Rate |
|-----------|-------------|-----------|
| FitnessSession | `_tickIntervalMs` | 5000ms |
| TreasureBox | `_autoInterval` | ~2500ms |
| FitnessTimeline | Passive | Driven by Session |
| ActivityMonitor | Passive | Driven by Session |

TreasureBox ticks at **double the rate** of the session for "responsiveness", but this means:
- 2 TreasureBox ticks per 1 Session tick
- Coins can be awarded mid-session-interval
- Race condition between HR dropout detection and coin awards

### The Problem

`_processIntervals()` awards coins based on `highestZone`, which persists from the last HR reading:

```javascript
// TreasureBox.js lines 117-129
_processIntervals() {
  for (const [userName, acc] of this.perUser.entries()) {
    if (elapsed >= this.coinTimeUnitMs) {
      if (acc.highestZone) {
        this._awardCoins(userName, acc.highestZone);  // Awards even if user dropped out!
      }
      acc.currentIntervalStart = now;
      acc.highestZone = null;
    }
  }
}
```

**When device stops broadcasting:**
1. `recordUserHeartRate()` is never called (no HR to record)
2. `highestZone` remains set from last valid reading
3. `_processIntervals()` sees `highestZone` and awards coins
4. User earns coins while not exercising!

### Why the Hack Was Needed

Because TreasureBox timer can award coins BETWEEN session ticks:

```
Session Tick 10: Milo has 25 coins, HR=180
↓
TreasureBox fires (tick 10.5): Milo still has highestZone, awards +3 coins
↓
Session Tick 11: Milo's device stopped broadcasting (dropout detected)
  → But Milo already has 28 coins in TreasureBox
  → Session records null for HR
  → We DON'T record coins during dropout (correct)
↓
TreasureBox fires (tick 11.5): We clear highestZone, no award
↓
Session Tick 15: Milo rejoins
  → TreasureBox says 28 coins
  → Last recorded was 25
  → JUMP! (Chart shows vertical line)
```

The hack freezes `25` at dropout and uses it on rejoin to mask the TreasureBox's continued accumulation.

### Ideal Design

**TreasureBox should be tick-driven, not timer-driven:**

```javascript
// IDEAL: No independent timer
class FitnessTreasureBox {
  // Remove _autoInterval entirely!
  
  processTick(tick, activeParticipants) {
    for (const [userName, acc] of this.perUser.entries()) {
      const slug = slugifyId(userName);
      
      // Only process if participant is active
      if (!activeParticipants.has(slug)) {
        // User not active - freeze their state, don't award
        acc.highestZone = null;
        continue;
      }
      
      // Check if interval complete
      const elapsed = now - acc.currentIntervalStart;
      if (elapsed >= this.coinTimeUnitMs && acc.highestZone) {
        this._awardCoins(userName, acc.highestZone);
        acc.currentIntervalStart = now;
        acc.highestZone = null;
      }
    }
  }
}

// Called from FitnessSession._collectTimelineTick()
this.treasureBox.processTick(currentTickIndex, activeParticipantIds);
```

This ensures coins are only awarded when:
1. Session tick fires (aligned timing)
2. User is in `activeParticipantIds` (activity-aware)
3. Interval is complete (proper coin timing)

---

## 2. Multiple Sources of Truth for Activity

### Current Design: 5 Activity Mechanisms

| Component | How it determines "active" | Used For |
|-----------|---------------------------|----------|
| `UserManager.getAllUsers()` | User exists in roster | Participant list |
| `DeviceManager` | Device exists + timeout | Device pruning |
| `Timeline.series['heart_rate']` | HR value != null | Chart rendering |
| `ActivityMonitor` | Tick-by-tick status | (Phase 2 - underused) |
| `_lastTickActiveHR` Set | Fresh device data | Dropout detection |

### The Disagreement Problem

These sources can give **different answers** for the same user:

| Scenario | UserManager | DeviceManager | Timeline | Reality |
|----------|-------------|---------------|----------|---------|
| User drops out | ✅ In roster | ✅ Device exists | ❌ HR null | Inactive |
| Between timeout checks | ✅ In roster | ✅ Device exists | ❌ HR null | Inactive |
| After timeout | ❌ Removed | ❌ Removed | ❌ HR null | Inactive |

The `_lastTickActiveHR` Set was introduced to detect dropout by comparing adjacent ticks:

```javascript
// FitnessSession.js - The hack to detect dropout
this._lastTickActiveHR.forEach((slug) => {
  if (!currentTickActiveHR.has(slug)) {
    // Dropout detected by comparing tick-to-tick
    droppedUsers.push(slug);
  }
});
```

**Why this is a hack:** It's a per-tick diff comparison that lives in FitnessSession when it should be a first-class concept in the domain model.

### The ActivityMonitor Already Exists!

```javascript
// FitnessSession.js line 62 - Created but underused
this.activityMonitor = new ActivityMonitor();

// FitnessSession.js line 876 - Updated each tick
this.activityMonitor.recordTick(currentTickIndex, activeParticipantIds, { timestamp });
```

But **TreasureBox doesn't use it** and **UserManager doesn't use it**.

### Ideal Design: Single Source of Truth

```javascript
// All components query ActivityMonitor
class FitnessSession {
  isParticipantActive(slug) {
    return this.activityMonitor.isActive(slug);
  }
}

// TreasureBox checks before awarding
_awardCoins(userName, zone) {
  if (!this.activityMonitor?.isActive(slugifyId(userName))) {
    return;  // Don't award during dropout
  }
  // ... award coins
}

// Chart gets activity mask
buildBeatsSeries(entry, getSeries, timebase, { activityMonitor }) {
  const active = activityMonitor.getActivityMask(entry.id);  // Single source
  return { beats, zones, active };
}
```

---

## 3. Cached Stale Data

### Current Design: Metrics Cached Everywhere

**Heart Rate stored in 4 places:**

1. `device.lastData.heartRate` (DeviceManager)
2. `user.currentData.heartRate` (UserManager)  
3. `timeline.series['user:X:heart_rate']` (FitnessTimeline)
4. `treasureBox.perUser[X].lastHR` (TreasureBox)

### The Staleness Problem

```javascript
// UserManager.js - User caches heartRate indefinitely
#updateHeartRateData(heartRate) {
  this.currentData = { 
    heartRate: zoneSnapshot.currentHR ?? 0,  // Cached!
    // ...
  };
}

// This value persists even when device stops broadcasting!
```

When `_collectTimelineTick` runs:

```javascript
// FitnessSession.js - Problem: getMetricsSnapshot returns stale data
const snapshot = typeof user.getMetricsSnapshot === 'function' 
  ? user.getMetricsSnapshot() 
  : {};

// snapshot.heartRate is the LAST KNOWN value, not current reality
```

**The fix introduced:** `entry._hasDeviceDataThisTick` flag to distinguish fresh vs cached:

```javascript
// Only trust HR if we got FRESH device data this tick
if (!entry._hasDeviceDataThisTick) return;
```

### Ideal Design: Timeline as Single Source

```javascript
// Remove cached metrics from User and Device
// Always fetch from timeline when needed

class User {
  // Remove: currentData.heartRate
  
  getHeartRate(timeline) {
    return timeline.getLatestValue(this.id, 'heart_rate');
  }
}

// TreasureBox queries timeline, not cached perUser
resolveZone(userName, timeline) {
  const hr = timeline.getLatestValue(slugifyId(userName), 'heart_rate');
  if (!hr || hr <= 0) return null;
  // ...
}
```

---

## 4. Split Timelines

### Current Design: Two Separate Timelines

**Main Timeline (FitnessTimeline.js):**
```javascript
this.series = {
  'user:milo:heart_rate': [72, 75, null, null, 78, ...],
  'user:milo:heart_beats': [10, 22, 22, 22, 35, ...],
  'global:coins_total': [0, 5, 8, 8, 12, ...],
  // ...
};
```

**TreasureBox Timeline (TreasureBox.js):**
```javascript
this._userTimelines = new Map();  // userName -> number[] (cumulative coins per tick)
// "Milo" -> [0, 3, 6, 9, 12, ...]
```

### Why This Causes Problems

1. **Different tick alignment** - TreasureBox timeline may not align with main timeline
2. **Different key format** - TreasureBox uses `"Milo"`, timeline uses `"milo"`
3. **Different update timing** - TreasureBox updates on its own timer

When the session records `coins_total` to the main timeline:

```javascript
// FitnessSession.js - Copies from TreasureBox to main timeline
perUserCoinTotals.forEach((coins, userName) => {
  assignMetric(`user:${slug}:coins_total`, coins);
});
```

This copy can be out of sync because TreasureBox may have updated between copies.

### Ideal Design: Single Timeline

```javascript
// Remove from TreasureBox
// this._userTimelines

// TreasureBox writes directly to session timeline
_awardCoins(userName, zone) {
  const slug = slugifyId(userName);
  const key = `user:${slug}:coins_total`;
  const current = this.sessionRef.timeline.getLatestValue(key) || 0;
  this.sessionRef.timeline.appendValue(key, current + zone.coins);
}
```

---

## The "Frozen Coins" Hack Explained

### What It Does

```javascript
// FitnessSession.js - On dropout detection
if (!this._frozenCoinTotals) this._frozenCoinTotals = new Map();
this._frozenCoinTotals.set(slug, acc.totalCoins || 0);  // Freeze at 25

// On rejoin
if (this._frozenCoinTotals.has(slug)) {
  coinValue = this._frozenCoinTotals.get(slug);  // Use 25, not 28
  this._frozenCoinTotals.delete(slug);
}
```

### Why It's Needed (Currently)

Because TreasureBox can award coins between session ticks, and its internal `totalCoins` doesn't match what we last recorded to the timeline.

### Why It's Wrong

1. **Only fixes first tick** - After rejoin, subsequent ticks use real values (which jumped)
2. **Doesn't stop accumulation** - TreasureBox keeps awarding, just masks the effect
3. **State duplication** - Another place tracking coin values
4. **Doesn't address root cause** - Timer-driven TreasureBox

---

## Recommended Refactoring Priority

### Priority 1: Remove TreasureBox Timer (HIGH)

**Why:** Eliminates race conditions, aligns all processing to session tick

**Changes:**
- Remove `_startAutoTicker()` and `_autoInterval`
- Add `processTick(tick, activeParticipants)` method
- Call from `FitnessSession._collectTimelineTick()`

**Files:** `TreasureBox.js`, `FitnessSession.js`

### Priority 2: Add ActivityMonitor Check to Coin Awards (HIGH)

**Why:** Prevents coin accumulation during dropout

**Changes:**
- Pass ActivityMonitor to TreasureBox
- Check `isActive(slug)` before awarding

**Files:** `TreasureBox.js`, `FitnessSession.js`

### Priority 3: Remove Frozen Coins Hack (MEDIUM)

**Why:** After fixes 1 & 2, this is no longer needed

**Changes:**
- Remove `_frozenCoinTotals` Map
- Remove freeze/use logic

**Files:** `FitnessSession.js`

### Priority 4: Remove Cached Metrics (MEDIUM)

**Why:** Eliminates stale data bugs

**Changes:**
- Remove `User.currentData.heartRate` caching
- Remove `Device.lastData.heartRate` (or add expiry)
- Query timeline for current values

**Files:** `UserManager.js`, `DeviceManager.js`

### Priority 5: Consolidate Timelines (LOW)

**Why:** Single source of truth for all time-series data

**Changes:**
- Remove `TreasureBox._userTimelines`
- Write coins directly to main timeline

**Files:** `TreasureBox.js`

### Priority 6: Replace _lastTickActiveHR with ActivityMonitor (LOW)

**Why:** Cleaner abstraction, ActivityMonitor already tracks this

**Changes:**
- Remove `_lastTickActiveHR` Set
- Query `activityMonitor.getPreviouslyActive()` or similar

**Files:** `FitnessSession.js`

---

## Data Model: Current vs Ideal

### Current (Fragmented)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  DeviceManager  │     │   UserManager   │     │   TreasureBox   │
│  ─────────────  │     │  ─────────────  │     │  ─────────────  │
│  devices[]      │     │  users[]        │     │  perUser Map    │
│  └─lastData.hr  │     │  └─currentData  │     │  └─lastHR       │
│                 │     │    └─heartRate  │     │  └─totalCoins   │
│                 │     │                 │     │  _userTimelines │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┴───────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │    FitnessTimeline      │
                    │    ───────────────      │
                    │    series Map           │
                    │    └─heart_rate[]       │
                    │    └─coins_total[]      │
                    └─────────────────────────┘
```

### Ideal (Unified)

```
┌─────────────────────────────────────────────────────────────────┐
│                       ActivityMonitor                            │
│  Single source of truth for: who is active, when, status        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────────┐
│                       FitnessTimeline                            │
│  Single source of truth for: all time-series metrics            │
│  ─────────────────────────────────────────────────              │
│  user:X:heart_rate[]     - Raw HR values (with nulls)           │
│  user:X:coins_total[]    - Cumulative coins                     │
│  user:X:zone_id[]        - Zone at each tick                    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  TreasureBox    │  │   UserManager   │  │  DeviceManager  │
│  (tick-driven)  │  │  (roster only)  │  │  (routing only) │
│  No caching     │  │  No metrics     │  │  No caching     │
│  No timer       │  │  cache          │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Conclusion

The "frozen coins hack" is a symptom of fundamental architectural issues:

1. **TreasureBox shouldn't run on its own timer** - It should be driven by the session tick
2. **Activity should be centralized** - ActivityMonitor should be the single source of truth
3. **Metrics shouldn't be cached everywhere** - Timeline is the source, components query it
4. **There should be one timeline** - Not a separate TreasureBox timeline

Until these are addressed, we'll continue fighting symptoms with hacks.
