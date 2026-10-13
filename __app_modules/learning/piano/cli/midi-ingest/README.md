# midi-ingest — MIDI Loop Library ingest / organize / convert

Turns the raw producer MIDI packs (`media/midi/<pack>/…`, ~53.8k tiny `.mid`
files) into a clean, canonical, queryable loop library.

## What it does

1. **Parse** each filename into structured metadata (`loopMeta.mjs`): key, type
   (chord-progression / melody / bassline / idea), chords, scale-degrees, mood,
   BPM, reverb (WET/DRY), artist/song, source pack.
2. **Collapse the 12-key redundancy** (`ingestCore.mjs`): every idea is
   pre-rendered in all 12 keys, which are true transpositions. Each file is
   transposed so its major tonic lands on C, then hashed by canonical
   pitch-class signature — identical transpositions collapse to one entry.
   **Measured: 53,810 → 3,223 unique ideas (94% redundancy removed).**
3. **Reorganize** into a role-first, kebab-case tree and emit a queryable
   `index.yml` (with roman-numeral progression signatures via the shared theory
   core).
4. **Percussion (grooves)** — content-detected, no flag: tracks are
   drum-detected via `shared/music/percussion.isDrumTrack` (channel 9
   authoritative; ≥60% GM_DRUM pitch coverage as fallback). A whole file
   ingests as `type: groove` only when it has **channel-9 drum evidence** and
   drum tracks carry ≥90% of its notes; channel-9 drums mixed with pitched
   material are skipped with a report line. Coverage-only detections (no
   channel-9 track anywhere) **never** change a file's type — basslines/riffs
   in the kick/snare pitch region routinely fake the coverage bar (76 confirmed
   false positives on the real packs) — they stay harmonic and are only counted
   in the report as hygiene suggestions. Grooves land under `percussion/`, get
   `feel` (`straight`/`swing` via `detectFeel`), `barSpan`, and `bpm` (filename,
   else MIDI header tempo) — and NO key/roman/availableKeys fields. They are
   copied verbatim (never transposed: shifting pitches would remap drum
   pieces), and `loop-enrich.cli.mjs` skips them (no harmonic content).
5. **Write safety** — enrichment fields (`timeline`/`timelineRoot`/
   `specificity`/`rootSource`/`title`/`signature`/`needsReview*`) belong to
   `loop-enrich.cli.mjs` + `enrich-index`; the ingest never computes them. On
   `--write` over an existing library it first backs up the old index to
   `index.yml.bak-YYYYMMDD-HHmmss`, then carries each entry's enrichment
   forward (matched by slug) when the produced `.mid` bytes equal the old
   entry's file; changed content drops the stale enrichment for the next
   enrichment run to recompute.

## Layout produced

```
media/midi/loops/
  chord-progressions/{niko,famous/<artist>}/<mood?>/<slug>.mid
  melodies/{starters,famous/<artist>}/<mood?>/<slug>.mid
  basslines/… arps/… ideas/… percussion/…
  index.yml
```

The canonical `.mid` files are all in C major / A minor; playback transposes to
any key live (transposition is free for MIDI). `index.yml` records each idea's
original/available keys, chords, roman numerals, degrees, mood, BPM, and source.

## Usage

```bash
node cli/midi-ingest.mjs                       # dry-run over the whole tree (stats only)
node cli/midi-ingest.mjs --limit=3000          # dry-run, sampled subset (fast iteration)
node cli/midi-ingest.mjs --write               # write canonical tree + index.yml
node cli/midi-ingest.mjs --src=PATH --out=PATH # override source / destination
```

Dry-run is the default and writes nothing. `--src` defaults to
`$DAYLIGHT_BASE_PATH/media/midi`; `--out` defaults to `<src>/loops`.

## Modules

| File | Responsibility |
|------|----------------|
| `loopMeta.mjs` | filename → `LoopEntry` metadata (pure) |
| `ingestCore.mjs` | canonical signature, dedup-merge, groove gate, enrichment carry-over, target path (pure) |
| `../midi-ingest.mjs` | thin I/O: walk, read SMF (`@tonejs/midi`), write tree + index |

Shared theory core (used by both this CLI and the kiosk UI):
`shared/music/{chords,transpose,romanAnalysis,midiToScore}.mjs`.

Tests: `node --test cli/midi-ingest/*.test.mjs shared/music/*.test.mjs`.
