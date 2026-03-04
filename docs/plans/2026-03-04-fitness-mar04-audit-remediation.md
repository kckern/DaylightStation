# Fitness Mar 04 Audit Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three user-reported bugs from the Mar 4 fitness session: video stall on seek, zone color lag, and chart visible behind governance lock overlay.

**Architecture:** Three independent bug fixes in the fitness player and zone profile system. Bug 1 adds a `seeking` guard to `pauseArbiter.js` + debounce on video pause/play toggles. Bug 2 exposes `displayZoneId` (raw, unhysteresized zone) from `ZoneProfileStore` for UI consumers. Bug 3 adds a governance-phase guard to the chart overlay render condition.

**Tech Stack:** React (JSX), Vitest (unit tests), existing pauseArbiter/ZoneProfileStore patterns

**Source audit:** `docs/_wip/audits/2026-03-04-fitness-session-mar04-audit.md`

---

## Task 1: Add `seeking` guard to pauseArbiter (Bug 1, Part A)

**Files:**
- Modify: `frontend/src/modules/Player/utils/pauseArbiter.js`
- Modify: `tests/isolated/domain/fitness/legacy/governance-video-pause.unit.test.mjs`

**Context:** `resolvePause()` is a pure function with priority: governance > resilience > user. During a seek, the video element buffers and governance challenge events fire state changes, triggering `resolvePause()` re-evaluation. This causes pause/play thrashing (10 cycles in 9s at the same currentTime). The fix: add a `seeking` bucket that suppresses all pause when active — the video must finish seeking before any system pauses it.

**Step 1: Write failing tests for seeking guard**

Add to `tests/isolated/domain/fitness/legacy/governance-video-pause.unit.test.mjs`:

```javascript
describe('Seeking suppresses pause', () => {

  test('seeking suppresses governance pause', () => {
    const result = resolvePause({
      seeking: { active: true },
      governance: { locked: true }
    });
    expect(result.paused).toBe(false);
    expect(result.reason).toBe(PAUSE_REASON.SEEKING);
  });

  test('seeking suppresses buffering pause', () => {
    const result = resolvePause({
      seeking: { active: true },
      resilience: { buffering: true }
    });
    expect(result.paused).toBe(false);
    expect(result.reason).toBe(PAUSE_REASON.SEEKING);
  });

  test('seeking suppresses user pause', () => {
    const result = resolvePause({
      seeking: { active: true },
      user: { paused: true }
    });
    expect(result.paused).toBe(false);
    expect(result.reason).toBe(PAUSE_REASON.SEEKING);
  });

  test('seeking:false does not suppress', () => {
    const result = resolvePause({
      seeking: { active: false },
      governance: { locked: true }
    });
    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GOVERNANCE);
  });

  test('no seeking bucket does not suppress', () => {
    const result = resolvePause({
      governance: { locked: true }
    });
    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GOVERNANCE);
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/isolated/domain/fitness/legacy/governance-video-pause.unit.test.mjs
```

Expected: 5 new tests fail (PAUSE_REASON.SEEKING not defined, seeking not handled).

**Step 3: Implement seeking guard in pauseArbiter**

Modify `frontend/src/modules/Player/utils/pauseArbiter.js`:

```javascript
export const PAUSE_REASON = Object.freeze({
  SEEKING: 'SEEKING',          // ← add this
  GOVERNANCE: 'PAUSED_GOVERNANCE',
  BUFFERING: 'PAUSED_BUFFERING',
  USER: 'PAUSED_USER',
  PLAYING: 'PLAYING'
});

const truthy = (value) => Boolean(value);

export const resolvePause = ({ seeking = {}, governance = {}, resilience = {}, user = {} } = {}) => {
  // Seeking suppresses ALL pause — video must finish seeking before pause is allowed
  if (truthy(seeking.active)) {
    return { paused: false, reason: PAUSE_REASON.SEEKING };
  }

  const governancePaused = truthy(
    governance.blocked
    ?? governance.paused
    ?? governance.locked
    ?? governance.videoLocked
  );
  // ... rest unchanged
```

**Step 4: Run tests — verify all pass**

```bash
npx vitest run tests/isolated/domain/fitness/legacy/governance-video-pause.unit.test.mjs
```

Expected: All tests pass (existing + 5 new).

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/utils/pauseArbiter.js tests/isolated/domain/fitness/legacy/governance-video-pause.unit.test.mjs
git commit -m "feat(fitness): add seeking guard to pauseArbiter to prevent pause thrashing during seeks"
```

---

## Task 2: Wire isSeeking into FitnessPlayer's resolvePause call (Bug 1, Part B)

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx`

**Context:** FitnessPlayer already has `seekIntentRef` (a ref storing `{ time, timestamp }`) set when a seek starts. But this isn't surfaced as reactive state. We need a boolean `isSeeking` state that's set `true` on seek initiation and `false` on the video element's `seeked` or `canplay` event. Then pass `seeking: { active: isSeeking }` to `resolvePause()`.

**Step 1: Add isSeeking state to FitnessPlayer**

Near the existing `seekIntentRef` (line ~230), add:

```javascript
const [isSeeking, setIsSeeking] = useState(false);
```

**Step 2: Set isSeeking true when seek starts**

Find where `seekIntentRef.current` is set (in `handleSeek` or equivalent). After setting the ref, add:

```javascript
setIsSeeking(true);
```

**Step 3: Set isSeeking false when seek completes**

In the video element's event handlers (look for `onSeeked` or `addEventListener('seeked', ...)`), add:

```javascript
setIsSeeking(false);
```

Also add a safety timeout — if seek doesn't complete within 15 seconds, force `isSeeking` to `false`:

```javascript
const seekTimeoutRef = useRef(null);

// When isSeeking becomes true, start timeout
useEffect(() => {
  if (isSeeking) {
    seekTimeoutRef.current = setTimeout(() => setIsSeeking(false), 15000);
  }
  return () => clearTimeout(seekTimeoutRef.current);
}, [isSeeking]);
```

**Step 4: Pass isSeeking to resolvePause**

Modify the existing `useMemo` for `pauseDecision` (~line 274):

```javascript
const pauseDecision = useMemo(() => resolvePause({
  seeking: { active: isSeeking },                          // ← add this
  governance: { locked: Boolean(governanceState?.videoLocked) },
  resilience: {
    stalled: resilienceState?.stalled,
    waiting: resilienceState?.waitingToPlay
  },
  user: { paused: isPaused }
}), [isSeeking, governanceState?.videoLocked, resilienceState?.stalled, resilienceState?.waitingToPlay, isPaused]);
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "feat(fitness): wire isSeeking state into resolvePause to suppress thrashing during seeks"
```

---

## Task 3: Debounce video pause/play toggles (Bug 1, Part C)

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx`

**Context:** Even with the seeking guard, a safety debounce prevents rapid-fire `pause()`/`play()` calls. The audit showed 0ms gaps between paused→resumed events. Guard the actual `media.pause()`/`media.play()` calls.

**Step 1: Add a pauseDebounce ref**

```javascript
const lastPauseToggleRef = useRef(0);
const PAUSE_DEBOUNCE_MS = 150;
```

**Step 2: Guard the pause/play calls**

Find where `pauseDecision.paused` drives `media.pause()` / `media.play()` (likely in a `useEffect` that reacts to `pauseDecision`). Wrap the toggle:

```javascript
const elapsed = Date.now() - lastPauseToggleRef.current;
if (elapsed < PAUSE_DEBOUNCE_MS) return;
lastPauseToggleRef.current = Date.now();
```

Apply this guard at the single point where the video element's `pause()`/`play()` is called based on `pauseDecision`. Do NOT apply it to user-initiated play/pause (button taps).

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "fix(fitness): debounce video pause/play toggles to prevent rapid thrashing"
```

---

## Task 4: Expose displayZoneId from ZoneProfileStore (Bug 2, Part A)

**Files:**
- Modify: `frontend/src/hooks/fitness/ZoneProfileStore.js`
- Create: `tests/isolated/domain/fitness/zone-profile-display-zone.unit.test.mjs`

**Context:** `ZoneProfileStore.#buildProfileFromUser()` returns `currentZoneId` from the hysteresis-committed zone. The `rawZoneId` (instant HR-derived zone) is only tracked internally in `_hysteresis`. UI consumers need to show the raw zone for visual feedback while governance uses the committed zone. We expose `displayZoneId`/`displayZoneName`/`displayZoneColor` on the profile — these reflect the unhysteresized (raw) zone.

**Step 1: Write failing tests**

Create `tests/isolated/domain/fitness/zone-profile-display-zone.unit.test.mjs`:

```javascript
import { describe, test, expect, beforeEach } from 'vitest';
import { ZoneProfileStore } from '../../../../frontend/src/hooks/fitness/ZoneProfileStore.js';

const ZONE_CONFIG = [
  { id: 'cool', name: 'Cool', color: '#3b82f6', min: 0 },
  { id: 'active', name: 'Active', color: '#22c55e', min: 120 },
  { id: 'warm', name: 'Warm', color: '#f59e0b', min: 140 },
  { id: 'hot', name: 'Hot', color: '#ef4444', min: 160 }
];

function makeUser(id, heartRate) {
  return {
    id,
    name: id,
    zoneConfig: ZONE_CONFIG,
    currentData: { heartRate }
  };
}

describe('ZoneProfileStore displayZoneId', () => {
  let store;

  beforeEach(() => {
    store = new ZoneProfileStore();
    store.setBaseZoneConfig(ZONE_CONFIG);
  });

  test('displayZoneId matches currentZoneId on first sync', () => {
    store.syncFromUsers([makeUser('alice', 130)]);
    const profile = store.getProfile('alice');
    expect(profile.currentZoneId).toBe('active');
    expect(profile.displayZoneId).toBe('active');
  });

  test('displayZoneId shows raw zone during exit margin suppression', () => {
    // First: establish committed zone as 'active' (HR=130)
    store.syncFromUsers([makeUser('alice', 130)]);
    let profile = store.getProfile('alice');
    expect(profile.currentZoneId).toBe('active');

    // Now: drop HR to 118 (below active min 120, but above exit threshold 115)
    store.syncFromUsers([makeUser('alice', 118)]);
    profile = store.getProfile('alice');

    // currentZoneId stays 'active' (exit margin suppression)
    expect(profile.currentZoneId).toBe('active');
    // displayZoneId should show 'cool' (the raw HR-derived zone)
    expect(profile.displayZoneId).toBe('cool');
  });

  test('getZoneState includes displayZoneId', () => {
    store.syncFromUsers([makeUser('alice', 130)]);
    const state = store.getZoneState('alice');
    expect(state.displayZoneId).toBeDefined();
    expect(state.displayZoneId).toBe('active');
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/isolated/domain/fitness/zone-profile-display-zone.unit.test.mjs
```

Expected: Tests fail because `displayZoneId` is undefined on profile.

**Step 3: Implement displayZoneId**

Modify `ZoneProfileStore.js`:

**3a.** Change `#applyHysteresis()` return to include both raw and committed zones. After the exit margin suppression block (line ~290), change the return to also include `rawZoneId`:

```javascript
// Change return type throughout #applyHysteresis:
// OLD: return lookupZone(state.committedZoneId);
// NEW: return { ...lookupZone(state.committedZoneId), rawZoneId, rawZoneName, rawZoneColor };

// Add a lookupRawZone helper alongside the existing lookupZone:
const lookupRawZone = (rawId) => {
  const raw = lookupZone(rawId);
  return { rawZoneId: raw.zoneId, rawZoneName: raw.zoneName, rawZoneColor: raw.zoneColor };
};
```

Modify every `return lookupZone(...)` in `#applyHysteresis()` to spread in the raw zone info:
- First-time commit (line ~262): `return { ...lookupZone(rawZoneId), ...lookupRawZone(rawZoneId) };`
- Raw matches committed (line ~273): `return { ...lookupZone(state.committedZoneId), ...lookupRawZone(rawZoneId) };`
- Exit margin suppression (line ~290): `return { ...lookupZone(state.committedZoneId), ...lookupRawZone(rawZoneId) };`
- Committed transitions (lines ~303, ~310): `return { ...lookupZone(rawZoneId), ...lookupRawZone(rawZoneId) };`
- Keep committed (line ~314): `return { ...lookupZone(state.committedZoneId), ...lookupRawZone(rawZoneId) };`

**3b.** In `#buildProfileFromUser()`, add to the return object (after line ~205):

```javascript
displayZoneId: stabilized.rawZoneId,
displayZoneName: stabilized.rawZoneName,
displayZoneColor: stabilized.rawZoneColor,
```

**3c.** In `getZoneState()`, add to the return object (after line ~133):

```javascript
displayZoneId: profile.displayZoneId,
displayZoneName: profile.displayZoneName,
displayZoneColor: profile.displayZoneColor,
```

**Step 4: Run tests — verify all pass**

```bash
npx vitest run tests/isolated/domain/fitness/zone-profile-display-zone.unit.test.mjs
```

Expected: All 3 tests pass.

**Step 5: Run existing governance tests — verify no regressions**

```bash
npx vitest run tests/isolated/domain/fitness/
```

Expected: All existing tests still pass.

**Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/ZoneProfileStore.js tests/isolated/domain/fitness/zone-profile-display-zone.unit.test.mjs
git commit -m "feat(fitness): expose displayZoneId (raw zone) from ZoneProfileStore for UI consumers"
```

---

## Task 5: Wire displayZoneId into LED sync (Bug 2, Part B)

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessContext.jsx` (the LED payload builder, ~line 1496)

**Context:** The LED payload currently reads `p.zoneId` (committed). It should read `p.rawZoneId` or the new `displayZoneId` so LEDs reflect instantaneous HR zone. The `useZoneLedSync` hook already has fallback logic for `p.rawZoneId || p.zoneId` — we just need the input payload to carry `rawZoneId`.

**Step 1: Find the LED payload builder in FitnessContext.jsx**

Look for `zoneLedPayload` useMemo (around line 1496). Currently:
```javascript
zoneId: p.zoneId || null,
```

**Step 2: Change to prefer rawZoneId**

```javascript
zoneId: p.rawZoneId || p.zoneId || null,
```

This single-line change ensures LEDs track the instant HR-derived zone, not the hysteresis-delayed committed zone.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessContext.jsx
git commit -m "fix(fitness): use rawZoneId for LED sync so colors match displayed HR"
```

---

## Task 6: Wire displayZoneId into chart live edge (Bug 2, Part C)

**Files:**
- Modify: `frontend/src/hooks/fitness/TreasureBox.js` (where `lastZoneId` is set from committed zone, ~line 533)

**Context:** `TreasureBox.js` sets `acc.lastZoneId` from the committed zone via `zoneProfileStore.getZoneState()`. The chart's live edge color comes from this. Change it to use `displayZoneId` so the chart edge color matches the instant HR.

**Step 1: Find the lastZoneId assignment in TreasureBox**

Look for `const committedZone = this._zoneProfileStore?.getZoneState?.(accKey);` around line 533.

**Step 2: Change to prefer displayZoneId**

```javascript
const committedZone = this._zoneProfileStore?.getZoneState?.(accKey);
const effectiveZoneId = committedZone?.displayZoneId || committedZone?.zoneId || zone.id || zone.name || null;
```

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/TreasureBox.js
git commit -m "fix(fitness): use displayZoneId for chart live edge color to match instant HR"
```

---

## Task 7: Suppress chart during governance lock (Bug 3)

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx`

**Context:** `showChart` state defaults to `true` and only responds to user toggle via sidebar button. When governance locks (phase = `locked` or `pending`), the chart overlay (z-index 15) is visible between the video and the lock overlay (z-index 60). Users see chart data peeking through the semi-transparent lock panel.

Fix: suppress chart render during `locked` and `pending` governance phases. Use declarative render guard (Option A from audit), not state management.

**Step 1: Find the chart render condition**

In FitnessPlayer.jsx, around line 1448:
```jsx
{showChart && (
  <div className="fitness-chart-overlay">
```

**Step 2: Add governance phase guard**

```jsx
{showChart && govStatus !== 'locked' && govStatus !== 'pending' && (
  <div className="fitness-chart-overlay">
```

`govStatus` is already derived at ~line 260 from `governanceState.status`. No new state needed.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "fix(fitness): hide chart overlay during governance lock/pending to prevent bleed-through"
```

---

## Task 8: Verify all changes together

**Step 1: Run all fitness tests**

```bash
npx vitest run tests/isolated/domain/fitness/
```

Expected: All pass, including new tests from Tasks 1 and 4.

**Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: No regressions.

**Step 3: Manual smoke test (if dev server available)**

Start `npm run dev`, open the fitness player, and verify:
- Seeking doesn't cause pause/play thrashing
- Zone colors update immediately when HR crosses thresholds
- Chart is hidden when governance locks video

**Step 4: Final commit (if any adjustments needed)**

---

## Dependency Graph

```
Task 1 (pauseArbiter seeking guard)
  └→ Task 2 (wire isSeeking into FitnessPlayer)
       └→ Task 3 (debounce pause/play)

Task 4 (expose displayZoneId from ZoneProfileStore)
  ├→ Task 5 (wire into LED sync)
  └→ Task 6 (wire into chart live edge)

Task 7 (suppress chart during lock) — independent

Task 8 (verify all) — depends on all above
```

Tasks 1→2→3, Tasks 4→5+6, and Task 7 are three independent chains that can be parallelized.
