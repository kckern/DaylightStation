# Student completion state machine handoff

Status: implemented and deployed 2026-08-23 (commit `fe3f587a8`).

Design: [2026-08-23-student-completion-state-machine-design.md](plans/2026-08-23-student-completion-state-machine-design.md)
Plan: [2026-08-23-student-completion-state-machine-plan.md](plans/2026-08-23-student-completion-state-machine-plan.md)

## What shipped

- `planDailyAgenda` (`agenda.mjs`) now computes `obligation:
  {state, reason}` per section — `served` / `excused` / `obligated` — from a
  six-rule table (non-elective pass, focus-day suppression, no actionable
  work, optional catch-up backlog, not-yet-urgent windowed work, otherwise
  obligated).
- `completion.mjs` (new, pure): `resolveDayCompletion({sections,
  planErrors})` folds those into a learner-level
  `incomplete | complete | no_work_today`, plus an `excused` breadcrumb list
  for the teacher console. A non-empty `planErrors` surfaces as a
  `plan_error` pseudo-section rather than being silently dropped.
- `GetLearnerDayCompletion` (new use case): the read-only twin of
  `BuildAgenda`'s planning path — same inputs, no session/token side
  effects. Has a parity test against `BuildAgenda`'s own output so the two
  paths cannot silently diverge.
- `CloseSessionOutcome` gained an optional `eventBus` dependency and now
  publishes `school.session.outcome-recorded` on every settle (pass, fail,
  honor-close, resettle). `CloseLanguageDay` routes language-day closes
  through the same `#settle`, so this one publish point covers curriculum
  and language work uniformly.
- `SchoolCompletionBridge` (new, same lifecycle shape as
  `DoNowSchoolBridge`): subscribes to that event, recomputes via
  `GetLearnerDayCompletion`, and publishes `school.completion.changed`
  **only on an actual state transition** — never on every recompute.
- Bug fix along the way: `programUnavailable` used to blank a whole
  section's `next` whenever any program in that subject errored, even with
  a live, unrelated curriculum entry sharing the subject. Candidacy is now
  scoped to entries belonging to the unavailable program only.
- Also fixed a pre-existing, unrelated red test
  (`schoolLifecycleWiring.test.mjs`) left broken by the Glossika
  integration's `closeLanguageDay` addition to the use-case graph.

## Open dependency for the dated-modules workstream

Rule 4 ("optional catch-up backlog never obligates") checks
`entry.timing?.mode === 'catch_up' || entry.timingState === 'catch_up'`.
That second field is **not safe alone**: `planner.mjs:262` overwrites
`timingState` to `'in_progress'` the moment a session is open on that entry
(`evaluateTiming(..., {inProgress: true})` unconditionally returns
`state: 'in_progress'`), so a learner who has *started* a backlog worksheet
would read `in_progress`, miss rule 4, and fall through to "obligated" —
directly contradicting the dated-modules design's own "never gates."

What this needs from that workstream: a field that survives the
in-progress overwrite — e.g. `timing.mode: 'catch_up'` set once at
materialization and never touched by `evaluateTiming`'s `inProgress`
branch — or confirmation that some other durable field (e.g.
`timingRank > 0`) is preserved through it. The completion code already
checks `entry.timing?.mode === 'catch_up'` defensively, so if that's the
field you land on, rule 4 picks it up with no further change on this side.
Until then this rule simply never fires (there is no `dated_modules` course
live yet), so nothing is currently broken — but please ping before shipping
so we can add the one integration test named in the design doc's §9.

## Consumer contract (documented, not built)

Nobody reads `school.completion.changed` or calls
`GetLearnerDayCompletion` yet. The intended contract, for whoever builds
the first consumer:

| Consumer | Honors |
| --- | --- |
| Piano-kiosk games unlock | `complete` **or** `no_work_today` |
| Coins / economy reward | `complete` **only** |
| Teacher console "today" view | `excused` regardless of state |

The `no_work_today` branch on the unlock matters: without it, a learner who
finishes every assigned course reads `caught_up` on every subject forever
and is locked out of the reward a peer doing one lesson a day earns
nightly.

## Verification

Full `tests/isolated/domain/school/` + `tests/isolated/application/school/`
+ `tests/isolated/composition/`: 2157 passing, 0 failing, 0 related to this
change. A full-repo `tests/isolated/` run surfaced 5 further failures, all
pre-existing on `main` before this branch (nutribot date-boundary tests, a
fitness playlist test, a content-resolver test) — verified via `git diff`
against the branch point that none intersect files this change touched.

Deployed: garage-in-use gate checked clear (paused video, no fitness
session) before rebuilding; container reports `healthy`;
`school.lifecycle.mounted`/`ready` logged with no errors; `/build.txt`
confirms the running image is this commit.
