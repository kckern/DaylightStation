# Media Lesson Checkpoints — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hard-gated video/audio lessons on the living-room TV — playback pauses at curriculum-authored checkpoints for retry-until-correct comprehension questions, with backend-owned per-learner state feeding completion.

**Architecture:** Three layers, per the validated design (`docs/_wip/plans/2026-08-27-media-lesson-checkpoints-design.md`, committed on main): (1) a generic gate layer in `lib/Player/gate/` promoted from the fitness governance pattern (N-ary `resolvePause`, `GateVerdict` contract, `useMediaGate` enforcement); (2) backend domain + session (pure `mediaCheckpoints.mjs`, durable progress store, in-memory session service, router); (3) School frontend (widget on the reading-session pattern, checkpoint quiz overlay, surround modules). Screen-framework gets one registry line; `contentFilter` is untouched.

**Tech stack:** Vitest (run directly — NEVER via `npm test --only=domain`, which mis-routes to Jest), React Testing Library, Express routers in `4_api/v1/routers/`, YAML stores in `1_adapters/persistence/yaml/`.

**Worktree:** `.worktrees/media-lesson-checkpoints`, branch `feature/media-lesson-checkpoints`. Baseline verified green (82 tests over the touched surfaces).

**Commit convention:** `feat(player): …` / `feat(school): …` — match `git log --oneline` style. Per-task commits are authorized on this isolated feature branch.

**Run tests as:** `npx vitest run <paths>` from the worktree root.

---

## Phase 1 — Gate layer (`lib/Player/gate/`)

### Task 1: Promote `pauseArbiter`, make it N-ary

> ✅ **DONE** — `b56d06038`, `0a4d16e61`, `9268020a7`. Spec-reviewed ✅ and
> quality-reviewed. **The code sketch below is the ORIGINAL, PRE-AMENDMENT spec, kept
> as a historical record — it is NOT the shipped contract and must not be copied.** It
> still shows `governanceAsGate` (deleted), `reason:` as the verdict's id field
> (renamed to `id`), and a `base` without `blocked` (the blocked/paused split came
> later). For the real contract, read `frontend/src/lib/Player/gate/pauseArbiter.js`
> and the "Standing rules" section at the end of this document.

**Files:**
- Move: `frontend/src/modules/Player/utils/pauseArbiter.js` → `frontend/src/lib/Player/gate/pauseArbiter.js` (use `git mv`)
- Move: `frontend/src/modules/Player/utils/pauseArbiter.test.js` → `frontend/src/lib/Player/gate/pauseArbiter.test.js`
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx:13` (import path), `:427-437` (call site)

**Read first:** both current files in full (they're short), and `FitnessPlayer.jsx:420-440`.

**Step 1: `git mv` both files** into `frontend/src/lib/Player/gate/`.

**Step 2: Write failing tests** appended to the moved test file:

```js
describe('gates array (GateVerdict composition)', () => {
  it('any blocked gate pauses, first blocked in array order wins the reason', () => {
    const r = resolvePause({ gates: [
      { blocked: false, reason: 'household', seekCeiling: null },
      { blocked: true, reason: 'checkpoint', seekCeiling: 312 },
      { blocked: true, reason: 'governance', seekCeiling: null },
    ] });
    expect(r).toEqual({ paused: true, reason: PAUSE_REASON.GATE, gate: 'checkpoint', seekCeiling: 312 });
  });
  it('seeking suppresses gate pause (anti-thrash rule unchanged)', () => {
    const r = resolvePause({ seeking: { active: true }, gates: [{ blocked: true, reason: 'checkpoint' }] });
    expect(r.paused).toBe(false);
    expect(r.reason).toBe(PAUSE_REASON.SEEKING);
  });
  it('seekCeiling composes as min of non-null ceilings, even with no gate blocked', () => {
    const r = resolvePause({ gates: [
      { blocked: false, reason: 'a', seekCeiling: 500 },
      { blocked: false, reason: 'b', seekCeiling: 312 },
      { blocked: false, reason: 'c', seekCeiling: null },
    ] });
    expect(r.paused).toBe(false);
    expect(r.seekCeiling).toBe(312);
  });
  it('legacy governance slot still maps to a gate (alias)', () => {
    const r = resolvePause({ governance: { locked: true } });
    expect(r).toMatchObject({ paused: true, reason: PAUSE_REASON.GATE, gate: 'governance' });
  });
  it('no gates, no ceiling: seekCeiling is null and result shape is stable', () => {
    expect(resolvePause({})).toEqual({ paused: false, reason: PAUSE_REASON.PLAYING, gate: null, seekCeiling: null });
  });
});
```

Adjust the *existing* tests: any assertion on `PAUSE_REASON.GOVERNANCE` becomes `PAUSE_REASON.GATE` + `gate: 'governance'`.

**Step 3: Run** `npx vitest run frontend/src/lib/Player/gate/pauseArbiter.test.js` — expect the new describe block to FAIL (`gates` unhandled, `GATE` undefined).

**Step 4: Implement.** Replace the moved `pauseArbiter.js` body with:

```js
/**
 * @typedef {object} GateVerdict
 * @property {boolean} blocked          playback may not proceed
 * @property {string}  reason           stable id for logs ('checkpoint', 'governance', …)
 * @property {number|null} [seekCeiling] furthest seekable position (s); null/absent = unclamped
 */
export const PAUSE_REASON = Object.freeze({
  SEEKING: 'SEEKING',
  GATE: 'PAUSED_GATE',
  BUFFERING: 'PAUSED_BUFFERING',
  USER: 'PAUSED_USER',
  PLAYING: 'PLAYING',
});

const truthy = (v) => Boolean(v);

/** Legacy alias: a `governance` slot becomes one gate named 'governance'. */
const governanceAsGate = (governance = {}) => ({
  blocked: truthy(governance.blocked ?? governance.paused ?? governance.locked ?? governance.videoLocked),
  reason: 'governance',
  seekCeiling: null,
});

export const resolvePause = ({ seeking = {}, gates = [], governance = null, resilience = {}, user = {} } = {}) => {
  const allGates = governance ? [...gates, governanceAsGate(governance)] : gates;
  // A ceiling is a standing rule, not a pause side-effect: composed regardless of blocked.
  const seekCeiling = allGates.reduce(
    (min, g) => (Number.isFinite(g?.seekCeiling) ? (min == null ? g.seekCeiling : Math.min(min, g.seekCeiling)) : min),
    null,
  );
  const base = { gate: null, seekCeiling };

  // Seeking is highest priority — suppress all pause while mid-seek to prevent
  // pause/resume thrashing from gate events during seeks (fitness lesson learned).
  if (truthy(seeking.active)) return { paused: false, reason: PAUSE_REASON.SEEKING, ...base };

  const blockedGate = allGates.find((g) => truthy(g?.blocked));
  if (blockedGate) return { paused: true, reason: PAUSE_REASON.GATE, gate: blockedGate.reason ?? 'gate', seekCeiling };

  // resilience.stalled deliberately NOT included — stall triggers reload, not pause.
  if (truthy(resilience.requiresPause ?? resilience.buffering ?? resilience.waiting)) {
    return { paused: true, reason: PAUSE_REASON.BUFFERING, ...base };
  }
  if (truthy(user.paused ?? user.pauseIntent === 'user')) return { paused: true, reason: PAUSE_REASON.USER, ...base };
  return { paused: false, reason: PAUSE_REASON.PLAYING, ...base };
};

export default resolvePause;
```

**Step 5: Migrate FitnessPlayer.** In `FitnessPlayer.jsx`: import from `'@/lib/Player/gate/pauseArbiter.js'`; change the call site to pass a gates array (keeps its telemetry id):

```js
const pauseDecision = useMemo(() => resolvePause({
  seeking: { active: isSeeking },
  gates: [{ blocked: Boolean(effectiveGovernanceState?.videoLocked), reason: 'governance', seekCeiling: null }],
  resilience: { stalled: resilienceState?.stalled, waiting: resilienceState?.waitingToPlay },
  user: { paused: isPaused },
}), [isSeeking, effectiveGovernanceState?.videoLocked, resilienceState?.stalled, resilienceState?.waitingToPlay, isPaused]);

const governancePaused = pauseDecision.reason === PAUSE_REASON.GATE && pauseDecision.gate === 'governance' && pauseDecision.paused;
```

Then `grep -rn "modules/Player/utils/pauseArbiter" frontend/src` — must return nothing.

**Step 6: Run** the arbiter suite + the fitness guard: `npx vitest run frontend/src/lib/Player/gate/ frontend/src/modules/Fitness/player/` — all pass.

**Step 7: Commit** `feat(player): promote pauseArbiter to lib/Player/gate, N-ary GateVerdict composition`

### Task 2: `mediaGate.js` — framework-free enforcement core

**Files:**
- Create: `frontend/src/lib/Player/gate/mediaGate.js`
- Test: `frontend/src/lib/Player/gate/mediaGate.test.js`

**Read first:** `frontend/src/lib/Player/useMediaClock.js:1-120` — copy its style: framework-free factory, injected `getMediaEl`, lazy module logger (CLAUDE.md "Module-Level Loggers"), never throws outward.

> **AMENDED after Task 1's code review.** `resolvePause` now returns
> `{ blocked, paused, reason, gate, seekCeiling }`, where **`blocked` is the standing
> fact ("a gate says no") and `paused` is the instruction ("act on it now")**. They
> differ during a seek: pause is suppressed to prevent thrash, but a checkpoint may
> still be blocking. **Resume MUST be conditioned on `!blocked`, never on
> `paused === false` alone** — the original wording of this task said
> `apply({paused:false}) → el.play()`, which would have called `play()` mid-seek on a
> gated lesson and then re-paused on seek end: the very thrash the seeking rule exists
> to prevent, reintroduced from the other side.

**Step 1: Failing tests** against a fake element (`{ paused, currentTime, play: vi.fn(), pause: vi.fn(), addEventListener, removeEventListener, dispatchEvent }` — a tiny EventTarget-ish stub is fine):

```js
import { createMediaGate } from './mediaGate.js';
// - apply({blocked:true, paused:true, gate:'checkpoint'}) on a playing element
//   → el.pause() called once
// - apply({blocked:false, paused:false}) on an element the gate itself paused
//   → el.play() called; but NEVER auto-plays an element the gate did not pause
//   (user-paused stays paused)
// - MID-SEEK, STILL BLOCKED: apply({blocked:true, paused:false, reason:'SEEKING',
//   gate:'checkpoint'}) → el.play() is NOT called. This is the regression the
//   amendment above exists to prevent; assert it explicitly.
// - a 'seeking' event with currentTime > effective ceiling → currentTime snapped
//   back to ceiling; a seek below ceiling untouched
// - ceiling null → no clamping listener behavior
// - detach() removes listeners; subsequent seeks unclamped
// - transitions logged: gate.blocked / gate.released / gate.seek-clamped (spy on logger)
```

**Step 2: Run to verify FAIL** (`createMediaGate` not defined).

**Step 3: Implement** `createMediaGate({ getMediaEl, logger })` returning `{ apply(decision), detach() }`:
- `apply` receives a full `resolvePause` result. Tracks `#gatePausedByUs` so release only resumes what the gate itself paused (the user-pause invariant above).
- Seek clamp: listen to `seeking` on the element; if `el.currentTime > ceiling + 0.25` set `el.currentTime = ceiling` and log `gate.seek-clamped { gate, from, ceiling }` via `logger.sampled` (maxPerMinute 10 — a held FF button must not flood).
- Re-resolve the element via `getMediaEl()` on every `apply` (late mount / element swap, same reason `useMediaClock` does).
- All logging uses the structured framework (`app: 'player', component: 'media-gate'`). **No raw console.**

**Step 4: Run — pass.**

**Step 4b: Harden the arbiter's remaining slots.** Task 1 added `Array.isArray(gates) ? gates : []` but left `seeking`, `resilience`, and `user` undefaulted against `null` — they only default on `undefined`, so `resolvePause({ seeking: null })` throws at the `seeking.active` read. THIS task is the one that starts passing all three from a hook (`useMediaGate` forwards `player: { seeking, resilience, user }`, any of which can be null before its source resolves), so harden them here rather than discovering it in a kiosk: normalize each to `{}` the same way, and add one test per slot asserting `null` yields the stable PLAYING shape.

**Step 5: Commit** `feat(player): mediaGate enforcement core (pause + seek clamp)`

### Task 3: `useMediaGate` hook + `GateVerdictContext`

**Files:**
- Create: `frontend/src/lib/Player/gate/useMediaGate.js`, `frontend/src/lib/Player/gate/GateVerdictContext.jsx`
- Test: `frontend/src/lib/Player/gate/useMediaGate.test.jsx`

> **REQUIRED, from Task 2's spec review.** `useMediaGate` MUST feed the element's own
> DOM `pause`/`play` events into the `user` slot it passes to `resolvePause`. This is
> not optional wiring: `mediaGate` deliberately keeps pause ownership after a rejected
> `play()` so it can retry (the garage kiosk's Firefox blocks audible autoplay), and
> the reviewer probe-confirmed the consequence — gate pauses → resume rejects → the
> human presses pause → the next apply carrying a PLAYING decision calls `play()` again
> and overrides them. The gate declines correctly ONCE the pause reaches the arbiter's
> `user` slot (also probe-confirmed), so this hook is the only thing standing between
> the retry and a viewer fighting their own pause button. Test it explicitly: a DOM
> pause during a gate-owned retry must produce `PAUSED_USER` and no further `play()`.

**Step 1: Failing tests** (RTL `renderHook`):
- `useMediaGate({ getMediaEl, verdicts, player: { seeking, resilience, user } })` calls `resolvePause` with merged verdicts and applies via a `createMediaGate` instance (mock the module); re-applies when verdicts change; detaches on unmount.
- A DOM `pause` event on the element flows into the `user` slot (see the requirement above).
- `GateVerdictProvider` + `useContributedVerdicts()`: a provider ancestor contributes verdicts; nesting providers concatenates outer-first (household outranks lesson — outer contributions come first in the merged array). No provider → `[]`, never throws.

**Step 2: FAIL. Step 3: Implement** (~30 lines each): context holds a stable array via `useMemo`; `useMediaGate` merges `[...useContributedVerdicts(), ...verdicts]`, memoizes the `resolvePause` result, and drives one `createMediaGate` instance in a `useEffect`.

**Step 4: pass. Step 5: Commit** `feat(player): useMediaGate hook + GateVerdictContext for cross-tree governors`

---

## Phase 2 — Backend domain

### Task 4: `mediaCheckpoints.mjs` — pure checkpoint math + validation

**Files:**
- Create: `backend/src/2_domains/school/mediaCheckpoints.mjs`
- Test: `backend/src/2_domains/school/mediaCheckpoints.test.mjs`

**Read first:** `backend/src/2_domains/school/storyTime.mjs` (style: header comment stating the WHY, `{errors, ...}` validator shape, no clock, no I/O) and its test file.

**Step 1: Failing tests:**

```js
import { validateCheckpoints, dueCheckpoint, seekCeilingFor, clearedSetFrom } from './mediaCheckpoints.mjs';
// validateCheckpoints(raw, { bankItemIds }) → { errors, checkpoints? }
// - not an array / empty array → error
// - each entry: integer at >= 1; non-empty items array of strings
// - strictly ascending `at` (equal or descending → error naming both indexes)
// - items resolve against bankItemIds WHEN the set is provided; shape-only when
//   absent (the PRINT_DOCUMENT_REF precedent: domain has no repository)
// - normalized checkpoints get stable ids: `cp-<at>` (deterministic, no clock)
// dueCheckpoint(position, checkpoints, clearedIds:Set) → first checkpoint with
//   at <= position and id not in clearedIds, else null (THE gate predicate)
// seekCeilingFor(checkpoints, clearedIds) → `at` of first uncleared checkpoint,
//   else null (all cleared = unclamped)
// - position exactly at boundary: at <= position fires (312 fires at 312.0)
```

**Step 2: FAIL. Step 3: Implement** (small — under 80 lines, comment-dense per house style). **Step 4: pass.**

**Step 5: Commit** `feat(school): mediaCheckpoints domain — validation, due-gate, seek ceiling`

### Task 5: `unitValidation.mjs` — accept the `checkpoints:` block

**Files:**
- Modify: `backend/src/2_domains/school/curriculum/unitValidation.mjs` (composition rules ~line 260-365, normalized output ~line 400)
- Test: extend `backend/src/2_domains/school/curriculum/unitValidation.test.mjs`

**Read first:** `unitValidation.mjs` in full; note `RESOLVABLE_REFS`, the exclusive-fields pattern, and where `references` lands on the normalized unit.

**Step 1: Failing tests:** a unit with `media + bank + checkpoints` validates clean and carries normalized `checkpoints`; `checkpoints` without `media` → error `'checkpoints requires media'`; without `bank` → `'checkpoints requires bank'`; invalid inner block surfaces `mediaCheckpoints`' errors prefixed `checkpoints: `; item existence checked when the caller injects `sets.bankItems` (a `Map<bankId, Set<itemId>>`), shape-only otherwise.

**Step 2: FAIL. Step 3: Implement:** import `validateCheckpoints`; in the composition section add the requires-media/bank guards, delegate the block, spread normalized `checkpoints` onto the returned unit. Follow the existing one-error-per-field message style.

**Step 4:** `npx vitest run backend/src/2_domains/school/curriculum/unitValidation.test.mjs` — all pass **including every pre-existing test** (the block is optional; nothing regresses).

**Step 5: Commit** `feat(school): curriculum units accept checkpoints block (publish-time resolution)`

---

## Phase 3 — Backend application + API

> **REVISED 2026-08-27, mid-execution.** The original Phase 3 (in git history) built a
> parallel in-memory `MediaLessonSessionService` plus a new YAML progress store. That was
> wrong: an event-sourced media-session lifecycle **already exists** and is wired.
> Discovered during Task 10's investigation step:
>
> - `2_domains/school/sessions/sessionEvents.mjs` — durable event-sourced work sessions:
>   `created → media_dispatched → media_completed | media_stalled`, with a closed
>   `TRANSITIONS` table, a `SCHEMA` field whitelist, and `ANNOTATION_EVENTS` (facts that
>   record without advancing state).
> - `3_applications/school/usecases/DispatchMedia.mjs` — resolves unit → manifest →
>   locator, target autonomy via `child_selectable`, idempotent (refuses a second dispatch
>   mid-play), appends `media_dispatched`.
> - `3_applications/school/usecases/RecordMediaCompletion.mjs` — the other end:
>   `verified: 'playhead'|'duration'`, **"only completion releases the linked quiz or
>   form"**, stall → `media_stalled`.
> - Both are wired in `5_composition/modules/schoolLifecycle.mjs:863-872`, called by
>   `ResolveScanAction` / `RunSelfServiceAction`.
> - **The gap that is genuinely missing:** the real playback adapter. Composition says
>   `playbackAdapter = null` — "null until §8 lands" (`schoolLifecycle.mjs:153`), and only
>   `VirtualPlaybackAdapter` exists. That gap is Task 10.
>
> So checkpoints EXTEND that lifecycle rather than duplicating it: a `checkpoint_cleared`
> annotation event is durable evidence for free, reporting already reads the stream, and
> the "media gates the linked quiz" concept already exists at unit granularity — ours is
> the finer-grained version mid-content. This is the DRY call the user asked for, applied
> to the backend as well as the gate layer. **The separate progress store is deleted from
> the plan.**

### Task 6: `checkpoint_cleared` annotation event (domain)

**Files:**
- Modify: `backend/src/2_domains/school/sessions/sessionEvents.mjs` (`SCHEMA` ~line 130 beside `media_dispatched`; `ANNOTATION_EVENTS` ~line 308; the `APPLY` reducer ~line 526)
- Test: extend `backend/src/2_domains/school/sessions/sessionEvents.test.mjs` (find it; if absent, the nearest existing session-events test)

**Read first:** `sessionEvents.mjs` lines 90-145 (SCHEMA entries and their `fields` whitelist + `validate` helpers), 275-325 (TRANSITIONS, ANNOTATION_EVENTS, TERMINAL_STATES derivation), and the `media_dispatched` reducer at ~526. Note the comment explaining that `fields` IS the whitelist — an undeclared field is silently dropped.

**Step 1: Failing tests:**
- `createEvent({ type: 'checkpoint_cleared', sessionId, at, checkpointId, attempts })` validates: `checkpointId` required non-empty string; `attempts` integer >= 1; unknown fields dropped by the whitelist.
- It is an ANNOTATION: legal while the session is `media_dispatched`, and **does not advance state** — `reduceSession` after it still reports `state === 'media_dispatched'`.
- `reduceSession` accumulates cleared checkpoints in order: state gains `clearedCheckpoints: [{ checkpointId, at, attempts }]`; a repeat of the same `checkpointId` does not duplicate the row (idempotent — the screen may retry a POST).
- It is NOT legal from `created` (nothing dispatched yet) — assert the rejection.

**Step 2: FAIL. Step 3: Implement** — SCHEMA entry + `ANNOTATION_EVENTS` membership + reducer case. Follow the existing comment style: state WHY it is an annotation (a cleared checkpoint is evidence inside an in-flight dispatch, not a lifecycle advance).

**Step 4: pass, including the whole pre-existing sessionEvents suite (this file is load-bearing for every school session — a regression here breaks paper, media and program paths alike).**

**Step 5: Commit** `feat(school): checkpoint_cleared session annotation event`

### Task 7: `RecordCheckpointAnswer` use case

**Files:**
- Create: `backend/src/3_applications/school/usecases/RecordCheckpointAnswer.mjs`
- Test: `tests/isolated/application/school/RecordCheckpointAnswer.test.mjs`

**Read first:** `DispatchMedia.mjs` in full (the neighbour this sits beside — same deps shape: `{ curriculum, sessions, clock, logger }`, same `reduceSession(await sessions.readEvents(id))` opening, same status-string return contract), `2_domains/school/grading.mjs` (`gradeAnswer`, `givenShapeError` — used UNCHANGED), and the new `mediaCheckpoints.mjs` from Task 4.

`execute({ sessionId, checkpointId, itemId, given })`:
- Reduce the session; refuse unless `state === 'media_dispatched'` (status `'not_playing'`).
- Resolve unit → `checkpoints` → the named checkpoint; resolve its bank items via curriculum.
- `givenShapeError` first → `ValidationError`. Then `gradeAnswer(item, given)`.
- **Wrong answer: `{ correct: false, attempts }` and the item stays answerable** — retry-until-correct is THIS use case's policy (design D3). Do not import any one-shot claim logic from `SchoolService`; that is a different policy on the same grader, exactly as OMR is.
- Correct AND it was the checkpoint's last unanswered item → append `checkpoint_cleared` → `{ correct: true, checkpointCleared: true, seekCeiling }` (recomputed from `mediaCheckpoints.seekCeilingFor`).
- Attempts are counted per item **in memory for the life of the request chain** — the durable record is `attempts` on the `checkpoint_cleared` event. Do NOT add a second store.
- Returns the same `{ status, message, ... }` flavour its neighbours do.

TDD per the standing rules. **Commit** `feat(school): RecordCheckpointAnswer — retry-until-correct checkpoint grading`

### Task 8: Gate `RecordMediaCompletion` on uncleared checkpoints

**Files:**
- Modify: `backend/src/3_applications/school/usecases/RecordMediaCompletion.mjs`
- Modify: `backend/src/3_applications/school/usecases/DispatchMedia.mjs` (return the checkpoint list with the dispatch, so the screen gets it without a second round trip)
- Test: extend both use cases' existing test files

**This is what makes the gate HARD on the backend.** A `media_completed` arriving with checkpoints still uncleared is not a completion — it is a client that seeked past the gate, or a stale duration timer.

**Step 1: Failing tests:**
- `RecordMediaCompletion.execute({ sessionId, verified: 'playhead' })` on a unit WITH checkpoints, some uncleared → refuses: status `'checkpoints_outstanding'`, `released: false`, no `media_completed` event appended, message naming how many are left. Assert the event stream is unchanged.
- Same call with all checkpoints cleared → completes exactly as today (`released: true`).
- A unit with NO `checkpoints` → **behaviour byte-for-byte unchanged** (this is the regression that matters; every existing media unit flows through here).
- `verified: 'duration'` with outstanding checkpoints → also refused (a duration timer cannot prove comprehension).
- `DispatchMedia` returns `checkpoints` (ids + `at`, never answers) alongside `contentId`; a unit without checkpoints returns `checkpoints: null` and an otherwise identical payload.

**Step 2: FAIL. Step 3: Implement** minimally — read cleared set from the reduced state, compare against the unit's checkpoints. **Step 4: pass, whole school suite. Step 5: Commit** `feat(school): completion refuses while checkpoints are outstanding`

### Task 9: Lesson router

**Files:**
- Create: `backend/src/4_api/v1/routers/mediaLesson.mjs`
- Test: `tests/isolated/api/routers/mediaLesson.test.mjs`

**Read first:** `backend/src/4_api/v1/routers/reading.mjs` — copy its structure exactly (deps-injected factory, `asyncHandler`, `errorHandlerMiddleware`, trimmed-string helpers, a header comment naming the ONE caller and what each route exists for).

Mounted at `/api/v1/school/lesson`. Thin — every route delegates to a use case:
- `GET /:sessionId` — snapshot for the widget: `contentId`, `checkpoints` (ids + `at`, **never answers**), `cleared`, `resumePosition`, learner display name via injected `resolveLearner`. Built from `reduceSession` + curriculum, no new state.
- `POST /:sessionId/answer` → `RecordCheckpointAnswer`.
- `POST /:sessionId/position` → appends nothing durable by default; it refreshes the in-flight dispatch's liveness only. **Investigate first:** if the existing `school-playback` bus topic already carries `progress` events with `seconds`/`percent` (see `VirtualPlaybackAdapter`'s header), route position through THAT rather than inventing a second channel, and say so in the route comment.
- `POST /:sessionId/ended` → `RecordMediaCompletion` with `verified: 'playhead'`; returns `{ completed, remaining }` so the screen can show what is left when refused.

Unknown/gone session → 410 (the `schoolApi` client distinguishes statuses — keep that contract). TDD mirroring `reading.test.mjs`. **Commit** `feat(school): media-lesson router`

### Task 10: Real playback adapter for the living-room screen + wiring

**This is the "§8" gap, and it is the ONLY genuinely new dispatch plumbing.**

**Files:**
- Create: `backend/src/1_adapters/hardware/playback/ScreenPlaybackAdapter.mjs`
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs` (pass the real adapter where `playbackAdapter` is threaded, ~line 153/192/394)
- Modify: `backend/src/app.mjs` (construct it; mount the Task 9 router beside the reading router, ~line 4030)
- Test: `tests/isolated/adapters/ScreenPlaybackAdapter.test.mjs`

**Read first:** `VirtualPlaybackAdapter.mjs` IN FULL — it documents the exact port shape the real adapter must satisfy (`dispatch()` returning a correlator, `getStatus()` → `SlotStatus[]`, the `school-playback` bus topic, `dispatched`/`progress`/`complete`/`stop` event types, the `source:id` contentId convention). Its header says these names were provisional pending this work: **if you keep them, say so; if you change them, change the double too so the shapes cannot drift.**

`dispatch({ target, contentId, learnerId, durationSec })` for a screen target:
- Runs the existing wake stack (`WakeAndLoadService.execute(deviceId, query)` — see how `LivingroomTvSurface` calls it) so a dark TV comes on.
- Then broadcasts `{ type: 'lesson.open', sessionId, learnerId }` on topic `lesson:{location}` (per-room, mirroring `reading:livingroom`) so the mounted screen SPA opens the lesson without a page reload.
- Wake failure → throws (so `DispatchMedia`'s existing catch files a non-advancing `failed` event and tells the child to scan again) and **no broadcast** — never tell a screen that is not coming on.

Configure targets in `data/household/school/config.yml` under `media.targets` (id `livingroom-tv`, `child_selectable: true`) — **but see the deployment-ordering warning in Task 18: that data edit goes live before the code deploys, so it is applied LAST, by the user, not committed as part of this branch's rollout.**

TDD with a fake wake service + fake bus. **Commit** `feat(school): real screen playback adapter (the §8 gap) + composition wiring`

---

## Phase 4 — Frontend School

### Task 11: `schoolApi` lesson methods

**Files:** modify `frontend/src/modules/School/schoolApi.js` + its test.
Add: `lessonSession(sessionId)`, `lessonAnswer(sessionId, body)`, `lessonPosition(sessionId, position)`, `lessonEnded(sessionId)` — all via the existing `req` helper (never throws, `{ok, status, data}`). TDD trivial. **Commit** `feat(school): schoolApi media-lesson endpoints`.

### Task 12: `useCheckpointGate` — the authority

**Files:**
- Create: `frontend/src/modules/School/lesson/useCheckpointGate.js`
- Test: `frontend/src/modules/School/lesson/useCheckpointGate.test.jsx`

Pure derivation, mirroring `mediaCheckpoints.mjs` client-side (duplicated by hand like the SUBJECT_IDS twin — note it in both headers): input `{ position, checkpoints, clearedIds }` → `{ verdict: GateVerdict, dueCheckpoint }`. `blocked` when a due checkpoint is uncleared; **`id: GATE_ID.CHECKPOINT`** (see below); `seekCeiling` = first uncleared `at`.

> ⚠ **The verdict field is `id`, NOT `reason`.** An earlier draft of this task said
> `reason: 'checkpoint'`; under the shipped arbiter that field is ignored and `gate`
> silently falls back to the string `'gate'` — a gate that blocks correctly but cannot
> be identified in logs or by `mediaGate`'s telemetry. Caught in Task 1's spec
> re-review before it was written.
>
> **Also add `GATE_ID` while you are here.** `'governance'` is currently a bare string
> literal on both the producer (`FitnessPlayer.jsx:428`) and the consumer (`:439`), and
> this task adds a second id. Create `frontend/src/lib/Player/gate/gateIds.js` exporting
> `export const GATE_ID = Object.freeze({ GOVERNANCE: 'governance', CHECKPOINT: 'checkpoint' })`,
> use it in both FitnessPlayer sites and here, and assert in a test that the two sides
> agree. Two literals that must match, in files that never import each other, is a
> drift waiting to happen. Include the approach signal: `{ approaching: dueWithin(position, 5) }` for the chrome pulse. TDD; **Commit** `feat(school): useCheckpointGate authority hook`.

### Task 13: `useMediaLessonSession` — the state machine

**Files:**
- Create: `frontend/src/modules/School/lesson/useMediaLessonSession.js`
- Test: `frontend/src/modules/School/lesson/useMediaLessonSession.test.jsx`

**Read first:** `frontend/src/modules/School/reading/useReadingSession.js` IN FULL — this hook is its sibling: same WS subscription pattern (`useWebSocketSubscription`), same "attribution frozen, never re-read" doctrine, same stable-listener refs.

Views: `idle → open (fetching) → playing → checkpoint → celebrating → done`. Subscribes `lesson:{location}`; on `lesson.open` fetches via `schoolApi.lessonSession`; exposes `notePlaybackStarted/Completed` callbacks (wired to the media element by the widget), `answer(checkpointId, itemId, given)`, `chooseRewind()` (releases gate locally, seeks handled by widget, re-arms), heartbeat timer (15s while playing, cleared otherwise). Error paths per design: answer POST failure → `notice` state, gate stays blocked, escape-at-notice exits. TDD with mocked WS + api exactly as `useReadingSession.test.jsx` does. **Commit** `feat(school): media-lesson session hook`.

### Task 14: `CheckpointQuizOverlay` — focus-ring quiz for remote/gamepad

**Files:**
- Create: `frontend/src/modules/School/lesson/CheckpointQuizOverlay.jsx` + `.scss` + test

**Read first:** `frontend/src/modules/School/quiz/QuizRunner.jsx` (item components + props), `frontend/src/screen-framework/input/useScreenAction.js`.

Renders the due checkpoint's current item via the existing item components (`MultipleChoiceItem` first; other types follow the same wrapper), inside a focus-ring layer: `useScreenAction('navigate')` moves focus, `'select'` activates, `'escape'` ignored at a live question / exits at a notice. **"Rewind & rewatch" is appended as a focusable option on every multiple-choice checkpoint item.** Wrong answer → shake + reshuffle; correct → ✓ beat then `onCleared`. TDD with RTL firing ActionBus events (see `useScreenAction.test.js` for the emit pattern). **Commit** `feat(school): checkpoint quiz overlay with d-pad focus navigation`.

### Task 15: `MediaLessonScreen` widget + registration

**Files:**
- Create: `frontend/src/modules/School/lesson/MediaLessonScreen.jsx` + `.scss` + test
- Modify: `frontend/src/screen-framework/widgets/builtins.js` (ONE line + comment, after `school-reading`)

**Read first:** `frontend/src/modules/School/reading/ReadingSessionScreen.jsx` IN FULL — mount pattern (renders null when idle; Player via `useScreenOverlay()`; `onMediaRef` + stable listener refs; `clear` ≠ `ended`).

The widget composes: `useMediaLessonSession` (state) + `useMediaClock` (position off the mounted element) + `useCheckpointGate` (verdict) + `useMediaGate` (enforcement) + `CheckpointQuizOverlay` (mounted during `checkpoint` view) + inline surround definition (Task 16). Registration:

```js
// Gated media lessons on the living-room TV. Same contract as school-reading:
// renders nothing until a lesson is dispatched to this room, so the screen's
// menu and screensaver are untouched by its presence.
registry.register('school-lesson', MediaLessonScreen);
```

Widget test mirrors `ReadingSessionScreen.test.jsx`: deliver `lesson.open`, assert fetch + overlay mount; simulate playhead crossing a checkpoint (fake clock state), assert pause + overlay; answer correct, assert release. **Commit** `feat(school): school-lesson screen widget`.

### Task 16: Surround modules — `checkpoint-map` + `lesson-score`

**Files:**
- Create: `frontend/src/modules/School/lesson/surround/CheckpointMap.jsx`, `LessonScore.jsx`, `.scss`, tests, plus a `registerLessonSurround.js` side-effect module imported by `MediaLessonScreen`

**Read first:** `frontend/src/modules/Surround/modules/SegmentMap.jsx` (the shape to copy: props = region definition + sampled clock state), `frontend/src/modules/Surround/registry.js`.

`checkpoint-map`: nodes per checkpoint (cleared ✓ / current pulsing when `approaching` / locked), position cursor. `lesson-score`: avatar + name (attribution visible), items correct, attempts. Registered via `registerSurroundModule('checkpoint-map', …)` / `('lesson-score', …)`. The widget hands `SurroundHost` an inline definition — verify `SurroundHost`'s props allow an explicit definition (read `SurroundHost.jsx`; if it only polls sidecars, mount `SurroundFrame` directly instead — it accepts a definition; note whichever path was taken in the commit). The frame failing must never block the lesson (the surround ONE RULE). RTL tests per module. **Commit** `feat(school): lesson surround chrome (checkpoint-map, lesson-score)`.

---

## Phase 5 — Integration, flow test, docs

### Task 17: Full-suite regression + flow test

**Step 1:** `npx vitest run frontend/src/lib/Player frontend/src/modules/School frontend/src/modules/Fitness/player frontend/src/screen-framework backend/src/2_domains/school tests/isolated` — everything green.

**Step 2:** Playwright flow test `tests/live/flow/school/media-lesson-checkpoint.runtime.test.mjs`: seed a test unit (fixture bank + 2 checkpoints) via test fixtures, open the lesson URL with `?goto=<checkpoint-5s>` (the review-seek primitive — see `lib/Player/reviewParams.js`), assert: playback pauses at the checkpoint, overlay visible, a forward seek attempt snaps back, correct answer resumes. **Test discipline:** no conditional assertion-skipping — if the fixture can't be seeded, fail in `beforeAll`. NOTE: live tests need the ONE running dev stack (never start a second backend — CLAUDE.local.md); coordinate with the user before running.

**Step 3: Commit** `test(school): media-lesson checkpoint flow test`

### Task 18: Docs + deployment notes

- Create `docs/reference/school/media-lessons.md`: architecture summary (link the design doc), the GateVerdict contract, topics/routes table, authoring guide for the `checkpoints:` unit block.
- Add the doc row to `CLAUDE.md`'s Navigation table.
- Move the design doc's status line to "Implemented on feature/media-lesson-checkpoints".
- **Deployment order note (shared-Dropbox data-tree hazard):** THREE data changes — `data/household/screens/living-room.yml` gaining the `school-lesson` widget entry, `data/household/school/config.yml` gaining `media.targets` (Task 10), and any real unit YAML gaining `checkpoints:` — go live on prod the moment they're saved to the synced tree, BEFORE code deploys. They must be applied only AFTER the code ships, by the user. Say this in the doc's deployment section explicitly, and note that school config is cached at startup so it needs a container restart to take effect.
- **Commit** `docs(school): media-lessons reference + deployment ordering`

### Task 19: Finish

Use superpowers:finishing-a-development-branch — verify full suite, then merge to main per house policy (no PRs, delete branch after merge, record in `docs/_archive/deleted-branches.md`).

---

## Standing rules for every task

- **Any move/rename verifies REPO-WIDE, never scoped to one tree.** Task 1's spec
  said `grep -rn <old path> frontend/src` and a consumer in `tests/isolated/` was
  therefore invisible: it went to `Cannot find module` and **0 tests collected**,
  which is the quietest way to lose 14 assertions. Grep the whole repo (excluding
  `node_modules`/`.git`), and check `tests/` explicitly.
- **The gate contract is `{ blocked, paused, reason, gate, seekCeiling }`.** `blocked`
  = a gate says no (standing); `paused` = apply it to the element now. They diverge
  during a seek. Governors emit `GateVerdict = { blocked, id, seekCeiling }` — the
  field is `id`, NOT `reason`.
- **The controller does not edit files in this worktree while an implementer subagent
  is live.** Task 1 collided: the implementer's `git add -A` swept the controller's
  in-progress plan edits into its commit. It caught and amended, but the amend window
  briefly reverted the file on disk. Batch controller edits BETWEEN tasks.
- **Subagents stage by explicit path.** Never `git add -A`, never `git commit -a` —
  this checkout has concurrent writers.
- **Reports must give REAL numbers**: the command run and its actual output counts.
  "Tests pass" is not a result. **Disclose EVERY failure in a run you quote, including
  ones you believe are unrelated** — say "1 failed, and here is why I believe it is
  pre-existing", never round it to green. Task 2 reported a frontend sweep as
  "1150 files / 11437 tests passed" when it was actually 1 failed; the failure was
  genuinely an unrelated flake, but the reviewer had to find that out independently.
- **A failing gate must be attributed, not waved past.** Compare against
  `docs/_wip/plans/2026-08-27-baseline.md` (task R2). Anything not in that baseline
  is ours.
- **ONE RED GATE RUN IS NOT EVIDENCE.** Measured during R2: two back-to-back
  `npm run test:unit:vitest` runs on identical code gave exit 1 then exit 0 (7 files
  failing, then 5). The gate is non-deterministic under a starvation flake that moves
  between files. Before calling any gate failure a regression: run it twice, then run
  the specific file SOLO. A file that passes solo is a flake, not your bug. The
  baseline doc lists the 6 known roamers.
- **Tests must run with cwd = worktree root, and `.env` must stay symlinked.** Two
  suites resolve the data path by parsing `path.join(process.cwd(), '.env')` — not by
  env var alone. Running them from elsewhere reproduces the "no data path" failure
  that looks like a code bug and is not. `ls -l .env` if you see that error.
- **Do not read `npx vitest run` (bare, whole repo) as a result.** It globs past every
  gate into `_extensions/`, `tests/live/`, `tests/integrated/` and a `backend/shared/`
  symlink, and reports ~526 `node:test` files as failures they are not. Scope your run,
  or use the gate.
- **Both reviews return ✅ before the next task is dispatched** — spec compliance
  first, then quality. A fix in response to EITHER review requires that review to run
  again. Task 1 shipped with this loop shortcut (the controller substituted a
  two-command self-check); task R4 repays it. Do not repeat the shortcut.

### Per-task verification checklist

Before reporting a task complete, the implementer must have run and QUOTED:

1. The task's own new tests (count).
2. The suites the changed files belong to (count).
3. A repo-wide grep for anything moved or renamed — **by PATH and by SYMBOL NAME**,
   `--include` on code extensions, excluding `node_modules`/`.git`. Both, always:
   Task 1's regression hid from a path-grep scoped to one tree, and a stale string
   literal (`'PAUSED_GOVERNANCE'`) was found only because a reviewer happened to be
   reading that file.
4. A check that no test file fails to LOAD — `grep "Cannot find module\|0 tests"` over
   the run output. A load failure reports as zero tests, which is invisible in a
   pass/fail count and is exactly how 14 assertions went silently dark in Task 1.
5. **The gate that actually covers the files you changed** — and they are different gates:

   | You changed | Gate that covers it |
   |---|---|
   | `backend/**`, `tests/unit/**`, `tests/isolated/**` | `npm run test:unit:vitest` |
   | `frontend/src/**` | `node tests/_infrastructure/harnesses/isolated.harness.mjs --only=frontend` |

   **`npm run test:unit:vitest` does NOT walk `frontend/src/**`** — measured in Task 2.
   Its population is `tests/unit`, `tests/isolated`, and `backend` only, so the entire
   gate layer, every School component, and every hook this feature adds are invisible
   to it. A green vitest gate is NOT evidence that frontend work is sound. Tasks 3 and
   11-16 are frontend: run the frontend harness, and quote its numbers.
   Attribute every failure against the baseline doc.

- Structured logging framework only — never raw `console.*` (CLAUDE.md).
- Backend imports use the `#domains/` / `#apps/` / `#api/` aliases as seen in neighbors.
- Comment density and header style must match the touched file's neighbors (School files carry WHY-dense headers; match them).
- No PII in fixtures — `test-user`, never real household identifiers.
- Vitest directly; never `--only=domain`.
- Each task: tests fail first, then pass, then commit. Report actual output, not intentions.
