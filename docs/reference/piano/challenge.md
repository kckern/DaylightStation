# PianoChallenge

PianoChallenge is the shared piano-performance contract used by practice,
learning steps, video checkpoints, game gates, placement, and School piano
lessons. The name describes the thing presented to the learner: nobody is
"asking the platform." A host asks the learner to play specific material for a
specific reason, and `AskSession` turns that request into one judged attempt.

Related references:

- [Exercise bank](./exercise-bank.md) — the mounted repertoire and instance format
- [Performance assessment](./performance-assessment.md) — attempt evidence and rubrics
- [Game budget and match gate](./games-budget-gate.md) — the board-game host and its stakes
- [Grid addressing](./grid-addressing.md) — piano vocabulary used to select board squares

## Responsibility boundary

The host owns **why** the learner is playing and what success changes. It chooses
the ask or bank instance, framing copy, rotation, ladder movement, failure
policy, and any reward. `AskSession` owns **how** that request becomes a playable
attempt: material resolution, child-facing ask copy, presentation, grading, and
the pass/fail result returned to the host.

| Layer | Owns | Does not own |
| --- | --- | --- |
| Host | purpose, stake, level selection, rotation, progression, unavailable policy | rendering notes or judging MIDI |
| `AskSession` | resolving material, expanding/validating the ask, framing, mounting one run | ladder policy, rewards, School state, game access |
| `ExerciseRun` / assessment | MIDI evidence, timing, hints, notation, rubric result | why the attempt exists or what a pass buys |
| Server application | durable profile, game budget, earned-time credit, School completion | deciding a result from raw client MIDI |

The current hosts are:

| Host | Why it asks | What a pass changes |
| --- | --- | --- |
| Exercises | voluntary practice | completes the current run |
| Program step | finish named learning work | advances that program step |
| Video checkpoint | demonstrate the checkpoint skill | lets the lesson continue |
| Game gate | earn entry to the next match | moves the repertoire ladder and opens the match |
| Placement | find an appropriate starting point | saves the learner's durable challenge profile |
| School lesson gate | finish today's assigned piano work | records School completion |

Hosts receive `onPassed`, `onFailed`, `onUnavailable`, and optional resolution
details. They must not invent a second score threshold after `AskSession` has
returned its rubric verdict. An authored/configuration failure and a bank or
score outage remain distinguishable so a gate can fail open for infrastructure
without granting access for malformed work.

The table below is generated from
[`askSchema.js`](../../../frontend/src/modules/Piano/ask/askSchema.js). Run
`node scripts/render-piano-challenge-grammar-doc.mjs` when intentionally
updating this checked-in reference; its test prevents schema/document drift.

<!-- generated:start — scripts/render-piano-challenge-grammar-doc.mjs -->
## Grammar reference

| Axis | Allowed values |
| --- | --- |
| texture | `unison` · `chord` · `line` · `polyphony` |
| hands | `right` · `left` · `both` · `either` |
| source | `synthesized` (`count`, `register`) · `bank` (`family`, `root`, `mode`, `quality`, `direction`, `octaves`, `inversion`) · `score` (`sourceId`, `measureStart`, `measureEnd`) |
| prompt | `follow` · `recall` · `read` |
| secondary | `none` · `staff` · `keyboard-strip` |
| notationStyle | `sequence` · `engraved` · `score` |
| timing | `free` · `pulsed` · `cued` |
| judging | `completion` · `clean` · `placed` |
| hints | `none` · `after-stall` · `always` |

### Presets

| Preset | Expansion |
| --- | --- |
| `tier-0` | `prompt: follow`, `secondary: none`, `timing: free`, `judging: completion` |
| `tier-1` | `prompt: follow`, `secondary: staff`, `timing: free`, `judging: completion` |
| `tier-2` | `prompt: read`, `secondary: keyboard-strip`, `notationStyle: sequence`, `timing: free`, `judging: completion` |
| `tier-3` | `prompt: read`, `secondary: keyboard-strip`, `notationStyle: engraved`, `timing: cued`, `judging: placed` |

<!-- generated:end -->

## Authoring rules

Use a named tier as compact compatibility sugar, or use `presentation` and
`grading` to state the values needed for a new ask. The gate ladder still needs
`tier` for ordering and failure/climb policy, but explicit presentation values
override that tier's preset and are preserved through repertoire resolution.
Material remains the sole source selector: `keys` is synthesized, `exercise`
is bank material, and `score` is a MusicXML passage. A recall chord is
therefore a `keys` material with `root` and `quality`, plus
`presentation.prompt: recall` and `grading.pitchClass: true`.

Do not author a matcher name, client-side credit, or a School completion flag.
The host sends a passed assessment identity; the server owns durable profile,
budget, and School-completion effects.

### Material shapes

An ask selects exactly one source shape:

```yaml
# A synthesized prompt. No bank entry or network lookup is required.
material:
  - { kind: keys, notes: 1, arrangement: sequence }

# Mounted repertoire. roots may rotate between attempts.
material:
  - { kind: exercise, collection: scales, roots: [G, D, F] }

# A bounded passage in a mounted score.
material:
  - { kind: score, source: music/scores/example.musicxml, measures: [1, 4] }
```

Use `instanceId` instead of `collection` when the exact bank item matters. A
collection plus roots is intentionally a repertoire query; the host chooses a
rotation index, then resolution selects the concrete instance.

### Presentation and grading

`presentation` controls what the learner sees and when; `grading` controls what
counts as success. Keep those choices independent. In particular:

- `prompt: recall` hides the answer initially; `hints: after-stall` may reveal it
  only after the learner stalls.
- `notationStyle: engraved` uses staff engraving even in `timing: free`; free
  means unpaced, not unnotated.
- `grading.pitchClass: true` accepts the requested chord in any octave or
  voicing. Add `bassPitchClass` only when an inversion or root bass is genuinely
  part of the assignment.
- `judging: completion` requires all expected material. `clean` additionally
  evaluates wrong notes. `placed` describes the cued tier: placement contributes
  to its score, but the current gate hard-checks completeness and cleanliness,
  not a separate placement threshold.
- A single-note staff ask stays a compact note card rather than expanding into
  a misleading full system.

For a new ask, prefer explicit values:

```yaml
presentation:
  texture: chord
  hands: either
  prompt: recall
  secondary: none
  notationStyle: sequence
  timing: free
  hints: after-stall
grading:
  judging: completion
  pitchClass: true
```

Named tiers remain supported for existing ladders, but they are ordering and
default-presentation shorthand, not four separate execution paths.

## Durable progression and side effects

Placement establishes a learner's durable base rung. Later judged gate attempts
move that base according to the host's climb/failure policy. The server accepts
profile changes, earned-time credit, and School completion only for a known
learner and an authorized passed assessment. Stable assessment and game-session
identities make retries idempotent.

The UI may display or request these effects, but browser state is never the
authority for durable credit or completion.

## Daily board-game pressure

The durable repertoire rung remains the learner's long-term base. The Games
host adds an orthogonal same-day offset from the number of completed Chess,
Checkers, and Connect Four games in the current 4 a.m. study day. Both the
offset curve and the game-seven capstone are configured under
`gameGate.dailyEscalation`; a learner's `path` names and orders the repertoire
levels that offset may traverse. The highest effective level served that day is
persisted in the local gate state as a high-water floor, so failures can adjust
the long-term base without making a later challenge easier that same day.

An explicit free-time ask with `grading.judging: clean` includes cleanliness in
its rubric. Setting `cleanliness: 1` is therefore an exact-score capstone;
legacy free/completion asks remain completeness-only.

The three values should be read separately:

| Value | Meaning | Changes when |
| --- | --- | --- |
| Base rung | durable learning position | every judged PianoChallenge pass or failure |
| Daily stage | completed-game pressure for this 4 a.m. study day | a Chess, Checkers, or Connect Four match finishes, win/loss/draw |
| Effective rung | the ask served now | base + configured daily offset, bounded by today's high-water floor/capstone |

This is deliberately separate from grid addressing. A board's file/rank
vocabulary escalates after human moves and uses `gameAddressing`; the challenge
between matches escalates after completed games and uses
`gameGate.dailyEscalation`. They share a pressure signal, not an implementation.

```yaml
gameGate:
  stateVersion: piano-challenge-sp4
  dailyEscalation:
    enabled: true
    steps:
      - { completedGames: 0, offset: 0 }
      - { completedGames: 4, offset: 4 }
      - { completedGames: 5, offset: 6 }
      - { completedGames: 6, offset: 8 }
    capstoneAfter: 7
  users:
    learner:
      startLevel: current-study-material
      path: [current-study-material, harder-scale, study-passage, capstone]
      dailyEscalation:
        enabled: true
        capstoneAfter: 7
        capstoneLevel: capstone
```

The completion counter is server-authoritative and retry-safe. Records require
the learner, one of the three eligible game ids, a completed win/loss/draw, and
the game's stable session id. The next rematch boundary waits for that receipt,
so a rapidly repeated game cannot receive yesterday's—or the previous game's—
difficulty.

### In-game board addressing is a separate ladder

Chess, Checkers, and Connect Four can require piano input to select a square.
That vocabulary is configured under `gameAddressing`, not `gameGate`. Its
difficulty combines a learner's configured start stage with:

1. a study-day offset from completed games; and
2. a turn offset from completed human moves in the current match.

Staff learners progress through wider clef/range, shuffling, then dyads and
triads. Chord learners progress through roots, qualities, accidentals, and
inversions. Staff texture generation is guarded to one to three distinct notes
within a perfect fifth, with the two board axes in disjoint registers; the
result must be playable by one hand and unambiguous. A new mapping takes effect
only at a safe human-turn boundary, never underneath held notes.

```yaml
gameAddressing:
  enabled: true
  dailyEscalation:
    enabled: true
    steps:
      - { completedGames: 0, offset: 0 }
      - { completedGames: 5, offset: 6 }
  turnEscalation:
    enabled: true
    everyCompletedMoves: 1
    offsetPerStep: 1
  users:
    staff-learner: { vocabulary: staff, startStage: 0 }
    chord-learner: { vocabulary: chords, startStage: 0 }
```

Do not use addressing progression to choose a PianoChallenge repertoire level,
and do not use a PianoChallenge verdict to advance the map mid-turn. The two
systems share the same server-authoritative completed-game count because both
should become less inviting after repeated play, but their state, content, and
transition boundaries are deliberately separate.

## Operational invariants

- The household study day changes at 4 a.m. local time, not midnight.
- Wins, losses, and draws count; abandoned matches do not.
- Replaying the same `gameSessionId` cannot increment the day twice.
- Failures may lower the durable base, but never lower the same-day high-water
  challenge already reached.
- Missing material or infrastructure must not trap a child at a gate; malformed
  authoring must remain visible rather than silently awarding a pass.
- Household assignments should use explicit `presentation` and `grading` when
  the intended skill is more specific than a tier preset.

After changing the grammar, regenerate this page and run its drift test:

```sh
node scripts/render-piano-challenge-grammar-doc.mjs
npx vitest run scripts/render-piano-challenge-grammar-doc.test.mjs
```
