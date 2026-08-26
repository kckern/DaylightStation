# School Gradebook & Reporting Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full schema-critique remediation roadmap (R1–R8): curriculum-complete scan evidence, repaired traceability, enrollment history, windowed reads, a course-grade projection with frozen report cards, a teacher daily digest, delivered feedback, and a minimal concept-mastery model.

**Architecture:** Everything stays append-only + derive-on-read. Exactly ONE new durable derived store earns existence: the frozen report card written at an explicit, grown-up-gated period close (`data/users/{id}/apps/school/report-cards/{periodId}.yml`). All other additions are additive fields on append-only events, pure domain projections, windowed adapter reads, and delivery of data that already exists.

**Tech Stack:** Node ESM (`.mjs`), vitest, express 5, YAML stores. No new dependencies.

> **Adequacy review (2026-08-05, applied):** verdict YES-WITH-ADDITIONS. MUSTs folded in: a teacher digest SURFACE (Task 8), a PRINTABLE report card (Task 7), and period-scoped course selection in the frozen card (Task 6 — never current-assignments). SHOULDs folded in: materials section + per-subject active-days + close-supersede on the card (Task 6), curriculum-outline expectation adapter (Task 11), kid-visible course grade (Task 9), summarize-read rationale (Task 4). Trims: the live report-card route stays lean (it feeds the PDF and the panel, not a dashboard); Task 13's live verify must NEVER close a real period.

## Global Constraints

- Domain layer (`2_domains/`) imports nothing outside `#domains` (architecture gate; no node builtins).
- Never raw `console.*` — injected `logger`, structured `school.*` events.
- Tests FAIL before each fix and PASS after; no skipped assertions.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Branch `feat/school-gradebook` in this worktree (`/opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3`); never touch the main checkout.
- Run tests with `npx vitest run <paths>`. The wide sweep: `npx vitest run backend/src/2_domains/school/ backend/src/3_applications/school/ backend/src/1_adapters/school/ backend/src/1_adapters/persistence/yaml/ backend/src/4_api/v1/routers/school.print.test.mjs tests/isolated/domain/school/ tests/isolated/application/school/ tests/isolated/composition/ cli/school-certify.cli.test.mjs`.
- Attempt `learning` context valid keys are FIXED (`learningProgress.mjs` `normalizeLearningContext`): text fields `catalogId|subjectId|courseId|unitId|lessonId|moduleId`, list fields `areaIds|conceptIds|classifications|tags`. Do not invent keys.
- Academic periods use `school.academic-period/v1` (`validateAcademicPeriod`): `{schema, periodId, kind, label, startsAt, endsAt, parentPeriodId?}`, timestamps CANONICAL ISO (`new Date(x).toISOString() === x`).
- The grade policy string is exactly `best-of-unit-mean-v1` everywhere it appears.
- Frozen report cards are events: a second close of the same (learner, period) is refused, never overwritten.
- Do NOT build (explicitly rejected at household scale): grade weighting/GPA scales, standards mapping, spaced repetition/decay models, cohort analytics, database migrations, month-level rollup indexes (parked until measured need), session-store read horizons (parked: the planner's best-of-ever `passedUnits` semantics require full history — record this rationale in code where you touch nearby lines, not by changing semantics).

---

### Task 1: Scan attempts carry the full curriculum context and concepts (R2)

**Files:**
- Modify: `backend/src/3_applications/school/documents/ResolveCardScan.mjs` (row results + graded entry)
- Modify: `backend/src/3_applications/school/documents/RecordCardScanOutcome.mjs`
- Test: `backend/src/3_applications/school/documents/ResolveCardScan.test.mjs`, `backend/src/3_applications/school/documents/RecordCardScanOutcome.test.mjs`

**Interfaces:**
- Consumes: bank items' optional `concepts` array (`questionBankValidation.mjs:57-61`); session state via `reduceSession` (fields `unitId`, `learnerId`, `state`).
- Produces: row results gain `concepts: string[]` (empty when the item has none) and graded entries gain `renderedAt` (the allocation record's own timestamp — Task 4 needs it). Attempts gain `learning: {subjectId?, courseId?, unitId?, conceptIds}`. `#bridgeSession` signature becomes `#bridgeSession(card, attemptIds, attemptIdByItem, at, preReadState)` where `preReadState` is the already-reduced session state or null.

- [ ] **Step 1: Failing tests.** In `ResolveCardScan.test.mjs` (reuse `publishAndAllocate` fixtures; give one `mcQuestion` fixture a `concepts: ['fraction-add']` field — check how the source question block carries concepts through publish into the derived bank; if question blocks don't accept a `concepts` key, put concepts on the referenced bank item via the bank-select fixture instead, following `questionBankValidation.mjs`):

```js
it('row results carry the bank item concepts and the record renderedAt', async () => {
  // fixture: one mc question whose bank item has concepts ['fraction-add']
  // scan → expect card.results[0].concepts to eql ['fraction-add']
  // and card.renderedAt to equal the allocation record's renderedAt
});
```

In `RecordCardScanOutcome.test.mjs` (extend `gradedCard` fixture rows with `concepts: []` default):

```js
it('attempts carry course and unit context when the session and taxonomy know them', async () => {
  const sessions = fakeSessions(seededSession('ws-1', { unitId: 'unit-frac-3' }));
  const useCase = new RecordCardScanOutcome({ datastore, sessions, logger: quietLogger });
  const card = gradedCard({
    sessionId: 'ws-1',
    documentId: 'math/fractions/quiz-3',
    recordId: 'math/fractions/quiz-3@abcdef123:v0:1-2',
  });
  card.results[0].concepts = ['fraction-add'];
  await useCase.execute({ testId: '1234567', card });
  const attempt = datastore.readAllAttempts('learner4')[0];
  expect(attempt.learning).toMatchObject({
    subjectId: 'math', courseId: 'fractions', unitId: 'unit-frac-3', conceptIds: ['fraction-add'],
  });
});

it('a URL-printed sheet (no session) still files subject + course from the taxonomy', async () => {
  const card = gradedCard({ documentId: 'math/fractions/quiz-3', recordId: 'math/fractions/quiz-3@abcdef123:v0:1-2' });
  await new RecordCardScanOutcome({ datastore, logger: quietLogger }).execute({ testId: '1234567', card });
  const attempt = datastore.readAllAttempts('learner4')[0];
  expect(attempt.learning).toMatchObject({ subjectId: 'math', courseId: 'fractions' });
  expect(attempt.learning.unitId ?? null).toBeNull();
});
```

- [ ] **Step 2: Run both suites, verify the new tests FAIL.**
- [ ] **Step 3: Implement.** ResolveCardScan `#resolveRecord`: row map adds `concepts: item.concepts ?? []`; graded entry adds `renderedAt: record.renderedAt`. RecordCardScanOutcome `execute`: read + reduce the session ONCE up front when `card.sessionId && this.#sessions` (null otherwise), derive `const segments = card.documentId.split('/');` → `subjectId = segments.length > 1 ? segments[0] : null`, `courseId = segments.length > 2 ? segments[1] : null`, `unitId = preReadState?.unitId ?? null`; per-row `conceptIds: row.concepts ?? []`. Build `learning` with only the non-null text keys (the normalizer rejects null text). Pass `preReadState` into `#bridgeSession` and delete its own `readEvents` call (keep the try/catch semantics: a session read failure up front must not block attempt recording — wrap the pre-read in try/catch, null on failure, and let the bridge report `bridge-failed` as today).
- [ ] **Step 4: Run both suites + `backend/src/3_applications/school/` — all green.** Fixture fallout: existing strict row `toEqual`s gain `concepts: []`; graded-entry assertions gain `renderedAt`.
- [ ] **Step 5: Commit** `feat(school): scan attempts carry course/unit/concepts context`.

---

### Task 2: Traceability repair + the one-item-assessment bug (R3)

**Files:**
- Modify: `backend/src/2_domains/school/progress/attemptEvidence.mjs`, `backend/src/2_domains/school/progress/learningProgress.mjs:497-502` (`buildRecentScores`)
- Modify: `backend/src/3_applications/school/usecases/GradeSubmission.mjs` (grader.answer call), `backend/src/3_applications/school/documents/RecordCardScanOutcome.mjs` (provenance)
- Test: colocated tests for each (find the existing test files with `grep -rl "buildRecentScores\|attemptEvidence" --include="*.test.mjs" backend/ tests/`)

**Interfaces:**
- Produces: evidence activity gains `assessmentId: attempt.sessionId ?? attempt.provenance?.recordId ?? null`; `buildRecentScores` groups by `entry.activity.assessmentId ?? entry.evidenceId`. Attempts written via `GradeSubmission` carry `provenance: {kind: 'review-grade', workSessionId}`; scan attempts add `workSessionId` to their existing provenance when the card carries a session.

- [ ] **Step 1: Failing tests.**

```js
it('two attempts from one printed card group into ONE recent-score assessment', () => {
  // two evidence entries, sessionId null, provenance.recordId 'math/q@abc:v0:1-2'
  // buildRecentScores → 1 assessment, total 2 — not two 0%/100% singletons
});

it('a screen-graded paper submission records the WORK session id, not only the throwaway grader session', async () => {
  // GradeSubmission.execute with entries → grader.answer received provenance {kind:'review-grade', workSessionId: sessionId}
});
```

- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement.** `attemptEvidence.mjs`: where the activity object is built from an attempt, add `assessmentId` per the interface above. `learningProgress.mjs` `buildRecentScores`: `const assessmentId = entry.activity.assessmentId ?? entry.activity.sessionId ?? entry.evidenceId;` (keep `sessionId` in the chain for evidence produced before this change). `GradeSubmission.mjs` (~:176-180): `this.#grader.answer({ sessionId: quizSessionId, itemId, given, transport: 'paper', provenance: { kind: 'review-grade', workSessionId: sessionId } })` — `answer` already accepts `provenance` (`SchoolService.mjs:248`). `RecordCardScanOutcome`: `...(card.sessionId ? { workSessionId: card.sessionId } : {})` inside the provenance block.
- [ ] **Step 4: Run the touched suites + `tests/isolated/application/school/` — green.**
- [ ] **Step 5: Commit** `fix(school): assessment grouping by card record; work-session ids on graded attempts`.

---

### Task 3: Enrollment history (R4)

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlAssignmentStore.mjs` (`put`, new `history`)
- Test: its existing test file (`grep -rl "YamlAssignmentStore" --include="*.test.mjs"`)

**Interfaces:**
- Produces: `put(record)` unchanged for callers; additionally appends `{...stored, recordedAt: stored.updatedAt ?? <now ISO>}` to `history/{learnerId}.yml` under the same root (an array, oldest first). New `async history(learnerId)` returns that array (empty when absent). The current-state file stays the read for `get`/`list`.

- [ ] **Step 1: Failing test** — two `put`s for one learner → `history()` returns both records in order with `assignedBy` preserved on each; `get()` still returns only the latest.
- [ ] **Step 2: Verify FAIL.** **Step 3: Implement** inside the existing `#writeChain` queue (both writes in the same queued task — never a torn pair). **Step 4: Suite green.** **Step 5: Commit** `feat(school): assignment history — every plan change survives, not just the latest`.

---

### Task 4: Windowed reads (R6)

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs` (new `readAttemptsInRange`), `backend/src/1_adapters/school/progress/YamlSchoolAttemptEvidenceSource.mjs`, `backend/src/3_applications/school/documents/RecordCardScanOutcome.mjs` (dedup read), `backend/src/1_adapters/persistence/yaml/YamlReviewQueue.mjs` (`listPending` settled skip)
- Test: colocated tests for each

**Interfaces:**
- Produces: `readAttemptsInRange(userId, fromDay, toDay)` — readdir, keep only `YYYY-MM-DD.yml` names with `fromDay <= name <= toDay` (string compare is correct for ISO dates), parse only those, concatenated oldest-first. Evidence source uses it whenever its caller supplies a window (`GetLearningProgress` already passes from/to — find how the window reaches `listEvidence` and thread the day bounds; full read only when unbounded). Scan dedup uses `readAttemptsInRange(learnerId, dayOf(card.renderedAt), today)` (Task 1 added `renderedAt`; fall back to `readAllAttempts` when absent — legacy cards). Review queue: when `resolve` leaves zero unresolved items in a session's file, rename it `<sessionId>.settled.yml`; `listPending` skips `*.settled.yml`; `listForSession` reads either name.

- Also: `SchoolService.summarize` (and its siblings at `SchoolService.mjs:346/385/448`) deliberately keeps `readAllAttempts` — its metrics are LIFETIME by design (sets attempted, ever). Add a rationale comment at the `summarize` read naming this decision and pointing at the parked month-index as the year-3 remedy; do NOT window it (that would silently change every board number).

- [ ] **Step 1: Failing tests** — range read parses only in-range days (fake io counts loads); dedup for a card rendered today does not read last year's day file; a fully-resolved session's file is skipped by `listPending` but still served by `listForSession`.
- [ ] **Step 2: Verify FAIL.** **Step 3: Implement.** **Step 4: Adapter + application suites green.** **Step 5: Commit** `perf(school): windowed attempt reads; settled review files leave the pending scan`.

---

### Task 5: The course-grade projection (R5a — pure domain)

**Files:**
- Create: `backend/src/2_domains/school/progress/courseGrade.mjs`
- Test: `tests/isolated/domain/school/progress/courseGrade.test.mjs`

**Interfaces:**
- Consumes: session rows as `YamlWorkSessionDatastore.listForLearner` returns them: `{sessionId, learnerId, unitId, state, result, gradedPercent, updatedAt}`.
- Produces:

```js
export const COURSE_GRADE_POLICY = 'best-of-unit-mean-v1';
export function courseGradeFromSessions({ sessions, courseId, unitIds, window = null }) {
  // window: {startsAt, endsAt} ISO strings or null; a session is in-window by updatedAt.
  // Per unitId in unitIds: bestPercent = max gradedPercent across in-window sessions
  //   for that unit (null when none graded); passed = any in-window session with
  //   result === 'passed'; attempts = count of graded sessions.
  // coursePercent = mean of bestPercent over units WITH at least one graded session,
  //   rounded to 2 decimals; null when no unit has one.
  // returns { courseId, policy: COURSE_GRADE_POLICY, coursePercent,
  //           unitGrades: [{unitId, bestPercent, passed, attempts}] }
}
```

- [ ] **Step 1: Failing tests** — the remediation scenario is the load-bearing one:

```js
it('a retake IMPROVES the grade — best-of per unit, never a mean over attempts', () => {
  const sessions = [
    row({ unitId: 'u1', gradedPercent: 60, result: 'needs_remediation', updatedAt: '2026-09-01T10:00:00.000Z' }),
    row({ unitId: 'u1', gradedPercent: 95, result: 'passed', updatedAt: '2026-09-03T10:00:00.000Z' }),
    row({ unitId: 'u2', gradedPercent: 80, result: 'passed', updatedAt: '2026-09-05T10:00:00.000Z' }),
  ];
  const grade = courseGradeFromSessions({ sessions, courseId: 'fractions', unitIds: ['u1', 'u2', 'u3'] });
  expect(grade.unitGrades).toEqual([
    { unitId: 'u1', bestPercent: 95, passed: true, attempts: 2 },
    { unitId: 'u2', bestPercent: 80, passed: true, attempts: 1 },
    { unitId: 'u3', bestPercent: null, passed: false, attempts: 0 },
  ]);
  expect(grade.coursePercent).toBe(87.5); // mean over attempted units only
  expect(grade.policy).toBe('best-of-unit-mean-v1');
});

it('the window excludes out-of-period sessions', () => { /* session at 2026-06-01 excluded by a Sep–Dec window */ });
it('ungraded sessions (no gradedPercent) never count as attempts', () => {});
```

- [ ] **Step 2: FAIL.** **Step 3: Implement** (pure; no imports outside `#domains`). **Step 4: PASS.** **Step 5: Commit** `feat(school): course-grade projection — best-of per unit, written down as policy`.

---
### Task 6: Report cards and period close (R5b)

**Files:**
- Create: `backend/src/3_applications/school/usecases/GetReportCard.mjs`, `backend/src/3_applications/school/usecases/CloseAcademicPeriod.mjs`, `backend/src/3_applications/school/usecases/GetTeacherToday.mjs`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs` (`writeReportCard`/`readReportCard`/`listReportCards` at `<userDir>/apps/school/report-cards/{periodId}.yml`, plus versioned supersede archive `{periodId}.v<n>.yml`), `backend/src/4_api/v1/routers/school.mjs` (routes + DI), `backend/src/app.mjs` (wiring)
- Test: `tests/isolated/application/school/reportCard.test.mjs` (new), `backend/src/4_api/v1/routers/school.reportcard.test.mjs` (new, supertest pattern from `school.print.test.mjs`)

**Interfaces:**
- `GetReportCard.execute({learnerId, periodId})` → `{schema: 'school.report-card/v1', learnerId, period, generatedAt, courses, materials, evidence, activeDays, pendingReview, remediationArcs, concepts?}` where:
  - **Course selection is PERIOD-SCOPED, never current-assignments (adequacy MUST 3):** courses = union of (a) course ids appearing in ANY assignment-history record (Task 3's `history(learnerId)`) whose `recordedAt` falls inside the period OR that was the current assignment at period start (the latest history record at or before `startsAt`), and (b) course ids of any unit with ≥1 graded session in the window (unit→course via the curriculum accessor `BuildAgenda`/`planLearnerWork` already use — grep `CurriculumAccess` for the unit list per course). A course assigned during the period but since unassigned STILL appears — this is a load-bearing test.
  - `courses: [{courseId, ...courseGradeFromSessions output, unitOutcomes: [{unitId, result, gradedPercent, sessionId}]}]` — grades via Task 5's projection with the period window.
  - `materials: [...]` (adequacy SHOULD 4): the learner's materials-framework courses from the existing `GetMaterialProgressSummary` use case — `{materialId, label, unitsDone, unitTotal}` — so video-course schooling stops being invisible.
  - `evidence`: the existing `GetLearningProgress` aggregate invoked with the period's from/to.
  - `activeDays` (adequacy SHOULD 6): `{bySubject: [{subjectId, days}], total}` — count of distinct attempt DAY FILES in the period containing ≥1 attempt (per subject via each attempt's `learning.subjectId`); derived from Task 4's `readAttemptsInRange`. This is the honest instructional-time proxy — name it that in a comment, never "attendance".
  - `remediationArcs`: from session rows linked by `remediationOf` — the day index lacks that field, so resolve arcs by `readEvents` on the sessions whose rows show `result: 'needs_remediation'` followed by a later session on the same unit (bounded to the period's sessions only).
  - `pendingReview`: count from `reviewQueue.listPending()` filtered to the learner.
- `CloseAcademicPeriod.execute({learnerId, periodId, closedBy, supersede = false})` → asserts `closedBy` via `GrownUpGate` (expose the instance `schoolLifecycle.mjs:403` constructs through the lifecycle return); plain close refuses when frozen exists (`REPORT_CARD_ALREADY_CLOSED` DomainInvariantError → 409); `supersede: true` (adequacy SHOULD 7) archives the existing file to `{periodId}.v<n>.yml` (next free n) and writes the new freeze — the old record is preserved, never destroyed. Frozen payload = report + `{closedBy, closedAt, supersededVersions: n}`.
- `GetTeacherToday.execute()` → per roster learner `{learnerId, attemptsToday, correctToday, sessionsToday: [{unitId, state}], pendingReview}` using `readAttemptDay(userId, todayStudyDay)` (4am boundary via `studyDay.mjs`), today's session day index, `reviewQueue.listPending()` grouped by learner.
- Routes (DI `getReportCard = null, closeAcademicPeriod = null, getTeacherToday = null`):
  - `GET /api/v1/school/report-card?learnerId=&periodId=` (derived, live — stays LEAN: it feeds Task 7's PDF and Task 9's panel, never grows dashboard extras)
  - `GET /api/v1/school/report-card/frozen?learnerId=[&periodId=]`
  - `POST /api/v1/school/report-card/close` `{learnerId, periodId, closedBy, supersede?}` (409 re-close without supersede; 403 gate)
  - `GET /api/v1/school/teacher/today`

- [ ] **Step 1: Failing use-case tests** (in-memory fakes per `RecordCardScanOutcome.test.mjs` idioms): report card composes course grades from session rows + PERIOD-SCOPED courses — including "a course assigned during the period but since unassigned still appears"; materials section present; activeDays counts distinct days per subject; re-close refuses; supersede archives `v1` and freezes anew; non-grown-up `closedBy` throws; today digest counts only today's study-day attempts.
- [ ] **Step 2: FAIL.** **Step 3: Implement use cases + datastore methods** (same `saveYaml` conventions as `appendAttempt`; `writeReportCard` refuses existing unless the caller passed the archive step first). **Step 4: Failing route tests → implement routes + app.mjs wiring.** **Step 5: New suites + wide sweep green.** **Step 6: Commit** `feat(school): report cards — period-scoped, frozen at a gated close with supersede; teacher today digest`.

---

### Task 7: The printable report card (adequacy MUST 2)

**Files:**
- Create: `backend/src/1_rendering/school/reportcard/ReportCardRenderer.mjs` (+ colocated test)
- Modify: `backend/src/4_api/v1/routers/school.mjs` (`GET /report-card?format=pdf` + frozen variant), `backend/src/app.mjs` (wiring)
- Test: renderer test + route test additions in `school.reportcard.test.mjs`

**Interfaces:**
- Consumes: the `school.report-card/v1` shape from Task 6, verbatim.
- Produces: `renderReportCardPdf(report, {learnerName})` → `{pdf: Buffer, pageCount}` — Letter PDF via pdfkit following `backend/src/1_rendering/school/documents/` conventions (reuse the workbook theme's fonts/registration helpers — grep `registerDocumentFonts`; do NOT reuse the document block pipeline, this is a bespoke one-or-two-page layout): header (learner display name, period label, generatedAt/closedAt + `closedBy` when frozen, the policy string in small print), per-course table (course, grade %, units passed/attempted), materials list, per-subject active days, concepts mastered/developing, remediation arcs as one narrative line each ("Fractions unit 3: 60% → tutored → 95%"), feedback-notes count. The FROZEN render must say FROZEN with `closedAt`; the live render says DRAFT.
- Route: `format=pdf` on both report-card GETs → `application/pdf`, `Content-Disposition: inline; filename="report-card-<learnerId>-<periodId>.pdf"`. JSON stays the default.

- [ ] **Step 1: Failing renderer test** — renders a fixture report to a parseable PDF (`%PDF` magic, pageCount ≥ 1); DRAFT vs FROZEN text asserted via pdf text extraction if a helper exists in the rendering tests (grep `pdf-parse\|textContent` in `tests/isolated/rendering/school/`), else assert on the renderer's returned metadata `{mode: 'frozen'|'draft'}`.
- [ ] **Step 2: FAIL → implement.** **Step 3: Route tests (pdf content-type + filename; frozen 404 when none) → implement.** **Step 4: Sweep green.** **Step 5: Commit** `feat(school): printable report card — the May filing ends in paper, not YAML`.

---

### Task 8: The teacher digest surface (adequacy MUST 1)

**Files:**
- Modify: `frontend/src/modules/School/report/` (the program-report board — add a "Today" strip) and/or `frontend/src/modules/Admin/School/` landing (follow whichever surface renders `GetSchoolReport` today; put the digest WHERE THE PARENT ALREADY LOOKS, do not invent a new page)
- Test: a fetch-hook unit test following the module's existing posture (no new frontend test framework)

**Interfaces:**
- Consumes: `GET /api/v1/school/teacher/today` (Task 6) and the pending-review counts inside it.
- Produces: a per-learner "Today" row — attempts today (n, with correct count), sessions in flight (unit names), pending review count rendered as a badge that links/taps through to the existing Admin review queue. Zero-state says "no work recorded today", never blank.

- [ ] **Step 1:** Find the board component + its data hook; add a `useTeacherToday` hook (same fetch idioms) with its unit test. **Step 2:** Render the strip; review-badge links to the review queue surface. **Step 3:** Frontend build passes (`npx vite build` or the project's check — match how other frontend changes were verified in this repo; at minimum the dev server compiles). **Step 4: Commit** `feat(school): the teacher's day on the board — attempts, in-flight, needs-marking`.

---

### Task 9: Deliver the feedback + kid-visible standing (R7 + adequacy SHOULD 9)

**Files:**
- Modify: `backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs` (~:199 `resultDocument` call), `backend/src/3_applications/school/usecases/BuildAgenda.mjs`
- Modify: `backend/src/4_api/v1/routers/school.mjs` (learner feedback route), `backend/src/1_adapters/persistence/yaml/YamlReviewQueue.mjs` (`listForLearner`), `frontend/src/modules/School/` (student panel: feedback list + live course grades)
- Test: colocated backend tests; frontend hook tests per module posture

**Interfaces:**
- `CloseSessionOutcome`: before building `resultDocument`, `listForSession(sessionId)` → items with non-empty `note`; append receipt lines `Note: <note> (<questionNumber ?? itemId>)` — cap 3, truncate at 120 chars.
- `BuildAgenda`: a "Notes for you" section when review items with notes were resolved within the current or previous study day (`studyDay.mjs` boundaries); max 3 lines; informational, no QR.
- `GET /api/v1/school/review/learner/:learnerId?limit=20` → resolved items newest-first `{itemId, sessionId, unitId, verdict, note, gradedBy, gradedAt, prompt, questionNumber}`; `YamlReviewQueue.listForLearner(learnerId, {limit})` scans per-session files' own `learnerId` field, windowed to the last 60 day-directories.
- Student panel: a "Feedback" list from that endpoint AND (SHOULD 9) the learner's live course grades — fetch `GET /report-card?learnerId=<id>&periodId=<current>` (current period = the one whose window contains today, resolved client-side from a small `GET /api/v1/school/periods` route you add here returning `listPeriods()`), rendering "Fractions: 87%" per course with a graded session. A child sees where they stand, not only what to fix.

- [ ] **Step 1: Failing backend tests** — receipt includes a resolved note; agenda prints yesterday's note and omits week-old ones; learner route newest-first, never pending; periods route returns the configured list.
- [ ] **Step 2: FAIL → implement backend.** **Step 3: Frontend panel (feedback list + standing) + hook tests.** **Step 4: Suites + frontend build green.** **Step 5: Commit** `feat(school): notes reach the child; a child sees where they stand`.

---

### Task 10: Concept registry + mastery facet (R8)

**Files:**
- Create: `backend/src/2_domains/school/progress/conceptMastery.mjs`, `backend/src/1_adapters/school/progress/YamlConceptRegistry.mjs`
- Modify: `cli/school-certify.cli.mjs` (concept lint), `backend/src/3_applications/school/usecases/GetReportCard.mjs` (concepts section), wiring as needed
- Test: `tests/isolated/domain/school/progress/conceptMastery.test.mjs`, adapter + certify tests colocated

**Interfaces:**
- Registry: `data/content/school/concepts.yml` — `{concepts: [{id, label, parent?}]}`, kebab ids. `YamlConceptRegistry`: `get(id)`, `list()`, `has(id)`; load-once.
- `conceptMastery(entries, {windowDays = 90, threshold = 0.8, minResponses = 5, now})` (pure): group graded evidence entries by `learning.conceptIds` member within window → `[{conceptId, responses, correct, ratio, mastered}]`, `mastered = responses >= minResponses && ratio >= threshold`, weakest-first.
- Certify lint: unknown concept ids → warnings by default, failures under `--strict-concepts`; absent registry → one notice, pass.
- Report card `concepts: {mastered, developing}` entries `{conceptId, label, ratio, responses}`.

- [ ] **Step 1: Failing domain tests** (threshold/minResponses honored; weakest-first; unknown ids still counted — registry only labels). **Step 2: FAIL → implement domain + adapter.** **Step 3: Certify test (warning; `--strict-concepts` failure) → implement.** **Step 4: GetReportCard wiring + test.** **Step 5: Sweep green.** **Step 6: Commit** `feat(school): concept registry + mastery facet`.

---

### Task 11: Feed the outline — curriculum-backed expectations (adequacy SHOULD 5)

**Files:**
- Create: `backend/src/1_adapters/school/progress/CurriculumExpectationSource.mjs` (+ colocated test)
- Modify: the composition site where `ConfiguredLearningExpectationSource` is wired into `GetLearningProgress` (grep `ConfiguredLearningExpectationSource` in `backend/src/app.mjs` / composition modules)

**Interfaces:**
- Consumes: the curriculum accessor's course→unit listing (same one Task 6 uses) and the expectation shape `ConfiguredLearningExpectationSource` emits (READ ITS CODE — mirror the exact output contract so `aggregateLearningProgress`/`curriculumHistory` consume it unchanged).
- Produces: an expectation source deriving the authored outline from the curriculum catalog itself (each course's units, in sequence), merged with (not replacing) any configured `progress.expectations`. Result: `curriculumHistory` can finally make "unit 3 of 12" completion claims for cataloged courses — the honesty rule keeps refusing only where no outline truly exists.

- [ ] **Step 1: Failing test** — with a two-course catalog fake, the source emits expectations for each course's units; configured expectations still win/merge. **Step 2: FAIL → implement + wire.** **Step 3:** Assert via an `aggregateLearningProgress` integration case that a fully-evidenced unit now reports completion against the outline (find the existing curriculumHistory test file and extend it). **Step 4: Sweep green.** **Step 5: Commit** `feat(school): the curriculum catalog feeds the outline — completion claims stop starving`.

---

### Task 12: Documentation

**Files:**
- Modify: `docs/reference/school/README.md` (new "Gradebook, report cards, and the teacher's day" subsection under §2: periods, the `best-of-unit-mean-v1` policy by name, period-scoped course selection, frozen closes + supersede, printable card, today digest + surface, feedback delivery, kid standing, concept registry, outline source), `docs/reference/school/print-documents.md` (§8: scan attempts carry course/unit/concepts; assessment grouping by record), `docs/docs-last-updated.txt`

- [ ] **Step 1: Write the sections** (present tense, endstate, path tables allowed). **Step 2: Commit** `docs(school): gradebook, report cards, teacher digest, feedback, concepts`.

---

### Task 13: Config, merge, deploy, live verify (controller-executed — not a subagent)

R1 + shipping: write `progress.academicPeriods` into the data mount's `school.yml` via docker exec (canonical ISO timestamps: fall `2026-08-01T07:00:00.000Z`→`2026-12-19T07:00:00.000Z` periodId `2026-fall`, spring `2027-01-05T07:00:00.000Z`→`2027-05-29T07:00:00.000Z` periodId `2027-spring`, parent year `2026-27` spanning both), full sweep, ff-merge to main, build, gate check (separate halting step), deploy (boot-cached config loads on the restart), live verify: derived report card for a real learner + period returns 200 JSON and `?format=pdf` returns a PDF; `GET /teacher/today` lists four learners; `GET /periods` lists the three periods; the digest strip renders on the board. **NEVER close a real period during verification — a close is a permanent record; `CloseAcademicPeriod` is exercised only by tests.** Record branch deletion; update memory.
