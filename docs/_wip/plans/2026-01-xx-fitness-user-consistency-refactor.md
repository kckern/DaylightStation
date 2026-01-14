# Fix: Fitness User List Consistency ("Single Source of Truth")

## Overview
Addressed a critical UI consistency issue where different components (Fitness Sidebar, Sidebar Footer, Governance Overlay, and Chart) displayed divergent user lists and activity states. This was causing confusion and intermittent crashes due to state mismatches.

The root cause was that components were relying on different data sources: `allDevices` (raw device data) vs `participantRoster` (processed session data). We have now standardized on `participantRoster` as the single source of truth for all Heart Rate users.

## Changes

### 1. Fitness Sidebar (`FitnessUsers.jsx`)
*   **Standardized Data Source**: switched from filtering `allDevices` directly to using `participantRoster`. This ensures that "virtual" participants or those with complex state (inactive but still in session) are rendered correctly.
*   **Fixed `active` State**: Now respects the `isActive` flag from the roster, rather than re-calculating it based on timestamps alone.
*   **Crash Fix**: Resolved a `ReferenceError: heartRateDevices is not defined` by explicitly memoizing user arrays from the context map. `allDevices` and `heartRateDevices` are now safely derived even if the context only exposes the raw `fitnessDevices` map.

### 2. Sidebar Footer (`SidebarFooter.jsx`)
*   **Unified Roster Logic**: Duplicated the logic from `GovernanceStateOverlay` to derive users from `participantRoster`. This ensures that the small "chips" in the footer exactly match the users shown in the main sidebar.
*   **Active State Alignment**: Updated `computeDeviceActive` to prioritize the `p.isActive` property from the roster. This prevents the footer from showing a user as "active" (due to a recent timestamp) when the session logic has already marked them as inactive.

### 3. Fitness Chart (`FitnessChartApp.jsx`)
*   **Prevent Stack Overflow**: Fixed a `RangeError: Maximum call stack size exceeded`. This occurred when calculating the max heart rate/value using `Math.max(...beats)` on extremely large datasets.
    *   **Fix**: Replaced the spread operator with `validBeats.reduce((a, b) => Math.max(a, b), 0)`. This is safer and more performant for large arrays.

### 4. Helper Utilities (`FitnessChart.helpers.js`)
*   **Robustness**: Added a `try/catch` block to `buildBeatsSeries` to prevent chart calculation errors from crashing the entire application.

## Testing
*   **Runtime Consistency Test**: Run `npx playwright test tests/runtime/fitness-session/user-list-consistency.runtime.test.mjs --workers=1`.
    *   This test verifies that all 4 UI areas (Sidebar, Footer, Overlay, Chart) report the exact same set of active users during a simulation.
*   **Results**: The test now passes consistently. The "User list updates" scenario also passes after fixing test harness state persistence (ghost users).

## Verification
The UI now correctly reflects the `participantRoster` across all surfaces. When a user joins or leaves (becomes inactive), all components update in sync.

---

## Post-Mortem: Design Principle Violations

This bug was entirely preventable. The codebase accumulated significant technical debt by violating fundamental software design principles. This section documents the violations so they are not repeated.

### 1. **Single Source of Truth (SSOT) — CRITICAL VIOLATION**

> *"Every piece of knowledge must have a single, unambiguous, authoritative representation within a system."*

**What happened:** Four UI components (`FitnessUsers.jsx`, `SidebarFooter.jsx`, `GovernanceStateOverlay.jsx`, `FitnessChartApp.jsx`) each independently computed "who is an active user" using different logic:
- One filtered `allDevices` by `type === 'heart_rate'`
- Another used `heartRateDevices` directly
- Another computed active status from `lastSeen` timestamps
- Another used `participantRoster.isActive`

**Result:** The same question — *"Who is currently participating?"* — had **four different answers** depending on which component you asked.

**The fix was embarrassing:** We had to copy-paste the same "derive users from roster" logic into multiple files. That is not a fix; it is a bandage. The correct solution would be a single exported hook or selector: `useActiveParticipants()`.

---

### 2. **DRY (Don't Repeat Yourself) — SEVERE VIOLATION**

> *"Every piece of knowledge must have a single, unambiguous, authoritative representation."*

**What happened:** The diff itself is damning evidence:
```javascript
// SidebarFooter.jsx
const hrDevices = participantRoster
  .filter(p => p.hrDeviceId || (p.heartRate !== null ...))
  .map(p => { ... });

// FitnessUsers.jsx (IDENTICAL LOGIC)
const hrDevices = roster
  .filter(p => p.hrDeviceId || (p.heartRate !== null ...))
  .map(p => { ... });
```

We duplicated **30+ lines of identical transformation logic** across two files. When (not if) this logic needs to change, we will forget to update one of them, and the bug will return.

**What should exist:** A shared utility or context selector:
```javascript
// In FitnessContext.jsx or a dedicated hook
export const useHeartRateParticipants = () => {
  const { participantRoster, heartRateDevices } = useFitnessContext();
  return useMemo(() => deriveHRDevicesFromRoster(participantRoster, heartRateDevices), [...]);
};
```

---

### 3. **Abstraction & Encapsulation — VIOLATED**

> *"Hide complexity behind well-defined interfaces."*

**What happened:** `FitnessContext` exposes **too many raw primitives**: `fitnessDevices`, `allDevices`, `heartRateDevices`, `participantRoster`, `participantsByDevice`, `users`, `userVitals`, etc. Components are left to figure out which one to use and how to combine them.

This is the opposite of abstraction. The context became a dumping ground of "all the data," rather than a provider of **domain-meaningful answers**.

**What should exist:** The context should expose *derived, ready-to-use* data:
- `activeParticipants` — The canonical list of users currently in the session.
- `getParticipantByDevice(deviceId)` — A function, not a raw map.
- `isUserActive(userId)` — A single function, not 4 different timestamp checks.

Components should **never** need to call `.filter(d => d.type === 'heart_rate')` themselves.

---

### 4. **Domain-Driven Design (DDD) — IGNORED**

> *"Structure code around the business domain, not technical concerns."*

**What happened:** The code conflates two distinct domain concepts:
1. **Device** — A physical ANT+ sensor broadcasting heart rate.
2. **Participant** — A person enrolled in the fitness session.

These are not the same thing. A participant can exist without an active device (e.g., during a grace period). A device can broadcast without being assigned to a participant (e.g., unclaimed sensor).

Components that display "users" should operate on **Participants**, not **Devices**. The `participantRoster` *is* the domain model for "who is in the session." The `fitnessDevices` map is infrastructure.

**The violation:** `FitnessUsers.jsx` was filtering `allDevices` (infrastructure) instead of consuming `participantRoster` (domain). This is like querying database row IDs instead of using your ORM entities.

---

### 5. **Separation of Concerns — VIOLATED**

**What happened:** Each UI component (`FitnessUsers`, `SidebarFooter`) contained its own:
- Device filtering logic
- Active/inactive determination logic
- User name resolution logic
- Zone color lookup logic

This is **business logic embedded in view components**. React components should be dumb renderers that receive pre-computed props.

**What should exist:**
- A `ParticipantService` or hook that handles all "who is active" logic.
- Components receive `participants: Participant[]` and render it. Period.

---

### 6. **Fail-Safe Defaults — MISSING**

**What happened:** The chart code used `Math.max(0, ...beats)`. When `beats` is a large array (10,000+ elements), this exceeds the JavaScript call stack limit and crashes the entire application.

This is a **latent production bomb**. It worked in testing with small datasets and failed catastrophically in real usage.

**What should exist:**
- Defensive coding: `beats.reduce((a, b) => Math.max(a, b), 0)` is safe for any array size.
- Error boundaries: The `try/catch` added to `buildBeatsSeries` is a minimum safeguard.
- Input validation: Large arrays should be sampled or windowed before processing.

---

## Phased Implementation Plan

### Phase 1: Immediate — Centralize Participant Derivation (1-2 days)

**Goal:** Eliminate duplicated roster-to-device transformation logic by creating a single canonical hook.

#### Tasks

| # | Task | File | Estimate |
|---|------|------|----------|
| 1.1 | Create `useHeartRateParticipants()` hook that derives HR devices from `participantRoster` | `frontend/src/context/FitnessContext.jsx` | 1h |
| 1.2 | Export `activeHeartRateParticipants` from context value (memoized) | `frontend/src/context/FitnessContext.jsx` | 30m |
| 1.3 | Replace inline derivation in `FitnessUsers.jsx` with hook/context consumption | `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx` | 1h |
| 1.4 | Replace inline derivation in `SidebarFooter.jsx` with hook/context consumption | `frontend/src/modules/Fitness/SidebarFooter.jsx` | 1h |
| 1.5 | Add unit test for `useHeartRateParticipants` ensuring roster → device mapping is correct | `tests/unit/context/FitnessContext.test.js` | 2h |
| 1.6 | Verify runtime consistency test still passes | CI | 30m |

#### Acceptance Criteria
- [ ] `FitnessUsers.jsx` contains **zero** calls to `.filter(d => d.type === 'heart_rate')`
- [ ] `SidebarFooter.jsx` contains **zero** inline roster transformations
- [ ] Both components consume identical data from context
- [ ] Unit test covers: empty roster, single user, multiple users, user with no device

#### Deliverable
```javascript
// In FitnessContext.jsx
const activeHeartRateParticipants = React.useMemo(() => {
  return (participantRoster || [])
    .filter(p => p.hrDeviceId || Number.isFinite(p.heartRate))
    .map(p => ({
      type: 'heart_rate',
      deviceId: p.hrDeviceId || `virtual-${p.name}`,
      heartRate: p.heartRate,
      isActive: p.isActive ?? true,
      name: p.name,
      profileId: p.profileId || p.id,
      zoneId: p.zoneId,
      zoneColor: p.zoneColor,
      // ... other fields
    }));
}, [participantRoster]);

// Exposed in context value
{ activeHeartRateParticipants, ... }
```

---

### Phase 2: Short-term — Audit & Replace Raw Device Access (3-5 days)

**Goal:** Remove all direct `allDevices` / `heartRateDevices` / `fitnessDevices` access from UI components.

#### Tasks

| # | Task | File(s) | Estimate |
|---|------|---------|----------|
| 2.1 | Run `grep -r "allDevices\|heartRateDevices\|fitnessDevices" frontend/src/modules/` to identify all usages | CLI | 15m |
| 2.2 | Categorize usages: HR display, RPM display, equipment display, other | Analysis | 1h |
| 2.3 | Create `useRpmDevices()` selector for cadence/jumprope devices | `frontend/src/context/FitnessContext.jsx` | 1h |
| 2.4 | Create `useEquipmentDevices()` selector for non-HR, non-RPM devices | `frontend/src/context/FitnessContext.jsx` | 1h |
| 2.5 | Refactor `FitnessUsers.jsx` to use `useRpmDevices()` for RPM group | `FitnessUsers.jsx` | 2h |
| 2.6 | Refactor `GovernanceStateOverlay.jsx` to use context selectors (if not already) | `GovernanceStateOverlay.jsx` | 1h |
| 2.7 | Refactor `FitnessChartApp.jsx` to consume `activeHeartRateParticipants` for roster | `FitnessChartApp.jsx` | 2h |
| 2.8 | Deprecate `allDevices` export with console warning in dev mode | `FitnessContext.jsx` | 30m |
| 2.9 | Update runtime consistency test to verify all 4 areas use same selector | Test file | 1h |

#### Acceptance Criteria
- [ ] `grep -r "\.filter(d => d\.type ===" frontend/src/modules/` returns **zero** matches
- [ ] All device-type filtering happens inside `FitnessContext.jsx`, not in components
- [ ] Dev console shows deprecation warning if any component accesses `allDevices` directly
- [ ] Chart, Sidebar, Footer, and Overlay all render identical user lists

#### Files to Audit
```
frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx
frontend/src/modules/Fitness/SidebarFooter.jsx
frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx
frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx
frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js
frontend/src/modules/Fitness/FitnessPlugins/FitnessPluginContainer.jsx
```

---

### Phase 3: Medium-term — Introduce Participant Domain Entity (1-2 weeks)

**Goal:** Create a proper domain model that encapsulates all participant-related logic, eliminating the device/participant conflation.

#### Tasks

| # | Task | File(s) | Estimate |
|---|------|---------|----------|
| 3.1 | Define `Participant` TypeScript interface or JSDoc type | `frontend/src/modules/Fitness/domain/Participant.js` | 1h |
| 3.2 | Define `Device` TypeScript interface (infrastructure layer) | `frontend/src/modules/Fitness/domain/Device.js` | 1h |
| 3.3 | Create `ParticipantFactory.fromRosterEntry(entry, devices)` | `frontend/src/modules/Fitness/domain/ParticipantFactory.js` | 3h |
| 3.4 | Move `isActive` determination logic into `Participant` class/factory | `ParticipantFactory.js` | 2h |
| 3.5 | Move zone resolution logic (`getZoneId`, `getZoneColor`) into `Participant` | `ParticipantFactory.js` | 2h |
| 3.6 | Move display label resolution into `Participant` | `ParticipantFactory.js` | 1h |
| 3.7 | Refactor `FitnessContext` to produce `Participant[]` instead of raw roster | `FitnessContext.jsx` | 4h |
| 3.8 | Update `FitnessUsers.jsx` to consume `Participant` objects | `FitnessUsers.jsx` | 2h |
| 3.9 | Update `SidebarFooter.jsx` to consume `Participant` objects | `SidebarFooter.jsx` | 2h |
| 3.10 | Update `GovernanceStateOverlay.jsx` to consume `Participant` objects | `GovernanceStateOverlay.jsx` | 2h |
| 3.11 | Update `FitnessChartApp.jsx` to consume `Participant` objects | `FitnessChartApp.jsx` | 2h |
| 3.12 | Write comprehensive unit tests for `ParticipantFactory` | `tests/unit/domain/ParticipantFactory.test.js` | 4h |
| 3.13 | Document the domain model in `docs/design/fitness-domain-model.md` | Docs | 2h |

#### Acceptance Criteria
- [ ] `Participant` type has: `id`, `name`, `displayLabel`, `profileId`, `heartRate`, `isActive`, `zoneId`, `zoneColor`, `deviceId`, `avatarUrl`
- [ ] No UI component directly accesses `participantRoster` — they all use `participants: Participant[]`
- [ ] Zone logic is tested independently of React components
- [ ] Active/inactive logic is tested independently of React components

#### Domain Model (Target State)
```javascript
// frontend/src/modules/Fitness/domain/Participant.js

/**
 * @typedef {Object} Participant
 * @property {string} id - Canonical user ID (from config)
 * @property {string} name - Display name
 * @property {string} displayLabel - Resolved label (may differ from name for guests)
 * @property {string|null} profileId - Avatar lookup ID
 * @property {string|null} deviceId - Associated HR device ID (may be null during grace period)
 * @property {number|null} heartRate - Current HR reading
 * @property {boolean} isActive - Whether user is currently broadcasting
 * @property {string|null} zoneId - Current zone ('cool', 'warm', 'hot', 'fire')
 * @property {string|null} zoneColor - CSS color for zone
 * @property {number|null} zoneProgress - Progress within current zone (0-1)
 * @property {boolean} isGuest - Whether this is a guest assignment
 * @property {Object|null} metadata - Additional context (transfer info, etc.)
 */

export class ParticipantFactory {
  static fromRosterEntry(entry, devices, zoneConfig) {
    // All resolution logic lives HERE, not in components
  }
}
```

---

### Phase 4: Ongoing — Governance & Enforcement

**Goal:** Prevent regression by adding tooling and process guardrails.

#### Tasks

| # | Task | Owner | Estimate |
|---|------|-------|----------|
| 4.1 | Add ESLint rule to warn on `allDevices` access outside `FitnessContext.jsx` | DevOps | 2h |
| 4.2 | Add PR checklist item: "Does this component filter devices? Use a selector." | Team | 15m |
| 4.3 | Add architectural decision record (ADR) for Fitness domain model | Docs | 1h |
| 4.4 | Schedule quarterly audit of Fitness module for SSOT violations | Calendar | 15m |

#### ESLint Rule (Example)
```javascript
// .eslintrc.js
rules: {
  'no-restricted-syntax': [
    'warn',
    {
      selector: "MemberExpression[property.name='allDevices']",
      message: 'Use useHeartRateParticipants() or useRpmDevices() instead of accessing allDevices directly.'
    }
  ]
}
```

---

### Timeline Summary

| Phase | Duration | Key Deliverable |
|-------|----------|-----------------|
| Phase 1 | 1-2 days | `useHeartRateParticipants()` hook, duplicated code removed |
| Phase 2 | 3-5 days | All components use context selectors, `allDevices` deprecated |
| Phase 3 | 1-2 weeks | `Participant` domain entity, components are pure renderers |
| Phase 4 | Ongoing | Linting, PR checks, quarterly audits |

---

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Regression during refactor | Runtime consistency test runs in CI on every PR |
| Performance degradation from new memoization | Profile with React DevTools; selectors are cheap |
| Breaking changes to context API | Deprecation warnings before removal; phased rollout |
| Team unfamiliarity with domain model | Documentation + pairing session for Phase 3 |

---

## Conclusion

This bug existed because **convenience beat architecture**. It was faster to copy `allDevices.filter(...)` into a new component than to refactor the context to expose the right abstraction. That shortcut created four divergent sources of truth, which eventually collided.

The fix applied here is tactical, not strategic. The real fix is to refactor `FitnessContext` to be a proper domain service, not a data bag. Until that happens, this class of bug will recur.
