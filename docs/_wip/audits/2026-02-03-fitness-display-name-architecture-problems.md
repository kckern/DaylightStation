# Architectural Audit: Fitness Display Name System

**Date:** 2026-02-03
**Trigger:** Simple `group_label` feature required 2+ hours to debug
**Scope:** Device name resolution, participant tracking, React state management
**Severity:** High - Technical debt creating ongoing maintenance burden

---

## Executive Summary

A feature that should have been a 10-line change ("show group_label when 2+ users") required extensive debugging because the display name is computed in **at least 7 different places** with **no single source of truth**. The current architecture violates fundamental software engineering principles and will continue to cause bugs.

---

## The Symptom That Exposed the Disease

**Expected:** When 2+ HR devices are active, show `group_label` ("Dad") instead of `display_name` ("KC Kern").

**Reality:** Required tracing through:
- `hrDisplayNameMap` (computes override correctly)
- `hrOwnerMap` (base display names)
- `hrOwnerBaseMap` (even more base display names)
- `userVitalsEntry.displayLabel` (from context)
- `participantEntry.displayLabel` (from roster)
- `guestAssignment.occupantName` (from device assignments)
- `getDisplayLabel()` callback (in context)
- `resolveDisplayLabel()` utility (in types.js)

**The fix:** One `if` statement checking `occupantType === 'guest'`.

**The cost:** 2+ hours of debugging, 500+ lines of diagnostic logs, multiple failed fix attempts.

---

## Principle Violations

### 1. Single Source of Truth (SSOT) - SEVERE VIOLATION

**The display name has 7+ potential sources:**

| Source | Location | When Used |
|--------|----------|-----------|
| `guestAssignment.occupantName` | FitnessUsers.jsx | First priority (was wrong) |
| `guestAssignment.metadata.name` | FitnessUsers.jsx | Second priority |
| `hrDisplayNameMap[deviceId]` | FitnessUsers.jsx | Has group_label logic |
| `userVitalsEntry.displayLabel` | FitnessContext.jsx | Computed via getDisplayLabel |
| `participantEntry.displayLabel` | ParticipantRoster.js | Computed separately |
| `participantEntry.name` | ParticipantRoster.js | Raw name |
| `hrOwnerMap[deviceId]` | FitnessUsers.jsx | Base names |
| `hrOwnerBaseMap[deviceId]` | FitnessUsers.jsx | Even more base names |

**Impact:** Each source computes the name with slightly different logic. When requirements change, you must update ALL sources or get inconsistent behavior.

**Evidence:** The bug existed because `hrDisplayNameMap` correctly applied group_label, but `guestAssignment.occupantName` had higher priority and didn't.

### 2. Don't Repeat Yourself (DRY) - SEVERE VIOLATION

**The same logic is duplicated in multiple places:**

```
Device count for preferGroupLabels:
├── ParticipantRoster.js:115-122    → heartRateDevices.length > 1
├── FitnessContext.jsx:1219         → activeHeartRateDevices.length > 1
└── FitnessUsers.jsx:451-453        → allDevices.filter(d => d.type === 'heart_rate')

Group label lookup:
├── FitnessContext.jsx:420-446      → userGroupLabelMap
├── FitnessUsers.jsx:469-473        → labelLookup from heartRateOwners
└── ParticipantRoster.js:365        → resolveDisplayLabel call

Display label computation:
├── FitnessContext.jsx:1244-1260    → getDisplayLabel callback
├── FitnessContext.jsx:1481         → getDisplayLabel(user.name, {userId})
├── FitnessContext.jsx:1602-1604    → mergedDisplayLabel in getUserVitals
├── FitnessUsers.jsx:443-509        → hrDisplayNameMap useMemo
└── ParticipantRoster.js:365        → resolveDisplayLabel call
```

**Impact:** When fixing the device count bug, we had to update BOTH `ParticipantRoster.js` AND `FitnessContext.jsx`. Easy to miss one.

### 3. Separation of Concerns - MODERATE VIOLATION

**FitnessUsers.jsx (a UI component) contains:**
- Business logic for group_label switching
- Device count calculations
- User identity resolution
- Zone calculations
- Assignment management

**A UI component should:**
- Receive data
- Render it
- Handle user interactions

**It should NOT:**
- Compute which display name to use based on device counts
- Maintain multiple lookup maps for user identity
- Duplicate logic from context providers

### 4. Naming Clarity - MODERATE VIOLATION

| Name | What You'd Expect | What It Actually Is |
|------|-------------------|---------------------|
| `guestAssignment` | Assignment for guests | Assignment for ANY device (guest, member, etc.) |
| `hrOwnerMap` | Map of HR device owners | Map of device IDs to display names (with guest overrides) |
| `hrOwnerBaseMap` | ??? | Map of device IDs to display names (without guest overrides) |
| `hrDisplayNameMap` | The display name map | The display name map WITH group_label applied |
| `displayLabel` | The label to display | One of many possible labels, computed differently in each location |

**Impact:** When debugging, I had to read each variable's implementation to understand what it contained. The names don't communicate their purpose or relationship.

### 5. Implicit Priority Chains - SEVERE VIOLATION

**The render-time priority is implicit in code structure:**

```javascript
if (guestAssignment?.occupantName) {
  deviceName = guestAssignment.occupantName;
} else if (guestAssignment?.metadata?.name) {
  deviceName = guestAssignment.metadata.name;
} else if (ownerName) {
  deviceName = ownerName;
} else if (displayLabel) {
  deviceName = displayLabel;
} else if (participantEntry?.name) {
  deviceName = participantEntry.name;
} else {
  deviceName = deviceIdStr;
}
```

**Problems:**
1. Priority order is not documented
2. Priority order differs between locations (context vs component vs roster)
3. Adding a new source requires understanding the entire chain
4. The semantic meaning of each priority level is unclear

---

## Architectural Problems

### Problem 1: No Canonical Display Name Service

**Current State:** Display names are computed on-demand in multiple locations with different logic.

**Should Be:** A single `DisplayNameService` that:
- Takes a device ID (or user ID)
- Returns the display name based on current context (device count, guest status, etc.)
- Is the ONLY place that knows about group_label, guest names, etc.

```javascript
// Proposed: Single source of truth
const displayName = displayNameService.getDisplayName(deviceId, {
  preferGroupLabel: deviceCount > 1,
  includeGuestOverride: true
});
```

### Problem 2: Context Provides Raw Data AND Computed Data

**Current State:** `FitnessContext` provides:
- Raw data: `fitnessDevices`, `users`, `deviceAssignments`
- Computed data: `getUserVitals`, `getDisplayLabel`, `activeHeartRateDevices`
- Hybrid data: `participantRoster` (raw + computed)

**Problem:** Consumers don't know whether to use raw data and compute, or use pre-computed data. Different components make different choices, leading to inconsistency.

**Should Be:** Context provides EITHER:
- Raw data only (let consumers compute via services)
- Fully computed, ready-to-render data (consumers just display)

Not both.

### Problem 3: React Memoization Complexity

**Current State:** 20+ `useMemo` hooks with complex dependency arrays:

```javascript
const hrDisplayNameMap = React.useMemo(() => {
  // 60 lines of logic
}, [hrOwnerMap, allDevices, heartRateOwners, getGuestAssignment]);
```

**Problems:**
1. Hard to trace when values update
2. Easy to miss a dependency
3. Stale closure bugs are common
4. Testing requires understanding entire dependency graph

**Evidence:** During debugging, we saw `hrDisplayNameMap` compute "Dad" but the render use "KC Kern" - a stale closure issue.

### Problem 4: Device Assignment Model Overloaded

**Current State:** `guestAssignment` (misnamed `deviceAssignment`) has:
- `occupantType: 'guest' | 'member'`
- `occupantName` (always present)
- `metadata` (sometimes present)

**Problem:** The same data structure serves multiple purposes:
1. Track temporary guest usage
2. Track primary device ownership
3. Store display metadata

This conflation caused the bug - we checked `occupantName` without checking `occupantType`.

**Should Be:** Separate models:
- `GuestAssignment` - when a guest uses someone else's device
- `DeviceOwnership` - the primary owner of a device
- `DisplayMetadata` - computed display properties

---

## Risk Assessment: Future Bugs

### High Risk: Any Display-Related Feature

Adding any of these features will likely cause bugs:
- User nicknames
- Display name preferences
- Multi-language display names
- Anonymous mode

**Why:** Each feature will need to be added to 7+ locations.

### High Risk: Device Assignment Changes

Changing how devices are assigned will break display logic because:
- `guestAssignment` is used for identity resolution
- Multiple components read it differently
- No abstraction between assignment and display

### Medium Risk: Performance Optimization

Attempting to optimize React re-renders will likely break the display name chain because:
- Dependencies are implicit
- Memoization boundaries are unclear
- No clear data flow diagram

---

## Recommendations

### Immediate (Before Next Feature)

1. **Document the current priority chain** in code comments
2. **Add TypeScript discriminated union** for device assignment types
3. **Rename `guestAssignment` to `deviceAssignment`** everywhere

### Short-Term (Next Sprint)

1. **Create `DisplayNameService`** - single source of truth for all display name resolution
2. **Remove display logic from FitnessUsers.jsx** - component should receive final display names
3. **Consolidate device counting** - one place computes `activeDeviceCount`

### Medium-Term (Next Quarter)

1. **Refactor FitnessContext** - separate raw data provider from computed data provider
2. **Create domain models** - `User`, `Device`, `Participant` with clear responsibilities
3. **Add integration tests** - test display name scenarios end-to-end

### Long-Term (Technical Debt Paydown)

1. **Consider state management library** - Redux/Zustand with selectors would make data flow explicit
2. **Create data flow documentation** - diagram showing how data transforms
3. **Establish component contracts** - what data each component expects

---

## Appendix: Full Data Flow (Current State)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    CURRENT DISPLAY NAME DATA FLOW (COMPLEX)                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Backend Config                                                                  │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────┐                                                                 │
│  │ usersConfig │────────────────────────────────────────────┐                    │
│  │ (YAML)      │                                            │                    │
│  └─────────────┘                                            │                    │
│       │                                                     │                    │
│       ▼                                                     ▼                    │
│  ┌─────────────────┐                              ┌─────────────────┐            │
│  │ userGroupLabel  │                              │ deviceOwnership │            │
│  │ Map (Context)   │                              │ (Context)       │            │
│  └────────┬────────┘                              └────────┬────────┘            │
│           │                                                │                     │
│           ▼                                                ▼                     │
│  ┌─────────────────┐                              ┌─────────────────┐            │
│  │ getDisplayLabel │                              │ heartRateOwners │            │
│  │ (Context)       │                              │ (Component)     │            │
│  └────────┬────────┘                              └────────┬────────┘            │
│           │                                                │                     │
│           ▼                                                ▼                     │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐            │
│  │ userVitalsMap   │     │ participantRoster│     │ hrDisplayNameMap│            │
│  │ (Context)       │     │ (Context)       │     │ (Component)     │            │
│  └────────┬────────┘     └────────┬────────┘     └────────┬────────┘            │
│           │                       │                       │                     │
│           ▼                       ▼                       ▼                     │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐            │
│  │ getUserVitals() │     │ participantEntry │     │ ownerName       │            │
│  │ .displayLabel   │     │ .displayLabel   │     │ (final?)        │            │
│  └────────┬────────┘     └────────┬────────┘     └────────┬────────┘            │
│           │                       │                       │                     │
│           └───────────────────────┼───────────────────────┘                     │
│                                   │                                              │
│                                   ▼                                              │
│                    ┌──────────────────────────────┐                              │
│                    │     RENDER PRIORITY CHAIN    │                              │
│                    │  (implicit if/else cascade)  │                              │
│                    │                              │                              │
│                    │  1. guestAssignment.name     │ ◀── BYPASSES EVERYTHING      │
│                    │  2. guestAssignment.meta     │                              │
│                    │  3. ownerName                │                              │
│                    │  4. displayLabel             │                              │
│                    │  5. participantEntry.name    │                              │
│                    │  6. deviceId                 │                              │
│                    └──────────────────────────────┘                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PROPOSED DISPLAY NAME DATA FLOW (SIMPLE)                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Backend Config                                                                  │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                      DisplayNameService (SSOT)                           │    │
│  │                                                                          │    │
│  │   getDisplayName(deviceId, context) {                                    │    │
│  │     const owner = this.getOwner(deviceId);                               │    │
│  │     const guest = this.getGuestAssignment(deviceId);                     │    │
│  │                                                                          │    │
│  │     // Single place for ALL priority logic                               │    │
│  │     if (guest?.occupantType === 'guest') return guest.name;              │    │
│  │     if (context.preferGroupLabel && owner.groupLabel) {                  │    │
│  │       return owner.groupLabel;                                           │    │
│  │     }                                                                    │    │
│  │     return owner.displayName;                                            │    │
│  │   }                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                   │                                              │
│                                   ▼                                              │
│                    ┌──────────────────────────────┐                              │
│                    │      UI COMPONENT            │                              │
│                    │  <UserCard name={name} />    │                              │
│                    └──────────────────────────────┘                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Conclusion

The `group_label` bug was a symptom of deeper architectural issues. The display name system has grown organically without a clear design, resulting in:

- 7+ sources of truth
- Duplicated logic in 5+ locations
- Implicit priority chains
- Misleading variable names
- Tight coupling between UI and business logic

**Without architectural remediation, every display-related feature will require similar debugging effort.**

The immediate risk is manageable with documentation and careful changes. But the long-term maintenance cost will continue to grow until the system is refactored around a single source of truth.
