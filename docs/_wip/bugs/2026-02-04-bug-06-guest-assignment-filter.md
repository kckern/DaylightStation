# Bug 06: Guest Assignment Filtering

**Date:** 2026-02-04
**Status:** Investigation Complete
**Area:** Fitness App - Guest Assignment

## Summary

Active users (already paired with a device) are appearing as options in the "Assign Guest" list.

## Investigation Findings

### Current Guest List Population

**FitnessSidebar.jsx** (lines 47-117) builds `guestCandidates` from:
- Family members (`usersConfigRaw?.family`)
- Friends (`usersConfigRaw?.friends`)
- Primary returnees (`replacedPrimaryPool`)
- Primary guest pool (active guest assignments)

**UserManager.getGuestCandidates()** (lines 615-631):
```javascript
getGuestCandidates() {
  const collections = this.getUserCollections();
  return [
    ...collections.family,
    ...collections.friends,
    ...collections.secondary,
    ...collections.other
  ]
}
```

### Current Filtering Logic

**FitnessSidebarMenu.jsx** (lines 119-210) applies these filters:

1. **Deduplication by ID** - prevents listing same person twice
2. **Already assigned exclusion** - excludes users assigned to ANY device (unless `allowWhileAssigned` is true)
3. **Tab-based category filtering** - Friends vs Family tabs

### Missing Filter: Active Session Exclusion

**Critical Finding**: There is NO filtering based on `isActive` or `active_session` status.

Users who are:
- Currently broadcasting HR data
- Already paired with a device in the current session
- Flagged as `active_session`

...should NOT appear in the guest list, but they do.

### Available Active Status Data

The system tracks active status in multiple ways:

**ActivityMonitor** (state machine):
```javascript
monitor.getActiveParticipants()      // Returns IDs with ACTIVE status
monitor.isActive(participantId)      // Check specific participant
monitor.getInSessionParticipants()   // ACTIVE or IDLE (not REMOVED)
```

**FitnessContext selectors**:
```javascript
context.activeHeartRateParticipants  // Only active HR broadcasters
context.activityMonitor              // Access to activity state machine
context.participantRoster            // Full roster with isActive flags
```

**Participant entity**:
```javascript
participant.isActive: boolean        // Direct flag from DeviceManager
```

### Data Flow

```
WebSocket Data → FitnessSession.ingestData()
  → DeviceManager.updateDevice() [updates lastSeen]
  → FitnessSession.roster [rebuilt with isActive flags]
  → FitnessContext.activeHeartRateParticipants [filtered]
  → FitnessSidebar.guestCandidates [NOT filtered by active status]
  → FitnessSidebarMenu [renders all candidates]
```

## Hypothesis

### H1: Missing Filter Implementation (Confirmed)
The guest assignment feature was implemented before or separately from the activity tracking system. The filter for active users was never added.

**Evidence**: No code path in FitnessSidebarMenu.jsx references `activeHeartRateParticipants`, `activityMonitor`, or `isActive`.

### H2: By Design (Intentional)
It's possible this is intentional - allowing reassignment of users who are already active. However, the bug report suggests this is unwanted behavior.

## Files Involved

| File | Purpose |
|------|---------|
| `frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebar.jsx` | Guest candidate list building |
| `frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx` | Guest list rendering, filtering |
| `frontend/src/hooks/fitness/GuestAssignmentService.js` | Assignment logic |
| `frontend/src/hooks/fitness/UserManager.js` | User registry, candidate lists |
| `frontend/src/hooks/fitness/ActivityMonitor.js` | Active status tracking |
| `frontend/src/context/FitnessContext.jsx` | Active participant selectors |

## Proposed Test Strategy

1. **Setup**: Mock a session with User A and User B already active with HR data
2. **Action**: Open the Guest Assignment service
3. **Assertion**: User A and User B do NOT appear in "Friends" or "Family" columns
4. **Verify**: Only inactive/offline users appear as candidates

## Proposed Fix Direction

### Option A: Filter in FitnessSidebarMenu
Add active user filtering where candidates are rendered:
```javascript
const activeUserIds = new Set(
  activeHeartRateParticipants.map(p => p.id)
);

const filteredCandidates = guestCandidates.filter(
  candidate => !activeUserIds.has(candidate.id)
);
```

### Option B: Filter in UserManager.getGuestCandidates()
Filter at the source:
```javascript
getGuestCandidates(activeParticipantIds = []) {
  const collections = this.getUserCollections();
  const activeSet = new Set(activeParticipantIds);
  return [...collections.family, ...collections.friends]
    .filter(user => !activeSet.has(user.id));
}
```

### Option C: Filter in FitnessSidebar.guestCandidates
Filter when building the memo:
```javascript
const guestCandidates = useMemo(() => {
  const activeIds = new Set(activeHeartRateParticipants.map(p => p.id));
  return buildCandidates().filter(c => !activeIds.has(c.id));
}, [activeHeartRateParticipants, ...otherDeps]);
```

**Recommendation**: Option A is cleanest - filter at the UI layer where the decision is made about what to display. This keeps the data layer (UserManager) pure and allows for future flexibility (e.g., showing active users with a different indicator).
