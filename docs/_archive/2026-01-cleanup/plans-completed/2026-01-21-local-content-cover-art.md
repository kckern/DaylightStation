# Local Content Cover Art Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ID3 cover art extraction to DDD backend with dynamic placeholder generation for files without embedded art.

**Architecture:** FilesystemAdapter gets a `getCoverArt()` method that extracts embedded pictures from audio files. A new `/cover/*` route in localContent router serves the images. Missing covers get a dynamically generated 500x500 dark placeholder with the path text in Roboto Condensed.

**Tech Stack:** Node.js, Express, `music-metadata` (existing), `canvas` (existing)

---

## Task 1: Create Placeholder Image Generator

**Files:**
- Create: `backend/src/0_infrastructure/utils/placeholderImage.mjs`
- Test: `tests/unit/infrastructure/placeholderImage.unit.test.mjs`

**Step 1: Write the failing test**

Create test file:

```javascript
// tests/unit/infrastructure/placeholderImage.unit.test.mjs
import { describe, test, expect, vi, beforeAll } from 'vitest';

// Mock canvas before importing the module
vi.mock('canvas', () => {
  const mockCtx = {
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    font: '',
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 100 }))
  };
  const mockCanvas = {
    getContext: vi.fn(() => mockCtx),
    toBuffer: vi.fn(() => Buffer.from('fake-png-data'))
  };
  return {
    createCanvas: vi.fn(() => mockCanvas),
    registerFont: vi.fn()
  };
});

describe('placeholderImage', () => {
  let generatePlaceholderImage;

  beforeAll(async () => {
    const mod = await import('../../../backend/src/0_infrastructure/utils/placeholderImage.mjs');
    generatePlaceholderImage = mod.generatePlaceholderImage;
  });

  test('returns a Buffer', () => {
    const result = generatePlaceholderImage('sfx/intro');
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  test('creates 500x500 canvas', async () => {
    const { createCanvas } = await import('canvas');
    generatePlaceholderImage('test/path');
    expect(createCanvas).toHaveBeenCalledWith(500, 500);
  });

  test('sets dark background color', async () => {
    const { createCanvas } = await import('canvas');
    generatePlaceholderImage('test/path');
    const mockCanvas = createCanvas.mock.results[0].value;
    const ctx = mockCanvas.getContext('2d');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 500, 500);
  });

  test('renders the display text', async () => {
    const { createCanvas } = await import('canvas');
    generatePlaceholderImage('my/media/path');
    const mockCanvas = createCanvas.mock.results[0].value;
    const ctx = mockCanvas.getContext('2d');
    expect(ctx.fillText).toHaveBeenCalledWith('my/media/path', 250, 250);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/infrastructure/placeholderImage.unit.test.mjs`

Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/0_infrastructure/utils/placeholderImage.mjs
import { createCanvas, registerFont } from 'canvas';
import path from 'path';
import { fileExists } from './FileIO.mjs';

// Attempt to register Roboto Condensed font
const mediaPath = process.env.path?.media || process.env.MEDIA_PATH || '/data/media';
const fontPath = path.join(mediaPath, 'fonts/RobotoCondensed-Regular.ttf');

try {
  if (fileExists(fontPath)) {
    registerFont(fontPath, { family: 'Roboto Condensed' });
  }
} catch (err) {
  // Font registration failed, will use fallback
  console.warn('placeholderImage: Failed to register Roboto Condensed font:', err.message);
}

/**
 * Generate a placeholder PNG with the media path displayed
 * @param {string} displayText - Text to show (e.g., "sfx/intro")
 * @returns {Buffer} PNG image buffer
 */
export function generatePlaceholderImage(displayText) {
  const SIZE = 500;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  // Dark background
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // White text, centered
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Scale font to fit (start at 32px, shrink if needed)
  let fontSize = 32;
  ctx.font = `${fontSize}px "Roboto Condensed", sans-serif`;
  while (ctx.measureText(displayText).width > SIZE - 40 && fontSize > 12) {
    fontSize -= 2;
    ctx.font = `${fontSize}px "Roboto Condensed", sans-serif`;
  }

  ctx.fillText(displayText, SIZE / 2, SIZE / 2);

  return canvas.toBuffer('image/png');
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/infrastructure/placeholderImage.unit.test.mjs`

Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add backend/src/0_infrastructure/utils/placeholderImage.mjs tests/unit/infrastructure/placeholderImage.unit.test.mjs
git commit -m "feat(infrastructure): add placeholder image generator

Generates 500x500 dark PNG with centered text for missing cover art.
Uses Roboto Condensed font when available, falls back to sans-serif."
```

---

## Task 2: Add getCoverArt to FilesystemAdapter

**Files:**
- Modify: `backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs`
- Test: `tests/unit/adapters/filesystem-cover-art.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/adapters/filesystem-cover-art.unit.test.mjs
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { FilesystemAdapter } from '../../../../backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs';

// Mock music-metadata
vi.mock('music-metadata', () => ({
  parseFile: vi.fn()
}));

// Mock FileIO
vi.mock('../../../../backend/src/0_infrastructure/utils/FileIO.mjs', () => ({
  fileExists: vi.fn(() => true),
  dirExists: vi.fn(() => false),
  loadYamlFromPath: vi.fn(() => ({})),
  resolveYamlPath: vi.fn(() => null),
  listEntries: vi.fn(() => []),
  getStats: vi.fn(() => null),
  isFile: vi.fn(() => true)
}));

describe('FilesystemAdapter.getCoverArt', () => {
  let adapter;
  let parseFileMock;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mm = await import('music-metadata');
    parseFileMock = mm.parseFile;

    adapter = new FilesystemAdapter({
      mediaBasePath: '/test/media'
    });
  });

  test('returns null when file not found', async () => {
    const { fileExists } = await import('../../../../backend/src/0_infrastructure/utils/FileIO.mjs');
    fileExists.mockReturnValue(false);

    const result = await adapter.getCoverArt('nonexistent/file');
    expect(result).toBeNull();
  });

  test('returns null when no picture in metadata', async () => {
    parseFileMock.mockResolvedValue({
      common: {}
    });

    const result = await adapter.getCoverArt('audio/test.mp3');
    expect(result).toBeNull();
  });

  test('returns buffer and mimeType when picture exists', async () => {
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    parseFileMock.mockResolvedValue({
      common: {
        picture: [{
          data: imageData,
          format: 'image/png'
        }]
      }
    });

    const result = await adapter.getCoverArt('audio/test.mp3');

    expect(result).not.toBeNull();
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.mimeType).toBe('image/png');
  });

  test('returns first picture when multiple exist', async () => {
    parseFileMock.mockResolvedValue({
      common: {
        picture: [
          { data: new Uint8Array([1, 2, 3]), format: 'image/jpeg' },
          { data: new Uint8Array([4, 5, 6]), format: 'image/png' }
        ]
      }
    });

    const result = await adapter.getCoverArt('audio/test.mp3');

    expect(result.mimeType).toBe('image/jpeg');
  });

  test('returns null on parse error', async () => {
    parseFileMock.mockRejectedValue(new Error('Invalid file'));

    const result = await adapter.getCoverArt('audio/corrupt.mp3');
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/adapters/filesystem-cover-art.unit.test.mjs`

Expected: FAIL with "getCoverArt is not a function"

**Step 3: Write minimal implementation**

Add to `FilesystemAdapter.mjs` after the `_parseAudioMetadata` method (around line 136):

```javascript
  /**
   * Extract cover art from media file
   * @param {string} mediaKey - e.g., "sfx/intro"
   * @returns {Promise<{buffer: Buffer, mimeType: string} | null>}
   */
  async getCoverArt(mediaKey) {
    const resolved = this.resolvePath(mediaKey);
    if (!resolved) return null;

    try {
      const metadata = await (this._parseFile || parseFile)(resolved.path);
      const picture = metadata?.common?.picture;

      if (picture?.length) {
        return {
          buffer: Buffer.from(picture[0].data),
          mimeType: picture[0].format
        };
      }
    } catch (err) {
      // File doesn't have cover art or can't be parsed
    }

    return null;
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/adapters/filesystem-cover-art.unit.test.mjs`

Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs tests/unit/adapters/filesystem-cover-art.unit.test.mjs
git commit -m "feat(adapter): add getCoverArt to FilesystemAdapter

Extracts embedded ID3 picture from audio files.
Returns buffer and mimeType, or null if not found."
```

---

## Task 3: Add Cover Art Route to LocalContent Router

**Files:**
- Modify: `backend/src/4_api/routers/localContent.mjs`
- Test: `tests/integration/api/local-content.api.test.mjs` (add tests)

**Step 1: Write the failing test**

Add to existing `tests/integration/api/local-content.api.test.mjs`:

```javascript
  // ===========================================================================
  // COVER ART ENDPOINT
  // ===========================================================================
  describe('GET /api/local-content/cover/*', () => {
    describe('error handling', () => {
      test('returns 400 for empty media key', async () => {
        const res = await request(app).get('/api/local-content/cover/');

        expect(res.status).toBe(400);
        validateErrorResponse(res.body);
      });
    });

    describe('placeholder generation', () => {
      test('returns PNG for nonexistent file', async () => {
        const res = await request(app).get('/api/local-content/cover/nonexistent/path/file');

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/png');
        expect(res.headers['cache-control']).toContain('max-age=');
      });

      test('returns valid PNG buffer', async () => {
        const res = await request(app)
          .get('/api/local-content/cover/test/placeholder')
          .buffer(true);

        expect(res.status).toBe(200);
        // PNG magic bytes: 0x89 0x50 0x4E 0x47
        expect(res.body[0]).toBe(0x89);
        expect(res.body[1]).toBe(0x50);
        expect(res.body[2]).toBe(0x4e);
        expect(res.body[3]).toBe(0x47);
      });
    });

    // Note: Testing actual cover extraction requires an MP3 with embedded art
    // in the test fixtures. For now, we verify the placeholder fallback works.
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/api/local-content.api.test.mjs`

Expected: FAIL with 404 (route not found)

**Step 3: Write minimal implementation**

Add import at top of `localContent.mjs`:

```javascript
import { generatePlaceholderImage } from '../../0_infrastructure/utils/placeholderImage.mjs';
```

Add route inside `createLocalContentRouter()` function, after the poem route:

```javascript
  /**
   * GET /api/local-content/cover/*
   * Returns cover art from embedded ID3 or placeholder
   */
  router.get('/cover/*', async (req, res) => {
    const mediaKey = req.params[0] || '';

    if (!mediaKey) {
      return res.status(400).json({ error: 'No media key provided' });
    }

    // Try filesystem adapter for cover art extraction
    const fsAdapter = registry.get('filesystem');

    if (fsAdapter?.getCoverArt) {
      try {
        const coverArt = await fsAdapter.getCoverArt(mediaKey);

        if (coverArt) {
          res.set({
            'Content-Type': coverArt.mimeType,
            'Content-Length': coverArt.buffer.length,
            'Cache-Control': 'public, max-age=86400'
          });
          return res.send(coverArt.buffer);
        }
      } catch (err) {
        console.error('[localContent] cover art extraction error:', err.message);
      }
    }

    // Generate placeholder
    const placeholder = generatePlaceholderImage(mediaKey);
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': placeholder.length,
      'Cache-Control': 'public, max-age=86400'
    });
    return res.send(placeholder);
  });
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/api/local-content.api.test.mjs`

Expected: PASS (all tests including new cover art tests)

**Step 5: Commit**

```bash
git add backend/src/4_api/routers/localContent.mjs tests/integration/api/local-content.api.test.mjs
git commit -m "feat(api): add cover art endpoint to localContent router

GET /api/local-content/cover/{mediaKey}
- Extracts ID3 cover from audio files via FilesystemAdapter
- Falls back to generated placeholder for missing covers
- Returns with 24h cache headers"
```

---

## Task 4: Add Roboto Condensed Font

**Files:**
- Add: `{mediaPath}/fonts/RobotoCondensed-Regular.ttf`

**Step 1: Download font**

```bash
# Create fonts directory if needed
mkdir -p /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/fonts

# Download Roboto Condensed from Google Fonts
curl -L "https://github.com/googlefonts/roboto/raw/main/src/hinted/RobotoCondensed-Regular.ttf" \
  -o /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/fonts/RobotoCondensed-Regular.ttf
```

**Step 2: Verify font file**

```bash
file /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/fonts/RobotoCondensed-Regular.ttf
```

Expected: `TrueType Font data`

**Step 3: Commit**

Note: Font file is in media mount (not git tracked). No commit needed for font itself.

---

## Task 5: Manual Integration Test

**Step 1: Start dev server**

```bash
node backend/index.js
```

**Step 2: Test placeholder generation**

```bash
curl -I http://localhost:3112/api/local-content/cover/sfx/intro
```

Expected:
```
HTTP/1.1 200 OK
Content-Type: image/png
Cache-Control: public, max-age=86400
```

**Step 3: View placeholder in browser**

Open: `http://localhost:3112/api/local-content/cover/sfx/intro`

Expected: 500x500 dark image with "sfx/intro" text centered

**Step 4: Test with real MP3 that has cover art (if available)**

```bash
curl -I http://localhost:3112/api/local-content/cover/songs/hymn/0001
```

Expected: `Content-Type: image/jpeg` (or whatever format is embedded)

---

## Task 6: Final Commit and Cleanup

**Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass

**Step 2: Verify no lint errors**

```bash
npm run lint --prefix backend 2>/dev/null || echo "No lint script"
```

**Step 3: Final commit if any cleanup needed**

```bash
git status
# If clean, skip. Otherwise:
git add -A
git commit -m "chore: cleanup after cover art implementation"
```

---

## Summary

| Task | Files | Tests |
|------|-------|-------|
| 1. Placeholder generator | `placeholderImage.mjs` | 4 unit tests |
| 2. FilesystemAdapter.getCoverArt | `FilesystemAdapter.mjs` | 5 unit tests |
| 3. LocalContent cover route | `localContent.mjs` | 3 integration tests |
| 4. Font file | `fonts/RobotoCondensed-Regular.ttf` | Manual verify |
| 5. Integration test | - | Manual verify |
| 6. Cleanup | - | Full suite |

**Total new tests:** 12
**Total new/modified files:** 4
