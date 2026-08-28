# Teacher console — flow coverage audit

**Date:** 2026-08-26
**Method:** model first, diff second. The complete state space is modeled in
[`docs/reference/school/teacher.md`](../../reference/school/teacher.md), derived
from `TRANSITIONS`, the obligation ladder in `agenda.mjs`, `joinLearnerDay`, and
`STEP_UP_ACTIONS`. This document diffs that model against the console's actual
UI and the actual API, **in both directions**:

- **Gaps** — a path the model says exists, with no affordance that reaches it.
- **Cruft** — a page, button, route, or client method with no unique path
  behind it: redundant, duplicated, unreachable, or promising something absent.

Every finding below was confirmed by reading the code, not inferred from the
feature list. Line references are against `1320b4639`.

---

## Summary

| | Count | Of which high |
|---|---|---|
| Gaps — model path with no affordance | 14 | 6 |
| Cruft — surface with no unique path | 11 | 3 |

**The headline:** three of the four things the flowchart was commissioned to
check — *issuing agendas, editing an enrollment, and clearing stuck work* — turn
out to have a modeled path that the console cannot walk. Two of them dead-end
in a pointer to a page that cannot do the thing. The fourth, grading and
changing grades, is the best-covered flow in the console.

---

## Part A — Gaps

### A1 · Stuck sessions past `submitted` are listed but unclearable — **HIGH**

`listStale` returns every non-terminal session untouched for 7+ days
(`MarkSessionAbandoned.mjs:66-86`). Every row renders an **Abandon…** button
(`panels/StaleSessions.jsx`). But `abandoned` is legal only from `created`,
`issued`, `reprinted`, the three dispatch states, and `media_stalled` —
`MarkSessionAbandoned.mjs:47-51` refuses everything else by name:

> `session … is submitted — that work settles through grading and close, not abandonment`

So a session wedged at `submitted`, `graded`, or `outcome_recorded` appears in
the panel that exists *precisely so somebody notices*, and the only button on
the row can never succeed. The refusal names the correct remedy — grading and
close — but the console has **no session-close verb and no manual grade path**,
and nothing links the stuck row to the review item that is blocking it.

**Model paths with no affordance:** `submitted → graded`, `graded →
outcome_recorded`, `outcome_recorded → rewarded` when the automatic path failed.

### A2 · An agenda cannot be issued from the console — **HIGH**

`TeacherAgendaDispatch` is complete: preview, `Idempotency-Key`,
`IDEMPOTENCY_CONFLICT` on payload mismatch, its own step-up action, and the real
receipt path. Routes exist (`school.mjs:1403,1409`). The client wrapper exists
(`teacherWorkspaceApi.js:65-75`).

**Nothing in the console calls either one.** Confirmed by grep: the only
non-test callers are `cli/school/ops.mjs:427` and the wrapper itself.

What the console *does* offer is the **preview** — the inert thermal PNG whose
tokens are `null` by construction. A teacher who wants to actually hand a child
today's agenda must drop to the CLI. This is the first of the four use cases
this audit was commissioned to check.

### A3 · Editing an enrollment is a three-hop dead end — **HIGH**

`AssignmentsView.jsx:141` tells the teacher:

> *"{course} has an enrollment — order and profile are edited from The whole school."*

"The whole school" is `SchoolMatrix` → `EnrollmentDrawer`. The drawer renders
syllabus, profile, and pass bar as a **read-only `<dl>` of facts**
(`EnrollmentDrawer.jsx:61-69`) and offers exactly three verbs: Enroll,
Re-materialize, Unenroll. There is no editor.

The true source is the **syllabus** — `EnrollLearner.mjs:145,147,168` copies
`profile` and `passing` off the syllabus record. And there is no syllabus editor
either (A4). So the pointer is not merely unhelpful, it is wrong, and the chain
terminates in hand-edited YAML.

### A4 · No syllabus authoring or archiving UI — **HIGH**

`PUT /lifecycle/syllabi/:id` and `POST /lifecycle/syllabi/:id/archive` are
implemented and guarded (`schoolLifecycle.mjs:563,572`), and the client has
`putSyllabus` / `archiveSyllabus` (`schoolApi.js:181-182`). **Zero callers.**

The consequence is visible in the enrollment drawer's own empty state: *"No
syllabus published for this course yet."* — a terminal sentence with no next
move. A course cannot be brought into service from the console at all.

### A5 · Faulted and excused obligations are invisible — **HIGH**

The obligation ladder distinguishes four states and eleven reasons, and the
newest work in this area exists specifically to separate *"the child is
excused"* from *"this is our fault"*: `faulted · program_unavailable` and
`faulted · blocked_unreachable` (`agenda.mjs:136,383`), the latter logging
`school.agenda.blocked-unreachable`.

`joinLearnerDay` reads `servedToday`, `suppressed`, `lockedRemedy`, `next`,
`servedWork`, `progressLabel`, and `progressRows`. **It never reads
`obligation`.** Confirmed by grep across the whole teacher module: the string
`obligation` does not appear in any frontend file.

So:

- A subject faulted because nothing can start its program renders no differently
  from a quiet day.
- `excused · caught_up` — *this course has no more lessons, assign more* — looks
  identical to `excused · not_due_yet`, which needs nothing.
- The two fault states fire a `warn` into the log store and nowhere else.

The teacher's only signal that a child's day is structurally broken is a log
line nobody reads.

### A6 · No "I can't tell" on a review item — **HIGH**

`ReviewQueueView` offers Correct and Incorrect. `VERDICTS` is
`new Set(['correct', 'incorrect'])` (`ResolveReviewItem.mjs:20`).

A teacher who genuinely cannot mark an item — an unreadable scan, a question
that needs the child present — must either guess or leave it pending. Leaving it
pending blocks the session from grading, which produces A1. The two findings are
one loop: the queue has no exit for uncertainty, and the stuck-session panel has
no way to clear what that uncertainty stranded.

### A7 · The session `reassigned` event has no writer — **MEDIUM-HIGH**

`reassigned` is a fully declared event: schema, validator (rejecting a
same-learner move), an `APPLY` handler that rewrites `state.learnerId`, and a
place in `ANNOTATION_EVENTS`. Grep for a writer across `backend/src`: **none
exists.**

Attribution repair does something different — `ReassignEvidence` moves *attempt
events* between learner shards. That means:

- `ReassignPanel` lists rows from `attempts-summary`, so work with **no machine
  attempts** — a program-served lesson, paper graded by hand, a launch outcome —
  cannot be moved to the right child at all.
- Because `reassigned` is not in `TERMINAL_ANNOTATIONS`, even if a writer
  existed it would be illegal on a `rewarded` session. Discovering the wrong
  name on a settled lesson has no repair path in either mechanism.

### A8 · The approver cannot see what they are approving — **MEDIUM**

`GET /print/printables/:printableId/preview` exists with this comment
(`school.mjs:378-380`):

> *"A read-only render of an authored printable — an approver should be able to see the sheet before saying yes."*

It is consumed by **`PrintCenter.jsx:159` — the child's own surface.**
`PrintPendingView` shows a name, a label, page count × copies, and a wait age.
The endpoint built for the approver is used by everyone except the approver.

### A9 · Approval carries no quota context — **MEDIUM**

`GET /print/quota?userId` exists and `PrintCenter` reads it for the child. The
approval panel never does. The teacher is deciding on an over-quota job without
being shown how far over, or what the child has already printed this window.

### A10 · A retake is offered once, then never again — **MEDIUM**

`WorkspaceViews.jsx:550`:

```js
const canOfferRetake = sessionState?.outcome?.result === 'needs_remediation'
  && !sessionState?.remediation;
```

`remediation` is set by the `remediation_opened` event and never cleared. If the
remediation session is then abandoned — or its ticket expires unscanned — the
parent session shows no retry affordance ever again, and the child's minted
ticket is dead. The lesson is stranded in `outcome_recorded · needs_remediation`
with no path forward for either party.

### A11 · No manual grade path — **MEDIUM**

`POST /lifecycle/sessions/:sessionId/grade` is implemented and guarded
(`schoolLifecycle.mjs:399`). There is no client method and no UI. When automatic
grading does not run — a scan that never produced attempts, a paper lesson
someone marked by hand — the only recorded route to a grade is the CLI. Feeds
A1.

### A12 · Four operational reads have no surface — **MEDIUM**

| Route | What it answers | UI |
|---|---|---|
| `GET /banks/health` | which quiz banks are malformed | none |
| `GET /audit?since=` | the household audit trail | none |
| `GET /learner/:id/record` | one learner's whole record | none |
| `GET /report-card/frozen/versions` | superseded freezes of a period | none |

The last is the sharpest: superseding a period *archives* the prior freeze
rather than destroying it, and the console cannot show what was archived. The
promise "the old record is preserved" is true and unverifiable from the UI.

### A13 · `timingAnchorId` cannot be set when enrolling — **LOW**

`POST /lifecycle/enrollments/:learnerId` accepts `timingAnchorId`
(`schoolLifecycle.mjs:586`). `EnrollmentDrawer` never sends it. Any enrollment
created from the console gets the default anchor.

### A14 · Lost answer cards have no console entry — **LOW**

`CreateLostAnswerSheetTicket` and `ReplaceLostAnswerSheet` are both teacher-gated
and complete, with routes at `/lifecycle/answer-sheets/:cardId/lost` and
`/lost-ticket`. The session inspector *displays* answer-card capacity and
warnings but offers no action. Grep for a frontend caller: none. The flow is
reachable only by scan or CLI. Arguably correct — a lost card is discovered at
the printer, not at a desk — but it should be a decision, not an omission.

---

## Part B — Cruft

### B1 · `LearnerOverview` is a pure alias — **TRIM**

`WorkspaceViews.jsx:202-208` renders `LearnerDayScreen` verbatim. Two routes
(`/students/:id/overview` and `/students/:id`) resolve to a third
(`/students/:id/day/:studyDay`). Kept deliberately for old bookmarks; the
comment says so. It should carry a removal date rather than living forever.

### B2 · `InterventionsIndex` renders on three pages — **DEDUPE**

`scopes={['school']}` renders in `CurriculumView` (both branches) *and*
`OperationsView`. `LearnerOperationsView` renders the learner scope. The index
exists to give every tool exactly one home; the index itself has three.

### B3 · The TODO registry is empty machinery — **TRIM OR JUSTIFY**

`todoRegistry.js` exports `TODO = {}` and `STUB_COPY = {}`, `StubCard.jsx` has no
caller, and `TeacherConsole.test.jsx` enforces drift between the two empty
objects. Retained on purpose "for the next programme's placeholders". That is a
defensible choice, but it is currently three files and a test guarding nothing.

### B4 · An unfunded promise on School Operations — **REMOVE**

```jsx
<CapabilityNotice>Device health and retained-artifact audit will appear here
when their teacher read models are available.</CapabilityNotice>
```

Both read models partly exist (A12: `banks/health`, `audit`). The notice is
either a gap statement in the wrong place or drift. Delete it or wire it.

### B5 · Ten dead client methods — **TRIM**

Zero non-test callers:

| File | Methods |
|---|---|
| `schoolApi.js` | `syllabus`, `putSyllabus`, `archiveSyllabus`, `certificate`, `transcript`, `teacherNotes` |
| `teacherWorkspaceApi.js` | `agendaDispatch`, `agendaDispatchPreview`, `artifactPostview`, `answerSheet`, `learnerAnswerSheets` |

Two different causes, and they need opposite treatment. `putSyllabus`,
`agendaDispatch`, and `artifactPostview` are **gaps wearing cruft's clothes** —
the wrapper is right, the caller is missing (A2, A3, A4). `transcript` is true
cruft: `RecordsTab` builds the same URL by hand as an `<a href>`, so the method
is redundant, not unreached.

### B6 · Two digest endpoints, one screen — **CONSOLIDATE**

`TodayTab` calls `schoolApi.teacherDay ? teacherDay() : teacherToday()`. The v1
digest is legacy and flattens rows into a title-only shape. Keeping a runtime
feature-detect for an endpoint that always exists is a fossil.

### B7 · Two URLs for one console — **DECIDE**

`/school/teacher` and `/school/teacher-next` both mount `TeacherConsole`, plus an
`/app/school/teacher` redirect. The "-next" alias was additive during the
rebuild; the rebuild landed.

### B8 · Stale docblocks that now mislead — **FIX**

- `FrozenHistory.jsx:4` — *"Closing a period from here is the
  teacher.period.close stub until its wave."* It shipped; `ClosePeriodPanel`
  renders directly below.
- `AssignmentsView.jsx:141` — the copy in A3, which sends a teacher to a page
  that cannot do the thing.

### B9 · The Reports page carries seven panels — **REVIEW, don't trim blind**

`ReportCardView`, `PacingPanel`, `FrozenHistory`, `ClosePeriodPanel`, a
transcript pill, `CurriculumHistoryOverview`, `InstructionalInsightsOverview`.
Each is independently justified; the page as a whole has no stated reading
order, and the densest page in the console is the one a teacher visits under the
most time pressure. Flagged for a density pass, not for deletion.

### B10 · Inconsistent preview labels — **POLISH**

`Preview` (exception), `Preview correction`, `Preview retraction`, `Preview
regrade`, `Print another copy…` then `Print now`. The house pattern is
`Preview <noun>`; one button breaks it.

### B11 · `GET /teacher/today` vs `GET /teacher/day` naming — **POLISH**

Two endpoints one word apart, where the newer one supersedes the older and
takes a `studyDay` param that makes "today" a misnomer in both.

---

## Part C — does each page earn its place?

| Page | Verdict | Why |
|---|---|---|
| Dashboard | **Earns it** | the only home of the digest; backlog strip is a summary, not a duplicate |
| Action queue | **Earns it** | three backlogs, item-level, nowhere else |
| Curriculum | **Earns it** | catalog, pass bars, matrix, enrichment — but drop the duplicated interventions index (B2) |
| School operations | **Earns it** | exceptions, stuck sessions, overrides, periods, regrade — remove the empty promise (B4) |
| Learner · Day | **Earns it** | the organizing unit; every other view links here |
| Learner · Courses | **Earns it** | assignments, piano programs, milestones |
| Learner · History | **Earns it** | timeline + feedback as separate evidence lanes |
| Learner · Reports | **Earns it, densest** | see B9 |
| Learner · Operations | **Earns it** | attestation and reassignment have one home each |
| Learner · Overview | **Does not** | pure alias (B1) |
| Session inspector | **Earns it** | the only place grade correction lives |

**No page is redundant. Nine of eleven are load-bearing.** The console's problem
is not too many pages — it is that six modeled paths have no page at all, and
two pages point at each other for a capability neither has.

---

## What this changes

The remediation plan is
[`docs/_wip/plans/2026-08-26-teacher-coverage-remediation.md`](../plans/2026-08-26-teacher-coverage-remediation.md).

Two findings deserve to be read as one story rather than two tickets:

**A1 + A6 + A11 are a single closed loop.** A review item with no "I can't tell"
exit strands a session at `submitted`; a stranded session appears in a panel
whose only button refuses it by name; the remedy the refusal names — grade and
close — has no console verb. Fixing any one of the three alone leaves the loop
intact.

**A2 + A3 + A4 are a single missing layer.** Syllabus authoring, enrollment
editing, and agenda dispatch are the three places where the console reads the
plan but cannot write it. Each independently ends at "use the CLI" or "edit the
YAML", and A3's pointer actively misdirects.
