# Governance Transition Tightness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate "Waiting for participant data..." flash and offender chip color lag by closing two SSoT gaps in governance state.

**Architecture:** GovernanceEngine's state snapshot (`_composeState()`) must carry ALL data the UI needs — zone colors, participant zone assignments — so the overlay never re-queries a potentially stale ZoneProfileStore. Additionally, requirement summaries must include `zoneColor` from the evaluation-time `zoneInfoMap` so chip borders match what governance used for its decision.

**Tech Stack:** Jest (unit tests), Playwright (runtime tests), GovernanceEngine.js, GovernanceStateOverlay.jsx

---

### Task 1: Unit test — lockRows never empty when participants exist

**Files:**
- Create: `tests/isolated/domain/fitness/legacy/governance-transition-tightness.unit.test.mjs`

**Step 1: Write the test**

```javascript
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

const mockSampled = jest.fn();
const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockDebug = jest.fn();
const mockError = jest.fn();
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug, error: mockError }),
  getLogger: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug, error: mockError })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

const ZONE_RANK_MAP = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
const ZONE_INFO_MAP = {
  cool: { id: 'cool', name: 'Cool', color: '#94a3b8' },
  active: { id: 'active', name: 'Active', color: '#22c55e' },
  warm: { id: 'warm', name: 'Warm', color: '#eab308' },
  hot: { id: 'hot', name: 'Hot', color: '#f97316' },
  fire: { id: 'fire', name: 'Fire', color: '#ef4444' }
};

const createEngine = (getProfileFn) => {
  const session = {
    zoneProfileStore: { getProfile: getProfileFn },
    roster: [],
    treasureBox: null
  };
  const engine = new GovernanceEngine(session);
  engine._hysteresisMs = 0;
  return engine;
};

describe('Governance transition tightness', () => {
  let realDateNow, mockTime;
  beforeEach(() => {
    [mockSampled, mockInfo, mockWarn, mockDebug, mockError].forEach(m => m.mockClear());
    realDateNow = Date.now;
    mockTime = realDateNow.call(Date);
    Date.now = () => mockTime;
  });
  afterEach(() => { Date.now = realDateNow; });

  describe('lockRows completeness', () => {
    test('lockRows has entries when participants exist and requirements unsatisfied', () => {
      const mockGetProfile = jest.fn().mockReturnValue({
        id: 'user-1', currentZoneId: 'active'
      });
      const engine = createEngine(mockGetProfile);
      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': { min_participants: 1, base_requirement: [{ warm: 'all' }] }
        }
      });

      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      const state = engine.state;
      expect(state.status).toBe('pending');
      expect(state.lockRows.length).toBeGreaterThan(0);
      expect(state.lockRows[0].missingUsers).toContain('user-1');
    });

    test('lockRows populated immediately after participant joins (no empty intermediate)', () => {
      const mockGetProfile = jest.fn()
        .mockReturnValueOnce(null) // No profile during pre-populate
        .mockReturnValue({ id: 'user-1', currentZoneId: 'active' });
      const engine = createEngine(mockGetProfile);
      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': { min_participants: 1, base_requirement: [{ warm: 'all' }] }
        }
      });

      // Pre-populate with 0 participants
      engine.evaluate({
        activeParticipants: [],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 0
      });
      expect(engine.state.status).toBe('pending');

      // Participant joins — lockRows must be populated on THIS call
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      const state = engine.state;
      expect(state.lockRows.length).toBeGreaterThan(0);
      expect(state.lockRows[0].missingUsers).toContain('user-1');
    });

    test('pre-populated requirements have zone labels before any participant data', () => {
      const mockGetProfile = jest.fn().mockReturnValue(null);
      const engine = createEngine(mockGetProfile);
      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': { min_participants: 1, base_requirement: [{ warm: 'all' }] }
        }
      });

      // Evaluate with 0 participants — should still have zone labels
      engine.evaluate({
        activeParticipants: [],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 0
      });

      const state = engine.state;
      // Requirements should have proper zone label, not raw ID
      expect(state.requirements.length).toBeGreaterThan(0);
      expect(state.requirements[0].zoneLabel).toBe('Warm');
    });
  });
});
```

**Step 2: Run test**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/legacy/governance-transition-tightness.unit.test.mjs --no-coverage
```

Expected: All 3 PASS (these validate existing behavior).

**Step 3: Commit**

```bash
git add tests/isolated/domain/fitness/legacy/governance-transition-tightness.unit.test.mjs
git commit -m "test: lockRows completeness contracts for governance transition tightness"
```

---

### Task 2: Unit test — zone color in requirement summaries

**Files:**
- Modify: `tests/isolated/domain/fitness/legacy/governance-transition-tightness.unit.test.mjs`

**Step 1: Add zone color tests (expected to FAIL — proving the bug)**

Add to the test file:

```javascript
  describe('zone color in governance state', () => {
    test('requirement summary carries zoneColor from evaluation-time zoneInfoMap', () => {
      const mockGetProfile = jest.fn().mockReturnValue({
        id: 'user-1', currentZoneId: 'active'
      });
      const engine = createEngine(mockGetProfile);
      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': { min_participants: 1, base_requirement: [{ warm: 'all' }] }
        }
      });

      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      const state = engine.state;
      // The requirement for 'warm' zone should carry the warm zone's color
      const warmReq = state.requirements.find(r => r.zone === 'warm');
      expect(warmReq).toBeDefined();
      expect(warmReq.zoneColor).toBe('#eab308'); // Warm zone color from zoneInfoMap
    });

    test('lockRows carry zoneColor for target zone', () => {
      const mockGetProfile = jest.fn().mockReturnValue({
        id: 'user-1', currentZoneId: 'active'
      });
      const engine = createEngine(mockGetProfile);
      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': { min_participants: 1, base_requirement: [{ warm: 'all' }] }
        }
      });

      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      const state = engine.state;
      expect(state.lockRows.length).toBeGreaterThan(0);
      expect(state.lockRows[0].zoneColor).toBe('#eab308'); // Target zone (warm) color
    });

    test('lockRows carry participant current zone color', () => {
      const mockGetProfile = jest.fn().mockReturnValue({
        id: 'user-1', currentZoneId: 'active'
      });
      const engine = createEngine(mockGetProfile);
      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': { min_participants: 1, base_requirement: [{ warm: 'all' }] }
        }
      });

      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      const state = engine.state;
      // Each missing user in lockRows should carry their CURRENT zone color
      // This is the zone GovernanceEngine read from ZoneProfileStore during evaluation
      const lockRow = state.lockRows[0];
      expect(lockRow.missingUsers).toBeDefined();
      // The lockRow itself should carry the participant's current zone info
      expect(lockRow.participantZones).toBeDefined();
      expect(lockRow.participantZones['user-1']).toBeDefined();
      expect(lockRow.participantZones['user-1'].zoneId).toBe('active');
      expect(lockRow.participantZones['user-1'].zoneColor).toBe('#22c55e');
    });
  });
```

**Step 2: Run test — should FAIL**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/legacy/governance-transition-tightness.unit.test.mjs --no-coverage -t "zone color"
```

Expected: FAIL — `zoneColor` is undefined on requirements and lockRows, `participantZones` doesn't exist.

**Step 3: Fix GovernanceEngine — add `zoneColor` to requirement summary**

**File:** `frontend/src/hooks/fitness/GovernanceEngine.js:1592-1605`

Change `_evaluateZoneRequirement` return value to include `zoneColor`:

```javascript
    return {
      zone: zoneId,
      zoneLabel: zoneInfo?.name || zoneId,
      zoneColor: zoneInfo?.color || null,        // ← ADD THIS
      targetZoneId: zoneId,
      participantKey: null,
      severity: requiredRank,
      rule,
      ruleLabel: this._describeRule(rule, requiredCount),
      requiredCount,
      actualCount: metUsers.length,
      metUsers,
      missingUsers,
      satisfied
    };
```

**Step 4: Fix GovernanceEngine — add `participantZones` to lockRows**

**File:** `frontend/src/hooks/fitness/GovernanceEngine.js:1096-1101`

After `lockRowsNormalized` computation, add participant zone info:

```javascript
    }).map((entry) => {
      // Embed participant zone info so UI doesn't re-query the store
      const participantZones = {};
      if (Array.isArray(entry.missingUsers)) {
        entry.missingUsers.forEach((userId) => {
          const userZone = this._latestInputs.userZoneMap?.[userId];
          const userZoneInfo = this._getZoneInfo(userZone);
          participantZones[userId] = {
            zoneId: userZone || null,
            zoneName: userZoneInfo?.name || userZone || null,
            zoneColor: userZoneInfo?.color || null
          };
        });
      }
      return {
        ...entry,
        participantKey: entry.participantKey || null,
        targetZoneId: entry.targetZoneId || entry.zone || null,
        severity: entry.severity != null ? entry.severity : this._getZoneRank(entry.targetZoneId),
        participantZones
      };
    });
```

**Step 5: Also add `zoneColor` to `_buildRequirementShell`**

**File:** `frontend/src/hooks/fitness/GovernanceEngine.js` — in `_buildRequirementShell` method, add `zoneColor` to the returned entries:

Find the return in `_buildRequirementShell` (around line 1510-1525) and add `zoneColor: zoneInfo?.color || null`.

**Step 6: Run tests — should PASS**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/legacy/governance-transition-tightness.unit.test.mjs --no-coverage
```

Expected: All PASS.

**Step 7: Run full fitness suite — no regressions**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/ --no-coverage --testPathIgnorePatterns='/\.worktrees/'
```

Expected: 32+ suites pass.

**Step 8: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/isolated/domain/fitness/legacy/governance-transition-tightness.unit.test.mjs
git commit -m "feat: embed zoneColor and participantZones in governance state for SSoT"
```

---

### Task 3: Unit test — state cache invalidation on evaluate

**Files:**
- Modify: `tests/isolated/domain/fitness/legacy/governance-transition-tightness.unit.test.mjs`

**Step 1: Add cache invalidation tests**

```javascript
  describe('state cache invalidation', () => {
    test('state reflects new zone data after evaluate, not cached stale data', () => {
      const mockGetProfile = jest.fn();
      const engine = createEngine(mockGetProfile);
      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': { min_participants: 1, base_requirement: [{ warm: 'all' }] }
        }
      });

      // First evaluation: user in active
      mockGetProfile.mockReturnValue({ id: 'user-1', currentZoneId: 'active' });
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      const state1 = engine.state;
      expect(state1.status).toBe('pending');

      // Second evaluation: user in warm
      mockGetProfile.mockReturnValue({ id: 'user-1', currentZoneId: 'warm' });
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      const state2 = engine.state;
      // Must reflect new state, not cached pending
      expect(state2.status).toBe('unlocked');
      expect(state2.lockRows.length).toBe(0); // No missing users when satisfied
    });

    test('state reflects participant changes immediately after evaluate', () => {
      const mockGetProfile = jest.fn().mockReturnValue({
        id: 'user-1', currentZoneId: 'active'
      });
      const engine = createEngine(mockGetProfile);
      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': { min_participants: 1, base_requirement: [{ warm: 'all' }] }
        }
      });

      // Evaluate with 1 participant
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.state.activeUserCount).toBe(1);

      // Add second participant
      mockGetProfile.mockImplementation((id) => ({
        id, currentZoneId: 'active'
      }));
      engine.evaluate({
        activeParticipants: ['user-1', 'user-2'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 2
      });
      expect(engine.state.activeUserCount).toBe(2);
      // Both users should appear in lockRows
      const allMissing = engine.state.lockRows.flatMap(r => r.missingUsers || []);
      expect(allMissing).toContain('user-1');
      expect(allMissing).toContain('user-2');
    });
  });
```

**Step 2: Run tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/legacy/governance-transition-tightness.unit.test.mjs --no-coverage
```

Expected: PASS.

**Step 3: Commit**

```bash
git add tests/isolated/domain/fitness/legacy/governance-transition-tightness.unit.test.mjs
git commit -m "test: state cache invalidation contracts for governance transitions"
```

---

### Task 4: Runtime test — lock screen never shows "Waiting" when devices active

**Files:**
- Create: `tests/live/flow/fitness/governance-transition-tightness.runtime.test.mjs`

**Step 1: Write the Playwright test**

```javascript
import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';

const BASE_URL = FRONTEND_URL;
const API_URL = BACKEND_URL;
const GOVERNED_CONTENT_ID = '606052';

test.describe('Governance transition tightness', () => {

  test('lock screen never shows "Waiting for participant data" when devices are active', async ({ browser }) => {
    const response = await fetch(`${API_URL}/api/v1/fitness`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`FAIL FAST: Fitness API returned ${response.status}`);

    const context = await browser.newContext();
    const page = await context.newPage();
    const sim = new FitnessSimHelper(page);

    await page.goto(`${BASE_URL}/fitness/play/${GOVERNED_CONTENT_ID}`);
    await page.waitForSelector('.fitness-player, .fitness-app', { timeout: 15000 });
    await sim.waitForController();
    const devices = await sim.getDevices();
    if (!devices.length) throw new Error('FAIL FAST: No devices found');

    // Start HR simulation FIRST
    const device = devices[0];
    await sim.setZone(device.deviceId, 'cool');

    // Poll rapidly for the "Waiting" flash
    let sawWaitingWithActiveDevice = false;
    const pollResults = [];

    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(150);

      const state = await page.evaluate(() => {
        const overlay = document.querySelector('.governance-overlay');
        if (!overlay) return { visible: false, hasEmpty: false };
        const emptyRow = overlay.querySelector('.governance-lock__row--empty');
        const rows = overlay.querySelectorAll('.governance-lock__row:not(.governance-lock__row--header):not(.governance-lock__row--empty)');
        return {
          visible: true,
          hasEmpty: !!emptyRow,
          emptyText: emptyRow?.textContent?.trim() || null,
          rowCount: rows.length
        };
      });

      pollResults.push(state);

      if (state.visible && state.hasEmpty) {
        sawWaitingWithActiveDevice = true;
      }

      // If we see populated rows, we've passed the critical window
      if (state.rowCount > 0) break;
    }

    // Assert: never saw "Waiting for participant data" while device was active
    expect(sawWaitingWithActiveDevice).toBe(false);

    await sim.stopAll();
    await context.close();
  });

  test('offender chip border color is non-blue/non-target during warning', async ({ browser }) => {
    const response = await fetch(`${API_URL}/api/v1/fitness`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`FAIL FAST: Fitness API returned ${response.status}`);

    const context = await browser.newContext();
    const page = await context.newPage();
    const sim = new FitnessSimHelper(page);

    await page.goto(`${BASE_URL}/fitness/play/${GOVERNED_CONTENT_ID}`);
    await page.waitForSelector('.fitness-player, .fitness-app', { timeout: 15000 });
    await sim.waitForController();
    const devices = await sim.getDevices();
    if (!devices.length) throw new Error('FAIL FAST: No devices found');

    const device = devices[0];

    // Unlock: get to warm zone
    await sim.setZone(device.deviceId, 'warm');

    // Wait for unlock
    let unlocked = false;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(500);
      const govState = await page.evaluate(() => window.__fitnessGovernance);
      if (govState?.phase === 'unlocked') {
        unlocked = true;
        break;
      }
    }
    expect(unlocked).toBe(true);

    // Drop to cool zone to trigger warning
    await sim.setZone(device.deviceId, 'cool');

    // Wait for warning phase
    let inWarning = false;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(300);
      const govState = await page.evaluate(() => window.__fitnessGovernance);
      if (govState?.phase === 'warning') {
        inWarning = true;
        break;
      }
    }
    expect(inWarning).toBe(true);

    // Check offender chip border color
    const chipData = await page.evaluate(() => {
      const chips = document.querySelectorAll('.governance-progress-overlay__chip');
      return Array.from(chips).map(chip => {
        const style = chip.style;
        const computed = window.getComputedStyle(chip);
        return {
          borderColor: style.borderColor || computed.borderColor || null,
          borderColorRaw: style.cssText
        };
      });
    });

    // The chip should have a border color that represents the user's CURRENT zone
    // (cool = gray/slate), NOT the target zone (warm = yellow) or a stale zone
    if (chipData.length > 0) {
      const borderColor = chipData[0].borderColor;
      // It should NOT be yellow (warm) or green (active) — user is in cool
      expect(borderColor).not.toContain('eab308'); // warm yellow
      // It SHOULD be present (not null)
      expect(borderColor).toBeTruthy();
    }

    await sim.stopAll();
    await context.close();
  });

  test('lock screen hydrates within 2 seconds of first HR data', async ({ browser }) => {
    const response = await fetch(`${API_URL}/api/v1/fitness`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`FAIL FAST: Fitness API returned ${response.status}`);

    const context = await browser.newContext();
    const page = await context.newPage();
    const sim = new FitnessSimHelper(page);

    await page.goto(`${BASE_URL}/fitness/play/${GOVERNED_CONTENT_ID}`);
    await page.waitForSelector('.fitness-player, .fitness-app', { timeout: 15000 });
    await sim.waitForController();
    const devices = await sim.getDevices();
    if (!devices.length) throw new Error('FAIL FAST: No devices found');

    // Send HR data and start timer
    const hrSentAt = Date.now();
    await sim.setZone(devices[0].deviceId, 'cool');

    // Poll for hydrated lock screen (participant name visible)
    let hydratedAt = null;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(100);

      const state = await page.evaluate(() => {
        const overlay = document.querySelector('.governance-overlay');
        if (!overlay) return { hydrated: false };
        const rows = overlay.querySelectorAll('.governance-lock__row:not(.governance-lock__row--header):not(.governance-lock__row--empty)');
        if (rows.length === 0) return { hydrated: false };
        const name = rows[0].querySelector('.governance-lock__chip-name')?.textContent?.trim();
        return { hydrated: !!name && name !== 'Unknown', name };
      });

      if (state.hydrated) {
        hydratedAt = Date.now();
        break;
      }
    }

    expect(hydratedAt).not.toBeNull();
    const hydrationMs = hydratedAt - hrSentAt;
    expect(hydrationMs).toBeLessThan(2000);

    await sim.stopAll();
    await context.close();
  });
});
```

**Step 2: Run the Playwright test (requires dev server running)**

```bash
npx playwright test tests/live/flow/fitness/governance-transition-tightness.runtime.test.mjs --reporter=line
```

Expected: Tests may fail initially — the "Waiting" flash and chip color issues are what we're trying to catch.

**Step 3: Commit**

```bash
git add tests/live/flow/fitness/governance-transition-tightness.runtime.test.mjs
git commit -m "test: runtime tests for governance lock screen transition tightness"
```

---

### Task 5: Fix overlay to read zone colors from governance state (not re-query store)

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx:629-640`

**Step 1: Update offender chip to prefer governance-provided zone color**

In `warningOffenders` useMemo (line 629-641), after computing `zoneInfo` via `getParticipantZone()`, also check the governance state's `participantZones` for the authoritative color:

```javascript
      // SSoT: Prefer zone color from governance state snapshot (evaluation-time consistent)
      // Falls back to ZoneProfileStore (which may have changed since evaluation)
      const governanceZoneInfo = overlay?.participantZones?.[normalized];
      const chipZoneColor = governanceZoneInfo?.zoneColor || zoneInfo?.color || null;

      offenders.push({
        key: normalized,
        name: canonicalName,
        displayLabel,
        heartRate,
        avatarSrc,
        zoneId: governanceZoneInfo?.zoneId || zoneInfo?.id || null,
        zoneColor: chipZoneColor,
        progressPercent,
        targetZoneId: targetZoneId || null,
        targetThreshold: targetThreshold,
        targetZoneColor: targetZoneColor || targetRequirement?.color || null
      });
```

**Note:** The `overlay.participantZones` field will exist once the overlay computation passes it through from `governanceState.lockRows[n].participantZones`. This may require updating the overlay computation useMemo to extract `participantZones` from the first matching lockRow.

**Step 2: Run full test suite**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/ --no-coverage --testPathIgnorePatterns='/\.worktrees/'
```

Expected: All pass.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx
git commit -m "fix: offender chip reads zone color from governance state snapshot (SSoT)"
```

---

### Task 6: Run all tests and verify

**Step 1: Run unit tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/ --no-coverage --testPathIgnorePatterns='/\.worktrees/'
```

Expected: 33+ suites pass, 0 failures.

**Step 2: Run runtime tests (if dev server running)**

```bash
npx playwright test tests/live/flow/fitness/governance-transition-tightness.runtime.test.mjs --reporter=line
```

Expected: All 3 PASS.

**Step 3: Final commit**

```bash
git add -A
git commit -m "test: governance transition tightness — unit + runtime tests complete"
```
