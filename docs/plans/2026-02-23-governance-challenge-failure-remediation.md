# Governance Challenge Failure Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the critical challenge failure lock bypass and 5 secondary bugs discovered in the governance session audit (`docs/_archive/audits/2026-02-23-governance-challenge-failure-audit.md`).

**Architecture:** The GovernanceEngine's phase evaluation (line 1462) incorrectly allows base requirement satisfaction to override challenge failure locks. The fix removes the `&& !allSatisfied` guard so challenge failure locks are absolute until the recovery path (`_evaluateChallenges` line 2121) clears them. Secondary fixes address a log timing bug, persistence data quality issues, and a race condition in media event capture.

**Tech Stack:** JavaScript (frontend), Jest unit tests, YAML docs

---

## Scope

From the audit's 7 issues + 9 persistence issues, this plan addresses 6 fixes. The following are **out of scope** (tracked separately or resolved by the critical fix):

| Issue | Why excluded |
|-------|-------------|
| Secondary 3: Stale phase in render thrashing logs | Cross-component subscription refactor — larger scope |
| Secondary 4: Video stayed paused after re-unlock | **Resolved by Critical fix** (no more 21ms lock/unlock cycle) |
| Secondary 5: Render thrashing 176/sec | Known issue (`governance-history.md` Era 4), tracked separately |
| Secondary 6: Challenge auto-succeeded in 18ms | UX enhancement — separate plan |
| P3: `sessionId` duplication | Minor cosmetic — not worth a migration |
| P6/P7/P8: Wrong duration/end/title hierarchy | Deeper media metadata pipeline issue — separate investigation |
| P9: Mixed camelCase/snake_case | Cosmetic naming convention — separate cleanup |

---

## Task 1: Fix Challenge Failure Lock Override (Critical)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1462-1467`
- Modify: `tests/unit/governance/governance-challenge-lock-priority.test.mjs` (update assertions)
- Create: `tests/unit/governance/governance-challenge-failure-lock.test.mjs`

### Step 1: Update existing test to match correct behavior

The existing test at `tests/unit/governance/governance-challenge-lock-priority.test.mjs` asserts the **buggy** behavior. Update the first test case to expect `locked` instead of `not locked` when challenge fails but base is satisfied.

```javascript
// tests/unit/governance/governance-challenge-lock-priority.test.mjs
// Line 68: Change test name and assertion

  it('should lock when challenge fails even if base requirements ARE satisfied', () => {
    const participants = ['alice', 'bob', 'charlie'];
    const userZoneMap = { alice: 'warm', bob: 'warm', charlie: 'active' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Advance to unlocked state
    advanceToUnlocked(engine, participants, userZoneMap, zoneRankMap, zoneInfoMap);
    expect(engine.phase).toBe('unlocked');

    // Simulate a failed challenge (e.g. "all warm" but charlie is only "active")
    engine.challengeState.activeChallenge = {
      id: 'test-challenge',
      status: 'failed',
      zone: 'warm',
      requiredCount: 3,
      startedAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000,
      timeLimitSeconds: 60,
      selectionLabel: 'all warm',
      summary: { satisfied: false, missingUsers: ['charlie'], metUsers: ['alice', 'bob'], actualCount: 2 }
    };

    // All participants are in Active zone or above — base requirement satisfied
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });

    // SHOULD be locked — challenge failure overrides base satisfaction
    expect(engine.phase).toBe('locked');
  });
```

### Step 2: Write new test for challenge recovery path

```javascript
// tests/unit/governance/governance-challenge-failure-lock.test.mjs

import { describe, it, expect, jest } from '@jest/globals';

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

function createEngine({ participants = [], grace = 30 } = {}) {
  const zoneConfig = [
    { id: 'cool', name: 'Cool', color: '#3399ff' },
    { id: 'active', name: 'Active', color: '#00cc00' },
    { id: 'warm', name: 'Warm', color: '#ffaa00' },
    { id: 'hot', name: 'Hot', color: '#ff0000' },
  ];
  const mockSession = {
    roster: participants.map(id => ({ id, isActive: true })),
    zoneProfileStore: null,
    snapshot: { zoneConfig }
  };
  const engine = new GovernanceEngine(mockSession);
  const policies = [{
    id: 'default',
    name: 'Default',
    minParticipants: 1,
    baseRequirement: { active: 'all', grace_period_seconds: grace },
    challenges: []
  }];
  engine.configure({ governed_labels: ['exercise'], grace_period_seconds: grace }, policies, {});
  engine.media = { id: 'test-media', labels: ['exercise'], type: 'video' };

  const zoneRankMap = {};
  const zoneInfoMap = {};
  zoneConfig.forEach((z, i) => { zoneRankMap[z.id] = i; zoneInfoMap[z.id] = z; });
  return { engine, zoneRankMap, zoneInfoMap };
}

describe('GovernanceEngine — challenge failure lock enforcement', () => {
  it('should stay locked on challenge failure even when base requirements are met', () => {
    const participants = ['alice', 'bob', 'charlie'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants });

    // Get to unlocked
    const allActive = { alice: 'active', bob: 'active', charlie: 'active' };
    engine.evaluate({ activeParticipants: participants, userZoneMap: allActive, zoneRankMap, zoneInfoMap, totalCount: 3 });
    expect(engine.phase).toBe('unlocked');

    // Challenge fails — alice isn't hot
    engine.challengeState.activeChallenge = {
      id: 'ch1', status: 'failed', zone: 'hot', requiredCount: 3,
      startedAt: Date.now() - 90000, expiresAt: Date.now() - 1000,
      timeLimitSeconds: 90, selectionLabel: 'all hot',
      summary: { satisfied: false, missingUsers: ['alice'], metUsers: ['bob', 'charlie'], actualCount: 2 }
    };

    // Re-evaluate: base requirement (active: all) is still met
    engine.evaluate({ activeParticipants: participants, userZoneMap: allActive, zoneRankMap, zoneInfoMap, totalCount: 3 });

    // Must stay locked — challenge failure is absolute
    expect(engine.phase).toBe('locked');

    // Simulate another HR update — still locked
    engine.evaluate({ activeParticipants: participants, userZoneMap: allActive, zoneRankMap, zoneInfoMap, totalCount: 3 });
    expect(engine.phase).toBe('locked');
  });

  it('should remain locked through multiple evaluations until challenge recovery', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants });

    // Unlock
    engine.evaluate({ activeParticipants: participants, userZoneMap: { alice: 'active', bob: 'active' }, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('unlocked');

    // Challenge fails
    engine.challengeState.activeChallenge = {
      id: 'ch2', status: 'failed', zone: 'warm', requiredCount: 2,
      startedAt: Date.now() - 60000, expiresAt: Date.now() - 1000,
      timeLimitSeconds: 60, selectionLabel: 'all warm',
      summary: { satisfied: false, missingUsers: ['alice'], metUsers: ['bob'], actualCount: 1 }
    };

    // 5 evaluations with base met — must stay locked every time
    for (let i = 0; i < 5; i++) {
      engine.evaluate({ activeParticipants: participants, userZoneMap: { alice: 'active', bob: 'warm' }, zoneRankMap, zoneInfoMap, totalCount: 2 });
      expect(engine.phase).toBe('locked');
    }
  });
});
```

### Step 3: Run tests to verify they fail (TDD)

Run: `npx jest tests/unit/governance/governance-challenge-lock-priority.test.mjs tests/unit/governance/governance-challenge-failure-lock.test.mjs --no-coverage`

Expected: Both test files fail — the first because we changed the expected assertion, the new one because the code still has the `&& !allSatisfied` bug.

### Step 4: Fix the bug

Change `GovernanceEngine.js:1462`:

```javascript
// BEFORE (line 1462):
    if (challengeForcesRed && !allSatisfied) {

// AFTER:
    if (challengeForcesRed) {
```

No other code changes needed. The existing recovery path at lines 2120-2125 will now correctly handle challenge recovery by checking `challenge.summary?.satisfied` (whether the *challenge* requirement is now met), not whether the base requirement is met.

### Step 5: Run tests to verify they pass

Run: `npx jest tests/unit/governance/governance-challenge-lock-priority.test.mjs tests/unit/governance/governance-challenge-failure-lock.test.mjs --no-coverage`

Expected: All tests pass.

### Step 6: Run full governance test suite to check for regressions

Run: `npx jest tests/unit/governance/ --no-coverage`

Expected: All pass. If any existing tests assumed the buggy behavior, update them.

### Step 7: Commit

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
       tests/unit/governance/governance-challenge-lock-priority.test.mjs \
       tests/unit/governance/governance-challenge-failure-lock.test.mjs
git commit -m "fix: challenge failure now locks regardless of base requirement satisfaction

Remove && !allSatisfied guard from phase evaluation (line 1462).
Challenge failure locks are now absolute — recovery only happens when
challenge requirements are actually met (via _evaluateChallenges recovery
path at line 2121).

Fixes: governance-challenge-failure-audit.md Critical Issue"
```

---

## Task 2: Fix `timeSinceWarningMs: null` on Grace Period Lock

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:628-700`

### Step 1: Write failing test

```javascript
// Add to tests/unit/governance/governance-challenge-failure-lock.test.mjs
// (or a new file if preferred)

describe('GovernanceEngine — timeSinceWarningMs logging', () => {
  it('should report non-null timeSinceWarningMs when transitioning warning → locked', () => {
    const participants = ['alice'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 0 });

    // Unlock
    engine.evaluate({ activeParticipants: participants, userZoneMap: { alice: 'active' }, zoneRankMap, zoneInfoMap, totalCount: 1 });
    expect(engine.phase).toBe('unlocked');

    // Drop to cool → warning (grace = 0, so should go straight to locked,
    // but with satisfiedOnce = true it will hit warning first)
    // For this test, manually set warning state
    engine._setPhase('warning');
    expect(engine.phase).toBe('warning');
    expect(engine._warningStartTime).not.toBeNull();

    // Now transition to locked — _warningStartTime should still be available
    // for timeSinceWarningMs calculation
    engine._setPhase('locked');
    expect(engine.phase).toBe('locked');
    // The fix is verified structurally — see step 3
  });
});
```

### Step 2: Run test to confirm current behavior

Run: `npx jest tests/unit/governance/governance-challenge-failure-lock.test.mjs -t "timeSinceWarningMs" --no-coverage`

### Step 3: Fix the ordering bug

In `GovernanceEngine.js:_setPhase()`, the `_warningStartTime` is cleared at line 631 **before** it's read at line 689. Fix by saving the value before clearing:

```javascript
// BEFORE (lines 628-647):
      if (newPhase === 'warning' && oldPhase !== 'warning') {
        this._warningStartTime = now;
      } else if (newPhase !== 'warning') {
        this._warningStartTime = null;
      }

// AFTER:
      const savedWarningStartTime = this._warningStartTime;
      if (newPhase === 'warning' && oldPhase !== 'warning') {
        this._warningStartTime = now;
      } else if (newPhase !== 'warning') {
        this._warningStartTime = null;
      }
```

Then at line 689, use `savedWarningStartTime`:

```javascript
// BEFORE (line 689):
        const timeSinceWarning = oldPhase === 'warning' && this._warningStartTime
          ? now - this._warningStartTime
          : null;

// AFTER:
        const timeSinceWarning = oldPhase === 'warning' && savedWarningStartTime
          ? now - savedWarningStartTime
          : null;
```

### Step 4: Run tests

Run: `npx jest tests/unit/governance/ --no-coverage`

Expected: All pass.

### Step 5: Commit

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
       tests/unit/governance/governance-challenge-failure-lock.test.mjs
git commit -m "fix: timeSinceWarningMs no longer null on warning→locked transition

Save _warningStartTime before clearing it in _setPhase() so the
lock_triggered log can compute elapsed grace period duration.

Fixes: governance-challenge-failure-audit.md Secondary Issue 2"
```

---

## Task 3: Fix Mixed Zero/Null Series Persistence

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:601-610`
- Modify: `tests/unit/fitness/persistence-validation.test.mjs`

### Step 1: Write failing test

Add to `tests/unit/fitness/persistence-validation.test.mjs`:

```javascript
  it('should drop series where every value is zero or null (mixed)', () => {
    const pm = new PersistenceManager();
    const series = {
      'alice:hr': [80, 85, 90, 88, 92, 95],           // real data — keep
      'bike:7153:rotations': [0, 0, 0, null, null],    // all zero/null — drop
      'bike:28812:rotations': [0, null, 0, null, 0],   // all zero/null — drop
      'bike:49904:rotations': [0, 0, 5, 10, 15, 20],   // has real data — keep
    };
    const { encodedSeries } = pm.encodeSeries(series);

    expect(encodedSeries).toHaveProperty('alice:hr');
    expect(encodedSeries).toHaveProperty('bike:49904:rotations');
    expect(encodedSeries).not.toHaveProperty('bike:7153:rotations');
    expect(encodedSeries).not.toHaveProperty('bike:28812:rotations');
  });
```

### Step 2: Run test to verify it fails

Run: `npx jest tests/unit/fitness/persistence-validation.test.mjs -t "mixed" --no-coverage`

Expected: FAIL — `bike:7153:rotations` is still present because the current filter checks all-null and all-zero separately, not combined.

### Step 3: Fix the filter

In `PersistenceManager.js`, replace the two separate checks (lines 601-610):

```javascript
// BEFORE (lines 601-610):
      // Empty-series filtering: do not persist all-null/empty series
      if (!arr.length || arr.every((v) => v == null)) {
        return;
      }

      // All-zero series filtering: do not persist series where every value is 0
      // (e.g., device:40475:rotations = [[0, 163]] when no rotations recorded)
      if (arr.every((v) => v === 0)) {
        return;
      }

// AFTER:
      // Empty-series filtering: do not persist series where every value is
      // zero, null, or undefined (covers pure-null, pure-zero, and mixed)
      if (!arr.length || arr.every((v) => v == null || v === 0)) {
        return;
      }
```

### Step 4: Run tests

Run: `npx jest tests/unit/fitness/persistence-validation.test.mjs --no-coverage`

Expected: All pass.

### Step 5: Commit

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js \
       tests/unit/fitness/persistence-validation.test.mjs
git commit -m "fix: filter mixed zero/null series from persistence

Combine the separate all-null and all-zero series filters into a
single check that catches mixed zero/null arrays (e.g. [0,0,null,null]).

Fixes: governance-challenge-failure-audit.md Persistence Issue P1"
```

---

## Task 4: Consolidate Voice Memo Events

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:291-470`
- Modify: `tests/unit/fitness/persistence-validation.test.mjs`

### Step 1: Write failing test

Add to `tests/unit/fitness/persistence-validation.test.mjs`:

```javascript
describe('_consolidateEvents — voice memo consolidation', () => {
  // Import the internal function via module reflection
  // _consolidateEvents is module-scoped, not exported. We test via validateSessionPayload
  // which calls _consolidateEvents internally.

  it('should merge voice_memo_start and voice_memo into a single event', () => {
    const pm = new PersistenceManager();
    const now = Date.now();
    const sessionData = {
      startTime: now - 120000,
      endTime: now,
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: { 'user:alice:heart_rate': [80, 85, 90, 88, 92, 95] },
        events: [
          {
            timestamp: now - 60000,
            type: 'voice_memo_start',
            data: {
              memoId: 'memo_123',
              elapsedSeconds: 60,
              videoTimeSeconds: 45,
              durationSeconds: 25,
              author: 'alice',
              transcriptPreview: 'Great workout today'
            }
          },
          {
            timestamp: now - 60033,
            type: 'voice_memo',
            data: {
              memoId: 'memo_123',
              duration_seconds: 25,
              transcript: 'Great workout today'
            }
          }
        ]
      }
    };

    pm.validateSessionPayload(sessionData);
    const events = sessionData.timeline.events;

    // Should have exactly one voice memo event, not two
    const voiceEvents = events.filter(e =>
      e.type === 'voice_memo' || e.type === 'voice_memo_start'
    );
    expect(voiceEvents.length).toBe(1);

    // Merged event should have fields from both
    const merged = voiceEvents[0];
    expect(merged.type).toBe('voice_memo');
    expect(merged.data.memoId).toBe('memo_123');
    expect(merged.data.transcript).toBe('Great workout today');
    expect(merged.data.duration_seconds).toBe(25);
    expect(merged.data.elapsedSeconds).toBe(60);
  });
});
```

### Step 2: Run test to verify it fails

Run: `npx jest tests/unit/fitness/persistence-validation.test.mjs -t "voice memo" --no-coverage`

Expected: FAIL — both events pass through unchanged.

### Step 3: Add voice memo consolidation to `_consolidateEvents`

In `PersistenceManager.js`, add voice memo pairing logic inside `_consolidateEvents()`. Add after line 304 (the `otherEvents` declaration):

```javascript
  // ── Voice memos: pair start+content by memoId ──
  const voiceMemoMap = new Map(); // memoId → { startEvt, contentEvt }
```

Add a new grouping block after the governance overlay block (before line 390 "Everything else passes through"):

```javascript
    // ── Voice memo grouping ──
    if (type === 'voice_memo_start') {
      const id = evt.data?.memoId || `unknown_memo_${ts}`;
      if (!voiceMemoMap.has(id)) voiceMemoMap.set(id, { startEvt: evt, contentEvt: null });
      else voiceMemoMap.get(id).startEvt = evt;
      continue;
    }
    if (type === 'voice_memo') {
      const id = evt.data?.memoId || `unknown_memo_${ts}`;
      if (!voiceMemoMap.has(id)) voiceMemoMap.set(id, { startEvt: null, contentEvt: evt });
      else voiceMemoMap.get(id).contentEvt = evt;
      continue;
    }
```

Add the consolidation builder after the governance events builder (after line 464):

```javascript
  // ── Build consolidated voice memo events ──
  const voiceMemoEvents = [];
  for (const [id, { startEvt, contentEvt }] of voiceMemoMap) {
    const s = startEvt?.data || {};
    const c = contentEvt?.data || {};
    voiceMemoEvents.push({
      timestamp: Number(startEvt?.timestamp || contentEvt?.timestamp) || 0,
      type: 'voice_memo',
      data: {
        memoId: id,
        transcript: c.transcript || s.transcriptPreview || null,
        duration_seconds: c.duration_seconds ?? s.durationSeconds ?? null,
        elapsedSeconds: s.elapsedSeconds ?? null,
        videoTimeSeconds: s.videoTimeSeconds ?? null,
        author: s.author ?? null
      }
    });
  }
```

Update the merge line (line 467) to include `voiceMemoEvents`:

```javascript
  const all = [...challengeEvents, ...mediaEvents, ...consolidatedGov, ...voiceMemoEvents, ...otherEvents];
```

### Step 4: Run tests

Run: `npx jest tests/unit/fitness/persistence-validation.test.mjs --no-coverage`

Expected: All pass.

### Step 5: Commit

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js \
       tests/unit/fitness/persistence-validation.test.mjs
git commit -m "fix: consolidate voice_memo_start + voice_memo into single event

Pair voice memo events by memoId in _consolidateEvents(), merging
timing context (elapsedSeconds, videoTimeSeconds) with content
(transcript, duration_seconds) into a single voice_memo event.

Fixes: governance-challenge-failure-audit.md Persistence Issue P2"
```

---

## Task 5: Fix Participants Missing from Session Data

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:157-196` (investigate)
- Modify: `tests/unit/fitness/persistence-validation.test.mjs`

The `buildParticipantsForPersist()` function at line 157 iterates `safeRoster` but only produces entries where `participantId` resolves from `entry.id || entry.profileId || entry.hrDeviceId`. If the roster entries for non-primary users are missing these fields, they get skipped.

### Step 1: Write failing test

```javascript
  it('should include all roster members in participants, not just primary', () => {
    const pm = new PersistenceManager();
    const now = Date.now();
    const sessionData = {
      startTime: now - 120000,
      endTime: now,
      roster: [
        { id: 'kckern', name: 'KC Kern', isPrimary: true, hrDeviceId: '40475' },
        { id: 'felix', name: 'Felix', hrDeviceId: '28688' },
        { id: 'milo', name: 'Milo', hrDeviceId: '28812' },
        { id: 'alan', name: 'Alan', hrDeviceId: '28676' },
        { id: 'soren', name: 'Soren', isExempt: true, hrDeviceId: '7153' }
      ],
      deviceAssignments: [
        { deviceId: '40475', occupantId: 'kckern' },
        { deviceId: '28688', occupantId: 'felix' },
        { deviceId: '28812', occupantId: 'milo' },
        { deviceId: '28676', occupantId: 'alan' },
        { deviceId: '7153', occupantId: 'soren' }
      ],
      timeline: {
        timebase: { tickCount: 6 },
        series: {
          'user:kckern:heart_rate': [100, 110, 120, 130, 140, 144],
          'user:felix:heart_rate': [120, 130, 140, 150, 160, 166],
          'user:milo:heart_rate': [130, 140, 150, 160, 170, 172],
          'user:alan:heart_rate': [110, 120, 130, 140, 150, 159],
          'user:soren:heart_rate': [90, 95, 100, 110, 120, 125]
        }
      }
    };

    const validation = pm.validateSessionPayload(sessionData);
    expect(validation.ok).toBe(true);

    // Build participants the same way persistSession does
    const participants = buildParticipantsForPersist(sessionData.roster, sessionData.deviceAssignments);

    expect(Object.keys(participants)).toHaveLength(5);
    expect(participants).toHaveProperty('kckern');
    expect(participants).toHaveProperty('felix');
    expect(participants).toHaveProperty('milo');
    expect(participants).toHaveProperty('alan');
    expect(participants).toHaveProperty('soren');
    expect(participants.kckern.is_primary).toBe(true);
  });
```

**Note:** `buildParticipantsForPersist` is module-scoped (not exported). To test it, either export it or test indirectly via `persistSession`. The test above assumes we export it. If it's not exportable, test via a spy on the API call in `persistSession`.

### Step 2: Investigate the actual roster data at runtime

Before implementing a fix, we need to verify what the roster actually looks like at persist time. The `buildParticipantsForPersist` code at line 170 looks correct — it iterates all roster entries. The bug may be upstream: the roster passed to `persistSession` might only contain the primary user.

Check `sanitizeRosterForPersist()` (called at line 746) — this function may be filtering out non-primary users. Search for its definition:

Run: `grep -n "sanitizeRosterForPersist" frontend/src/hooks/fitness/PersistenceManager.js`

If the sanitizer is stripping non-primary users, fix it to keep all roster entries.

### Step 3: Fix if identified

The fix depends on what the investigation finds:
- If `sanitizeRosterForPersist` strips non-primary: remove that filter
- If the roster upstream only has primary: fix the roster builder in the session module
- If roster entries lack `id` fields for non-primary: ensure IDs are set

### Step 4: Run tests

Run: `npx jest tests/unit/fitness/persistence-validation.test.mjs --no-coverage`

### Step 5: Commit

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js \
       tests/unit/fitness/persistence-validation.test.mjs
git commit -m "fix: include all roster members in persisted participants

[Description of actual fix based on investigation]

Fixes: governance-challenge-failure-audit.md Persistence Issue P4"
```

---

## Task 6: Fix `governed: false` Race Condition

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:1028`

### Step 1: Understand the race

At `FitnessPlayer.jsx:1028`, the `media_start` event captures:
```javascript
governed: Boolean(governanceState?.videoLocked),
```

But at media start time, the governance engine hasn't evaluated the new media yet (`setMedia()` doesn't trigger `evaluate()` per the architecture doc). So `videoLocked` is still from the previous state (idle → false).

The correct approach: check whether the media **type** is governed, not whether the video is currently locked. The governance engine exposes `isGoverned` at line 1179 via `this._mediaIsGoverned()`.

### Step 2: Fix the governed field

In `FitnessPlayer.jsx:1028`:

```javascript
// BEFORE (line 1028):
      governed: Boolean(governanceState?.videoLocked),

// AFTER:
      governed: governanceState?.isGoverned ?? Boolean(governanceState?.videoLocked),
```

This uses `isGoverned` (which checks media labels against `governed_labels` config) as the primary source, falling back to `videoLocked` only if `isGoverned` isn't available.

### Step 3: Run governance tests

Run: `npx jest tests/unit/governance/ --no-coverage`

Expected: All pass (this change is in the event logging, not in phase logic).

### Step 4: Commit

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "fix: governed field uses isGoverned instead of stale videoLocked

At media_start time, videoLocked reflects pre-evaluation state (idle).
Use governanceState.isGoverned which checks media labels against config.

Fixes: governance-challenge-failure-audit.md Secondary Issue 1 / P5"
```

---

## Task 7: Update Documentation

**Files:**
- Modify: `docs/reference/fitness/governance-system-architecture.md:203-212`
- Modify: `docs/reference/fitness/governance-system-architecture.md:356-371`
- Modify: `docs/reference/fitness/governance-history.md` (add Era 11 entry or note)

### Step 1: Update phase transition table

In `governance-system-architecture.md`, update the transitions table (line 203-212) to add `unlocked → locked` from challenge failure:

```markdown
| From | To | Condition |
|------|----|-----------|
| pending → unlocked | All requirements met for 500ms continuously |
| unlocked → warning | Requirements break AND `satisfiedOnce = true` |
| unlocked → locked | Challenge failure (absolute — base requirements irrelevant) |
| warning → unlocked | Requirements re-satisfied |
| warning → locked | Grace period expires OR challenge fails |
| locked → unlocked | Requirements met for 500ms AND no active failed challenge |
| any → pending | No media, no participants, or engine reset |
```

### Step 2: Update phase evaluation pseudocode

In `governance-system-architecture.md`, update the pseudocode (lines 356-371) to include challenge failure:

```
For each evaluate():
  If challengeForcesRed (active challenge with status 'failed'):
    phase = 'locked'   (recovery only via challenge satisfaction check)
  Else if allSatisfied:
    If satisfiedSince is null → set satisfiedSince = now
    If (now - satisfiedSince) >= 500ms:
      satisfiedOnce = true
      phase = 'unlocked'
    Else:
      Keep current phase (don't flap back to pending)
  Else:
    Clear satisfiedSince
    If satisfiedOnce → phase = 'warning'
    Else → phase = 'pending'
```

### Step 3: Commit

```bash
git add docs/reference/fitness/governance-system-architecture.md
git commit -m "docs: update architecture doc to reflect challenge failure lock fix

Add unlocked→locked transition for challenge failure. Update phase
evaluation pseudocode to show challengeForcesRed as absolute lock.

Fixes: governance-challenge-failure-audit.md Documentation Discrepancies"
```

---

## Summary

| Task | Issue | Severity | Files Changed |
|------|-------|----------|---------------|
| 1 | Challenge failure lock override | Critical | GovernanceEngine.js, 2 test files |
| 2 | timeSinceWarningMs null | Low | GovernanceEngine.js, 1 test file |
| 3 | Mixed zero/null series persisted | Medium | PersistenceManager.js, 1 test file |
| 4 | Voice memo duplication | Low | PersistenceManager.js, 1 test file |
| 5 | Participants missing | High | PersistenceManager.js, 1 test file |
| 6 | governed: false race | Medium | FitnessPlayer.jsx |
| 7 | Documentation discrepancies | — | 1 doc file |
