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
| ⠿ | 1–6 | 6 beats |
| ⣿ | all 8 | 8 beats (full cell — note 8-dot cells, so 8 beats = ⣿ not ⠿) |

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

Canonical MusicXML asset folders live at the `media/midi` **root**; all source and
intermediate/messy files live under `_workspace/` (reorg done 2026-07-03):

```
media/midi/
  chords/        *.musicxml   ← canonical assets (the Lego bins)
  basslines/     *.musicxml
  melodies/      *.musicxml
  ideas/         *.musicxml
  percussion/    *.musicxml
  _workspace/
    source-packs/   Niko_MIDI_Pack_, 2000_NikoChord_Pack, FamousMIDI_Bonus, …
    loops-midi/     old canonical .mid tree + index.yml (bootstrap input)
    backups/        pre-conversion tarball snapshot
    prefabs/        curated arrangements (to be re-pointed at new bricks)
    _ledger.jsonl   conversion audit trail
  dist/          manifest.json   ← future generated runtime aggregate, git-ignored
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
2. Carry **only key-independent** fields from the current `index.yml` (`origin`, `source`,
   `mood`, `artist`) into each brick's metadata as a **one-time bootstrap read**, then
   discard the monolith. **Do NOT carry stored `roman`/`chords`** — the prototype proved
   they're in the original vendor key, inconsistent with the transposed-to-C notes.
3. The analyzer assigns a **quality/curation flag** (from source curation folders like
   `best-*`, `famous`, dedup density) so the UI can **default to the curated tier** while
   the long tail stays queryable. Nothing is lost; mess is demoted, not deleted.
4. Re-derive all harmony/grid/roman from the actual notes.

## Migration Executed (2026-07-03)

First full MIDI→MusicXML pass via `cli/midi-to-musicxml.mjs` — **non-destructive**:
- **Backup:** `media/midi/_backups/loops-pre-musicxml-2026-07-03.tar.gz` (3,231 `.mid`,
  integrity-verified); raw vendor packs untouched; originals in `loops/` never modified.
- **Output:** staging tree `media/midi/loops-xml/` (`chords/ basslines/ melodies/ ideas/
  percussion/`) + `_ledger.jsonl`. Revert = `rm -rf loops-xml/`. Cutover deferred.
- **Result:** 3,231/3,231 converted, 0 failures, all XML well-formed (xmllint), 41 MB, ~2s.
- **Traceability:** each brick embeds source-midi path, vendor origin, source pack,
  converter/analyzer versions, timestamp, and a derived-harmony snapshot; the ledger is a
  1:1 input→output audit trail.
- **Collision handling:** 206 chord-name slugs were shared by 934 distinct loops (e.g.
  `am-f-c-g` = 23 different loops). Disambiguated with a source-path hash suffix
  (`am-f-c-g-a3f9.musicxml`) so the mapping is exactly 1 input → 1 output.
- **Harmony:** 1,622/1,655 chord-progressions derived at confidence 1.0; 28 flagged
  low-confidence (the `harmony-override` tail).

**Descriptors preserved (v0.2 converter):** genre/emotion/quality tags are extracted from
the source path, `origin` folder names, `mood`, and `descriptor` against curated
vocabularies (noise-filtered), and embedded per brick (`genre`, `emotion`, `tags`,
`quality`, `artist`, `bpm`, `reverb`, `title`) — with raw `source-mood`/`source-descriptor`
kept for traceability. Coverage: **2,153/3,231 bricks (67%)** carry a surfaceable
descriptor; top genres pop/house/edm/jazz/trap/rock, top emotions emotional/uplifting/
dark/beautiful/sad. These are meant to surface in the Producer UX for filtering.

**Layout reorg (2026-07-03):** canonical asset folders promoted to `media/midi` root;
source packs, old `.mid` tree, backups, prefabs, and the ledger moved under `_workspace/`
(all `mv`, reversible). Converter paths updated accordingly (`MIDI_ROOT`/`LOOPS_DIR`/
`OUT_DIR` env-overridable).

**Canonical naming DONE (converter v0.3):** filenames are now derived Roman/note-name +
Braille-duration, not the old keyed slug — `chords`/`ideas` → roman (`I⠃-iii⠃-II⠏`),
`basslines` → uppercase degree root-line, `melodies` → note-names in C (`C⠁-A⠁-E⠁`),
`percussion` → cleaned feel token (`latin-clave`). The V2 bass-informed analyzer feeds
both the name and the embedded `derived-roman`. Each brick keeps `source-slug` +
`source-midi` for traceability. Names carry a `source-path` hash suffix on collision
(563 bricks); **collision detection is case-folded** because APFS is case-insensitive and
Roman case (`III` vs `iii`) is the major/minor signal — otherwise ~14 case-twins clobber.
All 3,231 uniquely named, well-formed, 1:1.

Known follow-ups before cutover: 16th-grid quantization refinement, loop-boundary/minimal-
cycle detection (some names repeat the progression), the sus-casing convention (thirdless
chords default to uppercase+`sus`), and building the runtime manifest + re-pointing Producer.

## Producer Integration

- `useLoopLibrary` re-points from `…/loops/index.yml` to the new
  `…/loops/dist/manifest.json`; keeps `query()`/`facets()`/`rankFor()` shape.
- `loadNotes(entry)` reads **baked notes from the manifest** instead of fetching+parsing a
  `.mid` (or MusicXML). `@tonejs/midi` no longer on the hot path.
- Compatibility ranking flows through the existing `@shared-music` primitives, adapted to
  the derived grid.
- Optional: MusicXML source can feed the existing **OSMD** dependency for notation display.

## Prototype Findings (2026-07-03)

De-risked the load-bearing assumption ("derive harmony from notes") with a scratch
eval (`cli/_proto-harmony-eval.mjs`, untracked) over a stratified 32-loop sample,
reusing the existing `harmonicTimeline` / `pcSetToTriad` / `bestTonic` / `signatureKey`
primitives. Compared note-derived harmony (bar-resolution *and* a new beat-resolution
variant) against the stored `roman`/`chords`.

**Verdict: the core assumption is sound, but the analyzer is the crux investment —
and the existing index is worse than assumed (which strengthens the rebuild case).**

1. **Note-derivation is fundamentally correct, and a bass-informed analyzer nails it.**
   Measured by transposition-invariant progression *shape* (does it recover the
   progression in any key), on 18 chord-progression samples vs the (imperfect) stored
   reference:
   - **V1** (plain per-beat triad-fit): **6/18** exact.
   - **V2** (bass-informed root + onset-weighting + color-tone tolerance, ~50 lines):
     **13/18** exact, **15/18 (83%)** counting loop-boundary-only misses — **zero
     regressions** vs V1.
   The single unlock was **bass-informed root selection**: the lowest sounding note
   disambiguates inversions/color tones (e.g. `Dm7` no longer misreads as `F6`). V2 fixed
   every sus/add/7th voicing V1 failed on.
   - The 3 residual misses are genuinely ambiguous (a symmetric dim7; a dense 8-chord
     progression, 6/8 right; a typo'd source whose reference is itself suspect) — precisely
     the confidence-gated `harmony-override` cases.
   - Remaining tractable work: **loop-boundary / minimal-cycle detection** (recovers 2 of
     the 5 non-exact — the harmony is right, the cycle just didn't tile), a problem
     separable from harmony reading.
2. **🔴 The stored `chords` metadata is in the *original vendor key*, not canonical C.**
   Absolute-key match with the notes was **0/18**, with a *consistent per-file semitone
   offset* (e.g. Taylor Swift: every stored root = derived root + 1). The notes were
   transposed to C; the harmony metadata never was. **Concrete proof the index is
   internally inconsistent** — the notes are the only reliable ground truth. Migration
   must **not** carry stored `roman`/`chords` as truth (only key-independent fields:
   provenance, mood, artist, tags).
3. **✅ Type-specific derivation is mandatory, not optional.** Basslines (monophonic)
   yield empty/garbage from triad-fitting (4/6 empty) — they must be read as **root
   lines** (the single-note sequence), never chord-fitted. Melodies likewise resolve to
   nonsense chords (forcing harmony onto a line) — they must be **note-name sequences in
   C**. The design already says this; the prototype proves skipping it produces garbage.
4. **🟡 The analyzer needs hardening for real voicings.** Failures cluster on: sustained/
   pedal tones bleeding across beat windows; arpeggiation; and 7th/add/sus color tones
   confusing triad-fitting into inversion-root errors (e.g. `Dm7` read as `F6`). Solvable
   (onset/bass-weighted windowing, harmonic-segment rather than fixed-beat windows,
   inversion-aware root detection) but real algorithm work. This single analyzer is the
   highest-leverage component — it improves all bricks at once.

**Net:** proceed with the design — the risk is retired. A bass-informed analyzer already
hits 83% clean recovery in ~50 lines; the productionization work is loop-boundary
detection, the type-specific bass/melody paths, and confidence-gating the ambiguous tail
to the `harmony-override` escape hatch. Treat the current `index.yml` harmony as untrusted.
The bass-informed V2 approach lives in `cli/_proto-harmony-eval.mjs` (`fitTriadBass` /
`deriveV2`) as the starting point.

## Open Implementation Tasks

- **Hardened, type-aware harmonic analyzer (the crux)** — onset/bass-weighted, segment-
  based windowing, inversion-aware; separate paths for beds (chords) vs bass (root line)
  vs melody (note-names). Keep `cli/_proto-harmony-eval.mjs` as the regression harness to
  measure improvements against the sample.
- MIDI→MusicXML conversion + rhythm quantization for migration (Node-side).
- Node-side MusicXML parser for the build step (`@tonejs/midi` parses MIDI, not MusicXML).
- The Braille header codebook (~8–12 glyphs) — finalize after analyzing the real
  distribution of meters/resolutions across the 3,231 files.
- Canonical-filename renamer + collision-hash strategy.
- Quality/curation heuristic.
- Melody canonicalization for long phrases (truncate + hash rule).
