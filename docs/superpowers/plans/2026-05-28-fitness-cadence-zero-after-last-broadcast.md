# Cadence Zeroes Shortly After Last Broadcast — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bike's reported RPM drops to zero shortly after the last cadence broadcast, instead of holding the last value for seconds.

**Architecture:** The persisted-vs-payload freeze bug is already fixed (`Device.update` keys significance on the incoming payload, and a `cadence:0` broadcast zeros `device.cadence` immediately). The residual is the **silence** case — when an ANT+ sensor stops broadcasting cadence pages entirely, the last value is held until `rpmZero` (currently 3000 ms) elapses, in both `pruneStaleDevices` (zeros `device.cadence`, which the display reads) and `getEquipmentCadence` (the staleness gate the governance engine reads). Tighten that single SSOT window so zeroing happens ~1.2 s after the last cadence-bearing broadcast, and tighten the `CadenceFilter` decay so the governance-facing smoothed value zeros in the same ballpark.

**Tech Stack:** Vitest. `FITNESS_TIMEOUTS.rpmZero` (FitnessSession.js:30) is the single source of truth, consumed by `pruneStaleDevices` (via `_getTimeouts()`) and `getEquipmentCadence`.

**Source audit:** `docs/_wip/audits/2026-05-28-fitness-session-multi-issue-postmortem-audit.md` (Issue 3); root-cause bug doc `docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md`.

**Run a single Vitest spec (repo root):** `frontend/node_modules/.bin/vitest run --config vitest.config.mjs <path-to-spec>`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/src/hooks/fitness/FitnessSession.js` | Timeout SSOT (`FITNESS_TIMEOUTS`) | Lower `rpmZero` 3000 → 1200 ms |
| `frontend/src/hooks/fitness/DeviceManager.js` | Device store + prune | Lower the fallback `rpmZero` default 3000 → 1200 ms (used only when prune is called without config) |
| `frontend/src/hooks/fitness/DeviceManager.rpmFreeze.test.js` | Existing freeze test | Tighten assertions to the new window + add a "doesn't zero too early" guard |
| `frontend/src/hooks/fitness/CadenceFilter.js` | Smoothed cadence + decay | Tighten `STALE_THRESHOLD_MS`/`LOST_SIGNAL_MS` so the governance value zeros ~2 s after the last sample |
| `frontend/src/hooks/fitness/CadenceFilter.zeroFast.test.js` | New focused test | Create |

---

## Task 1: Lower the `rpmZero` window (display + governance staleness gate)

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:30` and `DeviceManager.js:244,248`
- Test: `frontend/src/hooks/fitness/DeviceManager.rpmFreeze.test.js`

- [ ] **Step 1: Update the existing freeze test to the tighter window + add an early guard**

In `DeviceManager.rpmFreeze.test.js`, replace the single test body's prune call and add a second assertion test. Replace the existing test `it('resets cadence to 0 within rpmZero after pedaling stops, …')` with two tests:

```js
  it('resets cadence to 0 within the rpmZero window after pedaling stops', () => {
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    const mgr = new DeviceManager();
    mgr.registerDevice({ id: 'bike-1', type: 'cadence', cadence: 55, lastSeen: t0 });
    expect(mgr.getDevice('bike-1').cadence).toBe(55);

    // Battery-only page 1s later (no cadence in payload).
    vi.setSystemTime(t0 + 1_000);
    mgr.registerDevice({ id: 'bike-1', batteryLevel: 80, lastSeen: t0 + 1_000 });

    // 1.3s after last cadence: past the new 1200ms rpmZero window.
    vi.setSystemTime(t0 + 1_300);
    mgr.registerDevice({ id: 'bike-1', batteryLevel: 80, lastSeen: t0 + 1_300 });
    mgr.pruneStaleDevices({ inactive: 60_000, remove: 1_800_000, rpmZero: 1_200 });
    expect(mgr.getDevice('bike-1').cadence).toBe(0);
  });

  it('does NOT zero cadence before the rpmZero window (no false-zero during slow pedaling)', () => {
    const t0 = 2_000_000;
    vi.setSystemTime(t0);
    const mgr = new DeviceManager();
    mgr.registerDevice({ id: 'bike-2', type: 'cadence', cadence: 40, lastSeen: t0 });

    // 0.8s later, still within the 1200ms window.
    vi.setSystemTime(t0 + 800);
    mgr.pruneStaleDevices({ inactive: 60_000, remove: 1_800_000, rpmZero: 1_200 });
    expect(mgr.getDevice('bike-2').cadence).toBe(40);
  });
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/DeviceManager.rpmFreeze.test.js`
Expected: the first test still passes at the prune call (it passes explicit `rpmZero:1200`), but this task is really about the SSOT default — proceed to Step 3 to make the production default match. (Both tests should already pass since they pass `rpmZero:1200` explicitly; they lock the intended behavior.)

- [ ] **Step 3: Lower the SSOT and the fallback default**

In `FitnessSession.js`, in the `FITNESS_TIMEOUTS` object (line ~30), change:
```js
  rpmZero: 3000,
```
to:
```js
  rpmZero: 1200,  // zero RPM ~1.2s after the last cadence broadcast (silence case)
```

In `DeviceManager.js` `pruneStaleDevices`, change BOTH fallback defaults from 3000 to 1200:
- line ~244: `? { inactive: config, remove: config * 3, rpmZero: 1200 }`
- line ~248: `rpmZero: config.rpmZero || 1200`

- [ ] **Step 4: Run the full cadence/device suite**

Run:
```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/hooks/fitness/DeviceManager.rpmFreeze.test.js \
  frontend/src/hooks/fitness/FitnessSession.cadenceTs.test.js
```
Expected: PASS. If `FitnessSession.cadenceTs.test.js` hard-codes a 3000 ms expectation, update that specific numeric to 1200 (the test's intent — "disconnected after rpmZero" — is preserved).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/DeviceManager.js frontend/src/hooks/fitness/DeviceManager.rpmFreeze.test.js
git commit -m "fix(fitness): zero RPM ~1.2s after last cadence broadcast (tighten rpmZero)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Tighten CadenceFilter decay so the governance value zeros quickly too

The governance engine reads a *smoothed* cadence via `CadenceFilter`, which today decays from 1.5 s and zeros at 4 s. Tighten so it zeros ~2 s after the last sample, matching the "shortly" intent for the cycle challenge / zone logic.

**Files:**
- Modify: `frontend/src/hooks/fitness/CadenceFilter.js:5–6`
- Test: `frontend/src/hooks/fitness/CadenceFilter.zeroFast.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/CadenceFilter.zeroFast.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { CadenceFilter } from './CadenceFilter.js';

describe('CadenceFilter — fast zeroing contract', () => {
  it('holds the value before the stale threshold', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 90, ts: 0 });
    const r = f.tick(500); // well within stale window
    expect(r.rpm).toBeGreaterThan(80);
    expect(r.flags.lostSignal).toBe(false);
  });

  it('reaches zero within ~2s of the last sample', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 90, ts: 0 });
    const r = f.tick(2000); // at/after the tightened LOST_SIGNAL window
    expect(r.rpm).toBe(0);
    expect(r.flags.lostSignal).toBe(true);
  });

  it('is partially decayed midway through the decay window', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 100, ts: 0 });
    const r = f.tick(1400); // between stale (800) and lost (2000)
    expect(r.rpm).toBeGreaterThan(0);
    expect(r.rpm).toBeLessThan(100);
    expect(r.flags.stale).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/CadenceFilter.zeroFast.test.js`
Expected: FAIL — at `tick(2000)` the current filter (LOST=4000) returns a non-zero decayed value, not 0.

- [ ] **Step 3: Tighten the thresholds**

In `CadenceFilter.js`, change lines 5–6:
```js
const STALE_THRESHOLD_MS = 1500;
const LOST_SIGNAL_MS     = 4000;
```
to:
```js
// Zero within ~2 s of the last fresh sample. Decay starts at 0.8 s and reaches
// 0 by 2 s, so the governance-facing cadence drops shortly after the last broadcast.
const STALE_THRESHOLD_MS = 800;
const LOST_SIGNAL_MS     = 2000;
```
Update the comment block at the top of the file (lines 3–4) to match the new 2 s contract.

- [ ] **Step 4: Run to verify it passes; then run the existing CadenceFilter spec**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/CadenceFilter.zeroFast.test.js`
Expected: PASS.
Then run the existing CadenceFilter spec if present:
```bash
ls frontend/src/hooks/fitness/CadenceFilter*.test.js
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/
```
If an existing CadenceFilter test asserts the old 1.5 s/4 s timings, update those specific numeric expectations to 0.8 s/2 s (the behavioral intent — "decays then zeros" — is unchanged; only the window shrank). Also run `CycleStateMachine.test.js` — its `intoMaintain`/dip sequences advance the clock by 200 ms ticks and should be unaffected by the tighter filter, but confirm it still passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/CadenceFilter.js frontend/src/hooks/fitness/CadenceFilter.zeroFast.test.js
git commit -m "fix(fitness): CadenceFilter zeros within ~2s of last sample

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Manual verification (next real session)

- [ ] During a real cycling session, stop pedaling and confirm the displayed RPM drops to 0 within ~1–2 s (not held at the last value for many seconds). Spot-check the garage logs (`ssh root@10.0.0.101 'docker logs --tail 100 daylight-fitness'`) show `CAD:0` / cessation around the same time.

---

## Notes
- The `Device.update` path already sets `device.cadence = 0` immediately on a `cadence:0` payload, so when the sensor broadcasts zero on stop, the display zeros at once; Task 1 handles the harder **silence** case (sensor stops broadcasting), and Task 2 handles the smoothed governance value.
- `FITNESS_TIMEOUTS.rpmZero` is also overridable at runtime via `setFitnessTimeouts({ rpmZero })` if 1200 ms proves too tight at very low cadence — no further code change needed to tune it.
- This plan does NOT add the `useEquipmentCadence` display hook (a larger refactor); tightening `rpmZero` makes `pruneStaleDevices` zero `device.cadence` fast enough that the raw-read display widgets reflect zero shortly, which satisfies the stated requirement. The hook remains an optional future cleanup.
