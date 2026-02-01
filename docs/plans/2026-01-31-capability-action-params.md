# Capability Action Params Implementation Plan

**Status:** ✅ Implemented 2026-01-31

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement URL action params (`display=`, `read=`) that map to content capabilities, enabling `/tv?display=canvas:religious/nativity.jpg` to show art from the Dropbox folder.

**Architecture:** Frontend parses URL action params → calls `/api/v1/content/item/{source}/{id}` → backend returns capability-typed item (DisplayableItem, ReadableItem) → frontend routes to appropriate component (ArtViewer, Reader).

**Tech Stack:** Express.js backend, React frontend, Playwright for runtime tests, Jest for unit tests.

---

## Task 1: Remove ViewableItem (Consolidate to DisplayableItem)

**Files:**
- Delete: `backend/src/2_domains/content/capabilities/Viewable.mjs`
- Modify: `backend/src/2_domains/content/index.mjs:19` - remove ViewableItem export
- Modify: `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs:192` - use DisplayableItem
- Delete: `tests/isolated/domain/content/capabilities/Viewable.test.mjs`
- Modify: `tests/isolated/domain/content/capabilities/Displayable.test.mjs` - add migrated tests

**Step 1: Update ImmichAdapter import and usage**

In `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs`, change:

```javascript
// Old
import { ViewableItem } from '#domains/content/capabilities/Viewable.mjs';
// ...
return new ViewableItem({

// New
import { DisplayableItem } from '#domains/content/capabilities/Displayable.mjs';
// ...
return new DisplayableItem({
```

**Step 2: Update domain index exports**

In `backend/src/2_domains/content/index.mjs`, remove line 19:

```javascript
// Remove this line:
export { ViewableItem } from './capabilities/Viewable.mjs';
```

**Step 3: Delete ViewableItem files**

```bash
rm backend/src/2_domains/content/capabilities/Viewable.mjs
rm tests/isolated/domain/content/capabilities/Viewable.test.mjs
```

**Step 4: Run tests to verify no breakage**

```bash
npm test -- --testPathPattern="Displayable|ImmichAdapter" --passWithNoTests
```

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(domain): consolidate ViewableItem into DisplayableItem"
```

---

## Task 2: Add resolveDisplayables() to FilesystemCanvasAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs`
- Modify: `tests/isolated/adapter/content/canvas/FilesystemCanvasAdapter.test.mjs`

**Step 1: Write the failing test**

Add to `tests/isolated/adapter/content/canvas/FilesystemCanvasAdapter.test.mjs`:

```javascript
describe('resolveDisplayables', () => {
  it('returns all images in a category folder', async () => {
    const mockFs = {
      existsSync: jest.fn().mockReturnValue(true),
      readdirSync: jest.fn()
        .mockReturnValueOnce(['religious']) // categories
        .mockReturnValueOnce(['nativity.jpg', 'sheep.jpg']), // files in religious
      statSync: jest.fn().mockReturnValue({ isDirectory: () => true }),
    };

    const adapter = new FilesystemCanvasAdapter(
      { basePath: '/media/art' },
      { fs: mockFs }
    );

    const items = await adapter.resolveDisplayables('religious');

    expect(items).toHaveLength(2);
    expect(items[0]).toBeInstanceOf(DisplayableItem);
    expect(items[0].id).toBe('canvas:religious/nativity.jpg');
  });

  it('returns single item when given full path', async () => {
    const mockFs = {
      existsSync: jest.fn().mockReturnValue(true),
      readdirSync: jest.fn().mockReturnValue(['nativity.jpg']),
      statSync: jest.fn().mockReturnValue({ isDirectory: () => false }),
    };

    const adapter = new FilesystemCanvasAdapter(
      { basePath: '/media/art' },
      { fs: mockFs }
    );

    const items = await adapter.resolveDisplayables('religious/nativity.jpg');

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('canvas:religious/nativity.jpg');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="FilesystemCanvasAdapter" -t "resolveDisplayables"
```

Expected: FAIL - `resolveDisplayables is not a function`

**Step 3: Implement resolveDisplayables**

Add to `backend/src/1_adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs`:

```javascript
/**
 * Resolve to displayable items (for slideshows, galleries)
 * @param {string} id - Category name or full path
 * @returns {Promise<DisplayableItem[]>}
 */
async resolveDisplayables(id) {
  const localPath = id.replace(/^canvas:/, '');
  const fullPath = `${this.#basePath}/${localPath}`;

  // Check if it's a directory (category) or file
  if (this.#fs.existsSync(fullPath) && this.#fs.statSync(fullPath).isDirectory()) {
    // It's a category folder - return all images
    return this.list({ categories: [localPath] });
  }

  // It's a single file
  const item = await this.getItem(`canvas:${localPath}`);
  return item ? [item] : [];
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- --testPathPattern="FilesystemCanvasAdapter" -t "resolveDisplayables"
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs tests/isolated/adapter/content/canvas/FilesystemCanvasAdapter.test.mjs
git commit -m "feat(canvas): add resolveDisplayables() to FilesystemCanvasAdapter"
```

---

## Task 3: Add display= mapping to TVApp.jsx

**Files:**
- Modify: `frontend/src/Apps/TVApp.jsx:109-131`

**Step 1: Add display and read to mappings**

In `frontend/src/Apps/TVApp.jsx`, update the `mappings` object (around line 109):

```javascript
// Source mappings - first match wins
const mappings = {
  // Queue actions (all playables)
  playlist:  (value) => ({ queue: { [findKey(value)]: value, ...config } }),
  queue:     (value) => ({ queue: { [findKey(value)]: value, ...config } }),

  // Play actions (single / next up)
  play:      (value) => ({ play:  { [findKey(value)]: value, ...config } }),
  random:    (value) => ({ play:  { [findKey(value)]: value, random: true, ...config } }),

  // Display actions (static images)
  display:   (value) => ({ display: { id: value, ...config } }),

  // Read actions (ebooks, articles)
  read:      (value) => ({ read: { id: value, ...config } }),

  // Source-specific play
  plex:      (value) => ({ play: { plex: value, ...config } }),
  // ... rest unchanged
```

**Step 2: Update TVAppContent to handle display type**

In the `useEffect` for autoplay handling (around line 31), add display case:

```javascript
// Handle autoplay on mount
useEffect(() => {
  if (!autoplayed && autoplay) {
    if (autoplay.queue || autoplay.play) {
      push({ type: 'player', props: autoplay });
    } else if (autoplay.display) {
      push({ type: 'display', props: autoplay });
    } else if (autoplay.read) {
      push({ type: 'reader', props: autoplay });
    } else if (autoplay.list?.plex) {
      // Plex list → use plex-menu router
      push({ type: 'plex-menu', props: autoplay });
    } else if (autoplay.list) {
      // Non-plex list (folder, etc.)
      push({ type: 'menu', props: autoplay });
    } else if (autoplay.open) {
      push({ type: 'app', props: autoplay });
    }
    setAutoplayed(true);
    logger.info('tvapp-autoplay', { keys: Object.keys(autoplay || {}) });
  }
}, [autoplay, autoplayed, push, logger]);
```

**Step 3: Commit**

```bash
git add frontend/src/Apps/TVApp.jsx
git commit -m "feat(frontend): add display= and read= URL action params"
```

---

## Task 4: Add display type handler to MenuStack.jsx

**Files:**
- Modify: `frontend/src/modules/Menu/MenuStack.jsx`

**Step 1: Add lazy import for ArtViewer**

At top of file (around line 10):

```javascript
const ArtViewer = lazy(() => import('../AppContainer/Apps/Art/Art').then(m => ({ default: m.default })));
```

**Step 2: Add display case to switch statement**

In the switch statement (around line 106), add before `default`:

```javascript
case 'display':
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ArtViewer item={props.display} onClose={clear} />
    </Suspense>
  );

case 'reader':
  // TODO: Implement reader component
  return (
    <div className="menu-stack-placeholder">
      Reader not yet implemented. ID: {props.read?.id}
    </div>
  );
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Menu/MenuStack.jsx
git commit -m "feat(frontend): add display and reader type handlers to MenuStack"
```

---

## Task 5: Update ArtApp to accept item prop (not just deviceId)

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/Art/Art.jsx`

**Step 1: Update component to handle both modes**

```javascript
export default function ArtApp({ deviceId, item, onClose }) {
  const [current, setCurrent] = useState(item || null);
  const [next, setNext] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [error, setError] = useState(null);

  // Fetch from API if no item provided (deviceId mode)
  const fetchCurrent = useCallback(async () => {
    if (item) return; // Skip fetch if item provided directly

    try {
      const response = await DaylightAPI(`/canvas/current?deviceId=${deviceId}`);
      if (response.ok) {
        const data = await response.json();
        if (current && data.id !== current.id) {
          setNext(data);
          setTransitioning(true);
          setTimeout(() => {
            setCurrent(data);
            setNext(null);
            setTransitioning(false);
          }, 1000);
        } else if (!current) {
          setCurrent(data);
        }
      }
    } catch (err) {
      setError(err.message);
    }
  }, [deviceId, current, item]);

  // Fetch item by ID if display.id provided
  useEffect(() => {
    if (item?.id && !current) {
      const fetchItem = async () => {
        try {
          const [source, ...rest] = item.id.split(':');
          const localId = rest.join(':');
          const data = await DaylightAPI(`api/v1/content/item/${source}/${localId}`);
          setCurrent(data);
        } catch (err) {
          setError(err.message);
        }
      };
      fetchItem();
    }
  }, [item, current]);

  // ... rest of component unchanged, but add onClose handling

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/AppContainer/Apps/Art/Art.jsx
git commit -m "feat(art): support direct item prop and onClose handler"
```

---

## Task 6: Add image proxy endpoint for canvas

**Files:**
- Modify: `backend/src/4_api/v1/routers/canvas.mjs`

**Step 1: Add image proxy route**

Add to `backend/src/4_api/v1/routers/canvas.mjs`:

```javascript
/**
 * GET /image/* - Serve canvas image
 */
router.get('/image/*', async (req, res, next) => {
  try {
    const imagePath = req.params[0];
    const householdId = req.householdId;

    // Get base path from config
    const config = req.app.get('canvasConfig') || {};
    const basePath = config.basePath;

    if (!basePath) {
      return res.status(503).json({ error: 'Canvas not configured' });
    }

    const fullPath = `${basePath}/${imagePath}`;

    // Security: ensure path is within basePath
    const resolvedPath = require('path').resolve(fullPath);
    if (!resolvedPath.startsWith(require('path').resolve(basePath))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.sendFile(resolvedPath);
  } catch (err) {
    next(err);
  }
});
```

**Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/canvas.mjs
git commit -m "feat(api): add canvas image proxy endpoint"
```

---

## Task 7: Register canvas adapter in bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (around line 454)

**Step 1: Update canvas config to use Dropbox path**

Ensure the canvas filesystem adapter is configured with the correct path. In bootstrap or config:

```javascript
// Register canvas-filesystem adapter
const canvasBasePath = config.canvas?.filesystem?.basePath
  || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/img/art';

if (canvasBasePath) {
  const canvasAdapter = new FilesystemCanvasAdapter({
    basePath: canvasBasePath,
    proxyPath: '/api/v1/canvas/image'
  });
  registry.register(canvasAdapter);
}
```

**Step 2: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(bootstrap): configure canvas adapter with Dropbox path"
```

---

## Task 8: Write Playwright runtime test

**Files:**
- Create: `tests/live/flow/canvas/canvas-art-display.runtime.test.mjs`

**Step 1: Write the test**

```javascript
/**
 * Canvas Art Display Test
 *
 * Verifies:
 * 1. Content API returns DisplayableItem for canvas source
 * 2. TV app displays art via ?display=canvas:religious/nativity.jpg
 * 3. Image loads from Dropbox path via proxy
 *
 * Prerequisites:
 * - Backend running at BACKEND_URL
 * - Canvas adapter configured with art in religious/ folder
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

let sharedPage;
let sharedContext;
let discoveredArtId;

test.describe.configure({ mode: 'serial' });

test.describe('Canvas Art Display', () => {

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    sharedPage = await sharedContext.newPage();

    sharedPage.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`❌ Browser console error: ${msg.text()}`);
      }
    });
  });

  test.afterAll(async () => {
    if (sharedPage) await sharedPage.close();
    if (sharedContext) await sharedContext.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Content API returns canvas items
  // ═══════════════════════════════════════════════════════════════════════════
  test('Content API returns canvas DisplayableItem', async ({ request }) => {
    console.log(`\n🔍 Fetching canvas item via ${BASE_URL}/api/v1/content/item/canvas/religious/nativity.jpg`);

    const response = await request.get(`${BASE_URL}/api/v1/content/item/canvas/religious/nativity.jpg`);

    if (response.status() === 404) {
      console.log('⚠️  Canvas adapter not configured or image not found');
      test.skip(true, 'Canvas not configured');
      return;
    }

    expect(response.ok()).toBe(true);
    const item = await response.json();

    console.log(`✅ Got item: "${item.title}"`);
    console.log(`   ID: ${item.id}`);
    console.log(`   Category: ${item.category}`);
    console.log(`   ImageUrl: ${item.imageUrl}`);

    expect(item.id).toBe('canvas:religious/nativity.jpg');
    expect(item.imageUrl).toContain('/api/v1/canvas/image/');

    discoveredArtId = item.id;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: TV app displays art via display= param
  // ═══════════════════════════════════════════════════════════════════════════
  test('TV app displays art via display= param', async () => {
    if (!discoveredArtId) {
      test.skip(true, 'No art discovered in previous test');
      return;
    }

    const displayUrl = `${BASE_URL}/tv?display=${discoveredArtId}`;
    console.log(`\n🖼️  Opening TV app: ${displayUrl}`);

    await sharedPage.goto(displayUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for art component to mount
    await sharedPage.waitForTimeout(3000);

    // Check for art-app class
    const artApp = await sharedPage.locator('.art-app').count();
    console.log(`\n🎨 Art app elements found: ${artApp}`);

    expect(artApp).toBeGreaterThan(0);

    // Check for image element
    const img = sharedPage.locator('.art-app img').first();
    const imgSrc = await img.getAttribute('src');
    console.log(`   Image src: ${imgSrc}`);

    expect(imgSrc).toContain('/api/v1/canvas/image/');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Image loads successfully
  // ═══════════════════════════════════════════════════════════════════════════
  test('Image loads from proxy', async () => {
    if (!discoveredArtId) {
      test.skip(true, 'No art discovered');
      return;
    }

    const img = sharedPage.locator('.art-app img').first();

    // Wait for image to load
    await sharedPage.waitForTimeout(2000);

    const naturalWidth = await img.evaluate(el => el.naturalWidth);
    const naturalHeight = await img.evaluate(el => el.naturalHeight);

    console.log(`\n📐 Image dimensions: ${naturalWidth}x${naturalHeight}`);

    expect(naturalWidth).toBeGreaterThan(0);
    expect(naturalHeight).toBeGreaterThan(0);

    console.log('\n✅ Canvas art display test completed successfully');
  });

});
```

**Step 2: Run the test**

```bash
npx playwright test tests/live/flow/canvas/canvas-art-display.runtime.test.mjs --headed
```

**Step 3: Commit**

```bash
git add tests/live/flow/canvas/canvas-art-display.runtime.test.mjs
git commit -m "test(canvas): add Playwright runtime test for art display"
```

---

## Task 9: Update design doc and clean up

**Files:**
- Update: `docs/plans/2026-01-31-capability-action-params.md`

**Step 1: Mark plan as implemented**

Add to top of file:

```markdown
**Status:** ✅ Implemented 2026-01-31
```

**Step 2: Final commit**

```bash
git add docs/
git commit -m "docs: mark capability action params plan as implemented"
```

---

## Summary

| Task | Description | Est. Complexity |
|------|-------------|-----------------|
| 1 | Consolidate ViewableItem → DisplayableItem | Low |
| 2 | Add resolveDisplayables() to adapter | Low |
| 3 | Add display= mapping to TVApp.jsx | Low |
| 4 | Add display handler to MenuStack.jsx | Low |
| 5 | Update ArtApp for direct item prop | Medium |
| 6 | Add canvas image proxy endpoint | Low |
| 7 | Register canvas adapter in bootstrap | Low |
| 8 | Write Playwright runtime test | Medium |
| 9 | Update docs | Low |
