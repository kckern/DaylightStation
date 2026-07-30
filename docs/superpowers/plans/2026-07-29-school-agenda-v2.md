# School Agenda v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the flat thermal agenda into a per-subject daily checklist — one QR per subject meaning "do the next thing," with progress, grade-so-far and done-today lines — where the curriculum catalog can schedule whole programs (language ladder first) and scanning on-screen work auto-launches the Portal.

**Architecture:** New pure domain modules (`studyDay.mjs`, `agenda.mjs`) compute the daily sections from the existing planner output; a new `subject_next` token class resolves at scan time through the same next-move logic BuildAgenda uses (extracted to `offerSession.mjs`); a new `IProgramLauncher` port (language first) supplies program status and Portal launches via the WS event bus; the ESC/POS path gains native QR.

**Tech Stack:** Node ESM (`.mjs`), vitest (`tests/isolated/**`), YAML persistence, ESC/POS thermal printing, WebSocket event bus, React frontend.

**Spec:** `docs/superpowers/specs/2026-07-29-school-agenda-v2-design.md` — read it before starting any task.

## Global Constraints

- Everything derived, never stored: no new persisted rollups, flags, or queues. The only writes are existing kinds (sessions, tokens).
- Closed sets in code: token classes, program launcher ids, cadence values. Config never invents one.
- A scan never succeeds silently and never dead-ends: every resolution path ends in printed paper.
- ASCII only on tape copy: `escposEncode` silently DROPS non-cp858 characters (em-dashes are safe — transliterated to `-`). No `✓` anywhere in printed strings.
- Daily boundary is 4am household time via the language ladder's `studyDayIndex` + per-instant offset — never a second boundary implementation, never `Date.now()` in domain code (clock always injected).
- No second gate: daily serving only shapes what the agenda offers; it never blocks any existing path.
- Tests run with the main repo's vitest from this worktree: `node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run <paths>` (worktrees lack node_modules; if `node_modules` is missing here, symlink it: `ln -s /opt/Code/DaylightStation/node_modules node_modules`).
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Backend layering: `2_domains` imports nothing above it; `3_applications` sees ports, never adapters; composition (`5_composition`) is the only place naming concrete adapters.

---

### Task 1: Shared study-day domain module

**Files:**
- Create: `backend/src/2_domains/school/studyDay.mjs`
- Modify: `backend/src/3_applications/school/LanguageStudyService.mjs` (delete its private `offsetMinutesFor`, import the shared one)
- Test: `tests/isolated/domain/school/studyDay.test.mjs`

**Interfaces:**
- Consumes: `studyDayIndex(epochMs, { boundaryHour, offsetMinutes })` from `#domains/school/language/rollover.mjs` (already exported).
- Produces: `offsetMinutesFor(timezone, epochMs) → number` and `isSameStudyDay(aMs, bMs, { timezone, boundaryHour = 4 }) → boolean` from `#domains/school/studyDay.mjs`. Task 5 uses `isSameStudyDay`; Task 9 relies on LanguageStudyService still passing its tests.

- [ ] **Step 1: Write the failing test**

```js
// tests/isolated/domain/school/studyDay.test.mjs
import { describe, it, expect } from 'vitest';
import { offsetMinutesFor, isSameStudyDay } from '#domains/school/studyDay.mjs';

describe('offsetMinutesFor', () => {
  it('returns 0 for a null timezone', () => {
    expect(offsetMinutesFor(null, Date.UTC(2026, 6, 29, 12))).toBe(0);
  });
  it('tracks DST: America/Los_Angeles is -420 in July, -480 in January', () => {
    expect(offsetMinutesFor('America/Los_Angeles', Date.UTC(2026, 6, 15, 12))).toBe(-420);
    expect(offsetMinutesFor('America/Los_Angeles', Date.UTC(2026, 0, 15, 12))).toBe(-480);
  });
  it('returns 0 for an unknown zone rather than throwing', () => {
    expect(offsetMinutesFor('Not/AZone', Date.UTC(2026, 6, 15))).toBe(0);
  });
});

describe('isSameStudyDay', () => {
  const tz = 'America/Los_Angeles';
  // 2026-07-29 01:00 PDT = 08:00 UTC; boundary 4am → belongs to the 28th's study day
  const oneAm = Date.UTC(2026, 6, 29, 8, 0);
  const priorEvening = Date.UTC(2026, 6, 29, 3, 0);   // 20:00 PDT on the 28th
  const nextMorning = Date.UTC(2026, 6, 29, 16, 0);   // 09:00 PDT on the 29th
  it('1am belongs to the previous study day', () => {
    expect(isSameStudyDay(oneAm, priorEvening, { timezone: tz })).toBe(true);
    expect(isSameStudyDay(oneAm, nextMorning, { timezone: tz })).toBe(false);
  });
  it('same calendar afternoon is the same study day', () => {
    expect(isSameStudyDay(nextMorning, Date.UTC(2026, 6, 29, 23, 0), { timezone: tz })).toBe(true);
  });
  it('handles invalid inputs as not-same (never throws)', () => {
    expect(isSameStudyDay(NaN, nextMorning, { timezone: tz })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run tests/isolated/domain/school/studyDay.test.mjs`
Expected: FAIL — cannot resolve `#domains/school/studyDay.mjs`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/2_domains/school/studyDay.mjs`. MOVE the `offsetMinutesFor` function body verbatim from `backend/src/3_applications/school/LanguageStudyService.mjs:39-58` (it is pure — Intl only; the doc comment about DST comes with it). Then:

```js
import { studyDayIndex } from './language/rollover.mjs';

export { studyDayIndex };
export function offsetMinutesFor(timezone, epochMs) { /* moved verbatim */ }

/**
 * Same 4am→4am study day, offset computed per instant so DST transitions
 * cannot split the pair. Invalid input is "not the same day", never a throw:
 * a bad timestamp must not take the agenda down.
 */
export function isSameStudyDay(aMs, bMs, { timezone = null, boundaryHour = 4 } = {}) {
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return false;
  const dayA = studyDayIndex(aMs, { boundaryHour, offsetMinutes: offsetMinutesFor(timezone, aMs) });
  const dayB = studyDayIndex(bMs, { boundaryHour, offsetMinutes: offsetMinutesFor(timezone, bMs) });
  return dayA === dayB;
}
```

In `LanguageStudyService.mjs`: delete the private `offsetMinutesFor` (lines 30-58 region) and add `import { offsetMinutesFor } from '#domains/school/studyDay.mjs';`. Change nothing else there.

- [ ] **Step 4: Run tests to verify they pass, and that language study still passes**

Run: `node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run tests/isolated/domain/school/studyDay.test.mjs backend/src/3_applications/school/LanguageStudyService.test.mjs backend/src/3_applications/school/LanguageStudyService.unrecorded.test.mjs`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/studyDay.mjs backend/src/3_applications/school/LanguageStudyService.mjs tests/isolated/domain/school/studyDay.test.mjs
git commit -m "feat(school): shared study-day domain module — one 4am boundary clock

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Program units in unit validation

**Files:**
- Modify: `backend/src/2_domains/school/curriculum/unitValidation.mjs`
- Test: `tests/isolated/domain/school/curriculum/unitValidation.test.mjs` (extend)

**Interfaces:**
- Produces: `validateUnit(raw, sets)` accepts `sets.programIds: Set<string>`; a valid program unit normalizes to include `program: string` and `cadence: 'daily'|'once'`. `CADENCES = ['daily','once']` exported. Tasks 3, 5, 10, 11 rely on `unit.program` / `unit.cadence` being present on normalized units (both `undefined` on non-program units, `cadence` defaulting to `'once'` on program units that omit it).

- [ ] **Step 1: Write the failing tests** (append to the existing test file, reusing its `refs()`/`valid()` helpers — read the file first; `refs()` must gain `programIds: new Set(['language'])`)

```js
describe('program units', () => {
  const programUnit = (over = {}) => ({
    unitId: 'language-daily',
    title: 'Language — today\'s sentences',
    subject: 'language',
    program: 'language',
    cadence: 'daily',
    provenance: { source: 'hand-authored', author: 'parent', reviewState: 'approved' },
    ...over,
  });

  it('accepts a valid daily program unit and normalizes program + cadence', () => {
    const { errors, unit } = validateUnit(programUnit(), refs());
    expect(errors).toEqual([]);
    expect(unit.program).toBe('language');
    expect(unit.cadence).toBe('daily');
  });
  it('defaults cadence to once when omitted', () => {
    const { unit } = validateUnit(programUnit({ cadence: undefined }), refs());
    expect(unit.cadence).toBe('once');
  });
  it('rejects an unknown program id', () => {
    const { errors } = validateUnit(programUnit({ program: 'chess' }), refs());
    expect(errors.some((e) => e.includes("program 'chess' not found"))).toBe(true);
  });
  it('rejects program combined with any other composition', () => {
    for (const extra of [{ bank: 'math-fractions' }, { document: 'math-fractions-01-ws' }, { media: 'liberty-kids-01' }]) {
      const { errors } = validateUnit(programUnit(extra), refs());
      expect(errors.some((e) => e.includes('program is exclusive'))).toBe(true);
    }
  });
  it('rejects passing/retry/review/reward on a program unit', () => {
    for (const extra of [{ passing: { percent: 80 } }, { retry: { variants: 2 } }, { review: 'rubric' }, { reward: { amount: 5 } }]) {
      const { errors } = validateUnit(programUnit(extra), refs());
      expect(errors.length).toBeGreaterThan(0);
    }
  });
  it('rejects courseId/sequence on a program unit', () => {
    const { errors } = validateUnit(programUnit({ courseId: 'c', sequence: 1 }), refs());
    expect(errors.length).toBeGreaterThan(0);
  });
  it('rejects cadence daily on a non-program unit', () => {
    const { errors } = validateUnit(valid({ cadence: 'daily' }), refs());
    expect(errors.some((e) => e.includes('cadence'))).toBe(true);
  });
  it('multi-composition NON-program units stay legal (media + bank)', () => {
    const { errors } = validateUnit(valid({ document: undefined, media: 'liberty-kids-01', bank: 'math-fractions' }), refs());
    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail** (`... run tests/isolated/domain/school/curriculum/unitValidation.test.mjs`)

- [ ] **Step 3: Implement in `unitValidation.mjs`**

- Export `const CADENCES = Object.freeze(['daily', 'once']);`
- In `validateUnit`, after the existing reference resolution: resolve `raw.program` against `sets.programIds` exactly the way `RESOLVABLE_REFS` entries resolve (`program 'x' not found` on a miss) — but do NOT add it to `RESOLVABLE_REFS` (its exclusivity rules differ; handle it explicitly).
- When `program` is present: push an error `'program is exclusive — remove bank/document/media'` if any of `bank`/`document`/`media` is present; push errors when `passing`, `retry`, `review`, `reward`, `courseId`, or `sequence` are present (`'a program unit takes no passing'` etc. — one clear error each). Validate `cadence` against `CADENCES`, default `'once'`.
- When `program` is absent: a present `cadence` other than undefined is an error (`'cadence is only meaningful on a program unit'`).
- A program unit satisfies the "must reference at least one of…" rule — extend that check's field list to include `program`.
- Add `program: references.program` (or the validated value) and `cadence` to the normalized `unit` object; both `undefined` for non-program units except `cadence` which is `'once'` only when `program` is present.
- Do not touch `passing` defaulting for non-program units.

- [ ] **Step 4: Run the whole curriculum test dir**

Run: `node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run tests/isolated/domain/school/curriculum/`
Expected: PASS (old tests prove multi-composition units unaffected).

- [ ] **Step 5: Also verify the two callers still pass** — `validateUnit` is called by `CurriculumAccess.mjs:86` and `ValidateCatalog.mjs:121`; both pass a `sets` object. Grep both, and thread a `programIds` set into each: they build `sets` from datastore listings — add `programIds: new Set(programIds ?? [])` taken from a new constructor/execute option (default empty set; composition supplies real ids in Task 12). Run: `node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run tests/isolated/application/school/` — expected PASS (empty set means no program units in old fixtures; nothing changes).

- [ ] **Step 6: Commit** (`feat(school): program unit kind in curriculum validation`)

---

### Task 3: Planner passes program units through

**Files:**
- Modify: `backend/src/2_domains/school/planner.mjs`
- Test: `tests/isolated/domain/school/planner.test.mjs` (extend — find it with `ls tests/isolated/domain/school/`; if the planner tests live elsewhere, `grep -rln planLearnerWork tests/`)

**Interfaces:**
- Consumes: normalized units now possibly carrying `program`/`cadence` (Task 2).
- Produces: plan entries carry `program: string|null` and `cadence: string|null`; a program unit's entry is ALWAYS `status: 'available'` (never locked — it has no courseId; never completed — no session ever passes it), with `sessionId: null, state: null`.

- [ ] **Step 1: Write the failing test**

```js
it('a program unit flows through: always available, never locked or completed', () => {
  const units = [
    { unitId: 'language-daily', title: 'Language', subject: 'language', program: 'language', cadence: 'daily' },
  ];
  const plan = planLearnerWork({
    learnerId: 'felix',
    assignment: { units: ['language-daily'] },
    units,
    sessions: [],
    now: '2026-07-29T16:00:00Z',
  });
  expect(plan.entries).toHaveLength(1);
  expect(plan.entries[0]).toMatchObject({
    unitId: 'language-daily', status: 'available', program: 'language', cadence: 'daily',
    sessionId: null, lockReason: null,
  });
});
```

- [ ] **Step 2: Run to verify failure** (entry lacks `program`/`cadence` keys → `toMatchObject` fails)

- [ ] **Step 3: Implement** — in the entry construction inside `planLearnerWork` (`planner.mjs:179-193`), add `program: unit.program ?? null, cadence: unit.cadence ?? null`. Guard the status derivation: `if (isNonEmptyString(unit.program)) { status stays 'available'; skip passedUnits/open/blocker checks }` — program units have no sessions and no course, so the existing logic would already yield `available`, but make it explicit so a stray session against that unitId can never mark a daily program `in_progress` or `completed`.

- [ ] **Step 4: Run planner tests** — expected PASS.

- [ ] **Step 5: Commit** (`feat(school): planner carries program units — always available`)

---

### Task 4: `subject_next` token class

**Files:**
- Modify: `backend/src/2_domains/school/sessions/tokens.mjs`
- Test: `tests/isolated/domain/school/sessions/tokens.test.mjs` (extend; locate via `grep -rln mintToken tests/isolated/domain`)

**Interfaces:**
- Produces: `mintToken({ tokenClass: 'subject_next', subject: { learnerId, subject }, at, rng, expiresAt })` mints; `resolveTokenState(record, { now })` for this class returns `actionable` with NO sessionState (expiry and revocation still enforced). Tasks 10 and 11 rely on exactly this.

- [ ] **Step 1: Write the failing tests**

```js
describe('subject_next tokens', () => {
  const at = '2026-07-29T16:00:00Z';
  const rng = () => 0.5;
  it('mints with a learnerId + subject and no session', () => {
    const rec = mintToken({
      tokenClass: 'subject_next',
      subject: { learnerId: 'felix', subject: 'math' },
      at, rng, expiresAt: '2026-08-05T16:00:00Z',
    });
    expect(rec.token.startsWith('sch:')).toBe(true);
    expect(rec.subject).toEqual({ learnerId: 'felix', subject: 'math' });
  });
  it('requires learnerId and subject', () => {
    expect(() => mintToken({ tokenClass: 'subject_next', subject: { learnerId: 'felix' }, at, rng }))
      .toThrow(/subject/);
    expect(() => mintToken({ tokenClass: 'subject_next', subject: { subject: 'math' }, at, rng }))
      .toThrow(/learnerId/);
  });
  it('resolves actionable without any sessionState', () => {
    const rec = mintToken({ tokenClass: 'subject_next', subject: { learnerId: 'felix', subject: 'math' }, at, rng, expiresAt: '2026-08-05T16:00:00Z' });
    expect(resolveTokenState(rec, { now: '2026-07-30T16:00:00Z' }).status).toBe('actionable');
  });
  it('still expires', () => {
    const rec = mintToken({ tokenClass: 'subject_next', subject: { learnerId: 'felix', subject: 'math' }, at, rng, expiresAt: '2026-07-30T16:00:00Z' });
    expect(resolveTokenState(rec, { now: '2026-08-01T00:00:00Z' }).status).toBe('expired');
  });
});
```

- [ ] **Step 2: Run to verify failure** (`unknown token class: subject_next`)

- [ ] **Step 3: Implement in `tokens.mjs`**

- Add `'subject_next'` to `TOKEN_CLASSES`.
- In `mintToken`, replace the `identify`-vs-everything-else subject check with a three-way: `identify` (unchanged), `subject_next` (requires `subject.learnerId` AND `subject.subject`, both non-empty strings; expiry allowed), everything else (requires `sessionId`, unchanged).
- Add `SEMANTICS.subject_next = { actionable: () => true, doneMessage: () => 'Scan your card for a fresh list.', readyMessage: 'Finding the next thing for you.' }`.
- In `resolveTokenState`, after the expiry check, short-circuit `subject_next` to `actionable` BEFORE the `!sessionState → unknown` guard (mirror the `identify` short-circuit but keep it below expiry — subject tokens do expire, identify never does).

- [ ] **Step 4: Run tokens tests + the full domain school dir** — expected PASS.

- [ ] **Step 5: Commit** (`feat(school): subject_next token class — sessionless, expiring`)

---

### Task 5: `planDailyAgenda` — the sectioned daily plan (pure domain)

**Files:**
- Create: `backend/src/2_domains/school/agenda.mjs`
- Test: `tests/isolated/domain/school/agenda.test.mjs`

**Interfaces:**
- Consumes: `planLearnerWork` output entries (with `program`/`cadence` from Task 3), `isSameStudyDay` (Task 1).
- Produces:

```js
planDailyAgenda({
  plan,                 // planLearnerWork() result
  sessions,             // [{ sessionId, unitId, state, terminal, outcome: {result, at}|null, gradedPercent: number|null, updatedAt }]
  programStatuses,      // { [programId]: { doneToday, progressLabel, score } | { error: true } }
  now,                  // ISO string
  timezone,             // IANA or null
  boundaryHour = 4,
}) → {
  sections: [{
    subject,            // one of SUBJECT_IDS, or 'other'
    servedToday,        // boolean
    next,               // a plan entry or null (null when served/locked/empty)
    lockedRemedy,       // string|null — printed when every entry is locked
    progressLabel,      // string|null
    gradePercent,       // integer 0-100 | null
    programUnavailable, // boolean — a launcher errored for this subject
  }],
}
```
Section order: `SUBJECT_IDS` order (import from `#domains/school/curriculum/unitValidation.mjs`), then `'other'`. Only subjects with ≥1 plan entry appear. Tasks 10/11 consume this exact shape.

- [ ] **Step 1: Write the failing tests** — cover every rule; these are the heart of the feature:

```js
import { describe, it, expect } from 'vitest';
import { planDailyAgenda } from '#domains/school/agenda.mjs';

const NOW = '2026-07-29T16:00:00Z'; // 09:00 PDT
const TZ = 'America/Los_Angeles';
const entry = (over) => ({
  unitId: 'u1', title: 'Unit One', subject: 'math', courseId: 'c', sequence: 1,
  elective: false, status: 'available', sessionId: null, state: null,
  lockReason: null, remedy: null, unlocks: null, program: null, cadence: null, ...over,
});
const plan = (entries) => ({ entries, errors: [] });
const args = (over = {}) => ({ plan: plan([]), sessions: [], programStatuses: {}, now: NOW, timezone: TZ, ...over });

describe('planDailyAgenda', () => {
  it('groups by subject in the nine-subject order, then other', () => {
    const { sections } = planDailyAgenda(args({ plan: plan([
      entry({ unitId: 'a', subject: 'language' }),
      entry({ unitId: 'b', subject: 'math' }),
      entry({ unitId: 'c', subject: null }),
    ]) }));
    expect(sections.map((s) => s.subject)).toEqual(['math', 'language', 'other']);
  });

  it('servedToday on a PASSING outcome this study day — and picks no next', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'u1', status: 'completed' }), entry({ unitId: 'u2', sequence: 2 })]),
      sessions: [{ sessionId: 's1', unitId: 'u1', state: 'closed', terminal: true,
        outcome: { result: 'passed', at: '2026-07-29T15:00:00Z' }, gradedPercent: 90, updatedAt: '2026-07-29T15:00:00Z' }],
    }));
    expect(sections[0].servedToday).toBe(true);
    expect(sections[0].next).toBeNull();
  });

  it('a FAILED outcome today does NOT serve — the retry stays offered', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'u1', status: 'in_progress', sessionId: 's1', state: 'outcome_recorded' })]),
      sessions: [{ sessionId: 's1', unitId: 'u1', state: 'outcome_recorded', terminal: false,
        outcome: { result: 'needs_remediation', at: '2026-07-29T15:00:00Z' }, gradedPercent: 40, updatedAt: '2026-07-29T15:00:00Z' }],
    }));
    expect(sections[0].servedToday).toBe(false);
    expect(sections[0].next.unitId).toBe('u1');
  });

  it("yesterday's pass does not serve today (1am boundary honoured)", () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'u1', status: 'completed' }), entry({ unitId: 'u2', sequence: 2 })]),
      // 2026-07-29T08:00Z = 1am PDT → previous study day
      sessions: [{ sessionId: 's1', unitId: 'u1', state: 'closed', terminal: true,
        outcome: { result: 'passed', at: '2026-07-29T08:00:00Z' }, gradedPercent: 90, updatedAt: '2026-07-29T08:00:00Z' }],
    }));
    expect(sections[0].servedToday).toBe(false);
    expect(sections[0].next.unitId).toBe('u2');
  });

  it('program doneToday serves its subject; progressLabel comes from the launcher', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'language-daily', subject: 'language', courseId: null, sequence: null, program: 'language', cadence: 'daily' })]),
      programStatuses: { language: { doneToday: true, progressLabel: 'Day 61', score: null } },
    }));
    expect(sections[0]).toMatchObject({ subject: 'language', servedToday: true, next: null, progressLabel: 'Day 61' });
  });

  it('a launcher error marks the section unavailable without touching others', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([
        entry({ unitId: 'language-daily', subject: 'language', courseId: null, sequence: null, program: 'language', cadence: 'daily' }),
        entry({ unitId: 'm1', subject: 'math' }),
      ]),
      programStatuses: { language: { error: true } },
    }));
    const lang = sections.find((s) => s.subject === 'language');
    expect(lang.programUnavailable).toBe(true);
    expect(lang.next).toBeNull();
    expect(sections.find((s) => s.subject === 'math').next.unitId).toBe('m1');
  });

  it('next = first in_progress, else first available; all-locked yields the remedy line', () => {
    const { sections } = planDailyAgenda(args({ plan: plan([
      entry({ unitId: 'u2', sequence: 2, status: 'locked', lockReason: 'Finish “Unit One” first',
        remedy: { unitId: 'u1', title: 'Unit One', action: 'start' } }),
    ]) }));
    expect(sections[0].next).toBeNull();
    expect(sections[0].lockedRemedy).toBe('Finish “Unit One” first');
  });

  it('progress: single course → Unit N of M; complete → Course complete; multi-course → x of y done', () => {
    const single = planDailyAgenda(args({ plan: plan([
      entry({ unitId: 'u1', status: 'completed' }), entry({ unitId: 'u2', sequence: 2 }),
      entry({ unitId: 'u3', sequence: 3 }), entry({ unitId: 'u4', sequence: 4 }),
    ]) }));
    expect(single.sections[0].progressLabel).toBe('Unit 2 of 4');
    const done = planDailyAgenda(args({ plan: plan([entry({ unitId: 'u1', status: 'completed' })]) }));
    expect(done.sections[0].progressLabel).toBe('Course complete');
    const multi = planDailyAgenda(args({ plan: plan([
      entry({ unitId: 'a1', courseId: 'a', status: 'completed' }),
      entry({ unitId: 'b1', courseId: 'b' }),
    ]) }));
    expect(multi.sections[0].progressLabel).toBe('1 of 2 done');
  });

  it('grade: mean of latest gradedPercent per attempted unit, program score blended; no evidence → null', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'u1', status: 'completed' }), entry({ unitId: 'u2', sequence: 2 })]),
      sessions: [
        { sessionId: 's0', unitId: 'u1', state: 'closed', terminal: true,
          outcome: { result: 'needs_remediation', at: '2026-07-20T15:00:00Z' }, gradedPercent: 40, updatedAt: '2026-07-20T15:00:00Z' },
        { sessionId: 's1', unitId: 'u1', state: 'closed', terminal: true,
          outcome: { result: 'passed', at: '2026-07-21T15:00:00Z' }, gradedPercent: 90, updatedAt: '2026-07-21T15:00:00Z' },
      ],
    }));
    expect(sections[0].gradePercent).toBe(90); // latest attempt only, u2 unattempted is NOT a zero
    const none = planDailyAgenda(args({ plan: plan([entry({})]) }));
    expect(none.sections[0].gradePercent).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** (module does not exist)

- [ ] **Step 3: Implement `backend/src/2_domains/school/agenda.mjs`** — pure, no I/O, no clock reads. Import `SUBJECT_IDS` from `../curriculum/unitValidation.mjs` (SAME layer — legal) and `isSameStudyDay` from `./studyDay.mjs`. Sketch:

```js
export function planDailyAgenda({ plan, sessions = [], programStatuses = {}, now, timezone = null, boundaryHour = 4 } = {}) {
  const nowMs = Date.parse(now ?? '');
  const entries = (plan?.entries ?? []).filter((e) => e && typeof e === 'object');
  const order = [...SUBJECT_IDS, 'other'];
  const bySubject = new Map();
  entries.forEach((e) => {
    const key = order.includes(e.subject) ? e.subject : 'other';
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(e);
  });

  const latestBySessionUnit = latestGradedPerUnit(sessions); // Map unitId → { gradedPercent, outcome }
  const passedToday = new Set(sessions
    .filter((s) => s.outcome?.result === 'passed'
      && isSameStudyDay(Date.parse(s.outcome.at ?? s.updatedAt ?? ''), nowMs, { timezone, boundaryHour }))
    .map((s) => s.unitId));

  const sections = order.filter((s) => bySubject.has(s)).map((subject) => {
    const list = bySubject.get(subject);
    const programs = list.filter((e) => e.program);
    const statuses = programs.map((e) => programStatuses[e.program]).filter(Boolean);
    const programUnavailable = statuses.some((s) => s.error === true);
    const programDone = statuses.some((s) => !s.error && s.doneToday === true);
    const servedToday = list.some((e) => passedToday.has(e.unitId)) || programDone;

    let next = null;
    if (!servedToday && !programUnavailable) {
      next = list.find((e) => e.status === 'in_progress')
        ?? list.find((e) => e.status === 'available')
        ?? null;
    }
    const lockedRemedy = (!servedToday && !next && list.some((e) => e.status === 'locked'))
      ? (list.find((e) => e.status === 'locked')?.lockReason ?? null)
      : null;

    return {
      subject, servedToday, next, lockedRemedy,
      progressLabel: progressLabelFor(list, statuses),
      gradePercent: gradeFor(list, latestBySessionUnit, statuses),
      programUnavailable,
    };
  });
  return { sections };
}
```

`latestGradedPerUnit`: for each unitId keep the session whose `outcome.at ?? updatedAt` is greatest AND `gradedPercent != null`. `progressLabelFor`: curriculum entries (non-program) with one distinct courseId → `Unit {min(passed+1,total)} of {total}` (`passed` = entries with status `completed`), all passed → `'Course complete'`; multiple courseIds or standalone mix → `` `${passed} of ${total} done` ``; no curriculum entries → first program status's `progressLabel ?? null`. `gradeFor`: collect latest `gradedPercent` per attempted curriculum unit + each non-error program `score * 100`; mean rounded, or null when empty.

- [ ] **Step 4: Run agenda tests + full `tests/isolated/domain/school/`** — expected PASS.

- [ ] **Step 5: Commit** (`feat(school): planDailyAgenda — sectioned daily plan, pure domain`)

---

### Task 6: Sessions projection carries `gradedPercent`

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlWorkSessionDatastore.mjs` (`listForLearner`, line ~209)
- Test: extend the datastore's existing test (`grep -rln listForLearner tests/`)

**Interfaces:**
- Produces: each derived fact from `listForLearner` additionally carries `gradedPercent: number|null` (from `reduceSession`'s `state.gradedPercent`) and keeps `outcome` (which already has `{ result, at }`). Tasks 5 and 10 consume it.

- [ ] **Step 1: Write the failing test** — append events including `graded` with `percent: 85` and `outcome_recorded`, then assert `listForLearner` returns `gradedPercent: 85` on that fact. Mirror the file's existing test arrangement exactly (read it first).
- [ ] **Step 2: Run — expect FAIL** (`gradedPercent` undefined).
- [ ] **Step 3: Implement** — `listForLearner` builds its facts from `reduceSession(events)`; add `gradedPercent: state.gradedPercent ?? null` to the projected object. If a `VirtualWorkSession`-style double or `lifecycleFakes.mjs` `FakeSessionRepository` mirrors this projection, update it identically (grep `#testlib/school/lifecycleFakes.mjs` for `listForLearner`).
- [ ] **Step 4: Run the datastore + application school suites** — expected PASS.
- [ ] **Step 5: Commit** (`feat(school): session projection carries gradedPercent`)

---

### Task 7: `agendaDocument` v2 — sectioned receipt

**Files:**
- Modify: `backend/src/2_domains/school/documents/receipts.mjs`
- Test: `tests/isolated/domain/school/documents/receipts.test.mjs` (extend; locate via `grep -rln agendaDocument tests/`)

**Interfaces:**
- Consumes: `planDailyAgenda` sections (Task 5).
- Produces: `agendaDocument({ learnerId, learnerName, generatedAt, timeZone, sections, tokensBySubject, footer })` where `tokensBySubject = { math: 'sch:…' }`. Emits per section, in order:
  - `rich_text` `## MATH — Unit 2 of 4` (subject upper-cased; ` — done today` suffix when served; ` — {progressLabel}` otherwise when present)
  - `rich_text` `Grade so far: 88%` (only when `gradePercent != null`)
  - served → nothing more; `programUnavailable` → `rich_text` `Not answering right now — try it on the Portal.`; `lockedRemedy` → `rich_text` of it; `next` + token → `scan_action { action, label }` with label `"{title} — {actionLabel}"` (the entry's `actionLabel`, see Task 10); `next` without a token → the label as `rich_text`.
  - The old flat-entries signature is REPLACED — callers are BuildAgenda (Task 10) and its tests only (`grep -rn 'agendaDocument(' backend frontend tests`). Keep `noticeDocument`/`resultDocument` untouched. Keep the empty case: no sections → the existing "Nothing is assigned right now" line.
  - ASCII rule: no `✓` — the served suffix is the words `done today`.

- [ ] **Step 1: Write failing tests** — build two sections (one served language section with `progressLabel 'Day 61'`, one live math section with grade 88 and a `next` entry) plus `tokensBySubject`, call `agendaDocument`, and assert: block sequence types `['rich_text' (name), 'rich_text' (printed at), 'rich_text' (## MATH…), 'rich_text' (grade), 'scan_action', 'rich_text' (## LANGUAGE — done today…), 'rich_text' (footer)]`; the scan_action's `action` is the math token; the string `✓` appears nowhere in any `md`. Also: empty sections → "Nothing is assigned" text; result passes `validateDocument` from `#domains/school/documents/documentValidation.mjs`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — rewrite the entry loop into a section loop per the contract above. Reuse `formatPrintedAt`, `slugify`, `receipt` helpers unchanged.
- [ ] **Step 4: Run the documents test dir — PASS.** (BuildAgenda tests will break — that is Task 10's job; run only `tests/isolated/domain/school/documents/` here.)
- [ ] **Step 5: Commit** (`feat(school): sectioned agenda document`)

---

### Task 8: Extract the session-offer helper

**Files:**
- Create: `backend/src/3_applications/school/usecases/offerSession.mjs`
- Modify: `backend/src/3_applications/school/usecases/BuildAgenda.mjs` (use the helper; NO behavior change yet)
- Test: existing `tests/isolated/application/school/buildAgenda.test.mjs` must stay green untouched.

**Interfaces:**
- Produces:

```js
// offerSession.mjs
export function agendaLabel(unit, state, fallback) { /* MOVED verbatim from BuildAgenda.mjs:43-62 */ }

/** Ensure the entry has a session; reuse an open one, create otherwise. */
export async function ensureSession({ entry, learnerId, nowIso, sessions, newSessionId }) →
  { sessionId, state /* reduceSession result */, created: boolean }

/** The state-and-composition decision: what acting on this entry means NOW. */
export function nextMove(unit, state) →
  { kind: 'print'|'play'|'screen'|'wait'|'nothing', tokenClass: string|null, label: string }
```

`nextMove` rules (this is the routing table Task 11 depends on — implement exactly):
- state `created`: unit.media → `play`/`select_unit`; else unit.document → `print`/`select_unit`; else unit.bank → `screen`/`select_unit`; else `nothing`.
- state `media_completed`: unit.document → `print`/`issue_document`; unit.bank → `screen`/null; else `wait`.
- state `media_stalled` → `play`/`media_action`. state `media_dispatched` → `wait` (label: `finish watching, then scan your card`).
- state `outcome_recorded` + outcome `needs_remediation` → `print`/`remediation` (label `try again with a fresh sheet`).
- anything else → `wait` with the reducer's `nextAction?.label` fallback.
- `label` uses the same wording `agendaLabel` produces today (they share the strings — build `agendaLabel` ON `nextMove` so there is one table: `agendaLabel = (unit, state, fallback) => nextMove-derived label ?? fallback`).

- [ ] **Step 1: Extract** — move the label logic and the session-ensure block (`BuildAgenda.mjs:163-196`'s session part) into `offerSession.mjs`; BuildAgenda's `#offerFor` becomes a thin caller: `ensureSession` → `nextMove` → mint per-unit token as today. Import `reduceSession`/`createEvent` into the helper (moves with the code).
- [ ] **Step 2: Run** `node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run tests/isolated/application/school/` — expected PASS, zero test edits. If a test fails, the extraction changed behavior: fix the extraction, not the test.
- [ ] **Step 3: Commit** (`refactor(school): extract ensureSession/nextMove from BuildAgenda`)

---

### Task 9: `IProgramLauncher` port, PortalDispatch, and the language launcher

**Files:**
- Create: `backend/src/3_applications/school/ports/IProgramLauncher.mjs`
- Create: `backend/src/3_applications/school/PortalDispatch.mjs`
- Create: `backend/src/3_applications/school/LanguageProgramLauncher.mjs`
- Modify: `backend/src/3_applications/school/LanguageStudyService.mjs` (add `todayStatus({ userId })`)
- Test: `tests/isolated/application/school/programLaunchers.test.mjs`

**Interfaces:**
- Produces:

```js
// IProgramLauncher.mjs — documentation-only port, same style as IProgramReporter.mjs (read it, mirror it)
// id: string
// launch({ userId }) → Promise<{ dispatched: boolean }>
// status({ userId }) → Promise<{ doneToday: boolean, progressLabel: string|null, score: number|null }>

// PortalDispatch.mjs
export class PortalDispatch {
  constructor({ eventBus, logger });                 // eventBus optional → dispatched:false
  launch({ learnerId, target }) → { dispatched: boolean }
  // broadcasts eventBus.broadcast('school', { type: 'school.launch', learnerId, target })
  // target: { kind: 'bank', bankId, unitId, sessionId } | { kind: 'program', program }
}

// LanguageProgramLauncher.mjs
export class LanguageProgramLauncher {
  constructor({ languageStudyService, portal, logger }); // portal = PortalDispatch
  id = 'language';
  async status({ userId })  // → from languageStudyService.todayStatus({ userId })
  async launch({ userId })  // → portal.launch({ learnerId: userId, target: { kind: 'program', program: 'language' } })
}
```

`LanguageStudyService.todayStatus({ userId })`: derive today's queue the way the service's existing day methods do (find the method that computes `summary: summarizeQueue(queue)` around line 218 and reuse its internal derivation — do NOT duplicate the queue math; extract a private helper if needed). Return `{ doneToday: queue length > 0 && every rung item completed (summary.remaining === 0 — read summarizeQueue for the exact field name), progressLabel: 'Day {dayIndex}' from the same derivation, score: null }`. If the user has no corpus/progress at all → `{ doneToday: false, progressLabel: null, score: null }`.

- [ ] **Step 1: Write failing tests** — PortalDispatch with a fake bus (`{ broadcast: vi.fn() }`) asserting topic `'school'` and payload shape; `dispatched: false` with no bus. LanguageProgramLauncher with a stub service (`todayStatus` returns a canned value) asserting pass-through and that `launch` calls portal with the program target. `todayStatus` itself: use the service's existing test arrangement (read `LanguageStudyService.test.mjs` and reuse its fixture datastore setup) — one test: a day fully completed → `doneToday: true`; a fresh day → `false` with a `Day N` label.
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement.** **Step 4: Run + full application/school suite — PASS.**
- [ ] **Step 5: Commit** (`feat(school): program launcher port, portal dispatch, language launcher`)

---

### Task 10: BuildAgenda v2 — sections, subject tokens

**Files:**
- Modify: `backend/src/3_applications/school/usecases/BuildAgenda.mjs`
- Modify: `tests/isolated/application/school/buildAgenda.test.mjs` (update expectations to sections)

**Interfaces:**
- Consumes: `planDailyAgenda` (Task 5), `agendaDocument` v2 (Task 7), `ensureSession`/`nextMove` (Task 8), launcher registry (Task 9), `subject_next` minting (Task 4).
- Produces: `new BuildAgenda({ curriculum, assignments, sessions, tokens, launchers = new Map(), timezone = null, clock, rng, newSessionId, tokenTtlHours, subjectTokenTtlHours = 168, logger })`. `execute({ learnerId, learnerName })` returns `{ learnerId, plan, sections, offers, createdSessions, document }` where `offers` = one record per unserved section `{ subject, unitId, sessionId: string|null, token, tokenClass: 'subject_next', label }` (ResolvePersonalCard only reads `offers.length` — verified — but keep the shape informative).

Behavior:
1. Guest path unchanged (notice document).
2. Fetch assignment/units/history as today; run `planLearnerWork`.
3. `programStatuses`: for each DISTINCT `program` id among plan entries, call `launchers.get(id)?.status({ userId: learnerId })` in its own try/catch → `{ error: true }` on throw or missing launcher (log `school.agenda.launcher-failed`).
4. `planDailyAgenda({ plan, sessions: history, programStatuses, now: nowIso, timezone })`.
5. For each section with a `next` that is a CURRICULUM entry (`!next.program`): `ensureSession` (collect `createdSessions`), then `nextMove(unit, state)` to compose the printed label (`"{title} — {label}"`). Program `next` needs NO session; label `"{title} — on the Portal"`.
6. Mint ONE `subject_next` token per section with a `next` (TTL `subjectTokenTtlHours`), subject `{ learnerId, subject: section.subject }`.
7. `agendaDocument({ learnerId, learnerName, generatedAt, timeZone: timezone, sections, tokensBySubject, footer })`.
8. Per-unit tokens are no longer minted at agenda time (the subject token replaces them; per-unit classes still exist for sheets/results).

- [ ] **Step 1: Rewrite the tests** — keep the fakes/fixtures; assert: sections grouped and ordered; one `sch:` token per live subject registered in the FakeTokenRegistry with `tokenClass 'subject_next'`; re-execute reuses open sessions (no duplicate `created` events — the existing idempotency test adapts); served subject (seed a passed-today session via `fakeClock`) mints no token; launcher `{error:true}` path prints the unavailable line and still yields other subjects; guest path unchanged; document passes `validateDocument`.
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement per the contract.** **Step 4: Run full `tests/isolated/application/school/` — PASS** (ResolvePersonalCard tests must stay green — it consumes `offers` and `document` only).
- [ ] **Step 5: Commit** (`feat(school): BuildAgenda v2 — daily sections with subject_next QRs`)

---

### Task 11: Resolving a subject scan

**Files:**
- Create: `backend/src/3_applications/school/usecases/ResolveSubjectNext.mjs`
- Modify: `backend/src/3_applications/school/usecases/ResolveScanAction.mjs`
- Test: `tests/isolated/application/school/resolveSubjectNext.test.mjs` + extend the existing ResolveScanAction test file (`grep -rln ResolveScanAction tests/`)

**Interfaces:**
- Consumes: everything Task 10 consumes (same computation, second caller) + `PortalDispatch`.
- Produces:

```js
// ResolveSubjectNext.mjs — computes, does not print
new ResolveSubjectNext({ curriculum, assignments, sessions, launchers, timezone, clock, newSessionId, logger })
execute({ learnerId, subject }) → one of:
  { kind: 'served',   subjectLabel }                    // done today
  { kind: 'locked',   remedy }                          // all locked
  { kind: 'empty' }                                     // nothing in this subject
  { kind: 'unavailable' }                               // launcher error
  { kind: 'move', move: {kind,label,tokenClass}, sessionId, unit, entry }  // curriculum next (session ensured here)
  { kind: 'program',  programId, unit }                 // program next
```

`ResolveScanAction` changes:
- Constructor gains `resolveSubjectNext`, `portal` (PortalDispatch), `launchers` (Map). All required when wired; the composition passes them (Task 12).
- `execute`: the early session lookup treats `subject_next` like `identify` (no sessionId — `record?.tokenClass === 'identify' || record?.tokenClass === 'subject_next'`).
- New switch case `'subject_next'` → `#subjectNext(record)`:

```js
async #subjectNext(record) {
  const { learnerId, subject } = record.subject ?? {};
  const r = await this.#subjectResolver.execute({ learnerId, subject });
  const nice = (s) => s ? s[0].toUpperCase() + s.slice(1) : 'That';
  if (r.kind === 'served') return this.#slip({ status: 'served_today', tokenClass: 'subject_next', id: `served-${subject}`,
    headline: `${nice(subject)} is done for today`, lines: ['Nice work — scan your card tomorrow.'],
    message: 'Done for today.' });
  if (r.kind === 'locked') return this.#slip({ status: 'locked', tokenClass: 'subject_next', id: `locked-${subject}`,
    headline: 'Not open yet', lines: [r.remedy ?? 'Finish the earlier work first.'], message: r.remedy ?? 'Locked.' });
  if (r.kind === 'empty' || r.kind === 'unavailable') return this.#slip({ status: r.kind, tokenClass: 'subject_next',
    id: `${r.kind}-${subject}`, headline: 'Nothing to hand out',
    lines: ['Try it on the Portal, or ask a grown-up.'], message: 'Nothing to hand out.' });
  if (r.kind === 'program') {
    const launcher = this.#launchers.get(r.programId);
    let dispatched = false;
    try { dispatched = (await launcher?.launch({ userId: learnerId }))?.dispatched === true; }
    catch (e) { this.#logger.warn?.('school.scan.launch-failed', { programId: r.programId, error: e.message }); }
    return this.#slip({ status: dispatched ? 'launched' : 'launch_unconfirmed', tokenClass: 'subject_next',
      id: `launch-${r.programId}`, headline: r.unit?.title ?? nice(subject),
      lines: [dispatched ? 'Starting on the Portal — or open it there yourself.' : 'Go to the Portal and open it there.'],
      message: 'Off to the Portal.' });
  }
  // r.kind === 'move' — act through the existing helpers
  if (r.move.kind === 'print') return this.#print(r.sessionId, 'subject_next', reduce-again-or-pass-state);
  if (r.move.kind === 'play')  return this.#play(r.sessionId);
  if (r.move.kind === 'screen') return this.#onScreen(r.sessionId, r.unit, 'subject_next');
  return this.#slip({ status: 'wait', tokenClass: 'subject_next', id: `wait-${r.sessionId}`,
    headline: r.unit?.title ?? 'Keep going', lines: [r.move.label], message: r.move.label });
}
```

- `#onScreen` additionally broadcasts the Portal launch (spec §4.3) and keeps printing the fallback slip: `this.#portal.launch({ learnerId, target: { kind: 'bank', bankId: unit.bank, unitId: unit.unitId, sessionId } })` — learnerId comes from the session state (`reduceSession` exposes `learnerId`; verify the field on the derived state and thread it — `#start`/`#print` already hold `sessionState`). Change the slip line to `'Starting on the school screen — or open it there yourself.'`. Update the existing `#onScreen` tests accordingly.

- [ ] **Step 1: Write failing tests.** ResolveSubjectNext: served → `served`; failed-today (`needs_remediation` outcome today, session `outcome_recorded`) → `move` with `move.kind 'print'` and tokenClass `'remediation'` label semantics (the fresh-sheet path); a `media`+`bank` unit whose session is `media_completed` → `move.kind 'screen'` (NEVER 'play' — pin this); program subject → `program`. ResolveScanAction: scanning a subject token routes each kind to the right physical outcome using the existing fakes (assert printed slips via the fake receipts, and portal broadcasts via a fake PortalDispatch `{ launch: vi.fn(() => ({dispatched:true})) }`); a subject token needs no session to resolve (regression for the early-lookup skip).
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement.** **Step 4: Run full application/school — PASS.**
- [ ] **Step 5: Commit** (`feat(school): subject_next scan resolution — state-aware routing, portal launch`)

---

### Task 12: ESC/POS QR + `##` headers + composition wiring

**Files:**
- Modify: `backend/src/1_rendering/school/documents/DocumentEscPosRenderer.mjs`
- Modify: `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs`
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs`
- Modify: `backend/src/app.mjs` (pass `languageStudyService` into `createSchoolLifecycle`)
- Test: extend the ESC/POS renderer test (`grep -rln DocumentEscPosRenderer tests/`) + `tests/isolated/adapter/` thermal test if one exists (`grep -rln processItem tests/ backend`), else assert via the renderer + virtual adapter.

**Interfaces:**
- Produces: `createDocumentEscPosRenderer({ width, symbology: 'QR' })` emits `{ type: 'qrcode', content, label }` items for `scan_action`; `##` lines emit `{ type: 'text', content, align: 'left', style: { bold: true } }` (NO `size`); `#` unchanged (centered, double). `ThermalPrinterAdapter.#processItem` handles `case 'qrcode'`.

Implementation details:
- Renderer: in the `rich_text` loop, distinguish `line.startsWith('## ')` (bold-left-normal) from other `#` headings (existing behavior) BEFORE the generic heading branch. For `scan_action` with `symbology === 'QR'` emit `qrcode` items; any other symbology keeps `barcode`.
- Adapter `#processQrcodeItem(item)` — ESC/POS model-2 QR, mirroring `#processBarcodeItem`'s alignment/centering conventions (read it first). Byte sequences (data = `Buffer.from(String(item.content), 'ascii')`, `len = data.length + 3`):

```js
const pL = len & 0xff, pH = (len >> 8) & 0xff;
Buffer.concat([
  Buffer.from([0x1B, 0x61, 0x01]),                          // center
  Buffer.from([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]), // model 2
  Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x08]),       // module size 8
  Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31]),       // EC level M
  Buffer.from([0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30]), data,     // store
  Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]),       // print
  Buffer.from([0x1B, 0x61, 0x00]),                          // back to left
])
```

Print the human-readable `item.label` as a text line after the symbol the way barcode does (check `#processBarcodeItem` for the label convention and mirror it).
- Composition (`schoolLifecycle.mjs`): accept `languageStudyService = null` dep; build `const portal = new PortalDispatch({ eventBus, logger })`; `const launchers = new Map(languageStudyService ? [['language', new LanguageProgramLauncher({ languageStudyService, portal, logger })]] : [])`; pass `launchers` + `timezone` (from `configService` — find how LanguageStudyService gets its timezone in `app.mjs:2300` and use the same source) into `BuildAgenda` and `ResolveSubjectNext`; construct `ResolveSubjectNext` and pass it + `portal` + `launchers` into `ResolveScanAction`; construct the ESC/POS renderer with `symbology: 'QR'` (find the construction site — `grep -n createDocumentEscPosRenderer backend/src/5_composition/modules/schoolLifecycle.mjs`); thread `programIds: [...launchers.keys()]` into `CurriculumAccess` / `ValidateCatalog` (Task 2's option).
- `app.mjs`: add `languageStudyService` to the `createSchoolLifecycle({ … })` call at line ~2330 (it is constructed at ~2300, before the lifecycle — verify order).

- [ ] **Step 1: Failing renderer tests** — a document with `## MATH — Unit 2 of 4` + a `scan_action`: with `symbology:'QR'` expect a bold-left non-sized text item and a `qrcode` item carrying the token; with default symbology expect the old `barcode` item (regression).
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement all four files.** **Step 4: Run renderer tests + `node --check backend/src/app.mjs` + boot-smoke: `node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run tests/isolated/` (full isolated suite) — PASS.**
- [ ] **Step 5: Commit** (`feat(school): ESC/POS QR agenda + composition wiring for launchers`)

---

### Task 13: Frontend — the Portal launch subscription

**Files:**
- Create: `frontend/src/modules/School/useSchoolLaunch.js`
- Modify: `frontend/src/modules/School/SchoolApp.jsx`
- Test: `frontend/src/modules/School/useSchoolLaunch.test.jsx`

**Interfaces:**
- Consumes: `useWebSocketSubscription(filter, callback, deps)` from `frontend/src/hooks/useWebSocket.js` (read its filter semantics first — topic string or array); `useSchoolProfile()`'s `claim(id)`; SchoolApp's existing navigation state (`setSection`, `start`, `setActive` — read `SchoolApp.jsx:110-200` and the `start` callback around line 189 before writing anything).
- Produces: `useSchoolLaunch({ claim, onLaunch })` — subscribes to topic `school`; on `{ type: 'school.launch', learnerId, target }`: `claim(learnerId)` then `onLaunch(target)`. SchoolApp supplies `onLaunch` mapping `target.kind === 'program' && target.program === 'language'` → navigate to the language section (whatever `setSection` value the Programs/Glossika tile uses — find it in `programs.js`/the section render), and `target.kind === 'bank'` → the same path the quiz `start` callback takes for `{ bank: target.bankId, mode: 'quiz' }`. Structured logging per CLAUDE.md: `logger.info('launch-received', { kind, learnerId })` via a `child({ component: 'school-launch' })` logger — never console.

- [ ] **Step 1: Write the failing hook test** — mock `../../hooks/useWebSocket.js` (`vi.mock`) to capture the callback; fire a `school.launch` payload; assert `claim` then `onLaunch` called with the target; assert a malformed payload (no type / wrong type) is ignored. Follow the mocking style of an existing School test (`SchoolApp.test.jsx`) for renderer/harness conventions.
- [ ] **Step 2: Run — FAIL** (frontend tests run with the same vitest binary: `node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run frontend/src/modules/School/useSchoolLaunch.test.jsx`).
- [ ] **Step 3: Implement hook + SchoolApp wiring.** Keep SchoolApp's change minimal: one hook call + one `onLaunch` callback near the existing `start`/claim plumbing.
- [ ] **Step 4: Run the School frontend suite** — `node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run frontend/src/modules/School/` — PASS.
- [ ] **Step 5: Commit** (`feat(school): portal launch subscription — scan-to-screen`)

---

### Task 14: Seed unit, end-to-end proof, docs

**Files:**
- Create: `tests/_fixtures/school/curriculum/units/language-daily.yml` (fixture copy) — AND the production copy is deployed later via docker exec (see Deployment note; not a repo file).
- Create/extend: an end-to-end test in `tests/isolated/application/school/` (follow the largest existing lifecycle test's arrangement — `grep -rln 'ResolveScanAction' tests/isolated/application/school/` and pick the fullest graph)
- Modify: `docs/reference/school/README.md` (the NFC/agenda + console sections)

**Steps:**
- [ ] **Step 1: Fixture YAML** — exactly the §2.1 spec YAML. Add it to the fixture loader the way other fixture units load (read `tests/_fixtures/school/curriculum/` conventions + `fixtureIntegrity.test.mjs`).
- [ ] **Step 2: End-to-end test (write first, watch it fail at the first unbuilt seam it touches — it should pass immediately if Tasks 1-13 are correct):** wire the real use cases over the fakes (the buildAgenda test's graph + ResolveScanAction + a fake PortalDispatch): (a) card tap (BuildAgenda via ResolvePersonalCard) → document has `## MATH` and `## LANGUAGE` sections and 2 subject tokens; (b) scan the math token → worksheet issued (or media dispatched per fixture composition); (c) record a passing outcome today, tap again → math section shows done today, ONE token; (d) scan the stale math token from (a) → served-today slip (yesterday's paper still safe); (e) scan the language token → fake portal received `{ kind: 'program', program: 'language' }` AND a slip printed.
- [ ] **Step 3: Run the ENTIRE isolated suite + frontend School suite** — `node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run tests/isolated/ frontend/src/modules/School/`. Expected: PASS, no skips. Capture the real exit code (`echo $?` immediately — no pipes).
- [ ] **Step 4: Update `docs/reference/school/README.md`** — rewrite the "NFC personal cards — tap to agenda" + "An assigned course, not a catalog, is what prints" sections to describe the sectioned daily agenda, the program unit kind, the `subject_next` token, the daily serving rule, and Portal launch. Present tense, endstate, no class names in prose beyond the layer table (per the household's reference-docs convention). Add the new files to the layer table.
- [ ] **Step 5: Commit** (`feat(school): agenda v2 e2e proof, seed fixture, reference docs`)

**Deployment note (post-merge, on this host):** production needs the real `data/content/school/curriculum/units/language-daily.yml` written via `sudo docker exec` (heredoc — never sed), `felix.yml` assignment gaining `units: [language-daily]` via the assignments API with a grown-up `assignedBy`, then build + deploy-gate check + `sudo deploy-daylight`, then a hardware tap test. The deploy gate and kiosk-reload rules in `CLAUDE.local.md` apply; deploy is NOT part of any task above.

---

## Self-review notes (already applied)

- Spec §3.3 (serving locks nothing) is honoured structurally: nothing in Tasks 3-11 adds a gate to existing token classes or session flows; only agenda composition and `subject_next` resolution consult `servedToday`.
- Spec §4.4 (no sessions for program units) appears in Tasks 10 (no ensureSession for program next) and 11 (`kind: 'program'` carries no sessionId).
- Every printed string introduced is ASCII.
- Type consistency spot-checks: `planDailyAgenda` section shape (Task 5) matches consumption in Tasks 7/10/11; `nextMove` kinds (Task 8) match the routing in Task 11; `PortalDispatch.launch` target shapes match Tasks 9/11/13.
