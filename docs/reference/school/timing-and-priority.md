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

Timing attaches only to an **enrollment** or **standalone work** in the first
version. It does not attach to individual modules or lessons. A smaller
time-sensitive activity should be represented by a scoped syllabus when scope
subsetting exists, or by standalone work. This preserves the enrollment's
frozen lesson order.

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
  - anchorId: milo-birthday-2026
    label: Milo's birthday
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
