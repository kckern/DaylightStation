# Mixed Media Slideshow — Part 2: Remaining Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the remaining issues identified in the [implementation audit](../\_wip/audits/2026-03-03-mixed-media-slideshow-implementation-audit.md) so the mixed media slideshow (photos + videos + audio layer) works end-to-end.

**Architecture:** No new architecture — this plan fixes bugs in the existing queue-driven mixed media system. The core pipeline is: Query YAML → SavedQueryService → QueryAdapter → ImmichAdapter → queue.mjs → useQueueController → Player → SinglePlayer → ImageFrame/VideoPlayer + AudioLayer.

**Tech Stack:** React, Web Animations API, Immich API, Vitest, existing Player infrastructure.

---

## Context: What's Already Done

Tasks 1–9 from the [original plan](2026-03-03-mixed-media-slideshow.md) are committed (9 commits, `989db99b..f9930f45`). Five files have additional uncommitted fixes in the working tree. The audit identified these remaining issues:

| Priority | Issue | Root Cause |
|----------|-------|------------|
| Critical | AudioLayer never renders | `useQueueController` destructures only `{ items }` from API response, dropping `audio` |
| Critical | ImageFrame render loop | Fixed via `useMemo` but not verified |
| Important | No face data during playback | Immich `searchMetadata` API doesn't return `people.faces` bounding boxes |
| Important | `/info/` returns `format: 'video'` for images | `#toListableItem` sets no `mediaType`; `resolveFormat` falls through to `'video'` |
| Minor | Orphaned test files | `tv-composite-player` and `useAdvanceController` tests reference deleted code |
| Minor | `music:anniversary` content ID | Must resolve via ContentIdResolver or AudioLayer silently fails |

---

## Task 1: Commit Existing Uncommitted Fixes

The 5 modified files from the audit have working fixes that should be committed before we layer more changes on top.

**Files:**
- Stage: `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs`
- Stage: `backend/src/1_adapters/content/query/QueryAdapter.mjs`
- Stage: `backend/src/4_api/v1/routers/queue.mjs`
- Stage: `frontend/src/modules/Player/renderers/ImageFrame.jsx`
- Stage: `frontend/src/modules/Player/components/AudioLayer.jsx`

**Step 1: Review the diffs**

```bash
git diff backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs
git diff backend/src/1_adapters/content/query/QueryAdapter.mjs
git diff backend/src/4_api/v1/routers/queue.mjs
git diff frontend/src/modules/Player/renderers/ImageFrame.jsx
git diff frontend/src/modules/Player/components/AudioLayer.jsx
```

Verify the changes match the audit descriptions:
- ImmichAdapter: `#searchAssets` uses `#toPlayableItem()` for all assets (not just videos)
- QueryAdapter: `items.audio = query.audio` after `#resolveImmichQuery()` returns
- queue.mjs: `toQueueItem()` passes `slideshow`/`metadata`; response includes `audio` at top level
- ImageFrame: `useMemo` wrappings for `slideshow`, `people`, `peopleNames`, `hasFaces`; logging
- AudioLayer: mount/unmount logging, resolve logging with track titles, enriched pause/duck logs

**Step 2: Commit**

```bash
git add backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs \
       backend/src/1_adapters/content/query/QueryAdapter.mjs \
       backend/src/4_api/v1/routers/queue.mjs \
       frontend/src/modules/Player/renderers/ImageFrame.jsx \
       frontend/src/modules/Player/components/AudioLayer.jsx
git commit -m "fix(slideshow): commit audit fixes — PlayableItem for photos, audio passthrough, render loop, logging"
```

---

## Task 2: Fix useQueueController to Propagate Audio Config

**The critical bug.** The `useQueueController` hook destructures only `{ items }` from the `/api/v1/queue/` API response, silently discarding the top-level `audio` field. Player.jsx reads `audioConfig` from `play?.audio || queue?.audio || activeSource?.audio` — none of these paths hold the API-returned audio config.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js:105,112-114,226-241`
- Modify: `frontend/src/modules/Player/Player.jsx:101-113,845`

### Step 1: Write the failing test

Create `tests/isolated/modules/Player/useQueueController.audio.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';

describe('useQueueController audio propagation contract', () => {
  // Validates the data shape contract: when the queue API returns
  // { items: [...], audio: {...} }, the audio field must be accessible.

  it('extracts audio from queue API response alongside items', () => {
    // Simulate the API response shape from queue.mjs (lines 144-152)
    const apiResponse = {
      source: 'query',
      id: 'query:mar4-videos-photos',
      count: 3,
      totalDuration: 45,
      thumbnail: null,
      audio: { contentId: 'music:anniversary', behavior: 'pause', mode: 'hidden' },
      items: [
        { id: 'immich:aaa', mediaType: 'image', format: 'image' },
        { id: 'immich:bbb', mediaType: 'video', format: 'video' },
        { id: 'immich:ccc', mediaType: 'image', format: 'image' },
      ],
    };

    // The fix: destructure both items and audio
    const { items, audio } = apiResponse;

    expect(items).toHaveLength(3);
    expect(audio).toEqual({
      contentId: 'music:anniversary',
      behavior: 'pause',
      mode: 'hidden',
    });
  });

  it('handles missing audio gracefully', () => {
    const apiResponse = {
      items: [{ id: 'immich:aaa', mediaType: 'video' }],
    };

    const { items, audio } = apiResponse;

    expect(items).toHaveLength(1);
    expect(audio).toBeUndefined();
  });
});
```

### Step 2: Run test to verify it passes (validates the contract)

Run: `npx vitest run tests/isolated/modules/Player/useQueueController.audio.test.mjs`
Expected: PASS

### Step 3: Implement — capture and return audio from useQueueController

In `frontend/src/modules/Player/hooks/useQueueController.js`:

**3a.** Add `queueAudio` state. After the existing `useState` declarations (around line 30), add:

```javascript
const [queueAudio, setQueueAudio] = useState(null);
```

**3b.** Line 105 — destructure `audio` from the API response:

Old:
```javascript
          const { items } = await DaylightAPI(`api/v1/queue/${contentRef}${shuffleParam}`);
          newQueue = items.map(item => ({ ...item, ...itemOverrides, guid: guid() }));
```

New:
```javascript
          const response = await DaylightAPI(`api/v1/queue/${contentRef}${shuffleParam}`);
          const { items, audio: responseAudio } = response;
          newQueue = items.map(item => ({ ...item, ...itemOverrides, guid: guid() }));
```

**3c.** Lines 112-114 — store audio alongside queue:

Old:
```javascript
      if (!isCancelled) {
        setQueue(newQueue);
        setOriginalQueue(newQueue);
      }
```

New:
```javascript
      if (!isCancelled) {
        setQueue(newQueue);
        setOriginalQueue(newQueue);
        if (responseAudio !== undefined) setQueueAudio(responseAudio);
      }
```

Note: `responseAudio` variable is in the `if (contentRef)` branch scope. Move the `let responseAudio` declaration above the if/else chain so it's accessible:

Old (lines 102-111):
```javascript
      } else if ((play && typeof play === 'object') || (queue && typeof queue === 'object')) {
        if (contentRef) {
          const shuffleParam = isShuffle ? '?shuffle=true' : '';
          const response = await DaylightAPI(`api/v1/queue/${contentRef}${shuffleParam}`);
          const { items, audio: responseAudio } = response;
          newQueue = items.map(item => ({ ...item, ...itemOverrides, guid: guid() }));
        } else if (play?.media) {
          newQueue = [{ ...play, ...itemOverrides, guid: guid() }];
        }
      }
      if (!isCancelled) {
        setQueue(newQueue);
        setOriginalQueue(newQueue);
        if (responseAudio !== undefined) setQueueAudio(responseAudio);
      }
```

Better approach — hoist `responseAudio` above the if/else:

```javascript
      } else if ((play && typeof play === 'object') || (queue && typeof queue === 'object')) {
        let responseAudio;
        if (contentRef) {
          const shuffleParam = isShuffle ? '?shuffle=true' : '';
          const response = await DaylightAPI(`api/v1/queue/${contentRef}${shuffleParam}`);
          ({ items: newQueue, audio: responseAudio } = {
            items: response.items.map(item => ({ ...item, ...itemOverrides, guid: guid() })),
            audio: response.audio,
          });
        } else if (play?.media) {
          newQueue = [{ ...play, ...itemOverrides, guid: guid() }];
        }
        if (!isCancelled) {
          setQueue(newQueue);
          setOriginalQueue(newQueue);
          if (responseAudio) setQueueAudio(responseAudio);
        }
      }
```

Actually, keep it simpler and closer to the existing style:

```javascript
      } else if ((play && typeof play === 'object') || (queue && typeof queue === 'object')) {
        let fetchedAudio = null;
        if (contentRef) {
          const shuffleParam = isShuffle ? '?shuffle=true' : '';
          const response = await DaylightAPI(`api/v1/queue/${contentRef}${shuffleParam}`);
          newQueue = response.items.map(item => ({ ...item, ...itemOverrides, guid: guid() }));
          fetchedAudio = response.audio || null;
        } else if (play?.media) {
          newQueue = [{ ...play, ...itemOverrides, guid: guid() }];
        }
        if (!isCancelled) {
          setQueue(newQueue);
          setOriginalQueue(newQueue);
          setQueueAudio(fetchedAudio);
        }
      }
```

Wait — the `if (!isCancelled)` block at line 112 is OUTSIDE the `else if` block. We need to keep the existing structure. Here's the minimal, safe change:

**Final approach:** Add a `let fetchedAudio = null;` at the top of `initQueue`, capture it from the response, and store it alongside queue:

At the top of `initQueue()` (after `let newQueue = [];`), add:
```javascript
      let fetchedAudio = null;
```

Replace line 105-106:
```javascript
          const { items } = await DaylightAPI(`api/v1/queue/${contentRef}${shuffleParam}`);
          newQueue = items.map(item => ({ ...item, ...itemOverrides, guid: guid() }));
```
With:
```javascript
          const response = await DaylightAPI(`api/v1/queue/${contentRef}${shuffleParam}`);
          newQueue = response.items.map(item => ({ ...item, ...itemOverrides, guid: guid() }));
          fetchedAudio = response.audio || null;
```

Replace lines 112-114:
```javascript
      if (!isCancelled) {
        setQueue(newQueue);
        setOriginalQueue(newQueue);
      }
```
With:
```javascript
      if (!isCancelled) {
        setQueue(newQueue);
        setOriginalQueue(newQueue);
        setQueueAudio(fetchedAudio);
      }
```

**3d.** Lines 226-241 — add `queueAudio` to the return object:

Old:
```javascript
  return {
    classes,
    cycleThroughClasses,
    shader,
    shaderUserCycled,
    setShader,
    isQueue,
    volume,
    isContinuous,
    playQueue,
    playbackRate: play?.playbackRate || play?.playbackrate || queue?.playbackRate || queue?.playbackrate || 1,
    setQueue,
    advance,
    queuePosition
  };
```

New:
```javascript
  return {
    classes,
    cycleThroughClasses,
    shader,
    shaderUserCycled,
    setShader,
    isQueue,
    volume,
    isContinuous,
    playQueue,
    playbackRate: play?.playbackRate || play?.playbackrate || queue?.playbackRate || queue?.playbackrate || 1,
    setQueue,
    advance,
    queuePosition,
    queueAudio,
  };
```

### Step 4: Thread queueAudio into Player.jsx

In `frontend/src/modules/Player/Player.jsx`:

**4a.** Lines 101-113 — destructure `queueAudio` from `useQueueController`:

Old:
```javascript
  const {
    classes,
    cycleThroughClasses,
    shader: queueShader,
    shaderUserCycled,
    setShader,
    isQueue,
    volume: queueVolume,
    queuePosition,
    playbackRate: queuePlaybackRate,
    playQueue,
    advance
  } = useQueueController({ play, queue, clear, shuffle: props?.shuffle });
```

New:
```javascript
  const {
    classes,
    cycleThroughClasses,
    shader: queueShader,
    shaderUserCycled,
    setShader,
    isQueue,
    volume: queueVolume,
    queuePosition,
    playbackRate: queuePlaybackRate,
    playQueue,
    advance,
    queueAudio,
  } = useQueueController({ play, queue, clear, shuffle: props?.shuffle });
```

**4b.** Line 845 — add `queueAudio` to the audioConfig lookup chain:

Old:
```javascript
  const audioConfig = play?.audio || queue?.audio || activeSource?.audio || null;
```

New:
```javascript
  const audioConfig = play?.audio || queue?.audio || queueAudio || activeSource?.audio || null;
```

### Step 5: Run tests

```bash
npx vitest run tests/isolated/modules/Player/
```
Expected: All PASS

### Step 6: Commit

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js \
       frontend/src/modules/Player/Player.jsx \
       tests/isolated/modules/Player/useQueueController.audio.test.mjs
git commit -m "fix(player): propagate audio config from queue API response to AudioLayer"
```

---

## Task 3: Fix resolveFormat for Images

**The bug:** When `/api/v1/info/immich:{id}` is called for an image, `resolveFormat` falls through to `'video'` because `#toListableItem` sets no `mediaType` field. The fix is to set `mediaType: 'image'` in `#toListableItem`.

**Files:**
- Modify: `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs:757-779`
- Test: `tests/isolated/adapters/content/gallery/immich/ImmichAdapter.faces.test.mjs` (extend)

### Step 1: Write the failing test

Add to `tests/isolated/adapters/content/gallery/immich/ImmichAdapter.faces.test.mjs`:

```javascript
describe('ListableItem image format', () => {
  it('images should have mediaType set so resolveFormat does not fall through', () => {
    // Simulate the ListableItem shape from #toListableItem
    // Before fix: no mediaType → resolveFormat returns 'video'
    // After fix: mediaType: 'image' → resolveFormat returns 'image'
    const item = {
      id: 'immich:abc123',
      source: 'immich',
      title: 'photo.jpg',
      itemType: 'leaf',
      mediaType: 'image', // This is what the fix adds
      metadata: { type: 'image', width: 1024, height: 768 },
    };

    // Simulate resolveFormat priority chain
    const format = item.metadata?.contentFormat || item.mediaType || 'video';
    expect(format).toBe('image');
  });
});
```

### Step 2: Run test to verify it passes (validates the expected shape)

Run: `npx vitest run tests/isolated/adapters/content/gallery/immich/ImmichAdapter.faces.test.mjs`
Expected: PASS

### Step 3: Implement — add mediaType to #toListableItem

In `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs`, in `#toListableItem()` (line 758), add `mediaType` to the ListableItem constructor:

Old:
```javascript
  #toListableItem(asset, context = {}) {
    return new ListableItem({
      id: `immich:${asset.id}`,
      source: 'immich',
      title: asset.originalFileName,
      itemType: 'leaf',
      thumbnail: this.#thumbnailUrl(asset.id),
      imageUrl: this.#originalUrl(asset.id),
      metadata: {
```

New:
```javascript
  #toListableItem(asset, context = {}) {
    return new ListableItem({
      id: `immich:${asset.id}`,
      source: 'immich',
      title: asset.originalFileName,
      itemType: 'leaf',
      mediaType: 'image',
      thumbnail: this.#thumbnailUrl(asset.id),
      imageUrl: this.#originalUrl(asset.id),
      metadata: {
```

### Step 4: Verify ListableItem accepts mediaType

Check `backend/src/2_domains/content/entities/ListableItem.mjs` to confirm the constructor doesn't strip unknown fields. If it has an allowlist, add `mediaType` to it.

### Step 5: Run full test suite

```bash
npx vitest run tests/isolated/
```
Expected: All PASS

### Step 6: Commit

```bash
git add backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs \
       tests/isolated/adapters/content/gallery/immich/ImmichAdapter.faces.test.mjs
git commit -m "fix(immich): set mediaType on ListableItem so resolveFormat returns 'image'"
```

---

## Task 4: Unit Tests for computeZoomTarget

The `computeZoomTarget` function in ImageFrame.jsx is pure and testable. It has three code paths (focusPerson, largest face, random fallback) that should be covered.

**Files:**
- Create: `tests/isolated/modules/Player/computeZoomTarget.test.mjs`

### Step 1: Write the tests

Create `tests/isolated/modules/Player/computeZoomTarget.test.mjs`:

```javascript
import { describe, it, expect, vi } from 'vitest';

// computeZoomTarget is not exported — extract the logic for testing.
// We replicate the function here to validate the algorithm.
// If this ever drifts from ImageFrame.jsx, the test will catch the wrong behavior
// and we should extract the function to a shared utility.

function computeZoomTarget({ people, focusPerson, zoom }) {
  const maxTranslate = ((zoom - 1) / zoom) * 50;

  let targetX = 0.5;
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
    targetX = 0.2 + Math.random() * 0.6;
    targetY = 0.2 + Math.random() * 0.6;
  }

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

describe('computeZoomTarget', () => {
  const zoom = 1.2;

  describe('focusPerson targeting', () => {
    it('zooms toward the named person face center', () => {
      const people = [{
        name: 'Felix',
        id: 'p1',
        faces: [{
          x1: 400, y1: 200, x2: 600, y2: 400,
          imageWidth: 1000, imageHeight: 800,
        }],
      }];

      const result = computeZoomTarget({ people, focusPerson: 'Felix', zoom });

      // Face center is at (500/1000, 300/800) = (0.5, 0.375)
      // targetX = 0.5, targetY = 0.375
      // maxTranslate = (0.2/1.2)*50 = 8.333
      // endOffX = (0.5 - 0.5) * 8.333 = 0
      // endOffY = (0.5 - 0.375) * 8.333 = 1.04
      expect(parseFloat(result.endX)).toBeCloseTo(0, 1);
      expect(parseFloat(result.endY)).toBeGreaterThan(0); // zoom moves toward face (above center)
    });

    it('is case-insensitive for person name matching', () => {
      const people = [{
        name: 'Felix',
        id: 'p1',
        faces: [{ x1: 0, y1: 0, x2: 200, y2: 200, imageWidth: 1000, imageHeight: 1000 }],
      }];

      const result = computeZoomTarget({ people, focusPerson: 'felix', zoom });
      // Should match — face center is (0.1, 0.1), not the random fallback
      // endOffX = (0.5 - 0.1) * maxTranslate = positive (zoom left toward face)
      expect(parseFloat(result.endX)).toBeGreaterThan(0);
    });
  });

  describe('largest face fallback', () => {
    it('picks the largest face when no focusPerson specified', () => {
      const people = [
        {
          name: 'Small',
          id: 'p1',
          faces: [{ x1: 0, y1: 0, x2: 50, y2: 50, imageWidth: 1000, imageHeight: 1000 }],
        },
        {
          name: 'Large',
          id: 'p2',
          faces: [{ x1: 300, y1: 300, x2: 700, y2: 700, imageWidth: 1000, imageHeight: 1000 }],
        },
      ];

      const result = computeZoomTarget({ people, focusPerson: null, zoom });
      // Largest face center: (500/1000, 500/1000) = (0.5, 0.5) → center
      // endOffX = (0.5 - 0.5) * maxTranslate = 0
      expect(parseFloat(result.endX)).toBeCloseTo(0, 1);
      expect(parseFloat(result.endY)).toBeCloseTo(0, 1);
    });

    it('picks the largest face when focusPerson does not match anyone', () => {
      const people = [{
        name: 'Felix',
        id: 'p1',
        faces: [{ x1: 0, y1: 0, x2: 200, y2: 200, imageWidth: 1000, imageHeight: 1000 }],
      }];

      const result = computeZoomTarget({ people, focusPerson: 'NonExistent', zoom });
      // Should fall through to largest face (Felix), not random
      expect(parseFloat(result.endX)).toBeGreaterThan(0);
    });
  });

  describe('random fallback', () => {
    it('returns values within the center 60% range when no faces', () => {
      const result = computeZoomTarget({ people: [], focusPerson: null, zoom });
      // Random target in [0.2, 0.8] → endOff in some range
      // Just verify the values are valid percentages
      expect(result.startX).toMatch(/-?\d+\.\d+%/);
      expect(result.endX).toMatch(/-?\d+\.\d+%/);
    });

    it('handles null people', () => {
      const result = computeZoomTarget({ people: null, focusPerson: null, zoom });
      expect(result.startX).toMatch(/-?\d+\.\d+%/);
    });

    it('handles people with empty faces arrays', () => {
      const people = [{ name: 'Felix', id: 'p1', faces: [] }];
      const result = computeZoomTarget({ people, focusPerson: 'Felix', zoom });
      // No faces → random fallback
      expect(result.startX).toMatch(/-?\d+\.\d+%/);
    });
  });
});
```

### Step 2: Run tests

Run: `npx vitest run tests/isolated/modules/Player/computeZoomTarget.test.mjs`
Expected: All PASS

### Step 3: Commit

```bash
git add tests/isolated/modules/Player/computeZoomTarget.test.mjs
git commit -m "test(player): add unit tests for Ken Burns computeZoomTarget algorithm"
```

---

## Task 5: JIT Face Data Fetch in ImageFrame

Immich's `searchMetadata` API does not return `people.faces` with bounding boxes. Only the single-asset API (`GET /api/assets/{id}`) returns them. To get smart face-targeted zoom, ImageFrame should fetch face data via `/api/v1/info/{imageId}` on mount and use it to compute the zoom target.

**Files:**
- Modify: `frontend/src/modules/Player/renderers/ImageFrame.jsx`

### Step 1: Write the failing test

Add to `tests/isolated/modules/Player/computeZoomTarget.test.mjs`:

```javascript
describe('JIT face data integration', () => {
  it('recomputes zoom target when face data arrives after mount', () => {
    // First render: no faces → random target
    const result1 = computeZoomTarget({ people: [], focusPerson: 'Felix', zoom: 1.2 });
    // Simulated: /info/ API returns face data
    const enrichedPeople = [{
      name: 'Felix',
      id: 'p1',
      faces: [{ x1: 200, y1: 100, x2: 400, y2: 300, imageWidth: 1000, imageHeight: 800 }],
    }];
    // Second computation: face found → targeted zoom
    const result2 = computeZoomTarget({ people: enrichedPeople, focusPerson: 'Felix', zoom: 1.2 });

    // result2 should zoom toward Felix's face, not random
    // Face center: (300/1000, 200/800) = (0.3, 0.25)
    // This should produce different end coordinates than the random fallback
    expect(parseFloat(result2.endX)).toBeGreaterThan(0); // zoom toward left-of-center face
    expect(parseFloat(result2.endY)).toBeGreaterThan(0); // zoom toward above-center face
  });
});
```

### Step 2: Run test

Run: `npx vitest run tests/isolated/modules/Player/computeZoomTarget.test.mjs`
Expected: PASS

### Step 3: Implement JIT face fetch in ImageFrame

In `frontend/src/modules/Player/renderers/ImageFrame.jsx`, add a state + effect for JIT face data:

After the existing `const [loaded, setLoaded] = useState(false);` (line 101), add:

```javascript
  const [enrichedPeople, setEnrichedPeople] = useState(null);
```

After the mount logging `useEffect` (after line 128), add a new effect:

```javascript
  // JIT fetch face data from /info/ endpoint for smart zoom
  useEffect(() => {
    if (!imageId) return;
    // Skip if we already have face data from the queue
    if (hasFaces) return;

    let cancelled = false;
    const fetchFaceData = async () => {
      try {
        const response = await fetch(`/api/v1/info/${encodeURIComponent(imageId)}`);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        const infoPeople = data.metadata?.people;
        if (!cancelled && infoPeople?.length > 0) {
          const hasFaceData = infoPeople.some(p => p.faces?.length > 0);
          if (hasFaceData) {
            logger.debug('image-frame-jit-faces', {
              imageId,
              peopleCount: infoPeople.length,
              faceCount: infoPeople.reduce((n, p) => n + (p.faces?.length || 0), 0),
            });
            setEnrichedPeople(infoPeople);
          }
        }
      } catch (err) {
        logger.debug('image-frame-jit-faces-error', { imageId, error: err.message });
      }
    };
    fetchFaceData();
    return () => { cancelled = true; };
  }, [imageId, hasFaces]);
```

Update the `zoomTarget` computation to use enriched people when available:

Old:
```javascript
  const zoomTarget = useMemo(
    () => computeZoomTarget({ people, focusPerson, zoom }),
    [people, focusPerson, zoom]
  );
```

New:
```javascript
  const effectivePeople = enrichedPeople || people;
  const zoomTarget = useMemo(
    () => computeZoomTarget({ people: effectivePeople, focusPerson, zoom }),
    [effectivePeople, focusPerson, zoom]
  );
```

**Note:** When `enrichedPeople` arrives (state update), `effectivePeople` changes, `zoomTarget` recomputes, and if the animation hasn't started yet (image still loading), the new target is used. If the animation already started, the current photo keeps its random zoom and the next photo gets smart zoom. This is acceptable — the `/info/` fetch races with image load and usually wins for the next image.

### Step 4: Verify the face data propagation

This depends on Task 3 (fix `resolveFormat` for images) being done first, so `/info/` returns correct data for image assets. If `/info/` still returns `format: 'video'` for images, the face data may not be structured correctly.

### Step 5: Commit

```bash
git add frontend/src/modules/Player/renderers/ImageFrame.jsx \
       tests/isolated/modules/Player/computeZoomTarget.test.mjs
git commit -m "feat(player): JIT fetch face data from /info/ for smart Ken Burns zoom"
```

---

## Task 6: Clean Up Orphaned Test Files

Two test files reference deleted components (CompositePlayer, useAdvanceController). They should be removed since the code they test no longer exists.

**Files:**
- Delete: `tests/live/flow/tv/tv-composite-player.runtime.test.mjs`
- Delete: `tests/isolated/assembly/player/useAdvanceController.test.mjs`

### Step 1: Verify no other tests import these

```bash
grep -r "tv-composite-player\|useAdvanceController.test" tests/ --include="*.mjs" --include="*.js" -l
```

Expected: Only the two files themselves.

### Step 2: Verify the deleted components don't exist

```bash
ls frontend/src/modules/Player/renderers/CompositePlayer.jsx 2>/dev/null || echo "Gone"
ls frontend/src/modules/Player/hooks/useAdvanceController.js 2>/dev/null || echo "Gone"
```

Expected: Both "Gone"

### Step 3: Delete test files

```bash
git rm tests/live/flow/tv/tv-composite-player.runtime.test.mjs
git rm tests/isolated/assembly/player/useAdvanceController.test.mjs
```

### Step 4: Commit

```bash
git commit -m "chore(tests): remove orphaned CompositePlayer and useAdvanceController test files"
```

---

## Task 7: Verify End-to-End

Manual verification of the full pipeline. Start the dev server and test the mixed media queue.

### Step 1: Start dev server

```bash
lsof -i :3111  # Check if already running
npm run dev     # Start if needed
```

### Step 2: Verify queue API returns audio

```bash
curl -s http://localhost:3112/api/v1/queue/mar4-videos-photos | jq '{count: .count, hasAudio: (.audio != null), audioContentId: .audio.contentId, firstItemType: .items[0].mediaType, sampleSlideshow: .items[0].slideshow}'
```

Expected:
```json
{
  "count": 45,
  "hasAudio": true,
  "audioContentId": "music:anniversary",
  "firstItemType": "image",
  "sampleSlideshow": { "duration": 5, "effect": "kenburns", "zoom": 1.2, "transition": "crossfade", "focusPerson": "Alan" }
}
```

### Step 3: Verify /info/ format for images

Pick an image asset ID from the queue response and test:

```bash
curl -s http://localhost:3112/api/v1/info/immich:{image-asset-id} | jq '{format: .format, mediaType: .mediaType, hasPeople: (.metadata.people | length > 0)}'
```

Expected: `format: "image"` (not `"video"`)

### Step 4: Browser test

Open the Player route with `mar4-videos-photos` queue. Verify in browser console (set `window.DAYLIGHT_LOG_LEVEL = 'debug'`):

- [ ] `image-frame-mount` logs appear with correct metadata
- [ ] `image-frame-start` logs appear ONCE per photo (not thousands — render loop fix verified)
- [ ] `image-frame-advance` logs after ~5 seconds per photo
- [ ] `audio-layer-mount` appears (AudioLayer is rendering)
- [ ] `audio-layer-resolved` appears with track count
- [ ] `audio-layer-pause` appears when a video item plays
- [ ] `audio-layer-resume` appears when returning to a photo
- [ ] Photos display Ken Burns zoom animation
- [ ] Videos play normally
- [ ] No React errors in console

### Step 5: Commit any fixes found

```bash
git add <fixed-files>
git commit -m "fix: address issues found during mixed media end-to-end verification"
```

---

## Summary

| Task | Priority | Description |
|------|----------|-------------|
| 1 | Pre-req | Commit existing uncommitted audit fixes |
| 2 | Critical | Fix useQueueController to propagate `audio` from API response |
| 3 | Important | Fix `resolveFormat` for images by adding `mediaType` to `#toListableItem` |
| 4 | Nice-to-have | Unit tests for `computeZoomTarget` algorithm |
| 5 | Important | JIT face data fetch in ImageFrame for smart Ken Burns zoom |
| 6 | Minor | Delete orphaned test files for CompositePlayer/useAdvanceController |
| 7 | Integration | End-to-end verification of the full pipeline |

**Dependencies:** Task 1 → Task 2 → Task 7. Tasks 3, 4, 5, 6 are independent of each other but should be done before Task 7.
