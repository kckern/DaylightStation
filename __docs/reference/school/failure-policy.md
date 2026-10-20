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

## A child's failed work: two rounds, then a grown-up

The sections above are about the system failing. A child failing a sheet is a
different thing, and it has its own rule: a failed result offers a fresh sheet
at most `lifecycle.remediation.maxRounds` times (default 2, in
`school.yml`), counted back to the original attempt. After that the unit is a
**teacher hold**.

Rounds are counted by lineage, not by date. Every remediation session carries
`remediationOf` on its `created` event, naming the session it retries; the
original carries none. Depth is the number of links back to the original — 0
for the first sheet, 1 for the first retry, 2 for the second. Session rows
(`IWorkSessionRepository.listForLearner`) carry `remediationOf`, so the planner
counts without reading events. A store whose rows omit the field is read from
events by `PlanProjection` before planning (`application/remediationDepth.mjs`):
an absent link means "unknown", never "original", because treating it as an
original would under-count and print the third TRY AGAIN the cap exists to stop.

Why there is a cap at all: before it, a failed result offered "try again"
forever. After a 16.67% on a mastery quiz on 2026-09-26, one learner's agenda
printed TRY AGAIN every school day from 9/29 to 10/02 and he stopped. The open
item sat at the top of the subject, the day could never complete, and his
games stayed locked behind work he could not clear alone.

What a teacher hold does, everywhere at once:

| Surface | Below the cap | At the cap |
| --- | --- | --- |
| Planner entry | `remediation: {depth, maxRounds, held: false}` | `held: true`; status stays `in_progress`, so successors stay locked |
| `nextMove` (scan, paper) | `retry` — "try again with a fresh sheet" | `teacher` — "a grown-up will help with this one", no token class, not printable |
| Self-service panel | Retry button | No button; "Waiting for a grown-up." |
| Agenda obligation | `obligated` | `excused · teacher_hold` when it is the only open item in the subject |
| Result receipt | Retry ticket, TRY AGAIN | No ticket; headed A GROWN-UP WILL HELP |
| `OpenRemediation` | Opens the next round | Refuses a child (`status: unavailable`, `reason: remediation_capped`) and logs `school.remediation.capped {learnerId, unitId, depth}` |
| Teacher dashboard | — | `attention: [{kind: 'remediation-cap', unitTitle, depth, lastScore, …}]` on the learner's row, linked to the failed session |

A grown-up is never capped. "Offer another try" on the session page opens the
next round through the teacher gate (`openedBy`); if that round fails too, the
unit goes straight back to a hold, so the grown-up stays in the loop until the
work is passed or settled another way.

The hold is excused rather than faulted on purpose: nothing about the system
is broken, and a fault would leave the day `indeterminate` and the games
locked — the very outcome the cap exists to end. The subject does not vanish:
the paper still names the held lesson, the teacher dashboard counts it among
the subjects that need a grown-up, and it stays listed until someone acts.
