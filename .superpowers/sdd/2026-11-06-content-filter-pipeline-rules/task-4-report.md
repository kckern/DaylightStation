# Task 4 report: refine is safe to re-run (R7)

Built: buildRefinedEdl now carries previous's top-level keys (scenes, sceneCalibration, unknown keys, timebase extras, certification.parent via certify), keeps previous refined cues that this run did not re-measure, and with `partial` unions anchors. CLI already loaded `previous` from the refined path before building (verified); it now passes `partial`. mergeRefine already preserved sceneOverrides/profilePatch/cards/unmeasured cues; tests added to lock it (no code change needed). CLI writes override only as the mergeRefine output round-trip.

Files: refine/refinedEdl.mjs, refinedEdl.test.mjs, refineOutput.test.mjs, cli/contentfilter/refineCommand.mjs, __docs/reference/core/content-filter.md.

Decisions: refinedCount now counts cues with a refine stamp (includes kept-from-previous). Previous refined cue wins over an override lacking a refine stamp.

RED: 4 of 15 new buildRefinedEdl tests failed before implementation (mergeRefine tests passed already). GREEN: content-filter + cli suites 27 files / 253 tests pass. No pre-existing failures seen.

## Fix round 1
1. Output now re-keyed in previous's key order (new keys last); tests assert Object.keys equality and yaml.dump(rebuilt) === yaml.dump(previous), with scenes before and after cues.
2. Carried keys are only those absent from the fresh head (plus scenes/sceneCalibration, which always come from previous); fresh title/runtimeUnalteredSec win. Test added.
Command: npx vitest run __app_modules/media/media/server/domain/content-filter --config tests/_infrastructure/config/vitest.config.mjs -> 13 files / 119 tests pass.
