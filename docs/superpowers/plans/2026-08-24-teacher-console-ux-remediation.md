# Teacher Console UX Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear every finding in `docs/_wip/audits/2026-08-24-teacher-console-ux-audit.md` across four shippable waves (Truth → Safety → Structure → Polish), per the approved spec `docs/superpowers/specs/2026-08-24-teacher-console-ux-remediation-design.md`.

**Architecture:** Read-model enrichment on the backend (catalog joins at read time, never stored-data rewrites); frontend fixes follow the module's existing contracts (`usePanelFetch`, `useTeacherWrite` arm→confirm, `PanelFrame`, `labelize`). Curriculum page becomes a catalog → the already-existing `/curriculum/:courseId` drill-in. Matrix transposes (courses as rows). Each wave ends: vitest green → build → deploy → Playwright screenshot re-verify.

**Tech Stack:** React 18 (jsx, no TS), SCSS, vitest (+ Testing Library) for frontend units, node:test/vitest for backend per existing file conventions, Playwright for layout verification.

## Global Constraints

- Never edit stored session/attempt records — titles are a catalog concern, joins happen in read models (spec "Principles").
- No raw internal ids in copy: unit codes, Q-ids, slugs, algorithm/policy names, usernames all resolve or labelize (spec "Principles").
- Shared `progress/` components serve the student ReportPanel too — changes there must be presentational improvements safe for both consumers.
- All writes stay behind `useTeacherWrite`/TeacherGate. No new write paths.
- Gate before each deploy: `npx vitest run --config vitest.config.mjs` scoped to touched suites, then the full `npm run test:unit:vitest`. `test:backend` is a known-vacuous gate — do not rely on it.
- jsdom cannot see layout: any layout claim (page height, truncation, overflow) verifies via Playwright against the deployed app, not jsdom.
- Deploy per wave on kckern-server (build → gate-check garage/Player → `sudo deploy-daylight`), then re-screenshot the 10 audit routes.

---

# Wave 1 — Truth

### Task 1: Delete the PHASE-4 console spam

**Files:**
- Modify: `frontend/src/main.jsx:47-50` (the `// ========== PHASE 4 DEBUG` block)

**Steps:**
- [ ] **Step 1:** Remove the four lines: the two `console.error('🔥 PHASE 4 …')` calls and their banner comments. Nothing else in the file changes.
- [ ] **Step 2:** Run: `grep -n "PHASE 4\|🔥" frontend/src/main.jsx` → Expected: no output. (`FitnessMomentum.jsx` also matches the repo-wide grep — leave it; it is outside this scope.)
- [ ] **Step 3:** Run `npx vitest run frontend/src/modules/School/teacher` → Expected: PASS (no test imports main.jsx, this is a smoke check).
- [ ] **Step 4:** Commit: `fix(frontend): remove PHASE 4 debug console spam from main.jsx`

### Task 2: Join the catalog in GetLearnerTimeline (History titles)

**Files:**
- Modify: `backend/src/3_applications/school/usecases/GetTeacherSession.mjs:157-178` (`GetLearnerTimeline`)
- Modify: `backend/src/app.mjs:3717-3718` (wiring)
- Test: `backend/src/3_applications/school/usecases/GetTeacherSession.test.mjs`

**Interfaces:**
- Produces: timeline rows gain `lessonTitle`, `courseId`, `courseTitle`, `moduleTitle`, `subject`, `posterUrl` — the same names `GetTeacherToday` emits and `SessionList`/`LessonIdentity` already render.

**Steps:**
- [ ] **Step 1:** In the existing test file (follow its established runner/imports — it already constructs `GetLearnerTimeline`), add a test: construct with a fake `curriculum` `{ getUnit: (id) => ({ unitId: id, title: 'Illinois', courseId: 'atlas-us' }), listWorks: () => [{ work: 'atlas-us', title: 'United States Regions and States', subject: 'civilization', modules: [] }] }` and a sessions store returning one row `{ sessionId: 's1', learnerId: 'learner3', unitId: 'u1', state: 'closed', updatedAt: '2026-08-24T15:20:00Z' }`. Assert the returned item has `lessonTitle: 'Illinois'` and `courseTitle: 'United States Regions and States'`. Add a second test: with `curriculum: null` the row still returns (no throw, titles absent).
- [ ] **Step 2:** Run the file's test command → Expected: FAIL (fields undefined).
- [ ] **Step 3:** Implement: `GetLearnerTimeline` constructor accepts optional `curriculum`. In `execute`, after paging, map rows:

```js
const works = this.#curriculum?.listWorks?.() ?? [];
const courseOf = (courseId) => works.find((c) => c.work === courseId || `${c.subject}/${c.work}` === courseId) ?? null;
const enrich = (row) => {
  const unit = this.#curriculum?.getUnit?.(row.unitId) ?? null;
  if (!unit) return row;
  const course = courseOf(unit.courseId);
  return {
    ...row,
    lessonTitle: unit.title ?? null,
    courseId: unit.courseId ?? null,
    courseTitle: course?.title ?? null,
    subject: unit.subject ?? course?.subject ?? null,
    moduleTitle: (course?.modules ?? []).find((m) => (m.units ?? []).includes(row.unitId))?.title ?? null,
    posterUrl: unit.courseId ? `/api/v1/school/teacher/curriculum/${encodeURIComponent(unit.courseId)}/poster.jpg` : null,
  };
};
```

  applied to the returned page only (`items: page.map(enrich)`). `listWorks()` is called once per execute; handle it throwing with a try/catch that degrades to un-enriched rows. Mirror the exact taxonomy resolution `GetTeacherSession.execute` uses (lines 61-64) so module matching behaves identically.
- [ ] **Step 4:** Wire `curriculum: schoolLifecycle.stores.curriculum ?? null` into the `new GetLearnerTimeline({...})` at `app.mjs:3717-3718`.
- [ ] **Step 5:** Run tests → Expected: PASS. Also run `backend/src/4_api/v1/routers/school.teacherWorkspace.routes.test.mjs` → Expected: PASS (route contract unchanged, additive fields).
- [ ] **Step 6:** Commit: `feat(school): timeline read model joins catalog — History rows get real titles`

### Task 3: Serve unitTitle on /review/learner rows (feedback lane names)

**Files:**
- Modify: `backend/src/4_api/v1/routers/school.mjs:1551-1575` (the `/review/learner/:learnerId` mapping)
- Test: `backend/src/4_api/v1/routers/school.teacherWorkspace.routes.test.mjs`

**Interfaces:**
- Produces: each review row gains `unitTitle` (nullable). `FeedbackNotes.jsx:35` already renders `item.unitTitle` first — no frontend change needed for the name itself.

**Steps:**
- [ ] **Step 1:** Add a route test: seed the injected review queue with one resolved item carrying `unitId`, inject a curriculum store whose `getUnit` returns `{ title: 'Illinois' }`, GET the route, assert `body[0].unitTitle === 'Illinois'`; assert a standalone note row has `unitTitle: null`.
- [ ] **Step 2:** Run → Expected: FAIL.
- [ ] **Step 3:** In the router mapping add `unitTitle: item.unitId ? (curriculum?.getUnit?.(item.unitId)?.title ?? null) : null` using the same curriculum store the router already has in scope (if it does not, thread `schoolLifecycle.stores.curriculum` through the router factory the same way sibling routes receive stores).
- [ ] **Step 4:** Run → Expected: PASS.
- [ ] **Step 5:** Commit: `feat(school): review rows carry unitTitle for the feedback lane`

### Task 4: Roll up the feedback lane

**Files:**
- Modify: `frontend/src/modules/School/teacher/panels/FeedbackNotes.jsx`
- Test: create `frontend/src/modules/School/teacher/panels/FeedbackNotes.test.jsx`

**Steps:**
- [ ] **Step 1:** Write component tests (Testing Library, mock `schoolApi.reviewLearner`): (a) 6 engine verdict rows for one `sessionId` render as ONE summary row reading `6 correct · Illinois` (unitTitle) with the date, expandable via a details/summary click to reveal individual verdicts; (b) `gradedBy: 'engine'` never appears in the DOM — a human `gradedBy: 'kckern'` still renders; (c) a `kind: 'note'` row renders standalone with its Retract button as today.
- [ ] **Step 2:** Run: `npx vitest run frontend/src/modules/School/teacher/panels/FeedbackNotes.test.jsx` → Expected: FAIL.
- [ ] **Step 3:** Implement grouping in the component (presentational only):

```js
const groups = [];
for (const item of rows) {
  const key = item.kind === 'note' ? `note:${item.itemId}` : `${item.sessionId}`;
  const last = groups.at(-1);
  if (last?.key === key) last.items.push(item);
  else groups.push({ key, kind: item.kind ?? 'verdict', items: [item] });
}
const summaryOf = (group) => {
  const correct = group.items.filter((i) => i.verdict === 'correct').length;
  const title = group.items.find((i) => i.unitTitle)?.unitTitle ?? 'Lesson';
  return `${correct} of ${group.items.length} correct · ${title}`;
};
```

  Verdict groups render `<details>` with the summary line + `teacherDate(items[0].gradedAt)`; the expanded list reuses the existing row markup minus the engine attribution (`{item.gradedBy && item.gradedBy !== 'engine' ? ` — ${item.gradedBy}` : ''}`). Note rows render exactly as before.
- [ ] **Step 4:** Run → Expected: PASS. Commit: `fix(school): feedback lane rolls up per session, drops engine attribution`

### Task 5: Session detail — numbering, letters, answer line

**Files:**
- Modify: `frontend/src/modules/School/teacher/WorkspaceViews.jsx:58-63` (`recordedAnswerLine`), `:593-607` (worksheet + answers sections)
- Test: create `frontend/src/modules/School/teacher/WorkspaceViews.sessionDetail.test.jsx`

**Steps:**
- [ ] **Step 1:** Tests (mock `teacherWorkspaceApi.session` to return a session whose `assignment.questions` have `number: 1..2`, `itemId`s, `choices`, and whose `assessment.items` have bank-global `questionNumber: 19..20` and matching `itemId`s): (a) the answers section shows "Question 1"/"Question 2" (worksheet-local, matched by `itemId`, falling back to array index + 1); (b) worksheet choices render lettered `A. Hotels and theaters`; (c) the answer line reads `Their answer: Factories and stockyards (C) · Correct` where (C) is derived by locating the expected text among the question's choices — when no choice matches, no letter renders; (d) "1 learners" never appears anywhere (guards Task 7's shared copy too).
- [ ] **Step 2:** Run → Expected: FAIL.
- [ ] **Step 3:** Implement: build `const numberByItemId = new Map(session.assignment?.questions?.map((q, i) => [q.itemId, q.number ?? i + 1]) ?? [])`; answers section uses `numberByItemId.get(item.itemId) ?? index + 1`. Worksheet choices render `<span>{question.choices.map((choice, i) => `${String.fromCharCode(65 + i)}. ${choice.text ?? choice.label ?? choice}`).join('  ·  ')}</span>`. Rewrite `recordedAnswerLine(item, question)`:

```js
const recordedAnswerLine = (item, question) => {
  const given = item.given ?? 'No recorded answer';
  const letterOf = (text) => {
    const i = (question?.choices ?? []).findIndex((c) => (c.text ?? c.label ?? c) === text);
    return i >= 0 ? ` (${String.fromCharCode(65 + i)})` : '';
  };
  const expected = item.expected?.length ? ` · Correct answer: ${item.expected.map((e) => `${e}${letterOf(e)}`).join(', ')}` : '';
  const verdict = item.verdict ? ` · ${labelize(item.verdict)}` : '';
  return `Their answer: ${given}${expected}${verdict}`;
};
```

  Thread the matching `question` (by itemId) into the call. When the given answer equals the expected answer, omit the `Correct answer:` clause entirely (redundancy fix): `const showExpected = item.verdict !== 'correct'`.
- [ ] **Step 4:** Run → Expected: PASS. Commit: `fix(school): session detail uses worksheet numbering, lettered options, honest answer line`

### Task 6: Score labels + UTC study-day bug

**Files:**
- Modify: `frontend/src/modules/School/teacher/WorkspaceViews.jsx:230` (studyDay default), `:583-584` (score dts)
- Test: extend `WorkspaceViews.sessionDetail.test.jsx`

**Steps:**
- [ ] **Step 1:** Test: freeze time to `2026-08-24T21:30:00-07:00` (vi.setSystemTime); `LearnerOverview` study-day input value is `2026-08-24`, not `2026-08-25`. Test: session detail shows `Marked score` with the caption `As graded by the machine` and `Current score` with `After teacher corrections`.
- [ ] **Step 2:** Run → Expected: FAIL (UTC slice gives 08-25).
- [ ] **Step 3:** Implement local-date helper in `teacherDates.js`: `export const localDay = (d = new Date()) => \`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}\`;` — use it in `LearnerOverview` (and note `BulkRegradePanel:396-397` already hand-rolls this; switch it to `localDay()` too). Add `<small>` captions under the two score `<dt>`s.
- [ ] **Step 4:** Run → Expected: PASS. Commit: `fix(school): study day defaults to local today; score labels explained`

### Task 7: Shared insights copy — pluralization, policy line, Q-id presentation

**Files:**
- Modify: `frontend/src/modules/School/progress/InstructionalInsightsOverview.jsx:85`, `:91-99`, `:101-103`
- Test: create `frontend/src/modules/School/progress/InstructionalInsightsOverview.test.jsx`

**Steps:**
- [ ] **Step 1:** Tests: (a) basis with `learnerCount: 1` renders `…and 1 learner.` (and `records`→`record` when 1); (b) the string `Policy school.instructional-review` does not appear; instead `Suggested automatically from answer history · expires <date>`; (c) an item with `target.id: 'q2'` renders `Question 2` (regex `/^q(\d+)$/i` → `Question $1`), a slug id like `illinois-labor-unions` still renders `Illinois Labor Unions`.
- [ ] **Step 2:** Run → Expected: FAIL.
- [ ] **Step 3:** Implement: pluralize helper `const n = (count, word) => \`${count} ${word}${count === 1 ? '' : 's'}\``, applied in `basisLabel`; replace the policy `<small>` with `Suggested automatically from answer history · reassess when evidence changes{policy?.expiresAt ? ` · expires ${dateLabel(policy.expiresAt)}` : ''}`; extend `displayId`: `const m = /^q(\d+)$/i.exec(String(value ?? '')); if (m) return \`Question ${m[1]}\`;` before the existing prettifier. These are presentational and equally correct for the student ReportPanel consumer.
- [ ] **Step 4:** Run → Expected: PASS. Commit: `fix(school): insights copy — pluralization, plain-English basis, Question N ids`

### Task 8: Curriculum-history unit names (Atlas Us P044 → Illinois)

**Files:**
- Investigate then modify: the progress read model behind `schoolApi.progress` (locate via `grep -rn "curriculumHistory" backend/src/3_applications/school/`) and/or `frontend/src/modules/School/progress/CurriculumHistoryOverview.jsx`
- Test: alongside whichever layer produces the name

**Steps:**
- [ ] **Step 1:** Locate where the node label "Atlas Us P044 Illinois" originates: read the progress use case and check whether nodes carry a raw slug (`atlas-us-p044-illinois`) title-cased frontend-side, or the backend emits that string. Decide the fix at the layer that owns it: if the backend emits slugs, join `getUnit(unitId).title` there exactly as Task 2 did; if the frontend prettifies slugs, prefer a `title` field when present and fall back to a prettifier that strips `/\b[Pp]\d{2,4}\b/` tokens and upcases the standalone word `Us` → `US`.
- [ ] **Step 2:** Write the failing test at that layer: input node named `atlas-us-p044-illinois` (or `title: null` + slug) asserting rendered/emitted label `Illinois` (with course context available separately) — and that a node WITH an authored title passes through untouched.
- [ ] **Step 3:** Implement per Step 1's finding. Run → Expected: PASS.
- [ ] **Step 4:** Commit: `fix(school): curriculum history shows catalog titles, not unit codes`

### Task 9: Artifact image failure handling + legacy 404

**Files:**
- Modify: `backend/src/4_api/v1/routers/school.mjs:1360-1394` (artifact thumbnail try/catch); the handler that currently answers `/sessions/:id/worksheet.thumbnail.png` with 500 (find via `curl` + route-order inspection)
- Modify: `frontend/src/modules/School/teacher/panels/IssuedArtifactCard.jsx:27-28`, `frontend/src/modules/School/teacher/CurriculumIdentity.jsx` (poster `<img>`)
- Test: `backend/src/4_api/v1/routers/school.teacherWorkspace.routes.test.mjs`; extend `FeedbackNotes.test.jsx` pattern for the card

**Steps:**
- [ ] **Step 1:** Route tests: (a) GET `/api/v1/school/teacher/sessions/x/worksheet.thumbnail.png` → 404 JSON (today: 500 `{"error":"internal"}` — find which splat/handler catches it and make the legacy shape an explicit 404 with `{ error: 'not-found', hint: 'artifact routes moved to /teacher/artifacts/:artifactId/…' }`); (b) artifact thumbnail route with a `renderPdfFirstPagePng` that throws → 404 `{ error: 'thumbnail-unrenderable' }`, not 500.
- [ ] **Step 2:** Run → Expected: FAIL. Implement both; wrap the render call in try/catch.
- [ ] **Step 3:** Frontend: give the artifact `<img>`s an `onError` that swaps to the module's not-available treatment: `onError={(e) => { e.currentTarget.replaceWith(Object.assign(document.createElement('p'), { className: 'teacher-muted', textContent: 'Preview not available' })); }}` — implement as a small `SafeImg` component with `const [failed, setFailed] = useState(false)` rendering the fallback `<p>` instead (React-idiomatic, no DOM surgery). Use it in `IssuedArtifactCard` (both imgs) and `LessonIdentity`'s poster. Component test: render `SafeImg` with a src, fire `error` event, assert fallback text.
- [ ] **Step 4:** Extend the "not archived" card copy in `IssuedArtifactCard` to one explanatory sentence: `Original print was not archived — only prints issued after artifact retention began are kept.`
- [ ] **Step 5:** Run both suites → Expected: PASS. Commit: `fix(school): artifact images fail soft — 404s, onError fallbacks, honest copy`

### Task 10: Names not usernames; warning slugs; warning placement

**Files:**
- Modify: `frontend/src/modules/School/teacher/panels/AssignmentsView.jsx` ("Assigned by kckern" line — locate `assignedBy`)
- Modify: `frontend/src/modules/School/teacher/panels/SchoolMatrix.jsx:143-152` (dead-refs list labelizes slugs)
- Test: `frontend/src/modules/School/teacher/panels/AssignmentsView.test.jsx` (exists), `SchoolMatrix.test.jsx` (exists)

**Steps:**
- [ ] **Step 1:** Tests: (a) AssignmentsView with `assignedBy: 'kckern'` and a kids/teachers list containing `{ id: 'kckern', name: 'KC' }` renders `Assigned by KC`; unknown id falls back to `labelize(id)` (never raw). (b) Matrix dead-refs render `labelize('come-follow-me-ot-2026')` → `Come Follow Me Ot 2026` instead of the slug. (Cross-student placement resolves itself in Wave 3 when the matrix leaves the student page.)
- [ ] **Step 2:** Run → Expected: FAIL. Implement: AssignmentsView receives the roster it already has (or `useTeacherProfile().teachers`) and resolves; matrix maps `r.deadRefs.map(labelize).join(', ')`.
- [ ] **Step 3:** Run → Expected: PASS. Commit: `fix(school): display names and labelized slugs in assignments and matrix warnings`

### Wave 1 ship gate

- [ ] Run `npm run test:unit:vitest` → Expected: PASS (compare failures, if any, against a pre-existing-failure baseline captured before Wave 1 started).
- [ ] Build, gate-check (fitness session + Player idle), deploy, verify `/build.txt`.
- [ ] Playwright re-screenshot `/school/teacher/students/learner3/history` (desktop): assert page text contains NO "Lesson title unavailable" and NO "— engine"; screenshot session detail: answers numbered 1-6.
- [ ] Commit any test-baseline notes; move to Wave 2.

---

# Wave 2 — Safety

### Task 11: EnrollmentDrawer arm→confirm

**Files:**
- Modify: `frontend/src/modules/School/teacher/panels/EnrollmentDrawer.jsx:70-80`
- Test: `frontend/src/modules/School/teacher/panels/EnrollmentDrawer.test.jsx` (exists)

**Steps:**
- [ ] **Step 1:** Tests: clicking `Unenroll` does NOT call `schoolApi.unenroll`; it renders a confirm row `Remove ${courseTitle} from ${learner.name}'s program?` with Confirm/Cancel; Confirm calls the api once; Cancel returns to the actions. Same pattern for `Enroll` (confirm copy `Enroll from "${syllabusTitle}"? This replaces any hand-authored order.`) and `Re-materialize` (`Rebuild from the current syllabus? The existing order is replaced.`).
- [ ] **Step 2:** Run → Expected: FAIL.
- [ ] **Step 3:** Implement one `armed` state (`useState(null)` holding `'enroll'|'rematerialize'|'unenroll'`), render the confirm strip in place of the actions row when armed, mirroring `ClosePeriodPanel.jsx:40-58`'s two-tap shape.
- [ ] **Step 4:** Run → Expected: PASS. Commit: `fix(school): enrollment actions require confirmation`

### Task 12: Neutral exception-form defaults

**Files:**
- Modify: `frontend/src/modules/School/teacher/WorkspaceViews.jsx:301-302`, `:312`, `:333`, `:339`
- Test: create `frontend/src/modules/School/teacher/WorkspaceViews.exceptions.test.jsx`

**Steps:**
- [ ] **Step 1:** Tests: initial render has Decision select value `''` showing a `Choose…` option; Reason (paused) select value `''` with `Choose…`; Preview disabled until decision, target, and reason are all chosen; option order lists `Paused globally` last (already true — assert to pin it).
- [ ] **Step 2:** Run → Expected: FAIL.
- [ ] **Step 3:** Implement: initial form `{ kind: '', …, reason: '' }`; add `<option value="">Choose…</option>` to the Decision select; the paused Reason select gains `<option value="">Choose…</option>`; the `change('kind')` special-case sets `reason: ''` (not `'broken'`); `valid` additionally requires `form.kind`.
- [ ] **Step 4:** Run → Expected: PASS. Commit: `fix(school): exception form starts neutral — no preselected destructive defaults`

### Task 13: Close-period moves below the fold

**Files:**
- Modify: `frontend/src/modules/School/teacher/tabs/RecordsTab.jsx:71-90`
- Test: `frontend/src/modules/School/teacher/tabs/RecordsTab.test.jsx` (exists)

**Steps:**
- [ ] **Step 1:** Test: in document order, the frozen-history section ("Closed periods") precedes the Close button; the Close button renders inside that section's container (assert via `within`).
- [ ] **Step 2:** Run → Expected: FAIL. Implement: move `<ClosePeriodPanel …/>` to render immediately after `<FrozenHistory …/>` (pass it down or wrap the two in one `<section className="teacher-period-admin">` with an h3 `Period administration`).
- [ ] **Step 3:** Run → Expected: PASS. Commit: `fix(school): period close lives with closed periods, not above the report card`

### Task 14: Inline retraction reason (kill window.prompt)

**Files:**
- Modify: `frontend/src/modules/School/teacher/WorkspaceViews.jsx:324-331`, `:343`
- Test: extend `WorkspaceViews.exceptions.test.jsx`

**Steps:**
- [ ] **Step 1:** Tests: clicking `Retract` renders an inline `<input maxLength={240}>` + Confirm/Cancel in the exception row; Confirm disabled until non-blank; confirming calls `retractCurriculumException` with the typed reason; `window.prompt` is never invoked (spy).
- [ ] **Step 2:** Run → Expected: FAIL. Implement `const [retracting, setRetracting] = useState(null)` (`exceptionId`), `const [retractReason, setRetractReason] = useState('')`, render the strip in the row, reuse the existing `run('retract-…')` call with `retractReason.trim()`.
- [ ] **Step 3:** Run → Expected: PASS. Commit: `fix(school): exception retraction uses the module's inline reason pattern`

### Task 15: Honest unavailable states for print/quiz panels

**Files:**
- Modify: `frontend/src/modules/School/teacher/panels/PrintPendingView.jsx:15`, `frontend/src/modules/School/teacher/panels/QuizRequestBacklog.jsx:18`
- Test: create `frontend/src/modules/School/teacher/panels/PrintPendingView.test.jsx`

**Steps:**
- [ ] **Step 1:** Test: mock the api returning `{ ok: false, status: 404 }` → panel renders the quiet unavailable copy, no Retry button. Mock 500 → error + Retry (unchanged).
- [ ] **Step 2:** Run → Expected: FAIL. Implement: add `notFoundAs: 'unavailable'` (+ an `unavailableCopy` on their PanelFrames: `Print approvals aren't enabled on this install.` / `Quiz requests aren't enabled on this install.`).
- [ ] **Step 3:** Run → Expected: PASS. Commit: `fix(school): print/quiz panels treat 404 as unavailable like their siblings`

### Wave 2 ship gate

- [ ] `npm run test:unit:vitest` → PASS vs baseline. Build → gate-check → deploy → verify `/build.txt`.
- [ ] Playwright: operations page — Decision/Reason show `Choose…`; reports page — red button below frozen history.

---

# Wave 3 — Structure

### Task 16: Transpose the matrix + legend + unassigned group

**Files:**
- Modify: `frontend/src/modules/School/teacher/panels/SchoolMatrix.jsx:92-163` (render only — `deriveMatrix` stays)
- Modify: `frontend/src/modules/School/Teacher.scss` (`.teacher-matrix__grid` sizing)
- Test: `frontend/src/modules/School/teacher/panels/SchoolMatrix.test.jsx`, `SchoolMatrix.drawer.test.jsx` (update selectors)

**Steps:**
- [ ] **Step 1:** Tests: header row is `Course, <kid names…>`; each body row is one courseId with `titles.course(id)` in the row-th; a cell button still opens `EnrollmentDrawer` for (learnerId, courseId); enrolled cell text is `${syllabusTitle}` + `· ${profile}` when present + ` ⚑` when hand-authored; unenrolled cell renders `—`; a legend paragraph `⚑ hand-authored enrollment · — not enrolled` exists; unassigned courses render as a `<ul>` under heading `Unassigned courses (N)` (replacing the run-on `Nobody is enrolled in:` — assert old string gone).
- [ ] **Step 2:** Run → Expected: FAIL.
- [ ] **Step 3:** Implement the transposed table: outer loop `model.courseIds`, inner loop `model.rows`; keep `data-testid`s; add the legend `<p className="teacher-matrix__legend">`; unassigned block becomes a list of `titles.course(id)` items. SCSS: `th[scope=row]` left-aligned, `max-width: 22rem`, student columns `width: 6rem; text-align: center`.
- [ ] **Step 4:** Run both matrix suites → Expected: PASS. Commit: `feat(school): matrix transposed — courses as rows, legend, unassigned group`

### Task 17: Matrix renders once; student page keeps its own program

**Files:**
- Modify: `frontend/src/modules/School/teacher/WorkspaceViews.jsx:347-358` (`CoursesView` drops `SchoolMatrix`)
- Test: `frontend/src/modules/School/teacher/TeacherConsole.test.jsx` (has section-rendering assertions — update)

**Steps:**
- [ ] **Step 1:** Test: rendering the learner `courses` section does NOT render `[data-testid=school-matrix]`; the global curriculum section still does.
- [ ] **Step 2:** Run → Expected: FAIL. Implement: remove `<SchoolMatrix kids={kids} />` from `CoursesView` (AssignmentsView already shows this learner's own courses; the drawer for THIS learner stays reachable from the catalog page).
- [ ] **Step 3:** Run → Expected: PASS. Commit: `feat(school): whole-school matrix renders once, on the curriculum page`

### Task 18: Curriculum catalog page (kill the 38k-px flat render)

**Files:**
- Create: `frontend/src/modules/School/teacher/panels/CurriculumCatalog.jsx`
- Modify: `frontend/src/modules/School/teacher/WorkspaceViews.jsx:387-389` (`CurriculumView` uses the catalog when no courseId; `CurriculumBrowser` no longer renders there)
- Modify: `frontend/src/modules/School/teacher/panels/CurriculumBrowser.jsx` (becomes the single-course lesson list — see Step 4)
- Test: create `frontend/src/modules/School/teacher/panels/CurriculumCatalog.test.jsx`

**Interfaces:**
- Consumes: `schoolApi.curriculumUnits()` (`{ units: [{ unitId, courseId, courseTitle, title, sequence, passingPercent, hasBank, hasDocument, subject }] }`), `schoolApi.passOverrides()`.
- Produces: catalog card links to `${base}/curriculum/${courseId}` (route already parsed by `teacherUrl.js:48-50`).

**Steps:**
- [ ] **Step 1:** Tests: given 3 courses × 40 units, the catalog renders exactly one card per course (poster `/api/v1/school/teacher/curriculum/{courseId}/poster.jpg` via `SafeImg`, courseTitle, `40 lessons`, `pass 80%` from the modal authored percent, `· N overrides` when passOverrides hit that course's units, and a `Syllabus` link) — and does NOT render any per-unit row or `PassOverride` input. Standalone units render under one `Standalone lessons` card. The guest-preview section from `CurriculumBrowser.jsx:158-172` renders at the bottom.
- [ ] **Step 2:** Run → Expected: FAIL.
- [ ] **Step 3:** Implement `CurriculumCatalog` (course grouping logic copied from `CurriculumBrowser.jsx:71-80`; card grid class `teacher-student-grid` reused). Pass summary: `const pcts = list.map(u => overrideMap[u.unitId] ?? u.passingPercent).filter(n => n != null); const modal = …most frequent…; label = pcts.length ? \`pass ${modal}%\` : 'no pass bar';` with override count appended.
- [ ] **Step 4:** `CurriculumView` becomes: no courseId → `<CurriculumCatalog />` + `<SchoolMatrix/>` + `<CurriculumExceptionPanel/>` + `<PeriodsTimeline/>` + `<EnrichmentPanel/>`; with courseId → existing `<CourseContext courseId=…/>` PLUS the per-lesson pass-override list: refit `CurriculumBrowser` to accept a `courseId` prop and render ONLY that course's units with the existing `PassOverride` rows (delete its all-courses loop), so the drill-in page owns per-lesson pass bars. Add a course-level control at the top of that page: one input + `Set all N lessons` button that loops `schoolApi.putPassOverride` over the course's unitIds behind a single arm→confirm (client-side bulk; per-unit override store is the SSOT).
- [ ] **Step 5:** Run new + existing curriculum tests → Expected: PASS. Commit: `feat(school): curriculum page is a catalog; lessons and pass bars live on the course page`

### Task 19: Tutor insights grouped by signal

**Files:**
- Modify: `frontend/src/modules/School/progress/InstructionalInsightsOverview.jsx:29-75`
- Test: extend `frontend/src/modules/School/progress/InstructionalInsightsOverview.test.jsx`

**Steps:**
- [ ] **Step 1:** Tests: items spanning signals render as one `<details>` per signal in severity order (`review_instruction`, `review_pacing`, `limited_evidence`, `upcoming`, `monitor`, `met`) with `<summary>Review instruction (4)</summary>`; only the first non-empty group has `open`; each group's contents reuse the existing card markup.
- [ ] **Step 2:** Run → Expected: FAIL. Implement grouping around the existing `OverviewDetail` (one `OverviewDetail` per group, same `renderItem`/`renderInspector`).
- [ ] **Step 3:** Run → Expected: PASS (ReportPanel consumer renders the same grouping — acceptable per spec). Commit: `feat(school): tutor insights grouped by signal with counts`

### Task 20: Dashboard/queue dedupe

**Files:**
- Modify: `frontend/src/modules/School/teacher/WorkspaceViews.jsx:197-213` (`DashboardView`), `frontend/src/modules/School/teacher/tabs/TodayTab.jsx` (drop its embedded review/print/quiz panels if present — verify its contents first)
- Test: `frontend/src/modules/School/teacher/tabs/TodayTab.test.jsx`, `TeacherConsole.test.jsx`

**Steps:**
- [ ] **Step 1:** Read `TodayTab.jsx`. Tests: Dashboard renders the Today digest (RosterStrip) and a compact backlog strip — `N to review · N prints · N quiz requests` as a single link/button to the queue — but NOT the three full `PanelFrame` card lists; the queue section still renders all three full lists; the `Student workspaces` grid is gone.
- [ ] **Step 2:** Run → Expected: FAIL. Implement: extract the three counts from the fetches TodayTab already makes (or one `usePanelFetch` trio inside a new `BacklogStrip` component rendered by DashboardView), remove the duplicated panels from the dashboard path, delete the `Student workspaces` section (`WorkspaceViews.jsx:205-210`).
- [ ] **Step 3:** Run → Expected: PASS. Commit: `feat(school): dashboard summarizes backlog; queue owns the lists`

### Task 21: Delete dead tabs; align vocabulary; fix phone truncation

**Files:**
- Delete: `frontend/src/modules/School/teacher/tabs/PlanningTab.jsx`, `tabs/PlanningTab.test.jsx`, `tabs/RepairTab.jsx`, `tabs/RepairTab.test.jsx`
- Modify: `frontend/src/modules/School/teacher/panels/FeedbackNotes.jsx:59` (stale doc-comment), `TeacherConsole.jsx:26-31` (GLOBAL_NAV shorts), `frontend/src/modules/School/Teacher.scss` (`.teacher-workspace__learner-nav`)

**Steps:**
- [ ] **Step 1:** `git rm` the four dead files; fix the doc-comment (`Rendered by RepairTab beside FeedbackNotes.` → `Rendered by HistoryView beside FeedbackNotes.`). Run `npm run test:unit:vitest` → Expected: PASS minus exactly the deleted suites.
- [ ] **Step 2:** GLOBAL_NAV shorts: `Curriculum → short: 'Curriculum'`, `Operations → short: 'Operations'` won't fit four-up at 390px at current sizing — instead set shorts to `Home / Queue / Courses / Ops` is the CURRENT state causing drift; change to `Home / Queue / Curriculum / Ops` is still drifty. Decision: keep short labels but make them truthful abbreviations of the same word — `Home`, `Queue`, `Curric.`, `Ops` — and add `aria-label` with the full word. Learner nav: SCSS `overflow-x: auto; scroll-snap-type: x proximity;` + `white-space: nowrap` on buttons and a trailing fade (`mask-image: linear-gradient(90deg, #000 92%, transparent)`) so "Operations" scrolls into view instead of clipping to "Opera".
- [ ] **Step 3:** Playwright at 390px: learner tab strip scrolls; no mid-word clip visible at rest (allowed: partial LAST tab with fade — assert via screenshot eyeball, not DOM).
- [ ] **Step 4:** Commit: `chore(school): delete dead Planning/Repair tabs; truthful nav labels; scrollable learner nav`

### Wave 3 ship gate

- [ ] Full vitest → PASS vs baseline. Build → gate-check → deploy → `/build.txt`.
- [ ] Playwright: `/school/teacher/curriculum` desktop fullPage height < 5,000px; matrix shows courses as rows; `/students/learner3/courses` has no matrix; phone catalog has no horizontal body scroll.

---

# Wave 4 — Consistency & polish

### Task 22: One date formatter

**Files:**
- Modify: `frontend/src/modules/School/teacher/teacherDates.js` (add + export `humanDate`, `humanDateTime`, `teacherTime`), `WorkspaceViews.jsx:33-46` (delete local copies, import), `panels/RosterStrip.jsx:13-19` (delete `humanDay`, import `humanDate`), `:93` (`teacherTime(session.processedAt)`), `WorkspaceViews.jsx:617` (`humanDateTime(adjustment.at)`)
- Test: `frontend/src/modules/School/teacher/teacherDates.test.js` (create)

**Steps:**
- [ ] **Step 1:** Tests: `humanDate('2026-08-25')` → `Tuesday, Aug 25` (en-US, T12 anchor); `humanDateTime('2026-08-24T15:20:00Z')` matches `/Aug 24, 2026/`; `teacherTime` renders `h:mm AM/PM`; all locale-pinned (`en-US`), no `undefined`-locale `Intl` calls anywhere in the module (`grep -rn "DateTimeFormat(undefined" frontend/src/modules/School/teacher` → empty).
- [ ] **Step 2:** Run → FAIL. Implement (move the two functions verbatim from WorkspaceViews into teacherDates.js, add `teacherTime`), rewire all call sites.
- [ ] **Step 3:** Run module suite → PASS. Commit: `refactor(school): one date formatter for the teacher console`

### Task 23: PanelFrame everywhere

**Files:**
- Modify: `frontend/src/modules/School/teacher/panels/PanelFrame.jsx` (add `alwaysRender` prop: children render in every state, state chrome above them), then migrate `AttestationPanel.jsx`, `PeriodsTimeline.jsx`, `EnrichmentPanel.jsx`, `MilestonesPanel.jsx`, `AssignmentsView.jsx`, `PianoProgramsPanel.jsx` to `<PanelFrame alwaysRender …>`
- Test: create `frontend/src/modules/School/teacher/panels/PanelFrame.test.jsx`; existing panel tests keep passing

**Steps:**
- [ ] **Step 1:** PanelFrame tests: default behavior unchanged (children only on `ok`); with `alwaysRender`, children render alongside the error notice (error state) and the skeleton (loading).
- [ ] **Step 2:** Run → FAIL. Implement: `{(state === 'ok' || alwaysRender) && children}` and suppress `emptyCopy` when `alwaysRender` (the panel's own form IS the content).
- [ ] **Step 3:** Migrate the six panels one at a time, deleting their hand-rolled `Couldn't load…` blocks; run each panel's existing test after its migration → PASS each time.
- [ ] **Step 4:** Commit: `refactor(school): six panels adopt PanelFrame's shared state chrome`

### Task 24: EnrollmentDrawer dialog a11y

**Files:**
- Modify: `frontend/src/modules/School/teacher/panels/EnrollmentDrawer.jsx:36`
- Test: extend `EnrollmentDrawer.test.jsx`

**Steps:**
- [ ] **Step 1:** Tests: drawer root has `aria-modal="true"`; on mount, focus lands inside (close button); pressing Escape calls `onClose`; Tab from the last control wraps to the first (assert with user-event tabbing).
- [ ] **Step 2:** Run → FAIL. Implement mirroring `PinPrompt.jsx:25`'s pattern: `useRef` + `useEffect` focus on mount, `onKeyDown` Escape handler on the aside, simple first/last sentinel trap.
- [ ] **Step 3:** Run → PASS. Commit: `fix(school): enrollment drawer is a real dialog — focus, escape, aria-modal`

### Task 25: Stale-while-revalidate retry + visibility-gated poll

**Files:**
- Modify: `frontend/src/modules/School/teacher/usePanelFetch.js:34-36`, `TeacherConsole.jsx:76-89`
- Test: `frontend/src/modules/School/teacher/usePanelFetch.test.jsx` (exists — extend)

**Steps:**
- [ ] **Step 1:** Tests: after a successful fetch, calling `retry()` keeps `data` non-null and exposes `refreshing: true` until the refetch lands; a retry that fails keeps the stale data with `state: 'ok'` and `refreshError: true` (teacherLog still records). First-load failure behaves exactly as today. Poll test: with `document.visibilityState === 'hidden'` (mock), the 60s interval callback does not fetch; on `visibilitychange` to visible it fetches immediately.
- [ ] **Step 2:** Run → FAIL. Implement: keep `lastGood` in a ref; on retry with lastGood present, set `{ state: 'ok', data: lastGood, refreshing: true }` instead of blanking; resolve into fresh result. TeacherConsole poll: guard `if (document.visibilityState === 'hidden') return;` inside `poll`, plus a `visibilitychange` listener calling `poll()` on visible.
- [ ] **Step 3:** Run → PASS. Commit: `fix(school): retries keep good data; backlog poll respects tab visibility`

### Task 26: Origin-aware back + remaining copy/affordances

**Files:**
- Modify: `frontend/src/modules/School/teacher/teacherUrl.js` (`teacherSessionPath` gains `from` param; parser passes `search` through), `TeacherConsole.jsx:109` (back honors `?from=`), `panels/RosterStrip.jsx:87` (links append `?from=today` — via the path helper), `WorkspaceViews.jsx:587` (ghost button → real link), `TeacherConsole.jsx:135` (`title` attribute), `panels/ReportCardView.jsx` (percent + units per course line), `Teacher.scss` (insight card titles `overflow-wrap: anywhere`)
- Test: `teacherUrl.test.js` (exists — extend), `TeacherConsole.test.jsx`

**Steps:**
- [ ] **Step 1:** Tests: `teacherSessionPath('learner3','s1',BASE,{from:'today'})` ends `?from=today`; SessionInspector back with `?from=today` in `window.location.search` navigates to the dashboard, without it → history (assert `navigate` target). Ghost button: session detail renders a link `Completion credit — use Student operations` pointing at `${base}/students/{ownerId}/operations` (no more `disabled` button). ReportCardView: a course row shows `100% · 12 of 12 units` shape when both are known (pick actual field names from the component when writing the test).
- [ ] **Step 2:** Run → FAIL. Implement each. `parseTeacherPath` ignores search (it takes pathname) — read `window.location.search` at the back-handler site instead; keep the helper signature additive.
- [ ] **Step 3:** Run → PASS. Commit: `fix(school): origin-aware session back, live completion-credit link, report card units`

### Wave 4 ship gate (final)

- [ ] Full `npm run test:unit:vitest` → PASS vs baseline.
- [ ] Build → gate-check → deploy → `/build.txt` shows this commit.
- [ ] Full Playwright sweep: all 10 audit routes at 1280×800 + 390×844. Assert: no "unavailable" placeholder strings on History; curriculum fullPage < 5,000px; no `— engine`; exceptions form starts on `Choose…`; matrix transposed; queue/dashboard deduped.
- [ ] Update `docs/reference/school/README.md` teacher-console section to the new IA (catalog → course page; matrix location; dashboard/queue split) — endstate voice, no wave numbers.
- [ ] Append outcome note to the audit doc header: findings addressed, date, commit.

# Wave 5 — School kiosk split home

### Task 27: AgendaStatusBoard component (shared, read-only)

**Files:**
- Create: `frontend/src/modules/School/status/AgendaStatusBoard.jsx`, `frontend/src/modules/School/status/AgendaStatusBoard.scss` (or a block in `School.scss` — follow the module's existing style placement)
- Test: create `frontend/src/modules/School/status/AgendaStatusBoard.test.jsx`

**Interfaces:**
- Consumes: `schoolApi.roster()` (`[{ id, name }]`), `schoolApi.agendaPreview(learnerId, day)` (`{ sections: [{ subject, servedToday, suppressed, next }] }`), `schoolApi.teacherDay(day)` (`{ learners: [{ learnerId, sessions: [{ subject, outcome }] }] }`) — the exact pair `AgendaPreview` (WorkspaceViews.jsx:78-143) already merges.
- Produces: `<AgendaStatusBoard kids={[{id,name}]} day={localDay()} />` — self-fetching, presentational rows; exported for future teacher-dashboard reuse.

**Steps:**
- [ ] **Step 1:** Tests (mock the two api calls): (a) each kid renders one row: avatar+name, a pill strip with one pill per agenda section (done = filled, remaining = hollow; suppressed sections excluded from the count), and a summary `2 of 3`; (b) status word logic — 0 done + 0 sessions → `Not started`; some done → `In progress`; all agenda sections done → `Done for the day`; (c) a kid whose agenda fetch fails renders name + `—` (never an error card); the whole board returns `null` if roster is empty or every fetch failed; (d) the root carries `aria-hidden="false"` but NO buttons/links and `data-testid="agenda-status-board"`.
- [ ] **Step 2:** Run → Expected: FAIL.
- [ ] **Step 3:** Implement: one `useEffect` fetch cycle on `(day, refreshNonce)` — `Promise.all` over kids' `agendaPreview` plus one `teacherDay`; done-detection per section mirrors `completedBySubject` (WorkspaceViews.jsx:89-94): a section is done when a passed session matches its subject or `servedToday && completed`. A 5-minute `setInterval` bumps `refreshNonce`; interval skips when `document.visibilityState === 'hidden'`. Pure display: `pointer-events: none` on the rows container.
- [ ] **Step 4:** Run → Expected: PASS. Commit: `feat(school): AgendaStatusBoard — read-only per-student day progress`

### Task 28: Split lock screen + 90s side swap

**Files:**
- Modify: `frontend/src/modules/School/SchoolApp.jsx:730-753` (locked keypad branch), `frontend/src/modules/School/School.scss` (split layout)
- Test: create `frontend/src/modules/School/SchoolApp.lockSplit.test.jsx` (or extend the existing SchoolApp lock-mode suite if present — check `frontend/src/modules/School/*.test.jsx` first)

**Steps:**
- [ ] **Step 1:** Tests: locked resting state renders a `.school-lock-split` container holding BOTH `[data-testid=selfservice-keypad]` and `[data-testid=agenda-status-board]`; with `vi.useFakeTimers`, advancing 90s flips a `data-side` attribute (`keypad-left` ↔ `keypad-right`) and keypad entry state survives (type two digits before the flip, still shown after); the LaunchCard view and runner mounts render WITHOUT the board (split applies only to the keypad resting state).
- [ ] **Step 2:** Run → Expected: FAIL.
- [ ] **Step 3:** Implement: in the locked branch, wrap Keypad in `<div className="school-lock-split" data-side={side}>` with `<AgendaStatusBoard kids={roster} …/>` as the sibling pane; `const [side, setSide] = useState('keypad-left')` + 90s interval toggling it (interval lives beside the keypad branch's other state; cleared on unmount). SCSS: `display: grid; grid-template-columns: 1fr 1fr; height: 100%;` with `[data-side="keypad-right"] { direction: rtl; }` + `direction: ltr` reset on children (order flip without remount), board pane `pointer-events: none`. Roster comes from `useSchoolProfile()`'s existing `roster` — already in scope in `SchoolShell`.
- [ ] **Step 4:** Run → Expected: PASS. Playwright on the deployed Portal route at 1280×800: both panes visible, keypad still operable. Commit: `feat(school): locked kiosk splits keypad + status board with burn-in swap`

### Task 29: Restore automatic screen-off

**Files:**
- Investigate: `data/household/screens/portal.yml` (via `sudo docker exec daylight-station sh -c 'cat data/household/screens/portal.yml'`), log store for `screen-off.*` events, `frontend/src/lib/fkb.js` `screenOff()`
- Modify: whichever layer the investigation convicts (screen YAML `school.screenOffTimeoutSeconds`, or `fkb.js`, or the suppression wiring in `SchoolApp.jsx:739-740`)

**Steps:**
- [ ] **Step 1:** Query the log store: `curl -s https://logs.kckern.net/select/logsql/query -d 'query="screen-off" AND _time:7d' -d 'limit=50'` (absolute ranges if needed — `_time` is local-mislabeled). Three verdicts: no `screen-off.requested` at all → the timeout is not configured (check the YAML `school:` block) or the effect is gated off; `requested` without `succeeded` → `screenOff()`/FKB failing (check FKB password/`type=json` handling in `fkb.js`); `succeeded` but screen stays on → FKB-side, test the REST call directly against `10.0.0.92:2323` with `cmd=screenOff`.
- [ ] **Step 2:** Fix at the convicted layer. If it is config: add `screenOffTimeoutSeconds` under the portal screen's `school:` block via docker exec heredoc (full-file write, never sed) and document the value in the YAML comment. If it is code: failing test first in the owning module, then fix.
- [ ] **Step 3:** Verify live: with the Portal on the keypad, wait the configured timeout + margin, then confirm a fresh `screen-off.succeeded` in the log store and the panel actually off (FKB `deviceInfo` `screenOn:false`). Confirm the new status board did NOT reset the idle timer (board refresh must not call `noteActivity`).
- [ ] **Step 4:** Commit whatever code/doc changed: `fix(school): restore automatic kiosk screen-off`

### Wave 5 ship gate (final)

- [ ] Full `npm run test:unit:vitest` → PASS vs baseline. Build → gate-check → deploy → `/build.txt`.
- [ ] Playwright: Portal screen route shows split lock screen; teacher routes unaffected.
- [ ] Live: screen-off verified per Task 29 Step 3.
- [ ] Update `docs/reference/school/README.md` (kiosk section: split home, status board, screen-off) — endstate voice.

## Self-review record

- Spec coverage: every numbered spec item maps to a task (spec 1→T2, 2→T3+T4, 3→T7+T8+T10, 4→T5, 5→T9, 6→T1, 7→T11, 8→T12, 9→T13, 10→T14, 11→T15, 12→T18, 13→T16+T17, 14→T19, 15→T20, 16→T21, 17→T21, 18→T22, 19→T23, 20→T24, 21→T25, 22→T25, 23→T26, 24→T6+T26).
- Known judgment calls recorded in-line: course-level pass bar is a client-side bulk write over the per-unit override store (SSOT unchanged); nav shorts stay abbreviated but truthful; insights grouping applies to the student ReportPanel too (presentational, both benefit).
- Two tasks carry an explicit investigation step (T8 progress-label origin; T9 legacy-500 handler) because the owning layer is genuinely unknown until read — each states the decision rule and both possible implementations.
