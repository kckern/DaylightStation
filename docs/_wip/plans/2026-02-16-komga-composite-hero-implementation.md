# Komga Composite Hero Image Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generate a 1280x720 composite hero image (magazine cover + 2 article pages) for Komga feed cards, served on-demand with disk caching.

**Architecture:** New proxy endpoint `/komga/composite/:bookId/:page` fetches 3 images from Komga, composites them using node-canvas into a 16:9 JPEG, caches to disk. KomgaFeedAdapter emits this composite URL instead of the single-page URL.

**Tech Stack:** node-canvas (`createCanvas`, `loadImage`), Express route, `fs` for disk cache, `fetch` for Komga API calls.

---

### Task 1: Export `loadImage` from Canvas Module

**Files:**
- Modify: `backend/src/0_system/canvas/CanvasService.mjs:9`
- Modify: `backend/src/0_system/canvas/index.mjs:8-11`

**Step 1: Add `loadImage` import to CanvasService.mjs**

In `backend/src/0_system/canvas/CanvasService.mjs`, change line 9:

```js
// Before:
import { createCanvas, registerFont } from 'canvas';

// After:
import { createCanvas, registerFont, loadImage } from 'canvas';
```

Add at the bottom of the file, before the `export default`:

```js
export { loadImage };
```

**Step 2: Re-export `loadImage` from index.mjs**

In `backend/src/0_system/canvas/index.mjs`, add the export:

```js
import { CanvasService } from './CanvasService.mjs';
import { loadImage } from './CanvasService.mjs';

export { CanvasService, loadImage };
export * from './drawingUtils.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/0_system/canvas/CanvasService.mjs backend/src/0_system/canvas/index.mjs
git commit -m "feat(canvas): export loadImage from canvas module"
```

---

### Task 2: Create compositeHeroImage Utility (TDD)

**Files:**
- Create: `backend/src/0_system/canvas/compositeHero.mjs`
- Create: `tests/isolated/system/canvas/compositeHero.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/system/canvas/compositeHero.test.mjs`:

```js
import { jest, describe, test, expect } from '@jest/globals';
import { createCanvas } from 'canvas';
import { compositeHeroImage } from '../../../../backend/src/0_system/canvas/compositeHero.mjs';

describe('compositeHeroImage', () => {
  /**
   * Helper: create a solid-color PNG buffer at given dimensions.
   */
  function makeTestImage(width, height, color = '#ff0000') {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    return canvas.toBuffer('image/png');
  }

  test('produces a 1280x720 JPEG buffer from 3 images', async () => {
    const cover = makeTestImage(400, 600, '#ff0000');
    const page1 = makeTestImage(400, 600, '#00ff00');
    const page2 = makeTestImage(400, 600, '#0000ff');

    const result = await compositeHeroImage([cover, page1, page2]);

    // Check it's a JPEG (starts with FF D8 FF)
    expect(result[0]).toBe(0xFF);
    expect(result[1]).toBe(0xD8);
    expect(result[2]).toBe(0xFF);

    // Verify dimensions by loading back
    const { loadImage: li } = await import('canvas');
    const img = await li(result);
    expect(img.width).toBe(1280);
    expect(img.height).toBe(720);
  });

  test('handles 2 images (page+1 missing)', async () => {
    const cover = makeTestImage(400, 600, '#ff0000');
    const page1 = makeTestImage(400, 600, '#00ff00');

    const result = await compositeHeroImage([cover, page1]);

    expect(result[0]).toBe(0xFF);
    expect(result[1]).toBe(0xD8);

    const { loadImage: li } = await import('canvas');
    const img = await li(result);
    expect(img.width).toBe(1280);
    expect(img.height).toBe(720);
  });

  test('handles 1 image (cover-only fallback)', async () => {
    const page1 = makeTestImage(400, 600, '#00ff00');

    const result = await compositeHeroImage([page1]);

    expect(result[0]).toBe(0xFF);
    expect(result[1]).toBe(0xD8);

    const { loadImage: li } = await import('canvas');
    const img = await li(result);
    expect(img.width).toBe(1280);
    expect(img.height).toBe(720);
  });

  test('throws on empty array', async () => {
    await expect(compositeHeroImage([])).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/system/canvas/compositeHero.test.mjs --no-cache`
Expected: FAIL — module `compositeHero.mjs` does not exist.

**Step 3: Write the implementation**

Create `backend/src/0_system/canvas/compositeHero.mjs`:

```js
/**
 * Composite Hero Image Generator
 * @module 0_system/canvas/compositeHero
 *
 * Creates a 1280x720 composite image from multiple source images.
 * Images are placed side-by-side at equal height, cropped at 16:9 right edge.
 */

import { createCanvas, loadImage } from 'canvas';

const HERO_WIDTH = 1280;
const HERO_HEIGHT = 720;

/**
 * Composite multiple image buffers into a single 1280x720 JPEG.
 *
 * Images are scaled to fill the canvas height (720px) and placed left-to-right.
 * Content beyond x=1280 is naturally clipped.
 *
 * @param {Buffer[]} imageBuffers - Array of image buffers (PNG/JPEG). At least 1 required.
 * @param {Object} [options]
 * @param {number} [options.quality=0.85] - JPEG quality (0-1)
 * @returns {Promise<Buffer>} JPEG buffer
 */
export async function compositeHeroImage(imageBuffers, options = {}) {
  if (!imageBuffers || imageBuffers.length === 0) {
    throw new Error('compositeHeroImage requires at least 1 image buffer');
  }

  const quality = options.quality ?? 0.85;

  // Load all images
  const images = await Promise.all(
    imageBuffers.map(buf => loadImage(buf))
  );

  // Create canvas
  const canvas = createCanvas(HERO_WIDTH, HERO_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Fill background black (in case images don't cover full width)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, HERO_WIDTH, HERO_HEIGHT);

  // Draw images left-to-right, each scaled to HERO_HEIGHT
  let x = 0;
  for (const img of images) {
    const scale = HERO_HEIGHT / img.height;
    const scaledWidth = Math.round(img.width * scale);
    ctx.drawImage(img, x, 0, scaledWidth, HERO_HEIGHT);
    x += scaledWidth;

    // Stop if we've filled the canvas width
    if (x >= HERO_WIDTH) break;
  }

  // Export as JPEG
  return canvas.toBuffer('image/jpeg', { quality });
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/system/canvas/compositeHero.test.mjs --no-cache`
Expected: All 4 tests PASS.

**Step 5: Commit**

```bash
git add backend/src/0_system/canvas/compositeHero.mjs tests/isolated/system/canvas/compositeHero.test.mjs
git commit -m "feat(canvas): add compositeHeroImage utility with tests"
```

---

### Task 3: Add Composite Endpoint to Proxy Router

**Files:**
- Modify: `backend/src/4_api/v1/routers/proxy.mjs:19-21,293-306`
- Modify: `backend/src/0_system/bootstrap.mjs:693`

**Step 1: Add `dataPath` to proxy router config**

In `backend/src/4_api/v1/routers/proxy.mjs`, update the config destructuring at line 21:

```js
// Before:
const { registry, proxyService, mediaBasePath, logger = console } = config;

// After:
const { registry, proxyService, mediaBasePath, dataPath, logger = console } = config;
```

Add these imports at the top of the file (after existing imports):

```js
import { compositeHeroImage } from '#system/canvas/compositeHero.mjs';
```

**Step 2: Add the composite route BEFORE the Komga catch-all**

Insert the new route before the existing `router.use('/komga', ...)` at line 293. The new route must come first so Express matches it before the catch-all:

```js
  /**
   * GET /proxy/komga/composite/:bookId/:page
   * Generate a composite 16:9 hero image from Komga book cover + article pages.
   * On-demand generation with disk cache.
   */
  router.get('/komga/composite/:bookId/:page', asyncHandler(async (req, res) => {
    const { bookId, page } = req.params;
    const pageNum = parseInt(page, 10);
    if (!bookId || isNaN(pageNum)) {
      return res.status(400).json({ error: 'Invalid bookId or page' });
    }

    // Check disk cache
    const cacheDir = dataPath
      ? nodePath.join(dataPath, 'household', 'shared', 'komga', 'hero')
      : null;
    const cacheFile = cacheDir
      ? nodePath.join(cacheDir, `${bookId}-${pageNum}.jpg`)
      : null;

    if (cacheFile && fs.existsSync(cacheFile)) {
      res.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000',
        'X-Cache': 'HIT',
      });
      return fs.createReadStream(cacheFile).pipe(res);
    }

    // Get Komga credentials from ProxyService
    const komgaAdapter = proxyService?.getAdapter?.('komga');
    if (!komgaAdapter?.isConfigured?.()) {
      return res.status(503).json({ error: 'Komga proxy not configured' });
    }

    const baseUrl = komgaAdapter.getBaseUrl();
    const authHeaders = komgaAdapter.getAuthHeaders();

    // Fetch source images in parallel
    const imageUrls = [
      `${baseUrl}/api/v1/books/${bookId}/thumbnail`,    // cover
      `${baseUrl}/api/v1/books/${bookId}/pages/${pageNum}`,  // article page
      `${baseUrl}/api/v1/books/${bookId}/pages/${pageNum + 1}`, // next page
    ];

    const fetchResults = await Promise.allSettled(
      imageUrls.map(async (url) => {
        const resp = await fetch(url, {
          headers: authHeaders,
          signal: AbortSignal.timeout(30000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return Buffer.from(await resp.arrayBuffer());
      })
    );

    // Collect successful fetches (skip failures gracefully)
    const buffers = fetchResults
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    if (buffers.length === 0) {
      return res.status(502).json({ error: 'Failed to fetch any images from Komga' });
    }

    // Composite
    const jpegBuffer = await compositeHeroImage(buffers);

    // Cache to disk
    if (cacheDir) {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, jpegBuffer);
    }

    // Serve
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': jpegBuffer.length,
      'Cache-Control': 'public, max-age=31536000',
      'X-Cache': 'MISS',
    });
    res.send(jpegBuffer);
  }));
```

**Step 3: Update bootstrap to pass `dataPath`**

In `backend/src/0_system/bootstrap.mjs`, line 693, add `dataPath`:

```js
// Before:
proxy: createProxyRouter({ registry, proxyService, mediaBasePath, logger }),

// After:
proxy: createProxyRouter({ registry, proxyService, mediaBasePath, dataPath, logger }),
```

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/proxy.mjs backend/src/0_system/bootstrap.mjs
git commit -m "feat(proxy): add Komga composite hero image endpoint"
```

---

### Task 4: Update KomgaFeedAdapter Image URL (TDD)

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs:117,204-206`
- Create: `tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs`:

```js
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock dataService
const mockDataService = {
  household: {
    read: jest.fn().mockReturnValue(null),
    write: jest.fn(),
  },
};

// KomgaFeedAdapter uses pdfjs-dist for TOC extraction — mock the entire module
jest.unstable_mockModule('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: jest.fn().mockReturnValue({
    promise: Promise.resolve({
      getOutline: jest.fn().mockResolvedValue([]),
      destroy: jest.fn(),
    }),
  }),
}));

const { KomgaFeedAdapter } = await import(
  '../../../../backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs'
);

describe('KomgaFeedAdapter', () => {
  const logger = { warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDataService.household.read.mockReturnValue(null);
  });

  describe('fetchItems image URL', () => {
    test('uses composite hero URL pattern', async () => {
      // Mock books list response
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{
              id: 'book-abc',
              name: 'Issue 42',
              metadata: { title: 'Issue 42', releaseDate: '2026-01-01' },
              media: { pagesCount: 50 },
            }],
          }),
        })
        // Mock PDF file download (for TOC extraction)
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(10),
        });

      // Return cached TOC so we skip pdfjs entirely
      mockDataService.household.read.mockReturnValue({
        bookId: 'book-abc',
        series: 'Test Series',
        issue: 'Issue 42',
        pages: 50,
        articles: [{ title: 'Article One', page: 12 }],
      });

      const adapter = new KomgaFeedAdapter({
        host: 'http://localhost:25600',
        apiKey: 'test-key',
        dataService: mockDataService,
        logger,
      });

      const items = await adapter.fetchItems({
        tier: 'library',
        priority: 5,
        params: {
          series: [{ id: 'series-1', label: 'Test Series' }],
          recent_issues: 1,
        },
      }, 'testuser');

      expect(items).toHaveLength(1);
      // Key assertion: image uses composite URL pattern
      expect(items[0].image).toBe('/api/v1/proxy/komga/composite/book-abc/12');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs --no-cache`
Expected: FAIL — image URL is still the old single-page pattern `/api/v1/proxy/komga/api/v1/books/book-abc/pages/12`.

**Step 3: Update the image URL in KomgaFeedAdapter**

In `backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs`, change line 117:

```js
// Before:
const imageUrl = this.#pageImageUrl(bookId, pageNum);

// After:
const imageUrl = `/api/v1/proxy/komga/composite/${bookId}/${pageNum}`;
```

Note: Keep the `#pageImageUrl` helper method — it's still used in `getDetail()` at line 158 for the detail view (which should show the single article page, not the composite).

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs --no-cache`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs
git commit -m "feat(feed): use composite hero URL for Komga feed cards"
```

---

### Task 5: Run Full Test Suite & Verify

**Step 1: Run all isolated tests to check for regressions**

Run: `npx jest tests/isolated/ --no-cache`
Expected: All tests pass. No regressions.

**Step 2: Manual smoke test (if dev server available)**

```bash
# Check if dev server is running
lsof -i :3112

# If running, hit the feed scroll endpoint filtered to Komga
curl -s "http://localhost:3112/api/v1/feed/scroll?source=komga&limit=3" | jq '.items[].image'

# Expected: URLs like /api/v1/proxy/komga/composite/{bookId}/{page}
# Then load one of those URLs in a browser to verify the composite image renders
```

**Step 3: Commit any fixes, then final commit**

If all looks good, no additional commit needed.
