# LilyPond → MusicXML import (Mutopia graded repertoire)

**Date:** 2026-08-10
**Status:** Stage 1 implemented and shipped
**Code:** `cli/lilypond-import.cli.mjs`, `cli/lilypond-import/`

## Problem

Sheet Music mode had arrangements but no graded pedagogical repertoire — no
Burgmüller, Clementi, or Schumann. That material exists, free, at the Mutopia
Project, but Mutopia ships PDF, MIDI and **LilyPond source**, never MusicXML.
The engraved player needs MusicXML.

MIDI was rejected as an intermediate: it destroys fingerings, and editorial
fingerings are the most pedagogically valuable thing in that corpus.

## Requirements

- Convert Mutopia LilyPond sources to MusicXML for `ScorePlayer`.
- Preserve **notes + fingerings** (slurs and dynamics welcome, not required).
- Every output is a **single part with two staves** — Learn mode maps staff 0 →
  RH and staff 1 → LH via `activeParts.js`, so any other shape silently breaks
  HandsControl.
- Scope: the graded piano sets (~60–80 files), not all 2,124 Mutopia pieces.
- Offline batch — no new runtime dependency in the Docker image.
- Staged: ship repertoire now, leave a seam for a hand-written parser later.

## Approach

Measured on the 38-file target corpus before choosing:

| Approach | Result |
|---|---|
| python-ly alone | **52%** — the entire Burgmüller set failed |
| LilyPond → MIDI → existing converter | Rejected: destroys all fingerings |
| Hand-written Node parser | Weeks of work; deferred to stage 2 |
| **Normalize → python-ly → validate** | **100%**, 997 fingerings preserved |

The decisive finding: python-ly's *music* parser is solid — fingerings, slurs,
hairpins, tuplets, grace notes, chords and nested `\alternative` all convert
correctly in isolation. Its *context/score plumbing* is not. On 18 of 38 files it
walked the `\context PianoStaff << \context Staff = "up" << … >> >>` shape, threw
an internal error, and emitted an empty part **while exiting 0**.

Extracting the music variables and feeding them through a synthesized minimal
`\score` recovered all 18. So the design uses the good half and replaces the bad
half rather than trying to repair it.

## Architecture

```
fetch → normalize → convert → validate → enrich → write (+ JSONL ledger)
                       ↑
              the swappable seam
```

- **fetch** — walks mutopiaproject.org's Apache directory index. The GitHub
  contents API costs one request per piece directory and exhausts the
  unauthenticated budget mid-set; Mutopia's own `make-table.cgi` is cheaper but
  **incomplete** (returned 10 of Burgmüller's 18). The directory index is
  complete and unmetered.
- **normalize** — resolves top-level variables, maps staff → variables → clef,
  and synthesizes one canonical `\score` per movement. Movement splitting happens
  *here*, so nothing downstream ever splits multi-part MusicXML.
- **convert** — canonical `.ly` → MusicXML. Today python-ly; a hand-written
  parser replaces only this module.
- **validate** — the gate. Rejects empty output, zero notes/measures, and
  anything that is not 1 part / 2 staves.
- **enrich** — stamps work-title, composer, licence and full provenance into
  `<identification><miscellaneous>`.
- **importRun** — writes only what passes; ledgers every outcome including
  rejections.

## Corpus rules discovered empirically

- **`\layout` + `\midi` twins.** Mutopia files typeset the same music twice, once
  for engraving and once for playback. Naive splitting published every Schumann
  piece twice, the second copy usually empty. A MIDI-only score with an engraved
  sibling is dropped.
- **Spacer tracks are not voices.** `dynamics = { s2\f s2*3 }` is invisible skips
  carrying marks. But a voice can be *mostly* spacers and still real —
  Burgmüller's `vTwo` rests for pages then plays — so the test is "has pitches or
  audible rests", not "has spacers".
- **Three staff shapes** all occur and are handled: bare variable reference,
  angle group with multiple voices, and brace group.
- **Filenames must sort pedagogically.** Titles derive from the basename and the
  grid lists in filesystem order, so numbers are zero-padded.

## Results

39 scores installed to `media/docs/sheet-music/studies/`, surfaced as a
**Studies** tab. 997 fingerings preserved. All 39 verified as 1 part / 2 staves.

One known failure: `Schumann Op. 68 No. 06`. Each staff converts alone (128 and
118 notes); the combined PianoStaff yields an empty part. A python-ly defect,
reported rather than skipped, and a natural stage-2 fix.

Licences are per-edition: Burgmüller and Clementi are Public Domain, Schumann
Op. 68 is CC-BY-SA 2.5/3.0. Recorded per file; acceptable for home use.

## Stage 2

Replace `convert.mjs` with a hand-written LilyPond parser. MusicXML is the
interchange boundary, so normalize/validate/enrich/install are unaffected. The
variable-extraction and staff-mapping work in `normalize.mjs` is the first third
of that parser and carries forward.
