# Mixed Media Slideshow — Design

**Date:** 2026-03-03
**Status:** Approved

## Overview

Extend the Player's queue system to handle interleaved photos and videos from Immich queries. Photos display as a Ken Burns slideshow with smart face-targeted zoom. A configurable audio layer plays background music that pauses/ducks during video items.

## Query YAML Shape

```yaml
title: March 4 Videos & Photos
type: immich
sort: date_desc
params:
  # omit mediaType to include both photos and videos
  month: 3
  day: 4
  yearFrom: 2014
exclude:
  - abc123-def4-5678-ghij-klmnopqrstuv
slideshow:
  duration: 5
  effect: kenburns
  zoom: 1.2
  transition: crossfade
  focusPerson: Felix
audio:
  contentId: music:anniversary
  behavior: pause        # pause (default) | duck | skip
  mode: hidden           # hidden (default) | overlay | mini
```

### New fields

- **`exclude`** — array of Immich asset UUIDs to filter out
- **`slideshow`** — config applied to all photo items (duration in seconds, effect type, zoom factor, transition style, optional focusPerson for smart zoom)
- **`audio`** — background audio track. `contentId` resolves via `ContentIdResolver`. `behavior` controls what happens during video items. `mode` controls visibility

## Architecture

Queue-driven mixed media. A flat queue of items where each knows its type. The Player renders each appropriately and manages a separate audio layer.

```
Query YAML
  → SavedQueryService.getQuery() — normalizes new fields
  → QueryAdapter.resolvePlayables() — calls ImmichAdapter, filters excludes, returns mixed items
  → Each item tagged: { mediaType: "video" | "image", slideshow config stamped on images }
  → Frontend receives queue of mixed items + audio config
  → Player renders:
    ┌─────────────────────────────┐
    │  AudioLayer                 │  ← resolves audio contentId, configurable visibility
    │  (pauses/ducks for videos)  │
    ├─────────────────────────────┤
    │  Queue (useQueueController) │  ← advances through mixed items
    │    ├─ video → VideoPlayer   │
    │    └─ image → ImageFrame    │  ← single photo, Ken Burns, auto-advances after duration
    └─────────────────────────────┘
```

## Backend Changes (3 files modified)

### SavedQueryService

Pass through new fields with defaults:

```js
{
  title: raw.title || name,
  source: raw.type,
  params: raw.params || {},
  sort: raw.sort,
  take: raw.take,
  exclude: raw.exclude || [],
  slideshow: raw.slideshow || null,
  audio: raw.audio || null,
}
```

### QueryAdapter

In `#resolveImmichQuery()`, after existing post-filters:

1. **Exclude filter** — remove items whose Immich asset ID is in `query.exclude`
2. **Slideshow stamp** — for each `mediaType: "image"` item, attach the query's `slideshow` config

### ImmichAdapter

Enrich people metadata with face bounding boxes. Replace `.map(p => p.name)` with:

```js
people: asset.people?.map(p => ({
  name: p.name,
  id: p.id,
  faces: p.faces?.map(f => ({
    x1: f.boundingBoxX1, y1: f.boundingBoxY1,
    x2: f.boundingBoxX2, y2: f.boundingBoxY2,
    imageWidth: f.imageWidth, imageHeight: f.imageHeight
  })) || []
})) || []
```

Existing code accessing `people[].name` still works.

## Frontend Changes

### New files (2)

#### `Player/renderers/ImageFrame.jsx`

Single photo renderer. Implements the same callback contract as VideoPlayer:

- `onPlaybackMetrics({ seconds, isPaused })` — ticks elapsed time
- `onRegisterMediaAccess({ hardReset })` — resilience compatibility
- `onStartupSignal()` — fires once image loads
- `advance()` — called when duration expires

**Ken Burns via Web Animations API** (immune to TVApp.scss `!important` animation kill):

```js
imgRef.current.animate([
  { transform: `scale(1.0) translate(${startX}, ${startY})` },
  { transform: `scale(${zoom}) translate(${endX}, ${endY})` }
], { duration: duration * 1000, easing: 'ease-in-out', fill: 'forwards' });
```

**Smart zoom targeting priority:**

1. **Preferred face** — `slideshow.focusPerson` matches a name in `metadata.faces`. Zoom towards that face's bounding box center
2. **Any face** — no preferred person, but faces exist. Pick largest bounding box (closest face)
3. **Random strike zone** — no faces. Random point in center 60% of image

**Transitions:** 300ms opacity fade on SinglePlayer wrapper via CSS class. Covers photo→video, video→photo, photo→photo uniformly.

#### `Player/components/AudioLayer.jsx`

Configurable audio player. Renders a `<Player>` internally.

| Mode | Visibility | Use Case |
|------|-----------|----------|
| `hidden` | Not rendered visually | Birthday slideshow with background music |
| `overlay` | Visible controls over visual | Ambient video with music player shown |
| `mini` | Small persistent bar | Workout with track info visible |

| Behavior | During video items | Default |
|----------|-------------------|---------|
| `pause` | Pause audio, resume where left off | Yes |
| `duck` | Lower volume to ~10%, restore after | No |
| `skip` | Let audio time advance, don't pause | No |

Props:
- `contentId` — resolved via ContentIdResolver
- `behavior` — pause / duck / skip
- `mode` — hidden / overlay / mini
- `currentItemMediaType` — from parent queue, drives behavior
- `ignoreKeys` — when hidden, no keyboard capture

Visibility is CSS-driven (not mount/unmount) to keep playback state alive.

### Modified files (3)

#### `Player/lib/registry.js`

Add `'image'` to `MEDIA_PLAYBACK_FORMATS`:

```js
const MEDIA_PLAYBACK_FORMATS = new Set(['video', 'dash_video', 'audio', 'image']);
```

#### `Player/components/SinglePlayer.jsx`

Route `format: 'image'` to `ImageFrame` in `renderByFormat()`, same dispatch pattern as VideoPlayer/AudioPlayer.

#### `Player/Player.jsx`

- Remove CompositePlayer gate at line 82
- Detect `audio` config on queue items, render `AudioLayer` alongside the queue
- Pass `currentItemMediaType` from active queue item to `AudioLayer`

### Removed files (6)

- `Player/renderers/CompositePlayer.jsx` — replaced by AudioLayer + queue-driven mixed media
- `Player/components/CompositeContext.jsx` — only used by CompositePlayer
- `Player/components/CompositeControllerContext.jsx` — only used by CompositePlayer
- `Player/components/VisualRenderer.jsx` — only used by CompositePlayer
- `Player/components/ImageCarousel.jsx` — replaced by ImageFrame
- `Player/hooks/useAdvanceController.js` — only used by VisualRenderer

## Sort Behavior

Sort is driven by the query YAML `sort` field. For mixed media, sort applies uniformly to the combined set of photos and videos (e.g., `date_desc` = newest first, interleaved by capture date).

## Audio Behavior During Videos

When the queue advances to a video item:

- **`pause`** (default): Audio pauses, resumes at same position when video ends
- **`duck`**: Audio volume drops to ~10% during video, restores after
- **`skip`**: Audio continues playing (time advances), no pause

Configured per-query in `audio.behavior`.
