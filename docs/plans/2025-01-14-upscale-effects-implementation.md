# Upscale Effects Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add adaptive blur and CRT effects to video player when source is upscaled beyond native resolution.

**Architecture:** A new hook `useUpscaleEffects` detects upscale ratio by comparing `videoWidth/videoHeight` to display dimensions. Returns CSS filter styles and CRT overlay props. Effects fade in after 1.5s stabilization delay.

**Tech Stack:** React hooks, CSS filters, SVG data URI for noise, CSS animations for scanlines.

**Design doc:** `docs/plans/2025-01-14-upscale-effects-design.md`

---

## Task 1: Create useUpscaleEffects Hook

**Files:**
- Create: `frontend/src/modules/Player/hooks/useUpscaleEffects.js`

**Step 1: Create hook file with constants and preset definitions**

```js
// frontend/src/modules/Player/hooks/useUpscaleEffects.js
import { useState, useEffect, useCallback, useRef } from 'react';

// Blur calculation constants
const BLUR_FACTOR = 1.2;      // px of blur per 1x upscale
const MAX_BLUR_PX = 4;        // cap to prevent over-softening
const BLUR_FACTOR_AGGRESSIVE = 2.0;
const MAX_BLUR_PX_AGGRESSIVE = 6;

// CRT threshold
const CRT_MAX_HEIGHT = 480;

// Timing
const DEFAULT_STABILIZE_MS = 1500;
const FADE_DURATION_MS = 400;

// Presets define which effects are enabled
const PRESETS = {
  auto: { blur: true, crt: true, aggressive: false },
  'blur-only': { blur: true, crt: false, aggressive: false },
  'crt-only': { blur: false, crt: true, aggressive: false },
  aggressive: { blur: true, crt: true, aggressive: true },
  none: { blur: false, crt: false, aggressive: false }
};

/**
 * Hook to detect video upscaling and return appropriate visual effect styles.
 *
 * @param {Object} options
 * @param {React.RefObject} options.mediaRef - ref to video element (or dash-video)
 * @param {string} options.preset - 'auto' | 'blur-only' | 'crt-only' | 'aggressive' | 'none'
 * @param {number} options.stabilizeMs - delay before applying effects (default 1500)
 * @returns {Object} { effectStyles, overlayProps, isActive, debug }
 */
export function useUpscaleEffects({
  mediaRef,
  preset = 'auto',
  stabilizeMs = DEFAULT_STABILIZE_MS
} = {}) {
  const [srcDimensions, setSrcDimensions] = useState({ width: 0, height: 0 });
  const [displayDimensions, setDisplayDimensions] = useState({ width: 0, height: 0 });
  const [isStabilized, setIsStabilized] = useState(false);
  const stabilizeTimerRef = useRef(null);
  const resizeObserverRef = useRef(null);

  const presetConfig = PRESETS[preset] || PRESETS.auto;

  // Get the actual video element (handles dash-video shadow DOM)
  const getVideoElement = useCallback(() => {
    const el = mediaRef?.current;
    if (!el) return null;
    // dash-video wraps the video in shadow DOM
    if (el.shadowRoot) {
      return el.shadowRoot.querySelector('video') || el;
    }
    return el;
  }, [mediaRef]);

  // Read source dimensions from video element
  const updateSrcDimensions = useCallback(() => {
    const videoEl = getVideoElement();
    if (!videoEl) return;
    const width = videoEl.videoWidth || 0;
    const height = videoEl.videoHeight || 0;
    if (width > 0 && height > 0) {
      setSrcDimensions(prev => {
        if (prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    }
  }, [getVideoElement]);

  // Read display dimensions from rendered element
  const updateDisplayDimensions = useCallback(() => {
    const videoEl = getVideoElement();
    if (!videoEl) return;
    const rect = videoEl.getBoundingClientRect();
    const width = Math.round(rect.width) || 0;
    const height = Math.round(rect.height) || 0;
    if (width > 0 && height > 0) {
      setDisplayDimensions(prev => {
        if (prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    }
  }, [getVideoElement]);

  // Handle resolution changes (loadedmetadata, resize)
  useEffect(() => {
    const videoEl = getVideoElement();
    if (!videoEl) return;

    const handleMetadata = () => {
      updateSrcDimensions();
      // Reset stabilization on resolution change
      setIsStabilized(false);
      if (stabilizeTimerRef.current) {
        clearTimeout(stabilizeTimerRef.current);
      }
      stabilizeTimerRef.current = setTimeout(() => {
        setIsStabilized(true);
      }, stabilizeMs);
    };

    // Listen for metadata load and resolution changes
    videoEl.addEventListener('loadedmetadata', handleMetadata);
    videoEl.addEventListener('resize', handleMetadata);

    // Initial check
    if (videoEl.videoWidth > 0) {
      handleMetadata();
    }

    return () => {
      videoEl.removeEventListener('loadedmetadata', handleMetadata);
      videoEl.removeEventListener('resize', handleMetadata);
      if (stabilizeTimerRef.current) {
        clearTimeout(stabilizeTimerRef.current);
      }
    };
  }, [getVideoElement, updateSrcDimensions, stabilizeMs]);

  // Track display dimension changes via ResizeObserver
  useEffect(() => {
    const videoEl = getVideoElement();
    if (!videoEl) return;

    updateDisplayDimensions();

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserverRef.current = new ResizeObserver(() => {
        updateDisplayDimensions();
      });
      resizeObserverRef.current.observe(videoEl);
    }

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, [getVideoElement, updateDisplayDimensions]);

  // Calculate upscale ratio and effects
  const { upscaleRatio, blurPx, shouldBlur, shouldCRT } = (() => {
    if (srcDimensions.width === 0 || srcDimensions.height === 0) {
      return { upscaleRatio: 1, blurPx: 0, shouldBlur: false, shouldCRT: false };
    }
    if (displayDimensions.width === 0 || displayDimensions.height === 0) {
      return { upscaleRatio: 1, blurPx: 0, shouldBlur: false, shouldCRT: false };
    }

    const scaleX = displayDimensions.width / srcDimensions.width;
    const scaleY = displayDimensions.height / srcDimensions.height;
    const ratio = Math.max(scaleX, scaleY);

    const isUpscaled = ratio > 1.05; // small threshold to avoid floating point issues
    const isLowRes = srcDimensions.height <= CRT_MAX_HEIGHT;

    const blurFactor = presetConfig.aggressive ? BLUR_FACTOR_AGGRESSIVE : BLUR_FACTOR;
    const maxBlur = presetConfig.aggressive ? MAX_BLUR_PX_AGGRESSIVE : MAX_BLUR_PX;
    const calculatedBlur = isUpscaled
      ? Math.min(maxBlur, (ratio - 1) * blurFactor)
      : 0;

    return {
      upscaleRatio: ratio,
      blurPx: presetConfig.blur ? calculatedBlur : 0,
      shouldBlur: presetConfig.blur && isUpscaled,
      shouldCRT: presetConfig.crt && isLowRes
    };
  })();

  const isActive = isStabilized && (shouldBlur || shouldCRT);

  // Build effect styles for video element
  const effectStyles = {};
  if (isActive && blurPx > 0) {
    effectStyles.filter = `blur(${blurPx.toFixed(2)}px)`;
  }

  // Build overlay props for CRT effect
  const overlayProps = {
    showCRT: isActive && shouldCRT,
    className: `upscale-crt-overlay ${isActive && shouldCRT ? 'active' : ''}`
  };

  // Debug info for development
  const debug = {
    srcDimensions,
    displayDimensions,
    upscaleRatio: upscaleRatio.toFixed(2),
    blurPx: blurPx.toFixed(2),
    shouldBlur,
    shouldCRT,
    isStabilized,
    preset,
    presetConfig
  };

  return {
    effectStyles,
    overlayProps,
    isActive,
    debug
  };
}

export default useUpscaleEffects;
```

**Step 2: Verify file created**

Run: `ls -la frontend/src/modules/Player/hooks/useUpscaleEffects.js`
Expected: File exists

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/hooks/useUpscaleEffects.js
git commit -m "feat(player): add useUpscaleEffects hook

Detects video upscaling by comparing source vs display dimensions.
Returns blur filter styles and CRT overlay props based on preset.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add CRT Overlay CSS

**Files:**
- Modify: `frontend/src/modules/Player/Player.scss` (append after line 547)

**Step 1: Add CRT overlay styles to Player.scss**

Append the following CSS at the end of the file:

```scss
// =============================================================================
// Upscale Effects - CRT Overlay
// =============================================================================

// Smooth filter transitions on video element
.video-player video,
.video-player dash-video video {
  transition: filter 400ms ease;
}

// CRT overlay container
.upscale-crt-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: var(--player-layer-crt, 36);
  opacity: 0;
  transition: opacity 400ms ease;

  &.active {
    opacity: 1;
  }
}

// Scanline layer
.upscale-crt-overlay::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0.10) 0,
    rgba(255, 255, 255, 0.10) 1px,
    transparent 1px,
    transparent 3px
  );
  mix-blend-mode: screen;
  animation: crt-scanline-scroll 2s linear infinite;
}

// Noise layer (SVG-based, no external asset)
.upscale-crt-overlay::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 256px 256px;
  opacity: 0.06;
  mix-blend-mode: screen;
  animation: crt-noise-flicker 150ms steps(4) infinite;
}

@keyframes crt-scanline-scroll {
  to {
    background-position: 0 12px;
  }
}

@keyframes crt-noise-flicker {
  to {
    background-position: 256px 256px;
  }
}
```

**Step 2: Verify SCSS is valid**

Run: `cd frontend && npm run build 2>&1 | head -20`
Expected: No SCSS syntax errors

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/Player.scss
git commit -m "style(player): add CRT overlay CSS for upscale effects

Scanlines via repeating-linear-gradient with slow scroll animation.
Noise via SVG feTurbulence data URI with flicker animation.
Both use mix-blend-mode: screen for subtle overlay effect.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Integrate Hook into VideoPlayer

**Files:**
- Modify: `frontend/src/modules/Player/components/VideoPlayer.jsx`

**Step 1: Import the hook**

Add import at line 7 (after LoadingOverlay import):

```js
import { useUpscaleEffects } from '../hooks/useUpscaleEffects.js';
```

**Step 2: Add upscaleEffects prop to component signature**

Modify the function signature (around line 12-32) to add the new prop:

```js
export function VideoPlayer({
  media,
  advance,
  clear,
  shader,
  volume,
  playbackRate,
  setShader,
  cycleThroughClasses,
  classes,
  playbackKeys,
  queuePosition,
  fetchVideoInfo,
  ignoreKeys,
  onProgress,
  onMediaRef,
  showQuality,
  stallConfig,
  keyboardOverrides,
  onController,
  upscaleEffects = 'auto'  // NEW PROP
}) {
```

**Step 3: Use the hook after useCommonMediaController**

Add after line 94 (after the useCommonMediaController call):

```js
  // Upscale detection and effects
  const { effectStyles, overlayProps, isActive: upscaleActive } = useUpscaleEffects({
    mediaRef: containerRef,
    preset: upscaleEffects
  });
```

**Step 4: Apply effectStyles to video elements**

Modify the dash-video element (around line 179-185) to include style:

```jsx
      {isDash ? (
        <dash-video
          key={`${media_url || ''}:${media?.maxVideoBitrate ?? 'unlimited'}:${elementKey}`}
          ref={containerRef}
          class={`video-element ${displayReady ? 'show' : ''}`}
          src={media_url}
          autoplay=""
          style={effectStyles}
        />
      ) : (
        <video
          key={`${media_url || ''}:${media?.maxVideoBitrate ?? 'unlimited'}:${elementKey}`}
          autoPlay
          ref={containerRef}
          className={`video-element ${displayReady ? 'show' : ''}`}
          src={media_url}
          style={effectStyles}
          onCanPlay={() => { setDisplayReady(true); setIsAdapting(false); setAdaptMessage(undefined); }}
          onPlaying={() => { setDisplayReady(true); setIsAdapting(false); setAdaptMessage(undefined); }}
        />
      )}
```

**Step 5: Add CRT overlay after video elements**

Add after the video elements and before the QualityOverlay (around line 196):

```jsx
      {overlayProps.showCRT && (
        <div className={overlayProps.className} />
      )}
```

**Step 6: Add prop type for upscaleEffects**

Add to PropTypes (around line 246):

```js
  upscaleEffects: PropTypes.oneOf(['auto', 'blur-only', 'crt-only', 'aggressive', 'none'])
```

**Step 7: Verify component renders**

Run: `cd frontend && npm run build 2>&1 | head -20`
Expected: No errors

**Step 8: Commit**

```bash
git add frontend/src/modules/Player/components/VideoPlayer.jsx
git commit -m "feat(player): integrate upscale effects into VideoPlayer

- Import and use useUpscaleEffects hook
- Apply blur filter via effectStyles on video element
- Render CRT overlay when showCRT is true
- New prop: upscaleEffects (default 'auto')

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Pass Prop Through SinglePlayer

**Files:**
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx`

**Step 1: Destructure upscaleEffects from play object**

Add to the destructuring around line 48-55:

```js
  const {
    plex,
    media,
    hymn,
    primary,
    scripture,
    talk,
    poem,
    rate,
    advance,
    open,
    clear,
    setShader,
    cycleThroughClasses,
    classes,
    playbackKeys,
    queuePosition,
    playerType,
    ignoreKeys,
    shuffle,
    continuous,
    shader,
    volume,
    playbackRate,
    onProgress,
    onMediaRef,
    media_key: mediaKeyProp,
    upscaleEffects  // NEW
  } = play || {};
```

**Step 2: Pass upscaleEffects to VideoPlayer**

In the React.createElement call around line 274-302, add the prop:

```js
          {
            media: mediaInfo,
            advance,
            clear,
            shader,
            volume,
            playbackRate,
            setShader,
            cycleThroughClasses,
            classes,
            playbackKeys,
            queuePosition,
            fetchVideoInfo: fetchVideoInfoCallback,
            ignoreKeys,
            onProgress: handleProgress,
            onMediaRef,
            keyboardOverrides: play?.keyboardOverrides,
            onController: play?.onController,
            resilienceBridge,
            maxVideoBitrate: mediaInfo?.maxVideoBitrate ?? play?.maxVideoBitrate ?? null,
            maxResolution: mediaInfo?.maxResolution ?? play?.maxResolution ?? null,
            watchedDurationProvider: getWatchedDuration,
            upscaleEffects  // NEW
          }
```

**Step 3: Add PropType**

Add to PropTypes around line 373:

```js
  upscaleEffects: PropTypes.oneOf(['auto', 'blur-only', 'crt-only', 'aggressive', 'none'])
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/components/SinglePlayer.jsx
git commit -m "feat(player): pass upscaleEffects through SinglePlayer

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Pass Prop Through Player.jsx

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx`

**Step 1: Read more of Player.jsx to find where props are passed to SinglePlayer**

First, read lines 150-300 to understand the prop flow:

Run: Read `frontend/src/modules/Player/Player.jsx` lines 150-300

**Step 2: Add upscaleEffects to singlePlayerProps construction**

In the singlePlayerProps useMemo (around line 134), ensure upscaleEffects is passed through from activeSource or play/queue:

```js
    // Add after maxResolution resolution (around line 156)
    const resolvedUpscaleEffects =
      cloned.upscaleEffects
      ?? rootPlay?.upscaleEffects
      ?? rootQueue?.upscaleEffects
      ?? 'auto';
    cloned.upscaleEffects = resolvedUpscaleEffects;
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/Player.jsx
git commit -m "feat(player): pass upscaleEffects from play/queue config

Resolves upscaleEffects from item, play, or queue level with 'auto' default.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Manual Testing

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Test with low-res video**

- Play a 480p or lower video
- Verify CRT scanlines appear after ~1.5s delay
- Verify blur is applied when video is stretched

**Step 3: Test with high-res video**

- Play a 1080p video
- Verify no CRT effects (only blur if upscaled)

**Step 4: Test presets via browser console**

In React DevTools, modify the `upscaleEffects` prop on VideoPlayer to test:
- `'none'` - no effects
- `'blur-only'` - blur without CRT
- `'crt-only'` - CRT without blur
- `'aggressive'` - stronger effects

---

## Task 7: Final Commit and Summary

**Step 1: Verify all changes**

Run: `git log --oneline -5`
Expected: 5 commits for this feature

**Step 2: Run build to verify no errors**

Run: `npm run build`
Expected: Successful build

---

## Summary

| File | Action |
|------|--------|
| `hooks/useUpscaleEffects.js` | Created - core detection and effect logic |
| `Player.scss` | Modified - CRT overlay CSS |
| `VideoPlayer.jsx` | Modified - hook integration |
| `SinglePlayer.jsx` | Modified - prop passthrough |
| `Player.jsx` | Modified - prop passthrough |
