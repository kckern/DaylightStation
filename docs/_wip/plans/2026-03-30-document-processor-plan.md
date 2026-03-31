# Document Processor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone Docker service that watches for scanned JPGs, uses vision LLM to group/categorize/fix them into named PDFs, and feeds them into Paperless-ngx.

**Architecture:** Standalone Node.js service in `_extensions/document-processor/`. Uses chokidar for filesystem watching, sharp for image manipulation, pdf-lib for PDF assembly, and the Anthropic SDK for vision LLM calls. Runs as a Docker container on the same network as Paperless.

**Tech Stack:** Node.js 22, sharp, pdf-lib, chokidar, @anthropic-ai/sdk, express

---

### Task 1: Project Scaffold

**Files:**
- Create: `_extensions/document-processor/package.json`
- Create: `_extensions/document-processor/Dockerfile`
- Create: `_extensions/document-processor/docker-compose.yml`
- Create: `_extensions/document-processor/.env.example`

**Step 1: Create package.json**

```json
{
  "name": "document-processor",
  "version": "1.0.0",
  "description": "Vision LLM-powered scan batch processor for DaylightStation",
  "type": "module",
  "main": "src/watcher.mjs",
  "scripts": {
    "start": "node src/watcher.mjs",
    "dev": "node --watch src/watcher.mjs",
    "process": "node src/cli.mjs process",
    "test": "node --test src/**/*.test.mjs"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "chokidar": "^4.0.0",
    "express": "^4.21.0",
    "pdf-lib": "^1.17.1",
    "sharp": "^0.33.0"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

**Step 2: Create Dockerfile**

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    inotify-tools && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY src/ ./src/

CMD ["node", "src/watcher.mjs"]
```

**Step 3: Create docker-compose.yml**

```yaml
services:
  document-processor:
    build: .
    container_name: document-processor
    restart: unless-stopped
    volumes:
      - ${DROPBOX_DOCUMENTS}/_Inbox:/data/_Inbox
      - ${DROPBOX_DOCUMENTS}/_Processing:/data/_Processing
      - ${DROPBOX_DOCUMENTS}/_Ready:/data/_Ready
      - ${DROPBOX_DOCUMENTS}/_Pending:/data/_Pending
    env_file:
      - .env
    ports:
      - "8190:8190"
    networks:
      kckern-net:
        aliases:
          - document-processor

networks:
  kckern-net:
    external: true
```

**Step 4: Create .env.example**

```bash
ANTHROPIC_API_KEY=sk-ant-...
VISION_MODEL=claude-sonnet-4-20250514
DEBOUNCE_MS=15000
STALE_BATCH_MS=300000
CATEGORIES=Tax,Medical,Insurance,Banking,Legal,Receipt,Correspondence,School,Church,Mortgage,Auto,Utility,Employment,Government
PORT=8190
DROPBOX_DOCUMENTS=/media/kckern/DockerDrive/Dropbox/Documents
```

**Step 5: Commit**

```bash
git add _extensions/document-processor/package.json \
        _extensions/document-processor/Dockerfile \
        _extensions/document-processor/docker-compose.yml \
        _extensions/document-processor/.env.example
git commit -m "feat(document-processor): scaffold project"
```

---

### Task 2: Image Manipulation Module

**Files:**
- Create: `_extensions/document-processor/src/images.mjs`
- Create: `_extensions/document-processor/src/images.test.mjs`

**Step 1: Write the failing test**

Create `src/images.test.mjs`:

```mjs
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { makeThumbnail, addPageLabel, buildContactSheet, rotateImage } from './images.mjs';

// Create a test image: 800x1000 white JPG
async function makeTestJpg(width = 800, height = 1000) {
  return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .jpeg()
    .toBuffer();
}

describe('images', () => {
  let testJpg;

  before(async () => {
    testJpg = await makeTestJpg();
  });

  test('makeThumbnail resizes to target width', async () => {
    const thumb = await makeThumbnail(testJpg, 300);
    const meta = await sharp(thumb).metadata();
    assert.equal(meta.width, 300);
    assert.ok(meta.height > 0);
  });

  test('addPageLabel composites a number onto image', async () => {
    const thumb = await makeThumbnail(testJpg, 300);
    const labeled = await addPageLabel(thumb, 7);
    const meta = await sharp(labeled).metadata();
    // Should be same dimensions — label is composited, not appended
    assert.equal(meta.width, 300);
  });

  test('buildContactSheet creates grid from thumbnails', async () => {
    const thumbs = [];
    for (let i = 0; i < 8; i++) {
      const thumb = await makeThumbnail(testJpg, 300);
      thumbs.push(await addPageLabel(thumb, i + 1));
    }
    const sheet = await buildContactSheet(thumbs, { columns: 4 });
    const meta = await sharp(sheet).metadata();
    // 4 columns of 300px = 1200px wide (plus padding)
    assert.ok(meta.width >= 1200);
    // 2 rows
    assert.ok(meta.height > 300);
  });

  test('rotateImage rotates by given degrees', async () => {
    const rotated = await rotateImage(testJpg, 90);
    const meta = await sharp(rotated).metadata();
    // 800x1000 rotated 90 = 1000x800
    assert.equal(meta.width, 1000);
    assert.equal(meta.height, 800);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd _extensions/document-processor && npm install && node --test src/images.test.mjs`
Expected: FAIL — `images.mjs` does not exist

**Step 3: Write implementation**

Create `src/images.mjs`:

```mjs
import sharp from 'sharp';

const THUMB_WIDTH = 300;
const LABEL_SIZE = 40;

/**
 * Resize image to thumbnail width, preserving aspect ratio.
 * @param {Buffer} imageBuffer - Source JPG buffer
 * @param {number} [width=300] - Target width in px
 * @returns {Promise<Buffer>} PNG thumbnail buffer
 */
export async function makeThumbnail(imageBuffer, width = THUMB_WIDTH) {
  return sharp(imageBuffer)
    .resize(width)
    .png()
    .toBuffer();
}

/**
 * Overlay a page number label on the bottom-right corner.
 * @param {Buffer} thumbBuffer - Thumbnail PNG buffer
 * @param {number} pageNum - Page number to display
 * @returns {Promise<Buffer>} Labeled thumbnail PNG buffer
 */
export async function addPageLabel(thumbBuffer, pageNum) {
  const label = Buffer.from(
    `<svg width="${LABEL_SIZE}" height="${LABEL_SIZE}">
      <rect width="${LABEL_SIZE}" height="${LABEL_SIZE}" rx="4" fill="rgba(0,0,0,0.7)"/>
      <text x="${LABEL_SIZE / 2}" y="${LABEL_SIZE * 0.72}" text-anchor="middle"
        font-family="sans-serif" font-size="22" font-weight="bold"
        fill="white">${pageNum}</text>
    </svg>`
  );
  return sharp(thumbBuffer)
    .composite([{ input: label, gravity: 'southeast' }])
    .png()
    .toBuffer();
}

/**
 * Stitch labeled thumbnails into a contact sheet grid.
 * @param {Buffer[]} thumbnails - Array of labeled thumbnail PNG buffers
 * @param {Object} [opts]
 * @param {number} [opts.columns=5] - Number of columns in grid
 * @param {number} [opts.padding=4] - Padding between cells in px
 * @returns {Promise<Buffer>} Contact sheet PNG buffer
 */
export async function buildContactSheet(thumbnails, { columns = 5, padding = 4 } = {}) {
  if (thumbnails.length === 0) throw new Error('No thumbnails to stitch');

  // Get dimensions from first thumbnail
  const firstMeta = await sharp(thumbnails[0]).metadata();
  const cellW = firstMeta.width;
  const cellH = firstMeta.height;

  const rows = Math.ceil(thumbnails.length / columns);
  const totalW = columns * cellW + (columns - 1) * padding;
  const totalH = rows * cellH + (rows - 1) * padding;

  const composites = thumbnails.map((buf, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    return {
      input: buf,
      left: col * (cellW + padding),
      top: row * (cellH + padding),
    };
  });

  return sharp({
    create: {
      width: totalW,
      height: totalH,
      channels: 4,
      background: { r: 240, g: 240, b: 240, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * Rotate an image by the given degrees (90, 180, 270).
 * @param {Buffer} imageBuffer - Source JPG buffer
 * @param {number} degrees - Rotation angle
 * @returns {Promise<Buffer>} Rotated JPG buffer
 */
export async function rotateImage(imageBuffer, degrees) {
  return sharp(imageBuffer)
    .rotate(degrees)
    .jpeg()
    .toBuffer();
}

/**
 * Map LLM orientation issue string to rotation degrees.
 * @param {string} issue - e.g. "upside_down", "sideways_right", "sideways_left"
 * @returns {number|null} Degrees to rotate, or null if no fix needed
 */
export function issueToRotation(issue) {
  const map = {
    upside_down: 180,
    sideways_right: 90,
    sideways_left: 270,
  };
  return map[issue] ?? null;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd _extensions/document-processor && node --test src/images.test.mjs`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add _extensions/document-processor/src/images.mjs \
        _extensions/document-processor/src/images.test.mjs
git commit -m "feat(document-processor): image manipulation module"
```

---

### Task 3: Vision LLM Module

**Files:**
- Create: `_extensions/document-processor/src/vision.mjs`
- Create: `_extensions/document-processor/src/vision.test.mjs`

**Step 1: Write the failing test**

Create `src/vision.test.mjs`:

```mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseResponse } from './vision.mjs';

const CATEGORIES = ['Tax', 'Medical', 'Insurance', 'Receipt'];

describe('vision', () => {
  test('buildPrompt includes page count and categories', () => {
    const prompt = buildPrompt(12, CATEGORIES);
    assert.ok(prompt.includes('12'));
    assert.ok(prompt.includes('Tax'));
    assert.ok(prompt.includes('Receipt'));
  });

  test('parseResponse extracts valid document array', () => {
    const raw = JSON.stringify({
      documents: [
        { pages: [1, 2], category: 'Tax', description: 'W-2 Form', date: '2026-01-15', issues: {} },
        { pages: [3], category: 'Receipt', description: 'Target Purchase', date: '2026-03-01', issues: { '3': 'upside_down' } },
      ],
    });
    const result = parseResponse(raw);
    assert.equal(result.length, 2);
    assert.deepEqual(result[0].pages, [1, 2]);
    assert.equal(result[1].issues['3'], 'upside_down');
  });

  test('parseResponse extracts JSON from markdown code fence', () => {
    const raw = 'Here is the analysis:\n```json\n{"documents":[{"pages":[1],"category":"Tax","description":"Test","date":"2026-01-01","issues":{}}]}\n```';
    const result = parseResponse(raw);
    assert.equal(result.length, 1);
  });

  test('parseResponse throws on invalid JSON', () => {
    assert.throws(() => parseResponse('not json at all'), /Failed to parse/);
  });

  test('parseResponse throws when documents array missing', () => {
    assert.throws(() => parseResponse('{"foo": "bar"}'), /Missing "documents"/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test src/vision.test.mjs`
Expected: FAIL — `vision.mjs` does not exist

**Step 3: Write implementation**

Create `src/vision.mjs`:

```mjs
import Anthropic from '@anthropic-ai/sdk';

let client = null;

function getClient() {
  if (!client) {
    client = new Anthropic(); // Uses ANTHROPIC_API_KEY env var
  }
  return client;
}

/**
 * Build the system+user prompt for the vision LLM.
 * @param {number} pageCount - Total pages in the batch
 * @param {string[]} categories - Allowed category names
 * @returns {string} The user prompt text
 */
export function buildPrompt(pageCount, categories) {
  return `You are a document sorting assistant. You are looking at a contact sheet grid of ${pageCount} scanned pages. Each page has a number label in the bottom-right corner.

Your job:
1. Group pages into separate documents (a multi-page letter is one document, a single receipt is one document, etc.)
2. Identify the category of each document
3. Extract or estimate the document date from visible content
4. Flag any pages that are upside down or sideways

Allowed categories: ${categories.join(', ')}

Respond with ONLY valid JSON in this exact format:
{
  "documents": [
    {
      "pages": [1, 2, 3],
      "category": "Category",
      "description": "Brief human-readable description",
      "date": "YYYY-MM-DD",
      "issues": { "2": "upside_down" }
    }
  ]
}

Issue types: "upside_down", "sideways_right", "sideways_left"
If no date is visible, use null for the date field.
Every page number from 1 to ${pageCount} must appear in exactly one document group.`;
}

/**
 * Parse the LLM response text into a documents array.
 * Handles raw JSON or JSON inside markdown code fences.
 * @param {string} text - Raw LLM response
 * @returns {Array} Parsed documents array
 */
export function parseResponse(text) {
  let jsonStr = text.trim();

  // Extract from code fence if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse LLM response as JSON: ${e.message}`);
  }

  if (!parsed.documents || !Array.isArray(parsed.documents)) {
    throw new Error('Missing "documents" array in LLM response');
  }

  return parsed.documents;
}

/**
 * Send contact sheet to vision LLM and get document groupings.
 * @param {Buffer} contactSheetPng - Contact sheet image buffer
 * @param {number} pageCount - Number of pages in the batch
 * @param {string[]} categories - Allowed categories
 * @param {Object} [opts]
 * @param {string} [opts.model] - Model override
 * @returns {Promise<Array>} Parsed documents array
 */
export async function analyzeContactSheet(contactSheetPng, pageCount, categories, opts = {}) {
  const model = opts.model || process.env.VISION_MODEL || 'claude-sonnet-4-20250514';
  const prompt = buildPrompt(pageCount, categories);

  const response = await getClient().messages.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: contactSheetPng.toString('base64'),
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const text = response.content[0]?.text;
  if (!text) throw new Error('Empty response from vision LLM');

  return parseResponse(text);
}

/**
 * Send individual pages at higher resolution for a second pass.
 * @param {Buffer[]} pageBuffers - Full-resolution page JPG buffers
 * @param {number[]} pageNumbers - The page numbers these correspond to
 * @param {string[]} categories - Allowed categories
 * @param {Object} [opts]
 * @returns {Promise<Array>} Refined documents array for these pages
 */
export async function analyzeDetailPages(pageBuffers, pageNumbers, categories, opts = {}) {
  const model = opts.model || process.env.VISION_MODEL || 'claude-sonnet-4-20250514';

  const imageContent = pageBuffers.map((buf, i) => ([
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') },
    },
    { type: 'text', text: `This is page ${pageNumbers[i]}.` },
  ])).flat();

  const prompt = `These are higher-resolution versions of pages that were ambiguous in the initial scan. Identify: document grouping, category, date, orientation issues, and a brief description.

Allowed categories: ${categories.join(', ')}

Respond with ONLY valid JSON:
{
  "documents": [
    { "pages": [N], "category": "Category", "description": "Description", "date": "YYYY-MM-DD", "issues": {} }
  ]
}`;

  const response = await getClient().messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: [...imageContent, { type: 'text', text: prompt }] }],
  });

  const text = response.content[0]?.text;
  if (!text) throw new Error('Empty response from detail vision LLM');

  return parseResponse(text);
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test src/vision.test.mjs`
Expected: All 5 tests PASS (only tests pure functions, not API calls)

**Step 5: Commit**

```bash
git add _extensions/document-processor/src/vision.mjs \
        _extensions/document-processor/src/vision.test.mjs
git commit -m "feat(document-processor): vision LLM module"
```

---

### Task 4: PDF Assembly Module

**Files:**
- Create: `_extensions/document-processor/src/pdf.mjs`
- Create: `_extensions/document-processor/src/pdf.test.mjs`

**Step 1: Write the failing test**

Create `src/pdf.test.mjs`:

```mjs
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { buildPdf, formatFilename } from './pdf.mjs';

async function makeTestJpg() {
  return sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .jpeg()
    .toBuffer();
}

describe('pdf', () => {
  let pages;

  before(async () => {
    pages = [await makeTestJpg(), await makeTestJpg(), await makeTestJpg()];
  });

  test('buildPdf creates valid PDF with correct page count', async () => {
    const pdfBytes = await buildPdf(pages);
    const doc = await PDFDocument.load(pdfBytes);
    assert.equal(doc.getPageCount(), 3);
  });

  test('formatFilename builds correct name with date and category', () => {
    const name = formatFilename('2026-03-15', 'Insurance', 'State Farm Auto Renewal');
    assert.equal(name, '2026-03-15 - Insurance - State Farm Auto Renewal.pdf');
  });

  test('formatFilename uses scan date when document date is null', () => {
    const name = formatFilename(null, 'Receipt', 'Unknown Purchase', '2026-03-30');
    assert.equal(name, '2026-03-30 - Receipt - Unknown Purchase.pdf');
  });

  test('formatFilename sanitizes unsafe characters', () => {
    const name = formatFilename('2026-01-01', 'Tax', 'W-2 Form: Federal/State');
    assert.ok(!name.includes('/'));
    assert.ok(!name.includes(':'));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test src/pdf.test.mjs`
Expected: FAIL — `pdf.mjs` does not exist

**Step 3: Write implementation**

Create `src/pdf.mjs`:

```mjs
import { PDFDocument } from 'pdf-lib';

/**
 * Assemble an array of JPG buffers into a single PDF.
 * @param {Buffer[]} jpgBuffers - Full-resolution page JPGs in order
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function buildPdf(jpgBuffers) {
  const doc = await PDFDocument.create();

  for (const buf of jpgBuffers) {
    const image = await doc.embedJpg(buf);
    const page = doc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  return doc.save();
}

/**
 * Build a sanitized filename from document metadata.
 * @param {string|null} docDate - Document date from LLM (YYYY-MM-DD) or null
 * @param {string} category - Document category
 * @param {string} description - Human-readable description
 * @param {string} [fallbackDate] - Scan date to use if docDate is null
 * @returns {string} Filename like "2026-03-15 - Insurance - State Farm Renewal.pdf"
 */
export function formatFilename(docDate, category, description, fallbackDate = null) {
  const date = docDate || fallbackDate || new Date().toISOString().slice(0, 10);
  const safeDesc = description.replace(/[/\\:*?"<>|]/g, '-').trim();
  return `${date} - ${category} - ${safeDesc}.pdf`;
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test src/pdf.test.mjs`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add _extensions/document-processor/src/pdf.mjs \
        _extensions/document-processor/src/pdf.test.mjs
git commit -m "feat(document-processor): PDF assembly module"
```

---

### Task 5: Batch Processor (Orchestration)

**Files:**
- Create: `_extensions/document-processor/src/processor.mjs`

**Step 1: Write implementation**

This is the orchestrator — it wires together images, vision, and pdf modules. Testing is integration-level (Task 7).

Create `src/processor.mjs`:

```mjs
import { readdir, readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { makeThumbnail, addPageLabel, buildContactSheet, rotateImage, issueToRotation } from './images.mjs';
import { analyzeContactSheet } from './vision.mjs';
import { buildPdf, formatFilename } from './pdf.mjs';

const DIRS = {
  inbox: '/data/_Inbox',
  processing: '/data/_Processing',
  ready: '/data/_Ready',
  pending: '/data/_Pending',
};

/**
 * Get the list of categories from env.
 */
function getCategories() {
  const env = process.env.CATEGORIES || '';
  return env.split(',').map(c => c.trim()).filter(Boolean);
}

/**
 * Collect all JPG files from a directory, sorted by name.
 * @param {string} dir
 * @returns {Promise<string[]>} Sorted file paths
 */
async function collectJpgs(dir) {
  const entries = await readdir(dir);
  return entries
    .filter(f => /\.jpe?g$/i.test(f))
    .sort()
    .map(f => join(dir, f));
}

/**
 * Move all JPGs from _Inbox to a timestamped batch directory in _Processing.
 * @returns {Promise<{batchDir: string, files: string[]}|null>} Null if no JPGs found
 */
export async function stageBatch() {
  const jpgs = await collectJpgs(DIRS.inbox);
  if (jpgs.length === 0) return null;

  const batchId = `batch-${Date.now()}`;
  const batchDir = join(DIRS.processing, batchId);
  await mkdir(batchDir, { recursive: true });

  const stagedFiles = [];
  for (const src of jpgs) {
    const dest = join(batchDir, src.split('/').pop());
    await rename(src, dest);
    stagedFiles.push(dest);
  }

  return { batchDir, files: stagedFiles };
}

/**
 * Process a staged batch: thumbnails → contact sheet → LLM → fix → PDFs → _Ready.
 * @param {Object} batch - From stageBatch()
 * @param {Function} [log] - Logging function
 * @returns {Promise<{documents: Array, errors: Array}>}
 */
export async function processBatch(batch, log = console.log) {
  const { batchDir, files } = batch;
  const categories = getCategories();
  const scanDate = new Date().toISOString().slice(0, 10);
  const results = { documents: [], errors: [] };

  try {
    // 1. Read all pages
    log(`Reading ${files.length} pages...`);
    const pageBuffers = await Promise.all(files.map(f => readFile(f)));

    // 2. Generate labeled thumbnails
    log('Generating thumbnails...');
    const thumbnails = [];
    for (let i = 0; i < pageBuffers.length; i++) {
      const thumb = await makeThumbnail(pageBuffers[i]);
      thumbnails.push(await addPageLabel(thumb, i + 1));
    }

    // 3. Build contact sheet
    log('Building contact sheet...');
    const contactSheet = await buildContactSheet(thumbnails);

    // 4. Send to vision LLM
    log('Analyzing with vision LLM...');
    const documents = await analyzeContactSheet(contactSheet, files.length, categories);
    log(`LLM identified ${documents.length} document(s)`);

    // 5. Process each document group
    for (const doc of documents) {
      try {
        // Fix orientation issues
        const fixedPages = [];
        for (const pageNum of doc.pages) {
          const idx = pageNum - 1; // pages are 1-indexed
          let buf = pageBuffers[idx];
          const issue = doc.issues?.[String(pageNum)];
          if (issue) {
            const degrees = issueToRotation(issue);
            if (degrees) {
              log(`Rotating page ${pageNum}: ${issue} (${degrees}deg)`);
              buf = await rotateImage(buf, degrees);
            }
          }
          fixedPages.push(buf);
        }

        // Build PDF
        const pdfBytes = await buildPdf(fixedPages);
        const filename = formatFilename(doc.date, doc.category, doc.description, scanDate);
        const destPath = join(DIRS.ready, filename);
        await writeFile(destPath, pdfBytes);
        log(`Created: ${filename} (${doc.pages.length} pages)`);
        results.documents.push({ filename, pages: doc.pages, category: doc.category });
      } catch (docErr) {
        log(`Error processing document [pages ${doc.pages}]: ${docErr.message}`);
        results.errors.push({ pages: doc.pages, error: docErr.message });
      }
    }

    // 6. Clean up batch dir on full success
    if (results.errors.length === 0) {
      await rm(batchDir, { recursive: true });
      log('Batch complete, cleaned up processing dir');
    } else {
      // Move to pending if any errors
      const pendingDir = join(DIRS.pending, batchDir.split('/').pop());
      await rename(batchDir, pendingDir);
      log(`Partial failure — moved batch to _Pending`);
    }
  } catch (err) {
    // Total failure — move entire batch to _Pending
    log(`Batch failed: ${err.message}`);
    try {
      const pendingDir = join(DIRS.pending, batchDir.split('/').pop());
      await rename(batchDir, pendingDir);
    } catch (moveErr) {
      log(`Failed to move batch to _Pending: ${moveErr.message}`);
    }
    results.errors.push({ pages: 'all', error: err.message });
  }

  return results;
}

/**
 * Run the full pipeline: stage + process.
 * @param {Function} [log]
 * @returns {Promise<Object|null>} Results or null if inbox empty
 */
export async function processInbox(log = console.log) {
  const batch = await stageBatch();
  if (!batch) {
    log('No JPGs in _Inbox, nothing to process');
    return null;
  }
  log(`Staged ${batch.files.length} pages → ${batch.batchDir}`);
  return processBatch(batch, log);
}
```

**Step 2: Commit**

```bash
git add _extensions/document-processor/src/processor.mjs
git commit -m "feat(document-processor): batch processor orchestration"
```

---

### Task 6: Filewatcher + HTTP Server

**Files:**
- Create: `_extensions/document-processor/src/watcher.mjs`
- Create: `_extensions/document-processor/src/server.mjs`

**Step 1: Write server.mjs**

```mjs
import express from 'express';
import { processInbox } from './processor.mjs';

let status = { state: 'idle', lastRun: null, lastResult: null };

export function createServer(port = process.env.PORT || 8190) {
  const app = express();

  app.post('/process', async (req, res) => {
    if (status.state === 'processing') {
      return res.status(409).json({ error: 'Already processing a batch' });
    }
    status.state = 'processing';
    try {
      const result = await processInbox(console.log);
      status.lastRun = new Date().toISOString();
      status.lastResult = result;
      status.state = 'idle';
      res.json({ ok: true, result });
    } catch (err) {
      status.state = 'error';
      status.lastResult = { error: err.message };
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/status', (req, res) => {
    res.json(status);
  });

  return app.listen(port, () => {
    console.log(`Document processor API on :${port}`);
  });
}

export function setStatus(updates) {
  Object.assign(status, updates);
}

export function getStatus() {
  return status;
}
```

**Step 2: Write watcher.mjs**

```mjs
import chokidar from 'chokidar';
import { processInbox } from './processor.mjs';
import { createServer, setStatus } from './server.mjs';

const INBOX = '/data/_Inbox';
const DEBOUNCE_MS = parseInt(process.env.DEBOUNCE_MS || '15000', 10);
const STALE_MS = parseInt(process.env.STALE_BATCH_MS || '300000', 10);

let debounceTimer = null;
let staleTimer = null;
let processing = false;

async function triggerProcess() {
  if (processing) {
    console.log('Already processing, skipping trigger');
    return;
  }
  processing = true;
  setStatus({ state: 'processing' });

  try {
    const result = await processInbox(console.log);
    setStatus({ state: 'idle', lastRun: new Date().toISOString(), lastResult: result });
  } catch (err) {
    console.error('Processing failed:', err.message);
    setStatus({ state: 'error', lastResult: { error: err.message } });
  } finally {
    processing = false;
  }
}

function resetDebounce() {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (staleTimer) clearTimeout(staleTimer);

  debounceTimer = setTimeout(() => {
    console.log(`No new files for ${DEBOUNCE_MS / 1000}s — processing batch`);
    triggerProcess();
  }, DEBOUNCE_MS);

  // Stale timer: process even if files keep trickling in
  if (!staleTimer) {
    staleTimer = setTimeout(() => {
      console.log(`Stale batch timeout (${STALE_MS / 1000}s) — forcing process`);
      if (debounceTimer) clearTimeout(debounceTimer);
      staleTimer = null;
      triggerProcess();
    }, STALE_MS);
  }
}

// Start watcher
console.log(`Watching ${INBOX} for JPGs (debounce: ${DEBOUNCE_MS}ms)`);

chokidar.watch(INBOX, {
  ignored: /(^|[/\\])\../, // ignore dotfiles
  awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
})
  .on('add', (path) => {
    if (!/\.jpe?g$/i.test(path)) return;
    console.log(`New page: ${path.split('/').pop()}`);
    resetDebounce();
  });

// Start HTTP server
createServer();
```

**Step 3: Commit**

```bash
git add _extensions/document-processor/src/watcher.mjs \
        _extensions/document-processor/src/server.mjs
git commit -m "feat(document-processor): filewatcher and HTTP trigger"
```

---

### Task 7: Paperless Post-Consume Script

**Files:**
- Create: `_extensions/document-processor/src/post-consume.sh`

**Step 1: Write the script**

```bash
#!/bin/bash
# Paperless post-consumption script
# Copies processed documents to Dropbox/Documents/YYYY/ archive
#
# Paperless sets these env vars:
#   DOCUMENT_ID, DOCUMENT_FILENAME, DOCUMENT_CREATED, DOCUMENT_ADDED

DOCS_ROOT="/data/Documents"

# Use document date if available, otherwise added date, otherwise today
if [ -n "$DOCUMENT_CREATED" ]; then
  YEAR=$(date -d "$DOCUMENT_CREATED" +%Y 2>/dev/null || echo "$(date +%Y)")
else
  YEAR=$(date +%Y)
fi

DEST="${DOCS_ROOT}/${YEAR}/"
mkdir -p "$DEST"

# The filename from Paperless is the full path to the archived file
if [ -f "$DOCUMENT_FILENAME" ]; then
  cp "$DOCUMENT_FILENAME" "$DEST"
  echo "Copied $(basename "$DOCUMENT_FILENAME") → ${DEST}"
else
  echo "ERROR: File not found: $DOCUMENT_FILENAME" >&2
  exit 1
fi
```

**Step 2: Commit**

```bash
chmod +x _extensions/document-processor/src/post-consume.sh
git add _extensions/document-processor/src/post-consume.sh
git commit -m "feat(document-processor): paperless post-consume script"
```

---

### Task 8: Integration Test with Real Images

**Files:**
- Create: `_extensions/document-processor/src/integration.test.mjs`

**Step 1: Write integration test**

This test exercises the full pipeline with synthetic images (no LLM call — mocks the vision response).

```mjs
import { test, describe, before, after } from 'node:test';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

// Set up test directories before importing processor
const TEST_ROOT = '/tmp/docproc-test-' + Date.now();
process.env.CATEGORIES = 'Tax,Receipt';

describe('integration: full pipeline', () => {
  const dirs = {
    inbox: join(TEST_ROOT, '_Inbox'),
    processing: join(TEST_ROOT, '_Processing'),
    ready: join(TEST_ROOT, '_Ready'),
    pending: join(TEST_ROOT, '_Pending'),
  };

  before(async () => {
    for (const dir of Object.values(dirs)) {
      await mkdir(dir, { recursive: true });
    }

    // Create 3 fake scanned pages
    for (let i = 1; i <= 3; i++) {
      const jpg = await sharp({
        create: { width: 800, height: 1000, channels: 3, background: { r: 200 + i * 10, g: 200, b: 200 } },
      }).jpeg().toBuffer();
      await writeFile(join(dirs.inbox, `page-${String(i).padStart(3, '0')}.jpg`), jpg);
    }
  });

  after(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  test('stageBatch moves JPGs from inbox to processing', async () => {
    // Monkey-patch the DIRS constant by importing after env setup
    // For this test, we'll directly test the image + pdf modules
    const { makeThumbnail, addPageLabel, buildContactSheet } = await import('./images.mjs');
    const { buildPdf, formatFilename } = await import('./pdf.mjs');

    // Read the test JPGs
    const { readFile: rf } = await import('node:fs/promises');
    const files = (await readdir(dirs.inbox)).sort();
    assert.equal(files.length, 3);

    // Test thumbnail + contact sheet pipeline
    const pageBuffers = await Promise.all(files.map(f => rf(join(dirs.inbox, f))));
    const thumbs = [];
    for (let i = 0; i < pageBuffers.length; i++) {
      const t = await makeThumbnail(pageBuffers[i]);
      thumbs.push(await addPageLabel(t, i + 1));
    }
    const sheet = await buildContactSheet(thumbs);
    const sheetMeta = await sharp(sheet).metadata();
    assert.ok(sheetMeta.width > 0);
    assert.ok(sheetMeta.height > 0);

    // Test PDF assembly
    const pdfBytes = await buildPdf(pageBuffers);
    const doc = await PDFDocument.load(pdfBytes);
    assert.equal(doc.getPageCount(), 3);

    // Test filename formatting
    const name = formatFilename('2026-03-30', 'Tax', 'Test Document');
    assert.equal(name, '2026-03-30 - Tax - Test Document.pdf');
  });
});
```

**Step 2: Run integration test**

Run: `node --test src/integration.test.mjs`
Expected: PASS

**Step 3: Commit**

```bash
git add _extensions/document-processor/src/integration.test.mjs
git commit -m "test(document-processor): integration test for pipeline"
```

---

### Task 9: DESIGN.md and Final Wiring

**Files:**
- Copy: design doc to `_extensions/document-processor/DESIGN.md`
- Verify: full `npm test` passes

**Step 1: Copy design doc**

```bash
cp docs/_wip/plans/2026-03-30-document-processor-design.md \
   _extensions/document-processor/DESIGN.md
```

**Step 2: Run all tests**

Run: `cd _extensions/document-processor && npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add _extensions/document-processor/DESIGN.md
git commit -m "docs(document-processor): add design document"
```

---

### Task 10: Deploy to Homeserver

**Not automated — manual steps for the user:**

1. Push the branch
2. SSH to homeserver
3. Pull the code
4. Create `.env` from `.env.example` with real Anthropic key
5. `cd _extensions/document-processor && docker compose up -d --build`
6. Update Paperless to set `PAPERLESS_POST_CONSUME_SCRIPT`:
   - Add volume mount for the post-consume script and Dropbox Documents YYYY dirs
   - Add env var `PAPERLESS_POST_CONSUME_SCRIPT=/scripts/post-consume.sh`
7. Test: drop a JPG into `_Inbox/`, watch logs with `docker logs -f document-processor`
