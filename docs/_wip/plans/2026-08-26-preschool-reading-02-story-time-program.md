# Story-Time Program — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the two preschoolers a daily school obligation — "finish N stories today" — that is an enrollment with **no course**, satisfied by a reading log, and that turns their tile green on the School board.

**Architecture:** Story-time joins the existing *program* lane: an entry in `assignment.programs[]` with `courseId: null` and `cadence: 'daily'`, whose evidence is owned by a new `StoryTimeProgramLauncher`. The launcher answers `doneToday` by counting rows in a reading log sharded **by study day**, so no timezone reconciliation is needed. Nothing in `agenda.mjs`, `completion.mjs`, or `AgendaStatusBoard` changes — they already read `doneToday`.

**Tech Stack:** Node ESM (`.mjs`), vitest, js-yaml.

**Learner ids:** use `learner-c` / `learner-d` in all code, tests and docs. Substitute the real roster ids ONLY in config under `$DAYLIGHT_BASE_PATH`, which is outside the repo. A commit hook refuses real household first names.

**Read first — in this order:**
1. `backend/src/3_applications/school/assignedProgramPlan.mjs` — the whole program lane is 90 lines
2. `backend/src/3_applications/school/SurfaceProgramLauncher.mjs` — read its **header comment** on the study-day boundary; this plan deliberately avoids the two-shard problem it describes
3. `backend/src/3_applications/school/FlashcardProgramLauncher.mjs` — the shortest possible launcher
4. `backend/src/1_adapters/persistence/yaml/YamlAgendaCooldownStore.mjs` — the YAML store house style (never-throws-on-read, write chain, id validation)

**Run one test file with:** `npx vitest run <path> --reporter=dot`

---

## Design decisions, settled — do not relitigate mid-execution

**The log shards by study day, not by UTC date.** `SurfaceProgramLauncher` reads DoNow's dispatch log, which shards by UTC, and therefore has to read two shards and filter by `isSameStudyDay` — a 5:01pm PDT event lands in tomorrow's UTC shard. We own this store, so we shard by the household's own study-day key at append time and `doneToday` is a single-shard read. Compute the key with `studyDayForInstant` from `#domains/school/studyDay.mjs`; never with `toISOString().slice(0,10)`.

**One enrollment per learner.** `corpusId` is null, so `SetAssignments`'s dedupe key `story-time\0` refuses a second story-time enrollment for the same learner.

**`target` lives in the enrollment policy, not in `school.yml`.** Different children get different counts, and the number is a per-learner teaching decision.

**The subject is `english`.** It is one of the nine fixed shelves (`frontend/src/modules/School/home/subjects.js`), so the board gets the right icon with no new mapping.

**A read is logged when the audiobook FINISHES, not when it starts.** Plan 3 supplies that signal. Task 7 here gives a CLI so the whole chain is verifiable before plan 3 exists.

---

### Task 1: The reading-log port

**Files:**
- Create: `backend/src/3_applications/school/ports/IReadingLogStore.mjs`

**Step 1: Write the port**

No test — it is an interface with throwing stubs, matching `IAgendaCooldownStore`'s shape.

```js
/**
 * IReadingLogStore — durable evidence that a learner finished a story.
 *
 * Records, not runtime: this is what a report card is reconstructed from, so it
 * lives under `school/records/` rather than `school/runtime/`, and it is never
 * pruned by a cooldown or a session close.
 *
 * SHARDED BY STUDY DAY, not by UTC date. The study day is 4am->4am in the
 * household timezone; sharding by the key the agenda actually asks about means
 * `countForDay` is one file read with no timezone reconciliation. See
 * `SurfaceProgramLauncher`'s header for what the alternative costs.
 */
export class IReadingLogStore {
  /**
   * @param {{learnerId: string, studyDay: string, at: string, contentId: string|null,
   *          title: string|null, tagUid: string|null, location: string|null}} row
   * @returns {Promise<object>} the stored row
   */
  async append() { throw new Error('IReadingLogStore.append not implemented'); }

  /**
   * @param {string} learnerId
   * @param {string} studyDay - YYYY-MM-DD
   * @returns {Promise<object[]>} rows for that learner and study day, oldest first
   */
  async listForDay() { throw new Error('IReadingLogStore.listForDay not implemented'); }
}

export default IReadingLogStore;
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/school/ports/IReadingLogStore.mjs
git commit -m "feat(school): IReadingLogStore port"
```

---

### Task 2: The YAML reading-log store

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlReadingLogStore.mjs`
- Test: `tests/isolated/adapter/persistence/YamlReadingLogStore.test.mjs`

Storage path: `<householdPath>/school/records/reading/{learnerId}/{studyDay}.yml`, holding `{ learnerId, studyDay, reads: [ ... ] }`.

**Step 1: Write the failing test**

```js
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlReadingLogStore } from '#adapters/persistence/yaml/YamlReadingLogStore.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
let dir;
const makeStore = () => new YamlReadingLogStore({
  configService: { getHouseholdPath: () => dir }, logger: silent,
});

beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'readinglog-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

it('appends a read and reads it back for that study day', async () => {
  const store = makeStore();
  await store.append({ learnerId: 'learner-c', studyDay: '2026-08-26', at: '2026-08-26T18:04:00.000Z', contentId: 'plex:620681', title: 'The Jungle Book', tagUid: '04215172cc2a81', location: 'livingroom' });
  const rows = await store.listForDay('learner-c', '2026-08-26');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ contentId: 'plex:620681', title: 'The Jungle Book' });
});

it('keeps two reads on the same day in append order', async () => {
  const store = makeStore();
  await store.append({ learnerId: 'learner-c', studyDay: '2026-08-26', at: '2026-08-26T18:00:00.000Z', contentId: 'plex:1', title: 'One' });
  await store.append({ learnerId: 'learner-c', studyDay: '2026-08-26', at: '2026-08-26T19:00:00.000Z', contentId: 'plex:2', title: 'Two' });
  expect((await store.listForDay('learner-c', '2026-08-26')).map((r) => r.title)).toEqual(['One', 'Two']);
});

it('scopes reads per learner', async () => {
  const store = makeStore();
  await store.append({ learnerId: 'learner-c', studyDay: '2026-08-26', at: '2026-08-26T18:00:00.000Z', contentId: 'plex:1' });
  expect(await store.listForDay('learner-d', '2026-08-26')).toEqual([]);
});

it('answers an empty list for a day with no file, and never throws', async () => {
  expect(await makeStore().listForDay('learner-c', '2026-01-01')).toEqual([]);
});

it('refuses a path-traversing learner id', async () => {
  await expect(makeStore().append({ learnerId: '../../etc', studyDay: '2026-08-26', at: 'x' })).rejects.toThrow();
});

it('refuses a malformed study day', async () => {
  await expect(makeStore().append({ learnerId: 'learner-c', studyDay: 'not-a-day', at: 'x' })).rejects.toThrow();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/persistence/YamlReadingLogStore.test.mjs --reporter=dot`
Expected: FAIL — cannot resolve `#adapters/persistence/yaml/YamlReadingLogStore.mjs`

**Step 3: Write the implementation**

Model it on `YamlAgendaCooldownStore.mjs`: same `#writeChain = Promise.resolve()` serialization (two books finishing seconds apart must not lose a row to a read-modify-write race), same `LEARNER_ID_RE` guard, same never-throw-on-read posture. Add a `STUDY_DAY_RE = /^\d{4}-\d{2}-\d{2}$/` guard.

`listForDay` returns `[]` for a missing OR corrupt file and logs the corrupt case — fail-open in the direction of "no evidence", never "crash the agenda".

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/persistence/YamlReadingLogStore.test.mjs --reporter=dot`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlReadingLogStore.mjs tests/isolated/adapter/persistence/YamlReadingLogStore.test.mjs
git commit -m "feat(school): YAML reading log, sharded by study day"
```

---

### Task 3: `StoryTimeProgramLauncher`

**Files:**
- Create: `backend/src/3_applications/school/StoryTimeProgramLauncher.mjs`
- Test: `tests/isolated/application/school/StoryTimeProgramLauncher.test.mjs`

**Step 1: Write the failing test**

```js
import { StoryTimeProgramLauncher } from '#apps/school/StoryTimeProgramLauncher.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
const at = (iso) => () => new Date(iso);

function makeLauncher({ rows = [], target = 2, now = '2026-08-26T18:00:00.000Z' } = {}) {
  return new StoryTimeProgramLauncher({
    readingLog: { listForDay: async () => rows },
    assignments: { get: async () => ({ programs: [{ programId: 'story-time', target }] }) },
    timezone: 'America/Los_Angeles', clock: at(now), logger: silent,
  });
}

it('is not done with no reads', async () => {
  const s = await makeLauncher({ rows: [] }).status({ userId: 'learner-c' });
  expect(s.doneToday).toBe(false);
  expect(s.progressLabel).toBe('0 of 2 stories');
});

it('is not done partway', async () => {
  const s = await makeLauncher({ rows: [{ title: 'One' }] }).status({ userId: 'learner-c' });
  expect(s.doneToday).toBe(false);
  expect(s.progressLabel).toBe('1 of 2 stories');
});

it('is done at the target', async () => {
  const s = await makeLauncher({ rows: [{ title: 'One' }, { title: 'Two' }] }).status({ userId: 'learner-c' });
  expect(s.doneToday).toBe(true);
  expect(s.progressLabel).toBe('2 of 2 stories');
});

it('stays done past the target — extra stories are never a penalty', async () => {
  const s = await makeLauncher({ rows: [{}, {}, {}] }).status({ userId: 'learner-c' });
  expect(s.doneToday).toBe(true);
  expect(s.progressLabel).toBe('3 of 2 stories');
});

it('is never terminal — a daily obligation does not complete', async () => {
  const s = await makeLauncher({ rows: [{}, {}] }).status({ userId: 'learner-c' });
  expect(s.terminal).toBe(false);
});

it('asks the reading log for the STUDY day, not the UTC date', async () => {
  const asked = [];
  const launcher = new StoryTimeProgramLauncher({
    readingLog: { listForDay: async (id, day) => { asked.push([id, day]); return []; } },
    assignments: { get: async () => ({ programs: [{ programId: 'story-time', target: 2 }] }) },
    // 01:30 UTC on the 27th is 18:30 on the 26th in Los Angeles, and the study
    // day does not roll until 4am — so this is still the 26th.
    timezone: 'America/Los_Angeles', clock: at('2026-08-27T01:30:00.000Z'), logger: silent,
  });
  await launcher.status({ userId: 'learner-c' });
  expect(asked).toEqual([['learner-c', '2026-08-26']]);
});

it('reports an error rather than a false zero when the log is unreadable', async () => {
  const launcher = new StoryTimeProgramLauncher({
    readingLog: { listForDay: async () => { throw new Error('disk gone'); } },
    assignments: { get: async () => ({ programs: [{ programId: 'story-time', target: 2 }] }) },
    timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
  });
  const s = await launcher.status({ userId: 'learner-c' });
  expect(s.error).toBe(true);
  expect(s.doneToday).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/school/StoryTimeProgramLauncher.test.mjs --reporter=dot`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```js
/**
 * StoryTimeProgramLauncher — the `IProgramLauncher` for a daily reading
 * obligation that has NO COURSE behind it.
 *
 * There is no curriculum here: no units, no sequence, no gate, no grade. The
 * only question is "how many stories today", so `doneToday` is a count against
 * a per-learner target and the program is NEVER terminal — tomorrow it asks
 * again. That is what distinguishes it from `cadence: 'once'` programs, which
 * leave the agenda when their launcher reports terminal.
 *
 * THE TARGET IS PER LEARNER and lives on the enrollment, because how many
 * stories a four-year-old owes is a teaching decision, not a household setting.
 *
 * AN UNREADABLE LOG IS `error: true`, NOT ZERO. A false zero would show a child
 * who read three books as owing three books; `error` makes the agenda report
 * the program unavailable and completion indeterminate, which is the honest
 * state. See `resolveDayCompletion`'s `indeterminate` branch.
 */
import { studyDayForInstant } from '#domains/school/studyDay.mjs';

export const STORY_TIME_PROGRAM_ID = 'story-time';
export const DEFAULT_STORY_TARGET = 2;

export class StoryTimeProgramLauncher {
  #readingLog; #assignments; #timezone; #clock; #logger;

  constructor({ readingLog, assignments, timezone = null, clock = () => new Date(), logger = console } = {}) {
    if (!readingLog) throw new Error('StoryTimeProgramLauncher requires a readingLog');
    if (!assignments) throw new Error('StoryTimeProgramLauncher requires an assignments store');
    this.#readingLog = readingLog;
    this.#assignments = assignments;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
  }

  get id() { return STORY_TIME_PROGRAM_ID; }

  /** The learner's own target, or the default when the enrollment omits one. */
  async #targetFor(userId) {
    try {
      const assignment = await this.#assignments.get(userId);
      const entry = (assignment?.programs ?? []).find((p) => p?.programId === STORY_TIME_PROGRAM_ID);
      return Number.isInteger(entry?.target) && entry.target > 0 ? entry.target : DEFAULT_STORY_TARGET;
    } catch {
      return DEFAULT_STORY_TARGET;
    }
  }

  studyDay() {
    return studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone });
  }

  async status({ userId }) {
    const target = await this.#targetFor(userId);
    const day = this.studyDay();
    let rows;
    try {
      rows = await this.#readingLog.listForDay(userId, day);
    } catch (err) {
      this.#logger.error?.('school.story-time.log-unreadable', { userId, day, error: err.message });
      return { error: true, doneToday: false, progressLabel: 'Reading log unavailable', score: null, terminal: false };
    }
    const count = Array.isArray(rows) ? rows.length : 0;
    return {
      doneToday: count >= target,
      progressLabel: `${count} of ${target} ${target === 1 ? 'story' : 'stories'}`,
      score: null,
      terminal: false,
      count,
      target,
      reads: rows ?? [],
    };
  }

  /**
   * Story time happens at the TV, not on the Portal. Until the living-room
   * reading session ships (plan 03) this is a sentence, not a dispatch — and a
   * sentence naming the room is what the self-service card is for.
   */
  async issueLaunchTarget() {
    return { kind: 'message', message: 'Story time happens on the living room TV — tap your card there.' };
  }

  async launch() {
    return { ok: false, reason: 'story-time is launched at the living-room reader' };
  }
}

export default StoryTimeProgramLauncher;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/school/StoryTimeProgramLauncher.test.mjs --reporter=dot`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/StoryTimeProgramLauncher.mjs tests/isolated/application/school/StoryTimeProgramLauncher.test.mjs
git commit -m "feat(school): story-time program launcher"
```

---

### Task 4: Project story-time into the agenda

**Files:**
- Modify: `backend/src/3_applications/school/assignedProgramPlan.mjs` (`appendAssignedProgramEntries`)
- Test: `tests/isolated/application/school/assignedProgramPlan.test.mjs`

**Step 1: Write the failing test**

```js
import { appendAssignedProgramEntries } from '#apps/school/assignedProgramPlan.mjs';

it('projects a story-time enrollment as a daily, courseless english entry', () => {
  const plan = { entries: [] };
  appendAssignedProgramEntries(plan, { programs: [{ programId: 'story-time', target: 2 }] });
  expect(plan.entries).toHaveLength(1);
  expect(plan.entries[0]).toMatchObject({
    unitId: 'story-time:daily',
    program: 'story-time',
    programInstance: 'daily',
    subject: 'english',
    courseId: null,
    cadence: 'daily',
    elective: false,
  });
});

it('uses the enrollment title when one is authored', () => {
  const plan = { entries: [] };
  appendAssignedProgramEntries(plan, { programs: [{ programId: 'story-time', title: 'Story time' }] });
  expect(plan.entries[0].title).toBe('Story time');
});

it('leaves other program kinds untouched', () => {
  const plan = { entries: [] };
  appendAssignedProgramEntries(plan, { programs: [{ programId: 'flashcards', deckId: 'd1' }] });
  expect(plan.entries[0].program).toBe('flashcards');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/school/assignedProgramPlan.test.mjs --reporter=dot`
Expected: FAIL — `expected [] to have a length of 1`

**Step 3: Write the implementation**

Add a branch inside the `for (const enrollment of assignment?.programs ?? [])` loop:

```js
    if (enrollment?.programId === 'story-time') {
      // One instance per learner — there is no corpus to distinguish, and
      // SetAssignments' dedupe key already refuses a second one.
      plan.entries.push(baseEntry({
        unitId: 'story-time:daily',
        title: enrollment.title ?? 'Story time',
        subject: enrollment.subject ?? 'english',
        program: 'story-time',
        programInstance: 'daily',
      }));
    }
```

`baseEntry` already sets `courseId: null`, `cadence: 'daily'`, `elective: false`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/school/ --reporter=dot`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/assignedProgramPlan.mjs tests/isolated/application/school/assignedProgramPlan.test.mjs
git commit -m "feat(school): project story-time into the daily agenda"
```

---

### Task 5: Validate a story-time enrollment

**Files:**
- Create: `backend/src/2_domains/school/storyTime.mjs`
- Test: `tests/isolated/domain/school/storyTime.test.mjs`

**Step 1: Write the failing test**

```js
import { validateStoryTimeEnrollment } from '#domains/school/storyTime.mjs';

it('accepts a bare enrollment and applies the default target', () => {
  const r = validateStoryTimeEnrollment({ programId: 'story-time' });
  expect(r.errors).toEqual([]);
  expect(r.enrollment).toEqual({ programId: 'story-time', corpusId: null, target: 2, subject: 'english', title: null });
});

it('accepts an explicit target', () => {
  expect(validateStoryTimeEnrollment({ programId: 'story-time', target: 3 }).enrollment.target).toBe(3);
});

it('refuses a zero or negative target', () => {
  expect(validateStoryTimeEnrollment({ programId: 'story-time', target: 0 }).errors[0]).toMatch(/target/);
  expect(validateStoryTimeEnrollment({ programId: 'story-time', target: -1 }).errors[0]).toMatch(/target/);
});

it('refuses a non-integer target', () => {
  expect(validateStoryTimeEnrollment({ programId: 'story-time', target: 1.5 }).errors[0]).toMatch(/target/);
});

it('refuses an absurd target rather than storing an unmeetable obligation', () => {
  expect(validateStoryTimeEnrollment({ programId: 'story-time', target: 100 }).errors[0]).toMatch(/target/);
});

it('refuses an unknown subject', () => {
  expect(validateStoryTimeEnrollment({ programId: 'story-time', subject: 'nonsense' }).errors[0]).toMatch(/subject/);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/school/storyTime.test.mjs --reporter=dot`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Bound the target with a `MAX_STORY_TARGET = 20` — an unmeetable obligation is a config mistake that would leave a child permanently red, and refusing it at write time is cheaper than diagnosing it later. Validate `subject` against `SUBJECT_IDS` from `#domains/school/curriculum/unitValidation.mjs`. Return the `{ errors, enrollment }` shape every other program validator returns (see `schoolLifecycle.mjs:1053`).

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/domain/school/storyTime.test.mjs --reporter=dot`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/storyTime.mjs tests/isolated/domain/school/storyTime.test.mjs
git commit -m "feat(school): story-time enrollment validation"
```

---

### Task 6: Wire the launcher, store and validator into composition

**Files:**
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs` — the store block, the `launchers` map (`:422-470`), and the `programValidators` map (`:1053`)

**Step 1: Construct the store**

Alongside the other `stores.*` construction:

```js
  const { YamlReadingLogStore } = await import('#adapters/persistence/yaml/YamlReadingLogStore.mjs');
  stores.readingLog = new YamlReadingLogStore({ configService, logger });
```

**Step 2: Register the launcher**

After the `piano-course` registration, before the `school.yml programs:` loop (so a config entry reusing the id trips that loop's collision check):

```js
  // Story time — a daily obligation with no course behind it. Unconditional:
  // its only dependencies are a YAML store and the assignments store, both of
  // which always exist, so unlike the service-backed launchers above there is
  // no degraded composition in which this should silently vanish.
  launchers.set(STORY_TIME_PROGRAM_ID, new StoryTimeProgramLauncher({
    readingLog: stores.readingLog, assignments: stores.assignments, timezone, clock, logger,
  }));
```

with the imports at the top of the file, beside the other launcher imports.

**Step 3: Register the validator**

In the `programValidators` Map at `:1053`, add — unconditionally, matching the launcher:

```js
      ['story-time', (raw) => validateStoryTimeEnrollment(raw)],
```

**Step 4: Verify**

```bash
npm run check:parse
npx vitest run tests/isolated/application/school/ tests/isolated/domain/school/ --reporter=dot
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/5_composition/modules/schoolLifecycle.mjs
git commit -m "feat(school): wire the story-time program"
```

---

### Task 7: A use case and CLI to record a read

Plan 3 supplies the real signal. This makes plan 2 verifiable on its own, and stays useful afterwards as the manual-correction path (a book finished on a lap, a mis-scanned tag).

**Files:**
- Create: `backend/src/3_applications/school/usecases/RecordStoryRead.mjs`
- Modify: `cli/school.mjs` — add `ops read <learnerId> [--title=] [--content=] [--apply]`
- Test: `tests/isolated/application/school/recordStoryRead.test.mjs`

**Step 1: Write the failing test**

```js
import { RecordStoryRead } from '#apps/school/usecases/RecordStoryRead.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };

it('appends a read stamped with the current study day', async () => {
  const appended = [];
  const useCase = new RecordStoryRead({
    readingLog: { append: async (row) => { appended.push(row); return row; } },
    timezone: 'America/Los_Angeles',
    clock: () => new Date('2026-08-27T01:30:00.000Z'),
    logger: silent,
  });
  await useCase.execute({ learnerId: 'learner-c', title: 'The Jungle Book', contentId: 'plex:620681', tagUid: '04215172cc2a81', location: 'livingroom' });
  expect(appended[0]).toMatchObject({ learnerId: 'learner-c', studyDay: '2026-08-26', title: 'The Jungle Book' });
});

it('refuses a read with no learner', async () => {
  const useCase = new RecordStoryRead({ readingLog: { append: async () => {} }, logger: silent });
  await expect(useCase.execute({ title: 'x' })).rejects.toThrow(/learnerId/);
});

it('broadcasts a story-read acknowledgement when a bus is wired', async () => {
  const sent = [];
  const useCase = new RecordStoryRead({
    readingLog: { append: async (r) => r },
    eventBus: { broadcast: (topic, payload) => sent.push({ topic, payload }) },
    timezone: 'America/Los_Angeles', clock: () => new Date('2026-08-26T18:00:00.000Z'), logger: silent,
  });
  await useCase.execute({ learnerId: 'learner-c', title: 'The Jungle Book' });
  expect(sent[0].topic).toBe('school');
  expect(sent[0].payload).toMatchObject({ event: 'story-read', learnerId: 'learner-c', title: 'The Jungle Book' });
});

it('still records the read when the broadcast throws', async () => {
  const useCase = new RecordStoryRead({
    readingLog: { append: async (r) => r },
    eventBus: { broadcast: () => { throw new Error('bus down'); } },
    timezone: 'America/Los_Angeles', clock: () => new Date('2026-08-26T18:00:00.000Z'), logger: silent,
  });
  await expect(useCase.execute({ learnerId: 'learner-c', title: 'x' })).resolves.toMatchObject({ learnerId: 'learner-c' });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/school/recordStoryRead.test.mjs --reporter=dot`
Expected: FAIL — module not found

**Step 3: Write the implementation**

`RecordStoryRead.execute({ learnerId, title, contentId, tagUid, location })`:
- reject a missing/blank `learnerId` with `ValidationError`
- compute `studyDay` via `studyDayForInstant(clock().getTime(), { timezone })`
- `append` the row
- broadcast `{ event: 'story-read', learnerId, title, at, studyDay }` on the **`school`** topic — the same bus `useScanCeremony.js` already reads for `piano-lesson-complete`, so the ceremony lands with no new transport
- **the broadcast is wrapped in try/catch**: the evidence is the point, the acknowledgement is a courtesy, and a dead bus must never lose a book a child actually finished
- return the stored row

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/school/recordStoryRead.test.mjs --reporter=dot`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/usecases/RecordStoryRead.mjs cli/school.mjs tests/isolated/application/school/recordStoryRead.test.mjs
git commit -m "feat(school): RecordStoryRead use case and CLI"
```

---

### Task 8: Enroll the two preschoolers

**Files (outside the repo — substitute the real roster ids here):**
- Create: `$DAYLIGHT_BASE_PATH/data/household/school/plans/learners/<preschooler-1>.yml`
- Create: `$DAYLIGHT_BASE_PATH/data/household/school/plans/learners/<preschooler-2>.yml`

Both are already declared learners in `school.yml` `students:` and already hold personal NFC cards; only the plan files are missing.

**Step 1: Confirm the shape the store expects**

`YamlAssignmentStore` reads `raw.enrollments ?? raw.courses` for courses. Confirm how it reads `programs` before committing to a key name, and match the existing grade-school plan files' conventions:

```bash
sed -n '1,60p' backend/src/1_adapters/persistence/yaml/YamlAssignmentStore.mjs
ls "$DAYLIGHT_BASE_PATH/data/household/school/plans/learners/"
```

**Step 2: Write the plan files**

**Targets are DIFFERENT per child** — decided 2026-08-26. They are not a default to
copy between files:

| Learner | `target` |
|---|---|
| the older preschooler (`learner-c` in tests/docs) | **2** |
| the younger preschooler (`learner-d` in tests/docs) | **1** |

```yaml
learnerId: <preschooler-1>
enrollments: []
programs:
  - programId: story-time
    corpusId: null
    target: 2          # the OTHER preschooler's file gets target: 1
    subject: english
    title: Story time
```

This is exactly why `target` lives on the enrollment rather than in `school.yml` —
see the design decisions above.

**Step 3: Restart and verify the agenda**

```bash
node cli/school.mjs ops status <preschooler-1>
```
Expected: an `english` section holding a `story-time` entry, `0 of 2 stories`, obligation `obligated`

**Step 4: Verify the full loop**

```bash
node cli/school.mjs ops read <preschooler-1> --title="The Jungle Book" --content=plex:620681 --apply
node cli/school.mjs ops status <preschooler-1>   # 1 of 2 stories, still obligated
node cli/school.mjs ops read <preschooler-1> --title="Dumbo" --content=plex:620669 --apply
node cli/school.mjs ops status <preschooler-1>   # 2 of 2 stories, obligation served, day complete
```

Then open the School board and confirm the card is green and breathing.

---

### Task 9: Docs

**Files:**
- Modify: `docs/reference/school/programs.md` — add story-time as the first courseless daily-count program, and document the study-day sharding decision
- Modify: `docs/reference/school/enrollment.md` — under "The three records", note that a *program* is the enrollment-without-a-course lane and point at `programs.md`
- Modify: `docs/docs-last-updated.txt` — `git rev-parse HEAD > docs/docs-last-updated.txt`

```bash
git add docs/ && git commit -m "docs(school): story-time and the courseless program lane"
```

---

## Acceptance

- `node cli/school.mjs ops status <preschooler-1>` shows story-time under English with a live count
- Two recorded reads flip obligation to `served` and the day to `complete`
- The School board paints the card green
- A third read does not break anything and reads `3 of 2 stories`
- An unreadable log shows the program as unavailable, not as zero reads
- No change was needed in `agenda.mjs`, `completion.mjs`, or `AgendaStatusBoard.jsx`. **If you found yourself editing any of those, stop** — the program lane was not being used correctly.
