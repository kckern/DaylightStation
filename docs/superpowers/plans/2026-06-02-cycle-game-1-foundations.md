# Cycle Game — Plan 1: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, unit-testable foundations the cycle game rides on — the distance-display helper, the distance-scoring math, the per-user cadence-zone config (system default + user-file override + backend hydration), and the equipment/zone config-schema additions.

**Architecture:** Small focused modules with no UI and no live-session coupling. Frontend helpers are pure functions (vitest, colocated `*.test.js`); the backend change is a one-line hydration mirror of the existing `heart_rate_zones` path (jest, `tests/unit`). Config-schema additions are data-file changes verified via the live API. Everything here is consumed by later plans (speedometer, race engine, screen, lobby).

**Tech Stack:** Plain ES modules. Frontend tests: `vitest` (colocated `*.test.js`). Backend tests: `jest` (`tests/unit/**/*.test.mjs`, `#system/` path alias).

**Plan 1 of 5** (Foundations → Speedometer → Race engine+persistence → Race screen → Lobby). This plan is independent of the per-user-rotations branch; `computeDistanceDelta` takes `rotationsDelta` as an input that the race engine (Plan 3) will supply.

**Spec:** `docs/superpowers/specs/2026-06-02-cycle-game-design.md` (§2 scoring, §7 config).

---

## Worktree test-command note

If executing in a git worktree (no local `node_modules`), invoke the **main repo's** test binaries against the worktree:

- **vitest:** `/opt/Code/DaylightStation/node_modules/.bin/vitest run --config /opt/Code/DaylightStation/vitest.config.mjs <relative-path> --root <worktree-abs-path>`
- **jest:** run from the main repo: `cd /opt/Code/DaylightStation && npx jest <relative-path>` (jest resolves `<rootDir>` + `#system/` from there; the worktree shares the same files once committed, so prefer running jest from the worktree if it has node_modules, else main repo).

The step commands below show the canonical short form (`./node_modules/.bin/vitest …`, `npx jest …`); substitute the worktree form when needed.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/modules/Fitness/lib/cycleGame/formatDistance.js` (+ test) | `formatDistance(meters)` — meters→km display helper |
| `frontend/src/modules/Fitness/lib/cycleGame/distanceModel.js` (+ test) | `zoneMultiplierFor` + `computeDistanceDelta` — pure scoring math |
| `frontend/src/hooks/fitness/cadenceZones.js` (+ test) | `buildCadenceConfig` + `DEFAULT_CADENCE_CONFIG` (mirrors `buildZoneConfig`) |
| `backend/src/0_system/config/UserService.mjs` (modify) | attach per-user `apps.fitness.cadence_zones` to the hydrated user |
| `tests/unit/config/UserService.cadenceZones.test.mjs` (create) | hydration test |
| Household fitness config + `data/users/*/profile.yml` (data volume) | `cycle_game` section, `equipment[].wheel_circumference_m`, `zones[].distance_multiplier`, per-user `cadence_zones` |

---

## Task 1: `formatDistance` display helper

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/formatDistance.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/formatDistance.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/lib/cycleGame/formatDistance.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { formatDistance } from './formatDistance.js';

describe('formatDistance', () => {
  it('shows whole meters below 1 km', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(250)).toBe('250 m');
    expect(formatDistance(999)).toBe('999 m');
  });
  it('rolls over to km with 2 decimals at/above 1 km', () => {
    expect(formatDistance(1000)).toBe('1.00 km');
    expect(formatDistance(4070)).toBe('4.07 km');
  });
  it('uses 1 decimal at/above 10 km', () => {
    expect(formatDistance(10000)).toBe('10.0 km');
    expect(formatDistance(12400)).toBe('12.4 km');
  });
  it('treats invalid / negative input as 0 m', () => {
    expect(formatDistance(-5)).toBe('0 m');
    expect(formatDistance(NaN)).toBe('0 m');
    expect(formatDistance(undefined)).toBe('0 m');
  });
  it('rounds meters before choosing the unit', () => {
    expect(formatDistance(999.6)).toBe('1.00 km'); // rounds to 1000 → km branch
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/formatDistance.test.js`
Expected: FAIL — `Cannot find module './formatDistance.js'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/modules/Fitness/lib/cycleGame/formatDistance.js`:

```js
/**
 * Format a distance in meters for display. Starts in whole meters and rolls
 * over to kilometers so a race doesn't begin as "0.00 km".
 *   < 1 km   → whole meters ("850 m")
 *   < 10 km  → 2 decimals   ("1.23 km")
 *   >= 10 km → 1 decimal    ("12.4 km")
 * @param {number} meters
 * @returns {string}
 */
export function formatDistance(meters) {
  const m = Number.isFinite(meters) && meters > 0 ? Math.round(meters) : 0;
  if (m < 1000) return `${m} m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(2)} km` : `${km.toFixed(1)} km`;
}

export default formatDistance;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/formatDistance.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/formatDistance.js frontend/src/modules/Fitness/lib/cycleGame/formatDistance.test.js
git commit -m "feat(cycle-game): formatDistance meters→km display helper"
```

---

## Task 2: Distance scoring math (`distanceModel`)

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/distanceModel.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/distanceModel.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/lib/cycleGame/distanceModel.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { zoneMultiplierFor, computeDistanceDelta } from './distanceModel.js';

const ZONES = [
  { id: 'cool',   distance_multiplier: 0.5 },
  { id: 'active', distance_multiplier: 1.0 },
  { id: 'warm',   distance_multiplier: 1.5 },
  { id: 'hot',    distance_multiplier: 2.0 },
  { id: 'fire',   distance_multiplier: 3.0 }
];

describe('zoneMultiplierFor', () => {
  it('returns the zone multiplier, case-insensitive', () => {
    expect(zoneMultiplierFor('hot', ZONES)).toBe(2);
    expect(zoneMultiplierFor('HOT', ZONES)).toBe(2);
    expect(zoneMultiplierFor('cool', ZONES)).toBe(0.5);
  });
  it('uses the HR-less multiplier when there is no zone', () => {
    expect(zoneMultiplierFor(null, ZONES, 1)).toBe(1);
    expect(zoneMultiplierFor(undefined, ZONES, 1)).toBe(1);
  });
  it('falls back to the HR-less multiplier for an unknown zone', () => {
    expect(zoneMultiplierFor('bogus', ZONES, 1)).toBe(1);
  });
  it('defaults the HR-less multiplier to 1', () => {
    expect(zoneMultiplierFor(null, ZONES)).toBe(1);
  });
});

describe('computeDistanceDelta', () => {
  it('multiplies rotations × circumference × multiplier', () => {
    expect(computeDistanceDelta(10, 2.1, 2)).toBeCloseTo(42, 5);
    expect(computeDistanceDelta(10, 1.2, 1)).toBeCloseTo(12, 5);
  });
  it('returns 0 for non-positive or invalid inputs', () => {
    expect(computeDistanceDelta(0, 2.1, 2)).toBe(0);
    expect(computeDistanceDelta(10, undefined, 2)).toBe(0);
    expect(computeDistanceDelta(10, 2.1, undefined)).toBe(0);
    expect(computeDistanceDelta(-5, 2.1, 2)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/distanceModel.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/modules/Fitness/lib/cycleGame/distanceModel.js`:

```js
/**
 * Distance scoring for the cycle game. Distance is the rider's own work:
 *   distanceDelta = rotationsDelta × wheelCircumference(m) × zoneMultiplier
 * Zone multiplier comes from the rider's current HR zone; a rider with no HR
 * (no strap → no zone) uses hrlessMultiplier.
 */

/**
 * @param {string|null} zoneId - current HR zone id, or null/undefined if no HR
 * @param {Array<{id:string, distance_multiplier:number}>} zones
 * @param {number} [hrlessMultiplier=1]
 * @returns {number}
 */
export function zoneMultiplierFor(zoneId, zones, hrlessMultiplier = 1) {
  if (!zoneId) return hrlessMultiplier;
  const list = Array.isArray(zones) ? zones : [];
  const target = String(zoneId).toLowerCase();
  const match = list.find((z) => z && String(z.id).toLowerCase() === target);
  const mult = match && Number.isFinite(match.distance_multiplier)
    ? match.distance_multiplier
    : null;
  return mult != null ? mult : hrlessMultiplier;
}

/**
 * @param {number} rotationsDelta - rotations this tick (> 0)
 * @param {number} wheelCircumferenceM - meters per rotation
 * @param {number} zoneMultiplier
 * @returns {number} meters covered this tick
 */
export function computeDistanceDelta(rotationsDelta, wheelCircumferenceM, zoneMultiplier) {
  const r = Number.isFinite(rotationsDelta) && rotationsDelta > 0 ? rotationsDelta : 0;
  const c = Number.isFinite(wheelCircumferenceM) && wheelCircumferenceM > 0 ? wheelCircumferenceM : 0;
  const m = Number.isFinite(zoneMultiplier) && zoneMultiplier > 0 ? zoneMultiplier : 0;
  return r * c * m;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/distanceModel.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/distanceModel.js frontend/src/modules/Fitness/lib/cycleGame/distanceModel.test.js
git commit -m "feat(cycle-game): distance scoring math (zone multiplier + delta)"
```

---

## Task 3: `buildCadenceConfig` (system default + per-user override)

Mirrors `frontend/src/hooks/fitness/types.js:208` `buildZoneConfig(globalZones, overrides)` — system default is a list of `{id,name,min,color}`, the per-user override is a `{id→min}` dict, colors/names always come from the system default. No HR-specific cool-baseline inference (a cadence floor is just 0).

**Files:**
- Create: `frontend/src/hooks/fitness/cadenceZones.js`
- Test: `frontend/src/hooks/fitness/cadenceZones.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/cadenceZones.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildCadenceConfig, DEFAULT_CADENCE_CONFIG } from './cadenceZones.js';

const SYSTEM = [
  { id: 'warmup',   name: 'Warm-up',  min: 0,  color: '#5b6470' },
  { id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' },
  { id: 'pushing',  name: 'Pushing',  min: 70, color: '#f1c40f' },
  { id: 'sprint',   name: 'Sprint',   min: 90, color: '#e74c3c' }
];

describe('buildCadenceConfig', () => {
  it('falls back to DEFAULT when no system zones given', () => {
    const out = buildCadenceConfig(undefined, undefined);
    expect(out).toHaveLength(DEFAULT_CADENCE_CONFIG.length);
    expect(out[0].id).toBe('warmup');
    expect(out.map(b => b.id)).toEqual(['warmup', 'cruising', 'pushing', 'sprint']);
  });

  it('uses the system bands unchanged when no override', () => {
    const out = buildCadenceConfig(SYSTEM, undefined);
    expect(out.find(b => b.id === 'cruising')).toEqual({ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' });
  });

  it('applies a per-user {id→min} override, keeping name/color from system', () => {
    const out = buildCadenceConfig(SYSTEM, { cruising: 50, pushing: 80, sprint: 105 });
    const cruising = out.find(b => b.id === 'cruising');
    expect(cruising.min).toBe(50);
    expect(cruising.color).toBe('#2ecc71');
    expect(out.find(b => b.id === 'pushing').min).toBe(80);
    expect(out.find(b => b.id === 'sprint').min).toBe(105);
    expect(out.find(b => b.id === 'warmup').min).toBe(0); // untouched
  });

  it('matches override keys case-insensitively and ignores non-numeric', () => {
    const out = buildCadenceConfig(SYSTEM, { CRUISING: 55, sprint: 'fast' });
    expect(out.find(b => b.id === 'cruising').min).toBe(55);
    expect(out.find(b => b.id === 'sprint').min).toBe(90); // unchanged (non-numeric ignored)
  });

  it('returns bands sorted by min ascending', () => {
    const out = buildCadenceConfig(SYSTEM, { warmup: 200 });
    expect(out[out.length - 1].id).toBe('warmup'); // pushed to the end by its new min
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/cadenceZones.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/hooks/fitness/cadenceZones.js`:

```js
/**
 * Cosmetic cadence (RPM) zones for the cycle game. Same contract as
 * buildZoneConfig (types.js): system default is a list of {id,name,min,color};
 * the per-user override is a {id→min} dict; names/colors come from the system
 * default. Purely visual — no scoring effect.
 */

export const DEFAULT_CADENCE_CONFIG = [
  { id: 'warmup',   name: 'Warm-up',  min: 0,  color: '#5b6470' },
  { id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' },
  { id: 'pushing',  name: 'Pushing',  min: 70, color: '#f1c40f' },
  { id: 'sprint',   name: 'Sprint',   min: 90, color: '#e74c3c' }
];

const normalizeOverrides = (overrides) => {
  if (!overrides || typeof overrides !== 'object') return {};
  return Object.entries(overrides).reduce((acc, [k, v]) => {
    const key = String(k).trim().toLowerCase();
    const num = Number(v);
    if (key && Number.isFinite(num)) acc[key] = num;
    return acc;
  }, {});
};

/**
 * @param {Array<{id:string,name?:string,min?:number,color?:string}>} systemCadenceZones
 * @param {Object<string,number>} overrides - per-user {bandId → min}
 * @returns {Array<{id:string,name:string,color:string|null,min:number}>}
 */
export const buildCadenceConfig = (systemCadenceZones, overrides) => {
  const source = Array.isArray(systemCadenceZones) && systemCadenceZones.length > 0
    ? systemCadenceZones
    : DEFAULT_CADENCE_CONFIG;
  const ov = normalizeOverrides(overrides);
  const out = source.map((band, i) => {
    const rawId = band?.id || band?.name || `band-${i}`;
    const id = String(rawId).trim() || `band-${i}`;
    const overrideMin = ov[id.toLowerCase()];
    return {
      id,
      name: band?.name || id,
      color: band?.color || null,
      min: Number.isFinite(overrideMin)
        ? overrideMin
        : (Number.isFinite(band?.min) ? band.min : 0)
    };
  }).sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
  return out.length ? out : DEFAULT_CADENCE_CONFIG.map((b) => ({ ...b }));
};

export default buildCadenceConfig;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/cadenceZones.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/cadenceZones.js frontend/src/hooks/fitness/cadenceZones.test.js
git commit -m "feat(cycle-game): buildCadenceConfig (system default + per-user override)"
```

---

## Task 4: Hydrate per-user `cadence_zones` (backend)

Mirror the existing `heart_rate_zones` hydration in `UserService.hydrateUsers` so a user's `apps.fitness.cadence_zones` (from `data/users/{id}/profile.yml`) flows through `/api/v1/fitness` onto the hydrated user object.

**Files:**
- Modify: `backend/src/0_system/config/UserService.mjs` (the `fitnessConfig` block, ~lines 80–91)
- Test: `tests/unit/config/UserService.cadenceZones.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/config/UserService.cadenceZones.test.mjs`:

```js
import { UserService } from '#system/config/UserService.mjs';

const makeCfg = (profile) => ({
  getUserProfile: (u) => (u === 'felix' ? profile : null),
  getAllUserProfiles: () => new Map()
});

describe('UserService — per-user cadence_zones hydration', () => {
  it('attaches cadence_zones from the profile to the hydrated user', () => {
    const svc = new UserService(makeCfg({
      username: 'felix',
      display_name: 'Felix',
      apps: { fitness: {
        heart_rate_zones: { active: 120 },
        cadence_zones: { cruising: 50, pushing: 80, sprint: 105 }
      } }
    }));
    const [user] = svc.hydrateUsers(['felix']);
    expect(user.cadence_zones).toEqual({ cruising: 50, pushing: 80, sprint: 105 });
    expect(user.zones).toEqual({ active: 120 }); // existing HR-zone hydration intact
  });

  it('omits cadence_zones when the profile has none', () => {
    const svc = new UserService(makeCfg({
      username: 'felix',
      apps: { fitness: { heart_rate_zones: { active: 100 } } }
    }));
    const [user] = svc.hydrateUsers(['felix']);
    expect(user.cadence_zones).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/config/UserService.cadenceZones.test.mjs`
Expected: FAIL — `user.cadence_zones` is `undefined` in the first test.

- [ ] **Step 3: Add the hydration line**

In `backend/src/0_system/config/UserService.mjs`, inside the `if (fitnessConfig) { … }` block, immediately after the `resting_heart_rate` handling:

```js
        if (fitnessConfig.resting_heart_rate) {
          hydrated.resting_heart_rate = fitnessConfig.resting_heart_rate;
        }
        if (fitnessConfig.cadence_zones) {
          hydrated.cadence_zones = fitnessConfig.cadence_zones;
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/config/UserService.cadenceZones.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/0_system/config/UserService.mjs tests/unit/config/UserService.cadenceZones.test.mjs
git commit -m "feat(cycle-game): hydrate per-user cadence_zones from profile"
```

---

## Task 5: Config-schema additions (data volume) + API verification

Code in Tasks 1–4 has safe fallbacks (`DEFAULT_CADENCE_CONFIG`, `hrlessMultiplier` default 1, distance delta → 0 when circumference missing), so this task populates real values. It edits the data volume (not the repo) and is verified via the live API rather than a unit test — distances are wrong (0) for any bike without `wheel_circumference_m`, so this step is required for real gameplay.

> Data-volume editing on this host: read via the host Dropbox mount; write via `sudo docker exec daylight-station sh -c '…'` (heredoc, never `sed -i`). See `CLAUDE.local.md`. Confirm the live fitness config path first (`household/config/fitness.yml` or legacy `household/apps/fitness/config.yml`).

- [ ] **Step 1: Locate the live fitness config**

```bash
sudo docker exec daylight-station sh -c 'ls -1 data/household/config/fitness.yml data/household/apps/fitness/config.yml 2>/dev/null'
```
Expected: one path prints. Use whichever exists (prefer `config/fitness.yml`).

- [ ] **Step 2: Add the `cycle_game` section + per-equipment + per-zone fields**

Edit the located file (write the complete file back; do not `sed`). Add a `wheel_circumference_m` to each bike `equipment` entry, a `distance_multiplier` to each `zones` entry, and a top-level `cycle_game` block:

```yaml
cycle_game:
  default_win_condition: distance
  distance_goal_default_m: 3000
  time_cap_default_s: 300
  hrless_multiplier: 1.0
  start_countdown_s: 3
  cadence_zones:
    - { id: warmup,   name: Warm-up,  min: 0,  color: '#5b6470' }
    - { id: cruising, name: Cruising, min: 40, color: '#2ecc71' }
    - { id: pushing,  name: Pushing,  min: 70, color: '#f1c40f' }
    - { id: sprint,   name: Sprint,   min: 90, color: '#e74c3c' }
  backgrounds: []
  default_background: null
```

For zones add `distance_multiplier`: cool `0.5`, active `1.0`, warm `1.5`, hot `2.0`, fire `3.0`.
For each bike equipment add `wheel_circumference_m` (meters per wheel revolution) — use the real wheel sizes (the tricycle's is smaller, e.g. ~1.2; a standard bike ~2.1).

- [ ] **Step 3: Add a per-user `cadence_zones` override to a test user**

```bash
sudo docker exec daylight-station sh -c 'cat data/users/felix/profile.yml'
```
Re-write `felix`'s profile adding under `apps.fitness:` (alongside `heart_rate_zones`):
```yaml
    cadence_zones:
      cruising: 50
      pushing: 80
      sprint: 105
```

- [ ] **Step 4: Verify via the live API**

Reload config / restart the dev server or container as appropriate, then:

```bash
curl -s http://localhost:3111/api/v1/fitness | jq '{
  cycle_game: .fitness.cycle_game // .cycle_game,
  zones: (.fitness.zones // .zones),
  equipment: (.fitness.equipment // .equipment),
  felix: ((.fitness.users // .users).primary[] | select(.id=="felix") | {id, cadence_zones})
}'
```
Expected: `cycle_game` present with `cadence_zones`/`hrless_multiplier`; each `zones[]` entry has `distance_multiplier`; each bike `equipment[]` has `wheel_circumference_m`; `felix.cadence_zones` shows `{cruising:50, pushing:80, sprint:105}`.

- [ ] **Step 5: Record the verification**

No code commit (data-volume change). Paste the `curl … | jq` output into the execution notes / PR description as evidence the schema is live, per the "report outcomes faithfully" rule.

---

## Final Verification

- [ ] **Run all Plan-1 frontend foundations:**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/ frontend/src/hooks/fitness/cadenceZones.test.js`
Expected: all green (formatDistance 5, distanceModel 6, cadenceZones 5).

- [ ] **Run the backend hydration test:**

Run: `npx jest tests/unit/config/UserService.cadenceZones.test.mjs`
Expected: PASS (2).

- [ ] **Confirm the data contract for downstream plans:** `/api/v1/fitness` exposes `cycle_game` (with `cadence_zones`, `hrless_multiplier`, `default_win_condition`, goal/time defaults, `start_countdown_s`, `backgrounds`), `zones[].distance_multiplier`, `equipment[].wheel_circumference_m`, and per-user `cadence_zones`.

---

## Self-Review Notes

- **Spec coverage:** §2 distance formula → Task 2; `formatDistance` rules → Task 1; cool 0.5×/HR-less 1× → Task 2 + config `hrless_multiplier` (Task 5); §7.1 system config (`cycle_game`, `wheel_circumference_m`, `distance_multiplier`) → Task 5; §7.2 per-user override + hydration + `buildCadenceConfig` → Tasks 3–4. Out of scope for Plan 1 (later plans): the speedometer/gauge, race engine, persistence, screen, lobby.
- **Type consistency:** `buildCadenceConfig(systemCadenceZones, overrides)` returns `{id,name,color,min}` (matches `buildZoneConfig`); `zoneMultiplierFor(zoneId, zones, hrlessMultiplier)` and `computeDistanceDelta(rotationsDelta, wheelCircumferenceM, zoneMultiplier)` signatures are used identically in tests and prose. Config keys snake_case with unit suffixes throughout.
- **No placeholders:** every code/test step contains full code; the one non-TDD task (5) is a data-volume change with explicit API verification and is flagged as such.
