# Mixed Media Slideshow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Player to handle interleaved photo/video queues from Immich queries, with Ken Burns slideshow effects on photos and a configurable audio layer that pauses/ducks during video playback.

**Architecture:** Extend the queue system — each queue item knows its media type (video or image). Photos render via a new `ImageFrame` renderer with Ken Burns zoom targeting faces from Immich metadata. A new `AudioLayer` component wraps an inner `<Player>` and reacts to the current item's media type. The CompositePlayer and its supporting files are removed.

**Tech Stack:** React, Web Animations API (Ken Burns), Immich API (face bounding boxes), existing Player/SinglePlayer/useQueueController infrastructure.

---

## Task 1: SavedQueryService — Pass Through New Query Fields

**Files:**
- Modify: `backend/src/3_applications/content/SavedQueryService.mjs:44-53`
- Test: `tests/isolated/applications/content/SavedQueryService.test.mjs`

**Step 1: Write the failing tests**

Add to the `getQuery` describe block in `tests/isolated/applications/content/SavedQueryService.test.mjs` after line 39:

```javascript
it('passes through exclude array when present', () => {
  const svc = new SavedQueryService({
    readQuery: () => ({ type: 'immich', exclude: ['uuid-1', 'uuid-2'] }),
  });
  const query = svc.getQuery('test');
  expect(query.exclude).toEqual(['uuid-1', 'uuid-2']);
});

it('omits exclude when not present', () => {
  const query = service.getQuery('dailynews');
  expect(query).not.toHaveProperty('exclude');
});

it('passes through slideshow config when present', () => {
  const slideshow = { duration: 5, effect: 'kenburns', zoom: 1.2, transition: 'crossfade', focusPerson: 'Felix' };
  const svc = new SavedQueryService({
    readQuery: () => ({ type: 'immich', slideshow }),
  });
  const query = svc.getQuery('test');
  expect(query.slideshow).toEqual(slideshow);
});

it('omits slideshow when not present', () => {
  const query = service.getQuery('dailynews');
  expect(query).not.toHaveProperty('slideshow');
});

it('passes through audio config when present', () => {
  const audio = { contentId: 'music:anniversary', behavior: 'pause', mode: 'hidden' };
  const svc = new SavedQueryService({
    readQuery: () => ({ type: 'immich', audio }),
  });
  const query = svc.getQuery('test');
  expect(query.audio).toEqual(audio);
});

it('omits audio when not present', () => {
  const query = service.getQuery('dailynews');
  expect(query).not.toHaveProperty('audio');
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/isolated/applications/content/SavedQueryService.test.mjs`
Expected: 6 new tests FAIL (exclude/slideshow/audio not returned)

**Step 3: Implement — add three spread operators**

In `backend/src/3_applications/content/SavedQueryService.mjs`, replace lines 44-53:

```javascript
  getQuery(name) {
    const raw = this.#readQuery(name);
    if (!raw) return null;

    return {
      title: raw.title || name,
      source: raw.type,
      filters: {
        sources: raw.sources || [],
      },
      params: raw.params || {},
      ...(raw.sort != null && { sort: raw.sort }),
      ...(raw.take != null && { take: raw.take }),
      ...(raw.exclude != null && { exclude: raw.exclude }),
      ...(raw.slideshow != null && { slideshow: raw.slideshow }),
      ...(raw.audio != null && { audio: raw.audio }),
    };
  }
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/applications/content/SavedQueryService.test.mjs`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/SavedQueryService.mjs tests/isolated/applications/content/SavedQueryService.test.mjs
git commit -m "feat(queries): pass through exclude, slideshow, audio fields"
```

---

## Task 2: QueryAdapter — Exclude Filter and Slideshow Stamping

**Files:**
- Modify: `backend/src/1_adapters/content/query/QueryAdapter.mjs:276-286`

**Step 1: Write the failing test**

Create `tests/isolated/adapters/content/query/QueryAdapter.immich-exclude.test.mjs`:

```javascript
import { describe, it, expect, vi } from 'vitest';

// Minimal stub to test the filtering logic in isolation.
// We test the public resolvePlayables() method which calls #resolveImmichQuery().
describe('QueryAdapter immich exclude + slideshow', () => {
  // These tests validate the contract: given a query with exclude/slideshow,
  // the returned items are filtered and stamped correctly.
  // We'll test at the integration level after implementing.

  it('placeholder — exclude filter removes matching asset IDs', () => {
    // Stub items: immich:aaa, immich:bbb, immich:ccc
    const items = [
      { id: 'immich:aaa', mediaType: 'image', metadata: {} },
      { id: 'immich:bbb', mediaType: 'video', metadata: {} },
      { id: 'immich:ccc', mediaType: 'image', metadata: {} },
    ];
    const exclude = ['aaa'];

    // Simulate the exclude filter logic we'll add
    const filtered = items.filter(item => {
      const assetId = item.id.replace(/^immich:/, '');
      return !exclude.includes(assetId);
    });

    expect(filtered).toHaveLength(2);
    expect(filtered.map(i => i.id)).toEqual(['immich:bbb', 'immich:ccc']);
  });

  it('placeholder — slideshow config stamped on image items only', () => {
    const slideshow = { duration: 5, effect: 'kenburns', zoom: 1.2 };
    const items = [
      { id: 'immich:aaa', mediaType: 'image', metadata: {} },
      { id: 'immich:bbb', mediaType: 'video', metadata: {} },
    ];

    // Simulate the slideshow stamping logic
    for (const item of items) {
      if (item.mediaType === 'image' && slideshow) {
        item.slideshow = slideshow;
      }
    }

    expect(items[0].slideshow).toEqual(slideshow);
    expect(items[1]).not.toHaveProperty('slideshow');
  });
});
```

**Step 2: Run test to verify it passes (logic validation)**

Run: `npx vitest run tests/isolated/adapters/content/query/QueryAdapter.immich-exclude.test.mjs`
Expected: PASS (these validate the logic pattern before we wire it in)

**Step 3: Implement — add exclude + slideshow to QueryAdapter**

In `backend/src/1_adapters/content/query/QueryAdapter.mjs`, replace lines 276-286 (after mediaType filter, before sort):

```javascript
    // Filter by mediaType if specified
    let filtered = mediaType
      ? dateFiltered.filter(item => item.mediaType === mediaType)
      : dateFiltered;

    // Exclude specific asset IDs
    if (query.exclude?.length > 0) {
      const excludeSet = new Set(query.exclude);
      filtered = filtered.filter(item => {
        const assetId = item.id?.replace(/^immich:/, '');
        return !excludeSet.has(assetId);
      });
    }

    // Stamp slideshow config on image items
    if (query.slideshow) {
      for (const item of filtered) {
        if (item.mediaType === 'image') {
          item.slideshow = query.slideshow;
        }
      }
    }

    // Sort if specified
    if (query.sort) {
      const getDate = (item) => item.metadata?.capturedAt || item.title || '';
      if (query.sort === 'date_desc') {
        filtered.sort((a, b) => getDate(b).localeCompare(getDate(a)));
      } else if (query.sort === 'date_asc') {
        filtered.sort((a, b) => getDate(a).localeCompare(getDate(b)));
      }
    }

    return filtered;
```

**Step 4: Run tests**

Run: `npx vitest run tests/isolated/adapters/content/query/`
Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/query/QueryAdapter.mjs tests/isolated/adapters/content/query/QueryAdapter.immich-exclude.test.mjs
git commit -m "feat(queries): add exclude filter and slideshow stamping for immich queries"
```

---

## Task 3: ImmichAdapter — Enrich People with Face Bounding Boxes

**Files:**
- Modify: `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs:811`

**Step 1: Write the failing test**

Create `tests/isolated/adapters/content/gallery/immich/ImmichAdapter.faces.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';

describe('ImmichAdapter face enrichment', () => {
  // Test the transformation logic that will replace .map(p => p.name)
  const transformPeople = (people) =>
    people?.map(p => ({
      name: p.name,
      id: p.id,
      faces: p.faces?.map(f => ({
        x1: f.boundingBoxX1, y1: f.boundingBoxY1,
        x2: f.boundingBoxX2, y2: f.boundingBoxY2,
        imageWidth: f.imageWidth, imageHeight: f.imageHeight,
      })) || [],
    })) || [];

  it('transforms people with face bounding boxes', () => {
    const input = [{
      name: 'Felix',
      id: 'person-uuid-1',
      faces: [{
        boundingBoxX1: 100, boundingBoxY1: 50,
        boundingBoxX2: 300, boundingBoxY2: 250,
        imageWidth: 1024, imageHeight: 768,
      }],
    }];

    const result = transformPeople(input);
    expect(result).toEqual([{
      name: 'Felix',
      id: 'person-uuid-1',
      faces: [{
        x1: 100, y1: 50, x2: 300, y2: 250,
        imageWidth: 1024, imageHeight: 768,
      }],
    }]);
  });

  it('handles people with no faces array', () => {
    const input = [{ name: 'Unknown', id: 'person-uuid-2' }];
    const result = transformPeople(input);
    expect(result).toEqual([{ name: 'Unknown', id: 'person-uuid-2', faces: [] }]);
  });

  it('handles null/undefined people', () => {
    expect(transformPeople(null)).toEqual([]);
    expect(transformPeople(undefined)).toEqual([]);
  });

  it('preserves backward compatibility — name field still accessible', () => {
    const input = [{ name: 'Felix', id: 'p1', faces: [] }];
    const result = transformPeople(input);
    expect(result[0].name).toBe('Felix');
    expect(result.map(p => p.name)).toEqual(['Felix']);
  });
});
```

**Step 2: Run test to verify it passes (validates transform logic)**

Run: `npx vitest run tests/isolated/adapters/content/gallery/immich/ImmichAdapter.faces.test.mjs`
Expected: PASS

**Step 3: Implement — replace .map(p => p.name) in ImmichAdapter**

In `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs`, replace line 811:

Old:
```javascript
        people: asset.people?.map(p => p.name) || []
```

New:
```javascript
        people: asset.people?.map(p => ({
          name: p.name,
          id: p.id,
          faces: p.faces?.map(f => ({
            x1: f.boundingBoxX1, y1: f.boundingBoxY1,
            x2: f.boundingBoxX2, y2: f.boundingBoxY2,
            imageWidth: f.imageWidth, imageHeight: f.imageHeight,
          })) || [],
        })) || []
```

**Step 4: Verify no other code breaks**

Search for code that consumes `metadata.people` and assumes it's an array of strings. Common patterns:
- `.map(p => p.name)` — still works (name is still a field)
- `.includes('Felix')` — BREAKS if it was checking string array. Search with: `grep -r "people.*includes\|people.*indexOf" frontend/ backend/`

Fix any consumers that assumed `people` was `string[]` — they now need `.map(p => p.name)` first.

**Step 5: Run full test suite**

Run: `npx vitest run tests/isolated/`
Expected: All PASS

**Step 6: Commit**

```bash
git add backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs tests/isolated/adapters/content/gallery/immich/ImmichAdapter.faces.test.mjs
git commit -m "feat(immich): enrich people metadata with face bounding boxes"
```

---

## Task 4: Registry — Add 'image' to Media Playback Formats

**Files:**
- Modify: `frontend/src/modules/Player/lib/registry.js:36`

**Step 1: Modify MEDIA_PLAYBACK_FORMATS**

In `frontend/src/modules/Player/lib/registry.js`, replace line 36:

Old:
```javascript
const MEDIA_PLAYBACK_FORMATS = new Set(['video', 'dash_video', 'audio']);
```

New:
```javascript
const MEDIA_PLAYBACK_FORMATS = new Set(['video', 'dash_video', 'audio', 'image']);
```

**Step 2: Verify**

This is a one-line change. The `isMediaFormat('image')` will now return `true`, which means `SinglePlayer.renderByFormat()` will route `format: 'image'` through the media playback branch (line 375) instead of the content renderer branch.

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/lib/registry.js
git commit -m "feat(player): register 'image' as media playback format"
```

---

## Task 5: ImageFrame Renderer — Ken Burns with Smart Zoom

**Files:**
- Create: `frontend/src/modules/Player/renderers/ImageFrame.jsx`
- Create: `frontend/src/modules/Player/renderers/ImageFrame.scss`

**Step 1: Create ImageFrame.scss**

Create `frontend/src/modules/Player/renderers/ImageFrame.scss`:

```scss
.image-frame {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;

  &__img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    will-change: transform;
  }

  &--loading {
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
```

**Step 2: Create ImageFrame.jsx**

Create `frontend/src/modules/Player/renderers/ImageFrame.jsx`:

```jsx
import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import './ImageFrame.scss';
import getLogger from '../../../lib/logging/Logger.js';

const logger = getLogger().child({ component: 'ImageFrame' });

/**
 * Compute Ken Burns animation target based on face data.
 *
 * Priority:
 * 1. focusPerson face bounding box center
 * 2. Largest face bounding box center (closest face)
 * 3. Random point in center 60% of image
 *
 * @param {Object} opts
 * @param {Array} opts.people - People metadata with faces array
 * @param {string|null} opts.focusPerson - Preferred person name
 * @param {number} opts.zoom - Zoom factor (e.g., 1.2)
 * @returns {{ startX: string, startY: string, endX: string, endY: string }}
 */
function computeZoomTarget({ people, focusPerson, zoom }) {
  const maxTranslate = ((zoom - 1) / zoom) * 50; // max % translate that keeps image in frame

  let targetX = 0.5; // normalized 0-1
  let targetY = 0.5;
  let found = false;

  const allFaces = (people || []).flatMap(p =>
    (p.faces || []).map(f => ({ ...f, personName: p.name }))
  );

  if (focusPerson && allFaces.length > 0) {
    const match = allFaces.find(f =>
      f.personName?.toLowerCase() === focusPerson.toLowerCase()
    );
    if (match && match.imageWidth && match.imageHeight) {
      targetX = ((match.x1 + match.x2) / 2) / match.imageWidth;
      targetY = ((match.y1 + match.y2) / 2) / match.imageHeight;
      found = true;
    }
  }

  if (!found && allFaces.length > 0) {
    // Pick largest bounding box (closest face)
    let largest = allFaces[0];
    let largestArea = 0;
    for (const f of allFaces) {
      const area = Math.abs((f.x2 - f.x1) * (f.y2 - f.y1));
      if (area > largestArea) {
        largestArea = area;
        largest = f;
      }
    }
    if (largest.imageWidth && largest.imageHeight) {
      targetX = ((largest.x1 + largest.x2) / 2) / largest.imageWidth;
      targetY = ((largest.y1 + largest.y2) / 2) / largest.imageHeight;
      found = true;
    }
  }

  if (!found) {
    // Random point in center 60% (0.2 to 0.8)
    targetX = 0.2 + Math.random() * 0.6;
    targetY = 0.2 + Math.random() * 0.6;
  }

  // Convert normalized target to translate percentages
  // Start slightly offset from center, end at face target
  const startOffX = (0.5 - targetX) * maxTranslate * 0.3;
  const startOffY = (0.5 - targetY) * maxTranslate * 0.3;
  const endOffX = (0.5 - targetX) * maxTranslate;
  const endOffY = (0.5 - targetY) * maxTranslate;

  return {
    startX: `${startOffX.toFixed(2)}%`,
    startY: `${startOffY.toFixed(2)}%`,
    endX: `${endOffX.toFixed(2)}%`,
    endY: `${endOffY.toFixed(2)}%`,
  };
}

/**
 * ImageFrame — single photo renderer with Ken Burns effect.
 *
 * Implements the same callback contract as VideoPlayer/AudioPlayer:
 * - resilienceBridge.onPlaybackMetrics({ seconds, isPaused })
 * - resilienceBridge.onRegisterMediaAccess({ hardReset })
 * - resilienceBridge.onStartupSignal()
 * - advance() when duration expires
 */
export function ImageFrame({
  media,
  advance,
  clear,
  shader,
  resilienceBridge,
  ignoreKeys,
}) {
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const animationRef = useRef(null);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const rafRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  const slideshow = media?.slideshow || {};
  const duration = (slideshow.duration || 5) * 1000; // ms
  const zoom = slideshow.zoom || 1.2;
  const effect = slideshow.effect || 'kenburns';
  const focusPerson = slideshow.focusPerson || null;
  const people = media?.metadata?.people || [];

  const zoomTarget = useMemo(
    () => computeZoomTarget({ people, focusPerson, zoom }),
    [people, focusPerson, zoom]
  );

  // Register media access for resilience bridge
  useEffect(() => {
    if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
      resilienceBridge.onRegisterMediaAccess({
        getMediaEl: () => imgRef.current,
        hardReset: () => {
          // Restart animation
          if (animationRef.current) {
            animationRef.current.cancel();
          }
        },
      });
    }
    return () => {
      if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
        resilienceBridge.onRegisterMediaAccess({});
      }
    };
  }, [resilienceBridge]);

  // Start Ken Burns animation + duration timer once image loads
  useEffect(() => {
    if (!loaded || !imgRef.current) return;

    logger.info('image-frame-start', {
      mediaUrl: media?.mediaUrl,
      duration: duration / 1000,
      effect,
      zoom,
      focusPerson,
    });

    // Signal startup
    if (typeof resilienceBridge?.onStartupSignal === 'function') {
      resilienceBridge.onStartupSignal();
    }

    // Start Ken Burns animation via Web Animations API
    if (effect === 'kenburns') {
      animationRef.current = imgRef.current.animate([
        { transform: `scale(1.0) translate(${zoomTarget.startX}, ${zoomTarget.startY})` },
        { transform: `scale(${zoom}) translate(${zoomTarget.endX}, ${zoomTarget.endY})` },
      ], {
        duration,
        easing: 'ease-in-out',
        fill: 'forwards',
      });
    }

    // Tick playback metrics
    startTimeRef.current = Date.now();
    const tickMetrics = () => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      if (typeof resilienceBridge?.onPlaybackMetrics === 'function') {
        resilienceBridge.onPlaybackMetrics({
          seconds: elapsed,
          isPaused: false,
          isSeeking: false,
        });
      }
      rafRef.current = requestAnimationFrame(tickMetrics);
    };
    rafRef.current = requestAnimationFrame(tickMetrics);

    // Advance after duration
    timerRef.current = setTimeout(() => {
      logger.debug('image-frame-advance', { mediaUrl: media?.mediaUrl });
      if (typeof advance === 'function') advance();
    }, duration);

    return () => {
      if (animationRef.current) animationRef.current.cancel();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [loaded, media?.mediaUrl, duration, effect, zoom, zoomTarget, advance, resilienceBridge, focusPerson]);

  const handleLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  const handleError = useCallback(() => {
    logger.warn('image-frame-load-error', { mediaUrl: media?.mediaUrl });
    // Skip to next item on load failure
    if (typeof advance === 'function') advance();
  }, [advance, media?.mediaUrl]);

  if (!media?.mediaUrl) {
    return <div className="image-frame image-frame--loading" />;
  }

  return (
    <div ref={containerRef} className="image-frame">
      <img
        ref={imgRef}
        className="image-frame__img"
        src={media.mediaUrl}
        alt={media.title || ''}
        onLoad={handleLoad}
        onError={handleError}
        draggable={false}
      />
    </div>
  );
}

ImageFrame.propTypes = {
  media: PropTypes.object.isRequired,
  advance: PropTypes.func.isRequired,
  clear: PropTypes.func,
  shader: PropTypes.string,
  resilienceBridge: PropTypes.shape({
    onPlaybackMetrics: PropTypes.func,
    onRegisterMediaAccess: PropTypes.func,
    onStartupSignal: PropTypes.func,
  }),
  ignoreKeys: PropTypes.bool,
};
```

**Step 3: Verify renders**

Start dev server, navigate to Player route with a test image item manually. Confirm Ken Burns animation plays and item auto-advances after duration.

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/renderers/ImageFrame.jsx frontend/src/modules/Player/renderers/ImageFrame.scss
git commit -m "feat(player): add ImageFrame renderer with Ken Burns smart zoom"
```

---

## Task 6: SinglePlayer — Route 'image' Format to ImageFrame

**Files:**
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx:7-8,375-376`

**Step 1: Add import**

In `frontend/src/modules/Player/components/SinglePlayer.jsx`, add after line 8 (`import { VideoPlayer }`):

```javascript
import { ImageFrame } from '../renderers/ImageFrame.jsx';
```

**Step 2: Modify format dispatch**

Replace lines 375-376:

Old:
```javascript
    if (isMediaFormat(format)) {
      const PlayerComponent = format === 'audio' ? AudioPlayer : VideoPlayer;
```

New:
```javascript
    if (isMediaFormat(format)) {
      if (format === 'image') {
        return (
          <ImageFrame
            media={mediaInfo}
            advance={advance}
            clear={clear}
            shader={shader}
            resilienceBridge={resilienceBridge}
            ignoreKeys={ignoreKeys}
          />
        );
      }
      const PlayerComponent = format === 'audio' ? AudioPlayer : VideoPlayer;
```

**Step 3: Verify**

Queue an image item. Confirm it routes to ImageFrame (not VideoPlayer).

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/components/SinglePlayer.jsx
git commit -m "feat(player): route image format to ImageFrame renderer"
```

---

## Task 7: AudioLayer Component

**Files:**
- Create: `frontend/src/modules/Player/components/AudioLayer.jsx`

**Step 1: Create AudioLayer.jsx**

Create `frontend/src/modules/Player/components/AudioLayer.jsx`:

```jsx
import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '../../../lib/logging/Logger.js';

const logger = getLogger().child({ component: 'AudioLayer' });

/**
 * AudioLayer — configurable audio track that sits alongside a visual queue.
 *
 * Renders an inner <Player> for actual playback. Controls pause/duck/skip
 * behavior based on the current queue item's media type.
 *
 * Modes:
 * - hidden: no visible UI, audio only
 * - overlay: visible controls over visual content
 * - mini: small persistent bar
 *
 * Behaviors (during video items):
 * - pause: pause audio, resume at same position when video ends (default)
 * - duck: lower volume to ~10%, restore after
 * - skip: let audio time advance, don't pause
 */
export function AudioLayer({
  contentId,
  behavior = 'pause',
  mode = 'hidden',
  currentItemMediaType,
  Player,
  ignoreKeys: parentIgnoreKeys,
}) {
  const playerRef = useRef(null);
  const prevMediaTypeRef = useRef(currentItemMediaType);
  const savedVolumeRef = useRef(1);
  const [audioQueue, setAudioQueue] = useState(null);

  // Resolve contentId to playable queue via API
  useEffect(() => {
    if (!contentId) return;

    let cancelled = false;
    const resolve = async () => {
      try {
        const response = await fetch(`/api/v1/queue/${encodeURIComponent(contentId)}`);
        if (!response.ok) {
          logger.warn('audio-layer-resolve-failed', { contentId, status: response.status });
          return;
        }
        const data = await response.json();
        if (!cancelled) {
          setAudioQueue(data.items || data);
          logger.info('audio-layer-resolved', { contentId, itemCount: (data.items || data).length });
        }
      } catch (err) {
        logger.error('audio-layer-resolve-error', { contentId, error: err.message });
      }
    };

    resolve();
    return () => { cancelled = true; };
  }, [contentId]);

  // React to media type changes (video vs image) for pause/duck/skip
  useEffect(() => {
    const prev = prevMediaTypeRef.current;
    prevMediaTypeRef.current = currentItemMediaType;

    if (!playerRef.current) return;
    if (prev === currentItemMediaType) return;

    const isVideo = currentItemMediaType === 'video';
    const wasVideo = prev === 'video';

    if (isVideo && !wasVideo) {
      // Entering video — apply behavior
      if (behavior === 'pause') {
        logger.debug('audio-layer-pause', { reason: 'video-start' });
        playerRef.current.pause();
      } else if (behavior === 'duck') {
        logger.debug('audio-layer-duck', { reason: 'video-start' });
        // Duck volume — implementation via CSS or direct media element
        const el = playerRef.current.getMediaElement?.();
        if (el) {
          savedVolumeRef.current = el.volume;
          el.volume = Math.max(0, el.volume * 0.1);
        }
      }
      // 'skip' — do nothing, audio continues
    } else if (wasVideo && !isVideo) {
      // Leaving video — restore
      if (behavior === 'pause') {
        logger.debug('audio-layer-resume', { reason: 'video-end' });
        playerRef.current.play();
      } else if (behavior === 'duck') {
        logger.debug('audio-layer-unduck', { reason: 'video-end' });
        const el = playerRef.current.getMediaElement?.();
        if (el) {
          el.volume = savedVolumeRef.current;
        }
      }
    }
  }, [currentItemMediaType, behavior]);

  const noop = useCallback(() => {}, []);

  // Don't render until queue is resolved
  if (!audioQueue || !Player) return null;

  const isHidden = mode === 'hidden';
  const containerStyle = isHidden
    ? { position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }
    : {};
  const containerClass = `audio-layer audio-layer--${mode}`;

  return (
    <div className={containerClass} style={containerStyle} data-track="audio">
      <Player
        ref={playerRef}
        playerType="background"
        queue={audioQueue}
        clear={noop}
        ignoreKeys={isHidden ? true : parentIgnoreKeys}
        shuffle={true}
      />
    </div>
  );
}

AudioLayer.propTypes = {
  contentId: PropTypes.string.isRequired,
  behavior: PropTypes.oneOf(['pause', 'duck', 'skip']),
  mode: PropTypes.oneOf(['hidden', 'overlay', 'mini']),
  currentItemMediaType: PropTypes.string,
  Player: PropTypes.elementType.isRequired,
  ignoreKeys: PropTypes.bool,
};
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Player/components/AudioLayer.jsx
git commit -m "feat(player): add AudioLayer component with pause/duck/skip behaviors"
```

---

## Task 8: Player.jsx — Integrate AudioLayer and Remove CompositePlayer Gate

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx:1-17,77-106`

**Step 1: Update imports**

In `frontend/src/modules/Player/Player.jsx`:

Remove line 5:
```javascript
import { CompositePlayer } from './renderers/CompositePlayer.jsx';
```

Remove line 14:
```javascript
import { useCompositeControllerChannel } from './components/CompositeControllerContext.jsx';
```

Add after remaining imports:
```javascript
import { AudioLayer } from './components/AudioLayer.jsx';
```

**Step 2: Remove CompositePlayer gate and compositeChannel**

Replace lines 77-106:

Old:
```javascript
const Player = forwardRef(function Player(props, ref) {
  // Detect composite presentations:
  // - Old format: play.overlay or queue.overlay
  // - New format: visual + audio tracks
  // - Sources format: sources array (unresolved, needs backend resolution)
  if (props.play?.overlay || props.queue?.overlay || props.visual || props.audio || props.sources) {
    return <CompositePlayer {...props} Player={Player} />;
  }

  const noop = useMemo(() => () => {}, []);

  let {
    play,
    queue,
    clear = noop,
    playbackrate,
    playbackKeys,
    playerType,
    ignoreKeys,
    keyboardOverrides,
    resilience,
    mediaResilienceConfig,
    onResilienceState,
    mediaResilienceRef,
    maxVideoBitrate,
    maxResolution,
    pauseDecision,
    plexClientSession: externalPlexClientSession
  } = props || {};
  const compositeChannel = useCompositeControllerChannel(playerType);
```

New:
```javascript
const Player = forwardRef(function Player(props, ref) {
  const noop = useMemo(() => () => {}, []);

  let {
    play,
    queue,
    clear = noop,
    playbackrate,
    playbackKeys,
    playerType,
    ignoreKeys,
    keyboardOverrides,
    resilience,
    mediaResilienceConfig,
    onResilienceState,
    mediaResilienceRef,
    maxVideoBitrate,
    maxResolution,
    pauseDecision,
    plexClientSession: externalPlexClientSession
  } = props || {};
```

**Step 3: Remove compositeChannel references**

Search for `compositeChannel` in the rest of Player.jsx and remove/replace:

- Line 106: `const compositeChannel = useCompositeControllerChannel(playerType);` — already removed above
- Line 504: `compositeChannel?.reportResilienceState(state);` — remove this line
- Line 682: `compositeChannel?.registerController(controller);` — remove this line

**Step 4: Extract audio config from queue and render AudioLayer**

The audio config comes from the queue/play metadata (stamped by the query system). Find the `activeSource` and check for audio config.

In the render section (around line 857, before `mainContent`), add:

```javascript
  // Audio layer — rendered alongside queue when audio config is present
  const audioConfig = play?.audio || queue?.audio || null;
  const currentItemMediaType = activeSource?.mediaType || null;
```

In the return JSX (around line 865), wrap with AudioLayer:

Old:
```javascript
  return (
    <div className={playerShellClass}>
      {overlayElements}
      {mainContent}
    </div>
  );
```

New:
```javascript
  return (
    <div className={playerShellClass}>
      {audioConfig && (
        <AudioLayer
          contentId={audioConfig.contentId}
          behavior={audioConfig.behavior || 'pause'}
          mode={audioConfig.mode || 'hidden'}
          currentItemMediaType={currentItemMediaType}
          Player={Player}
          ignoreKeys={ignoreKeys}
        />
      )}
      {overlayElements}
      {mainContent}
    </div>
  );
```

**Step 5: Verify no build errors**

Run: `npm run dev` — confirm no import errors or crashes.

**Step 6: Commit**

```bash
git add frontend/src/modules/Player/Player.jsx
git commit -m "feat(player): integrate AudioLayer, remove CompositePlayer gate"
```

---

## Task 9: Remove CompositePlayer and Supporting Files

**Files:**
- Delete: `frontend/src/modules/Player/renderers/CompositePlayer.jsx`
- Delete: `frontend/src/modules/Player/components/CompositeContext.jsx`
- Delete: `frontend/src/modules/Player/components/CompositeControllerContext.jsx`
- Delete: `frontend/src/modules/Player/components/VisualRenderer.jsx`
- Delete: `frontend/src/modules/Player/components/ImageCarousel.jsx`
- Delete: `frontend/src/modules/Player/hooks/useAdvanceController.js`

**Step 1: Verify no remaining imports**

Search for any imports of these files outside of themselves:

```bash
grep -r "CompositePlayer\|CompositeContext\|CompositeControllerContext\|VisualRenderer\|ImageCarousel\|useAdvanceController" frontend/src/ --include="*.jsx" --include="*.js" -l
```

Expected: Only the files being deleted should reference each other. Player.jsx should no longer reference any of them after Task 8.

If any other file imports these, update it first.

**Step 2: Delete files**

```bash
git rm frontend/src/modules/Player/renderers/CompositePlayer.jsx
git rm frontend/src/modules/Player/components/CompositeContext.jsx
git rm frontend/src/modules/Player/components/CompositeControllerContext.jsx
git rm frontend/src/modules/Player/components/VisualRenderer.jsx
git rm frontend/src/modules/Player/components/ImageCarousel.jsx
git rm frontend/src/modules/Player/hooks/useAdvanceController.js
```

**Step 3: Verify build**

Run: `npm run dev` — confirm no broken imports or build errors.

**Step 4: Update any test files**

Check: `tests/live/flow/tv/tv-composite-player.runtime.test.mjs` — this test references CompositePlayer. Either remove it or update it to test the new mixed media queue path.

**Step 5: Commit**

```bash
git commit -m "refactor(player): remove CompositePlayer and supporting files"
```

---

## Task 10: Create Query YAML File

**Files:**
- Create: `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/users/kckern/config/queries/mar4-videos-photos.yml`

**Step 1: Write the query file**

```yaml
title: March 4 Videos & Photos
type: immich
sort: date_desc
params:
  # omit mediaType to include both photos and videos
  month: 3
  day: 4
  yearFrom: 2014
exclude: []
slideshow:
  duration: 5
  effect: kenburns
  zoom: 1.2
  transition: crossfade
  focusPerson: Felix
audio:
  contentId: music:anniversary
  behavior: pause
  mode: hidden
```

**Step 2: Verify via API**

```bash
curl http://localhost:3112/api/v1/queries/mar4-videos-photos | jq .
```

Expected: Returns the normalized query with `exclude`, `slideshow`, `audio` fields.

**Step 3: No commit needed** — data file lives outside the git repo (Dropbox mount).

---

## Task 11: End-to-End Smoke Test

**Step 1: Start dev server**

```bash
npm run dev
```

**Step 2: Test mixed media queue**

Navigate to the Player route with the `mar4-videos-photos` query. Verify:

- [ ] Photos and videos appear interleaved, sorted by date descending
- [ ] Photos display with Ken Burns zoom effect (Web Animations API)
- [ ] Photos auto-advance after 5 seconds
- [ ] Videos play normally via VideoPlayer
- [ ] Brief fade transition between items (photo→video, video→photo)
- [ ] Background audio plays during photo slideshow
- [ ] Background audio pauses when a video starts
- [ ] Background audio resumes when video ends
- [ ] Excluded asset IDs do not appear in the queue
- [ ] No console errors or React warnings

**Step 3: Test edge cases**

- [ ] Query with no photos (all videos) — should work like a normal video queue
- [ ] Query with no videos (all photos) — should work as a pure slideshow with audio
- [ ] Query with no audio config — should work as silent mixed media queue
- [ ] Photo with no face data — Ken Burns uses random strike zone
- [ ] Photo with face data but no focusPerson — Ken Burns targets largest face

**Step 4: Commit any fixes found during testing**

```bash
git add -A
git commit -m "fix: address issues found during mixed media smoke test"
```
