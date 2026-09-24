# Assign Guest Reference

This document covers the guest assignment feature, which allows temporary user reassignment on fitness monitor devices.

**Key files:**
- `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx` - UI component
- `frontend/src/hooks/fitness/GuestAssignmentService.js` - Assignment logic and validation

---

## Overview

The Assign Guest feature allows users to temporarily assign a different person (a "guest") to a fitness monitor device. This is useful when:
- Someone borrows another person's heart rate monitor
- A friend visits and uses a family member's device
- The default device owner changes temporarily

**Key file**: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx`

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
1. **Contextual hints** - an explainer line for unrecognized straps (no base user), and a transfer note when the active segment is younger than the continuous-usage threshold ("{name}'s last N min on this strap will transfer to whoever you pick")
2. **Top options section** - "Guest" (generic), a kid Guest option that displays "Guest" with a "Kid" source badge (when `guest_profiles.kid` is configured), and "Original" (restore base user; source badge "Give back")
3. **Tab selector** - Friends / Family filter
4. **Guest grid** - Filtered candidates with avatars
5. **"⛔ Ignore This Strap" button** (formerly "Remove User") - Suppresses device until next reading

The option-list construction (exclusion sets, tab filtering, generic options) lives in the pure, unit-tested builder `frontend/src/modules/Fitness/lib/guestOptionsBuilder.js`.

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

Always-available options appear above the filtered list (built in `guestOptionsBuilder.js`):

1. **Original owner** - Shows only when a guest is currently assigned, allows restoring base user (source badge "Give back")
2. **Generic "Guest"** - Available on every device — `'guest'` is inherently multi-assignable, so it is hidden only where a Guest is *currently* assigned
3. **Kid Guest** - Displays "Guest" with a "Kid" source badge; shown when `fitness.yml → guest_profiles.kid` is configured

```javascript
// Add original owner as first option if a guest is currently assigned
if (activeAssignment && baseName &&
    (activeAssignment.occupantName || activeAssignment.metadata?.name) !== baseName) {
  topOptions.push({
    id: baseUserId,
    name: baseName,
    source: 'Give back',
    isOriginal: true
  });
}

// Add generic guest — note: no profileId here. It is synthesized at
// assignment time as `guest_<deviceId>` (W2) so each device gets a
// distinct anonymous identity.
topOptions.push({
  id: 'guest',
  name: 'Guest',
  source: 'Guest',
  isGeneric: true
});

// Kid variant (audit N4): carries configured kid zone thresholds at assign time
if (guestProfiles?.kid && !seen.has('guest-kid')) {
  topOptions.push({ id: 'guest-kid', name: 'Guest', source: 'Kid', isGeneric: true, ageClass: 'kid' });
}
```

### 4. Making an Assignment

When user selects a guest:

```javascript
const handleAssignGuest = (option) => {
  // W2: generic "Guest" gets a device-keyed alias so two simultaneous
  // Guests on different devices resolve to distinct User identities.
  const profileId = option.isGeneric
    ? `guest_${deviceIdStr}`
    : (option.profileId || option.id);
  // N3: simultaneous generic Guests get numbered names — "Guest", "Guest 2", ...
  // (nextGenericGuestName counts adult AND kid generics jointly)
  const name = option.isGeneric
    ? nextGenericGuestName(deviceAssignments)
    : option.name;
  // N4: age-class options carry configured zone overrides (guest_profiles.kid.zones,
  // converted map → [{id, min}] array by zonesMapToArray)
  const ageClass = option.ageClass || null;
  const zones = ageClass ? zonesMapToArray(guestProfiles?.[ageClass]?.zones) : null;
  assignGuestToDevice(deviceIdStr, {
    name,
    profileId,
    candidateId: option.id,
    source: option.source,
    baseUserName: baseName,  // Preserves original owner
    ...(ageClass ? { ageClass } : {}),
    ...(zones ? { zones } : {})
  });
  onClose();
};
```

### 5. Assignment Metadata

The metadata stored with each assignment:

| Field | Purpose |
|-------|---------|
| `name` | Guest display name (numbered for simultaneous generics: "Guest", "Guest 2", …) |
| `profileId` | Avatar lookup ID |
| `candidateId` | Original candidate ID (`'guest'` / `'guest-kid'` for generics) |
| `source` | Category badge (Friend/Family/Guest/Kid/Give back) |
| `baseUserName` | Original device owner (for restoration) |
| `ageClass` | Optional — `'kid'` when assigned via the kid Guest option; persisted as `guest_profile` |
| `zones` | Optional — `[{ id, min }]` zone-threshold overrides from `guest_profiles.{ageClass}.zones`, applied by UserManager |

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

### Ignore This Strap (Remove User)

The "⛔ Ignore This Strap" button (formerly labeled "Remove User") suppresses the device until the next heart rate reading (effectively removes user from session):

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
// W2: the generic candidate ids are ALWAYS multi-assignable — each
// assignment resolves to a distinct guest_<deviceId> identity, so the raw
// id must never globally block the option on other devices.
multiAssignableKeys.add('guest');
multiAssignableKeys.add('guest-kid');
```

Users with `allowWhileAssigned: true` bypass the "already assigned" exclusion filter. The generic `'guest'` / `'guest-kid'` ids get the same bypass unconditionally (`guestOptionsBuilder.js`).

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
| `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx` | UI component |
| `frontend/src/modules/Fitness/lib/guestOptionsBuilder.js` | Pure option-list builder (exclusions, generics, `nextGenericGuestName`, `zonesMapToArray`) |
| `frontend/src/hooks/fitness/GuestAssignmentService.js` | Assignment logic, validation |
| `frontend/src/hooks/fitness/DeviceAssignmentLedger.js` | Assignment state storage |
| `frontend/src/context/FitnessContext.jsx` | State management |
| `frontend/src/hooks/fitness/UserManager.js` | User-device mapping |
| `frontend/src/modules/Fitness/player/FitnessSidebar.scss` | Styles |

---

## Continuous-Usage Threshold (W1)

The legacy hardcoded 60-second "grace period" is gone. Sub-segment absorption
is now driven by a single configurable knob with four behavioral rules that
are applied at two distinct moments: live (in `GuestAssignmentService` as
each reassignment happens) and at session save time (in `PersistenceManager`
via the backfill pass).

### Configuration

```yaml
# data/household/.../fitness.yml
governance:
  usage_threshold_seconds: 300   # default; T = 5 minutes
```

| Source | Value |
|--------|-------|
| `fitness.yml → governance.usage_threshold_seconds` | Authoritative; loaded by `FitnessConfigService` |
| `FitnessContext` → `GuestAssignmentService({ thresholdMs })` | Threshold passed in as `thresholdMs` |
| `FitnessContext` → `PersistenceManager.setUsageThresholdMs(...)` | Same value reused for save-time backfill |
| GuestAssignmentService constructor default | `60_000` ms (back-compat for legacy unit tests only — NOT the runtime default) |
| PersistenceManager `_applyBackfill` default | `60_000` ms (only when `sessionData.thresholdMs` and `_usageThresholdMs` are both absent) |

The runtime default is **300 s / 5 min** — `fitness.yml` is the source of
truth. The lower 60 s constructor defaults exist purely so legacy unit
tests written against the original 60 s window don't have to inject a
threshold; production code paths always provide a value.

### The Four Behavioral Rules (audit Decision §7 + OI-1..OI-3)

| Rule | Trigger | Effect |
|------|---------|--------|
| **OI-3 — Symmetric forward absorption** | A segment of duration `< T` is followed by ANY other segment on the same device | The sub-T segment is absorbed forward into the successor (coins, timeline, start time). Applies to ALL transition types — Guest→Mapped, Mapped→Guest, **Mapped→Mapped**, Guest→Guest. There is intentionally NO "previous occupant must be a guest" gate. |
| **OI-1 — Final-segment backward absorption** | The LAST segment on a device is `< T` and has no successor to absorb into | Absorbed BACKWARD into the immediately prior honored segment (the "I just put it down" case). |
| **OI-2 — Cycling / turn-taking detection** | 3+ consecutive sub-T segments alternating between 2+ distinct occupants on one device | All segments honored as a "shared device" pattern — neither cascading forward-absorption nor the OI-1 backward rule applies. Both occupants survive in the saved YAML. |
| **§5 — Late-tag untagged placeholder merge** | A synthetic untagged (untagged placeholder) occupant is followed by a configured user, regardless of duration | The untagged placeholder segment is absorbed into the configured user. Per Decision §5, late tagging means "I'm telling you now who this was" — duration is irrelevant. |

### Correction vs Handover (live)

Every strap assignment is a **stint** — one occupant on one strap from a
`startTick` on (`SessionEntity`, see [Stints](#stints) below). When the strap is
reassigned, `GuestAssignmentService` classifies the change and hands it to
`FitnessSession.reassignStint(deviceId, toUserId, { mode })`:

| Mode | When | What happens |
|------|------|--------------|
| **correction** | The current occupant has held the strap for `< T` | "That was actually X." The open stint's data moves to X — timeline point series cell by cell, rings and beats **as the stint's delta above its starting value**, activity periods — and the stint is **relabelled in place** (prior occupant appended to `relabeledFrom`). Nothing before the stint's `startTick` moves. |
| **handover** | `≥ T` | The strap changed hands. Nothing moves; the stint closes (`endReason: 'handover'`) and a new one opens now. |

Why deltas: TreasureBox (rings) and TimelineRecorder (beats) keep running totals
per person and write them into the timeline every tick. Moving history without
moving the matching counter delta made the next tick overwrite it — one child's
line fell off a cliff and another's spiked (session 2026-09-23). The invariant
is: per-person cumulative series never decrease, and the sum of rings across
people is unchanged by a reassignment. Pure helper: `stintTransfer.js`
(`moveStintSeries`); store moves: `TreasureBox.moveStint`,
`TimelineRecorder.moveStintBeats`, `ActivityMonitor.moveStintActivity`,
`ZoneProfileStore.resetZoneState`.

A chain of corrections on one strap (A → B → A) moves the whole stint each
time, from its original `startTick`; `relabeledFrom` records `[A, B]`.

### Save-Time Application

| Layer | What it does |
|-------|--------------|
| **`PersistenceManager._applyBackfill`** | `runSessionBackfill({ entities, series, … })`. A **relabelled stint is authoritative** — exempt from effort absorb and cycling detection; names in `relabeledFrom` are dropped unless they own another stint. The effort rule (≤1 ring, ≤5 s active zone, <3 HR samples → fold forward), known-user cross-device merge, late-tag placeholder merge and OI-2 cycling honour apply to stints nobody relabelled. Participants come from stints; sessions without stints keep the series-derived fallback. |
| **`flattenCumulativeRegressions`** (`cumulativeGuard.js`) | After the backfill, any cumulative series (`rings_total`, `heart_beats`, `rotations`) that dips is flattened and logged as `fitness.persistence.cumulative_regressed` — a regression is visible in the log store, never drawn as a falling line. |

### Retroactive heal (saved sessions)

`node cli/fitness.cli.mjs session heal <date> <sessionId> [--apply]` and
`… session heal --sweep [--since=Nd] [--apply]` re-reconcile saved YAML with the
backend `SessionIdentityHealer` (dry run by default). It:

- **repairs split cumulative series** (`CumulativeSplitRepair.mjs`) — the
  signature the pre-stint transfer left: one rider's `rings`/`beats` drops by D
  while another's jumps by ≈D within 3 ticks. Both steps are cancelled; the
  rider whose HR covers the ticks before the drop keeps the rings. An unpaired
  drop is reported, never guessed;
- folds effortless ghosts and drops empty listed participants, honouring
  relabelled stints;
- rewrites participant flags from `data/household/config/fitness.yml` `users`
  (same rules as save time);
- patches `summary.participants` (rings, HR stats, zone minutes) and leaves
  every other summary section as the app wrote it.

### Telemetry

| Event | When emitted | Payload fields (key ones) |
|-------|--------------|---------------------------|
| `SEGMENT_ABSORBED` (live, journal) | Reassignment `< T` — a correction | `deviceId`, `previousOccupantId`, `previousDurationMs`, `thresholdMs`, `newOccupantId` |
| `GUEST_REPLACED` (live, journal) | Reassignment `≥ T` — a handover | Same shape |
| `guest_assignment.assigned` (log store) | Every assignment | `deviceId`, `from`, `to`, `mode`, `entityId` |
| `fitness.stint.corrected` / `fitness.stint.handover` (log store) | `reassignStint` | `deviceId`, `fromUserId`, `toUserId`, `startTick`, `ringsMoved`, `beatsMoved` |
| `treasurebox.stint_moved` (log store) | Rings moved by a correction | `fromUserId`, `toUserId`, `baseRings`, `ringsMoved` |
| `persist_backfill_applied` (save time) | Backfill moved data or removed occupants | `sessionId`, `thresholdMs`, `transfers[]`, `removedOccupants[]` |
| `fitness.persistence.cumulative_regressed` (log store, warn) | A cumulative series dipped at save time | `sessionId`, `key`, `tick`, `drop` |

> **Event rename note (W1.C):** The live event was previously named
> `GRACE_PERIOD_TRANSFER`. It is now `SEGMENT_ABSORBED` to match the actual
> semantic (the "grace period" framing only made sense when the constant
> was hardcoded at 60s). No external consumers existed at rename time — only
> the emitter itself and its unit tests referenced the old name.

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
│  4. CONTINUOUS-USAGE THRESHOLD (< T, default 5 min / 300s)         │
│     - Configured via fitness.yml governance.usage_threshold_seconds│
│     - Sub-T segment absorbed forward into next occupant            │
│     - Applies SYMMETRICALLY across Guest↔Mapped↔Mapped transitions │
│     - Session-end backfill catches OI-1 (final), OI-2 (cycling)    │
│     - See "Continuous-Usage Threshold" section above for details   │
│                                                                     │
│  5. STINT LIFECYCLE                                                 │
│     - Every assignment (auto-assigned members too) opens a stint   │
│     - A correction (< T) relabels the open stint in place          │
│     - A handover (>= T), clear, or session end closes it           │
│     - Stints hold no totals; data lives in the user-keyed stores   │
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

Constraint enforcement (guestOptionsBuilder.js):
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

### Scenario 4: Sub-Threshold Segment Absorption

**Use case**: Quick correction when wrong user assigned, within the
continuous-usage threshold `T` (default 5 min / 300 s; see
"Continuous-Usage Threshold" above).

```
Timeline:
  t0:     Device #1 assigned to Bob
  t0+30s: Realize mistake, assign to Carol instead   (30s < T → absorb)

Result: the strap's stint is relabelled Bob → Carol. Everything the strap
        recorded since the stint began — HR, zones, rings and beats (as
        deltas), activity — moves to Carol. Bob keeps anything he recorded
        before this stint (e.g. on another strap). SEGMENT_ABSORBED is
        journalled; fitness.stint.corrected is logged.

Flow (GuestAssignmentService → FitnessSession.reassignStint):
┌─────────────────────────────────────────────────────────────────────┐
│  mode = previousDuration < thresholdMs ? 'correction' : 'handover'  │
│  session.reassignStint(deviceId, newOccupantId, { mode })           │
│    correction → _moveStintData(from, to, stint.startTick)           │
│                   moveStintSeries   (timeline window)               │
│                   treasureBox.moveStint   (rings delta)             │
│                   timelineRecorder.moveStintBeats (beats delta)     │
│                   activityMonitor.moveStintActivity                 │
│                 registry.relabel(stint, to)                         │
│    handover   → close stint (endReason 'handover'), open new stint  │
└─────────────────────────────────────────────────────────────────────┘

Symmetric: the same rule applies when both occupants are household members.
A reassignment before the session starts moves no data; `ensureStarted`
opens a stint (startTick 0) for every ledger entry.
```

### Stints

`SessionEntity` is a stint record: `entityId`, `profileId` (current occupant),
`deviceId`, `startTime`, `startTick`, `endTime`, `status`, `endReason`
(`handover` \| `dropped` \| `cleared`/`guest_cleared` \| …) and
`relabeledFrom[]`. It has no live-accounting role — rings, beats and zones are
all keyed by user id. Stints are persisted in the session YAML as `entities[]`
and are what the save-time backfill and the backend healer reconcile.

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

**Use case**: A displaced primary (their device was taken by a guest) can be
assigned to any device — including reclaiming their own — even though their
name is technically "assigned." `FitnessSidebar.jsx` sets
`allowWhileAssigned: true` on these returnee candidates automatically.

```
Configuration:
  guestCandidates: [
    { id: 'alice', name: 'Alice', allowWhileAssigned: true },   // displaced primary
    { id: 'eve', name: 'Eve', allowWhileAssigned: false }
  ]

State:
  Device #1: Alice's device, currently occupied by guest Eve
  Device #2: (selecting...)

Available for Device #2:
  [Guest, Alice]  ← Alice NOT excluded despite appearing in Device #1's assignment

Note on generic "Guest": it is not a guestCandidates entry, but its ids
('guest' and 'guest-kid') are added to multiAssignableKeys unconditionally
in guestOptionsBuilder.js — the generic options are inherently
multi-assignable. The picker now matches the W2 device-keyed identity model
(guest_<deviceId>): any number of simultaneous generic Guests can be
created, each getting a numbered display name ("Guest", "Guest 2", ...) via
nextGenericGuestName. See guest-mode.md § Guest Identity Classes.

Constraint bypass (guestOptionsBuilder.js):
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
            └──────────────────── < T ────────────────────────┘
                          (sub-threshold absorb)

Note: Selecting "Original" from top options calls assignGuest()
with the base user, not clearGuest(). This creates an assignment
record that explicitly assigns the original owner.

T = configured continuous-usage threshold from fitness.yml →
governance.usage_threshold_seconds (default 5 min / 300 s).
```

### Entity Lifecycle During Transitions

```
Assignment creates entity:
  assignGuest(device, Bob) → createSessionEntity({profileId: Bob})
                           → entityId: "entity-123"

Replacement (>= T) ends previous entity:
  assignGuest(device, Carol) → reassignStint(device, Carol, {mode: 'handover'})
                             → stint "entity-123" closed (endReason 'handover')
                             → new stint "entity-456" for Carol
                             → GUEST_REPLACED event (thresholdMs in payload)

Replacement (< T) is a correction — same stint, relabelled:
  assignGuest(device, Carol) → reassignStint(device, Carol, {mode: 'correction'})
                             → stint data moved Bob → Carol (delta, from startTick)
                             → stint "entity-123" relabelled; relabeledFrom [Bob]
                             → SEGMENT_ABSORBED event (thresholdMs in payload)

Clear ends entity:
  clearGuest(device) → endSessionEntity("entity-456", {status: 'ended'})

T = configured continuous-usage threshold (see Continuous-Usage Threshold
section above for full details on the four behavioral rules — OI-1, OI-2,
OI-3, §5 — and the live/save-time split.)
```

---

## See Also

- [Governance Engine Reference](./governance-engine.md) - How assignments affect governance
