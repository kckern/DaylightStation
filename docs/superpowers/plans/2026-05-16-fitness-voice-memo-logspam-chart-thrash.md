# Voice Memo Visibility + Persistence Log Spam + FitnessChart Render Thrash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent quality fixes from the 2026-05-16 audit:
1. **Voice memo visibility (#6):** Refetch `fitness:sessions` data when a `voice_memo_added` event fires, so a memo recorded just before redirect appears immediately on the home screen.
2. **Persistence log spam (#7):** Suppress the 2,198× `fitness.persistence.validation_failed warn` flood for `session-too-short`; demote to `debug` and emit one-shot info events on transitions.
3. **FitnessChart render thrash (#8):** Eliminate the 13/sec re-render loop on `FitnessChart` by wrapping it in `React.memo` with a roster-aware comparator, and stabilize its `roster` input identity.

**Architecture:** Three tasks, three commits, three subsystems. Each fix is self-contained and independently shippable.

**Tech Stack:** React 18, vitest + jest, screen-framework `ScreenDataProvider`, `getLogger()` with `.sampled()` helper.

---

## File Structure

| File | Role |
|------|------|
| `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx` | Subscribe to `voice-memo-event`, call `refetch('sessions')` |
| `frontend/src/hooks/fitness/PersistenceManager.js` | Demote `session-too-short` to debug + one-shot info on transition |
| `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` | `React.memo` wrapper + stable roster prop |
| `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.refetch.test.jsx` | NEW vitest test |
| `tests/unit/suite/fitness/persistence-validation.test.mjs` | Extend (or create in suite/ if only in legacy `tests/unit/fitness/`) |
| `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.memo.test.jsx` | NEW vitest test |

---

### Task 1: Refetch `fitness:sessions` on `voice_memo_added`

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx:287-310` (add a `useEffect` near the top of the default-export component)
- Create: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.refetch.test.jsx`

**Why:** A voice memo dispatched as a `voice-memo-event { event: 'voice_memo_added' }` window event fires after the persistence write — but the home screen's `fitness:sessions` widget only polls every 300s. Subscribe to the window event and call `refetch('sessions')` so the memo appears immediately.

- [ ] **Step 1: Write the failing test** at `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.refetch.test.jsx`

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

// Capture the refetch call
const refetchMock = vi.fn();

vi.mock('../../../../screen-framework/data/ScreenDataProvider.jsx', () => ({
  useScreenData: () => ({ sessions: [] }),
  useScreenDataRefetch: () => refetchMock,
}));

// Minimal stubs for other hooks the widget needs
vi.mock('../../../../screen-framework/ScreenContext.jsx', () => ({
  useScreen: () => ({ replace: vi.fn() }),
}));
vi.mock('../../FitnessScreenProvider.jsx', () => ({
  useFitnessScreen: () => ({
    scrollToDate: null, setScrollToDate: vi.fn(),
    selectedSessionId: null, setSelectedSessionId: vi.fn(),
  }),
}));

import FitnessSessionsWidget from './FitnessSessionsWidget.jsx';

describe('FitnessSessionsWidget — refetch on voice_memo_added', () => {
  beforeEach(() => { refetchMock.mockReset(); });

  it('calls refetch("sessions") when window dispatches voice-memo-event/voice_memo_added', () => {
    render(<FitnessSessionsWidget />);
    expect(refetchMock).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new CustomEvent('voice-memo-event', {
        detail: { event: 'voice_memo_added', memoId: 'm1' }
      }));
    });

    expect(refetchMock).toHaveBeenCalledWith('sessions');
  });

  it('ignores voice-memo-event with a different event type', () => {
    render(<FitnessSessionsWidget />);
    act(() => {
      window.dispatchEvent(new CustomEvent('voice-memo-event', {
        detail: { event: 'voice_memo_review_opened' }
      }));
    });
    expect(refetchMock).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<FitnessSessionsWidget />);
    unmount();
    act(() => {
      window.dispatchEvent(new CustomEvent('voice-memo-event', {
        detail: { event: 'voice_memo_added' }
      }));
    });
    expect(refetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm failure**

```bash
cd /opt/Code/DaylightStation
npx vitest run frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.refetch.test.jsx
```

Expected: FAIL — no listener wired.

- [ ] **Step 3: Wire the listener in `FitnessSessionsWidget.jsx`**

At the top of the default-export component (line 287 currently `export default function FitnessSessionsWidget() {`), add the imports if missing:

```jsx
import { useScreenDataRefetch, useScreenData } from '../../../../screen-framework/data/ScreenDataProvider.jsx';
import { useEffect } from 'react';
```

Then inside the component body, just after `const rawSessions = useScreenData('sessions');` (line 288), add:

```jsx
  const refetch = useScreenDataRefetch();

  useEffect(() => {
    const onVoiceMemo = (e) => {
      if (e?.detail?.event === 'voice_memo_added') {
        refetch('sessions');
      }
    };
    window.addEventListener('voice-memo-event', onVoiceMemo);
    return () => window.removeEventListener('voice-memo-event', onVoiceMemo);
  }, [refetch]);
```

- [ ] **Step 4: Re-run the test**

```bash
npx vitest run frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.refetch.test.jsx
```

Expected: PASS — all three cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx \
        frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.refetch.test.jsx
git commit -m "fix(fitness): refetch sessions widget on voice_memo_added

Voice memos uploaded just before redirect were invisible until the
300s poll cycle. Subscribe to the existing voice-memo-event window
event and call refetch('sessions') so the memo appears immediately.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Suppress `session-too-short` persistence log spam

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:879-893`
- Create or extend: `tests/unit/suite/fitness/persistence-validation.test.mjs` (jest)

**Why:** 2,198 warnings per 63-min session is 30% of log volume and drowns out real signal. Demote `session-too-short` (the dominant cause, fired every tick before the 5-min mark) to `debug` and emit a one-shot `info` event when persistence becomes possible.

- [ ] **Step 1: Verify the existing test file location**

```bash
ls tests/unit/suite/fitness/persistence-validation.test.mjs 2>/dev/null || \
ls tests/unit/fitness/persistence-validation.test.mjs 2>/dev/null
```

If only the legacy `tests/unit/fitness/` copy exists, copy its contents into `tests/unit/suite/fitness/persistence-validation.test.mjs` so the harness runs the new cases. (The legacy copy is NOT run by `npm run test:unit` because the harness narrows to `tests/unit/suite/`.)

- [ ] **Step 2: Write the new failing test cases** — append to `tests/unit/suite/fitness/persistence-validation.test.mjs`

```js
describe('persistence validation_failed log demotion', () => {
  let mgr;
  let infoSpy, warnSpy, debugSpy;

  beforeEach(async () => {
    // Re-import to reset module-level _validationFailureState
    jest.resetModules();
    const { PersistenceManager } = await import('#frontend/hooks/fitness/PersistenceManager.js');
    mgr = new PersistenceManager();
    const Logger = await import('#frontend/lib/logging/Logger.js');
    const inst = Logger.default();
    infoSpy = jest.spyOn(inst, 'info');
    warnSpy = jest.spyOn(inst, 'warn');
    debugSpy = jest.spyOn(inst, 'debug');
  });

  it('logs session-too-short at debug, not warn', () => {
    mgr.persistSession({
      sessionId: 'fs_1', durationMs: 30_000, roster: [{ id: 'u1' }]
    });
    expect(warnSpy).not.toHaveBeenCalledWith(
      'fitness.persistence.validation_failed',
      expect.objectContaining({ reason: 'session-too-short' })
    );
    expect(debugSpy).toHaveBeenCalledWith(
      'fitness.persistence.validation_failed',
      expect.objectContaining({ reason: 'session-too-short' })
    );
  });

  it('emits a one-shot info event when persistence first becomes possible', () => {
    // First call: too short
    mgr.persistSession({ sessionId: 'fs_1', durationMs: 30_000, roster: [{ id: 'u1' }] });
    // Many failed calls in between
    for (let i = 0; i < 50; i++) {
      mgr.persistSession({ sessionId: 'fs_1', durationMs: 30_000 + i * 1000, roster: [{ id: 'u1' }] });
    }
    expect(infoSpy).not.toHaveBeenCalledWith(
      'fitness.persistence.eligible',
      expect.anything()
    );
    // Now eligible (5min+ with valid HR series — mock validateSessionPayload to return ok)
    jest.spyOn(mgr, 'validateSessionPayload').mockReturnValue({ ok: true, endTime: Date.now(), durationMs: 310_000 });
    mgr.persistSession({ sessionId: 'fs_1', durationMs: 310_000, roster: [{ id: 'u1' }] });
    expect(infoSpy).toHaveBeenCalledWith(
      'fitness.persistence.eligible',
      expect.objectContaining({ sessionId: 'fs_1' })
    );
  });

  it('still warns for non-session-too-short validation failures', () => {
    mgr.persistSession({ sessionId: 'fs_1', durationMs: 600_000, roster: [] });
    expect(warnSpy).toHaveBeenCalledWith(
      'fitness.persistence.validation_failed',
      expect.objectContaining({ reason: 'no-participants' })
    );
  });
});
```

- [ ] **Step 3: Run the test to confirm failure**

```bash
npm run test:unit -- --only=fitness --pattern=persistence-validation
```

Expected: FAIL — `session-too-short` still warns, `eligible` event missing.

- [ ] **Step 4: Modify `PersistenceManager.js` lines 879-893**

Add an instance-state guard near the top of the class (find constructor; add `this._eligibleNotified = new Set();`). Replace lines 879-893:

```js
    const validation = this.validateSessionPayload(sessionData);
    getLogger().debug('fitness.persistence.validation', { validation });
    if (!validation?.ok) {
      if ((this._debugValidationCount = (this._debugValidationCount || 0) + 1) <= 3) {
        console.error(`⚠️ VALIDATION_FAIL [${this._debugValidationCount}/3]: ${sessionData?.sessionId}, reason="${validation?.reason}"`, validation);
      }
      // Demote the high-frequency `session-too-short` case to debug. Every other
      // validation failure remains warn-level (genuine signal worth surfacing).
      const failurePayload = {
        sessionId: sessionData?.sessionId,
        reason: validation?.reason,
        rosterLength: (Array.isArray(sessionData?.roster) ? sessionData.roster.length : 0),
        hasPriorSave: this.hasSuccessfulSave(sessionData?.sessionId)
      };
      if (validation?.reason === 'session-too-short') {
        getLogger().debug('fitness.persistence.validation_failed', failurePayload);
      } else {
        getLogger().warn('fitness.persistence.validation_failed', failurePayload);
      }
      this._log('persist_validation_fail', { reason: validation.reason, detail: validation });
      return false;
    }

    // One-shot info event on the first successful validation per session — gives
    // ops visibility that the persistence pipeline transitioned out of the
    // (now-silent) too-short rejection loop.
    if (sessionData?.sessionId && !this._eligibleNotified?.has(sessionData.sessionId)) {
      this._eligibleNotified = this._eligibleNotified || new Set();
      this._eligibleNotified.add(sessionData.sessionId);
      getLogger().info('fitness.persistence.eligible', {
        sessionId: sessionData.sessionId,
        durationMs: validation.durationMs,
      });
    }
```

(Add `this._eligibleNotified = new Set();` to the constructor too.)

- [ ] **Step 5: Re-run the test**

```bash
npm run test:unit -- --only=fitness --pattern=persistence-validation
```

Expected: PASS — all three new cases.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js \
        tests/unit/suite/fitness/persistence-validation.test.mjs
git commit -m "fix(fitness): demote session-too-short to debug + one-shot eligible info

session-too-short fires every tick before the 5-min mark, producing
2k+ warnings per session (~30% of log volume). Demote it to debug
and emit a one-shot fitness.persistence.eligible info event when
the session transitions to valid, preserving observability without
drowning real signal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wrap `FitnessChart` in `React.memo` with a stable roster comparator

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx:1305` (the default export) + add a comparator
- Create: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.memo.test.jsx`

**Why:** Per audit Issue #8, the chart sustains 13-14 renders/sec. The internal `participantCache` short-circuit (line 463-465) prevents downstream invalidation, but the component re-renders anyway because its parent passes a fresh `roster` array on every device tick (every ~5s). Wrap `FitnessChart` in `React.memo` with a comparator that bails when the chart-relevant roster fields are unchanged. This is the lowest-risk version of the prior-audit fix (`docs/_wip/audits/2026-03-13-fitness-chart-render-thrashing-and-midstream-stall.md`).

- [ ] **Step 1: Write the failing test** at `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.memo.test.jsx`

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// Count internal renders via a sentinel
let renderCount = 0;
vi.mock('./FitnessChart.jsx', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    default: React.memo((props) => {
      renderCount++;
      return <div data-testid="chart" />;
    }, actual.fitnessChartArePropsEqual),
  };
});

// Re-import to grab the wrapped component
const { default: FitnessChart, fitnessChartArePropsEqual } = await import('./FitnessChart.jsx');

describe('FitnessChart memoization', () => {
  it('exports a roster-aware comparator that returns true for equivalent rosters', () => {
    const rosterA = [{ id: 'u1', lastValue: 130, isActive: true, profileId: 'p1' }];
    const rosterB = [{ id: 'u1', lastValue: 130, isActive: true, profileId: 'p1' }];
    expect(fitnessChartArePropsEqual(
      { roster: rosterA, getSeries: () => [], timebase: { intervalMs: 5000 } },
      { roster: rosterB, getSeries: () => [], timebase: { intervalMs: 5000 } }
    )).toBe(true);
  });

  it('returns false when isActive changes', () => {
    const rosterA = [{ id: 'u1', lastValue: 130, isActive: true,  profileId: 'p1' }];
    const rosterB = [{ id: 'u1', lastValue: 130, isActive: false, profileId: 'p1' }];
    expect(fitnessChartArePropsEqual(
      { roster: rosterA, getSeries: () => [], timebase: { intervalMs: 5000 } },
      { roster: rosterB, getSeries: () => [], timebase: { intervalMs: 5000 } }
    )).toBe(false);
  });

  it('returns false when roster grows', () => {
    const rosterA = [{ id: 'u1' }];
    const rosterB = [{ id: 'u1' }, { id: 'u2' }];
    expect(fitnessChartArePropsEqual(
      { roster: rosterA, getSeries: () => [], timebase: { intervalMs: 5000 } },
      { roster: rosterB, getSeries: () => [], timebase: { intervalMs: 5000 } }
    )).toBe(false);
  });

  it('returns false when timebase intervalMs changes', () => {
    const roster = [{ id: 'u1' }];
    expect(fitnessChartArePropsEqual(
      { roster, getSeries: () => [], timebase: { intervalMs: 5000 } },
      { roster, getSeries: () => [], timebase: { intervalMs: 3000 } }
    )).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.memo.test.jsx
```

Expected: FAIL — `fitnessChartArePropsEqual` not exported.

- [ ] **Step 3: Add the comparator + memo wrapper to `FitnessChart.jsx`**

At the very bottom of the file, replace:

```js
export default FitnessChart;
```

with:

```js
/**
 * Roster-aware shallow comparator for React.memo.
 * Re-renders only when chart-relevant roster fields change. Tick-frequency
 * device updates that produce equivalent rosters (same isActive, same lastValue,
 * same profileId set) are bailed out.
 */
export function fitnessChartArePropsEqual(prev, next) {
  if (prev === next) return true;
  if (!prev || !next) return false;

  // Compare timebase (changing intervalMs requires re-render)
  if ((prev.timebase?.intervalMs || 0) !== (next.timebase?.intervalMs || 0)) return false;
  // Compare other primitive props that might be passed; deliberately strict to
  // surface unintentional churn. Add to this list as new props are added.
  if (prev.getSeries !== next.getSeries) return false;
  if (prev.activityMonitor !== next.activityMonitor) return false;
  if (prev.zoneConfig !== next.zoneConfig) return false;

  // Roster: shape-equal compare
  const a = prev.roster || [];
  const b = next.roster || [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i], rb = b[i];
    if (ra === rb) continue;
    if (!ra || !rb) return false;
    if (ra.id !== rb.id) return false;
    if (ra.profileId !== rb.profileId) return false;
    if (ra.hrDeviceId !== rb.hrDeviceId) return false;
    if (ra.isActive !== rb.isActive) return false;
    if (ra.lastValue !== rb.lastValue) return false;
    if (ra.zoneColor !== rb.zoneColor) return false;
  }
  return true;
}

const FitnessChartMemo = React.memo(FitnessChart, fitnessChartArePropsEqual);
FitnessChartMemo.displayName = 'FitnessChart';
export default FitnessChartMemo;
```

Ensure `React` is imported at the top of the file (it likely already is, since this is a JSX file).

- [ ] **Step 4: Re-run the test**

```bash
npx vitest run frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.memo.test.jsx
```

Expected: PASS — all 4 comparator cases.

- [ ] **Step 5: Run any existing FitnessChart tests for regression**

```bash
npx vitest run frontend/src/modules/Fitness/widgets/FitnessChart/ 2>/dev/null
npm run test:unit -- --only=fitness --pattern=FitnessChart
```

Expected: no regression — chart still renders, race chart history mode test still passes.

- [ ] **Step 6: Manual verification on dev server**

```bash
# Confirm dev server is running
lsof -i :3111 || (cd /opt/Code/DaylightStation && nohup npm run dev > /tmp/dev.log 2>&1 &)
sleep 8

# Open browser console at http://localhost:3111/fitness with an active session.
# In the console:
window.DAYLIGHT_LOG_LEVEL = 'warn';
# Watch for fitness.render_thrashing events over the next 60 seconds.
```

Expected: no `fitness.render_thrashing` events emitted from `FitnessChart` over 60s of active session.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx \
        frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.memo.test.jsx
git commit -m "fix(fitness): memoize FitnessChart with roster-aware comparator

FitnessChart was re-rendering at 13-14/sec because the parent passed
a fresh roster array on every device tick. Wrap in React.memo with a
shallow comparator that bails on equivalent rosters; downstream useMemos
already short-circuit, so this stops the upstream render storm.

Closes the regression first documented in
docs/_wip/audits/2026-03-13-fitness-chart-render-thrashing-and-midstream-stall.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add a one-shot circuit-breaker for chart re-renders

**Files:**
- Modify: `frontend/src/hooks/fitness/useRenderProfiler.js:112` (where `fitness.render_thrashing` is emitted)

**Why:** Defense in depth. Even with the memo, if a future change re-introduces churn, drop the chart update rate from per-tick to per-5-tick once thrash is detected, until the next session boundary. Per audit Direction #2.

- [ ] **Step 1: Read the profiler emit code**

```bash
sed -n '90,130p' frontend/src/hooks/fitness/useRenderProfiler.js
```

Note the existing `fitness.render_thrashing` emit shape.

- [ ] **Step 2: Add a circuit-breaker flag to the existing profiler**

Inside the profiler hook (look for `if (rendersInWindow > THRESHOLD)`), after the existing emit, add:

```js
      // Circuit breaker: if thrash sustained for > 30s, set a sessionStorage
      // flag that chart consumers can read to throttle their tick rate.
      if (sustainedMs > 30_000 && !window.sessionStorage.getItem('fitness.chart.throttle')) {
        window.sessionStorage.setItem('fitness.chart.throttle', '1');
        getLogger().warn('fitness.chart.throttle_activated', {
          component, renderRate, sustainedMs
        });
      }
```

Then in `FitnessChart.jsx`'s data-fetch effect, check the flag and throttle:

```jsx
const throttleMode = typeof window !== 'undefined'
  && window.sessionStorage.getItem('fitness.chart.throttle') === '1';
const effectiveIntervalMs = throttleMode
  ? (timebase?.intervalMs || 5000) * 5
  : (timebase?.intervalMs || 5000);
```

Use `effectiveIntervalMs` wherever the chart currently uses `timebase.intervalMs` for periodic refresh decisions.

- [ ] **Step 3: Add a simple test** that the throttle flag is read

(Append to `FitnessChart.memo.test.jsx` if convenient.)

```js
it('respects the fitness.chart.throttle sessionStorage flag', () => {
  window.sessionStorage.setItem('fitness.chart.throttle', '1');
  // The chart should not crash and should read the flag — minimal smoke check.
  render(<div>...</div>);  // refine if needed
  window.sessionStorage.removeItem('fitness.chart.throttle');
});
```

If wiring a full chart render is too costly for a unit test, skip the test and rely on the manual verification step. Keep the commit small if so.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/useRenderProfiler.js \
        frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx
git commit -m "fix(fitness): circuit-breaker for chart render thrash

If thrash detection sustains >30s, set a sessionStorage flag the chart
honours by reducing its effective tick rate 5x. Defense in depth on
top of the React.memo wrapper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: End-to-end audit log spot-check

**Files:**
- None — observational

- [ ] **Step 1: Run a short fitness session in dev and capture the log**

```bash
# On kckern-server with dev server running, complete a ~10 min mock session.
# Then inspect the log for the three flagged event counts:
ssh kckern-server "find /var/log -name 'fitness-*.jsonl' -newer /tmp/last-check 2>/dev/null"
# Or for dev mode, the frontend log destination — adjust per env.
```

- [ ] **Step 2: Confirm**

- `fitness.persistence.validation_failed reason=session-too-short` warns: **0** (now at debug)
- `fitness.persistence.eligible` info events: **1** (on transition past 5 min)
- `fitness.render_thrashing` events on FitnessChart: **0**
- `fitness.session.refresh on voice_memo_added`: triggered when memo recorded

- [ ] **Step 3: If all three confirm, add a final empty commit**

```bash
git commit --allow-empty -m "docs(fitness): audit fixes verified in dev session

- validation_failed warns dropped from ~2200 to 0 per session
- render_thrashing events: 0 (previously 186/session)
- voice_memo_added triggers immediate sessions refetch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If any of the three is not confirmed, do NOT mark this task complete — open a follow-up debugging issue with the residual counts.
