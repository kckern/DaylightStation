# Cycle Game — Race Recap View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each entry in the lobby Records rail clickable; clicking opens a full-screen "Race Recap" that replays that saved race's chart (all riders' lines animating to the finish) plus its final standings and metadata.

**Architecture:** Reuse the existing presentational `CycleRaceScreen` — it's already pure and prop-driven. `RaceRecap` decodes a saved race's per-participant `distance_series` (and `hr_series`) into arrays, runs a local replay clock `t`, and on each frame synthesizes the `riders` + `riderLive` props `CycleRaceScreen` expects (each line sliced to `t`). It overlays play/scrub controls, a standings board (`RaceResults`), a header, and a close button. No backend work — the lobby already loads full records into `ghostCandidates`.

**Tech Stack:** React, Vitest (`*.test.jsx`, jsdom), the existing `CycleRaceScreen`, `RaceResults`, `SessionSerializerV3`.

**Context — read these first:**
- `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx` — props: `winCondition`, `goalM`, `timeCapS`, `elapsedS`, `riders` (map keyed by userId: `{ userId, displayName, equipmentId, cumulativeDistanceM, distanceSeries, finishTimeS, isGhost }`), `riderLive` (map: `{ rpm, avatarSrc, heartRate, zoneId, zoneColor, zoneProgress, multiplier }`), `cadenceBands`, `backgroundPlexId`. It renders the chart + a `CycleSpeedometer` row.
- `frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.jsx` — props: `standings` (`[{ userId, placement, finishTimeS, distanceM }]`), `riders` (map → `{ displayName, isGhost }`), `winCondition`, `dnf`, `dq`.
- `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx`:
  - `ghostCandidates` (memo) — one entry per saved race: `{ raceId, date, winCondition, goalM, timeCapS, intervalSeconds, participants: [{ id, displayName, avatarSrc, distanceSeries (RLE string), finalDistanceM, finalTimeS, placement }], winnerName, goalKind, goalLabel, scoreKind, scoreLabel, day, timeOfDay }`. (After the ghost-HR plan lands, participants also carry `hrSeries`.) **This object has everything the recap needs.**
  - `records` (memo) — the rail rows, each `{ raceId, avatars, goalKind, goalLabel, scoreKind, scoreLabel }`.
  - The rail is rendered in `CycleGameHome` (`<aside className="cycle-game-home__records">`).
- `frontend/src/hooks/fitness/SessionSerializerV3.js` — `decodeSeries(rleString)` → array.
- `frontend/src/modules/Fitness/lib/cycleGame/formatDistance.js` — `formatDistance(m)`.

**Run tests with:** `./node_modules/.bin/vitest run --config vitest.config.mjs <file>`

---

### Task 1: Let CycleRaceScreen hide its speedometer row (recap has no live RPM)

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`

- [ ] **Step 1: Write the failing test** (append)

```js
it('hides the speedometer row when showSpeedos is false', () => {
  const riders = { a: { userId: 'a', displayName: 'A', distanceSeries: [10, 20], cumulativeDistanceM: 20, finishTimeS: null, isGhost: false } };
  const { container } = render(
    <CycleRaceScreen winCondition="distance" goalM={100} elapsedS={2} riders={riders} riderLive={{ a: {} }} showSpeedos={false} />
  );
  expect(container.querySelector('.cycle-race-screen__speedos')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`
Expected: FAIL — the speedos row always renders.

- [ ] **Step 3: Implement the `showSpeedos` prop**

In the `CycleRaceScreen({ ... })` destructure, add `showSpeedos = true`. Wrap the `<div className="cycle-race-screen__speedos">…</div>` block in `{showSpeedos && ( … )}`. Add `showSpeedos: PropTypes.bool` to `CycleRaceScreen.propTypes`.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`
Expected: PASS (existing tests still pass — default `true` preserves current behavior).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx
git commit -m "feat(cycle-game): optional showSpeedos on CycleRaceScreen"
```

---

### Task 2: Build the RaceRecap component (decode + replay frame synthesis)

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.test.jsx`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import RaceRecap from './RaceRecap.jsx';

const candidate = {
  raceId: '20260603120000',
  winCondition: 'distance',
  goalM: 100,
  timeCapS: null,
  intervalSeconds: 1,
  day: '2026-06-03',
  timeOfDay: '12:00 pm',
  winnerName: 'Milo',
  participants: [
    { id: 'milo', displayName: 'Milo', avatarSrc: '/api/v1/static/img/users/milo',
      distanceSeries: JSON.stringify([20, 60, 100]), hrSeries: JSON.stringify([150, 158, 165]),
      finalDistanceM: 100, finalTimeS: 3, placement: 1 }
  ]
};

describe('RaceRecap', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the recap with the race screen + standings, and closes', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<RaceRecap candidate={candidate} onClose={onClose} />);
    expect(getByTestId('race-recap')).toBeTruthy();
    expect(getByTestId('cycle-race-screen')).toBeTruthy();
    expect(getByTestId('race-results')).toBeTruthy();
    fireEvent.click(getByTestId('race-recap-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('advances the replay clock on play and reveals more of the line', () => {
    const { getByTestId, getAllByTestId } = render(<RaceRecap candidate={candidate} onClose={() => {}} />);
    // starts paused at t=0 → first line point only
    const before = getAllByTestId('race-line')[0].getAttribute('points').trim().split(' ').length;
    fireEvent.click(getByTestId('race-recap-play'));
    act(() => { vi.advanceTimersByTime(1000); });
    const after = getAllByTestId('race-line')[0].getAttribute('points').trim().split(' ').length;
    expect(after).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.test.jsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement RaceRecap.jsx**

```jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import CycleRaceScreen from './CycleRaceScreen.jsx';
import RaceResults from './RaceResults.jsx';
import { SessionSerializerV3 } from '@/hooks/fitness/SessionSerializerV3.js';
import './RaceRecap.scss';

const LINE_COLORS = ['#3ddc84', '#ff9f43', '#a66cff'];
const REPLAY_TARGET_MS = 12000; // whole race replays in ~12s regardless of length

/**
 * Full-screen recap of a saved race. Decodes each participant's recorded series
 * and replays the chart by feeding synthesized frames to CycleRaceScreen.
 */
export default function RaceRecap({ candidate, onClose }) {
  const decoded = useMemo(() => {
    const parts = (candidate?.participants || []).map((p, idx) => ({
      id: p.id,
      displayName: p.displayName || p.id,
      avatarSrc: p.avatarSrc || `/api/v1/static/img/users/${p.id}`,
      color: LINE_COLORS[idx % LINE_COLORS.length],
      dist: SessionSerializerV3.decodeSeries(p.distanceSeries) || [],
      hr: SessionSerializerV3.decodeSeries(p.hrSeries) || [],
      finalDistanceM: p.finalDistanceM ?? 0,
      finalTimeS: p.finalTimeS ?? null,
      placement: p.placement ?? null
    }));
    const maxLen = Math.max(1, ...parts.map((p) => p.dist.length));
    return { parts, maxLen };
  }, [candidate]);

  const [t, setT] = useState(0); // current tick index (0-based, inclusive)
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef(null);

  const stepMs = Math.max(60, Math.round(REPLAY_TARGET_MS / decoded.maxLen));

  useEffect(() => {
    if (!playing) return undefined;
    intervalRef.current = setInterval(() => {
      setT((prev) => {
        if (prev >= decoded.maxLen - 1) { setPlaying(false); return prev; }
        return prev + 1;
      });
    }, stepMs);
    return () => clearInterval(intervalRef.current);
  }, [playing, stepMs, decoded.maxLen]);

  const intervalS = candidate?.intervalSeconds || 1;
  const sampleAt = (arr, i) => (arr.length ? arr[Math.min(i, arr.length - 1)] : 0);

  const riders = {};
  const riderLive = {};
  decoded.parts.forEach((p) => {
    riders[p.id] = {
      userId: p.id,
      displayName: p.displayName,
      equipmentId: null,
      cumulativeDistanceM: sampleAt(p.dist, t),
      distanceSeries: p.dist.slice(0, t + 1),
      finishTimeS: p.finalTimeS,
      isGhost: false
    };
    const hr = p.hr.length ? p.hr[Math.min(t, p.hr.length - 1)] : null;
    riderLive[p.id] = {
      rpm: 0,
      avatarSrc: p.avatarSrc,
      heartRate: Number.isFinite(hr) ? hr : null,
      zoneId: null,
      zoneColor: p.color,
      zoneProgress: null,
      multiplier: 1
    };
  });

  const standings = [...decoded.parts]
    .sort((a, b) => (a.placement || 99) - (b.placement || 99))
    .map((p) => ({ userId: p.id, placement: p.placement, finishTimeS: p.finalTimeS, distanceM: p.finalDistanceM }));
  const ridersMeta = Object.fromEntries(decoded.parts.map((p) => [p.id, { displayName: p.displayName, isGhost: false }]));

  return (
    <div className="race-recap" role="dialog" aria-modal="true" data-testid="race-recap">
      <div className="race-recap__head">
        <div className="race-recap__title">Race Recap</div>
        <div className="race-recap__meta">
          {candidate?.day || ''}{candidate?.timeOfDay ? ` · ${candidate.timeOfDay}` : ''}
          {' · '}{candidate?.winCondition === 'time' ? 'Time race' : 'Distance race'}
        </div>
        <button type="button" className="race-recap__close" data-testid="race-recap-close" aria-label="close" onClick={onClose}>×</button>
      </div>

      <div className="race-recap__stage">
        <CycleRaceScreen
          winCondition={candidate?.winCondition || 'distance'}
          goalM={candidate?.goalM ?? 3000}
          timeCapS={candidate?.timeCapS ?? 300}
          elapsedS={t * intervalS}
          riders={riders}
          riderLive={riderLive}
          showSpeedos={false}
        />
      </div>

      <div className="race-recap__controls">
        <button type="button" className="race-recap__btn" data-testid="race-recap-play" onClick={() => {
          if (t >= decoded.maxLen - 1) setT(0);
          setPlaying((p) => !p);
        }}>{playing ? 'Pause' : 'Play'}</button>
        <input
          type="range" className="race-recap__scrub" min={0} max={decoded.maxLen - 1} value={t}
          onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }}
          aria-label="scrub"
        />
      </div>

      <div className="race-recap__results">
        <RaceResults standings={standings} riders={ridersMeta} winCondition={candidate?.winCondition || 'distance'} />
      </div>
    </div>
  );
}

RaceRecap.propTypes = {
  candidate: PropTypes.object,
  onClose: PropTypes.func
};
```

- [ ] **Step 4: Implement RaceRecap.scss**

```scss
@use './cgTokens' as cg;

.race-recap {
  position: absolute; inset: 0; z-index: 60;
  display: flex; flex-direction: column;
  @include cg.cg-backdrop;
  background-color: rgba(6, 7, 10, 0.96);
  color: cg.$cg-text;

  &__head {
    display: flex; align-items: center; gap: 14px;
    padding: 16px 22px; border-bottom: 1px solid cg.$cg-border;
  }
  &__title { font-family: cg.$cg-display; font-weight: 800; font-size: 1.6rem; }
  &__meta { color: cg.$cg-muted; font-size: 0.9rem; flex: 1; }
  &__close {
    appearance: none; cursor: pointer; width: 38px; height: 38px; border-radius: 50%;
    border: 1px solid cg.$cg-border; background: cg.$cg-panel-2; color: cg.$cg-text; font-size: 1.4rem; line-height: 1;
    &:hover { border-color: #f87171; color: #f87171; }
  }

  &__stage { flex: 1 1 auto; min-height: 0; position: relative; }
  &__stage .cycle-race-screen { height: 100%; }

  &__controls {
    display: flex; align-items: center; gap: 16px; padding: 12px 22px;
    border-top: 1px solid cg.$cg-border-soft;
  }
  &__btn {
    appearance: none; cursor: pointer; font-family: cg.$cg-display; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.04em;
    padding: 10px 24px; border-radius: 10px; min-width: 110px;
    color: #f8fafc; background: cg.$cg-accent; border: 1px solid cg.$cg-accent;
  }
  &__scrub { flex: 1; accent-color: cg.$cg-accent; }

  &__results { max-height: 34%; overflow-y: auto; border-top: 1px solid cg.$cg-border-soft; }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.jsx frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.scss frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.test.jsx
git commit -m "feat(cycle-game): RaceRecap replay component"
```

---

### Task 3: Make the Records rail clickable

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`

- [ ] **Step 1: Write the failing test** (append)

```js
it('records rail entries are clickable and fire onSelectRecord with the raceId', () => {
  const onSelectRecord = vi.fn();
  const records = [{
    raceId: '20260603120000',
    avatars: [{ id: 'milo', src: '/api/v1/static/img/users/milo', name: 'Milo' }],
    goalKind: 'distance', goalLabel: '3 km', scoreKind: 'time', scoreLabel: '4:12'
  }];
  const { getByTestId } = render(
    <CycleGameHome bikes={bikes} people={people} records={records} onSelectRecord={onSelectRecord} />
  );
  fireEvent.click(getByTestId('record-20260603120000'));
  expect(onSelectRecord).toHaveBeenCalledWith('20260603120000');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`
Expected: FAIL — no `record-<id>` testid / not a button.

- [ ] **Step 3: Implement**

Add `onSelectRecord` to the `CycleGameHome({ ... })` props destructure and to `CycleGameHome.propTypes` (`onSelectRecord: PropTypes.func`). In the records `<ol className="cgh-records">` map, change each `<li className="cgh-record">…</li>` so the row content is a `<button>`:

```jsx
            {records.map((rec, i) => (
              <li key={`${rec.raceId || i}`} className="cgh-record">
                <button
                  type="button"
                  className="cgh-record__btn"
                  data-testid={`record-${rec.raceId}`}
                  onClick={() => onSelectRecord?.(rec.raceId)}
                >
                  <span className="cgh-record__avatars">
                    {(rec.avatars || []).map((a) => (
                      <img key={a.id} className="cgh-record__avatar" src={a.src} alt={a.name} title={a.name}
                        onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }} />
                    ))}
                  </span>
                  <span className="cgh-record__stats">
                    <span className="cgh-record__chip" data-kind={rec.goalKind}>🏁 {rec.goalLabel}</span>
                    <span className="cgh-record__score">{rec.scoreLabel}</span>
                  </span>
                </button>
              </li>
            ))}
```

Add a minimal style so the button is a transparent full-width row (append to `CycleGameHome.scss`):

```scss
.cgh-record__btn {
  appearance: none; cursor: pointer; width: 100%;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  background: transparent; border: none; color: inherit; padding: 4px; border-radius: 8px;
  &:hover { background: rgba(255, 255, 255, 0.05); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`
Expected: PASS. (Update the existing "records" rendering test if its DOM assertions changed — it asserts on `/3 km/` and `4:12` text, which still render inside the button.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx
git commit -m "feat(cycle-game): records rail entries are clickable"
```

---

### Task 4: Wire the recap into the container

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx`

- [ ] **Step 1: Add recap state + handler**

Near the other lobby state, add:

```jsx
  const [recapRaceId, setRecapRaceId] = useState(null);
  const onSelectRecord = useCallback((raceId) => setRecapRaceId(raceId), []);
  const recapCandidate = useMemo(
    () => ghostCandidates.find((g) => g.raceId === recapRaceId) || null,
    [ghostCandidates, recapRaceId]
  );
```

- [ ] **Step 2: Import RaceRecap**

At the top with the other widget imports:

```jsx
import RaceRecap from './RaceRecap.jsx';
```

- [ ] **Step 3: Pass `onSelectRecord` to the lobby**

In the `phase === 'idle'` render, add the prop to `<CycleGameHome … onSelectRecord={onSelectRecord} … />`.

- [ ] **Step 4: Render the recap overlay**

Still in the `phase === 'idle'` branch, render the overlay inside the `cycle-game-container` div, after `<CycleGameHome … />`:

```jsx
        {recapCandidate && (
          <RaceRecap candidate={recapCandidate} onClose={() => setRecapRaceId(null)} />
        )}
```

- [ ] **Step 5: Verify suites pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/ frontend/src/modules/Fitness/lib/cycleGame/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx
git commit -m "feat(cycle-game): open Race Recap from the records rail"
```

---

### Task 5: Live verification (deploy + manual)

- [ ] **Step 1: Build + deploy**

```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 2: Run the lifecycle E2E (regression — recap must not break the lobby)**

```bash
TEST_FRONTEND_URL=http://localhost:3111 \
DAYLIGHT_MEDIA_LOGS_FITNESS=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/logs/fitness \
npx playwright test tests/live/flow/fitness/cycle-game-lifecycle.runtime.test.mjs --config playwright.prod.config.mjs --reporter=line; echo "PW_EXIT=$?"
```
Expected: `3 passed`.

- [ ] **Step 3: Manual check** — open the cycle game lobby, click a Records entry, confirm the recap opens, Play animates the lines to the finish, the scrubber works, standings show, and close returns to the lobby.

---

## Notes / gotchas
- **No backend work** — `ghostCandidates` already contains the full per-participant recorded series; the recap reuses it. (If `hrSeries` isn't present yet — the ghost-HR plan not landed — the recap simply shows no HR; `decodeSeries(undefined)` → `[]`.)
- **Speedometers are hidden in the recap** (`showSpeedos={false}`) because RPM is not recorded — only distance + HR are. The chart + tip avatars + HR tell the story.
- **Replay speed:** the whole race compresses to ~12s (`REPLAY_TARGET_MS`) regardless of real duration, so a 2-minute race isn't a 2-minute recap. Adjust `REPLAY_TARGET_MS` if it feels too fast/slow.
- **Auto-scale + tips come for free** — because the recap drives the real `CycleRaceScreen`, it inherits the gradient fills, terminus avatar+score+HR markers, and linear/log auto-scaling.
- **Ordering:** this plan is independent of the ghost-HR plan, but they share `CycleRaceScreen`/`ghostCandidates`. If both are executed, land ghost-HR first so the recap shows HR for newly-recorded races.
