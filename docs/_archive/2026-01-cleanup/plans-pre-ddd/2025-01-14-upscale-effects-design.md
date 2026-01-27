# Adaptive Upscale Effects for Video Player

## Overview

Automatically detect when video is being upscaled beyond its source resolution and apply visual effects to mask pixelation artifacts while preserving source detail. For very low resolution content (≤480p), add subtle CRT-style scanlines and noise for a retro aesthetic.

## Decisions

| Decision | Choice |
|----------|--------|
| Scope | All video players by default, per-context overrides available |
| Blur calculation | Scale-based: `blur = (upscaleRatio - 1) * factor` |
| CRT intensity | Noticeable but gentle (8-12% scanlines, 5-8% noise) |
| Transitions | Delayed fade - wait ~1.5s for resolution to stabilize, then 400ms fade in |
| Override API | Preset strings: `auto`, `blur-only`, `crt-only`, `aggressive`, `none` |
| Noise implementation | CSS-only SVG data URI (no external PNG asset) |

## Presets

| Preset | Blur | CRT (≤480p) | Use case |
|--------|------|-------------|----------|
| `"auto"` (default) | ✓ scale-based | ✓ subtle | Standard behavior |
| `"blur-only"` | ✓ scale-based | ✗ | Clean look, no retro effects |
| `"crt-only"` | ✗ | ✓ subtle | Retro feel without softening |
| `"aggressive"` | ✓ stronger | ✓ pronounced | Intentional vintage aesthetic |
| `"none"` | ✗ | ✗ | Disable entirely |

## Technical Design

### 1. Resolution Detection

New hook `useUpscaleEffects` compares source vs display resolution:

```js
// Source dimensions (native video resolution)
const srcWidth = videoEl.videoWidth;
const srcHeight = videoEl.videoHeight;

// Display dimensions (rendered size)
const displayWidth = videoEl.clientWidth;
const displayHeight = videoEl.clientHeight;

// Calculate upscale ratio (use larger stretch axis)
const scaleX = displayWidth / srcWidth;
const scaleY = displayHeight / srcHeight;
const upscaleRatio = Math.max(scaleX, scaleY);
```

Effect triggers:
- `upscaleRatio <= 1.0` → no effects (native or downscaled)
- `upscaleRatio > 1.0` → apply blur
- `srcHeight <= 480` → also apply CRT effects

### 2. Blur Calculation

```js
const BLUR_FACTOR = 1.2;  // Pixels of blur per 1x upscale
const MAX_BLUR_PX = 4;    // Cap to prevent over-softening

const blurPx = Math.min(MAX_BLUR_PX, (upscaleRatio - 1) * BLUR_FACTOR);

// Examples:
// 1.5x upscale → 0.6px blur
// 2x upscale   → 1.2px blur
// 3x upscale   → 2.4px blur
// 4x upscale   → 3.6px blur
// 5x+ upscale  → 4px blur (capped)
```

Applied via CSS: `filter: blur(${blurPx}px)`

### 3. CRT Effects (≤480p only)

Two layered effects via CSS pseudo-elements:

**Scanlines** (`::before`):
```scss
background: repeating-linear-gradient(
  to bottom,
  rgba(255, 255, 255, 0.10) 0,
  rgba(255, 255, 255, 0.10) 1px,
  transparent 1px,
  transparent 3px
);
mix-blend-mode: screen;
animation: crt-scanline-scroll 2s linear infinite;
```

**Noise** (`::after`):
```scss
background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
background-size: 256px 256px;
opacity: 0.06;
mix-blend-mode: screen;
animation: crt-noise-flicker 150ms steps(4) infinite;
```

### 4. Stabilization

Adaptive bitrate streams often start at low resolution before ramping up. To prevent a brief CRT flash on high-res content:

1. Wait ~1500ms after `loadedmetadata` or resolution change
2. Then fade effects in over 400ms
3. Re-evaluate on resize / fullscreen toggle

### 5. Hook API

```js
const { effectStyles, overlayProps, isActive } = useUpscaleEffects({
  mediaRef,              // ref to video element
  preset: 'auto',        // preset string
  stabilizeMs: 1500,     // delay before applying
});
```

Returns:
- `effectStyles` - `{ filter: 'blur(Xpx)' }` or `{}` to apply to video
- `overlayProps` - `{ className, showCRT }` for overlay div
- `isActive` - boolean, true when effects applied

### 6. Component Integration

```jsx
// VideoPlayer.jsx
export function VideoPlayer({
  upscaleEffects = 'auto',  // NEW PROP
  ...props
}) {
  const { effectStyles, overlayProps, isActive } = useUpscaleEffects({
    mediaRef: containerRef,
    preset: upscaleEffects,
  });

  return (
    <div className={`video-player ${shader}`}>
      <video style={effectStyles} ... />
      {isActive && overlayProps.showCRT && (
        <div className="upscale-crt-overlay active" />
      )}
    </div>
  );
}
```

## File Changes

### Create
| File | Purpose |
|------|---------|
| `frontend/src/modules/Player/hooks/useUpscaleEffects.js` | Core hook |

### Modify
| File | Changes |
|------|---------|
| `frontend/src/modules/Player/components/VideoPlayer.jsx` | Add hook, styles, overlay |
| `frontend/src/modules/Player/Player.scss` | CRT overlay styles, keyframes |
| `frontend/src/modules/Player/Player.jsx` | Pass `upscaleEffects` prop |
| `frontend/src/modules/Player/components/SinglePlayer.jsx` | Pass `upscaleEffects` prop |

## CSS Additions

```scss
// Player.scss additions

.video-player video,
.video-player dash-video video {
  transition: filter 400ms ease;
}

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
  to { background-position: 0 12px; }
}

@keyframes crt-noise-flicker {
  to { background-position: 256px 256px; }
}
```

## Testing

### Manual Test Matrix
- Test with 360p, 480p, 720p, 1080p source videos
- Verify at various display sizes (windowed, fullscreen)
- Confirm effects don't flash during ABR ramp-up

### Preset Verification
- `none` - no effects ever
- `blur-only` - blur on upscale, no CRT
- `crt-only` - CRT on ≤480p, no blur
- `auto` - both as designed
- `aggressive` - stronger effects

### Edge Cases
- `dash-video` shadow DOM: apply filter to inner video via ref
- Window resize / fullscreen: re-calculate on dimension change
- Resolution change mid-stream: re-stabilize before updating

## Performance Notes

- CSS filters are GPU-accelerated, minimal CPU impact
- SVG noise is generated once and cached by browser
- Animations use compositor-friendly properties (background-position, opacity)
