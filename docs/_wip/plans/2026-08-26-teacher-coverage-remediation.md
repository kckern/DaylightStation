# Teacher console — closing the coverage gaps

**Date:** 2026-08-26
**Model:** [`docs/reference/school/teacher.md`](../../reference/school/teacher.md)
**Audit:** [`docs/_wip/audits/2026-08-26-teacher-flow-coverage.md`](../audits/2026-08-26-teacher-flow-coverage.md)

Fourteen gaps and eleven pieces of cruft, sequenced into five waves. Every
design decision the audit surfaced is **settled here** rather than listed as an
open question; where a decision could reasonably have gone the other way, the
reasoning is stated so a reviewer can overturn it deliberately.

Waves are ordered by dependency, then by how badly a teacher is stranded today.

---

## Wave 1 — The stranded-work loop (A1 · A6 · A11)

These three are one closed loop and must land together. A review item with no
honest exit strands a session at `submitted`; the stuck-session panel's only
button refuses that state by name; the remedy the refusal names has no console
verb. Fixing one leaves the loop intact.

### 1.1 A third review verdict: `void`

**Decision: add `void` to `VERDICTS`, meaning "not markable from the evidence".
Do not add a "set aside" that leaves the item pending.**

The dishonest options were considered and rejected: forcing a guess corrupts the
record, and "set aside" is the current behaviour renamed — the item stays
pending and the session stays stranded, which is the bug.

`void` composes with machinery that already exists. `grade_adjusted` accepts
`correctCount` **and** `totalCount`, so an item excluded from the denominator is
a shape the grade model already understands. A voided item:

- resolves the queue row, so it stops blocking the session;
- is excluded from `totalCount` when the session grades;
- carries a **mandatory** note to the child — this is an adult decision about a
  child's work, and the no-silent-verbs contract binds it.

If voiding leaves a session with zero markable items, the session grades as
`totalCount: 0` — which `graded`'s validator forbids — so that case closes
through 1.3 instead, and 1.1 must detect and route it rather than write an
invalid event.

**Touches:** `ResolveReviewItem.mjs` (VERDICTS, note requirement), the grading
fold that computes `totalCount`, `ReviewQueueView.jsx`, and the domain tests
that pin the verdict set.

### 1.2 The stuck row offers the verb that will actually work

**Decision: keep `abandoned` exactly as narrow as it is. Widen the panel, not
the event.**

The transition table is right — work that came back settles through grading and
close. `StaleSessions` should ask the same table the use case asks and render
per state:

| Row state | Button | Goes to |
|---|---|---|
| `created`, `issued`, `reprinted`, `media_*`, `*_dispatched` | **Abandon…** (today's behaviour) | `POST …/abandon` |
| `submitted` with pending review items | **Mark the waiting answers…** | the queue, filtered to that session |
| `submitted` with none pending | **Grade by hand…** | 1.3 |
| `graded`, `outcome_recorded` | **Settle…** | 1.3 |

A button that can only ever fail is worse than no button. `StaleSessions`
already receives `state` on every row, so this is a render decision, not a new
read.

### 1.3 A manual settle path in the session inspector

`POST /lifecycle/sessions/:sessionId/grade` and `…/close` are implemented and
guarded; nothing in the browser calls either. Add a **Settle this by hand**
section to `SessionInspector`, visible only when the session is non-terminal and
past `submitted`:

- percent or correct/total, a **mandatory** reason, preview-then-apply — the
  same shape `GradeCorrection` already uses, so no new interaction vocabulary;
- **step-up**, scoped to `sessionId`. It writes a grade no machine produced;
  that is at least as consequential as correcting one, which already steps up.

**Wave 1 is done when** a session can be walked from `submitted` to a terminal
state entirely in the browser, and every button on the stuck-session panel
succeeds for the state it renders on.

---

## Wave 2 — The missing write layer (A2 · A3 · A4 · A13)

Three places where the console reads the plan and cannot write it. Each
currently ends at "use the CLI" or "edit the YAML", and A3's pointer actively
misdirects.

### 2.1 Syllabi are editable from Curriculum

**Decision: a new `SyllabiPanel` on the Curriculum page, not on Operations.**
A syllabus is published curriculum, and Curriculum is where published
curriculum is inspected. Operations is for repair.

CRUD over the existing `GET/PUT /lifecycle/syllabi[/:id]` and
`POST …/:id/archive`. Archive arms first — an archived syllabus cannot
materialize new enrollments, and existing ones keep their snapshot.

This unblocks the enrollment drawer's dead end (*"No syllabus published for this
course yet"*), which is why it sequences first.

### 2.2 The enrollment drawer tells the truth, and gains its missing field

- Replace `AssignmentsView.jsx:141`'s wrong sentence. `profile` and `passing`
  come from the **syllabus** (`EnrollLearner.mjs:145,147`), so the copy points
  at 2.1's panel: *"Order, profile, and pass bar come from the syllabus."*
- The drawer shows the same three facts, each now a **link to the syllabus that
  set it**.
- Add the timing-anchor selector (A13). The route has accepted
  `timingAnchorId` all along; the drawer has never sent one.

**Decision: no per-learner override of profile or pass bar.** A second place to
set the same value is how the two-vocabularies problem starts. Per-unit pass
overrides already exist for the one-child-one-lesson case.

### 2.3 An agenda can be dispatched from the Learner Day

Beside the existing preview, mirroring `ArtifactReprint`'s exact pattern —
which is the house shape for "preview, then really do the physical thing":

1. **Prepare** mints the `Idempotency-Key` client-side and calls
   `agendaDispatchPreview`, rendering what will print and any plan errors.
2. **Print the agenda** calls `agendaDispatch` with that key and a step-up
   grant scoped to `learnerId`.
3. Cancel discards the key, so a cancelled dispatch can never be replayed.

**Decision: the button lives on the Learner Day, not the dashboard.** Dispatch
is for one child on one day; the dashboard is a household digest, and putting a
printing verb on a row of six would make a mis-tap expensive.

**Guardrail:** the preview stays visually distinct from the dispatch. The
inert-preview invariant is load-bearing, and two adjacent buttons where one
prints for real is exactly where it would erode.

---

## Wave 3 — Making the planner's verdict visible (A5)

The obligation ladder distinguishes four states and eleven reasons; the console
reads none of them.

### 3.1 `joinLearnerDay` carries `obligation` through

Add `row.obligation = { state, reason }` from the section. The join already
authors every explanatory sentence on a card, so the reason becomes a detail
line there — no new copy site.

### 3.2 A faulted subject looks like a fault

**Decision: `faulted` gets its own card treatment, distinct from both done and
not-started.** The two fault reasons mean *this is our fault, not the child's*,
and rendering them as a quiet planned row is precisely the conflation the day's
status work existed to end.

| Reason | Card says | Links to |
|---|---|---|
| `program_unavailable` | "This program can't start" | Operations |
| `blocked_unreachable` | "Locked behind work nothing can reach" | Operations → exceptions |

### 3.3 Excused reasons that need a grown-up say so

Most excuses need nothing. Two do, and they are currently indistinguishable
from the rest:

- `caught_up` — *the course has no more lessons.* The move is assign more.
- `awaiting_grown_up` — a dormant unit needs opening.

Both render an action link. The other seven reasons render as a muted sentence
and no affordance.

### 3.4 The dashboard names a structurally broken day

One strip above the roster, present only when non-zero: *"N subjects need a
grown-up"*, counting faults and the two actionable excuses across all learners.
It follows the `BacklogStrip` precedent — it renders nothing when the count is
zero, because an empty state shouting for attention is its own defect.

---

## Wave 4 — Repair paths that do not reach (A7 · A10 · A8 · A9 · A12)

### 4.1 Work with no machine attempts can be re-credited

Two changes, both small, both required for the flow to close:

- **Write the `reassigned` event.** It is fully declared, validated, and folded
  — and nothing appends it. Add the writer, and extend `ReassignPanel` to list
  *sessions* alongside attempt summaries so program-served and hand-graded work
  is selectable.
- **Add `reassigned` to `TERMINAL_ANNOTATIONS`.** Discovering the wrong name on
  a settled lesson is exactly when this is needed, and it is currently illegal
  there. It is an annotation: it changes attribution, never lifecycle position,
  which is the same argument that already admits `grade_adjusted`.

### 4.2 A retake stays offerable until one is actually taken

`canOfferRetake` reads whether a remediation was ever opened. It should read
whether the remediation session **reached a terminal state**. An abandoned or
never-scanned retry currently strands the parent lesson permanently.

### 4.3 The approver sees the sheet and the quota

Two lines in `PrintPendingView`, both against endpoints that already exist:

- a preview link to `/print/printables/:id/preview` — the endpoint whose own
  comment says it exists for the approver, currently used only by the child;
- the requester's quota state from `GET /print/quota?userId`, so "over budget"
  is a number rather than a category.

### 4.4 A System health panel replaces the unfunded promise

On School Operations, in place of the `CapabilityNotice`:

- `GET /banks/health` — malformed banks, named;
- `GET /report-card/frozen/versions` — superseded freezes, so "the old record is
  preserved" becomes verifiable. **Decision: this panel lists them; the Reports
  page links to it from `FrozenHistory`** rather than duplicating the list.

**Decision: `GET /audit?since=` stays UI-less this wave.** It is a debugging
read with no framed question behind it yet; shipping a raw event dump would add
a page that has to be justified later. Revisit when a question needs it.

### 4.5 Lost answer cards stay CLI-only — deliberately

**Decision: no console UI.** A lost card is discovered at the printer with the
child present, not at a desk, and the scan path already handles the recovery
token. Recorded here so it reads as a decision rather than an omission.

---

## Wave 5 — Trim

Ordered least-controversial first; all of it is deletion or copy.

| # | Change |
|---|---|
| 5.1 | Fix the two stale docblocks — `FrozenHistory.jsx:4`, `AssignmentsView.jsx:141` (the latter lands with 2.2) |
| 5.2 | Delete the truly dead client methods: `schoolApi.transcript`, `teacherNotes`, `certificate`, `syllabus` — **after** waves 2 and 4 claim the ones that were gaps in disguise |
| 5.3 | Render `InterventionsIndex` once per scope: keep it on Operations, drop both Curriculum copies |
| 5.4 | Drop the `teacherToday` fallback in `TodayTab`; `teacherDay` is the contract |
| 5.5 | Retire `/school/teacher-next` to a redirect |
| 5.6 | Retire `/students/:id/overview` to a redirect; keep `/students/:id` |
| 5.7 | Normalize the one off-pattern preview label |
| 5.8 | **Decision: keep `todoRegistry` + `StubCard`.** The drift test is cheap and the machinery is genuinely reusable. Add one line to the file saying it is dormant by choice, so the next reader does not re-derive it |
| 5.9 | Density pass on Reports (seven panels) — a reading order, not deletions |

---

## Sequencing and what lands together

```
Wave 1 (stranded loop)   ── must land as ONE change; each part alone leaves the loop
Wave 2 (write layer)     ── 2.1 before 2.2 (the drawer's dead end needs syllabi first)
                            2.3 is independent, parallelizable
Wave 3 (visibility)      ── 3.1 first; 3.2/3.3/3.4 all read what it carries
Wave 4 (repair)          ── all five independent of each other and of 1-3
Wave 5 (trim)            ── 5.2 AFTER waves 2 and 4; everything else any time
```

**Two engineers:** `{1 → 3}` as one lane (both touch the join and the day's
render path), `{2 → 4 → 5}` as the other.

## Verification

Per wave, in addition to the unit suites each item names:

- **Wave 1** — drive a session to `submitted` with a pending item, void the
  item, settle by hand, and assert it reaches terminal without touching the CLI.
  Assert the stuck-session panel renders no button that its state refuses.
- **Wave 2** — publish a syllabus, enroll from it, re-materialize, unenroll,
  and dispatch an agenda, entirely in the browser.
- **Wave 3** — feed a faulted section and each of the eleven excuse reasons
  through the join, and assert what each renders.
- **Wave 4** — reassign a program-served lesson; reassign a settled lesson.
- **Wave 5** — the console smoke test
  (`tests/live/flow/school/teacherConsole.runtime.test.mjs`) must stay green
  across every deletion.

**The audit's own standing check:** after each wave, re-walk the model in
`docs/reference/school/teacher.md` and confirm the state it describes still
matches. The reference is the endstate; when a wave lands, the reference does
not change — the audit shrinks.

## What this plan does not do

- It does not add curriculum authoring. Courses stay reviewed YAML; the console
  operates published curriculum. 2.1 publishes a *syllabus*, which is a plan
  over existing units.
- It does not widen `abandoned`. The transition table stays as narrow as it is.
- It does not add a second place to set any value that already has one home.
