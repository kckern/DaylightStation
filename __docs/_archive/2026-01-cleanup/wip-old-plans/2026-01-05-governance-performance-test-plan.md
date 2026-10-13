# Governance Overlay Performance Test Plan

**Date**: January 5, 2026  
**Related Changes**: Performance optimizations in GovernanceStateOverlay, GovernanceEngine, FitnessPlayerOverlay

---

## Overview

This document outlines the test plan for validating the governance overlay performance optimizations. The tests should verify that:

1. **Visual correctness** - Overlays render correctly with new CSS (transform vs width, no backdrop-filter on chips)
2. **Performance improvement** - Reduced re-renders, smoother animations, lower CPU usage
3. **Functional correctness** - Governance states transition correctly, countdown works, audio plays

---

## End-to-End Test Flow

**TDD Hurdle-Based Approach**: Each step is a pass/fail gate. Failure stops the test. Run iteratively: see where it fails, fix that issue, run again.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  HURDLE 1:  Dev server starts and is healthy                               │
│  HURDLE 2:  Simulator connects to WebSocket                                │
│  HURDLE 3:  Fitness page loads with queue function available               │
│  HURDLE 4:  HR simulation starts (cool zone = 80 bpm)                      │
│  HURDLE 5:  Governed media added to queue (type: movie)                    │
│  HURDLE 6:  Lock overlay appears (HR in cool zone)                         │
│  HURDLE 7:  Lock clears when HR rises to active zone (120 bpm)             │
│  HURDLE 8:  Video starts playing                                           │
│  HURDLE 9:  Baseline FPS measured (>30 fps)                                │
│  HURDLE 10: Warning overlay appears when HR drops to cool zone             │
│  HURDLE 11: FPS acceptable during warning (<30% degradation)               │
│  HURDLE 12: Video locks after grace period expires (30s)                   │
│  HURDLE 13: Video unlocks when HR rises again                              │
│  HURDLE 14: Video resumes playing                                          │
│  HURDLE 15: Final FPS check - performance maintained                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Development Iteration Cycle

```bash
# Run the test
npx playwright test tests/runtime/governance/ --headed

# See output like:
# 🏃 HURDLE 1: Starting dev server...
# ✅ HURDLE 1 PASSED: Dev server is healthy
# 🏃 HURDLE 2: Connecting simulator...
# ✅ HURDLE 2 PASSED: Simulator connected
# 🏃 HURDLE 3: Loading fitness page...
# ✅ HURDLE 3 PASSED: Fitness page loaded
# 🏃 HURDLE 4: Starting HR simulation...
# ❌ HURDLE 4 FAILED: Simulator failed to connect
#
# Fix the issue, run again, repeat until all 15 hurdles pass
```

---

## Test Infrastructure

### FitnessTestSimulator Framework

Location: `tests/_fixtures/fitness/FitnessTestSimulator.mjs`

**Key Features:**

| Feature | Description |
|---------|-------------|
| **Programmable HR** | Constant, ramp, oscillate, sequence patterns |
| **Multi-user** | Test alice, bob, charlie simultaneously |
| **Precise timing** | Control exact HR at each time point |
| **Presets** | `GOVERNANCE_SCENARIOS` for common test cases |
| **Signal dropout** | Test null HR handling |

### Triggering Governed Media Playback

Media is governed when:
- **Label match**: `plex.governed_labels` contains one of the media's labels (e.g., "KidsFun")
- **Type match**: `plex.governed_types` contains the media type (e.g., "movie")

**To start governed media in tests:**

```javascript
// Navigate through the UI to play governed content (Kids collection has KidsFun label)
await navigateToCollection(page, 'Kids');
const showName = await clickFirstShow(page);
await playFirstEpisode(page);
```

### Zone Thresholds (from production config)

| Zone | Min HR | Color | Governance Status |
|------|--------|-------|-------------------|
| cool | 0 | blue | ❌ Below requirement |
| active | 100 | green | ✅ Meets base requirement |
| warm | 120 | yellow | ✅ Meets requirement |
| hot | 140 | orange | ✅ Exceeds requirement |
| fire | 160 | red | ✅ Far exceeds |

**Governance triggers when**: Any participant is in "cool" zone (HR < 100) while governed media is playing.

### Test Device Mapping

Uses test fixtures from `tests/_fixtures/data/households/_test/apps/fitness/config.yml`:

| User Alias | Device ID | User ID |
|------------|-----------|---------|
| alice | 12345 | _alice |
| bob | 12346 | _bob |
| charlie | 12347 | _charlie |

---

## Detailed Test Sequence

### Phase 1: Setup & Initial Lock

```javascript
// 1. Start dev server (handled by beforeAll)
await startDevServer(90000);

// 2. Connect simulator
const simulator = new FitnessTestSimulator({ wsUrl: WS_URL });
await simulator.connect();

// 3. Start LOW HR simulation (below "active" zone)
simulator.runScenario({
  duration: 300,  // Long enough for full test
  users: {
    alice: { hr: 80, variance: 3 },  // Cool zone
    bob: { hr: 85, variance: 3 }     // Cool zone
  }
});

// 4. Navigate to governed media via UI
await page.goto(`${FRONTEND_URL}/fitness`);
await page.waitForLoadState('networkidle');

// Use UI navigation (Kids collection has governed KidsFun label)
await navigateAndPlayGovernedContent(page);

// 5. ASSERT: Lock overlay visible
const lockOverlay = page.locator('.governance-overlay');
await expect(lockOverlay).toBeVisible({ timeout: 10000 });
```

### Phase 2: Unlock & Baseline FPS

```javascript
// 6. Raise HR to "active" zone
simulator.stopSimulation();
await simulator.runScenario({
  duration: 120,
  users: {
    alice: { hr: 110, variance: 5 },  // Active zone
    bob: { hr: 115, variance: 5 }     // Active zone
  }
});

// 7. ASSERT: Lock vanishes, video plays
await expect(lockOverlay).toBeHidden({ timeout: 15000 });

const video = page.locator('video');
await expect(video).toHaveJSProperty('paused', false, { timeout: 10000 });

// 8. Measure baseline FPS
const baselineFPS = await page.evaluate(() => {
  return new Promise((resolve) => {
    let frames = 0;
    let lastTime = performance.now();
    
    function countFrame() {
      frames++;
      const now = performance.now();
      if (now - lastTime >= 2000) {  // 2 second sample
        resolve(frames / 2);
        return;
      }
      requestAnimationFrame(countFrame);
    }
    requestAnimationFrame(countFrame);
  });
});

console.log(`Baseline FPS: ${baselineFPS}`);
expect(baselineFPS).toBeGreaterThan(50);  // Should be near 60fps
```

### Phase 3: Warning Overlay & FPS Impact

```javascript
// 9. Drop ONE user to "cool" zone
simulator.stopSimulation();
await simulator.runScenario({
  duration: 60,
  users: {
    alice: { hr: 110, variance: 5 },  // Still active
    bob: { hr: 80, variance: 3 }      // Dropped to cool → triggers warning
  }
});

// 10. ASSERT: Warning overlay appears
const warningOverlay = page.locator('.governance-progress-overlay');
await expect(warningOverlay).toBeVisible({ timeout: 10000 });

// 11. Measure FPS during warning overlay
const warningFPS = await page.evaluate(() => {
  return new Promise((resolve) => {
    let frames = 0;
    let lastTime = performance.now();
    
    function countFrame() {
      frames++;
      const now = performance.now();
      if (now - lastTime >= 2000) {
        resolve(frames / 2);
        return;
      }
      requestAnimationFrame(countFrame);
    }
    requestAnimationFrame(countFrame);
  });
});

console.log(`Warning overlay FPS: ${warningFPS}`);
const degradation = ((baselineFPS - warningFPS) / baselineFPS) * 100;
console.log(`FPS degradation: ${degradation.toFixed(1)}%`);

// Performance threshold: less than 20% degradation
expect(degradation).toBeLessThan(20);
```

### Phase 4: Lockout & Recovery

```javascript
// 12. Wait for countdown to expire (30 seconds)
await page.waitForTimeout(35000);

// 13. ASSERT: Video locked overlay appears
const videoLockedOverlay = page.locator('.governance-overlay');
await expect(videoLockedOverlay).toBeVisible();

// Verify video is paused
await expect(video).toHaveJSProperty('paused', true);

// 14. Raise ALL users to "active" zone
simulator.stopSimulation();
await simulator.runScenario({
  duration: 60,
  users: {
    alice: { hr: 120, variance: 5 },
    bob: { hr: 125, variance: 5 }
  }
});

// 15. ASSERT: Lock vanishes, video resumes
await expect(videoLockedOverlay).toBeHidden({ timeout: 15000 });
await expect(video).toHaveJSProperty('paused', false, { timeout: 10000 });

// 16. Measure resumed FPS
const resumedFPS = await measureFPS(page);
console.log(`Resumed playback FPS: ${resumedFPS}`);
expect(resumedFPS).toBeGreaterThan(50);
```

### Phase 5: Teardown

```javascript
// 17. Cleanup
simulator.stopSimulation();
simulator.disconnect();
// Dev server cleanup handled by afterAll
```

---

## FitnessTestSimulator Usage

---

## FitnessTestSimulator Usage

### Basic Usage

```javascript
import { FitnessTestSimulator } from '../../_fixtures/fitness/FitnessTestSimulator.mjs';

const simulator = new FitnessTestSimulator({ wsUrl: 'ws://localhost:3112/ws' });
await simulator.connect();

// Simple constant HR
await simulator.runScenario({
  duration: 30,
  users: { alice: { hr: 95, variance: 3 } }
});

simulator.disconnect();
```

### Pattern Types

#### 1. Constant HR
```javascript
{ hr: 120, variance: 5 }  // 120 ± 5 bpm
```

#### 2. Ramp (warm-up/cooldown)
```javascript
{
  pattern: 'ramp',
  startHr: 90,
  endHr: 160,
  variance: 3
}
```

#### 3. Oscillate (intervals)
```javascript
{
  pattern: 'oscillate',
  lowHr: 80,
  highHr: 130,
  cycleDuration: 30  // seconds per cycle
}
```

#### 4. Sequence (precise control)
```javascript
{
  pattern: 'sequence',
  sequence: [
    { hr: 80, duration: 30 },   // Cool zone for 30s (triggers lock)
    { hr: 120, duration: 60 },  // Active zone for 60s (unlocks)
    { hr: null, duration: 10 }, // Signal dropout
    { hr: 110, duration: 20 }   // Recovery
  ]
}
```

### Pre-built Governance Scenarios

```javascript
import { GOVERNANCE_SCENARIOS } from '../../_fixtures/fitness/FitnessTestSimulator.mjs';

// Available scenarios (updated for production zone thresholds):
GOVERNANCE_SCENARIOS.warningAndClear   // 80 bpm → 120 bpm (triggers warning, then clears)
GOVERNANCE_SCENARIOS.lockout           // Stay at 80 bpm until lockout
GOVERNANCE_SCENARIOS.mixedCompliance   // Alice: 120 bpm (OK), Bob: 80 bpm (not OK)
GOVERNANCE_SCENARIOS.rapidTransitions  // Fast 80↔120 cycling
GOVERNANCE_SCENARIOS.allCompliant      // All users ≥100 bpm
GOVERNANCE_SCENARIOS.signalDropout     // HR signal loss mid-session
```

---

## Automated Test Implementation

**File**: `tests/runtime/governance/governance-performance.runtime.test.mjs`

### TDD Hurdle Structure

Tests use `test.describe.serial()` to run sequentially - failure on any hurdle stops the suite:

```javascript
test.describe.serial('Governance Hurdle Tests', () => {
  let simulator;
  let testContext = { baselineFPS: null, warningFPS: null };

  test('HURDLE 1: Dev server starts and is healthy', async () => {
    console.log('\n🏃 HURDLE 1: Starting dev server...');
    await startDevServer(90000);
    const response = await fetch(`${BACKEND_URL}/health`);
    expect(response.ok, 'Backend health check failed').toBe(true);
    console.log('✅ HURDLE 1 PASSED\n');
  });

  test('HURDLE 2: Simulator connects to WebSocket', async () => {
    console.log('\n🏃 HURDLE 2: Connecting simulator...');
    simulator = new FitnessTestSimulator({ wsUrl: WS_URL });
    await simulator.connect();
    expect(simulator.connected).toBe(true);
    console.log('✅ HURDLE 2 PASSED\n');
  });

  // ... hurdles 3-15 ...

  test.afterAll(async () => {
    console.log('🎉 ALL HURDLES PASSED!');
  });
});
```

### Hurdle Summary

| # | Hurdle | Pass Condition | Common Fix if Fails |
|---|--------|----------------|---------------------|
| 1 | Dev server healthy | `/health` returns 200 | Check `npm run dev`, ports |
| 2 | Simulator connects | WebSocket opens | Check WS_URL, backend running |
| 3 | Page loads | `addToFitnessQueue` exists | Check FitnessApp mounts |
| 4 | HR simulation | Data flows to backend | Check device config |
| 5 | Queue media | Media added | Check queue function |
| 6 | Lock appears | `.governance-overlay` visible | Check governed_types config |
| 7 | Lock clears | Overlay hidden when HR ≥100 | Check zone thresholds |
| 8 | Video plays | `video.paused === false` | Check autoplay policy |
| 9 | Baseline FPS | >30 fps | Browser/hardware issue |
| 10 | Warning appears | Progress overlay visible | Check grace period logic |
| 11 | FPS during warning | <30% degradation | Performance optimization needed |
| 12 | Lockout | Lock after 30s grace | Check grace_period_seconds |
| 13 | Unlock again | Overlay clears | Check re-evaluation logic |
| 14 | Resume play | Video unpaused | Check pause/resume handling |
| 15 | Final FPS | >30 fps maintained | Check for memory leaks |

### Running the Hurdle Test

```bash
# Run with visual browser (recommended for debugging)
npx playwright test tests/runtime/governance/ --headed

# Run specific hurdle range (debug one section)
npx playwright test tests/runtime/governance/ -g "HURDLE [1-5]"

# Run with verbose output
npx playwright test tests/runtime/governance/ --reporter=list

# Run with trace on failure (for debugging)
npx playwright test tests/runtime/governance/ --trace on
```

### Expected Output

```
Running 15 tests using 1 worker

🏃 HURDLE 1: Starting dev server...
✅ HURDLE 1 PASSED: Dev server is healthy

🏃 HURDLE 2: Connecting simulator...
✅ HURDLE 2 PASSED: Simulator connected

🏃 HURDLE 3: Loading fitness page...
✅ HURDLE 3 PASSED: Fitness page loaded with queue function

🏃 HURDLE 4: Starting HR simulation (cool zone = 80 bpm)...
   HR simulation running at 80 bpm (cool zone)
✅ HURDLE 4 PASSED: HR simulation started

🏃 HURDLE 5: Adding governed media (type=movie)...
✅ HURDLE 5 PASSED: Governed media queued

🏃 HURDLE 6: Checking for lock overlay (HR=80, cool zone)...
   Lock overlay visible: true
✅ HURDLE 6 PASSED: Governance overlay appeared

🏃 HURDLE 7: Raising HR to active zone (120 bpm)...
✅ HURDLE 7 PASSED: Lock cleared when HR rose

... continues through HURDLE 15 ...

═══════════════════════════════════════════════════════════════
🎉 ALL HURDLES PASSED - Governance lifecycle working correctly!
═══════════════════════════════════════════════════════════════
```

---

## Manual Testing Checklist

### Visual Inspection

| Item | Pass/Fail | Notes |
|------|-----------|-------|
| Progress bar smooth animation | | |
| No blur on offender chips | | |
| Countdown decrements correctly | | |
| Offender avatars load | | |
| Zone colors display correctly | | |
| Panel transparency looks correct | | |

### Performance Verification

| Item | Target | Actual | Pass/Fail |
|------|--------|--------|-----------|
| Frame rate during overlay | 60fps | | |
| CPU usage during overlay | <30% | | |
| No visible jank | N/A | | |
| Countdown smooth | N/A | | |

### Browser DevTools Verification

1. **React DevTools → Profiler**:
   - Record during governance state changes
   - Verify `GovernanceWarningOverlay` not re-rendering excessively
   - Check highlight updates show minimal component tree changes

2. **Chrome DevTools → Performance**:
   - No long layout/paint tasks
   - Smooth frame timeline
   - No excessive scripting during overlay

3. **Chrome DevTools → Layers** (More Tools → Layers):
   - Progress bars should be on separate compositor layer
   - Verify `will-change: transform` creates layer

---

## Regression Tests

Ensure these existing behaviors still work:

- [ ] Session starts correctly with governance enabled
- [ ] Challenge overlays work independently
- [ ] Voice memo overlay unaffected
- [ ] Fullscreen vitals overlay unaffected
- [ ] Audio continues after overlay dismissed
- [ ] Session saves complete correctly

---

## Running the Tests

```bash
# Run just governance tests
npx playwright test tests/runtime/governance/ --headed

# Run with debug logging
DEBUG=pw:api npx playwright test tests/runtime/governance/

# Run with specific browser
npx playwright test tests/runtime/governance/ --project=chromium

# Generate report
npx playwright test tests/runtime/governance/ --reporter=html
```

---

## Success Criteria

| Criterion | Threshold |
|-----------|-----------|
| No visual regressions | 100% checklist pass |
| Long tasks during overlay | <100ms each |
| React re-renders | <5/sec for overlay components |
| State cache hit rate | >80% |
| No console errors | 0 errors |
| All automated tests pass | 100% |

---

## Files Changed in Optimization

| File | Changes |
|------|---------|
| `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx` | React.memo, transform:scaleX |
| `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.scss` | CSS containment, transform animations, removed extra blur |
| `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceAudioPlayer.jsx` | New lightweight audio component |
| `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx` | Stabilized useCallback refs |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | State caching with throttle |
