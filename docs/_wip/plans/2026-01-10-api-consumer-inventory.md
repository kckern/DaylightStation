# API Consumer Inventory - Frontend Impact Analysis

This document catalogs all frontend consumers of backend APIs that would be affected by the Unified Domain-Driven Backend Architecture migration.

## Summary

| Category | Files Affected | API Patterns |
|----------|----------------|--------------|
| List/Menu Data | 6 | `data/list/{key}`, `media/plex/list/{id}` |
| Media Info | 3 | `media/plex/info/{id}`, `media/info/{key}` |
| Playback Logging | 3 | `media/log` |
| Content Scrollers | 1 | `data/scripture/`, `data/talk/`, `data/poetry/` |
| Static Media | 15+ | `/media/img/`, `/media/plex/img/` |

---

## 1. List/Menu Data Consumers

### 1.1 `frontend/src/modules/Player/lib/api.js`

**Functions:** `flattenQueueItems()`, `initializeQueue()`

**API Calls:**
```javascript
// Line 18 - Nested playlist resolution
DaylightAPI(`data/list/${queueKey}/playable${shuffle ? ',shuffle' : ''}`)

// Line 22 - Plex queue resolution
DaylightAPI(`media/plex/list/${item.queue.plex}/playable${shuffle ? ',shuffle' : ''}`)

// Line 99 - Queue initialization
DaylightAPI(`data/list/${queue_media_key}/playable${shuffle ? ',shuffle' : ''}`)
```

**Response Shape Expected:**
```typescript
interface ListResponse {
  items: Array<{
    play?: { plex?: string; media?: string };
    queue?: { plex?: string; playlist?: string; shuffle?: boolean };
    label?: string;
    active?: boolean;
    // ... other item properties
  }>;
}
```

**Migration Impact:** HIGH - Core playback queue resolution

---

### 1.2 `frontend/src/modules/Player/hooks/useQueueController.js`

**API Calls:**
```javascript
// Line 85 - Queue resolution by media key
DaylightAPI(`data/list/${queue_media_key}/playable${isShuffle ? ',shuffle' : ''}`)

// Line 90 - Plex queue resolution
DaylightAPI(`media/plex/list/${plexId}/playable${isShuffle ? ',shuffle' : ''}`)
```

**Migration Impact:** HIGH - Queue state management

---

### 1.3 `frontend/src/modules/Menu/Menu.jsx`

**Function:** `useListData()` hook (lines 258-260)

**API Calls:**
```javascript
// Line 259 - Menu data fetch
DaylightAPI(`data/list/${target}${config ? `/${config}` : ""}`)
```

**Input Parsing (lines 304-310):**
```javascript
const { menu, list, plex, shuffle, playable } = input;
const config = [];
if (shuffle) config.push("shuffle");
if (playable) config.push("playable");
```

**Response Shape Expected:**
```typescript
interface MenuResponse {
  title?: string;
  label?: string;
  image?: string;
  kind?: string;
  items: MenuItem[];
}
```

**Migration Impact:** HIGH - All menu navigation

---

### 1.4 `frontend/src/modules/Menu/PlexMenuRouter.jsx`

**API Calls:**
```javascript
// Line 109 - Plex data via data/list
DaylightAPI(`data/list/${plexId}`)
```

**Migration Impact:** MEDIUM - Plex menu navigation

---

### 1.5 `frontend/src/modules/Menu/hooks/useFetchPlexData.js`

**API Calls:**
```javascript
// Line 29 - Rich Plex data fetch
DaylightAPI(`media/plex/list/${plexId}`)
```

**Response Shape Expected:**
```typescript
interface PlexListResponse {
  plex: string;
  title: string;
  image: string;
  info?: {
    key: string;
    type: string;
    title: string;
    summary?: string;
    year?: number;
    labels?: string[];
    collections?: string[];
    image: string;
  };
  seasons?: Record<string, {
    num: number;
    title: string;
    img: string;
    summary?: string;
  }>;
  items: PlexItem[];
}
```

**Migration Impact:** MEDIUM - Plex browsing UI

---

### 1.6 `frontend/src/Apps/TVApp.jsx`

**API Calls:**
```javascript
// Line 70 - TV App menu load
DaylightAPI("data/list/TVApp/recent_on_top")
```

**Migration Impact:** HIGH - TV App home screen

---

## 2. Media Info Consumers

### 2.1 `frontend/src/modules/Player/lib/api.js`

**Function:** `fetchMediaInfo()`

**API Calls:**
```javascript
// Line 70 - Plex media info
DaylightAPI(`media/plex/info/${plex}/shuffle`)  // or without /shuffle
DaylightAPI(`media/plex/info/${plex}?maxVideoBitrate=...&maxResolution=...`)

// Line 75 - Filesystem media info
DaylightAPI(`media/info/${media}?shuffle=...`)
```

**Response Shape Expected:**
```typescript
interface MediaInfoResponse {
  plex?: string;
  media_key: string;
  media_url: string;
  media_type: 'audio' | 'video' | 'dash_video';
  title?: string;
  duration?: number;
  // Plex-specific
  show?: string;
  episode?: string;
  season?: string;
  // ...
}
```

**Migration Impact:** CRITICAL - All media playback

---

### 2.2 `frontend/src/modules/Player/components/DebugInfo.jsx`

**API Calls:**
```javascript
// Line 33 - Debug check
DaylightMediaPath(`/media/plex/info/${plexId}`)
```

**Migration Impact:** LOW - Debug only

---

## 3. Playback Logging Consumers

### 3.1 `frontend/src/modules/Player/hooks/useCommonMediaController.js`

**API Calls:**
```javascript
// Line 426 - Progress logging
DaylightAPI('media/log', logPayload)
```

**Payload Shape:**
```typescript
interface LogPayload {
  title: string;
  type: 'plex' | 'media' | string;
  media_key: string;
  seconds: number;
  percent: number;
  watched_duration?: number;
}
```

**Migration Impact:** HIGH - Watch state tracking

---

### 3.2 `frontend/src/modules/ContentScroller/ContentScroller.jsx`

**API Calls:**
```javascript
// Line 151 - Content scroller progress
DaylightAPI(`media/log`, { title, type, media_key, seconds, percent })
```

**Migration Impact:** MEDIUM - Scripture/Talk/Poetry tracking

---

### 3.3 `frontend/src/lib/Player/useMediaKeyboardHandler.js`

**API Calls:**
```javascript
// Line 140-141 - Keyboard-triggered logging
DaylightAPI('media/log', { title, type: logType, media_key, seconds, percent })
DaylightAPI('harvest/watchlist')
```

**Migration Impact:** MEDIUM - Keyboard shortcuts

---

## 4. Content Scroller Consumers

### 4.1 `frontend/src/modules/ContentScroller/ContentScroller.jsx`

**API Calls:**
```javascript
// Line 447 - Scripture fetch
DaylightAPI(`data/scripture/${scripture}`)

// Line 558 - Hymn/Primary fetch
DaylightAPI(path)  // e.g., data/hymn/113 or data/primary/228

// Line 777 - Talk fetch
DaylightAPI(`data/talk/${talk}`)

// Line 911 - Poetry fetch
DaylightAPI(`data/poetry/${poem_id}`)
```

**Response Shapes:**
```typescript
interface ScriptureResponse {
  reference: string;
  media_key: string;
  mediaUrl: string;
  verses: VerseData[];
}

interface TalkResponse {
  title: string;
  speaker: string;
  media_key: string;
  mediaUrl: string;
  content: ParagraphData[];
}

interface PoetryResponse {
  title: string;
  author: string;
  condition?: string;
  also_suitable_for?: string[];
  poem_id: string;
  verses: StanzaData[];
  duration?: number;
}
```

**Migration Impact:** MEDIUM - LocalContent playback

---

## 5. Fitness Module Consumers

### 5.1 `frontend/src/modules/Fitness/FitnessShow.jsx`

**API Calls:**
```javascript
// Line 248 - Episode list for fitness shows
DaylightAPI(`/media/plex/list/${showId}/playable`)
```

**Migration Impact:** MEDIUM - Fitness video selection

---

### 5.2 `frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx`

**API Calls:**
```javascript
// Line 193 - Music playlist fetch
DaylightAPI(`/media/plex/list/${selectedPlaylistId}/playable,shuffle`)
```

**Migration Impact:** MEDIUM - Fitness music

---

### 5.3 `frontend/src/modules/Fitness/FitnessMenu.jsx`

**API Calls:**
```javascript
// Line 183 - Collection fetch
DaylightAPI(`/media/plex/list/${collectionId}`)
```

**Migration Impact:** MEDIUM - Fitness menu browsing

---

### 5.4 `frontend/src/modules/Fitness/FitnessPlayer.jsx`

**API Calls:**
```javascript
// Line 818 - Progress logging
DaylightAPI('media/log', {...})
```

**Migration Impact:** MEDIUM - Fitness watch tracking

---

## 6. Static Media Paths (Image References)

These use `DaylightMediaPath()` helper for static assets:

| Component | Path Pattern | Count |
|-----------|--------------|-------|
| User avatars | `/media/img/users/{userId}` | 15+ |
| Equipment icons | `/media/img/equipment/{id}` | 8+ |
| Plex thumbnails | `/media/plex/img/{plexId}` | 3+ |
| Art images | `/media/img/art/{path}` | 2 |
| Entropy icons | `/media/img/entropy/{icon}` | 1 |

**Migration Impact:** LOW - Static file serving unchanged

---

## 7. Config/Modifier Patterns Used

The frontend passes these modifiers via URL path segments:

| Modifier | Usage | Files |
|----------|-------|-------|
| `playable` | Filter to playable items only | 6 |
| `shuffle` | Randomize order | 6 |
| `recent_on_top` | Sort by access time | 1 |

**Current Pattern:**
```javascript
`data/list/${key}/playable,shuffle`
`media/plex/list/${id}/playable`
`media/plex/info/${id}/shuffle`
```

**Migration Consideration:** New API should support both:
- Path-based: `/api/list/plex/12345/playable,shuffle`
- Query-based: `/api/list/plex/12345?playable=true&shuffle=true`

---

## 8. Migration Checklist

### Phase 1: Core Playback (CRITICAL)
- [ ] `media/plex/info/{id}` → `/api/play/plex/{id}`
- [ ] `media/info/{key}` → `/api/play/filesystem/{key}`
- [ ] `media/log` → `/api/progress/{source}/{id}`

### Phase 2: List/Navigation (HIGH)
- [ ] `data/list/{key}` → `/api/list/folder/{key}`
- [ ] `media/plex/list/{id}` → `/api/list/plex/{id}`

### Phase 3: Content Types (MEDIUM)
- [ ] `data/scripture/{ref}` → `/api/play/scripture/{ref}`
- [ ] `data/talk/{id}` → `/api/play/talk/{id}`
- [ ] `data/poetry/{id}` → `/api/play/poetry/{id}`
- [ ] `data/hymn/{num}` → `/api/play/hymn/{num}`

### Phase 4: Proxy/Static (LOW)
- [ ] `/media/plex/img/{id}` → `/proxy/plex/thumb/{id}`
- [ ] `/media/{path}` → `/proxy/filesystem/stream/{path}`

---

## 9. Backward Compatibility Requirements

The LegacyRouter must support:

```typescript
const LEGACY_MAPPINGS = {
  // Info endpoints
  'media/plex/info/:key/:config?': '/api/play/plex/:key',
  'media/info/*': '/api/play/filesystem/:path',

  // List endpoints
  'data/list/:folder/:config?': '/api/list/folder/:folder',
  'media/plex/list/:key/:config?': '/api/list/plex/:key',

  // Logging
  'media/log': '/api/progress',

  // Content types
  'data/scripture/:ref': '/api/play/scripture/:ref',
  'data/talk/:id': '/api/play/talk/:id',
  'data/poetry/:id': '/api/play/poetry/:id',
  'data/hymn/:num': '/api/play/hymn/:num',
  'data/primary/:num': '/api/play/primary/:num',

  // Proxy
  'media/plex/img/:key': '/proxy/plex/thumb/:key',
  'media/*': '/proxy/filesystem/stream/:path',
};
```

---

## 10. Response Shape Compatibility

New API responses must include all fields currently used by frontend:

### List Response (must include)
- `items[]` - Array of menu/queue items
- `title` / `label` - Display title
- `image` - Thumbnail URL
- `info` - Rich metadata (for Plex)
- `seasons` - Season map (for TV shows)

### Media Info Response (must include)
- `media_key` - Canonical identifier
- `media_url` - Playback URL
- `media_type` - Type discriminator
- `duration` - Length in seconds
- `title`, `show`, `season`, `episode` - Display metadata
- `plex` - Original Plex ID (for logging)

### Progress Log (must accept)
- `type` - Source type ('plex', 'media', etc.)
- `media_key` - Item identifier
- `seconds` - Playhead position
- `percent` - Progress percentage
- `title` - Display title
- `watched_duration` - Session watch time
