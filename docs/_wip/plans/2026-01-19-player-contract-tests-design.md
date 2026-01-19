# Player Contract Tests Design

**Date:** 2026-01-19
**Status:** Approved for implementation

## Goal

Add lightweight runtime tests that verify prop threading contracts in the Player module, catching bugs like the `resilienceBridge` gap without requiring TypeScript.

## Problem

Audit item #7 identified that props thread through 3-4 component layers with no validation they're actually used:
- `resilienceBridge` was passed Player.jsx → SinglePlayer.jsx → VideoPlayer.jsx
- VideoPlayer ignored it - parent's resilience system was blind
- No static analysis caught this

## Solution

Runtime contract tests that verify observable behavior, not implementation details.

## Contracts to Test

| Contract | Source | Destination | Verification |
|----------|--------|-------------|--------------|
| Playback Metrics | VideoPlayer/AudioPlayer | Player.jsx | Metrics callback receives expected shape |
| Media Element Access | VideoPlayer/AudioPlayer | Player.jsx | getMediaEl() returns actual element |

## Test Design

**File:** `tests/runtime/player/player-contracts.runtime.test.mjs`

**Pattern:** Playwright runtime tests (matches existing `video-playback.runtime.test.mjs`)

### Test 1: Playback Metrics Flow

```javascript
test('VideoPlayer reports playback metrics to parent', async ({ page }) => {
  // Expose test hook to capture metrics
  await page.exposeFunction('captureMetrics', (metrics) => {
    // Store metrics for assertion
  });

  // Inject test hook into app
  await page.addInitScript(() => {
    window.__TEST_CAPTURE_METRICS__ = true;
  });

  // Navigate to player with video
  // Wait for playback
  // Verify metrics were captured with expected shape:
  // { seconds, isPaused, stalled, isSeeking }
});
```

### Test 2: Media Element Access

```javascript
test('Parent can access media element via resilienceBridge', async ({ page }) => {
  // Navigate to player
  // Evaluate: window.__PLAYER_MEDIA_ACCESS__?.getMediaEl()
  // Verify returns element with tagName VIDEO or AUDIO
});
```

## Implementation Notes

1. **Test hooks:** Add minimal `window.__TEST_*` hooks in Player.jsx (dev/test mode only)
2. **No production impact:** Hooks only active when `__TEST_CAPTURE_METRICS__` is set
3. **Scope:** ~50-70 lines of test code

## What This Catches

- Props passed but not wired (like `resilienceBridge` bug)
- Regressions when refactoring prop threading
- Contract violations between components

## What This Doesn't Catch

- Type mismatches (TypeScript domain)
- Props with wrong values but right shape
- Unused props that don't affect behavior

## Files to Create/Modify

| File | Action |
|------|--------|
| `tests/runtime/player/player-contracts.runtime.test.mjs` | CREATE - Contract tests |
| `frontend/src/modules/Player/Player.jsx` | MODIFY - Add test hooks (~5 lines) |
