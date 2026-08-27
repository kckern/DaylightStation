# Piano Kiosk Today's-Lesson Gate — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a learner picks themselves at the piano kiosk and owes an unfinished `piano-course` lesson today, `PianoMenu` shows only that lesson (thumbnail + tap-to-launch) instead of the normal tile grid, clearing live on completion, co-progress excusal, or a parent-issued Teacher Console bypass.

**Architecture:** A new School use case (`GetPianoLessonGate`) reuses the existing `PianoCourseProgramLauncher.status()` as the single source of truth, reached from the kiosk via `GET /api/v1/school/lifecycle/learners/:id/piano-lesson-gate`. A parent bypass is a study-day-scoped, append-only ledger consumed *inside* `status()` itself (new optional `dayBypasses` dependency), so the kiosk gate, the agenda, and the completion ceremony all agree automatically. Both a real completion and a bypass grant/retract push a WS broadcast on the existing `school` topic so the kiosk clears live, with a 15s poll as the robustness fallback.

**Tech Stack:** Express (backend/src/4_api), DDD layered composition (backend/src/{1_adapters,2_domains,3_applications,5_composition}), React (frontend/src/modules), Vitest (backend `tests/isolated/**` — run vitest directly per house convention, not the Jest-routing harness), Jest/Testing Library (frontend `.test.jsx`/`.test.js`).

**Design doc (read first, has full rationale):** `docs/_wip/plans/2026-08-27-piano-todays-lesson-gate-design.md`

**Working directory for all tasks:** `.worktrees/piano-lesson-gate/` (branch `feature/piano-lesson-gate`)

---

## Task 1: `YamlProgramDayBypassStore` (adapter)

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlProgramDayBypassStore.mjs`
- Test: `backend/src/1_adapters/persistence/yaml/YamlProgramDayBypassStore.test.mjs`

Clone of `YamlCurriculumExceptionStore.mjs` (read it first — same file, different key names), plus one new query method `activeFor`.

**Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlProgramDayBypassStore } from './YamlProgramDayBypassStore.mjs';

describe('YamlProgramDayBypassStore', () => {
  let dir;
  let configService;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdb-store-'));
    configService = { getHouseholdPath: (p) => path.join(dir, p) };
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('list() on a missing file returns empty, not a throw', async () => {
    const store = new YamlProgramDayBypassStore({ configService });
    expect(await store.list()).toEqual([]);
  });

  it('append() persists and list() round-trips it', async () => {
    const store = new YamlProgramDayBypassStore({ configService });
    const record = {
      schema: 'school.program-day-bypass/v1', operation: 'applied', bypassId: 'pdb_1',
      learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27',
      reason: 'Recital', decidedBy: 'kckern', decidedAt: '2026-08-27T14:00:00-07:00',
    };
    await store.append(record);
    expect(await store.list()).toEqual([record]);
  });

  it('active() excludes a retracted bypassId', async () => {
    const store = new YamlProgramDayBypassStore({ configService });
    await store.append({ operation: 'applied', bypassId: 'pdb_1', learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27' });
    await store.append({ operation: 'retracted', bypassId: 'pdb_1' });
    expect(await store.active()).toEqual([]);
  });

  it('activeFor() matches learnerId + programId + studyDate among active records', async () => {
    const store = new YamlProgramDayBypassStore({ configService });
    await store.append({ operation: 'applied', bypassId: 'pdb_1', learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27' });
    await store.append({ operation: 'applied', bypassId: 'pdb_2', learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-26' });
    const hit = await store.activeFor({ learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27' });
    expect(hit?.bypassId).toBe('pdb_1');
    const miss = await store.activeFor({ learnerId: 'kid2', programId: 'piano-course', studyDate: '2026-08-27' });
    expect(miss).toBeNull();
  });

  it('two concurrent appends do not clobber each other', async () => {
    const store = new YamlProgramDayBypassStore({ configService });
    await Promise.all([
      store.append({ operation: 'applied', bypassId: 'pdb_a', learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27' }),
      store.append({ operation: 'applied', bypassId: 'pdb_b', learnerId: 'kid2', programId: 'piano-course', studyDate: '2026-08-27' }),
    ]);
    expect((await store.list()).map((r) => r.bypassId).sort()).toEqual(['pdb_a', 'pdb_b']);
  });
});
```

**Step 2: Run and verify it fails**

```
npx vitest run backend/src/1_adapters/persistence/yaml/YamlProgramDayBypassStore.test.mjs
```
Expected: FAIL (`Cannot find module './YamlProgramDayBypassStore.mjs'`).

**Step 3: Write the implementation**

```js
import { promises as fs } from 'node:fs';
import yaml from 'js-yaml';
import { saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

/** Append-only, study-day-scoped program obligation bypass ledger. */
export class YamlProgramDayBypassStore {
  #configService; #writeChain = Promise.resolve();
  constructor({ configService } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlProgramDayBypassStore requires configService');
    this.#configService = configService;
  }
  #file() { return this.#configService.getHouseholdPath('school/records/program-day-bypasses.yml'); }

  async list() {
    try { const raw = yaml.load(await fs.readFile(this.#file(), 'utf8')); return Array.isArray(raw) ? raw : []; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }

  async append(record) {
    const run = async () => {
      const records = await this.list();
      records.push(structuredClone(record));
      saveYamlToPathAtomic(this.#file(), records, { noRefs: true });
      return structuredClone(record);
    };
    const queued = this.#writeChain.then(run);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  async active() {
    const records = await this.list();
    const retracted = new Set(records.filter((r) => r.operation === 'retracted').map((r) => r.bypassId));
    return records.filter((r) => r.operation === 'applied' && !retracted.has(r.bypassId));
  }

  /** The active bypass (if any) for one learner + program + study day. */
  async activeFor({ learnerId, programId, studyDate }) {
    const active = await this.active();
    return active.find((r) => r.learnerId === learnerId && r.programId === programId && r.studyDate === studyDate) ?? null;
  }
}

export default YamlProgramDayBypassStore;
```

**Step 4: Run and verify it passes**

```
npx vitest run backend/src/1_adapters/persistence/yaml/YamlProgramDayBypassStore.test.mjs
```
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlProgramDayBypassStore.mjs backend/src/1_adapters/persistence/yaml/YamlProgramDayBypassStore.test.mjs
git commit -m "feat(school): add YamlProgramDayBypassStore"
```

---

## Task 2: `PianoCourseProgramLauncher` — structural `nextLesson`

**Files:**
- Modify: `backend/src/3_applications/school/PianoCourseProgramLauncher.mjs`
- Test: `tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs`

Fixes the draft's course-complete hole (see design doc §0.3): `status().context` cannot distinguish "next lesson" from "last lesson of a finished course." Add a structural field instead.

**Step 1: Write the failing test** — append to the existing test file (read it first for the `launcherFor`/`lesson` helpers already defined there):

```js
describe('PianoCourseProgramLauncher.status — nextLesson', () => {
  it('names the next unwatched lesson when owed', async () => {
    const launcher = launcherFor(
      { items: [lesson('a', { watched: true, title: 'Lesson 1' }), lesson('b', { title: 'Lesson 2' })] },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(false);
    expect(status.nextLesson?.lesson?.id).toContain('b');
  });

  it('is null when the course is fully watched (nothing left to gate on)', async () => {
    const launcher = launcherFor(
      { items: [lesson('a', { watched: true })] },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(false); // no completion TODAY, but nothing left to launch
    expect(status.nextLesson).toBeNull();
  });
});
```

**Step 2: Run and verify it fails**

```
npx vitest run tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs -t nextLesson
```
Expected: FAIL (`status.nextLesson` is `undefined`, not matching `.toContain`/`.toBeNull()`).

**Step 3: Implement** — in `PianoCourseProgramLauncher.mjs`, the final `return` of `status()` (currently ~line 273-279, the "not done, not excused" branch) gains one field:

```js
return {
  ...common,
  doneToday: false,
  nextLesson: next ? this.#lessonContext({ result, item: next }) : null,
  progressLabel: next
    ? `${completed}/${total} · next: ${next.title}`
    : `${completed}/${total} — course complete`,
};
```

(`next` is already computed earlier in `status()` as `credit.find((item) => !item.userWatched)` — no new lookup needed, just surface it.)

**Step 4: Run and verify it passes**

```
npx vitest run tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs
```
Expected: PASS, all tests in the file (existing + new 2).

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/PianoCourseProgramLauncher.mjs tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs
git commit -m "feat(school): expose structural nextLesson on PianoCourseProgramLauncher.status"
```

---

## Task 3: `PianoCourseProgramLauncher` — bypass consumption

**Files:**
- Modify: `backend/src/3_applications/school/PianoCourseProgramLauncher.mjs`
- Test: `tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs`

**Step 1: Write the failing tests**

```js
describe('PianoCourseProgramLauncher.status — parent bypass', () => {
  const bypassStore = (record) => ({ activeFor: async () => record });

  it('an active bypass settles the day as excused/bypassed, not owed', async () => {
    const launcher = new PianoCourseProgramLauncher({
      getPlayableUnits: fakeUnits({ items: [lesson('a')] }),
      dayBypasses: bypassStore({ decidedBy: 'kckern', reason: 'Recital' }),
      timezone: TZ, clock: () => new Date('2026-08-25T20:00:00Z'), logger: { warn() {}, info() {} },
    });
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(true);
    expect(status.excused).toBe(true);
    expect(status.bypassed).toBe(true);
    expect(status.progressLabel).toContain('Excused today by kckern');
  });

  it('a real completion outranks an active bypass — no excused flag, ceremony-eligible', async () => {
    const launcher = new PianoCourseProgramLauncher({
      getPlayableUnits: fakeUnits({ items: [lesson('a', { completedAt: '2026-08-25T18:00:00Z' })] }),
      dayBypasses: bypassStore({ decidedBy: 'kckern', reason: 'Recital' }),
      timezone: TZ, clock: () => new Date('2026-08-25T20:00:00Z'), logger: { warn() {}, info() {} },
    });
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(true);
    expect(status.excused).toBeUndefined();
    expect(status.bypassed).toBeUndefined();
  });

  it('a bypass store throw is treated as no bypass, never error:true', async () => {
    const launcher = new PianoCourseProgramLauncher({
      getPlayableUnits: fakeUnits({ items: [lesson('a')] }),
      dayBypasses: { activeFor: async () => { throw new Error('disk gone'); } },
      timezone: TZ, clock: () => new Date('2026-08-25T20:00:00Z'), logger: { warn() {}, info() {} },
    });
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.error).toBeUndefined();
    expect(status.doneToday).toBe(false);
  });

  it('no dayBypasses dependency behaves exactly as before (opt-in)', async () => {
    const launcher = launcherFor({ items: [lesson('a')] }, '2026-08-25T20:00:00Z');
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.bypassed).toBeUndefined();
  });
});
```

**Step 2: Run and verify it fails**

```
npx vitest run tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs -t bypass
```
Expected: FAIL — `dayBypasses` isn't a constructor param yet, `bypassed` is always `undefined`.

**Step 3: Implement**

Constructor (currently `constructor({ getPlayableUnits, donow = null, timezone = null, clock = () => new Date(), logger = console } = {})`):

```js
constructor({
  getPlayableUnits, donow = null, dayBypasses = null, timezone = null,
  clock = () => new Date(), logger = console,
} = {}) {
  if (!getPlayableUnits || typeof getPlayableUnits.execute !== 'function') {
    throw new Error('PianoCourseProgramLauncher requires a getPlayableUnits use case');
  }
  this.#getPlayableUnits = getPlayableUnits;
  this.#donow = donow;
  this.#dayBypasses = dayBypasses;
  this.#timezone = timezone;
  this.#clock = clock;
  this.#logger = logger;
}
```

Add `#dayBypasses;` to the private-field declaration line at the top of the class.

In `status()`, insert the bypass check **between** the `completedToday.length` branch and the co-progress `lock`/`lockBlocks` branch (i.e. it must not run when a real completion already returned; it must run before the excused-lockout check, per design doc §7.1 ordering):

```js
// Import at top of file:
import { studyDayForInstant, isSameStudyDay } from '#domains/school/studyDay.mjs';
```

```js
// After the `if (completedToday.length) { ... return { ... } }` block, before
// the co-progress lock check:
let bypass = null;
try {
  bypass = await this.#dayBypasses?.activeFor?.({
    userId, // NOTE: launcher's `userId` param IS the School learnerId
    learnerId: userId,
    programId: this.id,
    studyDate: studyDayForInstant(nowMs, { timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR }),
  }) ?? null;
} catch (err) {
  this.#logger.warn?.('school.piano-course.bypass-read-failed', {
    userId, courseId: programInstance, error: err?.message ?? String(err),
  });
  bypass = null;
}
if (bypass) {
  return {
    ...common,
    doneToday: true,
    excused: true,
    bypassed: true,
    progressLabel: `Excused today by ${bypass.decidedBy} · ${completed}/${total}`,
  };
}
```

(`nowMs` and `common` are already in scope at this point in the existing method — verify against the current file before pasting; adjust variable names to match exactly what's already there rather than assuming.)

**Step 4: Run and verify it passes**

```
npx vitest run tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs
```
Expected: PASS, entire file (original + Task 2 + Task 3 tests).

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/PianoCourseProgramLauncher.mjs tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs
git commit -m "feat(school): consume a parent day-bypass inside PianoCourseProgramLauncher.status"
```

---

## Task 4: `ManageProgramDayBypass` use case

**Files:**
- Create: `backend/src/3_applications/school/usecases/ManageProgramDayBypass.mjs`
- Test: `backend/src/3_applications/school/usecases/ManageProgramDayBypass.test.mjs`

Model: `RecordAttestation.mjs` (single-write, no preview/apply split — this is attestation-weight, not curriculum-exception-weight). Read that file first.

**Step 1: Write the failing tests**

```js
import { describe, it, expect, vi } from 'vitest';
import { ManageProgramDayBypass } from './ManageProgramDayBypass.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const fakeStore = (seed = []) => {
  const records = [...seed];
  return {
    records,
    list: async () => records,
    append: async (r) => { records.push(r); return r; },
    active: async () => records.filter((r) => r.operation === 'applied'
      && !records.some((x) => x.operation === 'retracted' && x.bypassId === r.bypassId)),
  };
};
const fakeAssignments = (enrolled = true) => ({
  get: async () => ({ programs: enrolled ? [{ programId: 'piano-course', courseId: 'plex:1' }] : [] }),
});
const fakeGate = (allow = true) => ({ assert: vi.fn((...args) => { if (!allow) throw new Error('refused'); }) });

describe('ManageProgramDayBypass.grant', () => {
  it('requires a reason', async () => {
    const uc = new ManageProgramDayBypass({ store: fakeStore(), assignments: fakeAssignments(), teacherGate: fakeGate() });
    await expect(uc.grant({ learnerId: 'kid1', reason: '', decidedBy: 'kckern' })).rejects.toThrow(ValidationError);
  });

  it('requires learnerId', async () => {
    const uc = new ManageProgramDayBypass({ store: fakeStore(), assignments: fakeAssignments(), teacherGate: fakeGate() });
    await expect(uc.grant({ learnerId: '', reason: 'x', decidedBy: 'kckern' })).rejects.toThrow(ValidationError);
  });

  it('refuses a learner not enrolled in the program', async () => {
    const uc = new ManageProgramDayBypass({ store: fakeStore(), assignments: fakeAssignments(false), teacherGate: fakeGate() });
    await expect(uc.grant({ learnerId: 'kid1', reason: 'x', decidedBy: 'kckern' })).rejects.toThrow(EntityNotFoundError);
  });

  it('asserts via teacherGate and propagates a refusal', async () => {
    const uc = new ManageProgramDayBypass({ store: fakeStore(), assignments: fakeAssignments(), teacherGate: fakeGate(false) });
    await expect(uc.grant({ learnerId: 'kid1', reason: 'x', decidedBy: 'kckern' })).rejects.toThrow('refused');
  });

  it('grants, stamping studyDate from the injected clock/timezone', async () => {
    const store = fakeStore();
    const uc = new ManageProgramDayBypass({
      store, assignments: fakeAssignments(), teacherGate: fakeGate(),
      timezone: 'America/Los_Angeles', clock: () => new Date('2026-08-27T20:00:00Z'), // 13:00 PDT
    });
    const record = await uc.grant({ learnerId: 'kid1', reason: 'Recital', decidedBy: 'kckern' });
    expect(record.studyDate).toBe('2026-08-27');
    expect(record.operation).toBe('applied');
    expect(store.records).toHaveLength(1);
  });

  it('is idempotent — a second grant the same day returns the existing record, no duplicate', async () => {
    const store = fakeStore();
    const uc = new ManageProgramDayBypass({
      store, assignments: fakeAssignments(), teacherGate: fakeGate(),
      timezone: 'America/Los_Angeles', clock: () => new Date('2026-08-27T20:00:00Z'),
    });
    const first = await uc.grant({ learnerId: 'kid1', reason: 'Recital', decidedBy: 'kckern' });
    const second = await uc.grant({ learnerId: 'kid1', reason: 'Recital again', decidedBy: 'kckern' });
    expect(second.bypassId).toBe(first.bypassId);
    expect(store.records.filter((r) => r.operation === 'applied')).toHaveLength(1);
  });

  it('broadcasts program-day-bypass-changed on the school topic', async () => {
    const broadcast = vi.fn();
    const uc = new ManageProgramDayBypass({
      store: fakeStore(), assignments: fakeAssignments(), teacherGate: fakeGate(),
      eventBus: { broadcast }, clock: () => new Date('2026-08-27T20:00:00Z'),
    });
    await uc.grant({ learnerId: 'kid1', reason: 'x', decidedBy: 'kckern' });
    expect(broadcast).toHaveBeenCalledWith('school', expect.objectContaining({
      event: 'program-day-bypass-changed', learnerId: 'kid1', active: true,
    }));
  });

  it('a dead event bus does not fail the grant', async () => {
    const uc = new ManageProgramDayBypass({
      store: fakeStore(), assignments: fakeAssignments(), teacherGate: fakeGate(),
      eventBus: { broadcast: () => { throw new Error('bus down'); } },
    });
    await expect(uc.grant({ learnerId: 'kid1', reason: 'x', decidedBy: 'kckern' })).resolves.toBeTruthy();
  });
});

describe('ManageProgramDayBypass.retract', () => {
  it('404s an unknown/inactive bypassId', async () => {
    const uc = new ManageProgramDayBypass({ store: fakeStore(), assignments: fakeAssignments(), teacherGate: fakeGate() });
    await expect(uc.retract({ bypassId: 'nope', reason: 'x', retractedBy: 'kckern' })).rejects.toThrow(EntityNotFoundError);
  });

  it('retracts an active bypass and broadcasts active:false', async () => {
    const broadcast = vi.fn();
    const store = fakeStore([{ schema: 'school.program-day-bypass/v1', operation: 'applied', bypassId: 'pdb_1', learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27' }]);
    const uc = new ManageProgramDayBypass({ store, assignments: fakeAssignments(), teacherGate: fakeGate(), eventBus: { broadcast } });
    const record = await uc.retract({ bypassId: 'pdb_1', reason: 'wrong kid', retractedBy: 'kckern' });
    expect(record.operation).toBe('retracted');
    expect(broadcast).toHaveBeenCalledWith('school', expect.objectContaining({ event: 'program-day-bypass-changed', active: false }));
  });
});

describe('ManageProgramDayBypass.list', () => {
  it('filters to one learner when given', async () => {
    const store = fakeStore([
      { operation: 'applied', bypassId: 'a', learnerId: 'kid1', studyDate: '2026-08-27' },
      { operation: 'applied', bypassId: 'b', learnerId: 'kid2', studyDate: '2026-08-27' },
    ]);
    const uc = new ManageProgramDayBypass({ store, assignments: fakeAssignments(), teacherGate: fakeGate() });
    const result = await uc.list({ learnerId: 'kid1' });
    expect(result.active.map((r) => r.bypassId)).toEqual(['a']);
  });
});
```

**Step 2: Run and verify it fails**

```
npx vitest run backend/src/3_applications/school/usecases/ManageProgramDayBypass.test.mjs
```
Expected: FAIL (`Cannot find module './ManageProgramDayBypass.mjs'`).

**Step 3: Implement**

```js
import { createHash } from 'node:crypto';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { studyDayForInstant } from '#domains/school/studyDay.mjs';

const BOUNDARY_HOUR = 4;
const SCHOOL_TOPIC = 'school'; // same topic PianoLessonCeremonyBridge broadcasts on (CEREMONY_TOPIC)
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const idFor = (seed) => `pdb_${createHash('sha256').update(JSON.stringify(seed)).digest('hex').slice(0, 16)}`;

export class ManageProgramDayBypass {
  #store; #assignments; #teacherGate; #eventBus; #timezone; #clock; #logger;

  constructor({
    store, assignments, teacherGate, eventBus = null,
    timezone = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!store || !assignments || !teacherGate) {
      throw new Error('ManageProgramDayBypass requires store, assignments and teacherGate');
    }
    this.#store = store;
    this.#assignments = assignments;
    this.#teacherGate = teacherGate;
    this.#eventBus = eventBus;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
  }

  async list({ learnerId = null } = {}) {
    const [active, history] = await Promise.all([this.#store.active(), this.#store.list()]);
    return {
      schema: 'school.program-day-bypasses/v1',
      active: learnerId ? active.filter((r) => r.learnerId === learnerId) : active,
      history: learnerId ? history.filter((r) => r.learnerId === learnerId) : history,
    };
  }

  async grant({ learnerId, programId = 'piano-course', reason, decidedBy, pin = null } = {}) {
    this.#teacherGate.assert({ userId: decidedBy, pin, action: 'program-day-bypass.grant', context: { learnerId, programId } });
    if (!text(learnerId)) throw new ValidationError('learnerId is required');
    if (!text(reason)) throw new ValidationError('a reason is required — an override without one is unauditable');

    const assignment = await this.#assignments.get(learnerId);
    const enrolled = (assignment?.programs ?? []).some((row) => row?.programId === programId);
    if (!enrolled) throw new EntityNotFoundError('program enrollment', `${learnerId}:${programId}`);

    const studyDate = studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR });
    const existing = await this.#store.activeFor({ learnerId, programId, studyDate });
    if (existing) return existing; // idempotent: same-day double-grant is a no-op, not a duplicate

    const record = {
      schema: 'school.program-day-bypass/v1',
      operation: 'applied',
      bypassId: idFor({ learnerId, programId, studyDate }),
      learnerId, programId, studyDate,
      reason: reason.trim(),
      decidedBy,
      decidedAt: this.#clock().toISOString(),
    };
    await this.#store.append(record);
    this.#broadcast({ event: 'program-day-bypass-changed', learnerId, programId, studyDate, active: true, decidedBy });
    return record;
  }

  async retract({ bypassId, reason, retractedBy, pin = null } = {}) {
    this.#teacherGate.assert({ userId: retractedBy, pin, action: 'program-day-bypass.retract', context: { bypassId } });
    if (!text(bypassId) || !text(reason)) throw new ValidationError('bypassId and reason are required');
    const target = (await this.#store.active()).find((r) => r.bypassId === bypassId);
    if (!target) throw new EntityNotFoundError('active program day bypass', bypassId);

    const record = {
      schema: 'school.program-day-bypass/v1', operation: 'retracted', bypassId,
      reason: reason.trim(), retractedBy, retractedAt: this.#clock().toISOString(),
    };
    await this.#store.append(record);
    this.#broadcast({
      event: 'program-day-bypass-changed', learnerId: target.learnerId, programId: target.programId,
      studyDate: target.studyDate, active: false, decidedBy: retractedBy,
    });
    return record;
  }

  #broadcast(payload) {
    try {
      this.#eventBus?.broadcast?.(SCHOOL_TOPIC, { ...payload, timestamp: Date.now() });
    } catch (err) {
      this.#logger.warn?.('school.program-day-bypass.broadcast-failed', { error: err?.message ?? String(err) });
    }
  }
}

export default ManageProgramDayBypass;
```

**Step 4: Run and verify it passes**

```
npx vitest run backend/src/3_applications/school/usecases/ManageProgramDayBypass.test.mjs
```
Expected: PASS (13 tests).

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/usecases/ManageProgramDayBypass.mjs backend/src/3_applications/school/usecases/ManageProgramDayBypass.test.mjs
git commit -m "feat(school): add ManageProgramDayBypass use case"
```

---

## Task 5: `GetPianoLessonGate` use case

**Files:**
- Create: `backend/src/3_applications/school/usecases/GetPianoLessonGate.mjs`
- Test: `backend/src/3_applications/school/usecases/GetPianoLessonGate.test.mjs`

**Step 1: Write the failing tests**

```js
import { describe, it, expect, vi } from 'vitest';
import { GetPianoLessonGate } from './GetPianoLessonGate.mjs';

const fakeAssignments = (programs) => ({ get: vi.fn(async () => ({ programs })) });
const fakeLauncher = (statusFn) => ({ id: 'piano-course', status: vi.fn(statusFn) });

describe('GetPianoLessonGate', () => {
  it('guest never fetches, never gated', async () => {
    const assignments = fakeAssignments([]);
    const uc = new GetPianoLessonGate({ assignments, launcher: fakeLauncher(async () => ({})), logger: console });
    const result = await uc.execute({ learnerId: 'guest' });
    expect(result).toEqual({ schema: 'school.piano-lesson-gate/v1', learnerId: 'guest', gated: false, reason: 'guest' });
    expect(assignments.get).not.toHaveBeenCalled();
  });

  it('not enrolled → not gated', async () => {
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments([]), launcher: fakeLauncher(async () => ({})), logger: console });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('not-enrolled');
  });

  it('owed → gated, payload built from nextLesson', async () => {
    const launcher = fakeLauncher(async () => ({
      doneToday: false,
      nextLesson: { course: { id: 'plex:1', title: 'Hoffman' }, unit: { id: '3', title: 'Unit 3' }, lesson: { id: 'plex:2', title: 'Lesson 5' } },
    }));
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments([{ programId: 'piano-course', courseId: 'plex:1' }]), launcher, logger: console,
    });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(true);
    expect(result.reason).toBe('owed');
    expect(result.lesson.title).toBe('Lesson 5');
    expect(result.course.id).toBe('plex:1');
  });

  it('doneToday → not gated', async () => {
    const launcher = fakeLauncher(async () => ({ doneToday: true }));
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments([{ programId: 'piano-course', courseId: 'plex:1' }]), launcher, logger: console });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('done');
  });

  it('excused → not gated (nothing launchable)', async () => {
    const launcher = fakeLauncher(async () => ({ doneToday: true, excused: true }));
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments([{ programId: 'piano-course', courseId: 'plex:1' }]), launcher, logger: console });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('excused');
  });

  it('bypassed → not gated', async () => {
    const launcher = fakeLauncher(async () => ({ doneToday: true, excused: true, bypassed: true }));
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments([{ programId: 'piano-course', courseId: 'plex:1' }]), launcher, logger: console });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('bypassed');
  });

  it('course-complete (not done, no nextLesson) → not gated', async () => {
    const launcher = fakeLauncher(async () => ({ doneToday: false, nextLesson: null }));
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments([{ programId: 'piano-course', courseId: 'plex:1' }]), launcher, logger: console });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('course-complete');
  });

  it('launcher status().error → fails open', async () => {
    const launcher = fakeLauncher(async () => ({ error: true }));
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments([{ programId: 'piano-course', courseId: 'plex:1' }]), launcher, logger: { warn: vi.fn() } });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('unavailable');
  });

  it('assignments.get throwing → fails open', async () => {
    const uc = new GetPianoLessonGate({
      assignments: { get: async () => { throw new Error('disk gone'); } },
      launcher: fakeLauncher(async () => ({})), logger: { warn: vi.fn() },
    });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('unavailable');
  });

  it('multiple enrollments: gated while ANY is owed', async () => {
    const status = vi.fn()
      .mockResolvedValueOnce({ doneToday: true }) // course A: done
      .mockResolvedValueOnce({ doneToday: false, nextLesson: { course: { id: 'plex:2' }, unit: null, lesson: { id: 'plex:9', title: 'B lesson' } } }); // course B: owed
    const launcher = { id: 'piano-course', status };
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments([
        { programId: 'piano-course', courseId: 'plex:1' },
        { programId: 'piano-course', courseId: 'plex:2' },
      ]),
      launcher, logger: console,
    });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(true);
    expect(result.lesson.title).toBe('B lesson');
  });
});
```

**Step 2: Run and verify it fails**

```
npx vitest run backend/src/3_applications/school/usecases/GetPianoLessonGate.test.mjs
```
Expected: FAIL (module not found).

**Step 3: Implement**

```js
export class GetPianoLessonGate {
  #assignments; #launcher; #logger;
  constructor({ assignments, launcher, logger = console } = {}) {
    if (!assignments || !launcher) throw new Error('GetPianoLessonGate requires assignments and launcher');
    this.#assignments = assignments;
    this.#launcher = launcher;
    this.#logger = logger;
  }

  async execute({ learnerId } = {}) {
    const base = { schema: 'school.piano-lesson-gate/v1', learnerId };
    if (!learnerId || learnerId === 'guest') return { ...base, gated: false, reason: 'guest' };

    let programs;
    try {
      programs = (await this.#assignments.get(learnerId))?.programs ?? [];
    } catch (err) {
      this.#logger.warn?.('school.piano-gate.assignments-unavailable', { learnerId, error: err?.message ?? String(err) });
      return { ...base, gated: false, reason: 'unavailable' };
    }

    const enrollments = programs.filter((row) => row?.programId === this.#launcher.id);
    if (!enrollments.length) return { ...base, gated: false, reason: 'not-enrolled' };

    let lastReason = 'done';
    for (const row of enrollments) {
      const courseId = row.courseId ?? row.corpusId ?? null;
      if (!courseId) continue;
      let status;
      try {
        // eslint-disable-next-line no-await-in-loop
        status = await this.#launcher.status({ userId: learnerId, programInstance: courseId });
      } catch (err) {
        this.#logger.warn?.('school.piano-gate.status-failed', { learnerId, courseId, error: err?.message ?? String(err) });
        return { ...base, gated: false, reason: 'unavailable' };
      }
      if (status?.error === true) {
        this.#logger.warn?.('school.piano-gate.status-unavailable', { learnerId, courseId });
        return { ...base, gated: false, reason: 'unavailable' };
      }
      if (status?.doneToday === true) {
        lastReason = status.bypassed ? 'bypassed' : status.excused ? 'excused' : 'done';
        continue;
      }
      if (status?.nextLesson) {
        const { course, unit, lesson } = status.nextLesson;
        return {
          ...base, gated: true, reason: 'owed',
          course, unit: unit ?? null,
          lesson: { id: lesson.id, title: lesson.title, ...(lesson.position != null ? { position: lesson.position } : {}),
            ...(lesson.thumbnail ? { thumbnail: lesson.thumbnail } : {}), ...(lesson.description ? { description: lesson.description } : {}) },
        };
      }
      lastReason = 'course-complete';
    }
    return { ...base, gated: false, reason: lastReason };
  }
}

export default GetPianoLessonGate;
```

**Step 4: Run and verify it passes**

```
npx vitest run backend/src/3_applications/school/usecases/GetPianoLessonGate.test.mjs
```
Expected: PASS (10 tests).

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/usecases/GetPianoLessonGate.mjs backend/src/3_applications/school/usecases/GetPianoLessonGate.test.mjs
git commit -m "feat(school): add GetPianoLessonGate use case"
```

---

## Task 6: Composition wiring (`schoolLifecycle.mjs`)

**Files:**
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs`

No new test file — this is composition wiring, verified by the router test in Task 7/8 and the full-suite run in Task 9.

**Step 1:** Near the curriculum-exception construction block (~line 605-608), add the bypass store and use case, and pass `dayBypasses` into the launcher. Read the surrounding ~30 lines first to match exact style (imports via dynamic `await import(...)`, as the exception store/use case already do).

```js
const { YamlProgramDayBypassStore } = await import('#adapters/persistence/yaml/YamlProgramDayBypassStore.mjs');
const { ManageProgramDayBypass } = await import('#apps/school/usecases/ManageProgramDayBypass.mjs');
const programDayBypassStore = new YamlProgramDayBypassStore({ configService });
```

Place this **before** the `pianoCourseLauncher` construction block (~line 474-482), so the store exists when the launcher is built:

```js
let pianoCourseLauncher = null;
if (pianoPlayableUnits) {
  pianoCourseLauncher = new PianoCourseProgramLauncher({
    getPlayableUnits: pianoPlayableUnits, donow, dayBypasses: programDayBypassStore, timezone, clock, logger,
  });
  launchers.set(pianoCourseLauncher.id, pianoCourseLauncher);
} else {
  logger.warn?.('school.lifecycle.piano-course-unwired', { reason: 'no pianoPlayableUnits' });
}
```

After `teacherGate` is constructed (~line 604), alongside `manageCurriculumException`:

```js
const manageProgramDayBypass = new ManageProgramDayBypass({
  store: programDayBypassStore, assignments: stores.assignments, teacherGate, eventBus, timezone, clock, logger,
});
```

**Step 2:** Add `GetPianoLessonGate` construction after `pianoCourseLauncher` exists (right after its `if` block, ~line 483):

```js
const { GetPianoLessonGate } = await import('#apps/school/usecases/GetPianoLessonGate.mjs');
const getPianoLessonGate = pianoCourseLauncher
  ? new GetPianoLessonGate({ assignments: stores.assignments, launcher: pianoCourseLauncher, logger })
  : null;
```

**Step 3:** Add both to the `useCases` map literal (~line 1222-1229):

```js
const useCases = {
  buildAgenda, issueDocument, issueComposedWorksheet, dispatchMedia, recordMediaCompletion,
  submitPaperWork, gradeSubmission, closeSessionOutcome, openRemediation,
  resolvePersonalCard, resolveScanAction, resolveReviewItem, setAssignments, closeLanguageDay,
  previewAgenda, markSessionAbandoned, replaceLostAnswerSheet, createLostAnswerSheetTicket,
  enrollLearner, unenrollLearner, resolveAccessCode, runSelfServiceAction, recordLessonCompanionProgress,
  getLearnerDayCompletion, teacherAgendaDispatch, reprintIssuedArtifact, reprintResultReceiptArtifact,
  issueCorrectedResultReceipt, manageCurriculumException,
  getPianoLessonGate, manageProgramDayBypass,
};
```

(`getPianoLessonGate` flows into `createSchoolLifecycleRouter` automatically via the existing `{...useCases, ...}` spread at ~line 1231-1243 — no separate change needed there.)

**Step 4:** Add `programDayBypassStore` to the exported `stores` object (~line 1312-1314), mirroring `curriculumExceptionStore`:

```js
stores: {
  ...stores, curriculum, printDocuments, allocationStore, worksheetInstances, companions, issuedArtifacts,
  curriculumExceptionStore, programDayBypassStore,
},
```

**Step 5: Verify nothing broke** — run the school-lifecycle composition's own smoke test if one exists, else the full domain suite for this module:

```bash
find . -iname "*schoolLifecycle*test*" -not -path "*/node_modules/*"
npx vitest run <whatever that finds>
```

**Step 6: Commit**

```bash
git add backend/src/5_composition/modules/schoolLifecycle.mjs
git commit -m "feat(school): wire program-day-bypass store and use cases into composition"
```

---

## Task 7: Router — gate read (`schoolLifecycle.mjs`)

**Files:**
- Modify: `backend/src/4_api/v1/routers/schoolLifecycle.mjs`
- Test: check for an existing router test file first (`schoolLifecycle.agenda-preview.test.mjs` exists — look for a sibling covering `/completion` to clone; if none, add a new `schoolLifecycle.piano-lesson-gate.test.mjs`)

**Step 1: Write the failing test** (adjust the harness setup to match whatever `schoolLifecycle.agenda-preview.test.mjs` uses — read it first for the exact app-mount pattern, likely `supertest` over an express app built with a subset of use cases):

```js
// Mirror the existing /completion route's own test setup (find it — likely
// alongside agenda-preview's test, or add this as a new describe block in
// the same file if one already covers this router).
it('GET /learners/:id/piano-lesson-gate 404s when getPianoLessonGate is not wired', async () => {
  // build router with getPianoLessonGate: null (or omitted)
  // request GET /learners/kid1/piano-lesson-gate → expect 404
});

it('GET /learners/:id/piano-lesson-gate proxies the use case result with no-store', async () => {
  const getPianoLessonGate = { execute: async ({ learnerId }) => ({ schema: 'school.piano-lesson-gate/v1', learnerId, gated: false, reason: 'not-enrolled' }) };
  // build router with getPianoLessonGate wired
  // request GET /learners/kid1/piano-lesson-gate
  // expect 200, body.gated === false, header Cache-Control: no-store
});
```

**Step 2: Run and verify it fails.**

**Step 3: Implement** — in `createSchoolLifecycleRouter`, add `getPianoLessonGate = null` to the destructured params (~line 144, beside `getLearnerDayCompletion`), and register the route beside the existing `/completion` route (~line 317-322):

```js
if (getPianoLessonGate) {
  router.get('/learners/:learnerId/piano-lesson-gate', asyncHandler(async (req, res) => {
    const result = await getPianoLessonGate.execute({ learnerId: req.params.learnerId });
    res.set('Cache-Control', 'no-store').json(result);
  }));
}
```

Also add `getPianoLessonGate` to the JSDoc param list near `getLearnerDayCompletion`'s own JSDoc entry (~line 109), matching that comment's style ("read-only ... consumer such as the piano kiosk").

**Step 4: Run and verify it passes.**

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/schoolLifecycle.mjs <test file>
git commit -m "feat(school): add GET /learners/:id/piano-lesson-gate route"
```

---

## Task 8: Router — bypass writes (`school.mjs`)

**Files:**
- Modify: `backend/src/4_api/v1/routers/school.mjs`
- Test: check for `school.selfservice.preview.test.mjs`-style existing router test infra; add `school.programDayBypasses.test.mjs` if attestation routes have no dedicated test file to extend (search first: `grep -rl attestations backend/src/4_api/v1/routers/*.test.mjs`)

**Step 1: Write the failing tests** — supertest-style, mirroring however `/attestations` is tested today (find and read that test first):

```js
it('GET /program-day-bypasses 404s when not configured', async () => { /* manageProgramDayBypass: null */ });
it('POST /program-day-bypasses 404s when not configured', async () => { /* ... */ });
it('POST /program-day-bypasses 201s and returns the granted record when configured', async () => {
  const manageProgramDayBypass = { grant: async (body) => ({ bypassId: 'pdb_1', ...body }) };
  // POST with { learnerId, reason, decidedBy } → 201, body.bypassId === 'pdb_1'
});
it('GET /program-day-bypasses?learnerId= filters through to the use case', async () => {
  const manageProgramDayBypass = { list: async ({ learnerId }) => ({ active: [], history: [], learnerId }) };
  // GET ?learnerId=kid1 → 200, body.learnerId === 'kid1'
});
it('POST /program-day-bypasses/:id/retract 200s', async () => {
  const manageProgramDayBypass = { retract: async ({ bypassId }) => ({ bypassId, operation: 'retracted' }) };
  // POST /program-day-bypasses/pdb_1/retract { reason } → 200
});
```

**Step 2: Run and verify it fails.**

**Step 3: Implement** — add `manageProgramDayBypass = null` to the router-factory param destructure (~line 96, beside `attestationLog`), and add the three routes beside the `/attestations` block (~line 1134-1145):

```js
router.get('/program-day-bypasses', wrap(async (req, res) => {
  if (!manageProgramDayBypass) throw new EntityNotFoundError('program day bypasses', 'not configured');
  res.set('Cache-Control', 'no-store').json(await manageProgramDayBypass.list({ learnerId: textQuery(req.query.learnerId) }));
}));
router.post('/program-day-bypasses', wrap(async (req, res) => {
  if (!manageProgramDayBypass) throw new EntityNotFoundError('program day bypasses', 'not configured');
  const { learnerId, programId = 'piano-course', reason, decidedBy = null, pin = null } = req.body || {};
  res.status(201).json(await manageProgramDayBypass.grant({ learnerId, programId, reason, decidedBy, pin }));
}));
router.post('/program-day-bypasses/:bypassId/retract', wrap(async (req, res) => {
  if (!manageProgramDayBypass) throw new EntityNotFoundError('program day bypasses', 'not configured');
  const { reason, retractedBy = null, pin = null } = req.body || {};
  res.json(await manageProgramDayBypass.retract({ bypassId: req.params.bypassId, reason, retractedBy, pin }));
}));
```

(`textQuery` is already imported/used elsewhere in this file for `/attestations`' `learnerId` filter — reuse it, don't reimplement.)

**Step 4: Run and verify it passes.**

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/school.mjs <test file>
git commit -m "feat(school): add program-day-bypasses read/grant/retract routes"
```

---

## Task 9: `app.mjs` wiring

**Files:**
- Modify: `backend/src/app.mjs`

**Step 1:** Near line 3863 (`manageCurriculumException: schoolLifecycle.useCases?.manageCurriculumException ?? null,`, inside the object passed to `createSchoolRouter`), add:

```js
manageProgramDayBypass: schoolLifecycle.useCases?.manageProgramDayBypass ?? null,
```

**Step 2: Verify** — boot the backend and confirm no startup error:

```bash
cd backend && node -e "import('./src/app.mjs').then(() => console.log('app.mjs imports cleanly')).catch((e) => { console.error(e); process.exit(1); })"
```

(This only checks the module graph loads — it does not start listening. If there's a lighter existing smoke test for `app.mjs` composition, prefer that instead.)

**Step 3: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(school): thread manageProgramDayBypass into createSchoolRouter"
```

---

## Task 10: Backend full-suite checkpoint

Before moving to frontend, run everything touched so far together:

```bash
npx vitest run \
  backend/src/1_adapters/persistence/yaml/YamlProgramDayBypassStore.test.mjs \
  tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs \
  backend/src/3_applications/school/usecases/ManageProgramDayBypass.test.mjs \
  backend/src/3_applications/school/usecases/GetPianoLessonGate.test.mjs \
  backend/src/3_applications/piano/usecases/GetPlayableUnits.test.mjs
```

All must pass (no regressions in `GetPlayableUnits` — untouched, but it's the launcher's direct dependency, worth re-running). If any router tests were added in Tasks 7-8, include those paths too. Do not proceed to frontend work with a red backend suite.

---

## Task 11: `usePianoLessonGate` hook (frontend kiosk)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/usePianoLessonGate.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/usePianoLessonGate.test.js`

Read `useSchoolGameAccess.js` and `useSchoolGameAccess.test.jsx` first — this hook is modeled on it directly, with two deliberate differences: **fail-open** (not fail-closed) and a WebSocket-triggered immediate refetch.

**Step 1: Write the failing tests** — clone `useSchoolGameAccess.test.jsx`'s structure (renderHook + fake timers + a mocked `DaylightAPI`), adding:

```js
// (exact mocking style must match useSchoolGameAccess.test.jsx — read it and
// copy its DaylightAPI/act/renderHook setup verbatim, adjusting the endpoint
// path and assertions below)

it('guest never fetches, gated:false immediately', async () => { /* ... */ });

it('fails OPEN on a fetch error (opposite of useSchoolGameAccess)', async () => {
  // mock DaylightAPI to reject
  // expect status:'error', gated:false — NOT locked
});

it('fails OPEN on the endpoint 404ing (lifecycle unwired)', async () => { /* same shape as above, status 404 */ });

it('renders not-gated during the first in-flight fetch', async () => { /* before the mock resolves, gated must be false */ });

it('gated:true surfaces course/unit/lesson from the response', async () => {
  // mock DaylightAPI to resolve { gated:true, course:{...}, unit:{...}, lesson:{...} }
  // assert hook returns them
});

it('re-fetches when learnerId changes (rerender with a new id)', async () => { /* ... */ });

it('never projects a stale learner onto a newly-picked one (request-generation guard)', async () => {
  // mirror useSchoolGameAccess.test.jsx's equivalent race test exactly
});

it('polls every 15s while mounted', async () => {
  // vi.useFakeTimers(); advance 15_000ms; assert a second DaylightAPI call
});

it('refetches on a school-topic piano-lesson-complete event for THIS learner', async () => {
  // mock wsService.subscribe (however useSchoolGameAccess/useScanCeremony tests do it)
  // fire a handler call with { event: 'piano-lesson-complete', learnerId: <this learner> }
  // assert a re-fetch happened
});

it('refetches on a school-topic program-day-bypass-changed event for THIS learner', async () => { /* same shape */ });

it('ignores a school-topic event for a DIFFERENT learnerId', async () => { /* assert NO extra fetch */ });
```

**Step 2: Run and verify it fails.**

**Step 3: Implement**

```js
import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useWebSocketSubscription } from '../../../hooks/useWebSocket.js';
import getLogger from '../../../lib/logging/Logger.js';

const REFRESH_MS = 15000;
const SCHOOL_TOPIC = 'school';
const RELEVANT_EVENTS = new Set(['piano-lesson-complete', 'program-day-bypass-changed']);

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-lesson-gate' });
  return _logger;
}

const notGated = (learnerId, status = 'ready') => ({ learnerId, status, gated: false, course: null, unit: null, lesson: null });

/**
 * Live gate state for the kiosk menu: true while `learnerId` owes an
 * unfinished piano-course lesson today. Fails OPEN on any read failure
 * (opposite of useSchoolGameAccess's fail-closed posture) — a network hiccup
 * must never lock a child out of the whole menu.
 */
export default function usePianoLessonGate(learnerId) {
  const guest = learnerId === 'guest';
  const requestGeneration = useRef(0);
  const [snapshot, setSnapshot] = useState(() => (guest || !learnerId
    ? { ...notGated(learnerId), status: 'ready' }
    : { ...notGated(learnerId), status: 'loading' }));

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!learnerId || guest) {
      setSnapshot({ ...notGated(learnerId), status: 'ready' });
      return;
    }
    try {
      const result = await DaylightAPI(`api/v1/school/lifecycle/learners/${encodeURIComponent(learnerId)}/piano-lesson-gate`);
      if (generation !== requestGeneration.current) return;
      const gated = result?.gated === true;
      const next = {
        learnerId, status: 'ready', gated,
        course: gated ? result.course ?? null : null,
        unit: gated ? result.unit ?? null : null,
        lesson: gated ? result.lesson ?? null : null,
      };
      setSnapshot((prev) => {
        if (prev.learnerId === learnerId && prev.gated !== gated) {
          logger().info('piano.lesson-gate.change', { learnerId, gated, reason: result?.reason ?? null });
        }
        return next;
      });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      logger().warn('piano.lesson-gate.read-failed', { learnerId, error: error?.message ?? String(error) });
      setSnapshot({ ...notGated(learnerId), status: 'error' }); // FAIL OPEN
    }
  }, [learnerId, guest]);

  useEffect(() => {
    let cancelled = false;
    const guarded = async () => { if (!cancelled) await refresh(); };
    guarded();
    const timer = learnerId && !guest ? setInterval(guarded, REFRESH_MS) : null;
    const onVisibility = () => { if (document.visibilityState === 'visible') guarded(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      requestGeneration.current += 1;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, learnerId, guest]);

  useWebSocketSubscription(SCHOOL_TOPIC, (msg) => {
    if (RELEVANT_EVENTS.has(msg?.event) && msg?.learnerId === learnerId) {
      logger().debug('piano.lesson-gate.ws-refresh', { learnerId, event: msg.event });
      refresh();
    }
  }, [learnerId, refresh]);

  const current = snapshot.learnerId === learnerId ? snapshot : { ...notGated(learnerId), status: guest || !learnerId ? 'ready' : 'loading' };
  return { ...current, refresh };
}

export { usePianoLessonGate };
```

**Step 4: Run and verify it passes.**

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/usePianoLessonGate.js frontend/src/modules/Piano/PianoKiosk/usePianoLessonGate.test.js
git commit -m "feat(piano): add usePianoLessonGate hook"
```

---

## Task 12: `TodaysLessonGate` component

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/TodaysLessonGate.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/TodaysLessonGate.test.jsx`

**Step 1: Write the failing tests**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TodaysLessonGate from './TodaysLessonGate.jsx';

vi.mock('./pianoContentOpen.js', () => ({
  openPianoCourseLesson: vi.fn(() => true),
}));
import { openPianoCourseLesson } from './pianoContentOpen.js';

const LESSON = { id: 'plex:2', title: 'Lesson 5: Broken Chords', thumbnail: '/api/img.jpg', description: 'Practice broken chords.' };
const COURSE = { id: 'plex:1', title: 'Hoffman Academy' };
const UNIT = { id: '3', title: 'Unit 3' };

describe('TodaysLessonGate', () => {
  it('renders lesson title, course/unit context, and description', () => {
    render(<TodaysLessonGate lesson={LESSON} unit={UNIT} course={COURSE} basePath="/piano" navigate={() => {}} />);
    expect(screen.getByText(/Lesson 5: Broken Chords/)).toBeInTheDocument();
    expect(screen.getByText(/Hoffman Academy/)).toBeInTheDocument();
    expect(screen.getByText(/Unit 3/)).toBeInTheDocument();
    expect(screen.getByText(/Practice broken chords/)).toBeInTheDocument();
  });

  it('renders with no thumbnail (absent-safe)', () => {
    render(<TodaysLessonGate lesson={{ ...LESSON, thumbnail: undefined }} unit={UNIT} course={COURSE} basePath="/piano" navigate={() => {}} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('tap calls openPianoCourseLesson with the right ids, no DoNow', () => {
    const navigate = vi.fn();
    render(<TodaysLessonGate lesson={LESSON} unit={UNIT} course={COURSE} basePath="/piano" navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: /start today.s lesson/i }));
    expect(openPianoCourseLesson).toHaveBeenCalledWith({ courseId: 'plex:1', lessonId: 'plex:2', basePath: '/piano', navigate });
  });

  it('falls back to the course-detail route when openPianoCourseLesson returns false', () => {
    openPianoCourseLesson.mockReturnValueOnce(false);
    const navigate = vi.fn();
    render(<TodaysLessonGate lesson={LESSON} unit={UNIT} course={COURSE} basePath="/piano" navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: /start today.s lesson/i }));
    expect(navigate).toHaveBeenCalledWith('/piano/videos/1');
  });
});
```

**Step 2: Run and verify it fails.**

**Step 3: Implement**

```jsx
import { useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { openPianoCourseLesson } from './pianoContentOpen.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-lesson-gate-view' });
  return _logger;
}

/**
 * TodaysLessonGate — replaces PianoMenu's tile grid + activity strip when the
 * active learner owes an unfinished piano-course lesson today. Single
 * purpose: show it, launch it. No DoNow dispatch — the tap originates on the
 * same tablet already showing the menu.
 */
export default function TodaysLessonGate({ lesson, unit, course, basePath, navigate }) {
  const onLaunch = useCallback(() => {
    logger().info('piano.lesson-gate.launch', { courseId: course?.id, lessonId: lesson?.id });
    const opened = openPianoCourseLesson({ courseId: course?.id, lessonId: lesson?.id, basePath, navigate });
    if (!opened && course?.id) {
      navigate(`${basePath}/videos/${String(course.id).replace(/^plex:/, '')}`);
    }
  }, [course, lesson, basePath, navigate]);

  return (
    <div className="piano-lesson-gate">
      {lesson?.thumbnail && <img className="piano-lesson-gate__thumb" src={lesson.thumbnail} alt="" />}
      <p className="piano-lesson-gate__context">
        {course?.title}{unit?.title ? ` · ${unit.title}` : ''}
      </p>
      <h2 className="piano-lesson-gate__title">{lesson?.title}</h2>
      {lesson?.description && <p className="piano-lesson-gate__description">{lesson.description}</p>}
      <button type="button" className="piano-lesson-gate__start" onClick={onLaunch}>
        Start today's lesson
      </button>
    </div>
  );
}
```

**Step 4: Run and verify it passes.**

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/TodaysLessonGate.jsx frontend/src/modules/Piano/PianoKiosk/TodaysLessonGate.test.jsx
git commit -m "feat(piano): add TodaysLessonGate component"
```

---

## Task 13: `PianoMenu` gate branch

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoMenu.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/PianoMenu.gate.test.js` (new, parallel to the existing `PianoMenu.curfew.test.js` — read that file first for the render/mock harness)

**Step 1: Write the failing tests** — mock `usePianoLessonGate` the same way `PianoMenu.curfew.test.js` mocks `usePianoCurfew`:

```js
// mirror PianoMenu.curfew.test.js's mocking setup for usePianoCurfew, PianoConfig,
// PianoUserContext, PianoMidiContext, useSchoolGameAccess, etc. — copy it, then add:

vi.mock('./usePianoLessonGate.js', () => ({ default: vi.fn() }));
import usePianoLessonGate from './usePianoLessonGate.js';

it('renders TodaysLessonGate instead of tiles when gated', () => {
  usePianoLessonGate.mockReturnValue({ gated: true, lesson: { id: 'plex:2', title: 'Lesson 5' }, unit: null, course: { id: 'plex:1', title: 'Hoffman' } });
  // usePianoCurfew mocked to return false
  // render PianoMenu, assert tile grid + activity strip are absent, gate content present
});

it('curfew outranks the gate', () => {
  usePianoLessonGate.mockReturnValue({ gated: true, lesson: {...}, unit: null, course: {...} });
  // usePianoCurfew mocked to return true
  // assert curfew message renders, NOT the lesson gate
});

it('normal menu when not gated', () => {
  usePianoLessonGate.mockReturnValue({ gated: false });
  // assert tile grid renders
});

it('the live keyboard strip renders in both the gated and normal branches', () => { /* ... */ });
```

**Step 2: Run and verify it fails.**

**Step 3: Implement** — in `PianoMenu.jsx`:

```jsx
import usePianoLessonGate from './usePianoLessonGate.js';
import TodaysLessonGate from './TodaysLessonGate.jsx';
```

```js
const lessonGate = usePianoLessonGate(currentUser);
const gated = !curfew && lessonGate.gated; // curfew wins outright
```

Replace the body's `PianoMenuActivity` + `<ul className="piano-menu__tiles">` block with a branch:

```jsx
{gated ? (
  <TodaysLessonGate
    lesson={lessonGate.lesson}
    unit={lessonGate.unit}
    course={lessonGate.course}
    basePath={basePath}
    navigate={navigate}
  />
) : (
  <>
    <PianoMenuActivity disabled={curfew} onOpenCourse={/* unchanged */} />
    <ul className="piano-menu__tiles" style={{ '--tile-cols': cols }}>
      {/* unchanged tile map */}
    </ul>
  </>
)}
```

Leave the curfew branch (`{curfew && <p className="piano-home__curfew">...}`) and the `<div className="piano-home__keyboard">` block exactly where they are — both must render regardless of `gated`.

**Step 4: Run and verify it passes** — also re-run `PianoMenu.curfew.test.js` and `PianoMenu.modes.test.js` to confirm no regression:

```
npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoMenu.gate.test.js frontend/src/modules/Piano/PianoKiosk/PianoMenu.curfew.test.js frontend/src/modules/Piano/PianoKiosk/PianoMenu.modes.test.js
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/PianoMenu.jsx frontend/src/modules/Piano/PianoKiosk/PianoMenu.gate.test.js
git commit -m "feat(piano): gate PianoMenu behind today's unfinished lesson"
```

---

## Task 14: `schoolApi.js` client functions

**Files:**
- Modify: `frontend/src/modules/School/schoolApi.js`

No dedicated test — covered by Task 15's panel test via a mock of `schoolApi`. Add near the existing `attestations`/`postAttestation` entries (~line 200):

```js
programDayBypasses: (learnerId) => req(learnerId ? `/program-day-bypasses?learnerId=${encodeURIComponent(learnerId)}` : '/program-day-bypasses'),
grantProgramDayBypass: (body) => req('/program-day-bypasses', body),
retractProgramDayBypass: (bypassId, body) => req(`/program-day-bypasses/${encodeURIComponent(bypassId)}/retract`, body),
pianoLessonGate: (learnerId) => req(`/lifecycle/learners/${encodeURIComponent(learnerId)}/piano-lesson-gate`),
```

**Commit**

```bash
git add frontend/src/modules/School/schoolApi.js
git commit -m "feat(school): add program-day-bypass and piano-lesson-gate API client functions"
```

---

## Task 15: `ProgramDayBypassPanel` (Teacher Console)

**Files:**
- Create: `frontend/src/modules/School/teacher/panels/ProgramDayBypassPanel.jsx`
- Test: `frontend/src/modules/School/teacher/panels/ProgramDayBypassPanel.test.jsx`

Modeled directly on `AttestationPanel.jsx` — read it again alongside `useTeacherWrite.js` before writing.

**Step 1: Write the failing tests** — mirror `AttestationPanel.test.jsx` if one exists (check first: `find frontend/src/modules/School/teacher/panels -iname "AttestationPanel.test*"`); if none exists, base the harness on `ActiveOverrides.jsx`'s test file instead. Cases to cover:

```jsx
// mock schoolApi.programDayBypasses / .pianoLessonGate / .grantProgramDayBypass / .retractProgramDayBypass
// mock useTeacherWrite (or exercise it with a fake TeacherProfileContext, matching whatever AttestationPanel's test does)

it('shows "not enrolled" copy when the gate read says not-enrolled', () => { /* ... */ });
it('shows the owed lesson title from the gate read before granting', () => { /* ... */ });
it('shows "already done today" when the gate read says gated:false, reason done', () => { /* ... */ });
it('grant requires a reason (button disabled until non-empty)', () => { /* ... */ });
it('granting calls schoolApi.grantProgramDayBypass with learnerId/reason/decidedBy and refreshes both reads on success', () => { /* ... */ });
it('an active bypass renders decidedBy/reason and a Retract control instead of the grant button', () => { /* ... */ });
it('retract requires a reason and calls schoolApi.retractProgramDayBypass', () => { /* ... */ });
```

**Step 2: Run and verify it fails.**

**Step 3: Implement**

```jsx
import { useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { teacherDate } from '../teacherDates.js';

export default function ProgramDayBypassPanel({ learnerId, learnerName }) {
  const log = usePanelFetch(() => schoolApi.programDayBypasses(learnerId), {
    deps: [learnerId], panel: 'program-day-bypass',
  });
  const gate = usePanelFetch(() => schoolApi.pianoLessonGate(learnerId), {
    deps: [learnerId], panel: 'program-day-bypass-gate', notFoundAs: 'unavailable',
  });
  const { run, busy, errors } = useTeacherWrite({ panel: 'program-day-bypass' });
  const [reason, setReason] = useState('');
  const [retractReason, setRetractReason] = useState('');

  const active = (log.data?.active ?? []).find((r) => r.learnerId === learnerId) ?? null;
  const statusLine = gate.state !== 'ok' ? null
    : gate.data?.reason === 'not-enrolled' ? 'No piano course is assigned to this student.'
    : gate.data?.gated ? `Owed today: ${gate.data.lesson?.title ?? 'a lesson'}`
    : 'Already done today.';

  const grant = () => run('grant', ({ actorId, pin }) => schoolApi.grantProgramDayBypass({
    learnerId, programId: 'piano-course', reason, decidedBy: actorId, pin,
  }), { onSuccess: () => { setReason(''); log.retry(); gate.retry(); } });

  const retract = () => run('retract', ({ actorId, pin }) => schoolApi.retractProgramDayBypass(active.bypassId, {
    reason: retractReason, retractedBy: actorId, pin,
  }), { onSuccess: () => { setRetractReason(''); log.retry(); gate.retry(); } });

  return (
    <PanelFrame title="Today's piano lesson" state={log.state} retry={log.retry} alwaysRender>
      {(log.state === 'ok' || log.state === 'empty') && (
        <>
          {statusLine && <p className="teacher-panel__status">{statusLine}</p>}
          {active ? (
            <div className="teacher-enrichment__row">
              <span>Excused by {active.decidedBy} — {active.reason}</span>
              <span>{teacherDate(active.decidedAt)}</span>
              <textarea
                aria-label="Retract reason"
                placeholder="Why retract? (required)"
                value={retractReason}
                onChange={(e) => setRetractReason(e.target.value)}
              />
              <button type="button" disabled={busy === 'retract' || !retractReason.trim()} onClick={retract}>Retract</button>
              {errors.retract && <p className="teacher-panel__error">{errors.retract}</p>}
            </div>
          ) : (
            <div className="teacher-enrichment__form">
              <textarea
                aria-label="Reason"
                placeholder="Why excuse today's lesson — recital, illness, travel? (required)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button type="button" disabled={busy === 'grant' || !reason.trim()} onClick={grant}>
                Excuse today's piano lesson
              </button>
              {errors.grant && <p className="teacher-panel__error">{errors.grant}</p>}
            </div>
          )}
        </>
      )}
    </PanelFrame>
  );
}
```

**Step 4: Run and verify it passes.**

**Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/panels/ProgramDayBypassPanel.jsx frontend/src/modules/School/teacher/panels/ProgramDayBypassPanel.test.jsx
git commit -m "feat(school): add ProgramDayBypassPanel to the Teacher Console"
```

---

## Task 16: Wire the panel into the console

**Files:**
- Modify: `frontend/src/modules/School/teacher/WorkspaceViews.jsx`
- Modify: `frontend/src/modules/School/teacher/panels/ActiveOverrides.jsx`
- Modify: `frontend/src/modules/School/teacher/interventions.js`

**Step 1:** In `WorkspaceViews.jsx`, import `ProgramDayBypassPanel` and add it to `LearnerOperationsView` (~line 352-361), beside `AttestationPanel`:

```jsx
import ProgramDayBypassPanel from './panels/ProgramDayBypassPanel.jsx';
```

```jsx
export function LearnerOperationsView({ learnerId, learnerName, kids }) {
  return (
    <div className="teacher-view">
      <div className="teacher-view__heading">...</div>
      <InterventionsIndex learnerId={learnerId} />
      <AttestationPanel learnerId={learnerId} learnerName={learnerName} />
      <ProgramDayBypassPanel learnerId={learnerId} learnerName={learnerName} />
      <ReassignPanel learnerId={learnerId} learnerName={learnerName} kids={kids} />
    </div>
  );
}
```

**Step 2:** In `ActiveOverrides.jsx`, add a third `usePanelFetch` for the bypass ledger (no `learnerId` filter — school-wide view) and a third group, mirroring the existing `overrides`/`attestations` pattern exactly:

```jsx
const bypasses = usePanelFetch(() => schoolApi.programDayBypasses(), { panel: 'active-program-bypasses', nullAs: 'empty' });
```

```jsx
const bypassRows = bypasses.data?.active ?? [];
const empty = !overrideRows.length && !attestationRows.length && !bypassRows.length;
const state = overrides.state === 'loading' || attestations.state === 'loading' || bypasses.state === 'loading'
  ? 'loading' : empty ? 'empty' : 'ok';
```

Update `retry` to include `bypasses.retry()`, and add a third `<div className="teacher-overrides__group" data-testid="active-program-bypasses">` block after the attestations one:

```jsx
{bypassRows.length > 0 && (
  <div className="teacher-overrides__group" data-testid="active-program-bypasses">
    <h3>Today's program bypasses</h3>
    <ul>
      {bypassRows.map((b) => (
        <li key={b.bypassId}>
          <span>{nameFor(b.learnerId)} · {b.programId}</span>
          <span>by {b.decidedBy}{b.decidedAt ? ` · ${teacherDate(b.decidedAt)}` : ''} — {b.reason}</span>
        </li>
      ))}
    </ul>
  </div>
)}
```

**Step 3:** In `interventions.js`, add one entry after `completion-credit` (or wherever fits alphabetically/thematically among the `scope: 'learner'` rows):

```js
{
  id: 'program-day-bypass', scope: 'learner', label: "Excuse today's piano lesson",
  useWhen: "Today's piano lesson shouldn't be required — recital, illness, travel.",
  where: 'Student → Operations.', href: learnerOps,
},
```

**Step 4: Update existing tests that snapshot these files' output** — `ActiveOverrides.jsx` almost certainly has a test file; find and extend it:

```bash
find frontend/src/modules/School/teacher/panels -iname "ActiveOverrides.test*"
```

Add a test asserting the new group renders when `schoolApi.programDayBypasses()` returns active rows, and is absent when empty. Also check `WorkspaceViews.jsx`'s own tests (`WorkspaceViews.history.test.jsx`, etc.) for anything that snapshots `LearnerOperationsView`'s children and update if needed.

**Step 5: Run the whole Teacher Console test slice**

```bash
npx vitest run frontend/src/modules/School/teacher
```

**Step 6: Commit**

```bash
git add frontend/src/modules/School/teacher/WorkspaceViews.jsx frontend/src/modules/School/teacher/panels/ActiveOverrides.jsx frontend/src/modules/School/teacher/interventions.js <updated test files>
git commit -m "feat(school): surface program-day bypasses in Teacher Console operations + overrides"
```

---

## Task 17: Full verification pass

**Step 1: Full backend suite for every touched/new file**

```bash
npx vitest run \
  backend/src/1_adapters/persistence/yaml/YamlProgramDayBypassStore.test.mjs \
  tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs \
  backend/src/3_applications/school/usecases/ManageProgramDayBypass.test.mjs \
  backend/src/3_applications/school/usecases/GetPianoLessonGate.test.mjs \
  backend/src/3_applications/piano/usecases/GetPlayableUnits.test.mjs
```

Plus whatever router test files Tasks 7-8 created.

**Step 2: Full frontend suite for every touched/new file**

```bash
npx vitest run \
  frontend/src/modules/Piano/PianoKiosk/usePianoLessonGate.test.js \
  frontend/src/modules/Piano/PianoKiosk/TodaysLessonGate.test.jsx \
  frontend/src/modules/Piano/PianoKiosk/PianoMenu.gate.test.js \
  frontend/src/modules/Piano/PianoKiosk/PianoMenu.curfew.test.js \
  frontend/src/modules/Piano/PianoKiosk/PianoMenu.modes.test.js \
  frontend/src/modules/School/teacher/panels/ProgramDayBypassPanel.test.jsx \
  frontend/src/modules/School/teacher
```

**Step 3: Lint** (whatever the project's standard command is — check `package.json` scripts):

```bash
npm run lint 2>&1 | tail -60
```

**Step 4: Manual smoke checklist** (per design doc §12 — needs a real dev server + tablet or browser against a household with a `piano-course` enrollment; document as a TODO for the user if it can't run headlessly in this environment):

- Pick an enrolled, not-yet-done learner at the kiosk → single lesson card, no tile grid.
- Complete the lesson → menu returns to normal without a reload.
- Re-pick that learner → normal menu (day already done).
- From the Teacher Console (a different device/tab), grant a bypass for a different not-done learner → kiosk clears within ~1s (WS) or ≤15s (poll fallback).
- Retract the bypass → gate returns for that learner on next pick/poll.
- With curfew active, confirm the curfew view wins over the lesson gate.
- Confirm sitting at the piano and playing still auto-enters Studio while the gate is showing (no menu tap).

**Step 5:** Report results to the user before merging. Do not merge/finish the branch without an explicit go-ahead — see `superpowers:finishing-a-development-branch`.

---

## Notes for whoever executes this plan

- Every "Modify" step above gives an approximate line number from the design-review pass on 2026-08-27 — **re-read the target file immediately before editing**, since line numbers drift as earlier tasks land.
- Backend tests run via `npx vitest run <path>` directly, **not** through the `--only=domain` harness — see `CLAUDE.md`/memory `reference_isolated_domain_tests_never_run`: that harness mis-routes vitest files to Jest.
- Never start a second `node backend/index.js` against the real household data tree while testing this — see `CLAUDE.local.md`'s standing warning. All backend verification here is `vitest run` against isolated/mocked dependencies, not a live server.
- If any "Files: Test" step above references an existing test file to clone/extend and it turns out not to exist where expected, search first (`find`/`grep`) rather than guessing a path — the file layout notes here are from a point-in-time read and may have shifted.
