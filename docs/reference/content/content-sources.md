# Content Sources

Sources are the providers of content in DaylightStation. This document covers drivers, the adapter contract, instance configuration, and how to add new sources.

---

## Drivers vs Source Instances

A **driver** is a protocol-level adapter that knows how to communicate with a specific kind of backend. A **source instance** is a named, configured connection that uses a driver.

```
Driver: plex (knows how to talk to Plex API)
  └─ Instance: plex-main   (host: 192.168.1.10, default: true)
  └─ Instance: plex-kids   (host: 192.168.1.11)

Driver: filesystem (knows how to read local files)
  └─ Instance: home-videos      (path: /mnt/media/videos)
  └─ Instance: hymn-library     (path: /data/content/singalong/hymn, content_format: singalong)
  └─ Instance: scriptures       (path: /data/content/readalong/scripture, content_format: readalong)
  └─ Instance: my-karaoke       (path: /data/content/singalong/karaoke, content_format: singalong)
```

Code is written against **drivers**. Configuration defines **source instances**.

A single driver can return items of different content formats. The filesystem driver serving MP4 files returns `video` format; serving YAML+audio directories with `content_format: singalong` returns `singalong` format. The driver inspects the content structure and reports the appropriate format.

---

## Adapter Contract

Every driver implements a standard interface. Not every method is required — drivers declare which capabilities they support.

### Required

Validated by `IContentSource.mjs`:

| Method | Purpose |
|--------|---------|
| `getItem(localId)` | Return metadata for a single item (title, thumbnail, mediaType, capabilities) |
| `getList(localId)` | Return children of a container |
| `resolvePlayables(localId)` | Flatten a container to an ordered list of playable leaves |
| `resolveSiblings(compoundId)` | Return peer items + parent info for navigation |

### Optional (capability-based, not validated)

| Method | Capability | Purpose |
|--------|-----------|---------|
| `search(query)` | `searchable` | Return items matching a text query |
| `getThumbnail(localId)` | `displayable` | Return an image/thumbnail for the item |
| `getCapabilities(localId)` | — | Return the list of capabilities for a specific item |
| `getContainerType(id)` | — | Return a container type string for selection strategy inference (see Content Progress) |
| `getStoragePath(id)` | — | Return a persistence key for watch state storage |
| `getSearchCapabilities()` | `searchable` | Report supported search filters and query mappings |

### How Playable Data Is Returned

Adapters do **not** have a separate `getPlayInfo()` method. Instead, adapters return playback data directly from `getItem()` as `PlayableItem` instances (or plain objects with equivalent fields). The adapter sets `mediaType` on the item (e.g., `'audio'`, `'video'`, `'dash_video'`).

The API layer adds a `format` field to the HTTP response via `resolveFormat.mjs` (located in `backend/src/4_api/v1/utils/`). The format resolution priority chain:

1. `item.metadata.contentFormat` — item-level override (e.g., `'singalong'`, `'readalong'`)
2. `adapter.contentFormat` — adapter-level default (e.g., filesystem with `content_format: singalong`)
3. `item.mediaType` — media type fallback (e.g., `'audio'`, `'video'`)
4. Container detection — if no mediaUrl but has children → `'list'`
5. Fallback → `'video'`

This means the `format` field in Play API responses is **not** set by adapters — it's derived at the API boundary. Adapters deal in `mediaType`; the frontend deals in `format`.

### Adapter Registration

Drivers register with the `ContentSourceRegistry` at startup. The registry maps instance names to adapter instances and tracks driver/format indexes for the resolution chain.

```javascript
registry.register('plex-main', plexMainAdapter, { driver: 'plex', default: true });
registry.register('plex-kids', plexKidsAdapter, { driver: 'plex' });
registry.register('hymn-library', filesystemAdapter, { driver: 'filesystem', contentFormat: 'singalong', defaultFor: 'singalong' });
```

---

## Built-in Drivers

### plex

Connects to a Plex media server via its API.

- **Protocol**: Remote HTTP API
- **Formats produced**: `video`, `dash_video`, `audio`, `image`
- **Capabilities**: `playable`, `listable`, `queueable`, `searchable`, `displayable`
- **Multi-instance**: Yes — one instance per Plex server
- **Config**: host, port, token, libraries

### immich

Connects to an Immich photo/video management server.

- **Protocol**: Remote HTTP API
- **Formats produced**: `image`, `video`
- **Capabilities**: `playable`, `listable`, `displayable`, `searchable`
- **Multi-instance**: Yes
- **Config**: host, API key, albums

### audiobookshelf (source name: `abs`)

Connects to an Audiobookshelf server. A single ABS instance can produce both playable and readable content — audiobooks return `audio` format, ebooks return `readable_flow` format. The adapter detects the media type and produces the appropriate format.

- **Protocol**: Remote HTTP API
- **Formats produced**: `audio` (audiobooks), `readable_flow` (ebooks/EPUB), `readable_paged` (PDFs)
- **Capabilities**: `playable`, `readable`, `listable`, `queueable`, `searchable`
- **Multi-instance**: Yes
- **Config**: host, API key
- **Resume**: Audiobooks use seconds-based playhead. Ebooks use EPUB CFI (Canonical Fragment Identifiers). 90% = complete.
- **Container aliases**: `libraries`, `authors`, `series`, `narrators`

### komga

Connects to a Komga comics/manga server. Produces paged readable content with support for multiple reading directions.

- **Protocol**: Remote HTTP API
- **Formats produced**: `readable_paged` (comics, manga, PDFs)
- **Capabilities**: `readable`, `listable`, `searchable`
- **Multi-instance**: Yes
- **Config**: host, API key
- **Reading directions**: `ltr` (Western comics), `rtl` (manga), `ttb` (webtoon/vertical scroll)
- **Status**: Adapter exists but is currently unregistered (no manifest). Needs manifest + bootstrap registration.

### filesystem

Reads files from the local filesystem. Behavior varies by `content_format` config:

- **No content_format**: Generic file browser. Format determined by file extension (mp4→video, mp3→audio, jpg→image).
- **content_format: singalong**: Expects YAML metadata + corresponding audio files. Returns `singalong` format.
- **content_format: readalong**: Expects YAML text files + optional audio/video. Returns `readalong` format.

| content_format | Formats produced | File structure |
|---------------|-----------------|---------------|
| (none) | `video`, `audio`, `image` | Raw media files in directories |
| `singalong` | `singalong` | YAML metadata in `data_path`, audio in `media_path` (matched by filename stem) |
| `readalong` | `readalong` | YAML text in `data_path`, optional audio/video in `media_path` |

- **Protocol**: Local disk read
- **Capabilities**: `playable`, `listable`, `searchable`, `displayable`
- **Multi-instance**: Yes — one instance per directory
- **Config**: `data_path` (YAML metadata), `media_path` (audio/video files), content_format, allowed extensions

#### Data/Media Path Split

Content YAML metadata and media files live on separate directory trees. The filesystem driver requires both paths:

```yaml
hymn-library:
  driver: filesystem
  content_format: singalong
  data_path: /data/content/singalong/hymn       # YAML: 0001-the-morning-breaks.yml
  media_path: /media/audio/singalong/hymn        # Audio: 0001-the-morning-breaks.mp3
  default_for: singalong
```

The driver matches YAML to media by filename stem (ignoring extension). Duration is read from the audio file at runtime via `music-metadata` when not specified in YAML metadata.

For generic filesystem instances (no `content_format`), a single `path` field suffices since the media files ARE the content:

```yaml
home-videos:
  driver: filesystem
  path: /media/video/clips
```

#### Collection Manifest

Each collection directory may contain a `manifest.yml` that declares collection-level metadata and behavior. The filesystem driver reads this at startup. The manifest is the primary mechanism for customizing how a readalong collection resolves IDs, selects versions, and renders content — all without code changes.

```yaml
# data/content/readalong/scripture/manifest.yml
resolver: scripture              # named resolver plugin (see Resolvers below)
renderer: scripture              # named frontend renderer (see Renderers below)
containerType: watchlist         # how the collection integrates with selection (watchlist, menu)
contentType: verses              # content structure type (verses, paragraphs)
ambient: true                    # enable ambient background audio during playback
style:                           # CSS custom properties passed to the frontend renderer
  fontFamily: serif
  fontSize: 1.3rem
  textAlign: left
defaults:                        # resolver-specific: per-section version defaults
  ot: { text: kjvf, audio: kjvf }
  nt: { text: kjvf, audio: kjvf }
  bom: { text: sebom, audio: sebom }
  dc: { text: rex, audio: rex }
  pgp: { text: lds, audio: lds }
volumeTitles:                    # human-readable names for section abbreviations
  ot: Old Testament
  nt: New Testament
  bom: Book of Mormon
  dc: Doctrine and Covenants
  pgp: Pearl of Great Price
```

```yaml
# data/content/readalong/poetry/manifest.yml — simple collection (no resolver, no custom renderer)
containerType: watchlist
contentType: paragraphs
ambient: true
style:
  fontFamily: serif
  fontSize: 1.3rem
  textAlign: left
```

**Manifest fields**:

| Field | Type | Purpose |
|-------|------|---------|
| `resolver` | string | Named resolver plugin for ID resolution (default: direct path lookup) |
| `renderer` | string | Named frontend renderer for content formatting (default: generic verse/paragraph) |
| `containerType` | string | How the collection participates in selection (`watchlist`, `menu`) |
| `contentType` | string | Content structure hint (`verses`, `paragraphs`) — determines default parse function |
| `ambient` | boolean | Whether to play ambient background audio during readalong |
| `style` | object | CSS custom properties passed to the renderer (`fontFamily`, `fontSize`, `textAlign`) |
| `defaults` | object | Resolver-specific config (e.g., per-section version defaults for text and audio) |
| `volumeTitles` | object | Human-readable names for section abbreviations |

#### Resolvers (Backend Plugin)

A **resolver** is a named strategy that converts an incoming `localId` into resolved file paths. Collections declare a resolver in `manifest.yml`; collections without a resolver use direct path lookup (the default).

The resolver interface is thin:

```javascript
// resolve(input, dataPath, options) → { textPath, audioPath, volume, verseId, isContainer }
```

The resolver receives the raw `localId` string, the collection's `data_path`, and the manifest's `defaults`. It returns paths to the text YAML and audio file, plus metadata about what was resolved.

**Registered resolvers:**

| Resolver | Package/Module | What It Does |
|----------|---------------|-------------|
| `scripture` | `scripture-guide` npm | Reference strings → verse IDs, volume ranges, multi-version path resolution |
| (default) | built-in | Direct path lookup with directory traversal |

The `scripture` resolver handles multiple input forms:
- Reference strings (`1-nephi-1`, `john-3-16`) → parsed via `scripture-guide.lookupReference()`
- Bare verse IDs (`37707`) → mapped to volume via range lookup
- Volume names (`bom`, `nt`) → resolved to next unread chapter via watch history
- Full paths (`bom/sebom/31103`) → direct lookup
- Version-qualified paths (`kjvf/john-1`) → explicit text version, audio from defaults

**Multi-version support**: The manifest's `defaults` section maps collection sections to preferred text and audio versions. The resolver produces separate `textPath` and `audioPath`, allowing different text and audio recordings for the same content (e.g., read KJV text while listening to a dramatized NRSV recording).

**This pattern is generic.** Any readalong collection with complex ID resolution can declare its own resolver. For example, a Shakespeare collection could declare `resolver: shakespeare` backed by a thin module that maps play/act/scene references (e.g., `hamlet-3-1`) to file paths, with version defaults for different folios or translations:

```yaml
# Hypothetical: data/content/readalong/shakespeare/manifest.yml
resolver: shakespeare
renderer: shakespeare
contentType: verses
defaults:
  comedies: { text: first-folio, audio: rsc }
  tragedies: { text: first-folio, audio: arkangel }
  histories: { text: oxford, audio: arkangel }
```

#### Renderers (Frontend Plugin)

A **renderer** is a named entry in the frontend's `contentRenderers` registry that controls how a collection's content is parsed and displayed. Collections declare a renderer in `manifest.yml`; collections without one use generic verse or paragraph rendering based on `contentType`.

The renderer interface:

```javascript
{
  cssType: 'scriptures',                    // CSS data-visual-type attribute
  parseContent: (contentData) => jsxBlock,  // custom content → JSX transform
  extractTitle: (data) => string,           // custom title extraction
  extractSubtitle: (data) => string         // custom subtitle extraction
}
```

**Registered renderers:**

| Renderer | What It Does |
|----------|-------------|
| `scripture` | Verse-numbered prose/poetry with headings, section markers, and `scripture-guide.generateReference()` for title generation |
| (default) | Generic verse arrays or paragraph blocks based on `contentType` |

The scripture renderer uses `scripture-guide.generateReference()` on the frontend to convert verse IDs back to human-readable references (e.g., `25065` → "John 3:16") for display titles. It also parses verse-level formatting markers (`§¶`, poetry/prose detection) into structured JSX.

**This pattern is generic.** A Shakespeare renderer could format act/scene headings, stage directions, and character dialogue with appropriate CSS classes — all declared in the registry, triggered by `renderer: shakespeare` in the manifest.

#### Nested Directory Support

The filesystem driver supports hierarchical content directories with multiple nesting levels. The directory structure is collection-specific and interpreted by the resolver.

**Scripture** — organized by section / version / item:

```
data/content/readalong/scripture/
├── manifest.yml
├── bom/
│   └── sebom/                 # Book of Mormon, SEBOM translation
│       ├── 25065.yml
│       └── ...
├── ot/
│   ├── kjvf/                  # Old Testament, KJV Formatted
│   │   ├── 1.yml              # Genesis
│   │   └── ...
│   └── LDS/                   # Old Testament, LDS edition
│       └── ...
├── nt/
│   └── kjvf/
│       └── ...
├── dc/
│   └── rex/                   # D&C, Rex Pinnegar recording
│       └── ...
└── pgp/
    └── lds/
        └── ...
```

The pattern is `{section}/{version}/{itemId}`. The manifest's `defaults` map section abbreviations to preferred versions so users can request `john-1` without specifying a version. `localId` paths with explicit versions (`kjvf/john-1`) override the defaults.

**Talks** — organized by conference / session / talk number:

```
data/content/readalong/talks/
└── ldsgc/                         # LDS General Conference
    ├── ldsgc202410/               # October 2024
    │   ├── 20.yaml
    │   └── index.yaml
    ├── ldsgc202504/               # April 2025
    │   ├── 13.yaml
    │   └── index.yaml
    └── ldsgc202510/               # October 2025
        └── 11.yaml
```

Talk `localId` paths: `ldsgc/ldsgc202510/11`. Note: talks use `.yaml` extension (not `.yml`). The driver supports both extensions.

The `localId` can contain path separators: `ldsgc/ldsgc202510/11` resolves to the nested file. The driver's `getList()` method traverses directories to build container hierarchies.

### yaml-config

Parses YAML configuration files that define curated content lists. Items in these lists reference content from other sources by content ID.

- **Protocol**: YAML file parse
- **Formats produced**: none (items are references to other sources)
- **Capabilities**: `listable`, `queueable`
- **Multi-instance**: No — scoped to household
- **Config**: path to lists directory
- **List subtypes**: menu, watchlist, program
- **Input types recognized in items**: `plex:`, `scripture:`, `singalong:`, `readalong:`, `media:`, `canvas:`, `app:`, `watchlist:`, `query:`, `freshvideo:`

### query

Executes saved search/filter queries against other sources. Items are dynamically resolved at request time rather than statically listed — a "smart playlist" that re-evaluates on every access.

- **Protocol**: Internal query execution (delegates to `ContentQueryService`)
- **Formats produced**: none (items are references to other sources — each result carries its own format from its originating driver)
- **Capabilities**: `listable`, `queueable`
- **Multi-instance**: Yes — one per saved query definition
- **Config**: query definition YAML (source, filters, sort, limit)
- **Storage**: `data/household/config/lists/queries/{name}.yml`

Unlike yaml-config (which stores static item references), the query driver stores **filter definitions** and computes results at request time by delegating to the existing `ContentQueryService`. This means query containers automatically reflect new content as it appears in upstream sources.

#### Query Definition Schema

```yaml
# data/household/config/lists/queries/family-photos-2025.yml
title: Family Photos 2025
source: immich                    # target source (or omit for cross-source)
filters:
  time: "2025-01-01..2025-12-31"
  person: [Felix, Sarah]
sort: date
take: 100

# data/household/config/lists/queries/recent-fitness.yml
title: Recent Fitness Videos
source: plex
filters:
  tags: [fitness, exercise]
  time: "30d.."                   # relative: last 30 days
sort: date
take: 50

# data/household/config/lists/queries/daily-news.yml
title: Daily News
source: freshvideo-teded          # alias to filesystem instance
filters:
  time: "7d.."
sort: date
shuffle: false

# Date-based filesystem folder — e.g., daily devotional audio (MM-DD.mp3 files)
# data/household/config/lists/queries/daily-devotional.yml
title: Today's Devotional
source: devotionals               # filesystem instance pointing at /media/audio/365Daily/JesusCalling
filters:
  filename: "today()"             # resolve to current MM-DD
take: 1
```

#### How It Works

1. `query:family-photos-2025` resolves to the query driver
2. Driver reads `family-photos-2025.yml` from the queries directory
3. Driver calls `ContentQueryService.search()` with the saved filters
4. Results are returned as a dynamic container — each item carries the format from its originating source (e.g., `image` from Immich, `video` from Plex)
5. The container is `queueable` — `resolvePlayables()` returns the filtered results as a playable queue

#### Cross-Source Queries

When no `source` is specified, the query runs across all sources with `searchable` capability:

```yaml
# data/household/config/lists/queries/all-christmas.yml
title: Christmas Content
filters:
  tags: [christmas, holiday]
  time: "12-01..12-31"           # any year, Dec 1-31
sort: random
take: 20
```

This might return a mix of Immich photos, Plex movies, hymns, and scripture — all in one dynamic container.

#### Referencing Queries in Config Lists

Queries appear as items in menu/watchlist/program configs:

```yaml
# In a menu config
items:
  - title: Family Photos
    list:
      contentId: query:family-photos-2025   # browse query results
  - title: Workout Videos
    queue:
      contentId: query:recent-fitness       # play all as queue
  - title: Daily News
    play:
      contentId: query:daily-news           # play first result
```

#### Immich-Specific Query Power

Immich's rich metadata makes queries especially useful:

```yaml
# Photos of a specific person at a specific place
title: Felix at the Beach
source: immich
filters:
  person: Felix
  location: Santa Cruz
sort: date

# Recent favorites
title: Recent Favorites
source: immich
filters:
  favorites: true
  time: "90d.."

# AI/CLIP semantic search (Immich's smart search)
title: Sunset Photos
source: immich
filters:
  text: "sunset at the beach"     # uses CLIP embeddings
```

#### ContentSearchCombobox Integration

The admin UI's `ContentSearchCombobox` can use queries in two ways:

1. **Save current search as query** — user searches for content, then saves the current filters as a named query definition
2. **Browse saved queries** — saved queries appear as browsable containers, so the admin can drill into `query:family-photos-2025` to preview its dynamic results before referencing it in a list config

### app-registry

Frontend-only driver that resolves app content IDs against the app registry.

- **Protocol**: Frontend registry lookup
- **Formats produced**: `app`
- **Capabilities**: `playable`
- **Multi-instance**: No — global registry
- **Config**: none (apps self-register)

### local-content (deprecated)

Legacy adapter that handles hymn, primary, scripture, talk, and poem content via hardcoded if/else branches. Being replaced by SingalongAdapter + ReadalongAdapter which handle the same content via config-driven manifests.

- **Protocol**: Local disk read (same as filesystem)
- **Formats produced**: `singalong`, `readalong`
- **Capabilities**: `playable`, `listable`
- **Multi-instance**: No
- **Status**: Deprecated. Legacy `/api/v1/local-content/*` endpoints have RFC 8594 deprecation headers (Sunset: 2026-08-01). New code should use the unified Play API with SingalongAdapter/ReadalongAdapter.

### list (yaml-config lists)

Handles yaml-config lists (menus, watchlists, programs). Items are references to content in other sources.

- **Protocol**: YAML file parse
- **Formats produced**: none (references only)
- **Capabilities**: `listable`, `queueable`
- **Multi-instance**: No — scoped to household
- **Config**: path to lists directory
- **List subtypes**: menu, watchlist, program

### canvas adapters

Dedicated adapter classes for the `displayable` capability on image content. Not content source drivers — they serve thumbnails and display images.

- `FilesystemCanvasAdapter` — serves images from local filesystem directories
- `ImmichCanvasAdapter` — serves images from Immich via its API

While `canvas:` is an alias for content IDs (resolving to a filesystem instance), these adapters provide the thumbnail/display rendering layer.

---

## Non-Driver Content Pipelines

Some content referenced in lists is not served by a dedicated driver. Instead, external pipelines produce files that are then served by the generic filesystem driver.

### Ambient audio (internal asset, not a source)

115 numbered MP3 files in `/media/audio/ambient/` are used as background music for readalong content. They are not user-facing source instances — the readalong adapter references them internally when a collection's `manifest.yml` declares `ambient: true`. The scroller plays ambient audio at 10% of the main audio volume.

### freshvideo (ingestion pipeline, not a driver)

`FreshVideoService` is an application-layer cron job that downloads videos from RSS feeds (news, TED-Ed, etc.) into `/media/video/news/{provider}/YYYYMMDD.mp4`. At query time, these files are served by a generic filesystem source instance. The `freshvideo:teded` prefix in program lists resolves via alias to the appropriate filesystem instance.

- **Download**: `FreshVideoService` + `VideoSourceGateway` (yt-dlp)
- **Storage**: `/media/video/news/{provider}/YYYYMMDD.mp4`
- **Retention**: Configurable days-to-keep, auto-cleanup of old files
- **Query-time driver**: `filesystem` (generic, no `content_format`)

### canvas (alias, not a driver)

The legacy `canvas:` prefix is an alias to a filesystem source instance pointing at a folder of images. `canvas:religious/treeoflife.jpg` resolves to a filesystem instance via alias — the item is a `leaf` with `displayable` capability and `image` format. No separate driver needed. Any filesystem instance pointing at a directory of image files produces `displayable` items with `image` format.

---

## Adding a New Source Instance

### Adding a Collection (filesystem)

1. Create a directory with content files
2. Add a source instance entry in config
3. Optionally add an alias

```yaml
sources:
  my-karaoke:
    driver: filesystem
    content_format: singalong
    path: /data/content/singalong/karaoke

aliases:
  karaoke: my-karaoke
```

No code changes. The filesystem driver handles the new instance identically to any other.

### Adding a Remote Service

1. Implement the driver if the protocol is new (or reuse an existing driver)
2. Add a source instance entry in config

```yaml
sources:
  karaoke-server:
    driver: karaoke          # new driver, or could be a generic REST driver
    host: karaoke.local:8080
    api_key: xxx
    content_format: singalong

aliases:
  karaoke: karaoke-server
```

If the new service speaks a novel protocol, implement a new driver. If it returns the same format as existing content (e.g., `singalong`), the frontend renderer (SingalongScroller) works unchanged.

---

## Multi-Instance Resolution

When a content ID uses a driver or format name rather than a specific instance name:

1. **Default instance first** — the instance marked `default: true` (or `default_for: formatName`) is tried first
2. **Remaining instances in config order** — if the default can't resolve, try others
3. **First successful resolution wins**
4. **If available in multiple, default wins**

Users can use short-form IDs (`plex:12345`) for the common case. Instance-qualified IDs (`plex-kids:12345`) target a specific non-default instance.
