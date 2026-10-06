# Sheet Music Learn: Score-to-Lab Design

## Purpose

Learn mode should feel like learning a piece of music, not navigating a generic exercise application. The full score is the learner's map. Selecting a segment should feel like plucking that music from the page, taking it into a focused practice lab, and then returning it to the score with newly earned progress.

Exercise runs remain the grading and repetition engine, but their implementation vocabulary must not dominate the experience.

## Experience Model

Learn has two distinct spaces:

1. **Score:** the complete piece, annotated with segment boundaries, recommendation, and mastery.
2. **Lab:** a focused practice surface containing only the selected segment.

The learner moves `score → lab → score`. The lab does not retain a faded full score or unrelated measures. Closing the lab returns to the same position in the score. Navigation uses a conventional close or back affordance, not product language such as “Return to roadmap.”

## Segments

Segments are numbered first. Their bar range is secondary:

- `Segment 1` / `Bars 1–5`
- `Segment 2 — Main Theme` / `Bars 6–10`

An optional authored name supplements the segment number; it does not replace the stable identity.

### Sources

Authored piece metadata may define:

- Stable segment ID
- Inclusive measure boundaries
- Musical name
- Recommended order
- Prerequisites
- Starting tempo progression
- Segment-specific ladder overrides

When no authored metadata exists, the balanced passage generator creates numbered segments. Invalid authored boundaries fall back to generated segments rather than disabling Learn mode.

Authored boundaries take precedence because musical phrases do not necessarily match a fixed bar count.

## Score Surface

The score is the canonical roadmap. Segment boundaries and state appear directly on the notation through restrained brackets, tabs, or overlays.

A compact passage rail may supplement the score when space permits. It provides quick navigation and progress without replacing the score-native controls. It collapses or disappears on constrained layouts.

Segment states are:

- **Unstarted:** numbered boundary only
- **Next:** gently emphasized recommendation
- **In progress:** partial achievement indicator
- **Mastered:** completed treatment
- **Tested out:** mastery with a distinct shortcut marker
- **Locked:** shown only when sequential navigation is configured

Every segment is selectable by default. One segment is recommended as Next. Strict sequential unlocking is an optional category, piece, user, or user-plus-piece setting.

Availability, recommendation, and mastery are independent concepts. “Unlocking” normally means earning mastery, not gaining permission to click.

## Lab Surface

The lab engraves only the selected segment. Measures outside the segment are absent rather than greyed out.

The notation prefers one system and must use no more than two. Forced system and page breaks inherited from the full score do not apply to the extracted segment. The lab may scale the excerpt within configured readability limits to meet the two-system constraint.

Part-specific practice changes the engraving itself:

- Right hand: show only the upper staff
- Left hand: show only the lower staff
- Together: show both staves
- Single-staff scores: omit inapplicable hand-specific rungs

The current rung, tempo, set, and repetition remain visible but subordinate to the notation.

Untimed work advances through correct musical input. Timed work adds a count-in, audible metronome, and clear moving timing cursor. The displayed feedback must come from the same assessment record used to grade the run.

## Default Learning Ladder

The default ladder is:

1. Right hand
2. Left hand
3. Hands together
4. Hands together with timing at one or more reduced tempo levels
5. Mastery with both hands at the MusicXML tempo map

Every rung is configuration-driven and may define:

- Applicable parts
- Free or cued mode
- Sets and repetitions
- Consecutive-pass requirements
- Accuracy and placement criteria
- Tempo percentage
- Automatic advancement behavior

Rungs that do not apply to the score disappear automatically.

### Test Out

Test Out is available by default. It uses both hands, the original MusicXML tempo map, and three consecutive successful repetitions by default. Passing it masters the segment without requiring intermediate rungs.

Sets, repetitions, availability, and pass criteria are configurable. The mastery tempo is not.

## Tempo Semantics

Mastery means performing at the tempo supplied by MusicXML.

For a score with tempo changes, mastery follows the complete tempo map. Intermediate tempo percentages scale every tempo entry proportionally. A 60% rung uses 60% of each encoded tempo; mastery and Test Out use 100%.

User, category, and piece configuration may control starting tempo, intermediate percentages, repetition counts, and the route toward mastery. They cannot redefine mastery as a slower personal target.

If MusicXML has no usable tempo, Learn uses a configurable fallback and identifies it as inferred. The resolved fallback becomes the score's explicit mastery target for that otherwise tempo-less document.

## Configuration Resolution

Configuration resolves in this order:

```text
built-in defaults
→ category
→ piece
→ user
→ user + piece
```

The result is one normalized Learn plan consumed by the UI and exercise engine. UI components do not contain piece-, category-, or user-specific conditionals.

Ownership remains explicit:

- MusicXML owns the mastery tempo map.
- Piece metadata owns authored musical boundaries.
- Category configuration supplies pedagogical defaults.
- User configuration supplies preferences and accommodations.
- User-plus-piece configuration stores targeted overrides and progress.

Curriculum configuration controls boundaries, rung order, target requirements, sets, repetitions, pass criteria, and sequential navigation. Learner configuration controls accommodations such as starting percentage, extra repetitions, preferred hand order, permitted speed controls, and automatic advancement.

## Progress Identity

Progress is keyed by:

- Score identity and revision
- Stable segment identity
- Ladder revision
- User identity

Material changes to segment boundaries or ladder meaning must not silently transfer completion to different music. Stable authored segment IDs may preserve progress through harmless metadata changes such as renaming a segment.

Guest progress may remain local, following the existing Learn persistence policy.

## Achievement Feedback

Passing a repetition updates compact set/rep feedback. Passing a rung produces a brief achievement moment and advances according to configuration. Mastering or testing out creates a distinct completion moment.

When the learner returns to the score, the affected segment animates its new state once. The treatment should make progress tangible without turning the notation into a dashboard or game board.

## Accessibility and Failure Behavior

- Segment controls must be keyboard- and touch-accessible even when visually attached to notation.
- State cannot rely on color alone.
- A close/back control remains available throughout the lab.
- Unengraveable excerpts fail back to the score with a clear message; they do not strand the learner.
- Empty or rest-only generated segments are omitted.
- Invalid enrichment degrades to generated segmentation.
- Runtime identity must remain stable across MIDI updates, resizing, and non-material parent rerenders so an active attempt is never reset beneath the learner.

## Verification

Automated coverage must establish:

- A selected segment engraves only its measures across every part.
- Required clef, key, time, divisions, staff, and tempo context survives extraction.
- Forced full-score page/system breaks are removed from excerpts.
- A segment uses one or at most two systems at supported kiosk sizes.
- RH and LH runs remove the inactive staff rather than merely dimming it.
- Together runs retain both staves.
- Timed percentage rungs scale the complete tempo map.
- Mastery and Test Out always use the unscaled MusicXML tempo map.
- MIDI/context rerenders do not recreate an active assessment runtime.
- Generated and authored segmentation resolve through the same normalized plan.
- Configuration precedence is deterministic.
- Progress invalidates on incompatible boundary or ladder changes.
- Closing the lab returns to the same score location and presents the earned state.

Real-browser measurement coverage is required for system count, staff removal, readable sizing, cursor placement, and score-to-lab transitions. Unit tests alone cannot prove engraved geometry.

## Migration

The existing Learn roadmap and ExerciseRun integration remain useful foundations but change presentation responsibilities:

- ExerciseRun remains the first-class training engine.
- The score surface becomes the primary roadmap instead of generic passage cards.
- The lab wraps ExerciseRun in score-native language and navigation.
- ScorePassage extracts and engraves only the selected segment.
- Part selection removes unused staves.
- Existing configuration gains normalized layered resolution rather than hardcoded per-screen decisions.

Legacy direct Learn behavior may remain behind its existing compatibility configuration while the score-to-lab experience becomes the default.
