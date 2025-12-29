# Dropout Rendering Deep Dive: Why Is This So Hard?

**Date:** December 24, 2025  
**Status:** Ongoing debugging nightmare  
**Author:** Debugging session with Claude

---

## The Problem Statement

We want a simple visual behavior:
1. User is active → **colored line** follows their score
2. User drops out → **colored line stops**, **badge appears** at dropout point
3. User stays dropped out → **no line drawn** (just the badge)
4. User rejoins → **grey dotted line** connects dropout to rejoin, **colored line resumes**

This should be straightforward. It is not.

---

## Attempt History (Abbreviated)

| Attempt | Change | Result |
|---------|--------|--------|
| 1 | Allow null heart_rate in timeline | Nulls recorded, but chart unchanged |
| 2 | Check device.inactiveSince in session | Session correct, chart still wrong |
| 3 | Create trailing gap segments | Grey line appeared during dropout (wrong) |
| 4 | Derive status from segments | Status overwritten elsewhere |
| 5 | Use entry.status in cache | Another override found |
| 6 | Add guardrail in validatedEntries | Guardrail fired, avatar still wrong |
| 7 | Add isActive to roster | Single source of truth, but gap segments gone |
| 8 | Fix lastIndex to use active array | Fixed duplicate badges |
| 9 | Fix gap segment to include vertical | Grey line with vertical appeared |
| 10 | Make gap horizontal only | Grey line disappeared entirely |

**Every fix creates a new problem.**

---

## The Fundamental Architecture Failures

### 1. No Clear Separation Between Data and Presentation

The codebase conflates three distinct concerns:

```
DATA LAYER          COMPUTATION LAYER       PRESENTATION LAYER
─────────────       ─────────────────       ──────────────────
Timeline series     buildBeatsSeries()      SVG path rendering
Device states       buildSegments()         Avatar positioning
Activity status     createPaths()           Badge placement
```

These are tangled together:
- `buildSegments()` both COMPUTES segments AND DECIDES what to render
- `createPaths()` both TRANSFORMS data AND APPLIES styles
- The chart component both FETCHES data AND RENDERS it

### 2. Too Many "Active" Indicators

We have **at least 5 different ways** to know if a user is active:

| Source | Location | Timeout | Updates |
|--------|----------|---------|---------|
| `device.inactiveSince` | DeviceManager | 60s | Real-time |
| `activityMonitor.isActive()` | ActivityMonitor | 10s | Per tick |
| `currentTickActiveHR` | FitnessSession | Per tick | Per tick |
| `active[]` array | buildBeatsSeries | N/A | Per render |
| `roster.isActive` | ParticipantRoster | Derived | Per render |

None of these are guaranteed to agree. When they disagree, bugs happen.

### 3. Forward-Fill Obscures Reality

`fillEdgesOnly()` with `startAtZero: true`:
- Leading nulls → 0 (good for late join)
- Trailing nulls → last value (HIDES dropout)
- Interior nulls → preserved (good)

But `beats` array after fill has NO NULLS in trailing positions. So we can't tell from `beats` alone whether user dropped out.

We depend on the `active[]` array to know this. But `active[]` comes from:
1. ActivityMonitor mask (if available)
2. OR heart_rate null detection (fallback)

If ActivityMonitor says user is active when they're not, the gap disappears.

### 4. Segments Are Built Fresh Every Render

```javascript
const { beats, zones, active } = buildBeatsSeries(entry, getSeries, timebase, { activityMonitor });
const segments = buildSegments(beats, zones, active);
```

Every render:
1. Fetches raw data
2. Builds beats/zones/active arrays
3. Builds segments from scratch
4. Creates paths from segments

**There is no persistence of segment state.** If the logic is wrong on ANY render, the wrong thing appears.

### 5. Gap Detection Depends on Tick-by-Tick Analysis

```javascript
for (let i = 0; i < beats.length; i += 1) {
  const isActiveAtTick = active[i] === true;
  if (isDropout(tickStatus)) {
    inGap = true;
    continue;  // Skip this tick
  }
  if (inGap && gapStartPoint) {
    // Create gap segment
  }
}
```

This iterates through every tick. If:
- `active[i]` is wrong for ANY tick → wrong gap
- `beats[i]` is null when it shouldn't be → wrong gap
- Loop continues past array end → undefined behavior

### 6. Multiple Data Transformations

Data flows through:
```
Timeline.getSeries('user:X:coins_total')
    ↓
buildBeatsSeries() applies fillEdgesOnly()
    ↓
buildSegments() creates segment objects
    ↓
createPaths() transforms to SVG path strings
    ↓
React renders <path> elements
```

Each step can introduce bugs. Each step has different expectations about input format.

---

## Why The Grey Line Keeps Disappearing

### Scenario Analysis

Let's trace what happens with our current code:

**User Milo:**
- Active ticks 0-10
- Drops out tick 11-20
- Rejoins tick 21+

**Expected `active[]` array:**
```
[T, T, T, T, T, T, T, T, T, T, T, F, F, F, F, F, F, F, F, F, F, T, T, T, ...]
                                 ↑ dropout at 11              ↑ rejoin at 21
```

**Expected behavior in buildSegments:**
1. Ticks 0-10: `isActiveAtTick = true` → add to colored segment
2. Tick 11: `isActiveAtTick = false` → set `inGap = true`, `gapStartPoint = {i:10, v:X}`
3. Ticks 12-20: `isActiveAtTick = false` → stay in gap, continue
4. Tick 21: `isActiveAtTick = true` → create gap segment, start new colored segment

**What might actually happen:**

If `active[]` is:
```
[T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, ...]
                                 ↑ should be F but isn't!
```

Then:
- No tick ever triggers `isDropout(tickStatus)`
- `inGap` is never set to true
- No gap segment is created
- User appears continuously active

**Why might `active[]` be all true?**

1. **ActivityMonitor not updated** - If ActivityMonitor doesn't know user dropped out, `getActivityMask()` returns all true
2. **Heart rate not null** - If fallback path is used and heart_rate series has values (not nulls), `active[i]` = true
3. **firstActiveTick check** - We added code to treat leading zeros as "active" - this might be over-inclusive

---

## The Specific Bug Right Now

Looking at the latest change:

```javascript
// User is active (ACTIVE status - HR data broadcasting)
if (inGap && gapStartPoint) {
  // Create HORIZONTAL gap segment
  const gapSegment = {
    zone: null,
    color: getZoneColor(null),
    status: ParticipantStatus.IDLE,
    isGap: true,
    points: [
      { ...gapStartPoint },
      { i, v: gapStartPoint.v }
    ]
  };
  segments.push(gapSegment);
  lastPoint = { i, v: gapStartPoint.v };
  // ...
}
```

This code ONLY RUNS when `inGap && gapStartPoint` is true.

For this to be true:
1. At some earlier tick, `isDropout(tickStatus)` must have been true
2. `lastPoint` must have existed
3. Then at current tick, `isDropout(tickStatus)` is false

Let's check what makes `isDropout(tickStatus)` true:

```javascript
const tickStatus = value == null 
  ? ParticipantStatus.ABSENT 
  : (isActiveAtTick || isLeadingZero ? ParticipantStatus.ACTIVE : ParticipantStatus.IDLE);

if (isDropout(tickStatus)) { ... }
```

`isDropout()` returns true for `IDLE` or `REMOVED` status.

So `tickStatus = IDLE` when:
- `value != null` (beats has a value)
- `isActiveAtTick = false` (active array says inactive)
- `isLeadingZero = false` (not a synthetic leading zero)

**The problem:** If `active[]` doesn't have false values during dropout, `isActiveAtTick` is always true, `tickStatus` is always ACTIVE, and we never enter the gap state.

---

## Diagnosing The Current State

Let me check what `active[]` actually looks like:

From the debug logs earlier:
```
{"totalSegs":6,"gapSegs":1,"activeFalseCount":18,"activeLen":...}
```

Wait - `gapSegs: 1` means a gap segment WAS created at some point! But then later logs showed `gapSegs: 0`.

This is **non-deterministic behavior** - sometimes gaps are created, sometimes not.

### Possible Causes:

1. **Race condition** - ActivityMonitor state changes between renders
2. **Stale data** - `active[]` built from old ActivityMonitor mask
3. **Cache invalidation** - Some hook not re-running when it should
4. **Array length mismatch** - `active[]` shorter than `beats[]`

---

## The Root Cause: No Single Source of Truth

The fundamental problem is that "user is active" is computed in multiple places with different results:

```
DeviceManager.inactiveSince    → Used by sidebar
ActivityMonitor.isActive()     → Used by some chart code
active[] array                 → Used by buildSegments
roster.isActive                → Used by avatar visibility
currentTickActiveHR            → Used by timeline recording
```

When these disagree (and they DO disagree), the UI shows inconsistent state.

---

## What Would Fix This

### Option 1: Single Computed Value

Create ONE function that computes "isActive" and use it everywhere:

```javascript
// In a central location
function isUserActive(userId, tick) {
  // ONE definition of activity
  // Used by ALL consumers
}
```

### Option 2: Activity As Timeline Data

Record activity state IN the timeline itself:

```javascript
assignMetric(`user:${slug}:is_active`, true);  // or false
```

Then `active[]` comes directly from timeline, not computed.

### Option 3: Segment State Persistence

Instead of rebuilding segments every render, persist them:

```javascript
// On dropout detection
persistedSegments.push({
  type: 'gap',
  userId: 'milo',
  startTick: 11,
  startValue: 45,
  endTick: null  // Filled when user rejoins
});

// On rejoin
const openGap = persistedSegments.find(s => s.userId === 'milo' && s.endTick === null);
openGap.endTick = 21;
```

### Option 4: Declarative Gap Definition

Instead of inferring gaps from `active[]`, define them explicitly:

```javascript
const gaps = activityMonitor.getDropoutPeriods('milo');
// Returns: [{start: 11, end: 21}, ...]

// Then buildSegments uses this directly
```

---

## Immediate Fix Needed

The grey line is gone because `active[]` doesn't have false values during dropout.

Let me check WHY by examining the actual data flow...

### Hypothesis: `firstActiveTick` is too aggressive

We added this code:
```javascript
let firstActiveTick = -1;
for (let i = 0; i < active.length; i++) {
  if (active[i] === true) {
    firstActiveTick = i;
    break;
  }
}

const isLeadingZero = i < firstActiveTick && value === 0;
const tickStatus = value == null 
  ? ParticipantStatus.ABSENT 
  : (isActiveAtTick || isLeadingZero ? ParticipantStatus.ACTIVE : ParticipantStatus.IDLE);
```

If `firstActiveTick = 0` (user was active from the start), then `isLeadingZero` is always false (because `i < 0` is never true).

That's fine.

But what if `active[]` has true at the END too?

Actually, this logic is fine. The issue must be that `active[]` simply doesn't have false values when it should.

### The Real Issue: ActivityMonitor vs DeviceManager

We set `roster.isActive` from `device.inactiveSince` (DeviceManager).
But `active[]` comes from `activityMonitor.getActivityMask()` (ActivityMonitor).

**These two systems have different timeouts:**
- DeviceManager: 60 seconds
- ActivityMonitor: 10 seconds (2 ticks)

If DeviceManager says inactive (isActive=false) but ActivityMonitor says active (mask all true), then:
- Avatar goes to "absent" list (uses roster.isActive) ✓
- But segments show no gap (uses active[] from ActivityMonitor) ✗

**This is the bug.**

---

## Recommended Fix

Force `active[]` to respect `roster.isActive`:

```javascript
// In buildBeatsSeries, after building active array:
// If roster entry says user is inactive, mark trailing ticks as inactive
if (rosterEntry.isActive === false) {
  // Find where activity stopped
  const lastTrueIdx = active.lastIndexOf(true);
  // Mark everything after as false (in case ActivityMonitor disagrees)
  for (let i = lastTrueIdx + 1; i < active.length; i++) {
    active[i] = false;
  }
}
```

Or better: Pass `roster.isActive` into `buildSegments` and use it to force trailing gap detection.

---

## Summary

The grey dotted line keeps disappearing because:

1. `active[]` array comes from ActivityMonitor
2. ActivityMonitor may not know user is inactive (different timeout than DeviceManager)
3. When `active[]` is all true, no gap is detected
4. No gap segment is created
5. User appears continuously active

**The fix:** Make `active[]` respect the same source of truth as avatar visibility (`roster.isActive`).
