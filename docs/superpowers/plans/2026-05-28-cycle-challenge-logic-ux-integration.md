# Cycle Challenge Logic, UX & Integration Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the cycle-challenge progress semicircle so phase progress and lockout grace are separate, non-conflicting affordances; harden the below-lo grace logic against threshold flicker; and trim the overlay's text density — then clean up the supporting perf/correctness smells.

**Architecture:** Three layers change in lockstep. The **engine** (`GovernanceEngine.js`) is the single source of truth for the cycle state machine and the per-tick display snapshot; we add hysteresis + sustained-recovery to the maintain→locked grace and keep `dangerSinceMs` sticky so the published `dangerActive` no longer flickers. The **pure visuals helper** (`cycleOverlayVisuals.js`) stops classifying a below-lo (failing) state as "green". The **component** (`CycleChallengeOverlay.jsx` + `.scss`) renders phase progress as a monotonic lower arc, moves the lockout countdown to a distinct *draining red outer ring + numeric "Ns ↑pedal"* readout, drops the redundant rider-name text, and folds the heart-rate gate into a dot on the avatar.

**Tech Stack:** React (JSX), SCSS, Vitest + @testing-library/react (jsdom). Engine is plain ES modules tested through its public `evaluate()` / `state` API. jsdom does **not** compute layout (`getBoundingClientRect` → 0, SCSS not applied), so positioning is verified *structurally* (which element exists, in which container, with what attributes) and *visually* via the built-in `?cycle-demo` harness.

**Decisions locked with the user (2026-05-28):**
- Scope: all three areas, phased.
- Lockout grace UI: **draining red outer ring + numeric countdown** (both).
- Grace reset semantics: **hysteresis + sustained recovery** — danger stays armed through brief bobs; clearing requires RPM held ≥ loRpm for a sustained window; grace is wall-clock from the first dip (bobbing cannot reset it).
- Rider name: **dropped entirely**; avatar is the sole identifier; HR gate becomes a dot on the avatar.

**Source audit:** `docs/_wip/audits/2026-05-28-cycle-challenge-overlay-layout-and-code-audit.md`
**Endstate reference (update at the end):** `docs/reference/fitness/cycing-challenge.md`

**Per CLAUDE.md:** Do all work on a branch or worktree; commits below are for incremental review — do **not** merge or deploy without the user's review.

**Run a single Vitest spec (from repo root `/opt/Code/DaylightStation`):**
```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs <path-to-spec>
```

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Cycle state machine + per-tick display snapshot | `_evaluateCycleChallenge` maintain branch: hysteresis + sustained recovery; `_startCycleChallenge` seeds new field; `_buildChallengeSnapshot` unchanged in shape (dangerActive now sticky) |
| `frontend/src/hooks/fitness/CycleStateMachine.test.js` | Engine cycle behavior specs | Add hysteresis / no-flicker / sustained-recovery specs |
| `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js` | Pure visuals mapping | Below-lo (dangerActive) no longer classified green; document `phaseProgressPct` unit |
| `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js` | Visuals specs | Add danger-color spec |
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx` | Overlay markup | Monotonic progress arc; draining danger ring; numeric danger countdown; drop rider name; HR dot on avatar; memoized geometry; avatar fallback via state; aria wording; cleanups |
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss` | Overlay styling | Danger-ring + danger-countdown + avatar-status styles; remove rider-name + phase-arc--danger styling |
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx` | Overlay specs | Update danger/stack/name specs; add danger-ring + countdown + aria-phase specs |
| `frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.jsx` | HR gate dot | Add `compact` prop (dot only, keep root aria-label) |
| `docs/reference/fitness/cycing-challenge.md` | Endstate reference | Update behavior description after code lands |

---

# Phase 1 — Logic + progress-arc redesign

Goal of phase: the engine stops flickering at the lo threshold and the overlay renders progress and danger as two distinct, non-conflicting affordances. Shippable on its own (rider name + HR still as-is).

---

## Task 1: Engine — hysteresis + sustained recovery on the maintain grace

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` — `_startCycleChallenge` (~line 2437, the object literal that seeds `dangerSinceMs: null` ~line 2537) and `_evaluateCycleChallenge` maintain branch (~lines 2719-2799)
- Test: `frontend/src/hooks/fitness/CycleStateMachine.test.js`

**Behavior contract:**
- Below `loRpm`: arm `dangerSinceMs` on first dip; cancel any pending recovery. Lock when `now - dangerSinceMs >= 3000` (wall-clock from first dip — unchanged threshold).
- At/above `loRpm` while danger armed: start a recovery timer (`dangerRecoverySinceMs`). Only clear danger after RPM stays ≥ lo for `DANGER_RECOVERY_MS` (500 ms). Until then, danger stays armed (no lock — we're above lo; no progress accumulation).
- A dip below lo before recovery confirms cancels the recovery timer; `dangerSinceMs` is **not** reset, so grace keeps counting. Bobbing at the threshold can no longer reset grace.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/hooks/fitness/CycleStateMachine.test.js` (the `tick`, `advance`, `makeEngineWithActiveCycle` helpers already exist in this file; `loRpm`=30, `hiRpm`=60 from the existing POLICY fixture):

```js
describe('Cycle SM — maintain grace hysteresis (2026-05-28)', () => {
  // Drive init→ramp→maintain with sustained 80 RPM (above hi=60).
  function intoMaintain(engine, advance) {
    for (let i = 0; i < 5; i += 1) {
      advance(200);
      tick(engine, engine._now(), { zone: 'warm', rpm: 80 });
    }
    expect(engine.challengeState.activeChallenge.cycleState).toBe('maintain');
  }

  it('keeps danger armed across a single-tick bob above lo (no flicker)', () => {
    const { engine, advance } = makeEngineWithActiveCycle(11);
    intoMaintain(engine, advance);

    // Dip below lo (rpm=10 < 30) for two ticks → danger arms.
    advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 10 });
    advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 10 });
    expect(Number.isFinite(engine.challengeState.activeChallenge.dangerSinceMs)).toBe(true);

    // One tick back above lo (rpm=40) — shorter than the 500ms recovery hold.
    advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 40 });
    // Danger must remain armed (recovery not yet confirmed) → no UI flicker.
    expect(Number.isFinite(engine.challengeState.activeChallenge.dangerSinceMs)).toBe(true);
  });

  it('clears danger only after RPM is sustained above lo for the recovery window', () => {
    const { engine, advance } = makeEngineWithActiveCycle(12);
    intoMaintain(engine, advance);

    advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 10 }); // arm danger
    expect(Number.isFinite(engine.challengeState.activeChallenge.dangerSinceMs)).toBe(true);

    // Sustain rpm=80 (above hi) for >500ms recovery window: 4 × 200ms = 800ms.
    for (let i = 0; i < 4; i += 1) {
      advance(200);
      tick(engine, engine._now(), { zone: 'warm', rpm: 80 });
    }
    expect(engine.challengeState.activeChallenge.dangerSinceMs).toBeNull();
    expect(engine.challengeState.activeChallenge.cycleState).toBe('maintain');
  });

  it('locks at ~3s wall-clock even while bobbing at the lo threshold', () => {
    const { engine, advance } = makeEngineWithActiveCycle(13);
    intoMaintain(engine, advance);

    // Alternate just-below (20) and just-above (40) lo every 200ms for 4s.
    // Each above-lo tick is < the 500ms recovery hold, so danger never clears;
    // grace is wall-clock from the first dip → must lock within ~3s.
    let locked = false;
    for (let i = 0; i < 20 && !locked; i += 1) {
      advance(200);
      tick(engine, engine._now(), { zone: 'warm', rpm: i % 2 === 0 ? 20 : 40 });
      if (engine.challengeState.activeChallenge.cycleState === 'locked') locked = true;
    }
    expect(locked).toBe(true);
  });

  it('snapshot dangerProgress decreases monotonically through a bob', () => {
    const { engine, advance } = makeEngineWithActiveCycle(14);
    intoMaintain(engine, advance);

    const progresses = [];
    const seq = [20, 20, 40, 20, 20]; // dip, dip, bob, dip, dip
    for (const rpm of seq) {
      advance(200);
      tick(engine, engine._now(), { zone: 'warm', rpm });
      const snap = engine.state.challenge;
      if (snap?.dangerActive) progresses.push(snap.dangerProgress);
    }
    // dangerProgress is remaining/3000 from a fixed dangerSinceMs → non-increasing.
    for (let i = 1; i < progresses.length; i += 1) {
      expect(progresses[i]).toBeLessThanOrEqual(progresses[i - 1]);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/CycleStateMachine.test.js`
Expected: the four new specs FAIL — current code clears `dangerSinceMs` immediately on any tick ≥ lo (so the no-flicker, sustained-recovery, and bob-lock specs fail).

- [ ] **Step 3: Seed the new recovery field**

In `_startCycleChallenge` (`GovernanceEngine.js` ~line 2437), find the active-challenge object literal that contains `dangerSinceMs: null,` (~line 2537) and add the recovery field directly after it:

```js
      dangerSinceMs: null,
      dangerRecoverySinceMs: null,
```

- [ ] **Step 4: Rewrite the maintain-branch grace logic**

In `_evaluateCycleChallenge` (`GovernanceEngine.js`), replace the maintain-branch danger handling. The current block to replace begins at `if (ctx.equipmentRpm < phase.loRpm) {` and runs through the `if (Number.isFinite(active.dangerSinceMs)) { ... active.dangerSinceMs = null; }` clear block (the block that today contains `// RPM is at or above loRpm — clear any pending grace.`). Replace **only** that danger arm/clear region (do NOT touch the `>= phase.hiRpm` progress-accumulation block or the trailing `// between lo and hi` return that follow it):

```js
      const DANGER_GRACE_MS = 3000;
      const DANGER_RECOVERY_MS = 500;
      const nowMs = ctx.now ?? this._now();

      if (ctx.equipmentRpm < phase.loRpm) {
        // Below lo — arm or continue danger. Any dip cancels a pending recovery
        // so the grace clock keeps counting from the ORIGINAL dangerSinceMs: a
        // rider bobbing at the threshold can no longer reset grace forever.
        active.dangerRecoverySinceMs = null;
        if (!Number.isFinite(active.dangerSinceMs)) {
          active.dangerSinceMs = nowMs;
          getLogger().info('governance.cycle.danger_started', {
            challengeId: active.id,
            phaseIndex: active.currentPhaseIndex,
            currentRpm: ctx.equipmentRpm,
            threshold: phase.loRpm
          });
        }
        if (nowMs - active.dangerSinceMs >= DANGER_GRACE_MS) {
          active.cycleState = 'locked';
          active.lockReason = 'maintain';
          active.totalLockEventsCount += 1;
          active.dangerSinceMs = null;
          active.dangerRecoverySinceMs = null;
          getLogger().info('governance.cycle.state_transition', {
            challengeId: active.id, from: 'maintain', to: 'locked',
            currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
            currentRpm: ctx.equipmentRpm, reason: 'below_lo_grace_expired'
          });
          getLogger().info('governance.cycle.locked', {
            challengeId: active.id, lockReason: 'maintain', phaseIndex: active.currentPhaseIndex,
            currentRpm: ctx.equipmentRpm, threshold: phase.loRpm,
            totalLockEventsCount: active.totalLockEventsCount
          });
          return;
        }
        // In grace window — stay in maintain visually, no progress accumulation.
        return;
      }

      // RPM is at or above loRpm.
      if (Number.isFinite(active.dangerSinceMs)) {
        // Recovering: require RPM to hold above lo for DANGER_RECOVERY_MS before
        // clearing danger. Until then danger stays armed (no lock — we're above
        // lo; no progress — recovery unconfirmed) so the overlay does not flicker.
        if (!Number.isFinite(active.dangerRecoverySinceMs)) {
          active.dangerRecoverySinceMs = nowMs;
        }
        if (nowMs - active.dangerRecoverySinceMs < DANGER_RECOVERY_MS) {
          return;
        }
        getLogger().info('governance.cycle.danger_cleared', {
          challengeId: active.id, currentRpm: ctx.equipmentRpm
        });
        active.dangerSinceMs = null;
        active.dangerRecoverySinceMs = null;
      }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/CycleStateMachine.test.js`
Expected: all specs PASS, including the pre-existing "does still lock when rpm is sustained below loRpm past the 3s grace window" and the noise-resilience test.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/CycleStateMachine.test.js
git commit -m "fix(fitness): hysteresis + sustained recovery on cycle maintain grace"
```

---

## Task 2: Visuals helper — stop classifying below-lo as "green"; document the progress unit

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js` — the `case 'maintain':` block in `getCycleOverlayVisuals` (~lines 106-117); the `phaseProgress` comment (~line 91)
- Test: `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js`

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js`:

```js
describe('cycleOverlayVisuals — danger color classification', () => {
  it('uses the slipping (orange) color, not green, when dangerActive in maintain', () => {
    const v = getCycleOverlayVisuals({
      type: 'cycle',
      cycleState: 'maintain',
      dimFactor: 0,          // below lo → engine reports dimFactor 0
      phaseProgressPct: 0.4,
      dangerActive: true,
      dangerProgress: 0.6
    });
    expect(v.ringColor).toBe('#f97316'); // maintainOrange, not #22c55e green
    expect(v.dimPulse).toBe(false);      // the danger ring owns attention, not the dim pulse
  });

  it('still reports green in maintain at/above hi with no danger', () => {
    const v = getCycleOverlayVisuals({
      type: 'cycle', cycleState: 'maintain', dimFactor: 0, phaseProgressPct: 0.4
    });
    expect(v.ringColor).toBe('#22c55e');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js`
Expected: the first new spec FAILS — today `maintain + dimFactor===0` returns green even when `dangerActive`.

- [ ] **Step 3: Add the danger branch in the maintain case**

In `cycleOverlayVisuals.js`, replace the `case 'maintain':` block (currently the `if (dimFactor > 0) { ... } else { ... }`) with a danger-first version:

```js
    case 'maintain':
      if (Boolean(challenge.dangerActive)) {
        // Below lo (failing) — slipping-hard color. The separate draining
        // danger ring + numeric countdown carry the lockout urgency, so we do
        // NOT pulse the dim animation here.
        ringColor = RING_COLORS.maintainOrange;
        ringOpacity = 1;
        dimPulse = false;
      } else if (dimFactor > 0) {
        ringColor = RING_COLORS.maintainOrange;
        // Ring opacity scales down with dimFactor so that as the video dims,
        // the ring also fades. Floor at 0.35 so it never fully disappears.
        ringOpacity = Math.max(0.35, 1 - dimFactor * 0.55);
        dimPulse = true;
      } else {
        ringColor = RING_COLORS.maintainGreen;
        ringOpacity = 1;
      }
      break;
```

- [ ] **Step 4: Document the progress-fraction unit (B3, no rename)**

`phaseProgressPct` is wired through the engine globals, the `?cycle-demo` harness, PropTypes, and tests; a rename is broad and risky for little gain (DRY/YAGNI). Instead clarify the unit at the helper. Replace the line:

```js
  const phaseProgress = clamp01(challenge.phaseProgressPct);
```

with:

```js
  // NOTE: `phaseProgressPct` is a FRACTION in [0,1] despite the "Pct" suffix
  // (engine computes min(1, ms/total)). clamp01 is correct; do not multiply by 100.
  const phaseProgress = clamp01(challenge.phaseProgressPct);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js`
Expected: all specs PASS (new danger-color specs + all pre-existing).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js
git commit -m "fix(fitness): cycle overlay below-lo state uses slipping color, not green"
```

---

## Task 3: Component — monotonic progress arc + draining danger ring + numeric countdown

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`
- Test: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`

**What changes:**
1. Phase arc fill is **always** `phaseProgress` (monotonic), color always `ringColor`, opacity always `ringOpacity`. Remove the `dangerActive ? dangerProgress : …` swap and the `--danger` class on the phase arc.
2. Add a full-circle **danger ring** (`__danger-ring`) at radius `CYCLE_RING_RADIUS + 4`, drawn only when `dangerActive`, draining clockwise from the top as `dangerProgress` goes 1→0.
3. Add a numeric **danger countdown** (`__danger-countdown`) at the top of `__stack` when `dangerActive`: `⚠ {ceil(dangerRemainingMs/1000)}s` + a "↑ pedal" cue.
4. aria-label: "segment" → "phase" (B7).

- [ ] **Step 1: Update the failing tests**

In `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`, **replace** the existing test `it('renders the danger arc class when dangerActive is true', …)` with:

```js
  it('renders a draining danger ring and numeric countdown when dangerActive', () => {
    const ch = {
      ...baseChallenge,
      cycleState: 'maintain',
      initRemainingMs: null,
      rampRemainingMs: null,
      dangerActive: true,
      dangerRemainingMs: 1500,
      dangerProgress: 0.5
    };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    // Separate danger ring exists; progress arc keeps its progress role.
    expect(container.querySelector('.cycle-challenge-overlay__danger-ring')).toBeTruthy();
    expect(container.querySelector('.cycle-challenge-overlay__phase-arc--danger')).toBeFalsy();
    // Numeric countdown: ceil(1500/1000) = 2.
    expect(screen.getByText(/2s/)).toBeInTheDocument();
  });

  it('does not render the danger ring or countdown when dangerActive is false', () => {
    const ch = { ...baseChallenge, cycleState: 'maintain', dangerActive: false };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    expect(container.querySelector('.cycle-challenge-overlay__danger-ring')).toBeFalsy();
    expect(container.querySelector('.cycle-challenge-overlay__danger-countdown')).toBeFalsy();
  });

  it('labels the challenge with "phase", not "segment"', () => {
    const { container } = render(<CycleChallengeOverlay challenge={baseChallenge} />);
    const root = container.querySelector('.cycle-challenge-overlay');
    expect(root.getAttribute('aria-label')).toMatch(/phase/i);
    expect(root.getAttribute('aria-label')).not.toMatch(/segment/i);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`
Expected: new specs FAIL (`__danger-ring` absent; aria says "segment").

- [ ] **Step 3: Make the phase arc monotonic**

In `CycleChallengeOverlay.jsx`, in the phase-arc geometry region, replace:

```js
  const phaseArcFraction = dangerActive ? dangerProgress : phaseProgress;
  const phaseArcDashOffset = phaseArcLen * (1 - phaseArcFraction);
```

with:

```js
  // Phase arc is progress ONLY — monotonic, never repurposed for the danger
  // countdown (that lives on the separate __danger-ring). It holds when paused.
  const phaseArcDashOffset = phaseArcLen * (1 - phaseProgress);
```

Then replace the stroke/opacity lines:

```js
  const phaseArcStroke = dangerActive ? '#fbbf24' : ringColor;
  const phaseArcOpacity = dangerActive ? 1 : ringOpacity;
```

with:

```js
  const phaseArcStroke = ringColor;
  const phaseArcOpacity = ringOpacity;
```

And in the phase-arc `<path>` JSX, change the className from:

```jsx
          className={`cycle-challenge-overlay__phase-arc${dangerActive ? ' cycle-challenge-overlay__phase-arc--danger' : ''}`}
```

to:

```jsx
          className="cycle-challenge-overlay__phase-arc"
```

- [ ] **Step 4: Add the danger-ring geometry + element**

In `CycleChallengeOverlay.jsx`, after the phase-arc geometry constants (after `phaseArcOpacity` is defined), add:

```js
  // Draining danger ring — a full circle just outside the status track that
  // depletes clockwise from 12 o'clock as the 3-second grace runs out. Distinct
  // radius + color so it reads as a countdown timer, not as phase progress.
  const DANGER_RING_RADIUS = CYCLE_RING_RADIUS + 4;
  const dangerRingCircumference = 2 * Math.PI * DANGER_RING_RADIUS;
  const dangerRingDashOffset = dangerRingCircumference * (1 - dangerProgress);
  const dangerCountdownSec = Number.isFinite(dangerRemainingMs)
    ? Math.max(0, Math.ceil(dangerRemainingMs / 1000))
    : null;
```

Then add the danger ring `<circle>` inside the `<svg>`, immediately after the phase-arc `<path>` element:

```jsx
        {dangerActive && (
          <circle
            className="cycle-challenge-overlay__danger-ring"
            cx={CYCLE_RING_CENTER}
            cy={CYCLE_RING_CENTER}
            r={DANGER_RING_RADIUS}
            fill="none"
            stroke="#ef4444"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${dangerRingCircumference}px`}
            strokeDashoffset={`${dangerRingDashOffset}px`}
            transform={`rotate(-90 ${CYCLE_RING_CENTER} ${CYCLE_RING_CENTER})`}
          />
        )}
```

- [ ] **Step 5: Add the numeric danger countdown to the stack**

In `CycleChallengeOverlay.jsx`, inside the `<div className="cycle-challenge-overlay__stack">`, add as the **first** child (before the rider-name block):

```jsx
        {dangerActive && dangerCountdownSec !== null && (
          <div
            className="cycle-challenge-overlay__danger-countdown"
            role="alert"
            aria-label={`Lockout in ${dangerCountdownSec} seconds — pedal faster`}
          >
            <span className="cycle-challenge-overlay__danger-countdown-time">⚠ {dangerCountdownSec}s</span>
            <span className="cycle-challenge-overlay__danger-countdown-cue">↑ pedal</span>
          </div>
        )}
```

- [ ] **Step 6: Fix the aria wording (B7)**

In `CycleChallengeOverlay.jsx`, change the `ariaLabel` construction from `segment ${…}` to `phase ${…}`:

```js
  const ariaLabel = `Cycle challenge — ${challenge.cycleState || 'state unknown'}, phase ${Math.min(totalPhases, currentPhaseIndex + 1)} of ${totalPhases}${dangerSuffix}`;
```

- [ ] **Step 7: Run to verify they pass**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`
Expected: all specs PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
git commit -m "feat(fitness): split cycle progress arc from draining danger ring + countdown"
```

---

## Task 4: SCSS — danger ring + countdown styling; remove dead phase-arc--danger

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss`

This task has no unit test (jsdom does not apply SCSS); it is verified visually in Task 11.

- [ ] **Step 1: Remove the dead phase-arc danger rule**

In `CycleChallengeOverlay.scss`, delete the `&__phase-arc--danger { … }` block (the one with `animation: cycle-phase-arc-danger-flash …`). Leave the `@keyframes cycle-phase-arc-danger-flash` definition deletion to the next step.

- [ ] **Step 2: Remove the now-unused keyframes**

Delete the `@keyframes cycle-phase-arc-danger-flash { … }` block near the bottom of the file.

- [ ] **Step 3: Add danger-ring + danger-countdown styles**

Add inside the `.cycle-challenge-overlay { … }` block (e.g. after the `&__phase-arc` rule):

```scss
  // Draining lockout ring — distinct red countdown outside the status track.
  &__danger-ring {
    transition: stroke-dashoffset 0.15s linear;
    filter: drop-shadow(0 0 6px rgba(239, 68, 68, 0.7));
    animation: cycle-danger-ring-flash 0.6s ease-in-out infinite;
  }

  // Numeric lockout countdown — top of the lower stack, unmistakably a timer.
  &__danger-countdown {
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.05;
    color: #fecaca;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
    animation: cycle-danger-countdown-flash 0.6s ease-in-out infinite;
  }

  &__danger-countdown-time {
    font-size: clamp(0.75rem, calc(var(--cycle-overlay-diameter) * 0.08), 1.1rem);
    font-weight: 800;
    letter-spacing: 0.02em;
  }

  &__danger-countdown-cue {
    font-size: clamp(0.5rem, calc(var(--cycle-overlay-diameter) * 0.045), 0.65rem);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: rgba(254, 202, 202, 0.85);
  }
```

- [ ] **Step 4: Add the danger keyframes**

Add at the bottom of the file (sibling to the other `@keyframes`):

```scss
@keyframes cycle-danger-ring-flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes cycle-danger-countdown-flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss
git commit -m "style(fitness): cycle danger ring + countdown styling, drop dead phase-arc flash"
```

---

# Phase 2 — Layout / UX trim

Goal of phase: drop the redundant rider name and fold the heart-rate gate into a dot on the avatar, reducing the lower stack from five rows toward two. Shippable on top of Phase 1.

---

## Task 5: HR gate compact mode + drop rider name + dot on avatar

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.jsx`
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`
- Test: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`

- [ ] **Step 1: Update the failing tests**

In `CycleChallengeOverlay.test.jsx`, **replace** the test `it('groups lower content inside a single __stack container', …)` with:

```js
  it('groups lower content inside a single __stack container without a rider name', () => {
    const ch = {
      ...baseChallenge,
      cycleState: 'init',
      initRemainingMs: 5000,
      totalPhases: 3,
      currentPhaseIndex: 1
    };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    const stack = container.querySelector('.cycle-challenge-overlay__stack');
    expect(stack).toBeTruthy();
    // Rider name is dropped — avatar is the sole identifier.
    expect(container.querySelector('.cycle-challenge-overlay__rider-name')).toBeFalsy();
    expect(stack.querySelector('.cycle-challenge-overlay__phase-blocks')).toBeTruthy();
    expect(stack.querySelector('.cycle-challenge-overlay__countdown')).toBeTruthy();
    expect(stack.querySelector('.cycle-challenge-overlay__current-rpm')).toBeTruthy();
  });

  it('does not render the rider name text', () => {
    render(<CycleChallengeOverlay challenge={baseChallenge} />);
    expect(screen.queryByText('KC Kern')).not.toBeInTheDocument();
  });

  it('renders the heart-rate gate as a compact dot on the avatar', () => {
    const { container } = render(<CycleChallengeOverlay challenge={baseChallenge} />);
    const wrap = container.querySelector('.cycle-challenge-overlay__avatar-wrap');
    expect(wrap).toBeTruthy();
    // Dot lives with the avatar, not in the lower stack.
    expect(wrap.querySelector('.cycle-base-req')).toBeTruthy();
    // Compact mode hides the sentence label but keeps the status aria-label.
    expect(wrap.querySelector('.cycle-base-req__label')).toBeFalsy();
  });
```

The pre-existing `it('renders the base-req indicator in satisfied mode', …)` (using `getByLabelText(/heart-rate.*satisfied/i)`) must keep passing — compact mode keeps the root `aria-label`.

- [ ] **Step 2: Run to verify they fail**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`
Expected: new specs FAIL (rider-name still present, no `__avatar-wrap`).

- [ ] **Step 3: Add a `compact` prop to CycleBaseReqIndicator**

Replace the body of `CycleBaseReqIndicator.jsx` with:

```jsx
import React from 'react';
import PropTypes from 'prop-types';
import './CycleBaseReqIndicator.scss';

export const CycleBaseReqIndicator = ({ baseReqSatisfied, waitingForBaseReq, compact = false }) => {
  let mode = 'inactive';
  let label = 'Heart-rate gate inactive';
  if (baseReqSatisfied) {
    mode = 'satisfied';
    label = 'Heart-rate zone satisfied';
  } else if (waitingForBaseReq) {
    mode = 'waiting';
    label = 'Waiting for heart-rate zone';
  }
  return (
    <div
      className={`cycle-base-req cycle-base-req--${mode}${compact ? ' cycle-base-req--compact' : ''}`}
      role="status"
      aria-label={label}
    >
      <span
        data-testid="base-req-dot"
        className={`cycle-base-req__dot cycle-base-req__dot--${mode}`}
      />
      {!compact && <span className="cycle-base-req__label">{label}</span>}
    </div>
  );
};

CycleBaseReqIndicator.propTypes = {
  baseReqSatisfied: PropTypes.bool,
  waitingForBaseReq: PropTypes.bool,
  compact: PropTypes.bool
};

export default CycleBaseReqIndicator;
```

- [ ] **Step 4: Wrap the avatar and move the HR dot onto it**

In `CycleChallengeOverlay.jsx`, wrap the avatar `<button>` in a positioning container and render the compact indicator beside it. Replace the existing avatar `<button> … </button>` block with:

```jsx
      <div className="cycle-challenge-overlay__avatar-wrap">
        <button
          type="button"
          className={`cycle-challenge-overlay__avatar${swapAllowed ? ' is-clickable' : ''}`}
          onClick={handleAvatarClick}
          disabled={!swapAllowed}
          aria-label={`Rider: ${riderName || 'unknown'}${swapAllowed ? ' — tap to swap' : ''}`}
        >
          <img
            className="cycle-challenge-overlay__avatar-img"
            src={riderAvatarUrl}
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              const fallback = e.currentTarget.nextSibling;
              if (fallback) fallback.style.display = 'flex';
            }}
          />
          <span
            className="cycle-challenge-overlay__avatar-initials"
            style={{ display: 'none' }}
          >
            {riderInitial}
          </span>
        </button>
        <CycleBaseReqIndicator
          compact
          baseReqSatisfied={Boolean(challenge.baseReqSatisfiedForRider)}
          waitingForBaseReq={waitingForBaseReq}
        />
      </div>
```

(Note: the `onError` handler is kept here verbatim; Task 8 replaces it with React state.)

- [ ] **Step 5: Remove the rider-name block from the stack**

In `CycleChallengeOverlay.jsx`, delete the entire rider-name block inside `__stack`:

```jsx
        {riderName && (
          <div className="cycle-challenge-overlay__rider-name">
            <span className="cycle-challenge-overlay__rider-name-text">{riderName}</span>
            <CycleBaseReqIndicator
              baseReqSatisfied={Boolean(challenge.baseReqSatisfiedForRider)}
              waitingForBaseReq={waitingForBaseReq}
            />
          </div>
        )}
```

`riderName` is still computed and used for the avatar's `aria-label`, so leave its derivation in place.

- [ ] **Step 6: Run to verify they pass**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`
Expected: all specs PASS (including the unchanged satisfied-mode aria test).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.jsx frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
git commit -m "feat(fitness): drop cycle rider name, fold HR gate into avatar dot"
```

---

## Task 6: SCSS — avatar wrap + HR dot placement; remove rider-name styles

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss`
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.scss`

Verified visually in Task 11.

- [ ] **Step 1: Make the avatar wrap the positioned center element**

In `CycleChallengeOverlay.scss`, the `&__avatar` rule currently owns the absolute centering (`position: absolute; top/left 50%; transform translate(-50%,-50%)`). Move that centering to a new `&__avatar-wrap` and make the avatar static within it. Add before the `&__avatar` rule:

```scss
  &__avatar-wrap {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1;
  }
```

Then in the `&__avatar` rule, remove these four lines:

```scss
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
```

and the `&.is-clickable &:active` transform that references the translate — change:

```scss
      &:active {
        transform: translate(-50%, -50%) scale(0.96);
      }
```

to:

```scss
      &:active {
        transform: scale(0.96);
      }
```

- [ ] **Step 2: Position the compact HR dot on the avatar's edge**

Add to `CycleChallengeOverlay.scss` inside the root block:

```scss
  // Compact HR gate dot — pinned to the avatar's bottom-right edge.
  &__avatar-wrap .cycle-base-req {
    position: absolute;
    right: -2px;
    bottom: -2px;
    padding: 2px;
    background: rgba(11, 18, 28, 0.9);
    border-radius: 999px;
    box-shadow: 0 0 0 2px rgba(11, 18, 28, 0.9);
  }
```

- [ ] **Step 3: Remove the dead rider-name styles**

Delete the `&__rider-name { … }` and `&__rider-name-text { … }` rules from `CycleChallengeOverlay.scss`.

- [ ] **Step 4: Add a compact modifier to the HR indicator stylesheet**

Add to `CycleBaseReqIndicator.scss`:

```scss
.cycle-base-req--compact {
  padding: 0;
  background: transparent;
  gap: 0;
}
.cycle-base-req--compact .cycle-base-req__dot {
  width: 10px;
  height: 10px;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.scss
git commit -m "style(fitness): center cycle avatar via wrap, pin compact HR dot, drop rider-name css"
```

---

# Phase 3 — Perf + correctness cleanups

Goal of phase: remove the per-tick geometry recompute, make the avatar fallback robust to rider swaps, and clear the small smells. Shippable on top of Phase 2.

---

## Task 7: Memoize gauge geometry; collapse hiRpm/targetRpm duplication (B1, B4)

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`
- Test: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`

The gauge ticks, arc path, and hi/lo markers depend only on `currentPhase` (via `hiRpm`/`loRpm`) and module constants — not on `currentRpm`. Today they recompute on every RPM tick. Wrap them in `useMemo`.

- [ ] **Step 1: Write a regression test for unchanged gauge output**

Append to `CycleChallengeOverlay.test.jsx`:

```js
  it('keeps gauge ticks stable when only currentRpm changes', () => {
    const ch1 = { ...baseChallenge, cycleState: 'maintain', currentRpm: 40 };
    const { container, rerender } = render(<CycleChallengeOverlay challenge={ch1} />);
    const before = container.querySelectorAll('.cycle-challenge-overlay__gauge-tick').length;
    rerender(<CycleChallengeOverlay challenge={{ ...ch1, currentRpm: 95 }} />);
    const after = container.querySelectorAll('.cycle-challenge-overlay__gauge-tick').length;
    expect(after).toBe(before);
    expect(after).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run to verify it passes against current code (baseline)**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`
Expected: PASS (this guards behavior; the refactor must not change rendered tick count).

- [ ] **Step 3: Collapse the duplicate hiRpm derivation (B4)**

In `CycleChallengeOverlay.jsx`, delete the standalone `targetRpm` derivation (the `const targetRpm = Number.isFinite(challenge.currentPhase?.hiRpm) ? Math.round(...) : null;` block near the top of the component body). After Step 4 introduces `hiRpm` inside the memo, derive `targetRpm` from it where it is used. Add this line right after the memo block from Step 4:

```js
  const targetRpm = hiRpm != null ? Math.round(hiRpm) : null;
```

- [ ] **Step 4: Wrap gauge geometry in useMemo**

In `CycleChallengeOverlay.jsx`, replace the block that begins at `// --- RPM gauge geometry (Task 22) ---` and computes `hiRpm`, `loRpm`, `gaugeTicks`, `arcStart`/`arcEnd`/`arcPath`, `hiAngle`/`loAngle`, and the hi/lo tick endpoints — i.e. everything that does **not** depend on `currentRpm` — with a single memo. Keep `currentRpm`, `needleAngle`, `needleDeg`, `atHi`, and the target-anchor percentage math **outside** the memo (they depend on `currentRpm` / `hiAngle`):

```js
  const currentRpm = Number.isFinite(challenge.currentRpm) ? challenge.currentRpm : 0;

  const {
    hiRpm, loRpm, gaugeTicks, arcPath,
    hiAngle, loAngle, hiTickInner, hiTickOuter, loTickInner, loTickOuter
  } = useMemo(() => {
    const _hiRpm = Number.isFinite(challenge.currentPhase?.hiRpm) ? challenge.currentPhase.hiRpm : null;
    const _loRpm = Number.isFinite(challenge.currentPhase?.loRpm) ? challenge.currentPhase.loRpm : null;

    const ticks = [];
    for (let rpm = 0; rpm <= CYCLE_GAUGE_MAX_RPM; rpm += CYCLE_GAUGE_TICK_STEP) {
      const angle = rpmToAngle(rpm, CYCLE_GAUGE_MAX_RPM);
      ticks.push({
        rpm,
        inner: polarToCartesian(CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_GAUGE_RADIUS - CYCLE_GAUGE_TICK_INNER_OFFSET, angle),
        outer: polarToCartesian(CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_GAUGE_RADIUS + CYCLE_GAUGE_TICK_OUTER_OFFSET, angle)
      });
    }

    const aStart = polarToCartesian(CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_GAUGE_RADIUS, Math.PI);
    const aEnd = polarToCartesian(CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_GAUGE_RADIUS, 2 * Math.PI);
    const _arcPath = `M ${aStart.x} ${aStart.y} A ${CYCLE_GAUGE_RADIUS} ${CYCLE_GAUGE_RADIUS} 0 0 1 ${aEnd.x} ${aEnd.y}`;

    const _hiAngle = _hiRpm != null ? rpmToAngle(_hiRpm, CYCLE_GAUGE_MAX_RPM) : null;
    const _loAngle = _loRpm != null ? rpmToAngle(_loRpm, CYCLE_GAUGE_MAX_RPM) : null;
    const mk = (angle, offIn, offOut) => angle != null ? {
      inner: polarToCartesian(CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_GAUGE_RADIUS - offIn, angle),
      outer: polarToCartesian(CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_GAUGE_RADIUS + offOut, angle)
    } : { inner: null, outer: null };
    const hi = mk(_hiAngle, CYCLE_GAUGE_HILO_INNER_OFFSET, CYCLE_GAUGE_HILO_OUTER_OFFSET);
    const lo = mk(_loAngle, CYCLE_GAUGE_HILO_INNER_OFFSET, CYCLE_GAUGE_HILO_OUTER_OFFSET);

    return {
      hiRpm: _hiRpm, loRpm: _loRpm, gaugeTicks: ticks, arcPath: _arcPath,
      hiAngle: _hiAngle, loAngle: _loAngle,
      hiTickInner: hi.inner, hiTickOuter: hi.outer, loTickInner: lo.inner, loTickOuter: lo.outer
    };
  }, [challenge.currentPhase?.hiRpm, challenge.currentPhase?.loRpm]);

  const needleAngle = rpmToAngle(currentRpm, CYCLE_GAUGE_MAX_RPM);
  const needleDeg = ((needleAngle - 1.5 * Math.PI) * 180) / Math.PI;
  const atHi = hiRpm != null && currentRpm >= hiRpm;
```

Then add the `targetRpm` line from Step 3 right after this block. The `targetAnchorAngle` / `targetAnchor` / `targetLeftPct` / `targetTopPct` math stays as-is (it reads `hiAngle`, now provided by the memo). Verify the JSX still references `gaugeTicks`, `arcPath`, `hiAngle`, `loAngle`, `hiTickInner`, etc. — names are unchanged.

- [ ] **Step 5: Run to verify it still passes**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`
Expected: all specs PASS (tick count stable; needle still rotates).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
git commit -m "perf(fitness): memoize cycle gauge geometry, dedupe target/hi rpm"
```

---

## Task 8: Avatar fallback via React state, reset on rider change (B2)

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`
- Test: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append to `CycleChallengeOverlay.test.jsx` (add `fireEvent` to the testing-library import at the top: `import { render, screen, fireEvent } from '@testing-library/react';`):

```js
  it('shows initials when the avatar image fails, and recovers on rider change', () => {
    const ch = { ...baseChallenge, rider: { id: 'kckern', name: 'KC Kern' } };
    const { container, rerender } = render(<CycleChallengeOverlay challenge={ch} />);
    // Initially the image renders and initials are absent.
    expect(container.querySelector('.cycle-challenge-overlay__avatar-img')).toBeTruthy();
    expect(container.querySelector('.cycle-challenge-overlay__avatar-initials')).toBeFalsy();

    // Image errors → state flips → initials shown, image removed.
    fireEvent.error(container.querySelector('.cycle-challenge-overlay__avatar-img'));
    expect(container.querySelector('.cycle-challenge-overlay__avatar-initials')).toBeTruthy();
    expect(container.querySelector('.cycle-challenge-overlay__avatar-img')).toBeFalsy();

    // New rider → fresh URL → effect resets imgFailed → image is attempted again.
    rerender(<CycleChallengeOverlay challenge={{ ...ch, rider: { id: 'alan', name: 'Alan' } }} />);
    expect(container.querySelector('.cycle-challenge-overlay__avatar-img')).toBeTruthy();
    expect(container.querySelector('.cycle-challenge-overlay__avatar-initials')).toBeFalsy();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`
Expected: FAIL — the imperative `display:none` fallback does not reset when the rider changes.

- [ ] **Step 3: Replace imperative fallback with state**

In `CycleChallengeOverlay.jsx`, add `useState` to the React import:

```js
import React, { useCallback, useEffect, useMemo, useState } from 'react';
```

After `riderAvatarUrl` is derived, add:

```js
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [riderAvatarUrl]);
```

Replace the avatar `<img>` + initials `<span>` (inside the `__avatar-wrap` button from Task 5) with:

```jsx
          {!imgFailed && (
            <img
              className="cycle-challenge-overlay__avatar-img"
              src={riderAvatarUrl}
              alt=""
              onError={() => setImgFailed(true)}
            />
          )}
          {imgFailed && (
            <span className="cycle-challenge-overlay__avatar-initials">
              {riderInitial}
            </span>
          )}
```

Note: only one of the two renders at a time — `imgFailed` drives the choice, so the imperative `style={{ display: 'none' }}` and the `nextSibling` DOM walk are both gone.

- [ ] **Step 4: Run to verify it passes**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`
Expected: all specs PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
git commit -m "fix(fitness): cycle avatar fallback via state, resets on rider change"
```

---

## Task 9: Drop unused metUsers; fix stale state-change log (B5, B6)

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`

No new behavior to test (these are a prop removal and a logging-correctness change); covered by the existing suite plus Task 10's full run.

- [ ] **Step 1: Drop the always-empty metUsers prop (B5)**

In `CycleChallengeOverlay.jsx`, in the `<CompletionCountBlocks … />` for phase blocks, remove the `metUsers={[]}` line. `CompletionCountBlocks` defaults `metUsers = []`, so behavior is identical and the dead-capability signal is gone.

- [ ] **Step 2: Make the state-change log read current values (B6)**

Replace the `state-change` logging effect:

```js
  useEffect(() => {
    if (!visuals.visible) return;
    logger.debug('state-change', {
      cycleState: challenge?.cycleState,
      dimFactor: challenge?.dimFactor,
      phaseProgressPct: challenge?.phaseProgressPct
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.cycleState, challenge?.dimFactor]);
```

with a version that fires when any logged value changes (so the logged `phaseProgressPct` is never stale):

```js
  useEffect(() => {
    if (!visuals.visible) return;
    logger.debug('state-change', {
      cycleState: challenge?.cycleState,
      dimFactor: challenge?.dimFactor,
      phaseProgressPct: challenge?.phaseProgressPct
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.cycleState, challenge?.dimFactor, challenge?.phaseProgressPct]);
```

- [ ] **Step 3: Run the overlay suite**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`
Expected: all specs PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx
git commit -m "refactor(fitness): drop unused metUsers, fix stale cycle state-change log"
```

---

# Phase 4 — Verification & docs

## Task 10: Full suite for the touched modules

- [ ] **Step 1: Run all four affected specs**

Run:
```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/hooks/fitness/CycleStateMachine.test.js \
  frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js \
  frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
```
Expected: all PASS, zero failures.

- [ ] **Step 2: Run the broader fitness governance suite to catch snapshot-shape regressions**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/`
Expected: PASS. If any pre-existing unrelated failures appear, note them but do not fix in this plan.

## Task 11: Visual check via the cycle demo

- [ ] **Step 1: Launch the demo**

Ensure the dev server is running (`ss -tlnp | grep 3112` on kckern-server; start with `node backend/index.js` if not). Open the app with `?cycle-demo` (the `CycleChallengeDemo` widget drives init→ramp→maintain→locked→recover automatically via `ctl.setRpm('cycle_ace', rpm)`).

- [ ] **Step 2: Confirm the new behavior visually**

Watch the maintain→below-lo transition and confirm:
- The lower **progress arc holds its position** (does not jump to full or drain) when RPM drops below lo.
- A **red ring drains** around the outer edge and a **"⚠ Ns ↑ pedal"** countdown shows.
- Recovering above lo for ~0.5s clears the danger ring without flicker; bobbing at the threshold still proceeds to lock at ~3s.
- The **rider name is gone**; the avatar carries a small HR-gate dot.

- [ ] **Step 3 (optional polish): surface dangerProgress in the demo debug table**

If useful for the check, in `CycleChallengeDemo.jsx` the governance projection object (the one exposing `cycleState`, `phaseProgressPct`, etc. ~line 34) can have `dangerActive`/`dangerProgress` added and a table row appended alongside the existing `phaseProgressPct` row (~line 303). This is read-only diagnostics; skip if the visual check is already conclusive.

## Task 12: Update the endstate reference doc

- [ ] **Step 1: Update `docs/reference/fitness/cycing-challenge.md`**

Revise the "Phase progress arc (lower hemisphere)" description to: the lower arc shows **phase progress only** (monotonic; holds when paused). Add that the **lockout grace** is shown by a **separate draining red outer ring plus a numeric "Ns ↑ pedal" countdown**, and that the grace uses **hysteresis + sustained recovery** (wall-clock from the first dip; clears only after RPM holds above lo briefly). Update the "Rider, phases, countdown" section to drop the rider-name row and note the HR gate is a dot on the avatar.

- [ ] **Step 2: Mark the audit items resolved**

In `docs/_wip/audits/2026-05-28-cycle-challenge-overlay-layout-and-code-audit.md`, annotate items A2, A3, C1–C7, B1, B2, B4, B5, B6, B7 as **Resolved (2026-05-28)** with a one-line pointer to this plan. Leave A1/A4 notes about residual density if the stack is still busier than desired.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/fitness/cycing-challenge.md docs/_wip/audits/2026-05-28-cycle-challenge-overlay-layout-and-code-audit.md
git commit -m "docs(fitness): update cycle challenge reference + mark audit items resolved"
```

---

## Notes for the executor

- **Do not merge or deploy** without the user's review (CLAUDE.md). Stop after Task 12 and report.
- The `phaseProgressPct` field name is intentionally **not** renamed (B3) — it is documented instead, to avoid a fragile rename across the engine globals, the `?cycle-demo` harness, PropTypes, and tests.
- The `boost badge`, booster pips, init/ramp countdown, target sign, gauge, and needle are unchanged.
- If a step's "replace this block" anchor has drifted (line numbers in this plan are approximate), match on the quoted code, not the line number.
