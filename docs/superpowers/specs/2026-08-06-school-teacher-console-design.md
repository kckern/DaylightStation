# School Teacher Console — Design

> **Status:** Approved design, pre-implementation. This document covers the
> full programme's use-case catalog and the first deliverable: the read-only
> **skeleton** (Approach B — full skeleton first), from which every later wave
> is planned.

## 1. What this is

A grown-up-facing companion to the School app: one browser surface where the
household's teacher checks the day, plans enrollment and curriculum, reads and
closes records, and repairs what people or technology got wrong. The kids'
School app (`frontend/src/modules/School/SchoolApp.jsx`) stays exactly what it
is; this is the other side of the desk.

Nearly every capability already exists server-side (teacher digest, review
queue, report cards, assignments, print approvals) but has no coherent
grown-up surface — the reference doc lists "Parent view, sign-off,
reassignment UI — not yet designed" as a known gap. This design closes the
*design* gap and sequences the build.

### Decisions already made

| Decision | Choice |
|---|---|
| Surface | Phone/desktop **browser**, responsive, phone-first. Never a Portal widget. |
| Placement | **Standalone route `/school/teacher`**. The Admin review queue (`/admin/school/review`) stays for deep work; the console links/embeds the same capability. |
| Identity | **Soft grown-up claim** — shared `lib/identity` picker, roster filtered to ≥ 18 by `birthyear` (the `GrownUpGate` rule), session-persisted, stamped on every future mutation (`assignedBy` / `closedBy` / `approver`). No PIN; the network perimeter is the gate, consistent with School's repairable-not-prevented identity philosophy. No idle lapse (a parent's own phone, not a shared kiosk). |
| Sequencing | **Approach B — full skeleton first**: all four tabs ship read-only over existing APIs; mutations and new domains land wave by wave on that foundation. |

## 2. Use-case catalog

The full programme. ✅ = backend exists today; ⚠️ = partial / structural work
needed; ❌ = new domain.

### A. The daily loop — "what happened, who needs me"

| # | Use case | Backend |
|---|---|---|
| A1 | Roster-at-a-glance today strip: per learner — attempts, correct, sessions touched, items awaiting a mark (4am→4am study day) | ✅ `GET /teacher/today` |
| A2 | Drill into one learner's day: sessions, scores, what's next, where they're stuck | ✅ `GET /lifecycle/learners/:id/sessions`, `GET /progress` |
| A3 | Work the review queue from the phone: mark essays / short answers / ambiguous OMR, with notes that reach the child's agenda and receipts | ✅ `GET /lifecycle/review`, `POST …/review/:itemId` (Admin `ReviewQueue` exists — reuse, restyle) |
| A4 | Approve/deny children's over-budget print requests | ✅ `GET /print/pending`, approve/deny endpoints |
| A5 | Quiz-request backlog: units children flagged as quiz-gated with no bank | ✅ `GET /quiz-requests` |

### B. Planning — periods, enrollment, curriculum, pacing

| # | Use case | Backend |
|---|---|---|
| B1 | Define/edit academic periods (term/semester/trimester) | ⚠️ exists but **boot-cached `school.yml` config**; editing requires promoting periods from config to data |
| B2 | Configure enrollments: assign courses / standalone units / programs per learner | ✅ `GET/PUT /lifecycle/assignments/:learnerId` + `GrownUpGate` |
| B3 | Curriculum planning: browse and define the breakdown of courses (units, sequence, gating) | ⚠️ read ✅ (`GET /lifecycle/curriculum/units`, `GET /catalogs`); **authoring UI is its own future sub-project** — the promotion boundary (reviewed YAML) deliberately keeps authoring out of runtime |
| B4 | Expected-progress schedule & milestones: "by week 6, unit 4", behind/ahead flags | ❌ new domain (expectations exist but are undated — no pacing) |
| B5 | Mid-period adjustments: change enrollment or pass-criteria mid-term, with an audit trail | ⚠️ assignments ✅ (history already append-only); **pass-criteria is config** — same promotion as B1 |
| B6 | **Enrichment log**: record out-of-band learning (educational travel, museums, projects) as dated, subject-tagged, attributed entries | ❌ new evidence kind |

### C. Records — grades, mastery, printouts

| # | Use case | Backend |
|---|---|---|
| C1 | Live report card per learner/period; close/freeze a period from the UI (and supersede) | ✅ API complete (`GET /report-card`, `/report-card/frozen`, `POST /report-card/close`), no UI |
| C2 | Printouts: report cards (✅ `?format=pdf`), **progress reports** (period-to-date vs milestones), **certificates** (course/program completion) | ⚠️ report card ✅; progress-report & certificate renderers ❌ |
| C3 | Concept mastery + curriculum history browsing (evidence tree, outline, outstanding) | ✅ `GET /progress` |
| C4 | Tutor/coach insight review: the Mastra-backed tutor's remediation arcs and instructional insights, read and used in judging mastery | ✅ `GET /progress/insights`, remediation arcs — no teacher-facing render |
| C5 | **Enrichment credit** on reports: enrichment renders as its own credit section, and enrichment days are calendar exceptions to pacing — never delinquency | ❌ new (depends on B4 + B6) |

### D. Repair & overrides — when people or tech fail

| # | Use case | Backend |
|---|---|---|
| D1 | Attribution repair: reassign a mis-attributed sitting's evidence between children | ❌ storage supports it (append-only, `attributedTo`); nothing performs it |
| D2 | Teacher attestation override: when the Portal / TI-86 / OMR malfunctions, record "I verify this was done/passed" as its **own evidence type** (attested-by, reason — never a silent edit of engine evidence); unlock a wedged gate | ❌ new, cleanly additive |
| D3 | Feedback notes browser: everything written per learner, plus standalone notes outside the review flow | ⚠️ read ✅ (`GET /review/learner/:learnerId`); standalone notes ❌ |

### Enrichment credit — the semantics (B6 + C5)

Learning outside the authored curriculum is *school, just not cataloged
school*. Three rules:

1. **A first-class credit kind, not a gap.** A grown-up records an enrichment
   entry — dates, title, subject tag(s), note — as an attributed, append-only
   evidence kind (a cousin of D2 attestation: parent-recorded, never
   masquerading as engine-graded work). Report cards and progress reports show
   it as its own "Enrichment / experiential learning" section alongside course
   grades, not blended into them.
2. **It excuses pacing rather than being averaged into it.** Enrichment days
   are calendar exceptions to B4 milestones: the pacing denominator shrinks,
   so the progress report reads "on pace — 4 enrichment days (Yellowstone)",
   never "behind by a week". Delinquency math never sees those days.
3. **It never inflates mastery.** Enrichment carries subject tags and appears
   as credit, but moves no course percent, no concept mastery, no gate. A
   parallel column, not bonus points.

## 3. Wave decomposition

| Wave | Contents | New backend |
|---|---|---|
| **1 — Skeleton** (this design, §4) | Shell + identity + all four tabs read-only + honest stubs | **None** |
| 2 — Daily-loop mutations | A3 resolve-with-note, A4 approve/deny, A2 polish | None (endpoints exist) |
| 3 — Planning | B2 assignment editing; **config→data promotion** for periods & pass-criteria (B1, B5); B4 milestones domain; B6 enrichment log | Promotion + two new domains |
| 4 — Records | C1 close/supersede UI; C2 progress-report & certificate renderers; C4/C5 render + enrichment credit | Renderers; C5 read model |
| 5 — Repair | D2 attestation evidence type; D1 evidence reassignment; D3 standalone notes | Two new use cases + evidence kind |
| Future | B3 curriculum authoring UI | Its own programme |

Waves 2–5 are candidates to reorder once the skeleton is in daily use; the
skeleton exists precisely so that planning them starts from a rendered,
navigable foundation rather than a document.

## 4. Skeleton design (wave 1)

### 4.1 Shell, mounting, identity

- **Module:** `frontend/src/modules/School/teacher/`, root `TeacherConsole.jsx`,
  mounted at **`/school/teacher`** — resolved *before* SchoolApp's route
  handling so the kids' shell never parses it (its URL parser would read
  `teacher` as no-section). Browser-only; never in kiosk nav. Living under
  `modules/School/` keeps `schoolApi`, subject metadata, and icons importable
  without crossing module boundaries.
- **Identity:** `TeacherProfileContext` — thin sibling of
  `SchoolProfileContext`, reusing shared `lib/identity` `ProfilePicker` /
  `ProfileAvatar`, roster filtered to grown-ups. Claim soft,
  `sessionStorage`-persisted, shown as a header chip. In the skeleton it is
  chrome plus the future mutation stamp; built now so every later wave
  inherits it.
- **Layout:** phone-first. Bottom tab bar — **Today · Planning · Records ·
  Repair** — content above, header carrying the claim chip and a persistent
  **learner selector** (kid faces, horizontally scrollable; three of four tabs
  are learner-scoped). Desktop: same layout, width-capped. `Teacher.scss`,
  School's design language but denser — an adult reading surface, not a kiosk
  touch target.
- **URL model:** `/school/teacher/<tab>[/<learnerId>]`, `pushState`/`popstate`
  like SchoolApp — a specific child's records view is linkable from a phone
  home-screen shortcut.
- **Logging:** `teacherLog` facade (child logger, `component:
  'school-teacher'`): mount, `nav` on tab change, `fetch-failed` per panel.

### 4.2 Tab contents

All read-only. Live panels render real data; planned panels are **honest
stubs** — a titled card stating what will live there and that it isn't built,
never a disabled fake control.

**Today** *(roster-scoped; the one tab not driven by the learner selector)*
- Roster strip — per-learner cards from `GET /teacher/today`.
- Learner day drill-in — tap a card: sessions today
  (`GET /lifecycle/learners/:id/sessions`, filtered to the study day) +
  recent scores (`GET /progress`).
- Review queue (read) — `GET /lifecycle/review` grouped by learner, showing
  the answer awaiting a mark; "resolve in Admin" link until wave 2.
- Print approvals (read) — `GET /print/pending` with pages/copies.
- Quiz-request backlog — `GET /quiz-requests`.

**Planning** *(learner-scoped except periods/curriculum)*
- Assignments — `GET /lifecycle/assignments/:learnerId`: courses with
  unit-by-unit gating state, standalone units, programs.
- Periods — `GET /periods` as a timeline, current period marked. Stub note:
  editing awaits the config→data promotion.
- Curriculum browser — `GET /lifecycle/curriculum/units` + `GET /catalogs`.
- Stubs: **Milestones / pacing** (B4), **Enrichment log** (B6).

**Records** *(learner + period scoped; period selector defaults to current)*
- Report card (live/DRAFT) — `GET /report-card`: course grades with policy
  label, materials progress, active days, concept mastery, remediation arcs,
  review backlog; link to `?format=pdf`.
- Frozen history — `GET /report-card/frozen` list + view.
- Curriculum history — evidence tree with outline/outstanding from
  `GET /progress`.
- Tutor insights — `GET /progress/insights` as a readable brief.
- Stubs: **Close period** (C1 mutation), **Progress report**, **Certificates**
  (C2), **Enrichment credit** section (C5).

**Repair** *(learner-scoped)*
- Feedback notes (read) — `GET /review/learner/:learnerId`: the child's-eye
  view of resolved verdicts + notes.
- Stubs: **Attestation override** (D2), **Attribution repair** (D1).

### 4.3 Data access and panel isolation

- **One API client:** extend the existing `schoolApi.js` with the missing read
  wrappers (lifecycle reads, `progress/insights`, `print/pending`,
  `quiz-requests`) in the same thin `{ok, data}` style. No second client.
- **`usePanelFetch`:** every panel gets the same contract — `loading` →
  skeleton, `error` → small inline notice naming the panel with a retry,
  `empty` → quiet zero-state, `ok` → render. Fetches are per-panel and
  independent: one failing endpoint never blanks its tab (the
  `GetSchoolReport` posture). Failures log through `teacherLog`.
- **Zero-state rule:** *nothing yet* is quiet and empty (the `StudentPanel`
  posture); *fetch failed* is a named inline error. The two are never
  conflated.

### 4.4 File layout

```
frontend/src/modules/School/teacher/
  TeacherConsole.jsx        # shell: header, learner selector, tab bar, URL model
  TeacherProfileContext.jsx # grown-up-filtered soft claim (sessionStorage)
  teacherLog.js             # child-logger facade
  teacherUrl.js             # /school/teacher/<tab>[/<learnerId>] parse/build
  usePanelFetch.js
  Teacher.scss
  tabs/                     # TodayTab, PlanningTab, RecordsTab, RepairTab
  panels/                   # RosterStrip, ReviewQueueView, PrintPendingView,
                            #   QuizRequestBacklog, AssignmentsView,
                            #   PeriodsTimeline, CurriculumBrowser,
                            #   ReportCardView, FrozenHistory, EvidenceTree,
                            #   TutorInsights, FeedbackNotes, …
  panels/StubCard.jsx       # the honest-placeholder card
```

### 4.5 Testing

Mirrors the module's existing patterns:

- `teacherUrl.test.js` — parse/build round-trips (the `schoolUrl.test.js`
  shape).
- `schoolApi.test.js` additions — one per new wrapper.
- Component tests per tab with mocked API (the `ReportPanel.test.jsx` shape),
  asserting all four panel states — including that one panel's failure leaves
  siblings rendered, and that every stub card renders its "not built yet" copy
  rather than controls.
- `TeacherProfileContext` test — the grown-up roster filter (a child never
  appears in the teacher picker).

### 4.6 Placeholder registry — the skeleton's TODO contract

Out of scope for the skeleton, but **not vaguely so**: every stub in the UI is
one row of this registry, and every registry row is one future work item. Each
`StubCard` rendered in the skeleton carries its row's `todoId` (as a
`data-todo` attribute and in its rendered copy), so "list the TODOs" is
answerable both from this table and from the running app, and they cannot
drift apart — a stub with no registry row, or a row with no stub, is a review
failure.

| todoId | Where (tab → panel) | Use case | What it becomes | Depends on | Backend work |
|---|---|---|---|---|---|
| `teacher.review.resolve` | Today → ReviewQueueView | A3 | Resolve controls (verdict + note) inline on each pending item, replacing the "resolve in Admin" link | skeleton | none — `POST /lifecycle/sessions/:sessionId/review/:itemId` exists |
| `teacher.print.decide` | Today → PrintPendingView | A4 | Approve/deny buttons per pending job, stamped with the claimed grown-up as `approver` | skeleton | none — approve/deny endpoints exist |
| `teacher.assignments.edit` | Planning → AssignmentsView | B2 | Add/remove courses, standalone units, programs per learner; writes `PUT /lifecycle/assignments/:learnerId` with `assignedBy` | skeleton | none — endpoint + `GrownUpGate` exist |
| `teacher.periods.edit` | Planning → PeriodsTimeline | B1 | Create/edit/end academic periods from the UI | config→data promotion of `progress.academicPeriods` | promotion + CRUD endpoints + append-only change history |
| `teacher.passcriteria.edit` | Planning → CurriculumBrowser | B5 | Adjust pass thresholds mid-period with audit trail | config→data promotion of pass-criteria | promotion + endpoint + history |
| `teacher.milestones` | Planning → stub card | B4 | Expected-progress schedule: dated per-course targets, behind/ahead computation against the study calendar | new milestones domain | domain + persistence + `GET`/`PUT` endpoints |
| `teacher.enrichment.log` | Planning → stub card | B6 | Entry form + list: dated, subject-tagged, attributed enrichment entries (educational travel, museums, projects) | new enrichment evidence kind | evidence kind + append-only store + endpoints |
| `teacher.period.close` | Records → stub card | C1 | Close/freeze the period from the UI (with supersede flow), stamped `closedBy` | skeleton | none — `POST /report-card/close` exists |
| `teacher.progressreport.print` | Records → stub card | C2 | Progress-report PDF: period-to-date vs milestones, including enrichment credit | `teacher.milestones`, `teacher.enrichment.log` | new renderer (sibling of `ReportCardRenderer`) |
| `teacher.certificates.print` | Records → stub card | C2 | Certificate PDF on course/program completion | skeleton | new renderer |
| `teacher.enrichment.credit` | Records → stub card | C5 | "Enrichment / experiential learning" section on report card + progress report; enrichment days as pacing calendar exceptions (never delinquency; never moves grades/mastery/gates) | `teacher.enrichment.log`, `teacher.milestones` | read-model + renderer integration |
| `teacher.attestation` | Repair → stub card | D2 | Record "I verify this was done/passed" as its own evidence type (`attestedBy`, reason); unlock a wedged gate. Never edits engine evidence | skeleton | new evidence kind + use case + endpoint |
| `teacher.reassign` | Repair → stub card | D1 | Move a mis-attributed sitting's evidence between learners (fold-an-event model per §5) | skeleton | new use case + endpoint; semantics decided at wave 5 planning |
| `teacher.notes.standalone` | Repair → FeedbackNotes | D3 | Write a note to a learner outside the review flow, delivered via the same agenda/receipt path | skeleton | new endpoint (delivery path exists) |

Also out of scope, deliberately **not** a stub card: **B3 curriculum
authoring** (its own future programme; the skeleton's CurriculumBrowser is
its read-only precursor) and the **wave-2+ styling/interaction polish** of
live panels.

Acceptance shape for any future wave: pick rows, satisfy their "Depends on",
build the "Backend work", replace the stub card with the live panel, delete
the registry row (the table shrinks to zero as the programme completes), and
update `docs/reference/school/README.md`.

## 5. Open questions for later waves

- **Config→data promotion (B1/B5):** exact home for periods and pass-criteria
  once teacher-editable (likely `data/apps/school/…` with append-only change
  history, the assignments pattern). Decide at wave 3 planning.
- **Reassignment semantics (D1):** whether moving evidence rewrites
  `attributedTo` in place with an audit event, or appends a reassignment
  event the readers fold — School's derived-rollup convention argues for the
  latter. Decide at wave 5 planning.
- **Milestone authoring shape (B4):** per-course dated targets vs
  period-relative pacing curves. Decide with real usage of the skeleton's
  assignments/curriculum views.
