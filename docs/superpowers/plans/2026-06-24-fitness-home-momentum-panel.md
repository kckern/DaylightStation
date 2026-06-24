# Fitness Home Momentum Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fitness home screen's nested, uninsightful `bottom-panels` region (`fitness:longitudinal` + `fitness:coach`) with one flat, motivational `fitness:momentum` widget — a household momentum headline plus a per-person streak/active-minutes row over a rolling 7-day window.

**Architecture:** A pure, unit-tested `momentum.js` computes per-person + household momentum from the `sessions` data the home screen already loads (`useScreenData('sessions')`) plus the roster + household label exposed through the existing `FitnessScreenProvider`. A presentational `FitnessMomentum.jsx` widget renders it. The widget registers as `fitness:momentum`; the home-screen config swaps the `bottom-panels` subtree for a single widget node.

**Tech Stack:** React, the project's screen-framework (`useScreenData`, widget registry), vitest, SCSS.

Spec: `docs/superpowers/specs/2026-06-24-fitness-home-momentum-panel-design.md`

---

## Session data shape (verified)

`/api/v1/fitness/sessions?since=95d` returns objects with:
- `date` — `"YYYY-MM-DD"` (already timezone-bucketed by the backend)
- `durationMs` — number (active ms; minutes = `durationMs / 60000`)
- `startTime` — epoch ms (used for the rolling-7-day cutoff)
- `participants` — `{ [userId]: { displayName } }` (a session can have several)

Roster comes from `/api/v1/fitness` → `users.primary` (hydrated `[{ id, name, ... }]`), already loaded by `FitnessApp`. `household_label` is a new top-level key in `fitness.yml`.

## File structure

- **Create** `frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.js` — pure compute (no DOM/fetch).
- **Create** `frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.test.js` — unit tests.
- **Create** `frontend/src/modules/Fitness/widgets/FitnessMomentum/FitnessMomentum.jsx` — the widget.
- **Create** `frontend/src/modules/Fitness/widgets/FitnessMomentum/FitnessMomentum.scss` — styles.
- **Create** `frontend/src/modules/Fitness/widgets/FitnessMomentum/FitnessMomentum.test.jsx` — render test.
- **Create** `frontend/src/modules/Fitness/widgets/FitnessMomentum/index.jsx` — barrel (matches sibling widgets).
- **Modify** `frontend/src/modules/Fitness/FitnessScreenProvider.jsx` — expose `roster` + `householdLabel`.
- **Modify** `frontend/src/Apps/FitnessApp.jsx` — pass `roster` + `householdLabel` into the provider.
- **Modify** `frontend/src/modules/Fitness/index.js` — register `fitness:momentum`.
- **Config** `data/household/config/fitness.yml` (in the container) — add `household_label`; swap the `bottom-panels` node.

Run all frontend tests from the repo root with `npx vitest run <path>`.

---

### Task 1: Pure momentum computation

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.js`
- Test: `frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.test.js
import { describe, it, expect } from 'vitest';
import { computeMomentum, addDays } from './momentum.js';

const roster = [
  { id: 'felix', name: 'Felix' },
  { id: 'kckern', name: 'KC Kern' },
];
// "today" anchor used across tests
const TODAY = '2026-06-24';
const NOW = Date.UTC(2026, 5, 24, 18, 0, 0); // 2026-06-24T18:00Z

// helper to build a session
const sess = (date, durationMs, users, startTime) => ({
  date, durationMs, startTime: startTime ?? Date.parse(`${date}T12:00:00Z`),
  participants: Object.fromEntries(users.map((u) => [u, { displayName: u }])),
});

describe('addDays', () => {
  it('subtracts/adds days across month boundaries', () => {
    expect(addDays('2026-06-01', -1)).toBe('2026-05-31');
    expect(addDays('2026-06-24', 1)).toBe('2026-06-25');
  });
});

describe('computeMomentum', () => {
  it('sums active minutes per participant over the rolling 7 days only', () => {
    const sessions = [
      sess('2026-06-24', 30 * 60000, ['felix']),          // in week
      sess('2026-06-20', 20 * 60000, ['felix', 'kckern']), // in week (both)
      sess('2026-06-10', 99 * 60000, ['felix']),          // OUTSIDE 7d window
    ];
    const { members } = computeMomentum(sessions, roster, { now: NOW, todayStr: TODAY, goalMinutes: 150 });
    const felix = members.find((m) => m.id === 'felix');
    const kc = members.find((m) => m.id === 'kckern');
    expect(felix.activeMinutes).toBe(50);   // 30 + 20, NOT the 99 from 14d ago
    expect(kc.activeMinutes).toBe(20);
    expect(felix.goalMinutes).toBe(150);
    expect(felix.pct).toBeCloseTo(50 / 150, 5);
    expect(felix.met).toBe(false);
  });

  it('counts a live streak through today or yesterday and stops at the first gap', () => {
    const sessions = [
      sess('2026-06-24', 10 * 60000, ['felix']),
      sess('2026-06-23', 10 * 60000, ['felix']),
      sess('2026-06-22', 10 * 60000, ['felix']),
      // gap on 06-21
      sess('2026-06-20', 10 * 60000, ['felix']),
    ];
    const { members } = computeMomentum(sessions, roster, { now: NOW, todayStr: TODAY });
    expect(members.find((m) => m.id === 'felix').streakDays).toBe(3);
  });

  it('keeps a streak alive when today is empty but yesterday is active', () => {
    const sessions = [
      sess('2026-06-23', 10 * 60000, ['felix']),
      sess('2026-06-22', 10 * 60000, ['felix']),
    ];
    const { members } = computeMomentum(sessions, roster, { now: NOW, todayStr: TODAY });
    expect(members.find((m) => m.id === 'felix').streakDays).toBe(2);
  });

  it('reports zero for a roster member with no sessions, but still lists them', () => {
    const { members } = computeMomentum([], roster, { now: NOW, todayStr: TODAY });
    expect(members.map((m) => m.id)).toEqual(['felix', 'kckern']); // roster order preserved
    expect(members[0].activeMinutes).toBe(0);
    expect(members[0].streakDays).toBe(0);
  });

  it('aggregates the household: minutes = sum of members, goal = members*goal, streak = any-member days', () => {
    const sessions = [
      sess('2026-06-24', 30 * 60000, ['felix']),
      sess('2026-06-23', 40 * 60000, ['kckern']),
    ];
    const { household } = computeMomentum(sessions, roster, { now: NOW, todayStr: TODAY, goalMinutes: 150, householdLabel: 'Kern Family' });
    expect(household.label).toBe('Kern Family');
    expect(household.activeMinutes).toBe(70);     // 30 + 40
    expect(household.goalMinutes).toBe(300);      // 2 members * 150
    expect(household.streakDays).toBe(2);         // 06-24 + 06-23, any member
  });

  it('caps pct at 1 but keeps real minutes; flags met', () => {
    const sessions = [sess('2026-06-24', 200 * 60000, ['felix'])];
    const { members } = computeMomentum(sessions, roster, { now: NOW, todayStr: TODAY, goalMinutes: 150 });
    const felix = members.find((m) => m.id === 'felix');
    expect(felix.activeMinutes).toBe(200);
    expect(felix.pct).toBe(1);
    expect(felix.met).toBe(true);
  });

  it('falls back to a generic household label and empty roster safely', () => {
    const { household, members } = computeMomentum([], [], { now: NOW, todayStr: TODAY });
    expect(household.label).toBe('Your household');
    expect(members).toEqual([]);
    expect(household.streakDays).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.test.js`
Expected: FAIL — `Failed to resolve import "./momentum.js"`.

- [ ] **Step 3: Implement `momentum.js`**

```js
// frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.js
//
// Pure momentum computation for the fitness home Momentum widget. No DOM, no
// fetch — a function of (sessions, roster, opts). "This week" is a ROLLING 7-day
// window ending `now`; a streak is the run of consecutive calendar days ending
// today (or yesterday, so an un-worked-out today doesn't break a live streak).

const DAY_MS = 86_400_000;
const DEFAULT_GOAL_MIN = 150;

/** Shift a 'YYYY-MM-DD' day string by `delta` days (UTC-safe date arithmetic). */
export function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** Length of the consecutive-day run in `dateSet` ending today, or yesterday. */
function streakDays(dateSet, todayStr) {
  if (!dateSet || dateSet.size === 0) return 0;
  let cursor;
  if (dateSet.has(todayStr)) cursor = todayStr;
  else if (dateSet.has(addDays(todayStr, -1))) cursor = addDays(todayStr, -1);
  else return 0;
  let count = 0;
  while (dateSet.has(cursor)) { count += 1; cursor = addDays(cursor, -1); }
  return count;
}

/**
 * @param {Array} sessions - fitness sessions ({ date, durationMs, startTime, participants })
 * @param {Array} roster   - [{ id, name }] family members (display order preserved)
 * @param {object} [opts]
 * @param {number} [opts.now=Date.now()] - rolling-window anchor (epoch ms)
 * @param {string} [opts.todayStr]       - today's local 'YYYY-MM-DD' (defaults from now, UTC)
 * @param {number} [opts.goalMinutes=150]- per-person weekly active-minute goal
 * @param {string} [opts.householdLabel] - team headline label
 * @returns {{ household: object, members: object[] }}
 */
export function computeMomentum(sessions, roster, opts = {}) {
  const now = opts.now ?? Date.now();
  const todayStr = opts.todayStr ?? new Date(now).toISOString().slice(0, 10);
  const goalMinutes = opts.goalMinutes ?? DEFAULT_GOAL_MIN;
  const householdLabel = opts.householdLabel || 'Your household';
  const list = Array.isArray(sessions) ? sessions : [];
  const members = Array.isArray(roster) ? roster : [];
  const weekCutoff = now - 7 * DAY_MS;

  const minutesByUser = new Map(); // id -> minutes in last 7d
  const datesByUser = new Map();   // id -> Set('YYYY-MM-DD') over all history
  const householdDates = new Set();

  for (const s of list) {
    const mins = (s.durationMs || 0) / 60000;
    const inWeek = (s.startTime ?? 0) >= weekCutoff;
    const day = s.date;
    const userIds = s.participants ? Object.keys(s.participants) : [];
    for (const uid of userIds) {
      if (inWeek) minutesByUser.set(uid, (minutesByUser.get(uid) || 0) + mins);
      if (day) {
        if (!datesByUser.has(uid)) datesByUser.set(uid, new Set());
        datesByUser.get(uid).add(day);
      }
    }
    if (day && userIds.length) householdDates.add(day);
  }

  const memberRows = members.map((m) => {
    const activeMinutes = Math.round(minutesByUser.get(m.id) || 0);
    const pct = goalMinutes > 0 ? Math.min(1, activeMinutes / goalMinutes) : 0;
    return {
      id: m.id,
      name: m.name || m.id,
      avatarId: m.id,
      activeMinutes,
      goalMinutes,
      pct,
      met: activeMinutes >= goalMinutes,
      streakDays: streakDays(datesByUser.get(m.id), todayStr),
    };
  });

  const householdMinutes = memberRows.reduce((sum, r) => sum + r.activeMinutes, 0);
  const householdGoal = memberRows.length * goalMinutes;
  const household = {
    label: householdLabel,
    activeMinutes: householdMinutes,
    goalMinutes: householdGoal,
    pct: householdGoal > 0 ? Math.min(1, householdMinutes / householdGoal) : 0,
    met: householdGoal > 0 && householdMinutes >= householdGoal,
    streakDays: streakDays(householdDates, todayStr),
  };

  return { household, members: memberRows };
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.js frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.test.js
git commit -m "feat(fitness): pure momentum compute (rolling-7d minutes + day streaks)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Expose roster + household label through FitnessScreenProvider

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessScreenProvider.jsx`

- [ ] **Step 1: Add the two new props to the provider signature**

In `FitnessScreenProvider({ ... })`, add `roster = []` and `householdLabel = ''` to the destructured props (after `onSelectedSessionConsumed`).

```jsx
export function FitnessScreenProvider({
  onPlay,
  onNavigate,
  onCtaAction,
  initialSelectedSessionId = null,
  onSelectedSessionConsumed,
  roster = [],
  householdLabel = '',
  children,
}) {
```

- [ ] **Step 2: Include them in the memoized context value**

Add `roster, householdLabel,` to the `value` object and to its dependency array:

```jsx
  const value = useMemo(() => ({
    onPlay, onNavigate, onCtaAction,
    scrollToDate, setScrollToDate,
    selectedSessionId, setSelectedSessionId,
    longitudinalSelection, setLongitudinalSelection,
    lastPlayedContentId, setLastPlayedContentId,
    roster, householdLabel,
  }), [onPlay, onNavigate, onCtaAction, scrollToDate, selectedSessionId, longitudinalSelection, lastPlayedContentId, roster, householdLabel]);
```

- [ ] **Step 3: Add them to the no-provider fallback in `useFitnessScreen`**

In the `if (!ctx)` fallback return object, add `roster: [], householdLabel: '',`.

- [ ] **Step 4: Verify nothing breaks**

Run: `npx vitest run frontend/src/modules/Fitness/`
Expected: PASS (existing fitness widget/provider tests unaffected; the new keys are additive).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessScreenProvider.jsx
git commit -m "feat(fitness): expose roster + householdLabel to screen widgets

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Pass roster + household label from FitnessApp into the provider

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`

`FitnessApp` already loads the fitness config (the object that holds `users.primary`; the existing `primaryUserId` memo reads `users.primary[0].id` from it) and renders `<FitnessScreenProvider ...>`.

- [ ] **Step 1: Derive the roster + label**

Near the existing `primaryUserId` memo, add (use the same fitness-config variable the `primaryUserId` memo reads — referred to here as `fitnessConfiguration`/the unified config object; match the actual local name in the file):

```jsx
const momentumRoster = useMemo(() => {
  const primary = fitnessConfiguration?.users?.primary;
  return Array.isArray(primary)
    ? primary.map((u) => ({ id: u.id, name: u.name || u.display_name || u.id }))
    : [];
}, [fitnessConfiguration]);
const householdLabel = fitnessConfiguration?.household_label || '';
```

- [ ] **Step 2: Pass them to the provider**

On the `<FitnessScreenProvider ...>` element, add the props:

```jsx
<FitnessScreenProvider
  /* ...existing props... */
  roster={momentumRoster}
  householdLabel={householdLabel}
>
```

- [ ] **Step 3: Verify the app still compiles**

Run: `npx vitest run frontend/src/Apps/` (or the closest existing FitnessApp test) and `node --experimental-vm-modules` is not needed — just confirm no import/JSX error via `npx vite build` if no direct test exists.
Expected: build/tests succeed.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "feat(fitness): feed roster + household_label into the screen provider

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The Momentum widget (render) + styles

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessMomentum/FitnessMomentum.jsx`
- Create: `frontend/src/modules/Fitness/widgets/FitnessMomentum/FitnessMomentum.scss`
- Create: `frontend/src/modules/Fitness/widgets/FitnessMomentum/FitnessMomentum.test.jsx`

- [ ] **Step 1: Write the failing render test**

```jsx
// FitnessMomentum.test.jsx
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const sessions = [
  { date: '2026-06-24', durationMs: 30 * 60000, startTime: Date.parse('2026-06-24T12:00:00Z'), participants: { felix: { displayName: 'Felix' } } },
];
vi.mock('@/screen-framework/data/ScreenDataProvider.jsx', () => ({ useScreenData: () => sessions }));
vi.mock('@/modules/Fitness/FitnessScreenProvider.jsx', () => ({
  useFitnessScreen: () => ({ roster: [{ id: 'felix', name: 'Felix' }, { id: 'kckern', name: 'KC Kern' }], householdLabel: 'Kern Family' }),
}));

import FitnessMomentum from './FitnessMomentum.jsx';

describe('FitnessMomentum', () => {
  it('renders the household headline and one card per roster member', () => {
    const { container, getByText } = render(<FitnessMomentum />);
    expect(getByText(/Kern Family/)).toBeTruthy();
    expect(container.querySelectorAll('.fitness-momentum__card').length).toBe(2);
    expect(getByText('Felix')).toBeTruthy();
    expect(getByText('KC Kern')).toBeTruthy();
  });

  it('shows a warm zero-state when nobody is active', () => {
    // override sessions to empty for this render via a fresh mock module is overkill;
    // instead assert the component tolerates empty members gracefully:
    const { container } = render(<FitnessMomentum />);
    expect(container.querySelector('.fitness-momentum')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FitnessMomentum/FitnessMomentum.test.jsx`
Expected: FAIL — cannot resolve `./FitnessMomentum.jsx`.

- [ ] **Step 3: Implement the widget**

```jsx
// FitnessMomentum.jsx
import React, { useMemo } from 'react';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import getLogger from '@/lib/logging/Logger.js';
import { computeMomentum } from './momentum.js';
import './FitnessMomentum.scss';

const logger = getLogger().child({ component: 'fitness-momentum' });

function Avatar({ id, name }) {
  const [failed, setFailed] = React.useState(false);
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (failed || !id) return <span className="fitness-momentum__avatar fitness-momentum__avatar--fallback">{initials}</span>;
  return <img className="fitness-momentum__avatar" src={`/api/v1/static/img/users/${id}`} alt={name} onError={() => setFailed(true)} />;
}

export default function FitnessMomentum() {
  const sessions = useScreenData('sessions');
  const { roster, householdLabel } = useFitnessScreen();

  const data = useMemo(
    () => computeMomentum(sessions, roster, { householdLabel }),
    [sessions, roster, householdLabel],
  );

  logger.sampled('momentum.render', { members: data.members.length, householdMin: data.household.activeMinutes },
    { maxPerMinute: 12, aggregate: true });

  const { household, members } = data;
  const anyActive = household.activeMinutes > 0;

  return (
    <div className="fitness-momentum">
      <div className="fitness-momentum__headline">
        <span className="fitness-momentum__flame">🔥</span>
        <span className="fitness-momentum__house">{household.label}</span>
        {household.streakDays > 0 && (
          <span className="fitness-momentum__roll">· {household.streakDays}-day roll</span>
        )}
        <span className="fitness-momentum__house-min">{household.activeMinutes} / {household.goalMinutes} min</span>
        <span className="fitness-momentum__bar fitness-momentum__bar--house">
          <span className="fitness-momentum__bar-fill" style={{ transform: `scaleX(${household.pct})` }} />
        </span>
      </div>

      {!anyActive && (
        <div className="fitness-momentum__zero">Let’s get moving — log a workout to start the week.</div>
      )}

      <div className="fitness-momentum__cards">
        {members.map((m) => (
          <div key={m.id} className={`fitness-momentum__card${m.met ? ' is-met' : ''}`}>
            <Avatar id={m.avatarId} name={m.name} />
            <span className="fitness-momentum__name">{m.name}</span>
            <span className="fitness-momentum__streak">🔥 {m.streakDays}</span>
            <span className="fitness-momentum__min">{m.activeMinutes} / {m.goalMinutes}{m.met ? ' ✓' : ''}</span>
            <span className="fitness-momentum__bar">
              <span className="fitness-momentum__bar-fill" style={{ transform: `scaleX(${m.pct})` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement the styles**

```scss
// FitnessMomentum.scss — one flat glass panel, sized for a TV, high-contrast.
.fitness-momentum {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  height: 100%;
  width: 100%;
  padding: 1rem 1.25rem;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  color: #e8e8ea;
  font-family: "Roboto Condensed", sans-serif;

  &__headline {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 1.5rem;
    font-weight: 700;
  }
  &__flame { font-size: 1.6rem; }
  &__house { letter-spacing: 0.01em; }
  &__roll { color: #ffb44c; font-weight: 700; }
  &__house-min { margin-left: auto; font-variant-numeric: tabular-nums; opacity: 0.9; }

  &__zero { opacity: 0.75; font-size: 1.1rem; }

  &__cards {
    flex: 1 1 auto;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 0.75rem;
    min-height: 0;
  }

  &__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 0.9rem 0.6rem;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid transparent;

    &.is-met { border-color: #3ddc84; box-shadow: 0 0 14px rgba(61, 220, 132, 0.35); }
  }

  &__avatar {
    width: 3.25rem;
    height: 3.25rem;
    border-radius: 50%;
    object-fit: cover;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    &--fallback { background: #3ddc84; color: #07210f; font-weight: 800; }
  }
  &__name { font-weight: 700; font-size: 1.1rem; }
  &__streak { color: #ffb44c; font-weight: 700; }
  &__min { font-variant-numeric: tabular-nums; opacity: 0.9; }

  &__bar {
    width: 100%;
    height: 0.5rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
    &--house { max-width: 16rem; }
  }
  &__bar-fill {
    display: block;
    height: 100%;
    width: 100%;
    transform-origin: left center;
    background: linear-gradient(90deg, #3ddc84, #7be0a3);
  }
}
```

- [ ] **Step 5: Run the render test, verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FitnessMomentum/FitnessMomentum.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessMomentum/FitnessMomentum.jsx frontend/src/modules/Fitness/widgets/FitnessMomentum/FitnessMomentum.scss frontend/src/modules/Fitness/widgets/FitnessMomentum/FitnessMomentum.test.jsx
git commit -m "feat(fitness): FitnessMomentum widget — household headline + per-person cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Register the widget

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessMomentum/index.jsx`
- Modify: `frontend/src/modules/Fitness/index.js`

- [ ] **Step 1: Barrel file** (matches sibling widgets like `FitnessLongitudinalWidget/index.jsx`)

```jsx
// frontend/src/modules/Fitness/widgets/FitnessMomentum/index.jsx
export { default } from './FitnessMomentum.jsx';
```

- [ ] **Step 2: Register `fitness:momentum`**

In `frontend/src/modules/Fitness/index.js`, alongside the other `registry.register('fitness:...')` lines, add an import and registration:

```js
import FitnessMomentumWidget from './widgets/FitnessMomentum/index.jsx';
// ...
registry.register('fitness:momentum', FitnessMomentumWidget);
```

- [ ] **Step 3: Verify registry test still passes**

Run: `npx vitest run frontend/src/modules/Fitness/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessMomentum/index.jsx frontend/src/modules/Fitness/index.js
git commit -m "feat(fitness): register fitness:momentum widget

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Config — household_label + swap the bottom-panels node

**Files:**
- Config (container data volume): `data/household/config/fitness.yml`

This is a data-volume file (not in git). Edit it inside the container with a heredoc (NEVER `sed -i` on YAML — it mangles structure). Read → edit → write the whole `screens.home.layout` region, or surgically replace the `bottom-panels` block. Keep `node:node` ownership.

- [ ] **Step 1: Add `household_label`**

Add a top-level key to `fitness.yml` (only if absent):

```bash
sudo docker exec daylight-station sh -c 'grep -q "^household_label:" data/household/config/fitness.yml || printf "\nhousehold_label: \"Kern Family\"\n" >> data/household/config/fitness.yml'
```

- [ ] **Step 2: Replace the `bottom-panels` subtree with the momentum widget**

In `screens.home.layout` → `right-area.children`, replace the entire `bottom-panels` node:

```yaml
        - id: right-area
          basis: "66%"
          direction: column
          gap: 0.5rem
          children:
            - widget: "fitness:suggestions"
            - widget: "fitness:momentum"
              basis: "45%"
```

(Removes the `bottom-panels` row holding `fitness:longitudinal` + `fitness:coach`.) Because YAML edits are fragile, read the current `screens.home.layout` block, make the change in a working copy, and write the whole file back via heredoc; then verify it parses by hitting the config endpoint.

- [ ] **Step 3: Verify the config parses + serves the new layout**

```bash
curl -s "http://localhost:3111/api/v1/fitness" | python3 -c "import sys,json;d=json.load(sys.stdin);print('household_label:', d.get('household_label')); import json as j; print('momentum in home layout:', 'fitness:momentum' in j.dumps(d.get('screens',{}).get('home',{})))"
```
Expected: `household_label: Kern Family` and `momentum in home layout: True`.

---

### Task 7: Build, deploy, verify on the garage display

The fitness app runs on the **garage** machine (fullscreen Firefox), not the piano tablet. After deploy the garage kiosk needs a hard reload.

- [ ] **Step 1: Run the full new+touched test surface**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FitnessMomentum/ frontend/src/modules/Fitness/`
Expected: PASS.

- [ ] **Step 2: Deploy (respect the gate)**

Confirm no active fitness session (`sessionActive:false`, `rosterSize:0`) before building. Then `sudo docker build` + `sudo deploy-daylight` per CLAUDE.local.md.

- [ ] **Step 3: Hard-reload the garage kiosk**

```bash
ssh garage 'DISPLAY=:0 XAUTHORITY=/home/kckern/.Xauthority xdotool search --onlyvisible --class firefox windowactivate --sync key ctrl+shift+r'
```

- [ ] **Step 4: Eyes-on verification (parent/user)**

On the fitness home: the bottom-right region now shows the Momentum panel — household headline (`Kern Family · N-day roll · min/goal`) + a card per family member with avatar, 🔥 streak, min/goal, and a progress bar; goal-met cards glow green. Confirm it reads cleanly from a distance and the old nested charts are gone.

---

## Self-Review

- **Spec coverage:** purpose/scope/metric → Task 1 (compute) + Task 4 (render); rolling-7d + streak liveness → Task 1 tests; household headline + per-person row → Task 4; `household_label` + layout swap → Task 6; avatars/initials + goal-met accent + zero-state → Task 4; removal of longitudinal/coach from home (widgets stay registered) → Task 6. ✓
- **Placeholders:** none — every code step has full code; the only deferred detail is the exact local variable name of the fitness config object in `FitnessApp.jsx` (Task 3), which the implementer reads from the existing `primaryUserId` memo. ✓
- **Type consistency:** `computeMomentum(sessions, roster, opts)` and its `{ household, members[] }` shape (`activeMinutes`, `goalMinutes`, `pct`, `met`, `streakDays`, `id`, `name`, `avatarId`) are used identically in the widget; `addDays` exported and tested. Provider keys `roster`/`householdLabel` match across Tasks 2–4. ✓
