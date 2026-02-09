# Content Model

The DaylightStation content system is built on four independent axes: **source instances** (with drivers), **content formats**, **capabilities**, and **item type**. Every piece of content is identified by a compound content ID that resolves through a layered alias and fallback chain. Every playable renderer implements a shared **Playable Contract**.

---

## Content ID

Every content item has a compound identifier: `{source}:{localId}`.

```
plex-main:12345
hymn-library:198
home-videos:vacation/beach-day.mp4
```

The source portion identifies **which configured source instance** holds the content. The localId is opaque to the system — each adapter interprets it according to its own conventions.

---

## Axis 1: Source Instances & Drivers

A **source instance** is a configured connection to a content provider. Each instance uses a **driver** that determines the protocol for communicating with the backend.

### Drivers

A driver is a protocol-level adapter — it knows how to talk to a specific kind of backend. A single driver can return items of **different content formats**.

| Driver | Protocol | Can Produce Formats |
|--------|----------|-------------------|
| `plex` | Plex API (remote) | video, dash_video, audio, image |
| `immich` | Immich API (remote) | image, video |
| `audiobookshelf` | ABS API (remote) | audio, readable_flow (ebooks), readable_paged (PDFs) |
| `komga` | Komga API (remote) | readable_paged (comics, manga) |
| `filesystem` | Local disk read | video, audio, image, singalong, readalong |
| `yaml-config` | YAML file parse | (references only — items point to other sources) |
| `query` | Internal query execution | (dynamic references — results come from other sources) |
| `app-registry` | Frontend registry lookup | app |

Note: There is no `canvas` driver. The legacy `canvas:` prefix is an alias to a filesystem source instance serving images, accessed via the `display` action. See the `displayable` capability for details.

The driver determines **how** to fetch content, not **what** the content is. A filesystem driver serving a directory of YAML+audio files returns `singalong` format. The same filesystem driver serving a directory of MP4 files returns `video` format. The driver inspects the content structure and reports the appropriate format.

### Source Instances

Each driver can have **multiple instances**. Instances are defined entirely in configuration.

```yaml
sources:
  # Remote API instances
  plex-main:
    driver: plex
    host: 192.168.1.10
    token: xxx
    default: true

  plex-kids:
    driver: plex
    host: 192.168.1.11
    token: yyy

  family-photos:
    driver: immich
    host: photos.local
    api_key: zzz

  audiobooks:
    driver: audiobookshelf
    host: abs.local
    api_key: aaa

  # Filesystem instances — generic (single path, media IS the content)
  home-videos:
    driver: filesystem
    path: /media/video/clips

  # Filesystem instances — singalong (split data/media paths)
  hymn-library:
    driver: filesystem
    content_format: singalong
    data_path: /data/content/singalong/hymn      # YAML metadata
    media_path: /media/audio/singalong/hymn       # MP3 audio files
    default_for: singalong

  primary-songs:
    driver: filesystem
    content_format: singalong
    data_path: /data/content/singalong/primary
    media_path: /media/audio/singalong/primary

  # Filesystem instances — readalong (split data/media paths)
  scriptures:
    driver: filesystem
    content_format: readalong
    data_path: /data/content/readalong/scripture   # YAML with verses/text
    media_path: /media/audio/readalong/scripture   # Audio recordings
    default_for: readalong

  conference-talks:
    driver: filesystem
    content_format: readalong
    data_path: /data/content/readalong/talks
    media_path: /media/video/readalong/talks       # Video recordings

  poetry:
    driver: filesystem
    content_format: readalong
    data_path: /data/content/readalong/poetry
    media_path: /media/audio/readalong/poetry

  # Display images (filesystem instance, accessed via displayable capability)
  # Image folder — any directory of images becomes displayable
  my-art-collection:
    driver: filesystem
    path: /media/img/art
    extensions: [jpg, jpeg, png, webp]

  # Filesystem media (local clips, sound effects)
  local-media:
    driver: filesystem
    path: /media/video/clips
    default_for: files

  # YAML config instances
  fhe-menu:
    driver: yaml-config
    path: data/household/config/lists
```

### Design Principle: Collections Are Config, Not Code

The code knows about **drivers** (plex, filesystem, immich) and **content formats** (video, singalong, readalong). It knows **nothing** about collections (hymn, scripture, primary, karaoke). Collections are user-defined source instances, declared entirely in configuration.

To add a new singalong collection: drop mp3s and YAMLs in a filesystem directory, add a source instance entry with `content_format: singalong`, and add an alias. Zero code changes.

---

## Axis 2: Content Format

A content format describes **what the content is** and determines **how the frontend renders it**. The format is independent of the source — a singalong item from a filesystem driver and one from a future karaoke API driver produce the same format and render the same way.

| Format | Structure | Frontend Renderer |
|--------|-----------|-------------------|
| `video` | Single media stream | VideoPlayer |
| `dash_video` | Adaptive bitrate stream | VideoPlayer (DASH mode) |
| `audio` | Single audio stream | AudioPlayer |
| `singalong` | Scrolling text + audio sync (untimed — scroll rate derived from duration/verseCount) | SingalongScroller |
| `readalong` | Scrollable text + optional audio/video | ReadalongScroller |
| `readable_paged` | Fixed-page content (comics, manga, PDFs) with page navigation | PagedReader |
| `readable_flow` | Reflowable text (ebooks/EPUB) with CFI-based position tracking | FlowReader |
| `image` | Static visual | ImageCarousel / Displayer |
| `app` | Interactive UI with lifecycle | PlayableAppShell |

The format is **always determined by the adapter's response**, never inferred from the content ID. When you resolve `hymn-library:198`, the adapter returns `{ format: 'singalong', ... }`. When you resolve `plex-main:12345`, the adapter returns `{ format: 'video', ... }` or `{ format: 'audio', ... }` depending on the item.

The content ID prefix identifies the source instance. The adapter determines the format.

### Unified Play API

All content formats resolve through a single Play API endpoint:

```
GET /api/v1/play/{contentId}
```

The response always includes a `format` field plus format-specific data:

```json
// All formats include:
{
  "format": "singalong",
  "contentId": "hymn-library:198",
  "title": "I Stand All Amazed",
  "duration": 180,
  "thumbnail": "/api/v1/display/hymn-library/198"
}

// Singalong example:
{
  "format": "singalong",
  "contentId": "hymn-library:198",
  "title": "I Stand All Amazed",
  "duration": 180,
  "audioUrl": "/api/v1/stream/hymn-library/198",
  "verses": [
    ["I stand all amazed at the love Jesus offers me,", "Confused at the grace that so fully he proffers me."],
    ["I marvel that he would descend from his throne divine", "To rescue a soul so rebellious and proud as mine,"]
  ],
  "verseCount": 4
}

// Format-specific fields:
// video/dash_video: mediaUrl, mediaType, resumePosition
// audio: mediaUrl, mediaType, albumArt
// singalong: audioUrl, verses (array of verse arrays, each verse an array of line strings), verseCount, duration (from audio file via music-metadata)
// readalong: audioUrl, text/verses, ambientAudioUrl, videoUrl (optional)
// readable_paged: contentUrl, totalPages, readingDirection (ltr/rtl/ttb), format (cbz/pdf/etc)
// readable_flow: contentUrl, format (epub), resumeCfi
// app: appId, appParam, appConfig
// image: imageUrl, dimensions
```

The frontend calls one endpoint, gets back everything the renderer needs. No format-specific API paths.

---

## Axis 3: Capabilities

Capabilities describe **what actions are available** on a content item. They are determined by the source adapter and the item itself.

| Capability | Meaning | Adapter Method |
|------------|---------|----------------|
| `playable` | Can produce renderable content (media, scroller, app) | `getPlayInfo()` |
| `readable` | Can produce paged or reflowable text content (ebooks, comics) | `resolveReadables()` |
| `listable` | Has children, can list contents (container) | `getList()` |
| `queueable` | Can be flattened to ordered playable items | `resolvePlayables()` |
| `searchable` | Appears in cross-source search results | `search()` |
| `displayable` | Can produce a thumbnail or static image for display | `getThumbnail()` |

A single item can have multiple capabilities. A TV show is `listable` (browse seasons) and `queueable` (flatten all episodes). An episode is `playable` and `displayable`. A photo is `displayable` and `playable` (in a slideshow context). An Audiobookshelf item can be both `playable` (audiobook) and `readable` (ebook) depending on the media type.

**`displayable` vs `image` format**: `displayable` is a capability — it means the item can produce a thumbnail. The `image` format is a content format — it means the item IS an image, rendered full-screen by the Displayer. A Plex movie is `displayable` (has poster art) but its format is `video`. A photo from Immich is `displayable` AND has format `image`. The legacy `canvas:` prefix is just an alias to a filesystem image source instance accessed via the `display` action — no separate driver needed.

Capabilities map to API routes:

| Capability | API Route |
|------------|-----------|
| `playable` | `GET /api/v1/play/:source/*` |
| `readable` | `GET /api/v1/read/:source/*` |
| `listable` | `GET /api/v1/list/:source/*` |
| `queueable` | `GET /api/v1/queue/:source/*` |
| `searchable` | `GET /api/v1/content/query/search` |
| `displayable` | `GET /api/v1/display/:source/*` |

---

## Axis 4: Item Type

Every content item is structurally either a **container** or a **leaf**:

| Item Type | Meaning | Typical Capabilities |
|-----------|---------|---------------------|
| `container` | Has children — you browse into it | `listable`, `queueable` |
| `leaf` | Terminal item — you act on it directly | `playable`, `displayable` |

Item type is orthogonal to source, driver, and format. A plex item could be either (show = container, episode = leaf). A singalong collection directory is a container; a specific song is a leaf.

---

## The Playable Contract

Every renderer of playable content implements a shared lifecycle interface called the **Playable Contract**. This allows all playable content — video, audio, singalong, readalong, apps — to participate uniformly in queues and the Player component hierarchy.

### Contract Interface

**Inbound (queue/Player → renderer):**

| Prop | Type | Purpose |
|------|------|---------|
| `advance` | `() => void` | Signal to advance to the next queue item |
| `clear` | `() => void` | Signal to stop and exit playback |
| `shader` | `string` | Current visual shader mode |
| `volume` | `number` | Playback volume (0-1) |
| `playbackRate` | `number` | Playback speed multiplier |
| `seekToIntentSeconds` | `number \| null` | External seek request |
| `onSeekRequestConsumed` | `() => void` | Acknowledge seek was applied |

**Outbound (renderer → queue/Player):**

| Callback | Type | Purpose |
|----------|------|---------|
| `onPlaybackMetrics` | `(metrics) => void` | Report current playback state (seconds, isPaused, stalled) |
| `onRegisterMediaAccess` | `(accessors) => void` | Register media element accessors for resilience |
| `onResolvedMeta` | `(meta) => void` | Report resolved metadata after content loads |
| `onStartupSignal` | `() => void` | Signal that playback has started |

### Existing Implementations

| Renderer | Implements Contract? | Notes |
|----------|---------------------|-------|
| VideoPlayer | Yes | Full implementation via `useCommonMediaController` |
| AudioPlayer | Yes | Full implementation via `useCommonMediaController` |
| SingalongScroller | Yes | Already reports metrics, registers access, handles seek |
| ReadalongScroller | Yes | Already reports metrics, registers access, handles seek |
| PlayableAppShell | Planned | New shell for interactive apps (webcam, gratitude, etc.) |

The key insight: ContentScroller (which SingalongScroller/ReadalongScroller build on) **already implements this contract**. The Playable Contract is not new — it's a formalization of what already exists.

### play vs open

The Playable Contract creates a clear distinction for apps:

| Action | Lifecycle | Queue participant? | Contract? |
|--------|-----------|-------------------|-----------|
| `play: { contentId: 'app:webcam' }` | PlayableAppShell wraps the app | Yes | Full Playable Contract |
| `open: 'webcam'` | AppContainer wraps the app | No | ESC to dismiss only |

Same app component, different wrapper. PlayableAppShell provides advance/clear/metrics. AppContainer provides only ESC handling.

---

## Content ID Resolution

Content IDs resolve through a layered chain. The resolver tries each layer in order and stops at the first successful resolution.

### Layer 1: Exact Instance Match

The source portion matches a configured instance name exactly.

```
Input:  hymn-library:198
Match:  instance 'hymn-library' exists → resolve localId '198' with its driver
```

### Layer 2: Driver/Format Type Match

The source portion matches a driver name or format name. Try instances using that driver or producing that format, starting with the default.

```
Input:  singalong:hymn/198
Match:  no instance named 'singalong'
        → 'singalong' matches a content format
        → instances producing singalong: [hymn-library (default_for: singalong), primary-songs, my-karaoke]
        → try hymn-library with 'hymn/198' → found
```

```
Input:  plex:12345
Match:  no instance named 'plex'
        → 'plex' matches a driver name
        → instances using plex driver: [plex-main (default), plex-kids]
        → try plex-main with '12345' → not found
        → try plex-kids with '12345' → found
```

For multi-instance resolution: the **default instance has priority**. If the default can't resolve the ID, try remaining instances in config order. First successful resolution wins.

### Layer 3: Alias Resolution

The source portion matches a configured alias. Aliases rewrite the content ID and re-enter the resolution chain.

```
Input:  hymn:198
Match:  no instance, driver, or format named 'hymn'
        → alias 'hymn' → instance 'hymn-library'
        → rewrite to: hymn-library:198
        → Layer 1: instance 'hymn-library' exists → resolve '198'
```

### Layer 4: Prefix Expansion

The adapter receives a localId it can't resolve directly, and tries known prefixes or path conventions.

```
Input:  singalong:198
Match:  format 'singalong' → try hymn-library with '198' → not found directly
        → adapter tries prefix expansion: hymn/198, primary/198
        → first hit wins
```

### Layer 5: Household Aliases

User-configured shortcuts defined at the household level.

```
Input:  bedtime-songs:3
Match:  no instance, driver, format, or system alias
        → household alias 'bedtime-songs' → instance 'primary-songs'
        → rewrite to: primary-songs:3
```

### Alias Configuration

Aliases are defined in configuration, not code.

```yaml
# System-level aliases (shipped with the application)
aliases:
  hymn: hymn-library
  primary: primary-songs
  scripture: scriptures
  talk: conference-talks
  poem: poetry
  canvas: my-art-collection
  media: local-media
  files: local-media

  # Legacy adapter name aliases
  singing: singalong         # singing:x → singalong:x (SingingAdapter compat)
  narrated: readalong        # narrated:x → readalong:x (NarratedAdapter compat)

# Household-level aliases (user-defined)
household_aliases:
  bedtime-songs: primary-songs
  fhe-playlist: fhe-watchlist
  karaoke: my-karaoke
```

---

## Summary

```
Content ID:  hymn:198
                │
                ▼
         Resolution Chain
         (exact → driver/format → alias → prefix → household)
                │
                ▼
         Source Instance: hymn-library
         Driver: filesystem
         Content Format: singalong
                │
                ▼
         Unified Play API
         GET /api/v1/play/hymn-library/198
         → { format: 'singalong', audioUrl: '...', verses: [...] }
                │
                ▼
         Frontend Renderer: SingalongScroller
         (implements Playable Contract)
```

The four axes are fully independent:
- **Source instance + driver** answers: who do I ask, and how?
- **Format** answers: what shape is the data, and what renders it?
- **Capabilities** answer: what can I do with it?
- **Item type** answers: container or leaf?

Code knows about drivers, formats, capabilities, and the Playable Contract. Configuration defines instances, collections, and aliases.
