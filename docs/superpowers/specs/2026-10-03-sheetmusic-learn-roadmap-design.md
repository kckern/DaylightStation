# Sheet Music Learn Roadmap and Passage Training Ladder

**Date:** 2026-10-03

## Intent

Learn mode turns the engraved score into an open roadmap. Short, stable passages are
the roadmap nodes; a dedicated `ExerciseRun` is the training surface for each node.
The normal default ladder is right hand, left hand, hands together, then hands
together at the written tempo. An always-available timed Test Out can complete the
passage without walking the normal ladder.

Listen, Polish, and Perform keep their current full-score identities.

## Passage roadmap

Passages are deterministic and contiguous. Rehearsal marks divide the score into
musical regions; each region is divided into balanced chunks targeting four measures,
normally three to five, without creating a one-measure tail. A short rehearsal region
stays intact. Passages with no playable notes are omitted.

Every passage remains selectable. The UI recommends the earliest incomplete passage,
but never locks later music. The full engraving shows passage boundaries, completion,
the current recommendation, and tested-out status. Selecting a passage exposes its
ladder; selecting an available rung opens a focused run and Back returns to the same
roadmap location.

## Config-driven ladder

The resolved `sheetmusic.learn` config owns passage sizing and the ordered ladder.
Components consume normalized data and never branch on rung IDs. The shipped,
overridable defaults are:

| Rung | Parts | Mode | Work | Availability | Completion |
|---|---|---|---|---|---|
| Right hand | RH | free | 2 sets × 3 reps | sequential | next rung |
| Left hand | LH | free | 2 × 3 | sequential | next rung |
| Hands together | RH+LH | free | 2 × 3 | sequential | next rung |
| Together with the beat | RH+LH | cued | 1 × 3 | sequential | passage |
| Test out | RH+LH | cued | 1 × 3 consecutive | always | passage |

A rep is one complete passage performance. A passing free rep is 100% complete and
clean. A passing cued rep is also at least 80% placed on the beat. Normal reps bank
cumulatively; a failed Test Out rep resets only its Test Out streak. Cued runs use the
score tempo map and its existing fallback when the document has no tempo.

Hand-specific rungs are skipped when their requested parts are absent. Single-staff
and non-grand-staff scores therefore use applicable all-part/together rungs rather
than displaying false RH/LH work.

Malformed ladder overrides fall back atomically to the shipped ladder and emit a
structured warning. A digest of normalized behavior is the ladder revision, so a
config change cannot silently reuse incompatible rung completion.

## Run and progress contracts

`ExerciseRun` accepts an explicit practice requirement, selected score parts, and a
host-supplied drill projection. `ScorePassage` filters the compiled expectation to
those parts and recesses inactive staves. A Learn passage host turns config into those
inputs, banks results, retries within the rung, unlocks the next sequential rung, and
returns to the roadmap at passage completion or explicit exit.

The per-score practice record gains passage/rung progress keyed by passage ID and
ladder revision. PUT patches deep-merge passages and rungs with prototype-pollution
guards. Existing per-measure history remains diagnostic and seeds only compatible
untimed RH, LH, and together progress on first use; it never seeds timed or Test Out
progress. Guests receive equivalent session-local progression without writes.

Every attempt continues through the shared assessment evidence pipeline.

## Acceptance

- The score is an annotated, open roadmap in Learn.
- A normal grand-staff passage follows the configured sequential ladder and set/rep
  workload.
- Test Out is immediately available and completes the passage only after its configured
  consecutive timed reps.
- Part filtering, timing, retry, persistence, reload, guest behavior, and legacy-history
  seeding are covered by automated tests.
- Existing non-Learn score modes, exercise practice, and challenge score passages retain
  their behavior.

