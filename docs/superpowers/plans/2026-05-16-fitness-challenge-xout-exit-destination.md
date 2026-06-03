# Challenge Feasibility + X-out Telemetry + Exit Destination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent governance/UX fixes from the 2026-05-16 audit:
1. **Challenge feasibility (#3):** Stop the hot-zone "downgrade-to-warm" cascade when no participant is within striking distance of hot. The 20-BPM threshold should be the primary gate; skip rather than downgrade when 0/N participants are close.
2. **X-out telemetry + executeClose dedup (#4):** Add `fitness.player.close.initiated` and `fitness.player.close.completed` events. Dedup `executeClose()` so the voice-memo onComplete callback + the useEffect transition handler don't both fire it.
3. **Exit destination (#5):** Redirect post-session to `/fitness/home` with the just-ended session pre-selected in the `fitness:sessions` widget, rather than the current full-screen chart view.

**Architecture:** Each fix is self-contained. The challenge fix tightens an existing predicate. The X-out fix adds two log lines and a one-line guard. The exit-destination fix changes the redirect payload shape and the navigation handler.

**Tech Stack:** React 18, React Router, vitest + jest, `getLogger()`.

---

## File Structure

| File | Role |
|------|------|
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Modify `_checkChallengeFeasibility` (~L335-388) — skip when 0 achievable |
| `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` | Add telemetry + dedup guard in `executeClose` and `handleClose` |
| `frontend/src/modules/Fitness/player/postEpisodeRedirect.js` | Change return shape: `{view:'screen', screenId:'home', sessionId}` |
| `frontend/src/Apps/FitnessApp.jsx` | Update `onSessionEndRedirect` handler + pass `sessionId` to FitnessScreenProvider |
| `frontend/src/modules/Fitness/FitnessScreenProvider.jsx` | Accept initial `selectedSessionId` from URL param or redirect |
| `tests/unit/suite/fitness/postEpisodeRedirect.test.mjs` | Extend (or copy from `tests/unit/fitness/`) |
| `tests/unit/suite/governance/GovernanceEngine-feasibility.test.mjs` | NEW jest test |
| `tests/unit/suite/fitness/FitnessPlayer-closeDedup.test.mjs` | NEW jest test |

---

### Task 1: Tighten `_checkChallengeFeasibility` to skip (not downgrade) when 0 participants close

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:335-388`
- Create: `tests/unit/suite/governance/GovernanceEngine-feasibility.test.mjs`

**Why:** Audit shows 6× `governance.challenge.zone_downgraded` (hot→warm) per session but only 1× `governance.challenge.skipped_infeasible`. The recursive downgrade fires whenever `achievableCount < requiredCount`, even when `achievableCount === 0`. The fix: when 0 participants are within 20 BPM of the original target, return `{feasible: false}` without `suggestedZone` — i.e., skip. Keep the downgrade behavior when `0 < achievableCount < requiredCount`.

- [ ] **Step 1: Read the existing GovernanceEngine test setup**

```bash
head -40 tests/unit/governance/GovernanceEngine-clockInjection.test.mjs
ls tests/unit/suite/governance/ 2>/dev/null
```

If no `tests/unit/suite/governance/` directory exists, create it (the harness path is `tests/unit/suite/`).

- [ ] **Step 2: Write the failing test** at `tests/unit/suite/governance/GovernanceEngine-feasibility.test.mjs`

```js
// tests/unit/suite/governance/GovernanceEngine-feasibility.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

function makeEngine({ profiles }) {
  const engine = new GovernanceEngine();
  engine.session = {
    getParticipantProfile: (pid) => profiles[pid],
  };
  return engine;
}

const ZONES = [
  { id: 'cool',   min: 80 },
  { id: 'active', min: 120 },
  { id: 'warm',   min: 140 },
  { id: 'hot',    min: 160 },
  { id: 'fire',   min: 175 },
];

describe('_checkChallengeFeasibility', () => {
  it('skips (no suggestedZone) when 0 participants are within 20 BPM of hot', () => {
    // All 3 participants at hr=110, hot.min=160 → margin 50 BPM, well over 20.
    const profiles = {
      u1: { heartRate: 110, zoneConfig: ZONES },
      u2: { heartRate: 105, zoneConfig: ZONES },
      u3: { heartRate: 100, zoneConfig: ZONES },
    };
    const engine = makeEngine({ profiles });
    const r = engine._checkChallengeFeasibility('hot', 'all', ['u1', 'u2', 'u3']);
    expect(r.feasible).toBe(false);
    expect(r.suggestedZone).toBeUndefined();          // skip, do NOT downgrade
    expect(r.reason).toMatch(/within 20 BPM/);
  });

  it('downgrades when 1+ participant IS within 20 BPM of hot but not enough', () => {
    // u1 at hr=145 (within 15 of hot), u2/u3 cool. Required all-3.
    const profiles = {
      u1: { heartRate: 145, zoneConfig: ZONES },
      u2: { heartRate: 100, zoneConfig: ZONES },
      u3: { heartRate: 105, zoneConfig: ZONES },
    };
    const engine = makeEngine({ profiles });
    const r = engine._checkChallengeFeasibility('hot', 'all', ['u1', 'u2', 'u3']);
    expect(r.feasible).toBe(false);
    expect(r.suggestedZone).toBe('warm');           // downgrade allowed when SOME are close
  });

  it('returns feasible when all participants are within 20 BPM of the target', () => {
    const profiles = {
      u1: { heartRate: 145, zoneConfig: ZONES },    // within 15 of hot
      u2: { heartRate: 150, zoneConfig: ZONES },
      u3: { heartRate: 155, zoneConfig: ZONES },
    };
    const engine = makeEngine({ profiles });
    const r = engine._checkChallengeFeasibility('hot', 'all', ['u1', 'u2', 'u3']);
    expect(r.feasible).toBe(true);
  });

  it('skips when 0 are achievable even when a lower zone WOULD be feasible (regression)', () => {
    // All in cool. Hot requires hr≥160. None within 20 of hot.
    // BUT all 3 are within 20 of warm (warm.min=140, hr=100→margin 40, not 20).
    // Actually all 3 at hr=100, warm.min=140 → 40 BPM margin, NOT within 20.
    // So warm should also be skip. active.min=120, margin=20 → boundary, achievable.
    // Test: with cool participants, hot challenge should skip, not downgrade.
    const profiles = {
      u1: { heartRate: 95, zoneConfig: ZONES },
      u2: { heartRate: 90, zoneConfig: ZONES },
      u3: { heartRate: 92, zoneConfig: ZONES },
    };
    const engine = makeEngine({ profiles });
    const r = engine._checkChallengeFeasibility('hot', 'all', ['u1', 'u2', 'u3']);
    expect(r.feasible).toBe(false);
    expect(r.suggestedZone).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to confirm failure**

```bash
cd /opt/Code/DaylightStation
npm run test:unit -- --only=governance --pattern=feasibility
```

Expected: tests 1 and 4 FAIL (current code downgrades whenever achievableCount < requiredCount, regardless of whether achievableCount is 0).

- [ ] **Step 4: Modify `_checkChallengeFeasibility`** at `frontend/src/hooks/fitness/GovernanceEngine.js:373-386`

Replace the downgrade block:

```js
    const requiredCount = this._normalizeRequiredCount(rule, activeParticipants.length, activeParticipants);
    if (achievableCount < requiredCount) {
      // Try downgrading: hot → warm → active
      const zoneDowngrades = ['fire', 'hot', 'warm', 'active'];
      const targetIdx = zoneDowngrades.indexOf(normalizeZoneId(targetZone));
      if (targetIdx >= 0 && targetIdx < zoneDowngrades.length - 1) {
        const downgrade = zoneDowngrades[targetIdx + 1];
        const downResult = this._checkChallengeFeasibility(downgrade, rule, activeParticipants);
        if (downResult.feasible) {
          return { feasible: false, suggestedZone: downgrade, reason: `${targetZone} not achievable, downgraded to ${downgrade}` };
        }
      }
      return { feasible: false, reason: `Only ${achievableCount}/${requiredCount} within ${FEASIBILITY_MARGIN_BPM} BPM of ${targetZone}` };
    }
    return { feasible: true };
```

with:

```js
    const requiredCount = this._normalizeRequiredCount(rule, activeParticipants.length, activeParticipants);
    if (achievableCount < requiredCount) {
      // Tightened gate (2026-05-16 audit): if 0 participants are within
      // FEASIBILITY_MARGIN_BPM of the original target, skip rather than
      // downgrade. Downgrading from hot→warm when nobody was even close to hot
      // produced surprise "warm challenges" the group then had to satisfy.
      // Only downgrade when at least one participant is within striking distance.
      if (achievableCount === 0) {
        return {
          feasible: false,
          reason: `Only 0/${requiredCount} within ${FEASIBILITY_MARGIN_BPM} BPM of ${targetZone}`,
        };
      }
      // Try downgrading: hot → warm → active
      const zoneDowngrades = ['fire', 'hot', 'warm', 'active'];
      const targetIdx = zoneDowngrades.indexOf(normalizeZoneId(targetZone));
      if (targetIdx >= 0 && targetIdx < zoneDowngrades.length - 1) {
        const downgrade = zoneDowngrades[targetIdx + 1];
        const downResult = this._checkChallengeFeasibility(downgrade, rule, activeParticipants);
        if (downResult.feasible) {
          return { feasible: false, suggestedZone: downgrade, reason: `${targetZone} not achievable, downgraded to ${downgrade}` };
        }
      }
      return { feasible: false, reason: `Only ${achievableCount}/${requiredCount} within ${FEASIBILITY_MARGIN_BPM} BPM of ${targetZone}` };
    }
    return { feasible: true };
```

- [ ] **Step 5: Re-run the test**

```bash
npm run test:unit -- --only=governance --pattern=feasibility
```

Expected: all four cases PASS.

- [ ] **Step 6: Run the broader governance suite for regression**

```bash
npm run test:unit -- --only=governance
```

Expected: no new failures.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        tests/unit/suite/governance/GovernanceEngine-feasibility.test.mjs
git commit -m "fix(fitness): skip (not downgrade) challenges with 0 close participants

zone_downgraded fired 6× per session in the 2026-05-16 audit when no
participant was within 20 BPM of the target. The recursive downgrade
treated every hot rejection as a warm challenge invitation. Now we
require at least 1 participant to be within striking distance before
proposing a downgrade; otherwise skip entirely.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add X-out telemetry + dedup `executeClose`

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx:903-984`
- Create: `tests/unit/suite/fitness/FitnessPlayer-closeDedup.test.mjs`

**Why:** Audit Issue #4 — user reports the X button sometimes triggers a page refresh. We have no telemetry to verify. AND `executeClose` can fire twice (once via the voice-memo `onComplete` callback at L961, once via the overlay-transition useEffect at L982), so two `onSessionEndRedirect` calls can race the React Router. Both issues addressed: add `initiated`/`completed` events; guard `executeClose` with an "already done" ref so the second call is a no-op.

- [ ] **Step 1: Write the failing test** at `tests/unit/suite/fitness/FitnessPlayer-closeDedup.test.mjs`

```js
// tests/unit/suite/fitness/FitnessPlayer-closeDedup.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Test the dedup helper in isolation: extract executeClose's guard into a
// pure helper so it can be unit-tested without rendering the full component.
// (We extract `makeCloseGuard()` in the implementation.)

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
}));

const { makeCloseGuard } = await import('#frontend/modules/Fitness/player/closeGuard.js');

describe('makeCloseGuard', () => {
  it('returns true on first acquire, false on subsequent', () => {
    const g = makeCloseGuard();
    expect(g.acquire()).toBe(true);
    expect(g.acquire()).toBe(false);
    expect(g.acquire()).toBe(false);
  });

  it('can be reset for a new close cycle', () => {
    const g = makeCloseGuard();
    expect(g.acquire()).toBe(true);
    g.reset();
    expect(g.acquire()).toBe(true);
  });

  it('preserves the sessionId of the acquiring caller', () => {
    const g = makeCloseGuard();
    expect(g.acquire('fs_1')).toBe(true);
    expect(g.heldFor()).toBe('fs_1');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm run test:unit -- --only=fitness --pattern=closeDedup
```

Expected: FAIL — `closeGuard.js` does not exist.

- [ ] **Step 3: Create the close-guard helper** at `frontend/src/modules/Fitness/player/closeGuard.js`

```js
/**
 * makeCloseGuard — single-shot acquire/release helper for the FitnessPlayer
 * close flow. Prevents `executeClose` from firing twice when both the
 * voice-memo onComplete callback AND the overlay-transition useEffect race
 * to invoke it after the same close gesture.
 *
 * @returns {{ acquire: (sessionId?: string) => boolean, reset: () => void, heldFor: () => string|null }}
 */
export function makeCloseGuard() {
  let held = false;
  let sessionId = null;
  return {
    acquire(sid) {
      if (held) return false;
      held = true;
      sessionId = sid ?? null;
      return true;
    },
    reset() {
      held = false;
      sessionId = null;
    },
    heldFor() {
      return sessionId;
    },
  };
}

export default makeCloseGuard;
```

- [ ] **Step 4: Re-run the guard test**

```bash
npm run test:unit -- --only=fitness --pattern=closeDedup
```

Expected: PASS.

- [ ] **Step 5: Integrate the guard + telemetry into `FitnessPlayer.jsx`**

At the top of the file, add imports near the other player imports:

```jsx
import { makeCloseGuard } from './closeGuard.js';
```

Inside the `FitnessPlayer` component, near the other refs (around line 155 where `pendingCloseRef` is declared), add:

```jsx
const closeGuardRef = useRef(makeCloseGuard());
```

Modify `executeClose` (line 903-927) to acquire the guard FIRST and emit telemetry:

```jsx
  const executeClose = useCallback(() => {
    const sid = fitnessSessionInstance?.sessionId ?? null;
    if (!closeGuardRef.current.acquire(sid)) {
      logger.debug('fitness.player.close.deduped', { sessionId: sid });
      return;
    }
    logger.info('fitness.player.close.initiated', { sessionId: sid });

    statusUpdateRef.current.endSent = true;
    postEpisodeStatus({ naturalEnd: false, reason: 'close' });

    const redirect = resolvePostEpisodeRedirect({
      hasActiveSession: Boolean(sid),
      sessionId: sid,
    });
    if (redirect && typeof onSessionEndRedirect === 'function') {
      try { onSessionEndRedirect(redirect); }
      catch (err) { logger.error('fitness.player.close.redirect_failed', { error: err?.message }); }
    }

    if (setQueue) setQueue([]);
    if (currentItem?.grandparentId && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('fitness-show-refresh', { detail: { showId: currentItem.grandparentId } }));
    }
    setCurrentItem(null);
    pendingCloseRef.current = false;

    logger.info('fitness.player.close.completed', { sessionId: sid });
  }, [postEpisodeStatus, setQueue, currentItem?.grandparentId, fitnessSessionInstance?.sessionId, onSessionEndRedirect, logger]);
```

In `handleClose` (line 929), add an `initiated` log at the top for visibility on the user's intent:

```jsx
const handleClose = () => {
  logger.info('fitness.player.close.requested', {
    sessionId: fitnessSessionInstance?.sessionId,
    voiceMemoOverlayOpen: Boolean(voiceMemoOverlayState?.open),
  });
  // ... existing voice-memo guard + 15-min check ...
};
```

The `useEffect` at line 972 stays as-is — the guard inside `executeClose` is what dedups, regardless of whether the call comes via `onComplete` or the effect.

- [ ] **Step 6: Make sure `resolvePostEpisodeRedirect` accepts a `sessionId` param**

(This wires into Task 3 below. For now, just pass it.)

- [ ] **Step 7: Run the player tests**

```bash
npm run test:unit -- --only=fitness --pattern=FitnessPlayer
```

Expected: no regressions in existing player tests.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Fitness/player/closeGuard.js \
        frontend/src/modules/Fitness/player/FitnessPlayer.jsx \
        tests/unit/suite/fitness/FitnessPlayer-closeDedup.test.mjs
git commit -m "feat(fitness): X-out close telemetry + dedup guard

Adds fitness.player.close.{requested,initiated,completed,deduped}
events so we can diagnose the user-reported 'X-out sometimes refreshes'
issue. Also adds a single-shot close guard so the voice-memo onComplete
callback + the overlay-transition useEffect can't both invoke
executeClose and cause two onSessionEndRedirect navigations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Change exit destination to `/fitness/home` with pre-selected session

**Files:**
- Modify: `frontend/src/modules/Fitness/player/postEpisodeRedirect.js`
- Modify: `frontend/src/Apps/FitnessApp.jsx:1349-1361` (the redirect handler)
- Modify: `frontend/src/modules/Fitness/FitnessScreenProvider.jsx` (accept initial sessionId)
- Modify: `tests/unit/suite/fitness/postEpisodeRedirect.test.mjs` (or copy from `tests/unit/fitness/`)

**Why:** Today, exit lands on `/fitness/users` (full-screen chart). User wants `/fitness/home` (chart + session history + coach + suggestions) with the just-ended session pre-selected in the `fitness:sessions` widget, which already supports `selectedSessionId`-based highlighting.

- [ ] **Step 1: Update the test FIRST** at `tests/unit/suite/fitness/postEpisodeRedirect.test.mjs`

If only `tests/unit/fitness/postEpisodeRedirect.test.mjs` exists (legacy path not in harness), copy it to `tests/unit/suite/fitness/postEpisodeRedirect.test.mjs` first.

Replace the current asserts with:

```js
import { describe, it, expect, beforeAll } from '@jest/globals';

let resolvePostEpisodeRedirect;
beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/player/postEpisodeRedirect.js');
  resolvePostEpisodeRedirect = mod.resolvePostEpisodeRedirect;
});

describe('resolvePostEpisodeRedirect', () => {
  it('routes to home screen with selected session when a sessionId is provided', () => {
    const r = resolvePostEpisodeRedirect({ hasActiveSession: true, sessionId: 'fs_123' });
    expect(r).toEqual({
      view: 'screen',
      screenId: 'home',
      sessionId: 'fs_123',
      clearActiveModule: true,
      clearActiveCollection: true,
      clearSelectedShow: true,
    });
  });

  it('returns null when no session is active', () => {
    expect(resolvePostEpisodeRedirect({ hasActiveSession: false })).toBeNull();
  });

  it('still routes to home when sessionId is missing (no highlight)', () => {
    const r = resolvePostEpisodeRedirect({ hasActiveSession: true });
    expect(r.view).toBe('screen');
    expect(r.screenId).toBe('home');
    expect(r.sessionId).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm run test:unit -- --only=fitness --pattern=postEpisodeRedirect
```

Expected: FAIL — current return shape is `{ view: 'users', ... }`.

- [ ] **Step 3: Rewrite `postEpisodeRedirect.js`**

Replace the file contents:

```js
/**
 * resolvePostEpisodeRedirect — pure helper deciding where the app should land
 * after a video OR voice memo completes.
 *
 * 2026-05-16: changed default to land on /fitness/home with the just-ended
 * session pre-selected in the fitness:sessions widget. The home screen surfaces
 * session history, suggestions, and the coach — better landing than the
 * full-screen chart at /fitness/users.
 *
 * @param {{ hasActiveSession?: any, sessionId?: string|null }} [input]
 * @returns {null | {
 *   view: 'screen', screenId: 'home', sessionId: string|null,
 *   clearActiveModule: true, clearActiveCollection: true, clearSelectedShow: true
 * }}
 */
export function resolvePostEpisodeRedirect(input) {
  if (!input || typeof input !== 'object') return null;
  if (!input.hasActiveSession) return null;
  return {
    view: 'screen',
    screenId: 'home',
    sessionId: input.sessionId ?? null,
    clearActiveModule: true,
    clearActiveCollection: true,
    clearSelectedShow: true,
  };
}

export default resolvePostEpisodeRedirect;
```

- [ ] **Step 4: Re-run the test**

```bash
npm run test:unit -- --only=fitness --pattern=postEpisodeRedirect
```

Expected: PASS — all three cases.

- [ ] **Step 5: Update the navigation handler** at `frontend/src/Apps/FitnessApp.jsx:1349-1361`

Replace with:

```jsx
                onSessionEndRedirect={(redirect) => {
                  if (!redirect) return;
                  if (redirect.clearActiveModule) setActiveModule(null);
                  if (redirect.clearActiveCollection) setActiveCollection(null);
                  if (redirect.clearSelectedShow) {
                    setSelectedShow(null);
                    setSelectedEpisodeId(null);
                  }
                  setCurrentView(redirect.view);
                  if (redirect.view === 'screen' && redirect.screenId) {
                    setActiveScreen(redirect.screenId);
                    // Pre-select the just-ended session in the home widget
                    if (redirect.sessionId) {
                      setPendingSelectedSessionId(redirect.sessionId);
                    }
                    navigate(`/fitness/${redirect.screenId}`, { replace: true });
                  } else if (redirect.view === 'users') {
                    // Backwards compat path — kept for any non-default consumer
                    navigate('/fitness/users', { replace: true });
                  }
                }}
```

- [ ] **Step 6: Add `pendingSelectedSessionId` state in `FitnessApp.jsx`**

Near the other top-level `useState` calls in the component (search for `const [activeScreen, setActiveScreen] = useState`), add:

```jsx
const [pendingSelectedSessionId, setPendingSelectedSessionId] = useState(null);
```

And pass it down to the `FitnessScreenProvider` (wherever that's mounted):

```jsx
<FitnessScreenProvider
  /* ...existing props */
  initialSelectedSessionId={pendingSelectedSessionId}
  onSelectedSessionConsumed={() => setPendingSelectedSessionId(null)}
>
```

- [ ] **Step 7: Update `FitnessScreenProvider.jsx`** to honor `initialSelectedSessionId`

Modify `frontend/src/modules/Fitness/FitnessScreenProvider.jsx`:

```jsx
export function FitnessScreenProvider({
  onPlay, onNavigate, onCtaAction,
  initialSelectedSessionId = null,
  onSelectedSessionConsumed,
  children
}) {
  const [scrollToDate, setScrollToDate] = useState(null);
  const [selectedSessionId, setSelectedSessionIdRaw] = useState(initialSelectedSessionId);
  const [longitudinalSelection, setLongitudinalSelection] = useState(null);
  const [lastPlayedContentId, setLastPlayedContentId] = useState(null);

  // When the initial value changes (e.g. post-session redirect), apply it.
  useEffect(() => {
    if (initialSelectedSessionId) {
      setSelectedSessionIdRaw(initialSelectedSessionId);
      onSelectedSessionConsumed?.();
    }
    // Only react to initialSelectedSessionId churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedSessionId]);

  const setSelectedSessionId = useCallback((id) => {
    setSelectedSessionIdRaw(id);
  }, []);

  const value = useMemo(() => ({
    onPlay, onNavigate, onCtaAction,
    scrollToDate, setScrollToDate,
    selectedSessionId, setSelectedSessionId,
    longitudinalSelection, setLongitudinalSelection,
    lastPlayedContentId, setLastPlayedContentId,
  }), [onPlay, onNavigate, onCtaAction, scrollToDate, selectedSessionId, setSelectedSessionId, longitudinalSelection, lastPlayedContentId]);

  return (
    <FitnessScreenContext.Provider value={value}>
      {children}
    </FitnessScreenContext.Provider>
  );
}
```

(Add `useEffect`, `useCallback` to the React imports if not already present.)

- [ ] **Step 8: Verify the widget already handles `selectedSessionId` highlight + auto-open**

```bash
grep -n 'selectedSessionId' frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx | head -10
```

Expected: existing code at L290 destructures `selectedSessionId, setSelectedSessionId` and L297-309 has `handleSessionClick`. The widget needs one more piece: when `selectedSessionId` becomes set via the new initial prop (not via user click), it should auto-open the session-detail pane via `replace('right-area', ...)`. Add a `useEffect` near the existing one in `FitnessSessionsWidget.jsx`:

```jsx
const initiallyOpenedRef = useRef(false);
useEffect(() => {
  if (!selectedSessionId) return;
  if (initiallyOpenedRef.current) return;
  if (loading) return;
  initiallyOpenedRef.current = true;
  // Auto-open detail pane for the externally-provided selection.
  revertRef.current = replace('right-area', {
    children: [{ widget: 'fitness:session-detail', props: { sessionId: selectedSessionId } }]
  });
  // Scroll to the row if it's rendered
  const row = containerRef.current?.querySelector(`[data-session-id="${selectedSessionId}"]`);
  if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
}, [selectedSessionId, loading, replace]);
```

(If the existing SessionsCard renders rows with a different data attribute, adjust the query selector. Verify by reading the SessionsCard component.)

- [ ] **Step 9: Run the screen widget test suite for regression**

```bash
npx vitest run frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/ 2>/dev/null
```

Expected: no regressions.

- [ ] **Step 10: Manual verification on dev server**

```bash
# Confirm dev server is running
lsof -i :3111 || (cd /opt/Code/DaylightStation && nohup npm run dev > /tmp/dev.log 2>&1 &)
sleep 8

# Open http://localhost:3111/fitness, complete a short mock session, press X.
# Expected: lands on /fitness/home with the just-ended session highlighted
# and the right-area showing the session-detail pane.
```

- [ ] **Step 11: Commit**

```bash
git add frontend/src/modules/Fitness/player/postEpisodeRedirect.js \
        frontend/src/Apps/FitnessApp.jsx \
        frontend/src/modules/Fitness/FitnessScreenProvider.jsx \
        frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx \
        tests/unit/suite/fitness/postEpisodeRedirect.test.mjs
git commit -m "feat(fitness): post-session redirect lands on home with selected session

Previously the X button (and natural episode-end) landed users on
/fitness/users (full-screen chart). Now lands on /fitness/home so
users get session history, coach, and suggestions, with the just-ended
session pre-selected and its detail pane auto-opened in the right area.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add a base-requirements UI audit pass

**Files:**
- Investigation only — `frontend/src/modules/Fitness/player/overlays/` and `GovernanceStateOverlay`

**Why:** Audit Direction #2 for Issue 3: confirm that `cycle.paused_by_base_req` events produce no user-visible UI freeze. If they do, that's a separate UX bug to file.

- [ ] **Step 1: Find the cycle-pause UI handler**

```bash
grep -rn 'paused_by_base_req\|base_req' frontend/src/modules/Fitness/ frontend/src/hooks/fitness/
```

Identify which UI components subscribe to that event or to a derived state.

- [ ] **Step 2: Trace what the user sees when the event fires**

For each handler found in Step 1, follow the code to the rendered output. Common cases:
- Overlay shown → user-visible freeze.
- State flag flipped, no overlay → invisible, safe.
- Audio cue only → audible but not a freeze.

- [ ] **Step 3: Write findings as an audit note**

Save to `docs/_wip/audits/2026-05-16-fitness-cycle-base-req-ux.md` with sections:
- Event source (where emitted)
- UI handlers (what subscribes)
- Visible effect (overlay? freeze? silent?)
- Verdict (matches user expectation YES/NO; if NO, file a follow-up)

- [ ] **Step 4: If verdict is "matches expectation," no commit needed**

If a UX bug IS surfaced, write a one-paragraph follow-up TODO at the bottom of the audit and stop. Do NOT fix in this plan — that's a separate scope-out decision.

- [ ] **Step 5: Optional commit**

If the audit doc was written:

```bash
git add docs/_wip/audits/2026-05-16-fitness-cycle-base-req-ux.md
git commit -m "docs(fitness): cycle base-requirements UX audit

Verdict: [pass/fail]. [One-line summary]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: End-to-end verification on dev server

**Files:**
- None — observational

- [ ] **Step 1: Run a short session that exercises all three fixes**

In dev: start a session, pedal to enter a zone, let governance try a challenge, press X to exit. Verify:
- No `governance.challenge.zone_downgraded` events when no participant is close to the original target.
- `fitness.player.close.initiated` followed by `fitness.player.close.completed` on X-out (no `deduped` log).
- Lands on `/fitness/home`, with the just-ended session pre-selected and its detail pane open.

- [ ] **Step 2: Capture the relevant log lines**

```bash
# After session ends:
grep -E 'governance.challenge|fitness.player.close|fitness.session.primary_selected' \
  /tmp/dev.log dev.log 2>/dev/null | tail -30
```

- [ ] **Step 3: If all three confirm, add a final empty commit**

```bash
git commit --allow-empty -m "docs(fitness): challenge + X-out + exit fixes verified in dev

- governance.challenge.zone_downgraded: 0 (down from 6/session)
- fitness.player.close.{initiated,completed}: paired (no dedup events)
- post-session redirect lands on /fitness/home with selected session

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If verification fails on any axis, do NOT mark this task complete. Open a focused follow-up issue with the observed deviation.
