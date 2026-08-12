# Performance Assessment

The performance service (`frontend/src/modules/Piano/performance/`) judges a live
performance against an expected one. It is pure and DOM-free; surfaces bind it to
notation, keyboards, or game chrome as they see fit.

## Runners

- **Timed** — matches note attacks against millisecond targets compiled from an
  engraved score (tempo map in, perfect/good/miss windows). Used by Sheet Music
  polish and the hero game.
- **Untimed** — advances span-by-span through ordered expected pitches with no
  tempo map. A wrong note within two octaves of the target counts against the
  current span; anything farther is ignored as an unrelated key. Used by lesson
  drills.

## Matching

Held-set matching judges chords on what is currently held: pitch-class
equivalence, any wrong pitch class held is wrong, completion means the full set
is down at once, and by default the lowest note must be the chord root
(inversions rejected — an option relaxes this). Note releases matter only here.

## Grading and spans

Grading is dimensional — pitch accuracy, timing, continuity, simultaneity — with
weights an exercise may declare to say what it is about; defaults reproduce the
long-standing constants. Scores band to green/yellow/red on shared thresholds.

Assessment aggregates over spans: measures in a score, transposition cells in a
drill, one span for a bare exercise. A run tallies to an overall grade and
surfaces its heaviest contiguous block of trouble — the natural thing to go
drill next.

## Boundaries

Sequence matching is attack-only: ornaments, sustain pedal, and note durations
are not assessed. An onset group spanning two measures belongs to neither and is
excluded from per-measure grading. Timing math differs between the timed runner
(fixed windows) and challenge grading (beat-relative quality); unifying them is
a grading-policy version change, not a refactor.

## Producers

The service consumes expected-performance material; it never authors it. Scores
arrive via the target compiler, drills via seed expansion, card-game challenges
via the backend's adaptive policy.
