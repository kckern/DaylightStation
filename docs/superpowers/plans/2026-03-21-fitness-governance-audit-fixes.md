# Fitness Governance Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs found in session `20260321192155` audit: (1) TreasureBox ignores per-user zone overrides, causing wrong coin accumulation for users with custom thresholds; (2) `treasureBox.reset()` called before session summary capture, zeroing out global coin totals in saved sessions; (3) missing fire zone in fitness config while rest of codebase expects it.

**Architecture:** TreasureBox gets per-user zone overrides from ZoneProfileStore (already wired in). Session end captures summary before resetting TreasureBox. Fitness config gets a fire zone added for consistency.

**Tech Stack:** JavaScript (ES modules), Vitest/Jest unit tests, YAML config

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/hooks/fitness/TreasureBox.js` | Modify | Pull per-user zone overrides from ZoneProfileStore in `resolveZone()` |
| `frontend/src/hooks/fitness/FitnessSession.js` | Modify | Capture summary before calling `treasureBox.reset()` in `end()` |
| `data/household/config/fitness.yml` | Modify | Add fire zone definition |
| `tests/isolated/domain/fitness/treasurebox-user-zones.unit.test.mjs` | Create | Tests for per-user zone resolution in TreasureBox |
| `tests/isolated/domain/fitness/session-end-coin-capture.unit.test.mjs` | Create | Tests for summary capture ordering |
| `tests/isolated/domain/fitness/build-session-summary.unit.test.mjs` | Modify | Add test for non-zero treasureBox data flowing through |

---

## Pre-read Reference

Before starting any task, read these files for context:
- `frontend/src/hooks/fitness/TreasureBox.js` — coin accumulation, zone resolution
- `frontend/src/hooks/fitness/ZoneProfileStore.js` — per-user zone profiles with custom thresholds
- `frontend/src/hooks/fitness/FitnessSession.js:1830-1850` — session end() flow
- `frontend/src/hooks/fitness/buildSessionSummary.js` — summary construction
- `tests/isolated/domain/fitness/build-session-summary.unit.test.mjs` — existing test patterns
- `tests/unit/governance/governance-challenge-lock-priority.test.mjs` — existing mock patterns

---

### Task 1: TreasureBox per-user zone override from ZoneProfileStore

The core bug. `TreasureBox.resolveZone()` checks `this.usersConfigOverrides` but this map is never populated because `configure()` is never called with the `users` parameter. The ZoneProfileStore already holds per-user zone configs (via `syncFromUsers()`). TreasureBox already has a `_zoneProfileStore` reference (set via `setZoneProfileStore()`). The fix: when resolving zones, pull per-user zone thresholds from ZoneProfileStore profiles instead of relying on the never-populated `usersConfigOverrides` map.

**Files:**
- Modify: `frontend/src/hooks/fitness/TreasureBox.js:437-451`
- Create: `tests/isolated/domain/fitness/treasurebox-user-zones.unit.test.mjs`

- [ ] **Step 1: Write failing test — user with custom zones gets correct zone resolution**

```javascript
// tests/isolated/domain/fitness/treasurebox-user-zones.unit.test.mjs
import { describe, it, expect, vi } from 'vitest';

// Mock Logger before importing TreasureBox
vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
    error: vi.fn(), sampled: vi.fn(), child: vi.fn().mockReturnThis()
  }),
  getLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
    error: vi.fn(), sampled: vi.fn(), child: vi.fn().mockReturnThis()
  })
}));

const { default: FitnessTreasureBox } = await import('#frontend/hooks/fitness/TreasureBox.js');

// Global zones (from fitness.yml)
const GLOBAL_ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', coins: 0 },
  { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow', coins: 2 },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange', coins: 3 },
  { id: 'fire', name: 'Fire', min: 160, color: 'red', coins: 5 },
];

// Soren's personal zones (active threshold much higher)
const SOREN_ZONE_CONFIG = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', coins: 0 },
  { id: 'active', name: 'Active', min: 125, color: 'green', coins: 1 },
  { id: 'warm', name: 'Warm', min: 150, color: 'yellow', coins: 2 },
  { id: 'hot', name: 'Hot', min: 170, color: 'orange', coins: 3 },
  { id: 'fire', name: 'Fire', min: 190, color: 'red', coins: 5 },
];

function createMockZoneProfileStore(profiles = {}) {
  return {
    getProfile: vi.fn((userId) => {
      const config = profiles[userId];
      if (!config) return null;
      return { id: userId, zoneConfig: config };
    }),
    getZoneState: vi.fn(() => null),
  };
}

function createTreasureBox(zoneProfileStore = null) {
  const mockSession = {
    _log: vi.fn(),
    startTime: Date.now(),
    timebase: { startAbsMs: Date.now(), intervalMs: 5000, intervalCount: 0 },
    timeline: { series: {} },
    snapshot: {},
    roster: [],
  };
  const tb = new FitnessTreasureBox(mockSession);
  tb.configure({ zones: GLOBAL_ZONES });
  if (zoneProfileStore) tb.setZoneProfileStore(zoneProfileStore);
  return tb;
}

describe('TreasureBox per-user zone resolution', () => {
  it('uses global zones when no ZoneProfileStore is set', () => {
    const tb = createTreasureBox();
    // HR 113 is above global active (100) -> should resolve to active
    const zone = tb.resolveZone('soren', 113);
    expect(zone.id).toBe('active');
    expect(zone.coins).toBe(1);
  });

  it('uses per-user zones from ZoneProfileStore when available', () => {
    const store = createMockZoneProfileStore({ soren: SOREN_ZONE_CONFIG });
    const tb = createTreasureBox(store);
    // HR 113 is below Soren's active (125) -> should resolve to cool
    const zone = tb.resolveZone('soren', 113);
    expect(zone.id).toBe('cool');
    expect(zone.coins).toBe(0);
  });

  it('falls back to global zones for users without custom profiles', () => {
    const store = createMockZoneProfileStore({ soren: SOREN_ZONE_CONFIG });
    const tb = createTreasureBox(store);
    // alan has no custom zones -> should use global thresholds
    const zone = tb.resolveZone('alan', 113);
    expect(zone.id).toBe('active');
    expect(zone.coins).toBe(1);
  });

  it('respects per-user active threshold exactly at boundary', () => {
    const store = createMockZoneProfileStore({ soren: SOREN_ZONE_CONFIG });
    const tb = createTreasureBox(store);
    // HR 125 is exactly at Soren's active threshold
    const zone = tb.resolveZone('soren', 125);
    expect(zone.id).toBe('active');
    expect(zone.coins).toBe(1);
  });

  it('resolves higher zones correctly with per-user thresholds', () => {
    const store = createMockZoneProfileStore({ soren: SOREN_ZONE_CONFIG });
    const tb = createTreasureBox(store);
    // HR 155 is warm for Soren (>= 150) but would be hot (>= 140) by global
    const zone = tb.resolveZone('soren', 155);
    expect(zone.id).toBe('warm');
    expect(zone.coins).toBe(2);
  });

  it('still uses usersConfigOverrides if populated (backward compat)', () => {
    const tb = createTreasureBox();
    // Manually populate overrides (legacy path)
    tb.usersConfigOverrides.set('soren', { active: 125, warm: 150, hot: 170, fire: 190 });
    const zone = tb.resolveZone('soren', 113);
    expect(zone.id).toBe('cool');
    expect(zone.coins).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/fitness/treasurebox-user-zones.unit.test.mjs`
Expected: Test `uses per-user zones from ZoneProfileStore when available` FAILS — resolves to `active` instead of `cool` because ZoneProfileStore is not consulted.

- [ ] **Step 3: Implement the fix in TreasureBox.resolveZone()**

Modify `frontend/src/hooks/fitness/TreasureBox.js`, replacing the `resolveZone` method (lines 437-451):

```javascript
  resolveZone(userId, hr) {
    if (!hr || hr <= 0 || this.globalZones.length === 0) return null;

    // Build effective thresholds: priority is usersConfigOverrides > ZoneProfileStore > global
    let overrides = this.usersConfigOverrides.get(userId);

    // If no manual overrides, pull from ZoneProfileStore (per-user custom zones)
    if (!overrides && this._zoneProfileStore) {
      const profile = this._zoneProfileStore.getProfile(userId);
      if (profile?.zoneConfig && Array.isArray(profile.zoneConfig)) {
        // Convert zoneConfig array [{id:'active', min:125}, ...] to override map {active: 125, ...}
        overrides = {};
        for (const z of profile.zoneConfig) {
          const key = z.id || z.name?.toLowerCase();
          if (key && typeof z.min === 'number') {
            overrides[key] = z.min;
          }
        }
      }
    }

    if (!overrides) overrides = {};

    const zonesDescending = [...this.globalZones].sort((a, b) => b.min - a.min);
    for (const zone of zonesDescending) {
      const key = zone.id || zone.name?.toLowerCase();
      const overrideMin = overrides[key];
      const effectiveMin = (typeof overrideMin === 'number') ? overrideMin : zone.min;
      if (hr >= effectiveMin) return { ...zone, min: effectiveMin };
    }
    return null;
  }
```

Key changes:
- When `usersConfigOverrides` has no entry for this user, check `_zoneProfileStore.getProfile(userId)`
- Convert the profile's `zoneConfig` array to the same `{zoneId: min}` override map format
- Everything else (descending sort, spread return) stays the same

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/domain/fitness/treasurebox-user-zones.unit.test.mjs`
Expected: All 6 tests PASS

- [ ] **Step 5: Run existing TreasureBox tests to check for regressions**

Run: `npx jest tests/isolated/domain/fitness/treasurebox-zone-sync.unit.test.mjs --no-coverage`
Expected: PASS (no regressions — note: this file uses Jest, not Vitest)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/TreasureBox.js tests/isolated/domain/fitness/treasurebox-user-zones.unit.test.mjs
git commit -m "fix(fitness): use per-user zone thresholds from ZoneProfileStore in TreasureBox coin calculation

TreasureBox.resolveZone() now checks ZoneProfileStore for per-user zone
configs when usersConfigOverrides has no entry. Previously, per-user zone
overrides were never loaded because configure() was never called with the
users parameter, causing all users to be evaluated against global zone
thresholds. This meant users like Soren (active >= 125) earned coins as
if active at HR 100+ (global threshold) while displaying as 'cool'."
```

---

### Task 2: Fix session summary coin capture ordering

`FitnessSession.end()` calls `treasureBox.reset()` (line 1837) before `this.summary` (line 1839), which reads `treasureBox.summary`. By the time summary captures the state, `totalCoins` is 0 and `buckets` is `{}`.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1835-1842`
- Create: `tests/isolated/domain/fitness/session-end-coin-capture.unit.test.mjs`

- [ ] **Step 1: Write failing test — summary captures coins before reset**

```javascript
// tests/isolated/domain/fitness/session-end-coin-capture.unit.test.mjs
import { describe, it, expect, vi } from 'vitest';

describe('FitnessSession end() coin capture ordering', () => {
  it('captures treasureBox summary BEFORE reset clears state', () => {
    // Simulate the ordering problem:
    // 1. TreasureBox has accumulated coins
    // 2. end() should capture summary first, then reset

    const treasureBox = {
      totalCoins: 500,
      buckets: { blue: 0, green: 200, yellow: 150, orange: 100, red: 50 },
      get summary() {
        return {
          totalCoins: this.totalCoins,
          buckets: { ...this.buckets },
        };
      },
      stop: vi.fn(),
      reset() {
        this.totalCoins = 0;
        this.buckets = {};
      },
    };

    // WRONG ordering (current bug): reset before summary
    const buggyCapture = () => {
      treasureBox.stop();
      treasureBox.reset();
      return treasureBox.summary;
    };

    const buggyResult = buggyCapture();
    expect(buggyResult.totalCoins).toBe(0); // Bug: coins lost

    // Restore state for correct test
    treasureBox.totalCoins = 500;
    treasureBox.buckets = { blue: 0, green: 200, yellow: 150, orange: 100, red: 50 };

    // CORRECT ordering: summary before reset
    const correctCapture = () => {
      treasureBox.stop();
      const summary = treasureBox.summary;
      treasureBox.reset();
      return summary;
    };

    const correctResult = correctCapture();
    expect(correctResult.totalCoins).toBe(500);
    expect(correctResult.buckets.green).toBe(200);
    expect(correctResult.buckets.orange).toBe(100);

    // After correct capture, treasureBox is still reset
    expect(treasureBox.totalCoins).toBe(0);
    expect(treasureBox.buckets).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it demonstrates the bug**

Run: `npx vitest run tests/isolated/domain/fitness/session-end-coin-capture.unit.test.mjs`
Expected: PASS (this test validates the ordering contract — it documents the bug pattern and correct fix. It does not import FitnessSession directly because the class has heavy dependencies. The real regression guard is the code review: the fix is a 3-line reorder with a clear comment explaining why.)

- [ ] **Step 3: Fix the ordering in FitnessSession.end()**

Modify `frontend/src/hooks/fitness/FitnessSession.js` around lines 1835-1842. Change:

```javascript
    // BEFORE (buggy):
    if (this.treasureBox) {
      this.treasureBox.stop();
      // MEMORY LEAK FIX: Clear accumulated timeline data on session end
      this.treasureBox.reset();
    }
    sessionData = this.summary;
```

To:

```javascript
    // AFTER (fixed):
    if (this.treasureBox) {
      this.treasureBox.stop();
    }
    sessionData = this.summary;
    if (this.treasureBox) {
      // MEMORY LEAK FIX: Clear accumulated timeline data on session end
      // Must happen AFTER summary capture so coins/buckets are preserved
      this.treasureBox.reset();
    }
```

- [ ] **Step 4: Run existing build-session-summary tests**

Run: `npx vitest run tests/isolated/domain/fitness/build-session-summary.unit.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js tests/isolated/domain/fitness/session-end-coin-capture.unit.test.mjs
git commit -m "fix(fitness): capture session summary before resetting TreasureBox

Move treasureBox.reset() after this.summary capture in end().
Previously, reset() zeroed totalCoins and buckets before summary
read them, causing saved sessions to always have coins.total=0 and
coins.buckets={}."
```

---

### Task 3: Add fire zone to fitness config

The `fitness.yml` zone config defines only cool/active/warm/hot. But `DEFAULT_ZONE_CONFIG` in `types.js`, `StravaSessionBuilder.mjs`, the UI components, and user profiles all reference a fire zone. Users like Milo (max HR 177) hit fire-level heart rates but get classified as "hot" since the zone doesn't exist.

**Files:**
- Modify: `data/household/config/fitness.yml` (inside Docker container)

- [ ] **Step 1: Verify the current zone config has no fire zone**

Run: `sudo docker exec daylight-station sh -c 'grep -A20 "^zones:" data/household/config/fitness.yml'`
Expected: Shows cool/active/warm/hot only, no fire entry

- [ ] **Step 2: Add fire zone to fitness.yml**

Read the current zones section, then write the updated version. The fire zone should match `DEFAULT_ZONE_CONFIG` and `StravaSessionBuilder` definitions (min: 160, coins: 5, color: red).

Add after the hot zone entry:

```yaml
  - name: Fire
    id: fire
    min: 160
    color: red
    coins: 5
```

Use `sudo docker exec` to edit the file inside the container. **Do NOT use `sed -i`** — it mangles multi-line YAML. Instead, read the full zones section, then write the complete corrected section back via heredoc:

```bash
# 1. Backup
sudo docker exec daylight-station sh -c "cp data/household/config/fitness.yml data/household/config/fitness.yml.bak"

# 2. Read current zones section to verify structure
sudo docker exec daylight-station sh -c 'grep -A25 "^zones:" data/household/config/fitness.yml'

# 3. Write the complete zones section (including fire) via python replacement
sudo docker exec daylight-station sh -c "python3 -c \"
import re
with open('data/household/config/fitness.yml') as f: content = f.read()
# Add fire zone after the hot entry
content = content.replace(
    '    coins: 3\n',
    '    coins: 3\n  - name: Fire\n    id: fire\n    min: 160\n    color: red\n    coins: 5\n',
    1  # only first occurrence (the hot zone coins line)
)
with open('data/household/config/fitness.yml', 'w') as f: f.write(content)
\""
```

**NOTE:** The data volume is inside Docker. The edit must happen via `docker exec`.

- [ ] **Step 3: Verify the fire zone is now present**

Run: `sudo docker exec daylight-station sh -c 'grep -A25 "^zones:" data/household/config/fitness.yml'`
Expected: Shows cool/active/warm/hot/fire

- [ ] **Step 4: Restart the container (or wait for next session) to pick up config changes**

The config is read at session start. No container restart needed — just the next fitness session will use it.

- [ ] **Step 5: Document the change**

No separate commit needed — this is a data-volume config change, not a code change. Note that this aligns `fitness.yml` with `DEFAULT_ZONE_CONFIG` in `types.js` and `StravaSessionBuilder.mjs`.

---

### Task 4: Run full test suite and verify no regressions

- [ ] **Step 1: Run all isolated fitness tests**

Run: `npx vitest run tests/isolated/domain/fitness/`
Expected: All tests PASS

- [ ] **Step 2: Run governance tests**

Run: `npx jest tests/unit/governance/ --no-coverage`
Expected: All tests PASS

- [ ] **Step 3: Run persistence validation tests**

Run: `npx vitest run tests/unit/fitness/persistence-validation.test.mjs`
Expected: PASS

- [ ] **Step 4: Final commit with all changes (if any test adjustments were needed)**

```bash
git add tests/isolated/domain/fitness/ tests/unit/fitness/
git commit -m "test(fitness): verify TreasureBox zone overrides and coin capture fixes"
```

---

## Scope Decisions

### Not fixing in this plan (separate work):

1. **Challenge failure locking while base requirements are met** (`GovernanceEngine.js:1497-1506`): This is working as designed — challenge failure is intentionally a hard lock. The interaction with cooldown timers makes warnings feel delayed, but that's a tuning question, not a bug. File a separate issue if the product behavior should change.

2. **Warning cooldown + grace period tuning** (currently 30s + 30s = 60s): Working as configured. If 60 seconds feels too long, adjust `warning_cooldown_seconds` and/or `grace_period_seconds` in `fitness.yml`. This is a product decision, not a code fix.

3. **StravaSessionBuilder hardcoded zones**: `StravaSessionBuilder.mjs` has its own zone definitions (lines 14-20) that don't read from config. This is used only for post-hoc Strava webhook session reconstruction — separate from live sessions. Aligning it with config would be a separate refactor.
