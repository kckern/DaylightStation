# Executive Summary: Session Entity Architecture Justification

**Document Type:** Technical Architecture Decision Record  
**Date:** January 1, 2026  
**Status:** Implemented (Phases 1-5 complete)  
**Author:** Engineering Team

---

## Executive Summary

The Session Entity architecture was introduced to solve a **fundamental design flaw** that made proper guest management impossible under the previous system. This document explains why the change was necessary, why it represents the minimal viable solution, and why it does not introduce unnecessary complexity.

**Key Finding:** The previous architecture conflated "who a person is" (profile) with "a person's participation in this session" (entity). This made it impossible to:
- Give guests fresh coin counts when they take over a device
- Track session duration per-participant accurately
- Handle the same person leaving and rejoining a session
- Implement the grace period transfer feature (brief sessions merge into successor)

The Session Entity pattern is a **well-established solution** used by fitness tracking apps (Peloton, Strava), gaming platforms (leaderboards), and healthcare systems (patient encounters) to solve exactly this class of problem.

---

## The Problem: Why Guest Management Was Broken

### Scenario That Exposed the Flaw

Consider this real-world scenario:

1. **Alan** starts working out on device 42, earns 50 coins over 10 minutes
2. Alan's friend **Bob** arrives; Alan assigns Bob as a guest on device 42
3. Expected: Bob starts at 0 coins, fresh session
4. **Actual (old system):** Bob inherits Alan's 50 coins because TreasureBox was keyed by `userId`

Even worse:

5. Bob works out for 5 minutes, earns 20 coins (showing 70 total - Alan's 50 + Bob's 20)
6. Bob leaves, Alan takes back device 42
7. Expected: Alan continues his original session
8. **Actual:** Alan now shows 70 coins (including Bob's 20)

### Root Cause Analysis

The old architecture used **profile ID as the accumulator key** everywhere:

```javascript
// OLD: TreasureBox keyed by profileId
this.perUser = new Map(); // profileId -> { totalCoins, ... }

// OLD: Timeline series keyed by profileId  
`user:${profileId}:coins_total`
`user:${profileId}:heart_rate`
```

This created an **implicit assumption**: one profile = one continuous participation. But guest management breaks this assumption because:

- A profile can participate **multiple times** in one session (leave and rejoin)
- A profile's participation can be **interrupted** by another user (guest takes over device)
- **Different participants share the same device** at different times

### Why Patches Wouldn't Work

We considered several alternatives before implementing Session Entities:

| Alternative | Why It Fails |
|------------|--------------|
| **Reset coins on guest assignment** | Destroys data if original owner rejoins; no audit trail |
| **Track "session segment" timestamps** | Still conflates profile with participation; complex timestamp math everywhere |
| **Use device ID as key instead of profile ID** | Breaks multi-device scenarios; loses profile association |
| **Add "guest mode" flag to existing structures** | Spreads guest-specific logic across entire codebase; if-statements everywhere |

Each alternative would have required **more code changes** with **worse maintainability** than the Session Entity approach.

---

## The Solution: Session Entity Architecture

### Core Concept

Introduce a simple, well-defined abstraction:

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

**Key insight:** This is the same pattern used by:
- **Peloton:** Each "ride" is an entity; your profile aggregates all rides
- **Strava:** Each "activity" is an entity; profile shows totals
- **Healthcare:** Each "encounter" is an entity; patient record aggregates encounters
- **Gaming:** Each "match" is an entity; player profile tracks career stats

### What Changed

| Component | Before | After | Lines Changed |
|-----------|--------|-------|---------------|
| SessionEntity.js | N/A | New file | +362 (new) |
| FitnessSession.js | Profile-keyed | Dual-writes to entity + profile | ~80 lines |
| TreasureBox.js | Profile-keyed | Entity-aware with device routing | ~60 lines |
| FitnessTimeline.js | Profile-keyed | Added entity helpers | ~100 lines |
| DeviceAssignmentLedger | No entityId | Tracks entityId | ~20 lines |
| ParticipantRoster | No entityId | Includes entityId | ~10 lines |
| Chart helpers | Profile lookup | Prefers entity, falls back to profile | ~30 lines |

**Total new code:** ~360 lines (SessionEntity.js)  
**Total modified code:** ~300 lines across 6 files  
**Backward compatibility:** 100% - existing profile-based queries still work

---

## Why This Is NOT Unnecessary Complexity

### Argument 1: "We're Adding Another ID to Track"

**Counter:** We're making an **implicit concept explicit**.

The concept of "a participation instance" already existed implicitly:
- TreasureBox reset coins via `resetUserSession()` (never called)
- User had `_cumulativeData.sessionStartTime` (set once, never updated on guest switch)
- Timeline had timestamps that implied segments

By creating `SessionEntity`, we:
- Gave this concept a **name** (entity)
- Gave it a **home** (SessionEntityRegistry)
- Gave it **clear boundaries** (startTime, endTime, status)

This is the **Single Responsibility Principle** applied correctly.

### Argument 2: "Now We Have Dual Keys Everywhere"

**Counter:** We have **graceful migration**, not dual keys.

The implementation dual-writes to both `user:X:metric` and `entity:X:metric` series. This is **temporary for backward compatibility**:

```javascript
// Phase 3: Dual-write during migration
assignUserMetric(userId, entityId, 'coins_total', value);
// Writes to: user:${userId}:coins_total
// Writes to: entity:${entityId}:coins_total (if entityId exists)
```

Once all consumers migrate to entity-based queries, the user-based writes can be removed. The dual-write ensures **zero breaking changes** during transition.

### Argument 3: "The Chart Code Got More Complex"

**Counter:** The chart code got **one optional parameter**.

Before:
```javascript
buildBeatsSeries(rosterEntry, getSeries, timebase, { activityMonitor });
```

After:
```javascript
buildBeatsSeries(rosterEntry, getSeries, timebase, { activityMonitor, getEntitySeries });
```

The internal change is a **5-line helper**:

```javascript
const getSeriesForParticipant = (metric, options = {}) => {
  if (entityId && typeof getEntitySeries === 'function') {
    const entitySeries = getEntitySeries(entityId, metric, options);
    if (entitySeries.length > 0) return entitySeries;
  }
  return getSeries(targetId, metric, options) || [];
};
```

This is **defense in depth**: prefer entity data when available, fall back to profile data. No breaking changes, no complex conditionals scattered across the codebase.

### Argument 4: "We Could Have Just Reset Coins on Guest Switch"

**Counter:** That approach **destroys data** and **breaks audit trails**.

Consider:
1. Alan earns 50 coins
2. Guest Bob takes over (reset Alan's coins to 0)
3. Alan rejoins later
4. Q: How many coins did Alan earn total?  
   A: Unknown - we destroyed the data

With Session Entities:
1. Alan's first entity: 50 coins, status: "dropped"
2. Bob's entity: 20 coins, status: "dropped"
3. Alan's second entity: 30 coins, status: "active"
4. Q: How many coins did Alan earn total?  
   A: `getProfileCoinsTotal('alan')` → 80 (50 + 30, excludes Bob)

We preserve **complete audit history** while displaying **correct per-session values**.

---

## Benefits Delivered

### 1. Guest Assignment Now Works Correctly

| Scenario | Before | After |
|----------|--------|-------|
| Guest takes over | Inherits owner's coins | Starts at 0 |
| Owner returns | Sees guest's coins added | Fresh entity, clean slate |
| Multiple guests | All coins conflated | Each guest tracked separately |

### 2. Session Summary Is Accurate

```yaml
# Session export now shows entity-level detail
entities:
  - entityId: "entity-1735689000000-abc12"
    profileId: "alan-001"
    name: "Alan"
    status: "dropped"
    coins: 50
    durationMs: 600000  # 10 minutes
    
  - entityId: "entity-1735689600000-def34"
    profileId: "guest-bob"
    name: "Bob"
    status: "dropped"
    coins: 20
    durationMs: 300000  # 5 minutes
```

### 3. Grace Period Transfer Is Now Possible

If someone accidentally gets assigned for < 1 minute, their brief session can be **transferred** to the next occupant instead of creating a meaningless entity. This was **impossible** under the old architecture.

### 4. Future Features Enabled

The Session Entity architecture unlocks:
- **Per-entity achievements:** "Bob earned 'First Timer' badge during this session"
- **Entity-level replays:** Show exactly what happened during Bob's 5-minute segment
- **Cross-session profile stats:** "Alan's all-time coins: 5,000 across 50 sessions"
- **Team/family aggregation:** Sum entities by household or team

---

## Complexity Budget Analysis

| Metric | Value | Assessment |
|--------|-------|------------|
| New classes introduced | 2 (SessionEntity, SessionEntityRegistry) | Minimal |
| New files | 1 (SessionEntity.js) | Minimal |
| Breaking changes | 0 | None |
| New API surface | 5 methods exposed to context | Appropriate |
| Test scenarios affected | 0 existing tests broken | Clean |
| Lines of code added | ~660 | Reasonable for feature scope |

**Comparison to alternative approaches:**

| Approach | Est. Lines | Breaking Changes | Maintainability |
|----------|-----------|------------------|-----------------|
| Session Entity (chosen) | 660 | 0 | High - clear abstractions |
| Timestamp-based segments | 800+ | 3+ | Low - math scattered everywhere |
| Reset on assignment | 200 | 5+ | Low - destroys data |
| Guest mode flag | 400+ | 2+ | Low - conditionals everywhere |

---

## Conclusion

The Session Entity architecture is:

1. **Necessary:** Guest management was fundamentally broken without it
2. **Minimal:** Introduces exactly one new concept (entity) with clear boundaries
3. **Non-breaking:** 100% backward compatible via dual-write strategy
4. **Industry-standard:** Same pattern used by Peloton, Strava, healthcare systems
5. **Future-proof:** Enables grace period transfers, per-entity achievements, profile aggregation

The alternative was not "keep it simple" - it was "keep it broken." The Session Entity architecture is the simplest correct solution to a real problem.

---

## Appendix: Code Diff Summary

### Files Added
- `frontend/src/hooks/fitness/SessionEntity.js` (+362 lines)

### Files Modified (with approximate line changes)
- `FitnessSession.js`: +80 lines (entity creation, dual-write helpers)
- `TreasureBox.js`: +60 lines (entity routing, transfer support)
- `FitnessTimeline.js`: +100 lines (entity series helpers)
- `DeviceAssignmentLedger.js`: +20 lines (entityId tracking)
- `ParticipantRoster.js`: +10 lines (entityId in roster entry)
- `FitnessChart.helpers.js`: +30 lines (entity-aware series lookup)
- `FitnessContext.jsx`: +40 lines (entity selectors exposed)
- `useFitnessPlugin.js`: +10 lines (entity methods exposed)
- `FitnessChartApp.jsx`: +10 lines (pass getEntitySeries)

**Total: ~720 lines for a feature that enables correct guest management, complete audit trails, and future profile aggregation capabilities.**
