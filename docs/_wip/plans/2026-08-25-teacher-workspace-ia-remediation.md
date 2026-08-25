# Teacher Workspace Information-Architecture Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the `/school/teacher` workspace so a teacher can retrace any school day on one page, read one lesson exactly once, and find the right intervention by name — resolving findings IA1–IA6 of `docs/_wip/audits/2026-08-25-teacher-view-information-architecture-audit.md`.

**Architecture:** A new **Learner Day** view becomes the organizing unit of the workspace. It joins the two reads that already exist — the agenda planner's dry-run `sections[]` (what was *planned*) and the day projection's `sessions[]` (what was *done*) — into one date-navigable list. The join is a pure function so it can be tested without a DOM. Every other change removes a duplicate rendering, merges two renderings of one lesson into one, or gives an existing action a correct home and a correct button weight. **No backend change is required:** both `GET /teacher/day` and the agenda preview already accept an arbitrary `studyDay`, and the frontend already performs a weaker version of this join at `WorkspaceViews.jsx:85-90`.

**Tech Stack:** React 18 (no router — the console owns its own route model in `teacherUrl.js`), SCSS (`Teacher.scss`), Vitest + @testing-library/react for unit/component tests, Playwright for the frontend-only visual contract (`playwright.teacher.config.mjs`, API fully mocked — it never boots the household backend).

---

## The real backend shapes (read this before writing any fixture)

A backend read-model survey was run for this plan. **The frontend currently reads several fields the backend does not produce.** Fixtures invented from the current frontend code would encode those bugs into new tests. Use these shapes.

**`GET /teacher/day?studyDay=YYYY-MM-DD`** → `{ schema, studyDay, generatedAt, learners[] }`. Handler `backend/src/4_api/v1/routers/school.mjs:1288`, service `3_applications/school/usecases/GetTeacherToday.mjs`. `studyDay` is optional; omitted means the household-timezone study day with a **4am** boundary. A learner row carries `sessions[]` (sessions whose **original study day is the requested day**), `processedToday[]` (sessions from **other** study days scanned or graded on the requested day), `effectiveScoreTotals{correct,total,percent}`, `pendingReview` (a count), and `reflections[]`.

A session summary carries: `sessionId, learnerId, unitId, lessonId, lessonTitle, subject, subjectIcon, courseId, courseTitle, moduleId, moduleTitle, posterUrl, studyDay, createdAt, issuedAt, updatedAt, processedAt, state, machineScore, effectiveScore{percent,correctCount,totalCount}, reviewStatus, outcome{result,at}`.

**`GET /lifecycle/learners/:id/agenda/preview?format=json&studyDay=…`** → `{ learnerId, studyDay, sections[], entries[], errors[] }`. Service `usecases/BuildAgenda.mjs`, sections built by `2_domains/school/agenda.mjs#planDailyAgenda`. Side-effect free either way. A section carries: `subject, servedToday, next|null, lockedRemedy, timingNotice, progressLabel, gradePercent, programUnavailable, focus, suppressed{bySubject,byUnitId,reasons}, obligation{state,reason}`. `section.next` is a planner entry: `{ unitId, title, subject, courseId, sequence, module, status, timing, lockReason, remedy, … }`.

**Four corrections this forces on the naive implementation:**

1. **`section.next.label` does not exist.** Planner entries have `title`. `label` lives only on `BuildAgenda`'s `offers[]`, which the JSON branch never returns. Any `?? next.label` is dead — keep it only as a harmless tail, never as the thing a test asserts.
2. **A section has NO `courseTitle`, `moduleTitle`, or `posterUrl`** — only ids (`courseId`, `module`, `unitId`). A *planned-but-not-done* row therefore **cannot** render `<LessonIdentity>`; it gets `<SubjectIdentity>` plus the plain title. The plan does this deliberately. (`BuildAgenda` already resolves full taxonomy for the printed PNG branch and simply doesn't return it in JSON — see the follow-ups appendix.)
3. **`section.next.unitId` and `session.unitId` both exist**, so plan-vs-actual can be matched **exactly by unit**, not merely by subject. The existing `completedBySubject` join (which this plan deletes) matched on subject alone and so could neither handle two sessions in one subject nor confirm the lesson done was the lesson planned.
4. **`reviewStatus` is `'pending'` or `'complete'`** — *not* `'pending_review'`. `RosterStrip.jsx:18` tests for `'pending_review'` and therefore renders "Not graded" for every session actually awaiting review. Accept both spellings in new code.

**`GET /teacher/sessions/:id`** → the shapes matter for Task 10:
- `assignment.questions[]` = `{ itemId, number, prompt, choices[{ id, label, letter, correct }], expected[] }` — choices carry **`label`, not `text`**, and each carries its own **`letter`**.
- `assessment.items[]` = `{ itemId, questionNumber, prompt, given, expected[], verdict }` — **`given` and `expected` may hold letters (`"C"`, `["B"]`) or answer text**, depending on whether the answer arrived by bubble sheet or another path. This is why production shows "Their answer: **B,D** · Correct" on one row and "Their answer: A broken spirit" on the next (audit IA6).
- `artifacts[]` mixes two shapes: worksheets have `kind` + `originalPdfUrl` + `thumbnailUrl`; receipts have `role: 'result-receipt'` + `originalUrl` and **no thumbnail**. An unavailable artifact carries only `{ artifactId, availability: 'unavailable', exactBytesRetained: false }` — nothing else.
- `gradeAdjustments` live at **`state.gradeAdjustments`**, not top level. `revision` is the max event seq.

**`GET /teacher/learners/:id/timeline`** → `{ schema, learnerId, items[], nextCursor }`. Params: `limit` (1–200), `before` (cursor = ISO `updatedAt`), `unitId`. **No date range, no day grouping.** A row carries **`day`, not `studyDay`**, and **`gradedPercent` only — no `effectiveScore`/`machineScore`**. `WorkspaceViews.jsx` reads `session.studyDay` and `session.effectiveScore` on these rows, so history currently dates rows by `updatedAt` (a Monday lesson rescanned Friday shows Friday) and never shows a score. Task 9 fixes both.

---

## Before you start: essential context

You are working in a household homeschool app. The "teacher" is a parent. The workspace under audit is at `frontend/src/modules/School/teacher/`. Read these three things before Task 1:

1. **The audit**: `docs/_wip/audits/2026-08-25-teacher-view-information-architecture-audit.md`. Every task below cites the finding it closes.
2. **`usePanelFetch.js`** — the module's five-state fetch contract (`loading | ok | empty | error | unavailable`). `notFoundAs: 'unavailable'` means "a 404 is this install lacking the feature, not an error." Never hand-roll loading/error chrome; wrap content in `PanelFrame`.
3. **`useTeacherWrite.js`** — every write is preview-then-apply, attributed to a teacher, and some require a PIN step-up. **Do not touch write semantics anywhere in this plan.** This plan moves, merges, and restyles read surfaces and relocates existing buttons. If a change would alter what a write does, you have gone off-plan.

### Rules for this codebase (violating these fails review)

- **No raw `console.log/warn/error`.** Use the logging framework. In this module the facade is `teacherLog.js`.
- **Slugs are not labels.** Render ids through `labelize()`; render lesson/course identity through `<LessonIdentity>` / `<SubjectIdentity>` from `CurriculumIdentity.jsx`.
- **Dates**: use `teacherDates.js` helpers only (`humanDate`, `teacherDate`, `humanDateTime`, `teacherTime`, `localDay`). Never `toLocaleString()` inline. Never `toISOString()` for a day (it is UTC and flips the date every evening).
- **Commit after every task.** Small commits.

### Commands you will use constantly

```bash
# Run one test file (from repo root — the vitest config lives there)
npx vitest run frontend/src/modules/School/teacher/<file>.test.jsx

# Run the whole teacher module
npx vitest run frontend/src/modules/School/teacher/

# Lint (must be clean — max-warnings 0)
npm run lint --prefix frontend

# The frontend-only Playwright visual contract (safe: mocks all APIs, no backend)
npx playwright test --config playwright.teacher.config.mjs --reporter=line
```

### ⚠ Never start a second backend

`node backend/index.js` is a live household controller — it makes real Home Assistant calls. A dev server may already be running. **This entire plan is frontend-only and needs no backend.** The Playwright config above starts only Vite on port 3113.

---

## Task 0: Set up an isolated worktree

**Step 1: Confirm you are in sync with the deployed tree**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git fetch origin
ssh homeserver.local 'cd /opt/Code/DaylightStation && git branch --show-current && git log --oneline -1'
```

Expected: the homeserver's HEAD commit is an ancestor of your local `HEAD`. Verify:

```bash
git merge-base --is-ancestor <homeserver-commit> HEAD && echo IN-SYNC || echo BEHIND
```

If it prints `BEHIND`, stop and integrate the homeserver branch first (see `CLAUDE.local.md`).

**Step 2: Create the worktree**

```bash
git worktree add .claude/worktrees/teacher-ia -b feat/teacher-workspace-ia
cd .claude/worktrees/teacher-ia
ln -s ../../../node_modules node_modules
ln -s ../../../../frontend/node_modules frontend/node_modules
```

**Step 3: Verify the module is green before you change anything**

```bash
npx vitest run frontend/src/modules/School/teacher/
```

Expected: all files pass. **Write down the file/test counts.** If anything is already red, note it — you must not be blamed for it, and you must not let it hide a regression you cause.

**Step 4: Commit nothing yet.** Proceed to Task 1.

---

# PHASE 1 — The Learner Day (closes IA3, IA2)

The teachers' hardest complaint: retracing a day means visiting three surfaces with three different data sources, one of which (the agenda) is framed as a planning tool and one of which (History) has no date control at all. Phase 1 builds one date-navigable record.

## Task 1: The pure join — `learnerDay.js`

The join answers: *for this child on this study day, what was planned, what got done, what was skipped and why, and what happened that nobody planned.*

**Files:**
- Create: `frontend/src/modules/School/teacher/learnerDay.js`
- Test: `frontend/src/modules/School/teacher/learnerDay.test.js`

**Step 1: Write the failing test**

Create `frontend/src/modules/School/teacher/learnerDay.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { joinLearnerDay } from './learnerDay.js';

// Shapes mirror the real read models — a section's plan lives at
// `next.title`/`next.unitId`; a session summary carries its own unitId.
const section = (subject, extra = {}) => ({ subject, next: { title: `${subject} lesson`, unitId: `${subject}.01` }, ...extra });
const session = (subject, sessionId, extra = {}) => ({ subject, sessionId, unitId: `${subject}.01`, lessonTitle: `${subject} done`, ...extra });

describe('joinLearnerDay', () => {
  it('marks a planned subject with a recorded session as done', () => {
    const { rows } = joinLearnerDay({ sections: [section('math')], sessions: [session('math', 'ses_1')] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subject: 'math', status: 'done', planned: 'math lesson' });
    expect(rows[0].session.sessionId).toBe('ses_1');
  });

  it('matches the session to the planned UNIT, not merely the subject', () => {
    // Both sessions are "math"; only one is the unit the planner offered.
    const { rows } = joinLearnerDay({
      sections: [section('math')],
      sessions: [session('math', 'ses_other', { unitId: 'math.99' }), session('math', 'ses_planned')],
    });
    const planned = rows.find((row) => row.planned);
    expect(planned.session.sessionId).toBe('ses_planned');
    expect(planned.matchedOn).toBe('unit');
  });

  it('falls back to a subject match when the session carries no unit', () => {
    const { rows } = joinLearnerDay({
      sections: [section('math')],
      sessions: [session('math', 'ses_1', { unitId: undefined })],
    });
    expect(rows[0]).toMatchObject({ status: 'done', matchedOn: 'subject' });
  });

  it('marks a planned subject with no session as planned', () => {
    const { rows } = joinLearnerDay({ sections: [section('math')], sessions: [] });
    expect(rows[0]).toMatchObject({ subject: 'math', status: 'planned', session: null });
  });

  it('explains a deferred subject with the subject it yielded to', () => {
    const { rows } = joinLearnerDay({ sections: [section('art', { suppressed: { bySubject: 'math' } })], sessions: [] });
    expect(rows[0]).toMatchObject({ status: 'deferred', detail: 'Deferred for math focus' });
  });

  it('marks a locked subject as blocked and carries the remedy', () => {
    const { rows } = joinLearnerDay({ sections: [section('math', { lockedRemedy: 'Finish Unit 2 first' })], sessions: [] });
    expect(rows[0]).toMatchObject({ status: 'blocked', detail: 'Finish Unit 2 first' });
  });

  it('trusts servedToday when the planner says the day is complete but no session is linked', () => {
    const { rows } = joinLearnerDay({ sections: [section('math', { servedToday: true })], sessions: [] });
    expect(rows[0]).toMatchObject({ status: 'done', session: null });
    expect(rows[0].detail).toMatch(/no session record/i);
  });

  it('lists a session whose subject was never planned as extra', () => {
    const { rows } = joinLearnerDay({ sections: [], sessions: [session('piano', 'ses_9')] });
    expect(rows[0]).toMatchObject({ subject: 'piano', status: 'extra' });
    expect(rows[0].detail).toMatch(/not on/i);
  });

  it('emits one row per session when a subject has two', () => {
    const { rows } = joinLearnerDay({
      sections: [section('scripture')],
      sessions: [session('scripture', 'ses_1'), session('scripture', 'ses_2')],
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'done')).toBe(true);
    // The planned title is stated once, not repeated per session (IA1).
    expect(rows.map((row) => row.planned)).toEqual(['scripture lesson', null]);
  });

  it('counts every status and the total', () => {
    const { counts } = joinLearnerDay({
      sections: [section('math'), section('art', { suppressed: { bySubject: 'math' } }), section('reading')],
      sessions: [session('math', 'ses_1'), session('piano', 'ses_2')],
    });
    expect(counts).toMatchObject({ done: 1, planned: 1, deferred: 1, extra: 1, total: 4 });
  });

  it('survives empty input', () => {
    expect(joinLearnerDay({})).toMatchObject({ rows: [], counts: { total: 0 } });
  });

  it('keeps a subjectless session rather than dropping it', () => {
    const { rows } = joinLearnerDay({ sections: [], sessions: [{ sessionId: 'ses_x' }] });
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBeNull();
  });
});
```

**Step 2: Run it to make sure it fails**

```bash
npx vitest run frontend/src/modules/School/teacher/learnerDay.test.js
```

Expected: FAIL — `Failed to resolve import "./learnerDay.js"`.

**Step 3: Write the implementation**

Create `frontend/src/modules/School/teacher/learnerDay.js`:

```js
/**
 * The Learner Day join (UX audit IA2/IA3).
 *
 * Retracing a school day used to mean reading three surfaces: the agenda
 * planner (what was OFFERED), the day projection (what was DONE), and the
 * History tab (which has no date control at all). Neither read is complete
 * alone, so this joins them into one list keyed by subject — including the
 * two cases both surfaces used to drop on the floor: work that was planned
 * and skipped, and work that happened without ever being planned.
 *
 * Pure by design: no fetching, no React. The view owns the reads.
 */

const NO_SUBJECT = '__no-subject__';
const subjectKey = (subject) => subject ?? NO_SUBJECT;

/** Status vocabulary, in the teacher's words — never an internal state name. */
export const DAY_STATUS_LABEL = {
  done: 'Done',
  planned: 'Not started',
  deferred: 'Deferred',
  blocked: 'Blocked',
  extra: 'Extra',
};

function groupSessionsBySubject(sessions) {
  const grouped = new Map();
  for (const session of sessions) {
    const key = subjectKey(session?.subject ?? null);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(session);
  }
  return grouped;
}

/**
 * Order a subject's sessions so the one the planner actually offered leads.
 * Both sides carry `unitId`, so the match can be exact; the old subject-only
 * join could not tell "did the planned lesson" from "did some other lesson
 * in the same subject".
 */
function orderByPlannedUnit(sessions, plannedUnitId) {
  if (!plannedUnitId) return { ordered: sessions, matchedOn: sessions.length ? 'subject' : null };
  const index = sessions.findIndex((session) => session.unitId === plannedUnitId);
  if (index < 0) return { ordered: sessions, matchedOn: sessions.length ? 'subject' : null };
  return { ordered: [sessions[index], ...sessions.filter((_, i) => i !== index)], matchedOn: 'unit' };
}

/**
 * @param {object}   input
 * @param {Array}    input.sections  agenda preview `sections[]` — the plan
 * @param {Array}    input.sessions  day projection `sessions[]` — the record
 * @param {string?}  input.studyDay  the day these describe (echoed back)
 * @returns {{ studyDay: string|null, rows: Array, counts: object }}
 */
export function joinLearnerDay({ sections = [], sessions = [], studyDay = null } = {}) {
  const unmatched = groupSessionsBySubject(Array.isArray(sessions) ? sessions : []);
  const rows = [];

  for (const section of Array.isArray(sections) ? sections : []) {
    const subject = section?.subject ?? null;
    const key = subjectKey(subject);
    const found = unmatched.get(key) ?? [];
    unmatched.delete(key);
    // `next.label` does not exist on a planner entry — kept only as a tail.
    const planned = section?.next?.title ?? section?.next?.label ?? null;
    const { ordered: matched, matchedOn } = orderByPlannedUnit(found, section?.next?.unitId ?? null);

    if (matched.length) {
      // The plan is stated once for the subject, not repeated per session —
      // repeating it is the duplication the teachers objected to (IA1).
      matched.forEach((session, index) => rows.push({
        key: session.sessionId ?? `${key}:done:${index}`,
        subject, status: 'done', planned: index === 0 ? planned : null, session, detail: null,
        matchedOn: index === 0 ? matchedOn : null,
      }));
      continue;
    }
    if (section?.suppressed) {
      rows.push({
        key: `${key}:deferred`, subject, status: 'deferred', planned, session: null,
        detail: section.suppressed.bySubject ? `Deferred for ${section.suppressed.bySubject} focus` : 'Deferred',
      });
      continue;
    }
    if (section?.lockedRemedy) {
      rows.push({ key: `${key}:blocked`, subject, status: 'blocked', planned, session: null, detail: section.lockedRemedy });
      continue;
    }
    if (section?.servedToday) {
      rows.push({
        key: `${key}:served`, subject, status: 'done', planned, session: null,
        detail: 'Completed — no session record',
      });
      continue;
    }
    rows.push({
      key: `${key}:planned`, subject, status: 'planned', planned, session: null,
      detail: section?.timingNotice ?? null,
    });
  }

  // Anything recorded that the plan never offered. Silently dropping these
  // made the day record lie about what the child actually did.
  for (const [key, matched] of unmatched) {
    matched.forEach((session, index) => rows.push({
      key: session.sessionId ?? `${key}:extra:${index}`,
      subject: key === NO_SUBJECT ? null : key,
      status: 'extra', planned: null, session,
      detail: 'Not on the day’s plan',
    }));
  }

  const counts = rows.reduce(
    (acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1, total: acc.total + 1 }),
    { total: 0 },
  );
  return { studyDay, rows, counts };
}

export default joinLearnerDay;
```

**Step 4: Run the test to verify it passes**

```bash
npx vitest run frontend/src/modules/School/teacher/learnerDay.test.js
```

Expected: PASS, 10 tests.

**Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/learnerDay.js frontend/src/modules/School/teacher/learnerDay.test.js
git commit -m "feat(school/teacher): pure plan-vs-actual join for a learner's study day"
```

---

## Task 2: Day arithmetic — `shiftDay`

The day view needs previous/next navigation. Adding a day must not break across DST or month ends.

**Files:**
- Modify: `frontend/src/modules/School/teacher/teacherDates.js`
- Test: `frontend/src/modules/School/teacher/teacherDates.test.js` (exists — append)

**Step 1: Write the failing test**

Append to `frontend/src/modules/School/teacher/teacherDates.test.js`:

```js
import { shiftDay } from './teacherDates.js';

describe('shiftDay', () => {
  it('moves forward a day', () => {
    expect(shiftDay('2026-08-25', 1)).toBe('2026-08-26');
  });
  it('moves backward a day', () => {
    expect(shiftDay('2026-08-25', -1)).toBe('2026-08-24');
  });
  it('crosses a month boundary', () => {
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01');
  });
  it('crosses a year boundary backwards', () => {
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('crosses a US spring-forward DST boundary without losing a day', () => {
    expect(shiftDay('2026-03-08', 1)).toBe('2026-03-09');
  });
  it('returns null for garbage', () => {
    expect(shiftDay('not-a-day', 1)).toBeNull();
    expect(shiftDay(null, 1)).toBeNull();
  });
});
```

Note: the existing test file already imports `describe/it/expect` from vitest at the top — do not import them twice. Add only the `shiftDay` import and the block.

**Step 2: Run to verify it fails**

```bash
npx vitest run frontend/src/modules/School/teacher/teacherDates.test.js
```

Expected: FAIL — `shiftDay is not a function`.

**Step 3: Implement**

Add to `frontend/src/modules/School/teacher/teacherDates.js`, after `localDay`:

```js
/** Move a YYYY-MM-DD day by whole days. Noon-anchored, so DST can't eat a day. */
export function shiftDay(day, delta = 1) {
  const date = dateFor(day);
  if (!date) return null;
  date.setDate(date.getDate() + delta);
  return localDay(date);
}
```

`dateFor` is already defined at the top of the file and anchors bare `YYYY-MM-DD` values at `T12:00:00` local — that is why this is DST-safe. Do not change `dateFor`.

**Step 4: Run to verify it passes**

```bash
npx vitest run frontend/src/modules/School/teacher/teacherDates.test.js
```

Expected: PASS (5 original + 6 new = 11 tests).

**Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/teacherDates.js frontend/src/modules/School/teacher/teacherDates.test.js
git commit -m "feat(school/teacher): DST-safe shiftDay for day-to-day navigation"
```

---

## Task 3: Route the day view

**Files:**
- Modify: `frontend/src/modules/School/teacher/teacherUrl.js`
- Test: `frontend/src/modules/School/teacher/teacherUrl.test.js` (exists — append)

The new address is `/school/teacher/students/:learnerId/day/:studyDay`. `:studyDay` is optional; absent means today.

**Step 1: Write the failing test**

Append to `frontend/src/modules/School/teacher/teacherUrl.test.js`:

```js
describe('learner day route', () => {
  it('parses a dated day route', () => {
    expect(parseTeacherPath('/school/teacher/students/learner-a/day/2026-08-25')).toMatchObject({
      kind: 'learner', section: 'day', learnerId: 'learner-a', studyDay: '2026-08-25',
    });
  });
  it('parses an undated day route as today-by-default', () => {
    expect(parseTeacherPath('/school/teacher/students/learner-a/day')).toMatchObject({
      kind: 'learner', section: 'day', learnerId: 'learner-a', studyDay: null,
    });
  });
  it('rejects a malformed study day', () => {
    expect(parseTeacherPath('/school/teacher/students/learner-a/day/lastweek').kind).toBe('not-found');
  });
  it('builds a dated day path', () => {
    expect(teacherDayPath('learner-a', '2026-08-25')).toBe('/school/teacher/students/learner-a/day/2026-08-25');
  });
  it('builds an undated day path', () => {
    expect(teacherDayPath('learner-a')).toBe('/school/teacher/students/learner-a/day');
  });
  it('falls back to the dashboard without a learner', () => {
    expect(teacherDayPath(null, '2026-08-25')).toBe('/school/teacher/dashboard');
  });
});
```

Add `teacherDayPath` to the file's existing import from `./teacherUrl.js`.

**Step 2: Run to verify it fails**

```bash
npx vitest run frontend/src/modules/School/teacher/teacherUrl.test.js
```

Expected: FAIL — `teacherDayPath is not a function`.

**Step 3: Implement**

In `frontend/src/modules/School/teacher/teacherUrl.js`:

3a. Add `'day'` to the learner sections, as the **first** entry (it is the new default landing):

```js
export const LEARNER_SECTIONS = ['day', 'overview', 'courses', 'history', 'reports', 'operations'];
```

3b. Add a day-shape guard near the top, after `decode`:

```js
const STUDY_DAY = /^\d{4}-\d{2}-\d{2}$/;
```

3c. Inside `parseTeacherPath`, in the `segments[0] === 'students'` branch, **before** the existing `segments[2] === 'history'` check, insert:

```js
    if (segments[2] === 'day') {
      if (segments.length === 3) {
        return { kind: 'learner', section: 'day', learnerId, courseId: null, sessionId: null, studyDay: null, base };
      }
      if (segments.length === 4 && STUDY_DAY.test(segments[3])) {
        return { kind: 'learner', section: 'day', learnerId, courseId: null, sessionId: null, studyDay: segments[3], base };
      }
      return notFound();
    }
```

3d. Add the builder next to `teacherLearnerPath`:

```js
/** The day record for one learner. An omitted day means "today" to the view. */
export function teacherDayPath(learnerId, studyDay = null, base = TEACHER_BASE) {
  if (!learnerId) return teacherSectionPath('dashboard', base);
  const suffix = studyDay ? `/${encodeURIComponent(studyDay)}` : '';
  return `${base}/students/${encodeURIComponent(learnerId)}/day${suffix}`;
}
```

3e. `teacherLearnerPath` currently appends a `detailId` only for `courses`. Leave it alone — day paths go through `teacherDayPath`.

**Step 4: Run to verify it passes**

```bash
npx vitest run frontend/src/modules/School/teacher/teacherUrl.test.js
```

Expected: PASS, including the pre-existing cases.

**Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/teacherUrl.js frontend/src/modules/School/teacher/teacherUrl.test.js
git commit -m "feat(school/teacher): route /students/:id/day/:studyDay"
```

---

## Task 4: The lazy paper record

Today the dashboard eagerly fetches **the full session document for every session** just to show two artifact thumbnails (`LearnerDay.jsx` → `SessionArtifacts`, an N+1). The day view needs the same paper records but attached to their own row, fetched only when a teacher asks.

**Files:**
- Create: `frontend/src/modules/School/teacher/panels/SessionPaperRecord.jsx`
- Test: `frontend/src/modules/School/teacher/panels/SessionPaperRecord.test.jsx`

**Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../teacherWorkspaceApi.js', () => ({
  teacherWorkspaceApi: { session: vi.fn() },
}));
const { teacherWorkspaceApi } = await import('../teacherWorkspaceApi.js');
const SessionPaperRecord = (await import('./SessionPaperRecord.jsx')).default;

const DOC = {
  taxonomy: { lessonTitle: 'Illinois' },
  artifacts: [
    { artifactId: 'w1', kind: 'assignment', availability: 'exact', originalPdfUrl: '/w1.pdf', thumbnailUrl: '/w1.png' },
    { artifactId: 'r1', kind: 'result-receipt', availability: 'exact', originalUrl: '/r1.png' },
  ],
};

beforeEach(() => { teacherWorkspaceApi.session.mockReset(); });

describe('SessionPaperRecord', () => {
  it('fetches nothing until it is opened', () => {
    render(<SessionPaperRecord sessionId="ses_1" lessonTitle="Illinois" />);
    expect(teacherWorkspaceApi.session).not.toHaveBeenCalled();
  });

  it('fetches once on open and shows both paper records', async () => {
    teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: DOC });
    render(<SessionPaperRecord sessionId="ses_1" lessonTitle="Illinois" />);
    fireEvent.click(screen.getByText('Paper record'));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open worksheet' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Open receipt' })).toBeInTheDocument();
    expect(teacherWorkspaceApi.session).toHaveBeenCalledTimes(1);
  });

  it('says so plainly when the install has no artifact record', async () => {
    teacherWorkspaceApi.session.mockResolvedValue({ ok: false, status: 404, data: null });
    render(<SessionPaperRecord sessionId="ses_1" lessonTitle="Illinois" />);
    fireEvent.click(screen.getByText('Paper record'));
    await waitFor(() => expect(screen.getByText(/not kept on this install/i)).toBeInTheDocument());
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run frontend/src/modules/School/teacher/panels/SessionPaperRecord.test.jsx
```

Expected: FAIL — cannot resolve `./SessionPaperRecord.jsx`.

**Step 3: Implement**

Create `frontend/src/modules/School/teacher/panels/SessionPaperRecord.jsx`:

```jsx
/**
 * The paper trail for ONE lesson, folded shut until asked for.
 *
 * The dashboard used to render every session's artifacts eagerly, which meant
 * a full session-document fetch per session on page load (N+1) and a third
 * separate rendering of a lesson the teacher had already read twice above
 * (UX audit IA1). Here the record belongs to its own row and costs nothing
 * until a teacher opens it.
 */
import { useState } from 'react';
import { usePanelFetch } from '../usePanelFetch.js';
import { teacherWorkspaceApi } from '../teacherWorkspaceApi.js';
import IssuedArtifactCard from './IssuedArtifactCard.jsx';

const isReceipt = (artifact) => artifact.kind === 'result-receipt' || artifact.role === 'result-receipt';

function PaperBody({ sessionId, lessonTitle }) {
  const detail = usePanelFetch(() => teacherWorkspaceApi.session(sessionId), {
    deps: [sessionId], panel: `paper-${sessionId}`, notFoundAs: 'unavailable',
  });
  if (detail.state === 'loading') return <p className="teacher-panel__empty">Loading the issued files…</p>;
  if (detail.state === 'error') {
    return <p className="teacher-panel__error">Couldn&rsquo;t load this lesson&rsquo;s paper record.
      <button type="button" className="teacher-panel__retry" onClick={detail.retry}>Retry</button></p>;
  }
  if (detail.state === 'unavailable') return <p className="teacher-panel__empty">Paper records are not kept on this install.</p>;
  const artifacts = detail.data?.artifacts ?? [];
  const worksheet = artifacts.find((artifact) => !isReceipt(artifact));
  const receipt = artifacts.find(isReceipt);
  if (!worksheet && !receipt) return <p className="teacher-panel__empty">No worksheet or result receipt is linked to this lesson.</p>;
  const title = detail.data?.taxonomy?.lessonTitle ?? lessonTitle;
  return <div className="teacher-paper-record__cards">
    {worksheet && <IssuedArtifactCard artifact={worksheet} lessonTitle={title} />}
    {receipt && <IssuedArtifactCard artifact={receipt} lessonTitle={title} />}
  </div>;
}

export default function SessionPaperRecord({ sessionId, lessonTitle = 'Lesson' }) {
  const [open, setOpen] = useState(false);
  if (!sessionId) return null;
  return (
    <details className="teacher-paper-record" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Paper record</summary>
      {open && <PaperBody sessionId={sessionId} lessonTitle={lessonTitle} />}
    </details>
  );
}
```

**Step 4: Run to verify it passes**

```bash
npx vitest run frontend/src/modules/School/teacher/panels/SessionPaperRecord.test.jsx
```

Expected: PASS, 3 tests.

**Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/panels/SessionPaperRecord.jsx frontend/src/modules/School/teacher/panels/SessionPaperRecord.test.jsx
git commit -m "feat(school/teacher): lazy per-lesson paper record replaces eager N+1 artifact fetch"
```

---

## Task 5: `LearnerDayView` — the view itself

**Files:**
- Create: `frontend/src/modules/School/teacher/panels/LearnerDayView.jsx`
- Test: `frontend/src/modules/School/teacher/panels/LearnerDayView.test.jsx`

**Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: { agendaPreview: vi.fn(), teacherDay: vi.fn() },
}));
vi.mock('../teacherWorkspaceApi.js', () => ({ teacherWorkspaceApi: { session: vi.fn() } }));
const { schoolApi } = await import('../../schoolApi.js');
const LearnerDayView = (await import('./LearnerDayView.jsx')).default;

const ok = (data) => ({ ok: true, status: 200, data });

beforeEach(() => {
  schoolApi.agendaPreview.mockResolvedValue(ok({ sections: [
    { subject: 'scripture', next: { title: 'Psalms 49–51' } },
    { subject: 'math', next: { title: 'Fractions 3' } },
    { subject: 'art', suppressed: { bySubject: 'math' } },
  ], errors: [] }));
  schoolApi.teacherDay.mockResolvedValue(ok({ learners: [{
    learnerId: 'learner-a',
    sessions: [{ sessionId: 'ses_1', subject: 'scripture', lessonTitle: 'Monday · Psalms 49, 50, 51, 61',
      courseTitle: 'Come Follow Me', effectiveScore: { correctCount: 5, totalCount: 5, percent: 100 } }],
    processedToday: [],
  }] }));
});

const mount = (props = {}) => render(
  <LearnerDayView learnerId="learner-a" learnerName="Learner A" studyDay="2026-08-25"
    onChangeStudyDay={vi.fn()} onOpenSession={vi.fn()} {...props} />,
);

describe('LearnerDayView', () => {
  it('states the study day once, in words', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Tuesday, Aug 25')).toBeInTheDocument());
  });

  it('shows planned, done, and deferred work in one list', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Monday · Psalms 49, 50, 51, 61')).toBeInTheDocument());
    expect(screen.getByText('Fractions 3')).toBeInTheDocument();
    expect(screen.getByText('Deferred for math focus')).toBeInTheDocument();
  });

  it('summarizes the day in counts', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('day-summary')).toHaveTextContent(/1 done/));
    expect(screen.getByTestId('day-summary')).toHaveTextContent(/1 not started/i);
    expect(screen.getByTestId('day-summary')).toHaveTextContent(/1 deferred/i);
  });

  it('steps to the previous day without a page reload', async () => {
    const onChangeStudyDay = vi.fn();
    mount({ onChangeStudyDay });
    await waitFor(() => expect(screen.getByText('Tuesday, Aug 25')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /previous day/i }));
    expect(onChangeStudyDay).toHaveBeenCalledWith('2026-08-24');
  });

  it('opens a completed lesson from its row', async () => {
    const onOpenSession = vi.fn();
    mount({ onOpenSession });
    await waitFor(() => expect(screen.getByText('Monday · Psalms 49, 50, 51, 61')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Monday · Psalms/ }));
    expect(onOpenSession).toHaveBeenCalledWith('ses_1');
  });

  it('does not repeat a per-row date inside a single-day view', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Monday · Psalms 49, 50, 51, 61')).toBeInTheDocument());
    // "Tuesday, Aug 25" is the page's heading; it must appear exactly once (IA2).
    expect(screen.getAllByText('Tuesday, Aug 25')).toHaveLength(1);
  });

  it('shows work graded today that belongs to another study day, labelled as such', async () => {
    schoolApi.teacherDay.mockResolvedValue(ok({ learners: [{
      learnerId: 'learner-a', sessions: [],
      processedToday: [{ sessionId: 'ses_old', subject: 'civilization', lessonTitle: 'The Midwestern States',
        studyDay: '2026-08-23', processedAt: '2026-08-25T14:03:00Z' }],
    }] }));
    mount();
    await waitFor(() => expect(screen.getByText('The Midwestern States')).toBeInTheDocument());
    expect(screen.getByText(/graded today/i)).toBeInTheDocument();
    expect(screen.getByText(/Aug 23/)).toBeInTheDocument();
  });

  // --- The printed agenda (operator requirement, 2026-08-25) --------------
  it('offers the exact printer image for the selected day', async () => {
    mount();
    const toggle = await screen.findByRole('button', { name: /show the printed agenda/i });
    fireEvent.click(toggle);
    const image = await screen.findByAltText(/printed agenda/i);
    expect(image).toHaveAttribute('src', expect.stringContaining('/agenda/preview'));
    expect(image).toHaveAttribute('src', expect.stringContaining('studyDay=2026-08-25'));
    // format=json is the DATA read; the image must be the PNG branch.
    expect(image.getAttribute('src')).not.toContain('format=json');
  });

  it('promises in plain words that the previewed codes are dead', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /show the printed agenda/i }));
    expect(await screen.findByText(/codes on this copy don’t work/i)).toBeInTheDocument();
    // The old five-noun disclaimer is gone.
    expect(screen.queryByText(/agenda artifact, print record, working QR/i)).not.toBeInTheDocument();
  });

  it('re-points the printer image when the day changes', async () => {
    const { rerender } = render(
      <LearnerDayView learnerId="learner-a" learnerName="A" studyDay="2026-08-25"
        onChangeStudyDay={vi.fn()} onOpenSession={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /show the printed agenda/i }));
    expect(await screen.findByAltText(/printed agenda/i)).toHaveAttribute('src', expect.stringContaining('2026-08-25'));
    rerender(
      <LearnerDayView learnerId="learner-a" learnerName="A" studyDay="2026-08-24"
        onChangeStudyDay={vi.fn()} onOpenSession={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByAltText(/printed agenda/i))
      .toHaveAttribute('src', expect.stringContaining('2026-08-24')));
  });

  it('never issues a non-GET to any agenda route', async () => {
    // Previewing must not mint a session, ticket, QR, or digit code.
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /show the printed agenda/i }));
    await screen.findByAltText(/printed agenda/i);
    expect(schoolApi.agendaDispatch).not.toBeDefined();
    // The only agenda call the view makes is the read-only JSON preview.
    expect(schoolApi.agendaPreview).toHaveBeenCalledWith('learner-a', '2026-08-25');
  });
});
```

**Step 2: Run to verify it fails**

Expected: FAIL — cannot resolve `./LearnerDayView.jsx`.

**Step 3: Implement**

Create `frontend/src/modules/School/teacher/panels/LearnerDayView.jsx`:

```jsx
/**
 * One child, one study day: what was planned, what was done, what was skipped
 * and why — plus anything graded today that belongs to an earlier day.
 *
 * This is the workspace's organizing unit (UX audit IA2/IA3). It replaces the
 * old split where the plan lived on Overview framed as a "planning preview",
 * the record lived on a dateless History tab, and the dashboard rendered a
 * third copy of both. The two reads it joins are unchanged and side-effect
 * free — previewing a day never creates a session, print, or code.
 */
import { useMemo, useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { joinLearnerDay, DAY_STATUS_LABEL } from '../learnerDay.js';
import { humanDate, teacherDate, teacherTime, localDay, shiftDay } from '../teacherDates.js';
import { LessonIdentity, SubjectIdentity } from '../CurriculumIdentity.jsx';
import PanelFrame from './PanelFrame.jsx';
import SessionPaperRecord from './SessionPaperRecord.jsx';

// `reviewStatus` is 'pending' | 'complete'. RosterStrip tests for the
// non-existent 'pending_review' and so has never once said "Awaiting
// review" — accept both spellings so the fix survives a backend rename.
const AWAITING = new Set(['pending', 'pending_review']);
const scoreLine = (session) => {
  const score = session?.effectiveScore ?? session?.machineScore;
  if (!score || score.correctCount == null || score.totalCount == null) {
    if (AWAITING.has(session?.reviewStatus)) return 'Awaiting review';
    return typeof session?.gradedPercent === 'number' ? `${Math.round(session.gradedPercent)}%` : null;
  }
  return `${score.correctCount} of ${score.totalCount} correct`;
};

function DayNav({ studyDay, onChangeStudyDay }) {
  const isToday = studyDay === localDay();
  return (
    <div className="teacher-day-nav">
      <button type="button" className="teacher-btn teacher-btn--quiet" aria-label="Previous day"
        onClick={() => onChangeStudyDay(shiftDay(studyDay, -1))}>←</button>
      <div className="teacher-day-nav__label">
        <strong>{humanDate(studyDay) ?? 'Pick a day'}</strong>
        {isToday && <span className="teacher-day-nav__today">Today</span>}
      </div>
      <button type="button" className="teacher-btn teacher-btn--quiet" aria-label="Next day"
        onClick={() => onChangeStudyDay(shiftDay(studyDay, 1))}>→</button>
      <label className="teacher-day-nav__pick">
        <span>Jump to</span>
        <input type="date" value={studyDay} onChange={(event) => event.target.value && onChangeStudyDay(event.target.value)} />
      </label>
      {!isToday && <button type="button" className="teacher-btn teacher-btn--quiet"
        onClick={() => onChangeStudyDay(localDay())}>Back to today</button>}
    </div>
  );
}

/**
 * The exact image the thermal printer would produce for this day.
 *
 * This is a dry run of the child's own agenda, not a re-layout of it: the
 * teacher sees the physical artifact. `previewAgenda` (BuildAgenda with
 * `previewOnly: true`) renders it with `token: null, tokenClass: 'preview'`
 * and relabels every offer "Preview only — ask a grown-up to start this
 * lesson", so the QR and digit codes on it are inert BY CONSTRUCTION, not by
 * convention. The route is GET-only and sets `X-School-Preview:
 * agenda-non-recording`; no session, ticket, or print record is created,
 * for today or for any other day.
 *
 * Loaded on demand — a printer-resolution PNG is not worth fetching for a
 * teacher who only wanted to read the list.
 */
function PrintedAgenda({ learnerId, studyDay }) {
  const [open, setOpen] = useState(false);
  const src = `/api/v1/school/lifecycle/learners/${encodeURIComponent(learnerId)}/agenda/preview?${new URLSearchParams({ studyDay })}`;
  return (
    <section className="teacher-printed-agenda">
      <div className="teacher-action-row">
        <button type="button" className="teacher-btn" onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide the printed agenda' : 'Show the printed agenda'}
        </button>
        {open && <a className="teacher-btn teacher-btn--quiet" href={src} target="_blank" rel="noreferrer">Open full size ↗</a>}
      </div>
      {open && <>
        <p className="teacher-printed-agenda__promise">
          This is the paper as it would print — but the codes on this copy don’t work. Nothing here starts a lesson.
        </p>
        <img className="teacher-printed-agenda__image" src={src} alt={`Printed agenda for ${humanDate(studyDay) ?? 'the selected day'}`} />
      </>}
    </section>
  );
}

function DayRow({ row, onOpenSession }) {
  const session = row.session;
  const title = session?.lessonTitle ?? session?.title ?? row.planned;
  const body = session
    ? <LessonIdentity compact subject={session.subject} courseTitle={session.courseTitle}
        moduleTitle={session.moduleTitle} lessonTitle={title ?? 'Lesson'} posterUrl={session.posterUrl} />
    : <div className="teacher-day-row__unstarted"><SubjectIdentity subject={row.subject} />
        <strong>{row.planned ?? 'No work offered'}</strong></div>;
  return (
    <li className={`teacher-day-row teacher-day-row--${row.status}`}>
      <span className={`teacher-day-chip teacher-day-chip--${row.status}`}>{DAY_STATUS_LABEL[row.status]}</span>
      <div className="teacher-day-row__body">
        {session
          ? <button type="button" className="teacher-day-row__open" onClick={() => onOpenSession(session.sessionId)}>{body}</button>
          : body}
        {row.detail && <small className="teacher-day-row__detail">{row.detail}</small>}
      </div>
      <div className="teacher-day-row__right">
        {scoreLine(session) && <span className="teacher-day-row__score">{scoreLine(session)}</span>}
        {session?.sessionId && <SessionPaperRecord sessionId={session.sessionId} lessonTitle={title ?? 'Lesson'} />}
      </div>
    </li>
  );
}

export default function LearnerDayView({ learnerId, learnerName, studyDay, onChangeStudyDay, onOpenSession }) {
  const agenda = usePanelFetch(() => schoolApi.agendaPreview(learnerId, studyDay), {
    deps: [learnerId, studyDay], panel: 'learner-day-agenda', notFoundAs: 'unavailable',
  });
  const day = usePanelFetch(() => schoolApi.teacherDay(studyDay), {
    deps: [learnerId, studyDay], panel: 'learner-day-record', notFoundAs: 'unavailable',
  });

  const learnerRow = useMemo(
    () => (day.data?.learners ?? (Array.isArray(day.data) ? day.data : [])).find((row) => row.learnerId === learnerId) ?? null,
    [day.data, learnerId],
  );
  const joined = useMemo(() => joinLearnerDay({
    sections: agenda.data?.sections ?? [],
    sessions: learnerRow?.sessions ?? [],
    studyDay,
  }), [agenda.data, learnerRow, studyDay]);

  const processed = (learnerRow?.processedToday ?? []).filter((session) => session.studyDay !== studyDay);
  const summary = [
    joined.counts.done ? `${joined.counts.done} done` : null,
    joined.counts.planned ? `${joined.counts.planned} not started` : null,
    joined.counts.deferred ? `${joined.counts.deferred} deferred` : null,
    joined.counts.blocked ? `${joined.counts.blocked} blocked` : null,
    joined.counts.extra ? `${joined.counts.extra} extra` : null,
  ].filter(Boolean).join(' · ');

  // Both reads failing at once is the install-lacks-lifecycle case; one panel
  // notice, not two stacked ones.
  const state = agenda.state === 'unavailable' && day.state === 'unavailable' ? 'unavailable'
    : agenda.state === 'loading' || day.state === 'loading' ? 'loading'
      : agenda.state === 'error' && day.state === 'error' ? 'error'
        : joined.rows.length || processed.length ? 'ok' : 'empty';

  return (
    <section className="teacher-day" aria-label={`${learnerName ?? learnerId}'s day`}>
      <DayNav studyDay={studyDay} onChangeStudyDay={onChangeStudyDay} />
      <PanelFrame
        title={`${learnerName ?? learnerId}’s work`}
        state={state}
        retry={() => { agenda.retry(); day.retry(); }}
        emptyCopy="Nothing was planned or recorded for this day."
        unavailableCopy="The day record needs the school lifecycle, which isn’t enabled on this install."
      >
        <p className="teacher-day__summary" data-testid="day-summary">{summary || 'Nothing recorded yet.'}</p>
        {(agenda.data?.errors ?? []).length > 0 && (
          <ul className="teacher-workspace__alerts">
            {agenda.data.errors.map((error, index) => (
              // eslint-disable-next-line react/no-array-index-key -- order stable within one fetch
              <li key={index}>{typeof error === 'string' ? error : error?.message ?? 'The planner refused an item.'}</li>
            ))}
          </ul>
        )}
        <ul className="teacher-day-rows">
          {joined.rows.map((row) => <DayRow key={row.key} row={row} onOpenSession={onOpenSession} />)}
        </ul>
      </PanelFrame>
      {/* Outside the PanelFrame deliberately: PanelFrame renders children
          only in the `ok` state, and "what would today's paper look like?"
          is a fair question on a day with nothing planned or recorded. */}
      <PrintedAgenda learnerId={learnerId} studyDay={studyDay} />
      {processed.length > 0 && (
        <PanelFrame title="Also graded today" state="ok">
          <p className="teacher-muted">Work from an earlier study day that was marked on this date.</p>
          <ul className="teacher-day-rows">
            {processed.map((session) => (
              <li className="teacher-day-row teacher-day-row--processed" key={session.sessionId}>
                <span className="teacher-day-chip teacher-day-chip--processed">Graded today</span>
                <div className="teacher-day-row__body">
                  <button type="button" className="teacher-day-row__open" onClick={() => onOpenSession(session.sessionId)}>
                    <LessonIdentity compact subject={session.subject} courseTitle={session.courseTitle}
                      moduleTitle={session.moduleTitle} lessonTitle={session.lessonTitle ?? 'Lesson'} posterUrl={session.posterUrl} />
                  </button>
                  <small className="teacher-day-row__detail">
                    Study day {teacherDate(session.studyDay)}
                    {teacherTime(session.processedAt) ? ` · marked ${teacherTime(session.processedAt)}` : ''}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </PanelFrame>
      )}
    </section>
  );
}
```

**Step 4: Run to verify it passes**

```bash
npx vitest run frontend/src/modules/School/teacher/panels/LearnerDayView.test.jsx
```

Expected: PASS, 7 tests. If the "exactly once" date assertion fails, you have left a per-row date somewhere — remove it, do not relax the assertion.

**Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/panels/LearnerDayView.jsx frontend/src/modules/School/teacher/panels/LearnerDayView.test.jsx
git commit -m "feat(school/teacher): Learner Day view joins the plan with the record"
```

---

## Task 6: Style the day view

**Files:**
- Modify: `frontend/src/modules/School/teacher/Teacher.scss`

**Step 1: Append the styles**

Add at the end of `Teacher.scss`:

```scss
/* --- Learner Day (UX audit IA2/IA3) ------------------------------------ */
.teacher-day { display: flex; flex-direction: column; gap: 12px; }
.teacher-day-nav {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 10px; border: 1px solid #e5dccb; border-radius: 10px; background: #fffdf8;
  &__label { display: flex; align-items: baseline; gap: 8px;
    strong { font: 700 19px/1.2 Georgia, serif; color: #30291f; } }
  &__today { padding: 2px 7px; border-radius: 20px; background: #e8dfc9; color: #6b5a33; font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
  &__pick { display: flex; align-items: center; gap: 6px; margin-left: auto; color: #7d7466; font-size: 12px;
    input { min-height: 34px; border: 1px solid #d8cfbe; border-radius: 7px; padding: 0 8px; background: white; color: #30291f; font: inherit; } }
}
.teacher-day__summary { margin: 0 0 10px; color: #6b6255; font-size: 13px; font-weight: 700; }
.teacher-day-rows { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.teacher-day-row {
  display: grid; grid-template-columns: 92px minmax(0, 1fr) auto; gap: 12px; align-items: start;
  padding: 10px; border: 1px solid #e9e1d2; border-radius: 9px; background: white;
  &__body { display: grid; gap: 4px; min-width: 0; }
  &__open { display: block; width: 100%; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; font: inherit; color: inherit; }
  &__unstarted { display: flex; flex-direction: column; gap: 3px;
    strong { color: #4a4335; font-weight: 700; } }
  &__detail { color: #857b6b; font-size: 12px; }
  &__right { display: grid; justify-items: end; gap: 6px; }
  &__score { color: #5f6b4f; font-size: 13px; font-weight: 700; white-space: nowrap; }
  /* Not-yet-done work is quieter than done work — the eye should land on
     what happened, then on what is outstanding. */
  &--planned, &--deferred, &--blocked { background: #fdfcf8; }
  &--blocked { border-color: #e6cfc4; }
}
.teacher-day-chip {
  align-self: start; padding: 3px 8px; border-radius: 20px;
  font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; text-align: center; white-space: nowrap;
  background: #efeade; color: #6b6255;
  &--done { background: #e2eddc; color: #3f5c34; }
  &--planned { background: #f2ece0; color: #7a6f5c; }
  &--deferred { background: #f4e9d6; color: #866526; }
  &--blocked { background: #f7e2da; color: #8d452c; }
  &--extra { background: #e6e9f2; color: #45507a; }
  &--processed { background: #eae6f0; color: #57457a; }
}
/* The dry-run printout. Constrained so a tall receipt-format PNG cannot
   run away with the page, and given paper-white ground + a drop shadow so
   it reads as a physical artifact rather than as page furniture. */
.teacher-printed-agenda {
  margin-top: 4px; padding: 10px; border: 1px solid #e5dccb; border-radius: 10px; background: #fffdf8;
  &__promise { margin: 10px 0 0; padding: 8px 11px; border-radius: 8px; background: #f4ecdb; color: #6f5c33; font-size: 12px; line-height: 1.45; }
  &__image { display: block; max-width: min(100%, 420px); max-height: 70vh; margin: 10px auto 2px;
    border: 1px solid #d9d0c0; background: white; object-fit: contain;
    box-shadow: 0 8px 25px rgba(45, 36, 22, .12); }
}
.teacher-paper-record {
  summary { color: #745326; cursor: pointer; font-size: 12px; font-weight: 700; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: '▸ '; }
  &[open] summary::before { content: '▾ '; }
  &__cards { display: grid; gap: 8px; margin-top: 8px; }
}
@media (max-width: 720px) {
  .teacher-day-row { grid-template-columns: 1fr; gap: 6px;
    &__right { justify-items: start; } }
  .teacher-day-nav__pick { margin-left: 0; }
}
```

**Step 2: Verify the stylesheet still compiles**

```bash
npm run build --prefix frontend 2>&1 | tail -5
```

Expected: a successful build (no SCSS error). This takes a minute; it is the only reliable SCSS check.

**Step 3: Commit**

```bash
git add frontend/src/modules/School/teacher/Teacher.scss
git commit -m "style(school/teacher): Learner Day layout, status chips, paper-record fold"
```

---

## Task 7: Wire the day view into the shell

The console must render the new section, keep the URL in sync as the teacher steps through days, and make `day` the learner's landing tab.

**Files:**
- Modify: `frontend/src/modules/School/teacher/WorkspaceViews.jsx`
- Modify: `frontend/src/modules/School/teacher/TeacherConsole.jsx`
- Test: `frontend/src/modules/School/teacher/TeacherConsole.test.jsx` (exists — append)

**Step 1: Write the failing test**

Append to `TeacherConsole.test.jsx` (match the file's existing mount/mocking helpers — read it first):

```jsx
it('lands a learner on their day record and keeps the URL in step with the day', async () => {
  window.history.pushState({}, '', '/school/teacher/students/learner-a/day/2026-08-25');
  mountConsole();
  await waitFor(() => expect(screen.getByText('Tuesday, Aug 25')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /previous day/i }));
  await waitFor(() => expect(window.location.pathname).toBe('/school/teacher/students/learner-a/day/2026-08-24'));
});

it('shows Day first in the learner tab strip', async () => {
  window.history.pushState({}, '', '/school/teacher/students/learner-a/day');
  mountConsole();
  const tabs = await screen.findAllByRole('button', { name: /^(Day|Courses|History|Reports|Operations)$/ });
  expect(tabs[0]).toHaveTextContent('Day');
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run frontend/src/modules/School/teacher/TeacherConsole.test.jsx
```

Expected: FAIL — the day route renders the overview fallback.

**Step 3a: Export a `LearnerDayScreen` from `WorkspaceViews.jsx`**

Add near `LearnerOverview` in `WorkspaceViews.jsx`:

```jsx
export function LearnerDayScreen({ learnerId, learnerName, studyDay, onChangeStudyDay, onOpenSession }) {
  return (
    <div className="teacher-view">
      <div className="teacher-view__heading"><div>
        <p className="teacher-view__eyebrow">Day record</p>
        <h2>{learnerName}&rsquo;s day</h2>
        <p>What was planned, what got done, and what is still open — for any school day.</p>
      </div></div>
      <LearnerDayView
        learnerId={learnerId}
        learnerName={learnerName}
        studyDay={studyDay}
        onChangeStudyDay={onChangeStudyDay}
        onOpenSession={onOpenSession}
      />
    </div>
  );
}
```

Add the import at the top of `WorkspaceViews.jsx`:

```jsx
import LearnerDayView from './panels/LearnerDayView.jsx';
```

**Step 3b: Retire the duplicate plan-and-sessions block from `LearnerOverview`**

`LearnerOverview` currently renders `AgendaPreview` + `SessionList` + `MilestonesPanel` — the first two are exactly what the day view now does better. Replace the whole `LearnerOverview` function body with a redirect-flavoured pointer, and delete the now-unused `AgendaPreview` component (the day view supersedes it, including its `completedBySubject` join).

Replace `LearnerOverview` with:

```jsx
export function LearnerOverview({ learnerId, learnerName, onOpenSession, studyDay, onChangeStudyDay }) {
  // Overview WAS a second, weaker day view — the plan under a "planning
  // preview" disclaimer plus a day-scoped session list (UX audit IA3). The
  // day record owns that now; this alias keeps old bookmarks working.
  return <LearnerDayScreen learnerId={learnerId} learnerName={learnerName} studyDay={studyDay}
    onChangeStudyDay={onChangeStudyDay} onOpenSession={onOpenSession} />;
}
```

Then **delete** the `AgendaPreview` function (lines ~74–139) from `WorkspaceViews.jsx`. Leave `SessionList` — `HistoryView` still uses it.

⚠ **Before deleting, confirm the day view carries its two capabilities forward.** `AgendaPreview` owned both the JSON plan read *and* the thermal-printer PNG preview. Task 5's `LearnerDayView` must already provide both — the joined plan-vs-record list, and `PrintedAgenda` with its "the codes on this copy don’t work" promise. Verify with:

```bash
grep -n "agenda/preview" frontend/src/modules/School/teacher/panels/LearnerDayView.jsx
```

Expected: two hits — the `format=json` data read and the PNG `src`. **If the PNG hit is missing, stop and fix Task 5 first.** Deleting `AgendaPreview` without it silently removes the operator-required ability to dry-run a child's printed agenda, which is the one thing the old Overview tab did that nothing else does.

**Step 3c: Wire the route in `TeacherConsole.jsx`**

Add to the imports from `./teacherUrl.js`:

```jsx
teacherDayPath,
```

Add to the imports from `./WorkspaceViews.jsx`:

```jsx
LearnerDayScreen,
```

Add to the imports from `./teacherDates.js` (add the import line if absent):

```jsx
import { localDay } from './teacherDates.js';
```

Inside `TeacherShell`, after `goSession`, add:

```jsx
  const studyDay = route.studyDay ?? localDay();
  const goDay = (nextDay) => navigate(teacherDayPath(route.learnerId, nextDay, route.base));
```

In the learner `views` map, add `day` first and pass the day props to `overview`:

```jsx
    const views = {
      day: <LearnerDayScreen learnerId={learner.id} learnerName={learner.name} studyDay={studyDay}
        onChangeStudyDay={goDay} onOpenSession={goSession} />,
      overview: <LearnerOverview learnerId={learner.id} learnerName={learner.name} studyDay={studyDay}
        onChangeStudyDay={goDay} onOpenSession={goSession} />,
      courses: <CoursesView learnerId={learner.id} learnerName={learner.name} courseId={route.courseId} kids={kids} />,
      history: <HistoryView learnerId={learner.id} learnerName={learner.name} onOpenSession={goSession} />,
      reports: <ReportsView learnerId={learner.id} kids={kids} />,
      operations: <LearnerOperationsView learnerId={learner.id} learnerName={learner.name} kids={kids} />,
    };
    view = views[route.section] ?? views.day;
```

Change `LEARNER_NAV` so Day leads and Overview is gone (it is now an alias, not a destination):

```jsx
const LEARNER_NAV = [
  { id: 'day', label: 'Day' },
  { id: 'courses', label: 'Courses' },
  { id: 'history', label: 'History' },
  { id: 'reports', label: 'Reports' },
  { id: 'operations', label: 'Operations' },
];
```

`goLearner` defaults to `'overview'`; change its default to `'day'`:

```jsx
  const goLearner = (learnerId, section = 'day', detail = null) => navigate(teacherLearnerPath(learnerId, section, detail, route.base));
```

And in `teacherUrl.js`, change the bare `/students/:id` parse result's `section` from `'overview'` to `'day'` so a bare learner URL lands on the day record. Update the matching assertion in `teacherUrl.test.js` if one exists.

**Step 4: Run the tests**

```bash
npx vitest run frontend/src/modules/School/teacher/
```

Expected: PASS. Two existing files will likely fail and **must be updated, not deleted**:
- `WorkspaceViews.sessionDetail.test.jsx` — it imports `LearnerOverview` and asserts on the agenda preview. Rewrite those cases against the day view's copy, or move them to `LearnerDayView.test.jsx` if they duplicate it.
- Any test asserting `section: 'overview'` for a bare learner path.

**Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/
git commit -m "feat(school/teacher): Day is the learner's landing record; Overview aliases it"
```

---

## Task 8: Dashboard rows lead to the day, not to a third copy of it

**Files:**
- Modify: `frontend/src/modules/School/teacher/panels/RosterStrip.jsx`
- Modify: `frontend/src/modules/School/teacher/panels/LearnerDay.jsx` (delete)
- Test: `frontend/src/modules/School/teacher/tabs/TodayTab.test.jsx` (exists — extend)
- Test: `tests/live/flow/school/teacher-workspace-contract.runtime.test.mjs` (exists — update)

The dashboard drill-in currently renders sessions, a "Processed today" section, **and** the full paper-records panel — three of the four framings in IA1. It becomes: a compact session list plus one link into the day record.

**Step 1: Write the failing test**

Append to `tabs/TodayTab.test.jsx`:

```jsx
it('offers one route into the full day record instead of re-rendering it', async () => {
  // (set up schoolApi.teacherDay to answer one learner with one session —
  // copy the existing helper in this file)
  mount(<TodayTab kids={KIDS} />);
  fireEvent.click(await screen.findByRole('button', { name: /Learner A/ }));
  expect(await screen.findByRole('link', { name: /Open the full day record/i }))
    .toHaveAttribute('href', expect.stringContaining('/students/learner-a/day/'));
  expect(screen.queryByText('Today’s paper and results')).not.toBeInTheDocument();
  expect(screen.queryByText('Processed today')).not.toBeInTheDocument();
});

it('points an idle learner at their plan rather than dead-ending', async () => {
  // teacherDay answers a learner with no sessions
  mount(<TodayTab kids={KIDS} />);
  expect(await screen.findByRole('link', { name: /See today’s plan/i })).toBeInTheDocument();
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run frontend/src/modules/School/teacher/tabs/TodayTab.test.jsx
```

**Step 3: Implement**

In `RosterStrip.jsx`:

3a. Remove the `LearnerDay` import and its `<LearnerDay sessions={sessions} />` usage.
3b. Remove the entire `processedToday` `<section className="teacher-processed">` block.
3c. Add `teacherDayPath` to the `teacherUrl.js` import.
3d. At the end of the expanded `teacher-roster__details`, add:

```jsx
            <a className="teacher-btn teacher-btn--quiet teacher-roster__day-link"
               href={teacherDayPath(row.learnerId, row.studyDay ?? undefined, base)}>
              Open the full day record →
            </a>
```

3d-bis. Fix the review-status bug while you are in this file. `outcomeLine` at `RosterStrip.jsx:18` tests `session.reviewStatus === 'pending_review'`; the backend emits `'pending'`, so this branch has never fired. Replace with:

```js
const AWAITING = new Set(['pending', 'pending_review']);
function outcomeLine(session) {
  const score = session.effectiveScore;
  if (score?.correctCount != null && score?.totalCount != null) {
    return `${score.correctCount} of ${score.totalCount} correct`;
  }
  return AWAITING.has(session.reviewStatus) ? 'Awaiting review' : 'Not graded';
}
```

Note the percent is dropped: `5 of 5 correct · 100%` says the same thing twice (audit IA1).

3e. In the "nothing yet today" branch, the card itself stays a button (it expands); add the plan link **below** the card so an idle learner is not a dead end (IA5). After the `</button>` and disclosure span, add:

```jsx
          {!((row.effectiveScoreTotals?.total ?? row.attemptsToday) > 0) && (
            <a className="teacher-btn teacher-btn--quiet teacher-roster__plan-link"
               href={teacherDayPath(row.learnerId, row.studyDay ?? undefined, base)}>
              See today’s plan →
            </a>
          )}
```

3f. Delete `frontend/src/modules/School/teacher/panels/LearnerDay.jsx` and `panels/LearnerDay.test.jsx`. If `rm` is permission-blocked, `mv` them to a `_deleteme/` folder at the repo root (project rule).

```bash
git rm frontend/src/modules/School/teacher/panels/LearnerDay.jsx frontend/src/modules/School/teacher/panels/LearnerDay.test.jsx
```

3g. Confirm nothing still imports it:

```bash
grep -rn "LearnerDay.jsx" frontend/src tests | grep -v LearnerDayView
```
Expected: no output.

**Step 4: Update the Playwright contract test in the same task**

`tests/live/flow/school/teacher-workspace-contract.runtime.test.mjs` has a test named *"uses the issued artifact record, not the legacy printable queue, on the dashboard"* that asserts `Open worksheet` / `Download PDF` / `Open receipt` inside `.teacher-roster__details`. Those links now live on the day record. Rewrite that test to:

- click the roster card,
- assert the lesson identity still renders in the drill-in (`Illinois`, `Civilization`, the poster),
- assert `Open the full day record →` is present and points at `/students/learner-b/day`,
- navigate to that href,
- open the row's `Paper record` disclosure,
- assert `Open worksheet` and `Open receipt` there,
- keep the negative assertions (`No printable lessons`, `/^assessment$/i`, `/P044/i`),
- screenshot to `today-issued-artifacts.png` as before.

The mock router already answers `/teacher/day?studyDay=…` and `/agenda/preview?format=json`; add a `sections` array to the agenda mock so the day view has a plan to join.

Run it:

```bash
npx playwright test --config playwright.teacher.config.mjs --reporter=line
```

Expected: all 4 tests pass.

**Step 5: Commit**

```bash
git add -A frontend/src/modules/School/teacher tests/live/flow/school
git commit -m "refactor(school/teacher): dashboard links to the day record instead of re-rendering it"
```

---

## Task 9: History becomes day-grouped

**Files:**
- Modify: `frontend/src/modules/School/teacher/WorkspaceViews.jsx` (`SessionList`, `HistoryView`)
- Test: `frontend/src/modules/School/teacher/WorkspaceViews.history.test.jsx` (create)

**Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// mock ../schoolApi.js and ./teacherWorkspaceApi.js as in
// WorkspaceViews.sessionDetail.test.jsx — copy that mock block verbatim.

describe('HistoryView', () => {
  it('groups sessions under one heading per study day', async () => {
    teacherWorkspaceApi.timeline.mockResolvedValue({ ok: true, status: 200, data: { items: [
      { sessionId: 'ses_1', studyDay: '2026-08-25', lessonTitle: 'Psalms 62–66', subject: 'scripture' },
      { sessionId: 'ses_2', studyDay: '2026-08-25', lessonTitle: 'Psalms 49–51', subject: 'scripture' },
      { sessionId: 'ses_3', studyDay: '2026-08-23', lessonTitle: 'The Midwestern States', subject: 'civilization' },
    ] } });
    render(<HistoryView learnerId="learner-a" learnerName="Learner A" onOpenSession={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Tuesday, Aug 25')).toBeInTheDocument());
    expect(screen.getByText('Sunday, Aug 23')).toBeInTheDocument();
    // Two sessions on Aug 25 sit under ONE date heading, not two dated rows.
    expect(screen.getAllByText('Tuesday, Aug 25')).toHaveLength(1);
  });

  it('links each day heading to that day’s record', async () => {
    // …same timeline mock…
    render(<HistoryView learnerId="learner-a" learnerName="Learner A" onOpenSession={vi.fn()} />);
    const link = await screen.findByRole('link', { name: /Tuesday, Aug 25/ });
    expect(link).toHaveAttribute('href', '/school/teacher/students/learner-a/day/2026-08-25');
  });
});
```

**Step 2: Run to verify it fails.**

**Step 3: Implement**

In `WorkspaceViews.jsx`, replace `SessionList`'s flat `<ul>` with day groups. Add above `SessionList`:

```jsx
/**
 * Timeline rows name their study day `day`; day-projection rows name it
 * `studyDay`. Reading only `studyDay` (as SessionList did) silently fell
 * through to `updatedAt`, so a Monday lesson rescanned on Friday filed
 * itself under Friday.
 */
function studyDayOf(session) {
  return session.studyDay ?? session.day ?? (dateOf(session) ?? '').slice(0, 10) ?? 'undated';
}

function groupSessionsByDay(rows) {
  const groups = new Map();
  for (const session of rows) {
    const day = studyDayOf(session) || 'undated';
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(session);
  }
  return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}
```

Also extend the module-level `scoreLine` in `WorkspaceViews.jsx` to fall back to `gradedPercent` — timeline rows carry **only** that, never `effectiveScore`, which is why the history list has always shown a bare title with no score:

```js
const scoreLine = (session) => {
  const score = session?.effectiveScore ?? session?.machineScore;
  if (!score || score.correctCount == null || score.totalCount == null) {
    return typeof session?.gradedPercent === 'number' ? `${Math.round(session.gradedPercent)}%` : null;
  }
  return `${score.correctCount} of ${score.totalCount} correct${score.percent == null ? '' : ` · ${score.percent}%`}`;
};
```

Add a test for it in the same file:

```jsx
it('shows a score for timeline rows, which carry only gradedPercent', async () => {
  teacherWorkspaceApi.timeline.mockResolvedValue({ ok: true, status: 200, data: { items: [
    { sessionId: 'ses_1', day: '2026-08-25', lessonTitle: 'Psalms 62–66', subject: 'scripture', gradedPercent: 80 },
  ] } });
  render(<HistoryView learnerId="learner-a" learnerName="Learner A" onOpenSession={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('80%')).toBeInTheDocument());
});

it('files a row under its study day, not the day it was last touched', async () => {
  teacherWorkspaceApi.timeline.mockResolvedValue({ ok: true, status: 200, data: { items: [
    { sessionId: 'ses_1', day: '2026-08-24', updatedAt: '2026-08-28T10:00:00Z', lessonTitle: 'Psalms 49–51', subject: 'scripture' },
  ] } });
  render(<HistoryView learnerId="learner-a" learnerName="Learner A" onOpenSession={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('Monday, Aug 24')).toBeInTheDocument());
  expect(screen.queryByText('Friday, Aug 28')).not.toBeInTheDocument();
});
```

Then in `SessionList`'s render, replace the `rows.map(...)` list with:

```jsx
      {groupSessionsByDay(rows).map(([day, daySessions]) => (
        <section className="teacher-history-day" key={day}>
          <h3 className="teacher-history-day__heading">
            <a href={teacherDayPath(learnerId, day === 'undated' ? null : day)}>{humanDate(day) ?? 'Undated'}</a>
          </h3>
          <ul className="teacher-session-list">
            {daySessions.map((session, index) => {
              const id = sessionIdOf(session);
              return (
                <li key={id ?? index}>
                  <button type="button" onClick={() => id && onOpenSession(id)} disabled={!id}>
                    <span><LessonIdentity subject={session.subject} courseTitle={session.courseTitle}
                      moduleTitle={session.moduleTitle} lessonTitle={session.lessonTitle ?? session.title ?? 'Lesson title unavailable'}
                      posterUrl={session.posterUrl} compact />
                      {/* No per-row date: the group heading owns the day (IA2). */}
                      {scoreLine(session) && <small>{scoreLine(session)}</small>}</span>
                    <span className={`teacher-status teacher-status--${stateOf(session)}`}>
                      {session.outcome?.result === 'passed' ? 'Completed' : labelize(stateOf(session))}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
```

Import `teacherDayPath` in `WorkspaceViews.jsx`.

Add the SCSS at the end of `Teacher.scss`:

```scss
.teacher-history-day { margin-top: 14px;
  &:first-of-type { margin-top: 0; }
  &__heading { margin: 0 0 6px; font: 800 12px/1 -apple-system, system-ui, sans-serif; letter-spacing: .07em; text-transform: uppercase;
    a { color: #8a6a2c; text-decoration: none; } a:hover { text-decoration: underline; } }
}
```

**Step 4: Run to verify it passes.**

**Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/
git commit -m "feat(school/teacher): group session history by study day, each linking to its day record"
```

---

# PHASE 2 — The session inspector (closes IA1, IA6)

## Task 10: One graded worksheet, not two question lists

The inspector prints every question twice: once with choices, once with the answer. Merge them into one list with a single numbering scheme.

**Files:**
- Create: `frontend/src/modules/School/teacher/panels/GradedWorksheet.jsx`
- Test: `frontend/src/modules/School/teacher/panels/GradedWorksheet.test.jsx`

**Step 1: Write the failing test**

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GradedWorksheet from './GradedWorksheet.jsx';

// REAL shapes: choices carry `label` + `letter` + `correct`; `given` and
// `expected` may hold LETTERS (bubble sheet) or answer text (other paths).
const assignment = { questions: [
  { itemId: 'q1', number: 1, prompt: 'Capital of Illinois?',
    choices: [{ id: 'a', letter: 'A', label: 'Chicago' }, { id: 'b', letter: 'B', label: 'Springfield', correct: true }],
    expected: ['B'] },
  { itemId: 'q2', number: 2, prompt: 'Statehood year?',
    choices: [{ id: 'a', letter: 'A', label: '1818', correct: true }, { id: 'b', letter: 'B', label: '1808' }],
    expected: ['A'] },
] };
const assessment = { items: [
  { itemId: 'q1', questionNumber: 19, prompt: 'Capital of Illinois?', given: 'B', expected: ['B'], verdict: 'correct' },
  { itemId: 'q2', questionNumber: 20, prompt: 'Statehood year?', given: 'B', expected: ['A'], verdict: 'incorrect' },
] };

describe('GradedWorksheet', () => {
  it('prints each question exactly once', () => {
    render(<GradedWorksheet assignment={assignment} assessment={assessment} />);
    expect(screen.getAllByText('Capital of Illinois?')).toHaveLength(1);
    expect(screen.getAllByText('Statehood year?')).toHaveLength(1);
  });

  it('uses the worksheet numbering, never the bank-global index', () => {
    render(<GradedWorksheet assignment={assignment} assessment={assessment} />);
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    expect(screen.queryByText('19.')).not.toBeInTheDocument();
  });

  it('resolves a bubbled LETTER to the answer the child actually chose', () => {
    // Production shows raw "B,D" on OMR rows next to plain text on others
    // (audit IA6). A letter is an internal coordinate, never the answer.
    render(<GradedWorksheet assignment={assignment} assessment={assessment} />);
    const given = screen.getAllByText('Springfield', { selector: '.teacher-graded-q__given' });
    expect(given).toHaveLength(1);
    expect(screen.queryByText('B', { selector: '.teacher-graded-q__given' })).not.toBeInTheDocument();
  });

  it('resolves multi-select letters to a readable list', () => {
    const multi = { items: [{ itemId: 'q1', given: 'A,B', expected: ['A', 'B'], verdict: 'correct' }] };
    render(<GradedWorksheet assignment={assignment} assessment={multi} />);
    expect(screen.getByText('Chicago, Springfield', { selector: '.teacher-graded-q__given' })).toBeInTheDocument();
  });

  it('passes answer TEXT straight through when that is what was recorded', () => {
    const textual = { items: [{ itemId: 'q1', given: 'A broken spirit', expected: ['A broken spirit'], verdict: 'correct' }] };
    render(<GradedWorksheet assignment={assignment} assessment={textual} />);
    expect(screen.getByText('A broken spirit', { selector: '.teacher-graded-q__given' })).toBeInTheDocument();
  });

  it('shows the verdict on every row', () => {
    render(<GradedWorksheet assignment={assignment} assessment={assessment} />);
    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(screen.getByText('Incorrect')).toBeInTheDocument();
  });

  it('shows the right answer, as words, only when the child got it wrong', () => {
    render(<GradedWorksheet assignment={assignment} assessment={assessment} />);
    const corrections = screen.getAllByText(/Correct answer:/);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toHaveTextContent('1818');
    expect(corrections[0]).not.toHaveTextContent(/Correct answer: A$/);
  });

  it('renders from the answers alone when no worksheet document survives', () => {
    render(<GradedWorksheet assignment={null} assessment={assessment} />);
    expect(screen.getByText('Capital of Illinois?')).toBeInTheDocument();
    expect(screen.getByText('1.')).toBeInTheDocument();
  });

  it('renders the worksheet alone when nothing is graded yet', () => {
    render(<GradedWorksheet assignment={assignment} assessment={null} />);
    expect(screen.getByText('Capital of Illinois?')).toBeInTheDocument();
    expect(screen.getByText(/not graded/i)).toBeInTheDocument();
  });

  it('marks the chosen option among the printed choices', () => {
    render(<GradedWorksheet assignment={assignment} assessment={assessment} />);
    expect(screen.getByText('B. Springfield')).toHaveClass('is-chosen');
  });

  it('uses the choice’s own letter rather than its array position', () => {
    const sparse = { questions: [{ itemId: 'q1', number: 1, prompt: 'P?',
      choices: [{ letter: 'C', label: 'Third' }, { letter: 'E', label: 'Fifth' }] }] };
    render(<GradedWorksheet assignment={sparse} assessment={null} />);
    expect(screen.getByText('C. Third')).toBeInTheDocument();
    expect(screen.getByText('E. Fifth')).toBeInTheDocument();
  });
});
```

**Step 2: Run to verify it fails.**

**Step 3: Implement**

```jsx
/**
 * One lesson's questions, answers and verdicts — as ONE list.
 *
 * The inspector used to print every question twice: "Worksheet and questions"
 * with the choices, then "Answers and result" with the same prompts again and
 * a different (bank-global) numbering. Same page, same questions, two
 * numberings, everything said twice (UX audit IA1/IA6). The worksheet's own
 * numbering wins; the bank index is an internal id and never appears.
 */
import { labelize } from '../labelize.js';

const fallbackLetter = (index) => String.fromCharCode(65 + index);
/** Choices carry `label`; `text` is only a legacy tail. */
const choiceText = (choice) => choice?.label ?? choice?.text ?? choice;
const choiceLetter = (choice, index) => choice?.letter ?? fallbackLetter(index);

/**
 * An answer arrives as either a bubbled LETTER ("B", "A,B") or as answer
 * text, depending on how it was captured. A letter is an internal
 * coordinate on a printed page — never something to show a parent (the
 * "Their answer: B,D" leak, audit IA6). Resolve it against the worksheet's
 * own choices; pass anything unrecognized through untouched.
 */
function readable(value, choices = []) {
  if (value == null || value === '') return null;
  const parts = String(value).split(',').map((part) => part.trim()).filter(Boolean);
  const resolved = parts.map((part) => {
    const byLetter = choices.find((choice, index) => choiceLetter(choice, index) === part);
    return byLetter ? String(choiceText(byLetter)) : part;
  });
  return resolved.join(', ');
}

/** Did the child pick this choice? Compare on letter AND on text. */
function isChosen(choice, index, given) {
  if (given == null) return false;
  const parts = String(given).split(',').map((part) => part.trim());
  return parts.includes(choiceLetter(choice, index)) || parts.includes(String(choiceText(choice)));
}

function rowsFor(assignment, assessment) {
  const questions = assignment?.questions ?? [];
  const items = assessment?.items ?? [];
  if (questions.length) {
    const byItemId = new Map(items.filter((item) => item.itemId != null).map((item) => [item.itemId, item]));
    return questions.map((question, index) => ({
      key: question.itemId ?? `q${index}`,
      number: question.number ?? index + 1,
      prompt: question.prompt ?? 'Question text unavailable',
      choices: question.choices ?? [],
      item: byItemId.get(question.itemId) ?? items[index] ?? null,
    }));
  }
  return items.map((item, index) => ({
    key: item.itemId ?? `a${index}`,
    number: index + 1,
    prompt: item.prompt ?? 'Recorded answer',
    choices: [],
    item,
  }));
}

export default function GradedWorksheet({ assignment, assessment }) {
  const rows = rowsFor(assignment, assessment);
  if (!rows.length) return null;
  return (
    <ol className="teacher-graded-worksheet">
      {rows.map((row) => {
        const item = row.item;
        const verdict = item?.verdict ?? null;
        const given = readable(item?.given, row.choices);
        const expected = item?.expected?.length ? readable(item.expected.join(','), row.choices) : null;
        const wrong = verdict && verdict !== 'correct';
        return (
          <li className={`teacher-graded-q${verdict ? ` teacher-graded-q--${verdict}` : ''}`} key={row.key}>
            <span className="teacher-graded-q__number">{row.number}.</span>
            <div className="teacher-graded-q__main">
              <p className="teacher-graded-q__prompt">{row.prompt}</p>
              {row.choices.length > 0 && (
                <ul className="teacher-graded-q__choices">
                  {row.choices.map((choice, index) => (
                    <li key={`${row.key}:${index}`} className={isChosen(choice, index, item?.given) ? 'is-chosen' : undefined}>
                      {choiceLetter(choice, index)}. {choiceText(choice)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="teacher-graded-q__result">
              {item ? <>
                <span className="teacher-graded-q__given">{given ?? 'No recorded answer'}</span>
                {verdict && <span className={`teacher-verdict teacher-verdict--${verdict}`}>{labelize(verdict)}</span>}
                {wrong && expected && (
                  <small className="teacher-graded-q__expected">Correct answer: {expected}</small>
                )}
              </> : <span className="teacher-muted">Not graded</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
```

**Step 4: Run to verify it passes.**

**Step 5: Add the styles** to `Teacher.scss`:

```scss
/* --- The graded worksheet (UX audit IA1/IA6) --------------------------- */
.teacher-graded-worksheet { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.teacher-graded-q {
  display: grid; grid-template-columns: 30px minmax(0, 1fr) minmax(150px, 230px); gap: 12px;
  padding: 11px 0; border-top: 1px solid #f0eadf;
  &:first-child { border-top: 0; }
  &__number { color: #a2988a; font-weight: 800; font-size: 13px; }
  /* Question prose reads left-to-right like prose. It used to be centred in a
     ragged middle column, which is unreadable at length. */
  &__main { min-width: 0; text-align: left; }
  &__prompt { margin: 0; color: #3b3428; font-weight: 700; line-height: 1.4; }
  &__choices { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0 0; padding: 0; list-style: none;
    li { color: #877d6d; font-size: 13px; }
    li.is-chosen { color: #3b3428; font-weight: 700; } }
  &__result { display: grid; justify-items: end; align-content: start; gap: 3px; text-align: right; }
  &__given { color: #4a4335; font-size: 13px; }
  &__expected { color: #8d452c; font-size: 12px; }
  &--incorrect { background: #fdf7f4; }
}
.teacher-verdict { padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
  &--correct { background: #e2eddc; color: #3f5c34; }
  &--incorrect { background: #f7e2da; color: #8d452c; }
}
@media (max-width: 720px) {
  .teacher-graded-q { grid-template-columns: 24px minmax(0, 1fr);
    &__result { grid-column: 2; justify-items: start; text-align: left; } }
}
```

**Step 6: Commit**

```bash
git add frontend/src/modules/School/teacher/panels/GradedWorksheet.jsx frontend/src/modules/School/teacher/panels/GradedWorksheet.test.jsx frontend/src/modules/School/teacher/Teacher.scss
git commit -m "feat(school/teacher): one graded-worksheet list replaces the double question render"
```

---

## Task 11: Recompose `SessionInspector`

**Files:**
- Modify: `frontend/src/modules/School/teacher/WorkspaceViews.jsx` (`SessionInspector`)
- Modify: `frontend/src/modules/School/teacher/panels/IssuedArtifactCard.jsx`
- Test: `frontend/src/modules/School/teacher/WorkspaceViews.sessionDetail.test.jsx` (exists — extend)

**Step 1: Write the failing test**

Append to `WorkspaceViews.sessionDetail.test.jsx`:

```jsx
it('states one score when the machine and the teacher agree', async () => {
  teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: SESSION });
  render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('Score')).toBeInTheDocument());
  expect(screen.queryByText('Marked score')).not.toBeInTheDocument();
  expect(screen.queryByText('Current score')).not.toBeInTheDocument();
  expect(screen.queryByText(/corrected from/i)).not.toBeInTheDocument();
});

it('shows the correction provenance only when the scores differ', async () => {
  teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: {
    ...SESSION, scores: { machine: { percent: 80 }, effective: { percent: 100 } },
  } });
  render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={vi.fn()} />);
  await waitFor(() => expect(screen.getByText(/corrected from 80%/i)).toBeInTheDocument());
});

it('prints the questions once, under one heading', async () => {
  teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: SESSION });
  render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('Questions and answers')).toBeInTheDocument());
  expect(screen.queryByText('Worksheet and questions')).not.toBeInTheDocument();
  expect(screen.queryByText('Answers and result')).not.toBeInTheDocument();
  expect(screen.getAllByText('Where did unions form?')).toHaveLength(1);
});

it('folds the answer card and the event log away by default', async () => {
  teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: {
    ...SESSION, answerSheets: [{ cardId: 'c1', studentNumber: '2487270', usedRows: 16, capacity: 50, remainingContiguousSlots: 34, nextRow: 17 }],
  } });
  render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('Answer card')).toBeInTheDocument());
  expect(screen.getByText('Answer card').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText('Event history').closest('details')).not.toHaveAttribute('open');
});

it('puts the reprint control inside the card it reprints', async () => {
  teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: SESSION });
  render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={vi.fn()} />);
  const reprint = await screen.findByRole('button', { name: /Print another copy/i });
  expect(reprint.closest('.teacher-issued-artifact')).not.toBeNull();
});
```

Note: `SESSION` in that file has `scores: { machine: { percent: 100 }, effective: { percent: 100 } }` already.

**Step 2: Run to verify it fails.**

**Step 3a: Let `IssuedArtifactCard` host its own action**

In `IssuedArtifactCard.jsx`, add an `action` prop and render it in the actions row:

```jsx
export default function IssuedArtifactCard({ artifact, lessonTitle = 'Lesson', action = null }) {
```

and inside `teacher-issued-artifact__actions`, after the two links:

```jsx
        {action}
```

Also add `action` to the `!url` early-return branch, inside `teacher-issued-artifact__copy`.

**Step 3b: Recompose `SessionInspector`**

In `WorkspaceViews.jsx`:

- Import `GradedWorksheet`: `import GradedWorksheet from './panels/GradedWorksheet.jsx';`
- Delete the `recordedAnswerLine` helper and the `choiceLetter` helper (now owned by `GradedWorksheet`).
- Replace the `Outcome` `<dl>` with:

```jsx
            <dl>
              <div><dt>Lesson status</dt><dd>{outcomeLabel(sessionState)}</dd></div>
              <div><dt>Score</dt><dd>
                {typeof effectiveGrade === 'number' ? `${Math.round(effectiveGrade)}%` : 'Not graded'}
                {typeof machineGrade === 'number' && typeof effectiveGrade === 'number'
                  && Math.round(machineGrade) !== Math.round(effectiveGrade)
                  && <small className="teacher-score-provenance">corrected from {Math.round(machineGrade)}% as marked</small>}
              </dd></div>
              <div><dt>Last recorded</dt><dd>{humanDateTime(updatedAt) ?? 'Unknown'}</dd></div>
            </dl>
```

- Replace **both** the `session?.assignment && <section>…</section>` block and the `session?.assessment?.items?.length > 0 && <section>…</section>` block with one:

```jsx
          {(session?.assignment || session?.assessment?.items?.length > 0) && (
            <section className="teacher-panel">
              <h3 className="teacher-panel__title">Questions and answers</h3>
              {session.assignment?.createdAt && (
                <p className="teacher-muted">Worksheet issued {humanDateTime(session.assignment.createdAt) ?? 'at session start'}.</p>
              )}
              <GradedWorksheet assignment={session.assignment} assessment={session.assessment} />
            </section>
          )}
```

- Wrap the answer-card section in a fold, keeping the heading text so tests and screen readers find it:

```jsx
          {session?.answerSheets?.length > 0 && (
            <details className="teacher-panel teacher-fold">
              <summary><h3 className="teacher-panel__title">Answer card</h3><span>Bubble-sheet capacity and mapping</span></summary>
              {session.answerSheets.map((card) => ( /* the existing <dl> unchanged */ ))}
            </details>
          )}
```

- Wrap the event-history section the same way:

```jsx
          <details className="teacher-panel teacher-fold">
            <summary><h3 className="teacher-panel__title">Event history</h3><span>{events.length} recorded step{events.length === 1 ? '' : 's'}</span></summary>
            {/* the existing <ol> / empty copy unchanged */}
          </details>
```

- Move the reprint into the card:

```jsx
            {session?.artifacts?.length ? <div className="teacher-session-materials__cards">{session.artifacts.map((artifact) => (
              <IssuedArtifactCard
                key={artifact.artifactId}
                artifact={artifact}
                lessonTitle={session.taxonomy?.lessonTitle ?? session.assignment?.title ?? 'Lesson'}
                action={artifact.availability === 'exact'
                  ? <ArtifactReprint artifactId={artifact.artifactId} kind={artifact.kind} onPrinted={() => setAttempt((n) => n + 1)} />
                  : null}
              />
            ))}</div> : <CapabilityNotice>No issued worksheet or result receipt is linked to this session.</CapabilityNotice>}
```

**Step 3c: Fold styles** — append to `Teacher.scss`:

```scss
.teacher-fold {
  summary { display: flex; align-items: baseline; gap: 10px; cursor: pointer; list-style: none;
    h3 { margin: 0; } span { color: #8d8474; font-size: 12px; } }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: '▸'; margin-left: auto; color: #8d8474; }
  &[open] summary::after { content: '▾'; }
}
.teacher-score-provenance { display: block; margin-top: 2px; color: #8a7d68; font-size: 12px; font-weight: 400; }
```

**Step 4: Run the tests**

```bash
npx vitest run frontend/src/modules/School/teacher/
```

Expected: PASS. The Playwright contract test asserts `Worksheet and questions` and `Answers and result` are visible — update those two assertions to `Questions and answers` in the same commit.

**Step 5: Commit**

```bash
git add -A frontend/src/modules/School/teacher tests/live/flow/school
git commit -m "refactor(school/teacher): session inspector states each fact once, folds the audit trail"
```

---

# PHASE 3 — Interventions (closes IA4)

## Task 12: The interventions registry

**Files:**
- Create: `frontend/src/modules/School/teacher/interventions.js`
- Test: `frontend/src/modules/School/teacher/interventions.test.js`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { INTERVENTIONS, interventionsFor } from './interventions.js';

describe('interventions registry', () => {
  it('gives every intervention a plain-language "use when"', () => {
    for (const item of INTERVENTIONS) {
      expect(item.id).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.useWhen.length).toBeGreaterThan(15);
      expect(item.label).not.toMatch(/exception|attestation|override/i); // no jargon in the name
    }
  });

  it('has no duplicate ids', () => {
    const ids = INTERVENTIONS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filters to a scope', () => {
    const learner = interventionsFor('learner');
    expect(learner.length).toBeGreaterThan(0);
    expect(learner.every((item) => item.scope === 'learner')).toBe(true);
  });

  it('builds learner-scoped hrefs', () => {
    const credit = INTERVENTIONS.find((item) => item.id === 'completion-credit');
    expect(credit.href('learner-a')).toBe('/school/teacher/students/learner-a/operations');
  });
});
```

**Step 2: Run to verify it fails.**

**Step 3: Implement**

```js
/**
 * The one index of "something went wrong — what do I use?" (UX audit IA4).
 *
 * The repair tools were spread across four pages under five different words —
 * exceptions, overrides, attestations, corrections, repair — with no page
 * anywhere saying which one matches which situation. Each entry names the
 * tool in the family's language and states the situation it is for; the id
 * and the internal vocabulary stay out of the label.
 */
import { TEACHER_BASE } from './teacherUrl.js';

const learnerOps = (learnerId) => `${TEACHER_BASE}/students/${encodeURIComponent(learnerId)}/operations`;
const schoolOps = () => `${TEACHER_BASE}/operations`;

export const INTERVENTIONS = [
  {
    id: 'grade-correction', scope: 'session', label: 'Fix a marked answer',
    useWhen: 'The machine marked a right answer wrong, or a wrong answer right.',
    where: 'Open the lesson from the day record, then “Fix a marked answer”.',
    href: null,
  },
  {
    id: 'retake', scope: 'session', label: 'Offer another try',
    useWhen: 'They should attempt the same lesson again.',
    where: 'Open the lesson from the day record. Offered when a lesson needs review.',
    href: null,
  },
  {
    id: 'completion-credit', scope: 'learner', label: 'Give credit for work you saw',
    useWhen: 'They did the work but the tech lost it — no scan, no session, a dead printer.',
    where: 'Student → Operations.',
    href: learnerOps,
  },
  {
    id: 'reassign', scope: 'learner', label: 'Move work to the right child',
    useWhen: 'The wrong child’s name ended up on a lesson.',
    where: 'Student → Operations.',
    href: learnerOps,
  },
  {
    id: 'curriculum-change', scope: 'school', label: 'Excuse, postpone, swap, or stop a lesson',
    useWhen: 'The lesson itself is the problem — broken, missing, garbled, or not right for now.',
    where: 'School → Operations.',
    href: schoolOps,
  },
  {
    id: 'stuck-session', scope: 'school', label: 'Clear a lesson that never finished',
    useWhen: 'A lesson is stuck open and blocking new work.',
    where: 'School → Operations.',
    href: schoolOps,
  },
  {
    id: 'active-changes', scope: 'school', label: 'See what is already changed',
    useWhen: 'You want to know which rules are currently overridden, and by whom.',
    where: 'School → Operations.',
    href: schoolOps,
  },
  {
    id: 'bulk-regrade', scope: 'school', label: 'Re-mark a whole batch',
    useWhen: 'A grading rule was wrong for many attempts at once.',
    where: 'School → Operations.',
    href: schoolOps,
  },
];

export const interventionsFor = (scope) => INTERVENTIONS.filter((item) => item.scope === scope);

export default INTERVENTIONS;
```

**Step 4: Run to verify it passes.**

**Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/interventions.js frontend/src/modules/School/teacher/interventions.test.js
git commit -m "feat(school/teacher): one registry naming every repair tool and when to use it"
```

---

## Task 13: The interventions index panel

**Files:**
- Create: `frontend/src/modules/School/teacher/panels/InterventionsIndex.jsx`
- Test: `frontend/src/modules/School/teacher/panels/InterventionsIndex.test.jsx`

**Step 1: Write the failing test**

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import InterventionsIndex from './InterventionsIndex.jsx';

describe('InterventionsIndex', () => {
  it('lists every tool with its situation', () => {
    render(<InterventionsIndex learnerId="learner-a" />);
    expect(screen.getByText('Give credit for work you saw')).toBeInTheDocument();
    expect(screen.getByText(/the tech lost it/i)).toBeInTheDocument();
  });

  it('links learner-scoped tools at the learner', () => {
    render(<InterventionsIndex learnerId="learner-a" />);
    expect(screen.getByRole('link', { name: /Give credit for work you saw/ }))
      .toHaveAttribute('href', '/school/teacher/students/learner-a/operations');
  });

  it('renders session-scoped tools as guidance, not dead links', () => {
    render(<InterventionsIndex learnerId="learner-a" />);
    const row = screen.getByText('Fix a marked answer').closest('li');
    expect(row.querySelector('a')).toBeNull();
    expect(row).toHaveTextContent(/Open the lesson from the day record/);
  });

  it('can narrow to one scope', () => {
    render(<InterventionsIndex learnerId="learner-a" scopes={['learner']} />);
    expect(screen.getByText('Give credit for work you saw')).toBeInTheDocument();
    expect(screen.queryByText('Re-mark a whole batch')).not.toBeInTheDocument();
  });
});
```

**Step 2: Run to verify it fails.**

**Step 3: Implement**

```jsx
/**
 * "Something went wrong — which tool?" (UX audit IA4). Every repair the
 * workspace can do, named for the situation rather than the mechanism, each
 * with exactly one home. A tool whose home is a specific lesson gets its
 * route described rather than a link that could only guess at the lesson.
 */
import { INTERVENTIONS } from '../interventions.js';

export default function InterventionsIndex({ learnerId = null, scopes = null }) {
  const items = scopes ? INTERVENTIONS.filter((item) => scopes.includes(item.scope)) : INTERVENTIONS;
  return (
    <section className="teacher-panel teacher-interventions">
      <h3 className="teacher-panel__title">Which repair do I need?</h3>
      <p className="teacher-muted">Use the narrowest one that matches what actually happened. Every change is recorded with your name and a reason.</p>
      <ul className="teacher-interventions__list">
        {items.map((item) => {
          const href = item.href && (item.scope === 'learner' ? (learnerId ? item.href(learnerId) : null) : item.href());
          return (
            <li key={item.id}>
              {href ? <a className="teacher-interventions__label" href={href}>{item.label}</a>
                : <strong className="teacher-interventions__label">{item.label}</strong>}
              <span className="teacher-interventions__when">{item.useWhen}</span>
              <small className="teacher-interventions__where">{item.where}</small>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

**Step 4: Run to verify it passes.**

**Step 5: Styles** — append to `Teacher.scss`:

```scss
.teacher-interventions__list { display: grid; gap: 0; margin: 10px 0 0; padding: 0; list-style: none;
  li { display: grid; grid-template-columns: minmax(190px, .8fr) 1fr; gap: 4px 16px; padding: 10px 0; border-top: 1px solid #f0eadf; }
  li:first-child { border-top: 0; }
}
.teacher-interventions__label { color: #6b4a1e; font-weight: 700; text-decoration: none;
  &:hover { text-decoration: underline; } }
.teacher-interventions__when { color: #5f584c; line-height: 1.45; }
.teacher-interventions__where { grid-column: 2; color: #8d8474; font-size: 12px; }
@media (max-width: 720px) {
  .teacher-interventions__list li { grid-template-columns: 1fr; }
  .teacher-interventions__where { grid-column: 1; }
}
```

**Step 6: Commit**

```bash
git add frontend/src/modules/School/teacher/panels/InterventionsIndex.jsx frontend/src/modules/School/teacher/panels/InterventionsIndex.test.jsx frontend/src/modules/School/teacher/Teacher.scss
git commit -m "feat(school/teacher): interventions index — one page that says which repair to use"
```

---

## Task 14: One home per panel

**Files:**
- Modify: `frontend/src/modules/School/teacher/WorkspaceViews.jsx`
- Test: `frontend/src/modules/School/teacher/WorkspaceViews.exceptions.test.jsx` (exists — extend)

Current duplication, verified by `grep -n "<PanelName" WorkspaceViews.jsx`:

| Panel | Rendered at | Keep at | Elsewhere |
|---|---|---|---|
| `CurriculumExceptionPanel` | 3 places (395, 399, 407) | School Operations | link |
| `StaleSessions` | 2 places (383, 407) | School Operations | link |
| `MilestonesPanel` | 2 places (230, 356) | Learner Courses | — (Overview is gone) |
| `PeriodsTimeline` | 2 places (400, 407) | School Operations | link |

**Step 1: Write the failing test**

Append to `WorkspaceViews.exceptions.test.jsx`:

```jsx
it('renders the curriculum-change form in exactly one place — School Operations', async () => {
  const { unmount } = render(<CurriculumView kids={KIDS} />);
  await waitFor(() => expect(screen.queryAllByText('Curriculum exceptions')).toHaveLength(0));
  expect(screen.getByRole('link', { name: /Excuse, postpone, swap, or stop a lesson/ })).toBeInTheDocument();
  unmount();
  render(<OperationsView kids={KIDS} />);
  await waitFor(() => expect(screen.getAllByText('Curriculum exceptions')).toHaveLength(1));
});

it('keeps stuck-session clearing on School Operations only', async () => {
  const { unmount } = render(<LearnerOperationsView learnerId="learner-a" learnerName="Learner A" kids={KIDS} />);
  await waitFor(() => expect(screen.queryByText(/Stale sessions/i)).not.toBeInTheDocument());
  unmount();
  render(<OperationsView kids={KIDS} />);
  await waitFor(() => expect(screen.getAllByText(/Stale sessions/i)).toHaveLength(1));
});
```

Adjust the panel headings in the assertions to whatever `StaleSessions` and `CurriculumExceptionPanel` actually render (read them first).

**Step 2: Run to verify it fails.**

**Step 3: Implement**

3a. `CurriculumView` — remove both `<CurriculumExceptionPanel …>` and the second `<PeriodsTimeline />`, replace with a scoped index:

```jsx
export function CurriculumView({ kids, courseId = null, lessonId = null }) {
  return <div className="teacher-view"><div className="teacher-view__heading"><div>
    <p className="teacher-view__eyebrow">Published curriculum</p>
    <h2>{courseId ? 'Course curriculum' : 'Courses, units, and policy'}</h2>
    <p>Inspect and operate published curriculum. Authoring remains in reviewed source files.</p>
  </div></div>
    {courseId ? <>
      <CourseContext courseId={courseId} lessonId={lessonId} />
      <CurriculumBrowser courseId={courseId} />
      <InterventionsIndex scopes={['school']} />
    </> : <>
      <CurriculumCatalog />
      <SchoolMatrix kids={kids} />
      <EnrichmentPanel kids={kids} />
      <InterventionsIndex scopes={['school']} />
    </>}
  </div>;
}
```

3b. `LearnerOperationsView` — drop `StaleSessions`, lead with the index:

```jsx
export function LearnerOperationsView({ learnerId, learnerName, kids }) {
  return (
    <div className="teacher-view">
      <div className="teacher-view__heading"><div>
        <p className="teacher-view__eyebrow">Student operations</p>
        <h2>Repair {learnerName}&rsquo;s record</h2>
        <p>Use the narrowest intervention that matches what actually happened. Every write is attributed and auditable.</p>
      </div></div>
      <InterventionsIndex learnerId={learnerId} />
      <AttestationPanel learnerId={learnerId} learnerName={learnerName} />
      <ReassignPanel learnerId={learnerId} learnerName={learnerName} kids={kids} />
    </div>
  );
}
```

3c. `OperationsView` — unchanged panel set, but add the index first and give it a real heading:

```jsx
export function OperationsView({ kids }) {
  return <div className="teacher-view"><div className="teacher-view__heading"><div>
    <p className="teacher-view__eyebrow">School operations</p>
    <h2>Health, gates, and exceptions</h2>
    <p>Find systematic blockers before changing a student record.</p>
  </div></div>
    <InterventionsIndex scopes={['school']} />
    <CurriculumExceptionPanel kids={kids} />
    <StaleSessions kids={kids} />
    <ActiveOverrides kids={kids} />
    <PeriodsTimeline />
    <BulkRegradePanel />
    <CapabilityNotice>Device health and retained-artifact audit will appear here when their teacher read models are available.</CapabilityNotice>
  </div>;
}
```

3d. Import `InterventionsIndex` in `WorkspaceViews.jsx`.

3e. Verify the counts are now 1 each:

```bash
cd frontend/src/modules/School/teacher
for p in CurriculumExceptionPanel StaleSessions MilestonesPanel PeriodsTimeline; do
  echo "$p: $(grep -c "<$p" WorkspaceViews.jsx)"
done
```
Expected: `CurriculumExceptionPanel: 1`, `StaleSessions: 1`, `MilestonesPanel: 1`, `PeriodsTimeline: 1`.

**Step 4: Run the module tests.**

**Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/
git commit -m "refactor(school/teacher): one home per repair panel; links replace duplicate renders"
```

---

## Task 15: The inspector's cross-page link becomes a real action

**Files:**
- Modify: `frontend/src/modules/School/teacher/WorkspaceViews.jsx` (`SessionInspector` action row)
- Test: `WorkspaceViews.sessionDetail.test.jsx`

**Step 1: Write the failing test**

```jsx
it('offers repair options in the teacher’s words, weighted by importance', async () => {
  teacherWorkspaceApi.session.mockResolvedValue({ ok: true, status: 200, data: SESSION });
  render(<SessionInspector learnerId="learner-b" sessionId="ses_1" kids={KIDS} onBack={vi.fn()} />);
  const fix = await screen.findByRole('button', { name: 'Fix a marked answer' });
  expect(fix).toHaveClass('teacher-btn--primary');
  const credit = screen.getByRole('link', { name: /Give credit for work you saw/ });
  expect(credit).toHaveAttribute('href', '/school/teacher/students/learner-b/operations');
  expect(credit).not.toHaveClass('teacher-back');
});
```

**Step 2: Run to verify it fails.**

**Step 3: Implement**

Replace the inspector's action row with:

```jsx
            <div className="teacher-action-row">
              <GradeCorrection sessionId={sessionId} revision={session?.revision} currentPercent={effectiveGrade}
                items={session?.reviewEvidence ?? []} onApplied={() => setAttempt((n) => n + 1)} />
              {canOfferRetake && <button type="button" className="teacher-btn" disabled={busy === sessionId}
                onClick={offerRetake}>Offer another try</button>}
              <a className="teacher-btn teacher-btn--quiet"
                 href={`${teacherBaseFor(globalThis.location?.pathname ?? '')}/students/${encodeURIComponent(result.ownerId ?? learnerId ?? '')}/operations`}>
                Give credit for work you saw →
              </a>
            </div>
```

And in `GradeCorrection`, change the closed-state trigger to the primary weight and the plain-language label:

```jsx
  if (!open) return <button type="button" className="teacher-btn teacher-btn--primary" onClick={() => setOpen(true)}>Fix a marked answer</button>;
```

Also update the two labels inside the open form for consistency: keep `Preview correction` / `Apply correction`.

**Step 4: Run to verify it passes.**

**Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/WorkspaceViews.jsx frontend/src/modules/School/teacher/WorkspaceViews.sessionDetail.test.jsx
git commit -m "fix(school/teacher): inspector actions get plain names and honest button weights"
```

---

# PHASE 4 — CTA hygiene (closes IA5)

## Task 16: A button system

**Files:**
- Modify: `frontend/src/modules/School/teacher/Teacher.scss`

**Step 1: Add the classes** near `.teacher-primary` (keep `.teacher-primary` — it is used by the dashboard heading):

```scss
/* One button vocabulary (UX audit IA5). Weight signals consequence:
   primary = the thing you came here to do; default = a peer action;
   quiet = navigation wearing a button's clothes. */
.teacher-btn {
  border: 1px solid #d4c6af; border-radius: 7px; padding: 7px 11px;
  background: white; color: #59462f; cursor: pointer; font: inherit; text-decoration: none; white-space: nowrap;
  &:disabled { cursor: not-allowed; opacity: .5; }
  &--primary { border-color: #6e4b20; background: #6e4b20; color: white; font-weight: 700; }
  &--quiet { border-color: transparent; background: transparent; color: #745326; font-weight: 700; padding-left: 4px; padding-right: 4px; }
}
```

**Step 2: Build to check the SCSS compiles**

```bash
npm run build --prefix frontend 2>&1 | tail -3
```

**Step 3: Commit**

```bash
git add frontend/src/modules/School/teacher/Teacher.scss
git commit -m "style(school/teacher): one button vocabulary — primary, default, quiet"
```

---

## Task 17: Stop advertising an empty queue twice

**Files:**
- Modify: `frontend/src/modules/School/teacher/tabs/TodayTab.jsx`
- Test: `frontend/src/modules/School/teacher/tabs/TodayTab.test.jsx`

**Step 1: Write the failing test**

```jsx
it('hides the backlog strip when there is no backlog', async () => {
  schoolApi.lifecycleReview.mockResolvedValue(ok({ items: [] }));
  schoolApi.printPending.mockResolvedValue(ok([]));
  schoolApi.quizRequests.mockResolvedValue(ok([]));
  schoolApi.teacherDay.mockResolvedValue(ok({ learners: [] }));
  mount(<TodayTab kids={KIDS} onOpenQueue={vi.fn()} />);
  await waitFor(() => expect(screen.queryByTestId('backlog-strip')).not.toBeInTheDocument());
});

it('shows the backlog strip as soon as anything is waiting', async () => {
  schoolApi.lifecycleReview.mockResolvedValue(ok({ items: [{ id: 'r1' }] }));
  schoolApi.printPending.mockResolvedValue(ok([]));
  schoolApi.quizRequests.mockResolvedValue(ok([]));
  schoolApi.teacherDay.mockResolvedValue(ok({ learners: [] }));
  mount(<TodayTab kids={KIDS} onOpenQueue={vi.fn()} />);
  await waitFor(() => expect(screen.getByTestId('backlog-strip')).toHaveTextContent('1 to review'));
});
```

**Step 2: Run to verify it fails.**

**Step 3: Implement** — in `BacklogStrip`, replace the `if (!parts.length) return null;` guard with:

```js
  // An empty queue advertised twice (heading CTA + this strip) was the
  // emptiest possible state shouting for attention (UX audit IA5).
  const waiting = (reviews ?? 0) + (printJobs ?? 0) + (quizAsks ?? 0);
  if (!parts.length || waiting === 0) return null;
```

**Step 4: Run to verify it passes.**

**Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/tabs/TodayTab.jsx frontend/src/modules/School/teacher/tabs/TodayTab.test.jsx
git commit -m "fix(school/teacher): hide the backlog strip when nothing is waiting"
```

---

## Task 18: "Preview not available" should not look like a broken link

**Files:**
- Modify: `frontend/src/modules/School/teacher/Teacher.scss`
- Modify: `frontend/src/modules/School/teacher/panels/IssuedArtifactCard.jsx`
- Test: `frontend/src/modules/School/teacher/panels/SafeImg.test.jsx` (exists — extend)

The fallback `<p>` sits inside an `<a>`, so it inherits the anchor's underline and link colour. It is the majority state in production, so it is the first thing a teacher sees of the paper-records feature.

**Step 1: Write the failing test**

Append to `SafeImg.test.jsx`:

```jsx
it('gives the fallback its own quiet class, not link styling', () => {
  render(<SafeImg src="/broken.png" alt="x" />);
  fireEvent.error(screen.getByAltText('x'));
  const fallback = screen.getByText('Preview not available');
  expect(fallback).toHaveClass('teacher-img-fallback');
});
```

**Step 2: Implement**

2a. In `IssuedArtifactCard.jsx`, change the worksheet fallback copy so it says what it means:

```jsx
        : artifact.thumbnailUrl
          ? <SafeImg src={artifact.thumbnailUrl} alt={`${title} first page`} fallback="No preview" />
          : <span className="teacher-img-fallback">PDF</span>}
```

2b. In `Teacher.scss`, kill the inherited underline at its source and style the fallback:

```scss
.teacher-issued-artifact__preview,
.teacher-issued-artifact__receipt-preview { text-decoration: none; }
.teacher-img-fallback {
  display: grid; place-items: center; height: 100%; min-height: 64px; margin: 0;
  color: #9a9081; font-size: 12px; font-weight: 700; text-decoration: none;
}
```

**Step 3: Run the tests, then build to check the SCSS.**

**Step 4: Commit**

```bash
git add frontend/src/modules/School/teacher/
git commit -m "fix(school/teacher): a missing thumbnail reads as a quiet state, not a broken link"
```

---

# PHASE 5 — Verify and document

## Task 19: Extend the visual contract

**Files:**
- Modify: `tests/live/flow/school/teacher-workspace-contract.runtime.test.mjs`

**Step 1: Add a Learner Day contract test**

```js
test('retraces any study day in one place — plan, record, and paper', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await installTeacherReadModel(page);
  await page.goto('/school/teacher/students/learner-b/day/2026-08-24');

  await expect(page.getByText('Monday, Aug 24')).toBeVisible();
  await expect(page.getByTestId('day-summary')).toBeVisible();
  await expect(page.getByText('Illinois')).toBeVisible();
  // The study day is stated once for the page, never repeated per row (IA2).
  await expect(page.getByText('Monday, Aug 24')).toHaveCount(1);

  await page.getByText('Paper record').first().click();
  await expect(page.getByRole('link', { name: 'Open worksheet' }))
    .toHaveAttribute('href', /artifacts\/worksheet-illinois\/original\.pdf$/);

  await page.getByRole('button', { name: /previous day/i }).click();
  await expect(page).toHaveURL(/\/students\/learner-b\/day\/2026-08-23$/);

  await page.screenshot({ path: path.join(OUT_DIR, 'learner-day.png'), fullPage: true });
});

test('dry-runs the printed agenda without minting a session, ticket, or code', async ({ page }) => {
  const writes = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() !== 'GET' && /\/agenda\//.test(url.pathname)) {
      writes.push({ method: request.method(), path: url.pathname });
    }
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await installTeacherReadModel(page);
  await page.goto('/school/teacher/students/learner-b/day/2026-08-24');

  await page.getByRole('button', { name: /show the printed agenda/i }).click();
  const printed = page.getByAltText(/printed agenda/i);
  await expect(printed).toBeVisible();
  await expect(printed).toHaveAttribute('src', /agenda\/preview\?.*studyDay=2026-08-24/);
  await expect(page.getByText(/codes on this copy don’t work/i)).toBeVisible();
  // No affordance anywhere that would send this to a real printer.
  await expect(page.getByRole('button', { name: /print .* agenda/i })).toHaveCount(0);
  expect(writes).toEqual([]);

  await page.screenshot({ path: path.join(OUT_DIR, 'printed-agenda-preview.png'), fullPage: true });
});
```

The mock's `/agenda/preview` branch already answers an SVG for the non-JSON case — keep it. That branch is what proves the view fetches the **printer image** rather than re-laying the plan out in HTML.

Extend the mock's agenda-preview branch to return real `sections` (at minimum one `civilization` section with `next.title`, one unplayed subject, and one `suppressed` section) so the join has something to show.

**Step 2: Run the whole contract suite**

```bash
npx playwright test --config playwright.teacher.config.mjs --reporter=line
```

Expected: all tests pass. Review every screenshot in `docs/_wip/audits/teacher-workspace/` by opening them — the point of this suite is that a human (or a vision-capable agent) looks.

**Step 3: Commit**

```bash
git add tests/live/flow/school/teacher-workspace-contract.runtime.test.mjs docs/_wip/audits/teacher-workspace/
git commit -m "test(school/teacher): visual contract for the Learner Day record"
```

---

## Task 20: Full verification sweep

**Step 1: The whole teacher module**

```bash
npx vitest run frontend/src/modules/School/teacher/
```
Expected: green, with **more** test files than the Task 0 baseline.

**Step 2: The whole School module** (the teacher views import from `../progress/` and `../home/`)

```bash
npx vitest run frontend/src/modules/School/
```

**Step 3: Lint**

```bash
npm run lint --prefix frontend
```
Expected: clean. `--max-warnings 0` means a warning fails.

**Step 4: The vitest population gate** (catches a file that no harness runs)

```bash
node scripts/gate-vitest.mjs
```
Expected: exit 0. If a NEW file fails, fix the file — do not run `--update`.

**Step 5: Build**

```bash
npm run build --prefix frontend
```

**Step 6: Confirm no dead imports remain**

```bash
grep -rn "AgendaPreview\|LearnerDay\.jsx\|recordedAnswerLine" frontend/src tests | grep -v LearnerDayView
```
Expected: no output.

**Step 7: Commit any fixes**

```bash
git add -A && git commit -m "chore(school/teacher): verification sweep fixes"
```

---

## Task 21: Documentation

**Files:**
- Modify: `docs/reference/school/README.md`
- Modify: `docs/_wip/audits/2026-08-25-teacher-view-information-architecture-audit.md`

**Step 1: Document the new organizing unit**

Add a section to `docs/reference/school/README.md`:

```markdown
### The teacher workspace's organizing unit: the Learner Day

`/school/teacher/students/:learnerId/day/:studyDay` is the canonical record of
one child on one school day. It joins two side-effect-free reads —
`GET /lifecycle/learners/:id/agenda/preview?format=json&studyDay=…` (the plan)
and `GET /teacher/day?studyDay=…` (the record) — through the pure function
`learnerDay.js#joinLearnerDay`, which classifies each subject as done,
not started, deferred, blocked, or extra. Previewing a day never writes.

- It also carries the **printed-agenda dry run**: the exact thermal-printer PNG
  for the selected day, from the same GET route, on demand. `previewAgenda` is
  `BuildAgenda` with `previewOnly: true`, which emits `token: null,
  tokenClass: 'preview'` and relabels every offer "Preview only — ask a
  grown-up to start this lesson" — so the QR and digit codes on a previewed
  sheet are inert by construction. Nothing is minted, for today or any day.
- The dashboard and the History tab both LINK here; neither re-renders it.
- `/students/:id` and `/students/:id/overview` both resolve to the day record.
- Paper records (worksheet PDF, result receipt) are fetched lazily per lesson
  via `SessionPaperRecord`, never eagerly for a whole day.
- Repair tooling is indexed in `interventions.js`; each tool has exactly one
  home, and `InterventionsIndex` is the only thing that lists them.
```

**Step 2: Mark the audit remediated** — add at the top of the audit, mirroring the 2026-08-24 audit's convention:

```markdown
> **OUTCOME (YYYY-MM-DD):** IA1–IA6 remediated — plan
> `docs/_wip/plans/2026-08-25-teacher-workspace-ia-remediation.md`.
> Verified via vitest (teacher module green) + the frontend-only Playwright
> visual contract. Screenshots in `docs/_wip/audits/teacher-workspace/`.
```

**Step 3: Update the docs freshness marker**

```bash
git rev-parse HEAD > docs/docs-last-updated.txt
```

**Step 4: Commit**

```bash
git add docs/
git commit -m "docs(school): the Learner Day is the teacher workspace's organizing unit"
```

---

## Task 22: Show the teachers, then integrate

**Step 1: Run the app and look at it**

A dev server may already be running (`lsof -i :3111`). **Do not start a second backend.** If nothing is running, the Playwright config's Vite-only server on 3113 is the safe way to view the workspace.

**Step 2: Capture the four screens the teachers complained about**

Dashboard, dashboard drill-in, a Learner Day, and a session inspector — at 1440px and at 390px. Put them beside the six originals in the audit and confirm each complaint is answered:

| Complaint | Now |
|---|---|
| Information scattered | One day record joins plan, record, and paper |
| Unnecessary repetition | Each lesson appears once per surface; questions printed once |
| Taxonomy confusing | One study day per page, stated once, in words |
| Retracing a day is hard | Date nav, prev/next, and History days link into it |
| CTAs haphazard | One button vocabulary; actions live inside what they act on |
| Hard to find overrides | An index that names each repair and when to use it |

**Step 3: Merge** — per project rules: merge into `main` directly, no PR, then remove the branch and record it.

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git checkout main
git merge --no-ff feat/teacher-workspace-ia
npx vitest run frontend/src/modules/School/    # green on main before anything else
git worktree remove .claude/worktrees/teacher-ia
git branch -d feat/teacher-workspace-ia
```

Record the deletion in `docs/_archive/deleted-branches.md`:

```markdown
| 2026-08-25 | feat/teacher-workspace-ia | <commit-hash> | Teacher workspace IA remediation (Learner Day, merged inspector, interventions index) |
```

**Step 4: Do NOT deploy.** Deploying is the operator's call. Report what merged and what still needs a look on real hardware.

---

## Appendix A: follow-ups this plan surfaces but does not do

The backend survey found more than this plan consumes. Record these; do not scope-creep into them.

**One small backend change would materially improve the day view.** `BuildAgenda.mjs` (L355–398) already resolves full `taxonomy{subject, course, unit, lesson}` and a numbered `progressLabel` for every section — but only into `sectionsForDocument`, which feeds the printed PNG. The JSON branch returns the *un*-enriched `sections`. Returning the enriched ones would let a *planned-but-not-done* row render a real `<LessonIdentity>` (poster, course, unit) instead of subject-plus-title. That is the single highest-value backend follow-up, and it is additive.

**Rich payloads the frontend ignores entirely:**
- `agenda/preview` `entries[]` — the whole flat planner list (every assigned unit with `status`, `timing`, `sequence`, `lockReason`, `remedy`, `unlocks`). Serialized on every call, read by nothing. It is the richest "what was planned" data in the system.
- `section.obligation{state, reason}` — a full excused/obligated/served/faulted state machine, computed and shipped, read by nothing. `AgendaStatusBoard` re-derives a weaker "done" from `servedToday`.
- `section.progressLabel`, `.gradePercent`, `.focus`, `.programUnavailable`, `.suppressed.byUnitId`, `.suppressed.reasons`.
- Session detail: `progress{}` (course completion roll-up), `omrEvidence[]`, `worksheetSnapshot`, `rewardReconciliation[]`, `assessment.machine`/`.effective`, and the remediation lineage (`state.remediationOf`, `remediationItemIds`, `variant`, `lastFailure`, `nextAction`).
- Timeline's `unitId` filter is implemented end to end (router → `teacherWorkspaceApi.timeline(id, {unitId})`) and no UI ever passes it. "Show me every attempt at this one lesson" is one prop away.

**Dead reads this plan does NOT touch** (all are harmless `??` tails today, but they are lies in the code): `sessionState.effectiveGrade`, `sessionState.percent`, `sessionState.title`, `sessionState.history` in `SessionInspector`, and `section.id` used as a React key fallback where sections have no `id`.

## Appendix B: what this plan deliberately does not do

- **No backend changes.** Both reads already accept an arbitrary `studyDay`, verified against the routers. If a field the day view wants is missing from a *real* response (as opposed to the mocks), report it — do not invent a backend change mid-plan. Appendix A is the queue for that conversation.
- **No write-semantics changes.** Preview-then-apply, attribution, and PIN step-up are untouched. Buttons were renamed and reweighted; what they do is identical.
- **No visual redesign beyond hierarchy.** Typography scale, verdict colour, alignment, and fold state are in scope because they *are* the hierarchy complaint. A new type system or palette is not.
- **`SchoolMatrix`, `CurriculumBrowser`, `ReportCardView`, and tutor insights are untouched.** The 2026-08-24 audit's C10–C13 (flat mega-renders, unreadable matrix, card walls) are real and still open. They are a separate piece of work; this plan does not pretend to close them.
