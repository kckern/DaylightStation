# Local Content Cover Art Design

**Date:** 2026-01-21
**Status:** Approved

## Overview

Add ID3 cover art extraction to the DDD backend, with dynamic placeholder generation for files without embedded art.

## Endpoint

```
GET /api/v1/local-content/cover/{media_key}
```

**Behavior:**
1. Resolve `{media_key}` to filesystem path (e.g., `sfx/intro` → `/media/audio/sfx/intro.mp3`)
2. Parse MP3 with `music-metadata`, extract embedded `picture`
3. If found: return image buffer with correct `Content-Type`
4. If not found: generate 500x500 dark placeholder PNG with path text

**Response headers:**
```
Content-Type: image/jpeg (or image/png for placeholder)
Content-Length: {size}
Cache-Control: public, max-age=86400
```

## Architecture

### Layer Placement

- **Adapter layer** (`2_adapters`): `FilesystemAdapter.getCoverArt(mediaKey)` handles extraction
- **Infrastructure** (`0_infrastructure`): `placeholderImage.mjs` generates fallback images
- **API** (`4_api`): `localContent.mjs` exposes the endpoint

### FilesystemAdapter Extension

```javascript
/**
 * Extract cover art from media file
 * @param {string} mediaKey - e.g., "sfx/intro"
 * @returns {Promise<{buffer: Buffer, mimeType: string} | null>}
 */
async getCoverArt(mediaKey) {
  const filePath = this.resolveMediaPath(mediaKey);
  if (!filePath) return null;

  try {
    const { common: { picture } } = await parseFile(filePath);
    if (picture?.length) {
      return {
        buffer: Buffer.from(picture[0].data),
        mimeType: picture[0].format
      };
    }
  } catch (err) {
    this.logger?.warn('cover-art.parse-failed', { mediaKey, error: err.message });
  }

  return null;
}
```

### Placeholder Generator

New utility: `backend/src/0_infrastructure/utils/placeholderImage.mjs`

```javascript
import { createCanvas, registerFont } from 'canvas';
import path from 'path';

const fontPath = path.join(process.env.path?.media || '/data/media', 'fonts/RobotoCondensed-Regular.ttf');
try {
  registerFont(fontPath, { family: 'Roboto Condensed' });
} catch (err) {
  console.warn('Failed to register Roboto Condensed font:', err.message);
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

  // Scale font to fit
  let fontSize = 32;
  ctx.font = `${fontSize}px "Roboto Condensed"`;
  while (ctx.measureText(displayText).width > SIZE - 40 && fontSize > 12) {
    fontSize -= 2;
    ctx.font = `${fontSize}px "Roboto Condensed"`;
  }

  ctx.fillText(displayText, SIZE / 2, SIZE / 2);

  return canvas.toBuffer('image/png');
}
```

### Router Endpoint

Add to `backend/src/4_api/routers/localContent.mjs`:

```javascript
router.get('/cover/*', async (req, res) => {
  const mediaKey = req.params[0] || '';

  if (!mediaKey) {
    return res.status(400).json({ error: 'No media key provided' });
  }

  const adapter = registry.get('filesystem');
  if (!adapter) {
    return res.status(500).json({ error: 'Filesystem adapter not configured' });
  }

  const coverArt = await adapter.getCoverArt(mediaKey);

  if (coverArt) {
    res.set({
      'Content-Type': coverArt.mimeType,
      'Content-Length': coverArt.buffer.length,
      'Cache-Control': 'public, max-age=86400'
    });
    return res.send(coverArt.buffer);
  }

  const placeholder = generatePlaceholderImage(mediaKey);
  res.set({
    'Content-Type': 'image/png',
    'Content-Length': placeholder.length,
    'Cache-Control': 'public, max-age=86400'
  });
  return res.send(placeholder);
});
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Endpoint path | `/api/v1/local-content/cover/*` | Follows DDD domain grouping |
| Layer placement | FilesystemAdapter | Adapters handle external data sources |
| Caching | None | YAGNI - covers requested infrequently, parseFile is fast |
| Missing cover fallback | Generated placeholder | More informative than static 404 image |
| Placeholder style | 500x500, dark (#1a1a1a), white Roboto Condensed text | Blends with media player UIs |

## Files to Change

| File | Action |
|------|--------|
| `backend/src/0_infrastructure/utils/placeholderImage.mjs` | Create |
| `backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs` | Modify - add `getCoverArt()` |
| `backend/src/4_api/routers/localContent.mjs` | Modify - add `/cover/*` route |
| `{mediaPath}/fonts/RobotoCondensed-Regular.ttf` | Add font file |

## Dependencies

- `canvas` - already in package.json (used by thermal printer)
- `music-metadata` - already in package.json (used by localContent)
