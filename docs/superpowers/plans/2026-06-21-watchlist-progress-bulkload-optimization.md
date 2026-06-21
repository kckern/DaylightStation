# Watchlist Progress Bulk-Load Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the N-serial-disk-read hotspot that makes large watchlists (e.g. "Come Follow Me (KC)" = 447 children) take ~8s to resolve, by bulk-loading media progress once per namespace and adding an mtime-keyed read cache to the progress store.

**Architecture:** Two layers. (1) In `ListAdapter._buildListItems`, replace the per-child `await mediaProgressMemory.get(assetId, watchCategory)` with a lazy per-category bulk load (`getAll(watchCategory)` → `Map`), mirroring the pattern already used 100 lines up in `_getNextPlayableFromChild`. (2) Add an mtime-keyed in-memory read cache to `YamlMediaProgressMemory._readFile` so *every* caller stops re-parsing the same YAML, with write-through invalidation so progress writes (and external Dropbox-synced changes, detected via mtime) are never served stale.

**Tech Stack:** Node ES modules (`.mjs`), DDD adapter layer, Vitest (isolated specs), js-yaml, YAML file persistence.

---

## Background / Root Cause (confirmed via logs + code)

- `watchlist:scriptures2026` ("Come Follow Me (KC)") expands to **447 `readalong:` children**, all in one progress namespace (`scriptures`). No Plex involved.
- `ListAdapter._buildListItems` enriches each child with `await this.mediaProgressMemory.get(assetId, watchCategory)` in a sequential loop.
- `YamlMediaProgressMemory.get()` → `_readFile()` → `loadYamlSafe()` → `loadYaml()` → **`fs.readFileSync` + `yaml.load`, uncached, every call.**
- The progress file `data/household/history/media_memory/scriptures.yml` is **1,975 lines / 44 KB**. It gets read + parsed **447 times** to render one menu.
- Measured warm: `GET /api/v1/list/watchlist/scriptures2026` ≈ 4.3s (enrichment only); `GET /api/v1/queue/watchlist/scriptures2026` ≈ 8.1–8.5s (full resolve → 152 playables). The live load hit ~17.5s under concurrent load and blew past the frontend's 10s `queue-init-timeout`, so the user saw it hang and retried.

## File Structure

- **Modify:** `backend/src/1_adapters/content/list/ListAdapter.mjs`
  - `_buildListItems()` (~line 842): add a lazy per-category progress loader; swap the per-item `get()` for a Map lookup.
- **Modify:** `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs`
  - Constructor: add `this._readCache = new Map()`.
  - Import `resolveYamlPath`, `getStats` from FileIO.
  - `_readFile()`: mtime-keyed cache.
  - `_writeFile()` and `clear()`: invalidate the cache entry.
- **Create:** `tests/isolated/adapter/content/list/ListAdapter.buildListItems.test.mjs`
- **Create:** `tests/isolated/adapter/persistence/YamlMediaProgressMemory.readCache.test.mjs`

## Test runner

These are Vitest "isolated" specs. The repo's `npm run test:isolated` routes them to Jest and crashes (see project memory). Always run them directly:

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs <path-to-spec>
```

---

### Task 1: Bulk-load watchlist progress once per namespace in `_buildListItems`

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs` (insert before the `for` loop at ~line 857; replace the enrichment block at ~lines 954-963)
- Test: `tests/isolated/adapter/content/list/ListAdapter.buildListItems.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/adapter/content/list/ListAdapter.buildListItems.test.mjs`:

```javascript
// tests/isolated/adapter/content/list/ListAdapter.buildListItems.test.mjs
import { describe, it, expect, vi } from 'vitest';

// Mock FileIO so ListAdapter imports without touching the filesystem.
// _buildListItems only touches FileIO for the uid-thumbnail path, which our
// items deliberately avoid (no uid), so these defaults are never exercised.
vi.mock('#system/utils/FileIO.mjs', () => ({
  dirExists: vi.fn(() => false),
  listEntries: vi.fn(() => []),
  fileExists: vi.fn(() => true),
  loadYaml: vi.fn(() => null),
  getStats: vi.fn(() => ({ mtimeMs: 1 })),
}));

const { ListAdapter } = await import('#adapters/content/list/ListAdapter.mjs');

// Progress store double. getAll returns one entity per supplied entry,
// keyed by contentId (matching YamlMediaProgressMemory.getAll's shape).
function makeMemory(entries = []) {
  return {
    get: vi.fn(async () => null),
    getAll: vi.fn(async () => entries.map((e) => ({ ...e }))),
  };
}

function makeAdapter(mediaProgressMemory) {
  return new ListAdapter({
    dataPath: '/fake/data',
    registry: null,
    mediaProgressMemory: mediaProgressMemory || null,
  });
}

function makeReadalongItems(count) {
  return Array.from({ length: count }, (_, i) => ({
    input: `readalong:scripture/ch${i + 1}`,
    title: `Chapter ${i + 1}`,
  }));
}

describe('ListAdapter._buildListItems progress enrichment', () => {
  it('bulk-loads progress once per namespace instead of once per child', async () => {
    const memory = makeMemory([]);
    const adapter = makeAdapter(memory);
    const items = makeReadalongItems(50);

    const result = await adapter._buildListItems(
      items,
      'watchlist',
      'scriptures2026',
      { namespace: 'scriptures' }
    );

    expect(result).toHaveLength(50);
    expect(memory.getAll).toHaveBeenCalledTimes(1);
    expect(memory.getAll).toHaveBeenCalledWith('scriptures');
    expect(memory.get).not.toHaveBeenCalled();
  });

  it('enriches each child with watch state from the bulk-loaded map', async () => {
    const memory = makeMemory([
      { contentId: 'scripture/ch3', percent: 42, playhead: 99, lastPlayed: '2026-06-20' },
    ]);
    const adapter = makeAdapter(memory);
    const items = [
      { input: 'readalong:scripture/ch1', title: 'Ch 1' },
      { input: 'readalong:scripture/ch3', title: 'Ch 3' },
    ];

    const result = await adapter._buildListItems(
      items,
      'watchlist',
      'scriptures2026',
      { namespace: 'scriptures' }
    );

    const ch3 = result.find((r) => r.localId === 'scripture/ch3');
    expect(ch3.metadata.percent).toBe(42);
    expect(ch3.metadata.playhead).toBe(99);
    expect(ch3.metadata.lastPlayed).toBe('2026-06-20');

    const ch1 = result.find((r) => r.localId === 'scripture/ch1');
    expect(ch1.metadata.percent).toBe(0);
    expect(ch1.metadata.playhead).toBe(0);
    expect(ch1.metadata.lastPlayed).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/content/list/ListAdapter.buildListItems.test.mjs
```
Expected: FAIL. First test fails on `expect(memory.getAll).toHaveBeenCalledTimes(1)` (actual 0) and `expect(memory.get).not.toHaveBeenCalled()` (actual 50) — current code calls `get()` per child and never calls `getAll()`.

- [ ] **Step 3: Add the lazy per-category loader before the loop**

In `backend/src/1_adapters/content/list/ListAdapter.mjs`, inside `_buildListItems`, find:

```javascript
    const results = [];

    for (const item of items) {
```

Replace with:

```javascript
    const results = [];

    // Bulk-load progress once per namespace/category instead of one disk read
    // per child. mediaProgressMemory.get() → _readFile() does an uncached
    // fs.readFileSync + yaml.load on EVERY call, so the old per-item lookup
    // re-parsed the same YAML N times (a 447-child scripture watchlist re-read
    // scriptures.yml 447×, ~4.3s). Mirror the bulk-load in
    // _getNextPlayableFromChild(): read each category file once into a Map.
    const progressByCategory = new Map(); // watchCategory -> Map(assetId -> MediaProgress)
    const getCategoryProgress = async (watchCategory) => {
      let map = progressByCategory.get(watchCategory);
      if (!map) {
        map = new Map();
        const all = await this.mediaProgressMemory.getAll(watchCategory);
        for (const p of all) map.set(p.contentId, p);
        progressByCategory.set(watchCategory, map);
      }
      return map;
    };

    for (const item of items) {
```

- [ ] **Step 4: Swap the per-item `get()` for a Map lookup**

In the same method, find:

```javascript
      if (isWatchlist && this.mediaProgressMemory) {
        const watchCategory = listMetadata?.namespace || watchCategoryMap[source] || source;
        if (watchCategory) {
          const watchState = await this.mediaProgressMemory.get(assetId, watchCategory);
          percent = watchState?.percent ?? 0;
          playhead = watchState?.playhead ?? 0;
          lastPlayed = watchState?.lastPlayed ?? null;
          priority = this._calculatePriority(item, watchState);
        }
      }
```

Replace with:

```javascript
      if (isWatchlist && this.mediaProgressMemory) {
        const watchCategory = listMetadata?.namespace || watchCategoryMap[source] || source;
        if (watchCategory) {
          const progressMap = await getCategoryProgress(watchCategory);
          const watchState = progressMap.get(assetId) || null;
          percent = watchState?.percent ?? 0;
          playhead = watchState?.playhead ?? 0;
          lastPlayed = watchState?.lastPlayed ?? null;
          priority = this._calculatePriority(item, watchState);
        }
      }
```

Note: `getAll()` and `get()` both return `MediaProgress` entities built by `_toDomainEntity`, so `watchState` is the same type as before — `percent`/`playhead`/`lastPlayed` and `_calculatePriority(item, watchState)` behave identically (and `_calculatePriority` already handles `null`).

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/content/list/ListAdapter.buildListItems.test.mjs
```
Expected: PASS (2 passing).

- [ ] **Step 6: Run the existing ListAdapter specs to confirm no regression**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/content/list/
```
Expected: PASS — `ListAdapter.loadList.test.mjs`, `ListAdapter.resolvePlayables.test.mjs`, and the new spec all green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/1_adapters/content/list/ListAdapter.mjs tests/isolated/adapter/content/list/ListAdapter.buildListItems.test.mjs
git commit -m "perf(list): bulk-load watchlist progress once per namespace

_buildListItems re-read the same media_memory YAML once per child via the
uncached mediaProgressMemory.get(); a 447-item watchlist re-parsed
scriptures.yml 447× (~4.3s). Load each namespace once into a Map, mirroring
_getNextPlayableFromChild.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add an mtime-keyed read cache to `YamlMediaProgressMemory`

This kills the underlying footgun for *all* callers of `get`/`getAll` (not just watchlists): repeated reads of an unchanged file parse it once. mtime keying means app writes and external Dropbox-synced edits are still picked up; write-through invalidation guarantees the writer never reads its own stale cache.

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs`
- Test: `tests/isolated/adapter/persistence/YamlMediaProgressMemory.readCache.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/adapter/persistence/YamlMediaProgressMemory.readCache.test.mjs`:

```javascript
// tests/isolated/adapter/persistence/YamlMediaProgressMemory.readCache.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock FileIO so we can count parses (loadYamlSafe) and control mtime (getStats).
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYamlSafe: vi.fn(() => ({ 'plex:1': { percent: 50, playhead: 10 } })),
  saveYaml: vi.fn(),
  deleteYaml: vi.fn(),
  listYamlFiles: vi.fn(() => []),
  dirExists: vi.fn(() => false),
  resolveYamlPath: vi.fn(() => '/fake/base/plex.yml'),
  getStats: vi.fn(() => ({ mtimeMs: 100 })),
}));

const FileIO = await import('#system/utils/FileIO.mjs');
const { MediaProgress } = await import('#domains/content/entities/MediaProgress.mjs');
const { YamlMediaProgressMemory } = await import(
  '#adapters/persistence/yaml/YamlMediaProgressMemory.mjs'
);

function makeMemory() {
  return new YamlMediaProgressMemory({ basePath: '/fake/base' });
}

describe('YamlMediaProgressMemory read cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FileIO.getStats.mockReturnValue({ mtimeMs: 100 });
    FileIO.loadYamlSafe.mockReturnValue({ 'plex:1': { percent: 50, playhead: 10 } });
  });

  it('parses the file once across repeated reads when mtime is unchanged', async () => {
    const memory = makeMemory();
    await memory.get('plex:1', 'plex');
    await memory.get('plex:1', 'plex');
    await memory.getAll('plex');
    expect(FileIO.loadYamlSafe).toHaveBeenCalledTimes(1);
  });

  it('re-parses when the file mtime changes', async () => {
    const memory = makeMemory();
    await memory.get('plex:1', 'plex'); // parse 1
    FileIO.getStats.mockReturnValue({ mtimeMs: 200 });
    await memory.get('plex:1', 'plex'); // parse 2
    expect(FileIO.loadYamlSafe).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cache on write so a writer never reads stale data', async () => {
    const memory = makeMemory();
    await memory.get('plex:1', 'plex'); // parse 1, cache populated
    await memory.set(
      new MediaProgress({ contentId: 'plex:1', playhead: 20, duration: 100 }),
      'plex'
    ); // invalidates
    await memory.get('plex:1', 'plex'); // parse 2
    expect(FileIO.loadYamlSafe).toHaveBeenCalledTimes(2);
  });

  it('caches per storage path independently', async () => {
    const memory = makeMemory();
    await memory.get('plex:1', 'plex');
    await memory.get('plex:1', 'scripture');
    expect(FileIO.loadYamlSafe).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/persistence/YamlMediaProgressMemory.readCache.test.mjs
```
Expected: FAIL. The first test fails on `expect(FileIO.loadYamlSafe).toHaveBeenCalledTimes(1)` (actual 3) — there is no cache yet, so every read parses.

- [ ] **Step 3: Import the path/stat helpers**

In `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs`, find:

```javascript
import {
  loadYamlSafe,
  saveYaml,
  deleteYaml,
  listYamlFiles,
  dirExists
} from '#system/utils/FileIO.mjs';
```

Replace with:

```javascript
import {
  loadYamlSafe,
  saveYaml,
  deleteYaml,
  listYamlFiles,
  dirExists,
  resolveYamlPath,
  getStats
} from '#system/utils/FileIO.mjs';
```

- [ ] **Step 4: Initialize the cache in the constructor**

Find:

```javascript
    this.basePath = config.basePath;
    this.mediaKeyResolver = config.mediaKeyResolver || null;
```

Replace with:

```javascript
    this.basePath = config.basePath;
    this.mediaKeyResolver = config.mediaKeyResolver || null;
    // mtime-keyed parse cache: storagePath -> { mtimeMs, data }.
    // loadYamlSafe (fs.readFileSync + yaml.load) is otherwise uncached, so hot
    // paths re-parsed the same file repeatedly. mtime keying picks up app writes
    // AND external (Dropbox-synced) edits; writes invalidate explicitly.
    this._readCache = new Map();
```

- [ ] **Step 5: Make `_readFile` cache by mtime**

Find:

```javascript
  _readFile(storagePath) {
    const basePath = this._getBasePath(storagePath);
    return loadYamlSafe(basePath) || {};
  }
```

Replace with:

```javascript
  _readFile(storagePath) {
    const basePath = this._getBasePath(storagePath);
    const resolvedPath = resolveYamlPath(basePath);
    if (!resolvedPath) {
      // No file on disk — drop any stale cache entry and return empty.
      this._readCache.delete(storagePath);
      return {};
    }
    const mtimeMs = getStats(resolvedPath)?.mtimeMs ?? 0;
    const cached = this._readCache.get(storagePath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.data;
    }
    const data = loadYamlSafe(basePath) || {};
    this._readCache.set(storagePath, { mtimeMs, data });
    return data;
  }
```

- [ ] **Step 6: Invalidate on write in `_writeFile`**

Find:

```javascript
  _writeFile(storagePath, data) {
    const basePath = this._getBasePath(storagePath);
    // saveYaml handles directory creation internally
    saveYaml(basePath, data);
  }
```

Replace with:

```javascript
  _writeFile(storagePath, data) {
    const basePath = this._getBasePath(storagePath);
    // saveYaml handles directory creation internally
    saveYaml(basePath, data);
    // Invalidate so the next read reloads (the in-process mtime may not advance
    // within the same millisecond as this write).
    this._readCache.delete(storagePath);
  }
```

- [ ] **Step 7: Invalidate on `clear` (it deletes the file directly, bypassing `_writeFile`)**

Find:

```javascript
    const fullPath = this._getBasePath(storagePath);
    const basePath = fullPath.replace(/\.ya?ml$/, '');
    deleteYaml(basePath);
```

Replace with:

```javascript
    const fullPath = this._getBasePath(storagePath);
    const basePath = fullPath.replace(/\.ya?ml$/, '');
    deleteYaml(basePath);
    this._readCache.delete(storagePath);
```

- [ ] **Step 8: Run the new cache test to verify it passes**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/persistence/YamlMediaProgressMemory.readCache.test.mjs
```
Expected: PASS (4 passing).

- [ ] **Step 9: Run the existing persistence specs to confirm no regression**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/persistence/YamlMediaProgressMemory.completedAt.test.mjs tests/isolated/adapter/persistence/YamlMediaProgressBookmark.test.mjs
```
Expected: PASS — round-trip set→get and bookmark behavior unaffected (these use a real temp dir, so they also prove mtime keying works against real files).

- [ ] **Step 10: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs tests/isolated/adapter/persistence/YamlMediaProgressMemory.readCache.test.mjs
git commit -m "perf(persistence): mtime-keyed read cache for media progress

_readFile did an uncached fs.readFileSync + yaml.load on every get/getAll.
Cache parsed data keyed by file mtime (so app writes and Dropbox-synced edits
are still seen), with write-through invalidation on _writeFile/clear.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Verify the live endpoint timing dropped

Confirms the real-world win on the running container. Per `CLAUDE.local.md`, building/deploying on this host is allowed — but **do not redeploy while the garage is in use** (active fitness session or a live Player video *playing*). Check the gate first.

**Files:** none (verification only)

- [ ] **Step 1: Capture the baseline timing (before deploy, old image still running)**

Run:
```bash
for i in 1 2 3; do curl -s -o /dev/null -w "list  total=%{time_total}s\n" "http://localhost:3111/api/v1/list/watchlist/scriptures2026"; done
for i in 1 2 3; do curl -s -o /dev/null -w "queue total=%{time_total}s\n" "http://localhost:3111/api/v1/queue/watchlist/scriptures2026"; done
```
Expected: `list` ≈ 4s, `queue` ≈ 8s (the current slow baseline).

- [ ] **Step 2: Confirm the deploy gate is clear**

Run:
```bash
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' \
  | sort | uniq -c
```
Expected: zero recurring render lines, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. If either gate is active, STOP and wait (or ask) before deploying.

- [ ] **Step 3: Build and deploy the new image**

Run:
```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```
Expected: build succeeds; container recreated and healthy.

- [ ] **Step 4: Re-time the endpoints (after deploy) and confirm the resolver still returns 152 playables**

Run:
```bash
sleep 5
for i in 1 2 3; do curl -s -o /dev/null -w "list  total=%{time_total}s\n" "http://localhost:3111/api/v1/list/watchlist/scriptures2026"; done
for i in 1 2 3; do curl -s -o /dev/null -w "queue total=%{time_total}s\n" "http://localhost:3111/api/v1/queue/watchlist/scriptures2026"; done
sudo docker logs --since 60s daylight-station 2>&1 | grep '"queue.resolve"' | grep scriptures2026 | tail -1
```
Expected: `list` and `queue` both drop dramatically (sub-second to ~1s warm), AND the last `queue.resolve` line still shows `"localId":"scriptures2026","count":152` — proving the queue contents are unchanged, only faster.

- [ ] **Step 5: Record the result**

Write the before/after numbers (e.g. `queue 8.1s → 0.4s`) into the PR/commit description or a short note. If `count` is no longer 152, STOP — the optimization changed behavior; return to Task 1 and debug the enrichment/skip logic.

---

## Self-Review

- **Spec coverage:** "to optimize" the slow Come Follow Me load. Task 1 removes the 447→1 per-namespace read (the dominant ~4.3s). Task 2 removes the underlying uncached-parse footgun for all callers. Task 3 proves the live win and that the queue is unchanged (152 items). Covered.
- **Placeholder scan:** No TBD/TODO/"add error handling"/"similar to" — every code and test step has complete content.
- **Type consistency:** `getCategoryProgress` returns `Map<assetId, MediaProgress>`; `getAll` returns `MediaProgress[]` keyed by `contentId`; lookup uses `assetId` (= `localId` parsed from the child's contentId, the same key `get()` used). Cache shape `{ mtimeMs, data }` is consistent across `_readFile`/`_writeFile`/`clear`, keyed by `storagePath` everywhere. `resolveYamlPath`/`getStats` are real FileIO exports (verified). `_calculatePriority(item, watchState|null)` matches the prior call signature.
