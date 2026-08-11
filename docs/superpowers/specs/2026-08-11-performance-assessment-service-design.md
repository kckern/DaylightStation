# Performance Assessment Service — Design

**Date:** 2026-08-11
**Status:** Spec, pending review

## Problem

The piano app repeatedly asks a player to play specified notes and judges whether
they played them right. That idea has been built four times — Sheet Music "Polish"
mode, Sheet Music "Learn" follow-along, the card-game challenge provider, and the
Hanon lesson drill — because each time it arrived attached to a surface. The idea
itself was never named, so it exists only as four incidental implementations, each
entangled with its host UI.

The four are not redundant copies. They are **disjoint**: no single surface has more
than a third of the capability.

| capability | polish | learn | card game | lessons |
|---|---|---|---|---|
| per-unit grading | yes | — | yes | — |
| aggregation, weak-spot | yes | — | — | — |
| tempo / metronome / count-in | yes | — | — | — |
| content realization (theory) | — | — | partial | yes |
| adaptive content selection | — | — | yes | — |
| non-MIDI input fallback | — | — | yes | — |

Each surface independently built the slice it needed. The cost is not just triplicated
maintenance (real: one CSS paint defect had to be found and fixed separately in two of
them). The cost is that **capability is trapped**. The card game knows how to grade
timing and continuity; Hanon is content whose entire purpose is evenness and tempo
progression, and it awards nothing. Polish knows how to find the worst measure in a
run; pointed at Hanon that would identify the failing finger transition, which is the
whole point of Hanon. Neither can reach the other.

There is also literal duplication. Note accuracy, in two files:

```js
clamp(matchedCount / (expectedCount + wrongCount), 0, 1)   // polish
required / (required + Math.max(0, wrongNotes))            // card game
```

## Goals

Provide one surface-agnostic service that answers: *here is an expected performance,
here is what was played, how well did it match.*

Success means a new surface can assess a performance without writing matching, grading,
or timing logic — and that an exercise authored for one surface runs unmodified in
another.

## Non-goals (narrow scope)

The service assesses **one attempt against one exercise**. It does not own:

- **Progression, mastery, or what-to-practice-next.** Adaptive content selection stays
  where it is today, above the service. The service consumes an exercise; it does not
  choose it.
- **Rendering.** No notation, no highlighting, no keyboards. The service emits state.
- **Content authoring or storage.** Exercises arrive through a port.
- **Reward semantics.** Damage, coins, lesson completion, gradebook entries all belong
  to the consumer.
- **Audible metronome.** The service owns the *timebase*; playing a click is presentation.

## Core model

Every exercise the system needs — a single chord, a scale, a chord progression, a
two-handed Hanon figure, a Roman-numeral progression in a key, a full engraved piece —
collapses into one structure:

> **An exercise is one or more voices; each voice is an ordered list of events; each
> event is a set of pitches.**

- single chord → 1 voice, 1 event, 3 pitches
- scale → 1 voice, 8 events, 1 pitch each
- chord progression → 1 voice, 4 events, 3–4 pitches each
- two-handed → 2 voices, each with its own events
- engraved piece → 2 voices, many events, grouped into spans by measure

There is no "chord kind" and "scale kind". The existing `kind: chord | scale | arpeggio
| timed-pattern` enum is the wrong axis — those are presets over parameters, not types.

### Spans

Assessment happens over **spans**, and spans aggregate. A span is a contiguous group of
events graded as a unit.

- A drill is the degenerate case: **one span**.
- A Hanon exercise is naturally one span per transposition of the figure.
- An engraved piece is one span per measure.

Same engine, different granularity. Aggregation over spans yields the run score and the
weak-spot — the single most pedagogically valuable output, currently reachable only from
polish mode.

### Three nouns

- **Exercise** — a declarative spec of an expected performance.
- **Attempt** — a stream of timestamped performance events matched against an exercise,
  yielding live state and a terminal outcome.
- **Assessment** — the graded verdict, per span and aggregated.

## Exercise parameters

| axis | values | decides |
|---|---|---|
| **voices** | 1..n (hand / staff / part) | polyphony |
| **ordering** | `simultaneous` · `ordered` · `unordered` | must notes be together, in sequence, or any order |
| **pitchEquivalence** | `exact` · `octave` · `pitchClass` | does C3 satisfy C4; does any inversion count |
| **timing** | `none` · `relative` · `paced` | just hit them / correct rhythm / on the beat |
| **completion** | `once` · `reps(n)` · `duration(ms)` · `timeLimit(ms)` | when it is over |
| **tolerance** | wrong-note budget, timing window | difficulty, independent of content |
| **grading weights** | weights over the scored dimensions | what this drill is *about* |

Two of these deserve emphasis.

**`pitchEquivalence` exists nowhere today** and is the difference between a drill that
feels smart and one that feels broken. "Play a C major chord" should accept any inversion
in any octave; a Hanon figure requires exact pitches.

**Grading weights become data.** Today polish hardcodes `noteScore × (0.6 + 0.4×timing)`
and the card game hardcodes `0.55/0.30/0.15` (paced) or `0.70/0.30` (untimed). Declaring
weights on the exercise is what lets Hanon say "grade me on evenness and continuity,
timing barely matters at first" while a rhythm drill says the opposite — same engine,
no new code.

## Material: specification vs realization

"I–IV–V–I in G", "G mixolydian", "Cmaj7", and Hanon's *figure plus climb it diatonically
two octaves* are **specifications**. Voices and events are the **realization**.

**The service owns realization.** Otherwise every surface reimplements music theory and
we are back where we started. The theory primitives already exist (`pitch`,
`keySignature`, `handSplit`, `diatonicTranspose`, `expandDrill`) but live in a frontend
notation module that only the lessons surface reaches.

A `Material` is either literal (explicit voices/events) or symbolic (a spec plus an
optional transform). Realization is a pure function: `Material → Voice[]`.

## Timing contract

The two shipped implementations disagree about how tempo affects difficulty. Resolved:

- **Matching uses beat-relative tolerance.** `tolerance = max(floorMs, beatMs × k)`.
  Playing slowly is genuinely easier and is graded on that curve. This adopts the card
  game's shape and retires polish's fixed 80ms window, which is likely why polish feels
  punishing at slow tempos.
- **Reward uses a tier multiplier.** Tempo tier scales what the run is *worth*, not
  whether a note counted.

These answer different questions and both survive. Tolerance decides "was that note on
time"; tier decides "what was this run worth".

Timing quality degrades on a ramp beyond the tolerance window rather than as a cliff,
preserving the existing behavior in both implementations.

## Scored dimensions

One grader computes the dimensions an exercise declares:

- **pitch accuracy** — matched / (expected + wrong)
- **ordering** — correctness of sequence, where ordering is `ordered`
- **timing** — mean quality over matched events, where timing is not `none`
- **continuity** — wrong notes as a fraction of expected; penalises broken flow
  separately from accuracy, so a wrong note costs twice
- **simultaneity** — onset spread within an event, for chords

An exercise declares which dimensions apply and their weights; undeclared dimensions are
not computed. Per-span output carries both the raw dimensions and a categorical grade
(the existing red/yellow/green), so a surface can render either.

## Ports

The service is the middle; surfaces are adapters.

- **Content** — supplies exercises (authored YAML, generator, adaptive policy). The
  service consumes; it never chooses.
- **Input** — supplies timestamped performance events. MIDI today, virtual keyboard
  already exists, microphone or another instrument later. The service never touches
  transport.
- **Presentation** — live state out: current targets per voice, per-event status,
  progress, live span grades. A surface decides whether that becomes engraved noteheads,
  a lit keyboard, a health bar, or nothing.
- **Outcome** — receives the run assessment. Damage, lesson progress, gradebook, coins.

Under this shape "Hanon lesson" and "card-game challenge" are not two features. They are
two bindings differing only in which content feeds the service and who consumes the
verdict.

## What is absorbed

Largely move-and-unify, not rewrite. The donor modules in polish are pure, DOM-free, and
individually tested, which is what makes this tractable.

| responsibility | absorbed from |
|---|---|
| matching | `nearestEvent`, `useFollowTracker` (polish) · `scaleProgress` (game) · the lesson drill's inline follow loop |
| grading | `scoreEvaluator` (polish) · `pianoChallengeGrading` (game) |
| aggregation, weak-spot | `gradeTally`, `polishTiers`, `worstSpan` |
| timebase | `clickScheduler`, `countIn` |
| realization | `drillTranspose`, `pitch`, `keySignature`, `handSplit` |
| input | `midiTap`, `pedalEdge`, `inputKind` · virtual-keyboard fallback |
| attempt record | the two existing persistence paths, unified |

## What stays out

Rendering (notation renderers, highlight layers, live-input layers, keyboards),
scrolling, transport and hand-selection UI, lesson browsing, and game semantics.

The three CSS class vocabularies (`note-current`/`note-played`/`note-wrong`,
`piano-note-pending`/`-hit`/`-match`, `piano-scale-note--next`/`--complete`/`--wrong`)
collapse to **one state vocabulary** emitted by the service. Styling stays per-surface:
polish should look like a score, the game like a game. This also means a paint defect in
the shared states is fixed once.

## What is new

1. Exercise specification as data (the parameter table above).
2. `pitchEquivalence`.
3. Symbolic material beyond diatonic transpose — chord symbols, Roman numerals in a key,
   scale specs.
4. Generalized spans (polish has measures only; drills have no span concept).
5. Multi-voice matching (polish tracks parts; the game is single-voice).
6. Declared grading weights.
7. Completion rules — "play it 4× correctly", "sustain 60s".
8. The ports themselves.

Items 1, 2, 6 and 7 are mostly reshaping constants into data. Items 3 and 5 are genuine
new capability.

## Migration

Surfaces move one at a time; the service ships before any surface depends on it.

1. **Extract from polish.** It is the most complete donor. Behavior must not change —
   its existing tests are the safety net, and any diff in grading output is a bug.
2. **Rebind the card-game provider.** Its four capability kinds become parameter presets.
   Verify against recorded attempts.
3. **Give lesson drills grading.** Hanon gains scoring and weak-spot for the first time
   — the first new user-visible capability, and the proof the abstraction pays.
4. **Rebuild the lessons surface** on the service.

Sheet Music "Learn" follow-along folds in with step 1 or 3, whichever proves cleaner.

## Testing

The service is pure and DOM-free, so it is unit-testable end to end: realization
(`Material → Voice[]`), matching (event stream → per-event status), grading (dimensions
→ score), aggregation (spans → run + weak-spot).

Two properties matter most:

- **Migration equivalence.** For step 1, the same inputs must produce byte-identical
  grades to today's polish output. This is the only guard against silently changing how
  every existing practice record scores.
- **Preset equivalence.** Each card-game kind, expressed as parameters, must reproduce
  the current provider's verdicts.

Surface bindings get thin integration tests only; the logic they would have tested now
lives in the service.

## Risks

- **Grading drift.** Unifying two graders changes numbers unless guarded. Existing
  practice records and run scores were produced under the old math; retiring polish's
  fixed 80ms window will move historical comparisons. Decide whether to re-score history
  or mark a scoring epoch.
- **Over-generalisation.** The parameter space is wide enough to model exercises nobody
  wants. Presets, not raw parameters, should be the authoring surface.
- **`ScorePlayer` is ~2,200 lines.** Extraction touches it heavily. It should get
  smaller, not merely rearranged.

## Open questions

- Do historical practice records get re-scored under the new timing contract, or is a
  scoring epoch recorded and old runs left as-is?
- Does the service own the beat clock for `paced` exercises, with surfaces subscribing
  for an audible click — or does a surface own the clock and feed the service a
  timebase? The first is proposed here; the second is viable if a surface needs to drive
  tempo interactively.
