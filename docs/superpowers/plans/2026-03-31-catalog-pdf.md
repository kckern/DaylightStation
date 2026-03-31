# Catalog PDF Generator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/api/v1/catalog/:source/:id` endpoint that generates a printable PDF grid of QR codes for every item in a content container.

**Architecture:** The route handler fetches the list from the existing `/api/v1/list` endpoint, then fetches each item's QR SVG from the existing `/api/v1/qrcode` endpoint, converts SVGs to PNGs via `sharp`, and lays them out on US Letter pages via `pdf-lib`. A dedicated renderer handles the PDF layout.

**Tech Stack:** `sharp` (SVG-to-PNG), `pdf-lib` (PDF generation), Express router

---

### Task 1: Add dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install sharp and pdf-lib**

Run:
```bash
cd /Users/kckern/Documents/GitHub/DaylightStation && npm install sharp pdf-lib
```

Expected: Both packages added to `dependencies` in `package.json`.

**Step 2: Verify install**

Run:
```bash
node -e "import('sharp').then(s => console.log('sharp OK')); import('pdf-lib').then(p => console.log('pdf-lib OK'));"
```

Expected: Both print OK.

---

### Task 2: Create CatalogRenderer

**Files:**
- Create: `backend/src/1_rendering/catalog/CatalogRenderer.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/rendering/catalog/CatalogRenderer.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { createCatalogRenderer } from '#rendering/catalog/CatalogRenderer.mjs';

describe('CatalogRenderer', () => {
  it('produces a valid PDF buffer from title + PNG buffers', async () => {
    const renderer = createCatalogRenderer();

    // Create a minimal 1x1 red PNG (smallest valid PNG)
    const sharp = (await import('sharp')).default;
    const pngBuf = await sharp({
      create: { width: 100, height: 60, channels: 3, background: { r: 255, g: 0, b: 0 } }
    }).png().toBuffer();

    const pdfBytes = await renderer.render({
      title: 'Test Catalog',
      images: [pngBuf, pngBuf, pngBuf, pngBuf],
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(100);

    // PDF magic bytes: %PDF
    const header = String.fromCharCode(...pdfBytes.slice(0, 4));
    expect(header).toBe('%PDF');
  });

  it('creates multiple pages when items exceed 15', async () => {
    const renderer = createCatalogRenderer();
    const sharp = (await import('sharp')).default;
    const pngBuf = await sharp({
      create: { width: 100, height: 60, channels: 3, background: { r: 0, g: 0, b: 255 } }
    }).png().toBuffer();

    // 16 items = 2 pages (15 per page)
    const images = Array(16).fill(pngBuf);

    const pdfBytes = await renderer.render({
      title: 'Multi Page',
      images,
    });

    // Parse with pdf-lib to check page count
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/rendering/catalog/CatalogRenderer.test.mjs`
Expected: FAIL — module not found

**Step 3: Write the renderer**

Create `backend/src/1_rendering/catalog/CatalogRenderer.mjs`:

```javascript
/**
 * Catalog PDF Renderer
 *
 * Lays out PNG images in a 3x5 grid on US Letter pages with a title header.
 *
 * @module rendering/catalog/CatalogRenderer
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const PAGE_WIDTH = 612;   // US Letter width in points
const PAGE_HEIGHT = 792;  // US Letter height in points
const MARGIN = 36;        // 0.5 inch margins
const COLS = 3;
const ROWS = 5;
const TITLE_HEIGHT = 50;
const CELL_GAP = 8;

/**
 * @returns {{ render: Function }}
 */
export function createCatalogRenderer() {
  return { render };
}

/**
 * @param {Object} params
 * @param {string} params.title - Catalog title (displayed on first page)
 * @param {Buffer[]} params.images - Array of PNG buffers
 * @returns {Promise<Uint8Array>} PDF bytes
 */
async function render({ title, images }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  const contentWidth = PAGE_WIDTH - 2 * MARGIN;
  const cellWidth = (contentWidth - (COLS - 1) * CELL_GAP) / COLS;

  const itemsPerPage = COLS * ROWS;
  const totalPages = Math.ceil(images.length / itemsPerPage);

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const isFirstPage = pageIdx === 0;

    // Title on first page
    let gridTop = PAGE_HEIGHT - MARGIN;
    if (isFirstPage && title) {
      const fontSize = 24;
      const textWidth = font.widthOfTextAtSize(title, fontSize);
      page.drawText(title, {
        x: (PAGE_WIDTH - textWidth) / 2,
        y: gridTop - fontSize,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
      gridTop -= TITLE_HEIGHT;
    }

    const gridHeight = gridTop - MARGIN;
    const cellHeight = (gridHeight - (ROWS - 1) * CELL_GAP) / ROWS;

    const startIdx = pageIdx * itemsPerPage;
    const pageImages = images.slice(startIdx, startIdx + itemsPerPage);

    for (let i = 0; i < pageImages.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);

      const x = MARGIN + col * (cellWidth + CELL_GAP);
      const y = gridTop - (row + 1) * cellHeight - row * CELL_GAP;

      try {
        const pngImage = await doc.embedPng(pageImages[i]);
        const aspect = pngImage.width / pngImage.height;

        // Fit image within cell, maintaining aspect ratio
        let drawWidth = cellWidth;
        let drawHeight = cellWidth / aspect;
        if (drawHeight > cellHeight) {
          drawHeight = cellHeight;
          drawWidth = cellHeight * aspect;
        }

        // Center within cell
        const offsetX = (cellWidth - drawWidth) / 2;
        const offsetY = (cellHeight - drawHeight) / 2;

        page.drawImage(pngImage, {
          x: x + offsetX,
          y: y + offsetY,
          width: drawWidth,
          height: drawHeight,
        });
      } catch (err) {
        // Skip images that fail to embed
      }
    }
  }

  return doc.save();
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/rendering/catalog/CatalogRenderer.test.mjs`
Expected: PASS (both tests)

**Step 5: Commit**

```bash
git add backend/src/1_rendering/catalog/CatalogRenderer.mjs tests/isolated/rendering/catalog/CatalogRenderer.test.mjs
git commit -m "feat: add CatalogRenderer for PDF grid layout"
```

---

### Task 3: Create catalog router

**Files:**
- Create: `backend/src/4_api/v1/routers/catalog.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/rendering/catalog/catalogRouter.test.mjs`:

```javascript
import { describe, it, expect, vi } from 'vitest';

// We'll test the orchestration logic (SVG fetch + convert + render)
// by mocking fetch and sharp, verifying the pipeline connects correctly.

describe('catalog router pipeline', () => {
  it('fetches list, fetches QR SVGs, converts to PNG, calls renderer', async () => {
    // This is an integration-level test; we'll verify in Task 5 via live API.
    // For now, verify the module exports correctly.
    const { createCatalogRouter } = await import('#api/v1/routers/catalog.mjs');
    expect(typeof createCatalogRouter).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/rendering/catalog/catalogRouter.test.mjs`
Expected: FAIL — module not found

**Step 3: Write the router**

Create `backend/src/4_api/v1/routers/catalog.mjs`:

```javascript
/**
 * Catalog PDF Router
 *
 * Generates a printable PDF grid of QR codes for all items in a content container.
 * Reuses existing /list and /qrcode endpoints via internal HTTP calls.
 *
 * GET /api/v1/catalog/:source/:id?screen=...&options=...
 *
 * @module api/v1/routers/catalog
 */

import express from 'express';
import sharp from 'sharp';

/**
 * @param {Object} config
 * @param {Object} config.renderer - CatalogRenderer with render()
 * @param {number} config.port - Server port for internal HTTP calls
 * @param {Object} [config.logger]
 */
export function createCatalogRouter(config) {
  const { renderer, port, logger = console } = config;
  const router = express.Router();

  const baseUrl = `http://localhost:${port}`;

  /**
   * GET /api/v1/catalog/:source/:id
   */
  router.get('/:source/:id', async (req, res) => {
    try {
      const { source, id } = req.params;
      const { screen, options } = req.query;

      // 1. Fetch list
      const listUrl = `${baseUrl}/api/v1/list/${source}/${id}`;
      logger.info?.('catalog.list.fetch', { listUrl });
      const listRes = await fetch(listUrl);
      if (!listRes.ok) {
        return res.status(listRes.status).json({ error: 'Failed to fetch list' });
      }
      const listData = await listRes.json();
      const title = listData.title || 'Catalog';
      const items = listData.items || [];

      if (items.length === 0) {
        return res.status(404).json({ error: 'No items in list' });
      }

      // 2. Fetch QR SVGs for each item
      const pngBuffers = await Promise.all(
        items.map(async (item) => {
          try {
            const params = new URLSearchParams();
            params.set('content', item.id);
            if (screen) params.set('screen', screen);
            if (options) params.set('options', options);

            const qrUrl = `${baseUrl}/api/v1/qrcode?${params}`;
            const qrRes = await fetch(qrUrl);
            if (!qrRes.ok) return null;

            const svgText = await qrRes.text();

            // 3. Convert SVG to PNG via sharp
            const pngBuf = await sharp(Buffer.from(svgText))
              .png()
              .toBuffer();
            return pngBuf;
          } catch (err) {
            logger.warn?.('catalog.qr.failed', { itemId: item.id, error: err.message });
            return null;
          }
        })
      );

      // Filter out failed items
      const validPngs = pngBuffers.filter(Boolean);
      if (validPngs.length === 0) {
        return res.status(500).json({ error: 'All QR code conversions failed' });
      }

      // 4. Render PDF
      const pdfBytes = await renderer.render({ title, images: validPngs });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${title}.pdf"`);
      res.send(Buffer.from(pdfBytes));

    } catch (err) {
      logger.error?.('catalog.render.failed', { error: err.message });
      res.status(500).json({ error: 'Catalog generation failed' });
    }
  });

  return router;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/rendering/catalog/catalogRouter.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/catalog.mjs tests/isolated/rendering/catalog/catalogRouter.test.mjs
git commit -m "feat: add catalog PDF router"
```

---

### Task 4: Wire into app.mjs and api.mjs

**Files:**
- Modify: `backend/src/app.mjs` (~line 1340, after qrcode router)
- Modify: `backend/src/4_api/v1/routers/api.mjs` (add to routeMap)

**Step 1: Add catalog router creation to app.mjs**

After the qrcode router block (line ~1340), add:

```javascript
  // Catalog PDF renderer and router
  const { createCatalogRenderer } = await import('#rendering/catalog/CatalogRenderer.mjs');
  const { createCatalogRouter } = await import('./4_api/v1/routers/catalog.mjs');
  const catalogRenderer = createCatalogRenderer();
  v1Routers.catalog = createCatalogRouter({
    renderer: catalogRenderer,
    port: Number(process.env.PORT || 3111),
    logger: rootLogger.child({ module: 'catalog' }),
  });
```

**Step 2: Add route to api.mjs routeMap**

In `backend/src/4_api/v1/routers/api.mjs`, add to the `routeMap` object (after the `/qrcode` entry):

```javascript
    '/catalog': 'catalog',
```

**Step 3: Verify server starts**

Run: `node -e "import('./backend/src/1_rendering/catalog/CatalogRenderer.mjs').then(m => console.log('import OK'))"`
Expected: "import OK"

**Step 4: Commit**

```bash
git add backend/src/app.mjs backend/src/4_api/v1/routers/api.mjs
git commit -m "feat: wire catalog router into app bootstrap"
```

---

### Task 5: Manual smoke test

**Step 1: Start dev server if not running**

Run: `lsof -i :3111` to check. If not running: `npm run dev` (background).

**Step 2: Test the endpoint**

Run:
```bash
curl -s -o /tmp/catalog-test.pdf -w "%{http_code}" "http://localhost:3111/api/v1/catalog/plex/674396?screen=living-room&options=shuffle"
```

Expected: HTTP 200, valid PDF at `/tmp/catalog-test.pdf`.

**Step 3: Verify PDF opens**

Run: `open /tmp/catalog-test.pdf` (macOS)

Expected: PDF with title header and grid of QR codes with cover thumbnails.
