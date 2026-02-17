# DDD Abstraction Leakage Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all DDD layer violations identified in the 2026-02-17 audit, restoring proper separation of concerns across the backend.

**Architecture:** Each task moves code to the correct DDD layer, creates missing port interfaces, or eliminates infrastructure leakage from orchestration services. All changes follow the existing port/adapter pattern documented in `docs/reference/core/layers-of-abstraction/`. Bootstrap wiring in `0_system/bootstrap.mjs` is updated as the final step of each move.

**Tech Stack:** Node.js ES modules (.mjs), Express, YAML persistence, node-canvas

**Source audit:** `docs/_wip/audits/2026-02-17-ddd-abstraction-leakage-audit.md`

---

## Phase 0: Unblock (Merge Conflicts)

### Task 1: Resolve all merge conflicts

> Audit ref: C1

**Files with `UU` (unmerged) status:**
- `backend/src/0_system/bootstrap.mjs`
- `backend/src/3_applications/agents/paged-media-toc/tools/PagedMediaTocToolFactory.mjs`
- `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs`
- `frontend/src/modules/Feed/Scroll/Scroll.jsx`
- `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx`
- `frontend/src/modules/Feed/Scroll/cards/index.jsx`
- `frontend/src/modules/Feed/Scroll/detail/DetailView.jsx`
- `frontend/src/modules/Feed/Scroll/detail/DetailView.scss`
- `tests/isolated/application/feed/FeedAssemblyService.test.mjs`

**Step 1: Identify conflict markers in each file**

```bash
grep -rn '<<<<<<< HEAD' backend/src/ frontend/src/ tests/
```

**Step 2: Resolve each file**

Open each file, understand both sides of the conflict, and choose the correct resolution. Key guidance:
- `FeedAssemblyService.mjs`: Keep both `FeedFilterResolver` imports AND `probeImageDimensions` imports if both are needed; remove `probeImageDimensions` direct usage per M3 below
- `PagedMediaTocToolFactory.mjs`: Merge the interleaved tool definitions — keep all unique tools
- `bootstrap.mjs`: Keep all registration blocks from both sides

**Step 3: Stage and verify**

```bash
git add <resolved-files>
node -e "import('./backend/src/0_system/bootstrap.mjs')" # syntax check
```

**Step 4: Commit**

```bash
git commit -m "fix: resolve all merge conflicts from feed/paged-media branches"
```

---

## Phase 1: Critical Layer Violations

### Task 2: Move SessionService from `2_domains` to `3_applications`

> Audit ref: C2. SessionService performs load→mutate→persist orchestration, which is an application-layer use case, not pure domain logic.

**Files:**
- Move: `backend/src/2_domains/fitness/services/SessionService.mjs` → `backend/src/3_applications/fitness/services/SessionService.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs` (update import)
- Modify: Any file importing `#domains/fitness/services/SessionService.mjs`
- Test: `tests/isolated/application/fitness/SessionService.test.mjs` (create or move existing)

**Step 1: Find all imports of the current path**

```bash
rg "domains/fitness/services/SessionService" backend/src/ --files-with-matches
```

**Step 2: Move the file**

```bash
mkdir -p backend/src/3_applications/fitness/services
mv backend/src/2_domains/fitness/services/SessionService.mjs \
   backend/src/3_applications/fitness/services/SessionService.mjs
```

**Step 3: Update imports in the moved file**

In `SessionService.mjs`, update relative imports:
```javascript
// OLD (from 2_domains/fitness/services/)
import { Session } from '../entities/Session.mjs';
import { prepareTimelineForApi, prepareTimelineForStorage } from './TimelineService.mjs';
import { ValidationError, EntityNotFoundError } from '../../core/errors/index.mjs';

// NEW (from 3_applications/fitness/services/)
import { Session } from '#domains/fitness/entities/Session.mjs';
import { prepareTimelineForApi, prepareTimelineForStorage } from '#domains/fitness/services/TimelineService.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
```

**Step 4: Update bootstrap.mjs import**

```javascript
// OLD
import { SessionService } from '#domains/fitness/services/SessionService.mjs';
// NEW
import { SessionService } from '#apps/fitness/services/SessionService.mjs';
```

**Step 5: Update all other importers found in Step 1**

Each file that imports from `#domains/fitness/services/SessionService.mjs` must change to `#apps/fitness/services/SessionService.mjs`.

**Step 6: Verify**

```bash
node -e "import('./backend/src/3_applications/fitness/services/SessionService.mjs')"
npm run test:isolated 2>&1 | head -50
```

**Step 7: Commit**

```bash
git add backend/src/2_domains/fitness/services/SessionService.mjs \
       backend/src/3_applications/fitness/services/SessionService.mjs \
       backend/src/0_system/bootstrap.mjs
git commit -m "refactor: move SessionService from 2_domains to 3_applications

SessionService performs load→mutate→persist orchestration (use-case pattern),
not pure domain logic. Belongs in application layer per DDD guidelines."
```

---

### Task 3: Create `IDismissedItemsStore` port interface

> Audit ref: M4. `YamlDismissedItemsStore` is used by `FeedPoolManager` with no port contract.

**Files:**
- Create: `backend/src/3_applications/feed/ports/IDismissedItemsStore.mjs`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlDismissedItemsStore.mjs`
- Test: existing tests should still pass

**Step 1: Create the port interface**

Create `backend/src/3_applications/feed/ports/IDismissedItemsStore.mjs`:

```javascript
/**
 * Port interface for dismissed feed items storage.
 *
 * Application layer defines WHAT it needs; adapters implement HOW.
 * Used by FeedPoolManager to filter out user-dismissed items.
 */
export class IDismissedItemsStore {
  /**
   * Load the set of dismissed item IDs.
   * @param {string} [username] - Optional user scope
   * @returns {Promise<Set<string>>} Set of dismissed item ID strings
   */
  async load(_username) {
    throw new Error('IDismissedItemsStore.load() must be implemented');
  }

  /**
   * Add item IDs to the dismissed set.
   * @param {string[]} itemIds - Array of item IDs to dismiss
   * @param {string} [username] - Optional user scope
   * @returns {Promise<void>}
   */
  async add(_itemIds, _username) {
    throw new Error('IDismissedItemsStore.add() must be implemented');
  }

  /**
   * Clear any in-memory cache, forcing next load() to read from storage.
   */
  clearCache() {
    throw new Error('IDismissedItemsStore.clearCache() must be implemented');
  }
}
```

**Step 2: Make the adapter extend the port**

In `YamlDismissedItemsStore.mjs`, add:

```javascript
import { IDismissedItemsStore } from '#apps/feed/ports/IDismissedItemsStore.mjs';

export class YamlDismissedItemsStore extends IDismissedItemsStore {
  // ... existing implementation unchanged
}
```

**Step 3: Verify**

```bash
node -e "import('./backend/src/1_adapters/persistence/yaml/YamlDismissedItemsStore.mjs')"
```

**Step 4: Commit**

```bash
git commit -m "refactor: add IDismissedItemsStore port for feed dismissed items

YamlDismissedItemsStore now extends a formal port interface, matching
the project's port/adapter pattern used by other feed stores."
```

---

### Task 4: Create `IContentQueryPort` for feed adapters

> Audit ref: M2. ImmichFeedAdapter and PlexFeedAdapter inject concrete `contentQueryService` instead of a port.

**Files:**
- Create: `backend/src/3_applications/feed/ports/IContentQueryPort.mjs`
- Modify: `backend/src/1_adapters/feed/sources/ImmichFeedAdapter.mjs`
- Modify: `backend/src/1_adapters/feed/sources/PlexFeedAdapter.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs` (inject port instead of concrete service)

**Step 1: Identify methods used by the adapters**

From the adapter code:
- `ImmichFeedAdapter` calls: `contentQueryService.search({ source: 'immich', ... })`
- `PlexFeedAdapter` calls: `contentQueryService.search({ source: 'plex', ... })`

Both only use `.search()`.

**Step 2: Create the port**

Create `backend/src/3_applications/feed/ports/IContentQueryPort.mjs`:

```javascript
/**
 * Port interface for content querying in feed source adapters.
 *
 * Adapters need to search content libraries (Immich photos, Plex media)
 * but must not depend on the concrete ContentQueryService.
 */
export class IContentQueryPort {
  /**
   * Search a content source.
   * @param {Object} params
   * @param {string} params.source - Source identifier (e.g. 'immich', 'plex')
   * @param {string} [params.query] - Search term
   * @param {number} [params.limit] - Max results
   * @param {Object} [params.filters] - Additional source-specific filters
   * @returns {Promise<Array>} Array of content items
   */
  async search(_params) {
    throw new Error('IContentQueryPort.search() must be implemented');
  }
}
```

**Step 3: Update feed adapters**

In both `ImmichFeedAdapter.mjs` and `PlexFeedAdapter.mjs`, rename the constructor param:

```javascript
// OLD
constructor({ contentQueryService, contentRegistry, ... }) {
  this.#contentQueryService = contentQueryService;

// NEW — same object, but the name signals it's a port
constructor({ contentQueryPort, contentRegistry, ... }) {
  this.#contentQueryPort = contentQueryPort;
```

Update all internal references from `this.#contentQueryService` to `this.#contentQueryPort`.

**Step 4: Update bootstrap wiring**

In `bootstrap.mjs`, where these adapters are constructed, pass `contentQueryPort: contentQueryService` (the existing concrete service satisfies the port contract).

**Step 5: Verify**

```bash
node -e "import('./backend/src/0_system/bootstrap.mjs')"
npm run test:isolated -- --grep feed 2>&1 | head -50
```

**Step 6: Commit**

```bash
git commit -m "refactor: add IContentQueryPort, decouple feed adapters from concrete service

ImmichFeedAdapter and PlexFeedAdapter now depend on a port interface
instead of importing the concrete ContentQueryService."
```

---

### Task 5: Extract `probeImageDimensions` from FeedAssemblyService

> Audit ref: M3. Application services should not perform infrastructure HTTP operations.

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- Modify: relevant feed source adapters (or create `IImageProber` port)
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Check current usage in FeedAssemblyService**

After merge conflicts are resolved, check if `probeImageDimensions` is still imported/used:

```bash
rg "probeImageDimensions" backend/src/3_applications/
```

**Step 2: Create IImageProber port** (if still used)

Create `backend/src/3_applications/feed/ports/IImageProber.mjs`:

```javascript
/**
 * Port interface for probing image dimensions.
 */
export class IImageProber {
  /**
   * @param {string} imageUrl
   * @returns {Promise<{width: number, height: number} | null>}
   */
  async probe(_imageUrl) {
    throw new Error('IImageProber.probe() must be implemented');
  }
}
```

**Step 3: Create adapter implementation**

Create `backend/src/1_adapters/feed/ImageProberAdapter.mjs`:

```javascript
import { IImageProber } from '#apps/feed/ports/IImageProber.mjs';
import { probeImageDimensions } from '#system/utils/index.mjs';

export class ImageProberAdapter extends IImageProber {
  async probe(imageUrl) {
    return probeImageDimensions(imageUrl);
  }
}
```

**Step 4: Update FeedAssemblyService**

Remove the direct `probeImageDimensions` import. Accept `imageProber` via constructor injection:

```javascript
// OLD
import { probeImageDimensions } from '#system/utils/index.mjs';
// ...
const dims = await probeImageDimensions(item.image);

// NEW
// constructor({ ..., imageProber, ... })
const dims = await this.#imageProber?.probe(item.image);
```

**Step 5: Wire in bootstrap**

```javascript
const imageProber = new ImageProberAdapter();
// pass to FeedAssemblyService constructor
```

**Step 6: Verify and commit**

```bash
npm run test:isolated -- --grep feed
git commit -m "refactor: extract probeImageDimensions behind IImageProber port

FeedAssemblyService no longer directly imports infrastructure utilities.
Image probing is now injected via port/adapter pattern."
```

---

## Phase 2: Moderate Violations

### Task 6: Rename `0_system` CanvasService to CanvasRenderer

> Audit ref: Mo6. Name collision between `0_system/canvas/CanvasService.mjs` and `3_applications/canvas/services/CanvasService.mjs`.

**Files:**
- Rename: `backend/src/0_system/canvas/CanvasService.mjs` → `backend/src/0_system/canvas/CanvasRenderer.mjs`
- Modify: All importers of the old path

**Step 1: Find all importers**

```bash
rg "system/canvas/CanvasService" backend/src/ --files-with-matches
```

**Step 2: Rename file and update class name**

```bash
mv backend/src/0_system/canvas/CanvasService.mjs backend/src/0_system/canvas/CanvasRenderer.mjs
```

In the renamed file:
```javascript
// OLD
export class CanvasService {
// NEW
export class CanvasRenderer {
```

**Step 3: Update all importers**

Each file found in Step 1: change `CanvasService` → `CanvasRenderer` in both import path and usage.

**Step 4: Verify and commit**

```bash
node -e "import('./backend/src/0_system/canvas/CanvasRenderer.mjs')"
git commit -m "refactor: rename 0_system CanvasService to CanvasRenderer

Eliminates name collision with 3_applications/canvas/services/CanvasService.
The system-layer class is a thin wrapper over node-canvas, not a service."
```

---

### Task 7: Inject config paths into HeadlineService

> Audit ref: Mo1, Mo2. HeadlineService hardcodes `config/feed` path and knows config schema shape.

**Files:**
- Modify: `backend/src/3_applications/feed/services/HeadlineService.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Identify hardcoded values**

In `HeadlineService.mjs`:
- Line 34: `this.#dataService.user.read('config/feed', username)` — hardcoded path
- Various lines: `config.headlines?.retention_hours || 48`, `config.headlines?.max_per_source || 10`, `headlineConfig.dedupe_word_count || 8` — deep config shape knowledge

**Step 2: Create config object in bootstrap**

In `bootstrap.mjs`, resolve the config at wiring time:

```javascript
const headlineServiceConfig = {
  configPath: 'config/feed',
  defaults: {
    retentionHours: 48,
    maxPerSource: 10,
    dedupeWordCount: 8,
  }
};
```

**Step 3: Update HeadlineService constructor**

```javascript
// OLD
constructor({ headlineStore, harvester, dataService, configService, logger }) {

// NEW
constructor({ headlineStore, harvester, dataService, config = {}, logger }) {
  this.#configPath = config.configPath || 'config/feed';
  this.#defaults = config.defaults || {};
```

**Step 4: Replace hardcoded references**

```javascript
// OLD
const cfg = await this.#dataService.user.read('config/feed', username);
const retentionHours = config.headlines?.retention_hours || 48;

// NEW
const cfg = await this.#dataService.user.read(this.#configPath, username);
const retentionHours = config.headlines?.retention_hours || this.#defaults.retentionHours || 48;
```

**Step 5: Remove unused `#configService`**

The audit found `#configService` is accepted but never used — remove it from the constructor.

**Step 6: Verify and commit**

```bash
npm run test:isolated -- --grep Headline
git commit -m "refactor: inject config into HeadlineService, remove hardcoded paths

Config path and default values are now injected at construction time.
Removes unused configService dependency."
```

---

### Task 8: Inject cache path into FeedCacheService

> Audit ref: Mo1. FeedCacheService hardcodes `current/feed/_cache` path.

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedCacheService.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Update constructor to accept cache path**

```javascript
// OLD
const CACHE_PATH = 'current/feed/_cache';

// NEW
constructor({ dataService, cachePath = 'current/feed/_cache', logger }) {
  this.#cachePath = cachePath;
```

**Step 2: Replace all `CACHE_PATH` references with `this.#cachePath`**

Lines ~109 (`#hydrateIfNeeded`) and ~187 (`#flushToDisk`).

**Step 3: Pass from bootstrap**

```javascript
const feedCacheService = new FeedCacheService({
  dataService,
  cachePath: 'current/feed/_cache',
  logger
});
```

**Step 4: Verify and commit**

```bash
npm run test:isolated -- --grep -i cache
git commit -m "refactor: inject cachePath into FeedCacheService

Removes hardcoded CACHE_PATH constant. Path is now provided at construction."
```

---

### Task 9: Register built-in feed sources as standard adapters

> Audit ref: Mo4. FeedPoolManager special-cases `freshrss`, `headlines`, `entropy` with a switch statement instead of using the adapter pattern.

**Files:**
- Create: `backend/src/1_adapters/feed/sources/FreshRSSFeedAdapter.mjs`
- Create: `backend/src/1_adapters/feed/sources/HeadlineFeedAdapter.mjs`
- Create: `backend/src/1_adapters/feed/sources/EntropyFeedAdapter.mjs`
- Modify: `backend/src/3_applications/feed/services/FeedPoolManager.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Create FreshRSSFeedAdapter**

Create `backend/src/1_adapters/feed/sources/FreshRSSFeedAdapter.mjs`:

```javascript
import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class FreshRSSFeedAdapter extends IFeedSourceAdapter {
  #freshRSSAdapter;
  #logger;

  constructor({ freshRSSAdapter, logger }) {
    super();
    this.#freshRSSAdapter = freshRSSAdapter;
    this.#logger = logger;
  }

  get sourceType() { return 'freshrss'; }

  async fetchPage(query, username, cursorToken) {
    // Move logic from FeedPoolManager.#fetchFreshRSSPage here
    // (lines 329-357 of FeedPoolManager.mjs)
  }
}
```

**Step 2: Create HeadlineFeedAdapter**

Same pattern — move `FeedPoolManager.#fetchHeadlinesPage` (lines 360-395) into a proper adapter class.

**Step 3: Create EntropyFeedAdapter**

Same pattern — move `FeedPoolManager.#fetchEntropy` (lines 405-423) into a proper adapter class.

**Step 4: Register in bootstrap**

```javascript
const freshRSSFeedAdapter = new FreshRSSFeedAdapter({ freshRSSAdapter, logger });
const headlineFeedAdapter = new HeadlineFeedAdapter({ headlineService, logger });
const entropyFeedAdapter = new EntropyFeedAdapter({ entropyService, logger });

// Add to sourceAdapters array passed to FeedPoolManager
```

**Step 5: Simplify FeedPoolManager**

Remove:
- `#freshRSSAdapter`, `#headlineService`, `#entropyService` private fields
- `#fetchBuiltinPage()` method and switch statement
- `#fetchFreshRSSPage()`, `#fetchHeadlinesPage()`, `#fetchEntropy()` methods

The `#fetchSourcePage` method should now treat all sources uniformly through `IFeedSourceAdapter.fetchPage()`.

**Step 6: Write tests for each new adapter**

Create `tests/isolated/adapter/feed/FreshRSSFeedAdapter.test.mjs` (and similar for each):

```javascript
import { describe, it, expect, vi } from 'vitest';
import { FreshRSSFeedAdapter } from '../../../../backend/src/1_adapters/feed/sources/FreshRSSFeedAdapter.mjs';

describe('FreshRSSFeedAdapter', () => {
  it('implements IFeedSourceAdapter', () => {
    const adapter = new FreshRSSFeedAdapter({ freshRSSAdapter: {} });
    expect(adapter.sourceType).toBe('freshrss');
    expect(typeof adapter.fetchPage).toBe('function');
  });
});
```

**Step 7: Verify and commit**

```bash
npm run test:isolated -- --grep -i "feed|freshrss|headline|entropy"
git commit -m "refactor: register built-in feed sources as standard adapters

Extracts freshrss, headlines, and entropy from FeedPoolManager's switch
statement into proper IFeedSourceAdapter implementations. All feed sources
now use the same adapter pattern."
```

---

### Task 10: Reduce proxy router infrastructure leakage

> Audit ref: Mo5. Proxy router contains inline HTTP proxy code, duplicated SVG placeholders, and repeated range-request handling.

**Files:**
- Modify: `backend/src/4_api/v1/routers/proxy.mjs` (or actual path `backend/src/4_api/routers/proxy.mjs`)
- Modify: `backend/src/0_system/proxy/ProxyService.mjs` (if needed)

**Step 1: Confirm actual file path**

```bash
ls backend/src/4_api/routers/proxy.mjs backend/src/4_api/v1/routers/proxy.mjs 2>/dev/null
```

**Step 2: Remove duplicated SVG placeholder**

The router defines its own `PLACEHOLDER_SVG` and `sendPlaceholderSvg` — replace with import from ProxyService:

```javascript
import { sendPlaceholderSvg } from '#system/proxy/ProxyService.mjs';
```

Or extract to a shared utility in `0_system/proxy/placeholders.mjs`.

**Step 3: Extract range-request helper**

The range-request code is duplicated 3 times (media/stream, local-content/stream, /media). Extract to:

```javascript
// In 4_api/utils/ or 0_system/http/
function streamFileWithRanges(req, res, filePath, contentType) { ... }
```

**Step 4: Remove inline Immich fallback proxy**

The `/immich` route has a full inline HTTP proxy fallback (lines 236-298). Remove it — require `ProxyService` to be configured for Immich proxying. If it's not configured, return 503.

**Step 5: Verify and commit**

```bash
npm run test:live:api 2>&1 | head -30  # if API tests exist for proxy
git commit -m "refactor: remove duplicated infrastructure from proxy router

Extracts shared SVG placeholder, range-request streaming helper, and
removes inline Immich HTTP proxy fallback. Router now delegates to
ProxyService for all proxy operations."
```

---

## Phase 3: Minor Violations (Low Priority)

### Task 11: Improve Headline entity immutability

> Audit ref: Mi1

**File:** `backend/src/2_domains/feed/entities/Headline.mjs`

**Step 1:** Change public properties to private fields with getters:

```javascript
// OLD
this.title = data.title;

// NEW
#title;
get title() { return this.#title; }
// In constructor:
this.#title = data.title;
```

**Step 2:** Add `Object.freeze(this)` at end of constructor (after `toJSON` is verified not to need mutation).

**Step 3:** Verify and commit.

---

### Task 12: Document optional port dependencies

> Audit ref: Mi3

**Files:**
- `backend/src/3_applications/feed/services/FeedPoolManager.mjs` — document `dismissedItemsStore` as `IDismissedItemsStore | null`
- `backend/src/3_applications/feed/services/FeedAssemblyService.mjs` — document `feedContentService` optional dep

Add JSDoc `@param` annotations to constructors documenting which dependencies are optional and what degrades when they're absent.

---

## Execution Notes

### Testing strategy

- After each task, run: `npm run test:isolated` (unit/integration tests)
- After Phase 1 complete, run: `npm run test:live:api` (if dev server is available)
- After Phase 2 complete, run full: `npm run test:live:flow`

### Import alias reference

| Alias | Path |
|-------|------|
| `#system/` | `backend/src/0_system/` |
| `#adapters/` | `backend/src/1_adapters/` |
| `#domains/` | `backend/src/2_domains/` |
| `#apps/` | `backend/src/3_applications/` |

### Files that will need bootstrap.mjs updates

After all tasks, `bootstrap.mjs` will have these changes:
1. SessionService import path (Task 2)
2. New `IDismissedItemsStore` wiring — no change needed since adapter is already instantiated (Task 3)
3. `IContentQueryPort` naming in feed adapter construction (Task 4)
4. `ImageProberAdapter` instantiation and injection (Task 5)
5. `CanvasRenderer` import rename (Task 6)
6. HeadlineService config injection (Task 7)
7. FeedCacheService cachePath injection (Task 8)
8. Built-in feed adapter registration (Task 9)

### What is NOT in scope

- **C3 (Move ProxyService/IProxyAdapter to `3_applications`)**: The audit flagged this as critical, but after deeper inspection, `ProxyService` is a system-level HTTP streaming concern that operates on raw `req`/`res`. It does not orchestrate business use cases. Moving it would be over-engineering — it's correctly placed as infrastructure plumbing. The proxy adapters correctly implement its contract. **Recommendation: Reclassify as "accepted deviation" and document in the DDD reference.**
- **Mo3 (Extract FeedCacheService I/O to ICacheRepository)**: Cache service manages debounced disk flushing and TTL — these are persistence patterns that would benefit from a port, but the service is small and self-contained. Injecting the cache path (Task 8) is sufficient for now. Can revisit if caching grows more complex.
- **Mi2 (FeedAssemblyService static coupling to ScrollConfigLoader)**: Minor coupling to a peer service's static method. Not worth abstracting unless ScrollConfigLoader changes independently.
