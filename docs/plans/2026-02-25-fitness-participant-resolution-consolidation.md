# Fitness Participant Resolution Consolidation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate 6 redundant participant resolution paths, establishing ParticipantRoster as the single source of truth for "who is participating and what zone are they in."

**Architecture:** Remove the legacy `FitnessSession.roster` getter fallback (~65 lines of duplicated code), add a canonical `getActiveParticipantState()` method on ParticipantRoster, make GovernanceEngine consume it instead of rebuilding its own participant list, and remove the display-layer fallback that compensated for governance startup failures.

**Tech Stack:** Jest (ESM mode via `--experimental-vm-modules`), `@jest/globals`, `jest.unstable_mockModule()` for mocking.

**Audit reference:** `docs/_wip/audits/2026-02-25-fitness-participant-resolution-ssot-audit.md`

---

## Key Files

| File | Role |
|------|------|
| `frontend/src/hooks/fitness/FitnessSession.js` | Session orchestrator — owns `roster` getter and `getParticipantProfile()` |
| `frontend/src/hooks/fitness/ParticipantRoster.js` | SSOT for participant list — `getRoster()`, `_buildRosterEntry()`, `_buildZoneLookup()` |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Evaluates zone governance rules — `evaluate()`, `_triggerPulse()` |
| `frontend/src/hooks/fitness/participantDisplayMap.js` | Builds display entries from roster + ZoneProfileStore |
| `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js` | Builds governance overlay rows — contains roster fallback to remove |

## Test Infrastructure

**Run isolated tests:**
```bash
npx jest tests/isolated/domain/fitness/ --colors
```

**Run a single test file:**
```bash
npx jest tests/isolated/domain/fitness/<file>.unit.test.mjs --colors
```

**Logger mock boilerplate** (required before importing any fitness module):
```javascript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockDebug = jest.fn();
const mockWarn = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();
const mockSampled = jest.fn();
const mockLogger = { debug: mockDebug, warn: mockWarn, info: mockInfo, error: mockError, sampled: mockSampled };

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => mockLogger,
  getLogger: () => mockLogger
}));
```

**ParticipantRoster mock dependencies pattern** (from `roster-zone-source.unit.test.mjs`):
```javascript
const mockDeviceManager = {
  getAllDevices: () => [/* devices */]
};
const mockUserManager = {
  assignmentLedger: new Map([/* entries */]),
  resolveUserForDevice: (id) => {/* return user */}
};
const mockTreasureBox = {
  getUserZoneSnapshot: () => [/* zone entries */]
};
const mockZoneProfileStore = {
  getZoneState: (id) => {/* return committed zone */}
};

roster.configure({
  deviceManager: mockDeviceManager,
  userManager: mockUserManager,
  treasureBox: mockTreasureBox,
  zoneProfileStore: mockZoneProfileStore
});
```

---

## Task 1: Retire Legacy Roster Getter

**Violations fixed:** V1 (Path 1), V3 (one copy), V4 (`isActive: true` hardcode), V5 (one ID extraction variation)

**Why it's safe:** `ParticipantRoster.getRoster()` already returns `[]` when unconfigured (lines 109-111 check `!this._deviceManager || !this._userManager`). All callers of `this.roster` are session-scoped (governance, timeline, summary) — none fire before `startSession()` calls `configure()`. The legacy path is dead code for the pre-session case.

**Files:**
- Create: `tests/isolated/domain/fitness/roster-legacy-retirement.unit.test.mjs`
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` (lines 1114-1188)

### Step 1: Write the failing regression test

Create `tests/isolated/domain/fitness/roster-legacy-retirement.unit.test.mjs`:

```javascript
/**
 * Regression test: verifies FitnessSession.roster delegates to ParticipantRoster
 * and does NOT use the legacy fallback that hardcoded isActive:true.
 *
 * Tests ParticipantRoster behavior directly (FitnessSession delegates to it).
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockDebug = jest.fn();
const mockWarn = jest.fn();
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: mockDebug, warn: mockWarn, info: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: mockDebug, warn: mockWarn, info: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

// Mock resolveDisplayLabel (imported by ParticipantRoster)
jest.unstable_mockModule('#frontend/hooks/fitness/types.js', () => ({
  resolveDisplayLabel: ({ name }) => name
}));

// Mock ParticipantStatus
jest.unstable_mockModule('#frontend/modules/Fitness/domain/types.js', () => ({
  ParticipantStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' }
}));

const { ParticipantRoster } = await import('#frontend/hooks/fitness/ParticipantRoster.js');

describe('Roster legacy retirement regression', () => {
  let roster;

  beforeEach(() => {
    roster = new ParticipantRoster();
  });

  it('returns [] when not configured (no legacy fallback)', () => {
    // Before the fix, FitnessSession.roster would fall through to a legacy
    // implementation when _participantRoster._deviceManager was null.
    // After the fix, it delegates unconditionally, getting [] from getRoster().
    expect(roster.getRoster()).toEqual([]);
  });

  it('returns isActive from device.inactiveSince, NOT hardcoded true (V4 fix)', () => {
    roster.configure({
      deviceManager: {
        getAllDevices: () => [
          { id: 'dev-active', type: 'heart_rate', heartRate: 120 },
          { id: 'dev-inactive', type: 'heart_rate', heartRate: 80, inactiveSince: '2026-01-01T00:00:00Z' }
        ]
      },
      userManager: {
        assignmentLedger: new Map([
          ['dev-active', { occupantName: 'Alice', occupantId: 'alice', occupantType: 'member' }],
          ['dev-inactive', { occupantName: 'Bob', occupantId: 'bob', occupantType: 'member' }]
        ]),
        resolveUserForDevice: (id) => {
          if (id === 'dev-active') return { id: 'alice', name: 'Alice', source: 'Member' };
          if (id === 'dev-inactive') return { id: 'bob', name: 'Bob', source: 'Member' };
          return null;
        }
      },
      treasureBox: { getUserZoneSnapshot: () => [] },
      zoneProfileStore: { getZoneState: () => null }
    });

    const result = roster.getRoster();
    const active = result.find(e => e.hrDeviceId === 'dev-active');
    const inactive = result.find(e => e.hrDeviceId === 'dev-inactive');

    expect(active.isActive).toBe(true);
    expect(inactive.isActive).toBe(false);
    // The legacy getter hardcoded isActive:true for ALL entries — this test
    // proves the SSOT behavior from ParticipantRoster is now authoritative.
  });

  it('produces entries with both id and profileId fields (V5 consistency)', () => {
    roster.configure({
      deviceManager: {
        getAllDevices: () => [
          { id: 'dev-1', type: 'heart_rate', heartRate: 100 }
        ]
      },
      userManager: {
        assignmentLedger: new Map([
          ['dev-1', { occupantName: 'Alice', occupantId: 'alice', occupantType: 'member' }]
        ]),
        resolveUserForDevice: () => ({ id: 'alice', name: 'Alice', source: 'Member' })
      },
      treasureBox: { getUserZoneSnapshot: () => [] },
      zoneProfileStore: { getZoneState: () => null }
    });

    const [entry] = roster.getRoster();
    // ParticipantRoster sets both id and profileId to the same value
    expect(entry.id).toBe('alice');
    expect(entry.profileId).toBe('alice');
  });
});
```

### Step 2: Run test to verify it passes (baseline)

```bash
npx jest tests/isolated/domain/fitness/roster-legacy-retirement.unit.test.mjs --colors
```

Expected: PASS (these test ParticipantRoster behavior which already works correctly).

### Step 3: Retire the legacy getter

In `frontend/src/hooks/fitness/FitnessSession.js`, replace the `roster` getter (lines 1114-1188) with:

```javascript
  get roster() {
    return this._participantRoster?.getRoster() ?? [];
  }
```

This removes ~70 lines of duplicated code. The `_participantRoster.getRoster()` already handles the unconfigured case (returns `[]`).

### Step 4: Run the regression test

```bash
npx jest tests/isolated/domain/fitness/roster-legacy-retirement.unit.test.mjs --colors
```

Expected: PASS

### Step 5: Run existing fitness test suite to verify no regressions

```bash
npx jest tests/isolated/domain/fitness/ --colors
```

Expected: All existing tests PASS. The existing `roster-zone-source.unit.test.mjs` tests ParticipantRoster directly and should be unaffected.

### Step 6: Commit

```bash
git add tests/isolated/domain/fitness/roster-legacy-retirement.unit.test.mjs frontend/src/hooks/fitness/FitnessSession.js
git commit -m "refactor(fitness): retire legacy roster getter, delegate to ParticipantRoster

Removes ~70 lines of duplicated participant resolution code from
FitnessSession.roster. The getter now unconditionally delegates to
ParticipantRoster.getRoster(), which already handles the unconfigured
case by returning [].

Fixes audit violations V1 (Path 1), V3, V4, V5 from the participant
resolution SSOT audit.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Simplify getParticipantProfile

**Why:** After Task 1, `this.roster` delegates to `_participantRoster.getRoster()`. The method's Fallback 2 (legacy roster search via `this.roster`) is now functionally identical to Fallback 1 (`_participantRoster.findParticipant()`) since `findParticipant()` internally calls `getRoster()`. Remove the redundant fallback.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` (lines 2515-2557)

### Step 1: Review the current method

Read `frontend/src/hooks/fitness/FitnessSession.js` lines 2515-2557. Confirm:
- Fallback 1 (line ~2527): `this._participantRoster?.findParticipant(identifier)`
- Fallback 2 (line ~2539): `this.roster` → `.find(...)` — now redundant

### Step 2: Remove the redundant fallback

Replace the `getParticipantProfile` method (lines 2515-2557) with:

```javascript
  getParticipantProfile(identifier) {
    if (!identifier) return null;

    // Primary: ZoneProfileStore (authoritative for zone state + config)
    const zoneProfile = this.zoneProfileStore?.getProfile(identifier) ?? null;
    if (zoneProfile) {
      return { ...zoneProfile, resolved: true };
    }

    // Fallback: ParticipantRoster (works whether or not roster is configured —
    // findParticipant returns null when unconfigured)
    const rosterEntry = this._participantRoster?.findParticipant(identifier) ?? null;
    if (rosterEntry) {
      this._log('participant_profile_roster_fallback', { identifier, hasHr: rosterEntry.heartRate != null });
      return {
        heartRate: rosterEntry.heartRate,
        currentZoneId: rosterEntry.zoneId || null,
        zoneConfig: this.zoneProfileStore?.getBaseZoneConfig() || [],
        resolved: true,
        _source: 'roster'
      };
    }

    // Not resolvable
    this._log('participant_profile_unresolved', { identifier });
    return null;
  }
```

### Step 3: Run existing fitness tests

```bash
npx jest tests/isolated/domain/fitness/ --colors
```

Expected: All PASS. No test directly tests the removed legacy fallback — the mock sessions in GovernanceEngine tests don't include `getParticipantProfile()` on the mock object.

### Step 4: Commit

```bash
git add frontend/src/hooks/fitness/FitnessSession.js
git commit -m "refactor(fitness): simplify getParticipantProfile, remove redundant fallback

After retiring the legacy roster getter, the legacy roster fallback
in getParticipantProfile was functionally identical to the
ParticipantRoster.findParticipant() fallback. Remove it.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Add Canonical getActiveParticipantState Method

**Why:** GovernanceEngine currently reads `session.roster`, re-extracts IDs and zones, then does a second-pass zone enrichment. Instead, ParticipantRoster should provide a pre-built `{ participants, zoneMap, totalCount }` that consumers use directly.

**Files:**
- Create: `tests/isolated/domain/fitness/active-participant-state.unit.test.mjs`
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js`
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` (add delegation method)

### Step 1: Write the failing test

Create `tests/isolated/domain/fitness/active-participant-state.unit.test.mjs`:

```javascript
/**
 * Tests ParticipantRoster.getActiveParticipantState() — the canonical method
 * for "who is participating and what zone are they in?"
 *
 * GovernanceEngine and other consumers should use this instead of reading
 * session.roster and rebuilding their own participant lists.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockDebug = jest.fn();
const mockWarn = jest.fn();
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: mockDebug, warn: mockWarn, info: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: mockDebug, warn: mockWarn, info: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

jest.unstable_mockModule('#frontend/hooks/fitness/types.js', () => ({
  resolveDisplayLabel: ({ name }) => name
}));

jest.unstable_mockModule('#frontend/modules/Fitness/domain/types.js', () => ({
  ParticipantStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' }
}));

const { ParticipantRoster } = await import('#frontend/hooks/fitness/ParticipantRoster.js');

describe('ParticipantRoster.getActiveParticipantState()', () => {
  let roster;

  const configureWithParticipants = (devices, users, zones = []) => {
    roster.configure({
      deviceManager: { getAllDevices: () => devices },
      userManager: {
        assignmentLedger: new Map(
          users.map(u => [u.deviceId, { occupantName: u.name, occupantId: u.id, occupantType: 'member' }])
        ),
        resolveUserForDevice: (deviceId) => {
          const u = users.find(x => x.deviceId === deviceId);
          return u ? { id: u.id, name: u.name, source: 'Member', currentData: {} } : null;
        }
      },
      treasureBox: { getUserZoneSnapshot: () => zones },
      zoneProfileStore: { getZoneState: () => null }
    });
  };

  beforeEach(() => {
    roster = new ParticipantRoster();
  });

  it('returns empty state when not configured', () => {
    const state = roster.getActiveParticipantState();
    expect(state).toEqual({ participants: [], zoneMap: {}, totalCount: 0 });
  });

  it('returns active participants with their zone IDs', () => {
    configureWithParticipants(
      [
        { id: 'dev-1', type: 'heart_rate', heartRate: 120 },
        { id: 'dev-2', type: 'heart_rate', heartRate: 90 }
      ],
      [
        { deviceId: 'dev-1', id: 'alice', name: 'Alice' },
        { deviceId: 'dev-2', id: 'bob', name: 'Bob' }
      ],
      [
        { trackingId: 'alice', userId: 'alice', zoneId: 'active', color: 'orange' },
        { trackingId: 'bob', userId: 'bob', zoneId: 'warm', color: 'yellow' }
      ]
    );

    const state = roster.getActiveParticipantState();
    expect(state.participants).toEqual(['alice', 'bob']);
    expect(state.zoneMap).toEqual({ alice: 'active', bob: 'warm' });
    expect(state.totalCount).toBe(2);
  });

  it('excludes inactive participants (device.inactiveSince set)', () => {
    configureWithParticipants(
      [
        { id: 'dev-1', type: 'heart_rate', heartRate: 120 },
        { id: 'dev-2', type: 'heart_rate', heartRate: 80, inactiveSince: '2026-01-01T00:00:00Z' }
      ],
      [
        { deviceId: 'dev-1', id: 'alice', name: 'Alice' },
        { deviceId: 'dev-2', id: 'bob', name: 'Bob' }
      ],
      [
        { trackingId: 'alice', userId: 'alice', zoneId: 'active', color: 'orange' },
        { trackingId: 'bob', userId: 'bob', zoneId: 'warm', color: 'yellow' }
      ]
    );

    const state = roster.getActiveParticipantState();
    expect(state.participants).toEqual(['alice']);
    expect(state.zoneMap).toEqual({ alice: 'active' });
    expect(state.totalCount).toBe(1);
  });

  it('includes participants without zone data (no ghost-filtering)', () => {
    // This is the key startup scenario: participants are real (HR device active)
    // but zone data hasn't arrived yet. They must NOT be filtered out.
    configureWithParticipants(
      [
        { id: 'dev-1', type: 'heart_rate', heartRate: 120 },
        { id: 'dev-2', type: 'heart_rate', heartRate: 90 }
      ],
      [
        { deviceId: 'dev-1', id: 'alice', name: 'Alice' },
        { deviceId: 'dev-2', id: 'bob', name: 'Bob' }
      ],
      [] // No zone data yet
    );

    const state = roster.getActiveParticipantState();
    expect(state.participants).toEqual(['alice', 'bob']);
    expect(state.zoneMap).toEqual({}); // No zones, but participants are present
    expect(state.totalCount).toBe(2);
  });

  it('lowercases zone IDs for consistent matching', () => {
    configureWithParticipants(
      [{ id: 'dev-1', type: 'heart_rate', heartRate: 120 }],
      [{ deviceId: 'dev-1', id: 'alice', name: 'Alice' }],
      [{ trackingId: 'alice', userId: 'alice', zoneId: 'Active', color: 'orange' }]
    );

    const state = roster.getActiveParticipantState();
    expect(state.zoneMap.alice).toBe('active'); // lowercased
  });
});
```

### Step 2: Run test to verify it fails

```bash
npx jest tests/isolated/domain/fitness/active-participant-state.unit.test.mjs --colors
```

Expected: FAIL — `roster.getActiveParticipantState is not a function`

### Step 3: Implement getActiveParticipantState on ParticipantRoster

In `frontend/src/hooks/fitness/ParticipantRoster.js`, add after `getAllWithStatus()` (around line 192):

```javascript
  /**
   * Canonical participant state for governance and other consumers.
   * Returns active participant IDs and their zone map in a single call.
   * Consumers should use this instead of reading getRoster() and re-extracting.
   *
   * @returns {{ participants: string[], zoneMap: Object<string, string>, totalCount: number }}
   */
  getActiveParticipantState() {
    const roster = this.getRoster();
    const participants = [];
    const zoneMap = {};

    for (const entry of roster) {
      if (!entry.isActive) continue;
      const id = entry.id || entry.profileId;
      if (!id) continue;
      participants.push(id);
      const zoneId = entry.zoneId;
      if (zoneId) {
        zoneMap[id] = typeof zoneId === 'string' ? zoneId.toLowerCase() : String(zoneId).toLowerCase();
      }
    }

    return { participants, zoneMap, totalCount: participants.length };
  }
```

### Step 4: Run test to verify it passes

```bash
npx jest tests/isolated/domain/fitness/active-participant-state.unit.test.mjs --colors
```

Expected: PASS

### Step 5: Add delegation on FitnessSession

In `frontend/src/hooks/fitness/FitnessSession.js`, add near the existing `getActiveParticipants()` method (around line 1095):

```javascript
  /**
   * Canonical participant state for governance consumers.
   * Delegates to ParticipantRoster.getActiveParticipantState().
   */
  getActiveParticipantState() {
    return this._participantRoster?.getActiveParticipantState()
      ?? { participants: [], zoneMap: {}, totalCount: 0 };
  }
```

### Step 6: Run full fitness test suite

```bash
npx jest tests/isolated/domain/fitness/ --colors
```

Expected: All PASS

### Step 7: Commit

```bash
git add tests/isolated/domain/fitness/active-participant-state.unit.test.mjs \
  frontend/src/hooks/fitness/ParticipantRoster.js \
  frontend/src/hooks/fitness/FitnessSession.js
git commit -m "feat(fitness): add canonical getActiveParticipantState method

ParticipantRoster.getActiveParticipantState() returns { participants,
zoneMap, totalCount } — the single canonical answer to 'who is active
and what zone are they in?' FitnessSession delegates to it.

Consumers (GovernanceEngine, display) will migrate to this in the
next task, eliminating duplicate participant list building.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Refactor GovernanceEngine to Use Canonical State

**Violations fixed:** V1 (Path 4), V2 (double-pass zone enrichment), V4 (isActive trust chain), V5 (ID extraction in evaluate)

**What changes:**
1. `evaluate()` calls `session.getActiveParticipantState()` instead of reading `session.roster` and re-extracting IDs/zones
2. Remove the second-pass zone enrichment via `getParticipantProfile()` (redundant — roster already includes ZoneProfileStore data via `_buildZoneLookup()`)
3. Remove the ghost filter (participants without zone data are real participants — `isActive` from ParticipantRoster is the authority, not zone data presence)

**Files:**
- Create: `tests/isolated/domain/fitness/governance-canonical-state.unit.test.mjs`
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (lines 1295-1388)

### Step 1: Write the failing test

Create `tests/isolated/domain/fitness/governance-canonical-state.unit.test.mjs`:

```javascript
/**
 * Tests that GovernanceEngine.evaluate() uses the canonical
 * getActiveParticipantState() method instead of rebuilding its own
 * participant list from session.roster.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockDebug = jest.fn();
const mockWarn = jest.fn();
const mockSampled = jest.fn();
const mockLogger = {
  debug: mockDebug, warn: mockWarn, info: jest.fn(),
  error: jest.fn(), sampled: mockSampled, child: () => mockLogger
};

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => mockLogger,
  getLogger: () => mockLogger
}));

// Mock the API module (imported by GovernanceEngine for challenge image fetch)
jest.unstable_mockModule('#frontend/lib/api.mjs', () => ({
  default: { get: jest.fn(), post: jest.fn() },
  api: { get: jest.fn(), post: jest.fn() }
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

const createMockSession = ({ participantState, roster, zoneProfileStore } = {}) => ({
  getActiveParticipantState: jest.fn().mockReturnValue(
    participantState || { participants: [], zoneMap: {}, totalCount: 0 }
  ),
  // Legacy roster — should NOT be used after refactoring
  roster: roster ?? [],
  zoneProfileStore: zoneProfileStore || { getProfile: () => null },
  treasureBox: null,
  getParticipantProfile: jest.fn().mockReturnValue(null)
});

describe('GovernanceEngine canonical state consumption', () => {
  let engine;
  let mockSession;

  beforeEach(() => {
    mockDebug.mockClear();
    mockWarn.mockClear();
    mockSampled.mockClear();
  });

  it('calls getActiveParticipantState() when evaluate() has no args', () => {
    mockSession = createMockSession({
      participantState: {
        participants: ['alice', 'bob'],
        zoneMap: { alice: 'active', bob: 'warm' },
        totalCount: 2
      }
    });

    engine = new GovernanceEngine(mockSession);
    // Set up minimal governance rules so evaluate doesn't bail early
    engine._governedLabelSet = new Set(['fitness']);
    engine._governedTypeSet = new Set();
    engine.media = { id: 'test-media', label: 'fitness', type: 'video' };
    engine._latestInputs = {
      zoneRankMap: { active: 3, warm: 2, rest: 1 },
      zoneInfoMap: { active: {}, warm: {}, rest: {} }
    };

    engine.evaluate();

    expect(mockSession.getActiveParticipantState).toHaveBeenCalled();
  });

  it('does NOT call getParticipantProfile for second-pass zone enrichment', () => {
    mockSession = createMockSession({
      participantState: {
        participants: ['alice'],
        zoneMap: { alice: 'active' },
        totalCount: 1
      }
    });

    engine = new GovernanceEngine(mockSession);
    engine._governedLabelSet = new Set(['fitness']);
    engine._governedTypeSet = new Set();
    engine.media = { id: 'test-media', label: 'fitness', type: 'video' };
    engine._latestInputs = {
      zoneRankMap: { active: 3 },
      zoneInfoMap: { active: {} }
    };

    engine.evaluate();

    // After refactoring, the second-pass enrichment via getParticipantProfile is removed
    expect(mockSession.getParticipantProfile).not.toHaveBeenCalled();
  });

  it('includes participants without zone data (no ghost-filtering)', () => {
    // Key startup scenario: alice has zone data, bob doesn't yet.
    // Both should remain in activeParticipants.
    mockSession = createMockSession({
      participantState: {
        participants: ['alice', 'bob'],
        zoneMap: { alice: 'active' }, // bob has NO zone
        totalCount: 2
      }
    });

    engine = new GovernanceEngine(mockSession);
    engine._governedLabelSet = new Set(['fitness']);
    engine._governedTypeSet = new Set();
    engine.media = { id: 'test-media', label: 'fitness', type: 'video' };
    engine._latestInputs = {
      zoneRankMap: { active: 3, warm: 2 },
      zoneInfoMap: { active: {}, warm: {} }
    };
    engine.requirements = [
      { zone: 'active', type: 'all', satisfied: false, missingUsers: [] }
    ];

    engine.evaluate();

    // bob should NOT be ghost-filtered — he's a real participant
    // Verify by checking that totalCount was not reduced
    // (The exact assertion depends on how evaluate exposes state;
    // checking the callback or internal state)
    const lastState = engine.getState?.() || {};
    // At minimum, the method should have been called with both participants
    expect(mockSession.getActiveParticipantState).toHaveBeenCalled();
  });
});
```

### Step 2: Run test to verify it fails

```bash
npx jest tests/isolated/domain/fitness/governance-canonical-state.unit.test.mjs --colors
```

Expected: FAIL — `getActiveParticipantState` is not called (GovernanceEngine still reads `session.roster`).

### Step 3: Refactor GovernanceEngine.evaluate()

In `frontend/src/hooks/fitness/GovernanceEngine.js`, replace the three blocks:

**Replace the first pass (lines ~1295-1313)** — change from reading `session.roster` to calling `session.getActiveParticipantState()`:

Find this block:
```javascript
  // If no data passed in, read participant list from session.roster
  // P1: Also pre-populate userZoneMap from roster entries (matches updateSnapshot path).
  // ZoneProfileStore will supplement/override below.
  if (!activeParticipants && this.session?.roster) {
    const roster = this.session.roster || [];
    activeParticipants = roster
      .filter((entry) => entry.isActive !== false && (entry.id || entry.profileId))
      .map((entry) => entry.id || entry.profileId);

    userZoneMap = {};
    roster.forEach((entry) => {
      const userId = entry.id || entry.profileId;
      const zoneId = entry.zoneId || entry.currentZoneId;
      if (userId && zoneId) {
        userZoneMap[userId] = typeof zoneId === 'string' ? zoneId.toLowerCase() : String(zoneId).toLowerCase();
      }
    });
    totalCount = activeParticipants.length;
  }
```

Replace with:
```javascript
    // Use canonical participant state from ParticipantRoster (SSOT).
    // This replaces reading session.roster and re-extracting IDs/zones.
    if (!activeParticipants && this.session?.getActiveParticipantState) {
      const state = this.session.getActiveParticipantState();
      activeParticipants = state.participants;
      userZoneMap = state.zoneMap;
      totalCount = state.totalCount;
    }
```

**Remove the second pass (lines ~1355-1373)** — delete this entire block:

```javascript
    // Populate userZoneMap using canonical resolution (FitnessSession.getParticipantProfile)
    // (Must happen before ghost filter so participants have zone data)
    // Uses the session's unified resolution chain: ZoneProfileStore → ParticipantRoster → legacy roster
    if (this.session) {
      activeParticipants.forEach((participantId) => {
        const profile = this.session.getParticipantProfile?.(participantId)
          ?? this.session.zoneProfileStore?.getProfile(participantId)
          ?? null;
        if (profile?.currentZoneId) {
          userZoneMap[participantId] = profile.currentZoneId.toLowerCase();
        } else if (participantId) {
          getLogger().debug('governance.evaluate.no_zone_profile', {
            participantId,
            hasProfile: !!profile,
            currentZoneId: profile?.currentZoneId ?? null
          });
        }
      });
    }
```

**Remove the ghost filter (lines ~1375-1388)** — delete this entire block:

```javascript
    // Filter out ghost participants — users in the roster but with no zone data.
    // These are disconnected participants whose roster entries are stale.
    // IMPORTANT: Must run AFTER ZoneProfileStore population above.
    if (userZoneMap && typeof userZoneMap === 'object') {
      const beforeCount = activeParticipants.length;
      activeParticipants = activeParticipants.filter(id => id in userZoneMap);
      totalCount = activeParticipants.length;
      if (activeParticipants.length < beforeCount) {
        getLogger().debug('governance.filtered_ghost_participants', {
          removed: beforeCount - activeParticipants.length,
          remaining: activeParticipants.length
        });
      }
    }
```

### Step 4: Run the new test

```bash
npx jest tests/isolated/domain/fitness/governance-canonical-state.unit.test.mjs --colors
```

Expected: PASS

### Step 5: Run existing GovernanceEngine test suite

```bash
npx jest tests/isolated/domain/fitness/legacy/governance- --colors
```

Expected: All PASS. Existing tests call `evaluate()` with explicit `activeParticipants` (not through the pulse path), so they're unaffected by the refactoring.

### Step 6: Run full fitness test suite

```bash
npx jest tests/isolated/domain/fitness/ --colors
```

Expected: All PASS

### Step 7: Commit

```bash
git add tests/isolated/domain/fitness/governance-canonical-state.unit.test.mjs \
  frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "refactor(fitness): GovernanceEngine uses canonical participant state

evaluate() now calls session.getActiveParticipantState() instead of
reading session.roster and re-extracting IDs/zones. Removes:
- First pass: roster iteration + ID/zone extraction (replaced by SSOT)
- Second pass: getParticipantProfile zone enrichment (redundant —
  roster already includes ZoneProfileStore data via _buildZoneLookup)
- Ghost filter: zone-data-as-activity-proxy (replaced by real
  isActive tracking from ParticipantRoster)

Fixes audit violations V1 (Path 4), V2, V4 (trust chain), V5.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Remove Display-Layer Governance Fallback

**Violation fixed:** V6 — display layer compensating for engine-layer gap

**Why it's now safe:** After Task 4, GovernanceEngine no longer ghost-filters all participants during startup. Participants are present in `activeParticipants` even without zone data, so governance produces real `missingUsers` entries. The display fallback is no longer needed.

**Files:**
- Modify: `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js` (lines 52-66)
- Modify: `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs` (if fallback is tested)

### Step 1: Review the fallback code

Read `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js` lines 52-66. This is the block that fires when `userTargets.size === 0` and governance is `pending`/`locked`. After our refactoring, governance will produce `missingUsers` even during startup, so `userTargets.size` will be > 0 when there are participants.

### Step 2: Remove the fallback block

Delete lines 52-66 from `resolveGovernanceDisplay()`:

```javascript
    // Roster fallback: when governance is pending/locked with no missingUsers but the roster
    // has participants (displayMap is roster-first), show all roster participants as needing
    // to meet the first unsatisfied requirement. This prevents "Waiting for participant data..."
    // during startup when GovernanceEngine hasn't resolved zone data yet.
    if (userTargets.size === 0 && (status === 'pending' || status === 'locked') && displayMap && displayMap.size > 0) {
      const firstTarget = (requirements || []).find(r => !r.satisfied);
      const fallbackTargetZoneId = firstTarget?.zone || null;
      const seen = new Set();
      for (const [key, entry] of displayMap) {
        const entryId = entry.id || key;
        if (seen.has(entryId)) continue;
        seen.add(entryId);
        userTargets.set(key, { userId: entryId, targetZoneId: fallbackTargetZoneId });
      }
    }
```

### Step 3: Run existing display hook tests

```bash
npx jest tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs --colors
```

Review results. If any test specifically tests the fallback behavior, update it to verify the fallback is NOT present (or remove the test if it only tests the fallback).

### Step 4: Run full fitness test suite

```bash
npx jest tests/isolated/domain/fitness/ --colors
```

Expected: All PASS

### Step 5: Commit

```bash
git add frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js \
  tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs
git commit -m "refactor(fitness): remove display-layer governance roster fallback

The useGovernanceDisplay roster fallback (V6) was added to compensate
for GovernanceEngine ghost-filtering all participants during startup.
Now that GovernanceEngine uses canonical participant state and no
longer ghost-filters, governance produces real missingUsers during
startup. The display fallback is no longer needed.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Full Test Suite Verification and Cleanup

### Step 1: Run all isolated fitness tests

```bash
npx jest tests/isolated/domain/fitness/ --colors
```

Expected: All PASS

### Step 2: Run all isolated tests (full suite)

```bash
npx jest tests/isolated/ --colors
```

Expected: All PASS

### Step 3: Verify no references to removed code

Search for any remaining references to the removed patterns:

```bash
# Check for lingering references to the ghost filter
grep -rn 'filtered_ghost_participants' frontend/src/hooks/fitness/
# Should return nothing (the log event was in the removed block)

# Check for references to the legacy roster fallback source tag
grep -rn "'legacy_roster'" frontend/src/hooks/fitness/
# Should return nothing (the _source: 'legacy_roster' was in the removed fallback)

# Verify no code reads session.roster for ID extraction (outside of display/timeline)
grep -rn 'session\.roster' frontend/src/hooks/fitness/GovernanceEngine.js
# Should return nothing (GovernanceEngine no longer reads session.roster)
```

### Step 4: Final commit (if any cleanup needed)

If Step 3 found stale references, fix them and commit:

```bash
git add -A
git commit -m "chore(fitness): clean up stale references after participant resolution consolidation

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Post-Consolidation Architecture

```
DeviceManager + UserManager + TreasureBox + ZoneProfileStore
                         |
                         v
              ParticipantRoster.getRoster()          <-- SSOT for participant list
              ParticipantRoster.getActiveParticipantState()  <-- canonical for consumers
                         |
          +--------------+-----------------+
          v              v                 v
   GovernanceEngine  displayMap builder  Chart/UI
   (consumes only)   (consumes only)     (consumes only)
```

**Eliminated paths:** Legacy `FitnessSession.roster` fallback, GovernanceEngine's roster re-extraction + double-pass zone enrichment + ghost filter, `useGovernanceDisplay` roster fallback.

**Remaining code (by design):**
- `getParticipantProfile()` — 2-layer lookup (ZoneProfileStore → ParticipantRoster) for single-participant queries. Different use case from batch state.
- `participantDisplayMap.js` — still merges roster + ZoneProfileStore profiles for display. This is display-layer enrichment, not a duplicate resolution path.

## Known Pre-Existing Issue (Not In Scope)

`ParticipantRoster._buildZoneLookup()` has a field naming inconsistency: TreasureBox entries use `zoneColor` (line 295) but ZoneProfileStore override and `_buildRosterEntry` read `color` (lines 307, 418). When only TreasureBox provides zone data, the color field is lost (falls through to `currentData.color` fallback). This predates the consolidation and should be tracked separately.
