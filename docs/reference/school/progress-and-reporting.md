# Progress, course status, and reporting

School does not have one universal “status.” It exposes several projections,
each answering a different question.

## Status vocabulary

| Projection | Examples | Question answered |
| --- | --- | --- |
| Plan entry | `locked`, `available`, `in_progress`, `completed`, `upcoming`, `dormant` | Can this unit be worked now? |
| Timing | `urgent`, `catch_up`, `missed_target` | How should eligible work be treated today? |
| Agenda obligation | `obligated`, `served`, `excused`, `faulted` | Does this subject count today? |
| Learner day | `incomplete`, `complete`, `no_work_today`, `indeterminate` | Is the learner done for today's access/reward policy? |
| Course grade | percentage plus per-unit best attempts | How has assessed work scored in this reporting window? |
| Program report | `not-started`, `active`, `blocked`, `complete` plus typed metrics | How is a program progressing longitudinally? |

“Passed,” “served today,” “course complete,” “100%,” and “done for today” are
therefore not synonyms.

## Course grade

The current policy is `best-of-unit-mean-v1`:

1. For each attempted unit, select its highest graded percentage in the
   reporting window.
2. Average those best unit percentages.
3. Leave untouched units out rather than treating them as zero.

A retake can improve a course grade but cannot dilute it. The report also keeps
per-unit attempt count, best percent, pass state, and the session behind the
best outcome.

## Academic periods and report cards

Academic periods are household-authored half-open time windows. They scope
reporting; they do not unlock work or create deadlines.

A live report card is a read-only period snapshot containing:

- course grades and unit outcomes;
- unresolved graded units whose catalog entry disappeared;
- materials-framework progress;
- cross-surface learning evidence;
- active instructional days;
- concept mastery;
- remediation arcs and pending-review count;
- warnings such as multiple enrollments in one course during the period.

The course list comes from assignment history in the period plus any course
with graded evidence in the period. Dropping a course later does not erase it.
Legacy learners with no assignment history fall back to the current assignment.

Closing a period freezes the exact report-card snapshot. Re-closing is refused
unless the teacher explicitly supersedes it; supersession archives the prior
frozen record before writing the replacement. An ordinary first close uses the
active teacher capability. Supersession additionally requires a fresh one-use
grant scoped to that learner and period.

## Program reports

Registered program reporters normalize their output into a closed metric set:
progress, count, score, streak, trend, and duration. Metrics carry an audience.
Learner reads omit parent-only instrumentation such as sibling-comparable
scores, streak pressure, trends, and time spent.

Sentence Ladder reports each corpus instance separately. Its daily agenda
status comes from the current derived queue; its longitudinal report comes from
append-only study evidence.

## Milestones, enrichment, and certificates

Milestones compare expected progress with passed or attested work. Enrichment
can excuse a behind milestone in the progress report but never manufactures an
engine grade. Certificates require actual graded course evidence; School does
not print a completion certificate for a course with nothing assessed.

## Learner and teacher surfaces

The learner Standing panel resolves the current period and shows live course
percentages only for courses with graded evidence. Quiet absence—not error
chrome—is used when no current period or grade exists.

The teacher Today digest uses the 4am study day and shows attempts, correct
answers, touched sessions, reflections, and pending review per learner. Records
provides live/frozen report cards, progress reports, certificates, enrichment,
and audit/repair views.

The teacher workspace adds a paginated learner timeline of work sessions. It is
an operational history, not a second gradebook: session transitions and their
linked issued artifacts, machine grades, and corrections remain typed and link
back to the authoritative session record. Enrollment changes, teacher feedback,
and instructional overrides remain in their own authoritative panels; they are
not currently interleaved into the session timeline. Session drill-down exposes
both machine and effective grades so reports never conceal that a teacher
correction occurred.
