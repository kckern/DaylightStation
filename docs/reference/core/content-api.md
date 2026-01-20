# Content Domain API Reference

## Overview

The Content Domain provides a unified API for accessing media from multiple sources (Plex, filesystem, local content). All endpoints use compound IDs in the format `source:localId`.

## Base URL

```
/api/content - General content operations
/api/play    - Playable item info
/api/list    - Container browsing
/api/local-content - Scripture, hymns, talks, poetry
/proxy       - Media streaming
```

## Compound ID Format

All items use compound IDs:
- `plex:12345` - Plex item by rating key
- `filesystem:audio/music/song.mp3` - Filesystem path
- `folder:Morning Program` - Named folder
- `talk:general/talk-id` - Local talk
- `scripture:cfm/1nephi1` - Scripture chapter
- `hymn:113` - Hymn by number
- `poem:remedy/01` - Poetry item

---

## Play API

### GET /api/play/:source/*

Get playable item information with media URL.

**Path Parameters:**
- `source` - Adapter name (plex, filesystem, local-content)
- `*` - Local ID within the source

**Path Modifiers:**
- `/shuffle` - Get random item from container

**Response:**
```json
{
  "id": "plex:12345",
  "media_key": "plex:12345",
  "media_url": "/proxy/plex/stream/12345",
  "media_type": "video",
  "title": "Movie Title",
  "duration": 7200,
  "resumable": true,
  "resume_position": 3600,
  "thumbnail": "/proxy/plex/thumb/12345"
}
```

---

## List API

### GET /api/list/:source/*

List contents of a container.

**Path Modifiers:**
- `/playable` - Flatten to playable items only
- `/shuffle` - Randomize order
- `/recent_on_top` - Sort by access time

**Response:**
```json
{
  "source": "folder",
  "path": "Morning Program",
  "title": "Morning Program",
  "image": "/img/morning.jpg",
  "items": [
    {
      "id": "plex:12345",
      "title": "Show One",
      "itemType": "container",
      "thumbnail": "/proxy/plex/thumb/12345"
    }
  ]
}
```

---

## Content API

### GET /api/content/item/:source/*

Get item metadata.

### GET /api/content/list/:source/*

Browse container (alias for /api/list).

### POST /api/content/progress/:source/*

Update watch progress.

**Body:**
```json
{
  "seconds": 3600,
  "duration": 7200
}
```

**Response:**
```json
{
  "itemId": "plex:12345",
  "playhead": 3600,
  "duration": 7200,
  "percent": 50,
  "watched": false
}
```

---

## LocalContent API

### GET /api/local-content/scripture/*

Get scripture chapter with verses.

**Response:**
```json
{
  "reference": "1 Nephi 1",
  "media_key": "scripture:cfm/1nephi1",
  "mediaUrl": "/proxy/local-content/stream/scripture/cfm/1nephi1",
  "duration": 360,
  "verses": [
    { "num": 1, "text": "...", "start": 0, "end": 15 }
  ]
}
```

### GET /api/local-content/hymn/:number

Get hymn with lyrics.

**Response:**
```json
{
  "title": "Our Savior's Love",
  "number": 113,
  "media_key": "hymn:113",
  "mediaUrl": "/proxy/local-content/stream/hymn/113",
  "duration": 240,
  "lyrics": [
    { "num": 1, "text": "...", "start": 0, "end": 60 }
  ]
}
```

### GET /api/local-content/primary/:number

Get primary song with lyrics.

**Response:**
```json
{
  "title": "I Am a Child of God",
  "number": 2,
  "media_key": "primary:2",
  "mediaUrl": "/proxy/local-content/stream/primary/2",
  "duration": 180,
  "lyrics": [
    { "num": 1, "text": "...", "start": 0, "end": 45 }
  ]
}
```

### GET /api/local-content/talk/*

Get talk with paragraphs.

**Response:**
```json
{
  "title": "Talk Title",
  "speaker": "Speaker Name",
  "media_key": "talk:general/talk-id",
  "mediaUrl": "/proxy/local-content/stream/talk/general/talk-id",
  "duration": 1200,
  "paragraphs": [
    { "num": 1, "text": "...", "start": 0, "end": 30 }
  ]
}
```

### GET /api/local-content/poem/*

Get poem with stanzas.

**Response:**
```json
{
  "title": "Poem Title",
  "author": "Author Name",
  "media_key": "poem:remedy/01",
  "mediaUrl": "/proxy/local-content/stream/poem/remedy/01",
  "duration": 180,
  "stanzas": [
    { "num": 1, "text": "...", "start": 0, "end": 30 }
  ]
}
```

---

## Proxy API

### GET /proxy/:source/stream/*

Stream media file. Supports range requests for seeking.

**Headers:**
- `Content-Type` - Media MIME type
- `Accept-Ranges: bytes`
- `Content-Length`

**Range Requests:**
- Request: `Range: bytes=0-1000`
- Response: 206 with `Content-Range: bytes 0-1000/50000`

### GET /proxy/:source/thumb/*

Get thumbnail image.

### GET /proxy/local-content/stream/:type/*

Stream local content media.

**Type values:** `scripture`, `hymn`, `primary`, `talk`, `poem`

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message",
  "source": "plex",
  "localId": "12345"
}
```

**Status Codes:**
- 200 - Success
- 206 - Partial content (range request)
- 400 - Bad request (invalid parameters)
- 404 - Not found (item or source)
- 500 - Internal error

---

## Related Code

- `backend/src/4_api/routers/play.mjs` - Play API router
- `backend/src/4_api/routers/list.mjs` - List API router
- `backend/src/4_api/routers/content.mjs` - Content API router
- `backend/src/4_api/routers/localContent.mjs` - LocalContent API router
- `backend/src/4_api/routers/proxy.mjs` - Proxy API router
- `backend/src/1_domains/content/` - Domain entities and ports
- `backend/src/2_adapters/content/` - Source adapters
