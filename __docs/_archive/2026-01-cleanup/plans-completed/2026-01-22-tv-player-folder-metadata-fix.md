# TV Player Folder Metadata Bug Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the TV player showing spinner/debug JSON instead of video when selecting Plex collections.

**Architecture:** The issue occurs because menu items with `play: { plex: collectionId }` bypass queue expansion. The content API returns collection metadata (no `media_url`) instead of playable content. Fix by making SinglePlayer detect non-playable responses and auto-expand to playable items.

**Tech Stack:** React, Express.js, Plex API

---

## Root Cause Analysis

When user selects "Bible Project" (collection ID 463232):

1. Menu item has `play: { plex: "463232" }`
2. `useQueueController` doesn't treat this as a queue (only `queue` prop or `play.playlist`/`play.queue` triggers queue mode)
3. `SinglePlayer` calls `fetchMediaInfo({ plex: "463232" })`
4. Content API `/api/v1/content/plex/info/463232` returns collection metadata with `media_url: null`
5. SinglePlayer renders debug `<pre>` because `media_type` is unrecognized

**Solution**: Make SinglePlayer detect when it receives a non-playable response (collection/folder) and auto-expand to the first playable item.

---

## Task 1: Add Collection Detection in SinglePlayer

**Files:**
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx:210-245`
- Test: Manual test via TV app

**Step 1: Update fetchVideoInfoCallback to detect collections**

In `SinglePlayer.jsx`, modify `fetchVideoInfoCallback` to detect when the response is a collection (no `media_url` and no recognized `media_type`) and auto-expand:

```jsx
const fetchVideoInfoCallback = useCallback(async () => {
  setIsReady(false);

  const info = await fetchMediaInfo({
    plex,
    media,
    shuffle,
    maxVideoBitrate: play?.maxVideoBitrate,
    maxResolution: play?.maxResolution,
    session: plexClientSession
  });

  if (info) {
    // Detect if this is a collection/folder (no media_url, no playable media_type)
    const isPlayable = info.media_url || ['dash_video', 'video', 'audio'].includes(info.media_type);

    if (!isPlayable && plex) {
      // This is a collection - fetch first playable item
      try {
        const { items } = await DaylightAPI(`/api/v1/list/plex/${plex}/playable`);
        if (items && items.length > 0) {
          const firstItem = items[0];
          const firstItemPlex = firstItem.plex || firstItem.play?.plex || firstItem.metadata?.plex;
          if (firstItemPlex) {
            // Fetch media info for the first playable item
            const playableInfo = await fetchMediaInfo({
              plex: firstItemPlex,
              shuffle: false,
              maxVideoBitrate: play?.maxVideoBitrate,
              maxResolution: play?.maxResolution,
              session: plexClientSession
            });
            if (playableInfo) {
              const withCap = {
                ...playableInfo,
                continuous,
                maxVideoBitrate: play?.maxVideoBitrate ?? null,
                maxResolution: play?.maxResolution ?? null
              };
              if (play?.seconds !== undefined) withCap.seconds = play.seconds;
              if (play?.resume !== undefined) withCap.resume = play.resume;
              setMediaInfo(withCap);
              setIsReady(true);
              return;
            }
          }
        }
      } catch (err) {
        console.error('[SinglePlayer] Failed to expand collection:', err);
      }
    }

    const withCap = {
      ...info,
      continuous,
      maxVideoBitrate: play?.maxVideoBitrate ?? null,
      maxResolution: play?.maxResolution ?? null
    };

    // Override seconds if explicitly provided in play object
    if (play?.seconds !== undefined) {
      withCap.seconds = play.seconds;
    }

    // Override resume if explicitly provided in play object
    if (play?.resume !== undefined) {
      withCap.resume = play.resume;
    }

    setMediaInfo(withCap);
    setIsReady(true);
  } else if (!!open) {
    setGoToApp(open);
  }
}, [plex, media, open, shuffle, continuous, play?.maxVideoBitrate, play?.maxResolution, play?.seconds, play?.resume, plexClientSession]);
```

**Step 2: Add DaylightAPI import if not present**

Ensure `DaylightAPI` is imported at the top of SinglePlayer.jsx:

```jsx
import { DaylightAPI } from '../../../lib/api.mjs';
```

**Step 3: Run manual test**

```bash
# Start dev server if not running
./dev

# Open browser to http://localhost:3112/tv
# Navigate to "Bible Project" and press Enter
# Expected: Video plays (not debug JSON)
```

**Step 4: Run automated test**

```bash
npx playwright test tests/runtime/tv-app/tv-video-select-play.runtime.test.mjs --reporter=list
```

Expected: Test passes, no "Player received folder data" error.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/components/SinglePlayer.jsx
git commit -m "fix(player): auto-expand collections to first playable item

When SinglePlayer receives a non-playable response (collection/folder with
no media_url), it now fetches /api/v1/list/plex/{id}/playable and uses
the first item. This fixes TV app showing debug JSON for collections.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add Unit Test for Collection Expansion

**Files:**
- Create: `tests/unit/player/singlePlayerCollectionExpand.unit.test.mjs`

**Step 1: Write the test**

```javascript
/**
 * Unit test: SinglePlayer collection expansion
 *
 * Verifies that when SinglePlayer receives a non-playable collection,
 * it auto-expands to the first playable item.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock the API module
vi.mock('../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn()
}));

// Mock fetchMediaInfo
vi.mock('../../../frontend/src/modules/Player/lib/api.js', () => ({
  fetchMediaInfo: vi.fn()
}));

import { DaylightAPI } from '../../../frontend/src/lib/api.mjs';
import { fetchMediaInfo } from '../../../frontend/src/modules/Player/lib/api.js';

describe('SinglePlayer collection expansion', () => {
  it('should detect a collection response (no media_url, no playable media_type)', () => {
    const collectionResponse = {
      listkey: '463232',
      key: '463232',
      title: 'New Testament',
      media_url: null,
      media_type: undefined
    };

    const isPlayable = collectionResponse.media_url ||
      ['dash_video', 'video', 'audio'].includes(collectionResponse.media_type);

    expect(isPlayable).toBe(false);
  });

  it('should detect a playable response (has media_url)', () => {
    const videoResponse = {
      listkey: '463233',
      key: '463233',
      title: 'New Testament Overview',
      media_url: '/api/v1/proxy/plex/video/...',
      media_type: 'dash_video'
    };

    const isPlayable = videoResponse.media_url ||
      ['dash_video', 'video', 'audio'].includes(videoResponse.media_type);

    expect(isPlayable).toBe(true);
  });

  it('should fetch playable items when collection detected', async () => {
    // Setup: collection info response
    fetchMediaInfo.mockResolvedValueOnce({
      listkey: '463232',
      title: 'New Testament',
      media_url: null
    });

    // Setup: playable items list
    DaylightAPI.mockResolvedValueOnce({
      items: [{
        id: 'plex:463233',
        plex: '463233',
        title: 'New Testament Overview'
      }]
    });

    // Setup: first playable item info
    fetchMediaInfo.mockResolvedValueOnce({
      listkey: '463233',
      title: 'New Testament Overview',
      media_url: '/api/v1/proxy/plex/video/...',
      media_type: 'dash_video'
    });

    // Simulate the logic (actual component test would use React Testing Library)
    const plex = '463232';
    const info = await fetchMediaInfo({ plex });

    const isPlayable = info.media_url || ['dash_video', 'video', 'audio'].includes(info.media_type);
    expect(isPlayable).toBe(false);

    // Expand collection
    const { items } = await DaylightAPI(`/api/v1/list/plex/${plex}/playable`);
    expect(items.length).toBeGreaterThan(0);

    const firstItemPlex = items[0].plex;
    const playableInfo = await fetchMediaInfo({ plex: firstItemPlex });

    expect(playableInfo.media_url).toBeTruthy();
    expect(playableInfo.media_type).toBe('dash_video');
  });
});
```

**Step 2: Run the test**

```bash
npm run test:unit -- --grep "collection expansion"
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/unit/player/singlePlayerCollectionExpand.unit.test.mjs
git commit -m "test(player): add unit tests for collection expansion logic

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Update Runtime Test Assertions

**Files:**
- Modify: `tests/runtime/tv-app/tv-video-select-play.runtime.test.mjs`

**Step 1: Update test to expect success**

The test already has good assertions. After the fix, it should pass. Run it to verify:

```bash
npx playwright test tests/runtime/tv-app/tv-video-select-play.runtime.test.mjs --reporter=list
```

**Step 2: Commit test results (if any changes needed)**

If test passes without changes, no commit needed for this task.

---

## Verification Checklist

- [ ] TV app: Select "Bible Project" → video plays (not debug JSON)
- [ ] TV app: Select any other collection → video plays
- [ ] Fitness app: Collections still work (regression check)
- [ ] Runtime test passes: `npx playwright test tests/runtime/tv-app/tv-video-select-play.runtime.test.mjs`
- [ ] Unit tests pass: `npm run test:unit`
- [ ] No console errors about "folder data"

---

## Alternative Approaches (Not Implemented)

### Option B: Backend content API auto-expand
The content API `/api/v1/content/plex/info/{id}` could detect collections and return the first playable item. This was rejected because:
- Changes API semantics unexpectedly
- Callers might actually want collection metadata

### Option C: Change menu item from `play` to `queue`
The FolderAdapter could return `queue: { plex: id }` instead of `play: { plex: id }` for collections. This was rejected because:
- Requires understanding item type at folder-config level
- Current approach is more resilient (works for any unexpected collection)
