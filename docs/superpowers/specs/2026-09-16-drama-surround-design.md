# Drama surround — design

Status: approved by user (2026-09-16), ready for implementation planning.
Revised 2026-09-16: generalized from a Shakespeare-specific domain to a
`drama` domain, per user feedback — other stage productions (a different
playwright, a company, a non-Shakespeare play) should be able to reuse this
without a new domain or new code.

## Goal

Add a `drama` domain to the Slow-TV surround system — same idea as
`classical` (see `docs/reference/player/surround/design.md` and
`docs/reference/player/surround/classical/README.md`): when a stage
production plays, the video locks into a box and the reclaimed screen fills
with chrome synchronized to the playhead — a "playhouse programme" instead
of a "concert programme."

**`drama` is a domain for stage works in general, not a Shakespeare
feature.** The pilot content is the BBC Television Shakespeare collection
(`TV Shows/Shakespeare/Season 1/`, 37 films), and Shakespeare is the first
playwright shelved in the corpus — but nothing in the schema, the
presentation definition, or the frontend/backend code names Shakespeare,
a play, an act, or a scene. Those are corpus-authored labels an individual
work chooses, exactly the way `classical` never hardcodes "movement" (see
"No hardcoded structure vocabulary" below). A future non-Shakespeare
production — a different playwright, a filmed opera, a devised-theatre
piece with no acts at all — should drop into this same domain with zero
code changes.

End state: a repeatable authoring skill (`drama-surround`, modeled on
`classical-music-surround`) that a future session can run per-production
without touching any frontend or backend code, once the presentation this
spec describes exists.

## No hardcoded structure vocabulary

This was flagged explicitly and is worth stating as a standing design rule,
not just a property of the pilot: **"Act" and "Scene" must never appear in
frontend/backend code, only in corpus YAML, as free-text `kind:`/`title:`
values an individual work chooses.** This already holds for every piece of
existing machinery this design reuses:

- `groups:`/`segments:` (`segments.js`, `SegmentMap.jsx`) take an optional
  `kind:` per group — Messiah authors `kind: part` and `kind: scene`; a
  Shakespeare play authors `kind: act` for its outer groups and needs no
  `kind:` at all on its `segments:` (a segment is a segment; "Scene" is
  just what its `label:`/`heading:` says). `kind` is never read by any
  conditional in the rendering code — it is display data only.
- The band's LEFT/RIGHT split reads `facts:` and `listen:` by position in
  the hierarchy (segment → nearest group → work), never by a group's
  `kind:` string.
- Nothing proposed in "What needs real engineering" below reads or branches
  on "act" or "scene" as a string. `PlayCard` reads `genre`/`setting`/
  `cast` — fields about a stage work in general, not about Shakespeare or
  about acts.

So a future drama with no acts (a one-act play), or a different structure
word (a "movement" in a devised piece, a "part" in a trilogy), needs no
code change — only a corpus author's choice of `kind:`/`title:`, exactly
as Messiah already demonstrates for the classical domain.

## Seed case

- `TV Shows/Shakespeare/Season 1/Shakespeare - S01E13 - The Taming Of The
  Shrew.mp4` — 640×480 (4:3), 7567.5s (~2h6m). **Plex contentId is
  `plex:697661`.**

  **Resolved during this design pass: the whole season's Plex metadata was
  scrambled, and it's now fixed at the root.** All 37 files were originally
  named alphabetically (`01 All's Well...` .. `37 The Winter's Tale.mp4`)
  with no season/episode markers, so Plex's TVDB agent assigned real
  broadcast-order episode numbers (1–37) to whatever position each file
  happened to occupy during a scan — two unrelated orderings glued together.
  Confirmed independent of Plex two ways before touching anything: each
  file's own embedded container metadata (written at rip time — e.g.
  `TAG:title=The Taming Of The Shrew`, `TAG:episode_sort=30` on the old file
  30) agreed with its filename, and the SRT's dialogue is unmistakably Shrew
  (Petruchio's wooing speech — "Good morning, Kate... Kate of Kate Hall...
  My super dainty Kate," Act 2 Scene 1 — appears verbatim in substance near
  its midpoint, with its last cue ending at 02:04:45, just before the file's
  7567.5s runtime) — so the fix was to rename files, not to fix data
  elsewhere.

  All 37 files were renamed to proper Plex convention,
  `Shakespeare - S##E## - <title>.mp4` (using each file's own existing short
  title and the TVDB-canonical episode number derived from
  `plex.cli.mjs`'s season-children listing, cross-referenced by play
  identity since TVDB's titles differ substantially in wording from the
  files' short titles — e.g. "Henry IV Part 1" vs. TVDB's "The First Part of
  King Henry the Fourth with the Life and Death of Henry Surnamed
  Hotspur"). The mapping was a clean 37-to-37 bijection with zero
  collisions, a strong correctness signal. The companion SRT was renamed to
  match.

  Triggering a library refresh after the rename had one side effect worth
  recording: Plex re-matched the **show** itself (not just the episodes),
  and briefly landed on the wrong show, "Shakespeare: Rise of a Genius" (a
  2023 documentary), discarding the previously-correct manual match to
  "BBC Television Shakespeare" (`tvdb://73009`). Fixed immediately via
  Plex's match API (`PUT .../match?guid=plex://show/5d9c...&name=...`,
  using the GUID captured before the rename). After that fix, all 37
  episode indices now correctly correspond to their files (verified
  programmatically, zero mismatches) and Shrew resolved to `plex:697661`.
  **`match.title` is safe again for this domain** — Plex's title metadata
  is now correct.
- A sibling `Shakespeare - S01E13 - The Taming Of The Shrew.srt` — an ASR
  transcript with no speaker names and no Act/Scene markers, textually
  noisy ("Trollio" for "Tranio"), opening directly on Act I Scene 1 (this
  production cuts the Induction).
- `The Taming of the Shrew (Cliffs Complete).pdf` — 218 pages: intro to
  Shakespeare, intro to the play, a full Act/Scene table of contents with
  each scene's setting ("Padua. A public place"), the complete text
  interleaved with commentary and glossary. This is the primary content
  source for the corpus (facts still cross-checked against the offline
  Wikipedia service, same discipline as the classical skill).

## What already generalizes — no code needed

Reading `frontend/src/modules/Surround/` confirmed the existing generic
machinery already does most of what a stage work needs, because it was
built for Handel's *Messiah* (Part → Scene → Number nesting) with no
domain-specific vocabulary baked in (see "No hardcoded structure
vocabulary" above):

- **`groups:` / `segments:` with folding** (`SegmentMap.jsx`, `segments.js`,
  README's "A long work may author an optional recursive `groups:` tree")
  map directly onto Act (`groups:`) → Scene (`segments:`) for Shakespeare —
  or onto whatever structure a future drama chooses — current-group-expanded
  / other-groups-folded, with zero changes.
- **The band's two-register split already does Act-vs-Scene**, not by
  content but by construction: `factPool()` in `segments.js` accumulates a
  segment's own `note`/`facts`, then every ancestor group's `facts:`
  (nearest first), then the work's `facts:`, into the LEFT ("piece")
  register's rotating pool; the RIGHT ("now") register independently reads
  the sounding segment's own `listen:` list. So: put Act-level commentary in
  each Act group's `facts:`, Scene-level "watch for" notes in each Scene
  segment's `listen:`, leave segment-level `facts:`/`note` and the work's own
  top-level `facts:` sparse, and the LEFT register reads (in practice)
  as Act commentary and the RIGHT as Scene commentary — the split the user
  asked for, for free, for any grouping depth a future drama chooses.
- **`work-placard`** (top plate) is already generic over `piece.opus` /
  `piece.composed` / `piece.premiered`, filtering absent fields — no changes
  needed; a play simply omits `opus`.

## What needs real engineering

Kept to the minimum that classical's existing, already-generic components
cannot already do — reuse was maximized deliberately, per feedback.

### 1. 4:3 aspect ratio

`SurroundFrame.jsx` hardcodes the media box:

```js
style={enabled
  ? { aspectRatio: '16 / 9', maxWidth: '100%', maxHeight: '100%' }
  : NO_BOX}
```

(`frontend/src/modules/Surround/SurroundFrame.jsx:533`)

Generalize to `data?.piece?.aspectRatio ?? '16 / 9'`, sourced from a new
`aspectRatio` field on the corpus work file (or sidecar `piece:` override),
added to the backend's `PIECE_FIELDS` allowlist
(`backend/src/1_adapters/content/surround/YamlSurroundStore.mjs:151`).
Store the value as a CSS `aspect-ratio` string (`"4 / 3"`), not a bare
fraction, so it drops into the same inline style with no parsing. This is a
domain-agnostic field — any `classical` work with a non-16:9 recording
benefits too, not just `drama`.

design.md's "16:9 is inviolable" quality-floor line needs updating to "the
corpus's declared aspect ratio is inviolable — letterbox or pillarbox,
never distort," since a 4:3 source in a 16:9-shaped stage pillarboxes rather
than letterboxes.

**Verification needed during implementation** (not resolved by this spec):
sweep `SurroundFrame.scss` for anything that assumes the media box's shape
specifically (the curtain veil's depth, the placard's straddle percentage) —
these are described in design.md as measured against "the video's top edge"
and "the placard overlaps the picture by a third of its own height," which
read as shape-agnostic (percentages of the box, not of 16:9 specifically),
but must be confirmed against a real 4:3 render, not assumed.

### 2. A new rail identity module: `PlayCard`

`ComposerCard` (`frontend/src/modules/Surround/modules/ComposerCard.jsx`) is
built around a portrait + name + dates + birthplace + rotating person-facts —
right for a composer, wrong for "what is this stage work." Reuse was
considered and rejected here specifically: `ComposerCard` answers "who wrote
this," and the ask was for the rail to answer "what is this" (a play's own
identity — genre, setting, cast), which classical's schema has no
equivalent of (a symphony has no cast). New module, same file shape as the
existing six (`.jsx` + `.scss`, registered in `builtins.js` under `right`),
reusing `ComposerCard`'s dissolve/timing pattern rather than its content:

- Title, genre (Comedy / History / Tragedy / Romance — a stage work's own
  classification, not Shakespeare-specific), one-line setting ("Padua,
  Italy"), a cast list (top-billed characters), and a rotating work-level
  fact pool (reusing the same dissolve/timing pattern `ComposerCard`
  already uses — `COMPOSER_FACT_INTERVAL_MS`-equivalent).
- New corpus fields needed on the allowlist: `genre`, `setting`, `cast`
  (array of `{ name, role }` or similar — shape TBD in the implementation
  plan, not this spec). All domain-agnostic — usable by any `drama` work,
  and by `classical` too if a future work wants a cast list (a staged
  opera, say).
- The playwright's own bio (`_composer.yml`, reused literally — the loader
  hardcodes that filename, and is itself already domain-agnostic — it
  works for a composer, a playwright, or any future "who made this")
  still resolves into `data.composer` and can supply a small byline if
  useful, but `PlayCard`'s primary content is the work, not its author.

### 3. `PlaceCarousel` generalization

`PlaceCarousel.jsx` reads `composer.map` / `composer.city_image` directly.
One existing precedent already does a piece-first fallback:
`piece.period ?? composer.period` (see design.md's era-timeline section).
Extend the same pattern to `map` and `city_image`:
`data.piece?.map ?? data.composer?.map`,
`data.piece?.city_image ?? data.composer?.city_image` — so a work can author
its own setting (Padua, Italy) via a `piece.map` override in its work file
or sidecar, falling back to its author's own geography (Shakespeare's
Stratford/London) when a work authors none. No new module needed here,
just the fallback chain — and it benefits `classical` too (a work composed
somewhere other than the composer's home city).

### 4. New presentation definition

`data/content/surround/_surrounds/playhouse.yml` (working name — confirm in
implementation; "playhouse" already reads as generic to any stage work, not
Shakespeare-specific):

```yaml
id: playhouse
regions:
  top:
    module: work-placard
  right:
    - module: play-card
      width: "33%"
      side: left
    - module: place-carousel
  bottom:
    - { module: segment-map, height: 64 }
    - { module: cue-ticker, height: fill, collapse: first }
collapse:
  footerFloor: 90
```

Everything except `play-card` is an existing, unmodified builtin.

## Corpus structure

Mirrors the classical split (knowledge tree / performance sidecar /
presentation definition) exactly, including its shelving pattern: `drama`
is the domain (parallel to `classical`), and each playwright/company gets
its own folder (parallel to each composer's) — Shakespeare is simply the
first one shelved. No period-shelving needed yet at 37-plays-one-playwright
scale, same as classical's early state; the pattern (shelf folders are
cosmetic, keyed by folder name at any depth) is already built to grow into
it.

```text
data/content/library/drama/
  shakespeare/
    _composer.yml                     # Shakespeare's bio (reuses the loader's reserved filename)
    taming-of-the-shrew.yml           # the WORK: groups > segments

data/content/surround/drama/
  shakespeare/
    taming-of-the-shrew.bbc1980.yml   # work ref + match + segment starts

data/content/surround/_surrounds/
  playhouse.yml
```

Work file shape (abridged):

```yaml
title: The Taming of the Shrew
genre: Comedy
setting: "Padua, Italy"
composed: "1590-1592"
year: 1592
aspectRatio: "4 / 3"
summary: >
  A comedy of wit and cruelty in which a fortune-hunter tames a fiercely
  independent woman into an obedient wife — or performs having done so.
cast:
  - { name: "Petruchio", role: "a gentleman of Verona" }
  - { name: "Katherina", role: "the shrew" }
  - { name: "Baptista", role: "her father" }
  # ...
facts:
  - "..."   # work-level, sparse — most commentary lives at group level
groups:
  # `kind:` and `title:` are this WORK's own choice, never read by code —
  # a different drama could use `kind: movement`, `kind: part`, or omit
  # groups entirely for a one-act piece.
  - kind: act
    title: "Act I"
    facts:
      - "Act-level commentary from the Cliffs Complete guide, verified against Wikipedia."
    segments:
      - n: 1
        label: "Scene 1"
        heading: "Padua. A public place."
        listen:
          - "Scene-level watch-for notes."
      - n: 2
        label: "Scene 2"
        heading: "Padua. Before Hortensio's house."
  # Act II - V ...
```

Sidecar shape (abridged):

```yaml
work: shakespeare/taming-of-the-shrew
surround: playhouse
match:
  contentId: plex:697661
  title: "The Taming of the Shrew"   # safe to rely on — Plex's season metadata was fixed, see "Seed case" above
performance: "BBC Television Shakespeare, 1980"
starts: [null, null, 42, 1180, ...]   # Induction scenes null — this production cuts them
```

## Timing derivation (skill process, not code)

The SRT is a raw, unlabeled ASR transcript. Timing comes from fuzzy-matching
each scene's known opening (and closing) line — from the Cliffs Complete
text — against the SRT's cue text, tolerant of transcription noise
("Tranio" → "Trollio"). This replaces the classical skill's three audio
tiers entirely; there is no equivalent tier ladder needed because the signal
(text) is more reliable than spectral analysis when it is available. Same
discipline as classical: explicit `null` for anything not confidently
placed (expected for the cut Induction), never a guessed number.

## Scope

Pilot end-to-end on *The Taming of the Shrew* only. The corpus schema,
timing method, and the four engineering pieces above are written generally
enough to extend to the other 36 Shakespeare plays, and to a future
non-Shakespeare stage work, without further code changes — that extension
is future authoring work (the eventual `drama-surround` skill), not part of
this implementation.

## Out of scope for this spec

- Authoring the other 36 plays. (Their files are now correctly renamed and
  matched too, as a side effect of fixing the whole season — see "Seed
  case" — so a future authoring pass for any of them starts from a clean
  Plex state, not a scrambled one.)
- Any change to the classical domain's existing modules beyond the two
  generalizations named above (`SurroundFrame`'s aspect ratio, `PlaceCarousel`'s
  fallback chain) — both are additive and backward-compatible (default to
  today's behavior when the new fields are absent), and both are usable by
  `classical` too, not `drama`-exclusive.
- The `drama-surround` skill file itself — written after this presentation
  exists and has been validated against the pilot play, so the skill can be
  checked against a working example rather than written speculatively.
