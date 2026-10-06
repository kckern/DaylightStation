# Sheet Music Learn Recovery Design

## Outcome

Sheet Music Learn must behave like a learner-controlled practice workstation. A child always chooses what to play, can stop or restart without penalty, can make the exercise easier, and can understand every recorded note after it passes.

## Entry and configuration

- Every segment entry, including a deep link containing `learnRung`, lands on the segment launchpad. A URL may preselect or emphasize a drill but may not auto-start it.
- Every unlocked rung remains selectable after completion. Achievement progress never regresses.
- Custom practice keeps the complete matrix the score supports: right hand, left hand, or together; No beat, Keep a beat, or Play on time; and tempo stages for beat modes.
- Add **Extra slow** at 15%. Both Keep a beat and Play on time accept it end-to-end, including configuration clamps and displayed effective BPM.
- Returning through **Change practice** preserves the last hands, beat, and tempo selections for that segment visit.
- Changing tempo during a run cleanly restarts only the current take at the new speed, preserving earned reps and preventing mixed-speed scoring.

## Run controls

The Learn Lab toolbar permanently exposes three touch targets of at least 64px:

- **Pause** freezes the authoritative exercise runtime: attempt time, MIDI observations, timing/miss windows, stall timeout, count-in, and metronome click. Paused notes are ignored. The notation and current verdict record remain visible.
- **Resume** uses a visible short count-in and then resumes from the same musical/runtime position. It never grades notes played during the resume count-in.
- **Start over** aborts only the current take, resets its clock, count-in, cursor, tally, and visual verdicts, and preserves all previously earned reps.
- **Change practice** aborts the current take and returns to the same segment launchpad with its configuration selections preserved. It never records a failed attempt merely because the learner changed configuration.

The existing Back action remains a route to the segment launchpad. No control silently advances to a new drill.

## Feedback

The engraved score retains a durable verdict on every adjudicated past note:

- green check/color: right;
- red cross/color: wrong pitch;
- amber left/right marker: early or late;
- gray missed marker: unplayed/missed.

Color is redundant, not the only signal. The run shows a compact live tally labeled **Right**, **Wrong**, and, only when timing is graded, **Early**, **Late**, and **Missed**.

Wrong-pitch attempts remain represented in the tally and result even when there is no corresponding engraved notehead to mark. Engraved notes, tally, result summary, and telemetry totals all project the same existing engine records.

Keep a beat remains pitch practice accompanied by a click. It receives persistent Right/Wrong pitch history but must not invent early/late timing judgments. Play on time uses the timed judge and displays the full timing verdict set. Both projections feed the existing `ScorePassage` renderer; there is no second grading engine.

## Telemetry

Structured events carry learner/session context and the selected segment, source, parts, beat mode, and tempo:

- `score.learn.launch`
- `score.learn.pause` / `score.learn.resume`
- `score.learn.restart`
- `score.learn.change-practice`
- `score.learn.tempo-change`
- the terminal assessment, including Right/Wrong/Early/Late/Missed totals and whether the take was completed or learner-aborted.

Pause, restart, and change-practice events are observable even when no attempt is persisted. Raw MIDI is not logged.
Every event includes a run ID and client build where available; launch and terminal records also include score ID and revision, effective BPM, and earned-credit outcome. Chooser entry and reasoned learner abandonment are logged. A compact per-note verdict sequence may be logged at debug level, without raw MIDI velocities or arbitrary input history.

## Architecture

Retain `ExerciseRun` and its assessment runtime as the single grading authority. Add explicit runtime pause/resume control and read-only verdict/tally projections. `LearnLab` owns learner controls and remounts a fresh take on restart. `ScorePlayer` owns the launchpad return state and selection persistence. `ScorePassage` continues to paint verdicts supplied by the runtime projections.

## Acceptance

- At 1280×800, launchpad choices, all three run controls, notation, tally, and result actions are visible without clipping.
- A segment/deep link never starts a drill without a deliberate press.
- Pause truly stops grading and click playback; resume count-in notes are ignored.
- Restart and Change practice do not consume or erase credit.
- Both-hands/no-beat and right-hand/metronome/15% are launchable.
- Past-note symbols and tally agree with recorded evidence.
- Tests cover model, component, runtime clock control, notation projection, ScorePlayer integration, telemetry, and production build.
- Build and deploy through the existing safety gate, then verify both `/build.txt` and the kiosk client's logged build. If the kiosk is occupied, retain a clearly identified pending deployment and do not claim the live-delivery problem is solved.
