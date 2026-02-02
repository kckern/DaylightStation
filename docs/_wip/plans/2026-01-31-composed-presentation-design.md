# Composed Presentation Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable multi-track media presentations combining visual content (images, video, apps) with audio tracks, replacing the current CompositePlayer antipatterns with a clean, extensible architecture.

**Architecture:** Domain-driven composition with inferred track assignment, polymorphic visual rendering, and unified modifier scoping.

**Tech Stack:** Backend DDD layers (use case, adapters, domain interfaces), React frontend with context-based state management.

---

## Overview

A "composed presentation" plays multiple tracks simultaneously:
- **Visual track:** Images (slideshow), video (looping/playlist), or app (clock, screensaver, blackout)
- **Audio track:** Music playlist, narration, ambient sounds

Use cases:
- Fireplace video + Christmas music
- Photo slideshow + background playlist
- Children's book pages + narration (synced)
- Art mode (single image) + ambient music
- Screensaver + audio playlist

---

## Domain Model

### Visual Track Taxonomy

| Visual Type | Category | Behavior | Example |
|-------------|----------|----------|---------|
| Image slideshow | media | Discrete, advances | Immich album |
| Single looping video | media | Continuous loop | Fireplace |
| Video playlist | media | Continuous, advances | Ambient playlist |
| Book pages | media | Discrete, ordered | Komga, Audiobookshelf |
| Single static image | media | Persistent | Art mode |
| Blackout | app | No visual output | Audio-only mode |
| Screensaver | app | Animated UI | Clock, patterns |

### Three Axes of Visual Behavior

**Axis 1: Content cardinality**
- Single (static image, looping video, blackout, screensaver)
- Playlist (image slideshow, video playlist, book pages)

**Axis 2: Advance mode**
- `none` - Static display (single image, looping video)
- `timed` - Advance every N milliseconds
- `onTrackEnd` - Advance when audio track ends
- `manual` - User-controlled only
- `synced` - Advance based on audio time markers

**Axis 3: Audio-visual relationship**
- **Independent** - Audio and visual advance separately (fireplace + music)
- **Synced** - Visual advances based on audio cues (book pages + narration)
- **Audio-driven** - Visual advances when audio track ends (slideshow + playlist)

---

## Domain Interfaces

```javascript
// backend/src/2_domains/content/capabilities/Composable.mjs

/**
 * IVisualTrack - Domain interface for visual content in composed presentations
 *
 * Category distinction:
 * - 'media': Content served from backend adapters via proxy (images, video, pages)
 * - 'app': Frontend-rendered UI components (blackout, screensaver, clock)
 */
interface IVisualTrack {
  category: 'media' | 'app';

  // For media category
  type?: 'image' | 'video' | 'pages';
  items?: Array<{
    id: string;
    url: string;          // Proxy URL for display
    duration?: number;    // Suggested display time (ms), optional
    caption?: string;     // Optional metadata
  }>;

  // For app category
  app?: 'blackout' | 'screensaver' | 'clock' | 'art-frame';
  appConfig?: Record<string, any>;  // App-specific settings

  // Advance configuration
  advance: {
    mode: 'none' | 'timed' | 'onTrackEnd' | 'manual' | 'synced';
    interval?: number;    // For timed mode (ms)
    markers?: Array<{ time: number; index: number }>;  // For synced mode
  };

  loop: boolean;
}

/**
 * IAudioTrack - Domain interface for audio content
 * Reuses existing PlayableItem capability
 */
interface IAudioTrack {
  items: PlayableItem[];
  shuffle?: boolean;
  loop?: boolean;
}

/**
 * IComposedPresentation - Full composed output from use case
 */
interface IComposedPresentation {
  visual: IVisualTrack;
  audio: IAudioTrack | null;  // Audio optional (art mode, screensaver alone)
  layout: 'fullscreen' | 'pip' | 'splitscreen';
}
```

---

## Adapter Responsibilities

Each adapter implements what it can provide:

| Adapter | Visual Types | Sync Markers | Notes |
|---------|-------------|--------------|-------|
| ImmichAdapter | image slideshow | No | Timed/manual advance |
| PlexAdapter | video, video playlist | No | |
| KomgaAdapter | pages | No | Estimate from page count |
| AudiobookshelfAdapter | pages | Yes | Chapter metadata |
| FilesystemAdapter | image, video | No | |
| ScreensaverAdapter | screensaver (app) | N/A | Frontend-rendered |

Adapters fulfill the interface based on their capabilities. Sync markers are optional - use case falls back to timed/manual if unavailable.

---

## URL Parameter Design

### Principle: Inferred Defaults, Explicit Override

Backend infers track assignment from content type. Explicit prefix only when overriding.

### Inference Rules

| Source/Content | Default Track |
|----------------|---------------|
| Video (plex movie, immich video) | visual |
| Audio (plex music, podcast) | audio |
| Images (immich album, filesystem images) | visual |
| App (screensaver, clock) | visual |
| Numeric-only ID (e.g., `12345`) | plex (assumed provider) |

### URL Patterns

```
# Simple - backend infers both tracks
?play=plex:fireplace,plex:xmasMusic
?queue=immich:album,plex:playlist

# Numeric IDs assume Plex provider
?play=12345,67890

# Explicit override when needed (music video as audio-only)
?play=plex:fireplace,audio:plex:musicVideo

# App as visual
?play=app:clock,plex:playlist

# PIP - two visuals (explicit second visual)
?queue=plex:fireplace,visual:plex:musicVideos&layout=pip
```

### Modifier Scoping

**Core principle:** When multi-track, modifiers like `loop` apply to both tracks by default to avoid awkward states (e.g., looping video in silence).

```javascript
/**
 * Modifier scope rules:
 *
 * VISUAL-ONLY (only makes sense for visual):
 * - shader: Visual rendering effect
 *
 * AUDIO-ONLY (only makes sense for audio):
 * - volume: Audio level
 *
 * VISUAL-ONLY DEFAULT (avoid unintended effects):
 * - playbackRate: Avoid audio pitch shift
 *
 * BOTH TRACKS (when multi-track, keep in sync):
 * - loop: Avoid visual looping in silence
 * - shuffle: Keep both randomized together
 * - continuous: Both keep playing or both stop
 *
 * COMPOSITION-LEVEL:
 * - layout: Affects how tracks are arranged (fullscreen, pip, splitscreen)
 */
const modifierScope = {
  // Visual-only
  shader: 'visual',

  // Audio-only
  volume: 'audio',

  // Visual-only default (audio pitch shift usually unwanted)
  playbackRate: 'visual',

  // Both tracks when multi-track
  loop: (trackCount) => trackCount > 1 ? 'both' : 'all',
  shuffle: (trackCount) => trackCount > 1 ? 'both' : 'all',
  continuous: (trackCount) => trackCount > 1 ? 'both' : 'all',

  // Composition-level
  layout: 'composition'
};
```

**Per-track override syntax:**

```
# Both loop (default)
?play=plex:fireplace,plex:xmasMusic&loop=1

# Only audio loops (visual plays once, audio continues)
?play=plex:fireplace,plex:xmasMusic&loop.audio=1&loop.visual=0

# Different shuffle per track
?queue=immich:album,plex:playlist&shuffle=1&shuffle.visual=0
```

---

## Backend Implementation

### ComposePresentationUseCase

```javascript
// backend/src/3_applications/content/useCases/ComposePresentationUseCase.mjs

export class ComposePresentationUseCase {
  #registry;
  #logger;

  constructor({ registry, logger }) {
    this.#registry = registry;
    this.#logger = logger;
  }

  /**
   * Compose a multi-track presentation from sources
   * @param {string[]} sources - Array of source identifiers (e.g., ['plex:12345', 'plex:67890'])
   * @param {Object} config - Composition config (advance mode, modifiers, layout)
   * @returns {IComposedPresentation}
   */
  async compose(sources, config = {}) {
    const tracks = await Promise.all(
      sources.map(source => this.#resolveTrack(source))
    );

    const visual = tracks.find(t => t.role === 'visual');
    const audio = tracks.find(t => t.role === 'audio');

    if (!visual && !audio) {
      throw new Error('At least one track required');
    }

    // Apply modifier scoping
    const resolvedConfig = this.#resolveModifiers(config, tracks.length);

    return {
      visual: visual ? this.#buildVisualTrack(visual, resolvedConfig) : null,
      audio: audio ? this.#buildAudioTrack(audio, resolvedConfig) : null,
      layout: config.layout || 'fullscreen'
    };
  }

  async #resolveTrack(source) {
    // Parse explicit track prefix
    const explicitMatch = source.match(/^(visual|audio):(.+)$/);
    if (explicitMatch) {
      const [, role, actualSource] = explicitMatch;
      return { role, source: actualSource, ...(await this.#getSourceMetadata(actualSource)) };
    }

    // Infer from content type
    const metadata = await this.#getSourceMetadata(source);
    const role = metadata.mediaType === 'audio' ? 'audio' : 'visual';
    return { role, source, ...metadata };
  }

  async #getSourceMetadata(source) {
    // Parse provider:id format, default to plex for numeric
    const [provider, id] = this.#parseSource(source);
    const adapter = this.#registry.get(provider);
    return adapter.getMetadata(id);
  }

  #parseSource(source) {
    if (/^\d+$/.test(source)) {
      return ['plex', source];  // Numeric assumes Plex
    }
    const colonIndex = source.indexOf(':');
    if (colonIndex > 0) {
      return [source.substring(0, colonIndex), source.substring(colonIndex + 1)];
    }
    return ['filesystem', source];
  }

  /**
   * Resolve modifier scoping based on track count
   * See modifier scope rules in documentation above
   */
  #resolveModifiers(config, trackCount) {
    const result = { visual: {}, audio: {}, composition: {} };

    for (const [key, value] of Object.entries(config)) {
      // Check for explicit scope (e.g., loop.audio)
      const scopeMatch = key.match(/^(\w+)\.(visual|audio)$/);
      if (scopeMatch) {
        const [, modifier, scope] = scopeMatch;
        result[scope][modifier] = value;
        continue;
      }

      // Apply default scoping
      const scope = this.#getModifierScope(key, trackCount);
      if (scope === 'both') {
        result.visual[key] = value;
        result.audio[key] = value;
      } else if (scope === 'composition') {
        result.composition[key] = value;
      } else {
        result[scope][key] = value;
      }
    }

    return result;
  }

  #getModifierScope(modifier, trackCount) {
    const scopes = {
      shader: 'visual',
      volume: 'audio',
      playbackRate: 'visual',
      loop: trackCount > 1 ? 'both' : 'visual',
      shuffle: trackCount > 1 ? 'both' : 'audio',
      continuous: trackCount > 1 ? 'both' : 'visual',
      layout: 'composition'
    };
    return scopes[modifier] || 'both';
  }
}
```

### API Endpoint

```javascript
// backend/src/4_api/v1/routers/content.mjs

/**
 * POST /api/v1/content/compose
 *
 * Compose a multi-track presentation from sources.
 *
 * Body:
 * {
 *   sources: ['plex:12345', 'plex:67890'],  // Visual inferred, audio inferred
 *   config: {
 *     advance: { mode: 'timed', interval: 5000 },
 *     loop: true,
 *     shuffle: true,
 *     layout: 'fullscreen'
 *   }
 * }
 *
 * Response: IComposedPresentation
 */
router.post('/compose', asyncHandler(async (req, res) => {
  const { sources, config } = req.body;

  if (!sources || !Array.isArray(sources) || sources.length === 0) {
    return res.status(400).json({ error: 'sources array required' });
  }

  const presentation = await composePresentationUseCase.compose(sources, config);
  res.json(presentation);
}));
```

---

## Frontend Implementation

### Refactored CompositePlayer

```
CompositePlayer (refactored)
├── VisualRenderer (polymorphic)
│   ├── ImageCarousel     → category: 'media', type: 'image' | 'pages'
│   ├── VideoPlayer       → category: 'media', type: 'video'
│   ├── BlackoutScreen    → category: 'app', app: 'blackout'
│   ├── Screensaver       → category: 'app', app: 'screensaver'
│   └── ClockDisplay      → category: 'app', app: 'clock'
├── AudioOverlay (existing Player as overlay)
├── useAdvanceController (coordinates visual advances)
└── CompositeContext (shared state)
```

### VisualRenderer Component

```javascript
// frontend/src/modules/Player/components/VisualRenderer.jsx

/**
 * Polymorphic visual renderer for composed presentations.
 * Renders media content (images, video) or app components based on track category.
 */
function VisualRenderer({ track, audioState, onAdvance }) {
  // App category - frontend-rendered UI
  if (track.category === 'app') {
    const AppComponent = {
      'blackout': BlackoutScreen,
      'screensaver': Screensaver,
      'clock': ClockDisplay,
      'art-frame': ArtFrame
    }[track.app];

    return <AppComponent config={track.appConfig} />;
  }

  // Media category - content from backend
  const MediaComponent = {
    'image': ImageCarousel,
    'pages': ImageCarousel,  // Same component, different styling via CSS
    'video': VideoPlayer
  }[track.type];

  return (
    <MediaComponent
      items={track.items}
      loop={track.loop}
      onAdvance={onAdvance}
    />
  );
}
```

### useAdvanceController Hook

```javascript
// frontend/src/modules/Player/hooks/useAdvanceController.js

/**
 * Coordinates visual track advances based on advance mode.
 *
 * Advance modes:
 * - 'none': No automatic advance (static image, looping video)
 * - 'timed': Advance every N milliseconds
 * - 'onTrackEnd': Advance when audio track ends
 * - 'manual': User-controlled only (keyboard/touch)
 * - 'synced': Advance based on audio time markers (book narration)
 */
function useAdvanceController(visual, audioState) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const itemCount = visual.items?.length || 1;

  useEffect(() => {
    const { mode, interval, markers } = visual.advance;

    // Timed advance
    if (mode === 'timed' && interval) {
      const timer = setInterval(() => advance(), interval);
      return () => clearInterval(timer);
    }

    // Audio track end advance
    if (mode === 'onTrackEnd' && audioState?.trackEnded) {
      advance();
    }

    // Synced advance (book pages with narration)
    if (mode === 'synced' && markers && audioState?.currentTime != null) {
      const marker = [...markers]
        .reverse()
        .find(m => m.time <= audioState.currentTime);
      if (marker && marker.index !== currentIndex) {
        setCurrentIndex(marker.index);
      }
    }
  }, [visual.advance, audioState, currentIndex]);

  const advance = useCallback(() => {
    setCurrentIndex(i =>
      visual.loop
        ? (i + 1) % itemCount
        : Math.min(i + 1, itemCount - 1)
    );
  }, [visual.loop, itemCount]);

  const goTo = useCallback((index) => {
    setCurrentIndex(Math.max(0, Math.min(index, itemCount - 1)));
  }, [itemCount]);

  return {
    currentIndex,
    advance,
    goTo,
    canAdvance: visual.loop || currentIndex < itemCount - 1,
    canReverse: currentIndex > 0
  };
}
```

### TVApp Integration

```javascript
// frontend/src/Apps/TVApp.jsx - additions to mappings

const mappings = {
  // ... existing mappings ...

  // Composed presentation - comma-separated sources
  // Backend infers track assignment, explicit prefix overrides
  compose: (value) => {
    const sources = value.split(',');
    return { compose: { sources, ...config } };
  }
};

// In autoplay effect handler
} else if (autoplay.compose) {
  push({ type: 'composite', props: autoplay.compose });
}
```

---

## Error Handling

### Error Categories

| Failure | Visual Impact | Audio Impact | Recovery |
|---------|--------------|--------------|----------|
| Visual source unavailable | Show fallback | Continue audio | Fallback to blackout |
| Audio source unavailable | Continue visual | Silent | Notify user (optional) |
| Single image fails to load | Skip to next | None | Preloader marks failed |
| Video stream fails | Show poster | Continue audio | Retry with backoff |
| Sync markers missing | N/A | N/A | Fall back to timed/manual |

### Graceful Degradation

```javascript
// CompositeContext provides error state and degradation actions
const CompositeContext = {
  visual: { status: 'loaded' | 'error' | 'partial', errorCount: 0 },
  audio: { status: 'loaded' | 'error' | 'silent', errorCount: 0 },

  degradeVisual: () => { /* switch to blackout */ },
  degradeAudio: () => { /* continue silent */ },
  retryVisual: () => { /* attempt reload */ }
};
```

### Backend Validation

Use case validates before returning:
- At least one track resolvable
- Visual items loadable (for media types)
- Audio playlist non-empty (if audio requested)
- Returns error with reason if composition impossible

---

## Testing Strategy

### Unit Tests (Backend)

```javascript
// ComposePresentationUseCase.test.mjs

describe('track inference', () => {
  it('infers video as visual track', async () => {
    const result = await useCase.compose(['plex:12345']);
    expect(result.visual).toBeDefined();
    expect(result.audio).toBeNull();
  });

  it('infers audio as audio track in multi-source', async () => {
    const result = await useCase.compose(['plex:videoId', 'plex:audioId']);
    expect(result.visual.source).toBe('plex:videoId');
    expect(result.audio.source).toBe('plex:audioId');
  });

  it('respects explicit track override', async () => {
    const result = await useCase.compose(['plex:12345', 'audio:plex:musicVideo']);
    expect(result.audio.source).toBe('plex:musicVideo');
  });

  it('assumes plex for numeric-only IDs', async () => {
    const result = await useCase.compose(['12345']);
    // Should resolve via plex adapter
    expect(result.visual).toBeDefined();
  });
});

describe('modifier scoping', () => {
  /**
   * Modifier scope rules:
   * - shader: visual only
   * - volume: audio only
   * - playbackRate: visual only (avoid audio pitch shift)
   * - loop/shuffle/continuous: both tracks when multi-track
   */
  it('applies loop to both tracks by default when multi-track', () => {
    const config = useCase.resolveModifiers({ loop: 1 }, 2);
    expect(config.visual.loop).toBe(true);
    expect(config.audio.loop).toBe(true);
  });

  it('applies loop to visual only when single track', () => {
    const config = useCase.resolveModifiers({ loop: 1 }, 1);
    expect(config.visual.loop).toBe(true);
    expect(config.audio.loop).toBeUndefined();
  });

  it('allows per-track override', () => {
    const config = useCase.resolveModifiers({ loop: 1, 'loop.audio': 0 }, 2);
    expect(config.visual.loop).toBe(true);
    expect(config.audio.loop).toBe(false);
  });

  it('scopes shader to visual only', () => {
    const config = useCase.resolveModifiers({ shader: 'blackout' }, 2);
    expect(config.visual.shader).toBe('blackout');
    expect(config.audio.shader).toBeUndefined();
  });
});
```

### Integration Tests (Playwright)

```javascript
// composed-presentation.runtime.test.mjs

test('slideshow with audio loads both tracks', async ({ page }) => {
  await page.goto('/tv?compose=immich:testAlbum,plex:testPlaylist');

  // Verify both tracks loaded
  await expect(page.locator('[data-track="visual"]')).toBeVisible();
  await expect(page.locator('[data-track="audio"]')).toBeVisible();
});

test('timed advance cycles through images', async ({ page }) => {
  await page.goto('/tv?compose=immich:testAlbum,plex:testPlaylist&advance=timed&interval=2000');

  const getImageIndex = () => page.locator('[data-image-index]').getAttribute('data-image-index');

  const firstImage = await getImageIndex();
  await page.waitForTimeout(2500);
  const secondImage = await getImageIndex();

  expect(secondImage).not.toBe(firstImage);
});

test('loop modifier applies to both tracks', async ({ page }) => {
  await page.goto('/tv?compose=plex:shortVideo,plex:shortAudio&loop=1');

  // Wait for natural end of content
  await page.waitForTimeout(10000);

  // Both should still be playing (looped)
  await expect(page.locator('[data-visual-status="playing"]')).toBeVisible();
  await expect(page.locator('[data-audio-status="playing"]')).toBeVisible();
});
```

---

## Migration Path

### Phase 1: Backend Infrastructure
1. Create `IVisualTrack`, `IAudioTrack`, `IComposedPresentation` interfaces
2. Implement `ComposePresentationUseCase`
3. Add `/api/v1/content/compose` endpoint
4. Add track inference logic with explicit override support

### Phase 2: Frontend Refactor
1. Extract hooks from CompositePlayer (`useAdvanceController`, `useCompositeKeyboard`)
2. Create `VisualRenderer` polymorphic component
3. Create `CompositeContext` for shared state
4. Refactor CompositePlayer to use new architecture

### Phase 3: URL Parameter Support
1. Add `compose` mapping to TVApp.jsx
2. Implement modifier scoping in frontend
3. Add per-track override parsing

### Phase 4: Additional Visual Types
1. Implement `ImageCarousel` component
2. Add app-type visual renderers (BlackoutScreen, Screensaver, Clock)
3. Integrate with existing Player for audio overlay

---

## Open Questions

1. **Preloading strategy:** How many images to prefetch? Network-aware?
2. **Transition effects:** Fade, slide, or configurable per-presentation?
3. **Remote control:** How do TV remotes map to advance/pause/skip?
4. **Persistence:** Save/resume composed presentation state?
