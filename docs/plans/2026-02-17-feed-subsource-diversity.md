# Feed Subsource Diversity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent the same news outlet (e.g., CNN) from dominating the feed by enforcing subsource-level diversity across all source types.

**Architecture:** Three changes: (1) Expand SpacingEnforcer's subsource key extraction to work for all source types (currently Reddit-only), (2) Add a global `max_consecutive_subsource` spacing rule so subsource diversity works without per-source config, (3) Apply SpacingEnforcer to the filtered batch path which currently bypasses all spacing rules.

**Tech Stack:** Node.js ES modules, Vitest for unit tests

---

### Task 1: Expand `#getSubsourceKey` to all source types

**Files:**
- Modify: `backend/src/3_applications/feed/services/SpacingEnforcer.mjs:232-234`
- Test: `tests/isolated/application/feed/SpacingEnforcer.test.mjs`

Currently `#getSubsourceKey` only returns `item.meta?.subreddit`, which means subsource spacing/caps are Reddit-only. Each source type stores its outlet/channel identifier in a different meta field. Use a priority chain that covers all types.

**Step 1: Write the failing test**

Add to `tests/isolated/application/feed/SpacingEnforcer.test.mjs`:

```javascript
test('enforces subsource max_per_batch for headline sourceId', () => {
  const items = [
    item('headline', null, 'a'),
    item('headline', null, 'b'),
    item('headline', null, 'c'),
    item('headline', null, 'd'),
  ];
  // Simulate headline items with sourceId instead of subreddit
  items[0].meta = { sourceId: 'cnn', sourceName: 'CNN' };
  items[1].meta = { sourceId: 'cnn', sourceName: 'CNN' };
  items[2].meta = { sourceId: 'cnn', sourceName: 'CNN' };
  items[3].meta = { sourceId: 'nyt', sourceName: 'NYT' };

  const config = {
    spacing: { max_consecutive: 99 },
    tiers: {
      wire: {
        sources: {
          headline: { subsources: { max_per_batch: 2 } },
        },
      },
    },
  };
  const result = enforcer.enforce(items, config);
  const cnnCount = result.filter(i => i.meta?.sourceId === 'cnn').length;
  expect(cnnCount).toBe(2);
});

test('enforces subsource min_spacing for headline sourceId', () => {
  const items = [
    item('headline', null, 'a'),
    item('headline', null, 'b'),
    item('headline', null, 'c'),
    item('headline', null, 'd'),
  ];
  items[0].meta = { sourceId: 'cnn' };
  items[1].meta = { sourceId: 'nyt' };
  items[2].meta = { sourceId: 'cnn' };
  items[3].meta = { sourceId: 'bbc' };

  const config = {
    spacing: { max_consecutive: 99 },
    tiers: {
      wire: {
        sources: {
          headline: { subsources: { min_spacing: 3 } },
        },
      },
    },
  };
  const result = enforcer.enforce(items, config);
  const cnnIndices = result
    .map((it, idx) => it.meta?.sourceId === 'cnn' ? idx : -1)
    .filter(i => i >= 0);
  for (let i = 1; i < cnnIndices.length; i++) {
    expect(cnnIndices[i] - cnnIndices[i - 1]).toBeGreaterThanOrEqual(3);
  }
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/isolated/application/feed/SpacingEnforcer.test.mjs`
Expected: FAIL — `#getSubsourceKey` returns `null` for headline items (no `subreddit` field), so subsource rules are never applied.

**Step 3: Implement the fix**

In `backend/src/3_applications/feed/services/SpacingEnforcer.mjs`, replace:

```javascript
#getSubsourceKey(item) {
  return item.meta?.subreddit || null;
}
```

With:

```javascript
#getSubsourceKey(item) {
  const m = item.meta;
  if (!m) return null;
  return m.subreddit || m.sourceId || m.outlet || m.feedTitle || null;
}
```

This priority chain covers:
- **Reddit:** `meta.subreddit` (e.g., "science")
- **Headlines:** `meta.sourceId` (e.g., "cnn")
- **Google News:** `meta.outlet` (e.g., "CNN")
- **FreshRSS:** `meta.feedTitle` (e.g., "Ars Technica")

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/application/feed/SpacingEnforcer.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/SpacingEnforcer.mjs tests/isolated/application/feed/SpacingEnforcer.test.mjs
git commit -m "fix(feed): expand subsource key extraction to all source types"
```

---

### Task 2: Add global `max_consecutive_subsource` spacing rule

**Files:**
- Modify: `backend/src/3_applications/feed/services/SpacingEnforcer.mjs:18-42`
- Modify: `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs:41-43`
- Test: `tests/isolated/application/feed/SpacingEnforcer.test.mjs`

Currently subsource caps only activate when per-source config exists (e.g., `sources.headline.subsources.max_per_batch`). Users shouldn't need to configure every source — add a global `spacing.max_consecutive_subsource` that works like `max_consecutive` but at the subsource level.

**Step 1: Write the failing test**

Add to `tests/isolated/application/feed/SpacingEnforcer.test.mjs`:

```javascript
test('enforces max_consecutive_subsource globally', () => {
  const items = [
    item('headline', null, 'a'),
    item('headline', null, 'b'),
    item('headline', null, 'c'),
    item('headline', null, 'd'),
    item('headline', null, 'e'),
  ];
  items[0].meta = { sourceId: 'cnn' };
  items[1].meta = { sourceId: 'cnn' };
  items[2].meta = { sourceId: 'cnn' };
  items[3].meta = { sourceId: 'nyt' };
  items[4].meta = { sourceId: 'bbc' };

  const config = {
    spacing: { max_consecutive: 99, max_consecutive_subsource: 2 },
    tiers: {},
  };
  const result = enforcer.enforce(items, config);

  // Check no 3+ CNN items in a row
  for (let i = 2; i < result.length; i++) {
    const sub0 = result[i - 2].meta?.sourceId;
    const sub1 = result[i - 1].meta?.sourceId;
    const sub2 = result[i].meta?.sourceId;
    if (sub0 && sub0 === sub1 && sub1 === sub2) {
      throw new Error(`3 consecutive items from subsource "${sub0}" at indices ${i-2},${i-1},${i}`);
    }
  }
});

test('max_consecutive_subsource works across different source types', () => {
  const items = [
    item('reddit', 'science', 'a'),
    item('reddit', 'science', 'b'),
    item('reddit', 'science', 'c'),
    item('reddit', 'tech', 'd'),
    item('headline', null, 'e'),
  ];
  items[4].meta = { sourceId: 'nyt' };

  const config = {
    spacing: { max_consecutive: 99, max_consecutive_subsource: 2 },
    tiers: {},
  };
  const result = enforcer.enforce(items, config);

  // No 3+ consecutive from r/science
  let maxRun = 0, run = 0, lastSub = null;
  for (const it of result) {
    const sub = it.meta?.subreddit || it.meta?.sourceId;
    if (sub === lastSub) { run++; } else { run = 1; lastSub = sub; }
    maxRun = Math.max(maxRun, run);
  }
  expect(maxRun).toBeLessThanOrEqual(2);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/isolated/application/feed/SpacingEnforcer.test.mjs`
Expected: FAIL — no `max_consecutive_subsource` enforcement exists.

**Step 3: Add default to ScrollConfigLoader**

In `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs`, update the `DEFAULTS.spacing`:

```javascript
const DEFAULTS = Object.freeze({
  batch_size: 15,
  wire_decay_batches: 10,
  spacing: Object.freeze({
    max_consecutive: 1,
    max_consecutive_subsource: 2,
  }),
  tiers: TIER_DEFAULTS,
});
```

**Step 4: Implement `#enforceMaxConsecutiveSubsource` in SpacingEnforcer**

In `backend/src/3_applications/feed/services/SpacingEnforcer.mjs`, add a new step between steps 3 and 4 in `enforce()`:

```javascript
enforce(items, config) {
  if (!items.length) return [];

  const sources = this.#flattenSources(config);

  let result = [...items];

  // 1. Source-level max_per_batch
  result = this.#enforceMaxPerBatch(result, sources);

  // 2. Subsource-level max_per_batch
  result = this.#enforceSubsourceMaxPerBatch(result, sources);

  // 3. max_consecutive (no N+ same source in a row)
  result = this.#enforceMaxConsecutive(result, config.spacing?.max_consecutive ?? 1);

  // 3b. max_consecutive_subsource (no N+ same subsource in a row)
  const maxConsecSub = config.spacing?.max_consecutive_subsource ?? 0;
  if (maxConsecSub > 0) {
    result = this.#enforceMaxConsecutiveSubsource(result, maxConsecSub);
  }

  // 4. Source-level min_spacing
  result = this.#enforceMinSpacing(result, sources);

  // 5. Subsource-level min_spacing
  result = this.#enforceSubsourceMinSpacing(result, sources);

  return result;
}
```

Add the new private method (structurally identical to `#enforceMaxConsecutive` but uses subsource key):

```javascript
#enforceMaxConsecutiveSubsource(items, maxConsecutive) {
  if (maxConsecutive <= 0 || items.length <= 1) return items;

  const result = [items[0]];
  const deferred = [];

  for (let i = 1; i < items.length; i++) {
    const itemSub = this.#getSubsourceKey(items[i]);
    if (!itemSub) {
      result.push(items[i]);
      continue;
    }

    let consecutive = 0;
    for (let j = result.length - 1; j >= 0; j--) {
      if (this.#getSubsourceKey(result[j]) === itemSub) consecutive++;
      else break;
    }

    if (consecutive < maxConsecutive) {
      result.push(items[i]);
    } else {
      deferred.push(items[i]);
    }
  }

  for (const item of deferred) {
    const itemSub = this.#getSubsourceKey(item);
    let inserted = false;
    for (let pos = 0; pos <= result.length; pos++) {
      if (this.#canInsertSubsourceAt(result, pos, itemSub, maxConsecutive)) {
        result.splice(pos, 0, item);
        inserted = true;
        break;
      }
    }
    if (!inserted) result.push(item);
  }

  return result;
}

#canInsertSubsourceAt(arr, pos, subsourceKey, maxConsecutive) {
  let before = 0;
  for (let i = pos - 1; i >= 0; i--) {
    if (this.#getSubsourceKey(arr[i]) === subsourceKey) before++;
    else break;
  }
  let after = 0;
  for (let i = pos; i < arr.length; i++) {
    if (this.#getSubsourceKey(arr[i]) === subsourceKey) after++;
    else break;
  }
  return (before + after + 1) <= maxConsecutive;
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/application/feed/SpacingEnforcer.test.mjs`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/3_applications/feed/services/SpacingEnforcer.mjs backend/src/3_applications/feed/services/ScrollConfigLoader.mjs tests/isolated/application/feed/SpacingEnforcer.test.mjs
git commit -m "feat(feed): add global max_consecutive_subsource spacing rule"
```

---

### Task 3: Apply SpacingEnforcer to filtered batch paths

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs:104-116` (sources bypass path)
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs:220-261` (`#getFilteredBatch`)
- Test: `tests/isolated/application/feed/FeedAssemblyService.test.mjs` (if exists, otherwise create)

Both the `?sources=` filter path (line 104) and `#getFilteredBatch` (line 220) skip tier assembly and return items sorted only by timestamp. This means SpacingEnforcer never runs, allowing same-source/subsource clusters.

**Step 1: Wire SpacingEnforcer into FeedAssemblyService**

FeedAssemblyService currently doesn't hold a reference to SpacingEnforcer (it's inside TierAssemblyService). Add it as a constructor dependency.

In `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`, add:

```javascript
// In the class fields section (after #feedFilterResolver):
#spacingEnforcer;

// In the constructor:
constructor({
  feedPoolManager,
  scrollConfigLoader = null,
  tierAssemblyService = null,
  feedContentService = null,
  selectionTrackingStore = null,
  feedFilterResolver = null,
  spacingEnforcer = null,
  logger = console,
  sourceAdapters = null,
  // ... existing legacy params
}) {
  // ... existing assignments
  this.#spacingEnforcer = spacingEnforcer;
}
```

**Step 2: Apply spacing to the sources bypass path**

Replace the sources filter block (lines ~104-116) — add spacing after timestamp sort, before slice:

```javascript
if (sources && sources.length > 0) {
  let filtered = freshPool
    .filter(item => sources.includes(item.source))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  if (this.#spacingEnforcer) {
    filtered = this.#spacingEnforcer.enforce(filtered, scrollConfig);
  }
  const batch = filtered.slice(0, effectiveLimit);
  for (const item of batch) this.#cacheItem(item);
  this.#feedPoolManager.markSeen(username, batch.map(i => i.id));
  return {
    items: batch,
    hasMore: this.#feedPoolManager.hasMore(username),
    colors: ScrollConfigLoader.extractColors(scrollConfig),
  };
}
```

**Step 3: Apply spacing to `#getFilteredBatch`**

In `#getFilteredBatch`, add spacing after the sort and before the slice:

```javascript
filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
if (this.#spacingEnforcer) {
  filtered = this.#spacingEnforcer.enforce(filtered, scrollConfig);
}
const batch = filtered.slice(0, effectiveLimit);
```

**Step 4: Wire spacingEnforcer in bootstrap (app.mjs)**

In `backend/src/app.mjs`, pass `spacingEnforcer` to FeedAssemblyService constructor. Find where `feedAssemblyService` is created and add:

```javascript
const feedAssemblyService = new FeedAssemblyService({
  // ... existing params
  spacingEnforcer,
});
```

**Step 5: Run all feed tests**

Run: `npx vitest run tests/isolated/application/feed/`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs backend/src/app.mjs
git commit -m "fix(feed): apply spacing enforcer to filtered batch paths"
```

---

### Task 4: Update ScrollConfigLoader test for new default

**Files:**
- Modify: `tests/isolated/application/feed/ScrollConfigLoader.test.mjs`

**Step 1: Check if existing test asserts on spacing defaults**

Run: `npx vitest run tests/isolated/application/feed/ScrollConfigLoader.test.mjs`

If a test asserts `spacing` equals `{ max_consecutive: 1 }`, update it to include `max_consecutive_subsource: 2`.

**Step 2: Fix any assertion that breaks**

Update the expected value to:
```javascript
{ max_consecutive: 1, max_consecutive_subsource: 2 }
```

**Step 3: Run tests to verify pass**

Run: `npx vitest run tests/isolated/application/feed/ScrollConfigLoader.test.mjs`
Expected: PASS

**Step 4: Commit**

```bash
git add tests/isolated/application/feed/ScrollConfigLoader.test.mjs
git commit -m "test(feed): update ScrollConfigLoader test for subsource default"
```
