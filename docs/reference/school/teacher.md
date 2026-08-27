# Teacher — every flow a grown-up can drive

> **Code map:** [`frontend/src/modules/School/teacher/README.md`](../../../frontend/src/modules/School/teacher/README.md)
> — screen-element → file lookup. Read that when the question starts from
> something on screen. Read *this* when the question starts from a state:
> "the work is sitting in X — what can a teacher do about it?"

This document is the **complete state space of adult intervention** in School.
Every lifecycle a child's work passes through, every state it can rest in,
every transition out of that state, and — for each one — which human decision
reaches it, where that decision lives in the console, and what it costs in
authority.

It is derived from the state machines themselves, not from the feature list:
`sessions/sessionEvents.mjs#TRANSITIONS`, `agenda.mjs`'s obligation ladder,
`learnerDay.js#joinLearnerDay`, and the gate declarations in
`TeacherCapabilitySessions.mjs`. Where the model says a path exists, the path
exists whether or not a button does.

---

## 1. Who a teacher is, and what authority costs

A teacher is **config-declared, never age-derived**: `school.yml` → `teachers:`
lists roster ids, and `GET /teachers` resolves them against the live roster per
request. When the key is absent the gate falls back to any adult — role is
authority, and a pre-console install keeps working.

Three tiers of authority, and every write names its tier.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Anonymous
    Anonymous --> Claimed: pick a teacher in the profile picker
    note right of Claimed
        Attribution only.
        sessionStorage. Buys nothing.
    end note
    Claimed --> Unlocked: POST auth/unlock with the console PIN
    Unlocked --> Claimed: idle 10 min / absolute 30 min / Lock / server restart
    Unlocked --> Granted: POST auth/step-up, action + resource
    Granted --> Unlocked: grant spent, or 2 min elapsed
    Unlocked --> [*]
```

| Tier | Carrier | Lifetime | Buys |
|---|---|---|---|
| **Claim** | `sessionStorage`, client-side | until the tab closes | attribution on writes — nothing else |
| **Capability** | HttpOnly `SameSite=Strict` cookie | 10 min idle, 30 min absolute | every ordinary teacher write |
| **Step-up grant** | `X-Teacher-Step-Up` header | 2 min, **one use**, scoped to one action *and one resource id* | the six high-consequence actions below |

The PIN exists only inside the prompt. It is never in React state, never in
`sessionStorage`, never in a log, and never in an ordinary mutation body.

**The six step-up actions** (`TeacherCapabilitySessions.mjs#STEP_UP_ACTIONS`),
with the resource each is scoped to:

| Action | Scoped to | Why it costs extra |
|---|---|---|
| `agenda.dispatch` | `learnerId` | mints tokens and drives a physical printer |
| `attempts.regrade` | `bankId` | rewrites what a batch of history *means* |
| `sessions.grade-adjust` | `sessionId` | overrides a machine verdict about a child |
| `sessions.grade-adjustment.retract` | `sessionId/adjustmentId` | withdraws that override |
| `artifact.postview` | `artifactId` | renders a marked-up copy of a child's work |
| `report-card.close` | `learnerId/periodId` — **only when `supersede: true`** | replaces a record a family already has |

A first freeze of a period needs the capability only. Re-closing one needs a
grant, because the record already exists in someone's hands.

**A 403 is a loop, not a wall.** `useTeacherWrite` invalidates the capability,
opens the PIN prompt, and replays the blocked call exactly once. A tap made
before any teacher is claimed is stashed and replayed after the picker
resolves; a *cancelled* picker drops the stash rather than firing it later as a
ghost write.

---

## 2. The navigation graph

Every URL is complete workspace state — deep-linkable, refresh-safe,
back-button-safe.

```mermaid
flowchart TD
    subgraph global["Global — household scope"]
        DASH["/school/teacher<br/>Dashboard: today's digest"]
        QUEUE["/queue<br/>Action queue"]
        CURRIC["/curriculum<br/>Published curriculum"]
        OPS["/operations<br/>School operations"]
    end
    subgraph learner["Learner scope — /students/:learnerId"]
        DAY["/day/:studyDay<br/>The Learner Day"]
        COURSES["/courses<br/>Courses and enrollment"]
        HIST["/history<br/>Sessions and feedback"]
        REPORTS["/reports<br/>Records and grades"]
        LOPS["/operations<br/>Repair this child's record"]
    end
    SESSION["/sessions/:sessionId<br/>Session inspector"]

    DASH -->|learner row| DAY
    DASH -->|backlog strip| QUEUE
    DASH -->|lesson card| SESSION
    DAY -->|lesson row| SESSION
    HIST -->|session row| SESSION
    HIST -->|day heading| DAY
    SESSION -->|"Give credit for work you saw"| LOPS
    CURRIC -->|course card| CURRIC
    OPS -.->|interventions index| LOPS
    CURRIC -.->|interventions index| OPS
```

`/students/:id` and `/students/:id/overview` both resolve to the Day. A
learner id that is no longer on the roster renders a named "Student not found"
screen, not an empty page; an unparseable path renders "Page not found".

**The Learner Day is the organizing unit.** It joins two side-effect-free
reads — the plan (`agenda/preview?format=json&studyDay=…`) and the record
(`teacher/day?studyDay=…`) — through the pure `joinLearnerDay`. Previewing a
day never writes, for today or any other day.

---

## 3. The work-session lifecycle

This is the spine. A work session is an **append-only event log**; its state is
derived on every read, never stored. The transition table below is the closed
map — `TRANSITIONS` in `2_domains/school/sessions/sessionEvents.mjs`.

```mermaid
stateDiagram-v2
    [*] --> created: agenda minted this lesson

    created --> issued: paper printed
    created --> media_dispatched: video sent to a screen
    created --> launch_dispatched: activity handed to a surface
    created --> program_dispatched: program day started
    created --> external_activity_dispatched: sent to Fitness
    created --> abandoned: teacher closes it out

    issued --> reprinted: another copy
    issued --> submitted: work comes back
    issued --> abandoned

    reprinted --> reprinted
    reprinted --> submitted
    reprinted --> abandoned

    media_dispatched --> media_completed
    media_dispatched --> media_stalled
    media_dispatched --> abandoned
    media_stalled --> media_dispatched: replay
    media_stalled --> abandoned
    media_completed --> issued: now print the questions
    media_completed --> submitted

    launch_dispatched --> outcome_recorded
    launch_dispatched --> abandoned
    program_dispatched --> outcome_recorded
    program_dispatched --> abandoned
    external_activity_dispatched --> external_activity_assessed
    external_activity_dispatched --> abandoned
    external_activity_assessed --> outcome_recorded

    submitted --> graded
    graded --> outcome_recorded
    outcome_recorded --> rewarded
    outcome_recorded --> remediation_opened: needs another try

    rewarded --> [*]
    remediation_opened --> [*]
    abandoned --> [*]
```

**Three terminal states**: `rewarded`, `remediation_opened`, `abandoned`.
Everything else is non-terminal and, by the reducer's own property test, has a
non-null `nextAction` — a state a child can be stuck in with no printed next
move is the failure this machine exists to forbid.

### Annotations — facts that do not advance the state

| Event | Meaning | Legal at a terminal state? |
|---|---|---|
| `failed` | a print attempt never reached paper | no |
| `reassigned` | the work belongs to a different child | **no** |
| `grade_adjusted` / `grade_adjustment_retracted` | a teacher corrected the mark | yes |
| `reward_reconciled` / `reward_reconciliation_failed` | coins follow a corrected grade | yes |
| `result_receipt_captured` / `result_receipt_reprinted` | settlement evidence | yes |

`failed` is deliberately non-advancing: the same ticket stays valid, so the
next scan retries. It does not touch `lastPrintedAt`, so a print that failed is
retryable immediately rather than blocked by the cooldown.

### What a teacher can do, per state

| Session state | Teacher's move | Where | Gate |
|---|---|---|---|
| `created` | abandon with a reason | Operations → Stuck sessions | capability |
| `issued` / `reprinted` | reprint the exact artifact; abandon | Session inspector → Issued materials; Operations | capability |
| `media_dispatched` / `media_stalled` | abandon | Operations | capability |
| `submitted` | resolve the review items that block grading | Queue → Grading and review | capability |
| `graded` | correct the mark; retract a correction | Session inspector → Fix a marked answer | **step-up** |
| `outcome_recorded` (`needs_remediation`) | offer another try | Session inspector → Offer another try | capability |
| `rewarded` | correct the mark — the effective grade and its reward reconcile | Session inspector | **step-up** |
| any | give credit for work the tech lost — attest the unit | Student → Operations | capability |
| any | move the work to the right child | Student → Operations | capability |

**Abandonment is not available everywhere.** `abandoned` is legal only from
`created`, `issued`, `reprinted`, `media_dispatched`, `media_stalled`,
`launch_dispatched`, `program_dispatched`, and
`external_activity_dispatched` — work that was handed out and never came back.
Work that came back settles through grading and close, never through
abandonment, and `MarkSessionAbandoned` refuses the difference by name.

---

## 4. The day: obligation, and what the dashboard says

Two vocabularies sit on one screen and they answer different questions. The
**obligation** is the planner's verdict about a subject. The **row status** is
the dashboard's verdict about a lesson.

### Obligation — per subject, per day

```mermaid
flowchart TD
    START["Subject, this study day"] --> SERVED{"Non-elective work<br/>passed or program done?"}
    SERVED -->|yes| S["served"]
    SERVED -->|no| ACT{"Anything actionable?"}

    ACT -->|"nothing actionable"| LADDER["Walk the excuse ladder<br/>first match wins"]
    LADDER --> L1["elective_only"]
    LADDER --> L2["program_unavailable → FAULTED"]
    LADDER --> L3["blocked_no_offer — blocker is reachable"]
    LADDER --> L4["blocked_unreachable → FAULTED"]
    LADDER --> L5["awaiting_grown_up"]
    LADDER --> L6["opens_later"]
    LADDER --> L7["caught_up"]

    ACT -->|"all backlog"| B["excused · optional_backlog"]
    ACT -->|"all not yet due"| D["excused · not_due_yet"]
    ACT -->|otherwise| O["obligated"]

    S --> NS{"Not a school day?"}
    O --> NS
    NS -->|yes, and not served| NSE["excused · not_a_school_day"]
    O --> FOCUS{"Suppressed by a focus subject?"}
    FOCUS -->|yes| SUP["excused · suppressed_by_focus"]
```

Four obligation states — `served`, `obligated`, `excused`, `faulted` — and the
*reason* is the whole point. `faulted` is reserved for two reasons only:
`program_unavailable` and `blocked_unreachable`. Everything else is an excuse
with a truthful name, because a date arriving on its own and a grown-up who can
be asked are not faults.

**The distinction that exists because of a real incident:** being blocked by a
sibling lesson the child can still reach *excuses* the day; being blocked by
something nothing can reach is a **fault**, and it logs
`school.agenda.blocked-unreachable`. A program that nothing can start is
reported, not planned.

| Obligation state | What it means for the teacher | The move |
|---|---|---|
| `served` | done — nothing owed | none |
| `obligated` | the day still owes this | let the child work it, or excuse/defer the lesson |
| `excused · caught_up` | there is no more of this course | assign more, or accept |
| `excused · awaiting_grown_up` | a dormant unit needs a grown-up to open it | act on the unit |
| `excused · opens_later` | a dated module has not opened | wait, or move the window |
| `excused · optional_backlog` | only catch-up work remains | optional |
| `excused · not_due_yet` | available but not due | optional |
| `excused · elective_only` | only electives are on offer | optional |
| `excused · blocked_no_offer` | locked behind a reachable sibling | clear the blocker, or excuse it |
| **`faulted · blocked_unreachable`** | locked behind something nothing can reach | **curriculum repair** |
| **`faulted · program_unavailable`** | the program itself cannot start | **fix the program** |

### Row status — per lesson, on the dashboard

`joinLearnerDay` decides progress from the planner's verdict, then a recorded
score, then the session state. Provenance is a *flag beside* the status, never
a status value — `status` means progress for every row.

```mermaid
flowchart LR
    R["A lesson row"] --> V{"Planner says served?"}
    V -->|yes| DONE["done"]
    V -->|no| SC{"A recorded score?"}
    SC -->|yes| DONE
    SC -->|no| ST{"Session state"}
    ST -->|"issued / reprinted / dispatched / submitted"| IP["in-progress"]
    ST -->|"created or none"| PL["planned"]
    ST -->|"deferred by exception"| DEF["deferred"]
    ST -->|"locked"| BL["blocked"]
    DONE -.-> F["flags: unplanned · carriedOver"]
    IP -.-> F
    PL -.-> F
```

A recorded score outranks a missing `state`: marks exist only for work that
happened. A missing `artifacts` key is not an empty one — the "no worksheet"
sentence fires only when the field is present and both members are empty,
because announcing it on silence would invent a fact.

---

## 5. Grading, review, and correction

Four distinct mechanisms, deliberately not collapsed into one. Each writes a
different kind of evidence.

```mermaid
flowchart TD
    SUB["Work submitted — paper scanned or screen answered"] --> AUTO["The one grading engine marks what it can"]
    AUTO --> AMB{"Anything it could not mark?"}
    AMB -->|no| GRADED["graded event · percent + the passing bar in effect"]
    AMB -->|"ambiguous · blank · free_response"| Q["Review queue — one item per question"]

    Q --> RES["Teacher marks it Correct or Incorrect<br/>plus an optional note the child receives"]
    Q --> VOID["Teacher marks it Can't mark this<br/>note REQUIRED — the child is told why"]
    VOID --> DEN["The question leaves the denominator"]
    DEN --> LAST
    RES --> LAST{"Last pending item<br/>on this session?"}
    LAST -->|yes| GRADED
    LAST -->|no| Q

    GRADED --> OUT["outcome_recorded · passed or needs_remediation"]
    OUT --> ADJ["Fix a marked answer<br/>percent, or per-question verdicts"]
    ADJ --> EFF["grade_adjusted — the machine grade survives underneath"]
    EFF --> RETR["Retract the correction"]
    RETR --> EFF2["Effective grade reverts. The correction stays in history."]

    GRADED --> BULK["Systematic regrade — a whole bank over a date range"]
    BULK --> CORR["Corrective attempts appended with provenance<br/>originals never edited"]
```

**The review queue.** Items carry the reason the machine gave up
(`ambiguous`, `blank`, `free_response`), the marking guide when the bank
authored one, the child's given answer, and how long they have been waiting. A
verdict plus an optional ≤120-character note — the same cap receipts and
agendas enforce, because the note is delivered to the child.

**Three verdicts, not two.** A teacher who genuinely cannot mark something —
an unreadable scan, a question that needs the child in the room — chooses
**Can't mark this** (`void`). That question leaves the score's **denominator**:
the percent becomes "of the questions we could mark", and the `graded` event
stamps `voidedItemIds` so a later reader can tell a 6-of-8 that was voided down
from nine apart from one that was always eight. A voided item is never counted
wrong, and it resolves its queue row like any other verdict, so it stops
holding the session open. **Its note is mandatory** — a question dropped from a
child's score without a sentence they can read is the silent verb this
household does not allow.

If voiding leaves **nothing** markable, the session is not graded at all —
`graded` requires a total of at least one — and it waits to be settled by hand.

With both finishers wired, resolving the **last** pending item of a session
grades and closes it in the same act. Without them, resolve-only.

**Corrections are annotations, never replacement grades.** The original
`graded` event remains machine evidence forever. `gradeAdjustments` accumulate;
the last non-retracted one is the effective interpretation that reports and
gates read. If both an effective percent and a passing bar exist, the *outcome*
re-derives too — a correction can turn `needs_remediation` into `passed`.

**The bar cannot move under a graded child.** `graded` stamps
`passingPercent` — the bar in effect at grading time. A later pass-override
edit is read by `CloseSessionOutcome` only for work not yet graded.

**Regrade is a different animal.** It re-runs the same `gradeAnswer` over
recorded attempts against the bank's *current* content, and appends corrective
attempts with `provenance: { kind: 'regrade', of, by, reason }`. Dry run by
default, reason required, self-graded flashcard rows skipped. Report cards are
**not** re-frozen — the report names the affected sessions so a teacher
supersedes deliberately.

| Correction mechanism | Scope | Writes | Gate |
|---|---|---|---|
| Resolve a review item | one question | queue verdict + child note | capability |
| Fix a marked answer | one session | `grade_adjusted` | **step-up** |
| Retract a correction | one adjustment | `grade_adjustment_retracted` | **step-up** |
| Systematic regrade | one bank × date range | corrective attempts | **step-up** |

Every one of the four is preview-first. Nothing applies on the first tap.

---

## 6. Paper — issuing, reprinting, and receipts

```mermaid
flowchart TD
    subgraph agenda["The day's agenda"]
        PREV["Preview — the exact thermal PNG<br/>tokens null, tokenClass 'preview'<br/>every offer relabelled 'ask a grown-up'"]
        DISP["Dispatch — mints tokens and prints for real<br/>Idempotency-Key required"]
    end
    subgraph worksheet["One lesson's paper"]
        TICKET["Child scans their ticket"] --> ISSUE["issued — artifact retained"]
        ISSUE --> RE["Reprint — the SAME artifactId<br/>lineage rule: a reprint is not new work"]
        RE --> ISSUE
    end
    subgraph settle["After it settles"]
        RECEIPT["result_receipt_captured"] --> RRE["Reprint the receipt"]
        CORRECT["A grown-up changed the result"] --> CRECEIPT["result-correction receipt<br/>non-printing, immutable"]
    end
    ISSUE --> SUBMIT["Submitted"] --> RECEIPT
    POST["Postview PDF — the child's sheet with the marks on it"]
```

**Preview and dispatch are different verbs and must stay that way.** The
previewed sheet's QR and digit codes are inert *by construction* — nothing is
minted, for today or any day. Dispatch requires an `Idempotency-Key`; reusing
one with a different payload is an `IDEMPOTENCY_CONFLICT`, not a second print.

**A reprint reuses the original `artifactId`.** Reprinting under a fresh id
would make one worksheet look like two pieces of work. Only artifacts whose
`availability` is `exact` — the retained bytes, not a reconstruction — offer a
reprint; a thumbnail is a view of those bytes, and a corrupt retained PDF
degrades the card to its no-thumbnail state rather than surfacing a 500.

**The print cooldown arms from confirmed prints only.** A `failed` annotation
never touches it, and an `issued` event carrying `confirmed: false` — a
simulator or preview path saying "I did not send this anywhere" — does not arm
it either. `firstIssuedAt` is set once and never moves, because a week-old
session reprinted this morning is still a week old.

**Answer cards.** A session's answer sheets carry a student number, capacity,
rows used, remaining contiguous slots, and warnings. A lost physical card has a
teacher-authorized recovery path: a 15-minute one-card ticket, then a
replacement that reissues **live allocations only** — settled work stays
immutable evidence, and each replacement prints successfully before the old
allocation is superseded, so a printer failure never destroys the child's only
usable copy.

### Print requests a child files

```mermaid
stateDiagram-v2
    [*] --> requested: child asks for a printable
    requested --> printed: within the rolling page quota
    requested --> pending: over quota
    pending --> printed: teacher approves — approver stamped in the log
    pending --> denied: teacher denies
    denied --> [*]: retained 30 days, visible to the child as "your asks"
    printed --> [*]
```

An approver can read the sheet before saying yes: `previewPrintable` is the
same resolve the print path uses, minus every side effect — no quota check, no
print, no log.

---

## 7. Enrollment — what a child is signed up for

Two layers, and conflating them is the classic mistake. **Assignment** is
"this course is on this child's list." **Enrollment** is a materialized
snapshot of a syllabus: module order, optional modules, a frozen `lessonOrder`,
and a copy of the progression policy.

```mermaid
stateDiagram-v2
    [*] --> unassigned
    unassigned --> assigned: tick the course in Assignments
    assigned --> enrolled: Enroll from a published syllabus
    unassigned --> enrolled: Enroll from the school matrix
    enrolled --> enrolled: Re-materialize — order is REPLACED
    enrolled --> unassigned: Unenroll
    assigned --> unassigned: untick

    state enrolled {
        [*] --> managed: has a syllabusId
        [*] --> handwritten: no syllabusId — flagged, still first-class
    }
```

**Materialization is a snapshot, on purpose.** `lessonOrder` is persisted
precisely so a `shuffle_once` order cannot move under a child mid-course —
which means a later syllabus edit does not reach existing enrollments.
Re-materializing is the explicit act.

**Two refusals, same reason.** Re-materializing and unenrolling are both
refused while any session on that course is open: a lesson leaving the
enrollment under an open session strands that session forever, off the agenda
and impossible to finish.

**Structural changes are two-tap.** Enroll, re-materialize, and unenroll each
arm first with a sentence naming the consequence, then act.

**Three pathologies only the whole-school grid can see:**

| Pathology | What it looks like | Why it matters |
|---|---|---|
| **Dead reference** | an assignment naming a course the catalog no longer publishes | the planner silently omits that subject from the child's day |
| **Zero-enrollment course** | a published course no child is assigned | authored work nobody receives |
| **Orphan record** | an assignment record for an id not on the roster | a departed or renamed learner still holding courses |

Editing assignments **round-trips whatever the record already held**: a checked
id that carried an enrollment block keeps the entire object. Flattening it to a
bare id would silently destroy the enrollment. Stale ids the catalog no longer
publishes still render with a checkbox and a "not in catalog" tag — before
that, they were un-untickable and re-saved verbatim forever.

Concurrent-edit guard: the save carries `baseUpdatedAt` from the read the
editor started at, and a stale save is refused with a reload message rather
than clobbering.

---

## 8. Changing the curriculum for a child

Four decisions, one form, and the *effects* differ in exactly the way the names
promise.

```mermaid
flowchart TD
    P["Something is wrong with the lesson itself"] --> K{"Which decision?"}
    K -->|"the child should skip it"| E["excused · learner-scoped"]
    K -->|"later, not never"| D["deferred · learner-scoped"]
    K -->|"do this one instead"| R["replaced · learner-scoped + replacement id"]
    K -->|"nobody should get this"| PA["paused · GLOBAL, no learner"]

    E --> EF1["advancesGate: satisfied without mastery"]
    R --> EF1
    D --> EF2["remainsOutstanding: still owed"]
    PA --> EF3["blocksNewWork: nobody is offered it"]

    EF1 --> RET["Retract — reason required"]
    EF2 --> RET
    EF3 --> RET
```

- `paused` is **global and cannot name a learner**, and its reason comes from a
  closed set: `defective`, `garbled`, `missing`, `broken`, `inappropriate`.
  A free-text reason is for the learner-scoped kinds.
- `replaced` requires a replacement lesson that exists in the catalog.
- A target can be a **lesson** or a whole **module**; a module target resolves
  to every published unit in it, optionally narrowed by course.
- **No default is preselected.** The most drastic decision must never be the
  zero-interaction path.
- Preview first, apply second. The preview states the gate effect in one line.

**Nothing here edits authored curriculum.** Exceptions are data with an audit
trail; courses stay reviewed YAML.

---

## 9. Overrides, credit, and the eraser

Three append-only logs, each its own evidence kind, each retractable, and the
differences between them are load-bearing.

```mermaid
flowchart LR
    subgraph att["Attestation — 'I verify this was done'"]
        A1["Unit + mandatory reason"] --> A2["Planner and milestones<br/>see a synthetic pass"]
        A2 --> A3["The report card<br/>NEVER reads it"]
        A2 --> A4["Retract → gates re-lock<br/>and the child is told"]
    end
    subgraph enr["Enrichment log"]
        E1["kind: enrichment<br/>counts as credit"]
        E2["kind: absence<br/>excuses pacing ONLY, never credit"]
    end
    subgraph note["Teacher notes"]
        N1["A sentence to the child"] --> N2["Rides the same delivery as review notes"]
    end
```

**Attestation is the "the tech failed a child who did the work" tool.** It
unlocks the next lesson for real — `BuildAgenda` and `ResolveSubjectNext` fold
an attested unit into history as a synthetic pass, and milestones count it met.
The report card deliberately never reads it: an override is its own evidence
kind, not an engine grade. And the **daily-serving layer reads raw history**,
so a repair day still offers the work.

Retracting an attestation re-locks the gates it opened *by construction* —
every reader folds retractions out. The child hears about it, rather than
discovering a lock reappeared.

**Pass-criteria overrides** are the fourth override surface: a per-unit bar
that beats the authored `passing.percent`, consumed at exactly one point
(`CloseSessionOutcome`). A course-level bar is a bulk write over the same
per-unit store — one concept, not two. Garbage input must never become a
silent *clear* of a real override, so the field validates 1–100 before it
writes.

All four surfaces are readable in one place — what is overridden right now, by
whom, since when.

---

## 10. Attribution repair

The wrong child's name on a lesson is repaired by **moving the evidence
itself**, not by annotating around it.

```mermaid
flowchart LR
    D["Pick a day with recorded work"] --> L["Load that day's assessments"]
    L --> T["Choose the sibling it belongs to"]
    T --> M["Move the attempt events between learner shards"]
    M --> P["Provenance stamped into each moved event:<br/>reassignedFrom · reassignedBy · reassignedAt"]
    P --> R["Every derived rollup follows the evidence"]
```

Destination shard is written first and gated: a corrupt destination refuses the
move rather than half-completing it. A reassignment to the same learner is
rejected outright — it records no fact and would still rewrite attribution
downstream.

---

## 11. Periods and the permanent record

```mermaid
stateDiagram-v2
    [*] --> live: the period is open — the card is computed on every read
    live --> frozen: Close this period
    frozen --> frozen: Supersede and re-close
    note right of frozen
        A plain re-close is REFUSED.
        Supersede archives the current
        freeze to periodId.v(n).yml FIRST,
        then writes the new one.
    end note
    frozen --> [*]
```

The confirm is honest *before* the act: it names the period and says how many
items still await a mark. Freezing lives below the live card, with the closed
periods — the most destructive verb on the page does not sit above the fold.

**Editing the calendar preserves boundaries.** Period instants carry a
timezone-offset time of day. An untouched date round-trips the original instant
verbatim; an edited date keeps the original time-of-day suffix. A label typo
fix can never shift a period boundary by hours. An existing period's **id is
settled** — renaming the label never silently rekeys the frozen records that
hang on it. Removing a period arms a warning first, because frozen report cards
keyed to it stop resolving.

**Clone forward a year** is next August's admin chore in one tap: dates shift
by a year, ids and labels bump the year where one appears, and paired spans go
`2026-27 → 2027-28`, never `2027-27`.

Documents that fall out of the record: the report card (live and frozen, with
`unresolvedUnits` flagged so catalog drift never erases grades), the transcript
PDF, the progress report where an enrichment-covered milestone reads
**excused — never delinquency**, the syllabus PDF, and a course-completion
certificate that **refuses a course with nothing graded** — no fabricated
diplomas.

---

## 12. What a child can ask for

Children file three kinds of request, and every one of them ends in a sentence
from a grown-up. This is the *no silent verbs about children* contract.

```mermaid
flowchart TD
    K1["Retake — 'I want another try'"] --> BL["Teacher backlog"]
    K2["Flag — 'something seems wrong'"] --> BL
    K3["Quiz request — a gated unit with no bank"] --> BL
    BL --> F{"Resolution"}
    F -->|"a bank bound to the unit now exists"| AUTO["Auto-badged 'bank authored'"]
    F -->|"teacher dismisses"| DIS["Reason REQUIRED<br/>delivered to the child as a note"]
```

A dismissal without a reason is not possible: the reason *is* the delivery. The
dismissal targets exactly one row — kind and session id ride along, because a
retake ask and a flag on the same bank are different sentences.

---

## 13. Stuck work

```mermaid
flowchart LR
    S["Non-terminal, untouched for 7+ days"] --> LIST["Stuck sessions — roster-wide"]
    LIST --> C{"Does the state accept 'abandoned'?"}
    C -->|yes| A["Abandon with a mandatory reason"]
    C -->|"no — submitted, graded, outcome_recorded"| G["Settles through grading and close"]
```

Household-scoped by design, not per-learner: a wedged session is an operational
leak whoever it belongs to, and the point is that somebody finally notices. A
nightly sweep closes out work that was handed to a child and never came back;
before it existed, the threshold on the manual route was never once consulted.

---

## 14. The intervention chooser

The one index of "something went wrong — what do I use?" Every tool has
**exactly one home**; the index is the only thing that lists them.

```mermaid
flowchart TD
    W["Something is wrong"] --> Q1{"What is wrong?"}

    Q1 -->|"the mark is wrong"| M1["Fix a marked answer<br/>→ session inspector"]
    Q1 -->|"they should try again"| M2["Offer another try<br/>→ session inspector"]
    Q1 -->|"they did it, the tech lost it"| M3["Give credit for work you saw<br/>→ student · Operations"]
    Q1 -->|"wrong child's name on it"| M4["Move work to the right child<br/>→ student · Operations"]
    Q1 -->|"the lesson itself is broken"| M5["Excuse, postpone, swap, or stop<br/>→ school · Operations"]
    Q1 -->|"a lesson is stuck open"| M6["Clear a lesson that never finished<br/>→ school · Operations"]
    Q1 -->|"a rule was wrong for many"| M7["Re-mark a whole batch<br/>→ school · Operations"]
    Q1 -->|"what is already changed?"| M8["Active overrides<br/>→ school · Operations"]
```

Use the **narrowest intervention that matches what actually happened**. Every
write is attributed and auditable.

---

## 15. Invariants this surface holds to

1. **No silent verbs about children.** Every adult action whose subject is a
   child produces one child-readable sentence. Dismissals, abandonments,
   attestation retractions, and review verdicts all carry a mandatory or
   optional note that is *delivered*, not filed.
2. **Preview before apply, everywhere consequential.** Exceptions, grade
   corrections and their retractions, regrades, reprints, agenda dispatch.
   Nothing consequential happens on a first tap.
3. **Append-only, always.** Nothing is edited in place. A correction is a new
   fact that outranks an old one; the old one stays readable.
4. **The record is not the presentation.** The machine grade survives under
   every correction. The report card ignores attestations. Regrades do not
   re-freeze report cards.
5. **A stale save is refused, never merged.** Assignments carry
   `baseUpdatedAt`; periods and milestones carry `baseHistoryLength`; grade
   adjustments carry `baseSeq`.
6. **Panels fail alone.** Every panel fetches independently across five states
   — `loading | error | empty | unavailable | ok`. One dead endpoint never
   blanks a page, and a 404 maps per read: a missing lifecycle route is
   `unavailable`, an unassigned learner is `empty`.
7. **Reads never write.** Agenda preview, report-card reads, and the print
   preview are side-effect-free by construction, not by convention.

---

## Related

- [`README.md`](README.md) — the school reference index; §"The teacher console"
- [`agenda-and-completion.md`](agenda-and-completion.md) — how sections, `servedToday`, and obligation are derived
- [`print-documents.md`](print-documents.md) — worksheets, receipts, OMR grading
- [`enrollment.md`](enrollment.md) — syllabi, materialization, progression policy
- [`operations.md`](operations.md) — day-to-day running
- [`../../runbooks/school/README.md`](../../runbooks/school/README.md) — troubleshooting, hardware, logs
