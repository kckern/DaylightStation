# Best-in-Class Guest UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a guest (e.g. a grandparent with a naturally low heart rate) always visible, always assignable, correctly zoned everywhere, and never silently dropped or de-anonymized by a session reset.

**Architecture:** Four independent phases. (1) Extract and fix the fullscreen overlay's zone resolver so any broadcasting device gets an HR-derived zone. (2) Change the participant roster from *delete-on-low-HR* to *demote-on-low-HR* with a configurable hard floor for true noise. (3) Make explicit guest assignments durable by snapshotting on assign and re-hydrating after any re-config. (4) Unify the overlay's noise floor with the roster's and stop the debug log storm.

**Tech Stack:** React 18 (JSX), Vitest 4 + `@testing-library/react` (jsdom env via `tests/_infrastructure/frontend-env.mjs`), the fitness session engine under `frontend/src/hooks/fitness/`.

**Source of truth:** `docs/_wip/audits/2026-06-25-fitness-guest-ux-session-20260625170246-audit.md`.

**Product decisions (locked):**
- Low-HR unregistered device → **demote, don't drop**, with a low configurable hard floor for genuine drawer-strap noise.
- Unmapped device zone → derive from **canonical household zones** (no per-guest profile needed).
- Assignment durability (survive cycle-game/session reset) → **in scope** (Phase 3).

**How to run a single test file (use everywhere below):**
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs <path-to-test-file>
```

---

## File Structure

**Created:**
- `frontend/src/modules/Fitness/player/overlays/resolveUserZone.js` — pure, exported zone resolver extracted from `FullscreenVitalsOverlay.jsx` (Phase 1). One responsibility: map `(userName, device, context)` → `{ id, color }` using committed zone → color match → HR-vs-thresholds, working with or without a resolved user.
- `frontend/src/modules/Fitness/player/overlays/resolveUserZone.test.js` — unit tests for the resolver (Phase 1).
- `frontend/src/hooks/fitness/ParticipantRoster.demote.test.js` — unit tests for demote-not-drop + hard floor + `weakSignal` flag (Phase 2).
- `frontend/src/hooks/fitness/FitnessSession.assignmentDurability.test.js` — unit tests for capture/restore of guest assignments (Phase 3).

**Modified:**
- `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx` — import the extracted resolver; add the shared hard-floor filter (Phases 1, 4).
- `frontend/src/hooks/fitness/ParticipantRoster.js` — add hard-floor constant; demote instead of drop; emit `weakSignal`; sample the drop log (Phases 2, 4).
- `frontend/src/hooks/fitness/FitnessSession.js` — `configureRosterFloors()`, `captureAssignmentSnapshot()`, `restoreAssignmentSnapshot()`; sample the `auto_assign_skip` log (Phases 2, 3, 4).
- `frontend/src/hooks/fitness/GuestAssignmentService.js` — capture snapshot on successful assign (Phase 3).
- `frontend/src/context/FitnessContext.jsx` — pass configured floors to the roster; restore assignment snapshot after re-config (Phases 2, 3).
- `frontend/src/modules/Fitness/components/CircularUserAvatar.jsx` — `weakSignal` prop → `.weak-signal` class (Phase 2).
- `frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx` — test for the new class (Phase 2).
- `frontend/src/Apps/FitnessApp.jsx` — revert forced app-wide `debug` log level to `info` (Phase 4).

---

# Phase 1 — Fullscreen overlay shows a real zone for any broadcasting device (Issue 4)

Ship first: isolated, low-risk, fixes the reported "no HR zones, not even default ones."

### Task 1.1: Extract `resolveUserZone` into a testable module

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/resolveUserZone.js`
- Create: `frontend/src/modules/Fitness/player/overlays/resolveUserZone.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/player/overlays/resolveUserZone.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { resolveUserZone, canonicalZones } from './resolveUserZone.js';

const ZONES = [
  { id: 'cool', min: 0, color: '#3b82f6' },
  { id: 'active', min: 100, color: '#22c55e' },
  { id: 'warm', min: 120, color: '#eab308' },
  { id: 'hot', min: 150, color: '#f97316' },
  { id: 'fire', min: 170, color: '#ef4444' }
];

describe('resolveUserZone', () => {
  it('exports the canonical zone list', () => {
    expect(canonicalZones).toEqual(['cool', 'active', 'warm', 'hot', 'fire']);
  });

  it('derives an HR-based zone for an UNMAPPED device (no userName) — the guest bug', () => {
    const zone = resolveUserZone(null, { heartRate: 130 }, {
      userCurrentZones: {}, zones: ZONES, usersConfigRaw: {}
    });
    expect(zone).toEqual({ id: 'warm', color: '#eab308' });
  });

  it('still resolves the committed zone for a mapped user', () => {
    const zone = resolveUserZone('User_2', { heartRate: 0 }, {
      userCurrentZones: { User_2: { id: 'fire', color: '#ff0000' } },
      zones: ZONES, usersConfigRaw: {}
    });
    expect(zone).toEqual({ id: 'fire', color: '#ff0000' });
  });

  it('applies per-user threshold overrides when a user is mapped', () => {
    const zone = resolveUserZone('User_3', { heartRate: 130 }, {
      userCurrentZones: {}, zones: ZONES,
      usersConfigRaw: { primary: [{ name: 'User_3', zones: { warm: 999 } }] }
    });
    // warm override is 999 → 130 falls back to the next-lower canonical zone (active@100)
    expect(zone.id).toBe('active');
  });

  it('returns null id / null color when there is no HR and no committed zone', () => {
    const zone = resolveUserZone(null, { heartRate: 0 }, {
      userCurrentZones: {}, zones: ZONES, usersConfigRaw: {}
    });
    expect(zone).toEqual({ id: null, color: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/resolveUserZone.test.js`
Expected: FAIL — `Failed to resolve import "./resolveUserZone.js"`.

- [ ] **Step 3: Create the module (early-return removed)**

Create `frontend/src/modules/Fitness/player/overlays/resolveUserZone.js`:

```js
// Pure zone resolver for the fullscreen vitals overlay. Extracted from
// FullscreenVitalsOverlay.jsx so it is unit-testable, and fixed so a device
// with a live heart rate resolves a zone even when it is NOT mapped to a
// configured user. A heart-rate zone is a function of BPM, not identity — an
// anonymous strap broadcasting 130 bpm is clearly "warm".
export const canonicalZones = ['cool', 'active', 'warm', 'hot', 'fire'];

export const resolveUserZone = (userName, device, context) => {
  const { userCurrentZones, zones = [], usersConfigRaw } = context || {};
  const entry = userName ? userCurrentZones?.[userName] : null;
  let zoneId = null;
  let color = null;

  if (entry) {
    if (typeof entry === 'object') {
      zoneId = entry.id || null;
      color = entry.color || null;
    } else if (typeof entry === 'string') {
      color = entry;
    }
  }

  if (color && !zoneId) {
    const normalizedColor = String(color).toLowerCase();
    zoneId = zones.find((z) => String(z.color).toLowerCase() === normalizedColor)?.id || normalizedColor;
  }

  // HR-based fallback — works with OR without a resolved user. When userName is
  // null, cfg is null → overrides is {} → canonical z.min thresholds apply.
  if ((!zoneId || !canonicalZones.includes(zoneId)) && device?.heartRate) {
    const cfg = userName
      ? (usersConfigRaw?.primary?.find((u) => u.name === userName)
        || usersConfigRaw?.secondary?.find((u) => u.name === userName))
      : null;
    const overrides = cfg?.zones || {};
    const sorted = [...zones].sort((a, b) => b.min - a.min);
    for (const z of sorted) {
      const min = typeof overrides[z.id] === 'number' ? overrides[z.id] : z.min;
      if (device.heartRate >= min) {
        zoneId = z.id;
        color = z.color;
        break;
      }
    }
  }

  return {
    id: zoneId && canonicalZones.includes(zoneId) ? zoneId : null,
    color: color || null
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/resolveUserZone.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/resolveUserZone.js frontend/src/modules/Fitness/player/overlays/resolveUserZone.test.js
git commit -m "feat(fitness): extract + fix resolveUserZone so unmapped devices get an HR-derived zone"
```

### Task 1.2: Wire the extracted resolver into the overlay

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx`

- [ ] **Step 1: Add the import**

After the existing import block (top of file, alongside the other `@/modules/Fitness` imports), add:

```jsx
import { resolveUserZone } from './resolveUserZone.js';
```

- [ ] **Step 2: Delete the inline `canonicalZones` const and the inline `resolveUserZone` function**

Remove the now-duplicated declarations currently at `FullscreenVitalsOverlay.jsx:37` (`const canonicalZones = [...]`) through the end of the `resolveUserZone` function (`:79`). The `getProfileSlug` helper below it stays. The call site at `:150` (`resolveUserZone(user?.name, device, { userCurrentZones, zones, usersConfigRaw })`) is unchanged — it now uses the imported function.

- [ ] **Step 3: Verify the overlay still compiles and the build is clean**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/resolveUserZone.test.js`
Expected: PASS (unchanged). Then sanity-check no other file imported the old inline symbol:

Run: `grep -rn "canonicalZones" frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx`
Expected: no matches (the const is gone; the import provides it implicitly to the resolver only).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx
git commit -m "refactor(fitness): use extracted resolveUserZone in FullscreenVitalsOverlay"
```

---

# Phase 2 — Demote-not-drop in the roster + configurable floors (Issues 1, 3)

### Task 2.1: Add a configurable hard floor and demote-not-drop in the roster

**Files:**
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js`
- Create: `frontend/src/hooks/fitness/ParticipantRoster.demote.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/ParticipantRoster.demote.test.js`:

```js
/**
 * ParticipantRoster — demote-not-drop for low-HR unregistered devices.
 *
 * A real guest (e.g. a grandparent) can broadcast a genuine 58-59 bpm that sits
 * just under the comfort floor. Such a device must NOT be deleted — it must
 * still render as a tappable card, flagged `weakSignal`. Only readings below a
 * low HARD floor (drawer-strap noise, e.g. 16 bpm) are dropped entirely.
 */
import { describe, it, expect } from 'vitest';
import { ParticipantRoster, DEFAULT_ANONYMOUS_HR_HARD_FLOOR_BPM } from './ParticipantRoster.js';
import { DeviceManager } from './DeviceManager.js';
import { UserManager } from './UserManager.js';

const buildRoster = (rosterConfig = {}) => {
  const deviceManager = new DeviceManager();
  const userManager = new UserManager();
  const roster = new ParticipantRoster();
  roster.configure({ deviceManager, userManager, ...rosterConfig });
  return { roster, deviceManager, userManager };
};

describe('ParticipantRoster — demote-not-drop', () => {
  it('exports a hard-floor default below the comfort floor', () => {
    expect(DEFAULT_ANONYMOUS_HR_HARD_FLOOR_BPM).toBeLessThan(60);
  });

  it('KEEPS a low-HR unregistered device (59 bpm) as a weakSignal card', () => {
    const { roster, deviceManager } = buildRoster();
    deviceManager.registerDevice({ id: '10266', type: 'heart_rate', heartRate: 59, lastSeen: Date.now() });
    const result = roster.getRoster();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('#10266');
    expect(result[0].weakSignal).toBe(true);
  });

  it('does NOT flag a healthy-HR unregistered device as weakSignal', () => {
    const { roster, deviceManager } = buildRoster();
    deviceManager.registerDevice({ id: '10266', type: 'heart_rate', heartRate: 120, lastSeen: Date.now() });
    const result = roster.getRoster();
    expect(result).toHaveLength(1);
    expect(result[0].weakSignal).toBe(false);
  });

  it('DROPS an unregistered device below the hard floor (drawer-strap noise)', () => {
    const { roster, deviceManager } = buildRoster();
    deviceManager.registerDevice({ id: '29425', type: 'heart_rate', heartRate: 16, lastSeen: Date.now() });
    expect(roster.getRoster()).toHaveLength(0);
  });

  it('honors a configurable hard floor', () => {
    const { roster, deviceManager } = buildRoster({ anonymousHrHardFloor: 50 });
    deviceManager.registerDevice({ id: '10266', type: 'heart_rate', heartRate: 45, lastSeen: Date.now() });
    expect(roster.getRoster()).toHaveLength(0);
  });

  it('never flags a registered user as weakSignal even at low HR', () => {
    const { roster, deviceManager, userManager } = buildRoster();
    userManager.assignGuest('10266', 'Grannie', { profileId: 'grannie', occupantType: 'guest' });
    deviceManager.registerDevice({ id: '10266', type: 'heart_rate', heartRate: 45, lastSeen: Date.now() });
    const result = roster.getRoster();
    expect(result).toHaveLength(1);
    expect(result[0].weakSignal).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/ParticipantRoster.demote.test.js`
Expected: FAIL — `DEFAULT_ANONYMOUS_HR_HARD_FLOOR_BPM` is undefined and `weakSignal` is undefined.

- [ ] **Step 3: Add the hard-floor constant**

In `frontend/src/hooks/fitness/ParticipantRoster.js`, immediately after the existing `export const DEFAULT_ANONYMOUS_HR_FLOOR_BPM = 60;` (line 26), add:

```js
/**
 * Hard floor (BPM) below which an UNREGISTERED device is dropped as pure noise
 * (e.g. a strap in a drawer broadcasting 16 BPM). Between this hard floor and
 * DEFAULT_ANONYMOUS_HR_FLOOR_BPM the device is KEPT but flagged `weakSignal`,
 * so a real low-HR guest still gets a tappable card. Overridable per-instance
 * via configure({ anonymousHrHardFloor }).
 */
export const DEFAULT_ANONYMOUS_HR_HARD_FLOOR_BPM = 40;
```

- [ ] **Step 4: Initialize the hard floor in the constructor**

In the constructor, immediately after `this._anonymousHrFloor = DEFAULT_ANONYMOUS_HR_FLOOR_BPM;` (line 67), add:

```js
    this._anonymousHrHardFloor = DEFAULT_ANONYMOUS_HR_HARD_FLOOR_BPM;
```

- [ ] **Step 5: Accept the hard floor in `configure()`**

In `configure()`, immediately after `if (Number.isFinite(config.anonymousHrFloor)) this._anonymousHrFloor = config.anonymousHrFloor;` (line 88), add:

```js
    if (Number.isFinite(config.anonymousHrHardFloor)) this._anonymousHrHardFloor = config.anonymousHrHardFloor;
```

- [ ] **Step 6: Replace the drop block with demote-not-drop in `_buildRosterEntry`**

Replace the existing block at `ParticipantRoster.js:506-514`:

```js
    const isUnregistered = !mappedUser && !guestEntry;
    if (isUnregistered && rawHeartRate != null && rawHeartRate < this._anonymousHrFloor) {
      getLogger().debug('participant.roster.dropped_unregistered_low_hr', {
        deviceId,
        heartRate: rawHeartRate,
        floor: this._anonymousHrFloor,
      });
      return null;
    }
```

with:

```js
    const isUnregistered = !mappedUser && !guestEntry;
    let weakSignal = false;
    if (isUnregistered && rawHeartRate != null) {
      if (rawHeartRate < this._anonymousHrHardFloor) {
        // Genuine noise (e.g. drawer strap at 16 BPM) — drop. Sampled so a
        // flapping ghost device cannot storm the session log (see audit Issue 7).
        getLogger().sampled('participant.roster.dropped_unregistered_low_hr', {
          deviceId,
          heartRate: rawHeartRate,
          hardFloor: this._anonymousHrHardFloor,
        }, { maxPerMinute: 6, aggregate: true });
        return null;
      }
      if (rawHeartRate < this._anonymousHrFloor) {
        // Real but low (e.g. an older guest at 58-59) — KEEP as a tappable
        // card, flagged so the UI can hint "weak signal / tap to add".
        weakSignal = true;
      }
    }
```

- [ ] **Step 7: Add `weakSignal` to the returned roster entry**

In the `rosterEntry` object literal, immediately after the `hrInactive: ...` line (line 629), add:

```js
      weakSignal,
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/ParticipantRoster.demote.test.js`
Expected: PASS (6 tests).

- [ ] **Step 9: Guard against regression in the existing floor test**

The old `ParticipantRoster.hrFloor.test.js` asserts a 72-bpm device with a configured floor of 100 is *dropped*. Under demote-not-drop it is now *kept* (72 ≥ hard floor 40). Update that one expectation.

Open `frontend/src/hooks/fitness/ParticipantRoster.hrFloor.test.js`, find the test `honors a configurable floor passed via configure()`, and replace its final assertion block:

```js
    // 72 is above the default 60 floor but below the configured 100 → dropped.
    const result = roster.getRoster();
    expect(result).toHaveLength(0);
```

with:

```js
    // 72 is above the hard floor (40) but below the configured comfort floor (100)
    // → KEPT as a weak-signal card (demote-not-drop), not dropped.
    const result = roster.getRoster();
    expect(result).toHaveLength(1);
    expect(result[0].weakSignal).toBe(true);
```

- [ ] **Step 10: Run the full roster test suite to confirm no other regressions**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/ParticipantRoster.hrFloor.test.js frontend/src/hooks/fitness/ParticipantRoster.anonymousDevice.test.js frontend/src/hooks/fitness/ParticipantRoster.demote.test.js`
Expected: PASS (all files green).

- [ ] **Step 11: Commit**

```bash
git add frontend/src/hooks/fitness/ParticipantRoster.js frontend/src/hooks/fitness/ParticipantRoster.demote.test.js frontend/src/hooks/fitness/ParticipantRoster.hrFloor.test.js
git commit -m "feat(fitness): demote low-HR unregistered devices to weakSignal cards instead of dropping them"
```

### Task 2.2: Surface `weakSignal` on the avatar

**Files:**
- Modify: `frontend/src/modules/Fitness/components/CircularUserAvatar.jsx`
- Test: `frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx`

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx`:

```js
describe('CircularUserAvatar weakSignal', () => {
  it('adds .weak-signal when weakSignal is true', () => {
    const { container } = render(<CircularUserAvatar name="#10266" weakSignal heartRate={59} />);
    expect(container.querySelector('.circular-user-avatar.weak-signal')).not.toBeNull();
  });

  it('omits .weak-signal by default', () => {
    const { container } = render(<CircularUserAvatar name="User_2" heartRate={120} />);
    expect(container.querySelector('.circular-user-avatar.weak-signal')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx`
Expected: FAIL — `.weak-signal` not found.

- [ ] **Step 3: Add the `weakSignal` prop and class**

In `CircularUserAvatar.jsx`, add `weakSignal = false` to the destructured props (after `boostBadge` on line 44):

```jsx
  boostBadge,
  weakSignal = false
```

Then in the `combinedClassName` array (lines 77-83), add the class after the `!hasActiveHr ? 'no-hr' : null,` line:

```jsx
    weakSignal ? 'weak-signal' : null,
```

Then add the prop type after `boostBadge: PropTypes.string` (line 199):

```jsx
  boostBadge: PropTypes.string,
  weakSignal: PropTypes.bool
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/components/CircularUserAvatar.jsx frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx
git commit -m "feat(fitness): CircularUserAvatar weakSignal prop adds .weak-signal class"
```

### Task 2.3: Wire configured floors from FitnessContext to the roster (Issue 3)

The `governance` config block already flows end-to-end (`FitnessConfigService` spreads `...governance`; `FitnessApp.jsx` unifies `governance`; `FitnessContext` reads `governanceConfig`). Piggyback on it — no new backend plumbing.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js`
- Modify: `frontend/src/context/FitnessContext.jsx`

- [ ] **Step 1: Add a public floor-config method on FitnessSession**

In `frontend/src/hooks/fitness/FitnessSession.js`, immediately before the `_collectTimelineTick(` method (line 2121), add:

```js
  /**
   * Configure the anonymous-device HR floors on the participant roster from
   * household config (fitness.yml governance.anonymous_hr_floor /
   * governance.anonymous_hr_hard_floor). No-ops for non-finite values, so the
   * roster keeps its built-in defaults when the keys are absent.
   */
  configureRosterFloors({ floor, hardFloor } = {}) {
    if (!this._participantRoster) return;
    const cfg = {};
    if (Number.isFinite(floor)) cfg.anonymousHrFloor = floor;
    if (Number.isFinite(hardFloor)) cfg.anonymousHrHardFloor = hardFloor;
    if (Object.keys(cfg).length > 0) this._participantRoster.configure(cfg);
  }
```

- [ ] **Step 2: Call it from the config-application effect**

In `frontend/src/context/FitnessContext.jsx`, in the config effect, immediately after `session.userManager.configure(usersConfig, zoneConfig);` (line 667), add:

```jsx
    session.configureRosterFloors?.({
      floor: Number(governanceConfig?.anonymous_hr_floor),
      hardFloor: Number(governanceConfig?.anonymous_hr_hard_floor)
    });
```

(`Number(undefined)` is `NaN`, which `configureRosterFloors` ignores via `Number.isFinite` — so absent keys safely keep the defaults.)

- [ ] **Step 3: Verify nothing regressed (roster tests still green)**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/ParticipantRoster.demote.test.js`
Expected: PASS (the configure path is exercised by the `anonymousHrHardFloor` test).

- [ ] **Step 4: Document the new config keys**

Append to `docs/reference/fitness/unknown-hr-monitors.md` (the doc the roster code already references) a short section:

```markdown
## Anonymous-device HR floors (config)

`data/household/apps/fitness/config.yml` → `governance:`
- `anonymous_hr_floor` (default 60): below this, an unregistered device is KEPT
  but flagged `weakSignal` (rendered as a tappable "tap to add" card).
- `anonymous_hr_hard_floor` (default 40): below this, an unregistered device is
  dropped as noise (e.g. a strap in a drawer).

Registered users and explicitly-assigned guests are never filtered, regardless
of heart rate.
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js frontend/src/context/FitnessContext.jsx docs/reference/fitness/unknown-hr-monitors.md
git commit -m "feat(fitness): wire configurable anonymous-HR floors from governance config to the roster"
```

---

# Phase 3 — Guest assignments survive a session/cycle-game reset (Issue 2)

A guest assignment lives only in the in-memory `DeviceAssignmentLedger`. The session-start high-water-mark snapshot (`_lastKnownGoodDeviceAssignments`) only updates on a tick with a non-empty roster — so an assignment made before the strap broadcasts is never captured, and any re-config that rebuilds the session loses it. Fix: snapshot immediately on assign, and re-hydrate after every re-config.

### Task 3.1: Capture/restore methods on FitnessSession

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js`
- Create: `frontend/src/hooks/fitness/FitnessSession.assignmentDurability.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/FitnessSession.assignmentDurability.test.js`:

```js
/**
 * Guest assignments must survive a session re-init. The ledger is in-memory;
 * a re-config that rebuilds users (the cycle-game lobby path) drops it. Capture
 * the ledger on assign; restore it after re-config.
 */
import { describe, it, expect } from 'vitest';
import { FitnessSession } from './FitnessSession.js';

describe('FitnessSession — guest assignment durability', () => {
  it('captures the ledger snapshot immediately on assign (no tick required)', () => {
    const session = new FitnessSession();
    session.userManager.assignGuest('10266', 'Grannie', { profileId: 'grannie', occupantType: 'guest' });

    session.captureAssignmentSnapshot();

    expect(session._lastKnownGoodDeviceAssignments).toHaveLength(1);
    expect(session._lastKnownGoodDeviceAssignments[0].deviceId).toBe('10266');
  });

  it('restores a lost assignment back into the ledger', () => {
    const session = new FitnessSession();
    session.userManager.assignGuest('10266', 'Grannie', { profileId: 'grannie', occupantType: 'guest' });
    session.captureAssignmentSnapshot();

    // Simulate the re-init wipe.
    session.userManager.assignmentLedger.remove('10266');
    expect(session.userManager.assignmentLedger.get('10266')).toBeNull();

    const restored = session.restoreAssignmentSnapshot();

    expect(restored).toBe(true);
    expect(session.userManager.assignmentLedger.get('10266')?.occupantName).toBe('Grannie');
  });

  it('does not clobber an assignment that is still present', () => {
    const session = new FitnessSession();
    session.userManager.assignGuest('10266', 'Grannie', { profileId: 'grannie', occupantType: 'guest' });
    session.captureAssignmentSnapshot();
    // Replace with a newer occupant; restore must not overwrite it.
    session.userManager.assignGuest('10266', 'User_3', { profileId: 'user_3', occupantType: 'guest' });

    session.restoreAssignmentSnapshot();

    expect(session.userManager.assignmentLedger.get('10266')?.occupantName).toBe('User_3');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/FitnessSession.assignmentDurability.test.js`
Expected: FAIL — `session.captureAssignmentSnapshot is not a function`.

- [ ] **Step 3: Implement the two methods**

In `frontend/src/hooks/fitness/FitnessSession.js`, immediately after the `configureRosterFloors(...)` method added in Task 2.3 Step 1 (before `_collectTimelineTick`), add:

```js
  /**
   * Snapshot the current guest-assignment ledger immediately. Unlike the
   * tick-driven high-water-mark (which only fires when the roster is non-empty),
   * this captures an assignment the instant it is made — even before the strap
   * broadcasts — so it can be restored after a re-init. See guest-UX audit #2.
   */
  captureAssignmentSnapshot() {
    const snap = this.userManager?.assignmentLedger?.snapshot?.() || [];
    if (snap.length > 0) this._lastKnownGoodDeviceAssignments = snap;
    return snap;
  }

  /**
   * Re-apply any captured assignments that are missing from the live ledger.
   * Idempotent and non-destructive: an assignment still present (or replaced by
   * a newer occupant) is left untouched. Called after a re-config rebuilds users.
   */
  restoreAssignmentSnapshot() {
    const snap = this._lastKnownGoodDeviceAssignments || [];
    const ledger = this.userManager?.assignmentLedger;
    if (!snap.length || !ledger) return false;
    let restoredAny = false;
    for (const entry of snap) {
      if (!entry?.deviceId) continue;
      if (ledger.get(entry.deviceId)) continue; // present or replaced — don't clobber
      this.userManager.assignGuest(entry.deviceId, entry.occupantName, entry.metadata || {});
      restoredAny = true;
    }
    return restoredAny;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/FitnessSession.assignmentDurability.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/FitnessSession.assignmentDurability.test.js
git commit -m "feat(fitness): capture/restore guest-assignment ledger to survive session re-init"
```

### Task 3.2: Capture on assign, restore after re-config

**Files:**
- Modify: `frontend/src/hooks/fitness/GuestAssignmentService.js`
- Modify: `frontend/src/context/FitnessContext.jsx`

- [ ] **Step 1: Capture on a successful assignment**

In `frontend/src/hooks/fitness/GuestAssignmentService.js`, in `assignGuest`, immediately before the final `return { ok: true, data: { entityId } };` (line 328), add:

```js
    // Durability: snapshot the ledger now so this assignment survives a
    // session/cycle-game re-init (see guest-UX audit #2).
    this.session?.captureAssignmentSnapshot?.();
```

- [ ] **Step 2: Restore after the re-config rebuilds users**

In `frontend/src/context/FitnessContext.jsx`, in the config effect, immediately after the `session.configureRosterFloors?.({ ... });` block added in Task 2.3 Step 2, add:

```jsx
    // The re-config above rebuilds users (and is where guest assignments were
    // being lost). Re-apply any captured assignments that went missing.
    session.restoreAssignmentSnapshot?.();
```

- [ ] **Step 3: Verify the durability suite is still green**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/FitnessSession.assignmentDurability.test.js`
Expected: PASS (unchanged — the wiring is exercised end-to-end at runtime; the unit contract is already covered).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/GuestAssignmentService.js frontend/src/context/FitnessContext.jsx
git commit -m "feat(fitness): persist guest assignments across re-config (capture on assign, restore after)"
```

---

# Phase 4 — Overlay/roster consistency + log hygiene (Issues 6, 7)

### Task 4.1: Apply the shared hard floor in the fullscreen overlay

The overlay reads raw `heartRateDevices` and bypassed the roster's noise filter, so a drawer strap could appear in fullscreen as a ghost. Apply the same hard floor (now that Phase 1 gives every shown device a real zone).

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx`

- [ ] **Step 1: Import the shared hard-floor constant**

Add to the imports in `FullscreenVitalsOverlay.jsx`:

```jsx
import { DEFAULT_ANONYMOUS_HR_HARD_FLOOR_BPM } from '@/hooks/fitness/ParticipantRoster.js';
```

- [ ] **Step 2: Drop sub-hard-floor unmapped devices from the overlay**

In the `hrItems` `useMemo`, the chain currently is `heartRateDevices.filter((device) => device && device.deviceId != null).map(...)` (lines 146-148). Replace the `.filter(...)` predicate with one that also drops genuine-noise unmapped devices:

```jsx
    return heartRateDevices
      .filter((device) => {
        if (!device || device.deviceId == null) return false;
        // Mirror the roster's hard floor: a sub-hard-floor reading on a device
        // with no resolved user is drawer-strap noise — hide it in fullscreen too.
        const mapped = getUserByDevice?.(device.deviceId) || null;
        const hr = Number.isFinite(device.heartRate) ? device.heartRate : null;
        if (!mapped && hr != null && hr < DEFAULT_ANONYMOUS_HR_HARD_FLOOR_BPM) return false;
        return true;
      })
      .map((device) => {
```

(The rest of the `.map(...)` body is unchanged.)

- [ ] **Step 3: Verify the resolver tests still pass (overlay imports are intact)**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/resolveUserZone.test.js`
Expected: PASS. Then confirm the constant resolves:

Run: `grep -n "DEFAULT_ANONYMOUS_HR_HARD_FLOOR_BPM" frontend/src/hooks/fitness/ParticipantRoster.js frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx`
Expected: the export in the roster and the import + usage in the overlay.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx
git commit -m "feat(fitness): apply shared anonymous HR hard floor in fullscreen overlay for roster consistency"
```

### Task 4.2: Stop the debug log storm

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`
- Modify: `frontend/src/hooks/fitness/FitnessSession.js`

(The roster drop log was already converted to `sampled` in Task 2.1 Step 6.)

- [ ] **Step 1: Revert the forced app-wide debug level to info**

In `frontend/src/Apps/FitnessApp.jsx`, in the logger-configuration effect, change line 99 from:

```jsx
    configureLogger({ level: 'debug', context: { app: 'fitness', sessionLog: true } });
```

to:

```jsx
    configureLogger({ level: 'info', context: { app: 'fitness', sessionLog: true } });
```

Update the comment immediately above it (lines 96-98) to drop the "while the cycle-game is under active tester debugging" note, replacing it with:

```jsx
    // Session logging runs at 'info'. Per-component debug can be enabled at
    // runtime via window.DAYLIGHT_LOG_LEVEL='debug' when investigating.
```

- [ ] **Step 2: Sample the `auto_assign_skip` log**

In `frontend/src/hooks/fitness/FitnessSession.js`, change the `auto_assign_skip` emit (line 643) from:

```js
          getLogger().debug('fitness.auto_assign_skip', { deviceId: device.id, hasUser: !!user, hasUserId: !!userId, hasLedgerEntry: !!ledgerEntry });
```

to:

```js
          getLogger().sampled('fitness.auto_assign_skip', { deviceId: device.id, hasUser: !!user, hasUserId: !!userId, hasLedgerEntry: !!ledgerEntry }, { maxPerMinute: 6, aggregate: true });
```

- [ ] **Step 3: Verify the fitness hooks suite is still green**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/ParticipantRoster.demote.test.js frontend/src/hooks/fitness/FitnessSession.assignmentDurability.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx frontend/src/hooks/fitness/FitnessSession.js
git commit -m "chore(fitness): revert forced debug log level to info; sample auto_assign_skip"
```

---

# Final verification

- [ ] **Run every test file this plan created or touched**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Fitness/player/overlays/resolveUserZone.test.js \
  frontend/src/hooks/fitness/ParticipantRoster.demote.test.js \
  frontend/src/hooks/fitness/ParticipantRoster.hrFloor.test.js \
  frontend/src/hooks/fitness/ParticipantRoster.anonymousDevice.test.js \
  frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx \
  frontend/src/hooks/fitness/FitnessSession.assignmentDurability.test.js
```
Expected: all files PASS.

- [ ] **Deploy + eyes-on (garage)** — this code renders on the garage fitness display. After build+deploy, hard-reload the kiosk (per `CLAUDE.local.md`) and confirm with a low-HR strap that: (a) the device shows as a tappable weak-signal card rather than vanishing; (b) the fullscreen vitals overlay shows a colored zone ring (not gray) for an unmapped device with HR; (c) a guest assignment made in the lobby survives entering the cycle game. Do NOT deploy while a session is active (`sessionActive:false`, `rosterSize:0`).

---

# Self-Review

**Spec coverage (against the audit's 7 issues + 3 locked decisions):**
- Issue 1 (demote-not-drop) → Task 2.1. ✔ Decision "demote + low hard floor" honored.
- Issue 2 (assignment durability) → Tasks 3.1, 3.2. ✔ Decision "include it" honored.
- Issue 3 (configurable floor) → Task 2.3. ✔ Decision "configurable via fitness.yml" honored (via `governance` block).
- Issue 4 (overlay abandons zone) → Tasks 1.1, 1.2. ✔ Decision "canonical household zones" honored (HR-based tier uses `z.min`).
- Issue 5 (default avatar) → addressed indirectly: fixing Issue 2 restores the real user→avatar; the audit notes the default avatar is "acceptable" for a truly anonymous device, so no separate task. ✔
- Issue 6 (overlay/roster disagree) → Task 4.1 (shared hard floor). ✔
- Issue 7 (log storm) → Task 2.1 Step 6 (roster drop → sampled) + Task 4.2 (app level + auto_assign_skip). ✔

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows the actual code; every run step shows the command and expected result.

**Type/name consistency:** `DEFAULT_ANONYMOUS_HR_HARD_FLOOR_BPM` (export name) used identically in ParticipantRoster, the demote test, and the overlay import. `anonymousHrHardFloor` (configure key) consistent between `configure()`, `configureRosterFloors()`, and tests. `weakSignal` consistent between roster entry, avatar prop/class, and tests. `captureAssignmentSnapshot` / `restoreAssignmentSnapshot` consistent across FitnessSession, GuestAssignmentService, FitnessContext, and the durability test.
