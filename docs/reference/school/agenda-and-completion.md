# Agenda and daily completion

The agenda is a projection, not a stored checklist. It is rebuilt from current
planning and evidence whenever School needs to preview, print, resolve a
subject ticket, or answer whether the learner is done for today.

## Compilation

```text
flat learner-work plan
        +
today's session outcomes
        +
read-only program status
        ↓
fixed-order subject sections
        ↓
one next action per subject
```

`planDailyAgenda` groups work into the nine School subjects plus `other`. The
visual subject order remains fixed even when timing changes priority. Within a
subject it chooses the best eligible entry using resumability, urgency, base
priority, dated-module rank, and stable authored order.

A section receives one obligation state:

| Obligation | Meaning |
| --- | --- |
| `obligated` | Healthy required work remains today |
| `served` | Passing curriculum evidence or the program's own daily evidence served the subject today |
| `excused` | The subject does not obligate today; the reason is retained |
| `faulted` | School cannot determine the required program or plan reliably |

Common excused reasons include elective-only work, already caught up, work that
opens later, optional dated-module backlog, temporary focus-day suppression,
and `not_a_school_day` — a weekend, holiday or vacation declared by the
enrollment's [school-day calendar](./timing-and-priority.md#7-the-school-day-calendar).
Catch-up remains excused even when its worksheet is already open.

A day the whole household is off is excused for the same reason but under its
own name, `household_calendar`, so a surface can tell a family vacation apart
from a course that simply does not meet on Thursdays. It comes from
[the household calendar](./term-grid.md#the-household-calendar), which the
lifecycle validates once and hands to every surface that asks whether anyone was
asked to work that day — the agenda, the term grid, and the reading streak
wall — so none of them can judge Christmas differently.

`not_a_school_day` is applied as an override after the ladder, so it never
downgrades a section that was already `served`, and the diagnostics below it
keep firing on a day that is off. The section still offers a `next`: the
obligation is excused, not forbidden.

## Focus days and chaining

Urgent timed work can request extra lesson blocks. Extra blocks may suppress
only lower-ranked flexible subjects. Protected work and anything already in
progress cannot be displaced. Passing one focus lesson may expose the next
prerequisite-safe lesson on the result receipt; School never pre-issues future
sequential work.

## Preview versus issuance

`GET /learners/:id/agenda` and `/agenda/preview` are side-effect free. They do
not mint sessions, tokens, access codes, or paper records. So is the launch-card
preview link, which opens the panel's own card for a learner and subject without
a code — see [operations](./operations.md#preview-a-launch-card).

Issuing/printing an agenda is the write path. For each offered curriculum
subject, `BuildAgenda` creates or reuses a work session and mints a
`subject_next` token. The token names learner plus subject—not a frozen unit—so
scanning old paper recomputes the honest next action. Program entries launch
their own surface and do not create curriculum work sessions.

The teacher workspace separates this into preview and dispatch. Preview renders
the same agenda PNG without state changes. Dispatch requires fresh teacher
confirmation and a durable idempotency key; the server reserves that key before
printing and persists the receipt. An identical retry returns the receipt. A
different payload or an indeterminate prior print returns 409, because a second
agenda is worse than requiring an operator to inspect the first attempt.

## The 4am study day

Agenda service, program daily status, teacher-today digest, and daily completion
share the same household-local 4am-to-4am boundary. A pass at 1am still belongs
to the previous evening's School day.

## Persisted reading activity

The v2 teacher-day learner row includes `readingActivity`, projected directly
from that learner's persisted book-event log with the requested study day and
the same household-local boundary. Progress/check-in events and effective
finishes count even when the book is not enrolled or present in the catalog.
Starting or setting aside a book does not count. A `reopened` event removes the
finish it corrects in append order while leaving independent progress intact.

An available shelf reports `status: ok` with `hasActivity`, `progressCount`,
`finishedCount`, and the number of distinct shelf items with evidence as
`bookCount`. A missing shelf is an available empty shelf. A damaged or
unreadable shelf reports `status: unavailable` and `hasActivity: null`, so a
read failure cannot be mistaken for no reading. The v1 teacher-today response
remains unchanged.

New shelf events carry a server-generated `recordedAt` as well as their
effective `at`. Backdated finishes are attributed by `at`; `recordedAt` records
when the write reached the server. Legacy events without `recordedAt` remain
valid. After a saved shelf mutation, the School event bus broadcasts
`{ event: 'book-log-changed', learnerId }` so readers can reload the whole
learner shelf; a broadcast failure is logged without changing the saved HTTP
result.

## Reading on the status board

The live board requests the teacher-day digest without a browser-derived date
and uses the response's household `studyDay` for learner agenda previews and
study-day event comparisons. Explicit day props still support historical
consumers. Each learner settles separately after the shared digest; weekly
rings load independently.

Available persisted `readingActivity` with `hasActivity: true` adds one
supplemental **Reading** circle, regardless of the number of events or books.
It appears even with zero required assignments or a failed plan read. Missing,
unavailable, or empty activity creates no credit. Supplemental circles affect
layout only: required totals, completed-required counts, daily gates, and
**Done for the day** remain unchanged.

Required program identity comes from agenda `entries[].program`, not the
shared English subject. Story time retains its own state and accessible label.
An unmet reading obligation can show partial `actual/target` progress alongside
the supplemental circle. Once a real reading obligation is met,
`BookLogProgramLauncher.status()` supplies `servedWork` for `book-log:shelf`,
so the required Reading circle remains visible after its next action disappears.
That completed required circle suppresses redundant supplemental credit.

The board remains static and noninteractive. It reloads on
`book-log-changed` for displayed learners without filtering by event date:
backdating and undo can change evidence on another day. Event payloads trigger
reads; they never supply optimistic credit. Returning from the shelf remounts
the board and reloads the same persisted sources.

## Persisted physical-education activity

The v2 teacher-day learner row also includes `fitnessActivity`, projected from
the fitness session log for the requested study day. Physical education is not
one of the nine subject shelves and is never assigned: there is no section, no
work-session, and no obligation behind it, so the only evidence is the workout
itself.

A learner is credited for a session two ways. The first is rings: the session
summary records `participants[learnerId].rings` above zero. Rings are computed
at session close and stored, so the projection is a field read rather than a
re-derivation, and requiring rings rather than bare membership in
`participants` keeps a stray heart-rate strap from awarding one child credit
for another's workout.

The second is time, and it exists for the youngest riders. Rings scale with
effort, so a preschooler can spend twenty real minutes on a bike and score
zero; a participant whose `zoneMinutes` total at least ten minutes across all
zones is credited whatever the rings say. Ten minutes still excludes a strap
put on and taken off. `rings: null` means no ring data was recorded and earns
nothing on its own, but does not bar credit on time.

A session belongs to the study day its **start** falls in — the rule the weekly
ring measure already uses — so a late-evening workout is credited once, on the
day it began. The digest reads the roster's day once, across the study day and
its successor, because sessions are stored by date rather than by learner.

An available session log reports `status: ok` with `hasActivity`, the day's
`rings` total, and `sessionCount`. A day credited entirely on time reports
`hasActivity: true` with `rings: 0`, and the circle's label then says only that
fitness is done rather than claiming a ring count it did not earn. A day with no qualifying workout is an
available quiet day, not an outage. A failed read, or no session log wired at
all, reports `status: unavailable` with `hasActivity: null`, so an outage
cannot be mistaken for a child who did not exercise. The v1 teacher-today
response remains unchanged.

## Physical education on the status board

Available `fitnessActivity` with `hasActivity: true` adds one supplemental
**Fitness** circle carrying the `physical-education` subject icon, however many
sessions or rings the day held. Like the Reading circle it affects layout only:
required totals, completed-required counts, daily gates, and **Done for the
day** are unchanged, so a workout can never finish a day of school work and
school work can never hide a workout.

The circle has no other state. It is never pending, because a wall panel should
not nag a child to go and exercise, and never amber, because nothing marks a
workout wrong. On a day with no qualifying session it is simply absent.

Fitness therefore appears twice on a card, deliberately: the ring chip in the
readout is the week's cumulative count, the circle is today's yes or no. The
board needs no new subscription for it — closing a session prompts the
`fitness.weekly-rings` State Gate producer, and the board already reloads on
that gate's events.

## Learner-day completion

Completion folds section obligations and planner faults into four states:

| State | Meaning |
| --- | --- |
| `incomplete` | At least one healthy required section remains |
| `complete` | Required work existed and every obligation was served |
| `no_work_today` | The healthy plan created no obligation today |
| `indeterminate` | A plan or required-program fault prevents a trustworthy answer |

This projection is never persisted as a mutable done flag. The endpoint is
read-only and `no-store`. Piano Games unlocks only for an identified learner in
`complete` or `no_work_today`; Guest, transport failure, and `indeterminate`
remain locked. Earned-reward consumers may require `complete` specifically.

The completion bridge publishes an initial observation after startup and later
state transitions. Event consumers must be idempotent by learner and study
date. See [completion and rewards](./completion-and-rewards.md).
