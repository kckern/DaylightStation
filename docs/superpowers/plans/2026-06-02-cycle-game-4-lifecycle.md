# Cycle Game — Plan 4: Race Lifecycle + Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** The race orchestration layer — a pure `CycleRaceController` (lifecycle state machine wrapping `CycleRaceEngine`, with countdown + DNF), the `CountdownStoplight` and `RaceResults` presentational components, and a backend `CycleRaceService` (save/get/list/ghost-candidates over the datastore).

**Architecture:** The controller is a pure FSM (vitest) owning the engine, countdown, and idle→DNF logic. The two components are prop-driven (render tests). The service is a thin wrapper over `YamlCycleRaceDatastore` (jest, temp-dir). The **live race-screen container** (wiring `useFitnessContext` → controller, `FitnessChart`, ambient video) and the **HTTP routes + app launch** land in Plan 5, where they're exercised end-to-end.

**Tech Stack:** React/SVG; vitest + jest.

**Plan 4 of 5.** Depends on Plan 3 (`CycleRaceEngine`, `YamlCycleRaceDatastore`), Plan 2 (`CycleSpeedometer`), Plan 1. Spec §6, §12.

---

## Worktree test commands
- vitest: `/opt/Code/DaylightStation/node_modules/.bin/vitest run --config /opt/Code/DaylightStation/.claude/worktrees/cycle-game/vitest.config.mjs <path> --root /opt/Code/DaylightStation/.claude/worktrees/cycle-game`
- jest: `cd /opt/Code/DaylightStation/.claude/worktrees/cycle-game && /opt/Code/DaylightStation/node_modules/.bin/jest --rootDir . --config /opt/Code/DaylightStation/jest.config.js <path>`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.js` (+ test) | lifecycle FSM (staged→countdown→racing→finished→results / cancelled) + DNF |
| `frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.jsx` (+scss, +test) | full-screen 🔴🟡🟢 countdown overlay |
| `frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.jsx` (+scss, +test) | standings + animated count-up results |
| `backend/src/3_applications/fitness/services/CycleRaceService.mjs` (+ test) | save/get/list/ghost-candidates over the datastore |

---

## Task 1: `CycleRaceController` (pure FSM)

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { CycleRaceController } from './CycleRaceController.js';

const HOT = [{ id: 'hot', distance_multiplier: 2 }];
const distConfig = (over = {}) => ({
  winCondition: 'distance', goalM: 21, intervalMs: 5000, zones: HOT, hrlessMultiplier: 1,
  startCountdownS: 3, raceIdleDnfS: 10,
  riders: [
    { userId: 'a', wheelCircumferenceM: 2.1 },
    { userId: 'b', wheelCircumferenceM: 1.2 }
  ],
  ...over
});

describe('CycleRaceController — lifecycle', () => {
  it('starts staged', () => {
    expect(new CycleRaceController(distConfig()).getState().phase).toBe('staged');
  });
  it('runs the countdown then enters racing', () => {
    const c = new CycleRaceController(distConfig());
    expect(c.startCountdown().phase).toBe('countdown');
    expect(c.getState().countdownRemaining).toBe(3);
    c.countdownTick(); c.countdownTick();
    expect(c.getState().phase).toBe('countdown');
    expect(c.countdownTick().phase).toBe('racing');
  });
  it('skips countdown when startCountdownS is 0', () => {
    const c = new CycleRaceController(distConfig({ startCountdownS: 0 }));
    expect(c.startCountdown().phase).toBe('racing');
  });
  it('cancel moves to cancelled from any active phase', () => {
    const c = new CycleRaceController(distConfig());
    expect(c.cancel().phase).toBe('cancelled');
  });
});

describe('CycleRaceController — racing + DNF', () => {
  const toRacing = (cfg) => { const c = new CycleRaceController(cfg); c.startCountdown(); return c; };

  it('accumulates via the engine while racing', () => {
    const c = toRacing(distConfig({ startCountdownS: 0, goalM: 1000 }));
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } });
    expect(c.getState().engineState.riders.a.cumulativeDistanceM).toBe(21);
  });
  it('DNFs an idle rider and finishes when all are finished-or-DNF', () => {
    const c = toRacing(distConfig({ startCountdownS: 0 }));
    // a reaches goal (21) tick1; b idle
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 0 } }); // b idle 5s
    expect(c.getState().phase).toBe('racing');
    c.tick({ a: { rpm: 0 }, b: { rpm: 0 } }); // b idle 10s → DNF
    const s = c.getState();
    expect(s.dnf).toContain('b');
    expect(s.phase).toBe('finished');
  });
  it('ignores ticks once finished and exposes results via showResults()', () => {
    const c = toRacing(distConfig({ startCountdownS: 0 }));
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } }); // both >=21 tick1? a=21,b=12
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } }); // b=24 → both finished
    expect(c.getState().phase).toBe('finished');
    expect(c.showResults().phase).toBe('results');
  });
});

describe('CycleRaceController — time race', () => {
  it('finishes at the time cap', () => {
    const c = new CycleRaceController({
      winCondition: 'time', timeCapS: 10, intervalMs: 5000, zones: HOT, startCountdownS: 0,
      riders: [{ userId: 'a', wheelCircumferenceM: 2.0 }]
    });
    c.startCountdown();
    c.tick({ a: { rpm: 60, zoneId: 'hot' } });
    expect(c.getState().phase).toBe('racing');
    c.tick({ a: { rpm: 60, zoneId: 'hot' } });
    expect(c.getState().phase).toBe('finished');
  });
});
```

- [ ] **Step 2: Run — must FAIL.**
- [ ] **Step 3: Implement**

Create `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.js`:

```js
import { CycleRaceEngine } from './CycleRaceEngine.js';

/**
 * Lifecycle state machine for a cycle race. Wraps CycleRaceEngine and adds the
 * countdown and idle→DNF handling. Pure (caller drives countdownTick/tick).
 * Phases: staged → countdown → racing → finished → results; cancelled (any).
 */
export class CycleRaceController {
  constructor(config = {}) {
    this.config = config;
    this.phase = 'staged';
    this.countdownRemaining = Number.isFinite(config.startCountdownS) ? config.startCountdownS : 3;
    this.raceIdleDnfS = Number.isFinite(config.raceIdleDnfS) ? config.raceIdleDnfS : 20;
    this.engine = null;
    this.dnf = new Set();
    this._idle = new Map();
  }

  startCountdown() {
    if (this.phase !== 'staged') return this.getState();
    if (this.countdownRemaining > 0) this.phase = 'countdown';
    else this._beginRacing();
    return this.getState();
  }

  countdownTick() {
    if (this.phase !== 'countdown') return this.getState();
    this.countdownRemaining -= 1;
    if (this.countdownRemaining <= 0) this._beginRacing();
    return this.getState();
  }

  _beginRacing() {
    this.engine = new CycleRaceEngine(this.config);
    this.phase = 'racing';
  }

  tick(inputs = {}) {
    if (this.phase !== 'racing' || !this.engine) return this.getState();
    const intervalS = this.engine.intervalSeconds;
    const before = this.engine.getState();
    const filtered = {};
    for (const userId of Object.keys(before.riders)) {
      const input = inputs[userId] || {};
      const rpm = Number.isFinite(input.rpm) ? input.rpm : 0;
      const nextIdle = rpm > 0 ? 0 : (this._idle.get(userId) || 0) + intervalS;
      this._idle.set(userId, nextIdle);
      const finished = before.riders[userId].finishTimeS != null;
      if (!finished && nextIdle >= this.raceIdleDnfS) this.dnf.add(userId);
      filtered[userId] = this.dnf.has(userId) ? { rpm: 0, zoneId: input.zoneId ?? null } : input;
    }
    this.engine.tick(filtered);
    if (this._isFinished()) this.phase = 'finished';
    return this.getState();
  }

  _isFinished() {
    const s = this.engine.getState();
    if (this.config.winCondition === 'time') return s.finished;
    return Object.values(s.riders).every((r) => r.finishTimeS != null || this.dnf.has(r.userId));
  }

  showResults() {
    if (this.phase === 'finished') this.phase = 'results';
    return this.getState();
  }

  cancel() {
    this.phase = 'cancelled';
    return this.getState();
  }

  getState() {
    return {
      phase: this.phase,
      countdownRemaining: this.countdownRemaining,
      dnf: [...this.dnf],
      engineState: this.engine ? this.engine.getState() : null
    };
  }
}

export default CycleRaceController;
```

- [ ] **Step 4: Run — must PASS** (4 + 3 + 1 = 8 tests).
- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.js frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.test.js
git commit -m "feat(cycle-game): CycleRaceController (lifecycle FSM + countdown + DNF)"
```

---

## Task 2: `CountdownStoplight` component

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CountdownStoplight from './CountdownStoplight.jsx';

describe('CountdownStoplight', () => {
  it('shows the remaining count and lights the right lamp', () => {
    const { getByTestId } = render(<CountdownStoplight remaining={3} total={3} />);
    expect(getByTestId('countdown-number').textContent).toBe('3');
    // 3 of 3 → top (red) lamp active
    expect(getByTestId('lamp-red').className).toContain('is-on');
  });
  it('shows GO at 0', () => {
    const { getByTestId } = render(<CountdownStoplight remaining={0} total={3} />);
    expect(getByTestId('countdown-number').textContent).toBe('GO');
    expect(getByTestId('lamp-green').className).toContain('is-on');
  });
});
```

- [ ] **Step 2: Run — must FAIL.**
- [ ] **Step 3: Implement**

Create `frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.jsx`:

```jsx
import React from 'react';
import PropTypes from 'prop-types';
import './CountdownStoplight.scss';

/**
 * Full-screen stoplight countdown overlay. `remaining` counts down to 0 (GO).
 * Lamp mapping: high third = red, middle third = yellow, 0 = green/GO.
 * Sound is triggered by the caller on each change (kept out of this presentational component).
 */
export default function CountdownStoplight({ remaining, total = 3 }) {
  const isGo = remaining <= 0;
  const frac = total > 0 ? remaining / total : 0;
  const lamp = isGo ? 'green' : frac > 2 / 3 ? 'red' : 'yellow';
  return (
    <div className="countdown-stoplight" data-testid="countdown-stoplight">
      <div className="countdown-stoplight__lamps">
        <span data-testid="lamp-red" className={`countdown-stoplight__lamp countdown-stoplight__lamp--red${lamp === 'red' ? ' is-on' : ''}`} />
        <span data-testid="lamp-yellow" className={`countdown-stoplight__lamp countdown-stoplight__lamp--yellow${lamp === 'yellow' ? ' is-on' : ''}`} />
        <span data-testid="lamp-green" className={`countdown-stoplight__lamp countdown-stoplight__lamp--green${lamp === 'green' ? ' is-on' : ''}`} />
      </div>
      <div className="countdown-stoplight__number" data-testid="countdown-number">
        {isGo ? 'GO' : Math.ceil(remaining)}
      </div>
    </div>
  );
}

CountdownStoplight.propTypes = { remaining: PropTypes.number.isRequired, total: PropTypes.number };
```

Create `frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.scss`:

```scss
.countdown-stoplight {
  position: absolute; inset: 0; z-index: 50;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 24px; background: rgba(0,0,0,0.7);

  &__lamps { display: flex; flex-direction: column; gap: 12px; padding: 16px; background: #0b0c10; border-radius: 16px; }
  &__lamp { width: 56px; height: 56px; border-radius: 50%; background: #1c2027; opacity: 0.25; transition: opacity 0.15s; }
  &__lamp--red.is-on    { background: #e74c3c; opacity: 1; box-shadow: 0 0 24px #e74c3c; }
  &__lamp--yellow.is-on { background: #f1c40f; opacity: 1; box-shadow: 0 0 24px #f1c40f; }
  &__lamp--green.is-on  { background: #2ecc71; opacity: 1; box-shadow: 0 0 24px #2ecc71; }
  &__number { font-size: 4rem; font-weight: 800; color: #f5f7fa; }
}
```

- [ ] **Step 4: Run — must PASS** (2 tests).
- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.jsx frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.scss frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.test.jsx
git commit -m "feat(cycle-game): CountdownStoplight overlay"
```

---

## Task 3: `RaceResults` component

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import RaceResults from './RaceResults.jsx';

const standings = [
  { userId: 'user_3', placement: 1, finishTimeS: 252, distanceM: 3000 },
  { userId: 'user_2', placement: 2, finishTimeS: null, distanceM: 2710 }
];
const riders = {
  user_3: { displayName: 'User_3' },
  user_2: { displayName: 'User_2' }
};

describe('RaceResults', () => {
  it('renders a row per standing in placement order with names', () => {
    const { getAllByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" dnf={[]} />);
    const rows = getAllByTestId('result-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('User_3');
    expect(rows[0].textContent).toContain('1');
  });
  it('marks DNF riders', () => {
    const { getByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" dnf={['user_2']} />);
    expect(getByTestId('result-row-user_2').textContent).toContain('DNF');
  });
  it('shows time for distance races and distance for time races', () => {
    const dist = render(<RaceResults standings={standings} riders={riders} winCondition="distance" dnf={[]} />);
    expect(within(dist.container).getByTestId('result-row-user_3').textContent).toContain('4:12'); // 252s
    const time = render(<RaceResults standings={standings} riders={riders} winCondition="time" dnf={[]} />);
    expect(within(time.container).getByTestId('result-row-user_3').textContent).toContain('3.00 km'); // 3000 m
  });
});
```

- [ ] **Step 2: Run — must FAIL.**
- [ ] **Step 3: Implement**

Create `frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.jsx`:

```jsx
import React from 'react';
import PropTypes from 'prop-types';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import './RaceResults.scss';

const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

/**
 * Race results board: standings rows in placement order. For a distance race
 * the headline metric is finish time; for a time race it's distance. DNF riders
 * are flagged. (Count-up animation is layered via CSS/caller; values shown final.)
 */
export default function RaceResults({ standings = [], riders = {}, winCondition = 'distance', dnf = [] }) {
  const dnfSet = new Set(dnf);
  return (
    <div className="race-results" data-testid="race-results">
      <h2 className="race-results__title">Results</h2>
      <ol className="race-results__list">
        {standings.map((s) => {
          const name = riders[s.userId]?.displayName || s.userId;
          const isDnf = dnfSet.has(s.userId);
          const metric = isDnf
            ? 'DNF'
            : winCondition === 'distance'
              ? fmtTime(s.finishTimeS)
              : formatDistance(s.distanceM);
          return (
            <li key={s.userId} className="race-results__row" data-testid="result-row" data-testid-row={s.userId}>
              <span className="race-results__place" data-testid={`result-row-${s.userId}`}>
                <span className="race-results__placement">{s.placement}</span>
                <span className="race-results__name">{name}</span>
                <span className={`race-results__metric${isDnf ? ' race-results__metric--dnf' : ''}`}>{metric}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

RaceResults.propTypes = {
  standings: PropTypes.array,
  riders: PropTypes.object,
  winCondition: PropTypes.string,
  dnf: PropTypes.array
};
```

> Note: the test queries both `data-testid="result-row"` (the `<li>`) and `data-testid="result-row-${userId}"` (the inner span). Keep both attributes exactly as written.

Create `frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.scss`:

```scss
.race-results {
  color: #e2e8f0; padding: 24px; text-align: center;
  &__title { font-size: 1.6rem; font-weight: 800; margin-bottom: 16px; }
  &__list { list-style: none; margin: 0 auto; padding: 0; max-width: 520px; }
  &__row { margin: 8px 0; }
  &__place { display: flex; align-items: center; gap: 16px; background: #101218; border: 1px solid #2a2e36; border-radius: 10px; padding: 12px 16px; }
  &__placement { font-size: 1.4rem; font-weight: 800; color: #f1c40f; width: 1.5em; }
  &__name { flex: 1; text-align: left; font-size: 1.1rem; }
  &__metric { font-family: ui-monospace, monospace; font-size: 1.1rem; color: #7aa2ff; }
  &__metric--dnf { color: #8b93a1; }
}
```

- [ ] **Step 4: Run — must PASS** (3 tests).
- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.jsx frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.scss frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.test.jsx
git commit -m "feat(cycle-game): RaceResults standings board"
```

---

## Task 4: `CycleRaceService` (backend)

**Files:**
- Create: `backend/src/3_applications/fitness/services/CycleRaceService.mjs`
- Test: `tests/unit/applications/CycleRaceService.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/applications/CycleRaceService.test.mjs`:

```js
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlCycleRaceDatastore } from '#adapters/persistence/yaml/YamlCycleRaceDatastore.mjs';
import { CycleRaceService } from '#apps/fitness/services/CycleRaceService.mjs';

let tmp, svc;
const rec = (id, over = {}) => ({
  version: 1,
  race: { id, date: `${id.slice(0,4)}-${id.slice(4,6)}-${id.slice(6,8)}`, win_condition: 'distance', goal_m: 3000, course_id: null, ...over },
  participants: {}
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cgsvc-'));
  const datastore = new YamlCycleRaceDatastore({ configService: { getHouseholdPath: (rel) => path.join(tmp, rel) } });
  svc = new CycleRaceService({ datastore });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('CycleRaceService', () => {
  it('saves and gets a race', async () => {
    await svc.save(rec('20260602143012'), 'default');
    expect((await svc.get('20260602143012', 'default')).race.id).toBe('20260602143012');
  });
  it('lists races by date', async () => {
    await svc.save(rec('20260602143012'), 'default');
    expect(await svc.listByDate('2026-06-02', 'default')).toHaveLength(1);
  });
  it('finds ghost candidates by course id', async () => {
    await svc.save(rec('20260602143012', { course_id: 'alps_3k' }), 'default');
    await svc.save(rec('20260602150000', { course_id: 'coastal' }), 'default');
    const cands = await svc.findGhostCandidates({ courseId: 'alps_3k', householdId: 'default' });
    expect(cands).toHaveLength(1);
    expect(cands[0].race.course_id).toBe('alps_3k');
  });
  it('finds ghost candidates by win condition + goal for custom races', async () => {
    await svc.save(rec('20260602143012', { course_id: null, goal_m: 3000 }), 'default');
    await svc.save(rec('20260602150000', { course_id: null, goal_m: 5000 }), 'default');
    const cands = await svc.findGhostCandidates({ winCondition: 'distance', goalM: 3000, householdId: 'default' });
    expect(cands).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — must FAIL.**

Run: `… jest … tests/unit/applications/CycleRaceService.test.mjs`

- [ ] **Step 3: Implement**

Create `backend/src/3_applications/fitness/services/CycleRaceService.mjs`:

```js
/**
 * CycleRaceService - application service for cycle-game races.
 * Thin orchestration over YamlCycleRaceDatastore: save/get/list + ghost-candidate
 * lookup (filtered by course, or by win-condition+goal for custom races).
 */
export class CycleRaceService {
  constructor({ datastore } = {}) {
    if (!datastore) throw new Error('CycleRaceService requires datastore');
    this.datastore = datastore;
  }

  save(record, householdId) { return this.datastore.save(record, householdId); }
  get(raceId, householdId) { return this.datastore.findById(raceId, householdId); }
  listByDate(date, householdId) { return this.datastore.findByDate(date, householdId); }
  listDates(householdId) { return this.datastore.listDates(householdId); }

  async findGhostCandidates({ courseId = null, winCondition = null, goalM = null, timeCapS = null, householdId } = {}) {
    const dates = await this.datastore.listDates(householdId);
    const matches = [];
    for (const date of dates) {
      const races = await this.datastore.findByDate(date, householdId);
      for (const r of races) {
        const rc = r?.race || {};
        const hit = courseId
          ? rc.course_id === courseId
          : (rc.win_condition === winCondition
              && (winCondition === 'distance' ? rc.goal_m === goalM : rc.time_cap_s === timeCapS));
        if (hit) matches.push(r);
      }
    }
    return matches;
  }
}

export default CycleRaceService;
```

- [ ] **Step 4: Run — must PASS** (4 tests).
- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/services/CycleRaceService.mjs tests/unit/applications/CycleRaceService.test.mjs
git commit -m "feat(cycle-game): CycleRaceService (save/get/list/ghost candidates)"
```

---

## Final Verification

- [ ] Frontend: `… vitest … frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.test.js frontend/src/modules/Fitness/widgets/CycleGame/CountdownStoplight.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.test.jsx --root …` → 13 green.
- [ ] Backend: `… jest … tests/unit/applications/CycleRaceService.test.mjs` → 4 green.

---

## Self-Review Notes

- **Spec coverage:** §12 lifecycle states (staged→countdown→racing→finished→results/cancelled) → Task 1; countdown stoplight → Task 2; results board (time vs distance, DNF) → Task 3; §12 DNF (`race_idle_dnf_s`, all-finished-or-DNF) → Task 1; §8 ghost candidates + course filter → Task 4.
- **Deferred to Plan 5:** live race-screen container (useFitnessContext → controller tick, FitnessChart, ambient Plex video, CycleSpeedometer row), the `/api/v1/fitness/cycle-races` HTTP routes + `createFitnessServices`/`createFitnessRouter` DI, the count-up animation + sound, and the app launch/route (replacing CycleChallengeDemo). All exercised end-to-end there.
- **Type consistency:** controller `getState()` exposes `engineState` (Plan-3 engine shape) + `dnf[]` + `phase` + `countdownRemaining` — consumed by the Plan-5 container; `RaceResults` consumes `standings`/`riders` matching the engine state; `CycleRaceService` wraps the Plan-3 datastore methods exactly; ghost filter reads `race.course_id` (spec §12.4).
