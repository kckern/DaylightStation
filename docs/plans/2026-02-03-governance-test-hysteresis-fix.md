# Governance Test Hysteresis Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix flaky governance tests by ensuring tests wait for the 500ms hysteresis window to complete before proceeding.

**Architecture:** Update the `unlockVideo()` helper function to continuously send HR signals and verify the GovernanceEngine phase reaches `unlocked` (not just check overlay visibility). This ensures `satisfiedOnce` is set before grace period tests run.

**Tech Stack:** Playwright, JavaScript/ES Modules, GovernanceEngine state machine

---

## Background

The governance tests fail intermittently because:
1. Tests check overlay visibility to determine "unlocked" state
2. But GovernanceEngine requires 500ms continuous zone satisfaction before setting `satisfiedOnce = true`
3. Without `satisfiedOnce`, zone drops go to `pending` instead of `warning`

**Key insight:** The overlay disappears before the governance phase is `unlocked`. Tests must verify the engine state, not just the UI.

**Reference:** `docs/_wip/bugs/2026-02-03-governance-test-flakiness.md`

---

## Task 1: Add Phase Stabilization to unlockVideo()

**Files:**
- Modify: `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs:537-587`

**Step 1: Read the current unlockVideo function**

Verify the current implementation at lines 537-587.

**Step 2: Update unlockVideo to verify governance phase**

Replace the `unlockVideo` function with this implementation:

```javascript
/**
 * Standard unlock sequence - move all devices to target zone
 * Waits for BOTH overlay to disappear AND governance phase to reach 'unlocked'
 */
async function unlockVideo(page, sim, devices, timeline, issues) {
  const recordEvent = (event, data = {}) => {
    timeline.push({ t: Date.now(), event, ...data });
  };

  console.log('\n[UNLOCK] Moving users to target zone...');

  // Ensure all devices are in cool zone first
  for (const device of devices) {
    await sim.setZone(device.deviceId, 'cool');
  }
  await page.waitForTimeout(500);

  // Move to warm zone (target) - all devices at once for faster hysteresis
  for (const device of devices) {
    await sim.setZone(device.deviceId, 'warm');
    console.log(`  Set device ${device.deviceId} to warm zone`);
  }

  // Wait for overlay to disappear AND governance phase to stabilize
  // Must maintain HR through the 500ms hysteresis window
  let unlocked = false;
  let phaseUnlocked = false;

  for (let i = 0; i < 30; i++) {
    // Keep sending HR to maintain zone through hysteresis
    for (const device of devices) {
      await sim.setZone(device.deviceId, 'warm');
    }

    await page.waitForTimeout(100);

    const state = await extractState(page);
    const govState = await extractGovernanceState(page);
    checkForPlaceholders(state, i * 100, issues);

    // Check overlay visibility
    if (!state.visible && !unlocked) {
      unlocked = true;
      recordEvent('OVERLAY_HIDDEN');
      console.log('  Overlay hidden');
    }

    // Check governance phase
    if (govState?.phase === 'unlocked' && !phaseUnlocked) {
      phaseUnlocked = true;
      recordEvent('PHASE_UNLOCKED');
      console.log('  Governance phase: unlocked');
    }

    // Success: both conditions met
    if (unlocked && phaseUnlocked) {
      recordEvent('UNLOCKED');
      console.log('  Video fully unlocked (overlay hidden + phase unlocked)');
      break;
    }

    // Log progress every second
    if (i > 0 && i % 10 === 0) {
      console.log(`  [${i * 100}ms] overlay=${!state.visible}, phase=${govState?.phase}`);
    }
  }

  // Final verification
  const finalGovState = await extractGovernanceState(page);
  if (!phaseUnlocked) {
    console.warn(`  WARNING: Governance phase is '${finalGovState?.phase}', not 'unlocked'`);
    console.warn('  This may cause grace period tests to fail (satisfiedOnce not set)');
  }

  return { unlocked, phaseUnlocked };
}
```

**Step 3: Run the hydration tests to verify unlock still works**

Run: `npx playwright test tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs --grep "hydration" --reporter=line`

Expected: Both hydration tests pass, logs show "Governance phase: unlocked"

**Step 4: Commit**

```bash
git add tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs
git commit -m "fix(tests): wait for governance phase in unlockVideo

The unlockVideo helper was checking overlay visibility but not
verifying the GovernanceEngine phase reached 'unlocked'. This
caused flaky tests because satisfiedOnce was never set.

Now continuously sends HR through the 500ms hysteresis window
and verifies both overlay hidden AND phase === 'unlocked'.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Update Unlock Assertions to Check phaseUnlocked

**Files:**
- Modify: `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs:1068-1069`
- Modify: `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs:1095-1098`

**Step 1: Update hydration test assertions**

Find lines 1068-1069:
```javascript
result = await unlockVideo(page, sim, devices, timeline, issues);
expect(result.unlocked, 'Video should unlock').toBe(true);
```

Replace with:
```javascript
result = await unlockVideo(page, sim, devices, timeline, issues);
expect(result.unlocked, 'Overlay should hide').toBe(true);
expect(result.phaseUnlocked, 'Governance phase should be unlocked').toBe(true);
```

**Step 2: Update challenge/grace setup assertions**

Find lines 1095-1098:
```javascript
const unlockResult = await unlockVideo(page, sim, devices, timeline, issues);
if (!unlockResult.unlocked) {
  throw new Error('FAIL FAST: Could not unlock video for scenario');
}
```

Replace with:
```javascript
const unlockResult = await unlockVideo(page, sim, devices, timeline, issues);
if (!unlockResult.unlocked) {
  throw new Error('FAIL FAST: Overlay did not hide');
}
if (!unlockResult.phaseUnlocked) {
  throw new Error('FAIL FAST: Governance phase did not reach unlocked (satisfiedOnce not set)');
}
```

**Step 3: Run all governance tests**

Run: `npx playwright test tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs --reporter=line`

Expected: All tests should now pass consistently (or fail with clear error about phase not unlocking)

**Step 4: Commit**

```bash
git add tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs
git commit -m "fix(tests): assert governance phase in unlock checks

Unlock verification now requires both overlay hidden AND
governance phase === 'unlocked'. This catches cases where
UI responds before the 500ms hysteresis completes.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Update Grace Period Recovery to Maintain HR

**Files:**
- Modify: `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs:949-952`

**Step 1: Find the grace recovery zone change**

Lines 949-952:
```javascript
// RECOVER - move back to target zone before grace expires
console.log('  Recovering: moving back to target zone...');
for (const device of devices) {
  await sim.setZone(device.deviceId, 'warm');
}
```

**Step 2: Update to maintain HR through recovery**

Replace with:
```javascript
// RECOVER - move back to target zone before grace expires
// Must maintain HR through hysteresis to clear warning state
console.log('  Recovering: moving back to target zone...');
for (let i = 0; i < 10; i++) {
  for (const device of devices) {
    await sim.setZone(device.deviceId, 'warm');
  }
  await page.waitForTimeout(100);
}
```

**Step 3: Run the grace-recover-normal test**

Run: `npx playwright test tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs --grep "grace-recover" --reporter=line`

Expected: PASS with "Returned to normal! Gov phase: unlocked"

**Step 4: Commit**

```bash
git add tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs
git commit -m "fix(tests): maintain HR during grace recovery

Grace period recovery needs to maintain HR through the
hysteresis window to properly transition back to unlocked.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Run Full Test Suite and Verify

**Files:**
- None (verification only)

**Step 1: Run all governance tests 3 times**

Run each command separately:
```bash
npx playwright test tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs --reporter=line
npx playwright test tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs --reporter=line
npx playwright test tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs --reporter=line
```

Expected: All 6 tests pass consistently across all 3 runs

**Step 2: Check for remaining flakiness**

If any test fails:
- Check the console output for "WARNING: Governance phase is..." messages
- Look for timing issues in the hysteresis window
- May need to increase loop counts or wait times

**Step 3: Update bug report status**

If all tests pass, add a "Resolution" section to `docs/_wip/bugs/2026-02-03-governance-test-flakiness.md`:

```markdown
---

## Resolution

**Fixed:** 2026-02-03

**Changes:**
1. `unlockVideo()` now maintains HR through 500ms hysteresis window
2. Tests verify both overlay visibility AND governance phase
3. Grace recovery maintains HR during zone transition

**Commits:**
- [list commit hashes]

**Verification:** All 6 tests pass consistently across multiple runs.
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Update unlockVideo to verify phase | governance-comprehensive.runtime.test.mjs |
| 2 | Update assertions to check phaseUnlocked | governance-comprehensive.runtime.test.mjs |
| 3 | Maintain HR during grace recovery | governance-comprehensive.runtime.test.mjs |
| 4 | Full verification and bug report update | docs/_wip/bugs/... |

**Total estimated steps:** 16 bite-sized actions
