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
opens later, optional dated-module backlog, and temporary focus-day
suppression. Catch-up remains excused even when its worksheet is already open.

## Focus days and chaining

Urgent timed work can request extra lesson blocks. Extra blocks may suppress
only lower-ranked flexible subjects. Protected work and anything already in
progress cannot be displaced. Passing one focus lesson may expose the next
prerequisite-safe lesson on the result receipt; School never pre-issues future
sequential work.

## Preview versus issuance

`GET /learners/:id/agenda` and `/agenda/preview` are side-effect free. They do
not mint sessions, tokens, access codes, or paper records.

Issuing/printing an agenda is the write path. For each offered curriculum
subject, `BuildAgenda` creates or reuses a work session and mints a
`subject_next` token. The token names learner plus subject—not a frozen unit—so
scanning old paper recomputes the honest next action. Program entries launch
their own surface and do not create curriculum work sessions.

## The 4am study day

Agenda service, program daily status, teacher-today digest, and daily completion
share the same household-local 4am-to-4am boundary. A pass at 1am still belongs
to the previous evening's School day.

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
