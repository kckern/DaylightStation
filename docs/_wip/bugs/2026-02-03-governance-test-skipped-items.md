# Bug Report: Skipped Governance Tests - RESOLVED

**Date:** 2026-02-03
**Updated:** 2026-02-03
**Status:** RESOLVED - All tests now pass
**Component:** Governance Test Suite
**Test File:** `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs`

---

## Executive Summary

Two governance tests were originally skipped. Both have been fixed.

| Test | Status | Fix |
|------|--------|-----|
| `hydration-video-first` | **FIXED** | Clear HR data before observing empty state |
| `challenge-fail-recover` | **FIXED** | Use universal HR values for per-user thresholds |

**Current Results:** 6 passed, 0 skipped, 0 failed

---

## Issue 1: hydration-video-first (FIXED)

### Original Problem

The test tried to observe the "waiting" state (empty lock screen) before HR data arrives, but the UI often hydrated too quickly because HR data was already present from previous test runs or pre-populated config.

### Root Cause

HR simulation data persisted between test runs. When the test navigated to governed content, devices already had HR data, causing immediate hydration.

### Fix Applied

Added `sim.stopAll()` at the start of the scenario to clear all HR data BEFORE waiting for the empty state:

```javascript
// CRITICAL: Stop all devices and clear HR data BEFORE waiting for empty state
console.log('\n[VIDEO-FIRST] Clearing all device HR data first...');
await sim.stopAll();
await page.waitForTimeout(500); // Allow state to propagate
```

This ensures the lock screen appears in its empty "waiting" state, then HR data is sent to observe the population flow.

---

## Issue 2: challenge-fail-recover (FIXED)

### Original Problem

Only 1 of 5 users' zones appeared to update when recovering from challenge failure:

```
UserZones: [kckern:hot, felix:warm, milo:warm, alan:warm, soren:warm]
```

### Root Cause

**Per-user zone thresholds**, not WebSocket propagation issues.

Each user has age-adjusted zone thresholds:
- **Adults (kckern)**: hot threshold = 170 BPM
- **Children (felix, milo)**: hot threshold = 180 BPM

The simulator's `setZone('hot')` sends ~175 BPM, which puts adults in 'hot' but children only in 'warm'.

### Fix Applied

1. Added universal HR constants that work for ALL users:

```javascript
const UNIVERSAL_HR = {
  cool: 70,
  active: 115,
  warm: 155,
  hot: 185,    // Above highest hot threshold (180)
  fire: 195
};
```

2. Modified `unlockVideo()` to support direct HR values:

```javascript
async function unlockVideo(page, sim, devices, timeline, issues, targetZone = 'warm', useUniversalHR = false)
```

3. For challenge recovery, use universal HR:

```javascript
const unlockResult = await unlockVideo(page, sim, devices, timeline, issues, 'hot', true);
```

---

## Test Results

```bash
npx playwright test tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs
```

```
  6 passed (2.2m)
```

| Test | Result |
|------|--------|
| hydration-hr-first | PASSED |
| hydration-video-first | PASSED |
| challenge-success | PASSED |
| challenge-fail-recover | PASSED |
| grace-expire-lock | PASSED |
| grace-recover-normal | PASSED |

---

## Key Learnings

### Per-User Zone Thresholds

Zone thresholds vary by user age/profile. When testing scenarios that require all users to reach a specific zone, use raw HR values (via `sim.setHR()`) that exceed the highest threshold across all users, rather than relying on `sim.setZone()` which uses a single HR value.

### Test Isolation

Tests that observe initial UI states should clear any persistent data (HR values, device registrations) before navigating to ensure clean slate observation.

---

## Files Modified

- `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs`
  - Added `UNIVERSAL_HR` constants
  - Added `sim.stopAll()` in `runHydrationVideoFirst()` before observing empty state
  - Modified `unlockVideo()` to support `useUniversalHR` parameter
  - Removed skip from both scenarios
