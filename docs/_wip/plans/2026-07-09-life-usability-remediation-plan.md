# Life App Usability Remediation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Life app genuinely usable end-to-end for both an existing user (fix the broken drift/adherence/timing mechanics) and a brand-new user (plan genesis, coach write tools, empty-state funnel, household identity, working notifications).

**Architecture:** Three phases mirroring the 2026-07-09 audit's P0→P2 ladder. Phase A is surgical composition/domain fixes with no schema changes. Phase B reworks `CadenceService` to local-calendar-day math (integer day serials in the household timezone) and adds per-ceremony delivery hours, which together fix the 7am dual-fire, the Tuesday retro, and the evening-misfile bugs. Phase C adds a `PlanAuthoringService` (single write path shared by a new REST genesis/authoring API and new coach write-tools), then the frontend funnel, creation affordances, user switcher, and in-app notification renderer.

**Tech Stack:** Node ESM backend (Express, YAML stores, DDD layers), Mantine React frontend, vitest (isolated) + jest (integrated), Mastra agent tools.

**Source findings:** `docs/_wip/audits/2026-07-09-life-user-journey-vs-implementation-audit.md` (finding numbers referenced as A-x.y below). Journey: `docs/reference/life/user-journey.md`.

**Conventions for the executor:**
- Work on a feature branch/worktree (`feat/life-usability`), not main.
- Run isolated tests with: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs <paths>` from repo root.
- Run integrated tests with: `NODE_OPTIONS=--experimental-vm-modules npx jest --config jest.config.js <path>`.
- Frontend structured logging only (no console.*) — see CLAUDE.md Logging section.
- Never use the real head-of-household identifier in tests; use `test-user`.
- Several frontend files are only partially quoted here; **always Read the file before editing** and anchor edits to the quoted landmarks.

**Explicitly out of scope (deferred to a P3 plan):** inbound Telegram reply routing to the coach, BeliefSignalDetector/LifeEventSignalDetector wiring, MetricsService/BriefingService wiring, calendar-aligned phases/seasons (`mode: calendar`), value→category mapping editor UI, Weekly Review transcript mining, nudge decay / lapse re-entry bridge, onboarding card-sort UI and micro-interview drip (both depend on coach write tools landing first — Task C2 is their prerequisite).

---

## Phase A — P0: Unbreak the existing user

### Task A1: Fix DriftService composition (missing cadenceService/clock) — audit A-3.2a

**Files:**
- Modify: `backend/src/5_composition/modules/lifeplan.mjs` (driftService construction, ~line 47)
- Test: `tests/isolated/composition/lifeplan-bootstrap.test.mjs` (create)

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { bootstrapLifeplan } from '#composition/modules/lifeplan.mjs';

function tmpUserDir(plan) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeplan-boot-'));
  fs.mkdirSync(path.join(base, 'test-user'), { recursive: true });
  fs.writeFileSync(path.join(base, 'test-user', 'lifeplan.yml'),
    `values:\n  - id: health\n    name: Health\n    rank: 1\n  - id: family\n    name: Family\n    rank: 2\ngoals: []\nbeliefs: []\n`);
  return base;
}

describe('bootstrapLifeplan composition', () => {
  it('driftService.computeAndSave does not throw on missing deps (A-3.2a)', async () => {
    const dataPath = tmpUserDir();
    const aggregator = { aggregateRange: async () => ({ days: {} }) };
    const { services } = bootstrapLifeplan({ dataPath, aggregator, logger: null });
    // Must not throw TypeError (cadenceService undefined); empty data → null/benign result
    await expect(services.driftService.computeAndSave('test-user')).resolves.toBeDefined();
  });

  it('alignmentService reports ceremony adherence when records exist (A-3.3)', () => {
    const dataPath = tmpUserDir();
    fs.writeFileSync(path.join(dataPath, 'test-user', 'ceremony-records.yml'),
      `- type: unit_intention\n  periodId: X\n  completedAt: '2026-07-01T00:00:00Z'\n`);
    const aggregator = { aggregateRange: async () => ({ days: {} }) };
    const { services } = bootstrapLifeplan({ dataPath, aggregator, logger: null });
    const result = services.alignmentService.computeAlignment('test-user');
    expect(result.dashboard.ceremonyAdherence).not.toBeNull();
  });
});
```

Note: before finalizing the first test's assertion, Read `backend/src/3_applications/lifeplan/services/DriftService.mjs` — if `computeAndSave` on empty allocation returns a snapshot object, assert on that shape; the essential assertion is *resolves rather than throws*.

**Step 2: Run to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/composition/lifeplan-bootstrap.test.mjs`
Expected: FAIL — first test rejects with `TypeError: Cannot read properties of undefined (reading 'resolve')` (DriftService.mjs:27); second test gets `ceremonyAdherence: null`.

**Step 3: Fix the composition**

In `backend/src/5_composition/modules/lifeplan.mjs`, extend both constructions:

```js
  const driftService = new DriftService({
    lifePlanStore: container.getLifePlanStore(),
    metricsStore: container.getMetricsStore(),
    aggregator,
    cadenceService: container.getCadenceService(),
    clock,
  });
```

```js
  const alignmentService = new AlignmentService({
    lifePlanStore: container.getLifePlanStore(),
    metricsStore: container.getMetricsStore(),
    cadenceService: container.getCadenceService(),
    ceremonyRecordStore: container.getCeremonyRecordStore(),
  });
```

Read `AlignmentService.mjs` constructor to confirm the dep name is `ceremonyRecordStore` (audit cites `#getCeremonyAdherence` returning null when absent, AlignmentService.mjs:150-151).

**Step 4: Run tests to verify they pass**

Run: same command. Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add backend/src/5_composition/modules/lifeplan.mjs tests/isolated/composition/lifeplan-bootstrap.test.mjs
git commit -m "fix(lifeplan): inject cadenceService/clock into DriftService and ceremonyRecordStore into AlignmentService"
```

---

### Task A2: Drift math must not cry wolf on empty intersection — audit A-3.2c

**Files:**
- Modify: `backend/src/2_domains/lifeplan/services/ValueDriftCalculator.mjs` (calculateDrift ~lines 66-83, #spearmanCorrelation ~129-131)
- Test: `tests/isolated/domain/lifeplan/value-drift.test.mjs` (extend existing)

**Step 1: Write the failing tests** (append a new describe block)

```js
describe('insufficient data handling (A-3.2c)', () => {
  it('returns status insufficient_data (not reconsidering) when value ids share <2 categories', () => {
    const calc = new ValueDriftCalculator();
    const values = [
      { id: 'faith-first', rank: 1 },
      { id: 'deep-craft', rank: 2 },
    ]; // ids match no allocation keys
    const allocation = { health: 0.6, family: 0.4 };
    const result = calc.calculateDrift(values, allocation);
    expect(result.status).toBe('insufficient_data');
    expect(result.correlation).toBeNull();
  });

  it('returns insufficient_data when allocation is empty', () => {
    const calc = new ValueDriftCalculator();
    const result = calc.calculateDrift([{ id: 'health', rank: 1 }, { id: 'family', rank: 2 }], {});
    expect(result.status).toBe('insufficient_data');
  });
});
```

Read the existing test file first and match its construction style (it may pass values/allocation differently — adapt argument shapes to the real `calculateDrift` signature, keeping the assertions).

**Step 2: Run to verify failure**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/domain/lifeplan/value-drift.test.mjs`
Expected: FAIL — current code returns correlation `0` and status `'reconsidering'`.

**Step 3: Implement**

In `ValueDriftCalculator.mjs`: `#spearmanCorrelation` currently returns `0` when `common.length < 2`; change it to return `null`, and in `calculateDrift` short-circuit:

```js
    const correlation = this.#spearmanCorrelation(statedRanks, observedRanks);
    if (correlation === null) {
      return { correlation: null, status: 'insufficient_data', allocation };
    }
```

Keep the existing thresholds for real correlations. Then Read `AlignmentService.mjs` (~lines 27-31, 104-112) and make the drift-alert priority item skip `status === 'insufficient_data'` snapshots the same way it skips a null snapshot.

**Step 4: Run tests**

Run: same file, plus `tests/isolated/domain/lifeplan/drift-detection.test.mjs` and `tests/isolated/lifeplan` to catch regressions. Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/2_domains/lifeplan/services/ValueDriftCalculator.mjs backend/src/3_applications/lifeplan/services/AlignmentService.mjs tests/isolated/domain/lifeplan/value-drift.test.mjs
git commit -m "fix(lifeplan): unmapped values yield insufficient_data, not a false drift alarm"
```

---

### Task A3: Distinguish "no plan" from "unknown ceremony type" — audit A-1.5

**Files:**
- Modify: `backend/src/4_api/v1/routers/life/plan.mjs` (GET /ceremony/:type ~line 137, POST /ceremony/:type/complete ~line 148)
- Test: `tests/isolated/api/routers/life-user.test.mjs` (extend) or new `life-ceremony.test.mjs`

**Step 1: Failing test**

```js
describe('ceremony endpoints without a plan', () => {
  it('returns 404 NO_PLAN for a valid type when user has no plan', async () => {
    const res = await request(app).get('/api/v1/life/plan/ceremony/unit_intention');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_PLAN');
  });
  it('still returns 400 for a genuinely unknown type', async () => {
    // fixture user WITH a plan
    const res = await request(appWithPlan).get('/api/v1/life/plan/ceremony/nonsense_type');
    expect(res.status).toBe(400);
  });
});
```

(Build `app`/`appWithPlan` with the same mock-config pattern as `life-user.test.mjs`, one lifePlanStore returning null, one returning a minimal plan object with `cadence: {}`.)

**Step 2: Run — expect FAIL** (today both cases return 400 "Unknown ceremony type").

**Step 3: Implement**

In `plan.mjs`, before calling the service in both ceremony handlers:

```js
      if (!lifePlanStore.load(getUsername(req))) {
        return res.status(404).json({ error: 'No life plan exists for this user yet', code: 'NO_PLAN' });
      }
```

**Step 4: Run tests — PASS.** Also rerun `tests/isolated/api/routers/life-*.test.mjs`.

**Step 5: Commit** — `fix(life-api): planless ceremony requests return 404 NO_PLAN instead of misleading 400`

---

### Task A4: CeremonyFlow friendly failure + no self-silencing of unimplemented types — audit A-1.5, A-4.2

**Files:**
- Modify: `frontend/src/modules/Life/views/ceremony/CeremonyFlow.jsx` (error render ~line 51-54; unimplemented fallback ~line 94; CEREMONY_COMPONENTS ~lines 20-25)
- Modify (small): `frontend/src/modules/Life/hooks/useCeremony.js` (~line 35 — surface response `code`)

**Step 1: Read both files fully.**

**Step 2: Implement, in order:**
1. `useCeremony.fetchContent`: on `!res.ok`, parse the JSON body and set `error = { status: res.status, code: body.code, message: body.error }` instead of throwing a bare `HTTP ${status}` string.
2. `CeremonyFlow` error branch: when `error.code === 'NO_PLAN'`, render a Mantine `Paper` with: title "You don't have a life plan yet", one sentence ("Ceremonies work against your plan — create one first."), a `Button` → `navigate('/life/coach')` labeled "Talk to your coach", and a subtle secondary link → `/life/plan`. Any other error renders `Alert color="red"` with `error.message` (never the raw string `HTTP 400`).
3. Unimplemented types: where the fallback "Ceremony type not yet implemented" renders (~line 94), also **suppress the Complete button** for types absent from `CEREMONY_COMPONENTS` (compute `const implemented = type in CEREMONY_COMPONENTS;` and gate the completion control). Copy: "This ceremony is coming soon — completing it is disabled so it stays on your schedule."

**Step 3: Verify.** No unit harness exists for these views; verify live: with the dev backend running (backend on app-port+1), `curl` confirms A3's 404, then load `/life/ceremony/unit_intention?username=<a-user-with-no-plan>` in a browser (or add a temporary test user dir) and confirm the friendly card renders; load `/life/ceremony/era_vision` as the plan-holding user and confirm no Complete button. Use the `verify` skill's spirit: drive the real flow.

**Step 4: Commit** — `fix(life-ui): friendly NO_PLAN ceremony state; unimplemented ceremonies can't be completed/silenced`

---

### Task A5: Schedule nightly drift computation — audit A-3.2b

**Files:**
- Modify: `backend/src/app.mjs` (next to the `lifeplan:ceremony-check` registration)
- Test: extend `tests/isolated/composition/lifeplan-bootstrap.test.mjs` is not applicable (app.mjs isn't unit-tested); verify via boot log.

**Step 1: Implement**

```js
  // Nightly drift/allocation snapshot per user with a plan — the dashboard's
  // drift gauge and the weekly retro read these snapshots.
  if (agentsServices.scheduler) {
    agentsServices.scheduler.registerTask('lifeplan:drift-refresh', '0 2 * * *', async () => {
      const lifePlanStore = lifeplanResult.container.getLifePlanStore();
      for (const username of lifePlanStore.listUsernames()) {
        try {
          await lifeplanResult.services.driftService.computeAndSave(username);
        } catch (err) {
          rootLogger.warn('lifeplan.drift.refresh_failed', { username, error: err.message });
        }
      }
    });
  }
```

**Step 2: Verify** — restart dev backend, boot log shows `scheduler.registered {"jobKey":"lifeplan:drift-refresh"...}`; then `curl -s -X POST localhost:<backend-port>/api/v1/life/now/drift/refresh` returns 200 with a snapshot (A1 fixed the 500) and `data/users/<user>/lifeplan-metrics.yml` appears.

**Step 3: Commit** — `feat(lifeplan): nightly drift snapshot task`

---

## Phase B — P1: Make the daily loop honest

### Task B1: Local-calendar-day cadence (timezone-correct, integer day serials) — audit A-2.3, A-3.1, A-4.4

This is the heart of Phase B. Replace UTC-millisecond fractional math with **integer local-day serials**: a date is converted to its calendar (Y,M,D) in the household timezone via `Intl.DateTimeFormat` (no new deps, domain stays pure), then to a day serial `Date.UTC(y, m-1, d)/86400000`. All period math is integer arithmetic on serials. This simultaneously fixes: evening rollover into tomorrow's period, the fractional `<1 day` dual-due window, and the local/UTC year mix in periodId.

**Files:**
- Modify: `backend/src/2_domains/lifeplan/services/CadenceService.mjs` (full rework of the private helpers; public API unchanged)
- Modify: `backend/src/3_applications/lifeplan/LifeplanContainer.mjs` (pass `timezone` into CadenceService)
- Modify: `backend/src/5_composition/modules/lifeplan.mjs` + `backend/src/app.mjs` (thread `timezone` from `configService.getHouseholdTimezone()`)
- Test: `tests/isolated/domain/lifeplan/cadence-timezone.test.mjs` (create)

**Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest';
import { CadenceService } from '#domains/lifeplan/services/CadenceService.mjs';

const TZ = 'America/Los_Angeles';

describe('CadenceService local-day semantics', () => {
  it('an 11pm PT instant resolves to the SAME local day as 7am PT that morning', () => {
    const svc = new CadenceService({ timezone: TZ });
    const morning = new Date('2025-01-08T15:00:00Z'); // 7am PST Jan 8
    const night   = new Date('2025-01-09T07:00:00Z'); // 11pm PST Jan 8
    expect(svc.resolve({}, night).unit.periodId).toBe(svc.resolve({}, morning).unit.periodId);
  });

  it('default cycles run Monday→Sunday in the household timezone', () => {
    const svc = new CadenceService({ timezone: TZ });
    // 2026-07-06 is a Monday; expect it to start a cycle
    const mon = svc.resolve({}, new Date('2026-07-06T20:00:00Z'));
    const sun = svc.resolve({}, new Date('2026-07-12T20:00:00Z'));
    const nextMon = svc.resolve({}, new Date('2026-07-13T20:00:00Z'));
    expect(mon.cycle.periodId).toBe(sun.cycle.periodId);        // same week
    expect(nextMon.cycle.periodId).not.toBe(sun.cycle.periodId); // rolls Monday
    expect(svc.isCeremonyDue('end_of_cycle', {}, new Date('2026-07-12T20:00:00Z'), null)).toBe(true);  // Sunday
    expect(svc.isCeremonyDue('end_of_cycle', {}, new Date('2026-07-11T20:00:00Z'), null)).toBe(false); // Saturday
  });

  it('start_of_unit and end_of_unit are both due on the day (time gating is the scheduler concern)', () => {
    const svc = new CadenceService({ timezone: TZ });
    const t = new Date('2025-01-08T15:00:00Z');
    expect(svc.isCeremonyDue('start_of_unit', {}, t, null)).toBe(true);
    expect(svc.isCeremonyDue('end_of_unit', {}, t, null)).toBe(true);
  });

  it('periodId year comes from the local calendar (Dec 31 11pm PT is still the old year)', () => {
    const svc = new CadenceService({ timezone: TZ });
    const nyEvePT = new Date('2026-01-01T07:00:00Z'); // 11pm PST Dec 31 2025
    expect(svc.resolve({}, nyEvePT).unit.periodId.startsWith('2025')).toBe(true);
  });

  it('lastCeremonyDate in the current period marks not-due (dedupe unchanged)', () => {
    const svc = new CadenceService({ timezone: TZ });
    const t = new Date('2025-01-08T15:00:00Z');
    expect(svc.isCeremonyDue('start_of_unit', {}, t, '2025-01-08T14:00:00Z')).toBe(false);
  });
});
```

**Step 2: Run — expect FAIL** (rollover test and Monday test fail against UTC/Wednesday math).

**Step 3: Implement the rework in `CadenceService.mjs`**

Key pieces (keep `resolve`, `currentPeriodId`, `isCeremonyDue`, `getNextCeremonyTime` signatures; constructor gains options):

```js
const DEFAULT_TZ = 'UTC';
// 2024-12-30 is a Monday — default cycles align to human weeks (A-3.1)
const DEFAULT_EPOCH = '2024-12-30';

export class CadenceService {
  #timezone;
  constructor({ timezone } = {}) {
    this.#timezone = timezone || DEFAULT_TZ;
  }

  // (Y,M,D) of the instant in the service timezone → integer day serial
  #daySerial(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.#timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const get = (t) => Number(parts.find(p => p.type === t).value);
    return { serial: Date.UTC(get('year'), get('month') - 1, get('day')) / 86400000, year: get('year') };
  }

  // Epoch strings are calendar dates, not instants — parse as plain Y/M/D
  #epochSerial(epoch) {
    const [y, m, d] = String(epoch).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  }
```

`#normalizeConfig` keeps its duration parsing but stores `epochSerial: this.#epochSerial(userCfg.epoch || DEFAULT_EPOCH)`. `resolve` computes per level: `periodIndex = Math.floor((daySerial - epochSerial) / duration_days)`, `startSerial = epochSerial + periodIndex * duration_days`, `startDate = new Date(startSerial * 86400000)` (kept for API compat; document it as the UTC instant of the local day). `#formatPeriodId` uses the **local** year from `#daySerial` (fixes A-4.4).

`isCeremonyDue` becomes integer comparisons:

```js
  isCeremonyDue(ceremonyTiming, cadenceConfig, today, lastCeremonyDate) {
    const config = this.#normalizeConfig(cadenceConfig);
    const [position, , level] = ceremonyTiming.split('_');
    if (!level || !config[level]) return false;
    const cfg = config[level];
    const { serial: todaySerial } = this.#daySerial(typeof today === 'string' ? new Date(today) : today);
    const startSerial = cfg.epochSerial + Math.floor((todaySerial - cfg.epochSerial) / cfg.duration_days) * cfg.duration_days;
    const endSerial = startSerial + cfg.duration_days - 1;

    if (lastCeremonyDate) {
      const { serial: lastSerial } = this.#daySerial(new Date(lastCeremonyDate));
      if (lastSerial >= startSerial) return false; // already done this period
    }
    if (position === 'start') return todaySerial === startSerial;
    if (position === 'end') return todaySerial === endSerial;
    return false;
  }
```

`getNextCeremonyTime` mirrors the same serial math (`next start = startSerial + duration`, `next end = endSerial + duration` when past). Delete `#periodIndex`, `#periodStartDate`, `#daysDiff` UTC-ms versions.

**Step 4: Thread the timezone.** `LifeplanContainer` — Read it; its `getCadenceService()` lazily constructs `new CadenceService()`; change to `new CadenceService({ timezone: this.#options.timezone })` and accept `timezone` in the container options. `modules/lifeplan.mjs`: accept `timezone` in `bootstrapLifeplan` deps, pass into the container. `app.mjs`: pass `timezone: configService.getHouseholdTimezone()` at the `bootstrapLifeplan` call site.

**Step 5: Run the new file + the whole lifeplan test set**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/domain/lifeplan tests/isolated/lifeplan tests/isolated/composition`
Expected: new tests PASS. `cadence-service.test.mjs` has assertions baked to the old Wednesday epoch (its comment "2025-01-01 is a cycle start") — update those specific expectations to the Monday default, do not weaken the new tests. Also run the integrated jest suite (`tests/integrated/lifeplan/`).

**Step 6: Commit** — `fix(lifeplan): cadence resolves in household-local calendar days; Monday-aligned default cycles`

---

### Task B2: Per-ceremony delivery hours + hourly scheduler — audit A-2.2

Design: `plan.ceremonies.<type>.at: "HH:00"` with per-type defaults (`unit_intention` 07:00, `unit_capture` 20:00, `cycle_retro` 17:00, `phase_review` 17:00, `season_alignment`/`era_vision` 17:00). The scheduler task runs **hourly**; `CeremonyScheduler` notifies only when the current household-local hour equals the ceremony's hour (stateless — no new notify-dedupe store needed; completion dedupe still applies). A missed hour (server down) skips that day's nudge, which is acceptable.

**Files:**
- Modify: `backend/src/3_applications/lifeplan/services/CeremonyScheduler.mjs`
- Modify: `backend/src/app.mjs` (cron `'0 7 * * *'` → `'0 * * * *'` for `lifeplan:ceremony-check`)
- Test: `tests/isolated/lifeplan/services/ceremony-scheduling.test.mjs` (extend)

**Step 1: Failing tests** (extend the CeremonyScheduler describe; construct with `timezone: 'America/Los_Angeles'` and a real `CadenceService` is not needed — keep the mocked cadence service, the hour gate is scheduler-local):

```js
  it('gates each ceremony to its delivery hour (default: intention 07, capture 20)', async () => {
    const at7am = new CeremonyScheduler({ ...deps, timezone: 'UTC', clock: { now: () => new Date('2025-06-15T07:30:00Z') } });
    const sent7 = await at7am.checkAndNotify('test-user');
    expect(sent7.map(s => s.type)).toContain('unit_intention');
    expect(sent7.map(s => s.type)).not.toContain('unit_capture');

    const at8pm = new CeremonyScheduler({ ...deps, timezone: 'UTC', clock: { now: () => new Date('2025-06-15T20:10:00Z') } });
    const sent20 = await at8pm.checkAndNotify('test-user');
    expect(sent20.map(s => s.type)).toContain('unit_capture');
    expect(sent20.map(s => s.type)).not.toContain('unit_intention');
  });

  it('honors plan.ceremonies.<type>.at override', async () => {
    mockLifePlanStore.load.mockReturnValue({ ceremonies: { unit_intention: { enabled: true, at: '09:00' } }, cadence: {} });
    const at9 = new CeremonyScheduler({ ...deps, timezone: 'UTC', clock: { now: () => new Date('2025-06-15T09:05:00Z') } });
    expect((await at9.checkAndNotify('test-user')).map(s => s.type)).toContain('unit_intention');
  });
```

(Refactor the existing beforeEach so `deps` is reusable; existing tests must pin their clock to each ceremony's delivery hour — update them deliberately, e.g. run the generic "sends notification" test at 07:xx.)

**Step 2: Run — FAIL** (no hour gating exists).

**Step 3: Implement in `CeremonyScheduler.mjs`**

```js
const DEFAULT_DELIVERY_HOUR = {
  unit_intention: 7, unit_capture: 20, cycle_retro: 17,
  phase_review: 17, season_alignment: 17, era_vision: 17,
};

  #localHour(date) {
    return Number(new Intl.DateTimeFormat('en-US', {
      timeZone: this.#timezone || 'UTC', hour: '2-digit', hourCycle: 'h23',
    }).format(date));
  }
```

Constructor accepts `timezone`. In the loop, after the `enabled` check:

```js
      const atHour = Number.parseInt(config?.at, 10);
      const deliveryHour = Number.isFinite(atHour) ? atHour : DEFAULT_DELIVERY_HOUR[type] ?? 7;
      if (this.#localHour(now) !== deliveryHour) continue;
```

Thread `timezone` from `bootstrapLifeplan` (same value as B1). In `app.mjs` change the task cron to `'0 * * * *'` and update the comment.

**Step 4: Run** the scheduler suite + integrated ceremony-delivery (pin its clock to 08:00Z → update its expectations to the delivery-hour model: run the check at each relevant hour or set `at` overrides in the fixture plan so all remain testable in one pass).

**Step 5: Commit** — `feat(lifeplan): per-ceremony delivery hours; ceremony check runs hourly with local-hour gating`

---

### Task B3: Evening capture echoes the morning's intentions — audit A-2.4

**Files:**
- Modify: `backend/src/3_applications/lifeplan/services/CeremonyService.mjs` (unit_capture branch, ~line 46)
- Modify: `frontend/src/modules/Life/views/ceremony/UnitCapture.jsx` (step 0)
- Test: `tests/isolated/lifeplan/services/ceremony-scheduling.test.mjs` (CeremonyService describe)

**Step 1: Failing test**

```js
  it('unit_capture content includes the same-period unit_intention responses', () => {
    mockCeremonyRecordStore.getRecords.mockReturnValue([
      { type: 'unit_intention', periodId: '2025-U165', responses: { intentions: 'intervals at 6', energy: 'high' } },
    ]);
    const content = service.getCeremonyContent('unit_capture', 'test-user');
    expect(content.morningIntention.responses.intentions).toBe('intervals at 6');
  });
```

**Step 2: Run — FAIL.**

**Step 3: Implement** — in the `unit_capture` case:

```js
      case 'unit_capture': {
        const todayIntentions = this.#ceremonyRecordStore
          .getRecords(username, 'unit_intention')
          .filter(r => (r.periodId || r.period_id) === base.periodId);
        return {
          ...base,
          activeGoals: (plan.getActiveGoals?.() || []),
          morningIntention: todayIntentions[todayIntentions.length - 1] || null,
        };
      }
```

**Step 4: Frontend** — Read `UnitCapture.jsx`; in step 0, above the goals list, render when `content?.morningIntention`:
a `Paper` titled "This morning you said" with the intention text and energy badge. (Note: real records nest `responses.responses.*` — normalize: `const morning = content.morningIntention?.responses?.responses || content.morningIntention?.responses || {}`.)

**Step 5: Run backend tests — PASS. Verify frontend live** (complete a unit_intention, open unit_capture, see the echo).

**Step 6: Commit** — `feat(lifeplan): evening capture shows the morning's intentions`

---

### Task B4: Telegram "Begin" inline button — audit A-2.5 (outbound half)

**Files:**
- Modify: `backend/src/1_adapters/notification/TelegramNotificationAdapter.mjs`
- Modify: `backend/src/5_composition/modules/notifications.mjs` + `backend/src/app.mjs` (thread `publicBaseUrl`)
- Test: `tests/isolated/adapters/notification-channels.test.mjs` (extend)

**Step 1: Failing test**

```js
  it('renders intent.actions with url data as an inline keyboard', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const adapter = new TelegramNotificationAdapter({
      telegramAdapter: { sendMessage },
      resolveChatId: () => '12345',
      publicBaseUrl: 'https://example.test',
    });
    await adapter.send({ ...intent({ username: 'test-user' }),
      actions: [{ label: 'Begin', action: 'open', data: { url: '/life/ceremony/unit_intention' } }] });
    const opts = sendMessage.mock.calls[0][2];
    expect(opts.replyMarkup.inline_keyboard[0][0]).toEqual(
      { text: 'Begin', url: 'https://example.test/life/ceremony/unit_intention' });
  });

  it('omits the keyboard when no publicBaseUrl is configured', async () => {
    /* same but no publicBaseUrl → opts.replyMarkup undefined, still delivered */
  });
```

**Step 2: Read `TelegramAdapter.sendMessage`** (~line 100) to confirm the exact option key it forwards as `reply_markup` (the adapter builds `params.reply_markup` from an options field — match its naming; adjust the test accordingly).

**Step 3: Implement** — in `TelegramNotificationAdapter.send`, build the keyboard from url-bearing actions:

```js
      const buttons = (intent.actions || [])
        .filter(a => a?.data?.url && this.#publicBaseUrl)
        .map(a => ({ text: a.label || 'Open', url: new URL(a.data.url, this.#publicBaseUrl).href }));
      const opts = { parseMode: 'Markdown' };
      if (buttons.length) opts.replyMarkup = { inline_keyboard: [buttons] };
      await adapter.sendMessage(chatId, text, opts);
```

Constructor gains `publicBaseUrl`. Composition: `bootstrapNotifications` accepts and forwards `publicBaseUrl`; `app.mjs` passes it from config — Read `ConfigService` for an existing public-URL getter (grep `public_url\|baseUrl\|app_url` in `backend/src/0_system/config/`); if none exists, read `configService.getAppConfig('system')?.public_url ?? null` and note in a comment that unset ⇒ text-only nudges.

**Step 4: Run adapter tests — PASS. Then live-verify once**: trigger one notification through the stack (reuse the pattern from the wiring session's verification script) and confirm the button renders in Telegram. Send exactly one.

**Step 5: Commit** — `feat(notifications): telegram inline action buttons with configurable public base URL`

---

## Phase C — P2: Open the doors for the new user

### Task C1: PlanAuthoringService + genesis/authoring API — audit A-1.1

One write path shared by REST and coach tools. Genesis creates a minimal valid plan; authoring methods create-if-missing then append.

**Files:**
- Create: `backend/src/3_applications/lifeplan/services/PlanAuthoringService.mjs`
- Modify: `backend/src/4_api/v1/routers/life/plan.mjs` (new POST routes)
- Modify: `backend/src/5_composition/modules/lifeplan.mjs` (construct + expose + routerConfig)
- Test: `tests/isolated/lifeplan/services/plan-authoring.test.mjs` (create), `tests/isolated/api/routers/life-user.test.mjs` (extend)

**Step 1: Failing service tests**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlanAuthoringService } from '#apps/lifeplan/services/PlanAuthoringService.mjs';

describe('PlanAuthoringService', () => {
  let store, saved, svc;
  beforeEach(() => {
    saved = null;
    store = { load: vi.fn().mockReturnValue(null), save: vi.fn((u, p) => { saved = p; }) };
    svc = new PlanAuthoringService({ lifePlanStore: store });
  });

  it('createPlan seeds a minimal valid plan; refuses to overwrite', () => {
    const plan = svc.createPlan('test-user');
    expect(store.save).toHaveBeenCalledWith('test-user', expect.anything());
    expect(plan.goals).toEqual([]);
    store.load.mockReturnValue(plan);
    expect(() => svc.createPlan('test-user')).toThrow(/already exists/);
  });

  it('addGoal creates the plan if missing and slugs an id', () => {
    const goal = svc.addGoal('test-user', { name: 'Run a half marathon', why: 'health', milestone: '10k by Sept' });
    expect(goal.id).toBe('run-a-half-marathon');
    expect(goal.state).toBe('considered');
    expect(saved.goals).toHaveLength(1);
  });

  it('addValue appends with next rank; addBelief seeds hypothesized', () => {
    svc.addValue('test-user', { name: 'Health' });
    const v2 = svc.addValue('test-user', { name: 'Family' });
    expect(v2.rank).toBe(2);
    const b = svc.addBelief('test-user', { if_hypothesis: 'train before 8am', then_outcome: 'training happens' });
    expect(b.state).toBe('hypothesized');
    expect(b.confidence).toBeGreaterThan(0);
  });
});
```

Before writing the implementation, Read `Goal.mjs`, `Value.mjs`, `Belief.mjs`, `Purpose.mjs` constructors so the seeded fields match entity expectations (state names, `confidence` default, `rank`), and adjust seeds/tests to the real field names (e.g. beliefs may use `if_hypothesis`/`then_outcome` — verify).

**Step 2: Run — FAIL (module not found).**

**Step 3: Implement `PlanAuthoringService.mjs`**

```js
import { LifePlan } from '#domains/lifeplan/entities/LifePlan.mjs';

const slug = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

export class PlanAuthoringService {
  #lifePlanStore;
  constructor({ lifePlanStore }) { this.#lifePlanStore = lifePlanStore; }

  createPlan(username) {
    if (this.#lifePlanStore.load(username)) throw new Error(`Plan already exists for ${username}`);
    const plan = new LifePlan({});
    this.#lifePlanStore.save(username, plan);
    return plan;
  }

  #loadOrCreate(username) {
    return this.#lifePlanStore.load(username) || (this.#lifePlanStore.save(username, new LifePlan({})), this.#lifePlanStore.load(username));
  }

  #uniqueId(base, existing) {
    let id = slug(base) || 'item'; let n = 2;
    while (existing.some(e => e.id === id)) id = `${slug(base)}-${n++}`;
    return id;
  }

  addGoal(username, { name, why = '', milestone = null }) { /* build entity-shaped object, push, save, return goal.toJSON() */ }
  addValue(username, { name, description = '' }) { /* rank = values.length + 1 */ }
  addBelief(username, { if_hypothesis, then_outcome }) { /* state 'hypothesized', confidence 0.5, evidence_history: [] */ }
  setPurpose(username, { statement }) { /* create/replace purpose */ }
}
```

(Fill the bodies against the real entity constructors from Step 1's reading; each mutator: `#loadOrCreate` → append entity instance → `save` → return the added item's `toJSON()`.)

**Step 4: API routes** in `plan.mjs`:

```js
  // POST / — plan genesis (409 if one exists)
  router.post('/', (req, res, next) => {
    try {
      const username = getUsername(req);
      if (lifePlanStore.load(username)) return res.status(409).json({ error: 'Plan already exists' });
      planAuthoringService.createPlan(username);
      logger.info('life.plan.created', { username });
      res.status(201).json({ ok: true });
    } catch (error) { next(error); }
  });

  // POST /goals, /values, /beliefs — authoring (creates plan if missing)
  router.post('/goals', ...);   // body: { name, why?, milestone? } → 400 if !name
  router.post('/values', ...);  // body: { name }
  router.post('/beliefs', ...); // body: { if_hypothesis, then_outcome }
```

Wire `planAuthoringService` through `modules/lifeplan.mjs` (construct after feedbackService; add to routerConfig and to the returned `services`).

**Step 5: Router tests** (extend `life-user.test.mjs` pattern): POST /plan → 201, second POST → 409, POST /goals with name → 201 + goal in body, POST /goals without name → 400.

**Step 6: Run all lifeplan suites — PASS. Commit** — `feat(lifeplan): PlanAuthoringService + plan genesis/authoring API`

---

### Task C2: Coach write tools (create, confirmed-by-conversation) — audit A-1.2/A-1.3

Design decision: rather than building a proposal-apply UI, the coach gets **direct create tools** whose descriptions require conversational confirmation first ("Only call after the user has explicitly agreed"). The existing `propose_*` tools remain for transitions/evidence (those mutate existing state and stay human-applied via the UI).

**Files:**
- Modify: `backend/src/3_applications/agents/lifeplan-guide/tools/PlanToolFactory.mjs`
- Modify: `backend/src/5_composition/bootstrap.mjs` (lifeplan-guide registration: pass `planAuthoringService` from `config.lifeplanServices.services`)
- Modify: `backend/src/app.mjs` (already passes `lifeplanServices.services` — confirm `planAuthoringService` is in the returned services from C1)
- Modify: `backend/src/3_applications/agents/lifeplan-guide/prompts/system.mjs` (read it first; add onboarding behavior)
- Test: `tests/isolated/lifeplan/services/plan-authoring.test.mjs` stands; add tool-level test `tests/isolated/agents/lifeplan-guide-tools.test.mjs`

**Step 1: Failing tool test**

```js
import { describe, it, expect, vi } from 'vitest';
import { PlanToolFactory } from '#apps/agents/lifeplan-guide/tools/PlanToolFactory.mjs';

describe('PlanToolFactory write tools', () => {
  it('exposes create_goal/add_value/add_belief/set_purpose backed by PlanAuthoringService', async () => {
    const planAuthoringService = { addGoal: vi.fn().mockReturnValue({ id: 'g' }), addValue: vi.fn(), addBelief: vi.fn(), setPurpose: vi.fn() };
    const factory = new PlanToolFactory({ lifePlanStore: { load: () => null }, planAuthoringService });
    const tools = factory.createTools();
    const names = tools.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['create_goal', 'add_value', 'add_belief', 'set_purpose']));
    const createGoal = tools.find(t => t.name === 'create_goal');
    const out = await createGoal.execute({ username: 'test-user', name: 'Ship it' });
    expect(planAuthoringService.addGoal).toHaveBeenCalledWith('test-user', expect.objectContaining({ name: 'Ship it' }));
    expect(out.created.id).toBe('g');
  });
});
```

(Check how existing factory tests import/construct — mirror `createTools()` usage; adjust `execute` signature to the ITool contract used by the other tools.)

**Step 2: Run — FAIL.**

**Step 3: Implement** — add four `createTool` entries to `PlanToolFactory.createTools()`; each description begins: *"Writes to the user's plan. Only call after the user has explicitly confirmed in conversation."* Parameters mirror the authoring service; each execute delegates and returns `{ created }` (or `{ error }` on throw — match the factory's existing error envelope style). Update the factory's constructor deps and the agent registration in `bootstrap.mjs` (`planAuthoringService: config.lifeplanServices.services.planAuthoringService`).

**Step 4: System prompt** — extend `prompts/system.mjs` with an onboarding section: when `get_plan` shows an empty/missing plan, run the first-session structure (values → 1-2 goals → one belief), confirm each item aloud before writing, and always read the plan via tools before answering questions about it (addresses the observed fabrication).

**Step 5: Run tool tests — PASS. Live-verify** (dev backend, one `/api/v1/agents/lifeplan-guide/run` call as a scratch test user: "I want to set up my plan; my top value is health, add it" → confirm `data/users/<scratch>/lifeplan.yml` gains the value; delete the scratch user dir after).

**Step 6: Commit** — `feat(coach): lifeplan-guide can author the plan (create goal/value/belief/purpose) after conversational confirmation`

---

### Task C3: Empty-state funnel on the dashboard — audit A-0.2, A-0.3

**Files:**
- Modify: `frontend/src/modules/Life/views/now/Dashboard.jsx`
- Modify: `frontend/src/modules/Life/views/plan/GoalsView.jsx` (empty copy + add button comes in C4)
- Modify: `frontend/src/modules/Life/hooks/useLifePlan.js` (expose `isEmpty`)

**Step 1: Read all three files.**

**Step 2: Implement**
1. `useLifePlan`: after fetching, `const isEmpty = !plan || Object.keys(plan).length === 0 || ((plan.goals?.length ?? 0) === 0 && (plan.values?.length ?? 0) === 0 && !plan.purpose);` — return it.
2. `Dashboard.jsx`: call `useLifePlan()`'s plan fetch (or a lightweight `GET /plan` via the hook) and when `isEmpty`, render an onboarding `Paper` *above* everything else: title "You don't have a life plan yet", body "Ten minutes with your coach gets you a working plan — values, a goal or two, and your first check-in tomorrow morning.", primary `Button` → `/life/coach`, secondary subtle button "Browse my life log first" → `/life/log`. Keep the rest of the dashboard rendering below (it degrades gracefully already).
3. `GoalsView.jsx`: add empty copy ("No goals yet — add one below, or let your coach walk you through it.") so the page is never blank (A-0.3).

**Step 3: Verify live** with a scratch planless user (`?username=` override): `/life/now` shows the funnel; `/life/plan/goals` shows copy, not blankness.

**Step 4: Commit** — `feat(life-ui): planless dashboard funnels to the coach; GoalsView empty state`

---

### Task C4: Creation affordances in Plan views — audit A-1.4

**Files:**
- Modify: `frontend/src/modules/Life/views/plan/GoalsView.jsx`, `ValuesView.jsx`, `BeliefsView.jsx`
- Modify: `frontend/src/modules/Life/hooks/useLifePlan.js` (add `createGoal`, `addValue`, `addBelief` POST helpers)

**Step 1: Hook helpers** (mirror the existing mutation style in the hook — read it first):

```js
  const post = async (path, body) => {
    const res = await fetch(`${BASE}${path}${qs}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    return res.json();
  };
  // createGoal({name, why, milestone}) → post('/goals', ...) then refetch()
```

**Step 2: UI per view** — a Mantine `Button` ("Add goal" / "Add value" / "Add belief") opening a small `Modal`:
- Goal: TextInput name (required), Textarea why, TextInput first milestone.
- Value: TextInput name (appends at next rank; existing arrows already re-rank).
- Belief: two TextInputs — "If I…" / "then…".
On submit: call the helper, close, refetch; on error show inline `Alert`. Match each view's existing component idioms (they all use `useLifePlan`-family hooks + Mantine primitives).

**Step 3: Verify live** — as the scratch user, add one of each from the UI; confirm they render and persist in the YAML.

**Step 4: Commit** — `feat(life-ui): create goals, values, and beliefs from the plan views`

---

### Task C5: Household user switcher — audit A-0.1

Design: a `GET /api/v1/life/users` endpoint lists household members (username + display name); LifeApp renders a compact user `Select` in the header; the chosen username is kept in `localStorage` (`life.username`) and drives `useLifeUser` (which passes `?username=`), and all Life hooks already inherit from `LifeUserContext` or must be extended to send it.

**Files:**
- Modify: `backend/src/4_api/v1/routers/life.mjs` (add GET /users)
- Modify: `backend/src/5_composition/modules/lifeplan.mjs` / `app.mjs` (life router needs a `listUsers` capability: pass `userService` — already in routerConfig — plus `configService.getHouseholdUsers` via a `listHouseholdUsers` function dep)
- Modify: `frontend/src/modules/Life/hooks/useLifeUser.js`, `frontend/src/Apps/LifeApp.jsx`
- Modify: `frontend/src/modules/Life/hooks/useLifePlan.js`, `useCeremony.js`, `useAlignment.js`, `useDrift.js` — append `?username=` from `LifeUserContext`
- Test: `tests/isolated/api/routers/life-user.test.mjs` (extend)

**Step 1: Failing router test**

```js
  it('GET /users lists household members with display names', async () => {
    const res = await request(app).get('/api/v1/life/users');
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ username: 'test-user', displayName: 'Test User' }),
    ]));
  });
```

(Fixture: pass `listHouseholdUsers: () => ['test-user', 'test-user-2']` into the router config.)

**Step 2: Implement backend** — in `life.mjs` next to GET /user:

```js
  router.get('/users', (req, res) => {
    const usernames = config.listHouseholdUsers?.() || [];
    res.json({
      users: usernames.map(u => ({
        username: u,
        displayName: config.userService?.getProfile?.(u)?.display_name || u,
      })),
    });
  });
```

Composition: `bootstrapLifeplan` accepts `listHouseholdUsers`; `app.mjs` passes `() => configService.getHouseholdUsers(configService.getDefaultHouseholdId())`.

**Step 3: Frontend** —
1. `useLifeUser`: read `localStorage.getItem('life.username')`; fetch `/api/v1/life/user${stored ? `?username=${stored}` : ''}`; expose `setUsername(u)` that writes localStorage and refetches. Also fetch `/life/users` for the option list (one hook, `useLifeUsers`, or fold into `useLifeUser`).
2. `LifeApp.jsx` header `Group`: add a Mantine `Select` (data = users, value = current) wired to `setUsername`; keep it unobtrusive (right-aligned, `size="xs"`).
3. Hooks: each fetch appends `?username=` when `LifeUserContext` provides one (follow the pattern already in `useLifelog`). CoachChat already receives the resolved username.

**Step 4: Verify live** — switch users in the header; plan views, ceremonies, and coach all follow (coach memory now keys per selected user).

**Step 5: Commit** — `feat(life): household user switcher; all life surfaces follow the selected user`

---

### Task C6: In-app notification renderer — audit A-2.1 (fallback channel)

**Files:**
- Create: `frontend/src/modules/Life/hooks/useAppNotifications.js`
- Modify: `frontend/src/Apps/LifeApp.jsx` (mount the hook)

**Step 1: Find the existing WS client.** Run `grep -rn "new WebSocket\|/ws" frontend/src/lib frontend/src/hooks | head` and reuse whatever shared eventBus client the fitness/device surfaces use (do NOT hand-roll a second socket manager). The backend broadcasts `eventBus.broadcast('notification', intent.toJSON())` — frames carry a topic field; inspect one live frame if the envelope shape is unclear (`websocat ws://localhost:<backend-port>/ws`).

**Step 2: Implement the hook** — subscribe to topic `notification`; for each intent addressed to the current user (`intent.metadata?.username === contextUsername`, or unaddressed), show a Mantine notification (`@mantine/notifications` — check it's installed; if not, use a local toast stack in AppShell) with `title`, `body`, and, when `actions[0].data.url` exists, make the toast clickable → `navigate(url)`. Log via the structured logger (`notification.received`).

**Step 3: Verify live** — from the dev shell, send one intent through the stack (category `goal_update`, which routes app-only) and confirm the toast renders in an open `/life` tab.

**Step 4: Commit** — `feat(life-ui): render in-app notifications from the eventBus notification topic`

---

## Final integration pass

### Task F1: Full suite + live walkthrough + docs

1. Run everything: isolated (`npm run test:isolated` — expect the two pre-existing unrelated failures in `localContent`/`fitness-debug-voice-memo` and no new ones), integrated lifeplan jest suite, `npm run audit:layers` (ratchets must not regress; new files: PlanAuthoringService is 3_applications — clean).
2. Live walkthrough as a scratch new user (`test-onboard` dir removed afterward): empty dashboard → funnel → coach creates values+goal → goals view shows them → complete a unit_intention → unit_capture echoes it → user switcher back to head of household unaffected.
3. Update `docs/reference/life/life-domain-architecture.md` (PlanAuthoringService, new routes, cadence timezone + Monday epoch, delivery hours, notification renderer) and mark the corresponding rows in `docs/reference/life/user-journey.md`'s status roll-up (several GAP → EXISTS).
4. Commit docs; final commit message `docs(life): update architecture + journey status after usability remediation`.

**Deployment notes (for the human):** prod pickup needs deploy + container restart; the cadence default-epoch change shifts cycle periodIds (old Wed-anchored ids won't match new Mon-anchored ids — ceremony dedupe for the current week resets once, acceptable); `lifeplan:ceremony-check` cron becomes hourly; set `system.public_url` (or the getter found in B4) for Telegram buttons.

---

## Task order & dependencies

```
A1 → A2 → A3 → A4 → A5      (independent of B/C, ship first)
B1 → B2 → B3 → B4            (B2 depends on B1's timezone threading)
C1 → C2                      (coach tools need the authoring service)
C1 → C4; C3 anytime after A-series; C5, C6 independent
F1 last
```
