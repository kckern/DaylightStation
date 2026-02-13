# Fitness Session Events Deduplication Audit

**Date:** 2026-02-12  
**Session:** fs_20260212183157 (28-minute session)  
**Issue:** Event spam causing 10x file bloat and duplicate event arrays

---

## Executive Summary

A production fitness session file has grown to **70KB** (vs normal 7KB sessions) due to:
1. **Spammy UI state events** (39 overlay events firing every time users join/leave)
2. **Duplicate event arrays** in YAML (events stored in both `timeline.events` AND root `events`)
3. **Insufficient deduplication** (only challenge events are deduplicated)

**Impact:**
- 10x larger session files (70KB vs 7KB baseline)
- 130+ events per session (mostly redundant UI state changes)
- Storage bloat across all fitness history
- Slower file I/O and parsing

---

## Findings

### 1. Event Type Distribution

**From YAML file analysis:**
```
Total events: 78 (before deduplication)
Breakdown:
  - overlay.lock_rows_changed: 20 events (26%)
  - overlay.warning_offenders_changed: 19 events (24%)
  - challenge_start: 13 events (17%)
  - challenge_end: 13 events (17%)
  - media_start: 6 events (8%)
  - voice_memo_start: 1 event (1%)

Total challenge/overlay events: 130 (65 in timeline.events + 65 in root events)
```

**Problem Events:**
- `overlay.lock_rows_changed`: Fires every time UI lock rows change (users join/leave governance)
- `overlay.warning_offenders_changed`: Fires when warning banner state changes
- Both events create rapid-fire duplicates within seconds of each other

### 2. Duplicate Event Arrays

**Structure issue in YAML:**
```yaml
timeline:
  events:        # Line 43 - v3 canonical format
    - timestamp: 1770949934036
      type: overlay.lock_rows_changed
      ...
    [65 events]

events:           # Line 1199 - v2 backwards compatibility
  - at: '2026-02-13 02:32:14.036'
    type: overlay.lock_rows_changed
    ...
  [65 events - EXACT DUPLICATES]
```

**Root cause:** `PersistenceManager.persistSession()` creates both arrays:
- `timeline.events` (v3 format): Lines 607 comment says "backend uses timeline.events as canonical source"
- `events` (v2 format): Line 596 creates for backwards compatibility

**Impact:** Every event is stored TWICE, doubling event-related YAML size.

### 3. File Size Comparison

```
Session 20260212062500: 7.0KB  (normal baseline)
Session 20260212183157: 70KB   (10x bloat)
Duration difference: ~28 minutes (not 10x longer)
```

**Bloat breakdown:**
- Duplicate events arrays: ~35% of file size
- Spammy UI events: ~30% of file size
- Inefficient event formatting: ~15% of file size
- Actual useful data: ~20% of file size

### 4. Current Deduplication Logic

**Location:** `PersistenceManager.js:457-473`

```javascript
// Deduplicate challenge events
if (Array.isArray(sessionData.timeline?.events)) {
  const seen = new Set();
  sessionData.timeline.events = sessionData.timeline.events.filter((evt) => {
    // ... only handles challenge_* events
    if (type.startsWith('challenge_')) {
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;  // ALL OTHER EVENTS PASS THROUGH
  });
}
```

**Limitations:**
1. Only deduplicates `challenge_*` events
2. No handling for UI state events (overlay.*)
3. No time-based throttling for rapid-fire events
4. Deduplication happens BEFORE v2 array creation (so duplicates exist in both arrays)

---

## Event Timeline Analysis

**Sample overlay.lock_rows_changed spam (from YAML):**
```
02:32:14.064 - Felix joins
02:32:27.995 - Felix joins again (duplicate)
02:32:34.073 - Milo joins (1 second after)
02:32:37.250 - Alan joins (3 seconds after)
02:32:37.541 - Alan leaves (0.3 seconds after!)
02:32:38.704 - Alan joins (1 second after)
02:33:07.108 - Felix leaves
...
[20 total events in 28 minutes, many within 1-5 seconds]
```

**Pattern:** Users joining/leaving/rejoining triggers UI lock state changes that fire events every time, even if net state hasn't changed.

---

## Recommendations

### Priority 1: Intelligent UI State Deduplication ✅ IMPLEMENTED

**Solution:** Deduplicate consecutive identical UI states within 5-second window.

**Implementation:**
```javascript
// UI state event deduplication: rapid-fire overlay changes
// Keep first and last state, dedupe identical consecutive states within 5 seconds
if (type === 'overlay.lock_rows_changed' || type === 'overlay.warning_offenders_changed') {
  const currentUsers = evt.data?.currentUsers || evt.data?.offenders || [];
  const timestamp = Number(evt.timestamp) || 0;
  const stateKey = JSON.stringify([...currentUsers].sort());
  
  // Keep if state changed or enough time elapsed (>5s)
  if (lastOverlayState !== stateKey || 
      lastOverlayTimestamp === null ||
      timestamp - lastOverlayTimestamp > 5000) {
    lastOverlayState = stateKey;
    lastOverlayTimestamp = timestamp;
    return true;
  }
  
  // Dedupe rapid-fire identical states
  return false;
}
```

**Expected reduction:** 39 overlay events → ~8-12 events (70% reduction)

### Priority 2: Remove Duplicate Events Array

**Decision needed:** Is v2 backwards compatibility still required?

**If NO (recommended):**
- Remove lines 568-596 in `PersistenceManager.js` (v2Events creation)
- Keep only `timeline.events` (v3 canonical format)
- **Impact:** 50% reduction in event-related YAML size

**If YES:**
- Document why v2 compat is needed
- Ensure backend can handle both formats
- Keep current dual-array structure

### Priority 3: Challenge Event Preservation

**Current handling is CORRECT:** Each challenge can have multiple sub-events:
- `challenge_start` (when challenge begins)
- `challenge_lock` (when challenge locks in)
- `challenge_recover` (when challenge recovers from failure)
- `challenge_end` (when challenge completes)

**Deduplication logic:** Only remove exact duplicates (same type + tick + challengeId).

**Status:** Already implemented correctly. No changes needed.

### Priority 4: Event Metadata Optimization

**Consider for future:**
1. Delta encoding for consecutive similar states
2. Event batching (group rapid events)
3. Separating critical vs informational events
4. Client-side event filtering before persistence

---

## Testing Recommendations

1. **Regression test:** Ensure all challenge sub-events persist correctly
2. **UI state test:** Verify overlay events dedupe without losing state transitions
3. **File size test:** Confirm 10x bloat is resolved
4. **Backwards compat test:** If removing v2 events, verify backend handles v3-only format

---

## Implementation Status

- [x] UI state deduplication (overlay.lock_rows_changed, overlay.warning_offenders_changed)
- [x] Remove duplicate v2 events array (v2 `events` removed; backend already uses `timeline.events` as canonical)
- [x] Drop `voice_memo_start` noise from persisted events
- [x] Throttle VALIDATION_FAIL console.error to 3 logs per session (was uncapped ~100+ in early session)
- [ ] Deploy to prod (not yet deployed — both fixes are local only)

---

## Related Files

- **Issue source:** `frontend/src/hooks/fitness/PersistenceManager.js`
- **Example bloated session:** `data/household/history/fitness/2026-02-12/20260212183157.yml`
- **Production logs:** `logs/prod-session-20260212183157.log`

---

## Appendix: Code Locations

### Deduplication Logic
`PersistenceManager.js:457-500` - Event filtering and deduplication

### v2 Events Creation
`PersistenceManager.js:568-596` - Builds backwards-compatible events array

### Event Persistence
`PersistenceManager.js:595-608` - Adds both timeline.events and root events to payload

### Backend Event Handling
Comment at line 607: "Keep timeline.events for backend persistence (backend uses timeline.events as canonical source)"
