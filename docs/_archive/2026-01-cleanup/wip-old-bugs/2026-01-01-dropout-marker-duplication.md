# Bug Report: Dropout Marker Duplication - Single Source of Truth Violation

**Date Discovered:** January 1, 2026  
**Severity:** High  
**Status:** ✅ REMEDIATED (Option A implemented)  
**Component:** FitnessChartApp / ActivityMonitor / Dropout Badge System

---

## Summary

Multiple dropout badges appeared for a single dropout event because dropout markers were being generated from **three independent sources** without proper coordination, violating the Single Source of Truth (SSOT) principle.

---

## Root Cause Analysis

### The Violation

Dropout markers were created by THREE different mechanisms:

| Source | Location | ID Pattern | When Created |
|--------|----------|------------|--------------|
| **ActivityMonitor** | `activityMonitor.getAllDropoutEvents()` | `{pid}-dropout-{tick}` | On rejoin (persisted) |
| **Legacy fallback** | `entry.dropoutMarkers` array | `{pid}-dropout-{tick}` | Component state |
| **Current dropout** | Inline in `dropoutMarkers` useMemo | `{pid}-dropout-current` | Every render when `isActive === false` |

### Why Duplicates Occurred

1. User drops out at tick 50
2. **Source 3** immediately creates `alice-dropout-current` badge
3. User rejoins at tick 60
4. **Source 1** records `alice-dropout-50` in ActivityMonitor
5. User drops out again at tick 70
6. **Source 3** creates `alice-dropout-current` (now at tick 70)
7. **Source 1** still has `alice-dropout-50` from earlier

Result: Two badges for Alice visible simultaneously.

Even worse - during the SAME dropout event:
1. ActivityMonitor might have `alice-dropout-50` from reconstruction
2. Current dropout logic creates `alice-dropout-current` at tick 50
3. These have DIFFERENT IDs so deduplication failed

### Visual Evidence

```
Expected (Single Source):
───────────────●[A]────────────────
              [S]  ← One badge at dropout point

Actual (Multiple Sources):
───────────────●[A]────────────────
              [S]  ← Badge from ActivityMonitor
              [S]  ← Badge from "current dropout" logic
```

---

## Immediate Hotfix Applied

Added position-based deduplication using `{participantId}-{tick}` as key:

```javascript
const seenPositions = new Set();

// For each source, check before adding:
const posKey = `${participantId}-${tick}`;
if (seenPositions.has(posKey)) return; // Skip duplicate
seenPositions.add(posKey);
```

**This is a BAND-AID, not a fix.**

---

## Architectural Problems

### 1. No Clear Owner

**Question:** Who owns dropout event data?

| Candidate | Problems |
|-----------|----------|
| ActivityMonitor | Doesn't exist in all contexts, reconstruction is async |
| Component State | Lost on unmount, not shareable |
| participantCache | Mixes concerns, cache shouldn't own events |
| Timeline Series | Would need new series type, overkill |

**Answer:** Should be ActivityMonitor, but it's not consistently available or trusted.

### 2. Reconstruction vs Live Detection Conflict

```
Timeline:         [────────────────────────>
Live Detection:   Sees dropout at tick 50 → creates marker
Reconstruction:   Scans history → finds same dropout → creates marker
Result:           TWO markers for ONE event
```

### 3. "Current" Dropout is Redundant

The `{pid}-dropout-current` marker exists because:
- ActivityMonitor might not be available
- ActivityMonitor might not have reconstructed yet
- We want immediate visual feedback

But this creates a race condition where both sources fire.

### 4. ID Scheme Inconsistency

```javascript
// ActivityMonitor uses tick-based ID:
`${participantId}-dropout-${event.tick}`

// "Current" logic uses sentinel ID:
`${participantId}-dropout-current`

// These are DIFFERENT for the SAME EVENT
```

---

## Proper Remediation Plan

### Option A: ActivityMonitor as Single Source (Recommended)

**Principle:** All dropout data flows through ActivityMonitor. Period.

```
┌─────────────────────────────────────────────────────┐
│                  ActivityMonitor                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ Live Detect │  │ Reconstruct │  │   Query     │  │
│  │  (records)  │  │  (backfill) │  │ (read-only) │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
│         └────────────────┼────────────────┘         │
│                          ▼                          │
│              ┌───────────────────┐                  │
│              │  #dropoutEvents   │ ← SINGLE STORE   │
│              │    Map<pid, []>   │                  │
│              └───────────────────┘                  │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────┐
              │  FitnessChartApp  │
              │  (read-only)      │
              └───────────────────┘
```

**Changes Required:**

1. **Remove "current dropout" logic entirely** from FitnessChartApp
2. **ActivityMonitor records immediately** on dropout detection, not on rejoin
3. **Reconstruction uses same recording method** with dedup built-in
4. **FitnessChartApp only reads** from `activityMonitor.getAllDropoutEvents()`

### Option B: Timeline Series as Source

Store dropout events as a timeline series:

```javascript
// New series type
getSeries(userId, 'dropout_events') → [null, null, { tick: 50, value: 15 }, null, ...]
```

**Pros:** Leverages existing timeline infrastructure
**Cons:** Overkill, timeline is for continuous data not discrete events

### Option C: Dedicated Event Store

Create a new `FitnessEventStore` service:

```javascript
class FitnessEventStore {
  #events = new Map(); // userId → Event[]
  
  recordDropout(userId, tick, value) { /* dedup built-in */ }
  getDropouts(userId) { /* returns array */ }
  getAllDropouts() { /* returns Map */ }
}
```

**Pros:** Clean separation, explicit ownership
**Cons:** Another service to maintain, similar to ActivityMonitor

---

## Recommended Implementation (Option A)

### Phase 1: Fix ActivityMonitor Recording

```javascript
// ActivityMonitor.mjs - RECORD IMMEDIATELY, not on rejoin
class ActivityMonitor {
  recordDropout(userId, tick, value) {
    const events = this.#dropoutEvents.get(userId) || [];
    
    // DEDUP: Check if we already have this tick
    if (events.some(e => e.tick === tick)) {
      return; // Already recorded
    }
    
    events.push({ tick, value, recordedAt: Date.now() });
    this.#dropoutEvents.set(userId, events);
  }
}
```

### Phase 2: Remove Redundant Sources

```javascript
// FitnessChartApp.jsx - REMOVE this entire block:
// ❌ DELETE:
if (entry.isActive === false && !seenParticipants.has(participantId)) {
  // ... creates duplicate markers
}

// ❌ DELETE:
if (!activityMonitor && entry.dropoutMarkers?.length) {
  // ... legacy fallback that creates duplicates
}
```

### Phase 3: Single Query Point

```javascript
// FitnessChartApp.jsx - ONLY source of truth:
const dropoutMarkers = useMemo(() => {
  if (!activityMonitor) return []; // No fallback, no markers
  
  const markers = [];
  activityMonitor.getAllDropoutEvents().forEach((events, participantId) => {
    events.forEach(event => {
      markers.push({
        id: `${participantId}-dropout-${event.tick}`,
        participantId,
        name: participantCache[participantId]?.name || participantId,
        tick: event.tick,
        value: event.value
      });
    });
  });
  return markers;
}, [activityMonitor, participantCache]);
```

### Phase 4: Ensure ActivityMonitor Availability

```javascript
// FitnessContext.jsx - ALWAYS provide ActivityMonitor
const activityMonitor = useMemo(() => {
  return new ActivityMonitor(); // Never null
}, []);
```

---

## Files Requiring Changes

| File | Change | Priority |
|------|--------|----------|
| `backend/lib/fitness/ActivityMonitor.mjs` | Add immediate recording, built-in dedup | P0 |
| `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx` | Remove redundant sources | P0 |
| `frontend/src/context/FitnessContext.jsx` | Ensure ActivityMonitor always available | P1 |
| `frontend/src/modules/Fitness/domain/index.js` | Export ActivityMonitor properly | P1 |

---

## Testing Requirements

### Unit Tests

```javascript
describe('ActivityMonitor dropout deduplication', () => {
  it('should not create duplicate for same tick', () => {
    monitor.recordDropout('alice', 50, 15);
    monitor.recordDropout('alice', 50, 15); // Duplicate
    expect(monitor.getDropoutEvents('alice')).toHaveLength(1);
  });
  
  it('should allow different ticks for same user', () => {
    monitor.recordDropout('alice', 50, 15);
    monitor.recordDropout('alice', 70, 20);
    expect(monitor.getDropoutEvents('alice')).toHaveLength(2);
  });
});
```

### Integration Tests

```javascript
describe('FitnessChart dropout badges', () => {
  it('should show exactly one badge per dropout event', async () => {
    // Simulate dropout
    await simulateDropout('alice', 50);
    
    // Wait for render
    const badges = screen.getAllByTestId(/dropout-badge/);
    expect(badges).toHaveLength(1);
  });
  
  it('should not duplicate on reconstruction', async () => {
    // Dropout, then unmount/remount
    await simulateDropout('alice', 50);
    rerender(<FitnessChartApp />);
    
    const badges = screen.getAllByTestId(/dropout-badge/);
    expect(badges).toHaveLength(1); // Still just one
  });
});
```

---

## Lessons Learned

1. **Single Source of Truth must be enforced architecturally**, not by deduplication hacks
2. **"Fallback" logic often becomes "duplicate" logic** when the primary source also fires
3. **ID schemes must be consistent** across all code paths creating the same logical entity
4. **Event sourcing** (ActivityMonitor) should be the ONLY writer; all else should be readers
5. **Race conditions** between reconstruction and live detection need explicit handling

---

## Related Issues

- [Scale Function Mismatch](./fitness-chart-scale-mismatch.md) - Another SSOT violation in the same component
- [Layout Manager Design](../design/fitness-chart-layout-manager.md) - Badge collision handling depends on correct badge count

---

## Timeline

| Date | Action |
|------|--------|
| 2026-01-01 | Bug discovered (duplicate badges visible) |
| 2026-01-01 | Hotfix applied (position-based dedup) |
| 2026-01-01 | **Option A implemented** - ActivityMonitor is now Single Source of Truth |

---

## Implementation Summary (Option A)

### Changes Made

1. **Record dropout IMMEDIATELY when user drops out** (not on rejoin)
   - Moved `activityMonitor.recordDropout()` call from rejoin detection to dropout detection
   - Added recording when user is removed from roster

2. **Removed ALL fallback/duplicate sources**
   - Deleted legacy `entry.dropoutMarkers` fallback
   - Deleted "current dropout" logic (`{pid}-dropout-current`)
   - `dropoutMarkers` now returns empty array if no ActivityMonitor (strict SSOT)

3. **Simplified dropoutMarkers useMemo**
   - Single source: `activityMonitor.getAllDropoutEvents()`
   - No deduplication needed (handled by ActivityMonitor)
   - Clean, readable code

### Code Diff Summary

```javascript
// BEFORE: Three competing sources
if (activityMonitor) { /* source 1 */ }
if (!activityMonitor && entry.dropoutMarkers) { /* source 2 */ }
if (entry.isActive === false) { /* source 3 - created duplicates */ }

// AFTER: Single source
if (!activityMonitor) return [];
activityMonitor.getAllDropoutEvents().forEach(...);
```
