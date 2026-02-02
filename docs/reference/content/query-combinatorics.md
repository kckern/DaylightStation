# Query Combinatorics Reference

This document maps the complete possibility space for content queries in DaylightStation. It defines the dimensions, valid combinations, constraints, and interaction rules that govern how actions, sources, IDs, and modifiers combine.

For API topology and response formats, see `content-stack-reference.md`.

---

## 1. Dimensions

The query system operates across these orthogonal dimensions:

| Dimension | Values | Count |
|-----------|--------|-------|
| **Action** | `play`, `queue`, `display`, `list`, `read`, `open` | 6 |
| **Source** | `plex`, `immich`, `audiobookshelf`, `komga`, `folder`, `canvas`, `filesystem` | 7 |
| **Category Alias** | `gallery`, `media`, `audiobooks`, `ebooks`, `local` | 5 |
| **Resolution Strategy** | explicit, query, heuristic, alias, nested | 5 |
| **Target Type** | leaf, container | 2 |
| **Capability** | `playable`, `displayable`, `readable`, `listable` | 4 |
| **Cardinality** | single, multi-same-source, multi-track | 3 |
| **Query Keys** | `text`, `person`, `time`, `duration`, `mediaType`, `creator` | 6+ |
| **Modifiers** | `shuffle`, `loop`, `continuous`, `sort`, `take`, `skip`, `pick` | 7+ |

### Combinatorial Scale

```
Full Cartesian (base dimensions only):
  6 × 7 × 5 × 2 × 4 × 3 = 5,040 combinations

With query key presence/absence (2^6):
  5,040 × 64 = 322,560 combinations

With modifiers (2^7):
  322,560 × 128 ≈ 41 million combinations
```

Constraints reduce the valid space significantly, but this illustrates why exhaustive testing is impractical.

---

## 2. Actions

### Action Definitions

| Action | Purpose | Returns | Primary Use |
|--------|---------|---------|-------------|
| `play=` | Immediate playback | Single playable item | Watch/listen now |
| `queue=` | Sequential playback | List of playable items | Play all in order |
| `display=` | Static visual | Viewable item(s) | Show image/slideshow |
| `list=` | Browse contents | Menu structure | Navigation |
| `read=` | Open reader | Readable item | Ebooks, comics |
| `open=` | Launch app | N/A | App routing |

### Action × Target Type Behavior

| Action | Leaf Target | Container Target |
|--------|-------------|------------------|
| `play` | Play item, stop when done | Pick ONE item, play it, stop |
| `queue` | Queue single item | Queue ALL items, play sequentially |
| `display` | Show single image | Slideshow of contents |
| `list` | **Invalid** (leaf not listable) | Browse as menu |
| `read` | Open in reader | Browse TOC or pick first |
| `open` | N/A | N/A |

### Container Selection (play/queue)

When `play=container` or `queue=container`, item selection is handled by **ItemSelectionService**. The service uses context-aware strategies to determine which items to return and in what order.

**Strategy resolution:** infer from context → apply config defaults → apply explicit overrides

| Container Type | Default Strategy | Filter | Sort | Pick |
|----------------|------------------|--------|------|------|
| Watchlist | `watchlist` | skipAfter, hold, watched, days | priority | first (play) / all (queue) |
| Album | `album` | none | track_order | first (play) / all (queue) |
| Playlist | `playlist` | none | source_order | first (play) / all (queue) |
| Search results | `discovery` | none | random | first (play) / all (queue) |

**Watchlist strategy** implements the "next lecture today" pattern:
- Filters out: watched (>90%), on hold, past `skipAfter`, `waitUntil` >2 days, wrong day of week
- Promotes items with `skipAfter` within 8 days to `priority: urgent`
- Sorts by: in_progress (by % desc) > urgent > high > medium > low

See `item-selection-service.md` for full API reference.

### Nested Containers

When a container contains other containers, all nested playables are flattened. Order follows the container type's strategy (album → track order, show → episode order, etc.).

### Heterogeneous Containers (Program of Watchlists)

When queuing a container whose children have different selection semantics:

| Child Type | Contribution to Queue |
|------------|----------------------|
| Watchlist | ONE item (next eligible by priority/filters) |
| Album | ALL tracks (in track order) |
| Playlist | ALL items (in playlist order) |
| Show | ALL episodes (in episode order) |

**Example:** A "Daily Program" containing `[Watchlist:FHE, Watchlist:Scripture, Album:Hymns]`

```
queue=program
    ↓
├── FHE watchlist      → 1 item (next unwatched, highest priority)
├── Scripture watchlist → 1 item (next unwatched, highest priority)
└── Hymns album        → 12 items (all tracks in order)
    ↓
Queue: 14 items total
```

Each child is resolved using **its own container type's strategy**, not the parent's. The parent container serves as a grouping mechanism only.

---

## 3. Sources

### Concrete Sources

| Source | Category | Capabilities Produced | ID Format |
|--------|----------|----------------------|-----------|
| `plex` | media | playable, listable | digits (ratingKey) |
| `immich` | gallery | displayable, playable (video), listable | UUID |
| `audiobookshelf` | audiobooks, ebooks | playable, readable, listable | UUID |
| `komga` | ebooks | readable, listable | UUID |
| `folder` | local | listable, mixed references | path |
| `canvas` | gallery | displayable, listable | path |
| `filesystem` | media | playable, listable | path |
| `singing` | singing | playable, listable (with synced stanzas) | `{collection}/{number}` |
| `narrated` | narrated | playable, listable (with synced paragraphs) | `{collection}/{path}` |
| `list` | local | listable (menus, programs, watchlists) | `{type}:{name}` |

### Category Aliases

| Alias | Resolves To | Notes |
|-------|-------------|-------|
| `gallery` | immich, canvas | All visual sources |
| `media` | plex, filesystem | All playable media |
| `audiobooks` | audiobookshelf | Audio long-form |
| `ebooks` | audiobookshelf, komga | Readable content |
| `local` | folder, list | Local content sources |
| `singing` | singing | Participatory sing-along content |
| `narrated` | narrated | Follow-along narrated content |

### Prefix Aliases (ID Resolution)

| Prefix | Resolves To | Example |
|--------|-------------|---------|
| `media:` | filesystem | `media:audio/song.mp3` |
| `file:` | filesystem | `file:video/movie.mp4` |
| `local:` | folder | `local:TVApp/menu` |
| `singing:` | singing | `singing:hymn/123` |
| `narrated:` | narrated | `narrated:scripture/alma-32` |
| `menu:` | list | `menu:TVApp/main` |
| `program:` | list | `program:daily` |
| `watchlist:` | list | `watchlist:FHE` |
| `hymn:` | singing (legacy) | `hymn:123` → `singing:hymn/123` |
| `scripture:` | narrated (legacy) | `scripture:alma-32` → `narrated:scripture/alma-32` |

---

## 4. Resolution Strategies

### Resolution Path Detection

| ID Pattern | Strategy | Example |
|------------|----------|---------|
| `source:localId` | Explicit | `plex:12345`, `immich:abc-def` |
| `source.query:term` | Query | `plex.query:Mozart`, `gallery.query:beach` |
| Digits only | Heuristic → plex | `12345` |
| Path-like | Heuristic → filesystem | `audio/song.mp3` |
| `source:type:id` | Nested | `immich:person:uuid`, `immich:album:uuid` |
| `alias:id` | Alias expansion | `media:audio/song.mp3` → `filesystem:audio/song.mp3` |

### Resolution Flow

```
Input ID
    │
    ├── Contains ".query:" ? ─────────────────────► Query Path
    │                                               (ContentQueryService)
    │
    └── Explicit/Heuristic ───► Parse source:localId
                                        │
                                        ├── Known source? ──► Adapter lookup
                                        │
                                        ├── Known alias? ───► Expand, retry
                                        │
                                        └── No colon? ──────► Heuristic detection
                                                              (digits→plex, path→filesystem)
```

---

## 5. Capabilities

### Capability Definitions

| Capability | Required Fields | Meaning |
|------------|-----------------|---------|
| `playable` | `mediaUrl`, `duration` | Can be played (video, audio) |
| `displayable` | `imageUrl` | Can be displayed (photo, art) |
| `readable` | `contentUrl`, `format` | Can be read (ebook, comic) |
| `listable` | `items[]` or `itemType=container` | Has browsable children |

### Source × Capability Production

```
                    ┌─────────────────────────────────────────┐
                    │           LEAF CAPABILITIES             │
                    ├─────────────┬─────────────┬─────────────┤
                    │  playable   │ displayable │  readable   │
┌───────────────────┼─────────────┼─────────────┼─────────────┤
│ plex              │ ✓ video,    │ ~ thumb     │ ✗           │
│                   │   audio     │   only      │             │
├───────────────────┼─────────────┼─────────────┼─────────────┤
│ immich            │ ✓ video     │ ✓ photo     │ ✗           │
├───────────────────┼─────────────┼─────────────┼─────────────┤
│ audiobookshelf    │ ✓ audio     │ ~ cover     │ ✓ ebook     │
├───────────────────┼─────────────┼─────────────┼─────────────┤
│ komga             │ ✗           │ ~ cover     │ ✓ comic     │
├───────────────────┼─────────────┼─────────────┼─────────────┤
│ folder            │ ~ refs      │ ~ refs      │ ~ refs      │
├───────────────────┼─────────────┼─────────────┼─────────────┤
│ canvas            │ ✗           │ ✓ image     │ ✗           │
├───────────────────┼─────────────┼─────────────┼─────────────┤
│ filesystem        │ ✓ audio,    │ ~ image     │ ✗           │
│                   │   video     │             │             │
├───────────────────┼─────────────┼─────────────┼─────────────┤
│ singing           │ ✓ audio     │ ✗           │ ✗           │
│                   │ + content   │             │             │
├───────────────────┼─────────────┼─────────────┼─────────────┤
│ narrated           │ ✓ audio,    │ ✗           │ ✗           │
│                   │   video     │             │             │
│                   │ + content   │             │             │
├───────────────────┼─────────────┼─────────────┼─────────────┤
│ list              │ ~ refs      │ ✗           │ ✗           │
└───────────────────┴─────────────┴─────────────┴─────────────┘

Legend: ✓ = native support, ~ = partial/derived, ✗ = not supported
Note: singing/narrated produce playable items with synchronized `content` for UI rendering
```

### Action × Capability Validity

|  | playable | displayable | readable |
|--|----------|----------|----------|
| **play** | ✓ Valid | ~ Degrade | ✗ Error |
| **queue** | ✓ Valid | ~ Slideshow? | ✗ Error |
| **display** | ~ Thumbnail | ✓ Valid | ~ Cover |
| **list** | (targets containers, not leaves) |||
| **read** | ✗ Error | ✗ Error | ✓ Valid |

---

## 6. Cardinality

### Single Item

```
play=plex:12345
display=immich:abc-def-123
```

One ID, one result.

### Multi-Same-Source

```
play=plex:123,plex:456,plex:789
queue=immich:abc,immich:def
```

Comma-separated IDs from same or different sources. Order preserved as specified.

### Multi-Track (Composed Presentation)

```
play=visual:immich:abc,audio:plex:123
```

Track labels (`visual:`, `audio:`) assign content to presentation layers.

| Track Label | Expected Capability | Layer |
|-------------|---------------------|-------|
| `visual` | displayable (or playable video) | Display layer |
| `audio` | playable audio | Audio layer |
| `text` | readable (future) | Overlay/subtitle |
| (unlabeled) | Inferred from content | Auto-assign |

---

## 7. Query Filters

### Canonical Query Keys

| Key | Description | Example |
|-----|-------------|---------|
| `text` | Free text search | `text=Mozart` |
| `person` | Filter by person/face | `person=uuid` |
| `time` | Date/time filter | `time=2024`, `time=2020..2024` |
| `duration` | Length filter | `duration=3m..10m` |
| `mediaType` | Content type | `mediaType=video` |
| `creator` | Creator/author/director | `creator=Spielberg` |

### Filter × Source Support

```
                    plex    immich   abs      komga   filesystem   canvas
    text            ✓       ✓        ✓        ✓       ~            ✗
    person          ✗       ✓        ✗        ✗       ✗            ✗
    time            ✓year   ✓range   ✗        ✗       ~mtime       ✗
    duration        ~       ✓        ✓        ✗       ~            ✗
    mediaType       ✓       ✓        ✓        ✓       ✓            ✗
    creator         ✓dir    ✗        ✓author  ✓author ✗            ✗
    rating          ✓       ✗        ✗        ✗       ✗            ✗
    genre           ✓       ✗        ✓        ✓       ✗            ✗
    location        ✗       ✓        ✗        ✗       ✗            ✗
    camera          ✗       ✓        ✗        ✗       ✗            ✗
```

### Filter Combination Semantics

Multiple filters combine with AND:

```
text=Mozart&time=2024        → Mozart recordings from 2024
person=uuid&mediaType=video  → Videos containing person
source=gallery&time=2024     → Gallery items from 2024
```

### Adapter-Specific Filters

Bypass canonical translation with prefixed keys:

```
immich.cameraModel=iPhone
plex.rating=8..10
audiobookshelf.narrator=Stephen+Fry
```

---

## 8. Sorting

### Default Sort by Context

| Query Context | Default Sort | Rationale |
|---------------|--------------|-----------|
| General search | Random/shuffle | Discovery mode |
| Album match | Track order | Respect artist intent |
| Playlist reference | Playlist order | User-curated |
| `person=` filter | Chronological | Timeline narrative |
| `time=` filter | Chronological | Temporal query |
| Folder/directory | Filename order | Filesystem convention |
| Container children | Source-native order | Trust source |

### Album Detection Signals

When a query might reference a specific album:

| Signal | Weight | Behavior |
|--------|--------|----------|
| Exact title match | High | Return tracks in order |
| Artist:Album pattern | High | Return tracks in order |
| All results share `parentId` | Medium | Likely same album |
| Sequential `itemIndex` values | High | Definitely ordered set |
| Track count matches known album | Medium | Likely album match |

### Sort Override

| Parameter | Effect |
|-----------|--------|
| `sort=random` | Force random order |
| `sort=date` | Sort by date |
| `sort=title` | Alphabetical |
| `sort=smart` | Contextual detection (default) |

---

## 9. Modifiers

### Action Modifier Validity

| Modifier | play | queue | display | list | read |
|----------|------|-------|---------|------|------|
| `shuffle` | ~ pick random | ✓ | ✓ | ✓ | ✗ |
| `loop` | ✓ repeat | ✓ loop queue | ✓ loop slideshow | ✗ | ✗ |
| `continuous` | ✗ | ✓ auto-advance | ✓ auto-advance | ✗ | ✗ |
| `sort` | N/A | ✓ | ✓ | ✓ | ✗ |
| `take` | N/A | ✓ limit | ✓ limit | ✓ paginate | ✗ |
| `skip` | N/A | ✓ offset | ✓ offset | ✓ paginate | ✗ |
| `volume` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `playbackRate` | ✓ | ✓ | ✗ | ✗ | ✗ |

### Modifier Conflicts

| Combination | Resolution |
|-------------|------------|
| `shuffle + sort=date` | `sort` wins |
| `loop + continuous` | Both apply |
| `take=5 + shuffle` | Shuffle first, then take |
| `skip + take + shuffle` | Shuffle, skip, take (in order) |

### Per-Track Modifiers (Composed Presentations)

```
play=visual:immich:abc,audio:plex:123&loop.audio=1&shuffle.visual=1
```

| Pattern | Effect |
|---------|--------|
| `loop.audio=1` | Loop only audio track |
| `shuffle.visual=1` | Shuffle only visual track |
| `volume.audio=50` | Set audio volume |
| `advance.visual=timed` | Time-based slide advance |
| `advance.visual=audio` | Advance on audio track end |

---

## 10. Composed Presentations

### Structure

```
play=visual:{source}:{id},audio:{source}:{id}
     └──────────┬──────────┘ └──────────┬──────────┘
           Track 1                 Track 2
```

### Track Expansion

| Track Value | Expansion |
|-------------|-----------|
| Leaf item | Single item |
| Container | All children |
| Query | Search results |

### Sync Modes

| Mode | Behavior |
|------|----------|
| `advance=timed` | Visual advances on interval |
| `advance=audio` | Visual advances when audio track ends |
| `advance=manual` | User controls visual |
| (default) | Longest track determines duration |

---

## 11. Constraint Graph

### Hard Constraints (Must Error)

```
play ──✗── readable-only (komga comic, audiobookshelf ebook)
read ──✗── playable-only (plex video, filesystem audio)
read ──✗── displayable-only (canvas image, immich photo)
list ──✗── leaf target (not listable)
*.query: ──✗── source without search() implementation
```

### Soft Constraints (Degrade Gracefully)

```
play + displayable → show image (silent degrade)
display + playable → show thumbnail
display + readable → show cover image
queue + displayable → slideshow queue
```

### Ambiguous (Behavior Decisions)

| Scenario | Options |
|----------|---------|
| `play=container` with many items | Pick random? First? Error? |
| `read=container` | Show TOC? Pick first? |
| Query returns mixed capabilities | Filter to action's capability? |
| Query returns 0 results | Empty state with message |

---

## 12. State Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    1. PARSE QUERY PARAMS                         │
│    Extract: action, id/query, modifiers                         │
│    Detect: explicit vs query resolution path                    │
└─────────────────────────────────────────────────────────────────┘
                                │
               ┌────────────────┴────────────────┐
               ▼                                 ▼
┌──────────────────────────┐      ┌──────────────────────────────┐
│   2A. EXPLICIT PATH      │      │   2B. QUERY PATH             │
│                          │      │                              │
│   source:localId         │      │   source.query:term          │
│   ↓                      │      │   ↓                          │
│   Heuristic detection    │      │   ContentQueryService        │
│   ↓                      │      │   • Resolve sources          │
│   Alias expansion        │      │   • Translate filters        │
│   ↓                      │      │   • Execute searches         │
│   Registry.resolve()     │      │   • Merge results            │
│   ↓                      │      │   ↓                          │
│   Adapter.getItem()      │      │   Smart Sort Service         │
└────────────┬─────────────┘      └──────────────┬───────────────┘
             │                                   │
             └───────────────┬───────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    3. TARGET TYPE DETECTION                      │
│                                                                 │
│              ┌─────────────────────────────┐                    │
│              │     Leaf or Container?      │                    │
│              └──────────┬──────────────────┘                    │
│                         │                                       │
│         ┌───────────────┴───────────────┐                       │
│         ▼                               ▼                       │
│    ┌─────────┐                   ┌────────────┐                 │
│    │  LEAF   │                   │ CONTAINER  │                 │
│    └────┬────┘                   └──────┬─────┘                 │
│         │                               │                       │
│  Check capability               Expand children                 │
│  match for action               Apply modifiers                 │
│                                 Filter by capability            │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    4. ACTION DISPATCH                            │
│                                                                 │
│   play → Single playback      queue → Sequential playback      │
│   display → Slideshow/static  list → Menu render                │
│   read → Reader render        open → App routing                │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    5. RESPONSE SHAPE                             │
│                                                                 │
│   item: Single item with mediaUrl/imageUrl/contentUrl           │
│   list: items[], parents{}, total, sources                      │
│   asset: Binary stream (proxy route)                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 13. Interaction Risk Matrix

Dimension pairs with highest bug/edge-case density:

```
                 Action  Source  Resolution  Target  Capability  Cardinality  Query
Action             -       ●●       ●          ●●●      ●●●          ●●         ●
Source            ●●       -        ●●         ●        ●●           ●          ●●●
Resolution        ●        ●●       -          ●        ●            ●          ●●
Target           ●●●       ●        ●          -        ●            ●●         ●
Capability       ●●●       ●●       ●          ●        -            ●          ●
Cardinality      ●●        ●        ●          ●●       ●            -          ●
Query             ●        ●●●      ●●         ●        ●            ●          -

Legend: ●●● = high risk, ●● = medium risk, ● = low risk
```

**Highest risk pairs:**
1. Action × Target Type — leaf vs container changes everything
2. Action × Capability — mismatch = error or degrade
3. Source × Query Keys — not all sources support all filters
4. Query × Resolution — explicit vs query path divergence

---

## Appendix: Example Queries

### Explicit Resolution

```
play=plex:12345                    # Play single Plex item
queue=plex:12345                   # Queue single item, play it
display=immich:abc-def             # Display single photo
display=canvas:art/nativity.jpg   # Display canvas image
list=folder:TVApp/FHE             # Browse folder contents
read=komga:comic-123              # Open comic in reader
```

### Heuristic Resolution

```
play=12345                         # Digits → plex:12345
queue=audio/song.mp3               # Path → filesystem:audio/song.mp3
```

### Query Resolution

```
play=plex.query:Mozart             # Search Plex, play random result
queue=media.query:Beatles          # Search media, queue results
play=media.query:dark.side.of.the.moon  # Album detected, track order
display=gallery.query:vacation&time=2024  # Search with filters
```

### Multi-Item

```
queue=plex:123,plex:456,plex:789   # Queue specific items
play=plex:123,immich:abc           # Mixed sources
```

### Composed Presentation

```
play=visual:immich:album:abc,audio:plex:playlist:123
play=visual:gallery.query:vacation,audio:media.query:chill&shuffle.visual=1
```

### With Modifiers

```
queue=plex:playlist:123&shuffle=1
display=immich:album:abc&loop=1&advance=timed&interval=5000
play=plex.query:Mozart&sort=date&take=10
```

---

## 14. Scripture Query Permutations

Scripture is accessed via the `narrated` source with the `scripture` collection. The resolution supports multiple formats.

### Reference Types

| Format | Example | Resolution |
|--------|---------|------------|
| **Volume selector** | `scripture/nt` | Next unfinished chapter in volume (via ItemSelectionService) |
| **Book reference** | `scripture/john` | First chapter of book |
| **Chapter reference** | `scripture/john-1` | Specific chapter |
| **Verse reference** | `scripture/john-1:1` | Chapter containing verse |
| **Numeric verse ID** | `scripture/25065` | Direct verse lookup |

### Volume Ranges

| Volume | Abbrev | Verse ID Range | Notes |
|--------|--------|----------------|-------|
| Old Testament | `ot` | 1 - 23145 | Genesis through Malachi |
| New Testament | `nt` | 23146 - 31102 | Matthew through Revelation |
| Book of Mormon | `bom` | 31103 - 38550 | 1 Nephi through Moroni |
| Doctrine & Covenants | `dc` | 38551 - 41844 | Sections 1-138 + OD1/OD2 |
| Pearl of Great Price | `pgp` | 41845 - 42296 | Moses, Abraham, JS-M, JS-H, AoF |

### Version and Recording Cascade

Scripture queries support text version and audio recording specification with fallback:

```
Resolution priority (most specific → least):
1. Explicit in query:     scripture/{version}/{recording}/{ref}
2. Query params:          scripture/{ref}?text=kjvf&audio=nirv
3. Manifest defaults:     config/narrated/scripture.yml → defaults
```

### Query Permutations

**Volume-level (uses ItemSelectionService):**
```
play=scripture/nt                    # Next unfinished NT chapter
play=scripture/bom                   # Next unfinished BOM chapter
play=scripture/ot                    # Next unfinished OT chapter
play=scripture/dc                    # Next unfinished D&C section
play=scripture/pgp                   # Next unfinished PGP chapter
```

**Book-level:**
```
play=scripture/john                  # John chapter 1 (first chapter)
play=scripture/alma                  # Alma chapter 1
play=scripture/genesis               # Genesis chapter 1
```

**Chapter-level:**
```
play=scripture/john-1                # John 1 specifically
play=scripture/alma-32               # Alma 32 specifically
play=scripture/1-nephi-1             # 1 Nephi 1
play=scripture/d&c-4                 # D&C 4 (special char handling)
```

**Verse-level (resolves to chapter):**
```
play=scripture/john-1:1              # John 1 (containing verse)
play=scripture/alma-32:21            # Alma 32 (containing verse)
```

**Numeric ID (direct verse lookup):**
```
play=scripture/25065                 # Luke 4:1 (verse ID)
play=scripture/31103                 # 1 Nephi 1:1 (first BOM verse)
```

**With version override:**
```
play=scripture/kjvf/john-1           # KJV Formatted text
play=scripture/nirv/john-1           # NIRV recording
play=scripture/kjvf/nirv/john-1      # Both explicit
```

**Full compound ID format:**
```
play=narrated:scripture/nt           # Explicit source prefix
play=narrated:scripture/kjvf/john-1  # With version
```

**With query params (alternative to path segments):**
```
play=scripture/john-1?text=kjvf&audio=nirv
play=scripture/nt?strategy=sequential
```

### Selection Strategy for Volumes

When `play=scripture/{volume}` is requested:

1. Load all chapters in volume from scriptures.yml watch history
2. Find first chapter with `percent < 90` (in-progress or unwatched)
3. If all chapters watched, return first chapter (restart)
4. Return single item for playback

Watch history keys use format: `plex:{volume}/{textVersion}/{verseId}`

Example: `plex:nt/kjvf/25065` = Luke 4 with KJV Formatted text

### Error Cases

| Query | Expected Error |
|-------|----------------|
| `scripture/invalid-book` | 404 - Unknown reference |
| `scripture/john-999` | 404 - Chapter out of range |
| `scripture/99999999` | 404 - Verse ID not found |
| `list=scripture/john-1` | 400 - Leaf not listable |

---

## 15. API Routes Reference

### Route Overview

All routes are prefixed with `/api/v1/`. The primary content access routes are:

| Route | Purpose | Returns |
|-------|---------|---------|
| `/item/:source/*` | Unified item access | Item or container contents |
| `/content/item/:source/*` | Single item info | Item metadata |
| `/content/playables/:source/*` | Resolve to playables | Playable items array |
| `/content/progress/:source/*` | Update watch progress | Progress confirmation |
| `/play/:source/*` | Play info with resume | Playable with resume position |
| `/play/log` | Log playback progress | Updated progress state |
| `/list/:source/*` | List container contents | Items array (deprecated) |
| `/content/query/search` | Unified search | Search results |
| `/content/query/list` | List containers | Containers array |

### Primary Routes: `/api/v1/item/:source/*`

The unified item endpoint handles most content access patterns.

**Path Parameters:**
- `:source` - Content source (`plex`, `narrated`, `singing`, `folder`, `local`, `filesystem`)
- `*` - Local ID within source (path-like, may contain `/`)

**Path Modifiers (appended to path):**
- `/playable` - Resolve container to playable items only
- `/shuffle` - Return items in random order
- `/recent_on_top` - Sort by recent menu selection time

**Query Parameters:**
- `?select=<strategy>` - Use ItemSelectionService to pick item from container
  - `select=watchlist` - Watchlist strategy (priority, skip watched, filter by days)
  - `select=album` - Album strategy (track order)
  - `select=sequential` - Sequential next item

**Examples:**
```
GET /api/v1/item/plex/672445                    # Container info
GET /api/v1/item/plex/672445/playable           # Playable episodes only
GET /api/v1/item/plex/672445?select=watchlist   # Next unwatched item
GET /api/v1/item/narrated/scripture/nt?select=watchlist  # Next unfinished NT chapter
GET /api/v1/item/singing/hymn/123               # Hymn with synced content
GET /api/v1/item/folder/watchlist/FHE           # Watchlist items
```

### Play Routes: `/api/v1/play/*`

**GET /api/v1/play/:source/*path**

Returns playable item info with resume position.

**Path Modifiers:**
- `/shuffle` - Random selection from container

**Response Fields:**
```json
{
  "id": "plex:12345",
  "assetId": "plex:12345",
  "mediaUrl": "/api/v1/proxy/plex/...",
  "mediaType": "video",
  "title": "Episode Title",
  "duration": 1800,
  "resumable": true,
  "resume_position": 542,    // Present if in-progress
  "resume_percent": 30,      // Present if in-progress
  "thumbnail": "...",
  "plex": "12345"            // Legacy Plex ID field
}
```

**POST /api/v1/play/log**

Updates watch progress. Request body:
```json
{
  "type": "plex",
  "assetId": "12345",
  "percent": 50,
  "seconds": 900,
  "title": "Episode Title",        // optional
  "watched_duration": 120          // optional, session watch time
}
```

Response uses canonical field names:
```json
{
  "response": {
    "type": "plex",
    "library": "plex/14_fitness",
    "playhead": 900,
    "duration": 1800,
    "percent": 50,
    "playCount": 3,
    "lastPlayed": "2026-02-02T14:30:00",
    "watchTime": 1542.5
  }
}
```

### Content Query Routes

**GET /api/v1/content/query/search**

Unified search across sources.

| Parameter | Description | Example |
|-----------|-------------|---------|
| `source` | Source filter | `plex`, `gallery`, `media` |
| `text` | Free text search | `Mozart` |
| `person` | Person/face filter | UUID |
| `creator` | Creator/author | `Spielberg` |
| `time` | Time filter | `2024`, `2020..2024` |
| `duration` | Length filter | `3m..10m` |
| `mediaType` | Content type | `video`, `audio`, `image` |
| `capability` | Required capability | `playable`, `displayable` |
| `favorites` | Boolean filter | `true` |
| `sort` | Sort order | `date`, `title`, `random` |
| `take`, `skip` | Pagination | `take=20&skip=40` |

**GET /api/v1/content/query/list**

List containers by type.

| Parameter | Description | Example |
|-----------|-------------|---------|
| `from` | Container type (required) | `playlists`, `albums`, `people` |
| `source` | Source filter | `plex`, `immich` |
| `pick` | Selection mode | `random` |
| `sort` | Sort order | `date`, `title` |

### Plex-Specific Routes

**GET /api/v1/content/plex/info/:id/:modifiers?**

Legacy Plex info endpoint with smart selection.

| Modifier | Effect |
|----------|--------|
| `shuffle` | Random item from container |

Response includes both legacy and canonical fields:
```json
{
  "listkey": "672445",           // Original container ID
  "listType": "show",
  "key": "123456",               // Selected item ID
  "type": "episode",
  "grandparentTitle": "Show Name",
  "parentTitle": "Season 1",
  "labels": ["exercise", "nomusic"],
  "mediaType": "dash_video",
  "mediaUrl": "/api/v1/proxy/plex/...",
  "thumbId": "456789",
  "image": "...",
  "percent": 45,                 // Canonical
  "seconds": 542,                // Canonical (maps to playhead)
  "duration": 1200,
  "metadata": {...}
}
```

**GET /api/v1/play/plex/mpd/:id**

Get DASH MPD manifest URL for Plex item.

| Query Param | Description |
|-------------|-------------|
| `maxVideoBitrate` | Maximum video bitrate |

### Source Aliases

Multiple paths can resolve to the same content:

| Alias Path | Resolves To |
|------------|-------------|
| `/item/local/...` | `/item/folder/...` |
| `/play/media/...` | `/play/filesystem/...` |
| `plex.query:...` | ContentQueryService search with Plex source |
| `gallery.query:...` | ContentQueryService search with Immich source |

### Watch State Field Mapping

After P0 migration (2026-02), all watch history uses canonical format:

| Canonical Field | Legacy Aliases | Description |
|-----------------|----------------|-------------|
| `playhead` | `seconds` | Current position in seconds |
| `duration` | `mediaDuration` | Total length in seconds |
| `percent` | - | Completion percentage (0-100) |
| `playCount` | - | Number of times started |
| `lastPlayed` | `time` | ISO timestamp of last play |
| `watchTime` | - | Total accumulated watch time |

API responses map canonical fields to contract fields:
- `watchProgress` = `percent`
- `watchSeconds` = `playhead`
- `watchedDate` = `lastPlayed`

### Error Responses

All endpoints return consistent error format:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE",
  "details": { ... }
}
```

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `INVALID_INPUT` | Bad request parameters |
| 404 | `NOT_FOUND` | Item/source not found |
| 501 | `*_NOT_CONFIGURED` | Service not available |
| 503 | - | External service offline |
