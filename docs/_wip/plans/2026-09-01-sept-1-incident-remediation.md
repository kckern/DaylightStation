# Sept-1 Incident Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the four defects found on 2026-09-01 — a stale Player remount timer that restarts playback after it has already recovered, a treasure box that pays rings on the wrong zone table, a piano lesson gate that opens the whole menu for the 11 s it takes to load (and lets a gated child reach the course grid), and a fitness "frame drop" symptom that nothing currently measures — plus one diagnostic so the unexplained 45 s backend hang can be classified next time.

**Architecture:** Every fix is local to the module that owns the bug; no new layers. Pure decision logic is extracted into small tested helpers (`remountGuard.js`, `videoFpsSample.js`, `crtFrameStats.js`) and wired into the existing hooks/components, so the TDD loop stays fast and the React files change by a handful of lines each. Backend changes are one use-case memo, one log line, and one 0_system monitor.

**Tech Stack:** React 18 + vitest (frontend, `npx vitest run <file>`); Node ESM + vitest (backend isolated tests under `tests/isolated/`); structured logging via `getLogger().child(...)` (frontend) and injected `logger` (backend). No new dependencies.

**Source reports** (read the one for each task before starting it):
- `docs/_wip/bugs/2026-09-01-story-time-second-book-stall-and-post-success-remount.md`
- `docs/_wip/bugs/2026-09-01-fitness-treasurebox-rings-on-global-thresholds.md`
- `docs/_wip/bugs/2026-09-01-piano-lesson-gate-escapes-via-course-grid.md`
- `docs/_wip/bugs/2026-09-01-fitness-crt-frame-drops-unmeasured.md`

**Ground rules for every task**
- Run tests with `npx vitest run <path>` from the repo root. The root `vitest.config.mjs` serves both `frontend/src/**` and `tests/isolated/**`. Do not use `npm test` per task (it is the full multi-runner sweep).
- Logging: frontend uses `getLogger().child({ component })` (`frontend/src/lib/logging/Logger.js`); never `console.*`. Backend classes take a `logger` and call `this.#logger.info?.(event, data)`.
- Commit after each task on the feature branch (per-task commits are authorised on an isolated feature branch). Message style: `fix(scope): what` / `feat(scope): what` / `test(scope): what` / `docs(scope): what`.
- Do not deploy. Do not push. The user merges to `main` and deploys.

---

### Task 0: Sync with the deployed tree and branch

The macbook's `main` is often behind the homeserver deploy tree. Building on a stale tree here produced merge conflicts before (2026-06-30).

**Step 1: Check whether origin or the homeserver is ahead**

Run:
```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git fetch origin
git log --oneline HEAD..origin/main | head
ssh homeserver.local 'cd /opt/Code/DaylightStation && git branch --show-current && git log --oneline origin/main..HEAD | head'
```
Expected: both lists empty. If the homeserver list is non-empty, stop and integrate first:
```bash
git fetch homeserver.local:/opt/Code/DaylightStation <branch-shown-above>
git merge FETCH_HEAD
```

**Step 2: Create the worktree branch**

Run:
```bash
git worktree add .claude/worktrees/sept1-remediation -b fix/sept1-incident-remediation
cd .claude/worktrees/sept1-remediation
ln -s /Users/kckern/Documents/GitHub/DaylightStation/node_modules node_modules
ln -s /Users/kckern/Documents/GitHub/DaylightStation/frontend/node_modules frontend/node_modules
```
Expected: `git branch --show-current` prints `fix/sept1-incident-remediation`. All later tasks run inside this worktree.

**Step 3: Bring the four bug reports onto the branch**

They are untracked in the main checkout. Copy them:
```bash
cp /Users/kckern/Documents/GitHub/DaylightStation/docs/_wip/bugs/2026-09-01-*.md docs/_wip/bugs/
cp /Users/kckern/Documents/GitHub/DaylightStation/docs/_wip/plans/2026-09-01-sept-1-incident-remediation.md docs/_wip/plans/
git add docs/_wip/bugs/2026-09-01-*.md docs/_wip/plans/2026-09-01-sept-1-incident-remediation.md
git commit -m "docs(bugs): 2026-09-01 incident reports and remediation plan"
```

**Step 4: Prove the runner works before changing anything**

Run: `npx vitest run frontend/src/hooks/fitness/TreasureBox.test.js`
Expected: `1 passed`.

---

### Task 1: Player — a scheduled remount must not fire after playback has recovered

Report: story-time, Incident B. `Player.jsx:301` `clearRemountTimer` is only called on media-guid change, re-schedule, and unmount. A remount armed with backoff (attempt ≥ 2) fires even if playback started in the meantime, tearing down a playing element.

Two layers: (a) a pure fire-time guard, (b) cancel on the resilience hook's `playing` transition.

**Files:**
- Create: `frontend/src/modules/Player/lib/remountGuard.js`
- Create: `frontend/src/modules/Player/lib/remountGuard.test.js`
- Modify: `frontend/src/modules/Player/Player.jsx:656-682` (schedule), `:885-889` (`compositeAwareOnState`)
- Create: `frontend/src/modules/Player/Player.remountAfterSuccess.test.jsx`

**Step 1: Write the failing helper test**

`frontend/src/modules/Player/lib/remountGuard.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { shouldSkipScheduledRemount } from './remountGuard.js';

// A remount is armed with a backoff because playback was NOT progressing. If,
// by the time the timer fires, the playhead has moved and nothing is stalled,
// the reason for the remount no longer exists — firing it restarts the media.
describe('shouldSkipScheduledRemount', () => {
  it('skips when the playhead advanced past where it was armed and nothing is stalled', () => {
    expect(shouldSkipScheduledRemount({ armedAtSeconds: 0, currentSeconds: 1.2, stalled: false }))
      .toEqual({ skip: true, reason: 'playback-resumed', advancedSeconds: 1.2 });
  });
  it('fires when the playhead has not moved', () => {
    expect(shouldSkipScheduledRemount({ armedAtSeconds: 0, currentSeconds: 0, stalled: false }).skip).toBe(false);
  });
  it('fires when the element reports a stall even if the clock moved', () => {
    expect(shouldSkipScheduledRemount({ armedAtSeconds: 0, currentSeconds: 3, stalled: true }).skip).toBe(false);
  });
  it('treats sub-100ms movement as noise, not progress', () => {
    expect(shouldSkipScheduledRemount({ armedAtSeconds: 10, currentSeconds: 10.05, stalled: false }).skip).toBe(false);
  });
  it('fires on missing numbers', () => {
    expect(shouldSkipScheduledRemount({ armedAtSeconds: null, currentSeconds: 4, stalled: false }).skip).toBe(false);
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Player/lib/remountGuard.test.js`
Expected: FAIL — `Failed to resolve import "./remountGuard.js"`.

**Step 3: Write the helper**

`frontend/src/modules/Player/lib/remountGuard.js`:
```js
// remountGuard.js — the fire-time check for a backoff-scheduled Player remount.
//
// Why this exists: on 2026-09-01 a story-time track stalled at 0:00 for 47s,
// recovery attempt 3 was scheduled with a 1500ms backoff, the stream then
// released and playback STARTED 20ms later, and the timer fired anyway —
// unmounting the playing element and restarting from 0. The cancel-on-success
// path in Player.jsx is the primary fix; this guard is defence in depth for any
// other way the timer gets armed, and it produces the log line that makes the
// next such incident self-explanatory.

/** Movement smaller than this is timer jitter, not playback. */
export const MIN_PROGRESS_SECONDS = 0.1;

/**
 * @param {{armedAtSeconds: number|null, currentSeconds: number|null, stalled: boolean}} p
 * @returns {{skip: boolean, reason: string|null, advancedSeconds: number|null}}
 */
export function shouldSkipScheduledRemount({ armedAtSeconds, currentSeconds, stalled }) {
  if (!Number.isFinite(armedAtSeconds) || !Number.isFinite(currentSeconds)) {
    return { skip: false, reason: null, advancedSeconds: null };
  }
  const advancedSeconds = currentSeconds - armedAtSeconds;
  if (stalled === true || advancedSeconds < MIN_PROGRESS_SECONDS) {
    return { skip: false, reason: null, advancedSeconds };
  }
  return { skip: true, reason: 'playback-resumed', advancedSeconds };
}
```

**Step 4: Run the helper test**

Run: `npx vitest run frontend/src/modules/Player/lib/remountGuard.test.js`
Expected: `5 passed`.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/lib/remountGuard.js frontend/src/modules/Player/lib/remountGuard.test.js
git commit -m "feat(player): fire-time guard for backoff-scheduled remounts"
```

**Step 6: Write the failing Player integration test**

This drives `Player` through its resilience callbacks by mocking `useMediaResilience` and capturing the `onReload` / `onStateChange` props it receives. Attempt 1 remounts immediately (backoff 0); attempt 2 is scheduled at 1000 ms. We then report `playing` and advance the clock: no second remount may occur.

`frontend/src/modules/Player/Player.remountAfterSuccess.test.jsx`:
```jsx
/**
 * A backoff-scheduled remount must be cancelled when playback succeeds before
 * it fires. 2026-09-01: attempt 3 armed at +0ms, playback.started at +20ms,
 * the timer fired at +1500ms and restarted a playing track from 0.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mounts = [];
vi.mock('./components/SinglePlayer.jsx', async () => {
  const { useEffect } = await import('react');
  return {
    SinglePlayer: ({ plexClientSession }) => {
      useEffect(() => { mounts.push(plexClientSession); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return <div data-testid="single-player-stub" />;
    },
  };
});
vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.reject(new Error('offline in test'))),
}));
vi.mock('./lib/playbackLogger.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, playbackLog: vi.fn() };
});

// Capture the callbacks Player hands the resilience hook so the test can play
// the hook's part: "reload please" and "status changed".
const resilience = { onReload: null, onStateChange: null };
vi.mock('./hooks/useMediaResilience.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useMediaResilience: (opts) => {
      resilience.onReload = opts.onReload;
      resilience.onStateChange = opts.onStateChange;
      return { overlayProps: {}, cancelDeadline: () => {}, requestRecovery: () => {} };
    },
  };
});

import Player from './Player.jsx';
import { playbackLog } from './lib/playbackLogger.js';

const remountLogs = () => playbackLog.mock.calls.filter(([event]) => event === 'player-remount');
const skippedLogs = () => playbackLog.mock.calls.filter(([event]) => event === 'player-remount-skipped');

beforeEach(() => { mounts.length = 0; playbackLog.mockClear(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Player scheduled remount vs. playback success', () => {
  it('cancels a backoff-scheduled remount when the resilience hook reports playing', async () => {
    render(<Player play={{ contentId: 'plex:620561' }} />);
    await waitFor(() => expect(typeof resilience.onReload).toBe('function'));
    const mountsBefore = mounts.length;

    // Attempt 1: immediate remount (backoff 0).
    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });
    await waitFor(() => expect(remountLogs().length).toBe(1));

    // Attempt 2: scheduled with a 1000ms backoff.
    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });
    expect(playbackLog.mock.calls.some(([e, d]) => e === 'player-remount-scheduled' && d?.backoffMs > 0)).toBe(true);

    // Playback recovers before the timer fires.
    act(() => { resilience.onStateChange({ status: 'playing' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(remountLogs().length).toBe(1);                 // attempt 2 never fired
    expect(mounts.length).toBe(mountsBefore + 1);         // exactly one real remount
  });

  it('skips at fire time if the playhead moved even without a status change', async () => {
    render(<Player play={{ contentId: 'plex:620561' }} />);
    await waitFor(() => expect(typeof resilience.onReload).toBe('function'));
    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });
    await waitFor(() => expect(remountLogs().length).toBe(1));
    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });

    // Simulate progress reaching Player's metrics ref. Player exposes no public
    // setter; the SinglePlayer stub receives `onPlaybackMetrics`-style props —
    // find the prop name in Player.jsx (search "setPlaybackMetrics(") and call
    // it from the stub if this step cannot be driven through onStateChange.
    // If that plumbing is more than ~10 lines, keep only the first test and
    // rely on remountGuard.test.js for the fire-time branch.
  });
});
```
Keep the second `it` only if the metrics plumbing is cheap; otherwise delete it before committing (the helper test already pins the fire-time branch).

**Step 7: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Player/Player.remountAfterSuccess.test.jsx`
Expected: FAIL on `expect(remountLogs().length).toBe(1)` — actual 2 (the scheduled remount fired).

If it fails earlier because `onReload` short-circuits on `hardReset` (it does when the stub registers a `mediaAccess` with `hardReset`; the plain stub above does not), read `Player.jsx:900-945` and adjust the stub — do not weaken the assertion.

**Step 8: Implement — cancel on success and guard at fire time**

In `Player.jsx`:

(a) Import the guard near the other `./lib/` imports:
```js
import { shouldSkipScheduledRemount } from './lib/remountGuard.js';
```

(b) In `scheduleSinglePlayerRemount` (line ~656), capture the position at arm time and guard in the timer body. Replace:
```js
    remountTimerRef.current = setTimeout(() => {
      remountTimerRef.current = null;
      forceSinglePlayerRemount(input, { scheduledDelayMs: backoffMs, attempt });
    }, backoffMs);
```
with:
```js
    const armedAtSeconds = playbackMetricsRef.current?.seconds ?? null;
    remountTimerRef.current = setTimeout(() => {
      remountTimerRef.current = null;
      const verdict = shouldSkipScheduledRemount({
        armedAtSeconds,
        currentSeconds: playbackMetricsRef.current?.seconds ?? null,
        stalled: playbackMetricsRef.current?.stalled === true
      });
      if (verdict.skip) {
        playbackLog('player-remount-skipped', {
          ...resolvedWaitKeyFields,
          attempt,
          backoffMs,
          reason: verdict.reason,
          advancedSeconds: verdict.advancedSeconds,
          guid: currentMediaGuid
        }, { level: 'info' });
        return;
      }
      forceSinglePlayerRemount(input, { scheduledDelayMs: backoffMs, attempt });
    }, backoffMs);
```

(c) Cancel on the hook's `playing` transition. Replace `compositeAwareOnState` (line ~885):
```js
  const compositeAwareOnState = useCallback((state) => {
    // A pending backoff remount exists because playback was not progressing.
    // The hook saying "playing" means that reason is gone; a timer that fires
    // now would tear down a working element (2026-09-01, story time).
    if (state?.status === 'playing' && remountTimerRef.current) {
      playbackLog('player-remount-cancelled', {
        ...resolvedWaitKeyFields,
        reason: 'playback-resumed',
        guid: currentMediaGuid
      }, { level: 'info' });
      clearRemountTimer();
    }
    if (typeof resolvedResilienceOnState === 'function') {
      resolvedResilienceOnState(state);
    }
  }, [resolvedResilienceOnState, clearRemountTimer, resolvedWaitKeyFields, currentMediaGuid]);
```
`clearRemountTimer` and `remountTimerRef` are declared at lines 280/301 — above this callback — so no hoisting issue. Confirm the hook's status constant for playing is the string `'playing'`: `grep -n "playing" frontend/src/modules/Player/lib/*.js | grep RESILIENCE_STATUS -A0` (the hook maps `STATUS = RESILIENCE_STATUS`, `useMediaResilience.js:20,45`).

**Step 9: Run the Player test and the neighbouring Player suites**

Run: `npx vitest run frontend/src/modules/Player/Player.remountAfterSuccess.test.jsx frontend/src/modules/Player/Player.stormGuard.test.jsx frontend/src/modules/Player/Player.keyLog.test.jsx frontend/src/modules/Player/Player.identityChurn.test.jsx frontend/src/modules/Player/Player.completion.test.jsx`
Expected: all pass.

**Step 10: Commit**

```bash
git add frontend/src/modules/Player/Player.jsx frontend/src/modules/Player/Player.remountAfterSuccess.test.jsx
git commit -m "fix(player): cancel backoff remount on playback success; skip at fire time if playhead moved"
```

---

### Task 2: TreasureBox — never cache a missing zone profile; invalidate on profile sync

Report: treasure box. `resolveZone` caches `overrides || null` once per user (`TreasureBox.js:494`) and `.has()` treats the null as an answer. First HR sample beat the profile store by 1 ms → global thresholds all session.

**Files:**
- Modify: `frontend/src/hooks/fitness/TreasureBox.js:472-503` (`resolveZone`), add `invalidateZoneOverrideCache()`
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:478-481`
- Modify: `frontend/src/hooks/fitness/TreasureBox.test.js`

**Step 1: Write the failing tests**

Append to `frontend/src/hooks/fitness/TreasureBox.test.js`:
```js
// 2026-09-01: milo's first HR sample reached the box 1ms before ZoneProfileStore
// had built his profile. The box cached the miss and scored him on GLOBAL
// thresholds (active=100) for the whole session while the roster, LED and
// zone series used his personal ones (active=120).
const GLOBAL_ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', rings: 0 },
  { id: 'active', name: 'Active', min: 100, color: 'green', rings: 1 },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow', rings: 2 },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange', rings: 3 },
  { id: 'fire', name: 'Fire', min: 160, color: 'red', rings: 5 },
];
const MILO_PROFILE = { id: 'milo', zoneConfig: [
  { id: 'cool', min: 0 }, { id: 'active', min: 120 }, { id: 'warm', min: 140 }, { id: 'hot', min: 160 }, { id: 'fire', min: 180 },
] };

function boxWithStore(profiles) {
  const store = { getProfile: (id) => profiles.get(id) ?? null, getZoneState: () => null };
  const box = new FitnessTreasureBox({ startTime: Date.now(), timebase: {} });
  box.configure({ zones: GLOBAL_ZONES });
  box.setZoneProfileStore(store);
  return { box, store };
}

describe('FitnessTreasureBox.resolveZone with a late ZoneProfileStore profile', () => {
  it('does not cache a missing profile — the next sample uses the personal thresholds', () => {
    const profiles = new Map();
    const { box } = boxWithStore(profiles);
    expect(box.resolveZone('milo', 105).id).toBe('active');   // no profile yet: global
    profiles.set('milo', MILO_PROFILE);                        // store catches up
    expect(box.resolveZone('milo', 105).id).toBe('cool');      // personal active=120
  });

  it('invalidateZoneOverrideCache() re-reads a profile that changed after it was cached', () => {
    const profiles = new Map([['milo', { id: 'milo', zoneConfig: [{ id: 'cool', min: 0 }, { id: 'active', min: 100 }] }]]);
    const { box } = boxWithStore(profiles);
    expect(box.resolveZone('milo', 105).id).toBe('active');
    profiles.set('milo', MILO_PROFILE);
    expect(box.resolveZone('milo', 105).id).toBe('active');    // still cached — by design, until told
    box.invalidateZoneOverrideCache();
    expect(box.resolveZone('milo', 105).id).toBe('cool');
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run frontend/src/hooks/fitness/TreasureBox.test.js`
Expected: FAIL — first test: `expected 'active' to be 'cool'`; second: `box.invalidateZoneOverrideCache is not a function`.

**Step 3: Implement**

In `TreasureBox.js`, replace the cache block inside `resolveZone` (lines ~477-495) with:
```js
    // If no manual overrides, pull from ZoneProfileStore (per-user custom zones).
    // Cache the converted map to avoid deep-cloning the profile on every HR
    // sample — but NEVER cache a miss. The store builds profiles lazily and the
    // first HR sample can arrive before it has this user (2026-09-01: by 1ms);
    // a cached null meant global thresholds for the rest of the session.
    if (!overrides && this._zoneProfileStore) {
      if (!this._zoneProfileOverrideCache) this._zoneProfileOverrideCache = new Map();
      if (this._zoneProfileOverrideCache.has(userId)) {
        overrides = this._zoneProfileOverrideCache.get(userId);
      } else {
        const profile = this._zoneProfileStore.getProfile(userId);
        if (profile?.zoneConfig && Array.isArray(profile.zoneConfig)) {
          overrides = {};
          for (const z of profile.zoneConfig) {
            const key = z.id || z.name?.toLowerCase();
            if (key && typeof z.min === 'number') overrides[key] = z.min;
          }
          this._zoneProfileOverrideCache.set(userId, overrides);
        } else {
          this._log('zone_override_miss', { userId }, 'warn');
        }
      }
    }
```
Add the method next to `setZoneProfileStore` (line ~68):
```js
  /** Drop cached per-user threshold maps; call when ZoneProfileStore profiles change. */
  invalidateZoneOverrideCache() {
    this._zoneProfileOverrideCache = new Map();
  }
```

In `FitnessSession.js:478`, after `const changed = this._syncZoneProfiles(usersForZones);` add:
```js
          if (changed) this.treasureBox?.invalidateZoneOverrideCache?.();
```

**Step 4: Run the tests**

Run: `npx vitest run frontend/src/hooks/fitness/TreasureBox.test.js frontend/src/hooks/fitness/`
Expected: TreasureBox `3 passed`; the rest of `hooks/fitness` unchanged from before (run the directory once before your change if you want a baseline count).

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/TreasureBox.js frontend/src/hooks/fitness/TreasureBox.test.js frontend/src/hooks/fitness/FitnessSession.js
git commit -m "fix(fitness): treasure box never caches a missing zone profile; invalidate on profile sync"
```

---

### Task 3: Piano lesson gate — "loading" is pending, not open

Report: piano gate, Gap 0. `usePianoLessonGate` reports `status: 'loading'` but `PianoMenu` reads only `gated`. The cold read is 11 s; the menu is fully open for all of it.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/usePianoLessonGate.js` (loading ceiling)
- Modify: `frontend/src/modules/Piano/PianoKiosk/usePianoLessonGate.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoMenu.jsx:49-79`
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoMenu.gate.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoMenu.scss` (only if a pending message style is needed; reuse curfew's)

**Step 1: Failing hook test — a slow read reports `loading`, then `timeout` after the ceiling**

Append to `usePianoLessonGate.test.js` inside `describe('usePianoLessonGate')`:
```js
  it('stays "loading" while the read is in flight and fails open as "timeout" after the ceiling', async () => {
    vi.useFakeTimers();
    let resolve;
    h.response = new Promise((r) => { resolve = r; });
    const { result } = renderHook(() => usePianoLessonGate('alan'));
    expect(result.current.status).toBe('loading');
    expect(result.current.gated).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(LOADING_CEILING_MS + 10); });
    expect(result.current.status).toBe('timeout');
    expect(result.current.gated).toBe(false);
    // A late answer still lands.
    await act(async () => { resolve(OWED); await Promise.resolve(); });
    expect(result.current.status).toBe('ready');
    expect(result.current.gated).toBe(true);
  });
```
and import the constant at the top: `import usePianoLessonGate, { LOADING_CEILING_MS } from './usePianoLessonGate.js';`

**Step 2: Run to verify failure**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/usePianoLessonGate.test.js`
Expected: FAIL — `LOADING_CEILING_MS` undefined / status never `timeout`.

**Step 3: Implement the ceiling in the hook**

In `usePianoLessonGate.js`:
```js
/**
 * How long a non-guest learner's menu stays PENDING (tiles disabled) waiting for
 * the first verdict. The cold read was measured at 11.1s on 2026-09-01; the
 * gate must outlast it, but a real fault must not lock a child out for long.
 */
export const LOADING_CEILING_MS = 20000;
```
Inside `refresh`, right after `const generation = ++requestGeneration.current;` and the guest early-return, arm a ceiling that flips status without touching `gated`:
```js
    const ceiling = setTimeout(() => {
      if (generation !== requestGeneration.current) return;
      setSnapshot((prev) => (prev.learnerId === learnerId && prev.status === 'loading'
        ? (logger().warn('piano.lesson-gate.loading-timeout', { learnerId, ceilingMs: LOADING_CEILING_MS }), { ...prev, status: 'timeout' })
        : prev));
    }, LOADING_CEILING_MS);
```
and `clearTimeout(ceiling)` in both the success path and the catch (before `setSnapshot`). Also make a learner switch visibly `loading`: at the top of `refresh` (non-guest), `setSnapshot((prev) => (prev.learnerId === learnerId ? prev : open(learnerId, 'loading')));` so the pending state renders for the new learner (the derived `current` already does this; the explicit set keeps the ceiling's `prev.status === 'loading'` check honest).

**Step 4: Run the hook tests**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/usePianoLessonGate.test.js`
Expected: all pass (existing tests + the new one).

**Step 5: Failing menu test — pending disables everything**

In `PianoMenu.gate.test.js`, add a state and a test:
```js
const LOADING = { status: 'loading', gated: false, course: null, unit: null, lesson: null, challenge: null };

it('while the gate is loading for a named learner, every tile and the activity strip are disabled', async () => {
  gateState = LOADING;
  renderMenu();
  const all = tiles();
  expect(all.length).toBe(10);
  expect(all.every((t) => t.disabled)).toBe(true);
  expect(screen.getByText(/checking today.s lesson/i)).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
});

it('a timed-out gate read opens the menu (fail open) and says nothing', () => {
  gateState = { ...LOADING, status: 'timeout' };
  renderMenu();
  expect(tiles().filter((t) => t.disabled)).toHaveLength(2); // Games + Producer, as in the not-gated case
  expect(screen.queryByText(/checking today.s lesson/i)).toBeNull();
});
```
Note the existing mock: `usePianoUser: () => ({ currentUser: 'learner2' })` — a named learner, so pending applies.

**Step 6: Run to verify failure**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoMenu.gate.test.js`
Expected: FAIL — tiles not disabled / text not found.

**Step 7: Implement pending in `PianoMenu.jsx`**

After line 50 (`const gated = …`):
```js
  // A named learner whose verdict has not arrived is PENDING, not free: the
  // cold read takes ~11s and the menu used to be wide open for all of it
  // (2026-09-01). Guests are never pending; a timed-out or failed read opens.
  const pending = !curfew && !gated && currentUser && currentUser !== 'guest' && lessonGate.status === 'loading';
```
Then: `PianoMenuActivity disabled={curfew || pending}`; in the tile map `const disabled = m.disabled || schoolLocked || curfew || pending;` and blurb for non-games tiles while pending: `pending ? 'Checking today's lesson…' : m.blurb` (apply to the `m.id !== 'games' || gameAccess.unlocked` branch). Add, next to the curfew `<p>`:
```jsx
        {pending && (
          <p className="piano-home__curfew" role="status">Checking today's lesson…</p>
        )}
```
(reusing the curfew message style; rename the class only if it reads wrong on screen).

**Step 8: Run menu tests**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoMenu.gate.test.js frontend/src/modules/Piano/PianoKiosk/PianoMenu.curfew.test.js`
Expected: all pass.

**Step 9: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/usePianoLessonGate.js frontend/src/modules/Piano/PianoKiosk/usePianoLessonGate.test.js frontend/src/modules/Piano/PianoKiosk/PianoMenu.jsx frontend/src/modules/Piano/PianoKiosk/PianoMenu.gate.test.js
git commit -m "fix(piano): lesson gate treats an in-flight read as pending, not open; 20s ceiling then fail-open"
```

---

### Task 4: GetPianoLessonGate — memoise the verdict per learner, invalidate on School events

Report: piano gate, Gap 0 (server half). Cold read = Plex course fetch via `GetPlayableUnits`. The verdict changes only on lesson completion, bypass, or day rollover.

**Files:**
- Modify: `backend/src/3_applications/school/usecases/GetPianoLessonGate.mjs`
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs:591`
- Create: `tests/isolated/application/school/getPianoLessonGate.test.mjs`

**Step 1: Failing test**

`tests/isolated/application/school/getPianoLessonGate.test.mjs`:
```js
import { describe, it, expect, vi } from 'vitest';
import { GetPianoLessonGate } from '#apps/school/usecases/GetPianoLessonGate.mjs';

const ENROLLED = [{ programId: 'piano-course', courseId: 'plex:695598' }];
const OWED = { doneToday: false, nextLesson: { course: { id: 'plex:695598' }, unit: null, lesson: { id: 'plex:695611', title: 'Meet the Eighth Note' } } };

function build({ status = OWED, realtime = null, now = () => 1_000 } = {}) {
  const statusFn = vi.fn(async () => status);
  const uc = new GetPianoLessonGate({
    assignments: { get: async () => ({ programs: ENROLLED }) },
    launcher: { id: 'piano-course', status: statusFn },
    realtime,
    clock: now,
    logger: { warn() {}, info() {} },
  });
  return { uc, statusFn };
}

describe('GetPianoLessonGate memo', () => {
  it('answers the second read for the same learner from memory', async () => {
    const { uc, statusFn } = build();
    await uc.execute({ learnerId: 'alan' });
    await uc.execute({ learnerId: 'alan' });
    expect(statusFn).toHaveBeenCalledTimes(1);
  });
  it('expires after the TTL', async () => {
    let t = 1_000;
    const { uc, statusFn } = build({ now: () => t });
    await uc.execute({ learnerId: 'alan' });
    t += GetPianoLessonGate.MEMO_TTL_MS + 1;
    await uc.execute({ learnerId: 'alan' });
    expect(statusFn).toHaveBeenCalledTimes(2);
  });
  it('is invalidated for that learner by a lesson-completed event', async () => {
    const handlers = {};
    const realtime = {
      onPianoLessonCompleted: (h) => { handlers.completed = h; return () => {}; },
      onProgramDayBypassChanged: (h) => { handlers.bypass = h; return () => {}; },
    };
    const { uc, statusFn } = build({ realtime });
    uc.start();
    await uc.execute({ learnerId: 'alan' });
    await handlers.completed({ userId: 'alan' });
    await uc.execute({ learnerId: 'alan' });
    expect(statusFn).toHaveBeenCalledTimes(2);
  });
  it('never memoises an unavailable verdict', async () => {
    const { uc, statusFn } = build({ status: { error: true } });
    await uc.execute({ learnerId: 'alan' });
    await uc.execute({ learnerId: 'alan' });
    expect(statusFn).toHaveBeenCalledTimes(2);
  });
});
```

Before writing the invalidation test, confirm the bypass subscription's name on the realtime port: `grep -n "Bypass\|onSchool" backend/src/1_adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs backend/src/3_applications/school/ports/ISchoolRealtimeGateway.mjs`. If there is no `onProgramDayBypassChanged`, use whichever method delivers `program-day-bypass-changed` (line 78 of the adapter filters on it) and rename in the test and implementation.

**Step 2: Run to verify failure**

Run: `npx vitest run tests/isolated/application/school/getPianoLessonGate.test.mjs`
Expected: FAIL — `statusFn` called 2 times; `uc.start is not a function`; `MEMO_TTL_MS` undefined.

**Step 3: Implement**

In `GetPianoLessonGate.mjs`:
- Add fields `#realtime; #clock; #memo = new Map(); #unsubscribe = null;` and `static MEMO_TTL_MS = 60_000;`.
- Constructor: accept `realtime = null, clock = () => Date.now()`.
- `start()`: if `#realtime`, subscribe to `onPianoLessonCompleted(({ userId }) => this.invalidate(userId))` and the bypass event (`({ learnerId }) => this.invalidate(learnerId)` — check the payload field name in `programDayBypassChanged` callers: `grep -rn "programDayBypassChanged(" backend/src`). Idempotent like the ceremony bridge's `start()`.
- `invalidate(learnerId)`: `this.#memo.delete(learnerId)`; `invalidate()` with no arg clears all.
- In `execute`: after the guest check, `const hit = this.#memo.get(learnerId); if (hit && this.#clock() - hit.at < GetPianoLessonGate.MEMO_TTL_MS) return hit.result;`. Wrap the existing body so every `return { ...base, gated, reason }` goes through `#remember(learnerId, result)`, which stores only when `result.reason !== 'unavailable'`.
- Also invalidate on the study-day boundary: store `at` and compare — the TTL handles it (60 s), no extra logic.

In `schoolLifecycle.mjs:591`, pass `realtime` (the same adapter the ceremony bridge receives in this module — find its variable with `grep -n "PianoLessonCeremonyBridge(" -B12 backend/src/5_composition/modules/schoolLifecycle.mjs`) and call `.start()` where the bridge's `start()` is called.

**Step 4: Run the tests plus the composition contract**

Run: `npx vitest run tests/isolated/application/school/getPianoLessonGate.test.mjs && npm run test:composition-contracts`
Expected: `4 passed`; composition contracts pass.

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/usecases/GetPianoLessonGate.mjs backend/src/5_composition/modules/schoolLifecycle.mjs tests/isolated/application/school/getPianoLessonGate.test.mjs
git commit -m "perf(school): memoise piano lesson gate verdict per learner; invalidate on completion/bypass"
```

---

### Task 5: Videos mode — a gated learner never sees the course grid

Report: piano gate, Gap 1. `CourseGridRoute` (`Videos.jsx:62-71`) lists every course; Back from the assigned course lands there.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.jsx:62-71`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.gate.test.jsx`

**Step 1: Failing test**

```jsx
// A learner who still owes today's lesson has ONE launcher — the lesson card on
// the menu. The grid is where the 2026-09-01 escape happened (Back from the
// assigned course → every course → a lesson from the wrong one).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CourseGridRoute } from './Videos.jsx';

const state = { gate: { status: 'ready', gated: false, course: null }, user: 'alan' };
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ basePath: '/piano', config: { videos: {} } }) }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: state.user }) }));
vi.mock('../../usePianoLessonGate.js', () => ({ default: () => state.gate }));
vi.mock('./CourseGrid.jsx', () => ({ default: () => <div data-testid="course-grid" /> }));
vi.mock('../../../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }),
}));

const renderAt = () => render(
  <MemoryRouter initialEntries={['/piano/videos']}>
    <Routes>
      <Route path="/piano" element={<div data-testid="menu" />} />
      <Route path="/piano/videos" element={<CourseGridRoute groups={[]} />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { state.gate = { status: 'ready', gated: false, course: null }; state.user = 'alan'; });

describe('CourseGridRoute under the lesson gate', () => {
  it('renders the grid when not gated', () => {
    renderAt();
    expect(screen.getByTestId('course-grid')).toBeTruthy();
  });
  it('sends a gated learner back to the menu instead of the grid', () => {
    state.gate = { status: 'ready', gated: true, course: { id: 'plex:695598' } };
    renderAt();
    expect(screen.queryByTestId('course-grid')).toBeNull();
    expect(screen.getByTestId('menu')).toBeTruthy();
  });
  it('shows nothing (not the grid) while a named learner\'s verdict is loading', () => {
    state.gate = { status: 'loading', gated: false, course: null };
    renderAt();
    expect(screen.queryByTestId('course-grid')).toBeNull();
    expect(screen.queryByTestId('menu')).toBeNull();
  });
  it('a guest always gets the grid', () => {
    state.user = 'guest'; state.gate = { status: 'loading', gated: false, course: null };
    renderAt();
    expect(screen.getByTestId('course-grid')).toBeTruthy();
  });
});
```
Check the relative import depth for `Logger.js` from `modes/Videos/` (`Videos.jsx` imports it — copy that path).

**Step 2: Run to verify failure**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.gate.test.jsx`
Expected: FAIL on the gated and loading cases (grid renders).

**Step 3: Implement**

In `Videos.jsx`, import `usePianoLessonGate from '../../usePianoLessonGate.js'`, `Navigate` from `react-router-dom`, and `usePianoKioskConfig` is already imported. Replace `CourseGridRoute`:
```jsx
/**
 * Course grid → push the selected course id (relative).
 *
 * Under the lesson gate the grid does not exist for that learner: the ONE
 * launcher they have is the lesson card on the menu, so Back from the assigned
 * course goes there. Guests, School-less installs and failed/timed-out reads
 * see the full grid (the hook fails open). While a named learner's verdict is
 * in flight, render nothing rather than a grid that may be about to vanish.
 */
function CourseGridRoute({ groups }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-videos' }), []);
  const navigate = useNavigate();
  const { basePath } = usePianoKioskConfig();
  const { currentUser } = usePianoUser();
  const gate = usePianoLessonGate(currentUser);
  const named = currentUser && currentUser !== 'guest';
  if (named && gate.gated) {
    logger.info('piano.videos.grid-redirected', { learnerId: currentUser, courseId: gate.course?.id ?? null });
    return <Navigate to={basePath} replace />;
  }
  if (named && gate.status === 'loading') return null;
  return (
    <CourseGrid
      groups={groups}
      onSelect={(item) => { logger.info('piano.course-open', { id: item.id }); navigate(idOf(item.id)); }}
    />
  );
}
export { CourseGridRoute };
```
`usePianoKioskConfig` must return `basePath` — `PianoMenu.gate.test.js` mocks it with one, and `PianoMenu.jsx` reads `basePath` from it; confirm with `grep -n "basePath" frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx`.

**Step 4: Run the Videos suites**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/`
Expected: all pass, including the new file.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.gate.test.jsx
git commit -m "fix(piano): gated learners are redirected from the course grid to the lesson card"
```

---

### Task 6: PianoLessonCeremonyBridge — log an ignored completion

Report: piano gate, Gap 2. `#handle` returns silently when the completed lesson is in no enrolled course.

**Files:**
- Modify: `backend/src/3_applications/school/PianoLessonCeremonyBridge.mjs:184-186`
- Modify: `tests/isolated/application/school/pianoLessonCeremonyBridge.test.mjs`

**Step 1: Failing test**

In the existing `build()` helper the logger is `{ warn() {}, info() {} }`. Add a test that passes a spying logger. Look at how the file emits a completion (`bus.emit('piano.lesson.completed', …)` — copy the pattern from the nearest negative-case test) and add:
```js
it('logs, at info, a completion that belongs to no enrolled course (2026-09-01: Hot Cross Buns vs Reading Music)', async () => {
  const info = vi.fn();
  const { bus } = build({
    status: { doneToday: false, completedLessonsToday: [], completedLessons: [] },
    logger: { warn() {}, info },
  });
  await bus.emit('piano.lesson.completed', { userId: 'alan', plexId: 'plex:694782', title: 'Lesson 9 | Hot Cross Buns: Part 2' });
  expect(info).toHaveBeenCalledWith('school.piano-ceremony.ignored', expect.objectContaining({
    learnerId: 'alan', plexId: 'plex:694782', reason: 'not-in-enrolled-course', enrolledCourseIds: [COURSE],
  }));
  expect(bus.sent).toHaveLength(0);
});
```
`build()` currently hard-codes its logger; add a `logger` option to it (default unchanged).

**Step 2: Run to verify failure**

Run: `npx vitest run tests/isolated/application/school/pianoLessonCeremonyBridge.test.mjs`
Expected: FAIL — `info` not called.

**Step 3: Implement**

In `#handle`, replace
```js
    // The completed episode was not part of an enrolled Hoffman course.
    if (!enrollment || !completion) return;
```
with
```js
    // The completed episode was not part of an enrolled course. Correct policy
    // — but it must leave a trace: on 2026-09-01 diagnosing exactly this took
    // the plan file, Plex metadata and this source, by hand.
    if (!enrollment || !completion) {
      this.#logger.info?.('school.piano-ceremony.ignored', {
        learnerId,
        plexId: payload?.plexId ?? null,
        title: payload?.title ?? null,
        reason: 'not-in-enrolled-course',
        enrolledCourseIds: enrollments.map((row) => row.courseId ?? row.corpusId ?? null),
      });
      return;
    }
```

**Step 4: Run**

Run: `npx vitest run tests/isolated/application/school/pianoLessonCeremonyBridge.test.mjs`
Expected: all pass.

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/PianoLessonCeremonyBridge.mjs tests/isolated/application/school/pianoLessonCeremonyBridge.test.mjs
git commit -m "fix(school): log piano completions that match no enrolled course"
```

---

### Task 7: Fitness profiler — fps must be frames ÷ playing time, not frames ÷ wall clock

Report: CRT. `FitnessApp.jsx:224` divides the frame delta by wall-clock elapsed; a video that starts 18 s into a 30 s window reads 14.5 fps and trips `video_fps_degraded` falsely.

**Files:**
- Create: `frontend/src/hooks/fitness/videoFpsSample.js`
- Create: `frontend/src/hooks/fitness/videoFpsSample.test.js`
- Modify: `frontend/src/Apps/FitnessApp.jsx:198-247`

**Step 1: Failing test**

```js
import { describe, it, expect } from 'vitest';
import { computeVideoFpsSample } from './videoFpsSample.js';

// 2026-09-01 17:01:55: video had played 18.2s of a 30s sampling window.
// 18.2/30 × 23.976 = 14.5 "fps" → a false video_fps_degraded warning.
describe('computeVideoFpsSample', () => {
  const prev = { totalFrames: 0, droppedFrames: 0, currentTime: 0, timestamp: 0 };
  it('divides by playing time, so a mid-window start reads the true rate', () => {
    const s = computeVideoFpsSample(prev, { totalFrames: 436, droppedFrames: 0, currentTime: 18.2, timestamp: 30000 });
    expect(s.fps).toBeCloseTo(23.96, 1);
    expect(s.dropRate).toBe(0);
  });
  it('returns null fps when less than a second of media played', () => {
    const s = computeVideoFpsSample(prev, { totalFrames: 10, droppedFrames: 0, currentTime: 0.4, timestamp: 30000 });
    expect(s.fps).toBeNull();
  });
  it('returns null fps and resets when the frame counter went backwards (element reset)', () => {
    const s = computeVideoFpsSample({ ...prev, totalFrames: 500 }, { totalFrames: 20, droppedFrames: 0, currentTime: 1, timestamp: 30000 });
    expect(s.fps).toBeNull();
    expect(s.reset).toBe(true);
  });
  it('dropRate is dropped ÷ total over the window, in percent', () => {
    const s = computeVideoFpsSample(prev, { totalFrames: 200, droppedFrames: 10, currentTime: 10, timestamp: 10000 });
    expect(s.dropRate).toBe(5);
  });
  it('null fps on the first sample (no previous)', () => {
    expect(computeVideoFpsSample(null, { totalFrames: 5, droppedFrames: 0, currentTime: 1, timestamp: 1 }).fps).toBeNull();
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run frontend/src/hooks/fitness/videoFpsSample.test.js`
Expected: FAIL — module not found.

**Step 3: Implement**

`frontend/src/hooks/fitness/videoFpsSample.js`:
```js
// videoFpsSample.js — pure fps/drop arithmetic for the fitness profiler.
// Frames are divided by MEDIA time that elapsed (video.currentTime delta), not
// wall-clock, so a video that starts mid-window is not reported as slow.

/**
 * @param {{totalFrames:number, droppedFrames:number, currentTime:number, timestamp:number}|null} prev
 * @param {{totalFrames:number, droppedFrames:number, currentTime:number, timestamp:number}} now
 * @returns {{fps:number|null, dropRate:number|null, reset:boolean}}
 */
export function computeVideoFpsSample(prev, now) {
  if (!prev) return { fps: null, dropRate: null, reset: false };
  const framesDelta = now.totalFrames - prev.totalFrames;
  if (framesDelta < 0) return { fps: null, dropRate: null, reset: true };
  const playedSeconds = now.currentTime - prev.currentTime;
  const droppedDelta = now.droppedFrames - prev.droppedFrames;
  const dropRate = framesDelta > 0 ? Math.round(droppedDelta / framesDelta * 1000) / 10 : 0;
  if (!(playedSeconds >= 1)) return { fps: null, dropRate, reset: false };
  return { fps: Math.round(framesDelta / playedSeconds * 10) / 10, dropRate, reset: false };
}
```

**Step 4: Run**

Run: `npx vitest run frontend/src/hooks/fitness/videoFpsSample.test.js`
Expected: `5 passed`.

**Step 5: Wire into `FitnessApp.jsx`**

Import `computeVideoFpsSample` and rewrite the body of `getVideoFps` (lines 198-247) to build `now = { totalFrames: quality.totalVideoFrames, droppedFrames: quality.droppedVideoFrames, currentTime: Number(video.currentTime) || 0, timestamp: performance.now() }`, call `computeVideoFpsSample(lastFpsCheck.timestamp > 0 ? lastFpsCheck : null, now)`, set `lastFpsCheck = now`, and return the same shape as before (`fps`, `totalFrames`, `droppedFrames`, `corruptedFrames`, `dropRate`, `videoState`). `lastFpsCheck` must gain a `currentTime` field wherever it is initialised (search `lastFpsCheck = {`).

**Step 6: Smoke the app file still parses and its neighbours pass**

Run: `npx vitest run frontend/src/hooks/fitness/ && node -e "import('./frontend/src/Apps/FitnessApp.jsx').catch(e=>{console.error(e.message);process.exit(1)})" 2>&1 | tail -2`
Expected: tests pass; the import check may fail on JSX in plain node — if so, run `npx vite build --mode development 2>&1 | tail -5` from `frontend/` instead and expect no errors mentioning `FitnessApp`.

**Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/videoFpsSample.js frontend/src/hooks/fitness/videoFpsSample.test.js frontend/src/Apps/FitnessApp.jsx
git commit -m "fix(fitness): profiler fps uses media time, not wall clock (false video_fps_degraded)"
```

---

### Task 8: CRT renderer — count the frames the canvas actually missed

Report: CRT. The canvas draws on `requestVideoFrameCallback`; a late callback is a skipped frame that `getVideoPlaybackQuality` never counts. rVFC hands the callback `metadata.presentedFrames`; the gap between consecutive callbacks is the miss count.

**Files:**
- Create: `frontend/src/modules/Player/lib/crtFrameStats.js`
- Create: `frontend/src/modules/Player/lib/crtFrameStats.test.js`
- Modify: `frontend/src/modules/Player/lib/crtRenderer.js:375-400` (pump / schedule / stats)

**Step 1: Failing test**

```js
import { describe, it, expect } from 'vitest';
import { createCrtFrameStats } from './crtFrameStats.js';

describe('createCrtFrameStats', () => {
  it('counts consecutive presentedFrames as zero skips', () => {
    const s = createCrtFrameStats();
    s.observe(10); s.observe(11); s.observe(12);
    expect(s.snapshot()).toEqual({ drawn: 3, skipped: 0 });
  });
  it('counts the gap between callbacks as skipped frames', () => {
    const s = createCrtFrameStats();
    s.observe(10); s.observe(14);
    expect(s.snapshot()).toEqual({ drawn: 2, skipped: 3 });
    expect(s.observe(15)).toBe(0);
  });
  it('returns the skip count for the latest observation so the caller can log it', () => {
    const s = createCrtFrameStats();
    s.observe(1);
    expect(s.observe(4)).toBe(2);
  });
  it('ignores a missing metadata value (rAF driver) and still counts the draw', () => {
    const s = createCrtFrameStats();
    s.observe(undefined); s.observe(undefined);
    expect(s.snapshot()).toEqual({ drawn: 2, skipped: 0 });
  });
  it('resets on a counter that went backwards (new media element)', () => {
    const s = createCrtFrameStats();
    s.observe(100); s.observe(3);
    expect(s.snapshot()).toEqual({ drawn: 2, skipped: 0 });
  });
});
```

**Step 2: Run to verify failure** — `npx vitest run frontend/src/modules/Player/lib/crtFrameStats.test.js` → module not found.

**Step 3: Implement**

`frontend/src/modules/Player/lib/crtFrameStats.js`:
```js
// crtFrameStats.js — presented-vs-drawn accounting for the CRT canvas.
// requestVideoFrameCallback gives each callback `metadata.presentedFrames`, a
// monotonic count of frames the browser has composited for the element. If two
// consecutive callbacks differ by more than 1, the canvas never drew the frames
// in between: that is a VISIBLE drop the decoder's droppedVideoFrames does not
// record (2026-09-01 fitness "frame drops from the start").
export function createCrtFrameStats() {
  let drawn = 0;
  let skipped = 0;
  let last = null;
  return {
    /** @param {number|undefined} presentedFrames @returns {number} frames skipped since the previous draw */
    observe(presentedFrames) {
      drawn += 1;
      if (!Number.isFinite(presentedFrames)) return 0;
      let gap = 0;
      if (last !== null && presentedFrames > last) gap = presentedFrames - last - 1;
      last = presentedFrames;
      skipped += gap;
      return gap;
    },
    snapshot() { return { drawn, skipped }; },
  };
}
```

**Step 4: Run** — expect `5 passed`.

**Step 5: Wire into `crtRenderer.js`**

- Import `createCrtFrameStats`; create `const frameStats = createCrtFrameStats();` next to `frameCount`.
- Change `pump` to accept rVFC's arguments and log skips, sampled:
```js
  function pump(_now, metadata) {
    if (!running) return;
    const gap = frameStats.observe(metadata?.presentedFrames);
    if (gap > 0 && typeof log.sampled === 'function') {
      log.sampled('crt.frames-skipped', { skipped: gap, mediaTime: metadata?.mediaTime ?? null, ...frameStats.snapshot() }, { maxPerMinute: 6, aggregate: true });
    }
    drawFrame();
    schedule();
  }
```
- Expose `stats: () => frameStats.snapshot()` on the returned renderer object, and include `...frameStats.snapshot()` in the existing `crt.renderer-created`/teardown logs if there is a `stop()` log (add `log.info('crt.stopped', frameStats.snapshot())` in `stop()` if not).
- The `log` default at line 134 has no `sampled`; the `typeof` guard above keeps the fallback safe. The real child logger (`useCrtShader.js`) has `sampled`.

**Step 6: Run the Player lib suites** — `npx vitest run frontend/src/modules/Player/lib/` → all pass.

**Step 7: Commit**

```bash
git add frontend/src/modules/Player/lib/crtFrameStats.js frontend/src/modules/Player/lib/crtFrameStats.test.js frontend/src/modules/Player/lib/crtRenderer.js
git commit -m "feat(player): count and log frames the CRT canvas skipped (rVFC presentedFrames gaps)"
```

---

### Task 9: Backend — event-loop lag monitor (classifies the next 45 s hang)

Report: story-time, Incident A. Six `POST /log` calls took 8–43 s and released in the same instant as the stalled media request. A backend stall and a network stall look identical from outside; from inside they do not.

**Files:**
- Create: `backend/src/0_system/runtime/eventLoopLag.mjs`
- Create: `tests/isolated/system/eventLoopLag.test.mjs` (confirm `tests/isolated/system/` is a registered directory in `tests/_infrastructure/harnesses/isolated.harness.mjs:19-40`; if not, put the test beside the existing `tests/unit/system/*.test.mjs` files instead)
- Modify: the boot sequence next to `processMetrics.mjs` — find where that is started: `grep -rn "processMetrics" backend/src --include='*.mjs' | grep -v "0_system/runtime/processMetrics.mjs"` and start the lag monitor in the same place.

**Step 1: Failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { createEventLoopLagMonitor } from '#system/runtime/eventLoopLag.mjs';

describe('createEventLoopLagMonitor', () => {
  it('logs at warn when the max lag over a sample window exceeds the threshold', () => {
    const warn = vi.fn(); const info = vi.fn();
    const histogram = { max: 1_500e6, percentile: () => 40e6, reset: vi.fn() }; // nanoseconds
    const m = createEventLoopLagMonitor({ logger: { warn, info }, histogram, thresholdMs: 1000 });
    m.sample();
    expect(warn).toHaveBeenCalledWith('system.event-loop.lag', expect.objectContaining({ maxMs: 1500, p99Ms: 40 }));
    expect(histogram.reset).toHaveBeenCalled();
  });
  it('stays quiet below the threshold', () => {
    const warn = vi.fn();
    const m = createEventLoopLagMonitor({ logger: { warn, info() {} }, histogram: { max: 30e6, percentile: () => 20e6, reset() {} }, thresholdMs: 1000 });
    m.sample();
    expect(warn).not.toHaveBeenCalled();
  });
});
```
Confirm the `#system` import alias exists (`grep -n '"#system"' package.json`); otherwise use a relative path.

**Step 2: Run to verify failure** → module not found.

**Step 3: Implement**

```js
// eventLoopLag.mjs — samples perf_hooks.monitorEventLoopDelay and warns when the
// loop stalled. Exists so the next "every request from one device hung 45s"
// (2026-09-01 16:49) can be told apart from a network stall: a backend stall
// shows here, a network stall does not.
import { monitorEventLoopDelay } from 'node:perf_hooks';

export function createEventLoopLagMonitor({
  logger, histogram = monitorEventLoopDelay({ resolution: 20 }), thresholdMs = 1000, intervalMs = 5000,
} = {}) {
  let timer = null;
  const toMs = (ns) => Math.round(ns / 1e6);
  return {
    sample() {
      const maxMs = toMs(histogram.max);
      const p99Ms = toMs(histogram.percentile(99));
      if (maxMs >= thresholdMs) logger?.warn?.('system.event-loop.lag', { maxMs, p99Ms, thresholdMs });
      histogram.reset();
    },
    start() {
      if (timer) return;
      histogram.enable?.();
      timer = setInterval(() => this.sample(), intervalMs);
      timer.unref?.();
      logger?.info?.('system.event-loop.monitor-started', { thresholdMs, intervalMs });
    },
    stop() { if (timer) clearInterval(timer); timer = null; histogram.disable?.(); },
  };
}
```
Start it at boot with the backend's system logger child `{ app: 'system', module: 'event-loop' }`, where `processMetrics` is started.

**Step 4: Run** — expect `2 passed`. Then boot-check without a second live instance: **do not start `node backend/index.js` while the dev server runs** (it is a live household controller). Use `node --check backend/src/0_system/runtime/eventLoopLag.mjs` and `npm run test:composition-contracts`.

**Step 5: Commit**

```bash
git add backend/src/0_system/runtime/eventLoopLag.mjs tests/isolated/system/eventLoopLag.test.mjs <boot-file>
git commit -m "feat(system): event-loop lag monitor (warn on >1s stalls)"
```

---

### Task 10: Docs and report status

**Files:**
- Modify: `docs/reference/school/programs.md` (section "The kiosk menu gate", ~line 51): add the pending state, the 20 s ceiling, the server memo + invalidation events, and that the Videos grid redirects gated learners to the menu.
- Modify: `docs/reference/player/playback-encoding-resilience.md`: add a paragraph on backoff remounts — cancelled on `playing`, guarded at fire time (`player-remount-cancelled`, `player-remount-skipped`).
- Modify: `docs/reference/fitness/fitness-system-architecture.md`: in the zones/treasure section state the threshold precedence (`usersConfigOverrides` → `ZoneProfileStore` → global), that a missing profile is never cached, and that `FitnessSession` invalidates the box on profile sync. Note `crt.frames-skipped` as the measure of visible drops and that profiler fps is media-time based.
- Modify: the four `docs/_wip/bugs/2026-09-01-*.md` headers: `**Status:**` → "fixed on `fix/sept1-incident-remediation`, awaiting merge + deploy" (CRT report: "instrumented; cause still unconfirmed until a session runs with the new counter").
- Modify: `CLAUDE.md` Reading Logs section — add `system.event-loop.lag` to the useful queries list (one line).

**Step 1: Make the edits.** Keep instance-specific values (hosts, IPs, passwords) out of `docs/reference/`.

**Step 2: Freshness marker**

```bash
git rev-parse HEAD > docs/docs-last-updated.txt
```

**Step 3: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: lesson gate pending state, remount cancel/guard, treasure box threshold precedence, event-loop lag"
```

---

### Task 11: Whole-branch verification

**Step 1: Frontend + isolated suites touched by this branch**

```bash
npx vitest run frontend/src/modules/Player frontend/src/hooks/fitness frontend/src/modules/Piano/PianoKiosk tests/isolated/application/school tests/isolated/system 2>&1 | tail -15
```
Expected: all green. Any red is yours to fix before handing off — do not skip.

**Step 2: Layer audit and composition contracts**

```bash
npm run test:refactor 2>&1 | tail -5
npm run test:composition-contracts 2>&1 | tail -5
```
Expected: pass.

**Step 3: Hand-off**

Report to the user: the branch name, the commit list (`git log --oneline main..HEAD`), the two things that need a real device to confirm — (a) the piano kiosk shows "Checking today's lesson…" then the card after a cold learner switch, and Back from the assigned course lands on the card; (b) a garage session emits `crt.frames-skipped` (or doesn't) — and that nothing has been merged or deployed.

---

## Out of scope (deliberately)

- **FitnessChart re-rendering 13–14×/s** during `pending` governance. Real, flagged in three reports, but its cause has not been located and this plan does not guess. Once Task 8 ships, one garage session will show whether the skips track the thrash; that decides whether the chart is next.
- **The 45 s backend/network hang itself.** Task 9 classifies the next occurrence; it does not fix this one.
- **Season switching inside `SubcourseNavigator`.** Only shows labelled `subcourses` use it, and every season there belongs to the same enrolled course; any lesson counts.
