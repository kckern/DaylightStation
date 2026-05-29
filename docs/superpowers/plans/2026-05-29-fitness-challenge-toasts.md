# Fitness Challenge Toasts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an ephemeral `FitnessToast` when a governance challenge starts and a second one when it succeeds (no toast on failure; an instantly-satisfied challenge yields a single success toast).

**Architecture:** Two pure, unit-tested helpers in `frontend/src/modules/Fitness/player/overlays/` — `challengeToastTracker.js` (detects start/end transitions from the `governanceState.challenge` snapshot with per-id de-dup) and `buildChallengeToast.js` (maps an event + snapshot to a toast payload). They are wired into `FitnessContext.jsx` via a `useRef`-held tracker and a `useEffect` keyed on the challenge's `(id, status)`, calling the existing `pushFitnessToast`. `FitnessToast.jsx` already supports the `icon` prop, so no component change is needed.

**Tech Stack:** React, vitest, project structured logging framework (`getLogger`).

---

## Background — the challenge snapshot

`FitnessContext.jsx` already exposes the engine snapshot:

```js
const governanceState = session?.governanceEngine?.state || { status: 'idle' };
```

`governanceState.challenge` is built by `GovernanceEngine._buildChallengeSnapshot` and is either `null` or:

```js
{
  id,                 // string, stable per challenge instance
  status,             // 'pending' | 'success' | 'failed'
  zone, zoneLabel,    // e.g. zoneLabel: 'Active'
  requiredCount,      // number | null
  actualCount,        // number | null (populated from summary)
  metUsers, missingUsers,   // string[]
  remainingSeconds, totalSeconds, startedAt, expiresAt,
  selectionLabel,     // string | null
  paused              // boolean
}
```

Lifecycle: `null → {status:'pending'} → {status:'success'|'failed'} → null`. It is rebuilt every governance tick, so the effect must key on the primitives `(id, status)`, not object identity.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/modules/Fitness/player/overlays/challengeToastTracker.js` (new) | Pure transition detector: given prior tracker + current snapshot, return `{ event, tracker }`. Per-id de-dup; instant-success collapses to one `end`. |
| `frontend/src/modules/Fitness/player/overlays/challengeToastTracker.test.js` (new) | Unit tests for the detector. |
| `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.js` (new) | Pure: map `(event, snapshot)` → toast payload (`icon`, `title`, `subtitle`, `variant`). |
| `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js` (new) | Unit tests for copy + fallbacks. |
| `frontend/src/context/FitnessContext.jsx` (modify) | Add tracker ref + effect that calls `pushFitnessToast`. |

---

## Task 1: Challenge toast transition tracker

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/challengeToastTracker.js`
- Test: `frontend/src/modules/Fitness/player/overlays/challengeToastTracker.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/player/overlays/challengeToastTracker.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createChallengeToastTracker, nextChallengeToast } from './challengeToastTracker.js';

describe('nextChallengeToast', () => {
  it('emits "start" the first time a challenge is seen pending', () => {
    const t0 = createChallengeToastTracker();
    const r = nextChallengeToast(t0, { id: 'c1', status: 'pending' });
    expect(r.event).toBe('start');
  });

  it('emits "end" when a started challenge becomes success', () => {
    let t = createChallengeToastTracker();
    t = nextChallengeToast(t, { id: 'c1', status: 'pending' }).tracker;
    const r = nextChallengeToast(t, { id: 'c1', status: 'success' });
    expect(r.event).toBe('end');
  });

  it('emits only "end" for a challenge first seen already in success (instant case)', () => {
    const t0 = createChallengeToastTracker();
    const r1 = nextChallengeToast(t0, { id: 'c2', status: 'success' });
    expect(r1.event).toBe('end');
    // a stray later "pending" for the same id must NOT re-fire start
    const r2 = nextChallengeToast(r1.tracker, { id: 'c2', status: 'pending' });
    expect(r2.event).toBeNull();
  });

  it('emits nothing for failed or null snapshots', () => {
    let t = createChallengeToastTracker();
    t = nextChallengeToast(t, { id: 'c3', status: 'pending' }).tracker;
    expect(nextChallengeToast(t, { id: 'c3', status: 'failed' }).event).toBeNull();
    expect(nextChallengeToast(t, null).event).toBeNull();
    expect(nextChallengeToast(t, { status: 'pending' }).event).toBeNull(); // no id
  });

  it('does not re-emit start or end on repeated identical snapshots', () => {
    let t = createChallengeToastTracker();
    const a = nextChallengeToast(t, { id: 'c4', status: 'pending' });
    expect(a.event).toBe('start');
    const b = nextChallengeToast(a.tracker, { id: 'c4', status: 'pending' });
    expect(b.event).toBeNull();
    const c = nextChallengeToast(b.tracker, { id: 'c4', status: 'success' });
    expect(c.event).toBe('end');
    const d = nextChallengeToast(c.tracker, { id: 'c4', status: 'success' });
    expect(d.event).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/player/overlays/challengeToastTracker.test.js`
Expected: FAIL — "Failed to resolve import './challengeToastTracker.js'" / `nextChallengeToast is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/modules/Fitness/player/overlays/challengeToastTracker.js`:

```js
/**
 * Pure transition detector for challenge toasts. Given the prior tracker state and the
 * current governance challenge snapshot, decide whether to emit a 'start' or 'end' toast.
 *
 * Rules:
 * - 'start' fires the first time a given challenge id is seen with status 'pending'.
 * - 'end' fires the first time that id is seen with status 'success'.
 * - A challenge first seen already in 'success' (never observed pending) emits only 'end'
 *   — a single toast for the instant-satisfaction case.
 * - 'failed' and null snapshots emit nothing.
 * - Each event fires at most once per challenge id (de-dup across the engine's many ticks).
 *
 * Pure: never mutates the input tracker; returns the next tracker to store.
 */

export function createChallengeToastTracker() {
  return { startedIds: new Set(), endedIds: new Set() };
}

export function nextChallengeToast(tracker, challenge) {
  const t = tracker || createChallengeToastTracker();
  const id = challenge && challenge.id;
  if (!id) return { event: null, tracker: t };

  const { status } = challenge;

  if (status === 'pending' && !t.startedIds.has(id)) {
    const startedIds = new Set(t.startedIds);
    startedIds.add(id);
    return { event: 'start', tracker: { startedIds, endedIds: t.endedIds } };
  }

  if (status === 'success' && !t.endedIds.has(id)) {
    const startedIds = new Set(t.startedIds);
    startedIds.add(id); // mark started too, so a stray later 'pending' can't re-fire start
    const endedIds = new Set(t.endedIds);
    endedIds.add(id);
    return { event: 'end', tracker: { startedIds, endedIds } };
  }

  return { event: null, tracker: t };
}

export default nextChallengeToast;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/player/overlays/challengeToastTracker.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/challengeToastTracker.js \
        frontend/src/modules/Fitness/player/overlays/challengeToastTracker.test.js
git commit -m "feat(fitness): challenge toast transition tracker"
```

---

## Task 2: Challenge toast builder

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.js`
- Test: `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildChallengeToast } from './buildChallengeToast.js';

describe('buildChallengeToast', () => {
  it('builds a start toast with rider count and zone', () => {
    const toast = buildChallengeToast('start', { zoneLabel: 'Active', requiredCount: 3 });
    expect(toast).toEqual({
      icon: '🏆',
      title: 'Challenge started',
      subtitle: 'Get 3 riders to Active',
      variant: 'info',
    });
  });

  it('builds a success toast with actual/required counts and zone', () => {
    const toast = buildChallengeToast('end', { zoneLabel: 'Active', requiredCount: 3, actualCount: 3 });
    expect(toast).toEqual({
      icon: '🏆',
      title: 'Challenge complete!',
      subtitle: '3 of 3 riders reached Active',
      variant: 'success',
    });
  });

  it('uses singular "rider" when requiredCount is 1', () => {
    expect(buildChallengeToast('start', { zoneLabel: 'Hot', requiredCount: 1 }).subtitle)
      .toBe('Get 1 rider to Hot');
    expect(buildChallengeToast('end', { zoneLabel: 'Hot', requiredCount: 1, actualCount: 1 }).subtitle)
      .toBe('1 of 1 rider reached Hot');
  });

  it('falls back to selectionLabel when zoneLabel is absent', () => {
    expect(buildChallengeToast('start', { selectionLabel: 'Sprint', requiredCount: 2 }).subtitle)
      .toBe('Get 2 riders to Sprint');
  });

  it('degrades to no subtitle when counts/zone are missing', () => {
    const start = buildChallengeToast('start', {});
    expect(start.title).toBe('Challenge started');
    expect(start.subtitle).toBeUndefined();
    const end = buildChallengeToast('end', {});
    expect(end.title).toBe('Challenge complete!');
    expect(end.subtitle).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js`
Expected: FAIL — import cannot be resolved / `buildChallengeToast is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.js`:

```js
/**
 * Map a challenge toast event + governance challenge snapshot to a FitnessToast payload.
 * Pure. Group event (no single rider) → no avatar, uses the 🏆 icon slot.
 *
 * @param {'start'|'end'} event
 * @param {Object} challenge - governanceState.challenge snapshot
 * @returns {{ icon: string, title: string, subtitle?: string, variant: string }}
 */
export function buildChallengeToast(event, challenge) {
  const c = challenge || {};
  const zoneLabel = c.zoneLabel || c.selectionLabel || null;
  const requiredCount = Number.isFinite(c.requiredCount) ? c.requiredCount : null;
  const actualCount = Number.isFinite(c.actualCount) ? c.actualCount : null;
  const riderWord = (n) => (n === 1 ? 'rider' : 'riders');

  if (event === 'start') {
    const subtitle = (requiredCount != null && zoneLabel)
      ? `Get ${requiredCount} ${riderWord(requiredCount)} to ${zoneLabel}`
      : undefined;
    return { icon: '🏆', title: 'Challenge started', subtitle, variant: 'info' };
  }

  // event === 'end' (success)
  const subtitle = (actualCount != null && requiredCount != null && zoneLabel)
    ? `${actualCount} of ${requiredCount} ${riderWord(requiredCount)} reached ${zoneLabel}`
    : undefined;
  return { icon: '🏆', title: 'Challenge complete!', subtitle, variant: 'success' };
}

export default buildChallengeToast;
```

Note: returning `subtitle: undefined` is intentional — `FitnessToast` only renders the subtitle line when truthy (`FitnessToast.jsx:64`), and the tests assert `toBeUndefined()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/buildChallengeToast.js \
        frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js
git commit -m "feat(fitness): challenge toast payload builder"
```

---

## Task 3: Wire challenge toasts into FitnessContext

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx` (imports near line 19; tracker ref + effect after the governance-state line ~2208)

- [ ] **Step 1: Add the helper imports**

In `frontend/src/context/FitnessContext.jsx`, the existing toast imports are:

```js
import { normalizeToast, dismissMatches } from '../modules/Fitness/player/overlays/fitnessToastSlot.js';
import { buildRiderToast } from '../modules/Fitness/player/overlays/buildRiderToast.js';
```

Add these two lines immediately below them:

```js
import { createChallengeToastTracker, nextChallengeToast } from '../modules/Fitness/player/overlays/challengeToastTracker.js';
import { buildChallengeToast } from '../modules/Fitness/player/overlays/buildChallengeToast.js';
```

- [ ] **Step 2: Add the tracker ref and the toast effect**

Find this existing block (around line 2207-2209):

```js
  // Governance State from Engine
  const governanceState = session?.governanceEngine?.state || { status: 'idle' };
  const governanceChallenge = session?.governanceEngine?.challengeState || {};
```

Immediately AFTER the `governanceChallenge` line, insert:

```js

  // Challenge start/success toasts. View-agnostic (mirrors the rider_select toast): the
  // toast is mounted at the FitnessApp root, so its trigger lives here in context rather
  // than in a player-only overlay. Keyed on the snapshot's (id, status) primitives —
  // governanceState.challenge is rebuilt every tick, so object identity can't be a dep.
  const challengeToastTrackerRef = useRef(createChallengeToastTracker());
  const govChallenge = governanceState.challenge || null;
  const govChallengeId = govChallenge?.id || null;
  const govChallengeStatus = govChallenge?.status || null;
  useEffect(() => {
    const { event, tracker } = nextChallengeToast(challengeToastTrackerRef.current, govChallenge);
    challengeToastTrackerRef.current = tracker;
    if (event) {
      pushFitnessToast(buildChallengeToast(event, govChallenge));
      getLogger().info('fitness.challenge.toast', {
        event,
        challengeId: govChallengeId,
        status: govChallengeStatus,
      });
    }
    // govChallenge is read fresh each run; only (id, status) transitions should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [govChallengeId, govChallengeStatus]);
```

(`useRef` and `useEffect` are already imported in this file; `pushFitnessToast` is defined at ~line 1209 and `getLogger` is imported at line 13.)

- [ ] **Step 3: Verify the existing FitnessContext tests still pass**

Run: `npx vitest run frontend/src/context`
Expected: PASS — no regressions in existing FitnessContext suites. (If there is no `frontend/src/context` test dir, run `npx vitest run frontend/src/modules/Fitness/player/overlays` to confirm the helper suites are green; the wiring is exercised manually in Step 4.)

- [ ] **Step 4: Manual sanity check (dev server)**

The full path requires a live governance challenge, so verify the wiring compiles and the helpers behave via the unit suites, then confirm in the running app:

Run: `npx vitest run frontend/src/modules/Fitness/player/overlays`
Expected: PASS (tracker + builder + existing toast suites).

Then, with the dev server running, trigger a challenge (or use `triggerChallengeNow`) and confirm in the browser:
- a 🏆 "Challenge started" toast appears when the challenge goes active, and
- a "Challenge complete!" toast appears on success,
- with `fitness.challenge.toast` events visible in the logs (`window.DAYLIGHT_LOG_LEVEL = 'debug'`).

Expected log lines: `fitness.challenge.toast { event: 'start', ... }` then `{ event: 'end', ... }`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "feat(fitness): emit start/success challenge toasts from FitnessContext"
```

---

## Self-Review Notes

- **Spec coverage:** start toast (Task 3 + builder `start`), success-only end toast (builder `end`, tracker ignores `failed`), instant-success → single toast (tracker test 3), rider/count copy (builder tests), logging (Task 3 Step 2), no `FitnessToast` change (icon prop pre-exists). All spec sections map to a task.
- **Type consistency:** `nextChallengeToast(tracker, challenge) → { event, tracker }` and `createChallengeToastTracker()` are used identically in Task 1 and Task 3. `buildChallengeToast(event, challenge)` signature matches across Task 2 and Task 3. Toast payload keys (`icon`, `title`, `subtitle`, `variant`) match `FitnessToast` propTypes (`FitnessToast.jsx:79-89`).
- **No placeholders:** every code step contains full content.
