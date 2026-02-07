# Content Adapters: Singalong and Readalong

Content adapters bridge between abstract content IDs (like `singalong:hymn/123`) and local files on disk (YAML metadata + audio files). They are the core abstraction that lets DaylightStation serve hymns, scripture, talks, karaoke, poetry readings, or any other text-with-audio content without code changes.

## Architecture Overview

The singalong and readalong adapters know nothing about hymns, scripture, or talks. They understand *collections* — directories of numbered YAML files with corresponding media. What makes `hymn/` a hymn collection vs a karaoke collection is entirely determined by the content you put in the directory and the optional `manifest.yml` you write.

Both adapters share the same contract:

| Method | Purpose |
|--------|---------|
| `canResolve(id)` | Claim IDs by prefix (`singalong:` or `readalong:`) |
| `getItem(id)` | Load YAML metadata + find media file, return normalized item |
| `getList(localId)` | Browse collections and their contents |
| `resolvePlayables(localId)` | Resolve what to actually play (may use watch history) |
| `search(query)` | Text search across collections |

The split between them reflects **presentation mode**, not content type:

- **Singalong** = participatory (lyrics displayed for sing-along, centered text, verse-by-verse)
- **Readalong** = follow-along (text scrolls as audio plays, left-aligned, paragraph-based)

A user could put poetry in the singalong adapter if they wanted centered verse display, or put hymn lyrics in the readalong adapter for a read-along experience. The adapter choice determines how the frontend renders the content.

Both are wired at bootstrap with two paths: `dataPath` (YAML metadata) and `mediaPath` (audio files). Collections are subdirectories within those paths.

### Key source files

| File | Purpose |
|------|---------|
| `backend/src/1_adapters/content/singalong/SingalongAdapter.mjs` | Singalong adapter implementation |
| `backend/src/1_adapters/content/singalong/manifest.mjs` | Singalong adapter metadata and config schema |
| `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs` | Readalong adapter implementation |
| `backend/src/1_adapters/content/readalong/manifest.mjs` | Readalong adapter metadata and config schema |
| `backend/src/1_adapters/content/readalong/resolvers/scripture.mjs` | Scripture path resolver |
| `backend/src/2_domains/content/services/ContentSourceRegistry.mjs` | Adapter registry and ID resolution |

---

## Directory Layout and ID Format

Both adapters use the same filesystem convention:

```
dataPath/                          # YAML metadata
  {collection}/
    manifest.yml                   # Optional: collection-level config
    icon.svg                       # Optional: collection icon
    0001-item-name.yml             # Numbered items
    0002-another-item.yml
    subfolder/                     # Optional: nested grouping
      item.yml

mediaPath/                         # Audio files
  {collection}/
    0001-item-name.mp3             # Matched by number prefix
    0002-another-item.mp3
```

### Compound IDs

IDs follow the format `{source}:{collection}/{path}`:

| ID | Resolves to |
|----|-------------|
| `singalong:hymn/1` | `dataPath/hymn/0001-*.yml` + `mediaPath/hymn/0001-*.mp3` |
| `singalong:primary/2` | `dataPath/primary/0002-*.yml` + `mediaPath/primary/0002-*.mp3` |
| `readalong:scripture/nt` | Resolved by scripture resolver to specific chapter |
| `readalong:talks/ldsgc202410/smith` | `dataPath/talks/ldsgc202410/smith.yml` |

### Number prefix matching

When the ID segment is numeric (like `1`), the adapter uses `loadYamlByPrefix()` to find any file starting with `0001` (zero-padded). This means you can name files descriptively (`0001-the-morning-breaks.yml`) while referencing them simply (`hymn/1`).

### Path mapping

For the **singalong adapter**, `dataPath` points to `data/content/songs/` — so collections are `hymn/`, `primary/`, etc. For the **readalong adapter**, `dataPath` points to `data/content/readalong/` — so collections are `scripture/`, `talks/`, `poetry/`, etc. Media files live under `media/audio/songs/` and `media/audio/readalong/` respectively.

---

## Collection Manifests

A `manifest.yml` in a collection directory customizes how that collection behaves. Every field is optional — without a manifest, the adapter uses sensible defaults.

### Default styles

**Singalong adapter** (no manifest needed):
```yaml
contentType: stanzas
style:
  fontFamily: serif
  fontSize: 1.4rem
  textAlign: center
```

**Readalong adapter** (no manifest needed):
```yaml
contentType: paragraphs
style:
  fontFamily: sans-serif
  fontSize: 1.2rem
  textAlign: left
```

### Manifest fields

| Field | Type | Effect |
|-------|------|--------|
| `contentType` | string | How the frontend renders content: `stanzas`, `verses`, `paragraphs` |
| `style` | object | CSS overrides: `fontFamily`, `fontSize`, `textAlign` |
| `icon` | string | Path to collection icon (relative to collection dir) |
| `resolver` | string | Name of a resolver module (readalong only — see Resolvers section) |
| `containerType` | string | Selection strategy hint: `sequential`, `watchlist` |
| `ambient` | boolean | Whether to play ambient background audio (readalong only) |
| `defaults` | object | Per-subcollection defaults (used by resolvers) |

### Real example: scripture manifest

```yaml
resolver: scripture
containerType: watchlist
contentType: verses
ambient: true
style:
  fontFamily: serif
  fontSize: 1.3rem
  textAlign: left
defaults:
  ot:
    text: kjvf
    audio: kjvf
  nt:
    text: kjvf
    audio: kjvf
  bom:
    text: sebom
    audio: sebom
  dc:
    text: rex
    audio: rex
  pgp:
    text: lds
    audio: lds
```

This tells the readalong adapter: use the `scripture` resolver for path resolution, render as verses with serif font, play ambient music, and use these text/audio version defaults per volume.

---

## Item YAML Format

Each content item is a YAML file containing metadata and text content. The structure varies slightly between singalong and readalong.

### Singalong items

```yaml
title: The Morning Breaks
hymn_num: 1
verses:
  - - The morning breaks, the shadows flee;
    - Lo, Zion's standard is unfurled!
    - The dawning of a brighter day,
    - Majestic rises on the world.
  - - The clouds of error disappear
    - Before the rays of truth divine;
    - The glory bursting from afar,
    - Wide o'er the nations soon will shine.
```

The singalong adapter reads `metadata.verses` as an array of arrays — each inner array is a stanza, each string is a line. `title` and `number` (or `hymn_num`) are used for display and search.

### Readalong items

The readalong adapter is more flexible. It tries these fields in order: `metadata.verses`, `metadata.content`, `metadata.paragraphs`, or treats the root as an array directly. This means readalong YAML can be structured differently per collection.

**Scripture chapter** — array at root level:
```yaml
- verse_id: 23146
  text: "In the beginning was the Word..."
  headings:
    heading: "The Gospel According to John"
- verse_id: 23147
  text: "The same was in the beginning with God."
```

**Talk** — object with metadata + content:
```yaml
title: "Faith and Doubt"
speaker: "Elder Smith"
paragraphs:
  - "Brothers and sisters, today I want to speak about..."
  - "When we face uncertainty..."
```

### Duration

Both adapters read `duration` from YAML metadata. If absent, the singalong adapter probes the audio file using `music-metadata` (`parseFile()`) to extract duration automatically. The readalong adapter falls back to `0` if no duration is specified.

---

## The Scripture Resolver

Resolvers are a readalong-adapter feature that transforms user-friendly paths into actual file lookups. The scripture resolver (`resolvers/scripture.mjs`) is the reference implementation.

### The problem it solves

Scripture has a three-level hierarchy — volume (`nt`), text version (`kjvf`), and verse ID (`23146`). But users shouldn't need to know all three. You want `scripture/john-1` to just work.

### Resolution cascade

The resolver parses the input path right-to-left, trying each segment as a scripture reference:

| Input | Resolved textPath | Resolved audioPath |
|-------|-------------------|--------------------|
| `john-1` | `nt/kjvf/23146` | `nt/kjvf/23146` |
| `kjvf/john-1` | `nt/kjvf/23146` | `nt/kjvf/23146` |
| `kjvf/nirv/john-1` | `nt/kjvf/23146` | `nt/nirv/23146` |
| `nt` | *(container — triggers selection)* | |
| `nt/kjvf/23146` | `nt/kjvf/23146` | `nt/kjvf/23146` |

The cascade for filling in missing segments:

1. **Explicit in path** — if the user provides a text version, use it
2. **Manifest defaults** — per-volume defaults from `manifest.yml` (e.g., `nt.text: kjvf`)
3. **First directory found** — fallback: scan the filesystem for the first available version

### Volume ranges

Volume ranges map verse IDs to canonical volumes:

| Volume | Verse ID range |
|--------|---------------|
| `ot` | 1–23,145 |
| `nt` | 23,146–31,102 |
| `bom` | 31,103–37,706 |
| `dc` | 37,707–41,994 |
| `pgp` | 41,995–42,663 |

When `john-1` is passed, the resolver calls `lookupReference('john-1')` (from the `scripture-guide` library) to get verse ID `23146`, maps that to volume `nt`, then applies defaults to get the full path.

### Container mode

When the input is just a volume name (`nt`), the resolver returns `{ isContainer: true }`. This triggers bookmark-based selection — the adapter reads watch history to find the next unfinished chapter, rather than always starting at verse 1.

### Separate text and audio paths

The resolver returns both `textPath` and `audioPath` independently. This allows a collection to use one text version (e.g., `kjvf` — King James with footnotes) while playing a different audio recording (e.g., `nirv` — alternate narration). The manifest `defaults` section configures this per volume.

---

## Bookmark Tracking and Playable Resolution

When a readalong content request is a container (like `scripture/nt`), the adapter doesn't just return the first item — it consults watch history to find where the user left off.

### The flow

1. `resolvePlayables('scripture/nt')` detects a volume-level request
2. Scripture resolver returns `{ isContainer: true, volume: 'nt' }`
3. Adapter calls `_resolveScriptureVolumePlayables()` which:
   - Gets the volume's verse range (nt: 23,146–31,102)
   - Reads all watch progress from `mediaProgressMemory`
   - Finds the first chapter with < 90% completion — resume there
   - If all watched chapters are complete — advance to next unwatched
   - If no history at all — start from the beginning

### Progress storage

The system checks two key formats for backward compatibility:

- Legacy: `plex:nt/kjvf/25065` (from when scripture was served via Plex)
- Current: `readalong:scripture/nt/kjvf/25065`
- Legacy: `narrated:scripture/nt/kjvf/25065`

All are checked in `scriptures.yml` first, then fall back to `readalong.yml` and `narrated.yml`.

### getItem() also uses selection

When you request `readalong:scripture/nt` via `getItem()`, instead of returning a container listing, it returns the actual next chapter as a fully-resolved item with content, audio URL, and metadata. This means any component that calls `getItem()` gets a playable result without needing to understand bookmarking.

### Selection strategy by collection

| Collection | Strategy | Behavior |
|------------|----------|----------|
| `scripture` | `sequential` | Progress through chapters in order |
| `talks`, `poetry` | `watchlist` | Pick from unwatched items |

This is determined by `getContainerType()` and can be overridden by `containerType` in the manifest.

---

## Adding a New Collection

To add a new content type, you don't touch adapter code — you create directories and optionally a manifest.

### Example: Adding a karaoke collection (singalong)

1. **Create the data directory:**
```
data/content/songs/karaoke/
  manifest.yml              # optional
  icon.svg                  # optional
  0001-bohemian-rhapsody.yml
  0002-dont-stop-believin.yml
```

2. **Create the media directory:**
```
media/audio/songs/karaoke/
  0001-bohemian-rhapsody.mp3
  0002-dont-stop-believin.mp3
```

3. **Write item YAML:**
```yaml
title: Bohemian Rhapsody
number: 1
verses:
  - - Is this the real life?
    - Is this just fantasy?
  - - I'm just a poor boy
    - I need no sympathy
```

The item is now addressable as `singalong:karaoke/1`.

### Example: Adding a poetry collection (readalong)

1. Create `data/content/readalong/poetry/` with YAML files
2. Create `media/audio/readalong/poetry/` with matching audio files
3. Optionally add a manifest:

```yaml
contentType: verses
ambient: true
style:
  fontFamily: serif
  fontSize: 1.5rem
  textAlign: center
```

Items are addressable as `readalong:poetry/frost-road-not-taken`.

### When you need a resolver

Only if your collection has a complex hierarchy where user-facing IDs differ from filesystem paths. Most collections don't need one — the default behavior of matching YAML files by prefix or name is sufficient.

If you do need one, create a module in `backend/src/1_adapters/content/readalong/resolvers/` that exports an object with a `resolve(input, dataPath, options)` method, then reference it in your manifest:

```yaml
resolver: yourresolver
```

The resolver receives the raw path segments and returns `{ textPath, audioPath }` (or a string for simple cases). See `resolvers/scripture.mjs` for the reference implementation.

### What you never need to change

- Adapter source code — collections are discovered from the filesystem
- Bootstrap/wiring code — adapters scan their `dataPath` for subdirectories
- Frontend rendering — the content renderer registry handles display by category

## Related code:

- backend/src/1_adapters/content/singalong/SingalongAdapter.mjs
- backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs
- backend/src/1_adapters/content/readalong/resolvers/scripture.mjs
