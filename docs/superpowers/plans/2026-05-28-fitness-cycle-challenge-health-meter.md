# Cycle Challenge Health-Meter Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cycle challenge's below-threshold *punishment* (the 3-second danger grace, the `maintain→locked` flashing danger ring + countdown, and the separate cycle-lock panel) with the **health-meter pattern**: while RPM is below the red line the health meter depletes; when it hits zero the **video pauses**; it resumes (and health regenerates) when RPM is back in the **green zone**. The lower-hemisphere **phase-progress arc stays** (positive-progress indicator) — only the punishment changes.

**Architecture:** Add a `cycleHealthMs` pool to the active cycle challenge. In `maintain`, RPM below `loRpm` depletes it, RPM at/above `hiRpm` regenerates it (and accumulates phase progress as today), the amber `lo..hi` band holds it. Health reaching zero transitions to `cycleState: 'locked'` with `lockReason: 'health'`, which — via a fixed `videoLocked` gate — pauses playback even though governance `phase` is `unlocked`. Recovery to `maintain` (and resume) happens when RPM reaches `hiRpm`. The overlay swaps the danger ring/countdown for a compact health meter bound to a new `cycleHealthPct` snapshot field; the separate cycle-lock panel is removed.

**Tech Stack:** React, SCSS, Vitest + @testing-library/react. Engine tested through the `CycleStateMachine.test.js` harness (`makeEngineWithActiveCycle`, `tick`, `advance`; POLICY fixture has `hiRpm=60`, `loRpm=30`).

**Source audit:** `docs/_wip/audits/2026-05-28-fitness-session-multi-issue-postmortem-audit.md` (Issue 4). Supersedes the danger-ring/grace mechanic added in `docs/superpowers/plans/2026-05-28-cycle-challenge-logic-ux-integration.md`.

**Chosen parameters (tunable; stated so there are no placeholders):**
- `CYCLE_HEALTH_MAX_MS = 3000` (≈ the old 3 s grace)
- `CYCLE_HEALTH_DEPLETE_RATE = 1` (1 ms health lost per 1 ms below `loRpm` → ~3 s below red to pause)
- `CYCLE_HEALTH_REGEN_RATE = 1.5` (refills from empty in ~2 s while in green)
- Health **resets to full** on challenge start and on each `ramp→maintain` phase entry, and on recovery from a health-lock.
- Deplete zone = below `loRpm`; hold zone = `lo..hi`; regen + progress zone = `≥ hiRpm`; recover-from-pause = `≥ hiRpm` ("green").

**Run a single Vitest spec (repo root):** `frontend/node_modules/.bin/vitest run --config vitest.config.mjs <path-to-spec>`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Cycle state machine + snapshot + videoLocked | Replace danger grace with `cycleHealthMs`; lock at zero (`lockReason:'health'`); recover at green; snapshot `cycleHealthPct`; fix `videoLocked` gate for cycle health-lock |
| `frontend/src/hooks/fitness/CycleStateMachine.test.js` | Engine specs | Replace hysteresis specs with health-meter specs |
| `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js` | Display projection | Cycle health-lock → `videoLocked: true` |
| `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js` | Visuals mapping | Remove danger fields; add `cycleHealthPct` |
| `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js` | Visuals specs | Swap danger specs for health specs |
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx` | Overlay markup | Remove danger ring + countdown; add health meter; keep `__phase-arc` |
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx` | Overlay specs | Swap danger-ring specs for health-meter specs |
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss` | Styling | Remove danger-ring/countdown styles; add health-meter styles |
| `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.jsx` | Lock panel host | Remove the `computeCycleLockPanelData` branch + import |

---

## Task 1: Engine — replace danger grace with a health meter

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`
- Test: `frontend/src/hooks/fitness/CycleStateMachine.test.js`

- [ ] **Step 1: Write the failing tests**

In `CycleStateMachine.test.js`, REPLACE the entire `describe('Cycle SM — maintain grace hysteresis', …)` block with:

```js
describe('Cycle SM — health meter (2026-05-28 redesign)', () => {
  function intoMaintain(engine, advance) {
    for (let i = 0; i < 5; i += 1) {
      advance(200);
      tick(engine, engine._now(), { zone: 'warm', rpm: 80 });
    }
    expect(engine.challengeState.activeChallenge.cycleState).toBe('maintain');
  }

  it('starts maintain at full health', () => {
    const { engine, advance } = makeEngineWithActiveCycle(21);
    intoMaintain(engine, advance);
    const a = engine.challengeState.activeChallenge;
    expect(a.cycleHealthMs).toBe(3000);
  });

  it('depletes health below loRpm and locks (lockReason health) at zero', () => {
    const { engine, advance } = makeEngineWithActiveCycle(22);
    intoMaintain(engine, advance);
    // Sustain rpm=1 (well below lo=30). EMA crosses lo within ~2 ticks; then
    // ~3s of depletion empties the 3000ms health pool. 25 × 200ms = 5s covers it.
    let locked = false;
    for (let i = 0; i < 25 && !locked; i += 1) {
      advance(200);
      tick(engine, engine._now(), { zone: 'warm', rpm: 1 });
      if (engine.challengeState.activeChallenge.cycleState === 'locked') locked = true;
    }
    expect(locked).toBe(true);
    expect(engine.challengeState.activeChallenge.lockReason).toBe('health');
    expect(engine.challengeState.activeChallenge.cycleHealthMs).toBe(0);
  });

  it('regenerates health when back in the green zone (>= hiRpm)', () => {
    const { engine, advance } = makeEngineWithActiveCycle(23);
    intoMaintain(engine, advance);
    // Drain partway below lo.
    for (let i = 0; i < 5; i += 1) { advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 1 }); }
    const drained = engine.challengeState.activeChallenge.cycleHealthMs;
    expect(drained).toBeLessThan(3000);
    // Back to green for a while.
    for (let i = 0; i < 5; i += 1) { advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 80 }); }
    expect(engine.challengeState.activeChallenge.cycleHealthMs).toBeGreaterThan(drained);
  });

  it('recovers from a health lock and resets health when RPM returns to green', () => {
    const { engine, advance } = makeEngineWithActiveCycle(24);
    intoMaintain(engine, advance);
    for (let i = 0; i < 25; i += 1) { advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 1 }); }
    expect(engine.challengeState.activeChallenge.cycleState).toBe('locked');
    // Pedal back into green.
    for (let i = 0; i < 3; i += 1) { advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 90 }); }
    const a = engine.challengeState.activeChallenge;
    expect(a.cycleState).toBe('maintain');
    expect(a.cycleHealthMs).toBe(3000);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/CycleStateMachine.test.js`
Expected: FAIL — `cycleHealthMs` doesn't exist; `lockReason` is `'maintain'` not `'health'`.

- [ ] **Step 3: Add health constants; remove the danger constant**

In `GovernanceEngine.js`, near the top where `CYCLE_DANGER_GRACE_MS` is declared (line ~30), REMOVE it and add:
```js
// Cycle challenge "health" pool: depletes while RPM is below loRpm, regenerates
// while in the green zone (>= hiRpm). At zero the video pauses until the rider
// is back in green. Replaces the old 3-second danger grace.
const CYCLE_HEALTH_MAX_MS = 3000;
const CYCLE_HEALTH_DEPLETE_RATE = 1;    // ms health lost per ms below loRpm
const CYCLE_HEALTH_REGEN_RATE = 1.5;    // ms health gained per ms in green
```

- [ ] **Step 4: Seed health; remove danger fields in `_startCycleChallenge`**

In `_startCycleChallenge`, REMOVE the `dangerSinceMs: null,` and `dangerRecoverySinceMs: null,` lines and add:
```js
      cycleHealthMs: CYCLE_HEALTH_MAX_MS,
```

- [ ] **Step 5: Rewrite the maintain branch**

In `_evaluateCycleChallenge`, replace the entire `if (active.cycleState === 'maintain') { … }` block's danger logic. Keep the `>= phase.hiRpm` progress-accumulation block (boost, `phaseProgressMs`, phase-advance/success) intact, but wrap it with health regen and replace the below-lo/amber handling. The new branch:

```js
    if (active.cycleState === 'maintain') {
      const phase = active.generatedPhases[active.currentPhaseIndex];

      if (ctx.equipmentRpm < phase.loRpm) {
        // Below the red line — deplete health; pause (lock) when empty.
        active.cycleHealthMs = Math.max(0, active.cycleHealthMs - dt * CYCLE_HEALTH_DEPLETE_RATE);
        if (active.cycleHealthMs <= 0) {
          active.cycleState = 'locked';
          active.lockReason = 'health';
          active.totalLockEventsCount += 1;
          getLogger().info('governance.cycle.state_transition', {
            challengeId: active.id, from: 'maintain', to: 'locked',
            currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
            currentRpm: ctx.equipmentRpm, reason: 'health_depleted'
          });
          getLogger().info('governance.cycle.locked', {
            challengeId: active.id, lockReason: 'health', phaseIndex: active.currentPhaseIndex,
            currentRpm: ctx.equipmentRpm, threshold: phase.loRpm,
            totalLockEventsCount: active.totalLockEventsCount
          });
        }
        return; // below lo: no progress
      }

      if (ctx.equipmentRpm >= phase.hiRpm) {
        // Green — regenerate health AND accumulate phase progress.
        active.cycleHealthMs = Math.min(CYCLE_HEALTH_MAX_MS, active.cycleHealthMs + dt * CYCLE_HEALTH_REGEN_RATE);

        const { multiplier, contributors } = this._computeBoostMultiplier(active, ctx);
        const progressAdd = dt * multiplier;
        active.phaseProgressMs += progressAdd;
        if (multiplier > 1.0) {
          active.totalBoostedMs += (progressAdd - dt);
          contributors.forEach(u => active.boostContributors.add(u));
        }
        if (active.phaseProgressMs >= phase.maintainSeconds * 1000) {
          const prev = active.currentPhaseIndex;
          if (active.currentPhaseIndex + 1 >= active.generatedPhases.length) {
            active.status = 'success';
            active.completedAt = now;
            getLogger().info('governance.cycle.state_transition', {
              challengeId: active.id, from: 'maintain', to: 'success',
              currentPhaseIndex: prev, rider: active.rider, currentRpm: ctx.equipmentRpm
            });
          } else {
            active.currentPhaseIndex += 1;
            active.cycleState = 'ramp';
            active.rampElapsedMs = 0;
            active.phaseProgressMs = 0;
            active.cycleHealthMs = CYCLE_HEALTH_MAX_MS; // fresh health each phase
            getLogger().info('governance.cycle.phase_advanced', {
              challengeId: active.id, fromPhaseIndex: prev, toPhaseIndex: active.currentPhaseIndex,
              elapsedMs: phase.maintainSeconds * 1000, boostedMs: Math.round(active.totalBoostedMs)
            });
            getLogger().info('governance.cycle.state_transition', {
              challengeId: active.id, from: 'maintain', to: 'ramp',
              currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
              currentRpm: ctx.equipmentRpm, reason: 'phase_complete'
            });
          }
        }
        return;
      }

      // Amber band (lo..hi): hold health and progress, no change.
      return;
    }
```

(This replaces the previous maintain branch in full. The boost/progress sub-logic is copied verbatim from the existing `>= phase.hiRpm` block so nothing about phase completion changes.)

- [ ] **Step 6: Add `'health'` to the locked-branch recovery + reset health**

In the `if (active.cycleState === 'locked') { … }` branch, the recovery clause for `lockReason === 'ramp' || lockReason === 'maintain'` recovers to `maintain` when `equipmentRpm >= phase.hiRpm`. Extend it to include `'health'` and reset the pool:
```js
      if (active.lockReason === 'ramp' || active.lockReason === 'maintain' || active.lockReason === 'health') {
        if (ctx.equipmentRpm >= phase.hiRpm) {
          const prevLockReason = active.lockReason;
          active.cycleState = 'maintain';
          if (prevLockReason === 'ramp') active.phaseProgressMs = 0;
          active.cycleHealthMs = CYCLE_HEALTH_MAX_MS;
          active.lockReason = null;
          getLogger().info('governance.cycle.state_transition', {
            challengeId: active.id, from: 'locked', to: 'maintain',
            currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
            currentRpm: ctx.equipmentRpm, reason: 'recovered_from_health_lock'
          });
          return;
        }
      }
```
(Preserve the existing `lockReason === 'init'` recovery clause unchanged.)

- [ ] **Step 7: Run the engine tests**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/CycleStateMachine.test.js`
Expected: PASS (the 4 new health specs + all pre-existing init/ramp/noise specs). If a pre-existing spec referenced `dangerSinceMs` or `recovered_from_maintain_lock`, update it to the health-equivalent (the redesign removes those).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/CycleStateMachine.test.js
git commit -m "feat(fitness): cycle challenge health meter replaces danger grace

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Engine — snapshot `cycleHealthPct` + pause the video on health-lock

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (`_buildChallengeSnapshot` + `_composeState`)
- Test: `frontend/src/hooks/fitness/CycleStateMachine.test.js`

- [ ] **Step 1: Write the failing test**

Append to the health-meter `describe` in `CycleStateMachine.test.js`:

```js
  it('exposes cycleHealthPct in the snapshot and pauses video on health lock', () => {
    const { engine, advance } = makeEngineWithActiveCycle(25);
    function intoMaintain() {
      for (let i = 0; i < 5; i += 1) { advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 80 }); }
    }
    intoMaintain();
    // Full health → pct 1, video not locked.
    let snap = engine.state.challenge;
    expect(snap.cycleHealthPct).toBeCloseTo(1, 1);
    expect(engine.state.videoLocked).toBe(false);

    // Drain to a health lock.
    for (let i = 0; i < 25; i += 1) { advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 1 }); }
    snap = engine.state.challenge;
    expect(snap.cycleHealthPct).toBe(0);
    // Cycle health lock pauses the video even though governance phase is unlocked.
    expect(engine.state.videoLocked).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/CycleStateMachine.test.js`
Expected: FAIL — `cycleHealthPct` is undefined and `videoLocked` stays false during a cycle lock.

- [ ] **Step 3: Snapshot the health pct; remove danger fields**

In `_buildChallengeSnapshot`, REMOVE the danger computation block (`DANGER_GRACE_MS_SNAPSHOT`, `dangerActive`, `dangerElapsedMs`, `dangerRemainingMs`, `dangerProgress`) and the `dangerActive/dangerRemainingMs/dangerProgress` keys in the returned object. Add to the returned object:
```js
        cycleHealthPct: Number.isFinite(activeChallenge.cycleHealthMs)
          ? Math.max(0, Math.min(1, activeChallenge.cycleHealthMs / CYCLE_HEALTH_MAX_MS))
          : 1,
```
(Keep the `fatal` debounce-bypass line, but change `activeChallenge.lockReason === 'init'` to also bypass for `lockReason === 'health'` so a health-lock surfaces immediately: `const fatal = activeChallenge.status === 'success' || activeChallenge.lockReason === 'init' || activeChallenge.lockReason === 'health';`)

- [ ] **Step 4: Fix the `videoLocked` gate for cycle health-lock**

In `_composeState`, the `videoLocked` field (line ~1724) currently:
```js
      videoLocked: (this.challengeState?.videoLocked || this._mediaIsGoverned())
        && this.phase !== 'unlocked' && this.phase !== 'warning',
```
Replace with:
```js
      videoLocked: ((this.challengeState?.videoLocked || this._mediaIsGoverned())
          && this.phase !== 'unlocked' && this.phase !== 'warning')
        || (this.challengeState?.activeChallenge?.type === 'cycle'
            && this.challengeState?.activeChallenge?.cycleState === 'locked'
            && this.challengeState?.activeChallenge?.lockReason === 'health'),
```

- [ ] **Step 5: Run to verify it passes**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/CycleStateMachine.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/CycleStateMachine.test.js
git commit -m "feat(fitness): snapshot cycleHealthPct; pause video on cycle health lock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: useGovernanceDisplay — health-lock reports videoLocked

**Files:**
- Modify: `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js`

- [ ] **Step 1: Update the cycle-locked branch**

The branch at lines 36–44 currently returns `{ …, videoLocked: false }` for `challenge.type === 'cycle' && challenge.cycleState === 'locked'`. Change the `videoLocked` it returns to honor a health-lock:
```js
        videoLocked: challenge.lockReason === 'health',
```
(Leave the rest of that branch — `show: true`, forwarding the challenge — unchanged. This keeps the cycle overlay visible while the video is paused on a health-lock.)

- [ ] **Step 2: Sanity — run the overlay/governance suite**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/`
Expected: PASS (or only the cycle overlay specs failing, which Task 5 updates).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js
git commit -m "feat(fitness): cycle health-lock surfaces videoLocked in display

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Visuals helper — swap danger fields for cycleHealthPct

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js`
- Test: `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js`

- [ ] **Step 1: Update the tests**

In `cycleOverlayVisuals.test.js`, REMOVE the two danger describe/it blocks (`exposes dangerActive…`, `defaults dangerActive=false…`, and the danger-color test added previously) and add:

```js
describe('cycleOverlayVisuals — health meter', () => {
  it('passes through cycleHealthPct', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: 0, phaseProgressPct: 0.4, cycleHealthPct: 0.5 });
    expect(v.cycleHealthPct).toBe(0.5);
  });
  it('defaults cycleHealthPct to 1 when absent', () => {
    const v = getCycleOverlayVisuals({ type: 'cycle', cycleState: 'maintain', dimFactor: 0, phaseProgressPct: 0 });
    expect(v.cycleHealthPct).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js`
Expected: FAIL — `cycleHealthPct` not exposed.

- [ ] **Step 3: Update the helper**

In `cycleOverlayVisuals.js`:
- In the `OFF` constant, REMOVE `dangerActive`, `dangerRemainingMs`, `dangerProgress` and add `cycleHealthPct: 1`.
- REMOVE the danger field extraction (`const dangerActive = …`, `dangerRemainingMs`, `dangerProgress`) and the `dangerActive` branch in the `maintain` color switch (revert that case to `if (dimFactor > 0) {…} else {…}` — green at/above hi, orange when slipping). Health is now the punishment signal, not ring color.
- Add `const cycleHealthPct = Number.isFinite(challenge.cycleHealthPct) ? Math.max(0, Math.min(1, challenge.cycleHealthPct)) : 1;` and include `cycleHealthPct` in the returned object.
- Update the JSDoc return-shape block: remove the `dangerActive/dangerRemainingMs/dangerProgress` lines, add `cycleHealthPct: number // [0..1] cycle health (depletes below loRpm)`.

- [ ] **Step 4: Run to verify it passes**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js
git commit -m "feat(fitness): cycleOverlayVisuals exposes cycleHealthPct, drops danger fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Overlay — health meter replaces danger ring + countdown (phase arc preserved)

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`
- Test: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`

- [ ] **Step 1: Update the tests**

In `CycleChallengeOverlay.test.jsx`: REMOVE the danger-ring/countdown tests (`renders a draining danger ring and numeric countdown…`, `does not render the danger ring or countdown…`) and the `phase arc dashoffset reflects phaseProgress, not dangerProgress…` test's danger-specific assertions (keep a simplified version asserting the arc reflects `phaseProgress`). Add:

```js
  it('renders a health meter reflecting cycleHealthPct', () => {
    const ch = { ...baseChallenge, cycleState: 'maintain', cycleHealthPct: 0.5 };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    const meter = container.querySelector('.cycle-challenge-overlay__health-meter');
    expect(meter).toBeTruthy();
    const fill = container.querySelector('.cycle-challenge-overlay__health-fill');
    expect(fill.getAttribute('style') || '').toMatch(/width:\s*50%/);
  });

  it('keeps the phase-progress arc (positive indicator)', () => {
    const { container } = render(<CycleChallengeOverlay challenge={{ ...baseChallenge, cycleState: 'maintain' }} />);
    expect(container.querySelector('.cycle-challenge-overlay__phase-arc')).toBeTruthy();
    expect(container.querySelector('.cycle-challenge-overlay__danger-ring')).toBeFalsy();
  });
```

(`baseChallenge` is the existing test fixture; add `cycleHealthPct: 1` to it so other tests have a defined value.)

- [ ] **Step 2: Run to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`
Expected: FAIL — no `__health-meter`; `__danger-ring` still present.

- [ ] **Step 3: Remove the danger ring/countdown; add the health meter**

In `CycleChallengeOverlay.jsx`:
- REMOVE the module constant `DANGER_RING_RADIUS` (and any `dangerRingCircumference` usage).
- In the visuals destructure, REMOVE `dangerActive, dangerRemainingMs, dangerProgress`; ADD `cycleHealthPct`.
- REMOVE the `dangerRingCircumference`/`dangerRingDashOffset`/`dangerCountdownSec` derivations.
- REMOVE the `{dangerActive && <circle className="cycle-challenge-overlay__danger-ring" … />}` element.
- REMOVE the `{dangerActive && dangerCountdownSec !== null && (<div className="cycle-challenge-overlay__danger-countdown" …>…</div>)}` element.
- REMOVE the `dangerSuffix` ariaLabel addition (revert ariaLabel to the plain phase summary).
- KEEP the `__phase-arc` path entirely unchanged.
- ADD a health meter as the first child of the `__stack` div:
```jsx
        <div
          className="cycle-challenge-overlay__health-meter"
          role="meter"
          aria-label={`Health ${Math.round((cycleHealthPct ?? 1) * 100)} percent`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((cycleHealthPct ?? 1) * 100)}
        >
          <div
            className="cycle-challenge-overlay__health-fill"
            style={{ width: `${Math.round((cycleHealthPct ?? 1) * 100)}%` }}
          />
        </div>
```
- Update PropTypes: remove `dangerActive/dangerRemainingMs/dangerProgress`, add `cycleHealthPct: PropTypes.number`.

- [ ] **Step 4: Run to verify it passes**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
git commit -m "feat(fitness): cycle overlay health meter replaces danger ring + countdown

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Remove the cycle-lock panel from GovernanceStateOverlay

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.jsx`

The video now pauses on a health-lock via `videoLocked`; the cycle overlay (with empty health) stays visible. The separate cycle-lock panel is redundant.

- [ ] **Step 1: Remove the branch + import**

In `GovernanceStateOverlay.jsx`: remove the `computeCycleLockPanelData` import and the `cycleLockData` rendering block (the `challenge.cycleState === 'locked'` panel with the RPM progress bar, ~lines 615–685). If `cycleLockPanelData.js` (the helper module) is now unused anywhere, delete it (grep first: `grep -rn "computeCycleLockPanelData" frontend/src`).

- [ ] **Step 2: Sanity**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.jsx
git commit -m "refactor(fitness): drop redundant cycle-lock panel (health meter replaces it)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: SCSS — health-meter styles; remove danger styles

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss`

No unit test (jsdom). Verified visually in Task 9.

- [ ] **Step 1: Remove dead danger styles**

Delete the `&__danger-ring`, `&__danger-countdown`, `&__danger-countdown-time`, `&__danger-countdown-cue` rules and the `@keyframes cycle-danger-ring-flash` / `@keyframes cycle-danger-countdown-flash` blocks.

- [ ] **Step 2: Add health-meter styles**

Add inside `.cycle-challenge-overlay { … }`:
```scss
  // Health meter — depletes below the red line; empty == video paused.
  &__health-meter {
    width: clamp(80px, calc(var(--cycle-overlay-diameter) * 0.55), 150px);
    height: clamp(5px, calc(var(--cycle-overlay-diameter) * 0.035), 9px);
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.15);
    overflow: hidden;
  }
  &__health-fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #ef4444 0%, #f59e0b 45%, #22c55e 100%);
    transition: width 0.2s linear;
  }
```
(A left-anchored fill that shrinks toward red as health depletes. Tune colors/size to taste.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss
git commit -m "style(fitness): cycle health-meter styles, drop danger ring/countdown css

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Docs + verification

- [ ] **Step 1: Update the reference + audit**

In `docs/reference/fitness/cycing-challenge.md`: replace the "Lockout grace affordance" section with a "Health meter" section (RPM below `loRpm` depletes a health meter; at zero the video pauses; recovery at `hiRpm` resumes + refills; the phase-progress arc is unchanged). In `docs/_wip/audits/2026-05-28-fitness-session-multi-issue-postmortem-audit.md`, mark Issue 4 **Resolved (health-meter redesign)** with a pointer to this plan.

- [ ] **Step 2: Full suite**

Run:
```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/hooks/fitness/ \
  frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js \
  frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
```
Expected: all PASS. Run eslint on the changed JS/JSX (`frontend/node_modules/.bin/eslint <files>`) and confirm clean.

- [ ] **Step 3: Manual `?cycle-demo` / real-session check**

Confirm: below `loRpm` the health meter drains; at empty the video pauses and the cycle overlay stays up with an empty meter; pedaling back to `≥ hiRpm` resumes the video and the meter refills; the phase-progress arc behaves as before; no danger ring, no separate lock panel.

- [ ] **Step 4: Commit docs**

```bash
git add docs/reference/fitness/cycing-challenge.md docs/_wip/audits/2026-05-28-fitness-session-multi-issue-postmortem-audit.md
git commit -m "docs(fitness): cycle challenge health-meter redesign + audit resolution

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes
- The health-lock pauses the video **without** showing the full governance lock screen, because governance `phase` stays `unlocked` (only `videoLocked` flips). The cycle overlay remains visible with an empty meter — the rider sees exactly why playback stopped.
- Recovery requires `≥ hiRpm` ("green") to match the spec ("until the rpm reaches the green zone again"); the amber `lo..hi` band holds health but does not resume a paused video.
- Parameters (`CYCLE_HEALTH_MAX_MS`, deplete/regen rates, per-phase reset) are the chosen defaults — adjust after the first real-session feel test. Moving them into the `fitness.yml` cycle selection config is a reasonable future enhancement.
