# Feed Image Dimensions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate layout shift ("rugpull effect") in the feed scroll by providing image dimensions to the frontend before images load.

**Architecture:** Each feed adapter extracts `imageWidth`/`imageHeight` from data it already has (Reddit preview, Immich EXIF, YouTube known sizes, Komga constants). FreshRSS images get dimensions via a server-side partial HTTP fetch at assembly time (cached). The frontend sets CSS `aspect-ratio` on the image container using these dimensions, with a 16:9 fallback for unknowns.

**Tech Stack:** Node.js (backend adapters), `image-size` npm package (binary header parsing for FreshRSS), React (FeedCard frontend), CSS `aspect-ratio`.

---

## Task 1: Install `image-size` and Create `probeImageDimensions` Utility

**Files:**
- Create: `backend/src/0_system/utils/probeImageDimensions.mjs`
- Test: `tests/isolated/system/probeImageDimensions.test.mjs`

**Step 1: Install dependency**

Run: `npm install image-size`

**Step 2: Write the failing test**

```js
// tests/isolated/system/probeImageDimensions.test.mjs
import { probeImageDimensions } from '#system/utils/probeImageDimensions.mjs';

describe('probeImageDimensions', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns width and height for a valid JPEG', async () => {
    // Minimal JPEG: SOF0 marker with 100x200 dimensions
    // SOF0 = FF C0, length 2 bytes, precision 1 byte, height 2 bytes, width 2 bytes
    const sof0 = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x02, // SOI + APP0 (minimal)
      0xFF, 0xC0, 0x00, 0x0B, 0x08,       // SOF0 marker, length=11, precision=8
      0x00, 0xC8, // height = 200
      0x00, 0x64, // width = 100
      0x01, 0x01, 0x00, // 1 component
    ]);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { [Symbol.asyncIterator]: async function* () { yield sof0; } },
    });

    const result = await probeImageDimensions('https://example.com/photo.jpg');
    expect(result).toEqual({ width: 100, height: 200 });
  });

  it('returns width and height for a valid PNG', async () => {
    // PNG: 8-byte signature + IHDR chunk (width at bytes 16-19, height at 20-23)
    const png = Buffer.alloc(33);
    // PNG signature
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(png, 0);
    // IHDR chunk: length(4) + "IHDR"(4) + width(4) + height(4)
    png.writeUInt32BE(13, 8);   // chunk length
    Buffer.from('IHDR').copy(png, 12);
    png.writeUInt32BE(640, 16); // width
    png.writeUInt32BE(480, 20); // height

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { [Symbol.asyncIterator]: async function* () { yield png; } },
    });

    const result = await probeImageDimensions('https://example.com/photo.png');
    expect(result).toEqual({ width: 640, height: 480 });
  });

  it('returns null on fetch failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await probeImageDimensions('https://example.com/missing.jpg');
    expect(result).toBeNull();
  });

  it('returns null on timeout', async () => {
    global.fetch = jest.fn().mockImplementation(() => new Promise(() => {})); // never resolves
    const result = await probeImageDimensions('https://example.com/slow.jpg', 50);
    expect(result).toBeNull();
  });

  it('returns null for non-image content', async () => {
    const html = Buffer.from('<html><body>Not an image</body></html>');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { [Symbol.asyncIterator]: async function* () { yield html; } },
    });

    const result = await probeImageDimensions('https://example.com/page.html');
    expect(result).toBeNull();
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npx jest tests/isolated/system/probeImageDimensions.test.mjs --verbose`
Expected: FAIL — module not found

**Step 4: Write the implementation**

```js
// backend/src/0_system/utils/probeImageDimensions.mjs
/**
 * Partial-fetch an image URL and read dimensions from binary headers.
 * Uses the `image-size` library to parse JPEG, PNG, WebP, GIF, etc.
 *
 * @param {string} url - Image URL to probe
 * @param {number} [timeoutMs=3000] - Max time to wait
 * @returns {Promise<{ width: number, height: number } | null>}
 */
import imageSize from 'image-size';

export async function probeImageDimensions(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DaylightStation/1.0)' },
    });
    if (!res.ok) return null;

    // Read up to 128KB — enough for any image header
    const MAX_BYTES = 128 * 1024;
    const chunks = [];
    let totalBytes = 0;

    for await (const chunk of res.body) {
      chunks.push(chunk);
      totalBytes += chunk.length;
      if (totalBytes >= MAX_BYTES) break;
    }

    // Abort remaining download
    controller.abort();

    const buffer = Buffer.concat(chunks, totalBytes);
    const result = imageSize(buffer);
    if (result?.width && result?.height) {
      return { width: result.width, height: result.height };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

**Step 5: Run test to verify it passes**

Run: `npx jest tests/isolated/system/probeImageDimensions.test.mjs --verbose`
Expected: PASS (all 5 tests)

> Note: The JPEG test may need adjustment depending on how `image-size` parses minimal buffers. If the minimal JPEG above doesn't parse, construct a proper minimal JPEG using the library's own test fixtures as reference. The PNG test should work reliably since IHDR is always at a fixed offset.

**Step 6: Commit**

```bash
git add backend/src/0_system/utils/probeImageDimensions.mjs tests/isolated/system/probeImageDimensions.test.mjs package.json package-lock.json
git commit -m "feat(feed): add probeImageDimensions utility for reading image dimensions from URLs"
```

---

## Task 2: Reddit Adapter — Extract Preview Dimensions

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/RedditFeedAdapter.mjs:200-228`
- Test: `tests/isolated/adapter/feed/RedditFeedAdapter.test.mjs` (create if not exists)

**Context:** The Reddit JSON API returns `post.preview.images[0].source.width` and `.height`. Currently only `.url` is read (line 175). The item construction is at lines 209-228.

**Step 1: Write the failing test**

```js
// tests/isolated/adapter/feed/RedditFeedAdapter.test.mjs
import { RedditFeedAdapter } from '#adapters/feed/sources/RedditFeedAdapter.mjs';

describe('RedditFeedAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new RedditFeedAdapter({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() } });
  });

  afterEach(() => jest.restoreAllMocks());

  describe('image dimensions', () => {
    it('includes imageWidth and imageHeight from preview source', async () => {
      const mockPost = {
        kind: 't3',
        data: {
          id: 'abc123',
          subreddit: 'pics',
          title: 'A cool photo',
          selftext: '',
          permalink: '/r/pics/comments/abc123/a_cool_photo/',
          url: 'https://i.redd.it/abc123.jpg',
          post_hint: 'image',
          score: 100,
          num_comments: 10,
          created_utc: Date.now() / 1000,
          stickied: false,
          thumbnail: 'https://i.redd.it/abc123_thumb.jpg',
          preview: {
            images: [{
              source: {
                url: 'https://preview.redd.it/abc123.jpg?auto=webp&amp;s=1234',
                width: 1920,
                height: 1080,
              },
            }],
          },
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { children: [mockPost] } }),
      });

      const query = { type: 'reddit', tier: 'wire', params: { subreddits: ['pics'] } };
      const items = await adapter.fetchItems(query, 'testuser');

      expect(items[0].meta.imageWidth).toBe(1920);
      expect(items[0].meta.imageHeight).toBe(1080);
    });

    it('sets imageWidth/imageHeight to null when no preview', async () => {
      const mockPost = {
        kind: 't3',
        data: {
          id: 'def456',
          subreddit: 'news',
          title: 'Breaking news',
          selftext: '',
          permalink: '/r/news/comments/def456/breaking/',
          url: 'https://example.com/article',
          score: 50,
          num_comments: 5,
          created_utc: Date.now() / 1000,
          stickied: false,
          thumbnail: 'self',
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { children: [mockPost] } }),
      });

      const query = { type: 'reddit', tier: 'wire', params: { subreddits: ['news'] } };
      const items = await adapter.fetchItems(query, 'testuser');

      expect(items[0].meta.imageWidth).toBeUndefined();
      expect(items[0].meta.imageHeight).toBeUndefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/RedditFeedAdapter.test.mjs --verbose`
Expected: FAIL — `imageWidth` is undefined (not set yet)

**Step 3: Modify RedditFeedAdapter.mjs**

In `#fetchMultiSubreddit` (around line 203-228), extract preview dimensions and add to meta:

```js
// After line 207 (const rawImage = ...), add:
const previewSource = post.preview?.images?.[0]?.source;
const imageWidth = previewSource?.width || undefined;
const imageHeight = previewSource?.height || undefined;
```

In the meta object (lines 219-227), add after `sourceIcon`:

```js
            ...(imageWidth && imageHeight ? { imageWidth, imageHeight } : {}),
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/adapter/feed/RedditFeedAdapter.test.mjs --verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/sources/RedditFeedAdapter.mjs tests/isolated/adapter/feed/RedditFeedAdapter.test.mjs
git commit -m "feat(feed): extract image dimensions from Reddit preview data"
```

---

## Task 3: YouTube Adapter — Hardcoded Thumbnail Dimensions

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/YouTubeFeedAdapter.mjs:150-174,220-238`
- Test: `tests/isolated/adapter/feed/YouTubeFeedAdapter.test.mjs` (create if not exists)

**Context:** YouTube thumbnails have known, fixed dimensions based on their URL suffix.

**Step 1: Write the failing test**

```js
// tests/isolated/adapter/feed/YouTubeFeedAdapter.test.mjs
import { YouTubeFeedAdapter } from '#adapters/feed/sources/YouTubeFeedAdapter.mjs';

describe('YouTubeFeedAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new YouTubeFeedAdapter({
      apiKey: 'fake-key',
      logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    });
  });

  afterEach(() => jest.restoreAllMocks());

  describe('image dimensions', () => {
    it('includes 480x360 for hqdefault thumbnails (RSS path)', async () => {
      const rssXml = `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/">
  <entry>
    <yt:videoId>dQw4w9WgXcQ</yt:videoId>
    <title>Test Video</title>
    <published>2026-01-01T00:00:00Z</published>
    <name>Test Channel</name>
    <yt:channelId>UC123</yt:channelId>
    <media:thumbnail url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" />
    <media:description>A test video</media:description>
  </entry>
</feed>`;

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => rssXml,
      });

      const query = { type: 'youtube', tier: 'wire', params: { channels: ['UC123'] } };
      const items = await adapter.fetchItems(query, 'testuser');

      expect(items[0].meta.imageWidth).toBe(480);
      expect(items[0].meta.imageHeight).toBe(360);
    });

    it('includes dimensions for API thumbnails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{
            id: { videoId: 'abc123' },
            snippet: {
              title: 'API Video',
              description: 'Test',
              channelTitle: 'Channel',
              channelId: 'UC456',
              publishedAt: '2026-01-01T00:00:00Z',
              thumbnails: {
                high: { url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg', width: 480, height: 360 },
                medium: { url: 'https://i.ytimg.com/vi/abc123/mqdefault.jpg', width: 320, height: 180 },
              },
            },
          }],
        }),
      });

      const query = { type: 'youtube', tier: 'wire', params: { keywords: ['test'] } };
      const items = await adapter.fetchItems(query, 'testuser');

      // API path: use snippet.thumbnails dimensions directly
      expect(items[0].meta.imageWidth).toBe(480);
      expect(items[0].meta.imageHeight).toBe(360);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/YouTubeFeedAdapter.test.mjs --verbose`
Expected: FAIL — `imageWidth` is undefined

**Step 3: Modify YouTubeFeedAdapter.mjs**

Add a constant near the top of the file:

```js
const YT_THUMB_DIMS = {
  'maxresdefault': { w: 1280, h: 720 },
  'sddefault':     { w: 640,  h: 480 },
  'hqdefault':     { w: 480,  h: 360 },
  'mqdefault':     { w: 320,  h: 180 },
  'default':       { w: 120,  h: 90 },
};
```

Add a private method:

```js
  #thumbDimensions(url) {
    if (!url) return {};
    for (const [key, dims] of Object.entries(YT_THUMB_DIMS)) {
      if (url.includes(key)) return { imageWidth: dims.w, imageHeight: dims.h };
    }
    return {};
  }
```

**RSS path** (inside `#parseRSS`, around line 166-172 meta block):
```js
          ...this.#thumbDimensions(image),
```

**API path** (inside `#fetchAPIAndNormalize`, around line 230-236 meta block):

Use the API's own thumbnail dimensions if available, otherwise fall back to URL-based lookup:
```js
          ...this.#apiThumbDimensions(snippet, image),
```

Where:
```js
  #apiThumbDimensions(snippet, imageUrl) {
    // Prefer the exact dimensions from whichever thumbnail was selected
    for (const key of ['high', 'medium', 'default', 'maxres', 'standard']) {
      const t = snippet.thumbnails?.[key];
      if (t?.url === imageUrl && t.width && t.height) {
        return { imageWidth: t.width, imageHeight: t.height };
      }
    }
    return this.#thumbDimensions(imageUrl);
  }
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/adapter/feed/YouTubeFeedAdapter.test.mjs --verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/sources/YouTubeFeedAdapter.mjs tests/isolated/adapter/feed/YouTubeFeedAdapter.test.mjs
git commit -m "feat(feed): add YouTube thumbnail dimensions to feed items"
```

---

## Task 4: Komga Adapter — Hardcoded Composite Dimensions

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs:130-138`
- Test: `tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs` (existing)

**Context:** Komga composite hero images are always 1280x720 (hardcoded in `backend/src/0_system/canvas/compositeHero.mjs` lines 11-12).

**Step 1: Add a test to the existing test file**

```js
it('includes imageWidth=1280 and imageHeight=720 for composite hero', async () => {
  // ... (use existing test's mock setup pattern from KomgaFeedAdapter.test.mjs)
  // Assert:
  expect(items[0].meta.imageWidth).toBe(1280);
  expect(items[0].meta.imageHeight).toBe(720);
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs --verbose`
Expected: FAIL

**Step 3: Modify KomgaFeedAdapter.mjs**

In the meta block (lines 130-138), add:

```js
    imageWidth: 1280,
    imageHeight: 720,
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs --verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs
git commit -m "feat(feed): add hardcoded 1280x720 dimensions for Komga composite images"
```

---

## Task 5: Immich Adapter — Read Dimensions from Viewable

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/ImmichFeedAdapter.mjs:154-175` (enrichWithExif) and `42-62` (item construction)
- Test: `tests/isolated/adapter/feed/ImmichFeedAdapter.test.mjs` (create)

**Context:** `ImmichAdapter.getViewable()` already returns `viewable.width` and `viewable.height` (lines 324-325 of ImmichAdapter.mjs). The feed adapter's `#enrichWithExif` calls `getViewable()` but only extracts `capturedAt` and `location`. We need to also pass through `width`/`height`.

**Step 1: Write the failing test**

```js
// tests/isolated/adapter/feed/ImmichFeedAdapter.test.mjs
import { ImmichFeedAdapter } from '#adapters/feed/sources/ImmichFeedAdapter.mjs';

describe('ImmichFeedAdapter', () => {
  let adapter;
  const mockViewable = {
    width: 4032,
    height: 3024,
    metadata: {
      capturedAt: '2025-01-14T15:45:00.000Z',
      exif: { city: 'Seattle' },
    },
  };

  const mockContentRegistry = new Map([
    ['immich', {
      getViewable: jest.fn().mockResolvedValue(mockViewable),
      search: jest.fn().mockResolvedValue([]),
      getRandomMemories: jest.fn().mockResolvedValue([
        { id: 'asset1', localId: 'asset1', metadata: {} },
      ]),
    }],
  ]);

  beforeEach(() => {
    adapter = new ImmichFeedAdapter({
      contentRegistry: mockContentRegistry,
      logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    });
  });

  it('includes imageWidth and imageHeight from viewable', async () => {
    const query = { type: 'immich', tier: 'scrapbook', limit: 1 };
    const items = await adapter.fetchItems(query, 'testuser');

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].meta.imageWidth).toBe(4032);
    expect(items[0].meta.imageHeight).toBe(3024);
  });

  it('omits imageWidth/imageHeight when viewable lacks dimensions', async () => {
    mockContentRegistry.get('immich').getViewable.mockResolvedValueOnce({
      metadata: { capturedAt: '2025-01-14T15:45:00.000Z', exif: {} },
    });

    const query = { type: 'immich', tier: 'scrapbook', limit: 1 };
    const items = await adapter.fetchItems(query, 'testuser');

    expect(items[0].meta.imageWidth).toBeUndefined();
    expect(items[0].meta.imageHeight).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/ImmichFeedAdapter.test.mjs --verbose`
Expected: FAIL — `imageWidth` is undefined

**Step 3: Modify ImmichFeedAdapter.mjs**

In `#enrichWithExif` (lines 164-169), add width/height to the returned exif object:

```js
        return {
          item,
          exif: viewable?.metadata ? {
            capturedAt: viewable.metadata.capturedAt,
            location: viewable.metadata.exif?.city || null,
            imageWidth: viewable.width || null,
            imageHeight: viewable.height || null,
          } : null,
        };
```

In the item construction (around lines 56-61), spread the dimensions into meta:

```js
          meta: {
            location,
            originalDate: created,
            sourceName: 'Photos',
            sourceIcon: 'https://immich.app',
            ...(exif?.imageWidth && exif?.imageHeight
              ? { imageWidth: exif.imageWidth, imageHeight: exif.imageHeight }
              : {}),
          },
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/adapter/feed/ImmichFeedAdapter.test.mjs --verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/sources/ImmichFeedAdapter.mjs tests/isolated/adapter/feed/ImmichFeedAdapter.test.mjs
git commit -m "feat(feed): extract Immich image dimensions from viewable metadata"
```

---

## Task 6: RssHeadlineHarvester — Parse media:content Dimensions

**Files:**
- Modify: `backend/src/1_adapters/feed/RssHeadlineHarvester.mjs:97-110`
- Test: `tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs` (existing)

**Context:** RSS `media:content` elements often include `width` and `height` attributes in their `$` metadata. The `rss-parser` library exposes these as `m['$'].width` and `m['$'].height`. Currently `#extractImage` only reads `url`.

**Step 1: Add test to existing test file**

```js
it('includes imageWidth and imageHeight from media:content attributes', async () => {
  mockRssParser.parseURL.mockResolvedValue({
    items: [{
      title: 'Test Article',
      link: 'https://example.com/article',
      isoDate: '2026-01-01T00:00:00Z',
      'media:content': [{
        '$': {
          url: 'https://example.com/image.jpg',
          type: 'image/jpeg',
          width: '1200',
          height: '630',
        },
      }],
    }],
  });

  const result = await harvester.harvest({ id: 'test', label: 'Test', url: 'https://example.com/rss' });
  expect(result.items[0].image).toBe('https://example.com/image.jpg');
  expect(result.items[0].imageWidth).toBe(1200);
  expect(result.items[0].imageHeight).toBe(630);
});

it('omits imageWidth/imageHeight when media:content lacks dimensions', async () => {
  mockRssParser.parseURL.mockResolvedValue({
    items: [{
      title: 'No Dims Article',
      link: 'https://example.com/article2',
      isoDate: '2026-01-01T00:00:00Z',
      'media:content': [{
        '$': { url: 'https://example.com/image2.jpg', type: 'image/jpeg' },
      }],
    }],
  });

  const result = await harvester.harvest({ id: 'test', label: 'Test', url: 'https://example.com/rss' });
  expect(result.items[0].image).toBe('https://example.com/image2.jpg');
  expect(result.items[0].imageWidth).toBeUndefined();
  expect(result.items[0].imageHeight).toBeUndefined();
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs --verbose`
Expected: FAIL

**Step 3: Modify RssHeadlineHarvester.mjs**

Change `#extractImage` to return an object with url and optional dimensions:

```js
  #extractImageWithDims(item) {
    const mediaContent = item['media:content'];
    if (Array.isArray(mediaContent)) {
      const img = mediaContent.find(m => m?.['$']?.type?.startsWith('image/') || m?.['$']?.url);
      if (img?.['$']?.url) {
        const w = parseInt(img['$'].width, 10);
        const h = parseInt(img['$'].height, 10);
        return {
          url: img['$'].url,
          ...(w > 0 && h > 0 ? { width: w, height: h } : {}),
        };
      }
    }
    const thumb = item['media:thumbnail'];
    if (thumb?.['$']?.url) {
      const w = parseInt(thumb['$'].width, 10);
      const h = parseInt(thumb['$'].height, 10);
      return {
        url: thumb['$'].url,
        ...(w > 0 && h > 0 ? { width: w, height: h } : {}),
      };
    }
    if (item.enclosure?.url && item.enclosure?.type?.startsWith('image/')) {
      return { url: item.enclosure.url };
    }
    return null;
  }
```

Update the harvest loop (lines 38-39) to use the new method:

```js
            const imageData = this.#extractImageWithDims(item);
            if (imageData) {
              entry.image = imageData.url;
              if (imageData.width) entry.imageWidth = imageData.width;
              if (imageData.height) entry.imageHeight = imageData.height;
            }
```

Remove the old `#extractImage` method.

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs --verbose`
Expected: PASS (all existing + new tests)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/RssHeadlineHarvester.mjs tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs
git commit -m "feat(feed): extract image dimensions from RSS media:content attributes"
```

---

## Task 7: FeedAssemblyService — Pass Through Dimensions + Probe FreshRSS

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs:300-324,406-427`
- Test: `tests/isolated/application/feed/FeedAssemblyService.test.mjs` (existing)

**Context:** Two changes needed:
1. `#normalizeToFeedItem` must pass through `imageWidth`/`imageHeight` from `raw.meta`
2. `#fetchFreshRSS` must probe image dimensions via `probeImageDimensions`

**Step 1: Add tests to existing test file**

```js
describe('image dimensions', () => {
  it('passes through imageWidth/imageHeight from adapter meta', async () => {
    const mockAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue([{
        id: 'reddit:abc',
        tier: 'wire',
        source: 'reddit',
        title: 'Test',
        image: '/api/v1/proxy/reddit/i.redd.it/abc.jpg',
        timestamp: new Date().toISOString(),
        meta: { sourceName: 'r/test', imageWidth: 1920, imageHeight: 1080 },
      }]),
    };

    // Construct service with this adapter, call getNextBatch, check items
    // Use the existing test's constructor pattern
    const result = await service.getNextBatch('testuser');
    expect(result.items[0].meta.imageWidth).toBe(1920);
    expect(result.items[0].meta.imageHeight).toBe(1080);
  });
});
```

For FreshRSS probing, add a test that mocks `probeImageDimensions`:

```js
  it('probes FreshRSS image dimensions when image URL present', async () => {
    // Mock freshRSSAdapter.getItems to return an item with image URL
    // Mock probeImageDimensions to return { width: 800, height: 600 }
    // Verify the assembled item has meta.imageWidth=800, meta.imageHeight=600
  });
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/FeedAssemblyService.test.mjs --verbose`
Expected: FAIL

**Step 3: Modify FeedAssemblyService.mjs**

Import the probe utility at the top:

```js
import { probeImageDimensions } from '../../0_system/utils/probeImageDimensions.mjs';
```

In `#normalizeToFeedItem` (line 411-427), the meta spread already passes through all `raw.meta` keys via `...raw.meta`. Since adapters now set `imageWidth`/`imageHeight` in their meta objects, these will flow through automatically. **No change needed here** — verify with a test.

In `#fetchFreshRSS` (lines 300-324), after the `.map()` call, add dimension probing:

```js
    // Probe image dimensions in parallel (cached by feedCacheService)
    await Promise.all(items.map(async (item) => {
      if (!item.image) return;
      const dims = await probeImageDimensions(item.image);
      if (dims) {
        item.meta = { ...item.meta, imageWidth: dims.width, imageHeight: dims.height };
      }
    }));
```

Insert this after the `items` array is built (after the `.map()` call on line 307) and before the `return` statement.

Also in `#fetchHeadlines` (lines 326-365), pass through `imageWidth`/`imageHeight` from headline items:

```js
          image: item.image || null,
          // ... in meta:
          ...(item.imageWidth && item.imageHeight
            ? { imageWidth: item.imageWidth, imageHeight: item.imageHeight }
            : {}),
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/feed/FeedAssemblyService.test.mjs --verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs tests/isolated/application/feed/FeedAssemblyService.test.mjs
git commit -m "feat(feed): pass through image dimensions and probe FreshRSS images"
```

---

## Task 8: FeedCard Frontend — Aspect-Ratio Placeholders

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx:435-468`

**Context:** The image block currently has no reserved height. Add `aspect-ratio` to the wrapper div using `meta.imageWidth` / `meta.imageHeight`, with a `16 / 9` fallback. The existing `.feed-card-image { max-height: calc(100cqi * 16 / 9) }` CSS cap in `Scroll.scss` (line 39-43) remains unchanged.

**Step 1: Modify FeedCard.jsx**

Replace the image block (lines 435-468):

```jsx
      {/* Hero image */}
      {item.image && (
        <div style={{
          overflow: 'hidden',
          position: 'relative',
          aspectRatio: (item.meta?.imageWidth && item.meta?.imageHeight)
            ? `${item.meta.imageWidth} / ${item.meta.imageHeight}`
            : '16 / 9',
          backgroundColor: '#1a1b1e',
        }}>
          <img
            src={item.image}
            alt=""
            className="feed-card-image"
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              objectFit: 'cover',
            }}
          />
          {/* Play button overlay */}
          {(item.source === 'plex' || item.meta?.youtubeId) && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          )}
        </div>
      )}
```

Key changes from original:
- Wrapper `<div>` gains `aspectRatio` and `backgroundColor`
- `<img>` gains `height: '100%'` to fill the aspect-ratio container

**Step 2: Visual verification**

Run the dev server and load the feed scroll. Verify:
1. Cards with images show a dark placeholder of the correct aspect ratio before image loads
2. No layout shift when images pop in
3. The existing 9:16 max-height cap still works for tall portrait images
4. Play button overlay still appears on Plex/YouTube items

**Step 3: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx
git commit -m "feat(feed): add aspect-ratio placeholders to FeedCard images"
```

---

## Task 9: Integration Verification

**Step 1: Run all existing feed tests**

```bash
npx jest tests/isolated/adapter/feed/ tests/isolated/application/feed/ tests/isolated/domain/feed/ tests/isolated/api/feed/ --verbose
```

Expected: All PASS (existing tests unbroken + new dimension tests pass)

**Step 2: Run the Playwright scroll test**

```bash
npx playwright test tests/live/flow/feed/feed-scroll-infinite.runtime.test.mjs
```

Expected: PASS (cards still render, infinite scroll still works)

**Step 3: Manual smoke test**

With dev server running, open the feed scroll and check:
- Reddit cards show correct aspect ratio before image loads
- YouTube cards show 480x360 (4:3) aspect ratio
- Komga cards show 16:9 aspect ratio
- Immich photo cards show their actual aspect ratio
- FreshRSS cards with images show probed dimensions
- Cards without images render unchanged
- No visible layout shift on initial load or infinite scroll pagination

**Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix(feed): integration fixups for image dimensions"
```
