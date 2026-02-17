# Komga Composite Hero Image

**Date:** 2026-02-16
**Status:** Design

## Problem

Komga feed cards currently show a single article page as the hero image. This lacks context — the reader can't tell which magazine or issue the article comes from at a glance.

## Solution

Generate a composite 16:9 (1280×720) hero image that shows three images side by side: the magazine cover, the article's start page, and the next page. The rightmost page is naturally cropped to fit the 16:9 frame. The composite is generated on-demand by the backend using `node-canvas` and cached to disk as JPEG.

## Architecture

### Endpoint

```
GET /api/v1/proxy/komga/composite/:bookId/:page
```

Returns a JPEG image. On first request, fetches source images from Komga, composites them, caches to disk. Subsequent requests serve from cache.

### Data Flow

```
Frontend <img>  →  /proxy/komga/composite/{bookId}/{page}
                        │
                        ├─ Check disk cache: common/komga/hero/{bookId}-{page}.jpg
                        │   └─ If exists → serve cached JPEG
                        │
                        ├─ Fetch 3 images from Komga (authenticated, parallel):
                        │   1. /api/v1/books/{bookId}/thumbnail    (cover)
                        │   2. /api/v1/books/{bookId}/pages/{page}  (article page)
                        │   3. /api/v1/books/{bookId}/pages/{page+1} (next page)
                        │
                        ├─ Composite with CanvasService:
                        │   - Canvas: 1280×720
                        │   - Scale each image to height=720, preserve aspect ratio
                        │   - Place left-to-right at x=0, x=w1, x=w1+w2
                        │   - Natural right-edge crop at x=1280
                        │
                        └─ Cache to disk → serve JPEG
```

### Source Images

| Position | Komga URL | Purpose |
|----------|-----------|---------|
| Left | `/api/v1/books/{bookId}/thumbnail` | Magazine cover |
| Center | `/api/v1/books/{bookId}/pages/{page}` | Article start page |
| Right | `/api/v1/books/{bookId}/pages/{page+1}` | Next page (cropped) |

### Compositing Rules

- Canvas dimensions: **1280×720** (16:9)
- Each image scaled proportionally to **height = 720px**
- Images placed left-to-right, no gaps
- Right edge naturally clips at x=1280
- Output: JPEG, quality 85

### Edge Cases

- **page+1 doesn't exist** (last page): Show cover + single article page
- **Cover fetch fails**: Show just the 2 article pages
- **All fetches fail**: Return 502 error

### Cache

- Path: `common/komga/hero/{bookId}-{page}.jpg` (via DataService household)
- No TTL — cached permanently (magazine pages don't change)
- Cache key includes page number so different articles from the same book get unique composites

## Changes Required

### Modified Files

| File | Change |
|------|--------|
| `backend/src/4_api/v1/routers/proxy.mjs` | Add `GET /proxy/komga/composite/:bookId/:page` route handler |
| `backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs` | Change `image` URL from single-page to composite URL pattern |
| `backend/src/0_system/canvas/CanvasService.mjs` | Add `loadImage` convenience re-export from `canvas` package |

### KomgaFeedAdapter Change

In `#fetchOneSeries()`, change the image URL from:
```js
const imageUrl = this.#pageImageUrl(bookId, pageNum);
```
to:
```js
const imageUrl = `/api/v1/proxy/komga/composite/${bookId}/${pageNum}`;
```

### Proxy Route Handler

New route in `proxy.mjs` that:
1. Checks disk cache for `common/komga/hero/{bookId}-{page}.jpg`
2. If cached, streams the file with `Content-Type: image/jpeg`
3. If not cached:
   - Fetches 3 images from Komga in parallel (using `X-API-Key` auth from KomgaProxyAdapter config)
   - Uses `CanvasService.createWithContext(1280, 720)` + `loadImage()` from `canvas` package
   - Draws images left-to-right at scaled height
   - Exports canvas as JPEG buffer
   - Writes to cache path
   - Responds with the buffer

### CanvasService Addition

Re-export `loadImage` from `canvas` package so the proxy route can load images from buffers:
```js
import { loadImage } from 'canvas';
export { loadImage };
```

## Test Impact

- `tests/isolated/adapter/content/KomgaAdapter.test.mjs` — **unaffected** (tests content adapter, not feed adapter)
- Feed adapter tests (if any) — update `image` field assertion to match composite URL pattern

### New Tests Needed

- Unit test: composite generation (mock 3 image fetches, verify canvas output is 1280×720 JPEG)
- Integration test: `GET /proxy/komga/composite/:bookId/:page` returns `Content-Type: image/jpeg`
