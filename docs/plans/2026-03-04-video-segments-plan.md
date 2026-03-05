# Video Segments Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split long videos into evenly-distributed segments that play as independent queue items with isolated progress bars.

**Architecture:** Backend expands video items into segment queue items in `QueryAdapter.#resolveImmichQuery()`. Frontend's `useCommonMediaController` gains segment-awareness: seek to segment start on load, clamp progress/seeking to segment bounds, and advance when segment end is reached.

**Tech Stack:** Node.js backend (ES modules), React frontend (hooks), existing Immich adapter and player infrastructure.

---

### Task 1: Backend — Segment Expansion in QueryAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/query/QueryAdapter.mjs:401-423` (after sort block, before `return filtered`)

**Step 1: Write the segment expansion logic**

Insert after the sort block (after line 422) and before `return filtered` (line 424):

```javascript
    // Expand long videos into segments if videoRules specified
    if (query.videoRules) {
      const { maxDuration, segmentCount, segmentLength } = query.videoRules;
      if (maxDuration && segmentCount && segmentLength) {
        const expanded = [];
        for (const item of filtered) {
          if (item.mediaType !== 'video' || !item.duration || item.duration <= maxDuration * 1.1) {
            expanded.push(item);
            continue;
          }
          const zoneDuration = item.duration / segmentCount;
          for (let i = 0; i < segmentCount; i++) {
            const start = Math.floor(i * zoneDuration);
            const end = Math.min(start + segmentLength, item.duration);
            expanded.push({
              ...item,
              id: `${item.id}#seg${i}`,
              duration: end - start,
              segment: { start, end, index: i, total: segmentCount },
            });
          }
        }
        filtered = expanded;
      }
    }
```

**Step 2: Verify no syntax errors**

Run: `node -e "import('./backend/src/1_adapters/content/query/QueryAdapter.mjs').catch(e => { console.error(e.message); process.exit(1) })"`

Expected: No output (clean import)

**Step 3: Commit**

```bash
git add backend/src/1_adapters/content/query/QueryAdapter.mjs
git commit -m "feat(query): expand long videos into segments via videoRules"
```

---

### Task 2: Backend — Pass segment through in toQueueItem

**Files:**
- Modify: `backend/src/4_api/v1/routers/queue.mjs:64-66`

**Step 1: Add segment passthrough**

After line 66 (`if (item.titlecard) qi.titlecard = item.titlecard;`), add:

```javascript
  if (item.segment) qi.segment = item.segment;
```

**Step 2: Verify no syntax errors**

Run: `node -e "import('./backend/src/4_api/v1/routers/queue.mjs').catch(e => { console.error(e.message); process.exit(1) })"`

Expected: No output (clean import)

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/queue.mjs
git commit -m "feat(queue): pass segment metadata through to queue items"
```

---

### Task 3: Frontend — Segment-aware progress and seeking in useCommonMediaController

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js`

This task touches three areas of the hook. The `meta` object (passed as the `media` prop from VideoPlayer) carries `segment` when present.

**Step 1: Extract segment bounds at the top of the hook**

After line 48 (`const assetId = ...`), add:

```javascript
  const segment = meta.segment || null;
  const segStart = segment?.start ?? 0;
  const segEnd = segment?.end ?? null;
  const segDuration = segment ? (segment.end - segment.start) : null;
```

**Step 2: Update handleProgressClick to map clicks to segment range**

Replace lines 331-339:

```javascript
  const handleProgressClick = useCallback((event) => {
    if (!duration || !containerRef.current) return;
    const mediaEl = getMediaEl();
    if (!mediaEl) return;
    mediaEl.__seekSource = 'click';
    const rect = event.target.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickPercent = clickX / rect.width;
    if (segDuration) {
      mediaEl.currentTime = segStart + (clickPercent * segDuration);
    } else {
      mediaEl.currentTime = clickPercent * duration;
    }
  }, [duration, getMediaEl, segStart, segDuration]);
```

**Step 3: Update onTimeUpdate to report segment-relative progress**

In the `onTimeUpdate` function (line 770), replace the `setSeconds` call and the `onProgress` block.

Change line 771 from:
```javascript
      setSeconds(mediaEl.currentTime);
```
to:
```javascript
      const rawTime = mediaEl.currentTime;
      setSeconds(segDuration ? (rawTime - segStart) : rawTime);
```

In the same function, update the `onProgress` callback (lines 780-793). Replace:
```javascript
          currentTime: mediaEl.currentTime || 0,
          duration: mediaEl.duration || 0,
```
with:
```javascript
          currentTime: segDuration ? (mediaEl.currentTime - segStart) : (mediaEl.currentTime || 0),
          duration: segDuration || (mediaEl.duration || 0),
```

And replace:
```javascript
          percent: getProgressPercent(mediaEl.currentTime, mediaEl.duration),
```
with:
```javascript
          percent: segDuration
            ? getProgressPercent(mediaEl.currentTime - segStart, segDuration)
            : getProgressPercent(mediaEl.currentTime, mediaEl.duration),
```

**Step 4: Add segment end detection in onTimeUpdate**

At the end of the `onTimeUpdate` function (before the closing `};` on ~line 795), add:

```javascript
      // Segment end detection — advance when playback reaches segment boundary
      if (segEnd && mediaEl.currentTime >= segEnd) {
        const s = stallStateRef.current;
        s.hasEnded = true;
        clearTimers();
        if (s.isStalled) {
          s.isStalled = false;
          setIsStalled(false);
        }
        logProgress();
        onEnd();
        return;
      }
```

**Step 5: Force segment start time on initial load**

In the `onLoadedMetadata` handler (around line 836-842), the initial seek logic uses `start` param. In VideoPlayer.jsx, this is set to `media.seconds`. For segments, we need to override this.

In `VideoPlayer.jsx` (line 62), change:
```javascript
    start: media.seconds,
```
to:
```javascript
    start: media.segment ? media.segment.start : media.seconds,
```

**Step 6: Update duration state for segments**

In `onDurationChange` (line 797-799), change:
```javascript
    const onDurationChange = () => {
      setDuration(mediaEl.duration);
    };
```
to:
```javascript
    const onDurationChange = () => {
      setDuration(segDuration || mediaEl.duration);
    };
```

**Step 7: Verify frontend builds**

Run: `npx vite build --mode development 2>&1 | tail -5`

Expected: Build succeeds

**Step 8: Commit**

```bash
git add frontend/src/modules/Player/hooks/useCommonMediaController.js frontend/src/modules/Player/renderers/VideoPlayer.jsx
git commit -m "feat(player): segment-aware progress, seeking, and end detection"
```

---

### Task 4: Update query YAML to use videoRules

**Files:**
- Modify: `data/users/kckern/config/queries/mar4-videos-photos.yml`

**Step 1: Add videoRules to the immich item**

The immich item (starting at line 17) currently has `params`, `exclude`, `timeFilter`, and `slideshow`. Add `videoRules` as a sibling:

```yaml
  - type: immich
    sort: day_desc_time_asc
    params:
      month: 3
      day: 4
      yearFrom: 2021
    exclude:
      - 82b355d6-b8f6-4942-bac2-09d4dea2b629
    timeFilter:
      "2021-03-04": { from: "20:00" }
    videoRules:
      maxDuration: 60
      segmentCount: 3
      segmentLength: 15
    slideshow:
      duration: 5
      effect: kenburns
      zoom: 1.2
      transition: crossfade
      focusPerson: Alan
      showMetadata: true
```

**Step 2: Commit**

This file is in the Dropbox data path, not in the git repo. No commit needed.

---

### Task 5: Manual Smoke Test

**Step 1: Start or verify dev server is running**

Run: `lsof -i :3111`

If not running: `npm run dev`

**Step 2: Test the query endpoint**

Run: `curl -s http://localhost:3112/api/v1/queue/query/mar4-videos-photos | node -e "
const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const items = data.items || data;
const segs = items.filter(i => i.segment);
console.log('Total items:', items.length);
console.log('Segmented items:', segs.length);
if (segs.length) {
  console.log('First segment:', JSON.stringify(segs[0].segment));
  console.log('Segment ID:', segs[0].id);
}
"`

Expected: Any video over ~66s should be expanded into 3 segment items with `#seg0`, `#seg1`, `#seg2` suffixes.

**Step 3: Test in browser**

Navigate to the query slideshow on the dev server. Verify:
- Segmented videos start at the correct offset (not at 0:00 for seg1/seg2)
- Progress bar shows 0-100% relative to the 15s segment
- Playback advances to next item when segment ends
- Clicking the progress bar seeks within the segment range
- Non-segmented videos and images behave as before

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(segments): address smoke test findings"
```
