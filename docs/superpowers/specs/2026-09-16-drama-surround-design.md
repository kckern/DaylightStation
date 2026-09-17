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
identity — genre, setting, who's on stage), which classical's schema has no
equivalent of (a symphony has no characters). New module, same file shape as
the existing six (`.jsx` + `.scss`, registered in `builtins.js` under
`right`), reusing `ComposerCard`'s dissolve/timing pattern rather than its
content:

- Title, genre (Comedy / History / Tragedy / Romance — a stage work's own
  classification, not Shakespeare-specific), one-line setting ("Padua,
  Italy"), and ONE rotating pool that mixes work-level facts with
  hierarchy-scoped character cards (see "Character cards" below) — reusing
  the same dissolve/timing pattern `ComposerCard` already uses
  (`COMPOSER_FACT_INTERVAL_MS`-equivalent).
- **`PlayCard` is clock-aware; `ComposerCard` is not — a deliberate,
  documented deviation.** `ComposerCard` ignores `position`/`duration`
  because a composer's bio is true at 0:00 and at 53:00. A play's character
  roster is not: which characters are "in scope" and how their description
  reads both change with the Act that is playing, so `PlayCard` reads
  `position`/`contentId` and resolves the current segment the same way
  `CueTicker` does (`segmentAt`, `../segments.js`) to pick the right
  hierarchy level for `characterPool()`.
- New corpus fields needed on the allowlist: `genre`, `setting` (both
  domain-agnostic scalars). `characters:` is its own field, not
  allowlist-scoped the same way — see "Character cards" below.
- The playwright's own bio (`_composer.yml`, reused literally — the loader
  hardcodes that filename, and is itself already domain-agnostic — it
  works for a composer, a playwright, or any future "who made this")
  still resolves into `data.composer` and can supply a small byline if
  useful, but `PlayCard`'s primary content is the work, not its author.

### Character cards — hierarchy-scoped, shown on both surfaces

Added per feedback: "it is often hard to keep track of who's who," and a
character's description can need to change as the play progresses (Act 1's
Petruchio is "a fortune-hunter, freshly arrived to wive it wealthily";
Act 4's is sharper). This reuses the exact mechanism already justified for
Act/Scene commentary — no new hierarchy, no new merge concept beyond one
change of merge rule:

- **`characters:` is a list of `{ name, role, description }`**, authorable
  at the work level (the baseline roster) and, optionally, again on any
  `groups:` entry (or a `segments:` entry, for a change mid-Act) — the same
  three places `facts:` can already live.
- **`characterPool(data, index)`** (new, `segments.js`, parallel to the
  existing `factPool`) walks the identical segment → nearest-group-outward
  → work path `factPool` already walks, but merges by **name, nearest wins**
  — an Act 4 override of "Petruchio" REPLACES the work-level entry for
  Petruchio, rather than both showing up as two cards for one character (the
  behavior plain `facts:` correctly has instead — a fact list accumulates,
  because two true facts about a symphony are both worth rotating through;
  two descriptions of one character are not both current). Characters no
  Act has re-described keep their work-level baseline.
- **No new rendering machinery.** Both consuming surfaces already exist as
  rotating string pools with a house dissolve — `CueTicker`'s LEFT ("piece")
  zone (`factPool`'s existing consumer) and `PlayCard`'s rotating pool
  (above). Each surface formats a `characterPool()` entry into one string
  for its own rotation (name emphasized, then role, then description) and
  merges it into the same pool `facts:` already feeds — the fit/measurement
  system (`fit.js`) that governs both zones already treats "the pool" as an
  opaque list of strings to size against, so it does not care whether a
  string originated from `facts:` or from a formatted character card.
- **Both homes are legitimate and not exclusive** — per feedback, character
  info can suit the band's left zone, the sidebar, or both; a corpus author
  decides implicitly by what's in `characters:` at each level, since both
  `CueTicker` and `PlayCard` draw from the same `characterPool()`. Nothing
  needs authoring twice.

### 3. `PlaceCarousel` generalization

`PlaceCarousel.jsx` reads `composer.map` / `composer.city_image` directly, via
the shared `mapPinFrom(data)` (`countryMapPayload.js`). One existing
precedent already does a piece-first fallback: `piece.period ?? composer.period`
(see design.md's era-timeline section). Extend the same pattern:
`mapPinFrom` becomes `data.piece?.map ?? data.composer?.map` (returning which
source won, as a `source: 'piece' | 'composer'` field on the pin), and the
photo slide's `map`/`city_image` resolution becomes
`data.piece?.map ?? data.composer?.map` /
`data.piece?.city_image ?? data.composer?.city_image` — so a work can author
its own setting (Padua, Italy) via a `piece.map` override, falling back to
its author's own geography (Shakespeare's Stratford/London) when a work
authors none.

**One caption fix rides along, and it is required, not optional.**
`countryCaptionFor`/`cityCaptionFor` (`placeCaption.js`) derive sentences
like "Born in Stratford; worked in Italy" from the COMPOSER's own
nationality/birthplace compared against the drawn map — a claim that is true
when the map is the composer's own geography, and simply **false** when the
map is a play's fictional setting (Padua is not where Shakespeare "worked").
So: call those two caption functions only when the resolved pin's
`source === 'composer'`; when it is `'piece'`, caption with the bare
label (`pin.country` / `pin.city`) — exactly the wave-3 floor these
functions already fall back to for a composer with no biography, reused
here for the opposite reason (a location that isn't biographical at all).
`eraCaptionFor` needs no change — it already compares `piece.city` against
`composer.map.city` as "home" to decide whether to say "written at
elsewhere," which stays correct regardless of where the drawn pin comes
from.

No new module needed for any of this, just the fallback chain and the one
caption gate — and both benefit `classical` too (a work composed somewhere
other than the composer's home city already exists as a real case; the
caption fix only changes behavior when a `piece.map` is actually authored,
which no shipped classical work does today).

### 4. Character-pool plumbing (backend + a new frontend pure function)

The one piece of the character-cards design (above) that is genuinely new
code, because `facts:` and `characters:` need different merge rules and the
backend has to carry both through the same hierarchy walk:

- **Backend** (`backend/src/1_adapters/content/surround/YamlSurroundStore.mjs`):
  `nestedGroupSegments`'s `ancestor` object (~line 90-95) already carries
  `facts` via `textList(group.facts)`; add a parallel
  `characters: characterList(group.characters)` (new helper, filters to
  objects with a non-empty `name`, alongside `asArray`/`isPlainObject`/
  `textList`). The top-level payload (~line 1421, beside
  `facts: asArray(work.facts)`) gets `characters: characterList(work.characters)`.
  Both are additive keys; a work with no `characters:` produces empty
  arrays, changing nothing for `classical`.
- **Frontend** (`frontend/src/modules/Surround/segments.js`): a new
  `characterPool(data, index)`, structurally parallel to the existing
  `factPool` right beside it — same segment → reversed-ancestors → work
  walk — but merging into a `Map` keyed by `name` where the FIRST (most
  specific) entry for a name wins and later, broader ones are skipped,
  rather than `factPool`'s "skip exact duplicate strings, keep every
  distinct one."
- **Consumption, no new UI**: `CueTicker.jsx`'s existing `facts` derivation
  and `PlayCard`'s rotating pool (both already string-pool consumers) each
  format `characterPool()`'s output into one line — name, then role, then
  description — and merge those lines into the same pool `factPool()`
  already feeds. `fit.js`'s measurement treats the pool as opaque strings,
  so it needs no changes.

### 5. New presentation definition

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
# The baseline roster — shown whenever no nearer Act/Scene re-describes a name.
characters:
  - { name: "Petruchio", role: "a gentleman of Verona", description: "A fortune-hunter, freshly arrived in Padua to wive it wealthily." }
  - { name: "Katherina", role: "the shrew, Baptista's elder daughter", description: "Sharp-tongued and unwilling to be bartered into marriage." }
  - { name: "Baptista", role: "a rich gentleman of Padua", description: "Father to Katherina and Bianca; will not marry off the younger before the elder." }
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
  - kind: act
    title: "Act IV"
    # Re-describing ONE name is enough — this REPLACES the work-level
    # Petruchio card from this Act on; every other character keeps their
    # baseline description untouched.
    characters:
      - { name: "Petruchio", role: "a gentleman of Verona", description: "Deep into the taming — starving and sleep-depriving Katherina under the banner of 'kindness'." }
    segments:
      - n: 1
        label: "Scene 1"
        heading: "A hall in Petruchio's country house."
  # Act II, III, V ...
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
timing method, and the five engineering pieces above are written generally
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
