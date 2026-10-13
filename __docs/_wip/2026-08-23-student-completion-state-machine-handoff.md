# Student completion state machine handoff

Status: implementation reconciled and verified locally on 2026-08-23. This
handoff makes no deployment claim.

Design: [2026-08-23-student-completion-state-machine-design.md](plans/2026-08-23-student-completion-state-machine-design.md)

The learner-day projection is read-only and has four states:

- `incomplete`: at least one healthy required section remains;
- `complete`: all required work was served;
- `no_work_today`: no healthy section obligated the learner;
- `indeterminate`: planning or required-program faults prevent a trustworthy
  answer.

Faults have precedence over the three ordinary states and are returned
separately from excused breadcrumbs. Guest, `indeterminate`, and unavailable
HTTP reads lock Piano Games. Identified learners unlock Games only on
`complete` or `no_work_today`; economy rewards may require `complete`.

`SchoolCompletionBridge` publishes an initial observation as well as later
transitions, so an event consumer does not lose the first completion after a
process restart. The payload names learner, study date, current and previous
state, whether the observation is initial, and observation time.

Dated-module catch-up remains non-obligating even while a catch-up session is
in progress because the planner carries durable `timing.mode: catch_up`.
Enrollment v2 snapshots the progression policy, and v1 dated enrollments remain
compatible through their frozen `moduleSchedule`.

Operational diagnosis and guarded repair are available under
`node cli/school.mjs ops`; see
[completion and rewards](../reference/school/completion-and-rewards.md) and
[program operations](../reference/school/programs.md).
