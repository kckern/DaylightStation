# Scripture Resolver

The `ScriptureResolver` converts human-readable scripture references into normalized file paths for both text (YAML data) and audio (MP3 media). It is the backend resolver plugin for the `scripture` readalong collection, declared via `resolver: scripture` in the collection manifest.

**Source:** `backend/src/1_adapters/content/readalong/resolvers/scripture.mjs`

---

## Three Orthogonal Layers

Scripture content has three independent dimensions:

| Layer | What It Is | Where It Lives | Example Slugs |
|-------|-----------|----------------|---------------|
| **Text Edition** | YAML verse data | `data/content/readalong/scripture/{volume}/{edition}/` | `kjvf`, `niv`, `sebom`, `readers` |
| **Audio Recording** | MP3 chapter files | `media/audio/readalong/scripture/{volume}/{recording}/` | `kjv-maxmclean`, `rex`, `niv-maxmclean`, `lds-male` |
| **Reference** | Book + chapter | Resolved via `scripture-guide` package | `john-1`, `alma-32`, `1-nephi-3` |

Any text edition can be paired with any audio recording. The resolver determines which edition and recording to use based on the input path, manifest defaults, and filesystem inspection.

---

## Flexible Content ID Format

The resolver accepts 1, 2, or 3 prefix segments before the reference. Fewer segments trigger smart defaults.

### 3 Segments: `{version}/{audio}/{reference}` — explicit everything

```
kjvf/kjv-dramatized/john-1
  → text: nt/kjvf/23146
  → audio: nt/kjv-dramatized/23146
```

Both text edition and audio recording are explicitly specified. No guessing.

### 2 Segments: `{slug}/{reference}` — smart detection

The resolver checks the filesystem to determine what the slug is:

| Slug Type | Detection | Behavior | Example |
|-----------|-----------|----------|---------|
| **Audio-only** | Exists in media dir but NOT in data dir | Audio override; text from manifest defaults | `kjv-maxmclean/john-1` → text=`kjvf`, audio=`kjv-maxmclean` |
| **Text dir** | Exists in data dir (whether or not it's also in media) | Version override; audio via `audioDefaults` | `niv/john-1` → text=`niv`, audio=`niv-maxmclean` |
| **Unknown** | Neither dir exists | Treated as version (same as text dir) | Passes through, may fail downstream |

Detection uses `dirExists()` from `FileIO.mjs` to check:
- Text: `{dataPath}/{volume}/{slug}/` exists?
- Audio: `{mediaPath}/{volume}/{slug}/` exists?

### 1 Segment: `{reference}` — all defaults

```
john-1
  → text: nt/kjvf/23146       (from manifest defaults.nt.text)
  → audio: nt/kjv-maxmclean/23146  (from manifest defaults.nt.audio)
```

Everything comes from the manifest's `defaults` block for the detected volume.

### Volume-Only: `{volume}` — container mode

```
nt → { volume: 'nt', isContainer: true }
```

When `allowVolumeAsContainer` is set (used by list/browse APIs), bare volume names return a container indicator instead of resolving to the first verse.

---

## Manifest Configuration

The scripture manifest (`data/content/readalong/scripture/manifest.yml`) controls defaults, audio aliasing, and playback flags.

### `defaults` — Per-Volume Defaults

When no version or audio is specified in the path, these are used:

```yaml
defaults:
  ot:
    text: kjvf
    audio: kjv-maxmclean
  nt:
    text: kjvf
    audio: kjv-maxmclean
  bom:
    text: sebom
    audio: rex
  dc:
    text: readers
    audio: rex
  pgp:
    text: lds
    audio: rex
```

### `audioDefaults` — Text-to-Audio Mapping

When a text edition is specified (2-segment path) but no explicit audio, the resolver looks up the edition slug here to find the matching audio directory.

Supports two formats:

```yaml
audioDefaults:
  # Flat string: same audio for all volumes
  kjvf: kjv-maxmclean
  sebom: rex
  readers: rex
  1981: lds-male
  2013: lds-male

  # Per-volume object: different audio per volume
  lds:
    bom: lds-male
    dc: lds-legacy
    pgp: lds-legacy
  niv:
    nt: niv-maxmclean
  nkjv:
    nt: nkjv-nelson
  nrsv:
    nt: nrsv-laughlin
```

Resolution logic (`resolveAudioAlias`):
1. Look up `audioDefaults[editionSlug]`
2. If string → return it (e.g., `kjvf` → `kjv-maxmclean`)
3. If per-volume object → return `obj[volume]` if present, otherwise return the edition slug unchanged
4. If not found → return the edition slug as-is (assumes audio dir matches text dir)

### `musicRecordings` — Skip Ambient Audio

Recordings that already contain background music. The `ReadalongAdapter` skips the ambient audio overlay for these:

```yaml
musicRecordings:
  - esv-music
  - niv-music
  - nrsv-dramatized
  - nkjv-johnson
  - nkjv-nelson-dramatized
  - nkjv-wordofpromise
  - kjv-dramatized
```

### `volumeTitles` — Human-Readable Names

```yaml
volumeTitles:
  ot: Old Testament
  nt: New Testament
  bom: Book of Mormon
  dc: Doctrine and Covenants
  pgp: Pearl of Great Price
```

---

## Resolution Examples

Given the current manifest defaults and filesystem state:

| Input | Text Path | Audio Path | How |
|-------|-----------|------------|-----|
| `john-1` | `nt/kjvf/23146` | `nt/kjv-maxmclean/23146` | 1 seg: all defaults |
| `alma-32` | `bom/sebom/31103` | `bom/rex/31103` | 1 seg: all defaults |
| `niv/john-1` | `nt/niv/23146` | `nt/niv-maxmclean/23146` | 2 seg: `niv` is text dir → audioDefaults |
| `kjv-maxmclean/john-1` | `nt/kjvf/23146` | `nt/kjv-maxmclean/23146` | 2 seg: audio-only dir → defaults for text |
| `kjv-dramatized/john-1` | `nt/kjvf/23146` | `nt/kjv-dramatized/23146` | 2 seg: audio-only dir |
| `rex/alma-32` | `bom/sebom/31103` | `bom/rex/31103` | 2 seg: audio-only dir |
| `lds-male/alma-32` | `bom/sebom/31103` | `bom/lds-male/31103` | 2 seg: audio-only dir |
| `niv/niv-maxmclean/john-1` | `nt/niv/23146` | `nt/niv-maxmclean/23146` | 3 seg: explicit |
| `kjvf/kjv-dramatized/john-1` | `nt/kjvf/23146` | `nt/kjv-dramatized/23146` | 3 seg: explicit |

---

## Available Editions and Recordings

### Text Editions (data dirs)

| Volume | Editions |
|--------|----------|
| OT | amp, csb, esv, gnv, hcsb, kjv, kjvf, msg, nirv, niv, nkjv, nlt, nrsv |
| NT | amp, ceb, cev, csb, esv, gnv, hcsb, kjv, kjvf, msg, net, nirv, niv, nkjv, nrsv, nwt, web |
| BOM | 1981, 2013, lds, readers, sebom |
| DC | lds, readers |
| PGP | lds, readers |

### Audio Recordings (media dirs)

| Volume | Recordings |
|--------|------------|
| OT | amp, csb, esv, esv-music, gnv, hcsb, kjv-glyn, kjv-lds-female, kjv-lds-legacy, kjv-lds-male, kjv-maxmclean, msg, nirv, niv, nkjv, nrsv |
| NT | amp, ceb, cev, csb, esv, esv-laughlin, esv-music, gnv, hcsb, kjv-dramatized, kjv-heath, kjv-lds-female, kjv-lds-legacy, kjv-lds-male, kjv-maxmclean, kjv-zondervan, msg, net, nirv, niv-dramatized, niv-experience, niv-maxmclean, niv-music, niv-sarris, niv-suchet, nkjv-johnson, nkjv-nelson, nkjv-nelson-dramatized, nkjv-wordofpromise, nrsv-dramatized, nrsv-laughlin, nwt, web |
| BOM | 1908, cameron, crisden, easier, hardman, lds-female, lds-legacy, lds-male, lovell, munro, restoration, rex |
| DC | lds-legacy, rex |
| PGP | lds-female, lds-legacy, lds-male, rex |

---

## Internal Details

### Volume Detection

References are resolved via the `scripture-guide` npm package, which returns verse IDs. The resolver maps verse IDs to volumes using static ranges:

| Volume | Verse ID Range |
|--------|---------------|
| OT | 1–23,145 |
| NT | 23,146–31,102 |
| BOM | 31,103–37,706 |
| DC | 37,707–41,994 |
| PGP | 41,995–42,663 |

### Path Passthrough

When input is already in `{volume}/{version}/{numericVerseId}` format (3 segments, first is a known volume, last is numeric), the resolver passes it through directly. This handles pre-resolved paths from watchlists.

### Fallback Chain

For any dimension not explicitly provided:

1. Manifest `defaults[volume].text` / `defaults[volume].audio`
2. `audioDefaults[textEdition]` (for audio when only text is specified)
3. First directory found in the filesystem (`getFirstDir()`)
4. Literal `'default'` (last resort, will likely fail downstream)
