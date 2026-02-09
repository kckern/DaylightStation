# LocalMediaAdapter Reference

Browses configured filesystem paths as content sources, providing direct access to local media files without external service dependencies.

**Location:** `backend/src/1_adapters/content/media/local-media/LocalMediaAdapter.mjs`

---

## Overview

LocalMediaAdapter exposes local filesystem directories as browsable content sources. Unlike FilesystemAdapter (which handles raw file access), LocalMediaAdapter:

- Uses configured "roots" from household config
- Generates thumbnails on-demand
- Supports search across configured paths
- Integrates with ContentSourceRegistry

| Property | Value |
|----------|-------|
| Source name | `local` |
| Prefixes | `local:` |
| Category | `media` |
| Provider | `local` |

---

## Configuration

### Household Config

Create `data/household/config/local-media.yml`:

```yaml
roots:
  - path: video/clips
    label: Video Clips
    mediaType: video
  - path: img/art
    label: Artwork
    mediaType: image
  - path: audio/scripture
    label: Scripture Audio
    mediaType: audio
```

| Field | Required | Description |
|-------|----------|-------------|
| `path` | Yes | Relative path from media mount |
| `label` | Yes | Display name for the root |
| `mediaType` | No | Hint: `video`, `audio`, `image` |

---

## API Endpoints

All endpoints mounted at `/api/v1/local/`.

### GET /roots

Returns configured media roots.

**Response:**
```json
{
  "roots": [
    { "path": "video/clips", "label": "Video Clips", "mediaType": "video" }
  ]
}
```

### GET /browse/*path

Browse folder contents.

**Examples:**
```bash
# Get configured roots as containers
curl /api/v1/local/browse/

# Browse specific folder
curl /api/v1/local/browse/video/clips
```

**Response:**
```json
{
  "path": "video/clips",
  "items": [
    {
      "id": "local:video/clips/intro.mp4",
      "source": "local",
      "title": "intro",
      "itemType": "leaf",
      "metadata": {
        "category": "media",
        "mediaType": "video",
        "size": 1652631,
        "mimeType": "video/mp4"
      }
    }
  ]
}
```

### GET /stream/*path

Stream media file with range request support.

**Headers returned:**
- `Content-Type`: Appropriate MIME type
- `Accept-Ranges: bytes`
- `Content-Length`: File size
- `Cache-Control: public, max-age=31536000`

**Range request support:** Yes (for seeking)

### GET /thumbnail/*path

On-demand thumbnail generation.

**Behavior:**
- **Images:** Returns original (future: resized via sharp)
- **Videos:** Generates frame via ffmpeg, caches result
- **Cache:** `{dataMount}/system/cache/thumbnails/{hash}.jpg`
- **Hash:** MD5 of `{filepath}:{mtime}` (invalidates on file change)

### GET /search?q=text

Search local media files by filename.

**Note:** Only searches within configured roots. Returns empty if no roots configured.

**Response:**
```json
{
  "query": "intro",
  "results": [...],
  "count": 3
}
```

### POST /reindex

Force metadata cache rebuild.

**Response:**
```json
{
  "message": "Reindex complete",
  "roots": 3,
  "files": 150
}
```

---

## ID Format

```
local:{relative-path}
```

**Examples:**
- `local:video/clips` - folder
- `local:video/clips/intro.mp4` - file
- `local:audio/ambient/001.mp3` - audio file

---

## Item Structure

### Container (folder)

```javascript
{
  id: 'local:video/clips',
  source: 'local',
  title: 'clips',
  itemType: 'container',
  childCount: 26,
  metadata: {
    category: 'container',
    path: 'video/clips'
  }
}
```

### Leaf (file)

```javascript
{
  id: 'local:video/clips/intro.mp4',
  source: 'local',
  title: 'intro',
  itemType: 'leaf',
  mediaType: 'video',
  mediaUrl: '/api/v1/local/stream/video/clips/intro.mp4',
  metadata: {
    category: 'media',
    mediaType: 'video',
    path: 'video/clips',
    size: 12345678,
    mimeType: 'video/mp4',
    modifiedAt: '2026-01-15T...'
  }
}
```

---

## Supported Media Types

| Extension | Media Type | MIME Type |
|-----------|------------|-----------|
| `.mp3` | audio | audio/mpeg |
| `.m4a` | audio | audio/mp4 |
| `.wav` | audio | audio/wav |
| `.flac` | audio | audio/flac |
| `.ogg` | audio | audio/ogg |
| `.mp4` | video | video/mp4 |
| `.webm` | video | video/webm |
| `.mkv` | video | video/x-matroska |
| `.avi` | video | video/x-msvideo |
| `.mov` | video | video/quicktime |
| `.jpg/.jpeg` | image | image/jpeg |
| `.png` | image | image/png |
| `.gif` | image | image/gif |
| `.webp` | image | image/webp |

---

## Security

- Path traversal protection: All paths validated to stay within `mediaBasePath`
- Normalized paths: `..` sequences stripped
- Resolved path check: `path.resolve()` must start with base path

---

## Dependencies

- **ffmpeg:** Required for video thumbnail generation
- **ConfigService:** Optional, for reading household config
- **MediaProgressMemory:** Optional, for watch state

---

## See Also

- [Content Stack Reference](./content-stack-reference.md) - Overall content architecture
- [ListAdapter](./list-adapter.md) - Menus/programs/watchlists as content
- [FilesystemAdapter](../../core/layers-of-abstraction/adapter-layer.md) - Raw file access
