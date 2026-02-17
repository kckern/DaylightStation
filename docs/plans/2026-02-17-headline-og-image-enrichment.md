# Headline og:image Enrichment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enrich headline items with og:image from article pages during RSS harvest, so FeedCard displays hero images for items that lack RSS media tags.

**Architecture:** During harvest, items without images get their article page fetched via the existing `WebContentAdapter.extractReadableContent()`. The og:image URL is stored alongside other headline fields in YAML cache. A backfill CLI script enriches existing cached items.

**Tech Stack:** Node.js ES modules, WebContentAdapter (existing), YamlHeadlineCacheStore (existing), Jest for tests.

---

### Task 1: Add og:image enrichment to HeadlineService

The enrichment happens in `HeadlineService` (not the harvester) because:
- The harvester is a pure RSS adapter — it shouldn't make HTTP calls to article pages
- HeadlineService already orchestrates harvest + save + prune, so enrichment fits naturally between harvest and save
- HeadlineService already has access to both the harvester and can receive WebContentAdapter

**Files:**
- Modify: `backend/src/3_applications/feed/services/HeadlineService.mjs`
- Test: `tests/isolated/application/feed/HeadlineService.test.mjs`

**Step 1: Write the failing test**

Add to `tests/isolated/application/feed/HeadlineService.test.mjs`:

```javascript
describe('og:image enrichment', () => {
  let mockWebContent;

  beforeEach(() => {
    mockWebContent = {
      extractReadableContent: jest.fn().mockResolvedValue({
        title: 'Article',
        content: 'body',
        wordCount: 10,
        ogImage: 'https://example.com/og-image.jpg',
        ogDescription: 'desc',
      }),
    };
    // Rebuild service with webContentAdapter
    service = new HeadlineService({
      headlineStore: mockStore,
      harvester: mockHarvester,
      dataService: mockDataService,
      configService: mockConfigService,
      webContentAdapter: mockWebContent,
    });
  });

  test('enriches items missing image with og:image after harvest', async () => {
    mockHarvester.harvest.mockResolvedValue({
      source: 'cnn',
      label: 'CNN',
      lastHarvest: new Date().toISOString(),
      items: [
        { id: 'a1', title: 'No image', link: 'https://cnn.com/1', timestamp: new Date().toISOString() },
        { id: 'a2', title: 'Has image', link: 'https://cnn.com/2', timestamp: new Date().toISOString(), image: 'https://cnn.com/photo.jpg' },
      ],
    });
    // No existing cached data
    mockStore.loadSource.mockResolvedValue(null);

    await service.harvestAll('kckern');

    // Only the imageless item should trigger og:image fetch
    expect(mockWebContent.extractReadableContent).toHaveBeenCalledTimes(1);
    expect(mockWebContent.extractReadableContent).toHaveBeenCalledWith('https://cnn.com/1');

    // Check that saveSource was called with enriched item
    const savedData = mockStore.saveSource.mock.calls[0][1];
    expect(savedData.items[0].image).toBe('https://example.com/og-image.jpg');
    expect(savedData.items[1].image).toBe('https://cnn.com/photo.jpg');
  });

  test('skips enrichment for items already in cache', async () => {
    mockHarvester.harvest.mockResolvedValue({
      source: 'cnn',
      label: 'CNN',
      lastHarvest: new Date().toISOString(),
      items: [
        { id: 'a1', title: 'Old item', link: 'https://cnn.com/1', timestamp: new Date().toISOString() },
        { id: 'new1', title: 'New item', link: 'https://cnn.com/new', timestamp: new Date().toISOString() },
      ],
    });
    // a1 is already cached
    mockStore.loadSource.mockResolvedValue({
      source: 'cnn',
      label: 'CNN',
      items: [{ id: 'a1', title: 'Old item', link: 'https://cnn.com/1', image: null }],
    });

    await service.harvestAll('kckern');

    // Only the new item should be fetched
    expect(mockWebContent.extractReadableContent).toHaveBeenCalledTimes(1);
    expect(mockWebContent.extractReadableContent).toHaveBeenCalledWith('https://cnn.com/new');
  });

  test('leaves image null when og:image fetch fails', async () => {
    mockHarvester.harvest.mockResolvedValue({
      source: 'cnn',
      label: 'CNN',
      lastHarvest: new Date().toISOString(),
      items: [
        { id: 'a1', title: 'Broken page', link: 'https://cnn.com/broken', timestamp: new Date().toISOString() },
      ],
    });
    mockStore.loadSource.mockResolvedValue(null);
    mockWebContent.extractReadableContent.mockRejectedValue(new Error('Upstream returned 404'));

    await service.harvestAll('kckern');

    const savedData = mockStore.saveSource.mock.calls[0][1];
    expect(savedData.items[0].image).toBeUndefined();
  });

  test('leaves image null when og:image is absent from page', async () => {
    mockHarvester.harvest.mockResolvedValue({
      source: 'cnn',
      label: 'CNN',
      lastHarvest: new Date().toISOString(),
      items: [
        { id: 'a1', title: 'No og', link: 'https://cnn.com/no-og', timestamp: new Date().toISOString() },
      ],
    });
    mockStore.loadSource.mockResolvedValue(null);
    mockWebContent.extractReadableContent.mockResolvedValue({
      title: 'Page', content: '', wordCount: 0, ogImage: null, ogDescription: null,
    });

    await service.harvestAll('kckern');

    const savedData = mockStore.saveSource.mock.calls[0][1];
    expect(savedData.items[0].image).toBeUndefined();
  });

  test('works without webContentAdapter (backward compat)', async () => {
    // Rebuild without webContentAdapter
    service = new HeadlineService({
      headlineStore: mockStore,
      harvester: mockHarvester,
      dataService: mockDataService,
      configService: mockConfigService,
    });

    await service.harvestAll('kckern');

    expect(mockStore.saveSource).toHaveBeenCalled();
    // No crash, no enrichment attempted
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/HeadlineService.test.mjs --verbose`
Expected: FAIL — HeadlineService constructor doesn't accept `webContentAdapter`

**Step 3: Implement enrichment in HeadlineService**

In `backend/src/3_applications/feed/services/HeadlineService.mjs`:

1. Add `#webContentAdapter` private field
2. Accept `webContentAdapter` in constructor (optional — no breakage if omitted)
3. Add `async #enrichImages(items, existingIds)` method:
   - Filter to items where `!item.image && item.link && !existingIds.has(item.id)`
   - For each (concurrency-limited to 3), call `this.#webContentAdapter.extractReadableContent(item.link)`
   - On success, set `item.image = result.ogImage` if truthy
   - On failure, log warning and continue
4. Call `#enrichImages()` in `harvestAll()` between harvest and save
5. Call `#enrichImages()` in `harvestSource()` between harvest and save

Concurrency helper (inline in HeadlineService):

```javascript
async #enrichImages(items, existingIds) {
  if (!this.#webContentAdapter) return;
  const CONCURRENCY = 3;

  const candidates = items.filter(i => !i.image && i.link && !existingIds.has(i.id));
  if (candidates.length === 0) return;

  let active = 0;
  let idx = 0;

  await new Promise((resolve) => {
    const next = () => {
      while (active < CONCURRENCY && idx < candidates.length) {
        const item = candidates[idx++];
        active++;
        this.#webContentAdapter.extractReadableContent(item.link)
          .then(result => {
            if (result?.ogImage) item.image = result.ogImage;
          })
          .catch(err => {
            this.#logger.debug?.('headline.enrich.skip', { link: item.link, error: err.message });
          })
          .finally(() => {
            active--;
            if (idx >= candidates.length && active === 0) resolve();
            else next();
          });
      }
      if (candidates.length === 0) resolve();
    };
    next();
  });
}
```

In `harvestAll()`, between harvest and save (around line 97-98):

```javascript
const result = await this.#harvester.harvest(source);

// Enrich new imageless items with og:image
const cached = await this.#headlineStore.loadSource(source.id, username);
const existingIds = new Set((cached?.items || []).map(i => i.id));
await this.#enrichImages(result.items, existingIds);

await this.#headlineStore.saveSource(source.id, result, username);
```

Same pattern in `harvestSource()` around line 235-236.

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/feed/HeadlineService.test.mjs --verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/HeadlineService.mjs tests/isolated/application/feed/HeadlineService.test.mjs
git commit -m "feat(feed): enrich headline images with og:image during harvest"
```

---

### Task 2: Wire WebContentAdapter into HeadlineService in bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:947-984`

**Step 1: Write the failing test**

No unit test needed — this is dependency wiring. We verify by running the existing test suite.

Run: `npx jest tests/isolated/application/feed/HeadlineService.test.mjs --verbose`
Expected: PASS (from Task 1)

**Step 2: Modify bootstrap wiring**

In `backend/src/0_system/bootstrap.mjs`, function `createFeedServices()`:

1. Add `webContentAdapter` to the function signature (accept from caller or create inline)
2. Pass it to `HeadlineService` constructor

Since `WebContentAdapter` is currently created later in `app.mjs` (line 789), the cleanest approach is to accept it as an optional parameter in `createFeedServices()`:

At line 948, add to destructuring:
```javascript
const { dataService, configService, freshrssHost, webContentAdapter, logger = console } = config;
```

At line 968, add to HeadlineService constructor:
```javascript
const headlineService = new HeadlineService({
  headlineStore,
  harvester,
  dataService,
  configService,
  webContentAdapter,  // ← add this
  logger,
});
```

Then in `app.mjs` where `createFeedServices` is called, pass `webContentAdapter`. Since `WebContentAdapter` is created later in app.mjs, we need to either:
- Move its creation before `createFeedServices`, or
- Create a separate instance for harvest-time use

The simplest: create `WebContentAdapter` just before calling `createFeedServices` and pass it through. Look for the `createFeedServices` call in `app.mjs` and add the adapter.

**Step 3: Verify bootstrap wiring**

Run: `npx jest tests/isolated/ --verbose`
Expected: All existing tests PASS

**Step 4: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/app.mjs
git commit -m "wire: pass WebContentAdapter to HeadlineService for og:image enrichment"
```

---

### Task 3: Backfill CLI script

**Files:**
- Create: `cli/headline-image-backfill.cli.mjs`

**Step 1: Write the CLI script**

```javascript
#!/usr/bin/env node
/**
 * headline-image-backfill.cli.mjs
 *
 * One-time backfill: fetch og:image for cached headline items that have no image.
 *
 * Usage:
 *   node cli/headline-image-backfill.cli.mjs [--source <sourceId>] [--dry-run] [--username <user>]
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Bootstrap minimal config
const { createPathResolver } = await import(path.join(ROOT, 'backend/src/0_system/config/pathResolver.mjs'));
const { ConfigService } = await import(path.join(ROOT, 'backend/src/0_system/config/ConfigService.mjs'));
const { DataService } = await import(path.join(ROOT, 'backend/src/0_system/services/DataService.mjs'));
const { WebContentAdapter } = await import(path.join(ROOT, 'backend/src/1_adapters/feed/WebContentAdapter.mjs'));
const { YamlHeadlineCacheStore } = await import(path.join(ROOT, 'backend/src/1_adapters/persistence/yaml/YamlHeadlineCacheStore.mjs'));

// Parse args
const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--source' && args[i + 1]) { flags.source = args[++i]; }
  else if (args[i] === '--username' && args[i + 1]) { flags.username = args[++i]; }
  else if (args[i] === '--dry-run') { flags.dryRun = true; }
  else if (args[i] === '--help') { showHelp(); process.exit(0); }
  else positional.push(args[i]);
}

function showHelp() {
  console.log(`
headline-image-backfill — fetch og:image for cached headlines missing images

Usage:
  node cli/headline-image-backfill.cli.mjs [options]

Options:
  --source <id>     Only backfill a specific source
  --username <user> Target user (default: head of household)
  --dry-run         Preview without writing changes
  --help            Show this help
`);
}

async function main() {
  const pathResolver = createPathResolver();
  const configService = new ConfigService({ pathResolver });
  const dataService = new DataService({ configService });
  const webContent = new WebContentAdapter({});
  const store = new YamlHeadlineCacheStore({ dataService });

  const username = flags.username || configService.getHeadOfHousehold();
  console.log(`Backfilling og:image for user: ${username}`);

  const allSources = await store.loadAllSources(username);
  const sourceIds = flags.source
    ? [flags.source].filter(id => allSources[id])
    : Object.keys(allSources);

  if (flags.source && !allSources[flags.source]) {
    console.error(`Source "${flags.source}" not found in cache.`);
    process.exit(1);
  }

  const CONCURRENCY = 3;
  let total = 0;
  let enriched = 0;
  let failed = 0;

  for (const sourceId of sourceIds) {
    const data = allSources[sourceId];
    const candidates = (data.items || []).filter(i => !i.image && i.link);
    if (candidates.length === 0) continue;

    console.log(`\n[${sourceId}] ${candidates.length} items missing images (${data.items.length} total)`);
    let modified = false;

    // Process with concurrency limit
    let active = 0;
    let idx = 0;

    await new Promise((resolve) => {
      const next = () => {
        while (active < CONCURRENCY && idx < candidates.length) {
          const item = candidates[idx];
          const num = ++total;
          idx++;
          active++;
          webContent.extractReadableContent(item.link)
            .then(result => {
              if (result?.ogImage) {
                item.image = result.ogImage;
                modified = true;
                enriched++;
                console.log(`  [${num}] ✓ ${item.title.substring(0, 60)}`);
              } else {
                console.log(`  [${num}] ✗ no og:image — ${item.title.substring(0, 60)}`);
              }
            })
            .catch(err => {
              failed++;
              console.log(`  [${num}] ✗ ${err.message} — ${item.title.substring(0, 40)}`);
            })
            .finally(() => {
              active--;
              if (idx >= candidates.length && active === 0) resolve();
              else next();
            });
        }
        if (candidates.length === 0) resolve();
      };
      next();
    });

    if (modified && !flags.dryRun) {
      await store.saveSource(sourceId, data, username);
      console.log(`  → saved ${sourceId}`);
    } else if (modified && flags.dryRun) {
      console.log(`  → [dry-run] would save ${sourceId}`);
    }
  }

  console.log(`\nDone. ${enriched} enriched, ${failed} failed, ${total} checked.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

**Step 2: Test manually (dry run)**

Run: `node cli/headline-image-backfill.cli.mjs --dry-run`
Expected: Lists sources and items, shows `[dry-run]` messages, does not modify YAML files.

**Step 3: Run actual backfill**

Run: `node cli/headline-image-backfill.cli.mjs`
Expected: Enriches items, saves modified YAML files, prints summary.

**Step 4: Commit**

```bash
git add cli/headline-image-backfill.cli.mjs
git commit -m "feat(cli): add headline og:image backfill script"
```

---

### Task 4: Verify end-to-end

**Step 1: Run full test suite**

Run: `npx jest tests/isolated/ --verbose`
Expected: All tests PASS

**Step 2: Manual verification**

1. Start dev server: `npm run dev`
2. Trigger a harvest: `curl -X POST http://localhost:3112/api/v1/feed/headlines/harvest`
3. Check a headline YAML file for newly populated `image` fields
4. Load the scroll feed in browser — verify images appear on FeedCards that previously had none

**Step 3: Final commit (if any fixups needed)**
