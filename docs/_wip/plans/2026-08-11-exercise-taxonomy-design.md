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

## Skill matching

Level sorts exercises. Matching a player to one needs more: asset difficulty and
player ability have to be **the same coordinate**, or selection is guesswork.

### Derived level is a prior, not a fact

The formula gives an estimate before anyone has played the thing. Observed
outcomes correct it, so an exercise everyone fails becomes harder than the
formula claimed and the bank calibrates itself. This is what makes it safe to
ship weights that have not been tuned: a wrong prior heals instead of persisting.

An authored override still wins, because sometimes the disagreement is the
formula's fault and sometimes it is the population's.

### Skill is a vector

Grading already produces one. `grading.js` returns `pitchAccuracy`,
`timingAccuracy`, and `continuity` (plus simultaneity for chords), weighted
differently per mode — `untimed: {pitch 0.70, timing 0, continuity 0.30}` against
`paced: {pitch 0.55, timing 0.30, continuity 0.15}`. The 0-to-1 score is a
projection of that vector, and the projection discards exactly what teaching
needs.

So a player's skill is tracked per dimension:

```yaml
skill:
  pitch: 4.1
  timing: 2.3          # the weak one
  continuity: 3.8
  simultaneity: 3.0
```

The point is not precision. It is being able to say *your notes are ahead of your
rhythm*, and then to pick something that works the rhythm.

### Demand is a vector too, derived from Shape

| Dimension | Loaded by |
|---|---|
| pitch | accidentals, span, position shifts |
| timing | target tempo, rhythm variety, `metronome` and `cued` modes |
| continuity | event count, length of the run |
| simultaneity | `max_simultaneity`, hand independence |

Demand and skill are then comparable component by component.

### The matching rule

Find exercises whose demand on the player's **weakest** dimension sits just above
their current estimate, leaving the other dimensions at or below it. One new
difficulty at a time: a scale they already know, now with a metronome, is a
timing exercise and nothing else.

Aim for a success band rather than a level. Too easy teaches nothing and too hard
discourages; the band is a tuning knob, and it should be a stated number that can
be moved rather than an emergent property of the formula.

### The mode ladder is progression for free

Because level is `(asset × mode)`, a passed exercise is not finished. Passed
`free`, offer `metronome`. Passed that, offer `cued`. No new content is authored,
and the failure says which dimension is not ready.

### Cold start

A new player starts at the floor and climbs. No placement test, no inherited
estimate. It is slow for a strong player and kind to a beginner, which is the
right way round for a household instrument that a child walks up to unprompted.

### Prerequisites

Two, both real blockers rather than polish:

1. **Drill results must be persisted.** `performance-assessment.md` records that a
   completed drill logs `piano.drill-complete` and discards it. Matching cannot
   run on a surface whose outcomes are thrown away.
2. **The dimensional grade must be persisted, not just the score.** The attempts
   endpoint validates a scalar `score` in 0..1. A vector skill model cannot be
   reconstructed from scalars after the fact, so the full grade object has to be
   stored from the first attempt onward.

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
  Less urgent than it looks: derived level is a prior that observed outcomes
  correct, so a wrong weight decays instead of persisting.
- **The success band.** What pass rate matching should aim for is a stated number
  to be tuned against real players, not derived here.
- **Stale skill.** A child who has not played for three months is not the player
  the estimate describes. Whether estimates decay, and how fast, is undecided.
- **How many attempts before the prior yields.** An asset needs some number of
  observations before population data should outweigh the formula. The threshold
  is unset.
- **Per-hand grading.** `performance-assessment.md` records that per-voice
  attribution is not performed; staves merge into one pitch set per onset. A
  two-handed asset therefore cannot yet be graded per hand, which limits what
  `hand_independence` can be used for at run time.
- **Generative forms.** Deferred until seeded expansion is proven.
- **Where the bank lives.** The Hanon content sits at
  `media/docs/piano-lessons/<collection>/` behind `getLessonIndex`. Whether the
  bank generalises that path or replaces it is undecided.
