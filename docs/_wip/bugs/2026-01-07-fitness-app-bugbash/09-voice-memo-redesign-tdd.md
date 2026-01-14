# Voice Memo Redesign - Test-Driven Development Plan

**Date:** 2026-01-08
**Priority:** Critical
**Approach:** Test-Driven Development (Red-Green-Refactor)

---

## Executive Summary

Two critical issues require resolution:

1. **Video/Music Pause Broken:** Recording starts but media continues playing
2. **UX Disaster:** Floating panel is disjointed, often hidden, amateur layout

This document defines the **tests first**, then the minimal implementation to pass them.

---

## Problem Analysis

### Issue 1: Media Pause Not Working

**Current Code Flow:**
```
VoiceMemoOverlay.jsx
  └─ useVoiceMemoRecorder({ playerRef, onPauseMusic, onResumeMusic })
       └─ startRecording()
            └─ pauseMediaIfNeeded(playerRef, wasPlayingRef)  // LINE 300
            └─ onPauseMusic?.()                              // LINE 302-303
```

**Root Causes:**

1. **playerRef API mismatch:** `pauseMediaIfNeeded` calls `api.pause()` but the DaylightPlayer may use a different API
2. **Playback state check fails:** `resolvePlaybackState()` tries multiple paths but may return `null`
3. **Music player ref not connected:** `musicPlayerRef.current` in FitnessContext may be null

**Evidence from code:**
- `useVoiceMemoRecorder.js:46-52`: Checks `playbackState.isPaused === false` but player might use `.paused` property
- `FitnessContext.jsx:764-769`: `pauseMusicPlayer` calls `musicPlayerRef.current?.pause?.()` but ref may never be assigned

### Issue 2: UX Problems

**Current Layout (VoiceMemoOverlay.scss):**
```scss
.voice-memo-overlay {
  position: absolute;
  bottom: 10%;
  left: 50%;
  transform: translateX(-50%);
  width: 38%;
  height: 42%;
}
```

**Problems:**
- Fixed percentages don't adapt to content
- Panel floats over video, obscured by other overlays (governance, challenge)
- Three-mode state machine (list/review/redo) is confusing
- No visual hierarchy - user doesn't know where to look
- Recording flow requires too many taps

---

## TDD Test Specifications

### Test Suite 1: Media Pause/Resume

These tests define the **required behavior**. Implementation must make them pass.

```javascript
// tests/unit/voice-memo/media-pause.test.js

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useVoiceMemoRecorder from '@/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder';

describe('Voice Memo Media Pause', () => {
  let mockPlayerRef;
  let mockPauseMusic;
  let mockResumeMusic;
  let mockMediaStream;

  beforeEach(() => {
    // Mock video player API
    mockPlayerRef = {
      current: {
        pause: vi.fn(),
        play: vi.fn(),
        getPlaybackState: vi.fn(() => ({ isPaused: false })),
        // Alternative API shapes the code must handle
        paused: false,
      }
    };

    mockPauseMusic = vi.fn();
    mockResumeMusic = vi.fn();

    // Mock getUserMedia
    mockMediaStream = {
      getTracks: () => [{ stop: vi.fn() }]
    };

    global.navigator.mediaDevices = {
      getUserMedia: vi.fn(() => Promise.resolve(mockMediaStream))
    };

    // Mock MediaRecorder
    global.MediaRecorder = vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      ondataavailable: null,
      onstop: null,
      state: 'inactive'
    }));

    // Mock AudioContext
    global.AudioContext = vi.fn(() => ({
      createAnalyser: () => ({
        fftSize: 256,
        frequencyBinCount: 128,
        getByteTimeDomainData: vi.fn()
      }),
      createMediaStreamSource: () => ({
        connect: vi.fn()
      }),
      close: vi.fn()
    }));
  });

  test('RED: pauses video when recording starts', async () => {
    const { result } = renderHook(() => useVoiceMemoRecorder({
      playerRef: mockPlayerRef,
      onPauseMusic: mockPauseMusic,
      onResumeMusic: mockResumeMusic
    }));

    await act(async () => {
      await result.current.startRecording();
    });

    expect(mockPlayerRef.current.pause).toHaveBeenCalledTimes(1);
  });

  test('RED: pauses music when recording starts', async () => {
    const { result } = renderHook(() => useVoiceMemoRecorder({
      playerRef: mockPlayerRef,
      onPauseMusic: mockPauseMusic,
      onResumeMusic: mockResumeMusic
    }));

    await act(async () => {
      await result.current.startRecording();
    });

    expect(mockPauseMusic).toHaveBeenCalledTimes(1);
  });

  test('RED: resumes video when recording stops (if was playing)', async () => {
    mockPlayerRef.current.getPlaybackState = vi.fn(() => ({ isPaused: false }));

    const { result } = renderHook(() => useVoiceMemoRecorder({
      playerRef: mockPlayerRef,
      onPauseMusic: mockPauseMusic,
      onResumeMusic: mockResumeMusic
    }));

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      result.current.stopRecording();
    });

    expect(mockPlayerRef.current.play).toHaveBeenCalledTimes(1);
  });

  test('RED: resumes music when recording stops', async () => {
    const { result } = renderHook(() => useVoiceMemoRecorder({
      playerRef: mockPlayerRef,
      onPauseMusic: mockPauseMusic,
      onResumeMusic: mockResumeMusic
    }));

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      result.current.stopRecording();
    });

    expect(mockResumeMusic).toHaveBeenCalledTimes(1);
  });

  test('RED: does NOT resume video if it was already paused', async () => {
    mockPlayerRef.current.getPlaybackState = vi.fn(() => ({ isPaused: true }));
    mockPlayerRef.current.paused = true;

    const { result } = renderHook(() => useVoiceMemoRecorder({
      playerRef: mockPlayerRef,
      onPauseMusic: mockPauseMusic,
      onResumeMusic: mockResumeMusic
    }));

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      result.current.stopRecording();
    });

    expect(mockPlayerRef.current.play).not.toHaveBeenCalled();
  });

  test('RED: handles player with only .paused property (no getPlaybackState)', async () => {
    mockPlayerRef.current.getPlaybackState = undefined;
    mockPlayerRef.current.paused = false;

    const { result } = renderHook(() => useVoiceMemoRecorder({
      playerRef: mockPlayerRef,
      onPauseMusic: mockPauseMusic,
      onResumeMusic: mockResumeMusic
    }));

    await act(async () => {
      await result.current.startRecording();
    });

    expect(mockPlayerRef.current.pause).toHaveBeenCalledTimes(1);
  });

  test('RED: handles null playerRef gracefully', async () => {
    const { result } = renderHook(() => useVoiceMemoRecorder({
      playerRef: { current: null },
      onPauseMusic: mockPauseMusic,
      onResumeMusic: mockResumeMusic
    }));

    // Should not throw
    await act(async () => {
      await result.current.startRecording();
    });

    expect(mockPauseMusic).toHaveBeenCalledTimes(1);
  });
});
```

### Test Suite 2: UI Layout & Flow

```javascript
// tests/runtime/voice-memo/voice-memo-ui.runtime.test.mjs

import { test, expect } from '@playwright/test';

const FRONTEND_URL = 'http://localhost:3111';

test.describe('Voice Memo UI & Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness`);
    await page.waitForLoadState('networkidle');
    // Navigate to a fitness show with video
    const showCard = page.locator('.show-card').first();
    await showCard.click();
    await page.waitForTimeout(1000);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VISIBILITY TESTS - Panel must be visible and not obscured
  // ═══════════════════════════════════════════════════════════════════════════

  test('RED: voice memo panel is fully visible when opened', async ({ page }) => {
    // Click record button
    const recordBtn = page.locator('.media-record-btn');
    await recordBtn.click();

    // Panel should exist
    const panel = page.locator('.voice-memo-overlay__panel');
    await expect(panel).toBeVisible({ timeout: 3000 });

    // Panel should be within viewport
    const box = await panel.boundingBox();
    const viewport = page.viewportSize();

    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  });

  test('RED: voice memo panel has higher z-index than governance overlay', async ({ page }) => {
    // This test requires governance to be active
    // The voice memo should appear ABOVE governance warnings
    const recordBtn = page.locator('.media-record-btn');
    await recordBtn.click();

    const voicePanel = page.locator('.voice-memo-overlay');
    const zIndex = await voicePanel.evaluate(el =>
      parseInt(window.getComputedStyle(el).zIndex, 10)
    );

    // Voice memo z-index should be > 100 (governance uses ~60)
    expect(zIndex).toBeGreaterThan(100);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ONE-TAP RECORDING - Reduce friction
  // ═══════════════════════════════════════════════════════════════════════════

  test('RED: single tap on record button starts recording immediately', async ({ page }) => {
    // Mock microphone permission
    await page.context().grantPermissions(['microphone']);

    const recordBtn = page.locator('.media-record-btn');
    await recordBtn.click();

    // Should see recording indicator within 2 seconds (not a mode selection screen)
    const recordingIndicator = page.locator('[data-recording="true"], .voice-memo-overlay__hint--recording');
    await expect(recordingIndicator).toBeVisible({ timeout: 2000 });
  });

  test('RED: recording state is clearly indicated', async ({ page }) => {
    await page.context().grantPermissions(['microphone']);

    const recordBtn = page.locator('.media-record-btn');
    await recordBtn.click();

    // Wait for recording to start
    await page.waitForTimeout(1000);

    // Should see: timer, stop button, mic level indicator
    const timer = page.locator('.voice-memo-overlay__recording-time');
    const stopBtn = page.locator('.voice-memo-overlay__record-btn--active');
    const micLevel = page.locator('.voice-memo-overlay__mic-level');

    await expect(timer).toBeVisible();
    await expect(stopBtn).toBeVisible();
    await expect(micLevel).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SIMPLIFIED FLOW - Remove unnecessary modes
  // ═══════════════════════════════════════════════════════════════════════════

  test('RED: after recording, shows accept/redo/delete (no list screen)', async ({ page }) => {
    await page.context().grantPermissions(['microphone']);

    const recordBtn = page.locator('.media-record-btn');
    await recordBtn.click();

    // Wait for recording, then stop
    await page.waitForTimeout(2000);
    const stopBtn = page.locator('.voice-memo-overlay__record-btn--active');
    await stopBtn.click();

    // Wait for processing
    await page.waitForTimeout(3000);

    // Should show review buttons, not a list
    const keepBtn = page.locator('.voice-memo-overlay__icon-btn--keep');
    const redoBtn = page.locator('.voice-memo-overlay__icon-btn--redo');
    const deleteBtn = page.locator('.voice-memo-overlay__icon-btn--delete');

    await expect(keepBtn).toBeVisible();
    await expect(redoBtn).toBeVisible();
    await expect(deleteBtn).toBeVisible();
  });

  test('RED: accept closes overlay and returns to video', async ({ page }) => {
    await page.context().grantPermissions(['microphone']);

    // Record and stop
    const recordBtn = page.locator('.media-record-btn');
    await recordBtn.click();
    await page.waitForTimeout(2000);

    const stopBtn = page.locator('.voice-memo-overlay__record-btn--active');
    await stopBtn.click();
    await page.waitForTimeout(3000);

    // Accept
    const keepBtn = page.locator('.voice-memo-overlay__icon-btn--keep');
    await keepBtn.click();

    // Overlay should close
    const overlay = page.locator('.voice-memo-overlay');
    await expect(overlay).not.toBeVisible({ timeout: 1000 });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RESPONSIVE DESIGN - Works on all screen sizes
  // ═══════════════════════════════════════════════════════════════════════════

  test('RED: panel is usable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE

    const recordBtn = page.locator('.media-record-btn');
    await expect(recordBtn).toBeVisible();
    await recordBtn.click();

    const panel = page.locator('.voice-memo-overlay__panel');
    await expect(panel).toBeVisible();

    // Panel should not exceed screen width
    const box = await panel.boundingBox();
    expect(box.width).toBeLessThanOrEqual(375);
  });

  test('RED: buttons are touch-target sized on mobile (min 44px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.context().grantPermissions(['microphone']);

    const recordBtn = page.locator('.media-record-btn');
    await recordBtn.click();

    // Check stop button size
    await page.waitForTimeout(1000);
    const stopBtn = page.locator('.voice-memo-overlay__record-btn--active');
    const box = await stopBtn.boundingBox();

    // Touch targets should be at least 44x44
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ESCAPE HATCH - User can always cancel
  // ═══════════════════════════════════════════════════════════════════════════

  test('RED: ESC key closes overlay at any point', async ({ page }) => {
    const recordBtn = page.locator('.media-record-btn');
    await recordBtn.click();

    const overlay = page.locator('.voice-memo-overlay');
    await expect(overlay).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(overlay).not.toBeVisible({ timeout: 500 });
  });

  test('RED: clicking outside panel closes overlay', async ({ page }) => {
    const recordBtn = page.locator('.media-record-btn');
    await recordBtn.click();

    const overlay = page.locator('.voice-memo-overlay');
    await expect(overlay).toBeVisible();

    // Click on the overlay backdrop (not the panel)
    await page.mouse.click(10, 10);

    await expect(overlay).not.toBeVisible({ timeout: 500 });
  });
});
```

### Test Suite 3: Integration - Media Actually Pauses

```javascript
// tests/runtime/voice-memo/media-pause-integration.runtime.test.mjs

import { test, expect } from '@playwright/test';

const FRONTEND_URL = 'http://localhost:3111';

test.describe('Voice Memo Media Pause Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness`);
    await page.waitForLoadState('networkidle');

    // Navigate to show and start video
    const collectionNav = page.locator('.nav-item.nav-item--plex_collection').first();
    await collectionNav.click();
    await page.waitForTimeout(1000);

    const showCard = page.locator('.show-card').first();
    await showCard.click();
    await page.waitForTimeout(1000);

    const episodeThumbnail = page.locator('.episode-card .episode-thumbnail').first();
    await episodeThumbnail.dispatchEvent('pointerdown');
    await page.waitForTimeout(1000);

    // Wait for video to start playing
    const video = page.locator('video').first();
    await expect(video).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
  });

  test('RED: video actually pauses when recording starts', async ({ page }) => {
    await page.context().grantPermissions(['microphone']);

    const video = page.locator('video').first();

    // Verify video is playing
    const initialPaused = await video.evaluate(v => v.paused);
    expect(initialPaused).toBe(false);

    // Start recording
    const recordBtn = page.locator('.media-record-btn');
    await recordBtn.click();

    // Wait for recording to start
    await page.waitForTimeout(1000);

    // Video should now be paused
    const pausedDuringRecording = await video.evaluate(v => v.paused);
    expect(pausedDuringRecording).toBe(true);
  });

  test('RED: video resumes when recording stops', async ({ page }) => {
    await page.context().grantPermissions(['microphone']);

    const video = page.locator('video').first();

    // Start recording
    const recordBtn = page.locator('.media-record-btn');
    await recordBtn.click();
    await page.waitForTimeout(1000);

    // Stop recording
    const stopBtn = page.locator('.voice-memo-overlay__record-btn--active');
    await stopBtn.click();
    await page.waitForTimeout(500);

    // Video should resume
    const pausedAfterStop = await video.evaluate(v => v.paused);
    expect(pausedAfterStop).toBe(false);
  });

  test('RED: video does NOT resume if it was paused before recording', async ({ page }) => {
    await page.context().grantPermissions(['microphone']);

    const video = page.locator('video').first();

    // Pause video first
    await video.evaluate(v => v.pause());
    await page.waitForTimeout(500);
    expect(await video.evaluate(v => v.paused)).toBe(true);

    // Start and stop recording
    const recordBtn = page.locator('.media-record-btn');
    await recordBtn.click();
    await page.waitForTimeout(1000);

    const stopBtn = page.locator('.voice-memo-overlay__record-btn--active');
    await stopBtn.click();
    await page.waitForTimeout(500);

    // Video should still be paused (not auto-resumed)
    const stillPaused = await video.evaluate(v => v.paused);
    expect(stillPaused).toBe(true);
  });
});
```

---

## Implementation Plan

### Phase 1: Fix Media Pause (Unit Tests First)

**Step 1: Run existing tests, watch them fail**
```bash
npm run test:unit tests/unit/voice-memo/media-pause.test.js
```

**Step 2: Fix `resolvePlaybackState` to handle all player API shapes**

```javascript
// useVoiceMemoRecorder.js - Line 19-25

const resolvePlaybackState = (api) => {
  if (!api) return null;

  // Try multiple API patterns
  // Pattern 1: getPlaybackState() method
  const direct = api.getPlaybackState?.();
  if (direct) return direct;

  // Pattern 2: Direct .paused property (native video element)
  if (typeof api.paused === 'boolean') {
    return { isPaused: api.paused };
  }

  // Pattern 3: MediaController pattern
  const controller = api.getMediaController?.();
  if (controller) {
    if (typeof controller.paused === 'boolean') {
      return { isPaused: controller.paused };
    }
    return controller?.getPlaybackState?.() || controller?.transport?.getPlaybackState?.() || null;
  }

  return null;
};
```

**Step 3: Fix `pauseMediaIfNeeded` to call correct method**

```javascript
// useVoiceMemoRecorder.js - Line 40-53

const pauseMediaIfNeeded = (playerRef, wasPlayingRef) => {
  const api = playerRef?.current;
  if (!api) {
    wasPlayingRef.current = false;
    return;
  }

  const playbackState = resolvePlaybackState(api);
  const isCurrentlyPlaying = playbackState?.isPaused === false;

  if (isCurrentlyPlaying) {
    wasPlayingRef.current = true;
    // Try both pause APIs
    if (typeof api.pause === 'function') {
      api.pause();
    } else if (api.getMediaController?.()?.pause) {
      api.getMediaController().pause();
    }
    return;
  }
  wasPlayingRef.current = false;
};
```

**Step 4: Run tests, verify green**
```bash
npm run test:unit tests/unit/voice-memo/media-pause.test.js
# All should pass
```

### Phase 2: Fix UI Layout (Runtime Tests First)

**Step 1: Run layout tests, watch them fail**
```bash
npx playwright test tests/runtime/voice-memo/voice-memo-ui.runtime.test.mjs --headed
```

**Step 2: Redesign SCSS for proper positioning**

```scss
// VoiceMemoOverlay.scss - REDESIGN

.voice-memo-overlay {
  // Full-screen backdrop
  position: fixed;
  inset: 0;
  z-index: 200; // Above governance (60), above challenges (100)
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;

  &__panel {
    position: relative;
    width: min(90vw, 400px);
    max-height: 70vh;
    background: rgba(13, 18, 28, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 1.5rem;
    padding: 1.5rem;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(20px);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  // Recording mode: centered, minimal
  &--redo &__panel {
    align-items: center;
    text-align: center;
  }

  // Mobile: bottom sheet
  @media (max-width: 640px) {
    align-items: flex-end;

    &__panel {
      width: 100%;
      max-width: 100%;
      max-height: 60vh;
      border-radius: 1.5rem 1.5rem 0 0;
      margin: 0;
    }
  }
}
```

**Step 3: Add click-outside-to-close behavior**

```jsx
// VoiceMemoOverlay.jsx - Add backdrop click handler

const handleBackdropClick = useCallback((e) => {
  // Only close if clicking directly on backdrop, not panel
  if (e.target === e.currentTarget) {
    handleClose();
  }
}, [handleClose]);

return (
  <div
    ref={overlayRef}
    className={`voice-memo-overlay voice-memo-overlay--${mode}`}
    onClick={handleBackdropClick}
    // ... rest
  >
```

**Step 4: Run tests, verify green**
```bash
npx playwright test tests/runtime/voice-memo/voice-memo-ui.runtime.test.mjs --headed
```

### Phase 3: Simplify User Flow

**Current flow:** Record button → "redo" mode → recording → stop → "review" mode → accept
**Target flow:** Record button → recording → stop → review → accept/close

The key change: **Remove the "list" mode as default**. Go straight to recording.

```jsx
// FitnessVoiceMemo.jsx - Change handler

const handleStartRecording = useCallback(() => {
  // Go directly to capture mode, not list
  fitnessCtx?.openVoiceMemoCapture?.(null, { autoAccept: true });
}, [fitnessCtx]);
```

---

## Test Execution Order

Following TDD, run tests in this order:

```bash
# 1. Unit tests for media pause (should fail initially)
npm run test:unit tests/unit/voice-memo/media-pause.test.js

# 2. Fix code, run again until green
npm run test:unit tests/unit/voice-memo/media-pause.test.js

# 3. Runtime tests for UI (should fail initially)
npx playwright test tests/runtime/voice-memo/voice-memo-ui.runtime.test.mjs --headed

# 4. Fix CSS/JSX, run again until green
npx playwright test tests/runtime/voice-memo/voice-memo-ui.runtime.test.mjs --headed

# 5. Integration tests (should pass if unit tests pass)
npx playwright test tests/runtime/voice-memo/media-pause-integration.runtime.test.mjs --headed

# 6. Run all voice memo tests together
npx playwright test tests/runtime/voice-memo/ --headed
```

---

## Verification Checklist

Before marking complete, all boxes must be checked:

- [ ] `media-pause.test.js` - All 7 unit tests pass
- [ ] `voice-memo-ui.runtime.test.mjs` - All 9 UI tests pass
- [ ] `media-pause-integration.runtime.test.mjs` - All 3 integration tests pass
- [ ] Watched each test fail before implementing fix
- [ ] No tests were modified to make them pass (only production code changed)
- [ ] Manual verification: video pauses during recording
- [ ] Manual verification: video resumes after recording (if was playing)
- [ ] Manual verification: panel is centered and visible
- [ ] Manual verification: ESC and click-outside close overlay
- [ ] Manual verification: works on mobile viewport

---

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `tests/unit/voice-memo/media-pause.test.js` | New | Unit tests for pause behavior |
| `tests/runtime/voice-memo/voice-memo-ui.runtime.test.mjs` | New | E2E tests for UI |
| `tests/runtime/voice-memo/media-pause-integration.runtime.test.mjs` | New | E2E tests for pause |
| `useVoiceMemoRecorder.js` | Modified | Fix resolvePlaybackState, pauseMediaIfNeeded |
| `VoiceMemoOverlay.scss` | Modified | Redesign layout |
| `VoiceMemoOverlay.jsx` | Modified | Add backdrop click handler |
| `FitnessVoiceMemo.jsx` | Modified | Go direct to capture mode |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Player API varies by context | Test multiple API shapes in unit tests |
| Breaking existing overlays | z-index 200 is above all existing overlays |
| Mobile keyboard covers panel | Use `visualViewport` API for safe area |
| Backdrop click unintended | Only close on direct backdrop click, not bubbled |

---

## Definition of Done

1. All tests pass (watched fail first)
2. No regressions in existing functionality
3. Manual QA on desktop and mobile
4. Code reviewed
5. Docs updated to reflect new behavior
