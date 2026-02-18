# Audio Content Feed — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace plex-music with a weighted multi-artist audio-content source in the library tier, with an overhauled playable-content frontend experience.

**Architecture:** PlexFeedAdapter gains `parentIds` array support with weighted random selection. Frontend FeedCard uses a generic `meta.playable` flag instead of hardcoded source checks. FeedPlayerMiniBar gets time display and seekable progress.

**Tech Stack:** Node/Express backend, React frontend, Plex API via PlexAdapter, Jest for tests.

**Design Doc:** `docs/plans/2026-02-17-audio-content-feed-design.md`

---

### Task 1: PlexFeedAdapter — Weighted parentIds Support (Backend)

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/PlexFeedAdapter.mjs`
- Create: `tests/isolated/adapter/feed/PlexFeedAdapter.test.mjs`

**Step 1: Write the failing test for weighted parentIds**

Create `tests/isolated/adapter/feed/PlexFeedAdapter.test.mjs`:

```javascript
import { jest } from '@jest/globals';
import { PlexFeedAdapter } from '#adapters/feed/sources/PlexFeedAdapter.mjs';

function makeMockRegistry(items) {
  return {
    get: () => ({
      getList: jest.fn().mockResolvedValue(items),
    }),
  };
}

function makeItems(count) {
  return Array.from({ length: count }, (_, i) => ({
    localId: String(1000 + i),
    id: `plex:${1000 + i}`,
    title: `Episode ${i}`,
    subtitle: 'Test Artist',
    thumbnail: `/thumb/${i}`,
    duration: 2700,
    metadata: { type: 'track', addedAt: '2026-01-01', viewCount: 0 },
  }));
}

describe('PlexFeedAdapter', () => {
  const logger = { warn: jest.fn(), debug: jest.fn(), info: jest.fn() };

  test('sourceType is plex', () => {
    const adapter = new PlexFeedAdapter({ logger });
    expect(adapter.sourceType).toBe('plex');
  });

  describe('parentIds weighted selection', () => {
    test('fetches from one of the weighted parentIds', async () => {
      const mockItems = makeItems(5);
      const mockGetList = jest.fn().mockResolvedValue(mockItems);
      const registry = { get: () => ({ getList: mockGetList }) };

      const adapter = new PlexFeedAdapter({ contentRegistry: registry, logger });
      const query = {
        tier: 'library',
        priority: 5,
        limit: 1,
        params: {
          mode: 'children',
          parentIds: [
            { id: 7578, weight: 3 },
            { id: 481800, weight: 2 },
            { id: 242600, weight: 1 },
          ],
          unwatched: true,
        },
      };

      const result = await adapter.fetchItems(query, 'testuser');

      expect(mockGetList).toHaveBeenCalledTimes(1);
      const calledWith = mockGetList.mock.calls[0][0];
      expect(['7578', '481800', '242600']).toContain(calledWith);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('plex');
      expect(result[0].tier).toBe('library');
    });

    test('sets meta.playable on items from parentIds', async () => {
      const mockItems = makeItems(3);
      const registry = makeMockRegistry(mockItems);
      const adapter = new PlexFeedAdapter({ contentRegistry: registry, logger });

      const query = {
        tier: 'library',
        limit: 1,
        params: {
          mode: 'children',
          parentIds: [{ id: 7578, weight: 1 }],
        },
      };

      const result = await adapter.fetchItems(query, 'testuser');
      expect(result[0].meta.playable).toBe(true);
    });

    test('sets meta.duration in seconds from item.duration', async () => {
      const mockItems = [{
        localId: '100',
        id: 'plex:100',
        title: 'Test',
        subtitle: 'Artist',
        thumbnail: '/thumb',
        duration: 2700,
        metadata: { type: 'track', viewCount: 0 },
      }];
      const registry = makeMockRegistry(mockItems);
      const adapter = new PlexFeedAdapter({ contentRegistry: registry, logger });

      const query = {
        tier: 'library',
        limit: 1,
        params: { mode: 'children', parentIds: [{ id: 1, weight: 1 }] },
      };

      const result = await adapter.fetchItems(query, 'testuser');
      expect(result[0].meta.duration).toBe(2700);
    });

    test('falls back to single parentId when parentIds absent', async () => {
      const mockItems = makeItems(2);
      const mockGetList = jest.fn().mockResolvedValue(mockItems);
      const registry = { get: () => ({ getList: mockGetList }) };
      const adapter = new PlexFeedAdapter({ contentRegistry: registry, logger });

      const query = {
        tier: 'compass',
        limit: 1,
        params: { mode: 'children', parentId: 99999 },
      };

      const result = await adapter.fetchItems(query, 'testuser');
      expect(mockGetList).toHaveBeenCalledWith('99999');
      expect(result).toHaveLength(1);
      // Old behavior: no playable flag
      expect(result[0].meta.playable).toBeUndefined();
    });

    test('filters unwatched items when unwatched=true', async () => {
      const items = [
        { localId: '1', title: 'Watched', thumbnail: '/t', metadata: { viewCount: 3 } },
        { localId: '2', title: 'Unwatched', thumbnail: '/t', metadata: { viewCount: 0 } },
      ];
      const registry = makeMockRegistry(items);
      const adapter = new PlexFeedAdapter({ contentRegistry: registry, logger });

      const query = {
        limit: 5,
        params: { mode: 'children', parentIds: [{ id: 1, weight: 1 }], unwatched: true },
      };

      const result = await adapter.fetchItems(query, 'user');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Unwatched');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/PlexFeedAdapter.test.mjs --no-coverage`
Expected: FAIL — `parentIds` not handled, falls through to search mode

**Step 3: Implement weighted parentIds in PlexFeedAdapter**

In `backend/src/1_adapters/feed/sources/PlexFeedAdapter.mjs`, modify the `fetchItems` method and add a `#fetchWeightedChildren` method:

```javascript
// In fetchItems(), add parentIds check before single parentId:
async fetchItems(query, _username) {
    const plexAdapter = this.#contentRegistry?.get('plex');
    if (!plexAdapter && !this.#contentQueryPort) return [];

    try {
      const mode = query.params?.mode || 'search';

      if (mode === 'children' && plexAdapter) {
        // New: weighted multi-parent selection
        if (Array.isArray(query.params?.parentIds)) {
          return this.#fetchWeightedChildren(plexAdapter, query);
        }
        if (query.params?.parentId) {
          return this.#fetchChildren(plexAdapter, query);
        }
      }

      return this.#fetchSearch(query);
    } catch (err) {
      this.#logger.warn?.('plex.adapter.error', { error: err.message });
      return [];
    }
  }

// New method:
async #fetchWeightedChildren(plexAdapter, query) {
    const entries = query.params.parentIds;
    const totalWeight = entries.reduce((sum, e) => sum + (e.weight || 1), 0);
    let roll = Math.random() * totalWeight;
    let selectedId = entries[0].id;
    for (const entry of entries) {
      roll -= (entry.weight || 1);
      if (roll <= 0) { selectedId = entry.id; break; }
    }

    const items = await plexAdapter.getList(String(selectedId));
    let filtered = items || [];

    if (query.params?.unwatched) {
      filtered = filtered.filter(item => {
        const vc = item.metadata?.viewCount ?? item.viewCount ?? 0;
        return vc === 0;
      });
    }

    filtered.sort(() => Math.random() - 0.5);
    return filtered.slice(0, query.limit || 3).map(item => {
      const localId = item.localId || item.id?.replace?.('plex:', '') || item.id;
      return {
        id: `plex:${localId}`,
        tier: query.tier || 'library',
        source: 'plex',
        title: item.title || item.label || 'Media',
        body: item.subtitle || item.metadata?.artist || item.metadata?.parentTitle || item.description || null,
        image: item.thumbnail || null,
        link: this.#plexWebLink(localId),
        timestamp: item.metadata?.addedAt || new Date().toISOString(),
        priority: query.priority || 5,
        meta: {
          playable: true,
          duration: item.duration || null,
          type: item.type || item.metadata?.type,
          year: item.year || item.metadata?.year,
          artistName: item.metadata?.artist || item.metadata?.parentTitle || null,
          sourceName: item.metadata?.artist || item.metadata?.parentTitle || 'Audio',
          sourceIcon: null,
        },
      };
    });
  }
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/adapter/feed/PlexFeedAdapter.test.mjs --no-coverage`
Expected: All PASS

**Step 5: Commit**

```bash
git add tests/isolated/adapter/feed/PlexFeedAdapter.test.mjs backend/src/1_adapters/feed/sources/PlexFeedAdapter.mjs
git commit -m "feat: add weighted parentIds selection to PlexFeedAdapter

Supports parentIds array with weight field for multi-artist audio content.
Sets meta.playable and meta.duration on resulting feed items.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Query Config and Feed Config (Data)

**Files:**
- Create: `data/users/kckern/config/queries/audio-content.yml`
- Delete: `data/users/kckern/config/queries/plex-music.yml`
- Modify: `data/users/kckern/config/feed.yml`

**Step 1: Create the new audio-content query**

Create `data/users/kckern/config/queries/audio-content.yml`:

```yaml
type: plex
tier: library
priority: 5
limit: 1
params:
  mode: children
  parentIds:
    - id: 7578
      weight: 3
    - id: 481800
      weight: 2
    - id: 242600
      weight: 1
  unwatched: true
```

**Step 2: Delete the old plex-music query**

Delete `data/users/kckern/config/queries/plex-music.yml`.

**Step 3: Update feed.yml — remove plex-music from compass, add audio-content to library**

In `data/users/kckern/config/feed.yml`:

Remove from `scroll.tiers.compass.sources`:
```yaml
        plex-music:
          max_per_batch: 1
```

Add to `scroll.tiers.library.sources` (after `abs-ebooks`):
```yaml
        audio-content:
          max_per_batch: 1
          padding: true
          max_age_hours: null
```

**Step 4: Commit**

```bash
git add data/users/kckern/config/queries/audio-content.yml data/users/kckern/config/feed.yml
git rm data/users/kckern/config/queries/plex-music.yml
git commit -m "config: replace plex-music with audio-content in library tier

Three weighted Plex artists: Hourly History (3), Scribd Coach (2), DK Business (1).
Moved from compass tier to library tier.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: FeedCard — Generic Playable Flag + Duration Badge (Frontend)

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.scss`

**Step 1: Replace hardcoded play button condition**

In `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx`, line 93, replace:

```jsx
{(item.source === 'plex' || item.meta?.youtubeId) && (
```

With:

```jsx
{item.meta?.playable && (
```

**Step 2: Add duration badge to hero image area**

Add a `formatDuration` helper at the top of the file (after imports):

```javascript
function formatDuration(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}
```

Inside the hero image `<div>` (after the dismiss button overlay, before the closing `</div>`), add:

```jsx
{/* Duration badge */}
{item.meta?.duration && (
  <span style={{
    position: 'absolute',
    bottom: '8px',
    right: '8px',
    background: 'rgba(0,0,0,0.75)',
    color: '#fff',
    fontSize: '0.65rem',
    fontWeight: 600,
    padding: '0.15rem 0.4rem',
    borderRadius: '4px',
    letterSpacing: '0.02em',
    zIndex: 1,
  }}>
    {formatDuration(item.meta.duration)}
  </span>
)}
```

**Step 3: Verify visually**

Start dev server, load the feed. Existing plex items (if any) should still show play buttons via `meta.playable`. YouTube items need `meta.playable: true` set by their adapter too — verify no regression.

> **Note:** YouTube items currently use `meta.youtubeId` for the play button. The YouTubeFeedAdapter must also set `meta.playable: true` to preserve existing behavior. Check `backend/src/1_adapters/feed/sources/YouTubeFeedAdapter.mjs` and add `playable: true` to meta if not already present.

**Step 4: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx
git commit -m "feat: generic meta.playable flag for feed card play button

Replace hardcoded source === 'plex' || youtubeId check with meta.playable.
Add duration badge overlay on hero images.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Ensure Existing Playable Sources Set meta.playable (Backend)

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/PlexFeedAdapter.mjs` (existing single-parentId path)
- Check: `backend/src/1_adapters/feed/sources/YouTubeFeedAdapter.mjs`

**Step 1: Add meta.playable to existing PlexFeedAdapter #fetchChildren path**

In the existing `#fetchChildren` method (the single `parentId` path), add `playable: true` to the `meta` object:

```javascript
meta: {
  playable: true,  // <-- add this
  type: item.type || item.metadata?.type,
  year: item.year || item.metadata?.year,
  sourceName: 'Plex',
  sourceIcon: null,
},
```

Also add it to the `#fetchSearch` path's meta object.

**Step 2: Check YouTubeFeedAdapter**

Read `backend/src/1_adapters/feed/sources/YouTubeFeedAdapter.mjs`. If it sets `meta.youtubeId`, also add `meta.playable: true` alongside it. This ensures YouTube feed items keep their play button after the FeedCard condition change.

**Step 3: Run existing tests**

Run: `npx jest tests/isolated/adapter/feed/ --no-coverage`
Expected: All existing tests pass (no regressions)

**Step 4: Commit**

```bash
git add backend/src/1_adapters/feed/sources/PlexFeedAdapter.mjs backend/src/1_adapters/feed/sources/YouTubeFeedAdapter.mjs
git commit -m "feat: set meta.playable on all playable feed sources

Ensures play button works after FeedCard switches to generic playable flag.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: MediaBody — Audio Indicator (Frontend)

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/cards/bodies/MediaBody.jsx`

**Step 1: Add audio indicator icon and duration to MediaBody**

Replace the full contents of `MediaBody.jsx`:

```jsx
export default function MediaBody({ item }) {
  const subtitle = item.body || null;
  const label = item.meta?.sourceName || item.source || 'Media';
  const isAudio = item.meta?.playable && !item.meta?.youtubeId;
  const duration = item.meta?.duration;

  const formatDuration = (seconds) => {
    if (!seconds || !Number.isFinite(seconds)) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m} min`;
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        {isAudio && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#fab005" style={{ flexShrink: 0 }}>
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
          </svg>
        )}
        <span style={{
          display: 'inline-block',
          background: '#fab005',
          color: '#000',
          fontSize: '0.6rem',
          fontWeight: 700,
          padding: '0.1rem 0.4rem',
          borderRadius: '4px',
          textTransform: 'uppercase',
        }}>
          {label}
        </span>
        {duration && (
          <span style={{
            fontSize: '0.6rem',
            color: '#868e96',
            marginLeft: 'auto',
          }}>
            {formatDuration(duration)}
          </span>
        )}
      </div>
      <h3 style={{
        margin: 0,
        fontSize: '0.95rem',
        fontWeight: 500,
        color: '#fff',
        wordBreak: 'break-word',
      }}>
        {item.title}
      </h3>
      {subtitle && (
        <p style={{
          margin: '0.25rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          wordBreak: 'break-word',
        }}>
          {subtitle}
        </p>
      )}
    </>
  );
}
```

**Step 2: Verify visually**

Load the feed. Plex cards should now show a speaker icon and duration in the body area.

**Step 3: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/cards/bodies/MediaBody.jsx
git commit -m "feat: add audio indicator and duration to MediaBody

Shows speaker icon for playable audio items and formatted duration.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: FeedPlayerMiniBar — Time Display + Seekable Progress (Frontend)

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/FeedPlayerMiniBar.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.scss`

**Step 1: Enhance FeedPlayerMiniBar with time display and seekable progress**

Replace the full contents of `FeedPlayerMiniBar.jsx`:

```jsx
import { proxyImage } from './cards/utils.js';

function formatTime(s) {
  if (!s || !Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function FeedPlayerMiniBar({ item, playback, onOpen, onClose }) {
  if (!item) return null;

  const { playing, currentTime, duration, toggle, seek, progressElRef } = playback || {};
  const thumb = item.image ? proxyImage(item.image) : null;

  const handleProgressClick = (e) => {
    if (!duration || !seek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(duration, pct * duration)));
  };

  return (
    <div className="feed-mini-bar" role="region" aria-label="Now playing">
      {thumb && (
        <img
          src={thumb}
          alt=""
          className="feed-mini-bar-thumb"
          onClick={onOpen}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      )}
      <div className="feed-mini-bar-info" onClick={onOpen}>
        <span className="feed-mini-bar-source">{item.meta?.sourceName || item.source}</span>
        <span className="feed-mini-bar-title">{item.title}</span>
      </div>
      {duration > 0 && (
        <span className="feed-mini-bar-time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      )}
      <button
        className="feed-mini-bar-toggle"
        onClick={(e) => { e.stopPropagation(); toggle?.(); }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          {playing
            ? <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
            : <path d="M8 5v14l11-7z" />
          }
        </svg>
      </button>
      <button
        className="feed-mini-bar-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Stop playback"
      >
        &times;
      </button>
      <div className="feed-mini-bar-progress" onClick={handleProgressClick}>
        <div className="feed-mini-bar-progress-fill" ref={progressElRef} />
      </div>
    </div>
  );
}
```

**Step 2: Add time display styling to Scroll.scss**

After the `.feed-mini-bar-title` rule (around line 233), add:

```scss
.feed-mini-bar-time {
  font-size: 0.6rem;
  color: #5c636a;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
```

Update the `.feed-mini-bar-progress` rule to show a pointer cursor:

```scss
.feed-mini-bar-progress {
  width: 100%;
  height: 3px;
  background: #25262b;
  border-radius: 1.5px;
  order: 99;
  flex-basis: 100%;
  margin-top: 0.25rem;
  cursor: pointer;
}
```

**Step 3: Verify visually**

Play a media item, check the mini bar shows:
- Time display "0:00 / 3:45" (or whatever duration)
- Clicking the progress bar seeks to that position

**Step 4: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/FeedPlayerMiniBar.jsx frontend/src/modules/Feed/Scroll/Scroll.scss
git commit -m "feat: add time display and seekable progress to mini bar

Shows currentTime/duration and allows click-to-seek on progress bar.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Integration Verification

**Step 1: Run all existing feed adapter tests**

Run: `npx jest tests/isolated/adapter/feed/ --no-coverage`
Expected: All PASS (including new PlexFeedAdapter tests)

**Step 2: Verify the full flow manually**

1. Start dev server: check it's running with `lsof -i :3111`
2. Load the feed at `http://localhost:3111/feed/scroll`
3. Verify audio-content items appear in the library tier
4. Verify play button overlay appears on the card
5. Verify duration badge appears on the hero image
6. Tap play, verify mini bar appears with time display
7. Click on progress bar to seek
8. Verify existing YouTube/Plex items still have play buttons

**Step 3: Check for regressions**

- YouTube cards: still show play button (via `meta.playable`)
- Other Plex cards: still show play button
- Non-playable cards (reddit, headlines): no play button
- Mini bar: still works for YouTube playback

**Step 4: Final commit (if any fixups needed)**

Only if fixes were needed during verification.
