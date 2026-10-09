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
