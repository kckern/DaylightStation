# PianoChallenge

PianoChallenge is the shared performance ask used by practice, learning steps,
video checkpoints, game gates, placement, and School piano lessons. A host
selects a material specification and owns its stake; `AskSession` resolves,
presents, judges, and records the performance.

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
