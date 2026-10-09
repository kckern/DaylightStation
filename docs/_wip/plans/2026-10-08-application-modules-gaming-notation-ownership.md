# Gaming and notation ownership review

Read-only source review against M1 checkpoint759be3aaf7 and current M2 worktree. This is implementation input, not completed migration evidence.

## Gaming

- `shared/gaming/kernel`, mechanics, rule modules, result/presentation contracts and asset algorithms are reusable capability candidates. Preserve rule identifiers, revisions, session formats and deterministic reducers.
- `frontend/src/modules/Gaming/platform` already prohibits imports of experiences/environments through its architecture test. Preserve the direction after migration. Fitness's Timer facade consumes this platform's actual Timer component.
- Concrete presenters and `experiences/presenterRegistry.js` are not neutral runtime. Both PianoCardGame and GamingApp consume the card-battle registration; assemble published providers explicitly without importing installed providers from the runtime.
- `GamingApplication.createSession` has charades-history policy. `gamingSessionSetup` resolves household candidates through PartyGamesCatalog. `GamingEffectService` specifies party-games automatic printing and family-friendly AI commentary/judgment. These are product responsibilities despite the generic directory names; extract exact injected policy or keep the actual application with its product, rather than labelling the whole directory shared.
- `createGamingApiModule` assembles coordinator, runtime, snapshots/journal, effects, drawing checkpoints and clue history. Separate product providers from reusable assembly while retaining one runtime/coordinator/storage authority, its existing wiring and all return values.
- Piano game containers, opponent dialogue/rivalry memory, ladders and day-budget integration follow Piano. Engine/rule algorithms can be shared; product-facing repositories and dialogue policy cannot become generic merely because several board games use them.
- Arcade session authorization, time grants, observation, reconciliation and enforcement form product policy distinct from deterministic game rules. Inventory includes adapters outside gaming directories: KioskArcadeGameTerminator/Speaker, FullyKioskArcadeGameOverlay, HomeAssistantArcadeGameAlert, eventbus announcers and YAML session/intents/grants stores. Preserve opt-in observation, one tracker per device, polling and stale-session semantics.

## Music

- `shared/music/learningPrograms.mjs` hardcodes Hanon and three-by-three scale-drill requirements; `exerciseBank`/`exerciseCatalog` define Piano exercise identity/levels; `assessmentRecord` defines Piano persisted criterion vocabulary. These belong to Piano portable contracts despite serving browser and server. Preserve IDs, criterion vectors and absent-field semantics.
- Pure pitch, duration, engraving, MusicXML/MIDI transforms and reusable renderers are notation capability candidates. Exact file-level decisions still required for remaining music helpers.
- Current MusicNotation renderers import Piano `staff-styles.mjs`. A public facade alone does not remove the reverse product dependency. Move genuinely shared style implementation with notation or inject product styling without duplicating it.
- Current M2 facade broadens CSS closure: baseline RimStaffRenderer/SvgStaffRenderer/SvgSequenceStaff imported ActionStaff only; StaffSkeleton imported tokens and Skeleton. The facade loads all three for every consumer, and StaffSkeleton imports it twice. Restore exact facets/closures and review CSS cascade before final certification.

## Verification implications

Keep the existing frontend Gaming architecture checks meaningful across new roots. Include game authorization/budget/reconciliation and runtime/effects tests, Piano ladder/rivalry tests, shared deterministic rule controls, notation resource/style checks and ordinary browser artifact evidence. No device connection, activation or changed persisted data is necessary for the ownership move.

## Applied ownership move, candidate verification pending

The [513-file manifest](2026-10-09-gaming-notation-owner-manifest.json) is applied.
Baseline evidence comprises 146 Vitest and 105 native Node assertions across
26 original suites. The Node fixture copy uses confined, checked bytes/mode
operations; this is not native metadata/copy parity.

The move applied 528 cached import/resource/style rewrites. Initial invariants
verified 152 byte-identical moves, 361 import-rewritten moves, and 517 unchanged
JavaScript bodies after masking import/resource literals. Two original CLI paths
now have guarded launchers with unchanged command bodies. Both architecture
suites follow their actual destination roots and reject missing declared roots.
An additional 34 shared-alias imports in 17 files were corrected after detecting
backend/shared symlink resolution differences. A canonical-path static import
check traversed 5,677 reachable files with no missing local targets.

Public contract closure, notation token/style separation, candidate behavior,
artifact validation and the complete milestone-3 gates remain outstanding.

### Notation stylesheet ownership correction

Nine shared token declarations now live in notation's `styles/tokens.scss`.
Static comparison preserves all 35 original declarations across shared and Piano
styles with no duplicate declaration ownership. Three narrow notation style
entries restore action-only and skeleton-plus-token dependencies. Piano loads
shared tokens through the same ESM entry before its own remaining tokens; it does
not compile another copy through Sass. All five Piano JSX consumers now use that
entry. The ExerciseRun measurement fixture follows actual owned styles and
correctly distinguishes repository and frontend roots.

Production notation source has no reverse Piano imports in the source import
scan. The two suites that build/edit actual Piano Composer models now live with
Composer; every assertion remains intact and only import paths changed. The
tracked ownership manifest follows those final destinations.
Runtime, compiled CSS, and rendered measurements have not yet certified this
change.


### Product policy and installed assembly closure

Diagnostic sessions and authored definitions now live with Party Games, including
their original tests. Their actual consumers are Party Games composition and
catalogue assembly; the implementations contain Party Games session setup and
charades clue-bank policy. The public media service, repository, port, and tests
also follow Party Games because they expose its pinned clue-image/archive API.
These nine ownership corrections preserve class/test bodies outside imports; the
513-file manifest records their final destinations. No reverse product imports
remain in the Gaming server capability source scan.

The shared session-runtime factory constructs snapshots, journal, runtime, IDs,
and coordinator in the original order. Party Games supplies the same ordered
eight rulesets and identity provider; there is still one runtime/coordinator/store
authority. Three Party Games factories now own installed catalogue/printer,
session/assets, and HTTP construction. The generic presentation catalogue stays
in its original installed position between the last two phases. The actual Party
Games configuration projection moved intact; other projections were retained.

Static checks preserve the nine moved bodies, all three installed construction
blocks, and the projection, with no introduced unbound identifiers or missing
relative imports. These changes await candidate verification. The prior
relocation checkpoint passed 146 Vitest and 105 Node cases (`gaming-notation-SIs0ll`
and `gaming-notation-node-MkuD0p`); those results predate this final policy wiring.

### Portable product policy correction

Chess now owns the unchanged ladder/progression implementation, its original
suite, and the `gaming/log/chess` path contract under `modules/chess/portable`.
Piano consumes that same Chess policy rather than copying its promotion rules.
Checkers and Connect Four default opponent names, artwork URLs, dialogue profiles,
and ordered depth values now live under Piano's `portable/game-opponents`.
The shared Gaming opponent modules retain the original search algorithms; they
no longer own Piano's roster declarations. The existing Connect Four suite that
uses those roster depths follows Piano with its assertions unchanged.

Two Piano stylesheet consumers now use notation's existing narrow style entries.
Prepared-and-applied static verification preserves 25 non-import source/test
bodies, both extracted roster declarations, and 251 relative imports. The four
physical moves are recorded in the original 513-file ownership manifest. Exact
public entry registration and runtime verification of this correction are pending.

Before this correction, the Gaming assembly candidate passed 163 cases: the 146
original named cases plus 17 existing supplemental cases. Its corrected receipt
(`gaming-notation-qqD5Cm/receipt.corrected.json`) preserves the original receipt
and raw-result hashes; the correction fixes the expected supplemental count,
not an assertion or execution result. This evidence does not certify the later
portable ownership changes described above.
