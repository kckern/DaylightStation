# Content Playback

Content playback covers how content is resolved to a renderable form, how queues are built and managed, and how the Player component hierarchy renders different content formats via the Playable Contract.

---

## Unified Play API

All content formats resolve through a single Play API endpoint. The frontend never needs to know format-specific endpoints.

**Route**: `GET /api/v1/play/:source/*`

The content ID goes through the resolution chain (see content-model.md), the appropriate driver's `getPlayInfo()` is called, and the response includes a `format` field that tells the frontend which renderer to use.

**Request examples** (all equivalent via resolution chain):
```
GET /api/v1/play/hymn-library/198     # exact instance
GET /api/v1/play/singalong/hymn/198   # format match
GET /api/v1/play/hymn/198             # alias resolution
GET /api/v1/play/plex-main/12345      # exact instance
GET /api/v1/play/plex/12345           # driver match (tries default first)
GET /api/v1/play/app/webcam           # app-registry driver
```

**Response** (common fields + format-specific):
```json
{
  "format": "singalong",
  "contentId": "hymn-library:198",
  "title": "I Stand All Amazed",
  "duration": 180,
  "thumbnail": "/api/v1/display/hymn-library/198",

  "audioUrl": "/api/v1/stream/hymn-library/198",
  "verses": [["I stand all amazed at the love Jesus offers me,", "..."], ["..."]],
  "verseCount": 4
}
```

### Format-Specific Response Fields

| Format | Additional Fields |
|--------|------------------|
| `video` / `dash_video` | `mediaUrl`, `mediaType`, `resumePosition`, `maxVideoBitrate` |
| `audio` | `mediaUrl`, `mediaType`, `albumArt`, `artist`, `album` |
| `singalong` | `audioUrl`, `verses` (array of verse arrays, each verse an array of line strings), `verseCount`, `duration` (from audio file via `music-metadata`) |
| `readalong` | `audioUrl`, `text`/`verses`, `ambientAudioUrl`, `videoUrl` (optional, for talks) |
| `readable_paged` | `contentUrl`, `totalPages`, `readingDirection`, `format` (cbz/pdf), `resumePage` |
| `readable_flow` | `contentUrl`, `format` (epub), `resumeCfi` |
| `app` | `appId`, `appParam`, `appConfig` |
| `image` | `imageUrl`, `dimensions` |

### What This Replaces

Today the frontend calls different endpoints per content type:
- Plex/media → `fetchMediaInfo()` → `/api/v1/play/`
- Hymns → `DaylightAPI('api/v1/local-content/hymn/...')`
- Scripture → `DaylightAPI('api/v1/local-content/scripture/...')`
- Talks → `DaylightAPI('api/v1/local-content/talk/...')`
- Poems → `DaylightAPI('api/v1/local-content/poem/...')`

All of these collapse into the unified Play API. The `local-content/*` endpoints become unnecessary.

---

## Queue API

**Route**: `GET /api/v1/queue/:source/*`

Resolves a container to an ordered list of playable items. Each item in the response includes its `format` field so the queue controller knows what to render.

**Request**:
```
GET /api/v1/queue/plex-main/67890?shuffle=true&limit=10
```

**Response**:
```json
{
  "source": "plex-main",
  "id": "plex-main:67890",
  "count": 10,
  "totalDuration": 13200,
  "items": [
    {
      "id": "plex-main:12345",
      "title": "S01E01 - Pilot",
      "format": "video",
      "mediaUrl": "...",
      "duration": 1320
    }
  ]
}
```

Queues can contain items of **mixed formats**:
```json
{
  "items": [
    { "id": "hymn-library:198", "format": "singalong", "title": "Opening Hymn" },
    { "id": "app:gratitude", "format": "app", "title": "Gratitude Activity" },
    { "id": "plex-main:12345", "format": "video", "title": "Lesson Video" },
    { "id": "scriptures:john-3-16", "format": "readalong", "title": "Scripture" }
  ]
}
```

---

## Compose API (Multi-Track)

**Route**: `POST /api/v1/content/compose`

Resolves multiple content IDs into a composite presentation with visual and audio tracks.

**Request**:
```json
{ "sources": ["app:screensaver", "plex-main:99"] }
```

**Response**:
```json
{
  "visual": { "category": "app", "app": "screensaver" },
  "audio": { "contentId": "plex-main:99", "format": "audio", "mediaUrl": "..." }
}
```

---

## Player Component Hierarchy

The Player component routes content to the appropriate renderer based on the resolved `format` field.

```
Player.jsx (orchestrator)
│
├─ Routing decision (top-level):
│  ├─ Composite props (visual + audio, sources, overlay) → CompositePlayer
│  └─ Single item → ContentResolver
│
├─ CompositePlayer
│  ├─ Resolves sources via Compose API if unresolved
│  ├─ Visual track → VisualRenderer
│  └─ Audio track → nested Player instance
│
└─ ContentResolver (evolved from SinglePlayer)
   ├─ Step 1: Resolve content ID via unified Play API
   │  └─ GET /api/v1/play/{contentId} → { format, ...data }
   │
   └─ Step 2: Dispatch to renderer by format
      ├─ video / dash_video → VideoPlayer
      ├─ audio → AudioPlayer
      ├─ singalong → SingalongScroller
      ├─ readalong → ReadalongScroller
      ├─ readable_paged → PagedReader
      ├─ readable_flow → FlowReader
      ├─ app → PlayableAppShell
      └─ image → ImageDisplay
```

All renderers implement the **Playable Contract** (see content-model.md), which means the queue controller doesn't need to know what format is being rendered — it just passes `advance`, `clear`, `shader`, `volume` and receives `onPlaybackMetrics` back.

### Queue Controller

The `useQueueController` hook manages queue state independently of renderers:

- **Queue initialization** from various input shapes (direct array, content ID, playlist reference)
- **Advancement** (forward/backward, continuous/non-continuous)
- **Shader management** (visual overlay modes)
- **Shuffle state**

The queue controller is format-agnostic. It manages the queue array and provides lifecycle callbacks. Each item renders via whichever component matches its `format`.

---

## The Playable Contract

Every renderer of playable content implements the Playable Contract. This is the interface between the Player/queue system and the component that renders content.

### Inbound Props (Player → Renderer)

| Prop | Type | Purpose |
|------|------|---------|
| `advance` | `() => void` | Advance to next queue item |
| `clear` | `() => void` | Stop and exit playback |
| `shader` | `string` | Current visual shader |
| `volume` | `number` | Playback volume (0-1) |
| `playbackRate` | `number` | Speed multiplier |
| `seekToIntentSeconds` | `number \| null` | External seek request |
| `onSeekRequestConsumed` | `() => void` | Acknowledge seek applied |

### Outbound Callbacks (Renderer → Player)

| Callback | Type | Purpose |
|----------|------|---------|
| `onPlaybackMetrics` | `(metrics) => void` | Report playback state |
| `onRegisterMediaAccess` | `(accessors) => void` | Register media element for resilience |
| `onResolvedMeta` | `(meta) => void` | Report resolved metadata |
| `onStartupSignal` | `() => void` | Signal playback started |

### Implementations

| Renderer | Format(s) | Media Element | Contract Status |
|----------|-----------|---------------|----------------|
| VideoPlayer | video, dash_video | `<video>` / `<dash-video>` | Full (via useCommonMediaController) |
| AudioPlayer | audio | `<audio>` | Full (via useCommonMediaController) |
| SingalongScroller | singalong | `<audio>` (embedded) | Full (via ContentScroller → useMediaReporter) |
| ReadalongScroller | readalong | `<audio>` (embedded, optional) | Full (via ContentScroller → useMediaReporter) |
| PlayableAppShell | app | None (app-defined) | Planned |

### PlayableAppShell

The new renderer for `app` format content. Wraps interactive apps (webcam, gratitude, family-selector, etc.) with the Playable Contract.

**How it works:**
1. Receives resolved play info: `{ format: 'app', appId: 'webcam', appParam: null }`
2. Loads the app component via `appRegistry.getApp(appId)`
3. Wraps the app with Playable Contract callbacks
4. App calls `advance()` when done (timer, user action, or event)
5. App optionally reports progress via `onPlaybackMetrics`

**App-specific contract extensions:**
- Apps receive `advance()` to self-terminate
- Apps receive `pause()` / `resume()` for external lifecycle control
- Apps without inherent progress report 0% until they call `advance()` (then 100%)
- Apps with timed behavior can report progress: `onPlaybackMetrics({ seconds: 15, duration: 30 })`

---

## play vs open

| Action | Wrapper | Queue? | Contract? | Use case |
|--------|---------|--------|-----------|----------|
| `play: { contentId: 'app:webcam' }` | PlayableAppShell | Yes | Playable Contract | App in a queue, auto-advances |
| `open: 'webcam'` | AppContainer | No | ESC only | Standalone app, manual dismiss |

Same app component. Different lifecycle wrapper. An app doesn't need to know which wrapper it's in — PlayableAppShell and AppContainer both pass appropriate callbacks.

---

## Composite Playback

Composite playback layers a visual track and an audio track into a coordinated presentation.

### Track Types

**Visual track** (what you see):
- App components: screensaver, clock, blackout, art-frame
- Media: image carousel, video

**Audio track** (what you hear):
- Any playable audio content
- Managed by a nested Player instance with isolated session

### Coordination

- Visual advances can be timed, synced to audio markers, or manual
- Each track gets an isolated playback session
- Overlays (loading, paused) coordinated via CompositeControllerContext

### Specifying Composite Playback

```
?play=app:screensaver,plex-main:99    # screensaver visual + plex audio
?play=plex:12345&overlay=plex:99      # video + audio overlay
```

---

## Display API

**Route**: `GET /api/v1/display/:source/*`

Returns a visual representation of a content item (thumbnail, poster art, cover image). Used by menu grids, queue previews, and anywhere an item needs a visual.

### Resolution Order

1. `adapter.getThumbnailUrl(localId)` — dedicated thumbnail method
2. `adapter.getItem(compoundId)` → `item.thumbnail || item.imageUrl` — fallback from item metadata
3. **Placeholder SVG** — generated fallback when no image exists

### Placeholder SVG Fallback

Non-displayable content (programs, playlists, config lists) typically has no thumbnail. Instead of returning a 404, the display endpoint generates a lightweight SVG with:

- Dark background (`#1a1a1a`)
- Color-coded type badge (source-specific colors: talk=green, scripture=brown, hymn=purple, plex=gold, etc.)
- Item title (from `getItem()`, falling back to the raw localId)

The SVG is returned with `Content-Type: image/svg+xml` and renders natively in `<img>` tags. This means menu items and list views always have a visual — no broken image icons.

**Utility**: `backend/src/4_api/v1/utils/placeholderSvg.mjs`

---

## Ambient Audio

Readalong content types (talks, scriptures) support ambient background audio — soft music layered under the main narration.

### How It Works

1. The collection manifest declares `ambient: true`
2. The frontend (ReadalongScroller) generates a random track from 115 numbered ambient MP3s
3. The ambient track plays at 10% of the main audio volume
4. Ambient audio fades in after a delay and fades out when playback ends

### Configuration

- **Track pool**: `/media/audio/ambient/001.mp3` through `/media/audio/ambient/115.mp3`
- **Volume**: Always 10% of the main volume (`mainVolume * 0.1`)
- **Fade**: `fadeInDelay: 750ms`, `fadeOutStep: 0.01`, `fadeOutInterval: 400ms`
- **Eligible types**: Determined by CSS type — `talk` and `scriptures` get ambient audio
