# Cycle Game — Plan 5: Surfaces (API, lobby helpers, screens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** The cycle game's exposed surfaces — the `/api/v1/fitness/cycle-races` HTTP routes (+ DI), pure lobby helpers (course→race-config, clock formatting), and the prop-driven `CycleRaceScreen` + `CycleGameHome` presentational components.

**Architecture:** Routes are thin over the Plan-4 `CycleRaceService` (supertest-verified). Helpers are pure (vitest). The two screens are prop-driven so they're render-testable; the **live container** that wires `useFitnessContext` → `CycleRaceController` on an interval + mounts these screens + registers the `fitness:cycle-game` widget is a **documented final follow-on** (§Follow-on) — it needs the running app to verify and is best built with the dev server up.

**Tech Stack:** Express + supertest (routes), vitest (helpers + render).

**Plan 5 of 5.** Depends on Plans 1-4. Spec §5, §8, §12.

---

## Worktree test commands
- vitest: `/opt/Code/DaylightStation/node_modules/.bin/vitest run --config /opt/Code/DaylightStation/.claude/worktrees/cycle-game/vitest.config.mjs <path> --root /opt/Code/DaylightStation/.claude/worktrees/cycle-game`
- jest: `cd /opt/Code/DaylightStation/.claude/worktrees/cycle-game && /opt/Code/DaylightStation/node_modules/.bin/jest --rootDir . --config /opt/Code/DaylightStation/jest.config.js <path>`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/4_api/v1/routers/fitness.mjs` (modify) | add `/cycle-races` POST(save)/GET(list,ghosts)/GET(:id) routes |
| `backend/src/0_system/bootstrap.mjs` (modify) | construct `YamlCycleRaceDatastore`+`CycleRaceService`, pass into `createFitnessRouter` |
| `tests/unit/api/cycleRaces.routes.test.mjs` (create) | supertest route coverage |
| `frontend/src/modules/Fitness/lib/cycleGame/cycleGameLobby.js` (+ test) | `buildRaceConfigFromCourse`, `formatClock` |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx` (+scss,+test) | clock + speedometer row + distance lines (prop-driven) |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx` (+scss,+test) | course list + custom + rider lineup + records (prop-driven) |

---

## Task 1: `/api/v1/fitness/cycle-races` routes + DI

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` (config destructure ~line 74; add routes near the other `/sessions` routes)
- Modify: `backend/src/0_system/bootstrap.mjs` (construct services ~after line 880; pass to `createFitnessRouter` ~line 1021)
- Test: `tests/unit/api/cycleRaces.routes.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/api/cycleRaces.routes.test.mjs`:

```js
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from '#api/v1/routers/fitness.mjs';

const makeApp = () => {
  const store = new Map();
  const cycleRaceService = {
    save: async (rec) => { store.set(rec.race.id, rec); return `/x/${rec.race.id}.yml`; },
    get: async (id) => store.get(id) || null,
    listByDate: async () => [...store.values()],
    listDates: async () => ['2026-06-02'],
    findGhostCandidates: async ({ courseId }) => [...store.values()].filter(r => r.race.course_id === courseId)
  };
  const app = express();
  app.use(express.json());
  app.use('/', createFitnessRouter({ cycleRaceService, logger: { error() {}, info() {}, warn() {} } }));
  return app;
};

const rec = (id = '20260602143012', over = {}) => ({ version: 1, race: { id, date: '2026-06-02', win_condition: 'distance', goal_m: 3000, course_id: 'alps_3k', ...over }, participants: {} });

describe('cycle-races routes', () => {
  it('POST saves a race', async () => {
    const app = makeApp();
    const res = await request(app).post('/cycle-races').send({ record: rec() });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.raceId).toBe('20260602143012');
  });
  it('GET /cycle-races/:id returns a saved race', async () => {
    const app = makeApp();
    await request(app).post('/cycle-races').send({ record: rec() });
    const res = await request(app).get('/cycle-races/20260602143012');
    expect(res.status).toBe(200);
    expect(res.body.race.race.id).toBe('20260602143012');
  });
  it('GET /cycle-races/:id 404s when missing', async () => {
    const res = await request(makeApp()).get('/cycle-races/nope');
    expect(res.status).toBe(404);
  });
  it('GET /cycle-races?date lists races', async () => {
    const app = makeApp();
    await request(app).post('/cycle-races').send({ record: rec() });
    const res = await request(app).get('/cycle-races').query({ date: '2026-06-02' });
    expect(res.status).toBe(200);
    expect(res.body.races).toHaveLength(1);
  });
  it('GET /cycle-races?courseId returns ghost candidates', async () => {
    const app = makeApp();
    await request(app).post('/cycle-races').send({ record: rec('20260602143012', { course_id: 'alps_3k' }) });
    await request(app).post('/cycle-races').send({ record: rec('20260602150000', { course_id: 'coastal' }) });
    const res = await request(app).get('/cycle-races').query({ courseId: 'alps_3k' });
    expect(res.body.races).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — must FAIL** (routes 404).

Run: `… jest … tests/unit/api/cycleRaces.routes.test.mjs`

- [ ] **Step 3: Add the routes (fitness.mjs)**

In `createFitnessRouter`'s config destructure (after `fitnessSuggestionService = null,`), add:
```js
    cycleRaceService = null,
```
Then add these routes (place right after the `GET /sessions/:sessionId` route block, before the lock routes):
```js
  // -------------------- Cycle Game races --------------------
  router.post('/cycle-races', async (req, res) => {
    if (!cycleRaceService) return res.status(503).json({ error: 'cycle races unavailable' });
    const { record, household } = req.body || {};
    if (!record?.race?.id) return res.status(400).json({ error: 'record.race.id required' });
    try {
      const file = await cycleRaceService.save(record, household);
      return res.json({ ok: true, raceId: record.race.id, file });
    } catch (err) {
      logger.error?.('fitness.cycle_races.save.error', { error: err?.message });
      return res.status(400).json({ error: err?.message || 'save failed' });
    }
  });

  router.get('/cycle-races/:raceId', async (req, res) => {
    if (!cycleRaceService) return res.status(503).json({ error: 'cycle races unavailable' });
    try {
      const race = await cycleRaceService.get(req.params.raceId, req.query.household);
      if (!race) return res.status(404).json({ error: 'not found' });
      return res.json({ race });
    } catch (err) {
      logger.error?.('fitness.cycle_races.get.error', { error: err?.message });
      return res.status(500).json({ error: 'lookup failed' });
    }
  });

  router.get('/cycle-races', async (req, res) => {
    if (!cycleRaceService) return res.status(503).json({ error: 'cycle races unavailable' });
    const { date, courseId, winCondition, goalM, timeCapS, household } = req.query;
    try {
      if (date) return res.json({ races: await cycleRaceService.listByDate(date, household) });
      if (courseId || winCondition) {
        return res.json({ races: await cycleRaceService.findGhostCandidates({
          courseId: courseId || null,
          winCondition: winCondition || null,
          goalM: goalM != null ? Number(goalM) : null,
          timeCapS: timeCapS != null ? Number(timeCapS) : null,
          householdId: household
        }) });
      }
      return res.json({ dates: await cycleRaceService.listDates(household) });
    } catch (err) {
      logger.error?.('fitness.cycle_races.list.error', { error: err?.message });
      return res.status(500).json({ error: 'list failed' });
    }
  });
```

- [ ] **Step 4: Run — must PASS** (5 tests).

- [ ] **Step 5: Wire DI in bootstrap.mjs**

Add imports near the other fitness imports (after the `YamlSessionDatastore` import line):
```js
import { YamlCycleRaceDatastore } from '#adapters/persistence/yaml/YamlCycleRaceDatastore.mjs';
import { CycleRaceService } from '#apps/fitness/services/CycleRaceService.mjs';
```
After the `sessionService` is constructed (the `const sessionService = new SessionService({...})` block, ~line 879-882), add:
```js
  const cycleRaceStore = new YamlCycleRaceDatastore({ configService });
  const cycleRaceService = new CycleRaceService({ datastore: cycleRaceStore });
```
Add `cycleRaceService` (and `cycleRaceStore`) to the `fitnessServices` object literal (the one that already lists `sessionStore, sessionService,` ~line 912-913):
```js
    sessionStore,
    sessionService,
    cycleRaceStore,
    cycleRaceService,
```
And pass it into the `createFitnessRouter({...})` call (where `sessionService: fitnessServices.sessionService,` appears, ~line 1021):
```js
    cycleRaceService: fitnessServices.cycleRaceService,
```

- [ ] **Step 6: Verify bootstrap + router still parse**

Run: `node --check backend/src/0_system/bootstrap.mjs && node --check backend/src/4_api/v1/routers/fitness.mjs && echo OK`
Expected: `OK`. Re-run the route test (Step 4) — still 5 green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs backend/src/0_system/bootstrap.mjs tests/unit/api/cycleRaces.routes.test.mjs
git commit -m "feat(cycle-game): /api/v1/fitness/cycle-races routes + DI"
```

---

## Task 2: lobby helpers

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/cycleGameLobby.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/cycleGameLobby.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/lib/cycleGame/cycleGameLobby.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildRaceConfigFromCourse, formatClock } from './cycleGameLobby.js';

describe('buildRaceConfigFromCourse', () => {
  const riders = [{ userId: 'milo', wheelCircumferenceM: 2.1 }];
  it('maps a distance course', () => {
    const cfg = buildRaceConfigFromCourse(
      { id: 'alps_3k', win_condition: 'distance', goal_m: 3000, background_plex_id: 'plex:1' },
      { riders, startCountdownS: 3 }
    );
    expect(cfg.winCondition).toBe('distance');
    expect(cfg.goalM).toBe(3000);
    expect(cfg.timeCapS).toBeUndefined();
    expect(cfg.courseId).toBe('alps_3k');
    expect(cfg.backgroundPlexId).toBe('plex:1');
    expect(cfg.riders).toBe(riders);
    expect(cfg.startCountdownS).toBe(3);
  });
  it('maps a time course', () => {
    const cfg = buildRaceConfigFromCourse({ id: 'c', win_condition: 'time', time_cap_s: 300 }, {});
    expect(cfg.winCondition).toBe('time');
    expect(cfg.timeCapS).toBe(300);
    expect(cfg.goalM).toBeUndefined();
  });
  it('falls back to opts/defaults for a custom (course-less) race', () => {
    const cfg = buildRaceConfigFromCourse({}, { winCondition: 'distance', goalM: 1500 });
    expect(cfg.goalM).toBe(1500);
    expect(cfg.courseId).toBeNull();
    expect(cfg.intervalMs).toBe(1000);
  });
});

describe('formatClock', () => {
  it('formats mm:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(252)).toBe('4:12');
  });
  it('clamps negatives to 0:00', () => {
    expect(formatClock(-5)).toBe('0:00');
  });
});
```

- [ ] **Step 2: Run — must FAIL.**
- [ ] **Step 3: Implement**

Create `frontend/src/modules/Fitness/lib/cycleGame/cycleGameLobby.js`:

```js
/**
 * Cycle-game lobby helpers (pure).
 */

/**
 * Build a CycleRaceController/Engine config from a course preset (or a custom
 * course-less race), merging in runtime opts (riders, zones, cadence, etc.).
 */
export function buildRaceConfigFromCourse(course = {}, opts = {}) {
  const winCondition = course.win_condition || opts.winCondition || 'distance';
  return {
    mode: opts.mode || 'simultaneous',
    winCondition,
    goalM: winCondition === 'distance' ? (course.goal_m ?? opts.goalM ?? 3000) : undefined,
    timeCapS: winCondition === 'time' ? (course.time_cap_s ?? opts.timeCapS ?? 300) : undefined,
    intervalMs: opts.intervalMs ?? 1000,
    riders: opts.riders || [],
    zones: opts.zones || [],
    hrlessMultiplier: opts.hrlessMultiplier ?? 1,
    startCountdownS: opts.startCountdownS ?? 3,
    raceIdleDnfS: opts.raceIdleDnfS ?? 20,
    courseId: course.id ?? null,
    backgroundPlexId: course.background_plex_id ?? opts.backgroundPlexId ?? null
  };
}

/** Format seconds as m:ss (clamped to >= 0). */
export function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Run — must PASS** (5 tests).
- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/cycleGameLobby.js frontend/src/modules/Fitness/lib/cycleGame/cycleGameLobby.test.js
git commit -m "feat(cycle-game): lobby helpers (race config from course, clock format)"
```

---

## Task 3: `CycleRaceScreen` (presentational)

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import CycleRaceScreen from './CycleRaceScreen.jsx';

const BANDS = [{ id: 'warmup', min: 0, color: '#5b6470' }, { id: 'cruising', min: 40, color: '#2ecc71' }];
const props = {
  winCondition: 'distance',
  goalM: 3000,
  elapsedS: 75,
  cadenceBands: BANDS,
  riders: {
    milo: { userId: 'milo', displayName: 'Milo', cumulativeDistanceM: 1500, distanceSeries: [500, 1000, 1500] },
    felix: { userId: 'felix', displayName: 'Felix', cumulativeDistanceM: 900, distanceSeries: [300, 600, 900] }
  },
  riderLive: {
    milo: { rpm: 92, heartRate: 168, zoneId: 'hot', zoneColor: '#e67e22', multiplier: 2 },
    felix: { rpm: 78, heartRate: 140, zoneId: 'warm', zoneColor: '#f1c40f', multiplier: 1.5 }
  }
};

describe('CycleRaceScreen', () => {
  it('shows the race clock (elapsed for a distance race)', () => {
    const { getByTestId } = render(<CycleRaceScreen {...props} />);
    expect(getByTestId('race-clock').textContent).toContain('1:15');
  });
  it('shows the time remaining for a time race (count down)', () => {
    const { getByTestId } = render(<CycleRaceScreen {...props} winCondition="time" timeCapS={300} goalM={undefined} elapsedS={75} />);
    expect(getByTestId('race-clock').textContent).toContain('3:45'); // 300-75
  });
  it('renders one speedometer per rider', () => {
    const { container } = render(<CycleRaceScreen {...props} />);
    expect(container.querySelectorAll('.cycle-speedometer').length).toBe(2);
  });
  it('renders a distance line per rider', () => {
    const { container } = render(<CycleRaceScreen {...props} />);
    expect(container.querySelectorAll('[data-testid="race-line"]').length).toBe(2);
  });
});
```

- [ ] **Step 2: Run — must FAIL.**
- [ ] **Step 3: Implement**

Create `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx`:

```jsx
import React from 'react';
import PropTypes from 'prop-types';
import CycleSpeedometer from './CycleSpeedometer.jsx';
import { formatClock } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import './CycleRaceScreen.scss';

const LINE_COLORS = ['#2ecc71', '#e67e22', '#9b59b6'];

/**
 * Presentational race screen: clock on top, a distance chart (one climbing line
 * per rider toward the goal), and a modular row of CycleSpeedometers beneath.
 * Pure — the live container feeds it engine state + per-rider live metrics.
 */
export default function CycleRaceScreen({
  winCondition = 'distance', goalM = 3000, timeCapS = 300, elapsedS = 0,
  riders = {}, riderLive = {}, cadenceBands = [], backgroundPlexId = null
}) {
  const riderIds = Object.keys(riders);
  const clockSeconds = winCondition === 'time' ? Math.max(0, timeCapS - elapsedS) : elapsedS;

  // chart scaling
  const maxSeriesLen = Math.max(1, ...riderIds.map((id) => (riders[id].distanceSeries || []).length));
  const maxDistance = winCondition === 'distance'
    ? goalM
    : Math.max(1, ...riderIds.map((id) => riders[id].cumulativeDistanceM || 0));
  const W = 600, H = 200;
  const xFor = (i) => maxSeriesLen <= 1 ? 0 : (i / (maxSeriesLen - 1)) * W;
  const yFor = (d) => H - Math.min(1, (d || 0) / maxDistance) * H;

  return (
    <div className="cycle-race-screen" data-testid="cycle-race-screen">
      {backgroundPlexId && <div className="cycle-race-screen__bg" data-plex={backgroundPlexId} aria-hidden="true" />}

      <div className="cycle-race-screen__clock" data-testid="race-clock">{formatClock(clockSeconds)}</div>

      <svg className="cycle-race-screen__chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {winCondition === 'distance' && (
          <line className="cycle-race-screen__goal" x1="0" y1="0" x2={W} y2="0" />
        )}
        {riderIds.map((id, idx) => {
          const series = riders[id].distanceSeries || [];
          const pts = series.map((d, i) => `${xFor(i).toFixed(1)},${yFor(d).toFixed(1)}`).join(' ');
          return (
            <polyline
              key={id}
              data-testid="race-line"
              points={pts}
              fill="none"
              stroke={LINE_COLORS[idx % LINE_COLORS.length]}
              strokeWidth="3"
            />
          );
        })}
      </svg>

      <div className="cycle-race-screen__speedos">
        {riderIds.map((id, idx) => {
          const live = riderLive[id] || {};
          return (
            <CycleSpeedometer
              key={id}
              rpm={live.rpm}
              cadenceBands={cadenceBands}
              distanceMeters={riders[id].cumulativeDistanceM}
              multiplier={live.multiplier}
              avatar={{
                name: riders[id].displayName,
                src: live.avatarSrc,
                heartRate: live.heartRate,
                zoneId: live.zoneId,
                zoneColor: live.zoneColor || LINE_COLORS[idx % LINE_COLORS.length],
                progress: live.zoneProgress
              }}
              size={200}
            />
          );
        })}
      </div>
    </div>
  );
}

CycleRaceScreen.propTypes = {
  winCondition: PropTypes.string,
  goalM: PropTypes.number,
  timeCapS: PropTypes.number,
  elapsedS: PropTypes.number,
  riders: PropTypes.object,
  riderLive: PropTypes.object,
  cadenceBands: PropTypes.array,
  backgroundPlexId: PropTypes.string
};
```

Create `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.scss`:

```scss
.cycle-race-screen {
  position: relative; width: 100%; height: 100%;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  background: #0e0f13; color: #e2e8f0; overflow: hidden;

  &__bg { position: absolute; inset: 0; background: #000; opacity: 0.35; z-index: 0; }
  &__clock { position: relative; z-index: 1; font-family: ui-monospace, monospace; font-size: 2.4rem; font-weight: 800; margin-top: 12px; }
  &__chart { position: relative; z-index: 1; width: 90%; height: 38%; }
  &__goal { stroke: #f1c40f; stroke-width: 2; stroke-dasharray: 6 5; }
  &__speedos { position: relative; z-index: 1; display: flex; gap: 24px; justify-content: center; align-items: flex-start; flex-wrap: wrap; }
}
```

- [ ] **Step 4: Run — must PASS** (4 tests).
- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.scss frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx
git commit -m "feat(cycle-game): CycleRaceScreen (clock + distance lines + speedometers)"
```

---

## Task 4: `CycleGameHome` (presentational)

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import CycleGameHome from './CycleGameHome.jsx';

const courses = [
  { id: 'alps_3k', name: 'Alps · 3 km', win_condition: 'distance', goal_m: 3000 },
  { id: 'coastal_5min', name: 'Coastal · 5 min', win_condition: 'time', time_cap_s: 300 }
];
const riders = [
  { userId: 'milo', displayName: 'Milo', equipmentId: 'cycle_ace', live: true },
  { userId: 'felix', displayName: 'Felix', equipmentId: 'tricycle', live: false }
];

describe('CycleGameHome', () => {
  it('lists courses and the rider lineup', () => {
    const { getByText } = render(<CycleGameHome courses={courses} riders={riders} records={[]} />);
    expect(getByText('Alps · 3 km')).toBeTruthy();
    expect(getByText('Coastal · 5 min')).toBeTruthy();
    expect(getByText('Milo')).toBeTruthy();
  });
  it('fires onSelectCourse when a course is chosen', () => {
    const onSelectCourse = vi.fn();
    const { getByTestId } = render(<CycleGameHome courses={courses} riders={riders} records={[]} onSelectCourse={onSelectCourse} />);
    fireEvent.click(getByTestId('course-alps_3k'));
    expect(onSelectCourse).toHaveBeenCalledWith(courses[0]);
  });
  it('renders the records panel rows', () => {
    const records = [{ courseId: 'alps_3k', userId: 'milo', label: 'Milo — 4:12' }];
    const { getByText } = render(<CycleGameHome courses={courses} riders={riders} records={records} />);
    expect(getByText('Milo — 4:12')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — must FAIL.**
- [ ] **Step 3: Implement**

Create `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx`:

```jsx
import React from 'react';
import PropTypes from 'prop-types';
import './CycleGameHome.scss';

/**
 * Cycle-game home (the `idle` lifecycle state). One screen: course picker +
 * custom-race entry, the auto-detected rider lineup, and a Records panel.
 * Prop-driven; the container supplies data + handlers.
 */
export default function CycleGameHome({ courses = [], riders = [], records = [], onSelectCourse, onCustom }) {
  return (
    <div className="cycle-game-home" data-testid="cycle-game-home">
      <div className="cycle-game-home__main">
        <h2 className="cycle-game-home__title">🚴 Cycle Game</h2>

        <div className="cycle-game-home__section">
          <div className="cycle-game-home__label">Courses</div>
          <div className="cycle-game-home__courses">
            {courses.map((c) => (
              <button
                key={c.id}
                type="button"
                className="cycle-game-home__course"
                data-testid={`course-${c.id}`}
                onClick={() => onSelectCourse?.(c)}
              >
                {c.name}
              </button>
            ))}
            <button type="button" className="cycle-game-home__course cycle-game-home__course--custom" data-testid="course-custom" onClick={() => onCustom?.()}>
              + Custom race
            </button>
          </div>
        </div>

        <div className="cycle-game-home__section">
          <div className="cycle-game-home__label">Riders</div>
          <div className="cycle-game-home__riders">
            {riders.map((r) => (
              <div key={r.userId} className={`cycle-game-home__rider${r.live ? ' is-live' : ''}`}>
                <span className="cycle-game-home__rider-name">{r.displayName}</span>
                <span className="cycle-game-home__rider-status">{r.live ? '🟢' : 'idle'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="cycle-game-home__records">
        <div className="cycle-game-home__label">High scores</div>
        {records.length === 0 && <div className="cycle-game-home__empty">No races yet</div>}
        {records.map((rec, i) => (
          <div key={`${rec.courseId}-${rec.userId}-${i}`} className="cycle-game-home__record">{rec.label}</div>
        ))}
      </aside>
    </div>
  );
}

CycleGameHome.propTypes = {
  courses: PropTypes.array,
  riders: PropTypes.array,
  records: PropTypes.array,
  onSelectCourse: PropTypes.func,
  onCustom: PropTypes.func
};
```

Create `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss`:

```scss
.cycle-game-home {
  display: flex; gap: 16px; height: 100%; padding: 20px;
  background: #0e0f13; color: #e2e8f0;

  &__main { flex: 1; display: flex; flex-direction: column; gap: 20px; }
  &__title { font-size: 1.8rem; font-weight: 800; }
  &__label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: #8b93a1; margin-bottom: 8px; }
  &__courses { display: flex; gap: 12px; flex-wrap: wrap; }
  &__course { background: #101218; border: 1px solid #2a2e36; border-radius: 10px; padding: 14px 18px; color: #e2e8f0; font-size: 1.05rem; cursor: pointer; }
  &__course--custom { border-style: dashed; color: #8b93a1; }
  &__riders { display: flex; gap: 12px; flex-wrap: wrap; }
  &__rider { display: flex; gap: 8px; align-items: center; background: #101218; border: 1px solid #2a2e36; border-radius: 10px; padding: 10px 14px; opacity: 0.55; }
  &__rider.is-live { opacity: 1; }
  &__records { width: 240px; background: #101218; border: 1px solid #2a2e36; border-radius: 10px; padding: 16px; }
  &__record { padding: 6px 0; border-bottom: 1px solid #1c2027; font-size: 0.95rem; }
  &__empty { color: #5b626e; font-size: 0.9rem; }
}
```

- [ ] **Step 4: Run — must PASS** (3 tests).
- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx
git commit -m "feat(cycle-game): CycleGameHome (course picker + lineup + records)"
```

---

## Final Verification

- [ ] Frontend: `… vitest … frontend/src/modules/Fitness/lib/cycleGame/cycleGameLobby.test.js frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx --root …` → 12 green.
- [ ] Backend: `… jest … tests/unit/api/cycleRaces.routes.test.mjs` → 5 green; `node --check` bootstrap + fitness.mjs → OK.

---

## Follow-on (final integration — needs the running app)

The last ~5% is the **live container + launch**, deliberately not built blind here because it can only be verified with the dev server (and benefits from the visual companion for animation/sound polish):

1. **`CycleGameContainer.jsx`** — owns a `CycleRaceController`; reads `useFitnessContext` (`rpmDevices`, `roster`, `getEquipmentRider`, `equipmentByCadence`, `cadenceBands`, zones, `cycle_game` config) to (a) auto-detect riders for the lineup and (b) each interval build `{userId:{rpm,zoneId}}` inputs and call `controller.tick`. Renders by phase: `CycleGameHome` (idle) → `CountdownStoplight` (drives `countdownTick` on a 1s interval) → `CycleRaceScreen` (racing) → `RaceResults` (results); on entering results, POST the `buildRaceRecord(...)` output to `/api/v1/fitness/cycle-races`. Cancel → confirm modal → idle.
2. **Sound + count-up polish** (countdown beeps, results number count-up).
3. **Launch:** register `fitness:cycle-game` in `frontend/src/modules/Fitness/index.js` (widget registry) with a manifest, and/or a `/fitness/cycle-game` route; optionally retire the `cycle_challenge_demo` entry.
4. **Ambient video:** mount the Plex background via the existing play path (`/api/v1/play/plex/{id}`) inside `CycleRaceScreen.__bg`.
5. **CycleChallengeOverlay → `<CycleSpeedometer>` refactor** (the deferred dedup from Plan 2).

Verify end-to-end on the dev server (riders on bikes → stage → countdown → race → results → record saved → high score on home).

---

## Self-Review Notes

- **Spec coverage:** §8 HTTP surface (save/list/get/ghosts) → Task 1; §5/§12 home (course picker + lineup + records) → Task 4; §3/§12 race screen (clock + chart + speedometer row + bg) → Task 3; course→config + clock → Task 2. Live wiring/launch → Follow-on (needs running app).
- **Type consistency:** routes call the Plan-4 `CycleRaceService` methods exactly; `buildRaceConfigFromCourse` output matches `CycleRaceController` config keys; `CycleRaceScreen` consumes engine `riders{...distanceSeries,cumulativeDistanceM}` + a `riderLive` map; `CycleSpeedometer`/`formatClock` reused.
