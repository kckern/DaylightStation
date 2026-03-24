# Freshvideo Media-Prefix Detection Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `media:news/*` content IDs to correctly trigger freshvideo strategy (latest unwatched video) instead of returning the oldest file alphabetically.

**Architecture:** The `MediaAdapter.resolvePlayables()` detects freshvideo sources by checking `id.startsWith('video/news/')`, but when input is `media:news/aljazeera`, the ID is `news/aljazeera` (without `video/` prefix). The `video/` prefix only appears during `resolvePath()` fallback. Fix: use the resolved path's prefix to detect freshvideo. Same fix needed in `getItem()` for the `isFreshVideo` flag used for container type labeling.

**Tech Stack:** Node.js ESM, Vitest

**Bug report:** `docs/_wip/bugs/2026-03-23-office-program-freshvideo-wrong-file.md`

---

### Task 1: Add failing test for `media:news/*` freshvideo detection

**Files:**
- Modify: `tests/isolated/adapter/content/freshvideo/FreshVideoAdapter.test.mjs`

The existing test file tests `FreshVideoAdapter` (the dedicated adapter), but the bug is in `MediaAdapter`. We need a new test file for MediaAdapter's freshvideo path.

- [ ] **Step 1: Create test file for MediaAdapter freshvideo detection**

Create `tests/isolated/adapter/content/media/MediaAdapter.freshvideo.test.mjs`:

```js
import { describe, it, expect, vi } from 'vitest';
import { MediaAdapter } from '#adapters/content/media/media/MediaAdapter.mjs';
import path from 'path';

/**
 * Mock filesystem where files live under video/news/ but the input ID
 * uses the shorter news/ path (relying on MEDIA_PREFIXES fallback).
 *
 * Directory structure:
 *   <mediaBase>/video/news/testchannel/20260310.mp4
 *   <mediaBase>/video/news/testchannel/20260322.mp4
 */
function makeMediaAdapter({ watchedKeys = [] } = {}) {
  const mediaBase = '/fake/media';

  // Build a fake filesystem map
  const dirs = new Set([
    path.join(mediaBase, 'video', 'news', 'testchannel'),
  ]);
  const files = new Map([
    [path.join(mediaBase, 'video', 'news', 'testchannel', '20260310.mp4'), { size: 1000, isDirectory: () => false, mtimeMs: 1 }],
    [path.join(mediaBase, 'video', 'news', 'testchannel', '20260322.mp4'), { size: 2000, isDirectory: () => false, mtimeMs: 2 }],
  ]);

  const adapter = new MediaAdapter({ mediaBasePath: mediaBase });

  // Stub internal filesystem calls used by resolvePath, getItem, getList
  const origResolvePath = adapter.resolvePath.bind(adapter);

  // Override resolvePath to use our fake filesystem
  adapter.resolvePath = (mediaKey) => {
    mediaKey = mediaKey.replace(/^\//, '');
    const normalizedKey = path.normalize(mediaKey).replace(/^(\.\.[/\\])+/, '');

    // Try MEDIA_PREFIXES: ['', 'audio', 'video', 'img']
    for (const prefix of ['', 'audio', 'video', 'img']) {
      const candidate = prefix
        ? path.join(mediaBase, prefix, normalizedKey)
        : path.join(mediaBase, normalizedKey);

      if (dirs.has(candidate) || files.has(candidate)) {
        return { path: candidate, prefix };
      }
    }
    return null;
  };

  // Stub getList to return directory contents
  const origGetList = adapter.getList.bind(adapter);
  adapter.getList = async (id) => {
    const localId = id.replace(/^(files|media|local|file|fs):/, '');
    const resolved = adapter.resolvePath(localId);
    if (!resolved) return [];

    // Return items in alphabetical order (simulating real fs)
    const dirPath = resolved.path;
    const entries = [...files.keys()]
      .filter(f => path.dirname(f) === dirPath)
      .map(f => path.basename(f))
      .sort();

    // Build PlayableItem-like objects
    return entries.map(entry => {
      const childLocalId = localId ? `${localId}/${entry}` : entry;
      return {
        id: `files:${childLocalId}`,
        localId: childLocalId,
        source: 'files',
        title: path.basename(entry, '.mp4'),
        itemType: 'leaf',
        getLocalId() { return this.localId; },
        isPlayable() { return true; },
        mediaUrl: `/api/v1/proxy/media/stream/${encodeURIComponent(childLocalId)}`,
        metadata: { type: 'video', mimeType: 'video/mp4' },
      };
    });
  };

  // Stub getItem to return PlayableItem-like objects
  adapter.getItem = async (id) => {
    const localId = id.replace(/^(files|media|local):/, '');
    const resolved = adapter.resolvePath(localId);
    if (!resolved) return null;

    const stat = files.get(resolved.path);
    if (stat && !stat.isDirectory()) {
      return {
        id: `files:${localId}`,
        localId,
        source: 'files',
        title: path.basename(localId, '.mp4'),
        itemType: 'leaf',
        getLocalId() { return this.localId; },
        isPlayable() { return true; },
        mediaUrl: `/api/v1/proxy/media/stream/${encodeURIComponent(localId)}`,
        metadata: { type: 'video', mimeType: 'video/mp4' },
      };
    }

    // Directory
    if (dirs.has(resolved.path)) {
      return {
        id: `files:${localId}`,
        localId,
        source: 'files',
        title: path.basename(localId),
        itemType: 'container',
        getLocalId() { return this.localId; },
        isPlayable() { return false; },
      };
    }

    return null;
  };

  // Stub mediaProgressMemory
  adapter.mediaProgressMemory = {
    get(key) {
      const cleanKey = key.replace(/^(files|media):/, '');
      const percent = watchedKeys.includes(cleanKey) ? 95 : 0;
      return { percent };
    },
  };

  return adapter;
}

describe('MediaAdapter freshvideo detection via media: prefix', () => {
  it('picks latest video when input uses news/ path (no video/ prefix)', async () => {
    const adapter = makeMediaAdapter();
    // This is the exact path that comes from "media:news/testchannel" in a program list
    const result = await adapter.resolvePlayables('news/testchannel');

    expect(result).toHaveLength(1);
    expect(result[0].localId).toContain('20260322');
  });

  it('picks latest video when input uses full video/news/ path', async () => {
    const adapter = makeMediaAdapter();
    const result = await adapter.resolvePlayables('video/news/testchannel');

    expect(result).toHaveLength(1);
    expect(result[0].localId).toContain('20260322');
  });

  it('skips watched and picks next unwatched', async () => {
    const adapter = makeMediaAdapter({
      watchedKeys: ['news/testchannel/20260322.mp4'],
    });
    const result = await adapter.resolvePlayables('news/testchannel');

    expect(result).toHaveLength(1);
    expect(result[0].localId).toContain('20260310');
  });

  it('returns all items for non-news media paths (no freshvideo)', async () => {
    // Create adapter with files under audio/ instead of video/news/
    const mediaBase = '/fake/media';
    const adapter = new MediaAdapter({ mediaBasePath: mediaBase });

    adapter.resolvePath = (key) => {
      const norm = path.normalize(key).replace(/^(\.\.[/\\])+/, '');
      const candidate = path.join(mediaBase, 'audio', norm);
      if (norm === 'playlist') return { path: candidate, prefix: 'audio' };
      if (norm.startsWith('playlist/')) return { path: candidate, prefix: 'audio' };
      return null;
    };

    adapter.getList = async () => [
      { id: 'files:playlist/track1.mp3', localId: 'playlist/track1.mp3', itemType: 'leaf', getLocalId() { return this.localId; }, isPlayable() { return true; }, metadata: {} },
      { id: 'files:playlist/track2.mp3', localId: 'playlist/track2.mp3', itemType: 'leaf', getLocalId() { return this.localId; }, isPlayable() { return true; }, metadata: {} },
    ];

    adapter.getItem = async (id) => {
      const localId = id.replace(/^(files|media|local):/, '');
      const resolved = adapter.resolvePath(localId);
      if (!resolved) return null;
      return { id: `files:${localId}`, localId, itemType: 'leaf', isPlayable() { return true; }, metadata: {} };
    };

    const result = await adapter.resolvePlayables('playlist');
    // Non-news path should return ALL items (no freshvideo strategy)
    expect(result.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/content/media/MediaAdapter.freshvideo.test.mjs`
Expected: First test FAILS — `news/testchannel` returns both items (no freshvideo applied) instead of just the latest.

- [ ] **Step 3: Commit failing test**

```bash
git add tests/isolated/adapter/content/media/MediaAdapter.freshvideo.test.mjs
git commit -m "test: add failing test for media:news/* freshvideo detection"
```

---

### Task 2: Fix freshvideo detection in `MediaAdapter.resolvePlayables`

**Files:**
- Modify: `backend/src/1_adapters/content/media/media/MediaAdapter.mjs:550-552`

The fix: call `resolvePath` at the top of `resolvePlayables` to determine if the path resolves under the `video/` prefix with a `news/` localId. Use this to set `isFreshVideo` correctly.

- [ ] **Step 1: Fix the freshvideo detection**

In `backend/src/1_adapters/content/media/media/MediaAdapter.mjs`, replace the `resolvePlayables` method's freshvideo detection (lines 550-552):

**Before:**
```js
  async resolvePlayables(id, options = {}) {
    // Detect freshvideo paths (video/news/*) and apply strategy
    const isFreshVideo = options.freshvideo || id.startsWith('video/news/');
```

**After:**
```js
  async resolvePlayables(id, options = {}) {
    // Detect freshvideo paths — check both explicit video/news/ prefix
    // and paths that resolve under the video/ MEDIA_PREFIX with a news/ localId
    // (e.g., "media:news/aljazeera" resolves to media/video/news/aljazeera/)
    const localId = id.replace(/^(files|media|local|file|fs):/, '');
    const resolved = this.resolvePath(localId);
    const isFreshVideo = options.freshvideo
      || localId.startsWith('video/news/')
      || (resolved?.prefix === 'video' && localId.startsWith('news/'));
```

- [ ] **Step 2: Run the freshvideo tests**

Run: `npx vitest run tests/isolated/adapter/content/media/MediaAdapter.freshvideo.test.mjs`
Expected: All 4 tests PASS.

- [ ] **Step 3: Run existing FreshVideoAdapter tests to verify no regression**

Run: `npx vitest run tests/isolated/adapter/content/freshvideo/`
Expected: All existing tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/1_adapters/content/media/media/MediaAdapter.mjs
git commit -m "fix: detect freshvideo for media:news/* paths via resolved prefix"
```

---

### Task 3: Fix freshvideo detection in `MediaAdapter.getItem` (container type labeling)

**Files:**
- Modify: `backend/src/1_adapters/content/media/media/MediaAdapter.mjs:374-375`

Same bug exists in `getItem()` where `isFreshVideo` determines whether a directory is labeled as `'channel'` vs `'directory'`. The `resolved` variable is already available from line 363.

- [ ] **Step 1: Fix the detection in getItem**

In `backend/src/1_adapters/content/media/media/MediaAdapter.mjs`, replace line 375:

**Before:**
```js
        const isFreshVideo = localId.startsWith('video/news/');
```

**After:**
```js
        const isFreshVideo = localId.startsWith('video/news/')
          || (resolved.prefix === 'video' && localId.startsWith('news/'));
```

- [ ] **Step 2: Run all related tests**

Run: `npx vitest run tests/isolated/adapter/content/media/ tests/isolated/adapter/content/freshvideo/`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/content/media/media/MediaAdapter.mjs
git commit -m "fix: detect freshvideo container type for media:news/* paths in getItem"
```

---

### Task 4: Remove dead `freshvideo` prefix from MediaAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/media/media/MediaAdapter.mjs:170-178`

`MediaAdapter.prefixes` claims `{ prefix: 'freshvideo', idTransform: ... }`, but the `FreshVideoAdapter` registers with `source: 'freshvideo'` which wins in Layer 1 of `ContentIdResolver`. The MediaAdapter entry is dead code that can never be reached, and its existence is confusing.

- [ ] **Step 1: Remove the dead prefix entry**

In `backend/src/1_adapters/content/media/media/MediaAdapter.mjs`, change the `prefixes` getter:

**Before:**
```js
  get prefixes() {
    return [
      { prefix: 'files' },
      { prefix: 'media' },
      { prefix: 'local' },
      { prefix: 'file' },
      { prefix: 'fs' },
      { prefix: 'freshvideo', idTransform: (id) => `video/news/${id}` }
    ];
  }
```

**After:**
```js
  get prefixes() {
    return [
      { prefix: 'files' },
      { prefix: 'media' },
      { prefix: 'local' },
      { prefix: 'file' },
      { prefix: 'fs' }
    ];
  }
```

- [ ] **Step 2: Run all content adapter tests**

Run: `npx vitest run tests/isolated/adapter/content/`
Expected: All tests PASS. No test depends on the `freshvideo` prefix routing through MediaAdapter.

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/content/media/media/MediaAdapter.mjs
git commit -m "refactor: remove unreachable freshvideo prefix from MediaAdapter"
```

---

### Task 5: Verify end-to-end in container

This task is manual verification — not automated tests.

- [ ] **Step 1: Build and deploy**

Build the Docker image and deploy to verify the fix works with the actual office-program queue.

- [ ] **Step 2: Trigger the office program queue**

```bash
curl "http://localhost:3111/api/v1/device/office-tv/load?queue=office-program"
```

- [ ] **Step 3: Check logs for correct video selection**

```bash
sudo docker logs daylight-station --since=1m 2>&1 | grep -E "queue-track-changed|queue\.resolve"
```

Expected: First track should be `20260322` (or the latest unwatched), not `20260313`.
