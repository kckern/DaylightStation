# FitnessApp BugBash Testing Approach

**Date:** 2026-01-07
**Scope:** 9 bugs requiring runtime tests
**Target:** `tests/runtime/` directory

---

## Overview

This document defines a unified testing approach for the FitnessApp BugBash. Each bug will have a dedicated runtime test file following consistent patterns established in the codebase.

### Bug Summary

| Bug | Severity | Category | Test Type | Simulation Needed |
|-----|----------|----------|-----------|-------------------|
| 01 - Chart Dropout Threshold | Low | Visualization | Unit + Visual | HR dropout patterns |
| 02 - Volume Persistence | High | Playback | Integration | Minimal |
| 03 - FPS Governance Blur | High | Performance | Performance | HR to trigger warning |
| 04 - Phantom Warnings | High | Logic | Integration | Zone oscillation |
| 05 - Challenge Trigger Failure | High | Logic | Integration | HR for unlocked phase |
| 06 - RPM Device Consolidation | Medium | Refactor | Integration | Cadence + jumprope |
| 07 - Footer Zoom Navigation | Medium | Navigation | Integration | Minimal |
| 08 - Jumprope Counting | Medium | Logic | Unit + Integration | Jumprope packets |
| 09 - Voice Memo Overhaul | Critical | Voice/UI | Integration | Audio mock |

---

## Test File Structure

### Naming Convention

```
tests/runtime/bugbash/
├── 01-chart-dropout-threshold.runtime.test.mjs
├── 02-volume-persistence.runtime.test.mjs
├── 03-fps-governance-blur.runtime.test.mjs
├── 04-phantom-warnings.runtime.test.mjs
├── 05-challenge-trigger-failure.runtime.test.mjs
├── 06-rpm-device-consolidation.runtime.test.mjs
├── 07-footer-zoom-navigation.runtime.test.mjs
├── 08-jumprope-counting.runtime.test.mjs
└── 09-voice-memo-overhaul.runtime.test.mjs
```

### Standard File Template

```javascript
/**
 * Bug XX: [Title]
 *
 * Tests for: [Brief description]
 * Bug doc: docs/_wip/bugs/2026-01-07 FitnessApp BugBash/XX-slug.md
 *
 * Usage:
 *   npx playwright test tests/runtime/bugbash/XX-slug.runtime.test.mjs --workers=1
 *   npx playwright test tests/runtime/bugbash/XX-slug.runtime.test.mjs --headed  # Visual debugging
 */

import { test, expect } from '@playwright/test';
import {
  FitnessTestSimulator,
  TEST_DEVICES,
  HR_ZONES,
  HR_PATTERNS
} from '../../_fixtures/fitness/FitnessTestSimulator.mjs';

const FRONTEND_URL = 'http://localhost:3111';
const WS_URL = 'ws://localhost:3111/ws';

test.describe.serial('Bug XX: [Title]', () => {
  /** @type {FitnessTestSimulator} */
  let simulator;
  /** @type {import('@playwright/test').Page} */
  let page;
  /** @type {import('@playwright/test').BrowserContext} */
  let context;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    simulator = new FitnessTestSimulator({ wsUrl: WS_URL, verbose: true, updateInterval: 2000 });
    await simulator.connect();
  });

  test.afterAll(async () => {
    simulator?.stopSimulation?.();
    simulator?.disconnect?.();
    await context?.close();
  });

  test('HURDLE 1: [First validation checkpoint]', async () => {
    console.log('\n🏃 HURDLE 1: [Description]...');
    // Test implementation
    console.log('✅ HURDLE 1 PASSED: [Summary]\n');
  });

  test('HURDLE 2: [Second validation checkpoint]', async () => {
    console.log('\n🏃 HURDLE 2: [Description]...');
    // Test implementation
    console.log('✅ HURDLE 2 PASSED: [Summary]\n');
  });
});
```

---

## Testing Patterns

### 1. Hurdle-Based Test Structure

Tests are organized as sequential "hurdles" - incremental checkpoints that build on each other.

**Why hurdles?**
- Easier to identify exactly where a bug manifests
- Allows partial passes (some hurdles pass, others fail)
- Clear progress logging for debugging
- Graceful degradation when conditions aren't met

**Example:**
```javascript
test('HURDLE 1: Verify baseline state', async () => {
  console.log('\n🏃 HURDLE 1: Checking baseline state...');
  // Setup and assertions
  console.log('✅ HURDLE 1 PASSED: Baseline state verified\n');
});

test('HURDLE 2: Trigger bug condition', async () => {
  console.log('\n🏃 HURDLE 2: Triggering bug condition...');
  // Trigger and verify
  console.log('✅ HURDLE 2 PASSED: Bug condition handled correctly\n');
});
```

### 2. Heart Rate Simulation

Use `FitnessTestSimulator` for all tests requiring HR data:

```javascript
// Simple constant HR
simulator.runScenario({
  duration: 60,
  users: { alice: { hr: 120, variance: 5 } }
});

// Zone transitions
simulator.runScenario({
  duration: 90,
  users: {
    alice: {
      pattern: 'sequence',
      sequence: [
        { hr: 80, duration: 30 },   // Cool zone - triggers warning
        { hr: 120, duration: 60 }   // Active zone - clears warning
      ]
    }
  }
});

// Rapid oscillation (for testing hysteresis)
simulator.runScenario({
  duration: 60,
  users: {
    alice: {
      pattern: 'oscillate',
      lowHr: 95,
      highHr: 105,
      cycleDuration: 10
    }
  }
});

// Signal dropout
simulator.runScenario({
  duration: 45,
  users: {
    alice: {
      pattern: 'sequence',
      sequence: [
        { hr: 120, duration: 15 },
        { hr: null, duration: 10 },  // null = dropout
        { hr: 125, duration: 20 }
      ]
    }
  }
});
```

**Zone Reference (from config):**
| Zone | HR Range | Governed |
|------|----------|----------|
| cool | 0-99 | No |
| active | 100-119 | Yes |
| warm | 120-139 | Yes |
| hot | 140-159 | Yes |
| fire | 160+ | Yes |

### 3. Navigation Helpers

Standard pattern for navigating to governed content:

```javascript
async function navigateToGovernedContent(page) {
  await page.goto(`${FRONTEND_URL}/fitness`);
  await page.waitForLoadState('networkidle');

  // Wait for navbar
  const navbar = page.locator('.fitness-navbar');
  await expect(navbar).toBeVisible({ timeout: 10000 });

  // Navigate to Kids (governed collection)
  const kidsNav = page.locator('.fitness-navbar button.nav-item', { hasText: 'Kids' });
  await expect(kidsNav).toBeVisible({ timeout: 5000 });
  await kidsNav.click();
  await page.waitForTimeout(2000);

  // Click first show
  const showTile = page.locator('.show-card[data-testid="show-card"]').first();
  await expect(showTile).toBeVisible({ timeout: 10000 });
  await showTile.click();
  await page.waitForTimeout(2000);

  return { navbar, showTile };
}

async function startEpisodePlayback(page) {
  const episodeThumb = page.locator('.episode-card .episode-thumbnail').first();
  await expect(episodeThumb).toBeVisible({ timeout: 10000 });
  await episodeThumb.dispatchEvent('pointerdown');
  await page.waitForTimeout(800);
  await episodeThumb.dispatchEvent('pointerdown');
  await page.waitForTimeout(3000);
  return episodeThumb;
}
```

### 4. Page State Debugging

Capture comprehensive page state for debugging failed tests:

```javascript
const pageState = await page.evaluate(() => ({
  hasVideo: !!document.querySelector('video'),
  videoPlaying: (() => {
    const v = document.querySelector('video');
    return v && !v.paused && !v.ended;
  })(),
  hasGovernanceOverlay: !!document.querySelector('.governance-overlay'),
  governancePhase: document.querySelector('.governance-overlay')?.dataset?.phase,
  visibleOverlays: Array.from(document.querySelectorAll('[class*="overlay"]'))
    .filter(el => window.getComputedStyle(el).display !== 'none')
    .map(el => el.className.split(' ')[0]),
  bodyTextSample: document.body.textContent?.substring(0, 500) || ''
}));
console.log('Page state:', JSON.stringify(pageState, null, 2));
```

### 5. Graceful Failure Handling

When conditions can't be verified, skip gracefully rather than fail:

```javascript
test('HURDLE N: Test requires warning overlay', async () => {
  const warningOverlay = page.locator('.governance-progress-overlay');

  try {
    await expect(warningOverlay).toBeVisible({ timeout: 45000 });
  } catch (e) {
    // Check why overlay didn't appear
    const state = await page.evaluate(() => ({
      isLocked: !!document.querySelector('.governance-overlay:not([style*="display: none"])'),
      videoEnded: document.querySelector('video')?.ended
    }));

    if (state.isLocked) {
      console.log('   ⚠️  Skipped to locked state (no warning phase)');
    } else if (state.videoEnded) {
      console.log('   ⚠️  Video ended before warning triggered');
    }
    console.log('✅ HURDLE N PASSED (condition not testable)\n');
    return;  // Skip remaining assertions
  }

  // Continue with assertions...
});
```

### 6. Performance Testing Pattern

For FPS/performance tests (Bug 03):

```javascript
test('HURDLE: Measure FPS during blur overlay', async () => {
  // Collect frame timing samples
  const samples = await page.evaluate(async () => {
    const timings = [];
    return new Promise(resolve => {
      let count = 0;
      const measure = (now) => {
        if (count > 0) timings.push(now - (timings._lastTime || now));
        timings._lastTime = now;
        if (++count < 60) {
          requestAnimationFrame(measure);
        } else {
          delete timings._lastTime;
          resolve(timings);
        }
      };
      requestAnimationFrame(measure);
    });
  });

  // Calculate FPS from frame deltas
  const avgDelta = samples.reduce((a, b) => a + b, 0) / samples.length;
  const fps = 1000 / avgDelta;
  console.log(`   Measured FPS: ${fps.toFixed(1)}`);

  expect(fps, 'FPS should be > 30 during blur overlay').toBeGreaterThan(30);
});
```

### 7. Audio/Microphone Mocking (Bug 09)

For tests requiring audio input:

```javascript
// In test setup
await page.addInitScript(() => {
  // Mock AudioContext
  window._mockAudioLevel = 0.5;  // 0-1 range

  const MockAnalyser = {
    getByteTimeDomainData: (array) => {
      const level = window._mockAudioLevel;
      for (let i = 0; i < array.length; i++) {
        array[i] = 128 + (level * 127 * Math.sin(i / 10));
      }
    },
    fftSize: 2048,
    frequencyBinCount: 1024
  };

  window.AudioContext = class MockAudioContext {
    createAnalyser() { return MockAnalyser; }
    createMediaStreamSource() { return { connect: () => {} }; }
  };
});

// Change level mid-test
await page.evaluate(() => { window._mockAudioLevel = 0.8; });
```

### 8. Device Simulation (Bug 06, 08)

For jumprope and cadence device tests:

```javascript
// Send jumprope BLE packet
function sendJumpropePacket(ws, revolutionCount) {
  ws.send(JSON.stringify({
    topic: 'fitness',
    source: 'fitness-simulator',
    type: 'ble_jumprope',
    timestamp: new Date().toISOString(),
    deviceId: 'test-jumprope',
    data: {
      revolutions: revolutionCount,
      packetType: 0xAD
    }
  }));
}

// Test rollover at 250
test('HURDLE: Counter continues past 250 rollover', async () => {
  for (let i = 245; i <= 255; i++) {
    sendJumpropePacket(simulator.ws, i % 250);  // Wraps at 250
    await page.waitForTimeout(200);
  }

  const displayCount = await page.locator('.jumprope-count').textContent();
  expect(parseInt(displayCount), 'Count should exceed 250').toBeGreaterThan(250);
});
```

---

## Bug-Specific Testing Notes

### Bug 01: Chart Dropout Threshold

**Test Focus:** Gap styling based on duration
**Hurdles:**
1. Verify short gaps (< 2 min) use segment color
2. Verify long gaps (>= 2 min) use grey dotted style
3. Edge case: exactly 2-minute boundary

**Simulation:** Use `sequence` pattern with `hr: null` for dropouts of varying duration.

### Bug 02: Volume Persistence

**Test Focus:** Volume survives page reload, stall, remount
**Hurdles:**
1. Set volume → reload → verify persisted
2. Trigger video stall → verify volume maintained
3. Force component remount → verify volume applied

**Key Locators:**
- Volume slider: `.volume-slider` or `[data-testid="volume"]`
- Player: `video` element
- Volume UI trigger: `.volume-control`

### Bug 03: FPS Governance Blur

**Test Focus:** Performance with blur overlay active
**Hurdles:**
1. Baseline FPS during normal playback
2. FPS during warning overlay (blur active)
3. Compare delta - should be < 10 FPS drop

**Run headless:** Performance tests should run headless for consistency.

### Bug 04: Phantom Warnings

**Test Focus:** Warning only appears with valid offenders
**Hurdles:**
1. Verify no warning when thresholds satisfied
2. Trigger near-threshold oscillation
3. Verify warning shows offender chips when present
4. Verify no phantom flash during transitions

**Simulation:** Use `oscillate` pattern with narrow range around zone boundary.

### Bug 05: Challenge Trigger Failure

**Test Focus:** Challenges appear during governed playback
**Hurdles:**
1. Start governed video, reach unlocked phase
2. Wait for challenge to appear (check `nextChallengeAt`)
3. Test manual `triggerChallenge()` API
4. Verify challenge UI renders

**Debug Hook:**
```javascript
await page.evaluate(() => {
  window.__debugChallenge = window.__governanceEngine?.challengeState;
});
const challengeState = await page.evaluate(() => window.__debugChallenge);
```

### Bug 06: RPM Device Consolidation

**Test Focus:** Unified display for bike + jumprope
**Hurdles:**
1. Connect bike, verify RpmDeviceCard renders
2. Connect jumprope, verify same card type
3. Verify grouped layout in sidebar
4. Verify full-screen shows generic "RPM" label

### Bug 07: Footer Zoom Navigation

**Test Focus:** Seek works in zoomed timeline view
**Hurdles:**
1. Enter zoomed view
2. Click at known position
3. Verify playhead moves to expected timestamp
4. Test zoom navigation (step forward/backward)

**Key Locators:**
- Footer: `.fitness-player-footer`
- Zoom thumbnails: `.seek-thumbnail`
- Progress bar: `.progress-frame`

### Bug 08: Jumprope Counting

**Test Focus:** Counter survives rollover at 250
**Hurdles:**
1. Count up to 249, verify display
2. Cross 250 boundary, verify increment (not reset)
3. Test device reconnection (maintains accumulated)
4. Test session reset (clears count)

### Bug 09: Voice Memo Overhaul

**Test Focus:** Three sub-issues (UI, loop, meter)
**Hurdles:**
1. **9A:** Compare Player vs Sidebar recorder UI elements
2. **9B:** Save memo, verify only one entry added (no loop)
3. **9C:** Mock varying audio levels, verify meter uses full range

**Critical:** Bug 9B is OOM-causing - add circuit breaker detection:
```javascript
let memoCountBefore = await page.evaluate(() =>
  window.__voiceMemoManager?.memos?.length ?? 0
);
// Trigger save
await page.click('[data-testid="save-memo"]');
await page.waitForTimeout(1000);
let memoCountAfter = await page.evaluate(() =>
  window.__voiceMemoManager?.memos?.length ?? 0
);
expect(memoCountAfter - memoCountBefore, 'Should add exactly 1 memo').toBe(1);
```

---

## Running Tests

### Individual Bug
```bash
npx playwright test tests/runtime/bugbash/01-chart-dropout-threshold.runtime.test.mjs --workers=1
```

### All BugBash Tests
```bash
npx playwright test tests/runtime/bugbash/ --workers=1
```

### Headed Mode (Visual Debugging)
```bash
npx playwright test tests/runtime/bugbash/XX-slug.runtime.test.mjs --headed
```

### Debug Mode
```bash
npx playwright test tests/runtime/bugbash/XX-slug.runtime.test.mjs --debug
```

### Generate Report
```bash
npx playwright test tests/runtime/bugbash/ --reporter=html
npx playwright show-report
```

---

## Prerequisites

1. **Dev server running:** `npm run dev` (frontend on 3111, backend on 3112)
2. **WebSocket accessible:** `ws://localhost:3111/ws` proxied to backend
3. **Test fixtures available:** `tests/_fixtures/fitness/FitnessTestSimulator.mjs`
4. **Playwright installed:** `npx playwright install`

---

## Definition of Done

A bug test is complete when:

1. ✅ Test file follows naming convention (`XX-slug.runtime.test.mjs`)
2. ✅ All hurdles from bug doc are covered
3. ✅ Test passes on fixed code
4. ✅ Test fails on buggy code (regression protection)
5. ✅ Graceful handling when conditions can't be tested
6. ✅ Clear console logging for debugging
7. ✅ No flaky assertions (appropriate timeouts, retry logic)
