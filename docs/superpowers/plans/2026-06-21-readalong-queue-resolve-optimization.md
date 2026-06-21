# Readalong Queue-Resolve Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the ~4.5s warm queue-resolve for large readalong watchlists (e.g. "Come Follow Me" → ~447 children) by eliminating redundant per-child filesystem work in `ReadalongAdapter.getItem`.

**Architecture:** Two caches at the layers where the redundancy lives. (1) An mtime-keyed directory-listing cache inside `findFileByPrefix` (FileIO), so the same 921-entry scripture directory isn't `readdirSync`-ed twice per child × hundreds of children. (2) A per-collection memo for `ReadalongAdapter._loadManifest`, so the static manifest YAML isn't re-read per child. Both are invalidation-safe (mtime for the dir cache; manifests are static config read once per process).

**Tech Stack:** Node ES modules (`.mjs`), DDD adapter layer, Vitest (isolated specs), js-yaml, filesystem (ext4 data volume).

---

## Background / Root Cause (measured, not assumed)

After the media-progress bulk-load + cache fix landed, `GET /api/v1/list/watchlist/scriptures2026` (browse/enrich, no fan-out) dropped to ~0.07s, but `GET /api/v1/queue/watchlist/scriptures2026` (full resolve → 152 playables) stayed at **~4.5s warm and consistent across runs**. The consistency rules out one-time costs (`_durationCache` and the resolver cache persist on the singleton adapter).

The queue path differs from the list path by the per-child `resolvePlayables` → `getItem` fan-out. Each child `getItem` (in `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs`) does, **uncached, per child:**
- `_loadManifest(collection)` → reads + parses `data/content/readalong/scripture/manifest.yml` (1.4 KB) — the SAME file every child.
- `findYamlByPrefix(parentDir, verseId)` → `fs.readdirSync` of the chapter dir + filter/find.
- `findMediaFileByPrefix(...)` → a SECOND `fs.readdirSync` of the media dir + filter/find.
- one chapter YAML read (~6.5 KB) — genuinely distinct per child (irreducible for a fresh resolve).

Measured directory size: `data/content/readalong/scripture/ot/nirv` has **921 entries**. So the watchlist re-`readdirSync`-es a 921-entry directory ~2× per child × hundreds of children, and re-reads the same 1.4 KB manifest hundreds of times. That redundant work is the ~4.5s.

`findFileByPrefix` (`FileIO.mjs:485`) is also used by `LocalContentAdapter`, `SingalongAdapter`, `stream.mjs`, and `localContent.mjs`, so the dir-cache is a shared win.

**Out of scope (YAGNI):** the per-chapter ~6.5 KB read is distinct per child and irreducible for a fresh resolve (~447 × ~1ms ≈ 0.5s residual). After this plan the queue should land at roughly ~0.5–1s warm, not necessarily sub-second.

## File Structure

- **Modify:** `backend/src/0_system/utils/FileIO.mjs` — add a module-level mtime-keyed dir-listing cache; route `findFileByPrefix` through it.
- **Create:** `tests/isolated/adapter/system/FileIO.findFileByPrefix.test.mjs` — real-temp-dir tests for correctness + cache behavior.
- **Modify:** `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs` — memoize `_loadManifest` per collection.
- **Modify:** `tests/isolated/adapter/content/readalong/ReadalongAdapter.test.mjs` — add a memoization test.

## Test runner

Vitest "isolated" specs. The repo's `npm run test:isolated` routes them to Jest and crashes (project memory). Always run directly:

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs <path-to-spec>
```

---

### Task 1: mtime-keyed directory-listing cache in `findFileByPrefix`

**Files:**
- Modify: `backend/src/0_system/utils/FileIO.mjs` (`findFileByPrefix` at ~line 485; add cache near it)
- Test: `tests/isolated/adapter/system/FileIO.findFileByPrefix.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/adapter/system/FileIO.findFileByPrefix.test.mjs`:

```javascript
// tests/isolated/adapter/system/FileIO.findFileByPrefix.test.mjs
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs, { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findFileByPrefix } from '#system/utils/FileIO.mjs';

const tmps = [];
function makeDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'findprefix-'));
  tmps.push(dir);
  for (const f of files) writeFileSync(join(dir, f), 'x');
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tmps.length) rmSync(tmps.pop(), { recursive: true, force: true });
});

describe('findFileByPrefix', () => {
  it('finds a file by numeric prefix (leading zeros ignored)', () => {
    const dir = makeDir(['00007-genesis-7.yml', '00008-genesis-8.yml']);
    expect(findFileByPrefix(dir, '7', ['.yml'])).toBe(join(dir, '00007-genesis-7.yml'));
  });

  it('reads the directory only once across repeated lookups (cache hit)', () => {
    const dir = makeDir(['00001-a.yml', '00002-b.yml', '00001-a.mp3']);
    const spy = vi.spyOn(fs, 'readdirSync');
    findFileByPrefix(dir, '1', ['.yml']);
    findFileByPrefix(dir, '2', ['.yml']);
    findFileByPrefix(dir, '1', ['.mp3']); // different extension, same dir
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('re-reads when the directory mtime changes', () => {
    const dir = makeDir(['00001-a.yml']);
    findFileByPrefix(dir, '1', ['.yml']); // populate cache (before spy)
    const spy = vi.spyOn(fs, 'readdirSync');
    const future = new Date(Date.now() + 60000);
    utimesSync(dir, future, future); // bump dir mtime → invalidate
    findFileByPrefix(dir, '1', ['.yml']);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns null for a non-existent directory', () => {
    expect(findFileByPrefix('/no/such/dir/xyz', '1', ['.yml'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/system/FileIO.findFileByPrefix.test.mjs
```
Expected: FAIL on "reads the directory only once" — current `findFileByPrefix` calls `fs.readdirSync` on every call, so the spy is called 3 times, not 1. (The other three tests pass — they assert existing behavior.)

- [ ] **Step 3: Add the mtime-keyed dir cache helper**

In `backend/src/0_system/utils/FileIO.mjs`, find the current implementation:

```javascript
export function findFileByPrefix(dirPath, prefix, extensions) {
  if (!fs.existsSync(dirPath)) return null;

  // Normalize prefix: remove leading zeros for comparison
  const normalizedPrefix = String(prefix).replace(/^0+/, '') || '0';

  // Normalize extensions to array
  const extArray = Array.isArray(extensions) ? extensions : [extensions];

  const files = fs.readdirSync(dirPath).filter(f => {
    if (f.startsWith('._')) return false;
    return extArray.some(ext => f.endsWith(ext));
  });

  const match = files.find(file => {
    // Extract leading digits from filename
    const m = file.match(/^(\d+)/);
    if (!m) return false;
    // Remove leading zeros for comparison
    const fileNum = m[1].replace(/^0+/, '') || '0';
    return fileNum === normalizedPrefix;
  });

  return match ? path.join(dirPath, match) : null;
}
```

Replace it with:

```javascript
// mtime-keyed directory-listing cache: dirPath -> { mtimeMs, files }.
// findFileByPrefix is called once per item for both the YAML and the media
// lookup, so a large readalong watchlist re-readdir'd the same 921-entry
// scripture directory hundreds of times. Caching the raw listing (invalidated
// when the directory mtime changes — i.e. a file is added/removed) collapses
// that to one read per directory per change.
const _dirListCache = new Map();

function _readdirCached(dirPath) {
  const stat = getStats(dirPath);
  if (!stat || !stat.isDirectory()) return null;
  const cached = _dirListCache.get(dirPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.files;
  const files = fs.readdirSync(dirPath);
  _dirListCache.set(dirPath, { mtimeMs: stat.mtimeMs, files });
  return files;
}

export function findFileByPrefix(dirPath, prefix, extensions) {
  const all = _readdirCached(dirPath);
  if (!all) return null;

  // Normalize prefix: remove leading zeros for comparison
  const normalizedPrefix = String(prefix).replace(/^0+/, '') || '0';

  // Normalize extensions to array
  const extArray = Array.isArray(extensions) ? extensions : [extensions];

  const files = all.filter(f => {
    if (f.startsWith('._')) return false;
    return extArray.some(ext => f.endsWith(ext));
  });

  const match = files.find(file => {
    // Extract leading digits from filename
    const m = file.match(/^(\d+)/);
    if (!m) return false;
    // Remove leading zeros for comparison
    const fileNum = m[1].replace(/^0+/, '') || '0';
    return fileNum === normalizedPrefix;
  });

  return match ? path.join(dirPath, match) : null;
}
```

Note: `getStats` (`FileIO.mjs:449`) returns the `fs.Stats` object or null and is already defined in this file. The per-call `getStats` (one `statSync`) is far cheaper than `readdirSync` + filtering a 921-entry directory.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/system/FileIO.findFileByPrefix.test.mjs
```
Expected: PASS (4 passing).

- [ ] **Step 5: Run adapters that use `findFileByPrefix` to confirm no regression**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/content/readalong/ tests/isolated/adapter/content/local-content/ tests/isolated/adapter/content/singalong/
```
Expected: PASS (any pre-existing green specs stay green). If a directory has no specs, vitest reports "no test files" for it — that is fine; the readalong dir definitely has specs.

- [ ] **Step 6: Commit**

```bash
git add backend/src/0_system/utils/FileIO.mjs tests/isolated/adapter/system/FileIO.findFileByPrefix.test.mjs
git commit -m "perf(fileio): mtime-keyed dir-listing cache in findFileByPrefix

A readalong watchlist resolve re-readdir'd the same 921-entry scripture dir
twice per child (yaml + media prefix scans) across hundreds of children. Cache
the raw listing keyed by dir mtime; invalidates when files are added/removed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Memoize `ReadalongAdapter._loadManifest` per collection

**Files:**
- Modify: `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs` (`_loadManifest` at ~line 241)
- Test: `tests/isolated/adapter/content/readalong/ReadalongAdapter.test.mjs` (add one spec)

- [ ] **Step 1: Write the failing test**

In `tests/isolated/adapter/content/readalong/ReadalongAdapter.test.mjs`, add this block immediately after the existing `describe('source and prefixes', () => { ... })` block (the mocked `loadContainedYaml` and the `adapter` from the file's `beforeEach` are already in scope):

```javascript
  describe('_loadManifest memoization', () => {
    it('reads each collection manifest only once', () => {
      loadContainedYaml.mockReturnValue({ resolver: 'scripture' });
      const first = adapter._loadManifest('scripture');
      const second = adapter._loadManifest('scripture');
      expect(loadContainedYaml).toHaveBeenCalledTimes(1);
      expect(second).toBe(first); // same cached reference
    });

    it('caches per collection independently', () => {
      loadContainedYaml.mockReturnValue({ resolver: 'scripture' });
      adapter._loadManifest('scripture');
      adapter._loadManifest('poetry');
      expect(loadContainedYaml).toHaveBeenCalledTimes(2);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/content/readalong/ReadalongAdapter.test.mjs
```
Expected: FAIL on "reads each collection manifest only once" — current `_loadManifest` calls `loadContainedYaml` every time (2 calls, not 1) and returns a fresh object each call (`second` !== `first`).

- [ ] **Step 3: Add the per-collection memo**

In `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs`, find:

```javascript
  _loadManifest(collection) {
    try {
      return loadContainedYaml(path.join(this.dataPath, collection), 'manifest');
    } catch {
      return null;
    }
  }
```

Replace with:

```javascript
  _loadManifest(collection) {
    if (!this._manifestCache) this._manifestCache = new Map();
    if (this._manifestCache.has(collection)) return this._manifestCache.get(collection);
    let manifest = null;
    try {
      manifest = loadContainedYaml(path.join(this.dataPath, collection), 'manifest');
    } catch {
      manifest = null;
    }
    // Manifests are static config (resolver name, defaults, styles) — read once
    // per process. The same file was previously re-read for every child during a
    // watchlist resolve. A redeploy/restart picks up manifest edits.
    this._manifestCache.set(collection, manifest);
    return manifest;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/content/readalong/ReadalongAdapter.test.mjs
```
Expected: PASS (existing specs + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs tests/isolated/adapter/content/readalong/ReadalongAdapter.test.mjs
git commit -m "perf(readalong): memoize _loadManifest per collection

_loadManifest re-read + re-parsed the same collection manifest YAML for every
child during a watchlist resolve. Memoize per collection (static config).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Verify the live queue-resolve timing dropped

Confirms the real win on the running container, and that the queue contents are unchanged. Per `CLAUDE.local.md`, building/deploying on this host is allowed — but **do not redeploy while the garage is in use** (active fitness session) or **while a Player video / readalong is actively playing** on a screen. Check the gate first. This change is frontend-independent (backend only), so no kiosk reload is required for correctness — but the living-room Shield bundle is unaffected anyway.

**Files:** none (verification only)

- [ ] **Step 1: Capture the baseline (before deploy)**

Run:
```bash
for i in 1 2 3; do curl -s -o /dev/null -w "queue total=%{time_total}s\n" "http://localhost:3111/api/v1/queue/watchlist/scriptures2026"; done
```
Expected: ~4.5s each (current baseline).

- [ ] **Step 2: Confirm the deploy gate is clear**

Run:
```bash
sudo docker logs --since 30s daylight-station 2>&1 | grep -c '"event":"playback.render_fps"'
sudo docker logs --since 30s daylight-station 2>&1 | grep -c '"event":"play.log.updated"'
sudo docker logs --since 40s daylight-station 2>&1 | grep -oE '"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```
Expected: zero `playback.render_fps` (no video playing), zero `play.log.updated` (no readalong actively scrolling), `sessionActive:false`, `rosterSize:0`. If any gate is active, STOP and wait (or ask) before deploying.

- [ ] **Step 3: Build and deploy**

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
sleep 6
sudo docker exec daylight-station cat /build.txt
```
Expected: build succeeds; `/build.txt` shows the new commit hash.

- [ ] **Step 4: Re-time and confirm the queue is unchanged (still 152 items)**

Run:
```bash
sleep 3
# warm-up (fresh container → caches empty), then time
curl -s -o /dev/null "http://localhost:3111/api/v1/queue/watchlist/scriptures2026"
for i in 1 2 3; do curl -s -o /dev/null -w "queue total=%{time_total}s\n" "http://localhost:3111/api/v1/queue/watchlist/scriptures2026"; done
sudo docker logs --since 30s daylight-station 2>&1 | grep '"queue.resolve"' | grep scriptures2026 | tail -1 | grep -oE '"localId":"scriptures2026","count":[0-9]+'
```
Expected: queue drops from ~4.5s toward ~0.5–1s warm, AND the last `queue.resolve` still shows `count:152`.

- [ ] **Step 5: Record the result**

Write the before/after numbers (e.g. `queue 4.5s → 0.9s`) into the commit/PR description. If `count` is no longer 152, STOP — the optimization changed behavior; return to Task 1/2 and debug (most likely a stale dir-cache or manifest-memo returning the wrong file).

---

## Self-Review

- **Spec coverage:** "to fix" the residual ~4.5s readalong queue resolve. Task 1 removes the dominant redundant cost (re-`readdirSync` of a 921-entry dir hundreds of times). Task 2 removes the secondary redundancy (per-child manifest re-read). Task 3 proves the live win and that the queue is unchanged (152 items). The irreducible per-chapter read is explicitly scoped out. Covered.
- **Placeholder scan:** No TBD/TODO/"add error handling"/"similar to" — every code and test step has complete content.
- **Type consistency:** `_readdirCached` returns `string[] | null`; `findFileByPrefix` consumes it and returns `string | null` (unchanged public contract). Dir cache value shape `{ mtimeMs, files }` is consistent. `getStats` returns `fs.Stats | null` (verified, `FileIO.mjs:449`) and has `.isDirectory()`/`.mtimeMs`. `_manifestCache` is a `Map<collection, manifest|null>`, keyed and read consistently. The manifest-memo test relies on `loadContainedYaml` being a `vi.fn()` (it is, in the existing test's `vi.mock`) and returning a fresh object per call so `toBe` identity proves memoization.
