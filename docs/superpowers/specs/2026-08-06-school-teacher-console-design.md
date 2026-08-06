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
| Identity | **Soft teacher claim** — shared `lib/identity` picker over a new teachers read backed by a config-declared `teachers:` list in `school.yml` (see §4.7; the school roster endpoint excludes adults by design, so client-side filtering is impossible, and teacher is a *role*, not an age), session-persisted, stamped on every future mutation (`assignedBy` / `closedBy` / `approver`). No idle lapse. |
| Security posture | **Soft reads, PIN-gated mutations.** The claim is attribution, not authentication — spoofable by design, like the kids' identity model. That is acceptable for the read-only skeleton but not for marking work, closing periods, or approving prints: any kiosk browser in the house can reach `/school/teacher`, and the codebase already PIN-gates teacher answer keys against exactly that population (`print.teacherPin`). Every mutation wave lands its writes behind a **distinct `teacherConsolePin`** (not a reuse of `print.teacherPin` — a child who shoulder-surfs a worksheet answer key must not thereby be able to close a semester), checked **inside the owning use cases** (`ResolveReviewItem`, `SetAssignments`, `CloseAcademicPeriod`, `PrintService` — policy lives in use cases, not routers), in addition to the teacher stamp. **Role is authority:** the gate also verifies the stamped id resolves to a `teachers:` member; when no `teachers:` key is configured it falls back to the plain `GrownUpGate` any-adult rule, preserving existing installs. One predicate, stated once, so picker membership and write eligibility cannot drift apart. |
| Sequencing | **Approach B — full skeleton first**: all four tabs ship read-only; mutations and new domains land wave by wave on that foundation. Wave 1 needs three small backend enablers (§4.7) — not zero backend work. |

## 2. Use-case catalog

The full programme. ✅ = backend exists today; ⚠️ = partial / structural work
needed; ❌ = new domain.

### A. The daily loop — "what happened, who needs me"

| # | Use case | Backend |
|---|---|---|
| A1 | Roster-at-a-glance today strip: per learner — attempts, correct, sessions touched, items awaiting a mark (4am→4am study day) | ✅ `GET /teacher/today` |
| A2 | Drill into one learner's day: sessions, scores, what's next, where they're stuck | ⚠️ sessions read ✅ but the study-day filter needs the `?window=today` enabler (§4.7); `GET /progress` ✅ |
| A3 | Work the review queue from the phone: mark essays / short answers / ambiguous OMR, with notes that reach the child's agenda and receipts | ✅ `GET /lifecycle/review`, `POST …/review/:itemId` (Admin `ReviewQueue` exists — reimplement its behavioral contract, §4.2) |
| A4 | Approve/deny children's over-budget print requests | ⚠️ approve/deny endpoints ✅; `GET /print/pending` is route-shadowed and 404s today (§4.7 bugfix) |
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
| **1 — Skeleton** (this design, §4) | Shell + identity + all four tabs read-only + honest stubs | **Three small enablers (§4.7):** teachers read, print route-order bugfix, sessions `window` param |
| 2 — Daily-loop mutations | A3 resolve-with-note, A4 approve/deny, A2 polish | `teacherPin`-class gate on the write endpoints (they exist, but soft-claim alone must not drive them) |
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
  mounted at **`/school/teacher`**. Concretely: today that URL redirects
  through `SchoolDeepLinkRedirect` → `/app/school/teacher` → SchoolApp, whose
  parser reads `teacher` as no-section and shows the kids' home grid. Wave 1
  adds an explicit `<Route path="/school/teacher/*">` in `main.jsx` (React
  Router ranks it above the school catch-all) **and** redirects
  `/app/school/teacher` to `/school/teacher` so both spellings reach the
  console. Browser-only; never in kiosk nav. Living under `modules/School/`
  keeps `schoolApi`, subject metadata, and icons importable without crossing
  module boundaries.
- **Identity:** `TeacherProfileContext` — thin sibling of
  `SchoolProfileContext`, reusing shared `lib/identity` `ProfilePicker` /
  `ProfileAvatar`, sourced from the **new teachers read** (§4.7): the
  existing school roster endpoint serves learners only (adults are filtered
  out server-side in `ConfiguredSchoolLearningDirectory`), so a client-side
  ≥18 filter would yield a permanently empty picker. Claim soft,
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
- Roster strip — per-learner cards from `GET /teacher/today`. Rows carry
  `learnerId` only (no name/avatar; `sessionsToday` is an array of touched
  sessions, not a count) — the client joins against the kids' roster fetch.
- Learner day drill-in — tap a card: sessions today via
  `GET /lifecycle/learners/:id/sessions?window=today` (the `window` param is
  a wave-1 enabler, §4.7 — the 4am boundary and household timezone are
  server-side only, so the client cannot compute the study day itself) +
  recent scores (`GET /progress`).
- Review queue (read) — `GET /lifecycle/review` grouped by learner, showing
  the answer awaiting a mark; "resolve in Admin" link until wave 2. This is a
  **reimplementation of the Admin `ReviewQueue`'s behavioral contract**
  (server-authoritative refresh, per-item error attribution, verdict/note
  state) in School's own SCSS design language — not a restyle; the Admin
  component is Mantine-based and imports Admin's throwing API client, which
  School must not cross-import.
- Print approvals (read) — `GET /print/pending` with pages/copies (works only
  after the route-order bugfix, §4.7 — the route is shadowed and 404s today).
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

- **One API client:** extend the existing `schoolApi.js`. Already present:
  `teacherToday`, `periods`, `reportCard`, `reviewLearner`, `printPending`,
  `quizRequests`, `instructionalInsights`. Actually missing: the lifecycle
  reads (pending review list, learner sessions, assignments, curriculum
  units), `report-card/frozen`, and the new teachers read — added in the
  same thin `{ok, data}` style. The Admin module's `schoolAdminApi` (throwing
  contract) is never imported.
- **`usePanelFetch`:** every panel gets the same contract — `loading` →
  skeleton, `error` → small inline notice naming the panel with a retry,
  `empty` → quiet zero-state, `unavailable` → feature-not-configured, `ok` →
  render. Fetches are per-panel and independent: one failing endpoint never
  blanks its tab (the `GetSchoolReport` posture). Failures log through
  `teacherLog`.
- **Zero-state rule:** *nothing yet* is quiet and empty (the `StudentPanel`
  posture); *fetch failed* is a named inline error. The two are never
  conflated — and neither is *not configured*:
- **The lifecycle-disabled posture.** On a deployment with
  `lifecycle.enabled: false`, every `/lifecycle/*` read 404s while
  `/teacher/today` quietly answers `[]` and `/report-card` answers `null`.
  The console must not render an empty roster next to a wall of red. **No
  mount probe** — the lifecycle router registers each route only when its
  own use case is injected (sessions, review, curriculum, assignments gate
  independently), so a single probed read can misrepresent its siblings.
  Instead each lifecycle-backed panel derives `unavailable` from **its own**
  404 (it is fetching anyway), and the shell renders **one** "School
  lifecycle is not enabled on this install" banner only when *all*
  lifecycle-backed panels report unavailable. Known 404-as-empty shapes are
  handled per-panel, not as errors: `GET /lifecycle/assignments/:learnerId`
  404s for a learner with nothing assigned — that is an empty state. And the
  Records tab maps `/report-card`'s unwired `null` to `unavailable`, never
  to `empty` — a misconfigured install must not render as a quiet
  nothing-graded-yet zero-state.

### 4.4 File layout

```
frontend/src/modules/School/teacher/
  TeacherConsole.jsx        # shell: header, learner selector, tab bar, URL model
  TeacherProfileContext.jsx # teachers-read-backed soft claim (sessionStorage)
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

Plus two files **outside** the module that must change: `main.jsx` (the
`/school/teacher/*` route + the `/app/school/teacher` redirect, §4.1) and
`schoolApi.js` (the new wrappers, §4.3).

### 4.5 Testing

Mirrors the module's existing patterns:

- `teacherUrl.test.js` — parse/build round-trips (the `schoolUrl.test.js`
  shape).
- `schoolApi.test.js` additions — one per new wrapper.
- Component tests per tab with mocked API (the `ReportPanel.test.jsx` shape),
  asserting all **five** panel states — including that one panel's failure
  leaves siblings rendered, that `unavailable` (own-404 derivation, the
  all-unavailable single-banner rule, assignments-404-as-empty, report-card
  `null`→unavailable) is covered explicitly, and that every stub card renders
  its "not built yet" copy rather than controls.
- `TeacherProfileContext` test — picker sourced from the teachers read; the
  not-configured and configured-but-empty responses both render the
  no-teachers card, and a child id in `teachers:` never reaches the picker
  (the server drops it; the client trusts the endpoint).

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
| `teacher.period.close` | Records → stub card | C1 | Close/freeze the period from the UI (with supersede flow), stamped `closedBy` | skeleton | PIN gate in `CloseAcademicPeriod` (endpoint exists) |
| `teacher.progressreport.print` | Records → stub card | C2 | Progress-report PDF: period-to-date vs milestones, including enrichment credit | `teacher.milestones`, `teacher.enrichment.log` | new renderer (sibling of `ReportCardRenderer`) |
| `teacher.certificates.print` | Records → stub card | C2 | Certificate PDF on course/program completion | skeleton | new renderer |
| `teacher.enrichment.credit` | Records → stub card | C5 | "Enrichment / experiential learning" section on report card + progress report; enrichment days as pacing calendar exceptions (never delinquency; never moves grades/mastery/gates) | `teacher.enrichment.log`, `teacher.milestones` | read-model + renderer integration |
| `teacher.attestation` | Repair → stub card | D2 | Record "I verify this was done/passed" as its own evidence type (`attestedBy`, reason); unlock a wedged gate. Never edits engine evidence | skeleton | new evidence kind + use case + endpoint |
| `teacher.reassign` | Repair → stub card | D1 | Move a mis-attributed sitting's evidence between learners (fold-an-event model per §5) | skeleton | new use case + endpoint; semantics decided at wave 5 planning |
| `teacher.notes.standalone` | Repair → FeedbackNotes | D3 | Write a note to a learner outside the review flow, delivered via the same agenda/receipt path | skeleton | new endpoint (delivery path exists) |

Every row whose "What it becomes" is a **write** (resolve, decide, edit,
close, attest, reassign, dismiss) lands behind the `teacherPin`-class server
gate per the security posture in §1 — the soft claim supplies attribution,
the PIN supplies authorization.

Also out of scope, deliberately **not** a stub card: **B3 curriculum
authoring** (its own future programme; the skeleton's CurriculumBrowser is
its read-only precursor) and the **wave-2+ styling/interaction polish** of
live panels.

Acceptance shape for any future wave: pick rows, satisfy their "Depends on",
build the "Backend work", replace the stub card with the live panel, delete
the registry row (the table shrinks to zero as the programme completes), and
update `docs/reference/school/README.md`.

### 4.7 Wave-1 backend enablers

Three small, read-only-or-bugfix items — the honest replacement for the
earlier "zero backend changes" claim, which review disproved:

1. **Teachers read, config-declared.** Teachers are **named in `school.yml`**
   (a `teachers:` list of roster ids), not derived from age: being a
   grown-up in the household does not make you the teacher, and the config
   file School already owns is where that role belongs. **Validation is
   shape-only at boot; resolution happens at request time.** Boot checks the
   list's shape (non-empty strings, no duplicates) — never roster
   membership: `GrownUpGate` itself reads the roster at call time precisely
   because members arrive and change after boot, and a composition-time
   snapshot is the trap its own header warns against. `GET
   /api/v1/school/teachers` → `[{id, name}]` resolves each id against the
   live roster on every request, dropping-and-warning any that doesn't
   resolve to a GrownUpGate-passing member — a typo or a blank `birthyear`
   costs a picker entry and a loud log line, **never the container** (the
   generated-banks boot crash-loop is the precedent not to repeat). The
   response distinguishes *not configured* (no `teachers:` key) from
   *configured-but-empty*; the client renders both as an
   `unavailable`-class "no teachers configured in `school.yml`" card, never
   a silently unclaimable console. Birthyear and other profile fields never
   leave the server (the alternative — consuming `/api/v1/admin/household`,
   with emails and device ids — is rejected). The school roster endpoint
   stays learners-only, untouched. Like the rest of `school.yml` the list
   is boot-cached: adding a teacher takes a restart — expected, not a bug.
   *Side benefit:* the Admin `ReviewQueue`'s sign-off is live-broken today
   because its `adults = roster.filter(isAdult)` runs against that adult-free
   roster; pointing it at this endpoint fixes it (tracked as a wave-2 item,
   not skeleton scope — and it inherits the same not-configured empty-state
   handling).
2. **Print route-order bugfix + regression test.** `GET /print/*id`
   (`school.mjs:205`) is registered before `/print/printables`, `/print/quota`,
   and `/print/pending` (`school.mjs:514–526`), so the Express 5 splat
   shadows all three — `/print/pending` 404s in production today, and the
   kids' PrintCenter reads are broken by the same bug. **Fix by moving the
   splat registration below the fixed routes** (no reserved-name exclusion
   list — that's a second source of truth that drifts the day `/print/history`
   is added). The regression test covers all three previously-shadowed
   routes *and* asserts the splat still serves a real multi-segment document
   id afterward, so the fix can't silently break the other direction.
3. **Sessions study-day window.** `GET /lifecycle/learners/:id/sessions`
   returns every session ever, and the 4am→4am boundary plus household
   timezone live server-side only (`GetTeacherToday`) — the client cannot
   compute "today" correctly across DST or from outside the household zone.
   Add an optional `?window=today`, implemented as follows: **extract the
   currently file-private `studyDayWindow` out of `GetTeacherToday` into
   `2_domains/school/studyDay.mjs`** (next to `offsetMinutesFor`, which it
   already imports — two copies of the window math is exactly the
   divergence this enabler exists to prevent); apply the filter **in a small
   use case with injected clock and timezone, not a router closure** (the
   lifecycle router's own header forbids clock logic in the shell); and
   filter on **`updatedAt`** — the same field `GetTeacherToday` buckets by —
   so the drill-in can never disagree with the digest card the teacher just
   tapped.

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
- **Settled (2026-08-06, stern review):** the security posture — soft reads,
  `teacherPin`-gated mutations (§1). The earlier "network perimeter is the
  gate" framing was rejected because kiosk browsers sit inside the perimeter
  and the codebase already PIN-gates answer keys against that population.
- **Assignments panel scope correction (2026-08-06, M1 review):** §4.2's
  "courses with unit-by-unit gating state, standalone units, programs"
  over-promises the assignments API, which returns plain course/unit id
  lists — no gating state, no programs field. The shipped panel honestly
  renders what the endpoint provides. Gating state would have to join from
  `/progress`; decide whether to build that join (or extend the API) at
  wave-3 planning.
