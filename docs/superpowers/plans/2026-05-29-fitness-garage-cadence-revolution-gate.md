# Garage Cadence Revolution-Gate (stuck non-zero RPM fix) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the garage ANT+ publisher from forwarding a *stuck non-zero* cadence (e.g. a held `CalculatedCadence` of 110) after the crank has actually stopped, by gating cadence on whether the sensor's cumulative revolution count is still advancing.

**Architecture:** `_extensions/fitness/src/ant.mjs` currently broadcasts the ANT+ library's `data.CalculatedCadence`, which the standard cadence profile *holds* at its last value when revolutions stop (the freeze observed 2026-05-29). The real ground truth is `data.CumulativeCadenceRevolutionCount`. Add a pure, unit-tested helper (`cadenceGate.mjs`) that tracks per-device revolution count: if revolutions keep advancing, pass the cadence through; if they have not advanced for longer than a staleness window, force cadence to 0. `ant.mjs` calls the gate and broadcasts the corrected value; it also logs the revolution count for future diagnosability.

**Tech Stack:** Node ESM (`.mjs`) on the garage machine (`kckern-garage`, `10.0.0.101`). No test framework exists in `_extensions/fitness`, so tests use Node's built-in runner (`node --test`) — no new dependency. The fix deploys via the garage build/load/compose cycle (separate from the main `daylight-station` container).

**Why this is needed (and why the main-app cadence work does NOT cover it):** The deployed `daylight-station` fix (`fbdbe74a9`) and the `fitness/session-audit-fixes` branch (`rpmZero`→1200ms, CadenceFilter→2s) only zero cadence when the sensor goes **silent** — they all key on "payload cadence > 0 = live rider." A stuck `CAD:110` is `cadence > 0`, so every freshness timer keeps getting reset and it is never zeroed. This is a distinct second freeze mechanism (stuck non-zero value) that must be fixed at the source, where the revolution count is available. See `docs/_wip/audits/2026-05-28-fitness-session-multi-issue-postmortem-audit.md` (Issue 3) and the 2026-05-29 morning session analysis (`fs_20260529060628`, sensor `7153`: flat jitter-free 110 for ~60 s while broadcasting `CAD:110` ~1/s, then `0↔110` flapping decay).

**Run the garage tests (from `_extensions/fitness/`):** `node --test test/cadenceGate.test.mjs`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `_extensions/fitness/src/cadenceGate.mjs` | Pure revolution-staleness gate (per-device state, no I/O) | Create |
| `_extensions/fitness/test/cadenceGate.test.mjs` | `node --test` unit tests for the gate | Create |
| `_extensions/fitness/package.json` | Scripts | Add `"test": "node --test test/*.test.mjs"` |
| `_extensions/fitness/src/ant.mjs` | ANT+ data handler / broadcaster | Call the gate; broadcast corrected cadence; log revolution count |

---

## Task 1: Pure cadence-revolution gate

**Files:**
- Create: `_extensions/fitness/src/cadenceGate.mjs`
- Test: `_extensions/fitness/test/cadenceGate.test.mjs`
- Modify: `_extensions/fitness/package.json`

**Contract:** `createCadenceGate({ revStaleMs })` returns `{ gate(deviceId, { calculatedCadence, revolutionCount, now }) }` → returns the cadence to actually use (a number, or `null` if there is no cadence at all). Rules:
- No `revolutionCount` available → cannot gate; pass `calculatedCadence` through unchanged (graceful fallback for sensors that don't report it).
- First time we see a device → record its revolution count + time; pass cadence through.
- Revolution count **changed** (advanced, or wrapped — any change) → real pedaling; record new count + time; pass cadence through.
- Revolution count **unchanged** and `now - lastChange <= revStaleMs` → still within a plausible inter-revolution gap; pass cadence through.
- Revolution count **unchanged** and `now - lastChange > revStaleMs` → crank has stopped; return `0`.

- [ ] **Step 1: Add the test script**

In `_extensions/fitness/package.json`, add to `"scripts"`:
```json
    "test": "node --test test/*.test.mjs",
```

- [ ] **Step 2: Write the failing tests**

Create `_extensions/fitness/test/cadenceGate.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCadenceGate } from '../src/cadenceGate.mjs';

test('passes cadence through while revolutions advance', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 10, now: 0 }), 110);
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 12, now: 1000 }), 110);
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 2000 }), 110);
});

test('holds cadence while revolutions are briefly unchanged (within window)', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 0 });
  // Same rev count 2s later — still within the 2500ms window → keep 110.
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 2000 }), 110);
});

test('zeros a stuck cadence once revolutions stall past the window', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 0 });
  // Sensor keeps sending CAD:110 but rev count never advances → after 2.5s → 0.
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 2600 }), 0);
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 5000 }), 0);
});

test('resumes real cadence when revolutions advance again after a stall', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 0 });
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 3000 }), 0); // stalled
  assert.equal(g.gate('7153', { calculatedCadence: 95, revolutionCount: 15, now: 3500 }), 95); // moving again
});

test('passes cadence through unchanged when no revolution count is available', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  assert.equal(g.gate('hr1', { calculatedCadence: 110, revolutionCount: null, now: 0 }), 110);
  assert.equal(g.gate('hr1', { calculatedCadence: 110, revolutionCount: undefined, now: 9000 }), 110);
});

test('returns null when there is no cadence', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  assert.equal(g.gate('7153', { calculatedCadence: null, revolutionCount: 14, now: 0 }), null);
});

test('handles the 16-bit revolution-count wrap as advancement (not a stall)', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  g.gate('7153', { calculatedCadence: 100, revolutionCount: 65535, now: 0 });
  // Wrap: 65535 -> 3 is a change → treated as advancing → cadence passes, timer resets.
  assert.equal(g.gate('7153', { calculatedCadence: 100, revolutionCount: 3, now: 3000 }), 100);
});

test('tracks devices independently', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  g.gate('a', { calculatedCadence: 110, revolutionCount: 14, now: 0 });
  g.gate('b', { calculatedCadence: 80, revolutionCount: 200, now: 0 });
  // a stalls, b advances.
  assert.equal(g.gate('a', { calculatedCadence: 110, revolutionCount: 14, now: 3000 }), 0);
  assert.equal(g.gate('b', { calculatedCadence: 80, revolutionCount: 205, now: 3000 }), 80);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `_extensions/fitness/`): `node --test test/cadenceGate.test.mjs`
Expected: FAIL — `Cannot find module '../src/cadenceGate.mjs'`.

- [ ] **Step 4: Implement the gate**

Create `_extensions/fitness/src/cadenceGate.mjs`:
```js
/**
 * Cadence revolution-gate.
 *
 * ANT+ cadence sensors broadcast a CalculatedCadence that the profile HOLDS at
 * its last value when the crank stops (the cumulative revolution count and event
 * time stop advancing, so the library keeps recomputing the same number until a
 * timeout). That produces a "stuck" non-zero cadence (e.g. a flat 110 RPM) long
 * after the rider stopped. Downstream freshness logic can't catch it because the
 * stuck value is still > 0.
 *
 * This gate uses the cumulative revolution count as ground truth: cadence is only
 * real while the revolution count keeps changing. If it has not changed for longer
 * than `revStaleMs`, the crank has stopped and we report 0.
 *
 * Pure and deterministic — `now` is injected so it is fully unit-testable.
 */
export function createCadenceGate({ revStaleMs = 2500 } = {}) {
  const state = new Map(); // deviceId -> { lastRevCount, lastRevChangeTs }

  return {
    /**
     * @param {string} deviceId
     * @param {{calculatedCadence: number|null, revolutionCount: number|null|undefined, now: number}} sample
     * @returns {number|null} the cadence to use (0 when the crank has stalled), or null if no cadence
     */
    gate(deviceId, { calculatedCadence, revolutionCount, now }) {
      const cadence = Number.isFinite(calculatedCadence) ? calculatedCadence : null;
      if (cadence === null) return null;

      // No revolution data → can't gate; trust the raw cadence.
      if (!Number.isFinite(revolutionCount)) return cadence;

      const prev = state.get(deviceId);
      if (!prev) {
        state.set(deviceId, { lastRevCount: revolutionCount, lastRevChangeTs: now });
        return cadence;
      }

      if (revolutionCount !== prev.lastRevCount) {
        // Any change (including a 16-bit wrap) means the crank turned.
        prev.lastRevCount = revolutionCount;
        prev.lastRevChangeTs = now;
        return cadence;
      }

      // Revolution count unchanged: real if still within a plausible inter-rev gap,
      // stopped (→ 0) once we exceed the staleness window.
      if (now - prev.lastRevChangeTs > revStaleMs) return 0;
      return cadence;
    }
  };
}

export default createCadenceGate;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/cadenceGate.test.mjs`
Expected: PASS (all 8 tests).

- [ ] **Step 6: Commit**

```bash
git add _extensions/fitness/src/cadenceGate.mjs _extensions/fitness/test/cadenceGate.test.mjs _extensions/fitness/package.json
git commit -m "feat(fitness-garage): pure cadence revolution-gate (zeros stuck cadence)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire the gate into the ANT+ data handler + log revolution count

**Files:**
- Modify: `_extensions/fitness/src/ant.mjs`

No unit test (the data handler depends on ANT+ hardware/library callbacks); the gate logic is fully covered by Task 1, and the integration is verified by the manual garage check in Task 3.

- [ ] **Step 1: Import and construct the gate**

At the top of `ant.mjs`, add the import alongside the other imports:
```js
import { createCadenceGate } from './cadenceGate.mjs';
```
In the class constructor, near `this._lastBroadcast = new Map();`, add:
```js
    // Gate cadence on revolution-count advancement so a sensor that holds its
    // last CalculatedCadence after the crank stops reports 0 instead of a stuck value.
    this._cadenceGate = createCadenceGate({ revStaleMs: 2500 });
```

- [ ] **Step 2: Gate the cadence in the data handler**

In the `channel.on('data', (profile, deviceId, data) => { … })` handler, the current lines are:
```js
        const hr = data.ComputedHeartRate ?? data.heartRate ?? null;
        const cadence = data.CalculatedCadence ?? data.cadence ?? null;
        const power = data.InstantaneousPower ?? data.power ?? null;
```
and later `const now = Date.now();` is computed (for the dedup window). Replace the `cadence` line and apply the gate. Change the three-line block to:
```js
        const hr = data.ComputedHeartRate ?? data.heartRate ?? null;
        const rawCadence = data.CalculatedCadence ?? data.cadence ?? null;
        const revolutionCount = Number.isFinite(data.CumulativeCadenceRevolutionCount)
          ? data.CumulativeCadenceRevolutionCount
          : null;
        const power = data.InstantaneousPower ?? data.power ?? null;
```
Then, immediately after the existing `const now = Date.now();` line (the one used for dedup), insert:
```js
        // Revolution-gate the cadence: zero it if the crank has stalled even though
        // the sensor keeps broadcasting a non-zero held CalculatedCadence.
        const cadence = this._cadenceGate.gate(deviceId, {
          calculatedCadence: rawCadence,
          revolutionCount,
          now
        });
        // Make downstream consumers (the app's DeviceManager) see the gated value.
        if (cadence !== null) data.CalculatedCadence = cadence;
        if (rawCadence !== null && rawCadence > 0 && cadence === 0) {
          console.log(`[${timestamp}] ${deviceId} cadence revolution-stall → 0 (was ${Math.round(rawCadence)}, revs=${revolutionCount})`);
        }
```
**Important:** the dedup check below uses `cadence` — that now refers to the gated value, which is correct (we want to dedup/broadcast the gated value). If the existing code referenced `cadence` *before* the `const now` line, move the gate computation up so `cadence` is defined before its first use; the dedup block (`lastBroadcast.cadence === cadence`) must compare the **gated** cadence. Verify ordering after editing.

- [ ] **Step 3: Log the revolution count for diagnosability**

In the throttled log block, the current metrics push is:
```js
          if (cadence !== null) metrics.push(`CAD:${Math.round(cadence)}`);
```
Change it to also surface the revolution count, so a future stall is self-evident from the logs:
```js
          if (cadence !== null) metrics.push(`CAD:${Math.round(cadence)}`);
          if (revolutionCount !== null) metrics.push(`REV:${revolutionCount}`);
```

- [ ] **Step 4: Verify the broadcast carries the gated value**

The handler ends with `this.broadcastFitnessData({ type:'ant', profile, deviceId, dongleIndex: deviceIndex, data });`. Because we overwrote `data.CalculatedCadence` in Step 2, the broadcast (and thus the app's `DeviceManager` normalization of `rawData.CalculatedCadence`) receives the gated cadence. Confirm no other line recomputes cadence from `data.CalculatedCadence` after the gate.

- [ ] **Step 5: Syntax check**

Run (from `_extensions/fitness/`): `node --check src/ant.mjs`
Expected: no output (valid syntax). Then re-run `node --test test/cadenceGate.test.mjs` (still PASS).

- [ ] **Step 6: Commit**

```bash
git add _extensions/fitness/src/ant.mjs
git commit -m "fix(fitness-garage): revolution-gate ANT+ cadence; log REV count

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Build, deploy to garage, and verify on real hardware

**Files:** none (deploy + manual verification). Per `CLAUDE.local.md`, the garage runs `_extensions/fitness/` as the `daylight-fitness` container on `kckern-garage` (`10.0.0.101`), built on kckern-server and transferred.

- [ ] **Step 1: Build the fitness image on kckern-server**

```bash
cd /opt/Code/DaylightStation
sudo docker build -f _extensions/fitness/Dockerfile -t kckern/daylight-station-fitness:latest _extensions/fitness/
```
Expected: build succeeds.

- [ ] **Step 2: Transfer + load + restart on the garage**

```bash
sudo docker save kckern/daylight-station-fitness:latest | ssh root@10.0.0.101 'docker load'
ssh root@10.0.0.101 'cd /path/to/fitness && docker compose up -d'
```
(Confirm the compose directory path on the garage first: `ssh root@10.0.0.101 'docker inspect daylight-fitness --format "{{ index .Config.Labels \"com.docker.compose.project.working_dir\" }}"'`.)

- [ ] **Step 3: Verify on real hardware**

Pedal a cadence bike (e.g. sensor `7153`) up to a steady RPM, then **stop**. Watch the garage logs:
```bash
ssh root@10.0.0.101 'docker logs -f daylight-fitness 2>&1 | grep 7153'
```
Expected:
- While pedalling: `CAD:<n>` with `REV:<count>` where the REV count **increases** each second.
- On stopping: the REV count stops increasing and `CAD` drops to **0 within ~2.5 s** (and a `cadence revolution-stall → 0` line appears) — instead of holding the last value.
- Confirm in the app UI that the rider's RPM falls to 0 shortly after they stop.

- [ ] **Step 4: Record the deploy**

Note the deploy in the session/PR description (garage image rebuilt + loaded). No code commit for this task.

---

## Self-review notes
- The staleness window `revStaleMs = 2500` is the one tunable: it must exceed the slowest *real* inter-revolution gap we care about (≈2.4 s at 25 RPM) so a slowly-pedalling rider isn't false-zeroed, while still zeroing a true stop quickly. Cadence thresholds for the cycle challenge sit well above 25 RPM, so 2500 ms is safe; adjust if very-low-cadence equipment is added.
- Using `!==` (not `>`) for the revolution-count comparison correctly treats the ANT+ 16-bit wrap as advancement.
- This is the **source** fix. An optional belt-and-suspenders app-side guard (zero cadence in `DeviceManager` when `revolutionCount` stalls) is **out of scope** here to avoid double-handling; the app already receives `revolutionCount` if it's ever wanted.
- This plan is independent of the `fitness/session-audit-fixes` branch; it can land before or after that branch merges (different files, different deploy target).
