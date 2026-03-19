# HR-Inactive State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a systemic `hrInactive` flag so participants with HR=0 (monitor resetting) are visually dimmed and exempt from governance rules.

**Architecture:** The `hrInactive` boolean originates in `User.currentData` (UserManager), propagates through the roster and ParticipantFactory to all consumers. Governance filtering happens in FitnessSession (where `activeParticipants` is built), so the GovernanceEngine never sees hrInactive users. Display components use the flag to apply existing inactive CSS styling.

**Tech Stack:** JavaScript ES modules, React, Jest

**Spec:** `docs/superpowers/specs/2026-03-18-hr-inactive-state-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/hooks/fitness/UserManager.js` | Modify | Add `hrInactive` to `currentData` lifecycle |
| `frontend/src/hooks/fitness/ParticipantRoster.js` | Modify | Pass `hrInactive` through roster entry |
| `frontend/src/modules/Fitness/domain/ParticipantFactory.js` | Modify | Include `hrInactive` on participant object |
| `frontend/src/hooks/fitness/FitnessSession.js` | Modify | Filter hrInactive from governance, pass hrInactiveUsers |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Modify | Store/expose `hrInactiveUsers` in state |
| `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js` | Modify | Defensive filter for hrInactive |
| `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx` | Modify | Use `hrInactive` via user lookup |
| `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx` | Modify | Same as above |
| `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx` | Modify | Add `hrInactive` to inactive check |
| `frontend/src/modules/Fitness/nav/SidebarFooter.jsx` | Modify | Add `hrInactive` to `computeDeviceActive` |
| `tests/unit/fitness/UserManager.test.mjs` | Modify | Add hrInactive tests |
| `tests/unit/fitness/hr-inactive-governance.test.mjs` | Create | Governance exclusion tests |
| `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs` | Modify | Add hrInactive display filter test |

---

### Task 1: Add `hrInactive` flag to UserManager

**Files:**
- Modify: `frontend/src/hooks/fitness/UserManager.js:44-61,63-81,84-92,194-213`
- Modify: `tests/unit/fitness/UserManager.test.mjs`

- [ ] **Step 1: Write failing tests for hrInactive flag**

Add a new describe block to `tests/unit/fitness/UserManager.test.mjs`:

```javascript
describe('User hrInactive flag', () => {
  it('should start with hrInactive true (no valid HR yet)', () => {
    const user = createTestUser();
    expect(user.currentData.hrInactive).toBe(true);
  });

  it('should set hrInactive false when valid HR received', () => {
    const user = createTestUser();
    sendHeartRate(user, 120);
    expect(user.currentData.hrInactive).toBe(false);
  });

  it('should set hrInactive true when HR drops to 0', () => {
    const user = createTestUser();
    sendHeartRate(user, 120);
    expect(user.currentData.hrInactive).toBe(false);

    sendHeartRate(user, 0);
    expect(user.currentData.hrInactive).toBe(true);
  });

  it('should clear hrInactive when valid HR returns after 0', () => {
    const user = createTestUser();
    sendHeartRate(user, 120);
    sendHeartRate(user, 0);
    expect(user.currentData.hrInactive).toBe(true);

    sendHeartRate(user, 105);
    expect(user.currentData.hrInactive).toBe(false);
  });

  it('should include hrInactive in summary getter', () => {
    const user = createTestUser();
    expect(user.summary.hrInactive).toBe(true);

    sendHeartRate(user, 120);
    expect(user.summary.hrInactive).toBe(false);
  });

  it('should reset hrInactive to true on resetSession', () => {
    const user = createTestUser();
    sendHeartRate(user, 120);
    expect(user.currentData.hrInactive).toBe(false);

    user.resetSession();
    expect(user.currentData.hrInactive).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/fitness/UserManager.test.mjs --testNamePattern="hrInactive" --verbose`

Expected: FAIL — `hrInactive` property is undefined on `currentData`.

- [ ] **Step 3: Implement hrInactive in UserManager**

In `frontend/src/hooks/fitness/UserManager.js`, make these changes:

**a) `#createDefaultCurrentData()` (line 49-60):** Add `hrInactive: true` to the returned object:

```javascript
// Add after line 59 (showProgress):
      hrInactive: true
```

**b) `#updateCurrentData()` (lines 70-81):** Add `hrInactive: false` to the valid-zoneSnapshot object:

```javascript
// Add after line 80 (showProgress):
      hrInactive: false
```

**c) `#updateHeartRateData()` (lines 85-92):** Add `hrInactive: true` in the early-return path:

```javascript
  #updateHeartRateData(heartRate) {
    if (!heartRate || heartRate <= 0) {
      this.currentData.heartRate = null;
      this.currentData.zone = null;
      this.currentData.color = null;
      this.currentData.hrInactive = true;
      return;
    }
    // hrInactive = false is set in #updateCurrentData via line 113
```

**d) `summary` getter (line 194-212):** Add `hrInactive` to the returned object:

```javascript
// Add after line 211 (zones):
      hrInactive: this.currentData.hrInactive ?? true
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/fitness/UserManager.test.mjs --testNamePattern="hrInactive" --verbose`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/UserManager.js tests/unit/fitness/UserManager.test.mjs
git commit -m "feat(fitness): add hrInactive flag to User.currentData

Set hrInactive=true when HR<=0 (monitor reset/disconnect), false when
valid HR arrives. Flag is set in #createDefaultCurrentData,
#updateCurrentData, and #updateHeartRateData to survive object rebuilds.
Exposed via summary getter for downstream consumers."
```

---

### Task 2: Propagate `hrInactive` through roster and ParticipantFactory

**Files:**
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js:432-453`
- Modify: `frontend/src/modules/Fitness/domain/ParticipantFactory.js:70-89`

- [ ] **Step 6: Add `hrInactive` to ParticipantRoster._buildRosterEntry()**

In `frontend/src/hooks/fitness/ParticipantRoster.js`, add `hrInactive` field to the roster entry object at line ~452 (after `inactiveSince`):

```javascript
      inactiveSince: device.inactiveSince || null, // Pass through for debugging
      hrInactive: mappedUser?.currentData?.hrInactive ?? true,
```

Default to `true` when no mapped user — no data means inactive.

- [ ] **Step 7: Add `hrInactive` to ParticipantFactory.fromRosterEntry()**

In `frontend/src/modules/Fitness/domain/ParticipantFactory.js`, add `hrInactive` to the returned object at line ~88 (after `type`):

```javascript
    // Preserve type for backward compatibility with device-based code
    type: 'heart_rate',
    hrInactive: rosterEntry.hrInactive ?? false
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/fitness/ParticipantRoster.js frontend/src/modules/Fitness/domain/ParticipantFactory.js
git commit -m "feat(fitness): propagate hrInactive through roster and ParticipantFactory

Add hrInactive field to roster entry (from User.currentData) and
participant object (from roster entry). Both objects are built
field-by-field so explicit addition is required."
```

---

### Task 3: Filter hrInactive from governance evaluation

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1610-1645`
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:482-504,1249-1275`
- Create: `tests/unit/fitness/hr-inactive-governance.test.mjs`

- [ ] **Step 9: Write failing governance exclusion test**

Create `tests/unit/fitness/hr-inactive-governance.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

const ZONE_CONFIG = [
  { id: 'cool', name: 'Cool', color: '#3399ff' },
  { id: 'active', name: 'Active', color: '#00cc00' },
  { id: 'warm', name: 'Warm', color: '#ffaa00' },
  { id: 'hot', name: 'Hot', color: '#ff0000' },
];

function createEngine({ grace = 30 } = {}) {
  const mockSession = {
    roster: [],
    zoneProfileStore: null,
    snapshot: { zoneConfig: ZONE_CONFIG }
  };
  const engine = new GovernanceEngine(mockSession);

  const policies = [{
    id: 'default',
    name: 'Default',
    minParticipants: 1,
    baseRequirement: {
      active: 'all',
      grace_period_seconds: grace
    },
    challenges: []
  }];

  engine.configure({
    governed_labels: ['exercise'],
    grace_period_seconds: grace,
  }, policies, {});

  engine.media = { id: 'test-media', labels: ['exercise'], type: 'video' };

  const zoneRankMap = {};
  const zoneInfoMap = {};
  ZONE_CONFIG.forEach((z, i) => {
    zoneRankMap[z.id] = i;
    zoneInfoMap[z.id] = z;
  });

  return { engine, zoneRankMap, zoneInfoMap };
}

describe('GovernanceEngine — hrInactive exclusion', () => {
  it('should expose hrInactiveUsers in state snapshot', () => {
    const { engine, zoneRankMap, zoneInfoMap } = createEngine();
    const participants = ['alice', 'bob'];
    const userZoneMap = { alice: 'active', bob: 'active' };

    engine.evaluate({
      activeParticipants: participants,
      userZoneMap, zoneRankMap, zoneInfoMap,
      totalCount: participants.length,
      hrInactiveUsers: ['charlie']
    });

    expect(engine.state.hrInactiveUsers).toEqual(['charlie']);
  });

  it('should default hrInactiveUsers to empty array when not provided', () => {
    const { engine, zoneRankMap, zoneInfoMap } = createEngine();

    engine.evaluate({
      activeParticipants: ['alice'],
      userZoneMap: { alice: 'active' },
      zoneRankMap, zoneInfoMap,
      totalCount: 1
    });

    expect(engine.state.hrInactiveUsers).toEqual([]);
  });
});

describe('FitnessSession — hrInactive filtering', () => {
  // This tests the filtering logic extracted from _evaluateGovernance.
  // We test the filter inline since FitnessSession is hard to instantiate in isolation.

  const filterActiveParticipants = (effectiveRoster) => {
    return effectiveRoster
      .filter((entry) => {
        const isActive = entry.isActive !== false;
        const hrActive = !entry.hrInactive;
        return isActive && hrActive && (entry.id || entry.profileId);
      })
      .map(entry => entry.id || entry.profileId);
  };

  const filterHrInactiveUsers = (effectiveRoster) => {
    return effectiveRoster
      .filter(entry => entry.hrInactive && (entry.id || entry.profileId))
      .map(entry => entry.id || entry.profileId);
  };

  it('should exclude hrInactive entries from activeParticipants', () => {
    const roster = [
      { id: 'alice', name: 'alice', isActive: true, hrInactive: false, zoneId: 'active' },
      { id: 'bob', name: 'bob', isActive: true, hrInactive: true, zoneId: null },
      { id: 'charlie', name: 'charlie', isActive: true, hrInactive: false, zoneId: 'warm' }
    ];

    const active = filterActiveParticipants(roster);
    expect(active).toEqual(['alice', 'charlie']);
    expect(active).not.toContain('bob');
  });

  it('should collect hrInactive entries into hrInactiveUsers', () => {
    const roster = [
      { id: 'alice', name: 'alice', hrInactive: false },
      { id: 'bob', name: 'bob', hrInactive: true },
      { id: 'charlie', name: 'charlie', hrInactive: true }
    ];

    const inactive = filterHrInactiveUsers(roster);
    expect(inactive).toEqual(['bob', 'charlie']);
  });

  it('should exclude both inactive device and hrInactive entries', () => {
    const roster = [
      { id: 'alice', name: 'alice', isActive: true, hrInactive: false },
      { id: 'bob', name: 'bob', isActive: false, hrInactive: false },
      { id: 'charlie', name: 'charlie', isActive: true, hrInactive: true }
    ];

    const active = filterActiveParticipants(roster);
    expect(active).toEqual(['alice']);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/fitness/hr-inactive-governance.test.mjs --verbose`

Expected: FAIL — `hrInactiveUsers` is undefined on engine state.

- [ ] **Step 11: Implement governance changes**

**a) GovernanceEngine._captureLatestInputs() (line ~493-499):** Store `hrInactiveUsers`:

In `frontend/src/hooks/fitness/GovernanceEngine.js`, add to `_latestInputs` object at line ~498:

```javascript
    this._latestInputs = {
      activeParticipants,
      userZoneMap,
      zoneRankMap: { ...(payload.zoneRankMap || {}) },
      zoneInfoMap,
      totalCount: Number.isFinite(payload.totalCount) ? payload.totalCount : activeParticipants.length,
      hrInactiveUsers: Array.isArray(payload.hrInactiveUsers) ? [...payload.hrInactiveUsers] : []
    };
```

**b) GovernanceEngine._composeState() (line ~1274):** Expose `hrInactiveUsers` in state:

Add after the `nextChallenge` line (1274):

```javascript
      nextChallenge: nextChallengeSnapshot,
      hrInactiveUsers: Array.isArray(this._latestInputs?.hrInactiveUsers)
        ? [...this._latestInputs.hrInactiveUsers]
        : []
```

**c) FitnessSession._evaluateGovernance() (lines 1610-1645):** Filter hrInactive from activeParticipants and build hrInactiveUsers list:

Replace lines 1610-1615 with:

```javascript
    const activeParticipants = effectiveRoster
        .filter((entry) => {
          const isActive = entry.isActive !== false;
          const hrActive = !entry.hrInactive;
          return isActive && hrActive && (entry.id || entry.profileId);
        })
        .map(entry => entry.id || entry.profileId);

    // Build hrInactive list for display layer (governance-exempt but visible)
    const hrInactiveUsers = effectiveRoster
        .filter(entry => entry.hrInactive && (entry.id || entry.profileId))
        .map(entry => entry.id || entry.profileId);
```

And update the `evaluate()` call at lines 1639-1645:

```javascript
    this.governanceEngine.evaluate({
        activeParticipants,
        userZoneMap,
        zoneRankMap,
        zoneInfoMap,
        totalCount: activeParticipants.length,
        hrInactiveUsers
    });
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/fitness/hr-inactive-governance.test.mjs --verbose`

Expected: ALL PASS

- [ ] **Step 13: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/fitness/hr-inactive-governance.test.mjs
git commit -m "feat(fitness): exclude hrInactive participants from governance evaluation

Filter hrInactive users out of activeParticipants in FitnessSession
before passing to GovernanceEngine. Pass hrInactiveUsers list alongside
for display layer consumption. Store and expose in engine state."
```

---

### Task 4: Add defensive filter in resolveGovernanceDisplay

**Files:**
- Modify: `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js:16,28-50`
- Modify: `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs`

- [ ] **Step 14: Write failing test for hrInactive display filtering**

Add to `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs` at the bottom of the describe block:

```javascript
test('hrInactive users are excluded from warning rows even if in missingUsers', () => {
  const displayMap = makeDisplayMap([
    {
      id: 'dad', displayName: 'Dad', avatarSrc: '/img/dad.jpg',
      heartRate: 85, zoneId: 'cool', zoneName: 'Cool', zoneColor: '#94a3b8',
      progress: 0.3, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 100
    },
    {
      id: 'kid1', displayName: 'Kid1', avatarSrc: '/img/kid1.jpg',
      heartRate: null, zoneId: null, zoneName: null, zoneColor: null,
      progress: null, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 100
    }
  ]);

  const result = resolveGovernanceDisplay(
    {
      isGoverned: true,
      status: 'warning',
      deadline: Date.now() + 20000,
      gracePeriodTotal: 30,
      requirements: [
        { zone: 'active', rule: 'all', missingUsers: ['dad', 'kid1'], satisfied: false }
      ],
      hrInactiveUsers: ['kid1']
    },
    displayMap,
    ZONE_META
  );

  expect(result.show).toBe(true);
  const rowUserIds = result.rows.map(r => r.userId);
  expect(rowUserIds).toEqual(['dad']);
  expect(rowUserIds).not.toContain('kid1');
});
```

- [ ] **Step 15: Run test to verify it fails**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs --testNamePattern="hrInactive" --verbose`

Expected: FAIL — `kid1` appears in rows.

- [ ] **Step 16: Implement hrInactive filter in resolveGovernanceDisplay**

In `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js`:

**a) Line 16 (destructuring):** Add `hrInactiveUsers` to destructured fields:

```javascript
  const { status, requirements, challenge, deadline, gracePeriodTotal, videoLocked, hrInactiveUsers } = govState;
```

**b) After line 24 (after `const rankOf`):** Build the hrInactive set:

```javascript
  const hrInactiveSet = new Set((hrInactiveUsers || []).map(normalize));
```

**c) Line 31 (inside base requirements loop):** Add guard at start of forEach callback:

```javascript
    (req.missingUsers || []).forEach((userId) => {
      const key = normalize(userId);
      if (hrInactiveSet.has(key)) return;
      // ... rest of existing logic unchanged ...
```

**d) Line ~44 (inside challenge requirements loop):** Add same guard:

```javascript
    challenge.missingUsers.forEach((userId) => {
      const key = normalize(userId);
      if (hrInactiveSet.has(key)) return;
      // ... rest of existing logic unchanged ...
```

- [ ] **Step 17: Run tests to verify they pass**

Run: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs --verbose`

Expected: ALL PASS (including previous paused-challenge tests)

- [ ] **Step 18: Commit**

```bash
git add frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs
git commit -m "feat(fitness): filter hrInactive users from governance display rows

Add defensive filter in resolveGovernanceDisplay to exclude hrInactive
users from warning/lock screen rows. Uses hrInactiveUsers set from
govState. Defense-in-depth alongside FitnessSession filtering."
```

---

### Task 5: Update display components to use hrInactive

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx:159-160`
- Modify: `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx:161-162`
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx:877,982`
- Modify: `frontend/src/modules/Fitness/nav/SidebarFooter.jsx:65-72`

- [ ] **Step 19: Update primary FullscreenVitalsOverlay**

In `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx`, replace lines 159-160:

```javascript
        const hrValid = Number.isFinite(device?.heartRate) && device.heartRate > 0;
        const isInactive = device.inactiveSince || device.connectionState !== 'connected' || !hrValid;
```

with:

```javascript
        const userHrInactive = user?.currentData?.hrInactive ?? false;
        const hrValid = Number.isFinite(device?.heartRate) && device.heartRate > 0;
        const isInactive = userHrInactive || device.inactiveSince || device.connectionState !== 'connected' || !hrValid;
```

Note: `user` is already resolved at line 144 via `getUserByDevice`.

- [ ] **Step 20: Update shared FullscreenVitalsOverlay**

In `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx`, replace lines 161-162 with the same pattern:

```javascript
        const userHrInactive = user?.currentData?.hrInactive ?? false;
        const hrValid = Number.isFinite(device?.heartRate) && device.heartRate > 0;
        const isInactive = userHrInactive || device.inactiveSince || device.connectionState !== 'connected' || !hrValid;
```

- [ ] **Step 21: Update FitnessUsers.jsx**

In `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx`, update both inactive computations:

**Line 877:** Change:
```javascript
                      isInactive={device.isActive === false || !!device.inactiveSince}
```
to:
```javascript
                      isInactive={device.isActive === false || !!device.inactiveSince || !!device.hrInactive}
```

**Line 982:** Change:
```javascript
              const isInactive = device.isActive === false || !!device.inactiveSince;
```
to:
```javascript
              const isInactive = device.isActive === false || !!device.inactiveSince || !!device.hrInactive;
```

- [ ] **Step 22: Update SidebarFooter.jsx**

In `frontend/src/modules/Fitness/nav/SidebarFooter.jsx`, add hrInactive check at the top of `computeDeviceActive` (after line 66):

```javascript
  const computeDeviceActive = React.useCallback((device) => {
    if (!device) return false;
    if (device.hrInactive) return false;
    // Prefer explicit active state if available (from Roster/ActivityMonitor)
    if (device.isActive !== undefined) return device.isActive;
```

**Note on PersonCard.jsx:** No changes needed inside `PersonCard.jsx` itself. It already accepts an `isInactive` prop from its parent (`FitnessUsers.jsx`). The changes to FitnessUsers.jsx in Steps 21 above ensure `hrInactive` is included in the `isInactive` computation passed to PersonCard.

- [ ] **Step 23: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx \
  frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx \
  frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx \
  frontend/src/modules/Fitness/nav/SidebarFooter.jsx
git commit -m "feat(fitness): use hrInactive flag in all display components

Update FullscreenVitalsOverlay (both versions), FitnessUsers panel,
and SidebarFooter to use centralized hrInactive flag for inactive
state detection. Replaces scattered hrValid checks with authoritative
flag from UserManager."
```

---

### Task 6: Run full test suite and verify

- [ ] **Step 24: Run all governance and fitness tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/fitness/ tests/unit/governance/ tests/isolated/domain/fitness/ --verbose
```

Expected: ALL new tests pass. Pre-existing failures (if any) should be unchanged.

- [ ] **Step 25: Final commit if any fixups needed**

Only if test failures reveal issues in the implementation.
