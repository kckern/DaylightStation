# Fitness false-zero / pipeline-stall fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop the fitness app from reporting 0 RPM — and locking a cycle challenge — when the sensor pipeline is starved, and remove the two backend event-loop blockers that starve it.

**Architecture:** Three layers, each independently shippable. **Backend** — stop the State Gates YAML storm (coalesce autosave-driven reconciles, publish learners sequentially, keep parsed state in memory, shrink the journal) and de-quadratic the 4-minute school bank prewarm with a real macrotask yield. **Frontend** — give `DeviceManager` a pipeline-liveness signal and make the prune, the cadence reader and the cycle state machine *hold* rather than zero/deplete when no device at all is delivering. **Docs** — close the bug report, note the retention default.

**Tech Stack:** Node ESM backend (`.mjs`, DDD layers), React frontend (`.js` hooks), vitest for both (`npx vitest run <file>` from repo root — verified working for both trees on 2026-09-02).

**Bug report (read first):** `docs/_wip/bugs/2026-09-02-fitness-rpm-false-zeros-pause-video-during-cycle-challenge.md`. Everything below is traced there with evidence; do not re-investigate.

---

## Ground rules for the executor

- **NEVER start a second backend** (`node backend/index.js`). It is a live household controller — a second instance makes real Home Assistant calls and fights for device authority on any port. All verification here is unit tests + reading the log store.
- Work on a **worktree branch**, not the main checkout (it has 18 unrelated modified files). See Task 0.
- Every task: failing test → run it → minimal code → run it → commit. One concern per commit.
- Commit trailer (required):
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01RNUiEG2Bca81qeVbL9uvGN
  ```
- Test commands: `npx vitest run <path>` from the repo root. Add `--reporter=dot` for less noise.

---

### Task 0: Worktree

**Step 1: Create the worktree and branch**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git worktree add .claude/worktrees/fitness-pipeline-stall -b fitness/false-zero-pipeline-stall main
cd .claude/worktrees/fitness-pipeline-stall
ln -s /Users/kckern/Documents/GitHub/DaylightStation/node_modules node_modules
ln -s /Users/kckern/Documents/GitHub/DaylightStation/frontend/node_modules frontend/node_modules
```

**Step 2: Prove the runner works from here**

Run: `npx vitest run frontend/src/hooks/fitness/DeviceManager.rpmFreeze.test.js tests/isolated/application/measures/weeklyMeasuresStateGatesProducer.test.mjs --reporter=dot`
Expected: `Test Files 2 passed`, `Tests 9 passed`.

---

## Part A — Backend: the blockers

### Task 1: Coalesce autosave-driven reconciles

Every 15 s browser autosave fires `notifySessionsChanged({operation:'saved'})` → `requestReconcile` → a full State Gates publish for every learner. `requestReconcile` ignores its argument and debounces at 500 ms, so every save reconciles. Saves only need rings refreshed *eventually*; `ended`/`deleted` change what a learner earned and should stay prompt.

**Files:**
- Modify: `backend/src/3_applications/measures/WeeklyMeasuresStateGatesProducer.mjs`
- Test: `tests/isolated/application/measures/weeklyMeasuresStateGatesProducer.test.mjs`

**Step 1: Write the failing tests** (append to the existing file, inside a new `describe`)

```js
function recordingScheduler() {
  const calls = [];
  return {
    calls,
    schedule: (delayMs, fn) => {
      const entry = { delayMs, fn, cancelled: false };
      calls.push(entry);
      return () => { entry.cancelled = true; };
    },
  };
}

describe('WeeklyMeasuresStateGatesProducer — reconcile coalescing by change kind', () => {
  const build = (sched) => new WeeklyMeasuresStateGatesProducer({
    weeklyMeasures: { execute: async () => ({ window: { from: '2026-08-30', to: '2026-09-05' }, learners: [] }) },
    publishAssertion: async () => {},
    timezone: 'UTC', clock: () => new Date('2026-08-30T12:00:00Z'),
    scheduler: sched, debounceMs: 500, savedDebounceMs: 60_000,
  });

  it('schedules a plain session save on the slow debounce, not the prompt one', () => {
    const sched = recordingScheduler();
    build(sched).requestReconcile({ operation: 'saved' });
    expect(sched.calls.map((c) => c.delayMs)).toEqual([60_000]);
  });

  it('a session end arriving behind a pending save upgrades it to the prompt debounce', () => {
    const sched = recordingScheduler();
    const producer = build(sched);
    producer.requestReconcile({ operation: 'saved' });
    producer.requestReconcile({ operation: 'ended' });
    expect(sched.calls[0].cancelled).toBe(true);
    expect(sched.calls.map((c) => c.delayMs)).toEqual([60_000, 500]);
  });

  it('a save arriving behind a pending prompt reconcile is absorbed, not rescheduled', () => {
    const sched = recordingScheduler();
    const producer = build(sched);
    producer.requestReconcile({ operation: 'ended' });
    producer.requestReconcile({ operation: 'saved' });
    expect(sched.calls.map((c) => c.delayMs)).toEqual([500]);
  });

  it('a request with no change object still reconciles promptly (backstop callers)', () => {
    const sched = recordingScheduler();
    build(sched).requestReconcile();
    expect(sched.calls.map((c) => c.delayMs)).toEqual([500]);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run tests/isolated/application/measures/weeklyMeasuresStateGatesProducer.test.mjs`
Expected: FAIL — first test gets `[500]`, second gets `[500]` with nothing cancelled.

**Step 3: Implement**

In `WeeklyMeasuresStateGatesProducer.mjs`:

Change the private field line and constructor:

```js
  #weekly; #publish; #timezone; #clock; #scheduler; #logger; #debounceMs; #savedDebounceMs; #refreshMs;
  #cancelRefresh = null; #pendingDelayMs = null; #cancelPoll = null; #cancelRollover = null; #stopped = false; #last = new Map(); #revisions = new Map(); #running = null;

  constructor({
    weeklyMeasures, publishAssertion, timezone = 'UTC', clock = () => new Date(),
    debounceMs = 500, savedDebounceMs = 60 * 1000, refreshMs = 5 * 60 * 1000, scheduler, logger = console,
  } = {}) {
```

Add after `this.#debounceMs = debounceMs;`:

```js
    this.#savedDebounceMs = savedDebounceMs;
```

In `stop()`, add after `this.#cancelRefresh = null;`:

```js
    this.#pendingDelayMs = null;
```

Replace `requestReconcile` entirely:

```js
  /**
   * Coalesce session changes into one roster-wide projection refresh.
   *
   * A plain autosave (`operation: 'saved'` — every 15 s from every open
   * session) only needs the rings refreshed eventually, so it waits
   * `savedDebounceMs`. A session ending or being deleted changes what a
   * learner has earned and reconciles on the prompt `debounceMs`. A prompt
   * request arriving behind a pending slow one upgrades it; a slow request
   * behind a pending prompt one is absorbed. Before this, every 15 s save
   * drove a full 4-learner publish against a 2.6 MB YAML file — the
   * 2026-09-02 event-loop stall.
   */
  requestReconcile(change = {}) {
    if (this.#stopped) return;
    const delayMs = change?.operation === 'saved' ? this.#savedDebounceMs : this.#debounceMs;
    if (this.#cancelRefresh) {
      if (delayMs >= this.#pendingDelayMs) return;
      this.#cancelRefresh();
    }
    this.#pendingDelayMs = delayMs;
    this.#cancelRefresh = this.#scheduler.schedule(delayMs, () => {
      this.#cancelRefresh = null;
      this.#pendingDelayMs = null;
      this.reconcile().catch((error) => this.#warn('reconcile-failed', error));
    });
  }
```

No change is needed in `backend/src/app.mjs:3524` — it already passes `change` through.

**Step 4: Run to verify it passes**

Run: `npx vitest run tests/isolated/application/measures/weeklyMeasuresStateGatesProducer.test.mjs`
Expected: PASS, 7 tests.

**Step 5: Commit**

```bash
git add backend/src/3_applications/measures/WeeklyMeasuresStateGatesProducer.mjs tests/isolated/application/measures/weeklyMeasuresStateGatesProducer.test.mjs
git commit -m "fix(state-gates): coalesce autosave-driven fitness reconciles onto a 60s debounce

Every 15s session autosave was driving a full per-learner State Gates
publish. Saves now wait 60s; ended/deleted stay prompt and upgrade a
pending slow request.

See docs/_wip/bugs/2026-09-02-fitness-rpm-false-zeros-pause-video-during-cycle-challenge.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RNUiEG2Bca81qeVbL9uvGN"
```

---

### Task 2: Publish learners sequentially

`#reconcile` fires `Promise.all` across every learner. Four publishers race one optimistic household revision with a 3-attempt cap, so the last learner in roster order **always** loses (`State Gates state changed concurrently` × 46; learner-D's rings were never published all session) and the retries multiply the file parses 18×.

**Files:**
- Modify: `backend/src/3_applications/measures/WeeklyMeasuresStateGatesProducer.mjs` (`#reconcile`)
- Test: `tests/isolated/application/measures/weeklyMeasuresStateGatesProducer.test.mjs`

**Step 1: Write the failing tests** (append inside the top-level `describe('WeeklyMeasuresStateGatesProducer'`)

```js
  it('publishes learners one at a time so they never race the household revision', async () => {
    let inFlight = 0; let maxInFlight = 0; const published = [];
    const producer = new WeeklyMeasuresStateGatesProducer({
      weeklyMeasures: { execute: async () => ({
        window: { from: '2026-08-30', to: '2026-09-05' },
        learners: ['a', 'b', 'c', 'd'].map((id) => ({ learnerId: id, measures: [{ id: 'fitness.rings', value: 1 }] })),
      }) },
      publishAssertion: async (assertion) => {
        inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        published.push(assertion.subject.id);
        inFlight -= 1;
      },
      timezone: 'UTC', clock: () => new Date('2026-08-30T12:00:00Z'), scheduler,
    });
    await producer.reconcile();
    expect(maxInFlight).toBe(1);
    expect(published).toEqual(['a', 'b', 'c', 'd']);
    producer.stop();
  });

  it('a failing learner does not stop the learners after it', async () => {
    const published = [];
    const producer = new WeeklyMeasuresStateGatesProducer({
      weeklyMeasures: { execute: async () => ({
        window: { from: '2026-08-30', to: '2026-09-05' },
        learners: ['a', 'b', 'c'].map((id) => ({ learnerId: id, measures: [{ id: 'fitness.rings', value: 1 }] })),
      }) },
      publishAssertion: async (assertion) => {
        if (assertion.subject.id === 'b') throw new Error('boom');
        published.push(assertion.subject.id);
      },
      timezone: 'UTC', clock: () => new Date('2026-08-30T12:00:00Z'), scheduler,
      logger: { warn: () => {} },
    });
    await producer.reconcile();
    expect(published).toEqual(['a', 'c']);
    producer.stop();
  });
```

**Step 2: Run to verify it fails**

Run: `npx vitest run tests/isolated/application/measures/weeklyMeasuresStateGatesProducer.test.mjs`
Expected: FAIL on the first new test — `maxInFlight` is 4.

**Step 3: Implement**

In `#reconcile`, replace the `await Promise.all((projection.learners ?? []).map(async (row) => {` … `}));` block with:

```js
    // Sequential on purpose. Every publish is a compare-and-swap on ONE
    // household revision with a 3-attempt cap; in parallel the last learner
    // in roster order lost every cycle ("State Gates state changed
    // concurrently") and the retries re-parsed the state file 18× per cycle.
    for (const row of projection.learners ?? []) {
      const rings = (row.measures ?? []).find((measure) => measure.id === 'fitness.rings');
      if (!row.learnerId || !Number.isFinite(rings?.value)) continue;
      const assertionId = `fitness:weekly-rings:${row.learnerId}:${projection.window.from}:${projection.window.to}`;
      const signature = String(rings.value);
      if (this.#last.get(assertionId) === signature) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.#publish({
          assertionId,
          claimTypeId: 'fitness.weekly.rings',
          subject: { kind: 'learner', id: row.learnerId },
          period,
          value: rings.value,
          sourceRevision: this.#nextRevision(assertionId, now),
          observedAt: now,
          validFrom: now,
          validUntil: period.endsAt,
          evidenceRef: `fitness-week:${projection.window.from}:${projection.window.to}`,
        });
        this.#last.set(assertionId, signature);
      } catch (error) {
        this.#warn('publish-failed', error, row.learnerId);
      }
    }
```

**Step 4: Run to verify it passes**

Run: `npx vitest run tests/isolated/application/measures/weeklyMeasuresStateGatesProducer.test.mjs`
Expected: PASS, 9 tests.

**Step 5: Commit**

```bash
git add backend/src/3_applications/measures/WeeklyMeasuresStateGatesProducer.mjs tests/isolated/application/measures/weeklyMeasuresStateGatesProducer.test.mjs
git commit -m "fix(state-gates): publish fitness learners sequentially, not Promise.all

Parallel publishes raced one household revision under a 3-attempt cap,
so the last learner in roster order failed every cycle and never had
rings published. Sequential removes the race and the wasted retries.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RNUiEG2Bca81qeVbL9uvGN"
```

---

### Task 3: Keep parsed State Gates state in memory

`YamlStateGatesStateEngine` re-reads + re-parses the whole 2.6 MB file on **every** operation: `loadProjection`, `commit`, `pending`, `markPublished`, `replayAfter`, … Writers are already serialised per household (`#serialized` / `#queues`), so one in-memory copy per household is safe: mutate under the queue, write through, and drop the cache if a write fails so the next read comes from disk (preserving the existing interrupted-write contract).

**Files:**
- Modify: `backend/src/1_adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs`
- Create: `tests/isolated/adapter/state-gates/stateGatesStateEngineCache.test.mjs`

**Step 1: Write the failing tests**

```js
import { describe, expect, it } from 'vitest';
import { YamlStateGatesStateEngine } from '#adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs';

function countingEngine() {
  const files = new Map();
  let loads = 0; let failSave = false;
  const engine = new YamlStateGatesStateEngine({
    resolveFilePath: (id) => `/virtual/${id}/current.yml`,
    load: (p) => { loads += 1; return files.has(p) ? structuredClone(files.get(p)) : null; },
    save: (p, v) => {
      if (failSave) throw new Error('simulated interrupted write');
      files.set(p, structuredClone(v));
    },
  });
  return { engine, loads: () => loads, failSave: (v) => { failSave = v; } };
}

const projection = (householdRevision, extras = {}) => ({
  schemaVersion: 1, householdRevision, activePolicyCandidate: null,
  assertions: [], evaluations: [], decisions: [], ...extras,
});
const event = (householdRevision, ordinal = 0) => ({
  transitionId: `state-gates:home:${householdRevision}:${ordinal}`,
  householdRevision, ordinal, occurredAt: Date.now(), kind: 'StateObservation', payload: {},
});

describe('YamlStateGatesStateEngine — in-memory state', () => {
  it('parses the file once and serves every later operation from memory', async () => {
    const { engine, loads } = countingEngine();
    await engine.commit('home', 0, projection(1), [event(1)]);
    await engine.markPublished('home', [event(1).transitionId]);
    await engine.loadProjection('home');
    await engine.pending('home');
    await engine.replayAfter('home', 0, 10);
    await engine.commit('home', 1, projection(2), [event(2)]);
    expect(loads()).toBe(1);
  });

  it('drops its copy when a write fails, so the next read comes from disk', async () => {
    const { engine, loads, failSave } = countingEngine();
    await engine.commit('home', 0, projection(1), [event(1)]);
    failSave(true);
    await expect(engine.commit('home', 1, projection(2), [event(2)]))
      .rejects.toMatchObject({ code: 'STATE_GATES_STATE_UNAVAILABLE' });
    failSave(false);
    expect((await engine.loadProjection('home')).householdRevision).toBe(1);
    expect(await engine.pending('home')).toHaveLength(1);
    expect(loads()).toBe(2);
  });

  it('never hands a caller a reference into its own copy', async () => {
    const { engine } = countingEngine();
    await engine.commit('home', 0, projection(1, { assertions: [{ id: 'a' }] }), [event(1)]);
    const leaked = await engine.loadProjection('home');
    leaked.assertions.push({ id: 'injected' });
    expect((await engine.loadProjection('home')).assertions).toHaveLength(1);
    const pending = await engine.pending('home');
    pending[0].payload.injected = true;
    expect((await engine.pending('home'))[0].payload).toEqual({});
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run tests/isolated/adapter/state-gates/stateGatesStateEngineCache.test.mjs`
Expected: FAIL — first test `loads()` is 7; third passes by accident today (fresh parse each time) — that's fine, it guards the new behaviour.

**Step 3: Implement**

In `YamlStateGatesStateEngine.mjs`:

Add `#cache = new Map();` to the private fields line:

```js
  #resolveFilePath; #load; #save; #maxEntries; #maxAgeMs; #queues = new Map(); #cache = new Map();
```

Add this method directly after `#read`:

```js
  /**
   * Parsed state for a household, from memory after the first read. Every
   * operation used to re-read and re-parse the whole file — 2.6 MB with the
   * journal inside it, ~140 ms parse plus a deep key-walk, 18–24 times per
   * fitness reconcile cycle (the 2026-09-02 event-loop stall). Writers are
   * already serialised per household (#serialized), so one copy is safe:
   * mutate it under the queue, write through, and drop it if the write fails
   * so the next read comes from disk — the interrupted-write contract.
   * Read paths hand out structuredClone()s, never the copy itself.
   */
  #state(householdId) {
    let state = this.#cache.get(householdId);
    if (!state) {
      state = this.#read(householdId);
      this.#cache.set(householdId, state);
    }
    return state;
  }
```

Change `#write`'s catch to drop the cache:

```js
    try { this.#save(this.#resolveFilePath(householdId), stored, { noRefs: true, sortKeys: true }); }
    catch (error) {
      this.#cache.delete(householdId); // disk is truth again; re-parse on the next read
      throw persistenceError('State Gates state could not be saved', error);
    }
```

Then replace every operational `this.#read(householdId)` with `this.#state(householdId)` and clone read-only returns. Exact edits:

- `loadProjection`: `return structuredClone(this.#state(householdId).projection);`
- `commit`: `const state = this.#state(householdId);`
- `pending`: `return structuredClone(this.#state(householdId).journal.filter(item => !item.published).map(({ published, ...item }) => item));`
- `markPublished`: `const state = this.#state(householdId);`
- `replayAfter`: `const state = this.#state(householdId);` and `const events = structuredClone(state.journal.filter(...).map(...));`
- `compactThrough`: `const state = this.#state(householdId);`
- `oldestAvailableRevision`: `return (this.#state(householdId).compactedThrough ?? 0) + 1;`

`#read` itself stays as-is (it is now only called by `#state`).

**Step 4: Run the new test and every state-gates suite**

There are **eight** state-gates test files across four layers; the engine is reached through the API routers too, so run all of them (amended 2026-09-02 after a blast-radius check — an earlier draft named only two directories):

Run: `npx vitest run tests/isolated/adapter/state-gates/ tests/isolated/application/state-gates/ tests/isolated/api/state-gates/ tests/isolated/domain/state-gates/`

Expected: PASS — all eight files. Two carry the durability contract this task must not break:
- `stateGatesPersistence.matrix.test.mjs` → *"leaves the prior durable projection readable when a save is interrupted"* — this is the one the cache-drop-on-write-failure exists for.
- `StateGatesEngine.matrix.test.mjs` → the compare-and-swap/retry behaviour that Task 2 depends on.

`stateGatesDomain*.test.mjs` should be untouched (pure domain, no I/O) — if either moves, you changed something you should not have.

**Step 5: Commit**

```bash
git add backend/src/1_adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs tests/isolated/adapter/state-gates/stateGatesStateEngineCache.test.mjs
git commit -m "perf(state-gates): keep parsed state in memory instead of re-parsing the file per operation

Every operation re-read and re-parsed the whole current.yml (2.6MB,
~140ms) — 18-24 times per fitness reconcile cycle. One serialised
in-memory copy per household, written through, dropped on write
failure so the interrupted-write contract holds.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RNUiEG2Bca81qeVbL9uvGN"
```

---

### Task 4: Shrink the journal retention default

The journal lives inside `current.yml` under a 5000-entry / 30-day retention that has never compacted (`compacted_through: 0`, 2282 entries, growing ~700/day). Even with Task 3 every commit still `yaml.dump`s the whole thing. 500 entries / 7 days is ~5× smaller and still far more than delivery recovery or the admin replay endpoint (`limit ≤ 500`) can consume.

**Files:**
- Modify: `backend/src/5_composition/modules/stateGates.mjs:54`
- Modify: `docs/reference/state-gates/README.md` (the "bounded transition journal" bullet, ~line 89)

**Step 1: Check nothing asserts the old default**

Run: `grep -rn "5000" tests/isolated/adapter/state-gates tests/isolated/application/state-gates backend/src/5_composition/modules/stateGates.mjs`
Expected: only the `stateGates.mjs:54` literal. If a test asserts 5000, update it in this task.

**Step 2: Change the default**

```js
  journalRetention = { maxEntries: 500, maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
```

Add a comment above it:

```js
  // Journal + projection share current.yml and every commit dumps the whole
  // file. 5000 entries / 30 days let it reach 2.6 MB and never compact; 500 / 7d
  // keeps a commit cheap while still exceeding what replay (limit ≤ 500) or
  // delivery recovery can consume. Cursors older than compactedThrough get the
  // 410 the design already handles.
```

**Step 3: Update the README bullet**

Change `- durable current projection and bounded transition journal;` to:

```
- durable current projection and a bounded transition journal (default 500 entries / 7 days — the journal shares `current.yml` with the projection, so its size is the cost of every commit);
```

**Step 4: Run the state-gates suites**

Run: `npx vitest run tests/isolated/adapter/state-gates/ tests/isolated/application/state-gates/ tests/isolated/api/state-gates/`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/5_composition/modules/stateGates.mjs docs/reference/state-gates/README.md
git commit -m "perf(state-gates): journal retention 5000/30d -> 500/7d

The journal shares current.yml with the projection; its size is the
cost of every commit. 5000 entries never compacted and reached 2.6MB.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RNUiEG2Bca81qeVbL9uvGN"
```

---

### Task 5: School bank prewarm — one walk per course, a real yield between works

`readAllBankRaws` calls `#bankFile(id)` for each of 637 ids; for a v2 course that calls `#v2BankEntries(subject, work)` which synchronously walks and parses **every** YAML in the course — per id. O(N²) sync work, all before the first real `await`, on a 4-minute `setInterval` (`app.mjs:3205`). ~7.8 s block every 4 minutes, all day, independent of fitness.

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs` (`#v2BankEntries`, `readAllBankRaws`)
- Test: `tests/isolated/adapter/school/yamlSchoolDatastore.test.mjs`

**Step 1: Confirm the spy will bite**

Run: `grep -n "^import fs\|fs.readdirSync" backend/src/0_system/utils/FileIO.mjs | head -3`
Expected: `import fs from 'fs'` and `fs.readdirSync(` inside `listYamlFiles`. (The test spies on the default `fs` object's method, which is what `listYamlFiles` calls.)

**Step 2: Write the failing tests** (append to the existing test file)

```js
describe('readAllBankRaws', () => {
  const bank = (id) => `schema: school.question-bank/v1\nid: ${id}\nitems: []\n`;
  let work;
  beforeEach(() => {
    work = path.join(tmp, 'content', 'school', 'math', 'algebra');
    fs.mkdirSync(path.join(work, 'lessons'), { recursive: true });
    fs.writeFileSync(path.join(work, '_index.yml'), 'schema: school.course/v2\ntitle: Algebra\n');
    for (const n of ['l1', 'l2', 'l3', 'l4', 'l5']) {
      fs.writeFileSync(path.join(work, 'lessons', `${n}.yml`), bank(`math/algebra/${n}`));
    }
  });

  it('returns every v2 bank with its parsed raw, sorted by id', async () => {
    const raws = await ds.readAllBankRaws();
    expect(raws.map((r) => r.id)).toEqual([
      'math/algebra/l1', 'math/algebra/l2', 'math/algebra/l3', 'math/algebra/l4', 'math/algebra/l5',
    ]);
    expect(raws.every((r) => r.raw?.schema === 'school.question-bank/v1')).toBe(true);
  });

  it('walks a v2 course directory once, not once per bank id', async () => {
    const spy = vi.spyOn(fs, 'readdirSync');
    await ds.readAllBankRaws();
    const workWalks = spy.mock.calls.filter(([dir]) => String(dir) === work).length;
    spy.mockRestore();
    // Was 6: one from listBankIds, plus one re-walk per bank id via
    // #bankFile → #v2BankEntries. O(N²) sync YAML blocked the loop ~8s every
    // 4-minute prewarm. See the 2026-09-02 bug report.
    expect(workWalks).toBe(1);
  });
});
```

**Step 3: Run to verify it fails**

Run: `npx vitest run tests/isolated/adapter/school/yamlSchoolDatastore.test.mjs`
Expected: FAIL on "walks … once" — `workWalks` is 6.

**Step 4: Implement**

In `YamlSchoolDatastore.mjs`, replace `#v2BankEntries` with these two methods:

```js
  /**
   * One walk of a v2 course, every bank parsed once. Feeds both the id index
   * (#v2BankEntries) and the bulk read (readAllBankRaws) — which used to walk
   * and re-parse the whole course once PER BANK ID through #bankFile: O(N²)
   * synchronous YAML that blocked the event loop ~8 s on every 4-minute
   * prewarm, independent of anything else running.
   * See docs/_wip/bugs/2026-09-02-fitness-rpm-false-zeros-pause-video-during-cycle-challenge.md
   *
   * Every question-bank YAML inside a v2 course is a typed bank artifact.
   * This is intentionally semantic discovery: compact `<lessonId>.yml` files
   * and rich lesson directories both work, while the bank's stable `id` stays
   * independent of its author-facing location.
   */
  #v2BankRaws(subject, work) {
    if (!this.#courseV2(subject, work)) return [];
    const compactRoot = this.#workDir(subject, work);
    const entries = new Map();
    for (const file of listYamlFiles(compactRoot, { recursive: true })) {
      if (['index', '_index'].includes(path.basename(file))) continue;
      const base = path.join(compactRoot, file);
      const raw = loadYamlSafe(base);
      if (!raw || !['school.question-bank/v1', 'school.question-bank/v2'].includes(raw.schema)
        || typeof raw.id !== 'string' || !raw.id) continue;
      entries.set(raw.id, { id: raw.id, file: base, raw });
    }
    return [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  #v2BankEntries(subject, work) {
    return this.#v2BankRaws(subject, work).map(({ id, file }) => ({ id, file }));
  }
```

Replace `readAllBankRaws` (keep its doc comment's intent, rewrite the body):

```js
  /**
   * Read every bank's raw YAML: legacy `quizzes/` files asynchronously in
   * bounded batches (libuv threadpool), v2 courses via ONE synchronous walk per
   * course (#v2BankRaws) with a real macrotask yield between works — an
   * `await Promise.all` over already-synchronous work never leaves the
   * microtask queue, which is why the previous "async" version still blocked
   * the loop for ~8 s. Returns [{ id, raw }] sorted by id (raw null on a miss).
   */
  async readAllBankRaws({ batch = 200 } = {}) {
    const out = [];
    for (const subject of SUBJECT_IDS) {
      for (const work of this.#works(subject)) {
        const quizzes = this.#quizzesDir(subject, work);
        const legacyIds = listYamlFiles(quizzes, { recursive: true }).map((rest) => `${subject}/${work}/${rest}`);
        for (let i = 0; i < legacyIds.length; i += batch) {
          // eslint-disable-next-line no-await-in-loop
          const chunk = await Promise.all(legacyIds.slice(i, i + batch).map(async (id) => {
            try {
              const text = await readTextFromPathAsync(`${path.join(quizzes, ...id.split('/').slice(2))}.yml`);
              return { id, raw: yaml.load(text) };
            } catch {
              return { id, raw: null };
            }
          }));
          out.push(...chunk);
        }
        for (const { id, raw } of this.#v2BankRaws(subject, work)) out.push({ id, raw });
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
```

`listBankIds` and `#bankFile` are unchanged — single-bank reads keep their current path.

**Step 5: Run to verify it passes**

Run: `npx vitest run tests/isolated/adapter/school/yamlSchoolDatastore.test.mjs tests/isolated/application/school/`
Expected: PASS (the school application suites exercise `warmBanks` through this method).

**Step 5b: the colocated test the command above MISSES** (added 2026-09-02 after a blast-radius check)

`backend/src/1_adapters/persistence/yaml/CoursePackageV2.test.mjs` is a **vitest file colocated in `backend/src`**, not under `tests/`, so no `tests/...` glob reaches it. It is also the only test that drives `listBankIds()` and `readBankRaw()` against a real on-disk v2 course, asserting exact id arrays — i.e. it covers precisely the `#v2BankEntries` / `#bankFile` path this task rewrites.

Run: `npx vitest run backend/src/1_adapters/persistence/yaml/CoursePackageV2.test.mjs`
Expected: PASS, unchanged.

Also confirm the `SchoolService.*.test.mjs` files colocated in `backend/src/3_applications/school/` still pass — they stub `readAllBankRaws` so they should be unaffected, but they are the contract consumers:
Run: `npx vitest run backend/src/3_applications/school/`

**Step 6: Fix the misleading comment in the caller**

In `backend/src/3_applications/school/SchoolService.mjs`, the comment above `warmBanks` (~line 240) says the scan runs "off the main thread". Replace those three lines with:

```js
  // Populate the summary cache via the datastore's bulk read. Legacy files
  // read async; v2 courses are one sync walk each with a macrotask yield
  // between works (see YamlSchoolDatastore.readAllBankRaws). Deduped:
  // concurrent callers share one scan.
```

**Step 7: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs backend/src/3_applications/school/SchoolService.mjs tests/isolated/adapter/school/yamlSchoolDatastore.test.mjs
git commit -m "perf(school): prewarm walks each v2 course once and yields between works

readAllBankRaws re-walked and re-parsed a whole v2 course once per bank
id (O(N^2) sync YAML) before its first real await — ~8s of blocked
event loop every 4-minute prewarm, all day.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RNUiEG2Bca81qeVbL9uvGN"
```

---

## Part B — Frontend: hold, don't zero

### Task 6: DeviceManager knows when the pipeline is stalled; prune holds

`pruneStaleDevices` zeros any cadence device whose last significant activity is older than `rpmZero` (1200 ms), on a client-side 3 s timer that a backend stall cannot delay. It cannot tell "this rider stopped" from "nothing at all is arriving." The discriminator: is **any** device delivering? If no device has delivered a packet for `transportStallMs`, the pipeline is starved and per-device staleness means nothing — hold every value and say so in the log.

**Files:**
- Modify: `frontend/src/hooks/fitness/DeviceManager.js` (constructor, `updateDevice`, new `isTransportStalled`, `pruneStaleDevices`)
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:28-34` and `:111-117` (`FITNESS_TIMEOUTS.transportStallMs`, setter)
- Create: `frontend/src/hooks/fitness/DeviceManager.transportStall.test.js`

**Step 1: Write the failing tests**

```js
/**
 * Pipeline-stall regression tests.
 *
 * 2026-09-02: the backend event loop blocked 6–8 s at a time. No packets
 * reached the browser from ANY device, but the 3 s prune timer kept firing and
 * zeroed every cadence device past rpmZero (1200 ms) at once. The cycle
 * challenge read 0 RPM and paused the video seven times on a rider holding
 * 85 RPM. "No data" and "0 RPM" must be different states.
 *
 * See docs/_wip/bugs/2026-09-02-fitness-rpm-false-zeros-pause-video-during-cycle-challenge.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { DeviceManager } from './DeviceManager.js';

const timeouts = { inactive: 60_000, remove: 1_800_000, rpmZero: 1_200, transportStallMs: 1_800 };
const t0 = 1_000_000;

describe('DeviceManager — a stalled pipeline holds cadence instead of zeroing it', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(t0); });
  afterEach(() => vi.useRealTimers());

  it('is never "stalled" before the first packet', () => {
    expect(new DeviceManager().isTransportStalled(1_800)).toBe(false);
  });

  it('zeros a silent bike while another device is still delivering (the rider stopped)', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 80 });
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 120 });
    vi.setSystemTime(t0 + 2_000);
    mgr.updateDevice('strap-1', 'HR', { ComputedHeartRate: 121 }); // pipeline alive
    mgr.pruneStaleDevices(timeouts);
    expect(mgr.isTransportStalled(timeouts.transportStallMs)).toBe(false);
    expect(mgr.getDevice('bike-1').cadence).toBe(0);
  });

  it('holds every cadence value when NO device has delivered (the pipeline stalled)', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 80 });
    mgr.updateDevice('bike-2', 'CAD', { CalculatedCadence: 55 });
    vi.setSystemTime(t0 + 8_000); // the 2026-09-02 shape: 8 s of nothing at all
    mgr.pruneStaleDevices(timeouts);
    expect(mgr.isTransportStalled(timeouts.transportStallMs)).toBe(true);
    expect(mgr.getDevice('bike-1').cadence).toBe(80);
    expect(mgr.getDevice('bike-2').cadence).toBe(55);
  });

  it('zeros normally again once packets resume and a bike stays silent', () => {
    const mgr = new DeviceManager();
    mgr.updateDevice('bike-1', 'CAD', { CalculatedCadence: 80 });
    mgr.updateDevice('bike-2', 'CAD', { CalculatedCadence: 55 });
    vi.setSystemTime(t0 + 8_000);
    mgr.pruneStaleDevices(timeouts);                                 // stalled: held
    mgr.updateDevice('bike-2', 'CAD', { CalculatedCadence: 57 });    // pipeline back
    vi.setSystemTime(t0 + 9_500);
    mgr.updateDevice('bike-2', 'CAD', { CalculatedCadence: 57 });
    mgr.pruneStaleDevices(timeouts);
    expect(mgr.getDevice('bike-1').cadence).toBe(0);   // genuinely silent now
    expect(mgr.getDevice('bike-2').cadence).toBe(57);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/hooks/fitness/DeviceManager.transportStall.test.js`
Expected: FAIL — `isTransportStalled is not a function`.

**Step 3: Implement — DeviceManager**

Constructor:

```js
export class DeviceManager {
  constructor() {
    this.devices = new Map(); // deviceId -> Device
    // Monotonic counter bumped on any mutation that can change roster output
    // (device add/update/remove, inactive-state transitions). Read by
    // ParticipantRoster's roster cache to know when a rebuild is required.
    // See docs/_wip/plans/2026-07-17-fitness-context-rearchitecture.md (Stage 1).
    this.mutationVersion = 0;
    // Wall-clock of the last packet from ANY device — the pipeline's liveness
    // signal. While it advances, one device's silence is that device (the
    // rider stopped). When it stops advancing, nothing is being delivered
    // (backend/socket stalled) and per-device staleness is meaningless.
    // See docs/_wip/bugs/2026-09-02-fitness-rpm-false-zeros-pause-video-during-cycle-challenge.md
    this.lastPacketAt = 0;
    this._transportStalledSince = null;
  }
```

In `updateDevice`, directly after `if (!id) return null;`:

```js
    this.lastPacketAt = Date.now();
```

Add after `getDevice(id)`:

```js
  /**
   * True when no device at all has delivered a packet for longer than
   * `stallMs` — the sensor pipeline is starved, not any one sensor. Never
   * true before the first packet.
   */
  isTransportStalled(stallMs, now = Date.now()) {
    if (!this.lastPacketAt) return false;
    return (now - this.lastPacketAt) > stallMs;
  }
```

In `pruneStaleDevices`, extend both branches of the `timeouts` normalisation:

```js
    const timeouts = typeof config === 'number'
      ? { inactive: config, remove: config * 3, rpmZero: 1200, transportStallMs: 1800 }
      : {
          inactive: config.inactive || 60000,
          remove: config.remove || 180000,
          rpmZero: config.rpmZero || 1200,
          transportStallMs: config.transportStallMs || 1800
        };

    // Pipeline liveness gate. If NO device has delivered recently the link is
    // stalled, and "this cadence device is stale" says nothing about the rider
    // — every device would read stale at once. Hold the last values; a starved
    // pipeline must never render as 0 RPM. Logged on the edges so a stall is
    // visible in the log store instead of reconstructed from two sources.
    const transportStalled = this.isTransportStalled(timeouts.transportStallMs, now);
    if (transportStalled && this._transportStalledSince == null) {
      this._transportStalledSince = now;
      getLogger().warn('device-manager.transport_stalled', {
        sinceMs: now - this.lastPacketAt, deviceCount: this.devices.size
      });
    } else if (!transportStalled && this._transportStalledSince != null) {
      getLogger().info('device-manager.transport_resumed', { stalledMs: now - this._transportStalledSince });
      this._transportStalledSince = null;
    }
```

And change the zeroing condition:

```js
      if (isCadence && !transportStalled && timeSinceSignificant > timeouts.rpmZero) {
```

**Step 4: Implement — FitnessSession timeouts**

In `FITNESS_TIMEOUTS` add after the `rpmZero` line:

```js
  transportStallMs: 1800, // hold (don't zero) cadence when NO device has delivered for this long — the pipeline is silent, not the rider
```

In `setFitnessTimeouts`, add `transportStallMs` to the destructured parameter and a line:

```js
  if (typeof transportStallMs === 'number' && !Number.isNaN(transportStallMs)) FITNESS_TIMEOUTS.transportStallMs = transportStallMs;
```

(`FitnessContext.jsx:1479` passes `getFitnessTimeouts()` to the prune, so the new key flows through with no further wiring.)

**Step 5: Run to verify it passes, plus the neighbours**

Run: `npx vitest run frontend/src/hooks/fitness/DeviceManager.transportStall.test.js frontend/src/hooks/fitness/DeviceManager.rpmFreeze.test.js frontend/src/hooks/fitness/FitnessSession.cadenceTs.test.js`
Expected: PASS, all three files.

**Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/DeviceManager.js frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/DeviceManager.transportStall.test.js
git commit -m "fix(fitness): hold cadence, don't zero it, when no device at all is delivering

pruneStaleDevices could not tell a stopped rider from a starved
pipeline; a backend stall zeroed every bike at once. DeviceManager now
tracks the last packet from any device and the prune holds values
while the pipeline is silent, logging the stall on both edges.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RNUiEG2Bca81qeVbL9uvGN"
```

---

### Task 7: The cycle state machine freezes during a pipeline stall

Even with Task 6 holding the device value, the governance path re-derives staleness: `_readCadenceDevice` returns `{rpm:0, connected:false}` with no `ts` → `_filteredCadenceFor` sees no fresh sample → `CadenceFilter.tick` decays to `lostSignal` at 2 s → `_evaluateCycleChallenge` depletes `CYCLE_HEALTH_MAX_MS` (3 s) → lock. The maintain branch only ever receives `equipmentRpm`, never the flags. Fix: the reader reports the stall, the filter *holds* its clock instead of decaying, and the state machine treats a stall exactly like a pause — no depletion, no progress, no timeout, no lock.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` (`_readCadenceDevice`, ~line 1090)
- Modify: `frontend/src/hooks/fitness/CadenceFilter.js` (new `hold`)
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (`_filteredCadenceFor` ~552; `_evaluateCycleChallenge` ~3098 after the `_timersPaused` gate; both call sites ~2213 and ~3798)
- Create: `frontend/src/hooks/fitness/GovernanceEngine.transportStall.test.js`

**Step 1: Write the failing test**

```js
/**
 * A pipeline stall must never lock a cycle rider. 2026-09-02: the backend
 * blocked 6–8 s at a time; the rider held 77–99 RPM the entire challenge
 * (sensor-side proof in the bug report) and was locked seven times at
 * currentRpm 0. Contrast case proves genuine silence still locks.
 *
 * Harness mirrors GovernanceEngine.sensorBlip.test.js.
 * See docs/_wip/bugs/2026-09-02-fitness-rpm-false-zeros-pause-video-during-cycle-challenge.md
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { GovernanceEngine } from './GovernanceEngine.js';

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function buildSession() {
  return {
    _deviceRouter: { getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['user_2'] }] },
    getParticipantProfile: () => null,
    zoneProfileStore: null,
    getActiveParticipantState: () => ({ participants: ['user_2'], zoneMap: { user_2: 'active' }, totalCount: 1 })
  };
}

const POLICY = {
  governed_labels: ['cardio'],
  grace_period_seconds: 30,
  policies: {
    default: {
      name: 'Default',
      base_requirement: [{ active: 'all' }],
      challenges: [{
        interval: [1, 1],
        selections: [{
          type: 'cycle', equipment: 'cycle_ace',
          hi_rpm_range: [60, 60], segment_count: [1, 1], segment_duration_seconds: [6, 6],
          ramp_seconds: [5, 5], init: { min_rpm: 30, time_allowed_seconds: 10 },
          lo_rpm_ratio: 0.5, time_allowed: 999
        }]
      }]
    }
  }
};

function makeEngineWithActiveCycle() {
  let nowValue = 100000;
  const engine = new GovernanceEngine(buildSession(), { now: () => nowValue, random: seededRng(42) });
  engine.configure(POLICY);
  engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
  const result = engine.triggerChallenge({ type: 'cycle', selectionId: 'default_0_0', riderId: 'user_2' });
  if (!result || result.success !== true) throw new Error(`triggerChallenge failed: ${result?.reason}`);
  return { engine, setNow: (v) => { nowValue = v; } };
}

function drive(fixture, samples) {
  for (const s of samples) {
    fixture.setNow(s.ts);
    fixture.engine.evaluate({
      activeParticipants: ['user_2'], userZoneMap: { user_2: 'warm' },
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: { active: { id: 'active', name: 'Active' }, warm: { id: 'warm', name: 'Warm' } },
      totalCount: 1,
      equipmentCadenceMap: { cycle_ace: s.entry }
    });
    void fixture.engine.state; // build the published snapshot, as the overlay would
  }
}

const fresh = (rpm, ts) => ({ rpm, connected: true, ts });
const STEP = 200;

// 8 ticks of solid 80 RPM: init → ramp → maintain, well short of the 6 s segment.
function warmUp(ts = 1000) {
  const samples = [];
  for (let i = 0; i < 8; i += 1) { samples.push({ ts, entry: fresh(80, ts) }); ts += STEP; }
  return { samples, ts };
}

describe('Cycle SM — pipeline stall vs genuine silence', () => {
  it('8 s in which NO device delivers never locks a rider who was in the green', () => {
    const f = makeEngineWithActiveCycle();
    const { samples, ts: afterWarm } = warmUp();
    drive(f, samples);
    expect(f.engine.challengeState.activeChallenge.cycleState).toBe('maintain');

    const lastFreshTs = afterWarm - STEP;
    const stall = [];
    let ts = afterWarm;
    // The reader hands back the HELD value with an unchanged ts and the stall flag.
    for (let i = 0; i < 40; i += 1) {
      stall.push({ ts, entry: { rpm: 80, connected: true, ts: lastFreshTs, transportStalled: true } });
      ts += STEP;
    }
    drive(f, stall);
    const active = f.engine.challengeState.activeChallenge;
    expect(active.totalLockEventsCount).toBe(0);
    expect(active.cycleState).toBe('maintain');

    // Pipeline resumes; the rider is still at 80 and completes the segment.
    const resume = [];
    for (let i = 0; i < 40; i += 1) { resume.push({ ts, entry: fresh(80, ts) }); ts += STEP; }
    drive(f, resume);
    expect(f.engine.challengeState.activeChallenge.totalLockEventsCount).toBe(0);
    expect(f.engine.challengeState.activeChallenge.cycleState).toBe('success');
  });

  it('the same 8 s of genuine silence (pipeline alive, bike stopped) does lock', () => {
    const f = makeEngineWithActiveCycle();
    const { samples, ts: afterWarm } = warmUp();
    drive(f, samples);
    expect(f.engine.challengeState.activeChallenge.cycleState).toBe('maintain');

    const silence = [];
    let ts = afterWarm;
    for (let i = 0; i < 40; i += 1) { silence.push({ ts, entry: { rpm: 0, connected: false } }); ts += STEP; }
    drive(f, silence);
    expect(f.engine.challengeState.activeChallenge.totalLockEventsCount).toBeGreaterThan(0);
  });
});
```

If the first `toBe('maintain')` after warm-up fails, the fixture needs more warm-up ticks — raise the `8` in `warmUp` until it passes *before* touching engine code; the sensorBlip precedent reaches maintain in 5.

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/hooks/fitness/GovernanceEngine.transportStall.test.js`
Expected: the contrast test PASSES already; the first test FAILS at `totalLockEventsCount` (≥ 1) — the stall locks today.

**Step 3: Implement — CadenceFilter**

Add after `update`:

```js
  /**
   * Pipeline stall: no device at all is delivering (see
   * DeviceManager.isTransportStalled). Advance the staleness clock WITHOUT a
   * sample so the stall is not charged to the rider as silence — otherwise
   * tick() would decay this to a "lost signal" 0 and the cycle SM would read
   * the rider as stopped. Returns the held value.
   */
  hold(nowTs) {
    if (this._lastUpdateTs !== null) this._lastUpdateTs = nowTs;
    return this._ema ?? 0;
  }
```

**Step 4: Implement — FitnessSession reader**

> **Design corrected 2026-09-02.** An earlier draft returned `connected: true` during a stall. That is WRONG and would have introduced phantom race progress — see Step 5b. The stall flag rides on a `connected: false` reading instead, so every existing consumer keeps its current behaviour and only the governance engine, which checks the flag explicitly, changes.

In `_readCadenceDevice`, replace the block from `const { rpmZero } = this._getTimeouts();` through the final `return`:

```js
    const { rpmZero, transportStallMs = 1800 } = this._getTimeouts();
    const lastActivity = Number.isFinite(device.lastSignificantActivity)
      ? device.lastSignificantActivity
      : (Number.isFinite(device.lastSeen) ? device.lastSeen : null);
    if (lastActivity == null) return disconnected;
    // Pipeline stalled: NO device at all is delivering, so this device's silence
    // says nothing about its rider. Report `connected: false` — every existing
    // consumer then keeps the behaviour it already has for a dropped sensor —
    // but carry the held rpm and a `transportStalled` flag for the one reader
    // that must tell a starved pipeline from a stopped rider (GovernanceEngine's
    // cadence filter). Do NOT report connected:true here: CycleGame treats a
    // connected reading as fresh truth and would accrue phantom race distance.
    if (this.deviceManager?.isTransportStalled?.(transportStallMs)) {
      return { rpm: rpmRaw, connected: false, transportStalled: true, ts: device.lastSeen ?? lastActivity };
    }
    if (Date.now() - lastActivity > rpmZero) return disconnected;
    // Use lastSeen (advances on every packet, including 0 readings) so 0-RPM blips
    // between rotations reach CadenceFilter's EMA.
    return { rpm: rpmRaw, connected: true, ts: device.lastSeen ?? lastActivity };
```

**Also `getEquipmentCadence` must propagate the flag.** Its aggregation loop `continue`s past any reading with `connected: false` and falls through to the bare `disconnected` constant, which would drop `transportStalled` before the governance engine ever sees it. Replace the loop and return:

```js
    let best = null;
    let stalled = null;
    for (const id of deviceIds) {
      const reading = this._readCadenceDevice(id);
      if (reading.transportStalled && (!stalled || reading.rpm > stalled.rpm)) stalled = reading;
      if (!reading.connected) continue;
      if (!best || reading.rpm > best.rpm) best = reading;
    }
    // A live sensor on any wheel wins. Otherwise, if the pipeline is stalled,
    // surface that (with the held rpm) rather than a bare "disconnected" — the
    // two are different states and only one of them means the rider stopped.
    return best || stalled || disconnected;
```

**Step 5: Implement — GovernanceEngine**

(a) In `_filteredCadenceFor`, insert after the `filter` is obtained/created and before `const cadenceEntry = …` is used for freshness — i.e. right after `const cadenceEntry = this._latestInputs?.equipmentCadenceMap?.[equipmentId];`:

```js
    if (cadenceEntry?.transportStalled) {
      // No device at all is delivering. Hold the filter's value and its clock;
      // do NOT run tick(), whose decay would turn a starved pipeline into a
      // "lost signal" 0 that the cycle SM reads as the rider stopping.
      return {
        rpm: filter.hold(nowTs),
        ts: nowTs,
        flags: { implausible: false, smoothed: false, stale: false, lostSignal: false, transportStalled: true }
      };
    }
```

(b) In `_evaluateCycleChallenge`, insert directly after the `if (this._timersPaused) { active._lastCycleTs = now; return; }` block:

```js
    // Pipeline-stall gate: no device at all is delivering (backend/socket
    // stalled — 2026-09-02). We know nothing about the rider, so freeze the
    // clock exactly like a pause: no depletion, no progress, no ramp/init
    // timeout, no lock. A starved pipeline must never lock a kid who is
    // pedalling. Consume dt so the resume tick is a small delta.
    if (ctx.cadenceFlags?.transportStalled) {
      active._lastCycleTs = now;
      return;
    }
```

(c) Pass the flags at both call sites. At ~line 2213:

```js
      this._evaluateCycleChallenge(active, {
        equipmentRpm,
        cadenceFlags: filtered.flags,
        activeParticipants: this._latestInputs?.activeParticipants || [],
```

At ~line 3798:

```js
          const ctx = {
            equipmentRpm,
            cadenceFlags: filtered.flags,
            activeParticipants,
```

**Step 5b: the second consumer this changes — CycleGame** (added 2026-09-02 after a blast-radius check)

`getEquipmentCadence` has a consumer **outside** the governance engine:
`frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` calls it at lines 490, 539, 1022 and 1787, and every one branches on `cadence.connected`.

Line 1022 matters most. That loop runs only while racing and carries its own gap tolerance, commented: *"A connected reading (even 0) is the truth: use it + remember it, and reset the consecutive-gap counter. While the sensor is DROPPED, hold the last good reading through the broadcast gap instead of flatlining."*

Today a stall reaches it as `{rpm: 0, connected: false}` → the game takes its DROPPED branch and holds the last good reading. After this task it arrives as `{rpm: <held>, connected: true, transportStalled: true}` → the game takes its *connected* branch, treats a held value as fresh truth, and **resets its consecutive-gap counter**.

Holding is the right outcome during a stall (the sensor is fine; the pipeline is starved), so the displayed behaviour is acceptable and arguably better than before. But it silently disables the game's own escalation path for the duration, so:

- Read those four call sites before implementing and confirm none of them *fails closed* on a held value — in particular that nothing derives distance/speed from a held RPM in a way that would accrue phantom progress during an 8 s stall. Line 1787 feeds the speed gauge; line 1022 feeds race bookkeeping.
- If phantom race progress IS reachable, STOP and report rather than shipping it. The fix would be for `CycleGameContainer` to treat `transportStalled` as its DROPPED branch, but that is a scope expansion and needs a decision.
- Do not otherwise modify `CycleGameContainer.jsx` in this task.

**Step 6: Run to verify it passes, plus every cycle-SM neighbour**

Run: `npx vitest run frontend/src/hooks/fitness/GovernanceEngine.transportStall.test.js frontend/src/hooks/fitness/GovernanceEngine.sensorBlip.test.js frontend/src/hooks/fitness/GovernanceEngine.challengePause.test.js frontend/src/hooks/fitness/GovernanceEngine.playbackPause.test.js frontend/src/hooks/fitness/FitnessSession.cadenceTs.test.js`
Expected: PASS, all five files. If `sensorBlip` asserts an exact `flags` object with `toEqual`, it is unaffected — the new key only appears in the stall branch.

**Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/CadenceFilter.js frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/GovernanceEngine.transportStall.test.js
git commit -m "fix(fitness): a pipeline stall freezes the cycle challenge instead of locking it

The reader reports transportStalled, CadenceFilter holds its clock
rather than decaying to lost-signal, and _evaluateCycleChallenge
treats the stall like a pause: no depletion, no progress, no lock.
Genuine silence with a live pipeline still locks.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RNUiEG2Bca81qeVbL9uvGN"
```

---

## Part C — Close out

### Task 8: Full suites, docs, bug report

**Step 1: Run the affected suites end to end**

Run: `npx vitest run frontend/src/hooks/fitness/ tests/isolated/adapter/state-gates/ tests/isolated/application/state-gates/ tests/isolated/application/measures/ tests/isolated/adapter/school/ tests/isolated/application/school/ --reporter=dot`
Expected: all PASS. Then the composition contract gate: `npm run test:composition-contracts` — PASS.

**Step 2: Update the bug report**

In `docs/_wip/bugs/2026-09-02-fitness-rpm-false-zeros-pause-video-during-cycle-challenge.md`, change the `**Status:**` line to:

```
**Status:** fixed on `fitness/false-zero-pipeline-stall` (2026-09-02) — see `docs/_wip/plans/2026-09-02-fitness-false-zero-pipeline-stall-fix.md`. Live verification on the next multi-rider session pending (Step 4 below).
```

And append a section at the end:

```markdown
## Fix

Plan: `docs/_wip/plans/2026-09-02-fitness-false-zero-pipeline-stall-fix.md`. Commits on `fitness/false-zero-pipeline-stall`:

| Layer | Change |
|---|---|
| backend | autosave reconciles coalesce on 60 s; ended/deleted stay prompt |
| backend | learners publish sequentially — no revision race, learner-D's rings publish |
| backend | State Gates state cached in memory; file parsed once, written through |
| backend | journal retention 5000/30 d → 500/7 d |
| backend | school prewarm walks each v2 course once, yields between works |
| frontend | `DeviceManager.isTransportStalled`; prune holds cadence during a stall; `device-manager.transport_stalled` / `transport_resumed` logged |
| frontend | reader reports the stall; `CadenceFilter.hold`; cycle SM freezes like a pause |

Not done (recorded, not forgotten): splitting the journal out of `current.yml` (rec. 7), the garage bridge heartbeat/backpressure watchdog (rec. 5), the `FitnessContext.jsx:1406` reconnect blackhole (rec. 4), and the `info`-level relay log (rec. 12).
```

**Step 3: Docs marker**

```bash
git rev-parse HEAD > docs/docs-last-updated.txt
```

**Step 4: Commit**

```bash
git add docs/_wip/bugs/2026-09-02-fitness-rpm-false-zeros-pause-video-during-cycle-challenge.md docs/docs-last-updated.txt
git commit -m "docs: close the 2026-09-02 fitness false-zero report against the fix branch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RNUiEG2Bca81qeVbL9uvGN"
```

**Step 5: Hand back — do not merge or deploy**

Per `CLAUDE.local.md`, merge and deploy are KC's call. Report the branch and this verification recipe for the **next real multi-rider session** (read-only; never start a backend):

```bash
# Backend loop health during the session — want p99 < 500 ms, no 6–8 s rows
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="system.event-loop.lag" AND _time:2h' -d 'limit=200'

# Blocker A gone: corrections should be a handful per session, not 10–13/min,
# and zero publish-failed
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=("state-gates.assertion.corrected" OR "state-gates.fitness.publish-failed") AND _time:2h | stats by (_msg) count()'

# Blocker B gone: prewarm rows no longer sit inside 7.8 s maxMs windows
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="school.banks.prewarmed" AND _time:24h' -d 'limit=50'

# Frontend guard: if a stall still happens it is now NAMED, and must never
# coincide with a health_depleted lock at currentRpm 0
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=("device-manager.transport_stalled" OR "device-manager.transport_resumed" OR "governance.cycle.locked") AND _time:2h' -d 'limit=100'
```

---

## Out of scope (deliberately)

- **Journal split** (bug report rec. 7) — right long-term shape, but Tasks 3+4 remove the cost that made it urgent. Do it when the journal has a second consumer.
- **Garage bridge heartbeat / `bufferedAmount`** (rec. 5) — separately deployed `_extensions/fitness` image; a latent hazard, not this session's cause.
- **`FitnessContext.jsx:1406` reconnect blackhole** (rec. 4) — no evidence it fired; needs its own repro.
- **`WebSocketEventBus` per-message `info` log** (rec. 12) — log volume, not correctness.
