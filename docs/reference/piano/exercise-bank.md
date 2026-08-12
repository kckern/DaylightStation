# Exercise Bank

The canonical repository of performable items, at `data/content/music/`. It is
the producer counterpart to the
[performance service](performance-assessment.md), which judges a performance and
authors nothing.

Taxonomy and rationale: [exercise taxonomy design](../../_wip/plans/2026-08-11-exercise-taxonomy-design.md).

## Two rules

**Only seeds are stored.** A file is a seed; what a player performs is an
*instance*, computed from the seed and never written to disk. One triad seed
yields 288 instances. Five simple-family seeds yield over 1,600. Materialising
those as files would be the same content pasted hundreds of times, and every
correction would have to be pasted again.

**Folders are taxonomy: what a thing is.** The tree is for a person browsing on
disk, so it is organised the way a musician would organise it — notes,
intervals, chords, arpeggios, scales, runs, drills, progressions. Categories nest
to any depth, so a method book is a category under the family it belongs to
(`drills/hanon`) rather than a peer of every musical form.

Provenance does not disappear; it lives in the file, where it always did
(`provenance.source`, `provenance.inspired_by`, `provenance.tradition`). The cost
of this choice is worth stating: `form` is *derived*, so if a recomputation ever
disagrees with the folder, the folder is the stale thing and the file has to
move. That is a real maintenance edge, accepted because browsing by what
something is beats browsing by where it came from.

The categories are exclusive by how many notes sound at once — one (`notes`), two
(`intervals`), three or more (`chords`) — and then by what the material is.
Triads and sevenths are two *seeds* inside `chords/`, not two categories: they
differ only in their quality list, which is an axis. They stay separate seeds
because their inversion axes differ, since rotating a three-note chord three
times returns root position an octave up rather than a third inversion.

```
data/content/music/
  index.yml                     # manifest, with seed and instance totals
  notes/single.yml              #  1 seed  ->   72   one note
  intervals/all.yml             #  1 seed  ->  288   two notes
  chords/                       #  2 seeds ->  768   three or more
    triads.yml                  #              288
    sevenths.yml                #              480
  arpeggios/all.yml             #  1 seed  ->  288   chord tones in sequence
  scales/modes.yml              #  1 seed  ->  720   10 modes, incl. pentatonic and blues
  runs/                         # 12 seeds ->  144   blues, jazz and rock vocabulary
  drills/
    hanon/001.yml … 030.yml     # 30 seeds ->  360   the method book, CC0
    five-finger/                #  7 seeds ->   84   first patterns, one hand
  progressions/                 #  3 seeds ->   36   I-V-vi-IV, three voicings
```

58 seeds, 2,760 instances.

The bank lives in the Dropbox-synced data directory, not in the git repository
(`data/` is gitignored). This document is the tracked artefact; the content it
describes is synced content.

## Anatomy of a seed

```yaml
schema_version: 1
id: hanon/001                # stable; `collection/id`, matches the path
title: Hanon Exercise No. 1

key: C
meter: 2/4
staff: grand                 # treble | bass | grand
tempo: { unit: quarter, start_bpm: 60, target_bpm: 108 }

events: [...]                # the note material — see below
supports: [free, metronome, cued]
ordering: strict             # strict | any

expansion: { axes: {...} }   # how one seed becomes many — see below

provenance:
  tradition: pedagogy
  collection: hanon
  source: { file: hanon-condensed-exercises-1-to-30.mxl, license: CC0-1.0 }
tags: [five-finger, weak-fingers]

derived: {...}               # machine-owned — see below
```

### `events` — one shape for everything

An event is **one onset** holding a set of notes. That single shape covers a
lone note, a struck triad, a two-handed chord, and a long sequence, so nothing
downstream has to branch on what kind of item it is.

```yaml
events:
  - value: 16th              # note value; omit for untimed material
    notes:
      - { midi: 48, hand: left,  finger: 5 }
      - { midi: 72, hand: right, finger: 1 }
```

`hand` and `finger` are optional. A single held chord is one event with several
notes; a scale is many events of one note each. This is a superset of the
per-hand arrays in the current Hanon lesson files, so conversion is mechanical.

### `staff` — how it is read

`treble`, `bass`, or `grand`. Distinct from `hand`: a left hand can read treble,
and reading an unfamiliar clef is a real difficulty that shows up as pitch
errors. Single-hand material can therefore be expanded across both clefs and be
genuinely two different exercises.

Staff is **notational only and never moves a pitch**. The same notes read in
another clef are the same notes. Moving register is what the `octave` axis is
for, and keeping them separate stops a note's pitch depending on the clef it
happens to be written in.

### `expansion.axes` — the cross product

Each axis is an enumerable list. An instance is one point in the product of all
axes. Axes are transformations, not labels, and each has defined semantics:

| Axis | Values | Transformation |
|---|---|---|
| `root` | pitch classes, or `all` | transpose every pitch by (target − prototype root) |
| `quality` | chord or interval qualities | rebuild the event from the named quality |
| `inversion` | `root`, `1st`, `2nd`, `3rd` | rotate the chord, lowest note up an octave, n times |
| `octave` | integers | shift every pitch by 12n |
| `staff` | `treble`, `bass` | re-notate only — the pitches do not move |
| `direction` | `up`, `down`, `up-then-down` | order melodic material |
| `span_octaves` | integers | repeat across n octaves; a join note shared by two blocks is struck once |
| `mode` | mode names | respell against the named mode |

```yaml
# chords/triads.yml — 288 instances from this one file
expansion:
  axes:
    root:      { values: all }                       # 12
    quality:   { values: [major, minor, diminished, augmented] }
    inversion: { values: [root, 1st, 2nd] }
    staff:     { values: [treble, bass] }
```

Declare only the axes that vary. A named repertoire passage declares none and
yields exactly itself.

### Instance identity

Instances need stable ids so attempts and progress can reference them. The id is
deterministic from the seed id and the axis values, in the order the axes are
declared:

```
chords/triads@root=D,quality=minor,inversion=1st,staff=bass
hanon/001@root=C,direction=up-then-down
```

Nothing generates a random id, so the same instance is the same string forever
and history stays attributable across regenerations.

### `derived` — machine-owned

Everything computed lives under one key, so regeneration replaces that subtree
wholesale and can never clobber authored intent.

```yaml
derived:
  shape: { events: 16, notes: 16, max_simultaneity: 2, hands: both,
           span_semitones: 9, position_shifts: 0, accidentals: 0 }
  form: figure                        # derived and checkable
  level: { free: 1, metronome: 2, cued: 3 }
  instances: 24                       # size of the cross product
```

`level` is per mode, because level is `(asset × mode)`. It is a prior that
observed outcomes correct. An authored `level` at the top of the file overrides
the derived one where the formula is wrong.

Note that level for an *instance* differs from the seed: F-sharp major in second
inversion is not C major in root position. Instance level derives from the
instance's own shape.

## The simple families

The families that motivated seeding, and what one file each yields:

| Seed | Axes | Instances |
|---|---|---|
| `notes/single.yml` | pitch (36) × staff (2) | 72 |
| `intervals/all.yml` | root (12) × quality (12) × staff (2) | 288 |
| `chords/triads.yml` | root (12) × quality (4) × inversion (3) × staff (2) | 288 |
| `chords/sevenths.yml` | root (12) × quality (5) × inversion (4) × staff (2) | 480 |
| `arpeggios/all.yml` | root (12) × quality (4) × direction (3) × staff (2) | 288 |
| `scales/modes.yml` | root (12) × mode (10) × direction (3) × octaves (2) | 720 |

For these, `ordering` is `any` on chord material — the notes are struck
together, so order is not a claim the assessment can make — and `strict` on
scales and drills.

## Provenance for course-derived material

Some seeds take their *curriculum* from a commercial course while their note
content is common-practice theory. A five-finger pattern and a I-V-vi-IV
progression are facts about music, not authored expression; the lesson sequence
that arranges them is somebody's work and is credited as such.

```yaml
provenance:
  tradition: pedagogy
  collection: progressions
  inspired_by: { course: 'My Music Workshop', note: 'lesson sequence; note content is common-practice theory' }
  source: { file: null, license: null }
```

`inspired_by` credits without claiming, and `source.license: null` states plainly
that no licence is held — better than asserting one that is not ours.

## Collection index

Each collection carries an `index.yml` for metadata that belongs to the set
rather than to any one item.

```yaml
title: Hanon — The Virtuoso Pianist
subtitle: Finger-technique drills (exercises 1–30)
ordered: true              # sequence within the book is meaningful
provenance:
  tradition: pedagogy
  source: { file: hanon-condensed-exercises-1-to-30.mxl, license: CC0-1.0 }
```

`ordered: true` means the collection's own sequence is a real claim (Hanon 1–30
is a course). Ordering within a book and difficulty across the bank are
different things, and both are kept.

## Serving

Mounted read-only on the piano router (`YamlExerciseBank` reads seeds;
`shared/music/exerciseBank.mjs` expands them). Instances are computed per
request and never stored.

| Route | Returns |
|---|---|
| `GET /api/v1/piano/bank` | collections and totals |
| `GET /api/v1/piano/bank/search?…` | filtered instances plus facet counts |
| `GET /api/v1/piano/bank/<path>` | a category index, or a seed — categories nest to any depth |
| `GET /api/v1/piano/bank/<seed>/instances` | instance ids; `?expand=true` materializes, `?limit=` caps |
| `GET /api/v1/piano/bank/<seed>/instance?<axes>` | one instance, built from axis values |

Listing returns ids by default because a 504-instance seed is cheap to name and
expensive to build. Expansion is opt-in and capped.

An absent bank answers `503`, not an empty `200` — "no content installed" and
"this collection is empty" are different facts and a surface should not have to
guess which it received.

```
GET /api/v1/piano/bank/chords/triads/instance?root=D&quality=minor&inversion=1st&staff=bass
{ "id": "chords/triads@root=D,quality=minor,inversion=1st,staff=bass",
  "events": [{ "notes": [{ "midi": 65 }, { "midi": 69 }, { "midi": 74 }] }],
  "staff": "bass", "ordering": "any", "supports": ["free", "cued"] }
```

## What this does not do

- **No rendering.** Notation is a surface concern; the bank ships pitches,
  values, fingering, and staff.
- **No progression policy.** The bank says what exists and how hard it is.
  Choosing what a player sees next is the matching layer's job.
- **No audio.** Recordings, if any, are media and live under `media/`.
