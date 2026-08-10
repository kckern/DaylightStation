# lilypond-import

Imports public-domain graded piano repertoire from the [Mutopia Project](https://www.mutopiaproject.org/)
into Sheet Music mode, converting LilyPond sources to MusicXML.

Offline batch tool. Nothing it depends on ships in the app image.

```bash
pip install python-ly                                  # build-time dependency
node cli/lilypond-import.cli.mjs --list
node cli/lilypond-import.cli.mjs --all --out /tmp/scores --dry-run
node cli/lilypond-import.cli.mjs --set burgmuller --out /tmp/scores
LY_BIN=/path/to/venv/bin/ly node cli/lilypond-import.cli.mjs --all --out /tmp/scores
```

`--offline` re-runs from the download cache without touching the network.

## Pipeline

```
fetch → normalize → convert → validate → enrich → write (+ JSONL ledger)
```

| Module | Role |
|---|---|
| `fetch.mjs` | Walk mutopiaproject.org's directory index; cache `.ly` on disk |
| `normalize.mjs` | Rewrite the source into one canonical `\score` per movement |
| `convert.mjs` | Canonical `.ly` → MusicXML (**the swappable seam**) |
| `validate.mjs` | Gate: 1 part, 2 staves, non-zero notes/measures |
| `enrich.mjs` | Stamp title, composer, licence and provenance into the XML |
| `importRun.mjs` | Orchestrate; write only what passes; ledger every outcome |

## Why normalize rewrites the score block

python-ly's *music* parser is solid — fingerings, slurs, hairpins, tuplets, grace
notes, chords and nested `\alternative` all convert correctly. Its *context/score
plumbing* is not: on 18 of 38 target files it walked
`\context PianoStaff << \context Staff = "up" << … >> >>`, threw an internal
error, and emitted an empty part **while exiting 0**.

So we don't repair the score block, we replace it. The music lives in top-level
variables; `normalize` resolves which variables belong to which staff and
synthesizes a clean `\score` from scratch. That took the target corpus from
52% → 100% conversion with fingerings intact.

Three staff shapes occur in the corpus and all are handled:

```lilypond
\new Staff = "upper" \upperfirst              % bare variable reference
\context Staff = "up" << \Global \vOne >>     % angle group, multi-voice
\new Staff { \clef bass \lower }              % brace group
```

## Rules that are not obvious

- **Grand staff is mandatory.** Learn mode maps staff 0 → RH and staff 1 → LH
  (`activeParts.js`). A score that converts as two one-staff parts renders fine
  but silently breaks HandsControl, so `validate.mjs` rejects it.
- **Exit codes are worthless.** python-ly exits 0 on failure. Only the emitted
  document is trusted.
- **`\layout` + `\midi` twins are one movement.** Mutopia files routinely typeset
  the same music twice, once for engraving and once for playback. Emitting both
  publishes every piece twice, the second copy often empty.
- **A spacer track is not a voice.** `dynamics = { s2\f s2*3 }` is invisible
  skips carrying marks. Distinct from a voice that is *mostly* spacers but has
  real bars — Burgmüller's `vTwo` rests for pages, then plays.
- **Filenames sort pedagogically.** Sheet Music mode titles a score from its
  basename and lists a collection in filesystem order, so numbers are zero-padded
  ("No. 02" before "No. 10").

## Known limitation

`Schumann Op. 68 No. 06 — Pauvre orpheline` fails to convert. Each staff converts
correctly in isolation (128 and 118 notes) but the combined PianoStaff yields an
empty part — a python-ly defect, not a source problem. It is reported as a
failure, never silently skipped. A hand-written parser replacing `convert.mjs`
would fix it.

## Licensing

Mutopia editions are re-typeset from public-domain sources but individual
editions carry their own terms, recorded per file in
`<identification><miscellaneous>`:

| Set | Licence |
|---|---|
| Burgmüller Op. 100 | Public Domain |
| Clementi Op. 36 | Public Domain |
| Schumann Op. 68 | CC-BY-SA 2.5 / 3.0 |
