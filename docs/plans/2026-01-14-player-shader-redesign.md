# Player Shader Redesign

## Problem

The current shader system has 5 modes (`regular`, `minimal`, `night`, `screensaver`, `dark`) but only 4 are actually used. The naming is unclear and `screensaver` is unused.

## Goals

1. **Screen dimming for different contexts** — Control brightness/visibility for sleep, ambient viewing, etc.
2. **Information density control** — Toggle how much UI/metadata is visible during playback

## Design

### Four Shader Modes

| Mode | Brightness | UI | Use Case |
|------|------------|-----|----------|
| `default` | Full | Visible | Normal viewing with progress bar |
| `focused` | Full | Hidden | Distraction-free watching |
| `night` | Dim/red | Visible (dimmed) | Low-light room viewing |
| `blackout` | Off | N/A | Audio-only, TV appears off |

### Cycling Behavior

Up/down keys cycle through modes in order, wrapping around:
`default → focused → night → blackout → default...`

### Files to Change

#### `frontend/src/modules/Player/hooks/useQueueController.js`

Line 12:
```javascript
// Before
const classes = ['regular', 'minimal', 'night', 'screensaver', 'dark'];

// After
const classes = ['default', 'focused', 'night', 'blackout'];
```

#### `frontend/src/modules/Player/Player.scss`

Replace lines 237-297 with:

```scss
.player {
  background-color: #151515;
  width: 100%;
  height: 100%;

  // .default: no special styles, progress bar visible by default

  .focused {
    background-color: #000;
    .progress-bar, p, h2, h3 { display: none; }
    img.cover {
      position: absolute; top: 0; left: 0;
      width: 100%; height: 100%;
      object-fit: contain;
    }
  }

  .night {
    background-color: #000;
    .video-element {
      --player-video-filter-base: sepia(1) brightness(0.15) hue-rotate(-35deg);
    }
    .progress-bar, .progress, p, h2, h3 {
      color: #FF000022;
    }
    .progress { background-color: #FF000022 !important; }
    .image-container {
      position: relative;
      display: flex;
      justify-content: center;
      align-items: center;
      img, .image-backdrop {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        height: 100%;
        aspect-ratio: 1 / 1;
      }
      img {
        filter: grayscale(1);
        mix-blend-mode: multiply;
        z-index: 1;
      }
      .image-backdrop {
        background-color: rgb(39, 12, 12);
        z-index: 0;
        border-radius: 1rem;
      }
    }
  }

  .blackout {
    background-color: #000;
    * { filter: brightness(0); }
  }
}
```

### Blackout Mode: Suppress Overlays

In blackout mode, the loading and pause overlays must be hidden. The screen should remain completely black regardless of buffering or pause state — this preserves the "TV looks off" experience for audio-only playback.

**Implementation:** Pass the current shader to the overlay components and suppress rendering when `shader === 'blackout'`.

In `Player.jsx`, the overlay props or a wrapper should check:
```javascript
const suppressOverlays = shader === 'blackout';
```

Then in `PlayerOverlayLoading` and `PlayerOverlayPaused`, return `null` early if suppressed.

### Removed

- `.regular` class (did nothing, replaced by `.default`)
- `.screensaver` class (unused)

### Migration

If any saved preferences or API calls reference old shader names (`regular`, `minimal`, `dark`), they may need updating. If shaders are only set at runtime via cycling, no migration needed.

## Related Code

- `frontend/src/modules/Player/Player.jsx` — Main player component
- `frontend/src/modules/Player/hooks/useQueueController.js` — Shader state management
- `frontend/src/modules/Player/Player.scss` — Shader CSS definitions
