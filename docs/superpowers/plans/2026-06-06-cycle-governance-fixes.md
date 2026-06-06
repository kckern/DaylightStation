# Cycle Governance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two confirmed governance bugs — (1) a cycle lock that deadlocks after a rider swap because the HR base-requirement pause gate starves the cadence lock-recovery path, and (2) the HR/cycle governance engine continuing to run (firing challenges, locking) over the ungoverned CycleGame race because it never learns the race took over.

**Architecture:** Both fixes live in `GovernanceEngine` plus one React wiring change. Issue 1 is a one-line gate-ordering fix: a `locked` cycle must never be frozen by the base-requirement pause gate, so cadence recovery can always run. Issue 2 adds an explicit `suspended` flag to the engine (set true while the race widget owns the screen, false when it unmounts); a suspended engine goes dormant without disturbing `this.media`, so governance resumes cleanly when the race ends.

**Tech Stack:** Vanilla ES-module class (`GovernanceEngine.js`), React function components + Context (`FitnessContext.jsx`, `CycleGameContainer.jsx`), Vitest + @testing-library/react.

**Reference:** Root-cause analysis in `docs/_wip/audits/2026-06-06-cycle-governance-deadlock-and-stale-media-audit.md`.

**Test runner (all tasks):** from repo root `/opt/Code/DaylightStation`:
```
./node_modules/.bin/vitest run <relative/path/to/test> --config vitest.config.mjs -t "<test name>"
```
(The positional path is a filter; vitest may also match copies under `.claude/worktrees/` — that is harmless, every copy asserts the same thing.)

**Out of scope (deliberate):** `swapCycleRider` inherits the current (hardest) `currentPhaseIndex` for the new rider — a contributing factor to *why* the lock happened, but it is arguably correct tag-team behavior and changing it is a product decision, not a bug fix. Not addressed here. See the audit's "Contributing factor" note.

---

## File Structure

- `frontend/src/hooks/fitness/GovernanceEngine.js` — **modify.** Issue 1: gate condition at the cycle pause gate. Issue 2: add `_suspended` field (constructor), `setSuspended()` method, and a suspend short-circuit in `evaluate()`.
- `frontend/src/hooks/fitness/CycleStateMachine.test.js` — **modify.** Add the Issue 1 regression test (reuses the file's existing `makeEngineWithActiveCycle` helper).
- `frontend/src/hooks/fitness/GovernanceEngine.suspend.test.js` — **create.** Self-contained Issue 2 engine test.
- `frontend/src/context/FitnessContext.jsx` — **modify.** Add `setGovernanceSuspended` callback and expose it in the context value.
- `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` — **modify.** Suspend governance on mount, resume on unmount.
- `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.test.jsx` — **modify.** Add mount/unmount suspend-wiring assertion.

---

## Task 1: Issue 1 — A locked cycle must recover from cadence even when global base-req is unmet

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:2779`
- Test: `frontend/src/hooks/fitness/CycleStateMachine.test.js` (append a new `describe` block)

**Background:** `_evaluateCycleChallenge` (GovernanceEngine.js:2752) early-returns at the base-requirement pause gate (line 2779) when `ctx.baseReqSatisfiedGlobal === false`. The locked→maintain recovery branch (line ~2997, `if (ctx.equipmentRpm >= phase.hiRpm)`) lives *below* that return and is never reached. After a rider swap the new rider's HR hasn't reached zone, so `baseReqSatisfiedGlobal` (which is just `this.phase === 'unlocked'`) is false, and the cycle stays locked forever no matter how fast they pedal. Fix: exempt `cycleState === 'locked'` from the pause gate.

- [ ] **Step 1: Write the failing test**

Append to the END of `frontend/src/hooks/fitness/CycleStateMachine.test.js` (after the last `describe` block, before EOF). It reuses `makeEngineWithActiveCycle` already defined near the top of that file.

```javascript
describe('Cycle SM — locked cycle recovers from cadence despite unmet global base-req (rider-swap deadlock)', () => {
  it('recovers a locked cycle from cadence even when baseReqSatisfiedGlobal is false', () => {
    const { engine, getNow, advance } = makeEngineWithActiveCycle();
    const active = engine.challengeState.activeChallenge;

    // Reproduce the post-swap ramp-lock: a NON-manual challenge (manual
    // triggers bypass the pause gate), already locked, on phase 0.
    active.manualTrigger = false;
    active.cycleState = 'locked';
    active.lockReason = 'ramp';
    active.currentPhaseIndex = 0;
    active._pausedAt = null;
    active._lastCycleTs = getNow();

    // POLICY hi_rpm_range is [60,60] → phase.hiRpm === 60. Pedal well past it
    // while the global HR base-requirement is UNMET (the deadlock condition).
    advance(200);
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 90,
      activeParticipants: ['user_2'],
      userZoneMap: { user_2: 'cool' },
      baseReqSatisfiedForRider: false,
      baseReqSatisfiedGlobal: false
    });

    expect(active.cycleState).toBe('maintain');
    expect(active.lockReason).toBe(null);
  });

  it('still freezes a non-locked cycle (init/ramp/maintain) when global base-req is unmet', () => {
    const { engine, getNow, advance } = makeEngineWithActiveCycle();
    const active = engine.challengeState.activeChallenge;
    active.manualTrigger = false;
    active.cycleState = 'maintain';
    active.lockReason = null;
    active.currentPhaseIndex = 0;
    active._pausedAt = null;
    active._lastCycleTs = getNow();

    advance(200);
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 90,
      activeParticipants: ['user_2'],
      userZoneMap: { user_2: 'cool' },
      baseReqSatisfiedForRider: false,
      baseReqSatisfiedGlobal: false
    });

    // Pause gate still applies to non-locked states: frozen, _pausedAt stamped.
    expect(active.cycleState).toBe('maintain');
    expect(active._pausedAt).not.toBe(null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```
./node_modules/.bin/vitest run frontend/src/hooks/fitness/CycleStateMachine.test.js --config vitest.config.mjs -t "recovers a locked cycle from cadence"
```
Expected: FAIL — `expected 'locked' to be 'maintain'` (the pause gate returns before the recovery branch). The second test ("still freezes a non-locked cycle") should already PASS.

- [ ] **Step 3: Apply the minimal fix**

In `frontend/src/hooks/fitness/GovernanceEngine.js`, change the pause-gate condition at line 2779.

Find:
```javascript
    if (ctx.baseReqSatisfiedGlobal === false && !active.manualTrigger) {
```

Replace with:
```javascript
    // A locked cycle (health/ramp/init) must ALWAYS remain escapable by
    // cadence — the rider pedals back into the green to resume. The base-
    // requirement pause gate (HR governance) must not freeze a locked cycle,
    // or a swapped-in rider whose HR hasn't yet caught up can never recover
    // (deadlock — see docs/_wip/audits/2026-06-06-cycle-governance-deadlock-
    // and-stale-media-audit.md). Non-locked states still freeze as before.
    if (ctx.baseReqSatisfiedGlobal === false && !active.manualTrigger && active.cycleState !== 'locked') {
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```
./node_modules/.bin/vitest run frontend/src/hooks/fitness/CycleStateMachine.test.js --config vitest.config.mjs -t "rider-swap deadlock"
```
Expected: PASS (both tests in the new describe block).

- [ ] **Step 5: Run the full cycle state-machine suite to confirm no regressions**

Run:
```
./node_modules/.bin/vitest run frontend/src/hooks/fitness/CycleStateMachine.test.js --config vitest.config.mjs
```
Expected: all tests pass (the prior count plus the 2 new ones).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/CycleStateMachine.test.js
git commit -m "fix(cycle-governance): let a locked cycle recover from cadence despite unmet base-req

A rider swap left the new rider's HR below the base requirement, which flipped
baseReqSatisfiedGlobal false and froze the cycle update before the lock-recovery
branch — the video could never be pedalled out of the lock. Exempt cycleState
'locked' from the base-req pause gate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Issue 2 (engine) — `setSuspended()` makes the engine dormant without dropping its media

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (constructor ~line 222; new method after `setMedia` ~line 1189; `evaluate()` gate ~line 2087)
- Test: `frontend/src/hooks/fitness/GovernanceEngine.suspend.test.js` (create)

**Background:** Governance only runs when `_mediaIsGoverned()` is true, which depends entirely on `this.media`. When the CycleGame race takes over the screen, the paused governed video stays as `this.media`, so the engine keeps evaluating zones and firing challenges over the race. We add an explicit suspend switch: while suspended the engine resets to idle and returns each `evaluate()`, but `this.media` is untouched so governance resumes when the race unmounts.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/GovernanceEngine.suspend.test.js`:

```javascript
// Issue 2 — governance must go dormant while suspended (e.g. the CycleGame
// race owns the screen) even though this.media still points at the paused
// governed video. See docs/_wip/audits/2026-06-06-cycle-governance-deadlock-
// and-stale-media-audit.md.
import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

function buildSession() {
  return {
    _deviceRouter: { getEquipmentCatalog: () => [] },
    getParticipantProfile: () => null,
    zoneProfileStore: null,
    getActiveParticipantState: () => ({
      participants: ['user_2'],
      zoneMap: { user_2: 'active' },
      totalCount: 1
    })
  };
}

const POLICY = {
  governed_labels: ['cardio'],
  grace_period_seconds: 30,
  policies: {
    default: {
      name: 'Default',
      base_requirement: [{ active: 'all' }],
      challenges: []
    }
  }
};

function makeEngine() {
  let now = 100000;
  const engine = new GovernanceEngine(buildSession(), { now: () => now });
  engine.configure(POLICY);
  engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
  return { engine, advance: (d) => { now += d; return now; } };
}

const EVAL_ARGS = {
  activeParticipants: ['user_2'],
  userZoneMap: { user_2: 'active' },
  zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
  zoneInfoMap: { active: { id: 'active', name: 'Active' } },
  totalCount: 1
};

describe('GovernanceEngine — suspend switch', () => {
  it('engages governance (phase unlocked) when NOT suspended and base-req is met', () => {
    const { engine, advance } = makeEngine();
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.phase).toBe('unlocked');
  });

  it('stays dormant (phase null) while suspended, even with governed media + satisfied base-req', () => {
    const { engine, advance } = makeEngine();
    engine.setSuspended(true);
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.phase).toBe(null);
    expect(engine.challengeState.activeChallenge).toBe(null);
  });

  it('re-engages after the race ends (setSuspended(false))', () => {
    const { engine, advance } = makeEngine();
    engine.setSuspended(true);
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.phase).toBe(null);

    engine.setSuspended(false);
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.phase).toBe('unlocked');
  });

  it('does not drop this.media while suspended', () => {
    const { engine, advance } = makeEngine();
    engine.setSuspended(true);
    advance(200);
    engine.evaluate(EVAL_ARGS);
    expect(engine.media).toEqual({ id: 'v1', type: 'episode', labels: ['cardio'] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```
./node_modules/.bin/vitest run frontend/src/hooks/fitness/GovernanceEngine.suspend.test.js --config vitest.config.mjs
```
Expected: FAIL — `engine.setSuspended is not a function` on the suspend tests. (The first test, "engages governance when NOT suspended", should PASS, confirming the harness reaches `unlocked`.)

> If the first test does NOT reach `phase === 'unlocked'`, stop and inspect: the harness/policy is wrong, not the fix. Do not proceed until the not-suspended baseline is green.

- [ ] **Step 3: Add the `_suspended` field to the constructor**

In `frontend/src/hooks/fitness/GovernanceEngine.js`, find (line ~222):
```javascript
    this.media = null;
    this.phase = 'pending'; // pending, unlocked, warning, locked
```
Replace with:
```javascript
    this.media = null;
    // True while an ungoverned takeover (e.g. the CycleGame race) owns the
    // screen. A suspended engine goes idle every evaluate() WITHOUT dropping
    // this.media, so governance resumes cleanly when the takeover unmounts.
    this._suspended = false;
    this.phase = 'pending'; // pending, unlocked, warning, locked
```

- [ ] **Step 4: Add the `setSuspended` method**

In the same file, find the end of `setMedia` (line ~1189):
```javascript
  setMedia(media) {
    this.media = media;
    this._invalidateStateCache();
    // Re-evaluate when governed media is set so phase transitions from null→pending
    if (media && this._mediaIsGoverned()) {
      this._triggerPulse();
    }
  }
```
Insert immediately AFTER that closing brace:
```javascript

  /**
   * Suspend/resume governance for an ungoverned screen takeover (CycleGame
   * race). While suspended, evaluate() resets to idle and returns without
   * touching this.media. Resuming triggers an immediate re-evaluation.
   */
  setSuspended(suspended) {
    const next = Boolean(suspended);
    if (this._suspended === next) return;
    this._suspended = next;
    this._invalidateStateCache();
    getLogger().info('governance.suspended_changed', { suspended: next });
    if (!next) {
      this._triggerPulse();
    }
  }
```

- [ ] **Step 5: Add the suspend short-circuit to `evaluate()`**

In the same file, find the governed-media gate (line ~2087):
```javascript
    const hasGovernedMedia = this._mediaIsGoverned();
    if (!hasGovernedMedia) {
```
Insert immediately BEFORE that `const hasGovernedMedia` line:
```javascript
    // Ungoverned takeover (CycleGame race owns the screen): go fully dormant
    // even though this.media still points at the paused governed video.
    // Without this the engine keeps evaluating HR zones and firing challenges
    // over the race (see 2026-06-06 audit). this.media is preserved so the
    // next un-suspended evaluate() re-engages on the same video.
    if (this._suspended) {
      getLogger().sampled('governance.evaluate.suspended', {
        contentId: this.media?.id
      }, { maxPerMinute: 2, aggregate: true });
      this._resetToIdle();
      return;
    }

```

- [ ] **Step 6: Run the test to verify it passes**

Run:
```
./node_modules/.bin/vitest run frontend/src/hooks/fitness/GovernanceEngine.suspend.test.js --config vitest.config.mjs
```
Expected: PASS (all 4 tests).

- [ ] **Step 7: Run the neighbouring governance suites to confirm no regressions**

Run:
```
./node_modules/.bin/vitest run frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js frontend/src/hooks/fitness/GovernanceEngine.inactiveFilter.test.js frontend/src/hooks/fitness/CycleStateMachine.test.js --config vitest.config.mjs
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/GovernanceEngine.suspend.test.js
git commit -m "feat(cycle-governance): add GovernanceEngine.setSuspended() dormancy switch

While suspended the engine resets to idle each evaluate() but keeps this.media,
so governance can be parked during an ungoverned screen takeover (CycleGame
race) and resume cleanly when it ends. Wiring follows in the next commit.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Issue 2 (wiring) — suspend governance while the CycleGame race owns the screen

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx` (callback after `setGovernanceMedia` ~line 1133; expose in value ~line 2342)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` (mount/unmount effect near top, ~line 40)
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.test.jsx` (add a test + add `setGovernanceSuspended` to the mock ctx)

- [ ] **Step 1: Write the failing test**

In `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.test.jsx`, first add a `setGovernanceSuspended` stub to the shared `makeCtx` factory. Find the tail of the `return { ... }` object in `makeCtx` (the lines ending with `getUserByName: (id) => ({ name: vitals[id]?.name || id }),` then `...overrides`). Insert the stub just before `...overrides`:

```javascript
    getUserByName: (id) => ({ name: vitals[id]?.name || id }),
    setGovernanceSuspended: vi.fn(),
    ...overrides
```

Then append a new `describe` block at the end of the file:

```javascript
describe('CycleGameContainer — governance suspension', () => {
  beforeEach(() => { mockCtx = makeCtx(); });

  it('suspends governance on mount and resumes it on unmount', () => {
    const suspendSpy = vi.fn();
    mockCtx = makeCtx({ setGovernanceSuspended: suspendSpy });

    let view;
    act(() => { view = render(<CycleGameContainer />); });
    expect(suspendSpy).toHaveBeenCalledWith(true);

    act(() => { view.unmount(); });
    expect(suspendSpy).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```
./node_modules/.bin/vitest run frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.test.jsx --config vitest.config.mjs -t "governance suspension"
```
Expected: FAIL — `suspendSpy` was never called (the container does not yet call `setGovernanceSuspended`).

- [ ] **Step 3: Add the `setGovernanceSuspended` callback to FitnessContext**

In `frontend/src/context/FitnessContext.jsx`, find the end of the `setGovernanceMedia` callback (line ~1133):
```javascript
    session.governanceEngine.setMedia(media);
    forceUpdate();
  }, [forceUpdate]);
```
Insert immediately AFTER that (after the closing `}, [forceUpdate]);`):
```javascript

  // Park/unpark HR + cycle governance while an ungoverned screen takeover
  // (the CycleGame race) owns the display. Keyed to the race container's
  // mount/unmount. See docs/_wip/audits/2026-06-06-cycle-governance-deadlock-
  // and-stale-media-audit.md (Issue 2).
  const setGovernanceSuspended = React.useCallback((suspended) => {
    const session = fitnessSessionRef.current;
    if (!session) return;
    session.governanceEngine.setSuspended(Boolean(suspended));
    forceUpdate();
  }, [forceUpdate]);
```

- [ ] **Step 4: Expose `setGovernanceSuspended` in the context value**

In the same file, find the context value object (line ~2342):
```javascript
    setGovernanceMedia,
    updateGovernancePhase,
```
Replace with:
```javascript
    setGovernanceMedia,
    setGovernanceSuspended,
    updateGovernancePhase,
```

- [ ] **Step 5: Call it from CycleGameContainer on mount/unmount**

In `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx`, find the top of the component (line ~39):
```javascript
  const ctx = useFitnessContext();
  const log = useMemo(() => getLogger().child({ component: 'cycle-game' }), []);
```
Insert immediately AFTER the `log` line:
```javascript

  // Suspend HR/cycle governance for as long as the race owns the screen. The
  // paused governed video remains the engine's media, so without this the
  // engine keeps evaluating zones and firing challenges over the race (see
  // the 2026-06-06 governance audit). setGovernanceSuspended is a stable
  // useCallback, so this effect runs exactly once on mount / once on unmount.
  const setGovernanceSuspended = ctx?.setGovernanceSuspended;
  useEffect(() => {
    if (!setGovernanceSuspended) return undefined;
    setGovernanceSuspended(true);
    return () => setGovernanceSuspended(false);
  }, [setGovernanceSuspended]);
```

(`useEffect` and `useMemo` are already imported at the top of this file — no import change needed.)

- [ ] **Step 6: Run the test to verify it passes**

Run:
```
./node_modules/.bin/vitest run frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.test.jsx --config vitest.config.mjs
```
Expected: PASS — the new "governance suspension" test plus all pre-existing CycleGameContainer tests (the added `setGovernanceSuspended: vi.fn()` in `makeCtx` keeps the others green).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.test.jsx
git commit -m "fix(cycle-game): suspend governance while the race owns the screen

CycleGameContainer now parks the GovernanceEngine on mount and resumes it on
unmount via FitnessContext.setGovernanceSuspended. Stops HR/cycle challenges
and locks from firing over the ungoverned race (and its recap) while the
paused governed video lingers as the engine's media.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full regression sweep + prod verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole fitness-hooks + cycle-game test surface**

Run:
```
./node_modules/.bin/vitest run frontend/src/hooks/fitness frontend/src/modules/Fitness/widgets/CycleGame --config vitest.config.mjs
```
Expected: all pass. If anything fails, return to the owning task — do not patch over it here.

- [ ] **Step 2: Build + deploy to prod (kckern-server)**

```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 3: Hard-reload the garage fitness display**

```bash
ssh garage 'DISPLAY=:0 XAUTHORITY=/home/kckern/.Xauthority \
  xdotool search --onlyvisible --class firefox windowactivate --sync key ctrl+shift+r'
```

- [ ] **Step 4: Verify Issue 1 from logs (lock recovers after a swap)**

Reproduce: start a governed video, let a cycle challenge lock, swap riders, pedal the new rider past the green (hi-RPM) tick. Then inspect the newest session log:
```bash
ls -t /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/logs/fitness/*.jsonl | head -1
```
Grep that file for the recovery after a swap:
```bash
grep -aE '"governance.cycle.(swap_completed|locked|recovered)"' <newest>.jsonl \
 | grep -oaE '"ts":"[^"]*"|"event":"[^"]*"|"lockReason":"[^"]*"'
```
Expected: after a `swap_completed` and a `locked`, a `governance.cycle.recovered` appears once the rider exceeds hi-RPM. (Before this fix there was a `locked` with no following `recovered`.)

- [ ] **Step 5: Verify Issue 2 from logs (no governance over the race)**

Reproduce: launch the CycleGame race over a governed video; run a full race; let the recap show. Then in the newest session log, confirm the engine was suspended for the race window and fired no challenges during/after it while the game was open:
```bash
grep -ac '"governance.evaluate.suspended"' <newest>.jsonl   # expect > 0 during the race
# Confirm no HR/cycle challenge started between race_started and the recap closing:
grep -aE '"cycle_game.(race_started|race_finished|recap_closed)"|"governance.challenge.started"|"governance.cycle.started"' <newest>.jsonl \
 | grep -oaE '"ts":"[^"]*"|"event":"[^"]*"'
```
Expected: `governance.evaluate.suspended` present across the race; **no** `governance.challenge.started` / `governance.cycle.started` timestamps fall between `race_started` and `recap_closed`.

- [ ] **Step 6: Update the audit doc status**

Append a short "Resolved 2026-06-06 — see docs/superpowers/plans/2026-06-06-cycle-governance-fixes.md" line to the top of `docs/_wip/audits/2026-06-06-cycle-governance-deadlock-and-stale-media-audit.md`, then commit:
```bash
git add docs/_wip/audits/2026-06-06-cycle-governance-deadlock-and-stale-media-audit.md
git commit -m "docs(cycle-governance): mark deadlock + stale-media audit resolved

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** Issue 1 → Task 1 (gate exemption). Issue 2 → Task 2 (engine `setSuspended`) + Task 3 (wiring). Verification → Task 4. The swap phase-inheritance is explicitly out of scope (documented above).
- **Type/name consistency:** `setSuspended(boolean)` on the engine; `setGovernanceSuspended(boolean)` on the context; `_suspended` field; log events `governance.suspended_changed`, `governance.evaluate.suspended`. These names are used identically across Tasks 2–4.
- **No placeholders:** every code step shows exact find/replace text and exact run commands with expected output.
- **Manual-trigger interaction (Task 1):** manual cycle challenges set `manualTrigger=true` and already bypass the pause gate, so the Task 1 change only affects real (non-manual) challenges — exactly the swap-deadlock case.
- **Media preservation (Task 2):** `setSuspended` never touches `this.media`; `_resetToIdle` preserves an active cycle challenge and seeded zone maps, and sets `phase = null`, which is what the Task 2 tests assert.
