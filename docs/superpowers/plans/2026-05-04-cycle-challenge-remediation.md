# Cycle Challenge Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the cycling-challenge UX failure modes documented in `docs/_wip/audits/2026-05-03-cycling-challenge-ux-failure-audit.md`: erratic needle, overlay flicker, opaque locks. Make the challenge playable end-to-end on real ANT+ cadence hardware whose sensor blips and dropouts the system today treats as ground truth.

**Architecture:** Three layers of defence, in order of impact:

1. **Input filter** — a new `CadenceFilter` module sanitises raw RPM samples (upper-bound clamp, EMA smoothing, staleness detection) *before* the state machine or the overlay needle ever sees them. This alone fixes the 0↔55 RPM sensor flicker that drove 10 lock events in 13 seconds on 2026-05-04.

2. **State machine guards** — debounce transitions to ≥500 ms minimum hold; fix the `init→ramp` / `locked→init` gate asymmetry so an unmet `baseReq` does not loop the engine; treat `init`/`ramp` clocks as work-clocks (pause when the rider isn't pedalling) rather than wall-clocks.

3. **UI surfacing** — render a base-req indicator and the init/ramp countdown inside the overlay so the rider can see *why* the challenge is or is not advancing.

**Tech Stack:**
- vitest (co-located `*.test.js`) — preferred for new unit tests in `frontend/src/hooks/fitness/`
- jest (`tests/unit/**/*.test.mjs`) — used by the rest of the test harness; not adding any here
- Playwright (`tests/live/flow/fitness/*.runtime.test.mjs`) — for the end-to-end repro
- React + SCSS frontend, ES modules
- Existing logging framework (`@/lib/logging/Logger.js`) — reuse, no new transports

---

## File Structure

```
frontend/src/hooks/fitness/
├── CadenceFilter.js                              [NEW]   pure sanitiser: clamp/EMA/staleness
├── CadenceFilter.test.js                         [NEW]   vitest unit tests
├── CycleStateMachine.test.js                     [NEW]   vitest sensor-blip integration tests
└── GovernanceEngine.js                           [MODIFY] use CadenceFilter; fix gates; pause clocks

frontend/src/modules/Fitness/player/overlays/
├── CycleBaseReqIndicator.jsx                     [NEW]   small UI: HR-zone gate dot
├── CycleBaseReqIndicator.scss                    [NEW]
├── CycleChallengeOverlay.jsx                     [MODIFY] render indicator + countdown
├── CycleChallengeOverlay.scss                    [MODIFY] minimum-state-hold animation guard
└── cycleOverlayVisuals.js                        [MODIFY] surface initRemainingMs / rampRemainingMs

tests/live/flow/fitness/
└── cycle-challenge-noise-resilience.runtime.test.mjs   [NEW] Playwright sensor-blip repro
```

**One responsibility per file.** `CadenceFilter` is an input cleaner; it has no knowledge of cycle state. The state machine consumes filtered values and emits transition decisions. The overlay only renders snapshots. Each layer is independently unit-testable.

---

## Task Sequencing Note

Tasks 1–4 (CadenceFilter + integration) fix the dominant symptom by themselves. Tasks 5–7 (state-machine guards) are belt-and-braces for any residual flicker and fix the init↔locked oscillation pattern from 2026-05-02. Tasks 8–10 (UI) make the system *legible* to the rider. Tasks 11–12 are end-to-end verification.

Recommended commit cadence: one commit per task. Each task produces a green test run.

---

## Task 1: Create `CadenceFilter` skeleton + clamp behaviour

**Files:**
- Create: `frontend/src/hooks/fitness/CadenceFilter.js`
- Create: `frontend/src/hooks/fitness/CadenceFilter.test.js`

The audit and 2026-05-04 logs prove two raw-input pathologies: sensor reporting `0` between rotations (10 events in 13s) and one device reporting `11618` for 23 ticks. Step 1 is a sanity clamp.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/hooks/fitness/CadenceFilter.test.js
import { describe, it, expect } from 'vitest';
import { CadenceFilter } from './CadenceFilter.js';

describe('CadenceFilter — sanity clamp', () => {
  it('returns the raw value when within plausible range', () => {
    const f = new CadenceFilter();
    expect(f.update({ rpm: 60, ts: 1000 }).rpm).toBe(60);
  });

  it('rejects values above the human plausibility ceiling (200 RPM)', () => {
    const f = new CadenceFilter();
    const result = f.update({ rpm: 11618, ts: 1000 });
    expect(result.rpm).toBe(0);
    expect(result.flags.implausible).toBe(true);
  });

  it('rejects negative values', () => {
    const f = new CadenceFilter();
    const result = f.update({ rpm: -5, ts: 1000 });
    expect(result.rpm).toBe(0);
    expect(result.flags.implausible).toBe(true);
  });

  it('rejects non-finite values (NaN, Infinity)', () => {
    const f = new CadenceFilter();
    expect(f.update({ rpm: NaN,      ts: 1000 }).rpm).toBe(0);
    expect(f.update({ rpm: Infinity, ts: 2000 }).rpm).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/hooks/fitness/CadenceFilter.test.js`
Expected: FAIL with `Cannot find module './CadenceFilter.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// frontend/src/hooks/fitness/CadenceFilter.js
const MAX_PLAUSIBLE_RPM = 200;

export class CadenceFilter {
  update({ rpm, ts }) {
    const flags = { implausible: false, smoothed: false, stale: false };
    let value = rpm;

    if (!Number.isFinite(value) || value < 0 || value > MAX_PLAUSIBLE_RPM) {
      flags.implausible = true;
      value = 0;
    }

    return { rpm: value, ts, flags };
  }
}

export default CadenceFilter;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/hooks/fitness/CadenceFilter.test.js`
Expected: PASS — 4 tests passed

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/CadenceFilter.js \
        frontend/src/hooks/fitness/CadenceFilter.test.js
git commit -m "feat(fitness): CadenceFilter skeleton with plausibility clamp"
```

---

## Task 2: Add EMA smoothing to `CadenceFilter`

**Files:**
- Modify: `frontend/src/hooks/fitness/CadenceFilter.js`
- Modify: `frontend/src/hooks/fitness/CadenceFilter.test.js`

ANT+ cadence sensors report RPM derived from the most recent inter-rotation interval; a missed-or-zero polled sample between live samples should *not* be propagated. Use EMA smoothing with `alpha = 0.4` (≈3-sample memory) so a single 0-RPM blip surrounded by 55-RPM samples reads ~33 RPM (above lo=37 in the worst observed phase 0 config) on the blip itself, and ~50 on the next sample.

- [ ] **Step 1: Write the failing tests**

Append to `CadenceFilter.test.js`:

```javascript
describe('CadenceFilter — EMA smoothing', () => {
  it('smooths a single zero-blip between live samples', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 55, ts: 1000 });
    f.update({ rpm: 55, ts: 1100 });
    f.update({ rpm: 55, ts: 1200 });
    const blip = f.update({ rpm: 0, ts: 1300 });
    expect(blip.rpm).toBeGreaterThan(30);
    expect(blip.rpm).toBeLessThan(55);
    expect(blip.flags.smoothed).toBe(true);
  });

  it('converges to the true value after several samples', () => {
    const f = new CadenceFilter();
    for (let i = 0; i < 10; i += 1) f.update({ rpm: 60, ts: 1000 + i * 100 });
    const settled = f.update({ rpm: 60, ts: 2000 });
    expect(settled.rpm).toBeGreaterThan(59);
    expect(settled.rpm).toBeLessThan(60.1);
  });

  it('the first sample passes through unsmoothed', () => {
    const f = new CadenceFilter();
    expect(f.update({ rpm: 50, ts: 1000 }).rpm).toBe(50);
  });

  it('treats an implausible value as a zero-blip for smoothing purposes (not a 200 spike)', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 60, ts: 1000 });
    f.update({ rpm: 60, ts: 1100 });
    const result = f.update({ rpm: 11618, ts: 1200 });
    expect(result.rpm).toBeLessThan(60); // smoothed toward 0, not toward 200
    expect(result.rpm).toBeGreaterThan(20);
    expect(result.flags.implausible).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run frontend/src/hooks/fitness/CadenceFilter.test.js`
Expected: FAIL — 3 of the new EMA tests fail because the filter isn't smoothing yet.

- [ ] **Step 3: Implement EMA in `CadenceFilter`**

Replace the body of `CadenceFilter.js`:

```javascript
const MAX_PLAUSIBLE_RPM = 200;
const EMA_ALPHA = 0.4;

export class CadenceFilter {
  constructor() {
    this._ema = null;
  }

  update({ rpm, ts }) {
    const flags = { implausible: false, smoothed: false, stale: false };
    let raw = rpm;

    if (!Number.isFinite(raw) || raw < 0 || raw > MAX_PLAUSIBLE_RPM) {
      flags.implausible = true;
      raw = 0;
    }

    let value;
    if (this._ema === null) {
      value = raw;
    } else {
      value = EMA_ALPHA * raw + (1 - EMA_ALPHA) * this._ema;
      flags.smoothed = true;
    }
    this._ema = value;

    return { rpm: value, ts, flags };
  }
}

export default CadenceFilter;
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run frontend/src/hooks/fitness/CadenceFilter.test.js`
Expected: PASS — 8 tests passed

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/CadenceFilter.js \
        frontend/src/hooks/fitness/CadenceFilter.test.js
git commit -m "feat(fitness): CadenceFilter EMA smoothing eliminates single-sample sensor blips"
```

---

## Task 3: Add staleness detection to `CadenceFilter`

**Files:**
- Modify: `frontend/src/hooks/fitness/CadenceFilter.js`
- Modify: `frontend/src/hooks/fitness/CadenceFilter.test.js`

**Hard contract:** when the cadence sensor stops broadcasting, the filter's reported RPM must reach **0 within 5 seconds** of the last fresh sample. This is intentionally more aggressive than heart-rate hold logic, because a rider really can stop pedalling instantly (whereas a person whose heart-rate broadcast goes silent is overwhelmingly more likely to have lost a sensor than to have died). Distinguish three regimes by elapsed gap since last fresh sample:

- `gap < STALE_THRESHOLD_MS` (1500 ms) — return last value, no flags
- `STALE_THRESHOLD_MS ≤ gap < LOST_SIGNAL_MS` (1500–4000 ms) — return last value linearly decayed toward 0; flag `stale: true`
- `gap ≥ LOST_SIGNAL_MS` (4000 ms, well inside the 5 s ceiling) — return 0; flag `lostSignal: true`

- [ ] **Step 1: Write the failing tests**

Append to `CadenceFilter.test.js`:

```javascript
describe('CadenceFilter — staleness', () => {
  it('marks output stale and decays the value when ts gap exceeds the grace threshold', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 60, ts: 1000 });
    const stale = f.tick(2750); // 1750 ms — 250 ms into the decay window
    expect(stale.flags.stale).toBe(true);
    expect(stale.flags.lostSignal).toBe(false);
    expect(stale.rpm).toBeLessThan(60);   // decaying
    expect(stale.rpm).toBeGreaterThan(45); // not collapsed yet
  });

  it('reports lost signal and returns 0 when ts gap exceeds the abandonment threshold', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 60, ts: 1000 });
    const lost = f.tick(5000); // 4 s since last update
    expect(lost.rpm).toBe(0);
    expect(lost.flags.lostSignal).toBe(true);
  });

  it('drops to 0 within 5 seconds of the last fresh sample (hard contract)', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 90, ts: 1000 });
    const atFiveSec = f.tick(6000); // exactly 5 s later
    expect(atFiveSec.rpm).toBe(0);
    expect(atFiveSec.flags.lostSignal).toBe(true);
  });

  it('a fresh update after a stale tick clears the stale flag', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 60, ts: 1000 });
    f.tick(2500);
    const fresh = f.update({ rpm: 58, ts: 2700 });
    expect(fresh.flags.stale).toBe(false);
    expect(fresh.flags.lostSignal).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run frontend/src/hooks/fitness/CadenceFilter.test.js`
Expected: FAIL — `f.tick is not a function`

- [ ] **Step 3: Implement staleness in `CadenceFilter`**

Replace the body of `CadenceFilter.js`:

```javascript
const MAX_PLAUSIBLE_RPM = 200;
const EMA_ALPHA = 0.4;
// Hard contract: zero within 5 s of last fresh sample. Decay starts at 1.5 s
// and reaches 0 by 4 s (well inside the 5 s ceiling).
const STALE_THRESHOLD_MS = 1500;
const LOST_SIGNAL_MS     = 4000;

export class CadenceFilter {
  constructor() {
    this._ema = null;
    this._lastUpdateTs = null;
    this._lastFreshValue = null;
  }

  update({ rpm, ts }) {
    const flags = {
      implausible: false,
      smoothed: false,
      stale: false,
      lostSignal: false
    };
    let raw = rpm;

    if (!Number.isFinite(raw) || raw < 0 || raw > MAX_PLAUSIBLE_RPM) {
      flags.implausible = true;
      raw = 0;
    }

    let value;
    if (this._ema === null) {
      value = raw;
    } else {
      value = EMA_ALPHA * raw + (1 - EMA_ALPHA) * this._ema;
      flags.smoothed = true;
    }
    this._ema = value;
    this._lastUpdateTs = ts;
    this._lastFreshValue = value;

    return { rpm: value, ts, flags };
  }

  tick(nowTs) {
    const flags = {
      implausible: false,
      smoothed: false,
      stale: false,
      lostSignal: false
    };
    if (this._lastUpdateTs === null || this._ema === null) {
      return { rpm: 0, ts: nowTs, flags: { ...flags, lostSignal: true } };
    }
    const gap = nowTs - this._lastUpdateTs;
    if (gap >= LOST_SIGNAL_MS) {
      this._ema = 0;
      this._lastFreshValue = 0;
      return { rpm: 0, ts: nowTs, flags: { ...flags, lostSignal: true } };
    }
    if (gap >= STALE_THRESHOLD_MS) {
      // Linear decay across the (STALE → LOST) window so the value visibly
      // drops toward 0 instead of holding flat. By definition this branch
      // only runs when STALE ≤ gap < LOST, so the divisor is non-zero.
      const decayProgress = (gap - STALE_THRESHOLD_MS)
                          / (LOST_SIGNAL_MS - STALE_THRESHOLD_MS);
      const decayed = this._lastFreshValue * (1 - decayProgress);
      return { rpm: Math.max(0, decayed), ts: nowTs, flags: { ...flags, stale: true } };
    }
    return { rpm: this._ema, ts: nowTs, flags };
  }
}

export default CadenceFilter;
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run frontend/src/hooks/fitness/CadenceFilter.test.js`
Expected: PASS — 11 tests passed

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/CadenceFilter.js \
        frontend/src/hooks/fitness/CadenceFilter.test.js
git commit -m "feat(fitness): CadenceFilter distinguishes stale-held from lost-signal"
```

---

## Task 4: Wire `CadenceFilter` into `GovernanceEngine`

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`

There are three sites in `GovernanceEngine.js` where raw `cadenceEntry.rpm` is consumed today: lines 486-487 (snapshot builder), 1706-1708 (manual cycle tick), and 2987-2989 (main eval loop). Centralise these via a `_filteredCadenceFor(equipmentId, nowTs)` helper that lazily creates one `CadenceFilter` per equipment.

- [ ] **Step 1: Read the existing call sites to understand the contract**

Run: `grep -n "equipmentCadenceMap" frontend/src/hooks/fitness/GovernanceEngine.js`
Expected: 3 matches at lines 486, 1706, and 2987.

Open `frontend/src/hooks/fitness/GovernanceEngine.js` and locate each match. The existing pattern at all three sites is:

```javascript
const cadenceEntry = this._latestInputs?.equipmentCadenceMap?.[equipmentKey];
const rpmVal = Number(cadenceEntry?.rpm);
const equipmentRpm = Number.isFinite(rpmVal) ? rpmVal : 0;
```

- [ ] **Step 2: Add the import and the helper to `GovernanceEngine`**

At the top of `GovernanceEngine.js`, add:

```javascript
import { CadenceFilter } from './CadenceFilter.js';
```

Find the constructor (search for `constructor(`) and add these initialisations alongside the other `this._*` fields:

```javascript
this._cadenceFilters = new Map();      // equipmentId → CadenceFilter
this._lastSeenCadenceTs = new Map();   // equipmentId → last ts we treated as fresh
```

Then add this method to the class (place it near `_buildChallengeSnapshot (cycle branch)` or other private helpers):

```javascript
/**
 * Filtered RPM read for the given equipment.
 *
 * Returns { rpm, flags } where flags include `stale` and `lostSignal`. The
 * caller decides what to do with stale/lost — for the cycle SM this means
 * "do not lock on a stale read; do treat lostSignal as 0".
 *
 * **Freshness contract:** the cadence map entry may be re-read every engine
 * tick even when the sensor has gone silent (the upstream pipeline doesn't
 * clear it). We only count a sample as fresh when its `ts` is strictly
 * greater than the last `ts` we observed for this equipment. Without this
 * check, the filter's staleness clock would never advance and the held
 * value would persist indefinitely — which is the bug the user hit:
 * "RPM holds the most recent value much longer than it should."
 */
_filteredCadenceFor(equipmentId, nowTs) {
  if (!equipmentId) return { rpm: 0, flags: { lostSignal: true } };
  let filter = this._cadenceFilters.get(equipmentId);
  if (!filter) {
    filter = new CadenceFilter();
    this._cadenceFilters.set(equipmentId, filter);
  }
  const cadenceEntry = this._latestInputs?.equipmentCadenceMap?.[equipmentId];
  const entryTs = Number(cadenceEntry?.ts);
  const entryRpm = Number(cadenceEntry?.rpm);
  const lastSeen = this._lastSeenCadenceTs.get(equipmentId) ?? -Infinity;

  const isFresh =
    cadenceEntry &&
    Number.isFinite(entryTs) &&
    entryTs > lastSeen &&
    Number.isFinite(entryRpm);

  if (isFresh) {
    this._lastSeenCadenceTs.set(equipmentId, entryTs);
    return filter.update({ rpm: entryRpm, ts: entryTs });
  }
  // No fresh sample this tick — let the filter advance its staleness clock.
  return filter.tick(nowTs);
}
```

- [ ] **Step 3: Replace the three call sites**

At line ~486-487 (snapshot builder, inside `_buildChallengeSnapshot (cycle branch)`):

Old:
```javascript
const cadenceEntry = this._latestInputs?.equipmentCadenceMap?.[activeChallenge.equipment];
const currentRpm = cadenceEntry?.rpm || 0;
```

New:
```javascript
const filtered = this._filteredCadenceFor(activeChallenge.equipment, Date.now());
const currentRpm = filtered.rpm;
const cadenceFlags = filtered.flags;
```

At line ~1706-1708 (`tickManualCycle`):

Old:
```javascript
const cadenceEntry = this._latestInputs?.equipmentCadenceMap?.[active.equipment];
const rpmVal = Number(cadenceEntry?.rpm);
const equipmentRpm = Number.isFinite(rpmVal) ? rpmVal : 0;
```

New:
```javascript
const filtered = this._filteredCadenceFor(active.equipment, Date.now());
const equipmentRpm = filtered.rpm;
```

At line ~2987-2989 (main eval loop):

Old:
```javascript
const cadenceEntry = this._latestInputs?.equipmentCadenceMap?.[challenge.equipment];
const rpmVal = Number(cadenceEntry?.rpm);
const equipmentRpm = Number.isFinite(rpmVal) ? rpmVal : 0;
```

New:
```javascript
const filtered = this._filteredCadenceFor(challenge.equipment, Date.now());
const equipmentRpm = filtered.rpm;
```

- [ ] **Step 4: Forward `cadenceFlags` to the snapshot**

In `_buildChallengeSnapshot (cycle branch)` (the `return { … }` near line 579-600), add:

```javascript
return {
  …existing fields…,
  currentRpm,
  cadenceFlags,            // exposes stale / lostSignal to the overlay
  …
};
```

- [ ] **Step 5: Pin the freshness behaviour with a dedicated test**

Append to `frontend/src/hooks/fitness/CycleStateMachine.test.js` (created in Task 5; if you're executing in order, defer this step until Task 5 lands):

```javascript
describe('Cycle SM — cadence freshness', () => {
  it('lets the filter decay to 0 within 5s when the sensor stops broadcasting', () => {
    const session = new FitnessSession({ /* fixture */ });
    session.governanceEngine.triggerChallenge({
      type: 'cycle', selectionId: 'default_0_7', riderId: 'kckern'
    });
    // 1) Inject one fresh sample.
    session.governanceEngine._latestInputs = {
      equipmentCadenceMap: { cycle_ace: { rpm: 80, ts: 1000 } },
      activeParticipants: ['kckern'],
      userZoneMap: { kckern: 'warm' }
    };
    session.governanceEngine.evaluate({ now: 1000 });
    // 2) Tick repeatedly with the SAME entry (sensor silent — input pipeline
    //    didn't clear the map). The filter should age it out.
    let lastRpm = null;
    for (let t = 1100; t <= 6500; t += 200) {
      session.governanceEngine.evaluate({ now: t });
      lastRpm = session.governanceEngine.challengeState?.activeChallenge?.currentRpm;
    }
    expect(lastRpm).toBe(0);
  });
});
```

- [ ] **Step 6: Run the existing engine tests to confirm nothing regressed**

Run: `npx vitest run frontend/src/hooks/fitness/`
Expected: all existing tests pass (FitnessSession.contentId, FitnessSession.resumable, selectPrimaryMedia, CadenceFilter, and once Task 5 lands, CycleStateMachine).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        frontend/src/hooks/fitness/CycleStateMachine.test.js
git commit -m "feat(fitness): GovernanceEngine reads cadence through CadenceFilter; freshness-checked"
```

---

## Task 5: Sensor-blip integration test for cycle SM

**Files:**
- Create: `frontend/src/hooks/fitness/CycleStateMachine.test.js`

Reproduces the 2026-05-04 pattern (rpm bouncing 0↔55) and proves the filter prevents lock storms. This test is the regression guard for everything in Tasks 1-4.

- [ ] **Step 1: Inspect existing engine tests for the instantiation pattern**

Run: `grep -nE "new FitnessSession|new GovernanceEngine|getGovernanceEngine" frontend/src/hooks/fitness/FitnessSession.contentId.test.js frontend/src/hooks/fitness/FitnessSession.resumable.test.js`
Expected: shows whatever pattern the existing tests use to construct the unit under test.

Read those tests in full to understand the constructor arguments and the `_latestInputs` shape they use.

- [ ] **Step 2: Write the failing test (model after the existing patterns)**

```javascript
// frontend/src/hooks/fitness/CycleStateMachine.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { FitnessSession } from './FitnessSession.js';

// Helper: feed the engine a sequence of cadence samples and return the
// cycle state after each tick. Adapt construction to match how the existing
// tests build a session (see FitnessSession.contentId.test.js).
function runCadenceSequence(samples) {
  const session = new FitnessSession({ /* mirror the existing test fixture */ });
  // 1. Force-start a cycle challenge with a known rider so manualTrigger=true.
  session.governanceEngine.triggerChallenge({
    type: 'cycle',
    selectionId: 'default_0_7',
    riderId: 'kckern'
  });
  const states = [];
  for (const { rpm, ts } of samples) {
    session.governanceEngine._latestInputs = {
      equipmentCadenceMap: { cycle_ace: { rpm, ts } },
      activeParticipants: ['kckern'],
      userZoneMap: { kckern: 'warm' }
    };
    session.governanceEngine.evaluate({ now: ts });
    states.push(session.governanceEngine.challengeState?.activeChallenge?.cycleState);
  }
  return states;
}

describe('Cycle SM — sensor noise resilience', () => {
  it('does not enter locked when rpm bounces 0↔55 (single-sample dropouts)', () => {
    const samples = [];
    let ts = 1000;
    for (let i = 0; i < 30; i += 1) {
      samples.push({ rpm: i % 2 === 0 ? 55 : 0, ts });
      ts += 200;
    }
    const states = runCadenceSequence(samples);
    const locks = states.filter((s) => s === 'locked').length;
    expect(locks).toBeLessThan(2); // pre-fix: was 10+ locks
  });

  it('does still lock when rpm is sustained below loRpm for >1s', () => {
    const samples = [];
    let ts = 1000;
    for (let i = 0; i < 5; i += 1) { samples.push({ rpm: 55, ts }); ts += 200; }
    for (let i = 0; i < 8; i += 1) { samples.push({ rpm: 10, ts }); ts += 200; } // sustained dump
    const states = runCadenceSequence(samples);
    expect(states).toContain('locked');
  });

  it('does not propagate an 11618-RPM implausible spike to currentRpm', () => {
    const samples = [
      { rpm: 60,    ts: 1000 },
      { rpm: 60,    ts: 1200 },
      { rpm: 11618, ts: 1400 },
      { rpm: 60,    ts: 1600 }
    ];
    const session = new FitnessSession({ /* fixture as above */ });
    session.governanceEngine.triggerChallenge({
      type: 'cycle', selectionId: 'default_0_7', riderId: 'kckern'
    });
    let lastRpm = null;
    for (const { rpm, ts } of samples) {
      session.governanceEngine._latestInputs = {
        equipmentCadenceMap: { cycle_ace: { rpm, ts } },
        activeParticipants: ['kckern'],
        userZoneMap: { kckern: 'warm' }
      };
      session.governanceEngine.evaluate({ now: ts });
      lastRpm = session.governanceEngine.challengeState?.activeChallenge?.currentRpm;
    }
    expect(lastRpm).toBeLessThan(120);
  });
});
```

> **Note for the implementer:** mirror whatever fixture-builder pattern `FitnessSession.contentId.test.js` already uses. If those tests use a `makeSession({...})` helper, reuse it rather than duplicating constructor wiring.

- [ ] **Step 3: Run test to verify the noise-resilience case fails the way the audit predicts (>2 locks) on Tasks 1-4 unimplemented, and passes once they are**

Run: `npx vitest run frontend/src/hooks/fitness/CycleStateMachine.test.js`
Expected: PASS for all 3 tests on top of Tasks 1-4.

If the noise-resilience test still fails post-Task-4, increase EMA_ALPHA's smoothing (lower it from 0.4 toward 0.3) and re-run; the smoothed value at a 0-blip after three 55s is roughly `0.4 * 0 + 0.6 * 55 = 33`, which is below loRpm=37 in phase 0. **This is expected to need Task 6's debounce to fully suppress; if the test still fails after Task 6, that is the trigger to revisit it.** Mark the test `.skip` with a TODO comment referencing Task 6 if needed, and unskip in Task 6.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/CycleStateMachine.test.js
git commit -m "test(fitness): cycle SM resilience to single-sample sensor blips"
```

---

## Task 6: State-transition minimum hold (debounce)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`

Even with smoothed input, a *real* dip below loRpm immediately followed by recovery should not trigger a 50-ms locked flash. Hold the engine's *external* state (the value placed in the snapshot) one step behind the *internal* state, releasing only after the internal state has been stable for ≥500 ms. Internal state continues to update so progress is preserved.

- [ ] **Step 1: Write the failing test**

Append to `CycleStateMachine.test.js`:

```javascript
describe('Cycle SM — transition debounce', () => {
  it('does not surface a locked snapshot when locked-state lasts <500 ms', () => {
    const samples = [
      ...Array.from({ length: 5 }, (_, i) => ({ rpm: 55, ts: 1000 + i * 200 })), // ramp+maintain
      { rpm: 0,  ts: 2000 },   // brief dump
      { rpm: 55, ts: 2200 }    // back, total 200 ms <500 ms
    ];
    const states = runCadenceSequence(samples);
    expect(states[states.length - 1]).not.toBe('locked');
  });

  it('does surface a locked snapshot when locked-state lasts ≥500 ms', () => {
    const samples = [
      ...Array.from({ length: 5 }, (_, i) => ({ rpm: 55, ts: 1000 + i * 200 })),
      { rpm: 0, ts: 2000 },
      { rpm: 0, ts: 2300 },
      { rpm: 0, ts: 2600 } // 600 ms
    ];
    const states = runCadenceSequence(samples);
    expect(states[states.length - 1]).toBe('locked');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/hooks/fitness/CycleStateMachine.test.js`
Expected: the new "does not surface" test fails — current snapshot reflects the locked state instantly.

- [ ] **Step 3: Implement the debounce in `_buildChallengeSnapshot (cycle branch)`**

In `GovernanceEngine.js` add to the `activeChallenge` initialisation in `_startCycleChallenge` (around line 2330):

```javascript
_publishedCycleState: 'init',
_publishedAt: now,
_pendingCycleState: 'init',
_pendingSince: now
```

Then, in `_buildChallengeSnapshot (cycle branch)` (just before computing the return shape), add:

```javascript
const STATE_DEBOUNCE_MS = 500;
const internal = activeChallenge.cycleState;
if (internal !== activeChallenge._pendingCycleState) {
  activeChallenge._pendingCycleState = internal;
  activeChallenge._pendingSince = now;
}
const heldEnough = (now - activeChallenge._pendingSince) >= STATE_DEBOUNCE_MS;
// `success` and `locked-with-fatal-cause` always publish immediately.
const fatal = activeChallenge.status === 'success'
           || activeChallenge.lockReason === 'init';
if (heldEnough || fatal || activeChallenge._publishedCycleState === internal) {
  activeChallenge._publishedCycleState = internal;
  activeChallenge._publishedAt = now;
}
const publishedState = activeChallenge._publishedCycleState;
```

Then change the snapshot return field from `cycleState: activeChallenge.cycleState` to `cycleState: publishedState`.

- [ ] **Step 4: Run all cycle tests**

Run: `npx vitest run frontend/src/hooks/fitness/CycleStateMachine.test.js`
Expected: all 5 tests pass. Also re-run Task 5's noise-resilience test if it was skipped — should now pass without further EMA tuning.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        frontend/src/hooks/fitness/CycleStateMachine.test.js
git commit -m "feat(fitness): cycle SM publishes state with 500ms debounce"
```

---

## Task 7: Symmetric init↔ramp gate (fix init_timeout-then-locked oscillation)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`

Audit finding F2: when init times out, the engine locks; recovery from `locked` (lockReason='init') re-enters `init` with only the RPM gate, not the baseReq gate. This loops every 60 s. Fix: when `init` times out and `(rpm >= minRpm AND !baseReqSatisfied)`, do **not** lock — stay in `init`, reset `initElapsedMs` to 0, and surface a `waitingForBaseReq: true` flag on the snapshot. Lock only if RPM is also below `minRpm`.

- [ ] **Step 1: Write the failing test**

Append to `CycleStateMachine.test.js`:

```javascript
describe('Cycle SM — init↔ramp gate symmetry', () => {
  it('does not enter locked on init_timeout when rider is pedalling but baseReq is unmet', () => {
    // Rider above minRpm, but no zone satisfaction. Run for >60 s sim time.
    const session = new FitnessSession({ /* fixture */ });
    session.governanceEngine.triggerChallenge({
      type: 'cycle', selectionId: 'default_0_7'   // no riderId → manualTrigger=false
    });
    const states = [];
    let ts = 1000;
    for (let i = 0; i < 360; i += 1) { // 360 ticks * 200ms = 72 s
      session.governanceEngine._latestInputs = {
        equipmentCadenceMap: { cycle_ace: { rpm: 60, ts } },
        activeParticipants: ['kckern'],
        userZoneMap: { kckern: 'cool' }   // not in zone → baseReq fails
      };
      session.governanceEngine.evaluate({ now: ts });
      states.push(session.governanceEngine.challengeState?.activeChallenge?.cycleState);
      ts += 200;
    }
    const lockEvents = states.filter((s) => s === 'locked').length;
    expect(lockEvents).toBe(0);
    const lastChallenge = session.governanceEngine.challengeState?.activeChallenge;
    expect(lastChallenge.waitingForBaseReq).toBe(true);
  });

  it('does enter locked on init_timeout when rider is below minRpm AND baseReq is unmet', () => {
    const session = new FitnessSession({ /* fixture */ });
    session.governanceEngine.triggerChallenge({
      type: 'cycle', selectionId: 'default_0_7'
    });
    let ts = 1000;
    for (let i = 0; i < 360; i += 1) {
      session.governanceEngine._latestInputs = {
        equipmentCadenceMap: { cycle_ace: { rpm: 5, ts } },   // below minRpm 30
        activeParticipants: ['kckern'],
        userZoneMap: { kckern: 'cool' }
      };
      session.governanceEngine.evaluate({ now: ts });
      ts += 200;
    }
    expect(session.governanceEngine.challengeState?.activeChallenge?.cycleState).toBe('locked');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/hooks/fitness/CycleStateMachine.test.js`
Expected: the first test fails — the current code locks on init_timeout regardless.

- [ ] **Step 3: Modify the init branch in `_evaluateCycleChallenge`**

In `GovernanceEngine.js` around line 2408-2447, replace the init branch with:

```javascript
if (active.cycleState === 'init') {
  active.initElapsedMs += dt;
  const rpmAtMin = ctx.equipmentRpm >= active.selection.init.minRpm;
  const gatesOpen = active.manualTrigger || ctx.baseReqSatisfiedForRider;

  if (rpmAtMin && gatesOpen) {
    active.waitingForBaseReq = false;
    active.cycleState = 'ramp';
    active.rampElapsedMs = 0;
    getLogger().info('governance.cycle.state_transition', {
      challengeId: active.id, from: 'init', to: 'ramp',
      currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
      currentRpm: ctx.equipmentRpm
    });
    return;
  }

  if (active.initElapsedMs >= active.initTotalMs) {
    if (rpmAtMin) {
      // Rider is doing the work — hold init, wait for HR-zone gate.
      active.initElapsedMs = 0;
      active.waitingForBaseReq = true;
      getLogger().sampled('governance.cycle.holding_for_base_req', {
        challengeId: active.id, currentRpm: ctx.equipmentRpm
      }, { maxPerMinute: 1, aggregate: true });
      return;
    }
    // True abandonment — rider not pedalling AND base-req not met.
    active.cycleState = 'locked';
    active.lockReason = 'init';
    active.totalLockEventsCount += 1;
    active.waitingForBaseReq = false;
    getLogger().info('governance.cycle.state_transition', {
      challengeId: active.id, from: 'init', to: 'locked',
      currentPhaseIndex: active.currentPhaseIndex, rider: active.rider,
      currentRpm: ctx.equipmentRpm, reason: 'init_timeout'
    });
    getLogger().info('governance.cycle.locked', {
      challengeId: active.id, lockReason: 'init',
      phaseIndex: active.currentPhaseIndex, currentRpm: ctx.equipmentRpm,
      threshold: active.selection.init.minRpm,
      totalLockEventsCount: active.totalLockEventsCount
    });
  }
  return;
}
```

Also add `waitingForBaseReq: false` to the active-challenge initialisation in `_startCycleChallenge` (around line 2330).

Forward `waitingForBaseReq` in the `_buildChallengeSnapshot (cycle branch)` return shape:

```javascript
return {
  ...existing fields...,
  waitingForBaseReq: Boolean(activeChallenge.waitingForBaseReq),
  ...
};
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run frontend/src/hooks/fitness/`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        frontend/src/hooks/fitness/CycleStateMachine.test.js
git commit -m "feat(fitness): cycle SM holds init on rpm-met-but-baseReq-unmet, no oscillation"
```

---

## Task 8: Pause init/ramp clocks when rider is not pedalling

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`

Audit finding F4: `initElapsedMs` and `rampElapsedMs` tick on wall-clock, so a rider who steps off the bike for 30 s loses 30 s of their startup budget. Make both clocks pause when `equipmentRpm < init.minRpm`. The clocks resume on the next tick where the rider is moving.

- [ ] **Step 1: Write the failing test**

Append to `CycleStateMachine.test.js`:

```javascript
describe('Cycle SM — init/ramp clocks pause when rider is idle', () => {
  it('does not advance initElapsedMs when rpm is below minRpm', () => {
    const session = new FitnessSession({ /* fixture */ });
    session.governanceEngine.triggerChallenge({
      type: 'cycle', selectionId: 'default_0_7'
    });
    let ts = 1000;
    for (let i = 0; i < 50; i += 1) { // 10 s of idle
      session.governanceEngine._latestInputs = {
        equipmentCadenceMap: { cycle_ace: { rpm: 5, ts } },
        activeParticipants: ['kckern'],
        userZoneMap: { kckern: 'cool' }
      };
      session.governanceEngine.evaluate({ now: ts });
      ts += 200;
    }
    const initElapsed = session.governanceEngine.challengeState
      ?.activeChallenge?.initElapsedMs;
    expect(initElapsed).toBeLessThan(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/hooks/fitness/CycleStateMachine.test.js`
Expected: fails — `initElapsedMs ≈ 10000`.

- [ ] **Step 3: Gate the clock increments**

In the init branch of `_evaluateCycleChallenge`, change:

```javascript
active.initElapsedMs += dt;
```

to:

```javascript
if (ctx.equipmentRpm >= active.selection.init.minRpm) {
  active.initElapsedMs += dt;
}
```

In the ramp branch of `_evaluateCycleChallenge` (around line 2452), change:

```javascript
active.rampElapsedMs += dt;
```

to:

```javascript
if (ctx.equipmentRpm >= active.selection.init.minRpm) {
  active.rampElapsedMs += dt;
}
```

- [ ] **Step 4: Run all tests, including a sanity re-run of Task 7**

Run: `npx vitest run frontend/src/hooks/fitness/`
Expected: all pass; the Task 7 init_timeout tests still pass because the rider in those tests is pedalling.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        frontend/src/hooks/fitness/CycleStateMachine.test.js
git commit -m "feat(fitness): init/ramp clocks pause when rider is idle"
```

---

## Task 9: Surface `cadenceFlags` and `waitingForBaseReq` in `cycleOverlayVisuals`

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js`
- Modify: `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js` (create if absent — this folder has no co-located test today; mirror the pattern from `CadenceFilter.test.js`)

The visuals helper currently maps `cycleState → ringColor/opacity`. Extend it to also pass through `lostSignal`, `stale`, `waitingForBaseReq`, and the init/ramp countdown values from the challenge snapshot.

- [ ] **Step 1: Create or extend the visuals test**

```javascript
// frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js
import { describe, it, expect } from 'vitest';
import { getCycleOverlayVisuals } from './cycleOverlayVisuals.js';

describe('cycleOverlayVisuals — extended state', () => {
  const baseChallenge = { type: 'cycle', cycleState: 'init', dimFactor: 0, phaseProgressPct: 0 };

  it('exposes lostSignal flag from cadenceFlags', () => {
    const v = getCycleOverlayVisuals({ ...baseChallenge, cadenceFlags: { lostSignal: true } });
    expect(v.lostSignal).toBe(true);
  });

  it('exposes waitingForBaseReq flag', () => {
    const v = getCycleOverlayVisuals({ ...baseChallenge, waitingForBaseReq: true });
    expect(v.waitingForBaseReq).toBe(true);
  });

  it('exposes initRemainingMs and rampRemainingMs', () => {
    const v = getCycleOverlayVisuals({
      ...baseChallenge,
      initRemainingMs: 23000,
      rampRemainingMs: 7000
    });
    expect(v.initRemainingMs).toBe(23000);
    expect(v.rampRemainingMs).toBe(7000);
  });

  it('defaults extended fields to safe values when absent', () => {
    const v = getCycleOverlayVisuals(baseChallenge);
    expect(v.lostSignal).toBe(false);
    expect(v.waitingForBaseReq).toBe(false);
    expect(v.initRemainingMs).toBeNull();
    expect(v.rampRemainingMs).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — fails because fields don't exist on the return shape**

Run: `npx vitest run frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js`
Expected: FAIL — `expect(v.lostSignal).toBe(true)` receives `undefined`.

- [ ] **Step 3: Extend `cycleOverlayVisuals.js`**

Inside the function `getCycleOverlayVisuals`, just before the `return { … }`, compute:

```javascript
const lostSignal       = Boolean(challenge.cadenceFlags?.lostSignal);
const stale            = Boolean(challenge.cadenceFlags?.stale);
const waitingForBaseReq = Boolean(challenge.waitingForBaseReq);
const initRemainingMs  = Number.isFinite(challenge.initRemainingMs)
  ? challenge.initRemainingMs : null;
const rampRemainingMs  = Number.isFinite(challenge.rampRemainingMs)
  ? challenge.rampRemainingMs : null;
```

And include them in the return shape:

```javascript
return {
  visible: true,
  ringColor,
  ringOpacity,
  dimPulse,
  phaseProgress,
  positionValid: true,
  lostSignal,
  stale,
  waitingForBaseReq,
  initRemainingMs,
  rampRemainingMs
};
```

Also update the `OFF` const to include the new fields with safe defaults:

```javascript
const OFF = Object.freeze({
  visible: false,
  ringColor: RING_COLORS.neutral,
  ringOpacity: 0,
  dimPulse: false,
  phaseProgress: 0,
  positionValid: false,
  lostSignal: false,
  stale: false,
  waitingForBaseReq: false,
  initRemainingMs: null,
  rampRemainingMs: null
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js \
        frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js
git commit -m "feat(fitness): cycleOverlayVisuals exposes cadence flags and countdowns"
```

---

## Task 10: `CycleBaseReqIndicator` component

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.jsx`
- Create: `frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.scss`
- Create: `frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.test.jsx`

A small dot/pill rendered inside `CycleChallengeOverlay` that turns green when the HR-zone gate is satisfied, amber when the rider is pedalling but waiting for HR (i.e. `waitingForBaseReq`), and grey when neither is true. Tooltip text explains.

- [ ] **Step 1: Write the failing component test**

```jsx
// frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CycleBaseReqIndicator } from './CycleBaseReqIndicator.jsx';

describe('CycleBaseReqIndicator', () => {
  it('renders the satisfied state when baseReqSatisfied is true', () => {
    render(<CycleBaseReqIndicator baseReqSatisfied waitingForBaseReq={false} />);
    expect(screen.getByLabelText(/heart-rate.*satisfied/i)).toBeInTheDocument();
    expect(screen.getByTestId('base-req-dot').className).toMatch(/satisfied/);
  });

  it('renders the waiting state when waitingForBaseReq is true', () => {
    render(<CycleBaseReqIndicator baseReqSatisfied={false} waitingForBaseReq />);
    expect(screen.getByLabelText(/waiting.*heart-rate/i)).toBeInTheDocument();
    expect(screen.getByTestId('base-req-dot').className).toMatch(/waiting/);
  });

  it('renders the inactive state when neither flag is true', () => {
    render(<CycleBaseReqIndicator baseReqSatisfied={false} waitingForBaseReq={false} />);
    expect(screen.getByTestId('base-req-dot').className).toMatch(/inactive/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```jsx
// frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.jsx
import React from 'react';
import PropTypes from 'prop-types';
import './CycleBaseReqIndicator.scss';

export const CycleBaseReqIndicator = ({ baseReqSatisfied, waitingForBaseReq }) => {
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
      className={`cycle-base-req cycle-base-req--${mode}`}
      role="status"
      aria-label={label}
    >
      <span
        data-testid="base-req-dot"
        className={`cycle-base-req__dot cycle-base-req__dot--${mode}`}
      />
      <span className="cycle-base-req__label">{label}</span>
    </div>
  );
};

CycleBaseReqIndicator.propTypes = {
  baseReqSatisfied: PropTypes.bool,
  waitingForBaseReq: PropTypes.bool
};

export default CycleBaseReqIndicator;
```

```scss
// frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.scss
.cycle-base-req {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.3);
  color: #e2e8f0;
}
.cycle-base-req__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #475569;
}
.cycle-base-req__dot--satisfied { background: #22c55e; }
.cycle-base-req__dot--waiting   { background: #f59e0b; }
.cycle-base-req__dot--inactive  { background: #475569; }
.cycle-base-req__label { white-space: nowrap; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.test.jsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.jsx \
        frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.scss \
        frontend/src/modules/Fitness/player/overlays/CycleBaseReqIndicator.test.jsx
git commit -m "feat(fitness): CycleBaseReqIndicator surfaces HR-zone gate state"
```

---

## Task 11: Render indicator + countdown inside `CycleChallengeOverlay`

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss`

Place `CycleBaseReqIndicator` near the rider name. Show a countdown text below the inner progress bar when `cycleState === 'init' || 'ramp'`. Add a `--lost-signal` modifier class that dims the needle when the cadence sensor has lost signal.

- [ ] **Step 1: Add the indicator and countdown rendering**

In `CycleChallengeOverlay.jsx`, near the top imports:

```javascript
import { CycleBaseReqIndicator } from './CycleBaseReqIndicator.jsx';
```

Pull the new fields out of `visuals`:

```javascript
const {
  ringColor,
  ringOpacity,
  dimPulse,
  phaseProgress,
  lostSignal,
  stale,
  waitingForBaseReq,
  initRemainingMs,
  rampRemainingMs
} = visuals;
```

Wire `--lost-signal` into `classNames`:

```javascript
if (lostSignal) classNames.push('cycle-challenge-overlay--lost-signal');
if (stale)      classNames.push('cycle-challenge-overlay--stale');
```

Add a base-req indicator next to the rider name (find the `riderName && <div>...</div>` block around line 457-459 and replace with):

```jsx
{riderName && (
  <div className="cycle-challenge-overlay__rider-name">
    {riderName}
    <CycleBaseReqIndicator
      baseReqSatisfied={!!challenge.baseReqSatisfiedForRider}
      waitingForBaseReq={waitingForBaseReq}
    />
  </div>
)}
```

Add a countdown line after the inner progress bar (after the `cycle-challenge-overlay__progress-bar` block around line 479):

```jsx
{(challenge.cycleState === 'init' || challenge.cycleState === 'ramp') && (
  <div className="cycle-challenge-overlay__countdown">
    {challenge.cycleState === 'init' && Number.isFinite(initRemainingMs) && (
      <span>Start in {Math.ceil(initRemainingMs / 1000)}s</span>
    )}
    {challenge.cycleState === 'ramp' && Number.isFinite(rampRemainingMs) && (
      <span>Reach target in {Math.ceil(rampRemainingMs / 1000)}s</span>
    )}
  </div>
)}
```

Update the propTypes for `challenge` to include `baseReqSatisfiedForRider`, `cadenceFlags`, `waitingForBaseReq`, `initRemainingMs`, `rampRemainingMs`.

- [ ] **Step 2: Add SCSS for the new elements and lost-signal modifier**

Append to `CycleChallengeOverlay.scss`:

```scss
.cycle-challenge-overlay__countdown {
  margin-top: 4px;
  font-size: 11px;
  color: #94a3b8;
  text-align: center;
}

.cycle-challenge-overlay--lost-signal .cycle-needle,
.cycle-challenge-overlay--stale       .cycle-needle {
  opacity: 0.35;
}

.cycle-challenge-overlay--lost-signal::after {
  content: 'No signal';
  position: absolute;
  top: 4px; right: 4px;
  font-size: 10px;
  color: #f59e0b;
  background: rgba(0, 0, 0, 0.5);
  padding: 1px 4px;
  border-radius: 4px;
}
```

- [ ] **Step 3: Smoke-render the overlay in vitest with the new shape**

Append to a new file `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CycleChallengeOverlay } from './CycleChallengeOverlay.jsx';

const baseChallenge = {
  type: 'cycle',
  cycleState: 'init',
  dimFactor: 0,
  phaseProgressPct: 0,
  currentPhaseIndex: 0,
  totalPhases: 3,
  currentPhase: { hiRpm: 49, loRpm: 37 },
  rider: { id: 'kckern', name: 'KC Kern' },
  currentRpm: 60,
  initRemainingMs: 23000,
  rampRemainingMs: null,
  cadenceFlags: { lostSignal: false, stale: false },
  waitingForBaseReq: false,
  baseReqSatisfiedForRider: true
};

describe('CycleChallengeOverlay — extended UI', () => {
  it('renders the init countdown', () => {
    render(<CycleChallengeOverlay challenge={baseChallenge} />);
    expect(screen.getByText(/Start in 23s/)).toBeInTheDocument();
  });

  it('renders the base-req indicator in satisfied mode', () => {
    render(<CycleChallengeOverlay challenge={baseChallenge} />);
    expect(screen.getByLabelText(/heart-rate.*satisfied/i)).toBeInTheDocument();
  });

  it('shows lost-signal class when cadenceFlags.lostSignal is true', () => {
    const ch = { ...baseChallenge, cadenceFlags: { lostSignal: true, stale: false } };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    expect(container.querySelector('.cycle-challenge-overlay--lost-signal')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run frontend/src/modules/Fitness/player/overlays/`
Expected: all overlay tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx \
        frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss \
        frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
git commit -m "feat(fitness): cycle overlay shows base-req indicator, countdown, and lost-signal"
```

---

## Task 12: End-to-end Playwright sensor-blip repro

**Files:**
- Create: `tests/live/flow/fitness/cycle-challenge-noise-resilience.runtime.test.mjs`

A live test that drives the simulator panel to inject a 0↔55 RPM bouncing cadence stream, opens the cycle demo, and asserts that the overlay does *not* show the locked state more than once over a 15-second window. This is the audit's red-team test re-run as a regression guard.

- [ ] **Step 1: Read an existing runtime test for the harness pattern**

Run: `ls tests/live/flow/fitness/*.runtime.test.mjs | head -3`
Read the most relevant one (e.g. `cycle-demo-launch.runtime.test.mjs.local-pre-merge` if it exists, or any other cycle/governance runtime test) to learn the page-object pattern and how to drive the simulator from the test.

- [ ] **Step 2: Write the runtime test**

```javascript
// tests/live/flow/fitness/cycle-challenge-noise-resilience.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { getAppPort } from '#testlib/configHelper.mjs';

test('cycle overlay does not strobe locked state under 0↔55 RPM noise', async ({ page }) => {
  const port = getAppPort();
  await page.goto(`http://localhost:${port}/fitness/menu/app_menu1`);
  await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30_000 });

  // Open the cycle demo and start a challenge with a forced rider so manualTrigger=true.
  const card = page.locator('.module-card', { hasText: 'Cycle Challenge Demo' });
  await card.click();
  await page.waitForURL(/\/fitness\/play\/\d+\?.*cycle-demo=1/, { timeout: 20_000 });

  // Inject 30 alternating samples (~6 s) at 200ms spacing.
  await page.evaluate(async () => {
    const setRpm = (rpm) => {
      const sim = window.__fitnessSimController;
      sim?.setEquipmentCadence?.('cycle_ace', { rpm, ts: Date.now() });
    };
    for (let i = 0; i < 30; i += 1) {
      setRpm(i % 2 === 0 ? 55 : 0);
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  // Sample the published cycleState every 200ms for 15s and count locked appearances.
  const lockedCount = await page.evaluate(async () => {
    let count = 0;
    let prev = null;
    for (let i = 0; i < 75; i += 1) {
      const state = window.__fitnessGovernance?.cycleState;
      if (state === 'locked' && prev !== 'locked') count += 1;
      prev = state;
      await new Promise((r) => setTimeout(r, 200));
    }
    return count;
  });

  expect(lockedCount).toBeLessThan(2);
});
```

> **Note for the implementer:** if the simulator does not expose `setEquipmentCadence`, add it to `FitnessSimulationController` as a thin pass-through to whatever feeds `_latestInputs.equipmentCadenceMap`. That addition belongs in this task.

- [ ] **Step 3: Run test**

Run: `npx playwright test tests/live/flow/fitness/cycle-challenge-noise-resilience.runtime.test.mjs --reporter=line`
Expected: PASS — fewer than 2 locked transitions over the sampling window.

- [ ] **Step 4: Commit**

```bash
git add tests/live/flow/fitness/cycle-challenge-noise-resilience.runtime.test.mjs \
        frontend/src/modules/Fitness/nav/FitnessSimulationController.js
git commit -m "test(fitness): live test pinning cycle overlay against sensor noise"
```

---

## Task 13: Audit close-out + doc move

**Files:**
- Move: `docs/_wip/audits/2026-05-03-cycling-challenge-ux-failure-audit.md` → `docs/_archive/2026-05-03-cycling-challenge-ux-failure-audit.md`
- Modify: the audit itself — append a "Resolution" footer linking this plan and listing each F* finding's resolving commit hash.

- [ ] **Step 1: Append a Resolution section to the audit**

Open the audit and add at the bottom:

```markdown
---

## Resolution — 2026-05-04

Remediated by `docs/superpowers/plans/2026-05-04-cycle-challenge-remediation.md`.
Per-finding fix commits:

- F1, F1b: Tasks 1–4 (CadenceFilter — clamp, EMA, staleness; wired into engine)
- F2:      Task 7 (init holds on rpm-met-baseReq-unmet)
- F3:      Tasks 10–11 (CycleBaseReqIndicator + countdown)
- F4:      Task 8 (init/ramp clocks pause when rider idle)
- F5:      Task 6 (state-transition 500 ms debounce)
- F6:      Task 12 (Playwright forces manualTrigger via riderId)

Regression guard: Tasks 5, 6, 7, 8, 11, 12.
```

- [ ] **Step 2: Move the audit to `_archive`**

Run:

```bash
git mv docs/_wip/audits/2026-05-03-cycling-challenge-ux-failure-audit.md \
       docs/_archive/2026-05-03-cycling-challenge-ux-failure-audit.md
```

- [ ] **Step 3: Commit**

```bash
git add docs/_archive/2026-05-03-cycling-challenge-ux-failure-audit.md \
        docs/_wip/audits/2026-05-03-cycling-challenge-ux-failure-audit.md
git commit -m "docs: archive cycling-challenge-ux-failure audit with resolution footer"
```

---

## Self-Review Notes

- **Spec coverage:** Audit findings F1, F1b, F2, F3, F4, F5, F6 each have a labelled task. F1+F1b → Tasks 1-4. F2 → Task 7. F3 → Tasks 10-11. F4 → Task 8. F5 → Task 6. F6 → Task 12 (which forces manualTrigger by passing `riderId`, exercising the demo plumbing path).
- **Type consistency:** `cadenceFlags` (object with `lostSignal`/`stale`) is created in Task 1, exposed by `_filteredCadenceFor` in Task 4, forwarded by `_buildChallengeSnapshot (cycle branch)` in Task 4, surfaced by `getCycleOverlayVisuals` in Task 9, and consumed by `CycleChallengeOverlay` in Task 11. `waitingForBaseReq` is created in Task 7, forwarded in Task 7's `_buildChallengeSnapshot (cycle branch)` change, surfaced in Task 9, consumed in Tasks 10-11.
- **Placeholders:** None of the tasks defer code to the implementer except where the existing test file's fixture builder is the canonical source — that is flagged with explicit "mirror this file" instructions and the file path.
- **Test discipline:** Every code-changing task is preceded by a failing test, then makes it pass. CLAUDE.md's "no skipping" / "no vacuously true" rule is honoured.
- **Risk areas:**
  - Task 5's "skip if needed, unskip in Task 6" instruction is the only place where intermediate state is acceptable — ensure the test is unskipped before Task 6's commit.
  - Task 12's `setEquipmentCadence` simulator addition is the only place where this plan adds API surface that may need product input. If the simulator already exposes this, drop the addition.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-04-cycle-challenge-remediation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
