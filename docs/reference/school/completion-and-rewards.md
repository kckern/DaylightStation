# Completion and rewards

For the full planner-to-agenda flow and obligation vocabulary, see
[Agenda and daily completion](./agenda-and-completion.md).

Learner-day completion is a derived, side-effect-free projection over the same
plan and agenda rules that issue work. It is never a mutable “done” flag.

`GET /api/v1/school/lifecycle/learners/:learnerId/completion` returns the study
date, one of `incomplete | complete | no_work_today | indeterminate`, excused
sections, and faults. `Cache-Control: no-store` prevents a stale reward answer.

Faults win: catalog/plan errors and an unavailable required program produce
`indeterminate`. A healthy obligated section produces `incomplete`; fully
served obligations produce `complete`; an otherwise healthy day with no
obligations produces `no_work_today`.

Piano Games unlocks only for an identified learner in `complete` or
`no_work_today`. Guest, transport failure, and `indeterminate` lock it. Coins
and other earned rewards should require `complete` unless their own policy says
otherwise.

The completion bridge emits an initial observation and every subsequent state
transition. Consumers must be idempotent and use learner plus study date as the
logical key.

For operations:

```bash
node cli/school.mjs ops completion milo
node cli/school.mjs ops status milo
node cli/school.mjs ops monitor milo felix --watch --interval 15
```
