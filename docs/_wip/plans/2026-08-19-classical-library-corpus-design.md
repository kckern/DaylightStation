# Classical Library Corpus — Design

**Date:** 2026-08-19
**Status:** Validated in brainstorming; not yet implemented
**Supersedes:** the data layout half of `docs/reference/player/surround/classical/README.md` (the authoring/timing workflow there remains current)

## Problem

The classical concert knowledge base (composer bios, work histories, movement-level
appreciation notes) currently lives inside the Player Surround's sidecar tree at
`data/content/surround/classical/`. That couples pedagogically neutral reference
knowledge to one consumer — playback chrome. The same facts are wanted by the School
system (music-appreciation curricula: read-then-watch, watch-then-quiz, printed
worksheets, extra credit — sequencing varies per enrollment), and the corpus is about
to grow from 2 authored pieces to 100+ works across ~70 composers, sourced from *The
Complete Classical Music Guide* (DK, 2012). Untangling after that authoring effort
would be expensive; now it is one contained loader change.

Two further facts force the shape:

- **One work ↔ N performances is already real.** The media tree holds two
  performances of Sibelius's Symphony No. 5 and two takes of Brandenburg Concerto
  No. 1. Any layout that stores knowledge inside a per-performance file duplicates it.
- **Authoring must be Plex-independent.** Most Tier B works will be authored before
  any recording exists. Knowledge files must be valid with no media, no contentId,
  no timings.

## Decision

Split knowledge from performance, following the exercise-library precedent (raw
corpus deliberately outside any app's tree; one repository instance injected into
multiple consumers; School consumes via an in-memory generated-catalog projection).

### Trees and ownership

```text
data/content/library/classical/          THE CORPUS — knowledge only, subject-neutral
  _index.yml                              domain metadata: title, description, eras
  beethoven/
    _composer.yml                         bio, dates, map, portrait refs, facts
    symphony-3-eroica.yml                 the WORK: movements, listen notes, facts, themes
  ...

data/content/surround/classical/          PERFORMANCES — owned by the player concern
  beethoven/
    symphony-3-eroica.hr-2016.yml         work ref + match + timings + venue

data/content/surround/_surrounds/         unchanged — presentation definitions (chrome)

media/img/library/classical/              corpus assets (portraits, city images)
                                          moved from media/img/surround/classical/
```

Rules:

- **The corpus is reference data.** No consumer vocabulary appears in it — no
  `surround:`, no `match:`, no quiz gates. It answers "what is true about this
  music," period.
- **Surround owns performances.** A performance sidecar is meaningless without a
  video. It references a work (`work: beethoven/symphony-3-eroica`) and never
  restates its content.
- **School owns nothing here.** A future `ClassicalLibraryCatalogSource` projects
  the corpus onto the `arts` shelf in memory at query time (anatomy-shelf pattern:
  toggled in `school.yml`, never materialized, authored YAML wins on id collision).
  The corpus schema is designed so that projection needs no schema change.
- **`data/content/library/` is the new sibling** for shared corpora, echoing the
  media-tree convention (`library/` = "not under apps/, because two apps read it").
  `content/language/` is a natural future migrant; out of scope now.
- The empty `data/content/school/culture/` folder is deleted. "Culture" is not one
  of the nine fixed subject shelves; music lands on `arts`.

### Work file schema

`library/classical/<composer>/<work-slug>.yml`:

```yaml
title: Symphony No. 3 in E-flat major, “Eroica”
opus: Op. 55                       # or BWV, K., RV, HWV, Op./No. — catalog number
composed: 1803-1804
year: 1804
period: Classical to Romantic
period_note: "Written at the hinge — many date the Romantic era from this symphony."
city: Vienna
premiered: Theater an der Wien, 7 April 1805
set: symphonies                    # groups works into cycles (symphonies, piano-sonatas…)
set_index: 3
tier: flagship                     # flagship | key | catalog — School emphasis later
duration_estimate: 50:00           # from the reference book; sanity bound for timing passes
movements:
  - n: 1
    name: Allegro con brio
    translation: "Fast, with spirit"
    listen:                        # per-movement appreciation bullets
      - "Two hammered E-flat chords, then the cellos sing the heroic theme…"
    note: "…"                      # movement-anchored commentary; becomes a cue at runtime
facts:                             # untimed pool about the work
  - "Beethoven meant to dedicate this symphony to Napoleon…"
themes: [heroism, napoleon, deafness]   # cross-work threads for future curricula
```

`_composer.yml` keeps its current schema (name, born/died, birthplace, period,
portrait, city_image, map, facts), plus optional `era:` and `tier:`.

### Performance sidecar schema

`surround/classical/<composer>/<work-slug>.<performance-slug>.yml`:

```yaml
work: beethoven/symphony-3-eroica   # required — corpus ref
surround: concert-hall              # required — definition id in _surrounds/
match: { contentId: plex:663134, title: "Beethoven: 3. Sinfonie" }
performance: hr-Sinfonieorchester · Orozco-Estrada · Alte Oper Frankfurt, 2016
starts: [0, 976, 1925, 2278]        # movement start seconds, positional by movement n
musicEndsAt: 2955
cues: []                            # performance-specific extras only
```

- A work with no sidecar is valid (Tier B before media exists).
- A sidecar whose `work:` ref does not resolve logs `surround.work.missing` and is
  excluded.
- `match.contentId` may carry a `pending:<slug>` placeholder for sidecars authored
  ahead of ingestion; it passes validation and simply never matches.

### Merge semantics (loader)

`YamlSurroundStore` is the only code that changes now:

- Constructor gains `libraryDir` alongside `rootDir`; composition wiring passes both.
- Walk order: corpus first (composers + works), then performance sidecars. A sidecar
  resolves `work:` and deep-merges **composer ← work ← performance** (later wins per
  key — the existing composer/piece precedence, extended one level).
- **Cue synthesis:** for each movement `n` with a `note`, emit
  `{at: starts[n], render: docked, text: note}`; append explicit sidecar `cues`.
  Movements gain `start: starts[n]`. The resolved payload is therefore
  **byte-equivalent to today's contract** — frontend modules need zero changes.
- New validations, fail-loud posture as today: `surround.work.missing` (dangling ref,
  sidecar excluded); `surround.starts.mismatch` (warn — `starts` length ≠ movement
  count; sidecar loads, unmatched movements get no timing). Corpus YAML errors reuse
  `surround.sidecar.invalid` naming the file.
- The mtime watcher covers both trees, preserving edit-and-refresh authoring.
- `assetBase` moves to `library/classical` (one constant); asset references in
  `_composer.yml` are relative and move with the files.

### School projection (deferred, shaped now)

`ClassicalLibraryCatalogSource`, when built: composers → courses on the `arts`
shelf; works → lessons (facts + listen notes as prose blocks); `themes` / `set` /
`tier` drive grouping and emphasis; question banks generated or hand-authored per
work. In-memory, config-toggled, authored-YAML-wins. Per-enrollment sequencing
(learn-then-watch vs watch-then-quiz vs extra credit) is an enrollment/syllabus
concern, never a corpus concern — that is why the corpus stays pedagogy-free.

## Alternatives considered

- **B — move the tree wholesale, one file per piece** (knowledge + playback keys
  together; School ignores playback keys). Simplest, but duplicates knowledge the day
  a second performance appears — which is already the case on disk.
- **C — status quo, surround owns it.** Zero work now; School would later read a
  tree named "surround," and the naming debt compounds with every authored file.

## Migration plan (small, first)

1. Create `library/classical/`; split the two authored pieces (Eroica, Spring):
   knowledge → work files, `match`/timings → performance sidecars (real timings
   already measured for both). Move the seven `_composer.yml`s and the image tree.
2. Loader change + tests, mirroring the store's existing test style.
3. Verify: the play-info endpoint returns a `surround` payload equivalent to
   today's for both migrated pieces (acceptance test for "frontend untouched"), and
   the log store shows no new `surround.*` warnings.
4. Update `docs/reference/player/surround/classical/README.md`; delete
   `data/content/school/culture/`.

## Authoring plan (the long game)

Source: *The Complete Classical Music Guide* (DK) — curation guide and fact source.
**Book prose is adapted, never copied** (copyrighted). Facts verified against the
local offline Wikipedia service (standing rule; see the surround README's "Facts and
accuracy").

- **Tier A — the 8 media-backed composers** (7 in Plex + Chopin in progress). Work
  files for complete sets matching the media: Beethoven 9 symphonies + 32 piano
  sonatas; Bach Brandenburgs + WTC Book II (24); Mozart's 9; Sibelius; Vivaldi's
  Seasons; Handel; Wagner's operas; Chopin nocturnes. Performance sidecars get real
  Plex contentIds now; `starts` timings are deferred to media-host ffmpeg passes per
  the documented workflow.
- **Tier B — the long tail.** Curation rule: book entries with a "KEY WORKS" section
  get a composer folder; their key works get work files; no sidecars until media
  exists. Roughly 60–80 composers, 3–6 works each.
- **Batching:** one composer per batch ("the composer folder is the unit of work").
  First batch: **Beethoven symphonies** — proves migration, merge, and book-pipeline
  quality on real Plex items in one pass.
