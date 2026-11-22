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
frozen record before writing the replacement. A first close and a supersession
both pass the teacher gate on `closedBy` — a grown-up listed in `teachers:`.

## Program reports

Registered program reporters normalize their output into a closed metric set:
progress, count, score, streak, trend, and duration. Metrics carry an audience.
Learner reads omit parent-only instrumentation such as sibling-comparable
scores, streak pressure, trends, and time spent.

Sentence Ladder reports each corpus instance separately. Its daily agenda
status comes from the current derived queue; its longitudinal report comes from
append-only study evidence.

## Learner work (outward read)

`ListLearnerWork` is how another app reads what the children did for school:
every learner on the roster, every item inside `[from, to)` (YYYY-MM-DD,
end exclusive), as plain learner-audience work items. Each item is built by
`workItem()` in `server/domain/learnerWork.mjs`, which emits exactly
`WORK_ITEM_KEYS` (`learnerId, learnerName, kind, verb, title, subtitle, at,
studyDay, imageUrl, groupKey, weight, subject`), so a score, percent,
correctness, answer, coin or streak on a store row cannot leak through.

| Source | `kind` / `verb` |
|---|---|
| Reading log | `book` started / finished |
| Finished course sessions | `course` completed (a finished session always reads "Completed"; pass/fail never reaches the review) |
| Printed activities (completed, not voided) | `activity` completed |
| Card ladder day files | `program` worked (`weight` = words that day) |
| Piano-lesson learning evidence (`activity.kind: piano_lesson`) | `course` completed: title = the Plex course's own title (else "Piano"), subtitle = the lesson title from the piano sitting log with ` \| ` shown as ` · `, picture `/api/v1/display/plex/<courseRatingKey>`, `groupKey` `course:plex:<ratingKey>` |
| Sentence ladder (Glossika) attempt logs | `program` worked, subtitle "<n> sentences", `weight` = distinct sentences (`seq`) that day, picture `program:sentence-ladder:<corpusId>` |

Each source is optional and read in parallel per learner; one that throws
costs that learner that source only (`school.learner-work.source-failed`).

Piano lessons and the sentence ladder are assigned to the household study
day (household timezone, 4am boundary) of their instant, not the UTC date.
The window `[from, to)` holds study days `from` .. `to - 1`, and study day D
runs from 04:00 local on D to 04:00 local on D+1, so evening work on the last
study day has a UTC instant on `to` (16:00Z at most, in UTC-12). Evidence is
therefore queried over `[from - 1 day 00:00Z, to + 2 days 00:00Z)`, and the
sentence ladder's log shards, which are named by the UTC date of each event,
are read for `from - 1` through `to + 1`, both inclusive; each read has a day
of margin, and the projection keeps only events whose study day is in the
window. Course ids are normalised (`plex:plex:<id>`, from older evidence,
reads as `plex:<id>`). Course titles come from Plex (a season is named by
its show), cached for the process for 6 hours (at most 200 courses) and
bounded at 2.5 s per request; a timeout or failure reads "Piano" and is
retried on the next load. From the sitting log only
`title` is read; its score, percent and outcome never reach an item. The
sentence ladder counts sentences only; accuracy, what was heard and what was
typed are never read. Corpus labels come from the language-study service's
cached corpora, so a weekly review load does not re-parse the corpus file.

The public entry is `server/composition/learner-work.mjs`:
`createSchoolLearnerWork(...)` returns `{ list({ from, to }), image(ref) }`,
or null when School is not wired (`school.learner-work.unwired`,
`school.learner-work.wiring-failed`). `image(ref)` is
`GetLearnerWorkImage`: a course poster, a program poster, or a printed
activity's rendered page (see
[Printed activities](./programs.md#printed-activities--a-page-done-on-paper)).
The consumer is the [Weekly Review](../life/weekly-review.md#school-work),
which curates the items into TV cards and a per-child showcase.

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
