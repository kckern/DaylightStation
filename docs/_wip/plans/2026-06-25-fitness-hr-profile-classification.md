# Fitness HR Device Profile-Classification Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guest ANT+ heart-rate strap that connects while reading 0 bpm (e.g. device `10266`) must appear in the fitness roster as a tappable anonymous `#<deviceId>` card so it can be assigned to a family member/friend — instead of degrading to an un-assignable "Unknown Device" in the equipment list.

**Architecture:** The garage ANT+ backend already identifies a strap's ANT+ **profile** (`HR`/`CAD`/`PWR`) authoritatively, and forwards it on every broadcast — even when it strips an out-of-range reading (0 bpm) to `null`. The frontend's `DeviceManager.updateDevice` currently derives device `type` **only** from data fields (`ComputedHeartRate`, etc.), ignoring the authoritative `profile`. So a HR strap with a momentarily-`null` reading falls through to `type: 'unknown'`. The fix makes `profile` the **primary** type signal, keeping data-field inference as a fallback. No backend change. No UI change — once `type === 'heart_rate'`, the device flows through the existing `heartRateDevices → ParticipantRoster` anonymous-card path and is tappable for guest assignment.

**Tech Stack:** Vanilla ES modules (frontend hooks), Vitest (jsdom-style env via `vitest.config.mjs`), colocated `*.test.js` files in `frontend/src/hooks/fitness/`.

---

## Root Cause (evidence)

- **Backend** `_extensions/fitness/src/ant.mjs:184-191` rejects HR outside 50–230 bpm and sets `data.ComputedHeartRate = null`, then **still broadcasts** the device with `profile: 'HR'` (line 249-255). Garage logs for `10266`: `DETECTED 10266 HR` then ~276× `10266 HR rejected: 0 bpm outside 50-230`.
- **Frontend** `frontend/src/hooks/fitness/DeviceManager.js:152-165` sets `normalized.type = 'heart_rate'` only when `Number.isFinite(rawData.ComputedHeartRate)`. With `null`, `type` is never set → `Device` constructor default `type = 'unknown'` (line 13). The `profile` arg is stored (line 14/147) but never consulted for classification.
- **Consequence:** `10266` only ever hit `fitness.auto_assign_skip` (the non-HR path) in session logs; never `heart_rate`. The guest-assignment tap gate `FitnessUsers.jsx:511` (`device.type !== 'heart_rate'` → return) made the avatar a no-op.

**The user's "did it think it was an RPM device?" theory is wrong** — it was `'unknown'`, not `'cadence'`. The strap was a correctly-profiled HR device with a transiently-invalid (null) reading.

## Why no roster/UI change is needed

- Once `type === 'heart_rate'`, `FitnessContext.heartRateDevices` (`FitnessContext.jsx:1460`) includes it → `ParticipantRoster.getRoster()` (`ParticipantRoster.js:128,196`) emits it as an anonymous `#<deviceId>` card.
- The §2B unregistered-HR-floor filter (`ParticipantRoster.js:500-513`) only drops devices whose `rawHeartRate != null && rawHeartRate < 60`. A backend-rejected reading arrives as `null`, so the guard is **false** → the device is **not** dropped. (Verified in Task 2.)

## File Structure

- **Modify:** `frontend/src/hooks/fitness/DeviceManager.js` — add `PROFILE_TYPE_MAP` + profile-primary classification in `updateDevice`. Single responsibility (device normalization) unchanged.
- **Create:** `frontend/src/hooks/fitness/DeviceManager.profileType.test.js` — unit tests for classification.
- **Create:** `frontend/src/hooks/fitness/ParticipantRoster.guestOnConnect.test.js` — end-to-end test proving the goal (profile `HR` + null reading → tappable `#10266` roster card).

---

### Task 1: Profile-authoritative device classification in `DeviceManager.updateDevice`

**Files:**
- Modify: `frontend/src/hooks/fitness/DeviceManager.js` (add map near top of file ~line 3; edit `updateDevice` lines 139-176)
- Test: `frontend/src/hooks/fitness/DeviceManager.profileType.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/DeviceManager.profileType.test.js`:

```javascript
/**
 * DeviceManager — ANT+ profile is the authoritative device-type signal.
 *
 * The garage backend forwards a strap's ANT+ profile ('HR'/'CAD'/'PWR') on
 * every broadcast, even when it strips an out-of-range reading (0 bpm) to null.
 * A HR strap reading 0 bpm must still classify as 'heart_rate' so it appears in
 * the roster and is guest-assignable — not degrade to 'unknown' equipment.
 */
import { describe, it, expect } from 'vitest';
import { DeviceManager } from './DeviceManager.js';

describe('DeviceManager — profile-authoritative classification', () => {
  it('classifies an HR strap as heart_rate even when the reading was stripped to null', () => {
    const dm = new DeviceManager();
    const device = dm.updateDevice('10266', 'HR', { ComputedHeartRate: null });
    expect(device.type).toBe('heart_rate');
    expect(device.heartRate).toBe(null);
  });

  it('classifies an HR strap as heart_rate and records a valid reading', () => {
    const dm = new DeviceManager();
    const device = dm.updateDevice('28688', 'HR', { ComputedHeartRate: 125 });
    expect(device.type).toBe('heart_rate');
    expect(device.heartRate).toBe(125);
  });

  it('classifies a CAD profile as cadence', () => {
    const dm = new DeviceManager();
    const device = dm.updateDevice('7138', 'CAD', { CalculatedCadence: 88 });
    expect(device.type).toBe('cadence');
    expect(device.cadence).toBe(88);
  });

  it('classifies a PWR profile as power', () => {
    const dm = new DeviceManager();
    const device = dm.updateDevice('49904', 'PWR', { InstantaneousPower: 210 });
    expect(device.type).toBe('power');
    expect(device.power).toBe(210);
  });

  it('falls back to data-field inference when the profile is unknown/absent', () => {
    const dm = new DeviceManager();
    const device = dm.updateDevice('555', null, { ComputedHeartRate: 99 });
    expect(device.type).toBe('heart_rate');
  });

  it('leaves a device with no profile and no usable data as unknown', () => {
    const dm = new DeviceManager();
    const device = dm.updateDevice('999', null, { ComputedHeartRate: null });
    expect(device.type).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/DeviceManager.profileType.test.js`

Expected: FAIL — the first test (`10266` / null reading) returns `type: 'unknown'` (`expected 'unknown' to be 'heart_rate'`). The CAD/PWR/valid-HR/fallback cases already pass; the null-HR case is the red.

- [ ] **Step 3: Write the minimal implementation**

In `frontend/src/hooks/fitness/DeviceManager.js`, add the profile map after the imports (after line 2):

```javascript
/**
 * Authoritative ANT+ profile → fitness device type. The strap's broadcast
 * profile is the source of truth for what kind of device it is, present even
 * when the current reading is missing (e.g. backend stripped an out-of-range
 * 0 bpm to null). Without this, a HR strap reading 0 bpm degrades to 'unknown'
 * equipment and becomes un-assignable. Profile strings observed in the garage
 * backend broadcasts: 'HR', 'CAD', 'PWR'.
 * See docs/_wip/plans/2026-06-25-fitness-hr-profile-classification.md
 */
const PROFILE_TYPE_MAP = {
  HR: 'heart_rate',
  CAD: 'cadence',
  PWR: 'power',
};
```

Then replace the type-assignment block in `updateDevice` (current lines 152-173). The data-field blocks keep populating the metric **values** but only set `type` as a fallback (`||`) so the authoritative profile wins:

```javascript
    // Authoritative ANT+ profile is the primary type signal (SSoT). A strap
    // broadcasting the HR profile is a heart-rate device even when the current
    // reading is null (backend stripped an out-of-range 0 bpm). Data-field
    // inference below only refines the type when the profile is unknown/absent.
    const profileType = PROFILE_TYPE_MAP[profile] || null;
    if (profileType) normalized.type = profileType;

    // Map ANT+ fields to normalized fields
    if (rawData) {
      if (Number.isFinite(rawData.ComputedHeartRate)) {
        normalized.heartRate = rawData.ComputedHeartRate;
        normalized.type = normalized.type || 'heart_rate';
      }
      if (Number.isFinite(rawData.CalculatedCadence)) {
        normalized.cadence = rawData.CalculatedCadence;
        normalized.type = normalized.type || 'cadence';
      }
      if (Number.isFinite(rawData.InstantaneousPower)) {
        normalized.power = rawData.InstantaneousPower;
        normalized.type = normalized.type || 'power';
      }
      if (Number.isFinite(rawData.CumulativeCadenceRevolutionCount)) {
        normalized.revolutionCount = rawData.CumulativeCadenceRevolutionCount;
      }
      if (Number.isFinite(rawData.BatteryLevel)) {
        normalized.batteryLevel = rawData.BatteryLevel;
      }
      // Add other mappings as needed
    }
```

> Note: the original code set `normalized.type = 'power'` *unconditionally* (overwriting an earlier HR/cadence). The `||` form is the intended behavior — a single device should not flip-flop type, and profile is now authoritative.

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/DeviceManager.profileType.test.js`

Expected: PASS (6 passed).

- [ ] **Step 5: Run the existing fitness hook tests to check for regressions**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/ --exclude '**/.claire/**'`

Expected: all PASS. Pay attention to `ParticipantRoster.*`, `DeviceManager*`, and any device-type assertions. (The `--exclude '**/.claire/**'` flag avoids a known broken copy in a nested worktree.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/DeviceManager.js frontend/src/hooks/fitness/DeviceManager.profileType.test.js
git commit -m "fix(fitness): classify ANT+ device type from profile, not just data fields

A HR strap reading 0 bpm has its reading stripped to null by the backend
but still broadcasts profile 'HR'. DeviceManager ignored the profile and
classified by data fields only, degrading the strap to 'unknown' equipment
so it could not be guest-assigned. Make the ANT+ profile the primary type
signal; keep data-field inference as a fallback.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: End-to-end test — guest HR strap appears as a tappable anonymous card on connection

**Files:**
- Test: `frontend/src/hooks/fitness/ParticipantRoster.guestOnConnect.test.js`

This locks the goal: a profile-`HR` device with a null reading, registered via the real `updateDevice` path, surfaces in `getRoster()` as `#<deviceId>` (the tappable anonymous card the guest-assignment UI keys on). It also guards the §2B floor interaction (null reading must not be dropped).

- [ ] **Step 1: Write the test**

Create `frontend/src/hooks/fitness/ParticipantRoster.guestOnConnect.test.js`:

```javascript
/**
 * Goal: a guest ANT+ HR strap that connects while reading 0 bpm (backend strips
 * it to null but forwards profile 'HR') must appear in the roster as a tappable
 * anonymous `#<deviceId>` card, so it can be assigned to a family member/friend.
 *
 * Exercises the real updateDevice → DeviceManager → ParticipantRoster path.
 */
import { describe, it, expect } from 'vitest';
import { ParticipantRoster } from './ParticipantRoster.js';
import { DeviceManager } from './DeviceManager.js';
import { UserManager } from './UserManager.js';

const buildRoster = (rosterConfig = {}) => {
  const deviceManager = new DeviceManager();
  const userManager = new UserManager();
  const roster = new ParticipantRoster();
  roster.configure({ deviceManager, userManager, ...rosterConfig });
  return { roster, deviceManager, userManager };
};

describe('ParticipantRoster — guest HR strap appears on connection', () => {
  it('surfaces a null-reading HR strap as a tappable anonymous card', () => {
    const { roster, deviceManager } = buildRoster();
    // Mirrors the live broadcast: profile 'HR', reading stripped to null.
    deviceManager.updateDevice('10266', 'HR', { ComputedHeartRate: null });

    const result = roster.getRoster();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('#10266');
  });

  it('still classifies it as heart_rate in the device manager (assignment gate)', () => {
    const { deviceManager } = buildRoster();
    const device = deviceManager.updateDevice('10266', 'HR', { ComputedHeartRate: null });
    // FitnessUsers.jsx:511 gates the guest-assignment tap on this exact value.
    expect(device.type).toBe('heart_rate');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/ParticipantRoster.guestOnConnect.test.js`

Expected: PASS (2 passed). (This relies on Task 1's fix — if run before Task 1, the first test fails with `expected length 1 to be 0` because the device is `'unknown'` and excluded from `heartRateDevices`.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/ParticipantRoster.guestOnConnect.test.js
git commit -m "test(fitness): guest HR strap surfaces as tappable anonymous card on connect

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Full fitness-hooks regression sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the whole fitness hooks suite**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/ --exclude '**/.claire/**'`

Expected: all green. If anything fails, STOP and report the failing test + assertion (do not paper over it).

- [ ] **Step 2: Confirm both new test files are included and pass**

Confirm the run output lists `DeviceManager.profileType.test.js` (6 passed) and `ParticipantRoster.guestOnConnect.test.js` (2 passed).

---

## Deployment note (out of plan scope, do NOT auto-run)

A live workout may be in progress (Felix + Milo were active during diagnosis). Per `CLAUDE.local.md`, **never redeploy while a fitness session is active**. After tests pass, confirm `sessionActive:false` / `rosterSize:0` via the documented gate before `sudo docker build` + `sudo deploy-daylight`, then hard-reload the garage Firefox kiosk (`frontend/src/modules/Fitness/` rule). The build/deploy is a separate, gated step — not part of this TDD plan.

---

## Self-Review

- **Spec coverage:** Goal = guest 0-bpm HR strap appears as a tappable guest card. Task 1 fixes classification (the root cause); Task 2 proves the end-to-end roster surfacing + the assignment-gate value; Task 3 guards regressions. Covered.
- **Placeholder scan:** No TBD/TODO; all test and impl code is concrete.
- **Type consistency:** `PROFILE_TYPE_MAP` keys (`HR`/`CAD`/`PWR`) match observed backend broadcast strings; values (`heart_rate`/`cadence`/`power`) match the types consumed by `FitnessContext` selectors and `FitnessUsers.jsx` gates. `updateDevice(deviceId, profile, rawData)` signature unchanged. `#<deviceId>` anonymous-name format matches `ParticipantRoster.js:493`.
