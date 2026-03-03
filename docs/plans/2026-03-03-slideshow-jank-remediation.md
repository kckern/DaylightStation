# Slideshow Jank Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate 100-248ms frame drops on slides 1-2 caused by JIT metadata fetch triggering React re-renders during animation compositing.

**Architecture:** The JIT enrichment fetch (`/api/v1/info/{id}`) currently fires immediately on `imageId` change, and its `setEnrichment()` response causes a React reconciliation pass during the critical window when cross-dissolve + Ken Burns `animate()` calls are setting up GPU compositor layers. The fix moves enrichment fetching into the preload phase (during the *previous* slide's display) so data is available synchronously when the slide transitions, and defers any fallback fetch until the browser is idle.

**Tech Stack:** React (hooks, refs, useMemo), Web Animations API, requestIdleCallback

**Bug Analysis:** `docs/_wip/bugs/2026-03-03-slideshow-jank-analysis.md`

---

### Task 1: Add metadata pre-fetch to the preload effect

**Files:**
- Modify: `frontend/src/modules/Player/renderers/ImageFrame.jsx:334-363` (preload effect)

**Context:** The existing preload effect (lines 334-363) creates `Image()` objects for `nextMedia`'s thumbnail and original. We extend it to also fetch `/api/v1/info/{nextMedia.id}` and store the result in a ref so it's available synchronously when that image becomes the active slide.

**Step 1: Add a preloaded enrichment ref**

Add after line 335 (`const preloadRef = ...`):

```jsx
const preloadedEnrichmentRef = useRef({ forId: null, data: null });
```

**Step 2: Extend the preload effect to fetch metadata**

Inside the `nextMedia` preload effect (the `useEffect` at line 336), add metadata fetching after the image preload setup. Replace lines 336-363 with:

```jsx
useEffect(() => {
  if (!nextMedia?.thumbnail && !nextMedia?.mediaUrl) return;
  const thumbUrl = nextMedia.thumbnail || nextMedia.mediaUrl;
  const origUrl = nextMedia.mediaUrl;
  const nextId = nextMedia.id;
  const t0 = performance.now();
  let cancelled = false;

  // Preload images (existing logic)
  const thumbImg = new Image();
  thumbImg.onload = () => {
    preloadRef.current.thumbDone = true;
    perfLog.info('slideshow.preload-thumb', { nextId, ms: Math.round(performance.now() - t0) });
  };
  thumbImg.src = thumbUrl;
  preloadRef.current.thumb = thumbImg;
  preloadRef.current.thumbDone = false;
  preloadRef.current.origDone = false;
  if (origUrl && origUrl !== thumbUrl) {
    const origImg = new Image();
    origImg.onload = () => {
      preloadRef.current.origDone = true;
      perfLog.info('slideshow.preload-orig', { nextId, ms: Math.round(performance.now() - t0) });
    };
    origImg.src = origUrl;
    preloadRef.current.orig = origImg;
  } else {
    preloadRef.current.origDone = true;
  }

  // Preload metadata for next slide
  const fetchNextMeta = async () => {
    try {
      const response = await fetch(`/api/v1/info/${encodeURIComponent(nextId)}`);
      if (!response.ok || cancelled) return;
      const data = await response.json();
      if (cancelled) return;
      const meta = data.metadata || {};
      preloadedEnrichmentRef.current = {
        forId: nextId,
        data: {
          people: meta.people?.length > 0 ? meta.people : null,
          capturedAt: meta.capturedAt || null,
          location: meta.location || null,
        },
      };
      logger.debug('image-frame-preload-meta', { nextId, peopleCount: meta.people?.length || 0 });
    } catch (err) {
      logger.warn('image-frame-preload-meta-error', { nextId, error: err.message });
    }
  };
  fetchNextMeta();

  logger.debug('image-frame-preload-start', { nextId });
  return () => {
    cancelled = true;
    preloadRef.current = { thumb: null, orig: null, thumbDone: false, origDone: false };
  };
}, [nextMedia?.id]);
```

**Step 3: Run the test**

```bash
# Verify no syntax errors and dev server starts
cd /Users/kckern/Documents/GitHub/DaylightStation && npm run dev
# Check browser console for 'image-frame-preload-meta' log events during slideshow
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/renderers/ImageFrame.jsx
git commit -m "feat(slideshow): preload metadata for next slide during current slide display"
```

---

### Task 2: Consume pre-fetched enrichment synchronously on slide change

**Files:**
- Modify: `frontend/src/modules/Player/renderers/ImageFrame.jsx:213-243` (JIT fetch effect)

**Context:** The JIT metadata `useEffect` (lines 214-243) fires on every `imageId` change and calls `setEnrichment()` asynchronously, which is the root cause of the compositing jank. We modify it to first check `preloadedEnrichmentRef` — if the enrichment is already available, set it synchronously (no async fetch, no delayed re-render during animation). Only fall back to a deferred fetch if no preloaded data exists.

**Step 1: Replace the JIT fetch effect**

Replace lines 213-243 with:

```jsx
// Consume pre-fetched enrichment or defer JIT fetch to idle time
useEffect(() => {
  if (!imageId) return;

  // Check if metadata was pre-fetched during previous slide
  const preloaded = preloadedEnrichmentRef.current;
  if (preloaded.forId === imageId && preloaded.data) {
    logger.debug('image-frame-enrichment-preloaded', { imageId });
    setEnrichment({ forId: imageId, ...preloaded.data });
    preloadedEnrichmentRef.current = { forId: null, data: null };
    return;
  }

  // Fallback: defer fetch to idle time so it doesn't collide with animation setup
  let cancelled = false;
  const fetchMetadata = async () => {
    try {
      const response = await fetch(`/api/v1/info/${encodeURIComponent(imageId)}`);
      if (!response.ok || cancelled) return;
      const data = await response.json();
      if (cancelled) return;
      const meta = data.metadata || {};
      logger.debug('image-frame-jit-metadata', {
        imageId,
        deferred: true,
        peopleCount: meta.people?.length || 0,
        hasCapturedAt: !!meta.capturedAt,
        hasLocation: !!meta.location,
      });
      setEnrichment({
        forId: imageId,
        people: meta.people?.length > 0 ? meta.people : null,
        capturedAt: meta.capturedAt || null,
        location: meta.location || null,
      });
    } catch (err) {
      logger.warn('image-frame-jit-metadata-error', { imageId, error: err.message });
    }
  };

  // Use requestIdleCallback to defer until browser is idle (after animation setup)
  // Falls back to setTimeout(200ms) for browsers without requestIdleCallback
  let idleHandle;
  if (typeof requestIdleCallback === 'function') {
    idleHandle = requestIdleCallback(() => {
      if (!cancelled) fetchMetadata();
    }, { timeout: 2000 });
  } else {
    idleHandle = setTimeout(() => {
      if (!cancelled) fetchMetadata();
    }, 200);
  }

  return () => {
    cancelled = true;
    if (typeof cancelIdleCallback === 'function' && typeof requestIdleCallback === 'function') {
      cancelIdleCallback(idleHandle);
    } else {
      clearTimeout(idleHandle);
    }
  };
}, [imageId]);
```

**Step 2: Verify behavior**

```bash
# Start dev server and open slideshow in browser
# Check console for:
#   - 'image-frame-enrichment-preloaded' on slides 2+ (preload hit)
#   - 'image-frame-jit-metadata' with deferred:true on slide 1 (fallback)
# Verify no 100ms+ frame drops on slides 2-3 in slideshow.slide-summary logs
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/renderers/ImageFrame.jsx
git commit -m "fix(slideshow): defer JIT metadata fetch to idle time, consume preloaded data synchronously

Eliminates 100-248ms frame drops on slides 1-2 caused by setEnrichment()
re-render during cross-dissolve + Ken Burns animation compositing window.
Pre-fetched metadata is consumed synchronously; fallback uses requestIdleCallback."
```

---

### Task 3: Validate fix with performance instrumentation

**Files:**
- No code changes — verification only

**Context:** The existing `perfLog.info('slideshow.slide-summary', ...)` instrumentation already captures `maxFrameMs`, `longFrames`, and `avgFps` per slide. We use this to validate the fix.

**Step 1: Run a slideshow session and collect metrics**

```bash
# Start dev server
cd /Users/kckern/Documents/GitHub/DaylightStation && npm run dev

# Open browser to slideshow queue (mar4-videos-photos or similar)
# Let it play through at least 5 slides
# Check backend logs for slideshow.slide-summary events
```

**Step 2: Compare before/after metrics**

Expected improvement:
- Slides 2-3: `maxFrameMs` drops from 84-248ms to <50ms
- Slides 2-3: `longFrames` drops from 2-5 to 0-1
- Slides 2-3: `avgFps` stays at 117-122 (was already good except during jank)

**Step 3: Check for regressions**

Verify:
- Ken Burns still zooms toward faces (enrichment data still arrives, just earlier)
- Cross-dissolve still smooth on all slides
- Metadata overlay still appears correctly (depends on `enrichment` state)
- `preloadHit` rate remains 100% after first session

**Step 4: Commit verification results**

Update the bug analysis document:

```bash
# Append remediation results to the bug analysis
echo "" >> docs/_wip/bugs/2026-03-03-slideshow-jank-analysis.md
echo "## Remediation Applied ($(date +%Y-%m-%d))" >> docs/_wip/bugs/2026-03-03-slideshow-jank-analysis.md
echo "" >> docs/_wip/bugs/2026-03-03-slideshow-jank-analysis.md
echo "Moved enrichment fetch to preload phase. Slides 2+ consume pre-fetched data synchronously. Slide 1 uses requestIdleCallback-deferred fallback." >> docs/_wip/bugs/2026-03-03-slideshow-jank-analysis.md
git add docs/_wip/bugs/2026-03-03-slideshow-jank-analysis.md
git commit -m "docs: record slideshow jank remediation results"
```

---

### Task 4: Clean up dead code (useImagePreloader hook)

**Files:**
- Delete: `frontend/src/modules/Player/hooks/useImagePreloader.js`

**Context:** The `useImagePreloader` hook is not imported anywhere in the slideshow code path. The actual preloading is done entirely within ImageFrame's `nextMedia` effect. This is dead code that could confuse future maintainers.

**Step 1: Verify the hook is unused**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
grep -r "useImagePreloader" frontend/src/ --include="*.js" --include="*.jsx"
# Expected: only the file itself — no imports
```

**Step 2: Delete the file (only if step 1 confirms no imports)**

```bash
rm frontend/src/modules/Player/hooks/useImagePreloader.js
```

**Step 3: Commit**

```bash
git add -A frontend/src/modules/Player/hooks/useImagePreloader.js
git commit -m "chore: remove unused useImagePreloader hook (preloading is in ImageFrame)"
```
