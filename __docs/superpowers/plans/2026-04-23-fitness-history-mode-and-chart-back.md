# Fitness History Mode and Chart Back Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) When the last user disconnects and `FitnessSession.endSession('empty_roster')` fires, keep the `FitnessChart` on-screen as a static **History Mode** snapshot (persists indefinitely until the user navigates away) with a clear "Session Ended" overlay — instead of the current "limbo/waiting" state caused by `setPersisted(null)` clearing on `sessionId` change. (2) Add a **Return Home** back button on the chart VIEW (the surrounding wrapper in `FitnessPlayer`), **not** overlaid on the chart's SVG/axes. The button invokes the existing `onToggleChart` handler (which flips `showChart` state).

**Architecture:** Two logically separable changes in one plan.

- *Issue C — History Mode.* Extract a pure helper `computeHistorySnapshotAction(prevSessionId, nextSessionId, isHistorical)` that returns one of `{ action: 'keep' }`, `{ action: 'clear' }`, or `{ action: 'enter-history' }`. Today, when `sessionId` transitions `'abc' -> null` (session ended), the existing effect at `FitnessChart.jsx:911-917` calls `setPersisted(null)`. The new helper returns `'enter-history'` on `string -> null`, keeping the snapshot alive. It returns `'clear'` on a true session swap (`'abc' -> 'xyz'`). A sibling local `[historyMode, setHistoryMode]` state tracks "session has ended but chart is retained," and when true the existing render path renders a new `<div className="race-chart__history-overlay">Session Ended</div>` absolute-positioned label inside the chart container. No timer, no auto-dismiss.

- *Issue F4 — Chart back button.* A tiny new component `FitnessChartBackButton.jsx` rendered by `FitnessPlayer.jsx` inside the `.fitness-chart-overlay` wrapper but *outside* the `<FitnessChart/>` element. The button fires the same `onToggleChart` prop already wired to `setShowChart(prev => !prev)` (line 1585). The button is absolutely positioned over the wrapper's top-left corner; the existing chart's `.race-chart__scale-toggle` / `.race-chart__focus-filter` already occupy the top-right and upper chart area, so top-left is free. The button is not a child of `FitnessChart` — it overlays the wrapper, not the SVG, so it does not sit on x-axis / y-axis real estate.

**Design decision — History Mode visual cue:** Chose **option (a) overlay text "Session Ended"** — minimal, explicit, no risk of being missed.

**Tech Stack:** React, Jest (node testEnvironment per `/opt/Code/DaylightStation/jest.config.js`), SCSS. No new dependencies.

**Spec:** Bug bash Issues C and F4. Context captured in this plan header.

---

## File Structure

| File | Role | Change |
|---|---|---|
| `frontend/src/modules/Fitness/widgets/FitnessChart/historyMode.js` | NEW — pure helper: decide keep/clear/enter-history | Create |
| `tests/unit/fitness/FitnessChart-historyMode.test.mjs` | NEW — unit tests for helper | Create |
| `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` | Swap "clear persisted" effect, add `historyMode` state + overlay | Modify |
| `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.scss` | Add `.race-chart__history-overlay` pill styles | Modify |
| `frontend/src/modules/Fitness/player/FitnessChartBackButton.jsx` | NEW — presentational back button | Create |
| `frontend/src/modules/Fitness/player/FitnessChartBackButton.js` | NEW — pure label helper (jsx-free for jest node env) | Create |
| `tests/unit/fitness/FitnessChartBackButton.test.mjs` | NEW — unit test for label helper | Create |
| `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` | Render back button in chart overlay wrapper | Modify |
| `frontend/src/modules/Fitness/player/FitnessPlayer.scss` | Add `.fitness-chart-back-button` styles | Modify |

The existing `onClose` prop on `FitnessChart` (line 737, currently unused) is **left alone** — per the spec, the back button belongs on the chart *view* (wrapper), not on the chart component.

---

## Background — Current State

**Existing persisted snapshot.** `FitnessChart.jsx:904, 1166-1178` already persists the last-rendered snapshot. Render falls back to `persisted?.paths` etc. when live data is empty. So the chart already shows the last known snapshot when data goes quiet — except the effect at `FitnessChart.jsx:911-917` clears `persisted` when `sessionId` changes:

```jsx
useEffect(() => {
    if (lastPersistedSessionRef.current !== sessionId) {
        lastPersistedSessionRef.current = sessionId;
        setPersisted(null);
        setFocusedUserId(null);
    }
}, [sessionId]);
```

When `endSession('empty_roster')` runs (`FitnessSession.js:2133` → `this.reset()` → `sessionId = null`), the sessionId transitions `'abc' -> null`, this effect fires, the snapshot is wiped. **This is the root cause of Issue C.**

**Existing back-button scaffolding.** `FitnessChart.jsx:737` accepts `onClose` but renders no UI. `FitnessPlayer.jsx:1558` passes `onClose={() => {}}`. Toggle state is `FitnessPlayer.jsx:265` (`[showChart, setShowChart] = useState(true)`).

---

## Task 1: History Mode helper + unit tests (RED → GREEN)

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessChart/historyMode.js`
- Create: `tests/unit/fitness/FitnessChart-historyMode.test.mjs`

- [ ] **Step 1: Write the failing tests first**

Create `tests/unit/fitness/FitnessChart-historyMode.test.mjs`:

```js
import { describe, it, expect, beforeAll } from '@jest/globals';

let computeHistorySnapshotAction;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/widgets/FitnessChart/historyMode.js');
  computeHistorySnapshotAction = mod.computeHistorySnapshotAction;
});

describe('computeHistorySnapshotAction', () => {
  it('returns keep when sessionId is unchanged', () => {
    expect(computeHistorySnapshotAction('abc', 'abc', false)).toEqual({ action: 'keep' });
  });

  it('returns keep on first mount (null -> session)', () => {
    expect(computeHistorySnapshotAction(null, 'abc', false)).toEqual({ action: 'keep' });
  });

  it('returns clear on live-session swap (abc -> xyz)', () => {
    expect(computeHistorySnapshotAction('abc', 'xyz', false)).toEqual({ action: 'clear' });
  });

  it('returns enter-history on session end (abc -> null)', () => {
    expect(computeHistorySnapshotAction('abc', null, false)).toEqual({ action: 'enter-history' });
  });

  it('returns enter-history on session end (abc -> undefined)', () => {
    expect(computeHistorySnapshotAction('abc', undefined, false)).toEqual({ action: 'enter-history' });
  });

  it('treats isHistorical=true as keep regardless of sessionId value', () => {
    expect(computeHistorySnapshotAction('abc', 'xyz', true)).toEqual({ action: 'keep' });
    expect(computeHistorySnapshotAction('abc', null, true)).toEqual({ action: 'keep' });
  });

  it('returns keep when both sides are nullish', () => {
    expect(computeHistorySnapshotAction(null, null, false)).toEqual({ action: 'keep' });
    expect(computeHistorySnapshotAction(undefined, null, false)).toEqual({ action: 'keep' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module ...historyMode.js`)

```bash
cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/FitnessChart-historyMode.test.mjs
```

- [ ] **Step 3: Create the helper**

Create `frontend/src/modules/Fitness/widgets/FitnessChart/historyMode.js`:

```js
/**
 * computeHistorySnapshotAction — pure helper that decides what to do with
 * FitnessChart's persisted snapshot when `sessionId` changes.
 *
 * @param {string|null|undefined} prevSessionId
 * @param {string|null|undefined} nextSessionId
 * @param {boolean} isHistorical
 * @returns {{ action: 'keep'|'clear'|'enter-history' }}
 */
export function computeHistorySnapshotAction(prevSessionId, nextSessionId, isHistorical) {
  if (isHistorical) return { action: 'keep' };
  if (prevSessionId === nextSessionId) return { action: 'keep' };
  if (prevSessionId == null) return { action: 'keep' };
  if (nextSessionId == null) return { action: 'enter-history' };
  return { action: 'clear' };
}

export default computeHistorySnapshotAction;
```

- [ ] **Step 4: Re-run tests — expect PASS** (7 tests green)

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/widgets/FitnessChart/historyMode.js \
        tests/unit/fitness/FitnessChart-historyMode.test.mjs
git commit -m "feat(fitness): add computeHistorySnapshotAction helper"
```

---

## Task 2: Wire History Mode into FitnessChart

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.scss`

- [ ] **Step 1: Import the helper** — below the existing `createChartDataSource` import (~line 16):

```jsx
import { computeHistorySnapshotAction } from './historyMode.js';
```

- [ ] **Step 2: Add `historyMode` state** — replace lines 904-906:

```jsx
	const [persisted, setPersisted] = useState(null);
	const [useLogScale, setUseLogScale] = useState(true);
	const [focusedUserId, setFocusedUserId] = useState(null);
	// Issue C — History Mode. When the live session ends (sessionId -> null) we
	// FREEZE the persisted snapshot on screen indefinitely instead of clearing it.
	const [historyMode, setHistoryMode] = useState(false);
```

- [ ] **Step 3: Replace the "clear persisted on session change" effect** — replace lines 908-917:

```jsx
	const lastPersistedSessionRef = useRef(sessionId);
	useEffect(() => {
		const prev = lastPersistedSessionRef.current;
		if (prev === sessionId) return;
		const { action } = computeHistorySnapshotAction(prev, sessionId, isHistorical);
		lastPersistedSessionRef.current = sessionId;
		if (action === 'clear') {
			setPersisted(null);
			setFocusedUserId(null);
			setHistoryMode(false);
		} else if (action === 'enter-history') {
			setHistoryMode(true);
		}
	}, [sessionId, isHistorical]);
```

- [ ] **Step 4: Render the "Session Ended" overlay** — find the return block at line 1204 and replace the opening div + two empty-state lines:

```jsx
	return (
		<div
			className={`fitness-chart ${layoutClass}${historyMode ? ' fitness-chart--history-mode' : ''}`}
			ref={containerRef}
		>
			{historyMode && (
				<div className="race-chart__history-overlay" role="status" aria-live="polite">
					Session Ended
				</div>
			)}
			{!hasData && !persisted && !isHistorical && !historyMode && (
				<div className="race-chart-panel__empty">Timeline warming up…</div>
			)}
			{!hasData && !persisted && isHistorical && (
				<div className="race-chart-panel__empty">No timeline data for this session</div>
			)}
```

- [ ] **Step 5: Add overlay styles** — append to `FitnessChart.scss`:

```scss
.fitness-chart {
  .race-chart__history-overlay {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    padding: 4px 12px;
    background: rgba(220, 38, 38, 0.85);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    border-radius: 999px;
    pointer-events: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  }

  &.fitness-chart--history-mode {
    // Hook left in place for future extension (no-op now).
  }
}
```

- [ ] **Step 6: Verify no regression**

```bash
cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/FitnessChart-historyMode.test.mjs
```

Expected: still green.

- [ ] **Step 7: Manual smoke — confirm History Mode persists indefinitely**

With a live session running, unplug all HR devices. Wait ~60s for `endSession('empty_roster')`. Confirm:
1. Chart stays on screen with final paths/avatars.
2. "Session Ended" pill top-center.
3. Wait 5+ minutes — chart still shows.
4. Navigate away (back button from Task 4) clears it.

- [ ] **Step 8: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx \
        frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.scss
git commit -m "feat(fitness): freeze chart snapshot in History Mode when session ends"
```

---

## Task 3: Chart back button helper + component + unit test (RED → GREEN)

**Files:**
- Create: `frontend/src/modules/Fitness/player/FitnessChartBackButton.jsx`
- Create: `frontend/src/modules/Fitness/player/FitnessChartBackButton.js` (pure helper, jsx-free for node-env Jest)
- Create: `tests/unit/fitness/FitnessChartBackButton.test.mjs`

- [ ] **Step 1: Write failing helper tests**

Create `tests/unit/fitness/FitnessChartBackButton.test.mjs`:

```js
import { describe, it, expect, beforeAll } from '@jest/globals';

let resolveBackButtonLabel;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/player/FitnessChartBackButton.js');
  resolveBackButtonLabel = mod.resolveBackButtonLabel;
});

describe('resolveBackButtonLabel', () => {
  it('returns default label when session is live', () => {
    expect(resolveBackButtonLabel({ historyMode: false })).toEqual({
      label: 'Return Home',
      title: 'Return Home',
      ariaLabel: 'Return Home',
    });
  });

  it('returns history-variant label when session has ended', () => {
    expect(resolveBackButtonLabel({ historyMode: true })).toEqual({
      label: 'Back to Home',
      title: 'Back to Home',
      ariaLabel: 'Back to Home (session ended)',
    });
  });

  it('defaults to live-session label when state is missing', () => {
    expect(resolveBackButtonLabel(undefined)).toEqual({
      label: 'Return Home',
      title: 'Return Home',
      ariaLabel: 'Return Home',
    });
    expect(resolveBackButtonLabel({})).toEqual({
      label: 'Return Home',
      title: 'Return Home',
      ariaLabel: 'Return Home',
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found)

```bash
cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/FitnessChartBackButton.test.mjs
```

- [ ] **Step 3: Create the pure helper file** (jsx-free, loads under node-env Jest)

Create `frontend/src/modules/Fitness/player/FitnessChartBackButton.js`:

```js
/**
 * resolveBackButtonLabel — pure label/a11y helper for FitnessChartBackButton.
 *
 * @param {{ historyMode?: boolean }} [state]
 * @returns {{ label: string, title: string, ariaLabel: string }}
 */
export function resolveBackButtonLabel(state) {
  const historyMode = !!(state && state.historyMode);
  if (historyMode) {
    return {
      label: 'Back to Home',
      title: 'Back to Home',
      ariaLabel: 'Back to Home (session ended)',
    };
  }
  return {
    label: 'Return Home',
    title: 'Return Home',
    ariaLabel: 'Return Home',
  };
}
```

- [ ] **Step 4: Create the JSX component**

Create `frontend/src/modules/Fitness/player/FitnessChartBackButton.jsx`:

```jsx
import React from 'react';
import { resolveBackButtonLabel } from './FitnessChartBackButton.js';

export { resolveBackButtonLabel };

/**
 * FitnessChartBackButton — small presentational button rendered in the
 * .fitness-chart-overlay wrapper (NOT inside FitnessChart).
 */
export default function FitnessChartBackButton({ onReturn, historyMode = false }) {
  const { label, title, ariaLabel } = resolveBackButtonLabel({ historyMode });
  return (
    <button
      type="button"
      className="fitness-chart-back-button"
      onClick={onReturn}
      title={title}
      aria-label={ariaLabel}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      <span className="fitness-chart-back-button__label">{label}</span>
    </button>
  );
}
```

- [ ] **Step 5: Re-run tests — expect PASS** (3 tests green)

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/player/FitnessChartBackButton.jsx \
        frontend/src/modules/Fitness/player/FitnessChartBackButton.js \
        tests/unit/fitness/FitnessChartBackButton.test.mjs
git commit -m "feat(fitness): add FitnessChartBackButton component + label helper"
```

---

## Task 4: Render the back button from FitnessPlayer

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx`
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.scss`

- [ ] **Step 1: Import the button** — add to the imports cluster:

```jsx
import FitnessChartBackButton from './FitnessChartBackButton.jsx';
```

- [ ] **Step 2: Render the button inside `.fitness-chart-overlay`** — replace lines 1556-1560:

```jsx
      {showChart && govStatus !== 'locked' && govStatus !== 'pending' && (
        <div className="fitness-chart-overlay">
          <FitnessChartBackButton onReturn={() => setShowChart(false)} />
          <FitnessChart mode="sidebar" onClose={() => {}} />
        </div>
      )}
```

The button is a sibling of `<FitnessChart/>`, not a child — it overlays the wrapper, not the chart SVG.

- [ ] **Step 3: Add button styles** — find `.fitness-chart-overlay` block in `FitnessPlayer.scss` (line ~1663) and append inside:

```scss
  .fitness-chart-back-button {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 20;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px 4px 8px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    pointer-events: auto;
    transition: background 120ms ease, border-color 120ms ease;

    &:hover, &:focus-visible {
      background: rgba(0, 0, 0, 0.85);
      border-color: rgba(255, 255, 255, 0.42);
      outline: none;
    }

    &:active {
      transform: translateY(1px);
    }

    .fitness-chart-back-button__label {
      white-space: nowrap;
    }
  }
```

- [ ] **Step 4: Confirm helper tests still pass**

```bash
cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/FitnessChartBackButton.test.mjs tests/unit/fitness/FitnessChart-historyMode.test.mjs
```

Expected: 10 tests green.

- [ ] **Step 5: Manual smoke**

1. Start a fitness session. Confirm "Return Home" pill at top-left of chart overlay (small pill with chevron).
2. Pill is NOT over chart x-axis (bottom) nor LOG/LIN scale toggle (top-right).
3. Click pill — chart overlay disappears entirely. Video continues.
4. Re-open chart via sidebar control — pill re-appears.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/player/FitnessPlayer.jsx \
        frontend/src/modules/Fitness/player/FitnessPlayer.scss
git commit -m "feat(fitness): render FitnessChartBackButton in chart overlay wrapper"
```

---

## Task 5: Cross-feature regression sweep

- [ ] **Step 1: Run all new Fitness unit tests**

```bash
cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/
```

Expected: green.

- [ ] **Step 2: Manual end-to-end of both bug-bash scenarios**

Scenario C (empty roster → History Mode): Start session, accumulate paths, unplug all devices, wait 60s. Expect chart stays + "SESSION ENDED" pill. Wait 5+ min — still there. Click Return Home — chart collapses.

Scenario F4 (back button): During active session, click "Return Home" pill. Chart overlay disappears. Re-open via sidebar — pill returns.

---

## Done

- **History Mode:** New helper `computeHistorySnapshotAction`. FitnessChart freezes snapshot on `sessionId -> null` and shows "Session Ended" pill. Live-session swaps still clear (no memory leak regression).
- **Back button:** New `FitnessChartBackButton` component + pure helper. Rendered inside `.fitness-chart-overlay` by FitnessPlayer; wired to `setShowChart(false)`.
- **No changes** to `FitnessSession.js`, empty-roster timeout, or `FitnessChart.onClose` prop.
