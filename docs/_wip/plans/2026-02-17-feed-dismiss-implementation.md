# Feed Item Dismiss Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users dismiss feed items (swipe, X button, or detail-open) so they never reappear — FreshRSS items via markRead API, others via YAML persistence with 30-day expiry.

**Architecture:** New `YamlDismissedItemsStore` adapter writes to `data/household/shared/feed/dismissed.yml`. `FeedPoolManager` filters dismissed IDs on `getPool()`. A new `POST /scroll/dismiss` API endpoint routes FreshRSS items to `markRead()` and others to the YAML store. Frontend adds swipe-to-dismiss, X buttons, and auto-dismiss on detail open.

**Tech Stack:** Express, YAML via DataService, React (Web Animations API for card removal)

**Design doc:** `docs/_wip/plans/2026-02-17-feed-dismiss-design.md`

---

### Task 1: YamlDismissedItemsStore — Datastore Adapter

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlDismissedItemsStore.mjs`

**Step 1: Create the datastore**

Follow the exact pattern from `YamlSelectionTrackingStore.mjs`. The YAML file stores `{ itemId: unixTimestamp }`. Auto-prune entries older than 30 days on load.

```js
// backend/src/1_adapters/persistence/yaml/YamlDismissedItemsStore.mjs
/**
 * YamlDismissedItemsStore
 *
 * YAML-backed persistence for dismissed feed item IDs.
 * Stores itemId → unix timestamp (seconds). Auto-prunes entries older than 30 days on load.
 *
 * Path: common/feed/dismissed (DataService appends .yml)
 * Scope: household-shared (not per-user) since there's a single scroll user.
 *
 * @module adapters/persistence/yaml
 */

const DISMISSED_PATH = 'common/feed/dismissed';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export class YamlDismissedItemsStore {
  #dataService;
  #logger;
  /** @type {Set<string>|null} Cached set, loaded once per session */
  #cache = null;

  constructor({ dataService, logger = console }) {
    this.#dataService = dataService;
    this.#logger = logger;
  }

  /**
   * Load dismissed item IDs, pruning expired entries.
   * Caches result in memory for the session.
   * @returns {Set<string>}
   */
  load() {
    if (this.#cache) return this.#cache;

    const raw = this.#dataService.household.read(DISMISSED_PATH) || {};
    const now = Math.floor(Date.now() / 1000);
    const pruned = {};
    let prunedCount = 0;

    for (const [id, ts] of Object.entries(raw)) {
      if (now - ts <= MAX_AGE_SECONDS) {
        pruned[id] = ts;
      } else {
        prunedCount++;
      }
    }

    // Write back if we pruned anything
    if (prunedCount > 0) {
      this.#dataService.household.write(DISMISSED_PATH, pruned);
      this.#logger.info?.('feed.dismissed.pruned', { prunedCount });
    }

    this.#cache = new Set(Object.keys(pruned));
    return this.#cache;
  }

  /**
   * Add item IDs to the dismissed set.
   * @param {string[]} itemIds
   */
  add(itemIds) {
    if (!itemIds.length) return;

    const raw = this.#dataService.household.read(DISMISSED_PATH) || {};
    const now = Math.floor(Date.now() / 1000);

    for (const id of itemIds) {
      raw[id] = now;
    }

    this.#dataService.household.write(DISMISSED_PATH, raw);

    // Update cache if loaded
    if (this.#cache) {
      for (const id of itemIds) this.#cache.add(id);
    }

    this.#logger.debug?.('feed.dismissed.added', { count: itemIds.length });
  }

  /**
   * Clear the in-memory cache (called on pool reset).
   */
  clearCache() {
    this.#cache = null;
  }
}

export default YamlDismissedItemsStore;
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlDismissedItemsStore.mjs
git commit -m "feat(feed): add YamlDismissedItemsStore for persistent item dismissal"
```

---

### Task 2: Wire Datastore into FeedPoolManager

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedPoolManager.mjs` (constructor at lines 60-83, `getPool` at line 93, `reset` at line 174)
- Modify: `backend/src/app.mjs` (lines 796-812 — instantiate store + inject)

**Step 1: Accept dismissedItemsStore in FeedPoolManager constructor**

In `FeedPoolManager.mjs`, add to the private fields (after line 28):

```js
#dismissedItemsStore;
```

In the constructor destructuring (line 60-68), add `dismissedItemsStore = null`:

```js
constructor({
    sourceAdapters = [],
    feedCacheService = null,
    queryConfigs = [],
    loadUserQueries = null,
    freshRSSAdapter = null,
    headlineService = null,
    entropyService = null,
    dismissedItemsStore = null,
    logger = console,
  })
```

Assign in constructor body (after line 82):

```js
this.#dismissedItemsStore = dismissedItemsStore;
```

**Step 2: Filter dismissed IDs in `getPool()`**

In the `getPool` method (line 93-116), after computing `remaining` on line 105, add filtering:

```js
const pool = this.#pools.get(username) || [];
const seen = this.#seenIds.get(username) || new Set();
const dismissed = this.#dismissedItemsStore?.load() || new Set();
const remaining = pool.filter(item => !seen.has(item.id) && !dismissed.has(item.id));
```

Apply the same filter after the refill path (line 112):

```js
return refreshed.filter(item => !seen.has(item.id) && !dismissed.has(item.id));
```

**Step 3: Clear dismissed cache on pool reset**

In `reset()` (line 174), add after existing deletes:

```js
this.#dismissedItemsStore?.clearCache();
```

**Step 4: Also filter dismissed from recycle**

In `#recycle()` (line 488), filter dismissed items out of the recycled set so permanently dismissed items don't re-appear:

```js
#recycle(username) {
    const history = this.#seenItems.get(username) || [];
    if (history.length === 0) return;

    const dismissed = this.#dismissedItemsStore?.load() || new Set();
    const eligible = history.filter(item => !dismissed.has(item.id));
    if (eligible.length === 0) return;

    const shuffled = [...eligible];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    this.#pools.set(username, shuffled);
    this.#seenIds.set(username, new Set());
    this.#logger.info?.('feed.pool.recycled', { username, items: shuffled.length });
  }
```

**Step 5: Wire in app.mjs**

In `backend/src/app.mjs`, after the `YamlSelectionTrackingStore` instantiation (line 797), add:

```js
const { YamlDismissedItemsStore } = await import('./1_adapters/persistence/yaml/YamlDismissedItemsStore.mjs');
const dismissedItemsStore = new YamlDismissedItemsStore({ dataService, logger: rootLogger.child({ module: 'feed-dismissed' }) });
```

Pass to `FeedPoolManager` constructor (line 803-812), add `dismissedItemsStore`:

```js
const feedPoolManager = new FeedPoolManager({
  sourceAdapters: feedSourceAdapters,
  feedCacheService,
  queryConfigs,
  loadUserQueries,
  freshRSSAdapter: feedServices.freshRSSAdapter,
  headlineService: feedServices.headlineService,
  entropyService: entropyServices?.entropyService || null,
  dismissedItemsStore,
  logger: rootLogger.child({ module: 'feed-pool' }),
});
```

Also pass `dismissedItemsStore` and `freshRSSAdapter` to `createFeedRouter` (line 833-840) so the API endpoint can use them:

```js
v1Routers.feed = createFeedRouter({
  freshRSSAdapter: feedServices.freshRSSAdapter,
  headlineService: feedServices.headlineService,
  feedAssemblyService,
  feedContentService,
  dismissedItemsStore,
  configService,
  logger: rootLogger.child({ module: 'feed' }),
});
```

**Step 6: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedPoolManager.mjs backend/src/app.mjs
git commit -m "feat(feed): wire YamlDismissedItemsStore into FeedPoolManager and app bootstrap"
```

---

### Task 3: POST /scroll/dismiss API Endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/feed.mjs` (add route after scroll routes, ~line 171)

**Step 1: Accept dismissedItemsStore in router config**

Update the destructuring at line 27:

```js
const { freshRSSAdapter, headlineService, feedAssemblyService, feedContentService, dismissedItemsStore, configService, logger = console } = config;
```

**Step 2: Add the dismiss endpoint**

Insert after the `/scroll/item/:slug` route (after line 171), before the Detail section:

```js
  // Dismiss / mark-read items (removes from future scroll batches)
  router.post('/scroll/dismiss', asyncHandler(async (req, res) => {
    const { itemIds } = req.body;
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds array required' });
    }

    const username = getUsername();

    // Partition by source: freshrss items use markRead API, others go to YAML store
    const freshrssIds = [];
    const otherIds = [];

    for (const id of itemIds) {
      if (id.startsWith('freshrss:')) {
        // Extract the GReader item ID (everything after 'freshrss:')
        freshrssIds.push(id.slice('freshrss:'.length));
      } else {
        otherIds.push(id);
      }
    }

    const promises = [];

    if (freshrssIds.length > 0 && freshRSSAdapter) {
      promises.push(
        freshRSSAdapter.markRead(freshrssIds, username).catch(err => {
          logger.warn?.('feed.dismiss.freshrss.error', { error: err.message, count: freshrssIds.length });
        })
      );
    }

    if (otherIds.length > 0 && dismissedItemsStore) {
      dismissedItemsStore.add(otherIds);
    }

    await Promise.all(promises);

    res.json({ dismissed: itemIds.length });
  }));
```

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/feed.mjs
git commit -m "feat(feed): add POST /scroll/dismiss endpoint routing FreshRSS and YAML dismissals"
```

---

### Task 4: FeedCard Dismiss Button (X overlay / footer)

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/cards/index.jsx`

**Step 1: Add onDismiss prop to FeedCard**

Update the FeedCard signature (line 62 of `FeedCard.jsx`):

```jsx
export default function FeedCard({ item, colors = {}, onDismiss }) {
```

**Step 2: Add dismiss button on image cards**

Inside the hero image container `<div>` (after the play button overlay, before the closing `</div>` at line 114), add an X button:

```jsx
          {/* Dismiss button overlay */}
          {onDismiss && (
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(item); }}
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.55)',
                border: 'none',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                lineHeight: 1,
                zIndex: 2,
              }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          )}
```

**Step 3: Add dismiss button for text-only cards**

After the overdue badge block (after line 180), add a footer dismiss row for cards with no image:

```jsx
        {/* Dismiss footer for text-only cards */}
        {onDismiss && !(item.image && isImageUrl(item.image)) && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: '0.4rem',
            paddingTop: '0.3rem',
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}>
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(item); }}
              style={{
                background: 'none',
                border: 'none',
                color: '#5c636a',
                fontSize: '0.65rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.15rem 0.3rem',
                borderRadius: '4px',
              }}
              aria-label="Dismiss"
            >
              ✕ <span>Dismiss</span>
            </button>
          </div>
        )}
```

**Step 4: Update renderFeedCard to pass onDismiss**

In `frontend/src/modules/Feed/Scroll/cards/index.jsx`, update the function signature and pass onDismiss:

```jsx
import FeedCard from './FeedCard.jsx';

export function renderFeedCard(item, colors = {}, onDismiss = null) {
  return <FeedCard key={item.id} item={item} colors={colors} onDismiss={onDismiss} />;
}

export default {};
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx frontend/src/modules/Feed/Scroll/cards/index.jsx
git commit -m "feat(feed): add dismiss X button to FeedCard (image overlay + text footer)"
```

---

### Task 5: Swipe-to-Dismiss + Slide Animation on FeedCard

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx` (card rendering + dismiss handler)
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.scss` (wrapper styles for swipe)

**Step 1: Add dismiss API helper and state management in Scroll.jsx**

Add a `dismissItem` function and update the card rendering to support dismiss. In `Scroll.jsx`:

After the `handleGalleryNav` callback (line 220), add:

```jsx
  /** Queue of item IDs to batch-dismiss via API. */
  const dismissQueueRef = useRef([]);
  const dismissTimerRef = useRef(null);

  const flushDismissQueue = useCallback(() => {
    const ids = dismissQueueRef.current.splice(0);
    if (ids.length === 0) return;
    DaylightAPI('/api/v1/feed/scroll/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds: ids }),
    }).catch(err => console.error('Dismiss failed:', err));
  }, []);

  const queueDismiss = useCallback((itemId) => {
    dismissQueueRef.current.push(itemId);
    clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(flushDismissQueue, 500);
  }, [flushDismissQueue]);

  const handleDismiss = useCallback((item, wrapperEl) => {
    queueDismiss(item.id);

    if (wrapperEl) {
      // Slide left + collapse using Web Animations API
      const slideAnim = wrapperEl.animate(
        [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-100%)', opacity: 0 }],
        { duration: 250, easing: 'ease-in', fill: 'forwards' }
      );
      slideAnim.onfinish = () => {
        wrapperEl.animate(
          [{ height: wrapperEl.offsetHeight + 'px', marginBottom: '12px' }, { height: '0px', marginBottom: '0px' }],
          { duration: 200, easing: 'ease-out', fill: 'forwards' }
        ).onfinish = () => {
          setItems(prev => prev.filter(i => i.id !== item.id));
        };
      };
    } else {
      setItems(prev => prev.filter(i => i.id !== item.id));
    }
  }, [queueDismiss]);
```

**Step 2: Update card rendering to pass onDismiss and add swipe tracking**

Replace the items map block (lines 242-248) with a `ScrollCard` wrapper component. Define it inside `Scroll.jsx` or above the `Scroll` export:

Before the `Scroll` function (above line 22), add:

```jsx
function ScrollCard({ item, colors, onDismiss, onClick }) {
  const wrapperRef = useRef(null);
  const touchRef = useRef(null);

  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    touchRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    // Reset any transform
    if (wrapperRef.current) wrapperRef.current.style.transform = '';
  };

  const handleTouchMove = (e) => {
    if (!touchRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchRef.current.x;
    const dy = touch.clientY - touchRef.current.y;

    // Only track leftward horizontal swipes
    if (dx < -10 && Math.abs(dx) > Math.abs(dy)) {
      if (wrapperRef.current) {
        wrapperRef.current.style.transform = `translateX(${dx}px)`;
        wrapperRef.current.style.opacity = Math.max(0, 1 + dx / 300);
      }
    }
  };

  const handleTouchEnd = (e) => {
    if (!touchRef.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchRef.current.x;
    const elapsed = Date.now() - touchRef.current.time;
    touchRef.current = null;

    if (dx < -100 && elapsed < 600) {
      // Threshold met — dismiss
      onDismiss(item, wrapperRef.current);
    } else {
      // Spring back
      if (wrapperRef.current) {
        wrapperRef.current.animate(
          [{ transform: wrapperRef.current.style.transform, opacity: wrapperRef.current.style.opacity },
           { transform: 'translateX(0)', opacity: 1 }],
          { duration: 150, easing: 'ease-out', fill: 'forwards' }
        ).onfinish = () => {
          if (wrapperRef.current) {
            wrapperRef.current.style.transform = '';
            wrapperRef.current.style.opacity = '';
          }
        };
      }
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="scroll-item-wrapper"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div onClick={onClick}>
        {renderFeedCard(item, colors, (cardItem) => onDismiss(cardItem, wrapperRef.current))}
      </div>
    </div>
  );
}
```

**Step 3: Update the items rendering to use ScrollCard**

Replace lines 242-248 in `Scroll.jsx`:

```jsx
{items.map((item, i) => (
  <ScrollCard
    key={item.id || i}
    item={item}
    colors={colors}
    onDismiss={handleDismiss}
    onClick={(e) => handleCardClick(e, item)}
  />
))}
```

Note: remove the old `.scroll-item-wrapper` div since `ScrollCard` now provides it.

**Step 4: Add swipe-related styles to Scroll.scss**

In `frontend/src/modules/Feed/Scroll/Scroll.scss`, add to the `.scroll-item-wrapper` rule (around line 22):

```scss
.scroll-item-wrapper {
  // Existing styles stay...
  will-change: transform, opacity;
  overflow: visible;
}
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/Scroll.jsx frontend/src/modules/Feed/Scroll/Scroll.scss
git commit -m "feat(feed): add swipe-to-dismiss and slide-out animation for scroll cards"
```

---

### Task 6: Auto-Dismiss on Detail View Open

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx` (detail open effect)

**Step 1: Fire dismiss when detail view opens**

In the URL slug change effect (starting at line 122 of original `Scroll.jsx`), add a `queueDismiss` call when an item's detail is opened. After `prevSlugRef.current = urlSlug;` (line 124), add:

```jsx
    // Auto-dismiss: mark item as read when detail opens
    if (fullId) {
      queueDismiss(fullId);
    }
```

This fires the dismiss API call via the existing debounced queue. The item stays in the current scroll session's `items` state (it's not removed from the list — only future loads are affected).

**Step 2: Also auto-dismiss when navigating between items in detail view**

The `handleNav` callback (line 204) navigates to a new item, which triggers the URL slug effect — so the new item gets auto-dismissed automatically. No additional code needed.

**Step 3: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/Scroll.jsx
git commit -m "feat(feed): auto-dismiss items when detail view opens"
```

---

### Task 7: Manual Smoke Test

**No files changed — verification only.**

**Step 1: Start dev server**

```bash
lsof -i :3111  # check if already running
npm run dev     # if not running
```

**Step 2: Verify backend endpoint**

```bash
curl -X POST http://localhost:3112/api/v1/feed/scroll/dismiss \
  -H 'Content-Type: application/json' \
  -d '{"itemIds":["headline:test:123"]}'
```

Expected: `{ "dismissed": 1 }`

Verify the YAML file was created:

```bash
cat data/household/shared/feed/dismissed.yml
```

Expected: `headline:test:123: <unix_timestamp>`

**Step 3: Verify frontend**

1. Open `http://localhost:3111/feed/scroll`
2. Verify X button appears on image cards (top-right overlay)
3. Verify "✕ Dismiss" link appears at bottom of text-only cards
4. Click X → card should slide left and disappear
5. On mobile (or DevTools device mode): swipe a card left → same slide-out behavior
6. Click a card to open detail → verify network tab shows POST to `/scroll/dismiss`
7. Refresh the page → dismissed items should not reappear

**Step 4: Verify FreshRSS integration**

1. Find a `freshrss:*` item in the scroll
2. Dismiss it (swipe or X)
3. Check FreshRSS web UI — the item should now be marked as read
4. Refresh scroll — item should not reappear (because `excludeRead: true` filters it)

---

### Task 8: Final Commit + Cleanup

**Step 1: Review all changes**

```bash
git diff --stat
git log --oneline -10
```

**Step 2: Verify no regressions**

Run any existing feed-related tests:

```bash
npx playwright test tests/live/flow/feed/ --reporter=line
```

**Step 3: Squash or leave as-is per user preference**
