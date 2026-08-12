# Exercise Taxonomy — Performance Assessment Assets

Design for the canonical exercise bank named as "planned" in
[performance-assessment.md](../../reference/piano/performance-assessment.md#producers).
The performance service judges a performance against an expected one and
authors nothing. This is the counterpart: what an expected performance *is*, how
it is described, and how one authored seed becomes many playable exercises.

Scope is the asset and its vocabulary. Storage, API, and the authoring CLI are
downstream and not decided here.

## Why facets, not a hierarchy

A tree forces false choices. A Chopin passage that is also an arpeggio study,
also two-handed, also in F-sharp minor has no single correct folder, and
whichever one it gets filed under is wrong for every other way of looking for
it.

So an asset carries many tags, and **buckets are queries over tags rather than
folders**. "Every two-handed thing in a minor key at level 3 or below that this
player has not yet passed with a metronome" is the question progression actually
asks, and only a facet scheme can answer it.

## The five axes

Four of these were originally one idea. Separating them is the point: each has a
different author, a different lifetime, and a different test for correctness.

| Axis | Answers | Who sets it | Test for correctness |
|---|---|---|---|
| **Shape** | What is the material, structurally? | measured from the notes | arithmetic |
| **Form** | What is it an instance of? | derived from Shape | a check that can fail |
| **Provenance** | Where did it come from? | authored, structured | citation exists |
| **Mode** | How is this attempt judged? | chosen at run time | enum |
| **Expansion** | How does one seed become many? | authored, mechanical | expansion runs |

Shape is measurable, Form is verifiable, Provenance is citable, Mode is runtime,
Expansion is authoring. Keeping them apart is what stops the bank rotting into
tag soup.

### Shape — measured, never authored

Computed from the note material. Nothing here is a judgement call, so nothing
here can drift.

| Field | Meaning |
|---|---|
| `events` | count of distinct onsets |
| `notes` | total notes (an onset may hold several) |
| `max_simultaneity` | largest set struck together: 1 note, interval, triad, 4+ |
| `hands` | `left`, `right`, `both` |
| `hand_independence` | `parallel` (same figure both hands) or `independent` |
| `span_semitones` | lowest to highest |
| `position_shifts` | thumb-unders and jumps beyond a five-finger position |
| `accidentals` | count outside the declared key |
| `rhythm_values` | the distinct note values used |

`max_simultaneity` is what splits your "single note vs multi-note" cleanly: a
single note, a triad struck at once, and a two-handed chord are all **one
event**, differing only in how many notes that event holds. A scale is many
events of one note each.

### Form — derived, closed, and checkable

A closed enum, computed from Shape, not typed by a human. If an asset claims a
form it does not have, that is a failing check rather than a matter of taste.

| Form | Detected because |
|---|---|
| `note` | one event, one note |
| `chord` | one event, three or more notes |
| `interval` | one event, two notes |
| `scale` | consecutive scale degrees in one key |
| `chromatic` | every step is a semitone |
| `arpeggio` | sequential, all notes are chord tones of one chord |
| `progression` | consecutive multi-note events |
| `figure` | span within five fingers, no position shift (the Hanon case) |
| `sequence` | ordered material matching none of the above |

`sequence` is the honest fallback, not a dumping ground: it means "we looked and
it is not one of the above," which is a fact about the notes.

### Provenance — structured, not free text

What is left after Form is not a structural claim at all. "A blues lick" and
"from Chopin Op. 10 No. 4" are claims about origin, and origin has real
referents.

```yaml
provenance:
  tradition: blues          # classical | jazz | blues | pop | hymn | folk | pedagogy
  work: null                # a named piece, when it is from one
  composer: null
  collection: hanon         # the method book, when it is from one
  source:
    file: hanon-condensed-exercises-1-to-30.mxl
    license: CC0-1.0
```

`tradition` is closed. `work`, `composer`, and `collection` are open but
referential: they name a thing that exists.

### Tags — the quarantine

Everything genuinely subjective (mood, feel, "sounds cool") goes in free `tags`
that are **explicitly non-load-bearing**. Browsable and searchable; never
branched on by selection, progression, or grading.

This is already house style. `frontend/src/modules/School/home/subjects.js` draws
the same line: `subject` is deliberately separate from banks' free-form `topics`
because "one is a curriculum shelf, the other is search metadata; conflating them
would make every tag a shelf."

### Mode — how this attempt is judged

Not a property of the asset. One asset, several ways to attempt it, so
progression walks the same content up a strictness ladder instead of demanding
new content for every step.

**Tempo**, the three levels:

| Mode | Metronome | Start | Judged on |
|---|---|---|---|
| `free` | none | whenever | notes only |
| `metronome` | runs continuously | player picks the bar | notes, and each onset against the click |
| `cued` | runs, with a count-in | fixed downbeat | notes, onsets, and the entry itself |

**Ordering** is a separate axis, not folded into tempo. A held triad is unordered
and untimed; a scale played rubato is ordered and untimed.

| Ordering | Meaning | Existing matcher |
|---|---|---|
| `strict` | events in sequence | `drillRun.js` |
| `any` | the set, in any order | `heldSet.js` |

**Voicing**, for chord material: `root_position` or `inversions_ok` — already an
option on `heldSet`.

An asset declares which modes are meaningful for it. A four-note lick cannot be
usefully unordered; a single held chord cannot be on-beat.

```yaml
supports: [free, metronome, cued]
ordering: strict
```

### Expansion — one seed, many exercises

Already working in the Hanon assets and generalised here. The authored file is a
**seed**; what a player is asked to perform is an **instance**.

```yaml
expansion:
  transpose: { mode: diatonic, keys: all }   # all | circle-of-fifths | [C, G, F] | none
  direction: up-then-down                    # up | down | up-then-down
  span_octaves: 2
```

This is where "fixed versus expandable" lands, and it is a property, not a
category:

- **Fixed** content expands trivially or not at all. A named repertoire passage
  is what it is. `transpose: none`.
- **Expandable** content is a small seed with a large yield. Scales, arpeggios,
  and Hanon figures are one authored shape times twelve keys times direction
  times octave span.
- **Generative** content, later, produces material to a Shape spec rather than
  transposing a seed: "a four-note blues lick in A that ends on the flat third."
  Licks and runs are the natural first candidates because the interesting thing
  about them is the pattern, not the particular notes.

The bank should be able to say how many instances a seed yields, so a
twelve-key scale is not mistaken for twelve pieces of authoring work.

## Level

Derived from the facets, overridable by hand, and computed **per mode** —
`(asset × mode)`, never the asset alone.

Inputs are Shape and Mode: note count, max simultaneity, hands and
independence, span, position shifts, accidentals, rhythm variety, target tempo,
and the strictness of the mode. The exact weights are tuning, not design, and
should be settled against real assets rather than guessed here.

```yaml
level:
  free: 2
  metronome: 3
  cued: 5          # authored override; the thumb-under is awkward at speed
```

Deriving it means new content arrives with a sane level for free and levels stay
comparable across collections. The override exists because the formula will
sometimes be wrong, and being wrong quietly is worse than being wrong visibly.

An ordered collection (Hanon 1–30) keeps its order regardless. Sequence within a
method book and difficulty across the bank are different claims.

## Worked example

An existing asset, restated. Nothing in `hands` changes; the surrounding
vocabulary is what this design adds.

```yaml
id: hanon.01
title: Hanon Exercise No. 1
focus: Preparatory finger work — agility, independence, evenness.

meter: 2/4
key: C
tempo: { unit: quarter, start_bpm: 60, target_bpm: 108 }

shape:                      # derived; written back by the authoring tool
  events: 16
  notes: 16
  max_simultaneity: 1
  hands: both
  hand_independence: parallel
  span_semitones: 9
  position_shifts: 0
  accidentals: 0

form: figure                # derived, checkable
provenance:
  tradition: pedagogy
  collection: hanon
  source: { file: hanon-condensed-exercises-1-to-30.mxl, license: CC0-1.0 }
tags: [five-finger, weak-fingers]

supports: [free, metronome, cued]
ordering: strict
expansion: { transpose: { mode: diatonic }, direction: up-then-down, span_octaves: 2 }

level: { free: 1, metronome: 2, cued: 3 }

hands:                      # unchanged from the current format
  right: [...]
  left: [...]
```

## Buckets are queries

The buckets to author into fall out of the facets rather than being decided in
advance:

- `form: scale` + `tradition: jazz` — the modes
- `max_simultaneity: >=3` + `events: 1` — single chords, the flashcard case
- `form: progression` + `tradition: pop` — song changes
- `hands: both` + `hand_independence: independent` — the genuinely hard bucket
- `expansion.transpose: none` — the fixed repertoire shelf

## Open questions

- **Weights for the level formula.** Needs real assets to calibrate against.
- **Per-hand grading.** `performance-assessment.md` records that per-voice
  attribution is not performed; staves merge into one pitch set per onset. A
  two-handed asset therefore cannot yet be graded per hand, which limits what
  `hand_independence` can be used for at run time.
- **Generative forms.** Deferred until seeded expansion is proven.
- **Where the bank lives.** The Hanon content sits at
  `media/docs/piano-lessons/<collection>/` behind `getLessonIndex`. Whether the
  bank generalises that path or replaces it is undecided.
