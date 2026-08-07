# School Teacher Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full teacher console (`/school/teacher`) per `docs/superpowers/specs/2026-08-06-school-teacher-console-design.md` — Wave 1 (read-only skeleton + three backend enablers) in full detail here; waves 2–5 get their own plan authored at each milestone after the previous wave's Fable review.

**Architecture:** New frontend module `frontend/src/modules/School/teacher/` (four read-only tabs over existing APIs, honest StubCards carrying registry todoIds), plus three small backend enablers: a config-declared teachers read, a print route-order bugfix, and a study-day session window. Identity is a soft teacher claim; per-panel fetch isolation with five states.

**Tech Stack:** React (no router lib inside the module — own pushState model like SchoolApp), SCSS, vitest + @testing-library/react, Express 5 backend with DDD layers.

## Global Constraints

- Spec is authoritative: `docs/superpowers/specs/2026-08-06-school-teacher-console-design.md`. Registry todoIds in §4.6 are load-bearing copy.
- Structured logging only — `teacherLog` facade; never raw `console.*` (CLAUDE.md rule).
- All policy in use cases, never routers (`schoolLifecycle.mjs` header doctrine).
- Never import `modules/Admin/**` or `schoolAdminApi` from School (module-boundary rule).
- Frontend api calls return `{ok, data}` via `schoolApi.js`'s `req()` — no throwing clients.
- Tests: vitest. In this worktree run with the main repo's binary + worktree config (known gotcha): `npx vitest run <paths>` from the worktree root works because node_modules is symlinked; if it fails, `cd` stays in worktree and use `/opt/Code/DaylightStation/node_modules/.bin/vitest`.
- Commit after each task (this host has autonomous commit/build/deploy authority; deploy only at end of wave, honoring the garage/player deploy gate in CLAUDE.local.md).
- Skipping is not passing: no vacuous tests; failed preconditions fail the test.

## Programme roadmap (milestone gates)

| Milestone | Deliverable | Gate |
|---|---|---|
| M1 (this plan) | Wave 1: skeleton + enablers, deployed | Fable stern review of the diff + live verification; fixes applied |
| M2 | Wave 2 plan authored → daily-loop mutations (`teacherConsolePin`, review resolve, print decide, quizrequests clear, Admin grader fix) | Fable review |
| M3 | Wave 3 plan authored → planning (assignments edit, config→data promotion for periods/pass-criteria, milestones domain, enrichment log) | Fable review |
| M4 | Wave 4 plan authored → records (close period UI, progress-report + certificate renderers, enrichment credit, tutor insights polish) | Fable review |
| M5 | Wave 5 plan authored → repair (attestation, reassignment, standalone notes) + reference README update + final deploy | Fable review |

---

### Task 1: Extract `studyDayWindow` into the domain

**Files:**
- Modify: `backend/src/2_domains/school/studyDay.mjs` (add `studyDayWindow`, `withinStudyWindow`)
- Modify: `backend/src/3_applications/school/usecases/GetTeacherToday.mjs` (delete local copies, import from domain)
- Test: `backend/src/2_domains/school/studyDay.window.test.mjs` (new)

**Interfaces:**
- Produces: `studyDayWindow(nowMs, {timezone=null, boundaryHour=4}) -> {startAtMs, endAtMs}` and `withinStudyWindow(iso, {startAtMs, endAtMs}) -> boolean`, exported from `#domains/school/studyDay.mjs`.
- `GetTeacherToday` behavior unchanged (its existing tests are the regression net).

- [ ] **Step 1: Write failing test** — port the window semantics into domain-level cases:

```js
import { describe, it, expect } from 'vitest';
import { studyDayWindow, withinStudyWindow } from './studyDay.mjs';

describe('studyDayWindow', () => {
  it('rolls at the 4am boundary, not midnight (UTC household)', () => {
    const at0330 = Date.parse('2026-08-06T03:30:00Z');
    const w = studyDayWindow(at0330, { timezone: null });
    expect(new Date(w.startAtMs).toISOString()).toBe('2026-08-05T04:00:00.000Z');
    expect(w.endAtMs - w.startAtMs).toBe(86_400_000);
  });
  it('after the roll, the window starts today 4am', () => {
    const at0430 = Date.parse('2026-08-06T04:30:00Z');
    const w = studyDayWindow(at0430, { timezone: null });
    expect(new Date(w.startAtMs).toISOString()).toBe('2026-08-06T04:00:00.000Z');
  });
  it('applies the household timezone offset', () => {
    // 2026-08-06T05:00Z = 2026-08-05T22:00 in America/Los_Angeles (UTC-7):
    // before the LA 4am boundary of Aug 6 → window starts Aug 5 04:00 LA = Aug 5 11:00Z
    const w = studyDayWindow(Date.parse('2026-08-06T05:00:00Z'), { timezone: 'America/Los_Angeles' });
    expect(new Date(w.startAtMs).toISOString()).toBe('2026-08-05T11:00:00.000Z');
  });
});

describe('withinStudyWindow', () => {
  const w = { startAtMs: Date.parse('2026-08-05T04:00:00Z'), endAtMs: Date.parse('2026-08-06T04:00:00Z') };
  it('includes the start, excludes the end', () => {
    expect(withinStudyWindow('2026-08-05T04:00:00Z', w)).toBe(true);
    expect(withinStudyWindow('2026-08-06T04:00:00Z', w)).toBe(false);
  });
  it('rejects garbage without throwing', () => {
    expect(withinStudyWindow(null, w)).toBe(false);
    expect(withinStudyWindow('not-a-date', w)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** (`studyDayWindow` not exported).
- [ ] **Step 3: Move the functions** — cut `studyDayWindow` and `withinWindow` (rename export `withinStudyWindow`) from `GetTeacherToday.mjs` into `studyDay.mjs` verbatim (keep the DST-caveat docblock); in `GetTeacherToday.mjs` import them (`daysTouchedBy` stays local — it's about the datastore's sharding, not the day rule) and alias `withinStudyWindow as withinWindow` to keep call sites unchanged.
- [ ] **Step 4: Run new test + existing `GetTeacherToday` tests** — all pass: `npx vitest run backend/src/2_domains/school/studyDay.window.test.mjs backend/src/3_applications/school/usecases 2>/dev/null || npx vitest run backend/src/2_domains/school backend/src/3_applications/school`
- [ ] **Step 5: Commit** `feat(school): studyDayWindow extracted to domain — one copy of the 4am window math`

### Task 2: `ListLearnerSessions` use case + `?window=today`

**Files:**
- Create: `backend/src/3_applications/school/usecases/ListLearnerSessions.mjs`
- Create: `backend/src/3_applications/school/usecases/ListLearnerSessions.test.mjs`
- Modify: `backend/src/4_api/v1/routers/schoolLifecycle.mjs` (sessions route honors the use case)
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs` (wire it; timezone same source as `GetTeacherToday`: `configService.getTimezone?.() || null`)

**Interfaces:**
- Consumes: Task 1's `studyDayWindow`/`withinStudyWindow`; `IWorkSessionRepository.listForLearner(learnerId)`.
- Produces: `new ListLearnerSessions({sessions, timezone=null, boundaryHour=4, clock=()=>new Date()})` with `execute({learnerId, window=null}) -> Promise<Array<session>>`; `window:'today'` filters on **`updatedAt`** (falling back to `created` when `updatedAt` is absent — same instant a fresh session was touched); any other/absent window returns all.
- Route: `GET /lifecycle/learners/:learnerId/sessions?window=today` → `{sessions: [...]}` (same envelope as today).

- [ ] **Step 1: Failing test:**

```js
import { describe, it, expect } from 'vitest';
import { ListLearnerSessions } from './ListLearnerSessions.mjs';

const mk = (id, updatedAt) => ({ id, updatedAt });
const repo = (rows) => ({ listForLearner: async () => rows });

describe('ListLearnerSessions', () => {
  const clock = () => new Date('2026-08-06T18:00:00Z'); // window = Aug 6 04:00Z → Aug 7 04:00Z
  it('window=today keeps only sessions whose updatedAt falls in the study-day window', async () => {
    const uc = new ListLearnerSessions({ sessions: repo([
      mk('old', '2026-08-05T12:00:00Z'), mk('now', '2026-08-06T09:00:00Z'),
    ]), clock });
    const rows = await uc.execute({ learnerId: 'felix', window: 'today' });
    expect(rows.map((r) => r.id)).toEqual(['now']);
  });
  it('no window returns everything', async () => {
    const uc = new ListLearnerSessions({ sessions: repo([mk('a', '2026-01-01T00:00:00Z')]), clock });
    expect((await uc.execute({ learnerId: 'felix' })).length).toBe(1);
  });
  it('falls back to created when updatedAt is absent', async () => {
    const uc = new ListLearnerSessions({ sessions: repo([{ id: 'c', created: '2026-08-06T05:00:00Z' }]), clock });
    expect((await uc.execute({ learnerId: 'felix', window: 'today' })).map((r) => r.id)).toEqual(['c']);
  });
});
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** (constructor throws without `sessions`; docblock states why this is a use case — the router's no-clock doctrine):

```js
import { studyDayWindow, withinStudyWindow } from '#domains/school/studyDay.mjs';

export class ListLearnerSessions {
  #sessions; #timezone; #boundaryHour; #clock;
  constructor({ sessions, timezone = null, boundaryHour = 4, clock = () => new Date() } = {}) {
    if (!sessions) throw new Error('ListLearnerSessions requires sessions');
    this.#sessions = sessions; this.#timezone = timezone;
    this.#boundaryHour = boundaryHour; this.#clock = clock;
  }
  async execute({ learnerId, window = null } = {}) {
    const rows = await this.#sessions.listForLearner(learnerId);
    if (window !== 'today') return rows;
    const w = studyDayWindow(this.#clock().getTime(), { timezone: this.#timezone, boundaryHour: this.#boundaryHour });
    return rows.filter((s) => withinStudyWindow(s?.updatedAt ?? s?.created, w));
  }
}
```

- [ ] **Step 4: Router + composition.** In `schoolLifecycle.mjs` router: add `listLearnerSessions = null` to the factory signature; in the sessions block replace the inline handler body with `res.json({ sessions: listLearnerSessions ? await listLearnerSessions.execute({ learnerId: req.params.learnerId, window: req.query.window ?? null }) : await sessions.listForLearner(req.params.learnerId) })`. In `backend/src/5_composition/modules/schoolLifecycle.mjs`: construct `new ListLearnerSessions({ sessions: <the same sessions repo passed to the router>, timezone: configService.getTimezone?.() || null })` and pass it. Add a router-level test beside the existing lifecycle router tests asserting `?window=today` delegates to the use case with `window:'today'`.
- [ ] **Step 5: Run tests, commit** `feat(school): sessions read gains study-day window (?window=today)`

### Task 3: Print route-order bugfix

**Files:**
- Modify: `backend/src/4_api/v1/routers/school.mjs` (move the `router.get('/print/*id', …)` registration currently at ~line 205 to AFTER `/print/pending` at ~line 526)
- Test: `backend/src/4_api/v1/routers/school.print.routes.test.mjs` (new)

**Interfaces:** none new — route behavior only.

- [ ] **Step 1: Failing tests** (supertest-style like the existing `school.print.test.mjs`; reuse its router construction helpers):

```js
// Asserts the three fixed print GETs win over the splat, and the splat still
// serves a multi-segment document id. Build the router with a stub
// printService ({listPrintables, quotaFor, pending}) and a stub
// renderPrintDocument that echoes the id it was asked for.
it('GET /print/pending reaches the pending handler, not the document splat', ...)
it('GET /print/printables reaches printables', ...)
it('GET /print/quota reaches quota', ...)
it('GET /print/math/fractions/quiz-1 still resolves as a document id', ...)
```

- [ ] **Step 2: Verify the pending/printables/quota tests FAIL against current order** (they hit the splat).
- [ ] **Step 3: Move the splat registration** below the last fixed `/print/…` route. Keep its handler byte-identical; add a comment: registration order is the fix — fixed routes must precede the splat (Express matches in order; no reserved-name list, it would drift).
- [ ] **Step 4: All four tests pass; run the whole existing print test files too.**
- [ ] **Step 5: Commit** `fix(school): fixed /print routes registered before the *id splat — pending/printables/quota no longer shadowed`

### Task 4: `GetTeachers` use case + `GET /api/v1/school/teachers`

**Files:**
- Create: `backend/src/3_applications/school/usecases/GetTeachers.mjs` (+ colocated `GetTeachers.test.mjs`)
- Modify: `backend/src/4_api/v1/routers/school.mjs` (add `getTeachers = null` dep + route)
- Modify: `backend/src/app.mjs` (wire near the `createSchoolRouter` call ~line 3076; teachers list from the same school config object the lifecycle block reads; roster fn `() => userService.getHouseholdRoster(householdId) ?? []`)
- Test: router case in a new/existing school router test file

**Interfaces:**
- Produces: `new GetTeachers({ teachers, roster, clock=()=>new Date(), logger })` where `teachers` is `() => (string[] | undefined)` (undefined = key absent) and `roster` is `() => Array<{id,name,birthyear}>`. `execute() -> {configured: boolean, teachers: Array<{id, name}>}`.
- Route: `GET /teachers` → that object verbatim. Frontend treats `configured:false` OR `configured:true && teachers.length===0` as the no-teachers card.
- Resolution is per-request; ids that don't resolve to an `isAdult`-passing member are dropped with `logger.warn('school.teachers.unresolved', {id, reason})`. Shape violations (non-string, empty, duplicate) are dropped-and-warned too (`school.teachers.bad-shape`) — never a boot failure (spec §4.7.1).

- [ ] **Step 1: Failing tests:**

```js
import { describe, it, expect, vi } from 'vitest';
import { GetTeachers } from './GetTeachers.mjs';

const roster = () => [
  { id: 'kckern', name: 'KC', birthyear: 1984 },
  { id: 'felix', name: 'Felix', birthyear: 2014 },
  { id: 'nan', name: 'Nan' }, // no birthyear
];
const logger = { warn: vi.fn() };

describe('GetTeachers', () => {
  it('absent key -> configured:false, empty list', async () => {
    const uc = new GetTeachers({ teachers: () => undefined, roster, logger });
    expect(await uc.execute()).toEqual({ configured: false, teachers: [] });
  });
  it('resolves ids at request time, dropping non-adults and unknowns with a warning', async () => {
    const uc = new GetTeachers({ teachers: () => ['kckern', 'felix', 'ghost'], roster, logger });
    const out = await uc.execute();
    expect(out).toEqual({ configured: true, teachers: [{ id: 'kckern', name: 'KC' }] });
    expect(logger.warn).toHaveBeenCalledWith('school.teachers.unresolved', expect.objectContaining({ id: 'felix' }));
  });
  it('a blank birthyear costs a picker entry, never a throw', async () => {
    const uc = new GetTeachers({ teachers: () => ['nan'], roster, logger });
    expect((await uc.execute()).teachers).toEqual([]);
  });
  it('duplicates and non-strings are dropped as bad shape', async () => {
    const uc = new GetTeachers({ teachers: () => ['kckern', 'kckern', 7], roster, logger });
    expect((await uc.execute()).teachers).toEqual([{ id: 'kckern', name: 'KC' }]);
  });
  it('an unreadable roster refuses everyone (empty, configured stays true)', async () => {
    const uc = new GetTeachers({ teachers: () => ['kckern'], roster: () => { throw new Error('boom'); }, logger });
    expect(await uc.execute()).toEqual({ configured: true, teachers: [] });
  });
});
```

- [ ] **Step 2: Verify failure. Step 3: Implement** using `isAdult` from `#domains/school/index.mjs` (per-call roster read, GrownUpGate's pattern; name from `member.name ?? member.id`). Router: `router.get('/teachers', wrap(async (_req, res) => res.json(getTeachers ? await getTeachers.execute() : { configured: false, teachers: [] })));`
- [ ] **Step 4: Wire in app.mjs, run tests. Step 5: Commit** `feat(school): GET /teachers — config-declared teacher roster, resolved per request`

### Task 5: `teacherUrl` + `teacherLog`

**Files:**
- Create: `frontend/src/modules/School/teacher/teacherUrl.js`, `teacherUrl.test.js`, `teacherLog.js`

**Interfaces:**
- Produces: `TABS = ['today','planning','records','repair']`; `parseTeacherPath(pathname) -> {tab, learnerId}` (unknown tab → `{tab:'today', learnerId:null}`); `teacherPathFor(tab, learnerId=null) -> '/school/teacher/<tab>[/<learnerId>]'`; `teacherLog` = child logger facade `{nav, fetch, claim}` each `(event, data)`.

- [ ] **Step 1: Failing tests** — round-trips: `parseTeacherPath('/school/teacher') → {tab:'today', learnerId:null}`; `/school/teacher/records/felix → {tab:'records', learnerId:'felix'}`; `teacherPathFor('records','felix') → '/school/teacher/records/felix'`; unknown tab normalizes to today; learnerId is URI-decoded/encoded.
- [ ] **Step 2–4: Implement, pass.** `teacherLog` mirrors `schoolLog.js`'s facade shape (`getLogger().child({component:'school-teacher'})`, lazy).
- [ ] **Step 5: Commit** `feat(school): teacher console url model + log facade`

### Task 6: `schoolApi` wrappers

**Files:**
- Modify: `frontend/src/modules/School/schoolApi.js`
- Modify: `frontend/src/modules/School/schoolApi.test.js`

**Interfaces (all `{ok,data}` via the existing `req()`):**
- `teachers: () => req('/teachers')`
- `reportCardFrozen: ({learnerId, periodId=null})` → `/report-card/frozen?...`
- `lifecycleReview: () => req('/lifecycle/review')`
- `learnerSessions: (learnerId, {window=null}={})` → `/lifecycle/learners/<id>/sessions[?window=]`
- `assignments: (learnerId) => req('/lifecycle/assignments/<id>')`
- `curriculumUnits: () => req('/lifecycle/curriculum/units')`

- [ ] Steps: failing tests asserting exact fetch URLs (existing test file's pattern), implement, pass, commit `feat(school): schoolApi wrappers for teacher console reads`.

### Task 7: `usePanelFetch`

**Files:**
- Create: `frontend/src/modules/School/teacher/usePanelFetch.js`, `usePanelFetch.test.jsx`

**Interfaces:**
- Produces: `usePanelFetch(fetcher, {deps=[], isEmpty=(d)=>looksEmpty(d), notFoundAs='error', nullAs='empty', panel})` → `{state: 'loading'|'error'|'empty'|'unavailable'|'ok', data, retry}`.
  - `fetcher: () => Promise<{ok, data, status?}>` (schoolApi call). `ok:false` + `status===404` → `notFoundAs` (`'empty'` for assignments, `'unavailable'` for lifecycle panels). `ok:true` + `data===null` → `nullAs` (`'unavailable'` for report card). `ok:true` + `isEmpty(data)` → `'empty'`. Other `ok:false` → `'error'` + `teacherLog.fetch('fetch-failed', {panel, status})`.
  - NOTE: `req()` must expose `status` — extend it to return `{ok, data, status}` (verify no existing destructuring breaks: additive key).
- Also produces `allUnavailable(states) -> boolean` helper for the single-banner rule.

- [ ] **Step 1: Failing tests** covering: ok→ok; 404+notFoundAs:'unavailable'→unavailable; 404+notFoundAs:'empty'→empty; null+nullAs:'unavailable'→unavailable; []→empty; 500→error and logs; retry refetches.
- [ ] **Steps 2–5:** implement, pass, commit `feat(school): usePanelFetch — five-state per-panel isolation`.

### Task 8: `TeacherProfileContext`

**Files:**
- Create: `frontend/src/modules/School/teacher/TeacherProfileContext.jsx`, `TeacherProfileContext.test.jsx`

**Interfaces:**
- Produces: `<TeacherProfileProvider>` + `useTeacherProfile() -> {status:'loading'|'ready', configured, teachers, currentTeacher, claim(id), release(), pickerOpen, openPicker, closePicker}`.
- Fetches `schoolApi.teachers()` once on mount. Claim persisted to `sessionStorage['school-teacher-claim']`; restored only if the id is in the fetched list. `configured=false` OR empty list → the shell renders the no-teachers card (an `unavailable`-class state); picker never opens.

- [ ] **Step 1: Failing tests:** ready-with-teachers exposes list; claim persists to sessionStorage and restores on remount; a persisted id no longer in the list is dropped; `configured:false` → `configured` false and `teachers` empty; child ids never appear (server-trust: whatever the endpoint returns IS the list — test asserts no client-side filtering is added).
- [ ] **Steps 2–5:** implement (pattern-match `SchoolProfileContext.jsx`'s provider/hook shape), pass, commit `feat(school): teacher soft-claim context over the teachers read`.

### Task 9: Shell — `TeacherConsole`, routes, `StubCard` + todo registry

**Files:**
- Create: `frontend/src/modules/School/teacher/TeacherConsole.jsx`, `TeacherConsole.test.jsx`, `panels/StubCard.jsx`, `todoRegistry.js`, `Teacher.scss`
- Create: `frontend/src/modules/School/teacher/tabs/TodayTab.jsx`, `PlanningTab.jsx`, `RecordsTab.jsx`, `RepairTab.jsx` (skeletal — panels arrive Tasks 10–13; each tab renders its StubCards from day one)
- Modify: `frontend/src/main.jsx`

**Interfaces:**
- `todoRegistry.js` exports `TODO = {REVIEW_RESOLVE:'teacher.review.resolve', PRINT_DECIDE:'teacher.print.decide', ASSIGNMENTS_EDIT:'teacher.assignments.edit', PERIODS_EDIT:'teacher.periods.edit', PASSCRITERIA_EDIT:'teacher.passcriteria.edit', MILESTONES:'teacher.milestones', ENRICHMENT_LOG:'teacher.enrichment.log', PERIOD_CLOSE:'teacher.period.close', PROGRESSREPORT_PRINT:'teacher.progressreport.print', CERTIFICATES_PRINT:'teacher.certificates.print', ENRICHMENT_CREDIT:'teacher.enrichment.credit', ATTESTATION:'teacher.attestation', REASSIGN:'teacher.reassign', NOTES_STANDALONE:'teacher.notes.standalone', QUIZREQUESTS_CLEAR:'teacher.quizrequests.clear'}` — exactly the spec §4.6 rows.
- `<StubCard todoId title>children</StubCard>` renders `data-todo={todoId}`, the title, body copy, and the fixed line `Planned — not built yet.` No buttons ever.
- `TeacherConsole` renders: header (title, teacher chip/picker via `ProfilePicker` with `title="Who's teaching?"`), learner selector (kid faces from `schoolApi.roster()`, horizontal scroll, selected persisted in URL), bottom tab bar, active tab. URL sync via `teacherUrl` + `popstate`. No-teachers card replaces the chip area when `!configured || teachers.length===0`.
- `main.jsx`: add above the `/school` routes: `<Route path="/school/teacher" element={<TeacherConsoleRoute />} />`, `<Route path="/school/teacher/*" element={<TeacherConsoleRoute />} />`, and `<Route path="/app/school/teacher/*" element={<TeacherRedirect />} />` + `<Route path="/app/school/teacher" element={<TeacherRedirect />} />` where `TeacherRedirect` mirrors `SchoolDeepLinkRedirect` (preserves sub-path + query, `replace`). `TeacherConsoleRoute` lazy-imports the module (keep the kids' bundle unaffected).

- [ ] **Step 1: Failing tests:** renders four tabs; tab click updates URL (`/school/teacher/planning`); learner select appends id (`/school/teacher/planning/felix`); popstate re-parses; every `TODO` value appears in the document exactly once across tabs (`data-todo` scan — the registry/stub drift test from the spec); no-teachers card when `configured:false`; StubCard renders no `<button>`.
- [ ] **Steps 2–5:** implement, pass (mock schoolApi), commit `feat(school): teacher console shell — tabs, claim, learner selector, stub registry`.

### Task 10: Today tab panels

**Files:**
- Create: `panels/RosterStrip.jsx`, `panels/LearnerDay.jsx`, `panels/ReviewQueueView.jsx`, `panels/PrintPendingView.jsx`, `panels/QuizRequestBacklog.jsx` (+ one `TodayTab.test.jsx` covering the tab)
- Modify: `tabs/TodayTab.jsx`

**Interfaces:**
- `RosterStrip`: joins `schoolApi.teacherToday()` rows (`{learnerId, attemptsToday, correctToday, sessionsToday:[{unitId,state}], pendingReview}`) with `schoolApi.roster()` names/avatars; tap → expands `LearnerDay` (fetches `learnerSessions(id,{window:'today'})` + `progress` recent scores). `teacherToday` unavailable-tell: `[]` alongside a non-empty kids roster renders the lifecycle-unavailable treatment for this panel (spec: reliable unwired signal), plain empty roster otherwise.
- `ReviewQueueView`: `lifecycleReview()` (`notFoundAs:'unavailable'`), grouped by learner, each item shows submitted answer + prompt; footer link `Resolve in Admin → /admin/school/review`. Carries `data-todo` NOTHING (live panel) — the stub for resolution controls is `TODO.REVIEW_RESOLVE` rendered as a StubCard beneath the list.
- `PrintPendingView`: `printPending()`; rows: learner, printable, pages×copies; StubCard `TODO.PRINT_DECIDE` beneath.
- `QuizRequestBacklog`: `quizRequests()`; StubCard `TODO.QUIZREQUESTS_CLEAR` beneath.
- Single-banner rule lives in `TodayTab`: collects lifecycle-backed panel states; when ALL are `unavailable` renders one banner `School lifecycle is not enabled on this install` and suppresses per-panel unavailable notices.

- [ ] **Step 1: Failing tests:** roster cards join names; drill-in calls `learnerSessions` with `window:'today'`; one panel 500 leaves siblings rendered (error isolation); all-lifecycle-404 → exactly one banner; mixed availability → no banner, per-panel notices.
- [ ] **Steps 2–5:** implement, pass, commit `feat(school): teacher Today tab — roster digest, drill-in, review/print/quiz-request reads`.

### Task 11: Planning tab panels

**Files:**
- Create: `panels/AssignmentsView.jsx`, `panels/PeriodsTimeline.jsx`, `panels/CurriculumBrowser.jsx` (+ `PlanningTab.test.jsx`)
- Modify: `tabs/PlanningTab.jsx`

**Interfaces:**
- `AssignmentsView` (learner-scoped): `assignments(learnerId)` with `notFoundAs:'empty'` (a 404 is "nothing assigned"); renders courses → unit gating states, standalone units, programs; StubCard `TODO.ASSIGNMENTS_EDIT`.
- `PeriodsTimeline`: `periods()` — horizontal timeline, current period highlighted (`startsAt <= now < endsAt`); StubCards `TODO.PERIODS_EDIT`, `TODO.PASSCRITERIA_EDIT`.
- `CurriculumBrowser`: `curriculumUnits()` (`notFoundAs:'unavailable'`) + `learningCatalogs()`; course → units listing with sequence; read-only.
- StubCards `TODO.MILESTONES`, `TODO.ENRICHMENT_LOG` at tab level. No learner selected → prompt to pick from header selector (not an error).

- [ ] Steps: failing tests (assignments 404 renders empty-state copy not error; current-period highlight logic; stubs present), implement, pass, commit `feat(school): teacher Planning tab — assignments, periods, curriculum reads`.

### Task 12: Records tab panels

**Files:**
- Create: `panels/ReportCardView.jsx`, `panels/FrozenHistory.jsx`, `panels/EvidenceTree.jsx`, `panels/TutorInsights.jsx`, `panels/PeriodSelect.jsx` (+ `RecordsTab.test.jsx`)
- Modify: `tabs/RecordsTab.jsx`

**Interfaces:**
- `PeriodSelect`: from `periods()`, defaults to current; lifted state in `RecordsTab`.
- `ReportCardView`: `reportCard({learnerId, periodId})` with `nullAs:'unavailable'` (spec: unwired `null` must not read as nothing-graded-yet); renders DRAFT banner, course grades + policy label, materials progress, active days, concept mastery `{mastered, developing}`, remediation arcs, pending-review count; `?format=pdf` link (`<a href={apiBase + …} target="_blank">`).
- `FrozenHistory`: `reportCardFrozen({learnerId})` list → tap to view one; FROZEN banner + closedBy/closedAt; StubCard `TODO.PERIOD_CLOSE`.
- `EvidenceTree`: `progress({userId: learnerId, …})` `curriculumHistory` — collapsible nodes showing evidence counts, `outline` badge, `outstanding` list.
- `TutorInsights`: `instructionalInsights(...)` (verify its existing wrapper signature before use) rendered as a readable brief; quiet empty state.
- StubCards `TODO.PROGRESSREPORT_PRINT`, `TODO.CERTIFICATES_PRINT`, `TODO.ENRICHMENT_CREDIT` at tab level.

- [ ] Steps: failing tests (null report card → unavailable, not empty; period default = current; frozen list renders), implement, pass, commit `feat(school): teacher Records tab — report card, frozen history, evidence tree, tutor insights`.

### Task 13: Repair tab panels

**Files:**
- Create: `panels/FeedbackNotes.jsx` (+ `RepairTab.test.jsx`)
- Modify: `tabs/RepairTab.jsx`

**Interfaces:**
- `FeedbackNotes`: `reviewLearner(learnerId)` — resolved verdicts + notes newest first, the child's-eye view; StubCard `TODO.NOTES_STANDALONE` beneath; StubCards `TODO.ATTESTATION`, `TODO.REASSIGN` at tab level.

- [ ] Steps: failing tests, implement, pass, commit `feat(school): teacher Repair tab — feedback notes read + repair stubs`.

### Task 14: Styling, full verification, deploy, docs

**Files:**
- Modify: `frontend/src/modules/School/teacher/Teacher.scss` (phone-first: bottom tab bar fixed, content scroll, width-capped desktop ≤ 760px centered, School palette but denser type)
- Modify: `docs/reference/school/README.md` (new "Teacher console" subsection under Built and deployed: surface, route, identity/teachers config, five-state posture, registry pointer to the spec)
- Modify: `data/household/config/school.yml` **in the container** (add `teachers:` list — kckern + spouse ids from the household roster) — via `docker exec` heredoc per CLAUDE.local.md; requires container restart to take effect (boot-cached).

- [ ] **Step 1:** Run the entire School test surface + new tests: `npx vitest run frontend/src/modules/School backend/src/2_domains/school backend/src/3_applications/school backend/src/4_api/v1/routers` — everything green (capture real exit code).
- [ ] **Step 2:** `npm run build` (vite) — clean.
- [ ] **Step 3:** Commit docs + code remnants. Check the deploy gate (CLAUDE.local.md: fitness session + playing video greps) — HALT if active.
- [ ] **Step 4:** Build + deploy (`./scripts/build-daylight.sh`, stop/rm, `sudo deploy-daylight`), add `teachers:` to school.yml first so the restart picks it up.
- [ ] **Step 5:** Live verification (evidence, not "should"): `curl -s localhost:3111/api/v1/school/teachers` shows the configured teachers; `curl -s localhost:3111/api/v1/school/print/pending` returns JSON not 404; `curl -s "localhost:3111/api/v1/school/lifecycle/learners/<kid>/sessions?window=today"` returns a filtered list; headless Playwright screenshot of `https://daylightlocal.kckern.net/school/teacher` renders the console (memory: headless screenshot recipe). `/school` still serves the kids' app.
- [ ] **Step 6: Milestone M1 — dispatch the Fable stern reviewer** over the wave-1 diff + live behavior; apply its verdicts; commit fixes.

---

## Self-review notes (plan)

- Spec coverage (wave 1): §4.1 shell/identity/URL → Tasks 5, 8, 9; §4.2 tabs → 10–13; §4.3 client/isolation/lifecycle posture → 6, 7, 10; §4.4 layout → 9 + main.jsx in 9; §4.5 testing → embedded per task (five states in 7/10, stub-drift scan in 9, teachers filtering in 8, url round-trips in 5); §4.6 registry → 9 (`todoRegistry.js` mirrors all 15 rows); §4.7 enablers → 1–4. Waves 2–5: deliberately deferred to per-milestone plans (roadmap table) — not placeholders, a sequencing decision recorded in the spec itself.
- Type consistency: `usePanelFetch` consumed in 10–13 with the option names defined in 7 (`notFoundAs`, `nullAs`); `TODO` keys in 10–13 match 9's registry; `ListLearnerSessions.execute({learnerId, window})` matches the router call in 2 and the client call in 6/10 (`window:'today'`).

---

# Wave 2 — Daily-loop mutations (authored at M2, after the M1 review)

**Contract:** spec §1 security posture (distinct `teacherConsolePin`, checked in owning use cases, role-is-authority with any-adult fallback when `teachers:` absent) + registry rows `teacher.review.resolve`, `teacher.print.decide`, `teacher.quizrequests.clear` + the Admin ReviewQueue grader fix. Acceptance shape per §4.6: live panel replaces stub, registry row deleted (spec table + todoRegistry.js + tab), drift test keeps passing.

### Task W2-1: `TeacherGate`

**Files:** Create `backend/src/3_applications/school/TeacherGate.mjs` (+ colocated test).
**Interface:** `new TeacherGate({ teachers, pin, roster, clock, logger })` where `teachers: () => (string[]|undefined)` and `pin: () => (string|null)` are config accessors (read per call, never snapshotted — the GrownUpGate discipline). `assert({ userId, pin, action })` throws `GuestForbiddenError` unless: (a) `isAdult` passes for userId against the live roster; (b) when the `teachers:` key exists, userId is listed (role IS authority; absent key → any-adult fallback); (c) when a console PIN is configured (non-empty), the provided pin strictly equals it. Refusal messages name the missing thing without echoing the pin; every refusal logs `school.teacher-gate.refused {action, userId, reason}`.
**Config:** `school.yml` gains `teacher: { pin: '<digits>' }` — distinct from `print.teacherPin` by design (answer-key shoulder-surf must not close semesters).

- [ ] Failing tests: adult+listed+right-pin passes; child refused; unlisted adult refused only when key present; wrong/missing pin refused only when configured; unreadable roster refuses all; pin never appears in the thrown message or log payload.
- [ ] Implement, pass, commit.

### Task W2-2: Gate the four writes

**Files:** Modify `ResolveReviewItem.mjs`, `SetAssignments.mjs`, `CloseAcademicPeriod.mjs`, `PrintService.mjs` (+ their tests); `schoolLifecycle.mjs` router (pass `pin` from body); `school.mjs` router (close + print approve/deny pass `pin`); compositions wire `teacherGate`.
**Interface:** each use case gains optional `teacherGate` dep and optional `pin` execute arg. When `teacherGate` present it REPLACES the plain grown-up assert (it subsumes it); absent → behavior byte-identical to today (back-compat: every existing test passes unchanged). PrintService `approve`/`deny` take `{requestId, approver, pin}`.

- [ ] Failing tests per use case: gate invoked with `{userId, pin, action}`; refusal propagates as 403; absent gate = legacy.
- [ ] Wire in `backend/src/5_composition/modules/schoolLifecycle.mjs` + `backend/src/app.mjs` (print service + close): one `TeacherGate` instance shared, accessors reading `getHouseholdAppConfig(null,'school')`.
- [ ] Routers forward `req.body.pin`. Run `lifecycleParentWrites.test.mjs` + router tests. Commit.

### Task W2-3: Quiz-request lifecycle (`teacher.quizrequests.clear`)

**Files:** Modify `SchoolService.mjs` (`listQuizRequests` gains `fulfilled` annotation via the bank `unit:` backlink index; new `dismissQuizRequest({unitId, userId, dismissedBy, pin})` using the gate), `school.mjs` router (`POST /quiz-requests/dismiss`), `YamlSchoolDatastore` if a delete helper is missing (+ tests).
**Interface:** list rows gain `fulfilled: boolean` (a bank bound to the request's unit now exists). Dismiss removes the entry (gate-checked), returns `{dismissed: true}`.

- [ ] Failing tests: fulfilled=true when a bank with matching `unit:` exists; dismiss removes and is gate-checked; commit.

### Task W2-4: Console mutation UI

**Files:** Modify `TeacherProfileContext.jsx` (in-memory `pin` state + `setPin` — never persisted), new `panels/PinPrompt.jsx`, modify `ReviewQueueView.jsx` (verdict correct/incorrect + note ≤120 chars per item, submit via new `schoolApi.resolveReview(sessionId, itemId, {verdict, note, gradedBy, pin})`), `PrintPendingView.jsx` (approve/deny via new wrappers), `QuizRequestBacklog.jsx` (fulfilled badge + dismiss), `todoRegistry.js` (DELETE the three rows), tabs (drop the three StubCards), spec §4.6 table (delete rows), schoolApi wrappers + tests.
**Behavior:** a mutation attempted with no claimed teacher opens the picker; with no pin entered (and the server refusing 403) opens `PinPrompt`; optimistic-nothing — every mutation is server-authoritative refresh (the Admin queue's contract). Per-item error attribution (a failed resolve marks that item, siblings untouched).

- [ ] Failing tests: resolve posts the claimed teacher + pin and refreshes; 403 surfaces the pin prompt, not a dead panel; print approve/deny wired; dismiss wired; drift test now expects 12 registry ids; commit.

### Task W2-5: Admin ReviewQueue grader fix

**Files:** Modify `frontend/src/modules/Admin/School/schoolAdminApi.js` (add `teachers()`), `useGrader.js` (adults from the teachers read instead of the adult-free roster; not-configured → sign-off disabled with an explanatory note), ReviewQueue pin field (small, only when a pin is configured — send it through resolve calls) + tests.
- [ ] Commit.

### Task W2-6: Verify, deploy, M2 review

- [ ] Full School-scoped test sweep green; vite build clean.
- [ ] Add `teacher: { pin }` to the live school.yml (data volume) alongside `teachers:`.
- [ ] Deploy-gate check → build → deploy → live verify (a real resolve with pin via curl on a synthetic pending item is NOT possible without fabricating child work — verify the 403/gate behavior instead: wrong pin → 403, missing pin with pin configured → 403).
- [ ] Update `docs/reference/school/README.md` (console section: wave 2 now live) + spec registry table.
- [ ] Dispatch the Fable stern reviewer (M2); apply verdicts.

---

# Wave 3 — Planning domains (authored at M3, after the M2 review)

**Contract:** registry rows `teacher.assignments.edit`, `teacher.periods.edit`, `teacher.passcriteria.edit`, `teacher.milestones`, `teacher.enrichment.log`. All writes through the existing `TeacherGate` (context field carries what changed). Data lives under `data/apps/school/` (household app data, the assignments pattern), append-only history everywhere.

### W3-1: Periods config→data promotion
- **Adapter** `backend/src/1_adapters/persistence/yaml/YamlAcademicPeriodStore.mjs`: file `data/apps/school/periods.yml` `{periods: [...], history: [...]}`. Implements `IAcademicPeriodSource` (`listPeriods`, `getPeriod`) + `replacePeriods(periods, {editedBy, at})` (validates every entry via `validateAcademicPeriod`, appends `{at, editedBy, periods}` to history, atomic write). **Fallback:** constructed with the existing `ConfiguredAcademicPeriodSource`; when the data file is ABSENT, reads serve the config source verbatim (no silent migration); the FIRST successful `replacePeriods` writes the data file and it wins thereafter.
- **Use case** `SetAcademicPeriods` (`usecases/`): gate (`action: 'periods.edit'`, context `{count}`), validate, `replacePeriods`. Route `PUT /api/v1/school/periods` `{periods, editedBy, pin}` → the stored list. `GET /periods` unchanged (now serves the store).
- **Wiring:** app.mjs replaces `schoolAcademicPeriods` with the store (config source as fallback); everything downstream (`GetReportCard`, router, agenda) inherits.

### W3-2: Pass-criteria overrides
- **Store** `YamlPassOverrideStore` (same file pattern, `data/apps/school/pass-overrides.yml` `{overrides: {unitId: percent}, history: []}`) + `SetPassOverride` use case (gate `passcriteria.edit`, context `{unitId, percent}`; percent 1–100 integer or null to clear).
- **Consumption:** `CloseSessionOutcome` gains optional `passOverrides` (`{percentFor(unitId)}`): effective passing percent = override ?? `unit.passing?.percent`. One consumption point, threaded once.
- **Routes:** `GET /pass-overrides`, `PUT /pass-overrides/:unitId` (gated).

### W3-3: Milestones domain
- **Domain** `2_domains/school/milestones.mjs`: `validateMilestone` (`{id, learnerId, courseId, unitId, dueBy: 'YYYY-MM-DD', label?}`) and `milestoneStatus(milestone, {passedUnitIds, today}) -> 'met'|'behind'|'upcoming'` (met if unit passed; behind if today > dueBy and not passed; else upcoming). Due dates are FIXED; enrichment excusal is a wave-4 presentation-time adjustment, not stored state.
- **Store** `YamlMilestoneStore` (`data/apps/school/milestones.yml`); **use cases** `SetMilestones` (gate, whole-list replace with history — planner-scale) + `GetMilestoneStatuses({learnerId})` deriving passedUnitIds from the work-session repo (`listForLearner` → sessions with passing outcome … reuse the same `result === 'passed'`-shaped check `GetReportCard` uses).
- **Routes:** `GET /milestones?learnerId=`, `PUT /milestones` (gated).

### W3-4: Enrichment log
- **Store** `YamlEnrichmentLog` (`data/apps/school/enrichment.yml`, append-only entries `{id, at, recordedBy, learnerIds, from, to, title, subjectIds, note}`); **use cases** `RecordEnrichment` (gate `enrichment.record`; validates dates/title/learnerIds) + list read (filter by learnerId). Entries are attributed evidence-kind records — never merged into graded evidence.
- **Routes:** `GET /enrichment?learnerId=`, `POST /enrichment` (gated).

### W3-5: Console UI
- **AssignmentsView** gains edit mode (add/remove courses + standalone units from the curriculum catalog; save via new `schoolApi.putAssignments(learnerId, {courses, units, assignedBy, pin})` through `useTeacherWrite`; server-authoritative refresh). Stub `teacher.assignments.edit` removed.
- **PeriodsTimeline** gains an editor (list-edit rows: label, kind, startsAt, endsAt date inputs; save-all via `PUT /periods`). Stub `teacher.periods.edit` removed.
- **CurriculumBrowser** rows show effective passing percent with an override input (PUT per unit). Stub `teacher.passcriteria.edit` removed.
- **MilestonesPanel** (new): per-learner list with status chips + editor (course/unit/dueBy). Stub `teacher.milestones` removed.
- **EnrichmentPanel** (new): entry form (dates, title, subjects multi, learners multi, note) + list. Stub `teacher.enrichment.log` removed.
- Registry shrinks to 7 rows (spec table + todoRegistry + drift test).

### W3-6: Verify, deploy, M3 review
Full sweep → build → gate → deploy → live probes (periods PUT wrong-pin 403 / right-pin no-op is NOT safe (it writes) — verify via GET-after-PUT on a COPY? No: verify wrong-pin 403 only, plus unit tests for the write path; enrichment POST with right pin IS safe-ish but writes real data — use a clearly-labeled test entry then leave it (append-only; harmless) or verify 403 path only) → README/spec updates → Fable M3 review → apply verdicts.

---

# Wave 4 — Records (authored at M4, after the M3 review)

**Contract:** registry rows `teacher.period.close`, `teacher.progressreport.print`, `teacher.certificates.print`, `teacher.enrichment.credit` (registry shrinks to 3). Spec C1/C2/C5.

- **W4-1 Pacing domain (C5):** `2_domains/school/milestones.mjs` gains `paceMilestones(milestones, enrichmentEntries, {today})` → rows `{...m, status, overdueDays, excusedDays, effectiveStatus}` where a 'behind' milestone whose overdue window is fully covered by the learner's enrichment days becomes `effectiveStatus: 'excused'` (never delinquency); other statuses pass through. Pure + tested. Enrichment days count = distinct dates in [from..to] ∩ (dueBy, today].
- **W4-2 Progress report:** `GetProgressReport` use case composes the live report card + paced milestones + in-period enrichment entries → `school.progress-report/v1 {learnerId, period, generatedAt, courses, activeDays, milestones (paced), enrichment: {entries, daysInPeriod}}`. `ProgressReportRenderer` (sibling of ReportCardRenderer, same theme/fonts/pinned CreationDate) renders it with an explicit "Enrichment / experiential learning" section and per-milestone pacing lines ("excused — N enrichment days"). Route `GET /progress-report?learnerId&periodId[&format=pdf]`.
- **W4-3 Certificates:** `CertificateRenderer` — one-page landscape-ish Letter certificate: learner display name, course id/label, completion percent, period label, date, "issued by" line. Route `GET /certificate?learnerId&periodId&courseId&format=pdf` (renders from the live report card's course row; a course with no graded sessions 404s — no fabricated diplomas).
- **W4-4 Console UI:** ReportCardView gains the Close-period flow (confirm + supersede when already frozen; POST close with stamp+pin through useTeacherWrite; refresh frozen list) — stub deleted; RecordsTab gains a PacingPanel (paced milestones + enrichment credit visible on-screen) — enrichment-credit stub deleted; Progress-report PDF link — stub deleted; per-course Certificate links (only for courses with a coursePercent) — stub deleted. Registry/spec table → 3 rows.
- **Deviations recorded at M4:** `/certificate` always renders PDF (the `format` param is accepted but not required); the certificate ships portrait, not "landscape-ish"; the roadmap row's "tutor insights polish" was already delivered by the wave-1 TutorInsights panel — no further work was needed or done.
- **W4-5:** sweep → build → gate → deploy → live verify (close-period NEVER exercised against prod — wrong-pin 403 only; progress-report/certificate GETs are safe reads) → README → M4 Fable review → apply verdicts.

---

# Wave 5 — Repair (authored at M5 open, after the M4 review)

**Contract:** registry rows `teacher.attestation`, `teacher.reassign`, `teacher.notes.standalone` (registry → 0; the StubCard machinery stays for future programmes). Spec D1/D2/D3, plus the e2e journey goal added mid-programme.

- **W5-1 Attestation (D2):** `YamlAttestationLog` (`apps/school/attestations.yml`, append-only `{id, at, attestedBy, learnerId, unitId, reason}`) + gated `RecordAttestation`. **Gate unlock is real:** `BuildAgenda` and `ResolveSubjectNext` accept an optional `attestations` source and append SYNTHETIC history rows (`{unitId, outcome:{result:'passed'}, attested:true}`) before the planner derives `passedUnits` — an attested unit unlocks its successor exactly as a passed one; `GetMilestoneStatuses` counts attested units as met the same way. DELIBERATE: the report card is untouched — attestation is its own evidence kind, listed in the teacher UI, never masquerading as an engine grade. Routes `GET/POST /attestations`.
- **W5-2 Reassignment (D1):** the storage design's intended mechanism — MOVE the attempt events between learners' day shards: `YamlSchoolDatastore.moveAttempts({fromUserId, toUserId, day, assessmentId})` moves rows matching `sessionId ?? provenance.recordId`, stamping each with `{reassignedFrom, reassignedBy, reassignedAt}` and rewriting `attributedTo`; an audit entry appends to `apps/school/reassignments.yml`. Gated `ReassignEvidence`; read `GET /attempts-summary?learnerId&day` groups a day's attempts by assessment for the picker. Derived rollups follow the moved evidence automatically — that is the whole design.
- **W5-3 Standalone notes (D3):** `YamlTeacherNotes` (`apps/school/teacher-notes.yml`, append-only) + gated `RecordTeacherNote`. Delivery: merged into `GET /review/learner` (kind:'note', so the student panel Feedback list shows it) and into BuildAgenda's "Notes for you" window (same current/previous-study-day rule). Routes `GET/POST /teacher-notes`.
- **W5-4 UI:** Repair tab goes fully live — AttestationPanel (unit picker + reason + log), ReassignPanel (day → assessments → target learner, two-tap), notes composer in FeedbackNotes. Registry/spec tables → 0 rows.
- **W5-5 E2E journey (goal addition):** isolated e2e on the lifecycle harness + virtual devices: fake household learner enrolls in the pokemon course (SetAssignments), agenda offers it, session issues a sheet, the VIRTUAL OMR submits marks from the real form map, grading + close outcome record results, then the teacher-side reads see it all (teacher/today digest, report card, progress; review queue if a human mark is required).
- **Deviations recorded at M5:** the promised `apps/school/reassignments.yml` audit log was NOT shipped — provenance rides the moved events themselves (`reassignedFrom/By/At` stamped into each attempt, `attributedTo` rewritten), which the review judged sufficient for a household-scale audit; a cross-learner "what moved this month" query would need a shard scan, accepted. The e2e journey covers the stated goal end-to-end but does not drive the browser console UI against the live wiring (panels are unit-tested with mocked api; routes are tested with injected deps) — the browser↔prod-wiring seam remains the one honestly-open gap.
- **W5-6:** sweep → build → gate → deploy → live verify (safe probes only) → README/spec → M5 Fable review (covers wave 5 + e2e) → apply verdicts → merge to main + branch cleanup.

---

# Wave 6 — Teacher-advocacy remediation (authored after the advocacy review)

**Contract:** the advocate's 19 findings, top-5 first, ALL addressed or explicitly deviation-recorded. Same review cycle (M6 Fable review at the end).

**Batch A (top-5):**
- A1 Notice: tab-bar backlog badges (pending review + pending prints, 60s poll while open) + an hourly `school:teacher-backlog-nudge` scheduler task sending a deduped Telegram intent to each configured teacher (notificationService, dedupeKey = day+counts) with a tappable /school/teacher link.
- A2 Review context: render `rubric`, `reason`, and wait-age (`enqueuedAt`) on every queue item.
- A3 Morning plan: `?format=json` on the agenda-preview route (dry-run sections, no side effects); LearnerDay renders "Today's plan" (subject → next, served-today) above the session history.
- A4 One-tap marks: `useTeacherWrite` stashes an action blocked on claim/PIN and replays it automatically once the claim/PIN lands.
- A5 Honest close: `currentPeriodId` prefers the NARROWEST current period; ClosePeriodPanel's confirm names the period label and the live pending-review count.

**Deviations recorded at M6:** the advocate's #19 print-document PEEK was not delivered — the quota printables render only at print time (there is no preview endpoint for a pending quota job), so the approval row shows label, pages×copies, and wait-age but not the document; building a preview render for quota printables is real new surface, deferred with this record. The nudge teacher list reads the boot-cached config (a teacher added to school.yml nudges after restart) — consistent with the console's own teachers read.

**Batch B (6-19):** absence entry kind (excuses pacing, never credit); slug→label rendering everywhere + materials label join; periods editor rails (kind select, id prefill, two-tap remove with frozen-records warning, parent select, friendly validation); authoring dead-end copy; unit objectives expansion + course syllabus PDF; learner transcript (JSON + PDF across frozen periods); periods clone-forward-a-year; feedback dates/authors + load-more; stale-save guards (409 on concurrent edits); append-only retractions for enrichment/attestations/notes (an attestation retraction re-locks the gate by construction); teacher-triggered retake via the existing remediation route; tree-aware empty states; recent-days chips for reassignment; print-pending wait-age; Admin nav link to the console; picker timeout 10min on the phone surface.

---

# Wave 7 — Student-advocacy remediation (authored after the student-advocate review)

**Contract:** the student advocate's 28 findings — top-5 in full, the remainder addressed or explicitly deviation-recorded. Principle: **no silent verbs about children** — every adult action whose subject is a child produces one child-readable sentence through the existing notes channel; every kid surface tells the truth about waiting, passing, and what didn't save. M7 Fable review at the end.

**Batch A (top-5):**
- A1 (#2) Close the review loop: when the LAST pending review item of a session is resolved, the lifecycle finishes the session (grade → close) in the same act — receipt, coins, unlock, no out-of-band actor. StudentPanel shows "waiting on a mark since …" for submitted sessions.
- A2 (#1) Fail dead-end: quiz summaries state pass/fail; a failed summary offers "Ask for a retake" (kid-safe, ungated like quiz requests → a retake-requests list on the teacher's Today tab). A `printed:false` retry is surfaced on the student panel.
- A3 (#4/#14) Notes: StudentPanel branches on `kind:'note'` (note icon, never the wrong-answer X); feedback polls and shows a "new" marker — the same noticing courtesy the teacher console got.
- A4 (#5) The pass bar is visible: GradeSubmission stamps the EFFECTIVE passing percent into the graded event; CloseSessionOutcome prefers the stamp (an override never moves a bar under an already-graded kid); quiz summaries and receipts say the threshold.
- A5 (#3/#6/#13) No silent verbs: quiz-request dismissal requires a reason that is DELIVERED as a note; reassignment/attestation/attestation-retraction auto-write child-readable notes; the profile picker shows its countdown; a guest runner carries a "not saved" banner; the result receipt prints "Coins: waiting for a grown-up's OK" on awaiting_signoff.

**Batch B:** child-register error copy everywhere ("That didn't save — tell a grown-up", no engineer strings, no silent taps); geo drill skip/exit + missing-asset card; end-of-runner celebration (tiered warm copy + animation); the day plan rendered on the Portal (same preview JSON the teacher reads); kid-scoped progress (own data, human labels, no admin chrome, no sibling flags); marked own answer + text verdict on choices; stable matching shuffle; neutral Missed styling; visible lock reasons on tiles; print-request outcomes kept + shown (deny keeps a record); reflections + kid flags surfaced on the teacher's Today tab ("This seems wrong" on feedback items); age-tier copy softening for the youngest; guilt-stat softening; probe out-of-tries copy; difficulty hidden from kids; feedback fallback labels; no kbd hints on touch.

**Deviations recorded up front (deep rebuilds deferred with reasons):** full mid-quiz resumability (server-side sittings — the tutor's pattern generalized) is real architecture, deferred; a leave-confirm guards the loss meanwhile. Paper-side "one more?" after servedToday stays as designed (the day cap is the pedagogy; ON-SCREEN materials are not day-capped, which is the pressure valve). Tap-again-to-confirm on choice items is deferred (it slows every answer to insure rare mis-taps; the marked-answer fix lands now). A third "show me again (doesn't count)" flashcard lane and deep tutor-linking from fail summaries are deferred to keep this wave shippable.

**Shipped (Wave 7, commits 1fd55f6d3 / f606a9bc6 / 5590dfeda):** Batch A landed exactly as contracted (self-closing review loop with degrade-to-resolve-only on finisher failure; kid-safe retake requests + Today-tab badges; note-kind icon + 60s feedback poll with New marker; graded-bar stamping end to end incl. receipts; delivered dismissal reasons + auto-notes on reassign/attest/retract; picker countdown opt-in; guest banners; awaiting-signoff receipt line). Batch B landed: child-register error sweep (runners, BankBrowser failed-vs-empty split, MaterialDetail lock fallback, SchoolHome "Nothing here yet" captions, probe/capability copy), geo Stop + skip-after-two-misses + unknown-item card, tiered celebration on all three runners, kidMode ReportPanel (no Everyone/admin-link/Needs-attention; admin review badge becomes "waiting for a grown-up to check"), coins on the student panel (optional wallet call), humanized standings, guilt-counter softened past 13 days, PrintService.deny keeps a `denied` record (30-day prune) + `GET /print/requests` + PrintCenter "Your asks", reflections surfaced on RosterStrip via GetTeacherToday's optional evidence dep, kid `kind:'flag'` channel (FlagAsk on quiz summaries → teacher backlog badge with the kid's words), difficulty hidden, kbd chips dropped.

**Found en route (fixed):** QuizRunner's openFailed card was unreachable (checked after the `!sessionId` loading gate it can never pass); `useGrader` treated a `configured:false` teachers read as authoritative and emptied the adult list (now falls back to any-adult, the TeacherGate rule); the isolated Admin suites (reviewQueue/curriculumPlanner) had never been updated for the wave-5 teachers-read + PIN contract.

**Wave-7 deviations still open (recorded above):** mid-quiz resumability, tap-confirm, third flashcard lane, tutor deep-links, paper "one more?". The day-plan-on-Portal item was NOT built this wave — the student panel's "Up next" already serves the kid-facing need; rendering the full dry-run agenda on the kiosk is deferred with this record. The matching shuffle was verified stable per item (useMemo keyed on the item) rather than rebuilt; marked-own-answer + a one-line text verdict WERE missing and were built (MultipleChoiceItem keeps the kid's pick highlighted with "— your pick" and says "Not quite — the answer is X." in words).

**M7 review verdicts applied (post-review commits):** (1) the pass bar/retake ask now has a real producer — `GetMaterialUnits` exposes `quiz.passingPercent` (the same `quiz_pass_percent` the gate applies) and `SchoolMaterialPlayer` hands it to QuizRunner; the catalog path carries no authored threshold and Library/Geography launches are free practice, both no-bar BY DESIGN (recorded, not omitted); the reflection prompt now keys off `learning.moduleId` so a bare threshold never triggers a catalog reflection POST. (2) `dismissQuizRequest` dismisses EXACTLY ONE row — `kind` (null matches legacy kindless rows) and `sessionId` join the identity, the teacher UI sends them, and only the first match goes. (3) the dismissal note is written BEFORE the row is removed — a notes-store failure keeps the child's row and surfaces to the teacher. (4) LearningProbeRunner got the same failed-open sign as the other runners. (5) the A4 invariant is now pinned (stamp beats a later-raised override; legacy unstamped events fall through; the receipt prints the bar), as are the three auto-notes and best-effort note failure on reassign. (6) geo `skip()` guards against an in-flight answer. Deviation 12 resolved by BUILDING the mitigation the record had wrongly claimed: the apple mid-run (quiz/problems/probe) is a two-tap arm/confirm with a visible warning banner, pinned by test.

---

# Wave 8 — Administration-advocacy remediation (authored after the administrator-advocate review)

**Contract:** the administrator advocate's 20 findings — top-5 in full, the remainder addressed or explicitly deviation-recorded. Principle: **the system already records truthfully; this wave makes it RECONCILE** — every store that can drift from another gets a read, a sweep, or a refusal that says so. M8 Fable review at the end.

**Batch A (top-5):**
- A1 (#1/#2) Boot resilience + cold start: `GeneratedBankSource` failure degrades to an empty source with an ERROR log (missing file = quiet empty; malformed = loud empty) — the station must never crash-loop over school content. A real cold-start runbook (`docs/runbooks/school-cold-start.md`) against the ACTUAL `{subject}/{work}/{kind}` layout; the data-volume authoring docs (README/WORK-CONFIG) pulled into git under `docs/reference/school/authoring/`; the four stale layout references corrected.
- A2 (#3) History-vs-catalog integrity: `GetReportCard` surfaces graded sessions whose unitId no longer resolves as a flagged `unresolvedUnits` block (bare-id fallback, warn log `school.report-card.unit-unresolved`) instead of silently dropping them; `ValidateCatalog` gains a reverse sweep (recorded history unitIds vs live catalog).
- A3 (#4) Content-identity stamping: every on-screen attempt stamps `bankRev` (a stable content hash of the bank's items — the print path's rev pattern, applied to the screen path).
- A4 (#10/#6/#13) The whole-school matrix: a Planning-tab panel composing `/lifecycle/assignments` × curriculum courses × pass-overrides — learners × courses with dead-reference, zero-enrollment, and override flags; `plan.errors` rendered instead of warn-logged; `SetAssignments` refuses unknown learners and unknown courses (advisory refusal naming them).
- A5 (#11/#12/#16) Stale-work sweeps: the orphaned `abandoned` event gets its writer (gated `MarkSessionAbandoned`, reason required — no silent verbs) + a stale-session listing on Repair with one-tap abandon; `school-docs list-cards [--status] [--older-than]`; a scheduled `school:retention-sweep` (print-log archival past 180d, denied print rows past 30d, fulfilled quiz-request rows past 30d).

**Batch B (6–20):** invalid banks logged at warm + surfaced count (#7); gated `RegradeSessions` (re-run grading over a bank/date range with provenance) + frozen-version read (#5); `school:rekey-learner` CLI + departure runbook section (#8); `assignedBy` returned from the store + `GET /audit?since=` merging the four history arrays (#9); Active-overrides panel + `?includeRetracted=1` reads (#13); learner-scoped merged record `GET /learner/:id/record` (#14); server-side period validation — same-kind overlap refusal, rename-with-frozen-cards refusal, half-open boundary comparison (#15); bank `unit:` backlink resolution + duplicate refusal in certify, validator-ownership doc (#17); optional `schema:` on banks/units (#18); Admin planner sends `baseUpdatedAt` (#19) and renders stale ids honestly (+ removable) instead of `[object Object]` (#6 tail); nightly content-tree hash manifest task in lieu of git-in-Dropbox (#20, deviation: a `.git` inside the Dropbox-synced volume risks sync churn; the manifest gives drift a diff without it).

**Shipped (Wave 8):** Batch A landed as contracted — A1 boot resilience (GeneratedBankSource degrades warn/error, bank warm names casualties + `GET /banks/health`, cold-start runbook, authoring docs into git, four stale layout references corrected), A2 history-vs-catalog (report-card `unresolvedUnits` flagged block + Records render + warn log; ValidateCatalog reverse sweep wired roster-wide in the certify CLI), A3 `bankRev` content stamping (pure FNV-1a 64 — the domain purity gate refused node:crypto — computed at open, stamped per attempt), A4 the bird's-eye view (SchoolMatrix with dead-ref/zero-enrollment/orphan/override flags; plan.errors exposed in preview JSON + rendered on LearnerDay; SetAssignments advisory refusal by name, degrade-on-broken-catalog), A5 stale sweeps (MarkSessionAbandoned + routes + Repair-tab StaleSessions; `school-docs list-cards`; daily `school:retention-sweep` — retakes/flags never swept). Batch B landed: #5 RegradeBankAttempts (dry-run default, provenance rows, sessionsAffected report) + readable freeze versions; #6-tail AssignmentsView object-form + stale-id checkboxes; #7 warm logging; #8 `school-rekey-learner` CLI (dry-run default, actor keys untouched); #9 store returns `assignedBy` + `GET /audit?since=` over the four history trails (history() reads added); #13 ActiveOverrides panel + `?includeRetracted=1` annotated reads; #14 `GET /learner/:id/record` merged six-channel record; #15 same-kind overlap refusal + frozen-card rename refusal + half-open `withinPeriod`; #17 bank↔unit seam as promotion blockers + validator-ownership table; #18 optional `schema:` discriminators; #19 Admin planner arms the stale-save guard; #20 nightly `school:content-manifest` diff task (deviation held: no git-in-Dropbox).


**M8 review verdicts applied:** (1) regrade corrections are verdict amendments, not work — `isRegradeCorrection` predicate; excluded from getResults, lifetime metrics, the report card's shared period read (activeDays/concepts), and attempt-evidence rows. (2) MarkSessionAbandoned defers to the event machine — states where `abandoned` is illegal (submitted/graded/…) are refused naming the right verb, instead of appending a permanent anomaly that "succeeds" and reappears. (3) `--apply` regrade is idempotent: prior corrections are found forward-of-window (scan to today) and skipped, reported as `alreadyCorrected` — pinned by a real test, not a comment. (4) the rekey CLI rewrites the session `reassigned` event's `fromLearnerId`/`toLearnerId`. (5) rekey also walks `users/{id}/apps/school` so `attributedTo` and frozen-card identities inside the moved dir follow the rename. (6) the retention sweep's join key uses the NUL-escape house delimiter (`web:kckern` is on the prod roster). Challenge 9 closed: `unresolvedUnits` flags `unitCourse.get == null` — a catalog unit authored with no courseId is the same grades-count-toward-no-course fact as a dropped unit. (Reviewer nit stands: the A3 commit MESSAGE says sha1; the code and in-file comment are FNV-1a — recorded here rather than rewriting history.)

---

# Wave 9 (queued) — Visual & print design audit

**Goal extension (2026-08-06):** after the three role advocates (teacher, student, administrator), a fourth reviewer joins the cycle — a high-fashion UX/editorial designer auditing every VISUAL surface: the kiosk JSX (wall, rail, subject/library/catalog, runners), the teacher console at phone width, the Admin school screens, every PDF (report card, syllabus, transcript, certificate, worksheet, OMR sheet), and the thermal receipts (agenda, notice slip). Scope is strictly visual/UX — style, layout, design system, typography, spacing, color, iconography, flow — no code or logic critique. The audit works from actual screenshots and renders, and its ranked top-10 becomes Wave 9's remediation contract under the same cycle (implement → sweep → deploy → Fable M9 review → merge).

**Wave 9 contract (authored at start):** the designer's top-10, plus the teardown's named micro-sins. Batch A: (1)+(2)+(8) practice discoverability — a Practice tile on the wall, a PRACTICE shelf per subject, the Library shows every generic bank grouped by subject, and ONE shared kiosk empty-state pattern (icon + what + how + action) replacing the stranded sentences; (3) names-never-slugs — display titles on the claimed rail, My Progress, report card ("Learner: Felix"), syllabus subtitle, and the thermal notice slip greets instead of printing the raw id; (5) the quiz runner gets a TV layout — centered, display-size question, tile options, green reserved for correct, neutral advance, guest chip instead of a banner, and a summary with ceremony (display score, per-question dots, Try again); (6)+(7) teacher console — planning unit rows become two-line cells with an unwrappable control cluster, the desktop page background inherits the cream, Records' run-on and triple PDF idiom unified; (4)+(9)+(10) print — the report card becomes a ruled table with a humane date and footnoted policy, the certificate gets a border/centering/40pt name/signature line, the worksheet drops its duplicate title and QR plumbing labels, the thermal code caption chunks, and the quiz sheet keeps ONE answer surface. Batch B: the micro-sweep (WATCH-count spacing, poster skeletons, interpunct orphans, Pending-sync hidden on the kid board, Today zero-rows copy, 'created since' copy, Abandon truncation, CURRENT badge hierarchy, Catalog double-heading, transcript copy, timestamp formats). M9 review re-audits VISUALLY from fresh screenshots/renders.
