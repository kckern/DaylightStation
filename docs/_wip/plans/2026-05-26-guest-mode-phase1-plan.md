# Guest Mode Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Implement Phase 1 of the guest-mode redesign — replace the hardcoded 60-second grace window with a configurable continuous-usage threshold (W1), fix generic "Guest" tags so simultaneous Guests on different devices stay distinct (W2), and make INACTIVE-device exclusion from governance evaluation explicit (W3).

**Architecture:** All three work items are service-layer or local UI-state changes. No schema migration. W1 introduces one config field (`governance.usage_threshold_seconds`, default 300) plumbed through the existing `FitnessConfigService` chain. W2 is a 3-line fix to `FitnessSidebarMenu.handleAssignGuest`. W3 is a verify-and-make-explicit filter at the governance boundary. Late-tag Pikachu deduplication (Decision §5) falls out automatically from W1's session-end backfill pass — no separate work item needed.

**Tech Stack:** React 18 frontend, Node.js backend, fitness.yml config loaded via `FitnessConfigService.mjs`, vitest for colocated frontend tests (`*.test.js`), vitest for centralized backend tests (`tests/unit/fitness/*.test.mjs`), Playwright for live flow tests (not used in this plan).

**Inputs:**
- Spec: [`docs/_wip/plans/../audits/2026-05-26-guest-mode-redesign-spec.md`](./2026-05-26-guest-mode-redesign-spec.md)
- Audit: [`docs/_wip/audits/2026-05-26-guest-mode-ux-audit.md`](../audits/2026-05-26-guest-mode-ux-audit.md)
- Resolved open issues: OI-1 (backfill backward into prior honored segment), OI-2 (detect 3+ consecutive sub-T alternations as "shared device" → honor all), OI-3 (apply symmetrically to all transition types)

**Ship order:** W3 → W2 → W1. W3 is fastest (verification + small filter), W2 is localized (one file), W1 is the meaty piece (threshold rule + session-end backfill).

---

## Pre-Flight

### Task 0: Branch setup

**Step 1: Confirm clean working tree**

Run: `git status`
Expected: clean tree on `main` (or current branch).

**Step 2: Create feature branch**

Run: `git checkout -b feat/guest-mode-phase1`
Expected: switched to new branch.

**Step 3: Verify test runner works**

Run: `npx vitest run frontend/src/hooks/fitness/CadenceFilter.test.js`
Expected: PASS (any existing colocated fitness test). If it fails, troubleshoot vitest config before proceeding.

**Step 4: No commit yet** — proceed to Task 1.

---

## W3 — INACTIVE Cards Excluded From Governance

Three tasks. The whole work item is verification-first: confirm current behavior with a test, then make the filter explicit so future changes can't break it.

### Task 1: Audit current INACTIVE-governance behavior

**Files:**
- Test: `frontend/src/hooks/fitness/GovernanceEngine.inactiveFilter.test.js` (create)

**Step 1: Write the failing test**

```javascript
// frontend/src/hooks/fitness/GovernanceEngine.inactiveFilter.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

describe('GovernanceEngine — INACTIVE device filtering', () => {
  let engine;

  beforeEach(() => {
    engine = new GovernanceEngine();
    engine.configure({
      governedLabels: ['test'],
      policies: {
        default: {
          base_requirement: [{ active: 'all' }],
          challenges: []
        }
      },
      zones: [
        { id: 'cool', min: 0, coins: 0 },
        { id: 'active', min: 100, coins: 1 }
      ]
    });
    engine.setMedia({ id: 'm1', labels: ['test'] });
  });

  it('does NOT fail base requirement when an INACTIVE participant is present', () => {
    // Two participants: one active, one INACTIVE (signal gone 15s)
    const participants = [
      { id: 'alice', name: 'Alice', currentZone: 'active', isInactive: false },
      { id: 'bob',   name: 'Bob',   currentZone: 'cool',   isInactive: true, inactiveSince: Date.now() - 15000 }
    ];
    engine.evaluate({ activeParticipants: participants, zoneConfig: engine._latestInputs.zoneConfig });

    // base_requirement is "active: all". Without the filter, Bob in cool zone would fail.
    // With the filter, only Alice counts → she is active → unlocked.
    expect(engine.getState().phase).toBe('unlocked');
  });
});
```

**Step 2: Run the test to verify it FAILS or PASSES**

Run: `npx vitest run frontend/src/hooks/fitness/GovernanceEngine.inactiveFilter.test.js`

**Two possible outcomes:**
- **PASS** → INACTIVE filtering already happens upstream. Move directly to Task 2 (lock it in with explicit guard so it can't regress).
- **FAIL** (engine returns `pending` or `locked`) → INACTIVE devices DO count today. Proceed to Task 2 to fix.

Record which outcome occurred — it determines whether Task 2 is "make explicit" or "actual fix."

**Step 3: Don't proceed without recording the outcome.**

### Task 2: Make INACTIVE exclusion explicit at the governance boundary

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (find the participant-iteration site in `evaluate()`)
- Modify (alternative): `frontend/src/hooks/fitness/FitnessSession.js` (if the filter belongs upstream where `activeParticipants` is built)
- Test: `frontend/src/hooks/fitness/GovernanceEngine.inactiveFilter.test.js` (from Task 1)

**Step 1: Locate the participant iteration**

Read `GovernanceEngine.js` and find where `_latestInputs.activeParticipants` is consumed inside `evaluate()` (or whatever method iterates participants for base-requirement checks).

**Step 2: Add the explicit filter**

If iterating in the engine:
```javascript
// Before: const participants = this._latestInputs.activeParticipants || [];
// After:
const participants = (this._latestInputs.activeParticipants || []).filter(p => !p.isInactive);
```

If the upstream caller (FitnessSession) should filter before passing in: locate the `_captureLatestInputs({ activeParticipants })` call site and filter there. Pick ONE location, not both.

**Step 3: Run the test from Task 1**

Run: `npx vitest run frontend/src/hooks/fitness/GovernanceEngine.inactiveFilter.test.js`
Expected: PASS.

**Step 4: Run the full GovernanceEngine test suite to check for regression**

Run: `npx vitest run frontend/src/hooks/fitness/GovernanceEngine`
Expected: all existing tests still PASS. If any fails, the filter location is wrong or an existing test asserted the old behavior — investigate before committing.

### Task 3: Commit W3

**Step 1: Stage and commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.inactiveFilter.test.js
git add frontend/src/hooks/fitness/GovernanceEngine.js  # or FitnessSession.js
git commit -m "fitness(governance): explicit INACTIVE-device filter at evaluation boundary

INACTIVE participants (signal silent >=10s) must not count toward
'active: all' base requirements or min_participants thresholds.
Adds an explicit filter so future changes can't accidentally include them.
Per audit Decision §4 / W3 spec."
```

**Step 2: Verify**

Run: `git log -1 --stat`
Expected: one commit with the test file + one source file.

---

## W2 — Generic Guest as Device-Keyed Alias

Five tasks. Localized fix; one source change, two test cases.

### Task 4: Write failing test — two simultaneous Guests produce two distinct users

**Files:**
- Test: `frontend/src/hooks/fitness/UserManager.genericGuest.test.js` (create)

**Step 1: Write the test**

```javascript
// frontend/src/hooks/fitness/UserManager.genericGuest.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { UserManager } from './UserManager.js';

describe('UserManager — generic Guest device-keyed alias', () => {
  let manager;

  beforeEach(() => {
    manager = new UserManager();
    manager.configure({
      primary: [], family: [], friends: [],
      defaultZones: [
        { id: 'cool', min: 0, coins: 0 },
        { id: 'active', min: 100, coins: 1 }
      ]
    });
  });

  it('creates two distinct User objects when generic Guest is tagged on two devices', () => {
    // Simulate what FitnessSidebarMenu.handleAssignGuest will send after the fix:
    // a deterministic device-keyed profileId for isGeneric tags.
    manager.assignGuest('99999', 'Guest', { profileId: 'guest_48291', isGeneric: true });
    manager.assignGuest('48292', 'Guest', { profileId: 'guest_48292', isGeneric: true });

    const userA = manager.resolveUserForDevice('99999');
    const userB = manager.resolveUserForDevice('48292');

    expect(userA).toBeTruthy();
    expect(userB).toBeTruthy();
    expect(userA.id).toBe('guest_48291');
    expect(userB.id).toBe('guest_48292');
    expect(userA).not.toBe(userB); // distinct objects
  });

  it('keeps the display name as "Guest" while the internal id is device-keyed', () => {
    manager.assignGuest('99999', 'Guest', { profileId: 'guest_48291', isGeneric: true });
    const user = manager.resolveUserForDevice('99999');
    expect(user.name).toBe('Guest');
    expect(user.id).toMatch(/^guest_/);
  });
});
```

**Step 2: Run to verify it FAILS**

Run: `npx vitest run frontend/src/hooks/fitness/UserManager.genericGuest.test.js`
Expected: PASS for first test (UserManager already creates distinct users when profileIds differ — the failure case was at the MENU layer where both devices passed `'guest'`). If both tests PASS already, the UserManager side is correct and only the menu needs fixing — proceed to Task 5.

If the first test FAILS, UserManager itself needs adjustment — that's a deeper change. Stop and report; the spec assumed UserManager was correct.

### Task 5: Fix FitnessSidebarMenu to synthesize device-keyed profileId

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx` (around lines 228–231 and the `handleAssignGuest` function)

**Step 1: Locate the option construction (around line 228)**

Current code:
```javascript
if (!seen.has('guest')) {
  seen.add('guest');
  topOptions.push({
    id: 'guest',
    name: 'Guest',
    profileId: 'guest',     // ← collapses identities
    source: 'Guest',
    isGeneric: true
  });
}
```

**Step 2: Remove the shared `profileId` from the option**

```javascript
if (!seen.has('guest')) {
  seen.add('guest');
  topOptions.push({
    id: 'guest',
    name: 'Guest',
    // profileId synthesized in handleAssignGuest based on deviceId
    source: 'Guest',
    isGeneric: true
  });
}
```

**Step 3: Update `handleAssignGuest` to synthesize the profileId**

Locate `handleAssignGuest` (around line 299). Modify the metadata-building branch:

```javascript
const handleAssignGuest = (option) => {
  if (!assignGuestToDevice || !deviceIdStr) return;

  const profileId = option.isGeneric
    ? `guest_${deviceIdStr}`            // device-keyed alias for generic Guest
    : (option.profileId || option.id);  // configured users keep their own id

  assignGuestToDevice(deviceIdStr, {
    name: option.name,
    profileId,
    candidateId: option.id,
    source: option.source,
    baseUserName: baseName
  });
  onClose();
};
```

**Step 4: Run the UserManager test from Task 4**

Run: `npx vitest run frontend/src/hooks/fitness/UserManager.genericGuest.test.js`
Expected: PASS (both tests).

**Step 5: Run any existing FitnessSidebarMenu tests to check for regression**

Run: `npx vitest run frontend/src/modules/Fitness/player`
Expected: all PASS. If any test asserted the old shared `'guest'` profileId, update its assertion to expect `'guest_<deviceId>'` instead.

### Task 6: Integration test — two Guest tags produce two saved participants

**Files:**
- Test: `frontend/src/hooks/fitness/FitnessSession.genericGuestDeviceKeyed.test.js` (create)

**Step 1: Write the integration test**

```javascript
// frontend/src/hooks/fitness/FitnessSession.genericGuestDeviceKeyed.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { FitnessSession } from './FitnessSession.js';

describe('FitnessSession — two simultaneous generic Guest tags', () => {
  let session;

  beforeEach(() => {
    session = new FitnessSession();
    session.configure({
      primary: [], family: [], friends: [],
      devices: { heart_rate: {} },
      zones: [
        { id: 'cool', min: 0, coins: 0 },
        { id: 'active', min: 100, coins: 1 }
      ]
    });
  });

  it('produces two distinct participants in session summary when two devices are Guest-tagged', () => {
    // Both devices broadcast HR
    session.ingestData({ type: 'ant', profile: 'HR', deviceId: '99999', data: { ComputedHeartRate: 110 } });
    session.ingestData({ type: 'ant', profile: 'HR', deviceId: '48292', data: { ComputedHeartRate: 115 } });

    // Both tagged Guest with device-keyed profileIds (per W2 fix)
    session.assignGuestToDevice('99999', { name: 'Guest', profileId: 'guest_48291', isGeneric: true });
    session.assignGuestToDevice('48292', { name: 'Guest', profileId: 'guest_48292', isGeneric: true });

    const summary = session.summary;
    const participantIds = (summary.participants || []).map(p => p.id);
    expect(participantIds).toContain('guest_48291');
    expect(participantIds).toContain('guest_48292');
    expect(new Set(participantIds).size).toBe(participantIds.length); // no duplicates
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run frontend/src/hooks/fitness/FitnessSession.genericGuestDeviceKeyed.test.js`
Expected: PASS (W2 fix is now in place from Task 5).

**Step 3: If it fails**, investigate — likely `session.summary` builds participants from a roster that doesn't see the per-device split. Fix before continuing.

### Task 7: Commit W2

**Step 1: Stage and commit**

```bash
git add frontend/src/hooks/fitness/UserManager.genericGuest.test.js
git add frontend/src/hooks/fitness/FitnessSession.genericGuestDeviceKeyed.test.js
git add frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx
git commit -m "fitness(guest): device-keyed alias for generic Guest tag

Generic 'Guest' was collapsing all simultaneous anonymous guests into a
single shared user identity (profileId='guest'), causing series-key
collisions in the timeline and a single shared participant in saved YAML.

Fix: FitnessSidebarMenu.handleAssignGuest now synthesizes profileId as
'guest_<deviceId>' for isGeneric tags. Display name remains 'Guest'.
Two devices both tagged Guest now resolve to distinct User objects and
distinct participant entries.

Per audit Decision §2 / W2 spec."
```

**Step 2: Verify**

Run: `git log -1 --stat`

---

## W1 — Continuous-Usage Threshold + Late-Tag Merge

The meaty piece. Decomposed into 14 tasks across three subphases:

- **W1.A** (Tasks 8–11): Replace hardcoded `GRACE_PERIOD_MS` with configurable threshold
- **W1.B** (Tasks 12–15): Implement session-end backfill pass (resolves OI-1, gives late-tag merge for free)
- **W1.C** (Tasks 16–19): Cycling detection (OI-2), symmetric application verification (OI-3), telemetry, docs

### W1.A — Configurable threshold

#### Task 8: Add config field with default

**Files:**
- Modify: `data/household/config/fitness.yml`
- Modify: `backend/src/3_applications/fitness/FitnessConfigService.mjs`
- Test: `tests/unit/fitness/configThreshold.test.mjs` (create)

**Step 1: Write the failing test**

```javascript
// tests/unit/fitness/configThreshold.test.mjs
import { describe, it, expect } from 'vitest';
import { FitnessConfigService } from '../../../backend/src/3_applications/fitness/FitnessConfigService.mjs';

describe('FitnessConfigService — usage_threshold_seconds', () => {
  it('reads governance.usage_threshold_seconds from config', async () => {
    const service = new FitnessConfigService({
      configLoader: () => ({
        governance: { usage_threshold_seconds: 240 }
      })
    });
    const cfg = await service.getConfig();
    expect(cfg.governance.usage_threshold_seconds).toBe(240);
  });

  it('defaults usage_threshold_seconds to 300 when absent', async () => {
    const service = new FitnessConfigService({
      configLoader: () => ({ governance: {} })
    });
    const cfg = await service.getConfig();
    expect(cfg.governance.usage_threshold_seconds).toBe(300);
  });
});
```

**Step 2: Run to verify FAIL**

Run: `npx vitest run tests/unit/fitness/configThreshold.test.mjs`
Expected: FAIL (field doesn't exist in service yet).

**Step 3: Add to fitness.yml** (just for documentation; default kicks in if absent):

In `data/household/config/fitness.yml` under the existing `governance:` block:
```yaml
governance:
  grace_period_seconds: 30
  warning_cooldown_seconds: 30
  usage_threshold_seconds: 300  # NEW: continuous-usage threshold for participant attribution (default 300)
  superusers:
    - user-primary
  # ... existing fields
```

**Step 4: Add default + passthrough in FitnessConfigService**

In `backend/src/3_applications/fitness/FitnessConfigService.mjs`, in the method that assembles the governance config (likely `getConfig()` or `_buildGovernanceConfig()`), ensure `usage_threshold_seconds` defaults to 300:

```javascript
governance: {
  ...rawGovernance,
  usage_threshold_seconds: rawGovernance?.usage_threshold_seconds ?? 300
}
```

**Step 5: Run the test**

Run: `npx vitest run tests/unit/fitness/configThreshold.test.mjs`
Expected: PASS (both cases).

#### Task 9: Plumb threshold through to FitnessContext → GuestAssignmentService

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx` (find where governance config is passed into session.configure)
- Modify: `frontend/src/hooks/fitness/GuestAssignmentService.js` constructor (accept threshold)
- Test: `frontend/src/hooks/fitness/GuestAssignmentService.threshold.test.js` (create)

**Step 1: Write the failing test**

```javascript
// frontend/src/hooks/fitness/GuestAssignmentService.threshold.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GuestAssignmentService } from './GuestAssignmentService.js';

describe('GuestAssignmentService — configurable threshold', () => {
  it('uses constructor-provided threshold instead of hardcoded 60s', () => {
    const service = new GuestAssignmentService({
      thresholdMs: 5 * 60 * 1000  // 5 min
    });
    expect(service.thresholdMs).toBe(300000);
  });

  it('defaults thresholdMs to 60000 if not provided (back-compat for tests)', () => {
    const service = new GuestAssignmentService({});
    expect(service.thresholdMs).toBe(60000);
  });
});
```

**Step 2: Run to verify FAIL**

Run: `npx vitest run frontend/src/hooks/fitness/GuestAssignmentService.threshold.test.js`
Expected: FAIL.

**Step 3: Modify GuestAssignmentService constructor**

In `GuestAssignmentService.js`, at the top of the class:

```javascript
class GuestAssignmentService {
  constructor(opts = {}) {
    // ... existing assignments
    this.thresholdMs = Number.isFinite(opts.thresholdMs) ? opts.thresholdMs : 60 * 1000;
  }
}
```

The module-level `const GRACE_PERIOD_MS = 60 * 1000` stays for now (still referenced by other code paths in this file); Task 10 swaps over.

**Step 4: Run the test**

Run: `npx vitest run frontend/src/hooks/fitness/GuestAssignmentService.threshold.test.js`
Expected: PASS.

**Step 5: Wire up the plumbing in FitnessContext**

In `FitnessContext.jsx`, locate where `session` and its subsystems are instantiated (look for `new FitnessSession`, `session.configure`, or similar). Pass the threshold:

```javascript
// Wherever GuestAssignmentService is constructed, pass:
new GuestAssignmentService({
  thresholdMs: (config?.governance?.usage_threshold_seconds ?? 300) * 1000,
  // ... existing options
})
```

The exact construction site may live in FitnessSession.js — search for `GuestAssignmentService` in that file too and pass through.

#### Task 10: Replace `GRACE_PERIOD_MS` usage with `this.thresholdMs`

**Files:**
- Modify: `frontend/src/hooks/fitness/GuestAssignmentService.js:12` and line 131

**Step 1: Write the boundary test**

```javascript
// Append to frontend/src/hooks/fitness/GuestAssignmentService.threshold.test.js
it('triggers transfer when previous segment duration < threshold', () => {
  const service = new GuestAssignmentService({ thresholdMs: 60000 });
  // Use the same setup pattern as existing GuestAssignmentService tests
  // (mock ledger, session, eventJournal as needed) and assert that
  // assignGuest with previousDuration=59000 sets isGracePeriodTransfer=true.
  // ... see existing assignGuest tests in repo for setup pattern
});

it('triggers drop when previous segment duration >= threshold', () => {
  const service = new GuestAssignmentService({ thresholdMs: 60000 });
  // assignGuest with previousDuration=60001 sets isGracePeriodTransfer=false.
});
```

If `GuestAssignmentService` has no existing test file with a setup pattern, write minimal mocks inline. Reference any sibling `*.test.js` for shape.

**Step 2: Run to verify FAIL** (or PASS if the line-131 swap is needed first):

Run: `npx vitest run frontend/src/hooks/fitness/GuestAssignmentService.threshold.test.js`

**Step 3: Replace the constant usage at line 131**

```javascript
// Before:
isGracePeriodTransfer = previousDuration < GRACE_PERIOD_MS && hasTransferableSource;
// After:
isGracePeriodTransfer = previousDuration < this.thresholdMs && hasTransferableSource;
```

Delete the module-level `const GRACE_PERIOD_MS = 60 * 1000;` at line 12.

**Step 4: Run the test**

Run: `npx vitest run frontend/src/hooks/fitness/GuestAssignmentService`
Expected: all tests PASS.

#### Task 11: Commit W1.A

**Step 1: Stage and commit**

```bash
git add data/household/config/fitness.yml
git add backend/src/3_applications/fitness/FitnessConfigService.mjs
git add tests/unit/fitness/configThreshold.test.mjs
git add frontend/src/hooks/fitness/GuestAssignmentService.js
git add frontend/src/hooks/fitness/GuestAssignmentService.threshold.test.js
git add frontend/src/context/FitnessContext.jsx
git add frontend/src/hooks/fitness/FitnessSession.js  # if touched for plumbing
git commit -m "fitness(threshold): configurable continuous-usage threshold (W1.A)

Replaces hardcoded GRACE_PERIOD_MS = 60s with configurable
governance.usage_threshold_seconds (fitness.yml, default 300).

Plumbed from FitnessConfigService → FitnessContext → GuestAssignmentService
constructor. The next subphase (W1.B) adds the session-end backfill pass
that makes late-tagged Pikachus auto-merge using this same threshold.

Per audit Decision §7 / W1 spec."
```

### W1.B — Session-end backfill pass

#### Task 12: Test — late-tagged Pikachu merges at session save (OI-1 backward backfill)

**Files:**
- Test: `frontend/src/hooks/fitness/PersistenceManager.lateTagMerge.test.js` (create)

**Step 1: Write the failing test**

```javascript
// frontend/src/hooks/fitness/PersistenceManager.lateTagMerge.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { FitnessSession } from './FitnessSession.js';

describe('PersistenceManager — late-tag Pikachu merge (W1.B / OI-1)', () => {
  let session;
  beforeEach(() => {
    session = new FitnessSession();
    session.configure({
      primary: [], family: [],
      friends: [{ id: 'friend-c', name: 'Friend C' }],
      devices: { heart_rate: {} },
      governance: { usage_threshold_seconds: 300 },
      zones: [{ id: 'active', min: 100, coins: 1 }]
    });
  });

  it('merges a 10-min Pikachu segment into a 5-min tagged-Friend C segment when Friend C is tagged late', () => {
    const t0 = Date.now();
    // 10 min of Pikachu HR data
    for (let i = 0; i < 120; i++) {  // 120 readings at 5s intervals = 10 min
      session.ingestData({
        type: 'ant', profile: 'HR', deviceId: '99999',
        data: { ComputedHeartRate: 130 }, timestamp: t0 + i * 5000
      });
    }
    // Late tag: assign Friend C at t0 + 10min (well past 5-min threshold for the Pikachu segment)
    session.assignGuestToDevice('99999', {
      name: 'Friend C', profileId: 'friend-c', candidateId: 'friend-c', source: 'Friend',
      baseUserName: null
    }, { now: t0 + 600000 });
    // 5 min of Friend C HR data
    for (let i = 0; i < 60; i++) {
      session.ingestData({
        type: 'ant', profile: 'HR', deviceId: '99999',
        data: { ComputedHeartRate: 140 }, timestamp: t0 + 600000 + i * 5000
      });
    }
    // Save (or get summary)
    const summary = session.summary;
    const participantIds = (summary.participants || []).map(p => p.id);

    // Pikachu segment (10 min) is the final-without-next case → backfills BACKWARD into Friend C per OI-1.
    // Wait: Pikachu is FIRST, Friend C is SECOND. So Pikachu segment ends when Friend C tagged.
    // Pikachu duration was 10 min (>= 5 min threshold), so it SHOULD be honored — but Decision §5
    // says late tagging means "I'm telling you now who this was" → merge.
    // Per spec: late-tag merge IS the special case that forces forward absorption regardless of duration.
    // → Saved YAML has ONLY Friend C, with full 15 min of data.
    expect(participantIds).toContain('friend-c');
    expect(participantIds).not.toContain('#99999');
    expect(participantIds.filter(id => id.startsWith('#') || id.includes('99999'))).toEqual([]);
  });
});
```

**Step 2: Run to verify FAIL**

Run: `npx vitest run frontend/src/hooks/fitness/PersistenceManager.lateTagMerge.test.js`
Expected: FAIL — currently produces both `#99999` Pikachu and `friend-c` in summary.

#### Task 13: Implement session-end backfill in PersistenceManager

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js` (specifically `_buildParticipantsForPersist` / `buildSessionSummary` path)
- Read first: `frontend/src/hooks/fitness/EventJournal.js` (to confirm ASSIGN_GUEST event shape)
- Read first: `frontend/src/hooks/fitness/SessionEntity.js` (for entity shape)

**Step 1: Read the existing build path**

Read `PersistenceManager.js` lines 159-199 (the `safeRoster.forEach` block) and `buildSessionSummary.js` (if separate). Understand the current shape of the participants array before mutating.

**Step 2: Design the backfill algorithm**

Pseudocode:
```
buildSegmentsPerDevice(eventJournal, sessionStart, sessionEnd):
  for each deviceId:
    extract ASSIGN_GUEST, GUEST_REPLACED, GRACE_PERIOD_TRANSFER events in order
    produce list of (occupantId, startTime, endTime) segments
    each segment: endTime = next assignment's timestamp, OR sessionEnd

applyBackfillRule(segments, thresholdMs):
  // Pass 1: detect cycling (OI-2) — handled in Task 14
  // Pass 2: forward absorption for sub-threshold segments
  for i from 0 to len(segments)-1:
    if segments[i].duration < thresholdMs:
      if i + 1 < len(segments):
        # absorb forward into next segment
        mergeSegments(segments[i], segments[i+1])
        delete segments[i]
      else:
        # OI-1: final segment with no next — backfill BACKWARD into prior honored
        priorHonored = find last segment before i that wasn't absorbed
        if priorHonored:
          mergeSegments(segments[i], priorHonored)
          delete segments[i]
        # else: keep as-is (no prior honored to absorb into)

  return segments

buildParticipantsFromSegments(segments):
  collapse by occupantId, sum/concat their data
```

**Step 3: Implement in `PersistenceManager.js`**

Add a new method `_resolveSegmentsForPersist(rosterSeed)` that walks `session.eventJournal.events` filtered by type, builds per-device segment lists, applies the backfill rule, and returns a deduplicated roster.

Replace the line 159-199 forEach with one that iterates the resolved segments instead of `safeRoster`.

For series transfer at save time, reuse the existing `FitnessTimeline.transferUserSeries` helper to move sub-threshold occupants' series into their absorber.

**Step 4: Run the test from Task 12**

Run: `npx vitest run frontend/src/hooks/fitness/PersistenceManager.lateTagMerge.test.js`
Expected: PASS.

**Step 5: Run all persistence tests**

Run: `npx vitest run frontend/src/hooks/fitness/PersistenceManager`
Run: `npx vitest run tests/unit/fitness/persistence`
Expected: all PASS.

#### Task 14: Test + implement cycling detection (OI-2)

**Files:**
- Test: `frontend/src/hooks/fitness/PersistenceManager.cyclingDetection.test.js` (create)
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js` (the backfill rule's Pass 1)

**Step 1: Write the failing test**

```javascript
// frontend/src/hooks/fitness/PersistenceManager.cyclingDetection.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { FitnessSession } from './FitnessSession.js';

describe('PersistenceManager — cycling/turn-taking detection (W1 / OI-2)', () => {
  it('honors all segments when 3+ consecutive sub-T alternations between 2 occupants are detected', () => {
    const session = new FitnessSession();
    session.configure({
      primary: [], family: [],
      friends: [
        { id: 'alice', name: 'Alice' },
        { id: 'bob',   name: 'Bob'   }
      ],
      devices: { heart_rate: {} },
      governance: { usage_threshold_seconds: 300 },  // 5 min
      zones: [{ id: 'active', min: 100, coins: 1 }]
    });
    const t0 = Date.now();
    // Alice-Bob-Alice-Bob-Alice, each 2-min, on device #99999
    for (let seg = 0; seg < 5; seg++) {
      const occupantId = seg % 2 === 0 ? 'alice' : 'bob';
      const occupantName = seg % 2 === 0 ? 'Alice' : 'Bob';
      session.assignGuestToDevice('99999', {
        name: occupantName, profileId: occupantId, candidateId: occupantId
      }, { now: t0 + seg * 120000 });
      // 24 readings of HR data per 2-min segment
      for (let i = 0; i < 24; i++) {
        session.ingestData({
          type: 'ant', profile: 'HR', deviceId: '99999',
          data: { ComputedHeartRate: 120 + seg }, timestamp: t0 + seg * 120000 + i * 5000
        });
      }
    }
    const summary = session.summary;
    const participantIds = (summary.participants || []).map(p => p.id);
    // Cycling detected → both Alice and Bob honored despite each segment being sub-T
    expect(participantIds).toContain('alice');
    expect(participantIds).toContain('bob');
  });
});
```

**Step 2: Run to verify FAIL**

Run: `npx vitest run frontend/src/hooks/fitness/PersistenceManager.cyclingDetection.test.js`
Expected: FAIL — without detection, last Alice segment absorbs the preceding Bob, which absorbs Alice, etc. → only the final occupant survives.

**Step 3: Add Pass 1 (cycling detection) to the backfill algorithm**

In `PersistenceManager.js`, before the forward-absorption loop:

```javascript
function detectCyclingSegments(segments) {
  // Find runs of 3+ consecutive sub-T segments where occupants alternate among 2+ distinct people
  // Mark those runs as "honored" (skip the absorb pass)
  for (let i = 0; i + 2 < segments.length; i++) {
    const run = [segments[i]];
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[j].duration >= thresholdMs) break;
      run.push(segments[j]);
    }
    if (run.length >= 3) {
      const distinctOccupants = new Set(run.map(s => s.occupantId));
      if (distinctOccupants.size >= 2) {
        run.forEach(s => { s.honored = true; });  // skip in absorb pass
        i += run.length - 1;
      }
    }
  }
}
```

Then in the absorb loop, skip any segment marked `honored: true`.

**Step 4: Run the test**

Run: `npx vitest run frontend/src/hooks/fitness/PersistenceManager.cyclingDetection.test.js`
Expected: PASS.

**Step 5: Run all PersistenceManager tests**

Run: `npx vitest run frontend/src/hooks/fitness/PersistenceManager`
Expected: all PASS, including Task 12's late-tag merge.

#### Task 15: Commit W1.B

**Step 1: Stage and commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js
git add frontend/src/hooks/fitness/PersistenceManager.lateTagMerge.test.js
git add frontend/src/hooks/fitness/PersistenceManager.cyclingDetection.test.js
git commit -m "fitness(threshold): session-end backfill pass (W1.B)

Adds a save-time pass over per-device segments that absorbs sub-threshold
segments forward into the next occupant (OI-3 symmetric), or backward into
the prior honored segment if the short segment is the final one (OI-1).

Detects cycling/turn-taking (3+ consecutive sub-T segments alternating
between 2+ occupants) and honors all of them (OI-2 — 'shared device' case).

Late-tagged Pikachu merge falls out automatically: a Pikachu segment
followed by a tagged segment is treated as a short-pre-tag absorb regardless
of nominal duration (per Decision §5).

Per audit Decision §7 / W1.B spec, OI-1, OI-2, OI-3 resolutions."
```

### W1.C — Verification, telemetry, docs

#### Task 16: Test + verify symmetric application (OI-3)

**Files:**
- Test: `frontend/src/hooks/fitness/PersistenceManager.symmetricTransitions.test.js` (create)

**Step 1: Write the test**

```javascript
// frontend/src/hooks/fitness/PersistenceManager.symmetricTransitions.test.js
import { describe, it, expect } from 'vitest';
import { FitnessSession } from './FitnessSession.js';

describe('PersistenceManager — symmetric threshold application (W1 / OI-3)', () => {
  it('applies the threshold to Mapped→Mapped transitions (e.g. User B→User A swap)', () => {
    const session = new FitnessSession();
    session.configure({
      primary: [
        { id: 'user-b', name: 'User B', hr: 22222 },
        { id: 'user-a', name: 'User A', hr: 11111 }
      ],
      family: [], friends: [],
      devices: { heart_rate: { 22222: 'user-b' } },  // device starts mapped to user-b
      governance: { usage_threshold_seconds: 300 },
      zones: [{ id: 'active', min: 100, coins: 1 }]
    });
    const t0 = Date.now();
    // 30s of User B on device #22222
    for (let i = 0; i < 6; i++) {
      session.ingestData({
        type: 'ant', profile: 'HR', deviceId: '22222',
        data: { ComputedHeartRate: 130 }, timestamp: t0 + i * 5000
      });
    }
    // Reassign to User A (Mapped→Mapped via guest menu)
    session.assignGuestToDevice('22222', {
      name: 'User A', profileId: 'user-a', candidateId: 'user-a', baseUserName: 'User B'
    }, { now: t0 + 30000 });
    // 10 min of User A
    for (let i = 0; i < 120; i++) {
      session.ingestData({
        type: 'ant', profile: 'HR', deviceId: '22222',
        data: { ComputedHeartRate: 135 }, timestamp: t0 + 30000 + i * 5000
      });
    }
    const summary = session.summary;
    const participantIds = (summary.participants || []).map(p => p.id);
    // User B segment (30s) is sub-T → absorbed forward into User A
    expect(participantIds).toContain('user-a');
    expect(participantIds).not.toContain('user-b');
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run frontend/src/hooks/fitness/PersistenceManager.symmetricTransitions.test.js`

**Expected:** PASS (the W1.B backfill pass is occupant-agnostic — it doesn't check whether the previous occupant was a mapped user or a guest, just whether the segment was sub-T).

**Step 3: If it FAILS**, the backfill rule in Task 13 has an unwanted "only guest transitions" check — remove it.

#### Task 17: Rename telemetry events (optional but recommended)

**Files:**
- Modify: `frontend/src/hooks/fitness/GuestAssignmentService.js` (event emission sites around lines 135, 161)
- Update any consumers / log dashboards that read these event names (search the codebase)

**Step 1: Search for current event names**

Run: `grep -rn "GRACE_PERIOD_TRANSFER\|GUEST_REPLACED" frontend backend tests`

Record findings. If consumers exist (analytics, dashboards), DO NOT rename — leave events as-is. If only the service emits them, rename is safe.

**Step 2: Decide based on findings**

If no consumers found beyond the service itself: rename `GRACE_PERIOD_TRANSFER` → `SEGMENT_ABSORBED`, add `thresholdMs` field to payload. Keep `GUEST_REPLACED` as-is (the semantic still holds for the post-T case).

If consumers found: skip rename. Add `thresholdMs` to existing `GRACE_PERIOD_TRANSFER` payload only.

**Step 3: If renaming, update emission**

```javascript
// Around line 135 in GuestAssignmentService.js:
this.#logEvent('SEGMENT_ABSORBED', {
  deviceId: key,
  previousOccupantId,
  previousOccupantName: previousEntry.occupantName || previousEntry.metadata?.name,
  previousEntityId,
  previousDurationMs: previousDuration,
  thresholdMs: this.thresholdMs,  // NEW
  newOccupantId,
  newOccupantName: value.name,
  transferType: previousEntityId ? 'entity-to-entity' : 'user-to-entity'
});
```

#### Task 18: Update docs

**Files:**
- Modify: `docs/reference/fitness/assign-guest.md` (the Constraint Summary and Grace Period sections)
- Modify: `docs/reference/fitness/guest-mode.md` (the "Downstream Effects" and lifecycle table)
- Modify: `docs/reference/fitness/unknown-hr-monitors.md` (the "Mid-Session Identity Changes" section — late-tag merge now automatic)

**Step 1: Search for "grace period" / "60 seconds" / "1 minute" in those docs**

Run: `grep -n -i "grace period\|60 seconds\|1 minute\|60s grace" docs/reference/fitness/*.md`

**Step 2: Update each occurrence**

Replace "60-second grace window" / "1 min grace" with "continuous-usage threshold (`governance.usage_threshold_seconds`, default 5 min)". Reference `assign-guest.md` for full details.

**Step 3: In `assign-guest.md`** add a new section "Continuous-Usage Threshold" that describes:
- The configurable `usage_threshold_seconds` field
- The forward-absorption rule for sub-T segments
- The OI-1 backward-absorption rule for the final segment
- The OI-2 cycling detection
- The OI-3 symmetric application (covers Mapped→Mapped too)

#### Task 19: Commit W1.C and final integration check

**Step 1: Run the full fitness test suite**

Run: `npx vitest run frontend/src/hooks/fitness`
Run: `npx vitest run tests/unit/fitness`
Expected: all PASS.

**Step 2: Stage and commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.symmetricTransitions.test.js
git add frontend/src/hooks/fitness/GuestAssignmentService.js  # if telemetry renamed
git add docs/reference/fitness/assign-guest.md
git add docs/reference/fitness/guest-mode.md
git add docs/reference/fitness/unknown-hr-monitors.md
git commit -m "fitness(threshold): symmetric verification, telemetry, docs (W1.C)

- Verifies W1.B backfill rule applies symmetrically to Mapped→Mapped
  transitions (OI-3), not just guest reassignments.
- Updates GRACE_PERIOD_TRANSFER event payload with thresholdMs field
  [or renames to SEGMENT_ABSORBED — pending Task 17 consumer-search].
- Updates fitness reference docs to describe the new continuous-usage
  threshold model and OI-1/OI-2/OI-3 rules.

Per audit Decision §7 / W1.C spec."
```

**Step 3: Verify branch state**

Run: `git log --oneline main..HEAD`
Expected: 5 commits (W3, W2, W1.A, W1.B, W1.C).

---

## Post-Implementation Checklist

After all tasks complete, verify the following before declaring Phase 1 done:

- [ ] All new tests pass: `npx vitest run frontend/src/hooks/fitness && npx vitest run tests/unit/fitness`
- [ ] Existing fitness tests still pass (no regression)
- [ ] `fitness.yml` has `governance.usage_threshold_seconds: 300` documented even if relying on default
- [ ] Backend container is restarted to pick up the new config field (`docker restart {env.docker_container}`)
- [ ] Reference docs updated (assign-guest.md, guest-mode.md, unknown-hr-monitors.md)
- [ ] No console warnings about deprecated event names if telemetry was renamed
- [ ] Run a live smoke session: assign generic Guest on two devices simultaneously; verify two cards, two distinct identities, two participants in saved YAML

---

## Out of Scope (Deferred to Phase 2/3)

- W4 (HR device color visibility — Pikachu disambiguation)
- W5 (UX state model fixes — Original-fallback, error feedback, etc.)
- W6 (Pre-session participant lobby)
- W7 (In-app config writeback)
- W8 (Silent-swap detection)

These have their own work items in the [redesign spec](./2026-05-26-guest-mode-redesign-spec.md) and will be planned separately.

---

## Open Issues — Resolved (locked in this plan)

- **OI-1** (final segment with no next user) → backfill BACKWARD into prior honored segment
- **OI-2** (cycling/turn-taking with all-sub-T segments) → detect 3+ consecutive sub-T alternations between 2+ occupants, honor all
- **OI-3** (transition-type symmetry) → apply to ALL transitions (Mapped→Guest, Guest→Mapped, Mapped→Mapped, Guest→Guest)

These are baked into the W1.B/W1.C tasks. Changing them post-implementation requires re-doing the backfill algorithm.
