# Piano cap persistence and agenda extra-credit badges

**Date:** 2026-09-03
**Status:** implemented and verified in `feat/piano-cap-agenda-overflow`
**Starting point:** isolated worktree fast-forwarded to the current deployed `homeserver/main` at `58af0d6bbd`; the dirty primary worktree remained untouched apart from this plan.

## Outcome

Ship the piano cap and the status-board correction as one coherent change:

1. A valid piano enrollment `videosLockedAfter` value survives Teacher Console / `SetAssignments` validation and save.
2. `AgendaStatusBoard` continues to draw one circle per actual assignment, including two circles when two different assignments share a subject.
3. Multiple completed items credited to one assignment fill that assignment's circle once. Further distinct completions appear as a `+N` badge on that circle instead of creating more circles.
4. Extra completions remain visible and continue to count in their underlying course/program progress, but they do not enlarge the day's assigned-work denominator.

The concrete acceptance example is Alan's current piano day: one assigned piano-course slot and eight credited lessons renders one completed Arts circle with `+7`, not eight Arts circles. The daily cap remains two; today's already-recorded work is not rewritten.

## Confirmed bugs and current contracts

- `validatePianoCourseEnrollment` rebuilds the normalized enrollment without `videosLockedAfter`. Any later Teacher Console save can therefore silently remove an otherwise valid cap.
- The piano lesson gate already treats only a positive integer as a cap. Missing, zero, negative, fractional, and string values mean “no cap.” The validator fix must preserve that contract rather than introduce a second interpretation.
- `agendaStatusModel.summarize` currently treats every distinct `servedWork.unitId` as a new circle. Piano emits every lesson credited on the study day, so surplus lessons inflate both the visual circle count and `total`.
- `servedWork` currently identifies the completed lesson but not the assignment/program enrollment that owns it. The frontend cannot reliably group two program enrollments in the same subject without that provenance.

## Display semantics

The board will use these definitions consistently:

- An **assignment circle** is an issued work session, a still-offered `section.next`, or an assigned program entry represented by its stable synthetic unit ID.
- A repeated subject is not a duplicate. Two distinct assignment anchors under Civilization still produce two globe circles.
- A program's first distinct completed work item fulfills its assignment circle. Each additional distinct completed item owned by the same anchor increments that circle's `extraCount`.
- Retries and duplicate evidence for the same completed unit do not increment `extraCount`.
- Pending or failed unassigned work is not “extra completed” and does not receive a badge.
- `summary.total`, `summary.done`, the `N of M` readout, and the card's complete state use assignment circles only. Extra completion count is additive presentation metadata, not another assignment.
- A program completion must carry an assignment anchor. Do not guess ownership from subject alone; that would mix two same-subject program enrollments.
- Existing session-backed “one more?” worksheets remain circles because issuing a work session made them concrete assignments. This change specifically collapses multiple completion records owned by one assignment anchor; it does not hide work that is already in a child's hands.

## Implementation plan

### 1. Preserve the daily cap at the assignment write boundary

Files:

- `backend/src/3_applications/school/SchoolProgramEnrollmentValidators.mjs`
- `backend/src/3_applications/school/SchoolProgramEnrollmentValidators.test.mjs`

Change `validatePianoCourseEnrollment` to copy `videosLockedAfter` into its normalized enrollment only when it is a positive integer. Leave it absent otherwise. Preserve the existing `courseId`/`corpusId`, subject, title, and schedule normalization.

Add regression coverage for:

- `videosLockedAfter: 2` surviving normalization alongside a schedule;
- an absent cap staying absent;
- `0`, a negative number, a fraction, and a numeric string being omitted, matching `GetPianoLessonGate`;
- the normalized object being the object that `SetAssignments` writes. If the validator test cannot exercise that seam directly, add a focused `SetAssignments` test with a fake assignment store rather than broad router coverage.

### 2. Add assignment ownership to agenda `servedWork`

Files:

- `backend/src/2_domains/school/agenda.mjs`
- `backend/src/2_domains/school/agenda.test.mjs`
- `backend/src/3_applications/school/ports/IProgramLauncher.mjs` for the documented projection shape, if its contract comment needs the field described

Add an additive `assignmentUnitId` to each served-work projection:

- ordinary passed curriculum work uses its own `entry.unitId`;
- program work uses the synthetic unit ID of the exact program entry whose status produced it.

Build program `servedWork` by iterating the program entries and looking up each entry's status, rather than flattening the already-detached `statuses` array. This retains the program-instance association and prevents same-subject or same-program instances from being mixed.

Keep `unitId` as the actual completed work identity. The intended shape is conceptually:

```js
{
  unitId: 'plex:lesson-42',
  assignmentUnitId: 'piano-course:plex:course-1',
  title: 'Lesson 42',
}
```

This is an additive API change; existing consumers can continue reading `unitId` and `title`.

Tests must cover ordinary curriculum provenance, a piano/program completion whose actual unit differs from its assignment anchor, and two program entries under one subject retaining separate anchors.

### 3. Project circles first, then attach completion overflow

Files:

- `frontend/src/modules/School/status/agendaStatusModel.js`
- `frontend/src/modules/School/status/AgendaStatusBoard.test.jsx`

Refactor `summarize` around assignment anchors:

1. Collapse retries by actual session `unitId`, preserving the existing “passed wins” state rule.
2. Seed session-backed assignment circles as today does.
3. Group `section.servedWork` by `assignmentUnitId ?? unitId` and deduplicate actual completed `unitId`s within each group.
4. If evidence already owns the same actual unit, keep the evidence-derived state; `servedWork` must not paint an open or failed sheet green.
5. For a program anchor with completed served work, create or fulfill exactly one passed circle at the anchor and set `extraCount` to `max(0, distinctCompletedWorkIds - 1)`.
6. Merge `section.next` by its own unit ID so an unstarted assignment remains pending or in progress without duplicating an already-fulfilled anchor.
7. Compute `total` and `done` from the resulting base segments only. Optionally expose a summary-level `extraCompleted` sum for diagnostics, but do not include it in day completion math.

Preserve the current behavior for suppressed subjects, excused offers, structured program obligation progress, fallback subject labels/icons, and evidence priority.

Model regressions:

- one piano assignment plus eight distinct served lessons produces `{ total: 1, done: 1 }`, one segment, and `extraCount: 7`;
- two distinct same-subject assignments still produce two circles;
- two same-subject program anchors receive independent counts;
- duplicate served-work rows and repeated session attempts do not inflate the badge;
- served work matching an open session does not override its pending/needs-retry state;
- zero or one distinct completion has no overflow badge;
- Story Time's one structured daily obligation still moves pending → in progress → passed without an extra badge;
- excused and suppressed sections remain absent.

### 4. Render and style the badge accessibly

Files:

- `frontend/src/modules/School/status/AgendaStatusBoard.jsx`
- `frontend/src/modules/School/School.scss`
- `frontend/src/modules/School/status/AgendaStatusBoard.test.jsx`

Render a compact `+N` only when `segment.extraCount > 0`. Position it on the upper edge of the relevant circle without adding a flex item or changing `--count`; overflow must not shrink the other circles or cause a new wrap.

Keep a single accessible announcement for the circle, for example `Arts: done, 7 extra completed`. Mark the visual badge hidden from assistive technology if that count is folded into the circle/icon label. Use plural-safe generic wording because the same component can represent lessons, worksheets, or another program's work.

The badge should use high contrast, tabular numerals, and no animation. Preserve the board's settled no-motion rule.

Rendering regressions:

- `+7` appears once for the eight-lesson example;
- the accessible name includes the overflow count once;
- no badge node exists when `extraCount` is zero;
- the DOM circle count and CSS `--count` remain the assigned count.

### 5. Update the written contract and stale comments

Files:

- `docs/reference/school/programs.md`
- `docs/reference/school/README.md`
- comments in `GetPianoLessonGate.mjs`, its tests, `agenda.mjs`, and `agendaStatusModel.js`

Replace the now-stale statement that the board draws one circle per finished piano lesson. Document that the launcher may report every credited lesson, the agenda attaches them to the assigned program anchor, and the board renders one assigned circle plus an overflow badge.

Also document that `videosLockedAfter` is preserved by assignment normalization and remains optional/off unless it is a positive integer.

## Verification

Run the focused suites from the isolated worktree:

```bash
npx vitest run \
  backend/src/3_applications/school/SchoolProgramEnrollmentValidators.test.mjs \
  backend/src/2_domains/school/agenda.test.mjs \
  frontend/src/modules/School/status/AgendaStatusBoard.test.jsx

npx vitest run \
  backend/src/3_applications/school/usecases/GetPianoLessonGate.test.mjs \
  backend/src/4_api/v1/routers/schoolLifecycle.piano-lesson-gate.test.mjs \
  frontend/src/modules/Piano/PianoKiosk/PianoMenu.cap.test.jsx \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.cap.test.jsx

git diff --check
```

Do not start the backend for verification; it has live household side effects. If an existing frontend stack is available, visually inspect at the Portal's 1280×800 target:

- one completed Arts circle with `+7`;
- two same-subject assignment circles remaining separate;
- badge legibility with the largest realistic count and no overlap/wrap.

Before rollout, read back Alan's stored enrollment and confirm `videosLockedAfter: 2` is still present. After rollout, make one no-op Teacher Console assignment save and verify the cap remains in storage and the lesson-gate response still reports `cap: 2`. Do not alter or delete today's eight historical completion records.

## Suggested commit sequence

1. `fix(school): preserve piano video cap on assignment saves`
2. `feat(school): attach served work to assignment anchors`
3. `feat(school): badge extra completions on agenda circles`

Keep them in one branch and deploy backend provenance before or with the frontend projection. Deploying the backend first is compatible with the current frontend because the new field is additive.

## Out of scope

- Changing the two-lesson threshold or applying caps to other piano enrollments.
- Rewriting or deleting already-recorded completion history.
- Changing the current Videos menu/grid/course redirect behavior.
- Closing the separate timing window in which the final lesson reaches 90%, the progress heartbeat records it, and the 15-second gate poll catches up.
- Deduplicating circles by subject.
- Hiding or truncating the underlying `servedWork` data; only its board projection becomes compact.
