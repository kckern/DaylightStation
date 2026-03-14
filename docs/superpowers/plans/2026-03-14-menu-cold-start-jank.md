# Menu Cold-Start Jank Fix — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the 20-second jank window on Shield TV when the menu first loads by throttling image loading so only visible items load immediately and the rest load progressively during idle.

**Architecture:** Replace the current "render all 34 items with `loading=lazy`" approach with a two-phase render: phase 1 renders only the first N visible items with images (determined by viewport), phase 2 progressively loads remaining images using `requestIdleCallback`. The menu grid is 5 columns × ~2 visible rows = 10 items visible at a time. Items beyond the viewport render with gradient placeholders initially, then swap in images as they load during idle time.

**Tech Stack:** React, CSS, `requestIdleCallback` (with rAF fallback for FKB/Android WebView)

**Data backing this plan:** Shield TV perf logs show all 20 frame janks >100ms occur in seconds 0-20 (image loading window). After images load, FPS is rock-solid 60fps for 4+ minutes. The problem is 34 concurrent image decodes overwhelming the Shield's CPU.

---

## Chunk 1: Progressive Image Loading

### Task 1: Add progressive image loading to MenuItems

The fix is entirely in `Menu.jsx`. No new files needed. The approach:

1. Only the first 10 items (2 visible rows × 5 columns) get their `image` prop immediately
2. Remaining items get `image=null` initially (renders gradient placeholder — zero cost)
3. After mount, a `requestIdleCallback` loop feeds images to the remaining items in batches of 2-3
4. Each batch triggers minimal re-renders (only the 2-3 items receiving images)

**Files:**
- Modify: `frontend/src/modules/Menu/Menu.jsx`

- [ ] **Step 1: Add a `useProgressiveImages` hook in Menu.jsx**

Add this hook before the `MenuItems` function (after the `MenuItem` component, around line 510):

```javascript
/**
 * Progressively reveals images beyond the initial viewport.
 * Returns a Set of indices whose images are "ready" (either in the
 * initial viewport or revealed by idle callbacks).
 *
 * @param {number} totalItems - Total number of menu items
 * @param {number} initialCount - Items to show immediately (visible viewport)
 * @param {number} batchSize - Items to reveal per idle callback
 * @returns {Set<number>} Set of item indices with images ready
 */
function useProgressiveImages(totalItems, initialCount = 10, batchSize = 2) {
  const [readyCount, setReadyCount] = useState(initialCount);

  useEffect(() => {
    if (readyCount >= totalItems) return;

    const schedule = typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (cb) => setTimeout(cb, 50);
    const cancel = typeof cancelIdleCallback === 'function'
      ? cancelIdleCallback
      : clearTimeout;

    let id;
    function loadNext() {
      setReadyCount(prev => {
        const next = Math.min(prev + batchSize, totalItems);
        if (next < totalItems) {
          id = schedule(loadNext);
        }
        return next;
      });
    }

    // Start loading after a brief delay to let the initial render settle
    id = schedule(loadNext);
    return () => cancel(id);
  }, [totalItems, readyCount, batchSize]);

  // Reset when item count changes (new menu loaded)
  useEffect(() => {
    setReadyCount(initialCount);
  }, [totalItems, initialCount]);

  return readyCount;
}
```

- [ ] **Step 2: Wire `useProgressiveImages` into the `itemData` computation**

In the `MenuItems` function, add the hook call right after the `useMenuPerfMonitor` call (around line 600):

```javascript
  // Progressive image loading — only first 10 items get images immediately,
  // rest load in batches of 2 during idle to avoid cold-start jank
  const imageReadyCount = useProgressiveImages(items.length, 10, 2);
```

Then modify the `itemData` useMemo to gate images on `imageReadyCount`. Change the useMemo's dependency array to include `imageReadyCount`, and gate the image assignment:

Find the line inside the `useMemo` callback that sets `let image = item.image;` and wrap the image logic:

```javascript
  const itemData = useMemo(() => items.map((item, index) => {
    const actionObj = item?.play || item?.queue || item?.list || item?.open || {};
    const { contentId: itemContentId, plex } = actionObj;
    const itemKey = findKeyForItem(item) || `${index}-${item.label}`;

    // Gate image loading: only items within readyCount get their image
    let image = index < imageReadyCount ? item.image : null;

    if (image && (image.startsWith('/media/img/') || image.startsWith('media/img/'))) {
      image = DaylightMediaPath(image);
    }

    if (!image && index < imageReadyCount && (itemContentId || plex)) {
      const displayId = itemContentId || plex;
      const val = Array.isArray(displayId) ? displayId[0] : displayId;
      image = ContentDisplayUrl(val);
    }

    const imageKey = image ? `img-${image}` : `no-img-${itemKey}`;
    const isAndroid = !!item.android;
    const isDisabled = isAndroid && !_fkbAvailable;

    return { item, itemKey, image, imageKey, isDisabled };
  }), [items, findKeyForItem, imageReadyCount]);
```

**Key change:** `imageReadyCount` is now in the dependency array. As the idle callback increments it, React re-runs the memo, and only the newly-revealed items get new `image` props — the rest are unchanged, so `React.memo` on `MenuItem` prevents their re-render.

- [ ] **Step 3: Build and verify**

Run: `cd frontend && npx vite build --mode development 2>&1 | tail -3`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Menu/Menu.jsx
git commit -m "perf(menu): progressive image loading — batch 2 per idle callback

Only the first 10 items (visible viewport) load images immediately.
Remaining items start with gradient placeholders and receive images
in batches of 2 via requestIdleCallback, eliminating the 20-second
cold-start jank on Shield TV caused by 34 concurrent image decodes."
```

---

### Task 2: Deploy and verify on Shield

- [ ] **Step 1: Build and deploy Docker**

```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 2: Clear Shield browser cache**

The old JS bundle is cached. FKB cache clear or force-stop + restart:
```bash
# If FKB: via REST API
curl "http://10.0.0.11:2323/?cmd=clearCache&password=<url-encoded-password>"

# If Chrome on Shield: user must hard-refresh
```

- [ ] **Step 3: Test on Shield and pull logs**

Browse the menu on Shield for 30+ seconds, then analyze:

```bash
sudo docker exec daylight-station sh -c 'ls -lt media/logs/screens/ | head -3'
# Get the latest session file and analyze
sudo docker exec daylight-station sh -c 'cat media/logs/screens/LATEST.jsonl' | python3 -c "
import sys, json
janks = []
snapshots = []
for line in sys.stdin:
    if not line.strip(): continue
    evt = json.loads(line)
    if evt['event'] == 'menu-perf.jank': janks.append(evt['data'])
    elif evt['event'] == 'menu-perf.snapshot': snapshots.append(evt['data'])
print(f'Janks >100ms: {len(janks)}')
if janks:
    print(f'  Worst: {max(j[\"frameMs\"] for j in janks)}ms')
print(f'Snapshots: {len(snapshots)}')
for i, s in enumerate(snapshots[:8]):
    print(f'  [{i*5}s] FPS={s[\"fps\"]} worst={s[\"worstFrameMs\"]}ms lt={s[\"longTasks\"]}({s[\"longTaskMs\"]}ms)')
"
```

**Success criteria:**
- Frame janks >100ms: ≤5 (was 20-24)
- Worst frame: ≤300ms (was 950-1135ms)
- Time to stable 60fps: ≤10s (was 20-25s)
- Long tasks in first snapshot: ≤1 (was 3-5)

---

### Task 3: Run Playwright regression tests

- [ ] **Step 1: Run the living-room test suite**

```bash
npx playwright test tests/live/flow/screen/living-room.runtime.test.mjs --reporter=line
```

Expected: 10/10 pass. The progressive loading should not affect test behavior since all items eventually get their images, and tests wait for `.menu-item` selector (not images).

- [ ] **Step 2: Run normalizer tests for regression check**

```bash
npx vitest run tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
```

Expected: 173/173 pass.
