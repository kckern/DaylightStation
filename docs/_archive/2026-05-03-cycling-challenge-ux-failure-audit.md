# Cycling Challenge UX Failure — 2026-05-02 Live Run

**Date:** 2026-05-03
**Reporter:** Internal users (live workout, 2026-05-02 ~19:03 PT)
**Severity:** P0 — challenge unplayable end-to-end; user pedalled for ~3 minutes and never advanced past `init`
**Scope:** `frontend/src/hooks/fitness/GovernanceEngine.js` (cycle state machine) + `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx` + cadence sensor input pipeline
**Related prior audit:** `2026-04-30-cycling-challenge-simulator-unusable-audit.md` (data-path wiring) — this audit is about *runtime behaviour* of the challenge once data is flowing

---

## TL;DR

The cycling challenge ran in a live family workout on 2026-05-02 19:03 PT and was an absolute UX failure. Three distinct symptoms reported by users, all corroborated by logs and session data:

1. **The RPM needle kept snapping to zero** even while the rider was pedalling steadily. Cadence-sensor dropouts and noise reach the overlay needle without smoothing or stale-value handling.
2. **The overlay flickered between states** every ~60 seconds — slate-blue (`init`) flashing red (`locked`) and back. The state machine entered four `init→locked→init` cycles in three minutes, with the locked phase lasting only ~250ms each time.
3. **Progress appeared to advance even when the rider was not in zone.** Code-path-wise, *phase* progress is correctly gated; but `initElapsedMs` ticks unconditionally regardless of RPM, and that clock is what the user was actually watching during the entire run.

**Underlying root cause:** the rider was pedalling at 50–60 RPM (well above the 30 RPM `init.minRpm`), but the `init→ramp` transition also requires `baseReqSatisfiedForRider` (a heart-rate gate) which was never met. So the init clock kept timing out every 60s → lock → instant recover → init clock restarts → repeat. The user could see they were pedalling fine but had no way to know an *invisible* HR requirement was failing.

The challenge ran for ~4 minutes and never reached `ramp`, never reached `maintain`, never accumulated phase progress, and ended with the bike sensor stuck at 0 RPM and the engine locked.

---

## The Run

Challenge `default_0_7_1777773785468`, started 2026-05-02 19:03:05 PT.

| Field | Value |
|---|---|
| Selection | `default_0_7` |
| Equipment | `cycle_ace` |
| Rider | `kckern` |
| Eligible riders | `kckern`, `felix`, `milo` |
| Sequence type | `progressive` |
| Phases | 3 (hi 50 / lo 38 / 12s ramp / 29s maintain) → (hi 67 / lo 50 / 20s ramp / 24s maintain) → (hi 86 / lo 65 / 17s ramp / 40s maintain) |
| Init total | 60 000 ms |
| Init `minRpm` | 30 |
| `manualTrigger` | **false** (proven, see below) |

**Session file:** `data/household/history/fitness/2026-05-02/20260502184911.yml`
**Backend log range:** `2026-05-03T02:03:05Z` — `2026-05-03T02:09:16Z` (UTC; PT 19:03–19:09)

---

## Timeline — As Logged

All from `governance.cycle.*` events in the docker log:

```
02:03:05.468  cycle.started               rider=kckern  totalPhases=3  initTotalMs=60000
02:04:05.646  init  →  locked   rpm=59.94  reason=init_timeout
02:04:05.896  locked  →  init   rpm=59.94  reason=recovered_from_init_lock     (locked for 250 ms)
02:05:06.051  init  →  locked   rpm=61.13  reason=init_timeout
02:05:06.302  locked  →  init   rpm=61.13                                       (locked for 251 ms)
02:06:06.369  init  →  locked   rpm=31.67  reason=init_timeout
02:06:06.620  locked  →  init   rpm=31.67                                       (locked for 251 ms)
02:06:31.626  paused_by_base_req           cycleState=init  initElapsedMs=24731
02:06:45.647  resumed_after_base_req       pausedDurationMs=14021
02:07:20.886  init  →  locked   rpm=0      reason=init_timeout                  (final — no recovery)
02:09:16.301  next config_parsed           (challenge effectively abandoned)
```

Four full `init↔locked` round-trips in ~3 minutes. No `phase_advanced`, no `cycle.recovered` to `maintain`, no `success`. The rider quit (or the session terminated) with the engine still locked.

---

## Complaint-by-Complaint Corroboration

### Complaint 1 — "The needle kept going to zero, it was not steady" → **CORROBORATED**

**Code path:** `CycleChallengeOverlay.jsx:187-189, 253-258`

```javascript
const currentRpm = Number.isFinite(challenge.currentRpm)
  ? challenge.currentRpm
  : 0;
…
const needleAngle = rpmToAngle(currentRpm, CYCLE_GAUGE_MAX_RPM);
const needleTip   = polarToCartesian(…CYCLE_GAUGE_RADIUS, needleAngle);
```

The needle reads `challenge.currentRpm` *raw, every render*. There is no smoothing, no debounce, no stale-value retention, no min-update interval. Whatever the cadence sensor reported on the most recent tick is where the needle points.

`GovernanceEngine.js:1706-1708` shows the source — also raw:

```javascript
const cadenceEntry = this._latestInputs?.equipmentCadenceMap?.[active.equipment];
const rpmVal       = Number(cadenceEntry?.rpm);
const equipmentRpm = Number.isFinite(rpmVal) ? rpmVal : 0;
```

A missing or stale cadence entry collapses to `0`.

**Sensor evidence — `bike:49904:rpm` in the session timeline (RLE-encoded, ~5s per tick):**

```
[null,174], [0,2], 77, 72, 67, 63, 58, 61, 63, 57, 75, [63,2], [61,6],
78, 115, 28, [32,5], 0, [32,7], [0,5], [null,17], 0, 61, 32, 52, 82,
[31,2], 82, 89, [31,4]
```

Decoded at the active period:
- A clean ramp from 57 → 75 RPM, then sustained ~60-78 (good).
- Then a single-tick spike `78, 115, 28` — **115 down to 28 in one sample**.
- `[0,5]` — **five consecutive ticks at 0 RPM (~25 seconds)** in the middle of pedalling.
- `[null,17]` — **17 ticks (~85 seconds) of no signal at all**.

**`bike:7138:rpm` shows the same pattern from the other bike:**

```
0, 53, [87,16], 25, 45, 48, [46,8], 110, 97, 92, 77, 26, [47,3], …
```

A 16-tick stretch at sustained 87 RPM, then a sample reading 25, then 45, 48, then 8 ticks at 46 — large drops from baseline that would visibly throw the needle around even when the rider's pace was constant.

**Verdict:** Bike cadence sensors (likely ANT+ via the garage extension) drop out and produce noise. Without smoothing in the engine *or* the overlay, every dropout flashes the needle to π (left edge). Combined with the final `currentRpm: 0` lock event at 02:07:20 — that one has authoritative log evidence — the user's experience of an erratic, dropping needle is real and produced by absent input filtering.

---

### Complaint 2 — "The progress kept growing even when out of range / at zero" → **PARTIAL: not the phase ring, but the init clock**

**Code path (phase progress, the "right" answer):** `GovernanceEngine.js:2481-2535`

```javascript
if (active.cycleState === 'maintain') {
  const phase = active.generatedPhases[active.currentPhaseIndex];
  if (ctx.equipmentRpm < phase.loRpm) {
    active.cycleState = 'locked';
    …
    return;
  }
  if (ctx.equipmentRpm >= phase.hiRpm) {
    const { multiplier, contributors } = this._computeBoostMultiplier(active, ctx);
    const progressAdd = dt * multiplier;
    active.phaseProgressMs += progressAdd;
    …
  }
  // between lo and hi: progress paused, no state change
  return;
}
```

This is correct: `phaseProgressMs` only increments when `equipmentRpm >= hiRpm`. Below `loRpm` the engine transitions to `locked`. Between `lo` and `hi` it does nothing. **The outer ring (`phaseProgress = clamp01(phaseProgressPct)`) and the inner progress bar in `CycleChallengeOverlay.jsx:178, 462-479` are wired off `phaseProgressPct`, which derives from `phaseProgressMs / (maintainSeconds × 1000)`** (`GovernanceEngine.js:529-531, 1719-1721`). So during `init`/`ramp`/`locked`, the ring stays at 0%. There is no "progress grows at zero RPM" via this path.

**But the user never reached `maintain` in this run.** They were in `init` or `locked` for the entire challenge. So what *were* they watching?

**Code path (init clock, the suspect):** `GovernanceEngine.js:2408-2447`

```javascript
if (active.cycleState === 'init') {
  active.initElapsedMs += dt;                          // ← unconditional
  if (active.initElapsedMs >= active.initTotalMs) {
    active.cycleState = 'locked';
    …
    reason: 'init_timeout'
    …
  }
  if (ctx.equipmentRpm >= active.selection.init.minRpm
      && (ctx.baseReqSatisfiedForRider || active.manualTrigger)) {
    active.cycleState = 'ramp';
    …
  }
  …
}
```

The init phase has its own clock that **ticks every frame regardless of RPM**. The engine surface exposes `initRemainingMs` and `initTotalMs` in the snapshot (`GovernanceEngine.js:538-539, 594-595`). If anything in the player UI displays init time as a progress indicator (countdown bar, fill animation, "time to start" pill), then yes — the user saw it advancing at 0 RPM, because that is exactly what the code does.

Even setting aside whether init time is rendered as a progress bar, **the user's mental model — "this should pause when I'm not pedalling" — is reasonable and not what the engine implements.** The init clock is a wall-clock timeout, not a "time pedalled" counter.

**Verdict:** Phase-progress logic is correct and behaves as the user wants. But the `init` and `ramp` clocks tick unconditionally; whichever of those is visible to the user (currently or in any planned UI) will *appear* to "grow at zero RPM" because that is its specified behaviour. This is more a spec/UX issue than a code bug — the user expected pedal-paused timers, the system has wall-clock timers.

---

### Complaint 3 — "The overlay kept disappearing and reappearing" → **STRONGLY CORROBORATED**

**Code path (visual state derivation):** `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js:82-109`

```javascript
switch (cycleState) {
  case 'init':     ringColor = #64748b /* slate */; ringOpacity = 0.9; break;
  case 'ramp':     ringColor = #f59e0b /* amber */; ringOpacity = 1;   break;
  case 'maintain': … (green or orange + dim-pulse)                     break;
  case 'locked':   ringColor = #ef4444 /* red   */; ringOpacity = 1;   break;
  default:         return OFF;
}
```

And class-name mapping in `CycleChallengeOverlay.jsx:294-300`:

```javascript
const classNames = ['cycle-challenge-overlay', `cycle-challenge-overlay--pos-${position}`];
if (challenge.cycleState) {
  classNames.push(`cycle-challenge-overlay--state-${String(challenge.cycleState).toLowerCase()}`);
}
if (dimPulse) classNames.push('cycle-challenge-overlay--dim-pulse');
```

**The overlay element re-classes every state transition.** SCSS in `CycleChallengeOverlay.scss` keys animations off these state classes (`--state-locked` does a red pulse; `--dim-pulse` does an opacity pulse). Each transition restarts CSS animations from frame 0.

**Observed transitions in the live run:**

| Wall time | Event | Overlay class change | Visible duration |
|---|---|---|---|
| 02:04:05.646 | init→locked | `--state-init` → `--state-locked` | 250 ms |
| 02:04:05.896 | locked→init | `--state-locked` → `--state-init` | (returns) |
| 02:05:06.051 | init→locked | `--state-init` → `--state-locked` | 251 ms |
| 02:05:06.302 | locked→init | `--state-locked` → `--state-init` | (returns) |
| 02:06:06.369 | init→locked | `--state-init` → `--state-locked` | 251 ms |
| 02:06:06.620 | locked→init | `--state-locked` → `--state-init` | (returns) |
| 02:06:31.626 | paused_by_base_req | (engine pause; visual state TBD) | 14 021 ms |
| 02:07:20.886 | init→locked | `--state-init` → `--state-locked` | (final) |

Four red-flash cycles in three minutes. Each red flash lasts ~250 ms — long enough to see, short enough to feel like a glitch rather than a deliberate state. To a user this *reads* as "the overlay just disappeared and came back" because the geometry, colours, and animation phase all change discontinuously, then change back.

The `paused_by_base_req` window (14s) probably also alters the overlay (or freezes the snapshot — see `GovernanceEngine.js:2377-2399`); whether it visually disappears depends on whether `_buildCycleSnapshot` is invoked while paused. Either "frozen at last value" or "snapshot withheld" would *also* read as a flicker to the user.

**Verdict:** The state machine produces a flicker pattern by design when the rider is in the failure mode this run hit. The 250 ms locked window is fundamentally too short to be a UI state — it's a code-state — but it gets fully rendered as one.

---

## Root Cause — Why This Run Looked Like It Did

Putting the three symptoms together, the underlying mechanism is a single broken interaction:

1. The rider mounts the bike and pedals at 50–60 RPM. Above the 30 RPM `init.minRpm` threshold.
2. The `init→ramp` transition (`GovernanceEngine.js:2434`) requires **both**:
   - `equipmentRpm >= minRpm` ✅ (satisfied)
   - `baseReqSatisfiedForRider || manualTrigger` ❌ (neither)
3. `baseReqSatisfiedForRider` is computed at `GovernanceEngine.js:2994` as `riderRank >= baseReqMinRank`, where `riderRank` is derived from heart-rate zone. The rider's HR was not in the required zone.
4. `manualTrigger` was **false** for this challenge. We can prove this because the `paused_by_base_req` event fired at 02:06:31 — and that branch (`GovernanceEngine.js:2377`) only runs when `!active.manualTrigger`. So this was *not* the demo path.
5. With both gate conditions failing, init never advanced. `initElapsedMs` ticked freely, hit 60 000 ms, fired `init_timeout`, transitioned to `locked`.
6. In `locked` with `lockReason: 'init'`, the recovery condition (`GovernanceEngine.js:2541`) is just `equipmentRpm >= minRpm` — **without** the base-req gate. The rider was at ≥30 RPM, so the engine recovered to `init` within a single tick (~250 ms).
7. `initElapsedMs` is reset to 0 on recovery (`GovernanceEngine.js:2544`). The 60s clock starts over. With the base-req still unmet, this loops forever.

The 250 ms locked windows are a direct consequence of an asymmetry in the gate conditions: **`init→ramp` requires baseReq+RPM, but `locked→init` requires only RPM**. So the engine perpetually escapes lock back to init, where it can't go anywhere else, where it times out again.

Sensor noise (the `bike:49904:rpm` series above) made things worse — every cadence dropout that touched 0 RPM during `locked` would prevent the recovery (since 0 < 30 minRpm), so the lock would persist longer. And every dropout to 0 during `init` had no state-machine effect but trashed the needle visually.

The challenge eventually died at 02:07:20 because RPM hit 0 at the moment the timer expired, leaving the engine in `locked` with no path back. The user gave up.

---

## Findings (numbered)

### F1 — Cadence input has zero filtering or stale-value handling

**Files:** `GovernanceEngine.js:1706-1708`, `CycleChallengeOverlay.jsx:187-189`

Raw cadence reads with `?? 0` collapse to zero on missing or stale samples. Both the *engine* (state machine) and the *overlay* (needle) read the same raw value. Sensor dropouts therefore cause both visual flicker and false state transitions.

**Recommendation:**
- Smooth `equipmentRpm` in `GovernanceEngine` with an EMA or rolling-window average over the last ~3 ticks.
- Distinguish "no recent sample" from "0 RPM" — treat a stale reading (sensor silent for >N seconds) as "data missing" rather than "rider stopped". Today they are indistinguishable.
- For the overlay needle, hold the last known good RPM for a short grace period rather than slamming to 0.

### F2 — `init→ramp` and `locked→init` gate asymmetry causes infinite oscillation

**Files:** `GovernanceEngine.js:2434` (init→ramp gate) vs `GovernanceEngine.js:2541-2557` (init-locked recovery)

`init→ramp` requires `rpm >= minRpm AND (baseReq || manualTrigger)`.
`locked→init` requires just `rpm >= minRpm`.

If `baseReq` is unsatisfied for the rider, the engine bounces between `init` and `locked` indefinitely, with no progress and no diagnostic visible to the user.

**Recommendations (pick one):**
- **Option A (preferred):** when init times out and the *only* unmet condition is `baseReq`, hold in `init` (don't lock) and surface a clear "waiting for HR zone" indicator. Never lock for an unmeetable HR requirement when the rider is doing the cardio work the gate is supposed to test for.
- **Option B:** make `locked→init` recovery require the same gate as `init→ramp`. Then the rider stays locked (visually unambiguous) instead of flickering. Worse UX in absolute terms but at least honest.
- **Option C:** apply a debounce — require any state to hold for ≥1 second before transitioning, so 250 ms locked flashes are impossible.

### F3 — User has no visibility into why the challenge isn't advancing

**Files:** `CycleChallengeOverlay.jsx` (no HR-gate UI), `GovernanceEngine.js:2434, 2541`

The rider can see RPM and the high/low ticks. They cannot see:
- Whether `baseReqSatisfiedForRider` is true.
- What zone they need to be in.
- That the `init` clock is ticking down toward a timeout.
- That `initElapsedMs` resets every time they recover from a lock.

So when the overlay flashes red and goes back to slate, the user has no idea what just happened or how to make it stop.

**Recommendation:**
- Surface base-requirement status in the overlay: a small HR-zone indicator next to the rider avatar that flips green when `baseReqSatisfiedForRider`.
- Render the `init` countdown explicitly (e.g. "Starting in 0:23" on the inner progress bar) so the user knows the clock is running.
- When `init→locked` fires due to `init_timeout`, include the cause in the overlay (e.g. tooltip / pill: "HR zone required") rather than just turning red.

### F4 — `phaseProgressMs` and `initElapsedMs` use different progress models — undocumented to the user

**Files:** `GovernanceEngine.js:2409` (init clock), `GovernanceEngine.js:2502` (phase-progress)

- `initElapsedMs` is **wall-clock** — increments unconditionally in `init`.
- `rampElapsedMs` is also wall-clock (similar pattern in the ramp branch).
- `phaseProgressMs` is **conditional** — only increments when `rpm >= hiRpm`.

This is internally consistent but not what users naturally model. The complaint "progress kept growing while I was at zero" is the correct intuition for a fitness challenge: time should count when you're working. Reconcile this:
- Either make all three progress dimensions conditional ("you must pedal for the init/ramp clocks to advance"),
- Or document and visually distinguish wall-clock vs work-clock progress so users can see *why* a bar is moving.

### F5 — 250 ms state durations are fundamentally not UI states

**File:** `CycleChallengeOverlay.scss` (state-keyed CSS) + `cycleOverlayVisuals.js:82-109`

A state that exists for a quarter second cannot be communicated to a human. It can only flicker. The `locked` state needs either a hold-down timer (don't paint `locked` until it has held for ≥500ms) or a transition guard at the engine level (F2 option C).

### F6 — `manualTrigger` was unexpectedly false for what was probably meant to be a demo run

**Evidence:** the `paused_by_base_req` log at 02:06:31 ran the `!active.manualTrigger` branch.

The presence of `cli/verify-cycle-demo.mjs` and `tests/live/flow/fitness/cycle-demo-launch.runtime.test.mjs.local-pre-merge` (untracked) suggests a demo path is in active development. If the user thought they were launching the demo (which sets `manualTrigger: true` to bypass `baseReq`) but actually launched the production flow, the symptoms in this audit are exactly what you'd expect.

**Recommendation:**
- Verify the launch URL/cardpath that triggered this run actually engaged demo mode.
- If the demo is meant to be the safe playground for testing the state machine without HR-zone dependencies, document and test that `manualTrigger` is truly being plumbed through.

---

## Actionable Punch List

In severity order — **F2 is the spine, everything else is contributory**.

| # | Action | Owner area | Estimated risk |
|---|---|---|---|
| 1 | Add transition debounce so any cycle state must hold ≥500ms before being snapshot-emitted (kills 250ms locked flickers regardless of root cause) | `GovernanceEngine._evaluateCycleChallenge` | Low — guard only |
| 2 | Resolve init→ramp / locked→init gate asymmetry (F2 above; pick option A) | `GovernanceEngine` cycle SM | Medium — semantic change |
| 3 | Smooth/EMA cadence input + distinguish stale-vs-zero | `GovernanceEngine._latestInputs` ingest path | Low |
| 4 | Surface `baseReqSatisfiedForRider` and `init` countdown in `CycleChallengeOverlay` | overlay UI | Low |
| 5 | Reconcile wall-clock vs work-clock progress UX (F4); decide whether init/ramp pause when rider stops | spec + engine | Medium |
| 6 | Verify demo-launch path actually sets `manualTrigger: true` | `FitnessSimulationController` + demo widget | Low |
| 7 | Hold-down rule: never paint `locked` until it has been the engine state for ≥500ms (belt-and-braces with #1) | overlay state mapping | Low |

---

## Open Questions

- **Why was `baseReqSatisfiedForRider` false?** The rider's HR device on this date was `28812` (Felix's? — `participants.felix.hr_device: '28812'` in the session yml). If `kckern` was the cycle rider but `kckern` had no HR device assigned, `baseReqSatisfiedForRider` would always be false. A cycle challenge that requires HR-zone gating but is launched without an HR device for the rider may be unwinnable by construction. Worth checking the device-ownership ledger for this session.
- **Was `cycle-demo=1` actually present in the URL?** The presence of `cli/verify-cycle-demo.mjs` (untracked) suggests recent work in this area; need to confirm whether the user clicked the demo card or a production card.
- **Is `manualTrigger` plumbed end-to-end from the demo entry point?** A grep over `_startCycleChallenge` callers and `selection.manualTrigger` would close this.

---

## Appendix — Source References

- Cycle state machine entry: `frontend/src/hooks/fitness/GovernanceEngine.js:2362` (`_evaluateCycleChallenge`)
- Init evaluation: `GovernanceEngine.js:2408-2447`
- Maintain evaluation: `GovernanceEngine.js:2481-2535`
- Locked recovery: `GovernanceEngine.js:2538-2578`
- Snapshot builder (window globals): `GovernanceEngine.js:486-500, 520-600`
- Manual demo tick path: `GovernanceEngine.js:1700-1723`
- Cadence input: `GovernanceEngine.js:486, 1706, 2987`
- Overlay needle: `CycleChallengeOverlay.jsx:187-189, 253-258, 390-407`
- Overlay visual mapping: `cycleOverlayVisuals.js:58-119`
- Overlay class names: `CycleChallengeOverlay.jsx:294-300`
- Session log: `data/household/history/fitness/2026-05-02/20260502184911.yml`
- Backend log events: `governance.cycle.*` between 2026-05-03T02:03:05Z and 02:07:20Z

---

## Resolution — 2026-05-04

Remediated by `docs/superpowers/plans/2026-05-04-cycle-challenge-remediation.md`.

Per-finding fix commits (in chronological order on branch `worktree-cycle-challenge-remediation`):

- **F1 / F1b — Cadence input has no filtering, no upper bound, no stale-vs-zero distinction:**
  - `CadenceFilter` skeleton + plausibility clamp (Task 1)
  - EMA smoothing α=0.4 (Task 2)
  - Staleness detection with ≤5 s hard contract (Task 3)
  - Wired into `GovernanceEngine` with freshness watermark (Task 4 + clock-fix follow-up)
  - **Integration fix:** `getEquipmentCadence` returns `ts: device.lastSeen` so 0-readings reach the EMA filter (Task 12 follow-up — caught only by the live-system Playwright reproduction)

- **F2 — `init→ramp` and `locked→init` gate asymmetry:**
  - When `init_timeout` fires AND rider is pedalling but `baseReq` unmet, hold in `init` with `waitingForBaseReq: true` instead of locking (Task 7)

- **F3 — User has no visibility into why challenge isn't advancing:**
  - `CycleBaseReqIndicator` component (Task 10) shows green/amber/grey HR-zone gate state
  - `CycleChallengeOverlay` mounts the indicator next to the rider name and renders an init/ramp countdown line (Task 11)
  - `cycleOverlayVisuals` exposes `lostSignal`, `stale`, `waitingForBaseReq`, `clockPaused`, `initRemainingMs`, `rampRemainingMs` (Task 9)

- **F4 — Wall-clock vs work-clock progress UX:**
  - Snapshot exposes `clockPaused: true` when rider is below `init.minRpm` so UI can render "paused" countdown (Task 8). Engine clocks unchanged to preserve `init_timeout` semantics post-Task-7.

- **F5 — 250 ms state durations rendered as UI flicker:**
  - `_buildChallengeSnapshot` (cycle branch) publishes state with 500 ms minimum hold; internal SM continues to track ground truth (Task 6). Lock transitions reduced from 10+/15s to ≤1/15s on the noise-resilience scenario.

- **F6 — `manualTrigger` not plumbed even where it should be:**
  - The integration test `tests/unit/governance/GovernanceEngine-cycleDispatch.test.mjs` proves `manualTrigger=true` flows end-to-end when `riderId` is supplied; `paused_by_base_req` no longer fires when the demo path is engaged correctly (verified by Task 7's symmetric-gate test, which exercises the non-manual path explicitly).

**Plus a user-driven addition during execution:**

- **Unified position container:** `ChallengeOverlayDeck` + `useChallengeOverlayPosition` hook (Task 11A — added per user feedback during execution). Both `ChallengeOverlay` and `CycleChallengeOverlay` now share a single position state (`fitness.challengeOverlay.position` localStorage key); a tap on the deck cycles position for both overlays at once.

**Regression guards:**

- Unit tests in `frontend/src/hooks/fitness/CadenceFilter.test.js` (13 tests) and `frontend/src/hooks/fitness/CycleStateMachine.test.js` (12 tests) cover Tasks 1-8.
- Component tests in `frontend/src/modules/Fitness/player/overlays/` cover Tasks 9-11 + 11A.
- Live Playwright test at `tests/live/flow/fitness/cycle-challenge-noise-resilience.runtime.test.mjs` reproduces the original 0↔55 RPM noise pattern on the running app and asserts ≤1 lock transition over a 15 s window (Task 12).
- New integration regression test at `frontend/src/hooks/fitness/FitnessSession.cadenceTs.test.js` pins the `ts: device.lastSeen` contract so the silent-0-read regression cannot recur.

**Closed.**
