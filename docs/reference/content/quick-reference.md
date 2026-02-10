# Content Taxonomy Quick Reference

Every content item in DaylightStation is defined by four independent axes. This guide maps all dimensions with concrete examples.

---

## Content ID

Format: `{source}:{localId}`

```
plex-main:12345                    # Plex movie by ratingKey
hymn-library:198                   # Hymn #198 by number
immich:a1b2c3d4-uuid              # Immich photo by asset UUID
scriptures:bom/sebom/31103        # Scripture by volume/version/verse path
conference-talks:ldsgc/ldsgc202510/11   # Talk by conference/session/number
poetry:remedy/01                  # Poem by collection/number
home-videos:vacation/beach-day.mp4     # File by relative path
local-media:clips/rubik            # Local media clip by path
app:webcam                        # App by registry ID
query:family-photos-2025          # Saved query by name
fhe-menu:fhe                      # Config list by name
```

The source portion resolves through a 5-layer chain (see Resolution Chain below). The localId is opaque — each driver interprets it differently.

---

## Axis 1: Drivers & Source Instances

A **driver** is a protocol adapter. A **source instance** is a named config that uses a driver.

### Drivers

| Driver | Protocol | Produces Formats | Multi-Instance |
|--------|----------|-----------------|----------------|
| `plex` | Remote HTTP API | video, dash_video, audio, image | Yes |
| `immich` | Remote HTTP API | image, video | Yes |
| `audiobookshelf` (source: `abs`) | Remote HTTP API | audio, readable_flow, readable_paged | Yes |
| `komga` | Remote HTTP API | readable_paged | Yes |
| `filesystem` | Local disk | video, audio, image, singalong, readalong | Yes |
| `yaml-config` | YAML file parse | (static references) | No (one per household) |
| `query` | Internal query exec | (dynamic references) | Yes |
| `app-registry` | Frontend lookup | app | No |

### Source Instances (examples)

| Instance Name | Driver | content_format | default / default_for |
|---------------|--------|---------------|----------------------|
| `plex-main` | plex | — | `default: true` |
| `plex-kids` | plex | — | — |
| `family-photos` | immich | — | `default: true` |
| `audiobooks` | audiobookshelf | — | — |
| `home-videos` | filesystem | — | `default: true` |
| `hymn-library` | filesystem | singalong | `default_for: singalong` |
| `primary-songs` | filesystem | singalong | — |
| `scriptures` | filesystem | readalong | `default_for: readalong` |
| `conference-talks` | filesystem | readalong | — |
| `poetry` | filesystem | readalong | — |
| *(any image folder)* | filesystem | — (images) | — |
| `local-media` | filesystem | — | `default_for: files` |
| `fhe-menu` | yaml-config | — | — |

### Not Drivers

| Legacy Prefix | What It Actually Is |
|---------------|-------------------|
| `canvas:` | Alias → any filesystem image instance + `displayable` capability |
| `freshvideo:` | Ingestion pipeline (cron/yt-dlp) → files served by filesystem |
| `media:` / `files:` | Alias → generic filesystem instance |

---

## Axis 2: Content Formats

Format describes **what the content is** and determines **which renderer** displays it. Always returned by the adapter, never inferred from the content ID.

| Format | What It Is | Renderer | Media Element |
|--------|-----------|----------|---------------|
| `video` | Single media stream | VideoPlayer | `<video>` |
| `dash_video` | Adaptive bitrate | VideoPlayer (DASH) | `<dash-video>` |
| `audio` | Single audio stream | AudioPlayer | `<audio>` |
| `singalong` | Scrolling lyrics + audio | SingalongScroller | `<audio>` (embedded) |
| `readalong` | Scrollable text + optional audio/video | ReadalongScroller | `<audio>` (embedded) |
| `readable_paged` | Fixed pages (comics, manga, PDF) | PagedReader | none |
| `readable_flow` | Reflowable text (EPUB) | FlowReader | none |
| `image` | Static visual | ImageDisplay | `<img>` |
| `app` | Interactive UI with lifecycle | PlayableAppShell | none (app-defined) |

### Format-Specific Play API Response Fields

All responses include: `format`, `contentId`, `title`, `duration`, `thumbnail`

| Format | Additional Fields |
|--------|------------------|
| `video` / `dash_video` | `mediaUrl`, `mediaType`, `resumePosition`, `maxVideoBitrate` |
| `audio` | `mediaUrl`, `mediaType`, `albumArt`, `artist`, `album` |
| `singalong` | `audioUrl`, `verses` (array of verse arrays, each an array of line strings), `verseCount`, `duration` |
| `readalong` | `audioUrl`, `text`/`verses`, `ambientAudioUrl`, `videoUrl` (optional) |
| `readable_paged` | `contentUrl`, `totalPages`, `readingDirection` (ltr/rtl/ttb) |
| `readable_flow` | `contentUrl`, `resumeCfi` |
| `app` | `appId`, `appParam`, `appConfig` |
| `image` | `imageUrl`, `dimensions` |

---

## Axis 3: Capabilities

Capabilities describe **what actions are available** on an item.

| Capability | Meaning | Adapter Method | API Route |
|------------|---------|---------------|-----------|
| `playable` | Can render content | `getItem()` (returns PlayableItem) | `GET /api/v1/play/:source/*` |
| `readable` | Can render paged/flow text | `getItem()` (returns ReadableItem) | `GET /api/v1/play/:source/*` |
| `listable` | Has children, browsable | `getList()` | `GET /api/v1/list/:source/*` |
| `queueable` | Flatten to playable list | `resolvePlayables()` | `GET /api/v1/queue/:source/*` |
| `searchable` | Cross-source search | `search()` | `GET /api/v1/content/query/search` |
| `displayable` | Can produce thumbnail | `getThumbnail()` | `GET /api/v1/display/:source/*` |

### Driver × Capability Matrix

| Driver | playable | readable | listable | queueable | searchable | displayable |
|--------|----------|----------|----------|-----------|------------|-------------|
| plex | Y | — | Y | Y | Y | Y |
| immich | Y | — | Y | — | Y | Y |
| audiobookshelf | Y | Y | Y | Y | Y | — |
| komga | — | Y | Y | — | Y | — |
| filesystem | Y | — | Y | — | Y | Y |
| yaml-config | — | — | Y | Y | — | — |
| query | — | — | Y | Y | — | — |
| app-registry | Y | — | — | — | — | — |

### `displayable` vs `image` format

- **`displayable`** = capability. Item can produce a thumbnail. A Plex movie is `displayable` (poster art) but format is `video`.
- **`image`** = format. Item IS an image, rendered full-screen. An Immich photo is both `displayable` AND format `image`.

### Display Placeholder SVG

When the Display API (`/api/v1/display/:source/*`) cannot find a thumbnail for an item (no `getThumbnailUrl()` result and no `thumbnail`/`imageUrl` on the item), it returns a generated placeholder SVG instead of a 404. The placeholder is a square SVG with a dark background, a color-coded type badge, and the item title.

- **Utility**: `backend/src/4_api/v1/utils/placeholderSvg.mjs`
- **Badge colors**: Per-source-type color map (talk=green, scripture=brown, hymn=purple, plex=gold, etc.)
- **Content**: Type badge label (uppercase source name) + item title (truncated, XML-escaped)
- **Response**: `Content-Type: image/svg+xml` — renders natively in `<img>` tags and browsers

---

## Axis 4: Item Type

| Type | Meaning | Typical Capabilities | Examples |
|------|---------|---------------------|----------|
| `container` | Has children, browse into it | listable, queueable | TV show, album, hymn collection, playlist |
| `leaf` | Terminal, act on directly | playable, displayable | Episode, track, hymn, photo |

Orthogonal to all other axes. A plex item could be either. A filesystem directory is a container; a file is a leaf.

---

## Content ID Resolution Chain

When a content ID is used, it resolves through 5 layers (first match wins):

| Layer | What It Does | Example |
|-------|-------------|---------|
| 1. Exact instance | Source matches a configured instance name | `hymn-library:198` → instance `hymn-library` |
| 2. Driver/format match | Source matches a driver or format name, try instances with default priority | `singalong:hymn/198` → try `hymn-library` (default_for: singalong) |
| 3. System alias | Source matches a system alias, rewrite and re-enter | `hymn:198` → alias → `hymn-library:198` |
| 4. Prefix expansion | Adapter tries known path prefixes | `singalong:198` → try `hymn/198`, `primary/198` |
| 5. Household alias | Source matches a user-defined alias | `bedtime-songs:3` → alias → `primary-songs:3` |

### System Aliases

| Alias | Resolves To | Purpose |
|-------|------------|---------|
| `hymn` | `hymn-library` | Collection shortcut |
| `primary` | `primary-songs` | Collection shortcut |
| `scripture` | `scriptures` | Collection shortcut |
| `talk` | `conference-talks` | Collection shortcut |
| `poem` | `poetry` | Collection shortcut |
| `canvas` | *(image folder instance)* | Legacy prefix compat |
| `media` / `files` | `local-media` | Generic file access |
| `plex` | `plex-main` | Driver shortcut |
| `immich` | `family-photos` | Driver shortcut |
| `singing` | `singalong` | Legacy adapter compat |
| `narrated` | `readalong` | Legacy adapter compat |

---

## Actions

Actions determine what happens when a user selects content.

| Action | What It Does | MenuStack Type | Queue Participant? |
|--------|-------------|---------------|-------------------|
| `play` | Render single item | `player` | Yes |
| `queue` | Flatten container, play all | `player` | Yes |
| `list` | Browse container children | `menu` | No |
| `open` | Launch standalone app | `app` | No |
| `display` | Show static image | `display` | No |
| `read` | Open paged/flow reader (served via play route) | `reader` | No |

### `play` vs `open` (apps)

| | `play: { contentId: 'app:webcam' }` | `open: 'webcam'` |
|---|---|---|
| Wrapper | PlayableAppShell | AppContainer |
| Queue? | Yes — auto-advances | No — ESC to dismiss |
| Contract? | Full Playable Contract | ESC only |

Same app component, different lifecycle wrapper.

---

## API Surface

| Route | Capability | Purpose |
|-------|-----------|---------|
| `GET /api/v1/play/:source/*` | playable, readable | Resolve content → format + render data (readable content also served here) |
| `GET /api/v1/list/:source/*` | listable | Browse container children |
| `GET /api/v1/queue/:source/*` | queueable | Flatten container to playable list |
| `GET /api/v1/display/:source/*` | displayable | Get thumbnail/image |
| `GET /api/v1/siblings/:source/*` | — | Peer navigation (same-level items) |
| `GET /api/v1/content/query/search` | searchable | Cross-source text search |
| `GET /api/v1/content/query/search/stream` | searchable | SSE streaming search |
| `POST /api/v1/content/compose` | — | Multi-track composite resolution |
| `GET /api/v1/content/sources` | — | Discovery: available sources |
| `GET /api/v1/content/aliases` | — | Discovery: alias mappings |

### List API Modifiers

Appended to path: `/playable` (flatten to leaves), `/shuffle` (randomize), `/recent_on_top` (by interaction history)

Query params: `take=N`, `skip=N`

### Search API Filters

| Filter | Type | Sources |
|--------|------|---------|
| `text` | string | All searchable |
| `person` | string/string[] | Immich (face), talks (speaker) |
| `time` | date range or relative | All |
| `tags` | string[] | Immich, Plex |
| `location` | string | Immich |
| `mediaType` | image/video/audio | All |
| `favorites` | boolean | Immich, Plex |
| `sort` | date/title/random | All |

---

## Adapter Contract (Driver Interface)

### Required (validated by `IContentSource.mjs`)

| Method | Returns |
|--------|---------|
| `getItem(localId)` | Item metadata (title, thumbnail, mediaType, capabilities). For playable content, returns PlayableItem. |
| `getList(localId)` | Children of a container |
| `resolvePlayables(localId)` | Ordered list of playable leaves |
| `resolveSiblings(compoundId)` | Peer items + parent info |

### Optional (capability-gated, not validated)

| Method | Capability | Returns |
|--------|-----------|---------|
| `search(query)` | searchable | Items matching text/filters |
| `getThumbnail(localId)` | displayable | Image/thumbnail URL |
| `getCapabilities(localId)` | — | List of capabilities for an item |
| `getContainerType(id)` | — | Container type string for selection strategy inference |
| `getStoragePath(id)` | — | Persistence key for watch state storage |
| `getSearchCapabilities()` | searchable | Supported search filters and query mappings |

---

## Playable Contract (Renderer Interface)

All renderers implement this interface so the queue controller is format-agnostic.

### Inbound (Player → Renderer)

| Prop | Type | Purpose |
|------|------|---------|
| `advance` | `() => void` | Next queue item |
| `clear` | `() => void` | Stop playback |
| `shader` | `string` | Visual overlay mode |
| `volume` | `number` | 0–1 |
| `playbackRate` | `number` | Speed multiplier |
| `seekToIntentSeconds` | `number \| null` | External seek request |
| `onSeekRequestConsumed` | `() => void` | Acknowledge seek applied |

### Outbound (Renderer → Player)

| Callback | Type | Purpose |
|----------|------|---------|
| `onPlaybackMetrics` | `(metrics) => void` | Report playback state |
| `onRegisterMediaAccess` | `(accessors) => void` | Register media element |
| `onResolvedMeta` | `(meta) => void` | Report resolved metadata |
| `onStartupSignal` | `() => void` | Signal playback started |

### Implementation Status

| Renderer | Format(s) | Mechanism | Status |
|----------|-----------|-----------|--------|
| VideoPlayer | video, dash_video | `useCommonMediaController` | Complete |
| AudioPlayer | audio | `useCommonMediaController` | Complete |
| SingalongScroller | singalong | ContentScroller → `useMediaReporter` | Complete |
| ReadalongScroller | readalong | ContentScroller → `useMediaReporter` | Complete |
| PlayableAppShell | app | Delegates to AppContainer | Minimal stub (exists, delegates to AppContainer) |
| PagedReader | readable_paged | Page navigation | Placeholder stub |
| FlowReader | readable_flow | CFI-based position | Placeholder stub |

---

## Player Component Hierarchy

```
Player.jsx
├─ Composite? → CompositePlayer
│   ├─ Visual track → VisualRenderer (app, image, video)
│   └─ Audio track → nested Player
└─ Single? → SinglePlayer.jsx
    ├─ Resolve: fetchMediaInfo() → /api/v1/play/ + /api/v1/info/
    └─ Dispatch by format → [renderer from table above]
```

---

## Config Lists

YAML-defined content structures in `data/household/config/lists/`.

| List Type | Directory | Selection | Items Are |
|-----------|-----------|-----------|-----------|
| **menu** | `menus/` | Manual browse & select | Static references |
| **watchlist** | `watchlists/` | Watch state filtering, priority sort | Static references + progress |
| **program** | `programs/` | Time-based, strategy-driven | Static references + schedule |
| **query** | `queries/` | Dynamic filter execution | Filter definitions (computed at request time) |

### Item Actions (To-Be Format)

```yaml
- title: Opening Hymn
  play: { contentId: hymn:198 }

- title: Movies
  list: { contentId: plex-main:67890 }

- title: Family Activity
  open: family-selector

- title: Art
  display: { contentId: canvas:treeoflife.jpg }

- title: Workout Videos
  queue: { contentId: query:recent-fitness }
```

### Item Actions (Current Format)

```yaml
- label: Opening Hymn
  input: singalong:hymn/166         # content ID in source:localId format
  fixed_order: true

- label: Spotlight
  input: app:family-selector/alan   # app with param
  action: Open

- label: Felix
  input: plex:457385                # Plex media by key
  action: Play

- label: Soren
  input: canvas:religious/treeoflife.jpg
  action: Display

- label: Gratitude and Hope
  input: 'app: gratitude'           # space after colon (YAML quirk — must .trim())
  action: Open
```

### Menus

Static navigation hierarchies for manual browsing. Located in `menus/`.

```yaml
# data/household/config/lists/menus/fhe.yml
title: Fhe
items:
  - label: Opening Hymn
    input: singalong:hymn/166
    fixed_order: true
  - label: Spotlight
    input: app:family-selector/alan
    action: Open
  - label: Gratitude and Hope
    input: 'app: gratitude'
    action: Open
  - label: Closing Hymn
    input: singalong:hymn/108
```

Key menu files: `tvapp.yml` (main TV menu), `fhe.yml` (family home evening), `bible.yml` (comprehensive Bible nav), `ambient.yml`, `education.yml`, `music.yml`, `kids.yml`

### Watchlists

Ordered playlists with watch state, scheduling, and priority metadata. ItemSelectionService filters and sorts.

```yaml
# data/household/config/lists/watchlists/cfmscripture.yml
- title: D&C 1
  src: scriptures                     # source adapter name
  media_key: dc/rex/37707            # content path within source
  program: Rex Pinnegar              # grouping label
  priority: High
  uid: 250bd26f-...
  wait_until: '2025-01-12'           # not eligible until this date
  skip_after: '2025-01-26'           # auto-skip after this date
  watched: true
  progress: 100
```

Key watchlist files: `cfmscripture.yml`, `comefollowme2025.yml` (58K, full year), `talks.yml`, `scripture.yml`

### Programs

Sequenced content from diverse sources with automatic selection. Items reference multiple source types.

```yaml
# data/household/config/lists/programs/morning-program.yml
- label: Intro
  input: 'media: sfx/intro'               # filesystem clip
- label: 10 Min News
  input: 'query: dailynews'               # dynamic query
- label: Come Follow Me Supplement
  input: 'watchlist: comefollowme2025'     # watchlist (auto-selects next)
- label: Crash Course Kids
  input: 'plex: 375839'                   # Plex content
- label: Ted Ed
  input: 'freshvideo: teded'              # ingestion pipeline
- label: General Conference
  input: 'talk: ldsgc'                    # conference talks (auto-selects)
- label: Wrap Up
  input: 'app: wrapup'                    # interactive app
  action: Open
```

Key program files: `morning-program.yml`, `evening-program.yml`, `cartoons.yml`, `music-queue.yml`

### Queries (Smart Playlists)

Dynamic containers — filter definitions re-evaluated at request time.

```yaml
# data/household/config/lists/queries/dailynews.yml
type: freshvideo
sources:
  - news/world_az
  - news/cnn
```

See content-sources.md for the full query driver specification and filter reference.

---

## Filesystem Driver Variants

The filesystem driver behaves differently based on `content_format`:

| content_format | Config Fields | File Structure | Produces |
|---------------|--------------|----------------|----------|
| (none) | `path` | Raw media files | video, audio, image |
| `singalong` | `data_path` + `media_path` | YAML metadata + audio, matched by filename stem | singalong |
| `readalong` | `data_path` + `media_path` | YAML text + optional audio/video, matched by stem | readalong |

### Collection Manifest (`manifest.yml`)

Collections may declare metadata that controls resolver, renderer, and playback behavior. Collections without a manifest use default behavior (direct path lookup, generic rendering).

| Field | Purpose | Example |
|-------|---------|---------|
| `resolver` | Backend: named ID resolution plugin | `scripture` |
| `renderer` | Frontend: named content rendering plugin | `scripture` |
| `containerType` | Selection integration | `watchlist` |
| `contentType` | Default parse mode (`verses`, `paragraphs`) | `verses` |
| `ambient` | Background audio during playback | `true` |
| `style` | CSS vars (`fontFamily`, `fontSize`, `textAlign`) | `{ fontFamily: serif }` |
| `defaults` | Resolver-specific: per-section version defaults | `{ bom: { text: sebom } }` |
| `volumeTitles` | Human-readable section names | `{ ot: Old Testament }` |

### Plugin Interfaces (Resolver + Renderer)

Readalong collections can customize ID resolution and rendering via two thin plugin interfaces declared in their manifest. Both are generic — scripture is the first implementation, but any collection could provide its own.

**Backend Resolver** — converts `localId` → file paths:

| Resolver | What It Does |
|----------|-------------|
| `scripture` | Reference strings (`1-nephi-1`) → verse IDs, multi-version path resolution via `scripture-guide` package |
| (default) | Direct path lookup with directory traversal |

**Frontend Renderer** — controls content → JSX parsing, title extraction, CSS type:

| Renderer | What It Does |
|----------|-------------|
| `scripture` | Verse-numbered prose/poetry, heading markers, title via `scripture-guide.generateReference()` |
| (default) | Generic verse arrays or paragraph blocks based on `contentType` |

To add a new collection with custom resolution (e.g., Shakespeare with act/scene references), declare `resolver: shakespeare` and `renderer: shakespeare` in the manifest, implement the thin interfaces, and the rest of the readalong pipeline (scrolling, audio sync, queue, progress) works unchanged.

**Container Type** — controls selection strategy when playing a container:

The `containerType` manifest field (or the adapter's `getContainerType()` method) tells `ItemSelectionService` how to select from a container's children. The service maps container types to named strategies via inference rules:

| Container Type | Strategy | Behavior |
|---------------|----------|----------|
| `watchlist` | watchlist | Priority-sorted, skip watched |
| `conference` | sequential | Source-order, skip watched, pick first unwatched |
| `series` | sequential | Source-order, skip watched |
| `playlist` | binge | Play all in order |

To add a new selection behavior for a container type: add an inference rule in `ItemSelectionService.mjs` mapping the container type to an existing strategy, or define a new strategy if the existing ones don't fit.

**Ambient Audio** — background music during readalong playback:

Collections with `ambient: true` in their manifest get background audio layered under the main content. The frontend generates a random track reference from 115 numbered ambient MP3s in `/media/audio/ambient/`. Ambient volume is always 10% of the main audio volume. Talks and scriptures use ambient audio; hymns and poetry do not.

### Directory Structures

**Scripture**: `section/version/itemId` — `bom/sebom/31103`, `ot/kjvf/1`, `dc/rex/37707`

**Talks**: `conference/session/talkNum` — `ldsgc/ldsgc202510/11` (uses `.yaml` extension)

**Hymns/Primary**: `NNNN-slug-name.yml` + matching `.mp3` — `0001-the-morning-breaks`

---

## Cross-Reference: Example Items Across All Axes

| Example | Driver | Instance | Format | Capabilities | Item Type |
|---------|--------|----------|--------|-------------|-----------|
| Plex movie | plex | plex-main | video | playable, displayable | leaf |
| Plex TV show | plex | plex-main | — | listable, queueable, displayable | container |
| Plex episode | plex | plex-main | video | playable, displayable | leaf |
| Plex music album | plex | plex-main | — | listable, queueable, displayable | container |
| Plex track | plex | plex-main | audio | playable, displayable | leaf |
| Immich photo | immich | family-photos | image | playable, displayable | leaf |
| Immich album | immich | family-photos | — | listable, displayable | container |
| Immich person | immich | family-photos | — | listable, searchable | container |
| ABS audiobook | audiobookshelf | audiobooks | audio | playable, listable | leaf |
| ABS ebook | audiobookshelf | audiobooks | readable_flow | readable | leaf |
| Komga comic | komga | comics | readable_paged | readable | leaf |
| Komga series | komga | comics | — | listable, searchable | container |
| Hymn #198 | filesystem | hymn-library | singalong | playable | leaf |
| Hymn collection | filesystem | hymn-library | — | listable, searchable | container |
| Scripture verse | filesystem | scriptures | readalong | playable | leaf |
| Conference talk | filesystem | conference-talks | readalong | playable | leaf |
| Poem | filesystem | poetry | readalong | playable | leaf |
| Home video clip | filesystem | home-videos | video | playable | leaf |
| Image from folder | filesystem | *(any image instance)* | image | displayable | leaf |
| FHE menu | yaml-config | fhe-menu | — | listable, queueable | container |
| Watchlist | yaml-config | fhe-menu | — | listable, queueable | container |
| Program | yaml-config | fhe-menu | — | listable, queueable | container |
| Saved query | query | — | — | listable, queueable | container |
| Video clip | filesystem | local-media | video | playable | leaf |
| SFX audio clip | filesystem | local-media | audio | playable | leaf |
| Webcam app | app-registry | — | app | playable | leaf |
| Gratitude app | app-registry | — | app | playable | leaf |

---

## Non-Code Concepts (Config, Not Code)

The code knows about **drivers**, **formats**, **capabilities**, and the **Playable Contract**.

The code does NOT know about:

| Concept | Lives In | Example |
|---------|---------|---------|
| Collection names | Source instance config | "hymn-library", "scriptures" |
| Aliases | Alias config (system + household) | `hymn` → `hymn-library` |
| Menu structure | YAML list configs | FHE Night menu items |
| Watch state rules | Watchlist configs | unwatched-first, hold, waitUntil |
| Query definitions | Query YAML files | "photos of Felix from 2025" |
| Household overrides | Household config | Custom aliases, display prefs |

Adding a new collection = add files + add config. Zero code changes.
