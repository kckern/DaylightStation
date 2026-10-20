# School — failure policy

One stated policy for "the content or collaborator I need is absent",
applied the same way everywhere in school. Two kinds of absence exist, and
they fail in opposite directions on purpose.

## Content problems fail soft, per item, with a visible receipt

A draft unit, a missing question bank, an absent generated-content recipe —
these are authoring-in-progress facts about the household's content, not
defects in the running system. The item is skipped and the skip is logged at
`warn` with a count and the identifiers of what was skipped. The rest of the
catalog loads and serves normally.

The count and identifiers are not optional decoration. A silent drop
relocates the symptom: the catalog still loads, everything still looks
healthy, and the only visible sign is somewhere downstream reporting a
generic absence — "no published units for this course," a missing bank, a
recipe nobody notices is gone — which names the wrong cause. A parent's
scripture course once offered a child nothing for a full day because the
draft units assigned to it were dropped with no log and no counter, while an
*invalid* unit one line below in the same loop was logged correctly. Nobody
could tell "authored but not yet approved" from "broken" from "never
existed" until someone thought to check the review state by hand. The fix is
symmetry: whatever gets an invalid item a `warn` gets a draft, a missing
bank, or a missing recipe the same `warn`, same shape, every time — not just
once code happens to already log the adjacent case.

This applies uniformly regardless of *why* the item is unusable — draft
review state, a dangling reference, a missing file, a schema mismatch. Each
gets its own named event, but every one of them is a per-item, per-load
`warn` with a count and ids, never an exception and never nothing.

## Wiring problems fail loud at startup, for that subsystem only

A required collaborator that was never injected, a config file that fails to
parse, a malformed recipe list — these are programming or deployment
mistakes, not household content in flux. They are logged at `error` when the
affected piece is constructed, and the *decision* they force is narrow: the
one feature or subsystem that depends on the broken collaborator degrades
(empty, unavailable, disabled), but nothing else in the process is allowed to
notice. A generated-content adapter that finds no recipes file logs a `warn`
and starts empty — a fresh mount may simply not have one yet. One that finds
a recipes file it cannot parse logs an `error` and starts empty anyway,
because the alternative is worse: refusing to construct would have taken
every unrelated app down with it.

That "every unrelated app down with it" is not hypothetical. A course
source once did its own file read at module scope and threw when the file
was absent from the built image. Because a lifecycle module imported it
statically, that throw fired at `import` time, before the composition root's
try/catch around app startup ever ran — and took fitness, finance, kiosks,
and every other subsystem down over one school content file. The fix moved
the source into a committed module with no I/O and turned the schema check
into a logged `error` that degrades the one course, never the process.

## No filesystem or network I/O at module scope

Nothing under `__backend/src` reads a file, opens a socket, or otherwise
touches the outside world at the top level of a module — only inside a
function, constructor, or lazily-invoked initializer. A static `import`
cannot be wrapped in a try/catch by the code that imports it; by the time
control reaches the composition root's error handling, a module-scope read
has already run, and a missing or unreadable file has already become a
thrown exception with no boundary around it. That is the mechanism behind
the fitness/finance/kiosks outage above: not a bug in the read itself, but
where the read was allowed to happen. Load configuration, recipes, or
content lazily — on first use, in a constructor, behind a function call — or
inject it from a caller that already did the same. Either shape keeps the
failure inside whatever error boundary the composition root actually builds
for that subsystem, instead of skipping it entirely.

## A child's failed work: two retries or three idle days, then a grown-up

The sections above are about the system failing. A child failing a sheet is a
different thing, and it has its own rule. An open failed result (settled
`needs_remediation`, no retry opened yet) becomes a **teacher hold** when
either of these is true:

- **`cap`** — it is already `lifecycle.remediation.maxRounds` retries deep
  (default 2), counted back to the original attempt.
- **`stale`** — it has sat unretried for `lifecycle.remediation.holdAfterStudyDays`
  school days (default 3).

Both values live in `school.yml`. The cap wins when both apply.

**Counting retries.** Every remediation session carries `remediationOf` on its
`created` event, naming the session it retries; the original carries none.
Depth is the number of links back to the original: 0 for the first sheet, 1
for the first retry, 2 for the second. Session rows
(`IWorkSessionRepository.listForLearner`) carry `remediationOf`, so the planner
counts without reading events. A store whose rows omit the field is read from
events by `PlanProjection` before planning (`application/remediationDepth.mjs`).
An absent link means "unknown", never "original", because treating it as an
original would under-count. A lineage that loops back on itself ends the walk
at the first repeat. Use cases that walk by reading events stop at the cap,
since that is all they need to know.

**Counting idle days.** Idle days are *school* days by the learner's own
calendar: the course enrollment's `schedule` and the household calendar. They
are counted from the study day (4am boundary) the failure was recorded, with
that day and today both excluded, so a child always has today. A failure
recorded on a Saturday is not stale on Monday morning because a weekend went
by; with weekday enrollment it is held from Thursday. A standalone unit has no
enrollment schedule, so only the household calendar thins its days.

**Why.** On 2026-09-26 a learner scored 16.67% on a mastery quiz. The failure
sat at depth 0 and was never retried. The agenda printed TRY AGAIN at the top
of the subject every school day from 9/29 to 10/02, and he never took it. While
it was owed the day could not complete, so his games stayed locked behind work
he was plainly not going to do alone. The idle-days rule is what would have
caught that. The cap catches the other way the same loop runs forever: retries
taken and failed, one after another.

What a hold does:

| Surface | Not held | `cap` | `stale` |
| --- | --- | --- | --- |
| Planner entry `remediation` | `held: false` | `held: true, reason: 'cap'` | `held: true, reason: 'stale'` |
| `nextMove` (scan, paper) | `retry` | `teacher` — "a grown-up will help with this one", no token class, not printable | same as `cap` |
| Self-service panel | Retry button | No button; "Waiting for a grown-up." | same |
| Agenda obligation | `obligated` | `excused · teacher_hold` when it is the only open item in the subject | same |
| Result receipt (at settle) | Retry ticket, TRY AGAIN | No ticket; headed A GROWN-UP WILL HELP, "After N retries…" | n/a — a fresh failure is never stale |
| A retry ticket already in hand | Opens the next round | `OpenRemediation` refuses a child (`reason: remediation_capped`, `school.remediation.capped`) | Still opens: the child came back |
| Teacher dashboard | — | `attention` item `remediation-cap` (depth, last score) | `attention` item `remediation-stale` (idle school days, last score) |
| Log | — | `school.remediation.held {reason: 'cap'}` when the result settles | `school.remediation.held {reason: 'stale'}` the first time a live projection sees it each study day |

`held` requires the unit's plan status to be `in_progress`. A unit passed on
another session is `completed` and never held, whatever an older failure says,
and only the newest open session on a unit is judged.

A stale hold does not refuse the child. It only stops the work from being
owed, so it can no longer keep the day shut. A child who returns with the
retry ticket still gets the fresh sheet, and the new session starts the count
again. A cap hold does refuse.

The stale log has no moment of its own to fire on. A hold forms when a day
passes with nothing done, and nothing observes that. So `PlanProjection` logs
it the first time it projects the hold, de-duplicated per session per study
day in memory. A restart may log the same hold once more that day. The dry-run
preview projection does not log, so the same hold is not reported twice.

A grown-up is never capped. "Offer another try" on the session page opens the
next round through the teacher gate (`openedBy`). If that round fails too, the
unit goes straight back to a hold, so the grown-up stays in the loop until the
work is passed or settled another way.

The hold is excused rather than faulted on purpose. Nothing about the system
is broken, and a fault would leave the day `indeterminate` and the games
locked, which is exactly what the hold exists to end. The subject does not
vanish: the paper still names the held lesson, the teacher dashboard lists it
and counts it among the subjects that need a grown-up, and it stays listed
until someone acts.
