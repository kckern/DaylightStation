# Assign Guest Reference

This document covers the guest assignment feature, which allows temporary user reassignment on fitness monitor devices.

**Key files:**
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx` - UI component
- `frontend/src/hooks/fitness/GuestAssignmentService.js` - Assignment logic and validation

---

## Overview

The Assign Guest feature allows users to temporarily assign a different person (a "guest") to a fitness monitor device. This is useful when:
- Someone borrows another person's heart rate monitor
- A friend visits and uses a family member's device
- The default device owner changes temporarily

**Key file**: `frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx`

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Assign Guest Data Flow                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User clicks device panel                                           │
│       ↓                                                             │
│  FitnessSidebarMenu opens (mode='guest')                           │
│       ↓                                                             │
│  guestCandidates filtered by tab (Friends/Family)                   │
│       ↓                                                             │
│  User selects guest                                                 │
│       ↓                                                             │
│  assignGuestToDevice(deviceId, metadata)                           │
│       ↓                                                             │
│  FitnessContext updates deviceAssignments                          │
│       ↓                                                             │
│  UserManager resolves device → guest user                          │
│       ↓                                                             │
│  GovernanceEngine uses guest's zone config                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## UI Components

### FitnessSidebarMenu

The menu renders in two modes:
- `mode='settings'` - Media visibility, volume controls
- `mode='guest'` - Guest assignment interface

When in guest mode, displays:
1. **Top options section** - "Guest" (generic) and "Original" (restore base user)
2. **Tab selector** - Friends / Family filter
3. **Guest grid** - Filtered candidates with avatars
4. **Remove User button** - Suppresses device until next reading

### Guest Option Structure

```javascript
{
  id: 'user-123',           // Unique identifier
  name: 'John',             // Display name
  profileId: 'user-123',    // Used for avatar path
  source: 'Friend',         // Category label
  isGeneric: false,         // True for "Guest" placeholder
  isOriginal: false         // True for restore-to-owner option
}
```

---

## Props

| Prop | Type | Description |
|------|------|-------------|
| `mode` | `'settings' \| 'guest'` | Menu mode |
| `targetDeviceId` | `string` | Device being assigned |
| `targetDefaultName` | `string` | Fallback name for device owner |
| `assignGuestToDevice` | `function` | Assignment callback |
| `clearGuestAssignment` | `function` | Clear assignment callback |
| `guestCandidates` | `array` | Available guest options |

---

## Assignment Flow

### 1. Opening the Menu

The menu opens with a target device when the user clicks on a device panel:

```javascript
<FitnessSidebarMenu
  mode="guest"
  targetDeviceId={selectedDeviceId}
  targetDefaultName={device.defaultName}
  assignGuestToDevice={context.assignGuestToDevice}
  guestCandidates={context.guestCandidates}
/>
```

### 2. Filtering Candidates

Candidates are filtered based on:
- **Already assigned** - Users assigned to any device are excluded (unless `allowWhileAssigned: true`)
- **Tab selection** - Friends or Family based on `candidate.category`
- **Currently selected** - The active assignee is excluded from the list

```javascript
// Filter by tab
const filteredCandidates = guestCandidates.filter((candidate) => {
  const category = (candidate.category || '').toLowerCase();
  if (selectedTab === 'friends') {
    return category === 'friend';
  } else if (selectedTab === 'family') {
    return category === 'family';
  }
  return false;
});
```

### 3. Top Options Logic

Always-available options appear above the filtered list:

1. **Original owner** - Shows only when a guest is currently assigned, allows restoring base user
2. **Generic "Guest"** - Always available (unless currently selected)

```javascript
// Add original owner as first option if a guest is currently assigned
if (activeAssignment && baseName &&
    (activeAssignment.occupantName || activeAssignment.metadata?.name) !== baseName) {
  topOptions.push({
    id: baseUserId,
    name: baseName,
    source: 'Original',
    isOriginal: true
  });
}

// Add generic guest
topOptions.push({
  id: 'guest',
  name: 'Guest',
  source: 'Guest',
  isGeneric: true
});
```

### 4. Making an Assignment

When user selects a guest:

```javascript
const handleAssignGuest = (option) => {
  assignGuestToDevice(deviceIdStr, {
    name: option.name,
    profileId: option.profileId,
    candidateId: option.id,
    source: option.source,
    baseUserName: baseName  // Preserves original owner
  });
  onClose();
};
```

### 5. Assignment Metadata

The metadata stored with each assignment:

| Field | Purpose |
|-------|---------|
| `name` | Guest display name |
| `profileId` | Avatar lookup ID |
| `candidateId` | Original candidate ID |
| `source` | Category (Friend/Family/Guest) |
| `baseUserName` | Original device owner (for restoration) |

---

## Clearing Assignments

### Clear Guest (Restore Original)

Returns device to base user:

```javascript
const handleClearGuest = () => {
  clearGuestAssignment(deviceIdStr);
  onClose();
};
```

### Remove User

Suppresses device until next heart rate reading (effectively removes user from session):

```javascript
const handleRemoveUser = () => {
  suppressDeviceUntilNextReading(deviceIdStr);
  onClose();
};
```

---

## Integration with FitnessContext

The context provides:

```javascript
const fitnessContext = useFitnessContext();

// State
fitnessContext.deviceAssignments     // Array of current assignments
fitnessContext.guestCandidates       // Available guests

// Functions
fitnessContext.assignGuestToDevice(deviceId, metadata)
fitnessContext.clearGuestAssignment(deviceId)
fitnessContext.suppressDeviceUntilNextReading(deviceId)
fitnessContext.getDeviceAssignment(deviceId)
fitnessContext.getUserByDevice(deviceId)
fitnessContext.getUserByName(name)
```

---

## Multi-Assignable Users

Some candidates can be assigned to multiple devices simultaneously (e.g., shared accounts):

```javascript
const multiAssignableKeys = new Set();
guestCandidates.forEach((candidate) => {
  if (candidate?.allowWhileAssigned) {
    if (candidate.id) multiAssignableKeys.add(String(candidate.id));
  }
});
```

Users with `allowWhileAssigned: true` bypass the "already assigned" exclusion filter.

---

## Auto-Tab Switching

If the Friends tab is empty (all friends already assigned), automatically switches to Family:

```javascript
React.useEffect(() => {
  if (selectedTab === 'friends' && guestOptions.filteredOptions.length === 0) {
    setSelectedTab('family');
  }
}, [selectedTab, guestOptions.filteredOptions.length]);
```

---

## Avatar Loading

Avatars are loaded from the media server:

```javascript
<img
  src={DaylightMediaPath(`/static/img/users/${option.profileId}`)}
  alt={`${option.name} avatar`}
  onError={(e) => {
    // Fallback to generic user avatar
    e.target.src = DaylightMediaPath('/static/img/users/user');
  }}
/>
```

---

## Governance Integration

When a guest is assigned:
1. The UserManager resolves `deviceId → guestUserId`
2. ZoneProfileStore uses the guest's zone configuration
3. GovernanceEngine evaluates requirements using guest's zone data

This means governance requirements are evaluated based on **who is currently assigned**, not the device's original owner.

---

## File Reference

| File | Purpose |
|------|---------|
| `frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx` | UI component |
| `frontend/src/hooks/fitness/GuestAssignmentService.js` | Assignment logic, validation |
| `frontend/src/hooks/fitness/DeviceAssignmentLedger.js` | Assignment state storage |
| `frontend/src/context/FitnessContext.jsx` | State management |
| `frontend/src/hooks/fitness/UserManager.js` | User-device mapping |
| `frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebar.scss` | Styles |

---

## Lifecycle Scenarios

This section documents the ideal flows and constraints for guest assignment state transitions.

### Constraint Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Assignment Constraints                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. ONE USER PER DEVICE                                            │
│     - A device can only have one active assignment at a time       │
│     - New assignment replaces previous assignment                   │
│                                                                     │
│  2. ONE DEVICE PER USER (default)                                  │
│     - A user can only be assigned to one device at a time          │
│     - Exception: allowWhileAssigned=true bypasses this             │
│                                                                     │
│  3. BASE USER PRESERVATION                                          │
│     - baseUserName stored with every assignment                    │
│     - Enables "restore to owner" option                            │
│                                                                     │
│  4. GRACE PERIOD TRANSFER (< 1 minute)                             │
│     - If previous assignment < 1 min, data transfers to new user   │
│     - Coins, timeline, start time inherited                        │
│                                                                     │
│  5. ENTITY LIFECYCLE                                                │
│     - Each assignment creates a session entity                     │
│     - Entity tracks coins/timeline for that assignment period      │
│     - Entity ended when assignment cleared or replaced             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Scenario 1: Simple Guest Swap and Return

**Use case**: Owner lends device to friend temporarily, then takes it back.

```
Timeline:
  t0: Device #1 owned by Alice (no assignment, Alice is base user)
  t1: Friend Bob uses Device #1
  t2: Alice takes Device #1 back

State Flow:
┌──────────┬─────────────────┬──────────────────┬─────────────────────┐
│  Time    │  Action         │  Assignment      │  Available Options  │
├──────────┼─────────────────┼──────────────────┼─────────────────────┤
│  t0      │  (initial)      │  null            │  Guest, Bob, Carol  │
│  t1      │  Assign Bob     │  {Bob, base:     │  Guest, Alice,      │
│          │                 │   Alice}         │   Carol             │
│  t2      │  Select Alice   │  {Alice, base:   │  Guest, Bob, Carol  │
│          │  (Original)     │   Alice}         │                     │
└──────────┴─────────────────┴──────────────────┴─────────────────────┘

Key behaviors:
- At t1: Bob removed from candidates (assigned to Device #1)
- At t1: "Original" option (Alice) appears in top options
- At t2: Alice selected via "Original" restores base user
- At t2: Bob returns to candidate pool
```

### Scenario 2: Multiple Guest Transitions

**Use case**: Device passes through several users before returning to owner.

```
Timeline:
  t0: Device #1 owned by Alice
  t1: Bob uses Device #1
  t2: Carol takes over from Bob
  t3: Alice takes Device #1 back

State Flow:
┌──────────┬─────────────────┬──────────────────┬─────────────────────┐
│  Time    │  Action         │  Assignment      │  baseUserName       │
├──────────┼─────────────────┼──────────────────┼─────────────────────┤
│  t0      │  (initial)      │  null            │  Alice              │
│  t1      │  Assign Bob     │  Bob             │  Alice              │
│  t2      │  Assign Carol   │  Carol           │  Alice (preserved)  │
│  t3      │  Select Alice   │  Alice           │  Alice              │
└──────────┴─────────────────┴──────────────────┴─────────────────────┘

Important: baseUserName is set at FIRST assignment (t1) and preserved
through subsequent assignments. This ensures "Original" always points
to the true device owner, not the previous guest.
```

### Scenario 3: Preventing Duplicate Assignments

**Use case**: Prevent same user from being on two devices simultaneously.

```
Setup:
  Device #1: owned by Alice
  Device #2: owned by Bob
  Friends: Carol, Dave

Initial state:
  Device #1: (no assignment)  → Candidates: [Guest, Carol, Dave]
  Device #2: (no assignment)  → Candidates: [Guest, Carol, Dave]

After Carol assigned to Device #1:
  Device #1: Carol            → Candidates: [Guest, Alice, Dave]
  Device #2: (no assignment)  → Candidates: [Guest, Dave]
                                            ↑ Carol EXCLUDED

Constraint enforcement (FitnessSidebarMenu.jsx:138-150):
┌─────────────────────────────────────────────────────────────────────┐
│  deviceAssignments.forEach((assignment) => {                        │
│    // Collect all IDs associated with this assignment               │
│    const blockKeys = [                                              │
│      metadata.candidateId,                                          │
│      metadata.profileId,                                            │
│      assignment.occupantId                                          │
│    ];                                                               │
│                                                                     │
│    // Skip if user has allowWhileAssigned flag                      │
│    if (blockKeys.some(key => multiAssignableKeys.has(key))) return; │
│                                                                     │
│    // Add all IDs to exclusion set                                  │
│    blockKeys.forEach(key => seen.add(key));                         │
│  });                                                                │
└─────────────────────────────────────────────────────────────────────┘
```

### Scenario 4: Grace Period Transfer

**Use case**: Quick correction when wrong user assigned (< 1 minute).

```
Timeline:
  t0:     Device #1 assigned to Bob
  t0+30s: Realize mistake, assign to Carol instead

Result: Carol inherits Bob's session data (coins, timeline, start time)

Grace Period Logic (GuestAssignmentService.js:97-165):
┌─────────────────────────────────────────────────────────────────────┐
│  const GRACE_PERIOD_MS = 60 * 1000; // 1 minute                     │
│                                                                     │
│  if (previousEntry && previousDuration < GRACE_PERIOD_MS) {         │
│    // Transfer mode: inherit data from previous                     │
│    isGracePeriodTransfer = true;                                    │
│    transferredFromEntity = previousEntityId;                        │
│                                                                     │
│    // New entity inherits:                                          │
│    // - Start time from previous entity                             │
│    // - Coins via transferSessionEntity()                           │
│    // - Timeline series via transferUserSeries()                    │
│  } else {                                                           │
│    // Normal replacement: previous session kept separate            │
│    // Previous entity marked as 'dropped'                           │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘

Data Transfer Flow:
  Entity-to-Entity (guest → guest):
    session.transferSessionEntity(oldEntityId, newEntityId)

  User-to-Entity (owner → guest):
    session.transferUserSeries(ownerUserId, guestUserId)
```

### Scenario 5: Multi-Device Family Session

**Use case**: Family of 4 using 4 devices, friend visits.

```
Setup:
  Device #1: Alice (base)
  Device #2: Bob (base)
  Device #3: Carol (base)
  Device #4: Dave (base)
  Friend: Eve

Initial available candidates for each device:
  All devices: [Guest, Eve]
  (Family members are base users, not in candidate pool)

Eve assigned to Device #1:
  Device #1: Eve (base: Alice)  → Options: [Guest, Alice]
  Device #2: Bob (base)         → Options: [Guest] (Eve now excluded)
  Device #3: Carol (base)       → Options: [Guest]
  Device #4: Dave (base)        → Options: [Guest]

Alice reclaims Device #1:
  Device #1: Alice              → Options: [Guest, Eve]
  Device #2-4: unchanged        → Options: [Guest, Eve] (Eve available again)
```

### Scenario 6: allowWhileAssigned Override

**Use case**: Generic "Guest" can be assigned to multiple devices.

```
Configuration:
  guestCandidates: [
    { id: 'guest', name: 'Guest', allowWhileAssigned: true },
    { id: 'eve', name: 'Eve', allowWhileAssigned: false }
  ]

State:
  Device #1: Guest assigned
  Device #2: (selecting...)

Available for Device #2:
  [Guest, Eve]  ← Guest NOT excluded despite being on Device #1

Constraint bypass (FitnessSidebarMenu.jsx:123-128):
┌─────────────────────────────────────────────────────────────────────┐
│  const multiAssignableKeys = new Set();                             │
│  guestCandidates.forEach((candidate) => {                           │
│    if (candidate?.allowWhileAssigned) {                             │
│      multiAssignableKeys.add(String(candidate.id));                 │
│    }                                                                │
│  });                                                                │
│                                                                     │
│  // Later, when filtering:                                          │
│  const allowReuse = blockKeys.some(k => multiAssignableKeys.has(k));│
│  if (allowReuse) return; // Skip exclusion                          │
└─────────────────────────────────────────────────────────────────────┘
```

### State Machine Diagram

```
                              ┌─────────────┐
                              │  UNASSIGNED │
                              │  (base user │
                              │   active)   │
                              └──────┬──────┘
                                     │
                        assignGuest(deviceId, guest)
                                     │
                                     ▼
                              ┌─────────────┐
            ┌────────────────▶│  ASSIGNED   │◀────────────────┐
            │                 │  (guest     │                 │
            │                 │   active)   │                 │
            │                 └──────┬──────┘                 │
            │                        │                        │
   assignGuest(deviceId,    clearGuest(deviceId)    assignGuest(deviceId,
   differentGuest)                   │              originalOwner)
            │                        │                        │
            │                        ▼                        │
            │                 ┌─────────────┐                 │
            │                 │  UNASSIGNED │                 │
            │                 │  (base user │                 │
            │                 │   restored) │                 │
            │                 └─────────────┘                 │
            │                                                 │
            └────────────────── < 1 min ──────────────────────┘
                              (grace transfer)

Note: Selecting "Original" from top options calls assignGuest()
with the base user, not clearGuest(). This creates an assignment
record that explicitly assigns the original owner.
```

### Entity Lifecycle During Transitions

```
Assignment creates entity:
  assignGuest(device, Bob) → createSessionEntity({profileId: Bob})
                           → entityId: "entity-123"

Replacement (> 1 min) ends previous entity:
  assignGuest(device, Carol) → endSessionEntity("entity-123", {status: 'dropped'})
                             → createSessionEntity({profileId: Carol})
                             → entityId: "entity-456"

Replacement (< 1 min) transfers to new entity:
  assignGuest(device, Carol) → createSessionEntity({profileId: Carol,
                                                    startTime: inheritedFromBob})
                             → transferSessionEntity("entity-123", "entity-456")
                             → entityId: "entity-456"

Clear ends entity:
  clearGuest(device) → endSessionEntity("entity-456", {status: 'ended'})
```

---

## See Also

- [Governance Engine Reference](./governance-engine.md) - How assignments affect governance
