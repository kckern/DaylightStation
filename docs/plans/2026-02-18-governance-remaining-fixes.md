# Governance Remaining Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three remaining governance issues: HR=0 device disconnects causing false warnings, warning cooldown bypass on the locked path, and a log field typo.

**Architecture:** Task 1 changes `UserManager.#updateHeartRateData()` to preserve the last known zone snapshot when HR drops to 0, instead of recomputing a snapshot with HR=0 that puts the user in the "cool" zone. Task 2 extends the warning cooldown in `GovernanceEngine._setPhase()` to also activate on `locked→unlocked` transitions. Task 3 renames the `oderId`/`odeName` log fields to `userId`/`userName`.

**Tech Stack:** Vanilla JS classes (`UserManager.js`, `GovernanceEngine.js`), Jest (ESM mode via `--experimental-vm-modules`)

---

## Context

### Source Audits

- `docs/_wip/audits/2026-02-17-governance-warning-observability-audit.md` — identified 19 warning events, 2 caused by HR=0
- `docs/_wip/audits/2026-02-17-governance-post-fix-prod-verification.md` — confirmed ghost oscillation fix, video lock fix
- Production log: `logs/prod-session-fs_20260217171959-full.txt`

### The Three Issues

**1. HR=0 Device Disconnect → False Zone Change (2 of 19 warnings)**

When a BLE heart rate device disconnects, the device sends `heartRate: 0`. `UserManager.#updateHeartRateData()` (line 84-87) receives this and calls `deriveZoneProgressSnapshot({ heartRate: 0 })`, which maps HR=0 to zone index 0 ("cool"). This drops the user from whatever zone they were in (e.g., "active" or "fire") to "cool", triggering a governance warning.

From the prod log (line 23):
```json
{"event":"governance.user_zone_change","data":{"fromZone":"active","toZone":"cool","hr":0}}
```

A disconnected device is not a user who stopped exercising. HR=0 should preserve the last known zone.

**2. Warning Cooldown Bypass on Locked Path (5 of 19 warnings escalated)**

The `warning_cooldown_seconds` mechanism (line 635) only activates on `warning→unlocked` transitions. When a warning escalates to locked (`warning→locked`) and the user then recovers (`locked→unlocked`), NO cooldown is set. The user can immediately get a new warning.

From the prod phase timeline:
```
01:37:26  warning   (Warning #7)
01:37:56  locked    (grace expired — no cooldown set on warning→locked)
01:38:07  unlocked  (recovered — no cooldown set on locked→unlocked)
01:38:51  warning   (Warning #8 — immediate re-warning, no suppression)
```

**3. `oderId`/`odeName` Typo (every zone_change event)**

GovernanceEngine.js lines 302-303 log `oderId` and `odeName` instead of `userId` / `userName`. Every `governance.user_zone_change` event in production has this typo, affecting log queries.

### Key Files

| File | Role |
|------|------|
| `frontend/src/hooks/fitness/UserManager.js:84-87` | HR=0 handling in `#updateHeartRateData()` |
| `frontend/src/hooks/fitness/GovernanceEngine.js:634-640` | Warning cooldown logic in `_setPhase()` |
| `frontend/src/hooks/fitness/GovernanceEngine.js:301-303` | Zone change log field names |
| `tests/unit/governance/GovernanceEngine.test.mjs` | Governance tests (34+ tests) |
| `tests/unit/governance/governance-below-threshold-logging.test.mjs` | Below-threshold logging tests |

### Test Command

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/ --no-cache
```

---

## Task 1: Preserve Last Known Zone on HR=0

**Problem:** `UserManager.#updateHeartRateData()` recomputes the zone snapshot with `heartRate: 0` when the device disconnects, dropping the user to "cool" zone.

**Fix:** When `heartRate <= 0`, skip the zone snapshot update entirely. The user keeps their last known zone. The ghost participant filter in `GovernanceEngine.evaluate()` (line 1307-1312) already handles the case where a user has genuinely disconnected (no zone data at all) — it removes them from evaluation. For the brief HR=0 period before roster cleanup, the user should stay in their last known zone rather than false-transitioning to "cool."

**Files:**
- Modify: `frontend/src/hooks/fitness/UserManager.js:84-87`
- Test: `tests/unit/fitness/UserManager.test.mjs` (create if needed)

**Step 1: Write the failing test**

Check if a UserManager test file exists. If not, create a minimal one.

```bash
ls tests/unit/fitness/
```

Create or add to the test file:

```javascript
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

const { FitnessUser } = await import('#frontend/hooks/fitness/UserManager.js');

describe('FitnessUser — HR=0 zone preservation', () => {
  it('should preserve last known zone when heartRate drops to 0', () => {
    const zoneConfig = [
      { id: 'cool', name: 'Cool', min: 0, color: '#0000ff' },
      { id: 'active', name: 'Active', min: 100, color: '#00ff00' },
      { id: 'warm', name: 'Warm', min: 130, color: '#ffaa00' },
    ];

    const user = new FitnessUser({
      id: 'bob',
      name: 'Bob',
      birthyear: 2018,
      globalZones: zoneConfig,
      hrDeviceId: 'device-1'
    });

    // Simulate real HR reading at 120 → should be in "active" zone
    user.recordDeviceReading({
      type: 'heart_rate',
      deviceId: 'device-1',
      heartRate: 120
    });
    expect(user.currentData.zoneId).toBe('active');
    const activeZoneSnapshot = { ...user.currentData };

    // Simulate device disconnect → HR=0
    user.recordDeviceReading({
      type: 'heart_rate',
      deviceId: 'device-1',
      heartRate: 0
    });

    // KEY ASSERTION: should still be in "active" zone, NOT "cool"
    expect(user.currentData.zoneId).toBe('active');
    // HR should reflect 0 (for display purposes) but zone should be preserved
  });

  it('should still update zone normally for real HR values after HR=0', () => {
    const zoneConfig = [
      { id: 'cool', name: 'Cool', min: 0, color: '#0000ff' },
      { id: 'active', name: 'Active', min: 100, color: '#00ff00' },
    ];

    const user = new FitnessUser({
      id: 'bob',
      name: 'Bob',
      birthyear: 2018,
      globalZones: zoneConfig,
      hrDeviceId: 'device-1'
    });

    // Get to active
    user.recordDeviceReading({ type: 'heart_rate', deviceId: 'device-1', heartRate: 120 });
    expect(user.currentData.zoneId).toBe('active');

    // Device disconnect
    user.recordDeviceReading({ type: 'heart_rate', deviceId: 'device-1', heartRate: 0 });
    expect(user.currentData.zoneId).toBe('active'); // preserved

    // Device reconnects with real reading at 50 → should now be "cool"
    user.recordDeviceReading({ type: 'heart_rate', deviceId: 'device-1', heartRate: 50 });
    expect(user.currentData.zoneId).toBe('cool'); // normal update resumes
  });
});
```

**Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/fitness/UserManager.test.mjs --no-cache -t "HR=0 zone preservation"
```

Expected: FAIL — `user.currentData.zoneId` is `'cool'` instead of `'active'` after HR=0.

**Step 3: Implement the fix**

In `frontend/src/hooks/fitness/UserManager.js`, change lines 84-88:

```javascript
// Before:
#updateHeartRateData(heartRate) {
  if (!heartRate || heartRate <= 0) {
    this.#updateCurrentData(deriveZoneProgressSnapshot({ zoneConfig: this.zoneConfig, heartRate: 0 }));
    return;
  }

// After:
#updateHeartRateData(heartRate) {
  if (!heartRate || heartRate <= 0) {
    // Device disconnect (HR=0): preserve last known zone snapshot.
    // Don't recompute with HR=0, which would drop user to "cool" zone.
    // The ghost participant filter in GovernanceEngine handles truly
    // disconnected users by removing them from evaluation.
    return;
  }
```

This is a 1-line change: remove the `deriveZoneProgressSnapshot({ heartRate: 0 })` call and just `return`. The user keeps whatever zone snapshot they had from their last real HR reading.

**Step 4: Run all tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/fitness/ tests/unit/governance/ --no-cache
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/UserManager.js tests/unit/fitness/UserManager.test.mjs
git commit -m "fix(fitness): preserve last known zone on HR=0 device disconnect

When a BLE device disconnects and sends heartRate=0, preserve the
user's last known zone snapshot instead of recomputing with HR=0
(which dropped them to 'cool' zone and triggered false governance
warnings). The ghost participant filter already handles truly
disconnected users by removing them from evaluation."
```

---

## Task 2: Extend Warning Cooldown to Cover Locked Path

**Problem:** The `warning_cooldown_seconds` mechanism only activates on `warning→unlocked` transitions. When a warning escalates to locked and the user recovers (`warning→locked→unlocked`), no cooldown is set and the user can immediately get another warning.

**Fix:** Also set the warning cooldown on `locked→unlocked` transitions. If a user was just locked out, they deserve at least the same cooldown protection as someone whose warning was dismissed by recovery.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:634-640`
- Test: `tests/unit/governance/GovernanceEngine.test.mjs`

**Step 1: Write the failing test**

Add to `tests/unit/governance/GovernanceEngine.test.mjs` inside the `'warning cooldown'` describe block:

```javascript
it('should apply cooldown after warning escalates to locked then unlocks', () => {
  const mockSession = {
    roster: [],
    zoneProfileStore: null,
    snapshot: {
      zoneConfig: [
        { id: 'cool', name: 'Cool', color: '#0000ff' },
        { id: 'active', name: 'Active', color: '#ff0000' },
      ]
    }
  };

  const engine = new GovernanceEngine(mockSession);
  engine.configure({
    governed_labels: ['exercise'],
    grace_period_seconds: 0,  // immediate lock (no grace period)
    warning_cooldown_seconds: 30
  }, [], {});

  engine.setMedia({ id: 'test-media', labels: ['exercise'] });
  engine.registerCallbacks(() => {}, () => {}, () => {});

  const zoneRankMap = { cool: 0, active: 1 };
  const zoneInfoMap = {
    cool: { id: 'cool', name: 'Cool' },
    active: { id: 'active', name: 'Active' }
  };

  // Get to unlocked
  engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'active' }, zoneRankMap, zoneInfoMap });
  expect(engine.phase).toBe('unlocked');

  // Alice drops → locked immediately (grace=0)
  engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'cool' }, zoneRankMap, zoneInfoMap });
  expect(engine.phase).toBe('locked');

  // Alice recovers → unlocked (cooldown should start here)
  engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'active' }, zoneRankMap, zoneInfoMap });
  expect(engine.phase).toBe('unlocked');

  // Alice drops again within cooldown → should stay unlocked (suppressed)
  engine.evaluate({ activeParticipants: ['alice'], userZoneMap: { alice: 'cool' }, zoneRankMap, zoneInfoMap });
  // KEY ASSERTION: stays unlocked during cooldown after locked→unlocked
  expect(engine.phase).toBe('unlocked');
});
```

**Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/GovernanceEngine.test.mjs --no-cache -t "warning escalates to locked"
```

Expected: FAIL — `engine.phase` is `'locked'` (no cooldown on `locked→unlocked`).

**Step 3: Implement the fix**

In `frontend/src/hooks/fitness/GovernanceEngine.js`, change lines 634-640:

```javascript
// Before:
// Start warning cooldown when warning dismisses to unlocked
if (oldPhase === 'warning' && newPhase === 'unlocked') {
  const cooldownSeconds = Number(this.config?.warning_cooldown_seconds);
  if (Number.isFinite(cooldownSeconds) && cooldownSeconds > 0) {
    this._warningCooldownUntil = now + cooldownSeconds * 1000;
  }
}

// After:
// Start warning cooldown when returning to unlocked from warning or locked.
// After a warning or lock cycle, suppress immediate re-entry to warning.
if ((oldPhase === 'warning' || oldPhase === 'locked') && newPhase === 'unlocked') {
  const cooldownSeconds = Number(this.config?.warning_cooldown_seconds);
  if (Number.isFinite(cooldownSeconds) && cooldownSeconds > 0) {
    this._warningCooldownUntil = now + cooldownSeconds * 1000;
  }
}
```

This is a 1-character logical change: `oldPhase === 'warning'` becomes `(oldPhase === 'warning' || oldPhase === 'locked')`.

**Step 4: Run all governance tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/ --no-cache
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine.test.mjs
git commit -m "fix(governance): extend warning cooldown to locked→unlocked transitions

The warning cooldown previously only activated on warning→unlocked.
When a warning escalated to locked and the user recovered, no cooldown
was set, allowing immediate re-warning. Now cooldown also activates
on locked→unlocked, giving the user the same protection after being
locked out."
```

---

## Task 3: Fix `oderId`/`odeName` Log Field Typo

**Problem:** `_logZoneChanges()` in GovernanceEngine.js logs `oderId` and `odeName` (missing the "us" prefix) instead of `userId` / `userName`. Every `governance.user_zone_change` event in production has this typo.

**Fix:** Rename the fields to `userId` and `userName`.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:302-303`

**Step 1: Verify no downstream consumers depend on the typo'd field names**

```bash
grep -r "oderId\|odeName" frontend/ tests/ --include="*.js" --include="*.jsx" --include="*.mjs" -l
```

Expected: Only `GovernanceEngine.js` uses these field names. If any dashboards or log queries use them, they'll need updating — but that's outside code scope.

**Step 2: Implement the fix**

In `frontend/src/hooks/fitness/GovernanceEngine.js`, change lines 302-303:

```javascript
// Before:
oderId: userId,
odeName: rosterEntry?.name || rosterEntry?.displayName || userId,

// After:
userId: userId,
userName: rosterEntry?.name || rosterEntry?.displayName || userId,
```

**Step 3: Run all governance tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/ --no-cache
```

Expected: All tests pass (no tests assert on these field names).

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "fix(governance): rename oderId/odeName to userId/userName in zone_change logs

The governance.user_zone_change event had typo'd field names (oderId,
odeName) since the field was first added. Rename to userId/userName
for correct log querying."
```

---

## Task 4: Run Full Test Suite and Verify

**Step 1: Run all governance tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/ --no-cache
```

Expected: All tests pass.

**Step 2: Run fitness unit tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/fitness/ --no-cache
```

Expected: All tests pass.

**Step 3: Verify no lint errors**

```bash
npx eslint frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/UserManager.js
```

---

## Execution Summary

| Task | What | Files Modified | Tests | Risk |
|------|------|---------------|-------|------|
| 1 | Preserve zone on HR=0 | `UserManager.js` | 2 new | Low — removes a side effect, fallback behavior is safe |
| 2 | Extend cooldown to locked path | `GovernanceEngine.js` | 1 new | Low — 1-char condition change, config-gated |
| 3 | Fix log field typo | `GovernanceEngine.js` | 0 | None — cosmetic log field rename |
| 4 | Full verification | — | — | — |

**Dependencies:** Tasks 1-3 are independent and can be done in any order. Task 4 runs last.

**Impact on the 19-warning session:** After all fixes:
- Warnings #1, #2 (HR=0 disconnects) → **eliminated** by Task 1
- Warnings #5, #6 (rapid re-entry after #4) → **suppressed** by existing cooldown
- Warnings #16-18 (rapid cluster) → **suppressed** by existing cooldown
- Warning #8 (re-entry after locked path) → **suppressed** by Task 2
- Remaining 11 warnings → still fire (genuine zone boundary crossings >30s apart)
- All warnings → now have full `{hr, threshold, delta}` diagnostics (from prior plan)
