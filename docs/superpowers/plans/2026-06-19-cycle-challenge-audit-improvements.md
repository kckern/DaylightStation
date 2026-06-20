# Cycle Challenge Audit Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Act on the 2026-06-19 cycle-challenge overlay audit plus four follow-up requests: hide the health bar by default (show only when the rider is at risk), enlarge the boost badge, fail a cycle challenge that is never started, remove the dead overlay vestiges, and resync the docs.

**Architecture:** Five independent changes. Three are frontend overlay edits in `frontend/src/modules/Fitness/player/overlays/` (a pure presentational component + its SCSS). One is a governance-engine state-machine change in `frontend/src/hooks/fitness/GovernanceEngine.js` (a never-started failure path with history + cooldown, mirroring the existing success path). One is documentation. Each task is self-contained and committed separately.

**Tech Stack:** React (JSX), SCSS, Vitest (`./node_modules/.bin/vitest run --config vitest.config.mjs <file>`), structured logging framework.

**Decisions already made (do not re-litigate):**
- Booster pips + init/ramp countdown text are **removed**, not restored. The engine still emits `boostingUsers`/`initRemainingMs`/`rampRemainingMs`; we only clean up the dead overlay contract + docs.
- The amber dim band (orange ring + `--cycle-dim` video filter) is **kept** as a documented soft pre-warning. No code change to it.

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx` | The overlay component — gate health-bar visibility (T1); drop dead propTypes + fix docstring (T4) | T1, T4 |
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx` | Overlay tests — update + extend health-bar coverage (T1) | T1 |
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss` | Overlay styles — enlarge the boost badge (T3) | T3 |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Governance engine — never-started failure path (T2) | T2 |
| `frontend/src/hooks/fitness/CycleStateMachine.test.js` | Engine state-machine tests — never-started failure coverage (T2) | T2 |
| `docs/reference/fitness/cycing-challenge.md` | Overlay endstate reference — resync (T5) | T5 |
| `docs/reference/core/cycle-challenge-design.md` | System design reference — resync (T5) | T5 |
| `docs/_wip/audits/2026-06-19-cycle-challenge-overlay-as-built-audit.md` | The audit — add resolution note (T5) | T5 |

**Run a single test file:**
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs <path-to-test-file>
```
This is verified working: the overlay file currently reports `27 passed`.

---

## Task 1: Hide the health bar by default (show only when at risk)

The overlay currently renders `<CycleHealthBar>` unconditionally, so a full bar shows during init/ramp and while holding green. New behavior: the health bar is hidden by default and appears **only** when the rider is actually losing/lost health — i.e. during `maintain` while RPM is below the red line (`loRpm`), or during a health lock.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`
- Test: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`

- [ ] **Step 1: Update the existing health-meter test and add the default-hidden tests**

In `CycleChallengeOverlay.test.jsx`, **replace** the existing test (currently around lines 60–68):

```jsx
  it('renders a health meter reflecting cycleHealthPct', () => {
    const ch = { ...baseChallenge, cycleState: 'maintain', cycleHealthPct: 0.5 };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    const meter = container.querySelector('.cycle-health-bar');
    expect(meter).toBeTruthy();
    const litSegs = container.querySelectorAll('.cycle-health-bar__seg--lit');
    // 0.5 pct × 10 segments → 5 lit segments
    expect(litSegs.length).toBe(5);
  });
```

with this block (the meter is now only shown below the red line; `baseChallenge.currentPhase` is `{ hiRpm: 49, loRpm: 37 }`, so drive `currentRpm: 20`):

```jsx
  it('renders a health meter reflecting cycleHealthPct when below the red line', () => {
    // Below loRpm (37) during maintain → at risk → bar is shown.
    const ch = { ...baseChallenge, cycleState: 'maintain', currentRpm: 20, cycleHealthPct: 0.5 };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    const meter = container.querySelector('.cycle-health-bar');
    expect(meter).toBeTruthy();
    const litSegs = container.querySelectorAll('.cycle-health-bar__seg--lit');
    // 0.5 pct × 10 segments → 5 lit segments
    expect(litSegs.length).toBe(5);
  });

  it('hides the health bar by default while holding at/above the red line in maintain', () => {
    // rpm 60 ≥ loRpm 37 → not at risk → bar hidden.
    const ch = { ...baseChallenge, cycleState: 'maintain', currentRpm: 60, cycleHealthPct: 1 };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    expect(container.querySelector('.cycle-health-bar')).toBeNull();
  });

  it('hides the health bar during init (hidden by default)', () => {
    // baseChallenge is cycleState 'init', rpm 60 → bar hidden.
    const { container } = render(<CycleChallengeOverlay challenge={baseChallenge} />);
    expect(container.querySelector('.cycle-health-bar')).toBeNull();
  });

  it('shows the health bar the moment rpm drops below the red line in maintain', () => {
    const ch = { ...baseChallenge, cycleState: 'maintain', currentRpm: 30, cycleHealthPct: 0.8 };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    expect(container.querySelector('.cycle-health-bar')).toBeTruthy();
  });
```

Also **update** the test "renders the segmented health bar (not the old smooth meter)" (currently around lines 199–211) — its challenge holds `maintain` at `currentRpm: 68` ≥ `loRpm: 52`, which the new gate hides. Drop the RPM below the red line. Replace:

```jsx
      currentPhase: { hiRpm: 70, loRpm: 52 },
      currentRpm: 68, phaseProgressPct: 0.4, cycleHealthPct: 0.5
```

with:

```jsx
      currentPhase: { hiRpm: 70, loRpm: 52 },
      currentRpm: 40, phaseProgressPct: 0.4, cycleHealthPct: 0.5
```

> Note: the existing test "renders (phase arc + health meter visible) when cycleState=locked with cycleHealthPct:0" already covers the health-lock case — it passes `lockReason: 'health'`, which our gate treats as shown. Leave it unchanged.

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
```
Expected: FAIL — the three "hides…" tests fail because the bar is still rendered unconditionally (and the updated "below the red line" test still passes since the bar currently always renders).

- [ ] **Step 3: Gate the health bar in the component**

In `CycleChallengeOverlay.jsx`, find the current-RPM computation (around line 188):

```jsx
  // --- RPM gauge geometry (Task 22) -----------------------------------------
  const currentRpm = Number.isFinite(challenge.currentRpm) ? challenge.currentRpm : 0;
```

Immediately **after** that line, add the visibility gate:

```jsx

  // Health bar is hidden by default. It only appears when the rider is actually
  // at risk: below the red line (loRpm) during maintain, or held in a health
  // lock (empty pool, video paused). Holding green / init / ramp show nothing.
  const loRpm = Number.isFinite(challenge.currentPhase?.loRpm)
    ? challenge.currentPhase.loRpm
    : null;
  const showHealthBar =
    (challenge.cycleState === 'maintain' && loRpm != null && currentRpm < loRpm)
    || (challenge.cycleState === 'locked' && challenge.lockReason === 'health');
```

Then find the unconditional health-bar render (around line 429):

```jsx
      <CycleHealthBar pct={cycleHealthPct ?? 1} />
```

and replace it with the gated render:

```jsx
      {showHealthBar && <CycleHealthBar pct={cycleHealthPct ?? 1} />}
```

- [ ] **Step 4: Run the full overlay test file to verify all pass**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
```
Expected: PASS — all tests green (the prior 27 plus the 3 new ones, with the one replaced).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx \
        frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
git commit -m "feat(fitness): hide cycle health bar unless rider is below the red line

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Fail a cycle challenge the rider never starts

A rider who never reaches `init.min_rpm` currently locks into `init` indefinitely — the cycle state machine has no failure path, so it never resolves (confirmed in the 2026-06-20 session: challenge 3 sat in `lockReason: 'init'` at rpm 0 forever). Add a never-started failure: once the challenge has spent a grace window in the init lock without recovering, mark it `failed`, record history, apply the rider cooldown, hold the locked video briefly, then clear and move on. Because `status === 'failed'` forces governance red elsewhere in the engine, failing is a penalty, not a free pass.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`
- Test: `frontend/src/hooks/fitness/CycleStateMachine.test.js`

- [ ] **Step 1: Write the failing tests**

In `CycleStateMachine.test.js`, append this describe block at the end of the file (it reuses the existing `makeEngineWithActiveCycle`, `tick`, and `advance` helpers; the fixture's `init.time_allowed_seconds` is 10):

```jsx
describe('Cycle SM — never-started failure timeout', () => {
  it('fails a challenge the rider never starts (stays at 0 rpm past the init grace)', () => {
    const { engine, advance } = makeEngineWithActiveCycle(11);
    const originalId = engine.challengeState.activeChallenge.id;

    // init.time_allowed_seconds = 10 → initTotalMs = 10000. Grace floor is
    // 15000ms, so failure fires ~10s (init) + 15s (init-lock) later. Drive
    // rpm=0 for 40s of 500ms ticks — the rider never reaches min_rpm (30).
    for (let i = 0; i < 80; i += 1) {
      advance(500);
      tick(engine, engine._now(), { zone: 'active', rpm: 0 });
      void engine.state; // build the snapshot each tick, mirroring the overlay
    }

    const failedEntry = engine.challengeState.challengeHistory.find(
      (h) => h.type === 'cycle' && h.status === 'failed'
    );
    expect(failedEntry).toBeTruthy();
    expect(failedEntry.failReason).toBe('never_started');
    expect(failedEntry.rider).toBe('user_2');
    expect(failedEntry.phasesCompleted).toBe(0);

    // The original never-started challenge must be cleared (engine moved on),
    // not stuck in init-lock limbo. (user_2 is on cooldown after the fail, so no
    // replacement cycle can re-fire with him as the only eligible rider.)
    expect(engine.challengeState.activeChallenge?.id).not.toBe(originalId);
  });

  it('does NOT fail a rider who starts pedalling within the grace', () => {
    const { engine, advance } = makeEngineWithActiveCycle(12);
    // Sit idle 12s — into the init lock but well short of the 25s fail point...
    for (let i = 0; i < 24; i += 1) { advance(500); tick(engine, engine._now(), { rpm: 0 }); }
    // ...then pedal above min_rpm (30) and reach hi (60) — recovers into the workout.
    for (let i = 0; i < 10; i += 1) { advance(500); tick(engine, engine._now(), { zone: 'warm', rpm: 80 }); }

    const failedEntry = engine.challengeState.challengeHistory.find(
      (h) => h.type === 'cycle' && h.status === 'failed'
    );
    expect(failedEntry).toBeUndefined();
    expect(engine.challengeState.activeChallenge).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/CycleStateMachine.test.js
```
Expected: FAIL — the first test fails (no failed history entry; challenge stuck) because no failure path exists yet. The second test passes already.

- [ ] **Step 3: Add the never-started fail constant**

In `GovernanceEngine.js`, find the cycle health constants (around lines 45–48):

```js
const CYCLE_SUCCESS_PUBLISH_MS = 600;
```

Immediately **after** that line, add:

```js
// Never-started failure: once a cycle has been stuck in the init lock (rider at
// 0 rpm, never reaching init.min_rpm) for at least this long, fail it so it is
// recorded and the engine moves on instead of sitting locked forever. Floored
// so a tiny init window can't cause an instant fail.
const CYCLE_INIT_FAIL_GRACE_MS = 15000;
```

- [ ] **Step 4: Detect the never-started timeout in the state machine**

In `_evaluateCycleChallenge`, find the init-lock recovery branch (around lines 3032–3050):

```js
      if (active.lockReason === 'init') {
        if (ctx.equipmentRpm >= active.selection.init.minRpm) {
          const prevLockReason = active.lockReason;
          active.cycleState = 'init';
          active.initElapsedMs = 0;
          active.lockReason = null;
          getLogger().info('governance.cycle.state_transition', {
            challengeId: active.id, from: 'locked', to: 'init',
            currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
            currentRpm: ctx.equipmentRpm, reason: 'recovered_from_init_lock'
          });
          getLogger().info('governance.cycle.recovered', {
            challengeId: active.id, fromLockReason: prevLockReason,
            currentRpm: ctx.equipmentRpm, resumeState: 'init',
            lockDurationMs: null
          });
        }
        return;
      }
```

Replace it with (adds the fail accumulator on the no-recovery path and resets it on recovery):

```js
      if (active.lockReason === 'init') {
        if (ctx.equipmentRpm >= active.selection.init.minRpm) {
          const prevLockReason = active.lockReason;
          active.cycleState = 'init';
          active.initElapsedMs = 0;
          active.initLockElapsedMs = 0; // rider showed up — reset the fail timer
          active.lockReason = null;
          getLogger().info('governance.cycle.state_transition', {
            challengeId: active.id, from: 'locked', to: 'init',
            currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
            currentRpm: ctx.equipmentRpm, reason: 'recovered_from_init_lock'
          });
          getLogger().info('governance.cycle.recovered', {
            challengeId: active.id, fromLockReason: prevLockReason,
            currentRpm: ctx.equipmentRpm, resumeState: 'init',
            lockDurationMs: null
          });
          return;
        }
        // Rider still hasn't started. Accumulate init-lock time and fail the
        // challenge once it exceeds the grace, so a never-started cycle is
        // recorded as a failure instead of sitting locked indefinitely.
        active.initLockElapsedMs = (active.initLockElapsedMs || 0) + dt;
        const failGraceMs = Math.max(active.initTotalMs || 0, CYCLE_INIT_FAIL_GRACE_MS);
        if (active.initLockElapsedMs >= failGraceMs) {
          active.status = 'failed';
          active.failReason = 'never_started';
          active.completedAt = now;
          getLogger().info('governance.cycle.state_transition', {
            challengeId: active.id, from: 'locked', to: 'failed',
            currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
            currentRpm: ctx.equipmentRpm, reason: 'never_started'
          });
          getLogger().info('governance.cycle.failed', {
            challengeId: active.id, failReason: 'never_started',
            rider: active.rider,
            initLockElapsedMs: Math.round(active.initLockElapsedMs),
            failGraceMs
          });
        }
        return;
      }
```

- [ ] **Step 5: Handle the failed status in the cycle dispatch**

In the main dispatch, find the end of the success block and the start of the locked block (around lines 3597–3607):

```js
            this._maybeClearCycleSuccess(challenge, challengeConfig, queueNextChallenge);
            return;
          }

          // Locked cycleState: drive lock screen but keep the challenge alive
          // so rider can recover (handled by _evaluateCycleChallenge next tick).
          if (challenge.cycleState === 'locked') {
```

Insert a `failed` branch **between** the success `return;}` and the `// Locked cycleState` comment — so the new block sits right after the success block closes and before the locked check:

```js
            this._maybeClearCycleSuccess(challenge, challengeConfig, queueNextChallenge);
            return;
          }

          // Failure (e.g. never started past the init grace): record history,
          // apply the rider cooldown, hold the locked video for one brief window
          // (so the fail is visible), then clear and schedule the next challenge.
          if (challenge.status === 'failed') {
            if (!challenge.historyRecorded) {
              const completedAt = challenge.completedAt || now;
              const cooldownMs = (challenge.selection?.userCooldownSeconds || 600) * 1000;
              const ridersUsed = Array.isArray(challenge.ridersUsed)
                ? [...challenge.ridersUsed]
                : (challenge.rider ? [challenge.rider] : []);
              const phasesCompleted = Math.max(0, challenge.currentPhaseIndex || 0);

              ridersUsed.forEach((uid) => { this._cycleCooldowns[uid] = now + cooldownMs; });

              this.challengeState.challengeHistory.push({
                id: challenge.id,
                type: 'cycle',
                status: 'failed',
                failReason: challenge.failReason || null,
                startedAt: challenge.startedAt,
                completedAt,
                selectionLabel: challenge.selectionLabel || null,
                equipment: challenge.equipment,
                rider: challenge.rider,
                ridersUsed,
                totalPhases: challenge.totalPhases,
                phasesCompleted,
                totalLockEventsCount: challenge.totalLockEventsCount || 0,
                totalBoostedMs: Math.round(challenge.totalBoostedMs || 0),
                boostContributors: challenge.boostContributors ? [...challenge.boostContributors] : []
              });
              if (this.challengeState.challengeHistory.length > 20) {
                this.challengeState.challengeHistory.splice(
                  0,
                  this.challengeState.challengeHistory.length - 20
                );
              }
              challenge.historyRecorded = true;

              getLogger().info('governance.cycle.completed', {
                challengeId: challenge.id,
                status: 'failed',
                failReason: challenge.failReason || null,
                rider: challenge.rider,
                ridersUsed,
                totalPhases: challenge.totalPhases,
                phasesCompleted,
                durationMs: completedAt - challenge.startedAt
              });

              ridersUsed.forEach((uid) => {
                getLogger().info('governance.cycle.cooldown_applied', {
                  rider: uid,
                  cooldownUntilMs: this._cycleCooldowns[uid],
                  trigger: 'failed'
                });
              });
            }

            this.challengeState.videoLocked = true;
            if (!Number.isFinite(challenge.failPublishedAt)) {
              challenge.failPublishedAt = now;
            }
            if (now - challenge.failPublishedAt < CYCLE_SUCCESS_PUBLISH_MS) {
              this._schedulePulse(100);
              return;
            }
            this.challengeState.activeChallenge = null;
            const nextDelay = this._pickIntervalMs(challengeConfig.intervalRangeSeconds);
            queueNextChallenge(nextDelay);
            this._schedulePulse(50);
            return;
          }

          // Locked cycleState: drive lock screen but keep the challenge alive
          // so rider can recover (handled by _evaluateCycleChallenge next tick).
          if (challenge.cycleState === 'locked') {
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/CycleStateMachine.test.js
```
Expected: PASS — both never-started tests green, and all pre-existing CycleStateMachine tests still pass.

- [ ] **Step 7: Run the broader cycle/governance suites for regressions**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/
```
Expected: PASS — no regressions in the fitness hooks suites (GovernanceEngine, FitnessSession, etc.).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        frontend/src/hooks/fitness/CycleStateMachine.test.js
git commit -m "feat(fitness): fail a cycle challenge the rider never starts

Never reaching init.min_rpm used to lock into init forever with no resolution.
After a grace window in the init lock, mark the challenge failed, record history,
apply the rider cooldown, then clear. status=failed keeps governance red, so
never-starting is a penalty, not a free pass.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Enlarge the boost multiplier badge (up to 2× bigger)

The `×N.N` boost badge is too small to read at workout distance. Double its type scale and padding. This is a styling-only change (no meaningful unit test in jsdom); verify visually via the demo harness and by confirming the overlay suite stays green.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss`

- [ ] **Step 1: Double the badge type scale and padding**

In `CycleChallengeOverlay.scss`, find the `&__boost-badge` rule (around line 326):

```scss
  &__boost-badge {
    position: absolute;
    // Sits below the health bar (which now lives just under the circle).
    top: calc(100% + 32px);
    left: 50%;
    transform: translateX(-50%);
    padding: 2px clamp(6px, calc(var(--cycle-overlay-diameter) * 0.04), 10px);
    border-radius: 8px;
    background: rgba(249, 115, 22, 0.9);
    color: #1e293b;
    font-size: clamp(0.6rem, calc(var(--cycle-overlay-diameter) * 0.06), 0.85rem);
    font-weight: 800;
    letter-spacing: 0.04em;
    text-shadow: none;
    white-space: nowrap;
    pointer-events: none;
    animation: cycle-boost-pulse 1.2s ease-in-out infinite;
  }
```

Replace the `padding`, `border-radius`, and `font-size` declarations with their doubled values (leave everything else unchanged):

```scss
  &__boost-badge {
    position: absolute;
    // Sits below the health bar (which now lives just under the circle).
    top: calc(100% + 32px);
    left: 50%;
    transform: translateX(-50%);
    // 2x larger for legibility at workout distance.
    padding: 4px clamp(12px, calc(var(--cycle-overlay-diameter) * 0.08), 20px);
    border-radius: 12px;
    background: rgba(249, 115, 22, 0.9);
    color: #1e293b;
    font-size: clamp(1.2rem, calc(var(--cycle-overlay-diameter) * 0.12), 1.7rem);
    font-weight: 800;
    letter-spacing: 0.04em;
    text-shadow: none;
    white-space: nowrap;
    pointer-events: none;
    animation: cycle-boost-pulse 1.2s ease-in-out infinite;
  }
```

- [ ] **Step 2: Verify the overlay test suite still passes (no structural break)**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
```
Expected: PASS — styling change does not affect the DOM structure the tests assert on.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss
git commit -m "style(fitness): enlarge cycle boost badge ~2x for legibility

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Remove the dead overlay vestiges

The overlay no longer renders booster pips or countdown text (existing tests already assert their absence), but the file docstring still claims booster avatars + a boost pill "below the avatar", and `propTypes` still declares `boostingUsers`, `initRemainingMs`, and `rampRemainingMs`, none of which the render reads. Remove these dead contract entries and fix the docstring.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`

- [ ] **Step 1: Fix the docstring**

In `CycleChallengeOverlay.jsx`, find these two lines in the header docstring (around lines 26–27):

```jsx
 *   - Up to 4 booster avatars at the corners (NE/SE/SW/NW) (Task 23)
 *   - Boost multiplier pill (×2.5) below the avatar when >1.0 (Task 23)
```

Replace them with a single accurate line:

```jsx
 *   - Boost multiplier badge (×2.5) shown below the widget when >1.0
```

- [ ] **Step 2: Remove the dead propTypes**

In `CycleChallengeOverlay.jsx`, find these entries in `CycleChallengeOverlay.propTypes.challenge` (around lines 461, 472–473):

```jsx
    boostingUsers: PropTypes.arrayOf(PropTypes.string),
    boostMultiplier: PropTypes.number,
```

Replace with (drop only `boostingUsers`, keep `boostMultiplier` — the badge uses it):

```jsx
    boostMultiplier: PropTypes.number,
```

Then find:

```jsx
    clockPaused: PropTypes.bool,
    initRemainingMs: PropTypes.number,
    rampRemainingMs: PropTypes.number,
    cycleHealthPct: PropTypes.number,
```

Replace with (drop the two countdown fields; keep `clockPaused` and `cycleHealthPct`, which the visuals helper still reads):

```jsx
    clockPaused: PropTypes.bool,
    cycleHealthPct: PropTypes.number,
```

- [ ] **Step 3: Verify nothing in the component references the removed props**

Run:
```bash
grep -n 'boostingUsers\|initRemainingMs\|rampRemainingMs' frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx
```
Expected: no output (the props are gone from the component; the engine still emits them, which is fine).

- [ ] **Step 4: Run the overlay test suite to confirm no regression**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
```
Expected: PASS — the tests pass `boostingUsers`/`initRemainingMs` as data in fixtures, which React ignores; removing the propTypes declarations does not change behavior.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx
git commit -m "refactor(fitness): drop dead booster/countdown props + fix overlay docstring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Resync the documentation

Bring the two reference docs and the audit in line with the shipped behavior: booster pips + countdown removed, health bar hidden by default, never-started failure path added, dim band kept as a soft cue, boost badge enlarged.

**Files:**
- Modify: `docs/reference/fitness/cycing-challenge.md`
- Modify: `docs/reference/core/cycle-challenge-design.md`
- Modify: `docs/_wip/audits/2026-06-19-cycle-challenge-overlay-as-built-audit.md`

- [ ] **Step 1: Trim the booster pips + countdown from the overlay reference**

In `docs/reference/fitness/cycing-challenge.md`:

(a) Delete the entire `### Booster pips` section (the heading and its paragraph about `getBoosterAvatarSlots`).

(b) In the "Rider, phases, countdown, RPM readout" section, delete the **Countdown text** bullet (the `"Start in 8s" / "Reach target in 5s"` line).

(c) In the data-contract table, replace the `boostingUsers` / `boostMultiplier` row:

```markdown
| `boostingUsers` / `boostMultiplier` | Corner booster pips and the `×N.N` multiplier pill. |
```

with:

```markdown
| `boostMultiplier` | Drives the `×N.N` multiplier badge (shown only when > 1). `boostingUsers` is still emitted by the engine but no longer rendered. |
```

(d) In the `clockPaused` / `initRemainingMs` / `rampRemainingMs` row, replace:

```markdown
| `clockPaused` / `initRemainingMs` / `rampRemainingMs` | Countdown text for the `init` and `ramp` states; `clockPaused` is set when the rider is below the init min-RPM threshold. |
```

with:

```markdown
| `clockPaused` / `initRemainingMs` / `rampRemainingMs` | Still emitted by the engine; the trimmed overlay no longer renders countdown text. |
```

- [ ] **Step 2: Update the health-meter section of the overlay reference**

In `docs/reference/fitness/cycing-challenge.md`, in the "Health meter" section, add a sentence stating the bar is hidden by default. Replace the closing line:

```markdown
The separate danger ring and numeric countdown are removed; the health bar is the
sole punishment affordance.
```

with:

```markdown
The separate danger ring and numeric countdown are removed; the health bar is the
sole punishment affordance. It is **hidden by default** — it appears only when the
rider is actually at risk (RPM below `loRpm` during maintain, or a health lock),
so a rider holding green sees a clean dial.
```

- [ ] **Step 3: Update the core design reference for the never-started failure and health-bar visibility**

In `docs/reference/core/cycle-challenge-design.md`:

(a) In the `### States` list, append a sentence to the `locked` bullet:

```markdown
  into the green zone). A rider who never starts — stuck in the init lock past a
  grace window — transitions to a recorded `failed` (see the transitions table).
```

(b) In the transitions table, add a row after the `locked (init) … resume init` row:

```markdown
| `locked` (init) | stuck below `init.min_rpm` past the grace window | outer `status: failed` (`failReason: never_started`) — recorded, then cleared |
```

(c) In the "Health pool, progress, and dim" section, add a bullet noting the overlay only surfaces the bar when at risk:

```markdown
- **Overlay surfacing:** the health bar is hidden by default and shown only when
  RPM is below `loRpm` during maintain, or during a health lock — a rider holding
  green sees no bar.
```

(d) In the History section's code block, add the `failReason` field and the `failed` status note. Change:

```js
  status: 'success' | 'failed' | 'abandoned',
```

to:

```js
  status: 'success' | 'failed' | 'abandoned',
  failReason: null | 'never_started',   // set when a failure is recorded
```

- [ ] **Step 4: Add a resolution note to the audit**

In `docs/_wip/audits/2026-06-19-cycle-challenge-overlay-as-built-audit.md`, append this section at the very end of the file:

```markdown

---

## Resolution (2026-06-19)

Actioned via `docs/superpowers/plans/2026-06-19-cycle-challenge-audit-improvements.md`:

- **Finding 1 (vestiges):** Removed — dropped the dead `boostingUsers` /
  `initRemainingMs` / `rampRemainingMs` overlay props and fixed the docstring;
  booster pips + countdown are not restored. Reference docs resynced.
- **Finding 2 / 3 / 4 (mechanic / lock-screen / contract drift):** Resolved in
  docs — the core design reference was rewritten around the health pool, the
  promoted-overlay lock screen, and the real snapshot contract.
- **Finding 5 (dim band):** Kept as a documented soft pre-warning (no code change).
- **New (health bar):** The health bar is now hidden by default, shown only when
  the rider is below the red line or health-locked.
- **New (never-started failure):** A cycle stuck in the init lock past the grace
  window now fails (recorded, cooldown applied, cleared) instead of sitting in
  limbo — closing the "never start to avoid the work" gap.
- **New (boost badge):** Enlarged ~2× for legibility.
```

- [ ] **Step 5: Commit**

```bash
git add docs/reference/fitness/cycing-challenge.md \
        docs/reference/core/cycle-challenge-design.md \
        docs/_wip/audits/2026-06-19-cycle-challenge-overlay-as-built-audit.md
git commit -m "docs(fitness): resync cycle challenge docs with shipped behavior

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] **Run the full fitness frontend test surface**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/hooks/fitness/ \
  frontend/src/modules/Fitness/player/overlays/
```
Expected: PASS — all overlay and fitness-hook suites green.

- [ ] **Build to confirm the SCSS + JSX compile**

Run:
```bash
npm run build 2>&1 | tail -20
```
Expected: a successful production build (vite build completes with no errors).

---

## Self-Review Notes (for the implementer)

- **Type consistency:** `failReason` is set on the challenge in T2 Step 4 and read in T2 Step 5 and documented in T5 — same spelling throughout. `showHealthBar` / `loRpm` are local to the overlay render in T1. `CYCLE_INIT_FAIL_GRACE_MS` is defined once (T2 Step 3) and used once (T2 Step 4).
- **Decisions honored:** No booster-pip or countdown rendering is added (removal only). The dim band is untouched.
- **Deploy gate:** This touches `frontend/src/modules/Fitness/` and the governance engine. Per `CLAUDE.local.md`, after deploy, hard-reload the garage kiosk Firefox, and confirm no active fitness session before deploying.
