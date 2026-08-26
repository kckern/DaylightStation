# Time-sensitive School Planning

> **Status: runtime core implemented.** The planner, agenda compiler, keypad
> resolution, and agenda printing consume materialized timing now. Household
> anchors and timing templates are hand-authored YAML/API inputs for now; an
> editor for them remains future work.
>
> Related: [enrollment and syllabi](./enrollment.md),
> [School overview](./README.md), and
> [print-document lifecycle](./print-documents.md).

School needs more than school terms. A learner may need an Advent activity in
December, a project before a birthday, a unit around the World Cup, or extra
work before the Fourth of July. Those are planning facts, not curriculum facts:
they should change what is offered next without changing what was learned,
what paper was issued, or what evidence has already been recorded.

## 1. Boundaries

Four concepts remain intentionally separate:

| Concept | Answers | Owner |
| --- | --- | --- |
| Sequence | What lesson unlocks next? | Course progression and enrollment snapshot |
| Academic period | Which reporting window contains this evidence? | Household period plan |
| Timing | When should this planned work be offered or completed? | Learner plan entry |
| Evidence | What did the learner actually attempt or pass? | Session, worksheet, OMR, and assessment records |

An academic period may be a term, semester, or season, but it is not a generic
due-date engine. A deadline never unlocks a prerequisite, changes an answer
key, revises an issued worksheet, or converts an unattempted lesson into a
failing grade.

Timing normally attaches to an **enrollment** or **standalone work**: use that
course-level timing for an occasion-shaped course such as Advent or the Fourth
of July. A calendar-shaped `dated_modules` course, such as Come Follow Me,
instead snapshots one `moduleSchedule` window per module onto the enrollment.
The clock makes the current module available, unfinished closed modules remain
offerable as newest-first catch-up, and future modules stay unavailable. Days
inside each module still use the enrollment's frozen lesson order.

## 2. Authority and materialization

A course may describe a useful occasion, but it must not own the household's
calendar. A syllabus may provide reusable timing defaults; the learner plan
owns the actual household event and resolved dates.

### Household anchors

`household/school/plans/timing-anchors.yml` holds stable,
household-owned anchors. It supports a one-off local date and an annual
month/day. It is deliberately not a direct reference to the harvested calendar
feed: outside calendar events can move or disappear, while an active learner
plan must be explainable and stable.

```yaml
schema: school.timing-anchor-list/v1
anchors:
  - anchorId: fourth-of-july
    label: Fourth of July
    kind: annual_date
    month: 7
    day: 4
  - anchorId: learner3-birthday-2026
    label: Learner3's birthday
    kind: fixed_date
    date: '2026-10-18'
  - anchorId: world-cup-final-2026
    label: FIFA World Cup final
    kind: fixed_date
    date: '2026-07-19'
```

There is no `learner_birthday` shortcut: the School roster currently guarantees
a birth year, not a stable full birth date. A birthday is therefore an explicit
anchor until household identity exposes a suitable authoritative date.

### Syllabus default and learner snapshot

A syllabus may carry `timingTemplate`, a reusable policy without learner
history. Materializing it resolves an anchor and copies the final timing record
onto the enrollment. The enrollment or standalone-work record is thereafter
authoritative for that learner; editing an anchor or syllabus never silently
moves an active plan.

```yaml
# `school.syllabus/v1` timingTemplate.
timingTemplate:
  schema: school.timing-template/v1
  defaultAnchorId: fourth-of-july
  opensBeforeDays: 21
  closesAfterDays: 1
  targetOffsetDays: -1
  targetStrength: firm                 # firm | aspirational
  basePriority: high                   # low | medium | high
  flexibility: flexible                # protected | flexible
  normalBlocks: 1
  urgentBlocks: 3
  urgencyLeadDays: 10
```

```yaml
# Materialized field on one enrollment or standalone-work entry.
timing:
  schema: school.timing/v1
  anchor:
    anchorId: fourth-of-july
    label: Fourth of July
    resolvedOn: '2026-07-04'
  availability:
    opensOn: '2026-06-13'
    closesOn: '2026-07-05'
  target:
    dueOn: '2026-07-03'
    strength: firm
  basePriority: high
  flexibility: flexible
  agenda:
    normalBlocks: 1
    urgentBlocks: 3
  urgencyLeadDays: 10
```

All dates are household-local study dates (`YYYY-MM-DD`), not UTC timestamps.
Omitting `timing` keeps the current behavior: always available, medium priority,
one ordinary daily block, and protected from automatic displacement.

### Activating a timed enrollment

1. Add the selected household anchor to
   `data/household/school/plans/timing-anchors.yml`.
2. Add a valid `timingTemplate` to the hand-authored `school.syllabus/v1`
   record, including its `defaultAnchorId`, or supply an anchor explicitly.
3. Create the ordinary course enrollment through
   `POST /api/v1/school/lifecycle/enrollments/:learnerId`. Include
   `syllabusId`, the usual teacher credentials, and optional
   `timingAnchorId`. When it is omitted, the syllabus `defaultAnchorId` is
   used.

At enrollment, School resolves the anchor using the household study day and
saves the materialized `timing` snapshot on the learner plan. An invalid or
missing anchor rejects that enrollment; School never silently creates an
unrestricted timed course. There is no timing-editor UI yet, so anchors and
templates are currently authored as YAML or supplied through the existing
enrollment API.

## 3. Availability, targets, and effective priority

The planner derives timing state; it never rewrites plan YAML just because a
day has passed.

| Derived state | Condition | Agenda treatment |
| --- | --- | --- |
| `upcoming` | Before `availability.opensOn` | Not offered; parent preview may show when it opens. |
| `available` | In the availability window, with no active deadline boost | Eligible normally. |
| `urgent` | Incomplete, eligible, and `target.dueOn` is within `urgencyLeadDays` | Eligible with an automatic priority promotion. |
| `dormant` | After `closesOn`, or after an incomplete firm target | Not offered until a grown-up continues, retargets, retires, or archives it. |
| `missed_target` | After an incomplete aspirational target but still in its window | Still eligible at base priority; explain the missed target to the parent. |
| `catch_up` | A closed dated-module window with unfinished lessons | Still eligible at medium priority; ordered newest closed module first. |

An open session or issued worksheet always remains resumable. Timing may not
strand a child holding paper: `in_progress` outranks a later dormant state until
that work resolves.

Effective priority is a pure, explainable value:

```text
in_progress or retry
  > urgent incomplete work
  > high base priority
  > medium base priority
  > low base priority
  > authored plan order (stable tie-breaker)
```

For dated modules, calendar rank resolves ties inside the subject: current
module first, then closed unfinished modules by `closesOn` descending. This is
not deadline urgency and never claims additional cross-subject focus blocks.

The selector should return its reasons, such as `in_progress`,
`due_in_3_days`, or `high_base_priority`. Those reasons let a parent preview
and a child-facing agenda say why today's work changed.

This borrows the useful idea from content watchlists—authored base priority plus
derived deadline urgency—but not its behavior wholesale. School does **not**
auto-skip expired work, relax an expired window merely to fill an agenda, or
equate a missed target with completion.

## 4. Agenda allocation and focus days

Agenda selection becomes a two-stage process:

```text
assigned plan entries
  -> curriculum gates and resumable work
  -> timing availability
  -> effective priority
  -> cross-subject block allocation
  -> fixed-order subject sections and next actions
```

The normal agenda stays sectioned in its fixed subject-wall order. A timing
policy may make one course a temporary focus without visually turning the
agenda into a priority-sorted task list.

### Declared block budgets

One block is one sequential lesson opportunity. `normalBlocks` is the ordinary
daily allowance; `urgentBlocks` is the allowance while that entry is urgent.
Both are positive integers and `urgentBlocks >= normalBlocks`. Ordinary plans
default to one block. Only an urgent entry's **extra** blocks
(`urgentBlocks - normalBlocks`) can displace work in another subject.

For each urgent entry, in effective-priority order, reserve one lower-ranked
flexible subject offer for each requested extra block. Protected entries and
all in-progress work cannot be displaced. If fewer flexible offers exist, the
focus entry receives only the capacity available; it never suppresses protected
work. A stable authored-plan order breaks otherwise equal claims.

The child sees the focus subject in its normal subject position with a concise
label such as “Focus today · up to 3 lessons.” The parent preview lists every
suppressed flexible subject and the timing reason. This preserves the existing
one-section-per-subject presentation while making a genuine cram day possible.

### Chaining safely

When a learner passes a focus lesson, its result receipt may offer the next
newly unlocked lesson that same study day, until the declared block budget has
been consumed. It must not pre-print a packet of future sequential lessons:
each next offer follows the real prerequisite result. A failed lesson keeps the
retry as the current block and does not consume another lesson opportunity.

## 5. Parent decisions and durable history

Time changes future offers only:

- A past availability window, or an incomplete firm target after its due date,
  becomes `dormant` and requires a grown-up to **continue**, **retarget**,
  **retire**, or **archive** the plan entry.
- An aspirational target that passes while its availability window remains open
  stays available. It loses urgency and records an explanatory missed-target
  status rather than a delinquency or grade.
- Milestones remain expected-progress/reporting facts. They may be derived from
  an active timing plan later, but must not be used to manufacture a completion.
- A schedule change creates a plan revision. It never edits issued worksheet
  instances, OMR allocations, scan evidence, session outcomes, or frozen
  report-card history.

## 6. Implementation posture

The implementation uses a small pure School timing/priority evaluator rather
than importing the media `QueueService`. It takes plan snapshots, date anchors,
derived session state, and the injected local study day; it returns
availability, effective priority, reasons, focus-block claims, and
parent-facing displacement explanations. Persistence, printing, and QR
issuance consume that result downstream.

The implemented behavior is covered by focused domain/application tests for:

1. An Advent course opens and closes without changing its course structure.
2. A Fourth of July course becomes urgent, claims two flexible subject blocks,
   and chains safely after each pass.
3. A World Cup anchor remains fixed for an active plan even if an external
   calendar later changes.
4. A missed firm birthday target goes dormant without creating a failure or
   altering past paper evidence.
5. An in-progress worksheet remains resumable even when its timing window ends.

## 7. The school-day calendar

Timing windows answer *"is this unit open yet?"* with one continuous
`opensOn`/`closesOn` span. That cannot say "weekdays only", "not Thanksgiving
week", or "we're making Thursday up on Saturday" — so before the schedule
block, a Saturday still read as an unmet obligation on the status board.

An enrollment may declare which days are school days:

```yaml
schedule:
  daysOfWeek: [1, 2, 3, 4, 5]   # ISO-8601: 1=Monday .. 7=Sunday. Omitted = every day.
  except:                        # never a school day, whatever daysOfWeek says
    - '2026-11-26'
    - { from: '2026-12-21', to: '2027-01-02' }   # inclusive at both ends
  also:                          # always a school day, even if daysOfWeek excludes it
    - '2026-11-28'               #   -> the makeup day
```

**Precedence is fixed: `also` beats `except` beats `daysOfWeek`.** A makeup day
named explicitly has to win over the vacation range containing it, or "we'll
make it up on Saturday" is inexpressible. Naming one date in both `also` and
`except` is therefore a school day, not an error.

`schoolCalendar.mjs` is pure: it compares calendar keys and never reads a
clock, a timezone or a `Date` in local time. The day it is handed is a study-day
key that `studyDay.mjs` already resolved at the 4am boundary.

### It fails open, and it is strict about keys

An absent, unparseable or invalid schedule is a **school day**. The failure
mode must be "the child is asked to do their work", never "a typo excused the
entire term and nobody noticed until June".

Because failing open is silent, the validator refuses **unknown keys** as well
as bad values — `daysofweek`, `exept` and `holidays` are errors, not ignored
extras — and `agenda.mjs` emits `school.agenda.invalid-schedule` carrying the
validator's own messages whenever it meets a schedule it had to ignore. An
empty block normalizes to no schedule at all.

A weekday list may not be empty: that is a term with no school days, which
nobody means and which would otherwise raise nothing.

### Where it lives, and why it is a snapshot

The block is authored on a **syllabus** and snapshotted onto the **enrollment**
by `createCourseEnrollment`, deep-copied, exactly like `progression`,
`display` and `moduleSchedule`. Different children have different school years,
and the enrollment is the frozen statement a later syllabus edit cannot reach
into. The consequence is deliberate: **a vacation added mid-year needs an
explicit re-materialize**, the same as every other frozen field.

```bash
SCHOOL_PIN=... node cli/school.mjs ops rematerialize <learner> \
  --syllabus <id> --teacher <teacher> --pin-env SCHOOL_PIN --apply
```

Re-materialize is refused while any session on that course is open, and it
re-shuffles a `shuffle_once` order — do it when nobody is mid-worksheet.

A shared household calendar layered *under* this is a reasonable future
addition. It is not a substitute: the per-learner statement has to win.

### What a non-school day does to the agenda

`planLearnerWork` carries the enrollment's schedule onto every entry of that
course; `planDailyAgenda` consults it at exactly one place, where it decides
`obligation`.

- The section resolves to the existing `excused` state with the reason
  `not_a_school_day`, so `completion.mjs`, the status board and the report card
  need no change. A whole day of them rolls up to `no_work_today`, not
  `incomplete`.
- A section is off only when **every** non-elective entry in it says so. One
  unscheduled course beside a weekday-only one keeps the section obligated
  rather than borrowing its vacation.
- **`served` outranks it.** A child who does the work on a Saturday has done
  it; the excuse applies to what is left, never to what was finished.
- **`next` is still offered.** The obligation is excused, not forbidden —
  optional work on a Saturday is fine. A presenter therefore has a lesson to
  render on a day that is off, and must read the obligation reason rather than
  the presence of `next` to decide whether to say "no school today".
- A focus day cannot displace a section that is not in session: there is
  nothing to hold back, and the extra block stays available for a subject that
  was open.
- The obligation ladder still runs underneath the override, so
  `school.agenda.blocked-unreachable` and the other diagnostics keep firing on
  a Saturday. Only the verdict softens.
