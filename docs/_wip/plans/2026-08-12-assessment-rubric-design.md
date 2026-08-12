# Assessment Rubric — design notes

Working notes behind the concept map in
[performance-assessment.md](../../reference/piano/performance-assessment.md#concept-map).
The map is the settled shape; this records why, and what is still open.

## The problem

Grading was a fixed formula. It needs to be a configurable rubric: named
criteria, each switchable, weighted, and tunable, selected per context. The
formula also conflated things that a teacher keeps apart — most obviously *"did
you play the right notes"* and *"did you play wrong notes"*, which
`pitchAccuracy = played / (required + wrong)` answers as one question.

## Decisions

**A rubric is scored criteria plus optional gates.** Every enabled criterion
yields a 0–1 and a verdict. The rubric weights them into a score and may mark any
of them required. Score answers *how well*; gates answer *did you pass*. "Wrong
notes are free for a beginner" is a criterion switched off, not a weight set near
zero.

**The rubric never touches measurement.** Every criterion is computed on every
run; the rubric chooses only weights and gates. Decoder and matcher parameters
belong to the item, never the rubric — otherwise two children's `completeness`
are different measurements sharing a name, and no versioning recovers that.

**Rubrics key to modes, not users.** The bank already declares
`supports: [free, metronome, cued]` with a level per mode. A beginner is not a
child with a lenient rubric; a beginner is a child in free mode. Scores stay
comparable within *(item, mode)* — the coordinate the level model already uses.
Per-user configuration selects which mode and which projection, never the
measurement.

**Simultaneity is decoding, not judgement.** Three note-ons 10ms apart are one
chord the wire serialised. Onset grouping moves upstream into the decoder, whose
window must be expectation-aware: a fixed 300–400ms window would fuse a run of
sixteenths (125ms apart at 120bpm) into chords. The decoder still *records* onset
spread, because expectation-aware fusing would otherwise hide a badly rolled
chord.

**Order is not a criterion.** Under the cursor matcher it is unobservable — the
cursor only advances on the expected note, so a run cannot be completed out of
order and violations surface as wrong notes. Under the held-set matcher it is
deliberately free. Only the timed matcher can observe it, where it mostly
manifests as bad placement. It survives as a `transposition` count in the
matcher's alignment.

**Each error is charged once.** The matcher emits a classified edit script —
omission, insertion, substitution, transposition — and criteria derive from the
classification. Otherwise one wrong finger dents completeness *and* cleanliness,
costing roughly triple an omission for what a teacher calls one mistake.

**Evenness is deferred.** A careful beginner hunting for F♯ produces wild
inter-onset variance while a reckless one slams through steadily; at beginner
tempi the measure reflects reading fluency, not rhythm, and would punish the
child it is meant to help. Stall count ships as a diagnostic instead.

**Pace is a gate, not a weight or a multiplier.** Speed is the progression axis
for technique material — every Hanon seed carries `60 → 108` — but weighting it
teaches a child to rush, and a bonus multiplier is the most comparability-
destroying option available. It gates against the item's `target_bpm`.

**A score range is an exercise.** A learn-mode selection resolves to ordered
onsets holding pitch sets, which is the bank's own event shape. It gets a level
for free from `deriveLevel`, can carry an identity so attempts accrue to a
passage, and closes the loop `spans.js` already half-built: polish grades a run,
`worstSpan` names the worst bars, those bars become a learn exercise.

## Open

- **The output language.** Vector, verdict `{score, passed}`, and the projections
  — detail, percentage, band, pass/fail. A gate failure must be visible in every
  projection without zeroing the score: "94%, not passed" is true and teachable;
  "0%" is a lie. Letter grades are contested: a five-note drill quantises to a
  handful of values, so thirteen grades claim resolution the measurement lacks.
- **Abandoned runs.** A completeness gate is exactly what walking away fails.
  Needs an explicit third state, or every gate becomes an abandonment penalty.
- **The persistence contract.** The attempts endpoint validates a scalar 0–1.
  The vector-plus-verdict shape has to be settled against it first.
- **Per-hand grading.** Blocked on per-voice attribution, which does not exist —
  staves merge into one pitch set per onset.

## Consolidation this implies

- `useFollowTracker` (learn) and `drillRun` (exercises) are the same cursor
  matcher written twice.
- `MusicNotation/model/drillTranspose.js` and `shared/music/exerciseBank.mjs`
  are two transposition engines; only the latter has the key-anchoring fix.
- `Lessons/` is retired: its route redirects to Exercises, its drill runner is
  superseded by `ExerciseRun`, and `theoryEngine` (still used by Producer) moved
  to `modules/Piano/theory/`.
