# Planning: assignment, enrollment, and timing

Planning answers one question: **what work belongs in this learner's active
plan?** It does not record what the learner accomplished.

## Sources of planning truth

```text
published curriculum
        +
current learner assignment
        +
frozen enrollment snapshots
        +
materialized timing
        ↓
learner-work plan
```

Published curriculum says what exists. The assignment says which courses,
standalone units, and programs this learner is doing. An enrollment freezes how
one assigned course applies to that learner. Timing controls when eligible work
is offered and how strongly it is prioritized.

## Assignment

The current learner assignment contains three independent collections:

- `courses`: bare legacy course ids or rich enrolled-course records;
- `units`: standalone curriculum or program units;
- `programs`: validated per-instance program policies, such as one Sentence
  Ladder corpus.

A published course offers nothing merely because it exists in the catalog.
Only assigned work enters the planner. Assignment writes are teacher-gated,
validated before persistence, protected by `baseUpdatedAt`, and appended to
assignment history.

Unknown courses and malformed or duplicate program policies are refused. The
program id `language` is normalized to the canonical `sentence-ladder` id at
the write boundary.

## Enrollment

A syllabus is a reusable template; enrollment materializes it into a frozen
`school.course-enrollment/v2` record embedded in the course assignment. The
snapshot owns progression policy, profile, membership, ordering, and dated
windows. See [enrollment and syllabi](./enrollment.md).

## Timing

There are two calendar mechanisms:

- Enrollment/standalone timing for occasion-shaped work such as Advent or a
  project deadline.
- `dated_modules` for calendar-shaped courses such as Come Follow Me, where
  each module has its own frozen window.

Timing is derived on every read. It can make work upcoming, available, urgent,
dormant, missed-target, or catch-up; it never changes a grade, prerequisite,
issued worksheet, or historical record. An open session always remains
resumable. See [timing and priority](./timing-and-priority.md).

## From plan to agenda

`planLearnerWork` combines the assignment, catalog, frozen enrollment, session
history, current study date, and course policy. It produces one flat entry per
planned unit with a closed status set:

| Plan status | Meaning |
| --- | --- |
| `locked` | A prerequisite is incomplete; the entry names the nearest remedy |
| `available` | Eligible to start now |
| `in_progress` | A session or issued worksheet can be resumed |
| `completed` | Durable pass evidence satisfies this unit |
| `upcoming` | Not open yet |
| `dormant` | Closed or expired and awaiting an adult decision |

Timing details such as `urgent`, `catch_up`, and `missed_target` accompany the
plan entry; they are not additional completion states.

Attestations may enter planning as synthetic passes to repair a gate. They do
not become engine grades and do not appear as graded report-card evidence.

The next stage is [agenda and daily completion](./agenda-and-completion.md).
