# Queue Progress Lookup Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix queue resolution so that readalong scripture items pick up their stored watch progress, causing watched items to sort to the end of the queue (e.g., Genesis 37 at 99% should not be item[0]).

**Architecture:** The root cause is a source/storagePath mismatch. Progress is written to `scriptures.yml` (via the play.log `type` field), but `QueueService.resolveQueue()` looks for progress under `{basePath}/readalong/` (via `item.source`). The fix adds a `storagePath` property to `PlayableItem`, populated by adapters that override storage paths. `resolveQueue()` then collects progress from storagePaths in addition to source directories.

**Tech Stack:** Node.js ES modules, YAML persistence, Express routers

---

## Bug Trace

```
WRITE PATH (play.log):
  Frontend sends type="scriptures" → storagePath = "scriptures" → writes to scriptures.yml

READ PATH (queue):
  ListAdapter → PlayableItem { source: "readalong" }
  QueueService.resolveQueue() → getAllFromAllLibraries("readalong")
  Looks in {basePath}/readalong/ directory → DOES NOT EXIST → empty progressMap
  All items appear unwatched → Genesis 37 stays at item[0]
```

## Key Files

| File | Role |
|------|------|
| `backend/src/2_domains/content/capabilities/Playable.mjs` | PlayableItem entity |
| `backend/src/2_domains/content/services/QueueService.mjs` | Queue resolution with progress lookup |
| `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs` | Builds PlayableItems for readalong content |
| `backend/src/1_adapters/content/singalong/SingalongAdapter.mjs` | Builds PlayableItems for singalong content (same pattern) |
| `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs` | Progress file I/O |

## Existing Tests

Check for existing test files before creating new ones:
```bash
find tests/ -name "*QueueService*" -o -name "*Playable*" -o -name "*queue*test*"
```

---

### Task 1: Add `storagePath` to PlayableItem

**Files:**
- Modify: `backend/src/2_domains/content/capabilities/Playable.mjs:34-54`

**Step 1: Write the failing test**

Create or extend test for PlayableItem to verify storagePath is stored:

```javascript
// In the appropriate test file
test('PlayableItem stores storagePath when provided', () => {
  const item = new PlayableItem({
    id: 'readalong:scripture/ot/nirv/1085',
    source: 'readalong',
    title: 'Genesis 37',
    mediaType: 'audio',
    mediaUrl: '/api/v1/stream/readalong/scripture/ot/nirv/1085',
    resumable: true,
    storagePath: 'scriptures'
  });
  assert.strictEqual(item.storagePath, 'scriptures');
});

test('PlayableItem storagePath defaults to null', () => {
  const item = new PlayableItem({
    id: 'readalong:scripture/ot/nirv/1085',
    source: 'readalong',
    title: 'Genesis 37',
    mediaType: 'audio',
    mediaUrl: '/api/v1/stream/readalong/scripture/ot/nirv/1085',
    resumable: true
  });
  assert.strictEqual(item.storagePath, null);
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `storagePath` is not a recognized property on PlayableItem.

**Step 3: Add storagePath to PlayableItem constructor**

In `backend/src/2_domains/content/capabilities/Playable.mjs`, add to constructor after line 53 (`this.active = ...`):

```javascript
this.storagePath = props.storagePath ?? null;
```

Also add to JSDoc `@param` block (after `@param {boolean} [props.active]`):

```javascript
 * @param {string} [props.storagePath] - Override storage path for progress lookup (e.g., 'scriptures' instead of source name)
```

**Step 4: Run test to verify it passes**

Expected: PASS

**Step 5: Preserve storagePath in _withResumePosition**

In `QueueService.mjs`, the `_withResumePosition` method (line 442) creates a new PlayableItem but does NOT copy `storagePath`. Add it:

```javascript
// In _withResumePosition, add to the PlayableItem constructor call:
storagePath: item.storagePath,
```

The full method should look like:

```javascript
_withResumePosition(item, state) {
  return new PlayableItem({
    id: item.id,
    source: item.source,
    localId: item.localId,
    title: item.title,
    mediaType: item.mediaType,
    mediaUrl: item.mediaUrl,
    duration: item.duration,
    resumable: item.resumable,
    resumePosition: state.playhead,
    playbackRate: item.playbackRate,
    thumbnail: item.thumbnail,
    description: item.description,
    metadata: item.metadata,
    storagePath: item.storagePath
  });
}
```

**Step 6: Commit**

```bash
git add backend/src/2_domains/content/capabilities/Playable.mjs backend/src/2_domains/content/services/QueueService.mjs
git commit -m "feat(content): add storagePath to PlayableItem for progress lookup override"
```

---

### Task 2: Set storagePath in ReadalongAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs:203-231`

**Step 1: Write the failing test**

```javascript
test('ReadalongAdapter sets storagePath on PlayableItem from storagePaths config', async () => {
  // Given adapter with storagePaths: { scripture: 'scriptures' }
  const item = await adapter.getItem('scripture/ot/nirv/1085');
  assert.strictEqual(item.storagePath, 'scriptures');
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — PlayableItem is built without storagePath.

**Step 3: Add storagePath to PlayableItem construction**

In `ReadalongAdapter.mjs`, in the `_buildPlayableItem` method (around line 203), add `storagePath` to the `new PlayableItem({...})` call:

```javascript
return new PlayableItem({
  id: canonicalId,
  source: 'readalong',
  title,
  subtitle,
  // ... existing fields ...
  storagePath: this.getStoragePath(`readalong:${collection}`),
  metadata: {
    // ... existing metadata ...
  }
});
```

The `getStoragePath('readalong:scripture')` call (line 64-71) will:
1. Strip the `readalong:` prefix → `'scripture'`
2. Look up `this.storagePaths['scripture']` → `'scriptures'`
3. Return `'scriptures'`

**Step 4: Run test to verify it passes**

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs
git commit -m "feat(readalong): set storagePath on PlayableItems for correct progress lookup"
```

---

### Task 3: Set storagePath in SingalongAdapter (same pattern)

**Files:**
- Modify: `backend/src/1_adapters/content/singalong/SingalongAdapter.mjs`

**Step 1: Find where SingalongAdapter builds PlayableItems**

```bash
grep -n 'new PlayableItem' backend/src/1_adapters/content/singalong/SingalongAdapter.mjs
```

**Step 2: Add storagePath to PlayableItem construction**

Same pattern as ReadalongAdapter — add `storagePath: this.getStoragePath(...)` to the PlayableItem constructor call.

**Step 3: Run any existing singalong tests**

**Step 4: Commit**

```bash
git add backend/src/1_adapters/content/singalong/SingalongAdapter.mjs
git commit -m "feat(singalong): set storagePath on PlayableItems for correct progress lookup"
```

---

### Task 4: Update QueueService.resolveQueue to use storagePaths

**Files:**
- Modify: `backend/src/2_domains/content/services/QueueService.mjs:399-436`

This is the core fix. `resolveQueue()` currently only collects progress by `item.source`. It needs to also collect progress from `item.storagePath`.

**Step 1: Write the failing test**

```javascript
test('resolveQueue finds progress via item storagePath (not just source)', async () => {
  // Given: items with source='readalong' but storagePath='scriptures'
  // And: progress stored under 'scriptures' (not 'readalong')
  const items = [
    new PlayableItem({
      id: 'readalong:scripture/ot/nirv/1085',
      source: 'readalong',
      title: 'Genesis 37',
      mediaType: 'audio',
      mediaUrl: '/stream/1085',
      duration: 302,
      resumable: true,
      storagePath: 'scriptures'
    }),
    new PlayableItem({
      id: 'readalong:scripture/ot/nirv/1121',
      source: 'readalong',
      title: 'Genesis 38',
      mediaType: 'audio',
      mediaUrl: '/stream/1121',
      duration: 271,
      resumable: true,
      storagePath: 'scriptures'
    })
  ];

  // Mock mediaProgressMemory that has Genesis 37 at 99% under 'scriptures'
  const mockMemory = {
    getAllFromAllLibraries: async (source) => [],  // nothing under 'readalong'
    getAll: async (storagePath) => {
      if (storagePath === 'scriptures') {
        return [new MediaProgress({
          contentId: 'readalong:scripture/ot/nirv/1085',
          playhead: 299, duration: 302, percent: 99,
          playCount: 1, lastPlayed: '2026-03-08'
        })];
      }
      return [];
    }
  };

  const qs = new QueueService({ mediaProgressMemory: mockMemory });
  const result = await qs.resolveQueue(items, 'list');

  // Genesis 38 should be first (Genesis 37 is watched at 99%)
  assert.strictEqual(result[0].title, 'Genesis 38');
  assert.strictEqual(result[1].title, 'Genesis 37');
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — Genesis 37 is still item[0] because resolveQueue never checks 'scriptures' storagePath.

**Step 3: Update resolveQueue to collect progress from storagePaths**

Replace lines 399-436 of `QueueService.mjs`:

```javascript
async resolveQueue(playables, source, { shuffle = false } = {}) {
  if (!this.mediaProgressMemory) {
    return shuffle ? QueueService.shuffleArray([...playables]) : playables;
  }

  // Collect unique sources from items — a "list" or "menu" queue contains
  // items from various actual sources (e.g., plex). Progress is stored under
  // the item's source, not the parent container's source.
  const itemSources = new Set(playables.map(p => p.source).filter(Boolean));
  if (!itemSources.size) itemSources.add(source);

  const progressMap = new Map();

  // Load progress from source directories (existing behavior)
  for (const src of itemSources) {
    const progress = await this.mediaProgressMemory.getAllFromAllLibraries(src);
    for (const p of progress) {
      progressMap.set(p.contentId, p);
    }
  }

  // Load progress from explicit storagePaths (new behavior).
  // Some adapters store progress under a different path than their source name
  // (e.g., readalong adapter stores scripture progress under 'scriptures', not 'readalong').
  const storagePaths = new Set(
    playables.map(p => p.storagePath).filter(sp => sp && !itemSources.has(sp))
  );
  for (const sp of storagePaths) {
    const progress = await this.mediaProgressMemory.getAll(sp);
    for (const p of progress) {
      if (!progressMap.has(p.contentId)) {
        progressMap.set(p.contentId, p);
      }
    }
  }

  // Enrich items with resume positions from media memory
  const enriched = playables.map(item => {
    const progress = progressMap.get(item.id);
    if (progress && item.resumable && progress.playhead) {
      return this._withResumePosition(item, progress);
    }
    return item;
  });

  // Partition by watch status: unwatched/in-progress first, watched last
  const { unwatched, watched } = QueueService.partitionByWatchStatus(
    enriched, progressMap, this.classifier
  );

  return [
    ...(shuffle ? QueueService.shuffleArray([...unwatched]) : unwatched),
    ...(shuffle ? QueueService.shuffleArray([...watched]) : watched)
  ];
}
```

Key changes:
1. After loading from source directories, collect unique `storagePath` values from items
2. Filter out storagePaths that match an already-loaded source (avoid double-loading)
3. For each storagePath, call `getAll(sp)` (reads flat file) instead of `getAllFromAllLibraries(sp)` (scans directory)
4. Only add to progressMap if not already present (source-directory progress takes precedence)

**Step 4: Run test to verify it passes**

Expected: PASS — Genesis 38 is now item[0].

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/services/QueueService.mjs
git commit -m "fix(queue): look up progress from item storagePaths, not just source directories"
```

---

### Task 5: Integration verification against live API

**Step 1: Rebuild and deploy (or restart dev server)**

If running against Docker prod:
```bash
# Build and deploy
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest ...
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

If running dev server:
```bash
# Restart dev server to pick up changes
pkill -f 'node backend/index.js' && node backend/index.js
```

**Step 2: Verify queue order via API**

```bash
curl -s http://localhost:3111/api/v1/queue/kidsscriptures2026 | python3 -c "
import json, sys
d = json.load(sys.stdin)
for i, item in enumerate(d['items'][:5]):
    rp = item.get('resumePosition')
    wp = item.get('watchProgress')
    print(f'{i}: {item[\"title\"]} (resume={rp}, progress={wp})')
"
```

**Expected output:**
```
0: Genesis 38 (resume=None, progress=None)
1: Genesis 39 (resume=None, progress=None)
...
```

Genesis 37 should appear near the end of the list (in the watched partition).

**Step 3: Commit (if not already committed)**

---

### Task 6: Update docs

**Files:**
- Modify: `docs/reference/content/content-progress.md` — add note about storagePath override
- Modify: `docs/reference/content/content-watchlists.md` — mention storagePath in architecture section if relevant

**Step 1: Add storagePath documentation to content-progress.md**

Under the "Persistence" section, add a subsection:

```markdown
### Storage Path Override

Some adapters store progress under a path different from their source name. For example, the readalong adapter has `source: 'readalong'` but stores scripture progress under the `'scriptures'` storage path (configured via `storagePaths` in `content-prefixes.yml`).

When building PlayableItems, adapters set `storagePath` on items that use non-default storage. `QueueService.resolveQueue()` uses this to look up progress from the correct location.
```

**Step 2: Commit**

```bash
git add docs/reference/content/content-progress.md
git commit -m "docs: document storagePath override for progress lookup"
```
