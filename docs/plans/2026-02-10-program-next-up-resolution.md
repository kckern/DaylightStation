# Program "Next Up" Resolution Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix `ListAdapter.resolvePlayables()` so programs return ONE playable per slot (the "next up" item) instead of ALL playables from every child source.

**Architecture:** The program path in `resolvePlayables()` currently calls `adapter.resolvePlayables(input)` on each child and dumps all results (382 items for morning-program). The fix scopes program resolution to use the existing `_getNextPlayableFromChild()` method — already proven in the watchlist path — which picks the next unwatched item via media progress memory. Menus retain current "all items" behavior since they serve as full playlists.

**Tech Stack:** Node.js ES modules, Vitest, manual mock factories

---

## Context

### The Bug
`GET /api/v1/queue/program:morning-program` returns 382 items. The YAML defines 8 active slots. Each slot should resolve to 1 playable (the next unwatched episode/track), giving ~8 items total.

### Root Cause
`ListAdapter.resolvePlayables()` line 994 (non-watchlist path) calls `adapter.resolvePlayables(input)` which returns ALL playables from each child. For `plex:375839` (Crash Course Kids), this dumps every episode into the queue.

### The Fix
For `listType === 'programs'`, call `this._getNextPlayableFromChild(child, resolved)` instead. This method:
1. Calls `adapter.resolvePlayables(child.id)` to get all child items
2. If only 1 item, returns it directly
3. If multiple, uses `mediaProgressMemory` to find: in-progress (1-90%) > first unwatched > first item
4. Returns ONE item (or null if empty)

### Key Files
| File | Role |
|------|------|
| `backend/src/1_adapters/content/list/ListAdapter.mjs` | **Modify:** `resolvePlayables()` program path (lines 967-1001) |
| `backend/src/1_adapters/content/list/listConfigNormalizer.mjs` | **Read-only:** `extractContentId()` extracts content ID from normalized items |
| `backend/src/2_domains/content/services/ItemSelectionService.mjs` | **Read-only:** Has `program` strategy but NOT wired into this path yet (future work — day format incompatibility between ListAdapter and QueueService blocks ISS integration) |
| `tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs` | **Create:** Unit tests |

### Already Fixed (this session)
`resolvePlayables()` line 913 — added `list:` prefix stripping (same pattern as `getList()`) to fix double-prefix bug where `list:program:morning-program` was misinterpreted.

---

## Task 1: Write failing unit test for program "next up" resolution

**Files:**
- Create: `tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs`

**Step 1: Write the test file**

This test mocks the registry and child adapters to verify that program resolution returns one item per slot, not all items.

```javascript
// tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ListAdapter } from '#adapters/content/list/ListAdapter.mjs';

// Mock FileIO — ListAdapter uses these at module level
vi.mock('#system/utils/FileIO.mjs', () => ({
  dirExists: vi.fn(() => true),
  listEntries: vi.fn(() => []),
  fileExists: vi.fn(() => false),
  loadYaml: vi.fn(() => null)
}));

const { fileExists, loadYaml } = await import('#system/utils/FileIO.mjs');

// ── Helpers ──────────────────────────────────────────────────────

function createMockAdapter(source, playables = []) {
  return {
    source,
    prefixes: [],
    getCapabilities: () => ['playable'],
    resolvePlayables: vi.fn().mockResolvedValue(playables),
    getItem: vi.fn().mockResolvedValue(null),
    getStoragePath: vi.fn().mockReturnValue(source)
  };
}

function createMockRegistry(adapters = {}) {
  return {
    resolve: vi.fn((compoundId) => {
      const colonIdx = compoundId.indexOf(':');
      if (colonIdx === -1) return null;
      const source = compoundId.substring(0, colonIdx);
      const adapter = adapters[source];
      if (!adapter) return null;
      return { adapter, localId: compoundId.substring(colonIdx + 1) };
    }),
    get: vi.fn((source) => adapters[source] || null)
  };
}

function createPlayableItem(id, title) {
  return {
    id,
    source: id.split(':')[0],
    localId: id.split(':')[1],
    title,
    mediaType: 'video',
    mediaUrl: `/stream/${id}`,
    resumable: true,
    duration: 300
  };
}

// ── Program YAML fixture ─────────────────────────────────────────

// Simulates morning-program.yml: 3 slots with different source types
const PROGRAM_YAML = [
  { input: 'media:sfx/intro', label: 'Intro' },
  { input: 'plex:375839', label: 'Crash Course Kids' },
  { input: 'plex:99999', label: 'Another Show', active: false }
];

// ── Tests ────────────────────────────────────────────────────────

describe('ListAdapter.resolvePlayables (programs)', () => {
  let adapter;
  let mediaAdapter;
  let plexAdapter;
  let mockMemory;

  beforeEach(() => {
    vi.clearAllMocks();

    // Media adapter: returns 1 playable (single SFX file)
    mediaAdapter = createMockAdapter('files', [
      createPlayableItem('files:sfx/intro', 'Good Morning')
    ]);

    // Plex adapter: returns 5 episodes (simulates a TV show)
    plexAdapter = createMockAdapter('plex', [
      createPlayableItem('plex:ep1', 'Episode 1'),
      createPlayableItem('plex:ep2', 'Episode 2'),
      createPlayableItem('plex:ep3', 'Episode 3'),
      createPlayableItem('plex:ep4', 'Episode 4'),
      createPlayableItem('plex:ep5', 'Episode 5')
    ]);

    // Mock media progress memory (no watch history → all unwatched)
    mockMemory = {
      get: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      getAllFromAllLibraries: vi.fn().mockResolvedValue([])
    };

    const registry = createMockRegistry({ files: mediaAdapter, plex: plexAdapter, media: mediaAdapter });

    // Configure fileExists + loadYaml to serve the program fixture
    fileExists.mockImplementation((p) => p.includes('morning-program'));
    loadYaml.mockImplementation((p) => {
      if (p.includes('morning-program')) return PROGRAM_YAML;
      return null;
    });

    adapter = new ListAdapter({
      dataPath: '/mock/data',
      registry,
      mediaProgressMemory: mockMemory
    });
  });

  test('program resolves ONE item per slot, not all child playables', async () => {
    const result = await adapter.resolvePlayables('program:morning-program');

    // 3 YAML items, 1 is active:false → 2 active slots
    // Slot 1 (media:sfx/intro): 1 playable → returns it
    // Slot 2 (plex:375839): 5 episodes → returns FIRST unwatched (ep1)
    // Total: 2 items
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('files:sfx/intro');
    expect(result[1].id).toBe('plex:ep1');
  });

  test('program picks in-progress episode over unwatched', async () => {
    // Episode 3 is 45% watched (in-progress)
    mockMemory.get.mockImplementation((key) => {
      if (key === 'ep3') return Promise.resolve({ percent: 45, playhead: 135 });
      return Promise.resolve(null);
    });

    const result = await adapter.resolvePlayables('program:morning-program');

    // Slot 2 should pick ep3 (in-progress) instead of ep1 (unwatched)
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe('plex:ep3');
  });

  test('program skips slot when all episodes watched', async () => {
    // All plex episodes are 95% watched
    mockMemory.get.mockImplementation((key) => {
      if (key.startsWith('ep')) return Promise.resolve({ percent: 95, playhead: 285 });
      return Promise.resolve(null);
    });

    const result = await adapter.resolvePlayables('program:morning-program');

    // _getNextPlayableFromChild returns items[0] as fallback when all watched
    // So we still get 2 items (the fallback behavior)
    expect(result).toHaveLength(2);
  });

  test('menu still resolves ALL child playables (not next-up)', async () => {
    // Reconfigure for a menu instead of program
    fileExists.mockImplementation((p) => p.includes('test-menu'));
    loadYaml.mockImplementation((p) => {
      if (p.includes('test-menu')) return [
        { input: 'plex:375839', label: 'A Show' }
      ];
      return null;
    });

    const result = await adapter.resolvePlayables('menu:test-menu');

    // Menu should get ALL 5 episodes, not just 1
    expect(result).toHaveLength(5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs`

Expected: FAIL — first test expects 2 items but gets 6 (1 + 5 = all child playables dumped).

---

## Task 2: Implement the fix

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs:967-1001`

**Step 3: Modify the program path in `resolvePlayables()`**

Replace the non-watchlist section (lines 967-1001) with program-aware resolution:

```javascript
    // Non-watchlist: programs and menus
    const listData = this._loadList(listType, parsed.name);
    if (!listData) return [];

    const rawItems = Array.isArray(listData) ? listData : (listData.items || []);
    const items = rawItems.map(normalizeListItem);
    const playables = [];

    for (const item of items) {
      if (item.active === false) continue;

      // Apply schedule filtering for programs (if not overridden)
      if (applySchedule && listType === 'programs') {
        const shouldApply = item.applySchedule !== false;
        if (shouldApply && !this._matchesToday(item)) {
          continue;
        }
      }

      const input = extractContentId(item);
      if (!input) continue;
      if (!this.registry) continue;

      const resolved = this.registry.resolve(input);
      if (!resolved?.adapter) continue;

      // Programs: resolve ONE "next up" playable per slot (variety programming)
      // Menus: resolve ALL playables per slot (full playlist/queue)
      if (listType === 'programs') {
        const colonIdx = input.indexOf(':');
        const child = { id: input, source: colonIdx !== -1 ? input.substring(0, colonIdx) : 'files' };
        const nextItem = await this._getNextPlayableFromChild(child, resolved);
        if (nextItem) {
          playables.push(nextItem);
        }
      } else {
        if (resolved.adapter.resolvePlayables) {
          const childPlayables = await resolved.adapter.resolvePlayables(input);
          playables.push(...childPlayables);
        }
      }
    }

    return playables;
```

Key changes from current code:
- Added `if (listType === 'programs')` branch
- Programs use `_getNextPlayableFromChild(child, resolved)` → returns ONE item
- Menus use existing `adapter.resolvePlayables(input)` → returns ALL items
- Constructed minimal `child` object with `{ id, source }` for `_getNextPlayableFromChild`

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs`

Expected: All 4 tests PASS.

---

## Task 3: Run full test suite for regressions

**Step 5: Run all isolated tests**

Run: `npm run test:isolated`

Expected: No regressions. Existing tests should still pass.

**Step 6: Run integrated tests**

Run: `npm run test:integrated`

Expected: Queue API integration tests still pass.

---

## Task 4: Live API verification

**Step 7: Verify with live API**

Run: `curl -s http://localhost:3111/api/v1/queue/program:morning-program | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'count: {d[\"count\"]}'); [print(f'  {i[\"id\"]} — {i[\"title\"]}') for i in d['items']]"`

Expected: ~7-8 items (one per active program slot), NOT 382.

---

## Task 5: Commit

**Step 8: Commit the changes**

```bash
git add backend/src/1_adapters/content/list/ListAdapter.mjs tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs
git commit -m "fix: program queue resolves one item per slot instead of all episodes

Programs (morning-program, etc.) now use _getNextPlayableFromChild() to pick
the next unwatched item per slot, matching watchlist behavior. Previously
each slot dumped all child playables (e.g., every episode of a Plex show),
inflating a ~8-slot program to 382 items.

Also includes list: prefix stripping fix in resolvePlayables() (same pattern
as getList()) for double-prefixed IDs like list:program:morning-program.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Future Work (out of scope)

- **Wire ItemSelectionService into program path:** The `program` strategy in ISS has correct filters (`skipAfter`, `waitUntil`, `hold`, `days`) but day format is incompatible — ISS uses ISO weekday numbers [1-7] while ListAdapter uses string abbreviations ['M', 'T', 'W']. Requires format alignment before ISS can replace ad-hoc `_matchesToday()`.
- **Refactor `_getNextPlayableFromChild` to use ISS internally:** Could use `sequential` strategy (`pick: 'first'`, `filter: ['watched']`) instead of manual watch state loops.
