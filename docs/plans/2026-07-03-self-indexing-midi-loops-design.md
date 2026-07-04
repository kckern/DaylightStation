# Self-Indexing MIDI Loops — Design

**Date:** 2026-07-03
**Status:** Design complete, ready for implementation planning
**Consumer:** `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx`

## Problem

The loop catalog under `media/midi/loops/` is backed by a single 6.3 MB / ~461k-line
`index.yml` monolith — a *generated* artifact whose harmony (`roman`, `chords`) was
derived from **filenames** during ingest, and which carries fields that don't survive
scrutiny:

- `availableKeys` / `canonicalKey` — meaningless. Every key is always available via the
  Producer's transpose control; a brick is authored in C, full stop.
- `bpm` as a constraint — meaningless. Tempo is a Producer slider.
- `copies` — an ingest dedup artifact.
- filename-guessed `roman` — the source of the "inadequate index" complaint.

We want to move **away from the index monolith toward self-indexing**: each loop is a
self-describing Lego brick, and any aggregate index is a disposable artifact *derived by
walking the tree*, never hand-maintained.

## Principles

1. A brick carries **ground truth only**: the notes (in C, with real rhythm) plus
   labels (provenance, tags, color, type). Nothing about key or tempo. No stored roman.
2. Everything analytical (roman, chords, per-beat grid, compatibility) is **derived at
   build time from the actual note content** — recomputed on every build, never stale.
   (Note-based analysis ≠ the old filename-guessing; improve the analyzer once, all
   bricks improve.)
3. Key and tempo are **pure playback parameters** owned by Producer, never asset
   properties.

## Three-Tier Architecture

| Tier | What | Lifecycle |
|---|---|---|
| **Source** | one **MusicXML** file per brick — notes in C + metadata | authored, git-tracked, self-indexing |
| **Build** | walk tree → parse → derive harmony/grid/roman → bake playable notes → emit `dist/manifest.json` | **regenerable, disposable — replaces `index.yml`** |
| **Runtime** | Producer reads `manifest.json` only; **never parses MusicXML** | minimal churn to `useLoopLibrary` |

Because the build bakes lightweight playable notes + the harmony grid into the manifest,
adopting MusicXML costs **nothing at runtime** (no new browser parser) while giving a
rich, human-editable, notation-grade source format.

## Brick Anatomy (MusicXML source)

```xml
<score-partwise>
  <identification>
    <miscellaneous>
      <miscellaneous-field name="type">chords</miscellaneous-field>
      <miscellaneous-field name="provenance">FamousMIDI/Queen/We Will Rock You</miscellaneous-field>
      <miscellaneous-field name="tags">rock,anthemic,driving</miscellaneous-field>
      <miscellaneous-field name="color">#c0392b</miscellaneous-field>
      <!-- rare: only when the analyzer misreads this specific brick -->
      <miscellaneous-field name="harmony-override">I / IV / V</miscellaneous-field>
    </miscellaneous>
  </identification>
  <part id="P1">
    <measure number="1">
      <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>...notes in C, real durations...</note>
    </measure>
  </part>
</score-partwise>
```

- **In every brick:** notes in C with real rhythm + time signature; `type`, `provenance`,
  `tags`, `color`.
- **Deliberately absent:** key, tempo-constraint, roman/chords/grid (all derived).
- **`harmony-override`** is the escape hatch: normally empty; a one-line correction only
  when analysis gets a specific brick wrong.

## Four Types → Engine Roles

| `type` | Engine role | Notes |
|---|---|---|
| `chords` | **Bed** — defines full harmony | block progressions, pads, arps, comping |
| `bassline` | **Root line** — defines bottom/root motion | first-class; bass roots are the strongest harmonic signal |
| `melody` | **Line** — rides over harmony | lead, counterpoint, hooks |
| `percussion` | **None** — unpitched | GM drum map; harmony n/a |

Nuance (lead vs pad vs arp vs counterpoint) lives in `tags`, not as new types.

## Filename Grammar (unified)

Filenames are **standardized, derived projections of the analysis** — the build renames a
brick to its canonical form. The name is a human-facing label; the *truth* is the notes
inside + the derived manifest. Rename freely, nothing breaks.

**Grammar:** `[header]TOKEN⟨braille⟩-TOKEN⟨braille⟩-…` — `TOKEN` + Braille-rhythm pairs,
`-` separated. Only the token vocabulary changes by type:

| Type | Token | Example filename |
|---|---|---|
| chords | roman | `I⠃-vi⠃-IV⠃-V⠃.musicxml` |
| bassline | roman root | `I⠏-IV⠏.musicxml` |
| melody | note-name in C (pitch-class, no octave) | `C#⠃-D⠿-E⠿.musicxml` |
| percussion | feel/drum token | `kick⠅-snare⠃.musicxml` |

One parser, four vocabularies. Melody uses absolute note-names *in C* — which, since C is
canonical, is itself the transposition-invariant form and has zero tonic ambiguity.
**Octave is pitch-class only** in the name; true octaves live in the MusicXML.

### Braille rhythm encoding

A Braille cell = 8 dots = an 8-bit **beat-occupancy mask**. Verified valid as filenames on
macOS/APFS and in git.

| Glyph | Dots | Meaning |
|---|---|---|
| ⠁ | 1 | 1 beat |
| ⠃ | 1,2 | 2 beats (held) |
| ⠇ | 1,2,3 | 3 beats |
| ⠏ | 1,2,3,4 | 4 beats (full 4/4 bar) |
| ⠅ | 1,3 | sounds beats 1 & 3 (syncopated) |
| ⠿ | all 8 | 8 beats |

- **Beat count = popcount** (dots set). **Placement = which dots.** Held vs. syncopated
  fall out of the same glyph.
- **Default: 1 dot = 1 beat**, range = 8 beats/glyph (two 4/4 bars). A chord longer than
  that repeats the glyph.
- **U+2800 (BRAILLE BLANK) is banned** — it renders invisibly (looks like a space); every
  token occupies ≥1 beat so it's never needed.

### Optional leading header glyph

If a filename **starts** with a Braille glyph, it's a self-declaring header that sets
**resolution + meter**; absent = **beat-grid, 4/4**. Unambiguous because every token
otherwise starts with a letter.

Codebook (~8–12 named glyphs) is defined at implementation, e.g.:

| Header | Meaning |
|---|---|
| *(none)* | beat grid, 4/4 |
| ⠢ | beat grid, 3/4 |
| ⠔ | eighth grid, 6/8 |
| ⠒ | sixteenth grid, 4/4 |

### Collisions & long names

- Same roman + rhythm → append a short content hash.
- Long melodies → truncate to a lead phrase + hash.

### Runtime safety

The build **also** writes plain arrays into the manifest (`durations:[2,2,2,2]`,
`beats`, resolution, meter), so **nothing at runtime ever parses Braille**. The glyphs are
a delightful human label, not a load-bearing format.

## Compatibility Engine

Everything normalized to **C** and to a **per-beat grid**, so any two bricks compare
regardless of length. Two bricks are compatible only if they pass **all three gates**;
the output is a **score** (not just yes/no) so Producer ranks "goes-with" candidates.

**1. Metric gate (timing).**
- Time signatures must agree/be compatible.
- Lengths align by looping the shorter over the **LCM of bar-counts** (a 2-bar rides under
  an 8-bar). Coprime/ugly lengths fail here *even if harmony is identical* — this is why
  "I-IV-V in one rhythm" ≠ "I-IV-V in another."

**2. Harmonic gate (pitched bricks only).**
- Build each brick's per-beat pitch-class set (in C) from its actual notes.
- **bed + bed:** same implied chord/function at each beat over the cycle.
- **bassline + bed:** bass note at each chord change is a chord tone (root/3rd/5th).
- **melody + bed:** each note is a chord tone or acceptable tension; brief passing tones
  tolerated. Two melodies stack if mutually consonant.
- **percussion:** skips this gate.

**3. Role gate.**
- One bed / one bassline is normal; a second of either is flagged. Melodies stack if
  consonant. Percussion stacks freely.

Existing `shared/music/` primitives already implement most of this — `layerMatch.mjs`
(`compatibilityScore`, `roleOf`, `rankLayerCandidates`), `harmonicSignature.mjs`
(`areStackable`, `signatureKey`), `consonance.mjs` — and will be adapted to the derived
grid.

## Organization

```
loops/
  chords/        *.musicxml
  basslines/     *.musicxml
  melodies/      *.musicxml
  percussion/    *.musicxml
  dist/          manifest.json   ← generated, git-ignored
```

- Top level = the four **types**, period. No more `niko/`, `famous/`, `100/`, `120bpm/`,
  `best-progresions/` folders.
- Cross-cutting organization = **metadata**: `tags`, `color`, `provenance`. A brick can be
  "rock" + "anthemic" + "from Queen" at once. "Find driving basslines that fit I-vi-IV-V"
  is a **query** against derived harmony + tags, not a folder path.
- `prefabs/` (curated arrangements/songs/stacks) stays a **separate layer** that
  *references* bricks — not merged into the catalog.

## Migration Plan — "All, with quality tier"

1. Regenerate **all 3,231** existing loops into MusicXML bricks. Their notes were already
   normalized to canonical C by the prior ingest, so this is primarily a MIDI→MusicXML
   conversion plus rhythm re-quantization.
2. Carry `provenance` and useful `tags` from the current `index.yml` (`origin`, `source`,
   `mood`, `artist`) into each brick's metadata as a **one-time bootstrap read**, then
   discard the monolith.
3. The analyzer assigns a **quality/curation flag** (from source curation folders like
   `best-*`, `famous`, dedup density) so the UI can **default to the curated tier** while
   the long tail stays queryable. Nothing is lost; mess is demoted, not deleted.
4. Re-derive all harmony/grid/roman from the actual notes.

## Producer Integration

- `useLoopLibrary` re-points from `…/loops/index.yml` to the new
  `…/loops/dist/manifest.json`; keeps `query()`/`facets()`/`rankFor()` shape.
- `loadNotes(entry)` reads **baked notes from the manifest** instead of fetching+parsing a
  `.mid` (or MusicXML). `@tonejs/midi` no longer on the hot path.
- Compatibility ranking flows through the existing `@shared-music` primitives, adapted to
  the derived grid.
- Optional: MusicXML source can feed the existing **OSMD** dependency for notation display.

## Open Implementation Tasks

- MIDI→MusicXML conversion + rhythm quantization for migration (Node-side).
- Node-side MusicXML parser for the build step (`@tonejs/midi` parses MIDI, not MusicXML).
- The Braille header codebook (~8–12 glyphs) — finalize after analyzing the real
  distribution of meters/resolutions across the 3,231 files.
- Canonical-filename renamer + collision-hash strategy.
- Quality/curation heuristic.
- Melody canonicalization for long phrases (truncate + hash rule).
