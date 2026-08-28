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
