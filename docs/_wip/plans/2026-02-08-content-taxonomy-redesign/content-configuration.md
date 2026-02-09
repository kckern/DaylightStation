# Content Configuration

All content-related configuration is declarative. Source instances, aliases, collections, and list definitions are defined in YAML files. The code operates generically against these declarations.

---

## Source Instance Configuration

Source instances are configured in a unified sources configuration file. Each entry defines a named instance that uses a **driver** (protocol-level adapter). See content-sources.md for driver details.

**Current config split**: Today, external service configuration is split across two files:
- `data/system/config/adapters.yml` — connection details (host, port, protocol)
- `data/household/config/integrations.yml` — capability declarations (which providers the household uses)

```yaml
# Current: data/household/config/integrations.yml
media:
  - provider: plex
    protocol: dash
    platform: Chrome
gallery:
  - provider: immich
audiobooks:
  - provider: audiobookshelf
ebooks:
  - provider: audiobookshelf
  - provider: komga
```

The to-be format unifies these into a single `sources:` block with named instances:

```yaml
sources:
  # Remote API sources
  plex-main:
    driver: plex
    host: 192.168.1.10
    port: 32400
    token: xxxxxxxxxxxx
    default: true
    libraries:
      - Movies
      - TV Shows
      - Music

  plex-kids:
    driver: plex
    host: 192.168.1.11
    port: 32400
    token: yyyyyyyyyyyy

  family-photos:
    driver: immich
    host: photos.local
    api_key: zzzzzzzzzz
    default: true

  audiobooks:
    driver: audiobookshelf
    host: abs.local
    api_key: aaaaaaaaa

  # Filesystem sources — generic (single path, media IS the content)
  home-videos:
    driver: filesystem
    path: /media/video/clips
    extensions: [mp4, mkv, avi, mov]
    default: true

  family-music:
    driver: filesystem
    path: /media/audio/music
    extensions: [mp3, flac, ogg, m4a]

  # Singalong collections (split data_path / media_path)
  hymn-library:
    driver: filesystem
    content_format: singalong
    data_path: /data/content/singalong/hymn
    media_path: /media/audio/singalong/hymn
    default_for: singalong

  primary-songs:
    driver: filesystem
    content_format: singalong
    data_path: /data/content/singalong/primary
    media_path: /media/audio/singalong/primary

  # Readalong collections (split data_path / media_path)
  scriptures:
    driver: filesystem
    content_format: readalong
    data_path: /data/content/readalong/scripture
    media_path: /media/audio/readalong/scripture
    default_for: readalong

  conference-talks:
    driver: filesystem
    content_format: readalong
    data_path: /data/content/readalong/talks
    media_path: /media/video/readalong/talks

  poetry:
    driver: filesystem
    content_format: readalong
    data_path: /data/content/readalong/poetry
    media_path: /media/audio/readalong/poetry

  # Image folder (any directory of images becomes displayable)
  my-art-collection:
    driver: filesystem
    path: /media/img/art/classic
    extensions: [jpg, jpeg, png, webp]

  # Generic local media (clips, sound effects)
  local-media:
    driver: filesystem
    path: /media/video/clips
    default_for: files

  # YAML config instances
  fhe-menu:
    driver: yaml-config
    path: data/household/config/lists
```

### Required Fields

| Field | Description |
|-------|-------------|
| `driver` | Driver name (must match a registered driver: plex, immich, audiobookshelf, filesystem, yaml-config, app-registry) |

### Optional Fields

| Field | Description | Default |
|-------|-------------|---------|
| `default` | Whether this is the default instance for its driver | `false` (first instance becomes default if none specified) |
| `default_for` | Make this the default instance when resolving by content format name | — |
| `content_format` | Content format hint for the driver (e.g., `singalong`, `readalong`) | Driver inspects content structure |
| `host` | Remote API host (for remote drivers) | — |
| `path` | Filesystem path — for generic filesystem instances where media IS the content | — |
| `data_path` | Path to YAML metadata files — for singalong/readalong collections | — |
| `media_path` | Path to audio/video media files — for singalong/readalong collections | — |
| `token` / `api_key` | Authentication (for remote drivers) | — |

Additional fields are driver-specific and passed through to the adapter.

**Path field rules**: Generic filesystem instances (no `content_format`) use `path`. Singalong/readalong instances use `data_path` + `media_path` because YAML metadata and media files live on separate directory trees. If `data_path` is set but `media_path` is not, the driver looks for media alongside the YAML files (single-directory fallback).

---

## Alias Configuration

Aliases provide shorthand names that resolve through the content ID resolution chain (see content-model.md).

### System Aliases

Defined at the application level. These ship with the system and provide conventional shortcuts.

**To-be format** (unified aliases config):

```yaml
aliases:
  # Driver shortcuts (resolve to default instance for that driver)
  plex: plex-main
  immich: family-photos
  abs: audiobooks

  # Collection shortcuts (map friendly names to source instances)
  hymn: hymn-library
  primary: primary-songs
  scripture: scriptures
  talk: conference-talks
  poem: poetry
  canvas: my-art-collection
  media: local-media
  files: local-media

  # Legacy adapter name aliases (backward compat)
  singing: singalong
  narrated: readalong
```

**Current format** (`data/household/config/content-prefixes.yml`):

```yaml
# Maps legacy content prefixes to canonical singalong/readalong format
legacy:
  hymn: singalong:hymn
  primary: singalong:primary
  scripture: readalong:scripture
  # talk: handled by LocalContentAdapter directly (has selection logic)
  poem: readalong:poetry
```

The current prefix map rewrites legacy collection names to canonical `singalong:`/`readalong:` prefixes with sub-paths. The to-be alias system maps collection names to named source instances instead.

### Household Aliases

Defined per household. Users can create their own shortcuts.

```yaml
household_aliases:
  karaoke: my-karaoke
  bedtime-songs: primary-songs
  fhe-playlist: fhe-watchlist
  workout-music: family-music
```

### Resolution Priority

1. Exact instance name match
2. Driver/format type match (try instances with default priority)
3. System alias
4. Prefix expansion
5. Household alias

See content-model.md for the full 5-layer resolution chain.

---

## Collection Setup

A "collection" is simply a source instance using the filesystem driver with a `content_format` (singalong, readalong) backed by files on disk. There is no special "collection" concept in the code — collections are config, not code.

### Adding a Singalong Collection

1. Create directories for YAML metadata and audio files (matched by filename stem):

```
/data/content/singalong/karaoke/          # YAML metadata
├── journey-dont-stop.yml
├── queen-bohemian.yml
└── manifest.yml                          # optional: collection metadata

/media/audio/singalong/karaoke/           # Audio files
├── journey-dont-stop.mp3
└── queen-bohemian.mp3
```

2. Each item YAML contains verses as arrays of lines (duration is read from the audio file at runtime via `music-metadata`):

```yaml
title: The Morning Breaks
hymn_num: 1
verses:
  - - "The morning breaks, the shadows flee;"
    - "Lo, Zion's standard is unfurled!"
  - - "The clouds of error disappear"
    - "Before the rays of truth divine;"
```

3. Add a source instance:

```yaml
sources:
  my-karaoke:
    driver: filesystem
    content_format: singalong
    data_path: /data/content/singalong/karaoke
    media_path: /media/audio/singalong/karaoke
```

4. Optionally add an alias:

```yaml
aliases:
  karaoke: my-karaoke    # karaoke:journey-dont-stop → my-karaoke:journey-dont-stop
```

No code changes. The filesystem driver with `content_format: singalong` handles the new instance identically to any other singalong source.

### Adding a Readalong Collection

Same pattern: create a directory with YAML text files, add a source instance, optionally add an alias.

```
/data/content/readalong/poetry/
├── frost-road-not-taken.yml
├── frost-stopping-by-woods.yml
└── manifest.yml
```

### Collection Manifest

Each collection directory may include a `manifest.yml` to configure resolver, renderer, and playback behavior. See content-sources.md for the full field reference and plugin interface documentation.

```yaml
# Simple manifest — poetry collection (no custom resolver or renderer)
containerType: watchlist
contentType: paragraphs
ambient: true
style:
  fontFamily: serif
  fontSize: 1.3rem
  textAlign: left
```

```yaml
# Rich manifest — scripture collection (custom resolver + renderer + version defaults)
resolver: scripture              # backend: ID resolution plugin
renderer: scripture              # frontend: content rendering plugin
containerType: watchlist
contentType: verses
ambient: true
style:
  fontFamily: serif
  fontSize: 1.3rem
  textAlign: left
defaults:                        # per-section version defaults (text + audio)
  ot: { text: kjvf, audio: kjvf }
  bom: { text: sebom, audio: sebom }
  dc: { text: rex, audio: rex }
volumeTitles:
  ot: Old Testament
  bom: Book of Mormon
```

The `contentType` field determines how the frontend parses content by default: `verses` produces numbered verse arrays, `paragraphs` produces prose blocks. A collection with a custom `renderer` can override this entirely.

The `resolver` and `renderer` fields are generic plugin interfaces. Scripture is the first implementation, but any readalong collection with complex ID resolution or specialized formatting can declare its own (e.g., a Shakespeare collection with act/scene reference parsing and dialogue formatting).

### File Extension Support

Content files use both `.yml` and `.yaml` extensions. Talks use `.yaml`; hymns and scriptures use `.yml`. The filesystem driver supports both.

---

## Config Lists

Config lists are YAML files that define curated content structures. Items in config lists reference content from any source by content ID.

### File Locations

```
data/household/config/lists/
├── menus/
│   ├── tvapp.yml           # main TV app menu
│   ├── fhe.yml             # Family Home Evening
│   ├── ambient.yml         # ambient content menu
│   ├── bible.yml           # comprehensive Bible menu
│   ├── education.yml       # educational content
│   ├── music.yml           # music menu
│   └── ...
├── watchlists/
│   ├── cfmscripture.yml    # Come Follow Me scripture
│   ├── comefollowme2025.yml # full year CFM lessons
│   ├── talks.yml           # conference talks
│   └── ...
├── programs/
│   ├── morning-program.yml  # morning routine
│   ├── evening-program.yml  # evening routine
│   ├── cartoons.yml        # cartoon programs
│   └── ...
└── queries/
    └── dailynews.yml       # daily news query
```

### Menu Lists

Static navigation hierarchies. Users browse and select manually.

**To-be format** (action-as-key):

```yaml
title: FHE Night
items:
  - title: Opening Hymn
    play:
      contentId: hymn:198
    fixed_order: true
  - title: Scripture
    play:
      contentId: scripture:john-3-16
  - title: Lesson Video
    play:
      contentId: plex:12345
  - title: Family Activity
    open: family-selector
  - title: Closing Song
    play:
      contentId: primary:42
  - title: Treat Selection
    open: gratitude
```

**Current format** (input/label with separate action field):

```yaml
title: Fhe
items:
  - label: Opening Hymn
    input: singalong:hymn/166
    fixed_order: true
    image: https://...
    uid: e7302007-...
  - label: Spotlight
    input: app:family-selector/alan
    action: Open
  - label: Felix
    input: plex:457385
    action: Play
    active: true
  - label: Gratitude and Hope
    input: 'app: gratitude'          # space after colon — YAML quirk
    action: Open
  - label: Closing Hymn
    input: singalong:hymn/108
```

The yaml-config driver normalizes both formats. See gap-analysis.md §12 for migration details.

### Watchlists

Ordered playlists with watch state awareness. The ItemSelectionService filters and sorts items based on progress.

**To-be format**:

```yaml
title: Family Movies
strategy: unwatched-first
items:
  - contentId: plex:11111
    priority: 1
  - contentId: plex:22222
  - contentId: plex:33333
    hold: true              # temporarily excluded from selection
    holdReason: "Too scary for youngest"
  - contentId: plex:44444
    waitUntil: "2026-03-01"  # not eligible until date
```

**Current format**:

```yaml
# data/household/config/lists/watchlists/cfmscripture.yml
- title: D&C 1
  src: scriptures
  media_key: dc/rex/37707
  program: Rex Pinnegar
  priority: High
  uid: 250bd26f-...
  wait_until: '2025-01-12'
  skip_after: '2025-01-26'
  watched: true
  progress: 100
```

**Key fields**: `src` (source adapter name), `media_key` (content path within source), `program` (grouping label), `priority`, `wait_until`/`skip_after` (scheduling window), `watched`/`progress` (watch state).

### Programs

Sequenced content from diverse sources, with automatic selection.

**To-be format**:

```yaml
title: Scripture Study
strategy: sequential
schedule:
  frequency: daily
  time: "07:00"
items:
  - contentId: scripture:genesis-1
  - contentId: scripture:genesis-2
  - contentId: scripture:genesis-3
```

**Current format**:

```yaml
# data/household/config/lists/programs/morning-program.yml
- label: Intro
  input: 'media: sfx/intro'
- label: 10 Min News
  input: 'query: dailynews'
- label: Come Follow Me Supplement
  input: 'watchlist: comefollowme2025'
- label: Crash Course Kids
  input: 'plex: 375839'
- label: Ted Ed
  input: 'freshvideo: teded'
- label: General Conference
  input: 'talk: ldsgc'
- label: Wrap Up
  input: 'app: wrapup'
  action: Open
```

Programs reference diverse source types: `media:` (filesystem clips/sfx), `query:` (dynamic queries), `watchlist:` (watchlist selection), `plex:` (Plex content), `freshvideo:` (ingestion pipeline), `talk:` (conference talks), `app:` (interactive apps).

### Queries (Smart Playlists)

Dynamic content containers whose children are computed at request time from saved filter definitions. Unlike static watchlists, query results automatically reflect new content as it appears in upstream sources.

```yaml
# data/household/config/lists/queries/family-photos-2025.yml
title: Family Photos 2025
source: immich
filters:
  time: "2025-01-01..2025-12-31"
  person: [Felix, Sarah]
sort: date
take: 100
```

```yaml
# data/household/config/lists/queries/recent-fitness.yml
title: Recent Fitness Videos
source: plex
filters:
  tags: [fitness, exercise]
  time: "30d.."
sort: date
take: 50
```

```yaml
# Cross-source query (no source specified — searches all searchable sources)
# data/household/config/lists/queries/christmas-content.yml
title: Christmas Content
filters:
  tags: [christmas, holiday]
  time: "12-01..12-31"
sort: random
take: 20
```

#### Query Filter Reference

| Filter | Type | Description | Sources |
|--------|------|-------------|---------|
| `text` | string | Free text / CLIP semantic search | All searchable |
| `person` | string or string[] | Person/face name | Immich, talks (speaker) |
| `time` | string | Date range (`YYYY-MM-DD..YYYY-MM-DD`) or relative (`30d..`) | All |
| `tags` | string[] | Content tags/labels | Immich, Plex |
| `location` | string | City/state/country | Immich |
| `mediaType` | string | `image`, `video`, `audio` | All |
| `favorites` | boolean | Favorited items only | Immich, Plex |
| `sort` | string | `date`, `title`, `random` | All |
| `take` | number | Max results | All |

Queries are referenced in other config lists via `query:{name}`:

```yaml
# In a menu
- title: Family Photos
  list:
    contentId: query:family-photos-2025
```

See content-sources.md for the full query driver specification.

---

## Household Overrides

Household-level configuration can override system defaults:

| Override | Location | Purpose |
|----------|----------|---------|
| Additional source instances | household integrations config | Add household-specific sources |
| Household aliases | household content config | Shorthand names for this household |
| Watch state classifiers | household content config | Custom watched/unwatched thresholds |
| Default shader | household display config | Visual preferences |
