# Governance Display SSoT Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate SSoT violations in the governance overlay display pipeline by separating decision data (GovernanceEngine) from display data (ParticipantDisplayMap), removing ~170 lines of re-derivation from the overlay.

**Architecture:** A new `participantDisplayMap` memo in FitnessContext becomes the single source for "how to render a participant" — combining ZoneProfileStore + roster once. GovernanceEngine sheds display data (colors, names) and produces only decision data (zone IDs, user IDs, phase). A new `useGovernanceDisplay` hook joins decisions with display data in ~30 lines, replacing three separate useMemos (~270 lines). Zone metadata is hoisted to FitnessContext, computed once instead of three times.

**Tech Stack:** React (hooks, useMemo, useCallback, context), Jest with `--experimental-vm-modules`, Playwright (runtime tests)

**Audit:** `docs/_wip/audits/2026-02-13-governance-overlay-display-architecture-audit.md`

---

### Task 1: Add ParticipantDisplayMap to FitnessContext

Creates the single source of truth for "how to render a participant." Additive — no existing code changes.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:1324-1352` (near participantRoster memo), `~2108` (context value)
- Test: `tests/isolated/domain/fitness/legacy/participant-display-map.unit.test.mjs` (create)

**Step 1: Write the failing test**

Create `tests/isolated/domain/fitness/legacy/participant-display-map.unit.test.mjs`:

```javascript
import { jest } from '@jest/globals';

// Mock FitnessContext to test participantDisplayMap in isolation
// We test the pure function, not the React hook
import { buildParticipantDisplayMap } from '#frontend/context/FitnessContext.jsx';

describe('buildParticipantDisplayMap', () => {
  const mockProfiles = [
    {
      id: 'user-1',
      name: 'User One',
      displayName: 'User One',
      heartRate: 130,
      currentZoneId: 'warm',
      currentZoneName: 'Warm',
      currentZoneColor: '#eab308',
      progress: 0.65,
      targetHeartRate: 145,
      zoneSequence: [{ id: 'cool' }, { id: 'active' }, { id: 'warm' }],
      groupLabel: 'Adults',
      source: 'primary',
      updatedAt: 1000
    }
  ];

  const mockRoster = [
    { id: 'user-1', name: 'User One', avatarUrl: '/img/user-1.jpg' }
  ];

  test('produces display entry from ZoneProfileStore profile + roster', () => {
    const map = buildParticipantDisplayMap(mockProfiles, mockRoster);
    const entry = map.get('user one');  // normalized
    expect(entry).toBeDefined();
    expect(entry.id).toBe('user-1');
    expect(entry.displayName).toBe('User One');
    expect(entry.avatarSrc).toBe('/img/user-1.jpg');
    expect(entry.heartRate).toBe(130);
    expect(entry.zoneId).toBe('warm');
    expect(entry.zoneName).toBe('Warm');
    expect(entry.zoneColor).toBe('#eab308');
    expect(entry.progress).toBe(0.65);
  });

  test('zone data comes from ZoneProfileStore (stabilized), not raw', () => {
    const map = buildParticipantDisplayMap(mockProfiles, mockRoster);
    const entry = map.get('user one');
    // These fields come directly from ZoneProfileStore profile
    // which applies hysteresis — NOT from raw device data
    expect(entry.zoneId).toBe('warm');
    expect(entry.zoneColor).toBe('#eab308');
  });

  test('handles missing roster entry gracefully', () => {
    const map = buildParticipantDisplayMap(mockProfiles, []);
    const entry = map.get('user one');
    expect(entry).toBeDefined();
    expect(entry.displayName).toBe('User One');
    expect(entry.avatarSrc).toContain('user');  // fallback avatar
  });

  test('handles empty profiles', () => {
    const map = buildParticipantDisplayMap([], mockRoster);
    expect(map.size).toBe(0);
  });

  test('normalizes keys for case-insensitive lookup', () => {
    const map = buildParticipantDisplayMap(mockProfiles, mockRoster);
    expect(map.get('user one')).toBeDefined();
    expect(map.get('USER ONE')).toBeUndefined();  // Map is pre-normalized
  });
});
```

**Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/legacy/participant-display-map.unit.test.mjs --no-coverage
```

Expected: FAIL — `buildParticipantDisplayMap` is not exported from FitnessContext.

**Step 3: Implement buildParticipantDisplayMap**

In `frontend/src/context/FitnessContext.jsx`, add a **named export** of the pure function (above the component, near line 40):

```javascript
/**
 * Builds a display-ready map of participants from ZoneProfileStore + roster.
 * Single source of truth for "how to render a participant."
 * Exported for testability — used internally via useMemo.
 *
 * @param {Array} profiles - From ZoneProfileStore.getProfiles()
 * @param {Array} roster - Session roster with avatar/metadata
 * @returns {Map<string, DisplayEntry>} Normalized name → display entry
 */
export function buildParticipantDisplayMap(profiles, roster) {
  const map = new Map();
  const normalize = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

  const rosterIndex = new Map();
  (roster || []).forEach((r) => {
    const key = normalize(r?.name || r?.id || '');
    if (key) rosterIndex.set(key, r);
  });

  (profiles || []).forEach((profile) => {
    if (!profile?.id) return;
    const key = normalize(profile.id);
    const rosterEntry = rosterIndex.get(key)
      || rosterIndex.get(normalize(profile.name || ''));
    const avatarSrc = rosterEntry?.avatarUrl
      || (profile.profileId ? `/static/img/users/${profile.profileId}` : '/static/img/users/user');

    map.set(key, {
      id: profile.id,
      displayName: profile.displayName || profile.name || profile.id,
      avatarSrc,
      heartRate: profile.heartRate ?? null,
      zoneId: profile.currentZoneId || null,
      zoneName: profile.currentZoneName || null,
      zoneColor: profile.currentZoneColor || null,
      progress: profile.progress ?? null,
      targetHeartRate: profile.targetHeartRate ?? null,
      zoneSequence: profile.zoneSequence || [],
      groupLabel: profile.groupLabel || null,
      source: profile.source || null,
      updatedAt: profile.updatedAt || null
    });
  });

  return map;
}
```

Then inside the component, add the memo (near line 1355, after `participantRoster`):

```javascript
const participantDisplayMap = React.useMemo(() => {
  const profiles = session?.zoneProfileStore?.getProfiles() || [];
  const roster = session?.roster || [];
  return buildParticipantDisplayMap(profiles, roster);
}, [session, version]);
```

Add to the context value object (near line 2115):

```javascript
participantDisplayMap,
```

**Step 4: Run test to verify it passes**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/legacy/participant-display-map.unit.test.mjs --no-coverage
```

Expected: 5 PASS.

**Step 5: Run full fitness suite — no regressions**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/ --no-coverage --testPathIgnorePatterns='/\.worktrees/'
```

Expected: 33+ suites pass, 0 failures.

**Step 6: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx tests/isolated/domain/fitness/legacy/participant-display-map.unit.test.mjs
git commit -m "feat: add ParticipantDisplayMap as single display source in FitnessContext"
```

---

### Task 2: Hoist zoneMetadata to FitnessContext

Zone metadata (the zone *system* — what zones exist, colors, thresholds, ranks) is computed 3 times today. Hoist to one location.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:1305-1317` (near existing zoneInfoMap), `~2074` (context value)
- Test: `tests/isolated/domain/fitness/legacy/zone-metadata-ssot.unit.test.mjs` (create)

**Step 1: Write the failing test**

Create `tests/isolated/domain/fitness/legacy/zone-metadata-ssot.unit.test.mjs`:

```javascript
import { buildZoneMetadata } from '#frontend/context/FitnessContext.jsx';

describe('buildZoneMetadata', () => {
  const zoneConfig = [
    { id: 'cool', name: 'Cool', color: '#94a3b8', min: 0 },
    { id: 'active', name: 'Active', color: '#22c55e', min: 100 },
    { id: 'warm', name: 'Warm', color: '#eab308', min: 130 },
    { id: 'hot', name: 'Hot', color: '#f97316', min: 155 },
    { id: 'fire', name: 'Fire', color: '#ef4444', min: 175 }
  ];

  test('map contains all zones keyed by normalized ID', () => {
    const meta = buildZoneMetadata(zoneConfig);
    expect(Object.keys(meta.map)).toEqual(['cool', 'active', 'warm', 'hot', 'fire']);
    expect(meta.map.warm.name).toBe('Warm');
    expect(meta.map.warm.color).toBe('#eab308');
  });

  test('each zone has a rank matching sorted order by min', () => {
    const meta = buildZoneMetadata(zoneConfig);
    expect(meta.map.cool.rank).toBe(0);
    expect(meta.map.active.rank).toBe(1);
    expect(meta.map.warm.rank).toBe(2);
    expect(meta.map.hot.rank).toBe(3);
    expect(meta.map.fire.rank).toBe(4);
  });

  test('rankMap provides zoneId → rank for GovernanceEngine', () => {
    const meta = buildZoneMetadata(zoneConfig);
    expect(meta.rankMap.cool).toBe(0);
    expect(meta.rankMap.warm).toBe(2);
  });

  test('infoMap provides zoneId → {id, name, color} for GovernanceEngine', () => {
    const meta = buildZoneMetadata(zoneConfig);
    expect(meta.infoMap.warm).toEqual({ id: 'warm', name: 'Warm', color: '#eab308' });
  });

  test('handles empty config', () => {
    const meta = buildZoneMetadata([]);
    expect(Object.keys(meta.map)).toEqual([]);
    expect(Object.keys(meta.rankMap)).toEqual([]);
  });

  test('ranked array is sorted by min threshold', () => {
    const shuffled = [zoneConfig[3], zoneConfig[0], zoneConfig[4], zoneConfig[1], zoneConfig[2]];
    const meta = buildZoneMetadata(shuffled);
    expect(meta.ranked.map(z => z.id)).toEqual(['cool', 'active', 'warm', 'hot', 'fire']);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/legacy/zone-metadata-ssot.unit.test.mjs --no-coverage
```

Expected: FAIL — `buildZoneMetadata` is not exported.

**Step 3: Implement buildZoneMetadata**

In `frontend/src/context/FitnessContext.jsx`, add a named export (near `buildParticipantDisplayMap`):

```javascript
/**
 * Builds zone metadata from zone config. Single source for zone system info.
 * Produces map (display), rankMap (evaluation), infoMap (evaluation), ranked (sorted list).
 *
 * @param {Array} zoneConfig - Zone configuration array
 * @returns {{ map, rankMap, infoMap, ranked }}
 */
export function buildZoneMetadata(zoneConfig) {
  const zones = Array.isArray(zoneConfig) ? zoneConfig.filter(Boolean) : [];
  const sorted = [...zones].sort((a, b) => (a?.min ?? 0) - (b?.min ?? 0));

  const map = {};      // zoneId → { id, name, color, min, rank } — for display
  const rankMap = {};   // zoneId → rank integer — for GovernanceEngine
  const infoMap = {};   // zoneId → { id, name, color } — for GovernanceEngine
  const ranked = [];    // sorted array

  sorted.forEach((zone, index) => {
    if (!zone || zone.id == null) return;
    const id = String(zone.id).toLowerCase();
    const entry = {
      id,
      name: zone.name || zone.id,
      color: zone.color || null,
      min: typeof zone.min === 'number' ? zone.min : null,
      rank: index
    };
    map[id] = entry;
    rankMap[id] = index;
    infoMap[id] = { id, name: entry.name, color: entry.color };
    ranked.push(entry);
  });

  return { map, rankMap, infoMap, ranked };
}
```

Inside the component, add the memo (replacing or alongside existing `zoneRankMap`/`zoneInfoMap`, near line 1276):

```javascript
const zoneMetadata = React.useMemo(
  () => buildZoneMetadata(zoneConfig),
  [zoneConfig]
);
```

For backwards compatibility (existing consumers use `zoneRankMap` and `zoneInfoMap`), derive them:

```javascript
const zoneRankMap = zoneMetadata.rankMap;
const zoneInfoMap = zoneMetadata.infoMap;
```

This replaces the two existing useMemo blocks at lines 1276-1290 (`zoneRankMap`) and 1305-1317 (`zoneInfoMap`).

Add `zoneMetadata` to the context value object (near line 2074):

```javascript
zoneMetadata,
```

**Step 4: Run test to verify it passes**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/legacy/zone-metadata-ssot.unit.test.mjs --no-coverage
```

Expected: 6 PASS.

**Step 5: Run full fitness suite — no regressions**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/ --no-coverage --testPathIgnorePatterns='/\.worktrees/'
```

Expected: 33+ suites pass, 0 failures.

**Step 6: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx tests/isolated/domain/fitness/legacy/zone-metadata-ssot.unit.test.mjs
git commit -m "feat: hoist zoneMetadata to FitnessContext — single zone system computation"
```

---

### Task 3: Create useGovernanceDisplay hook

The new thin join hook. Takes governance decisions + display map + zone metadata → resolved display rows. Replaces `useGovernanceOverlay` + `warningOffenders` + `lockRows` (~270 lines → ~60 lines).

**Files:**
- Create: `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js`
- Test: `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs` (create)

**Step 1: Write the failing test**

Create `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs`:

```javascript
import { jest } from '@jest/globals';

// Mock React hooks for unit testing
const mockUseMemo = jest.fn((fn) => fn());
jest.unstable_mockModule('react', () => ({
  useMemo: mockUseMemo,
  default: { useMemo: mockUseMemo }
}));

const { resolveGovernanceDisplay } = await import(
  '#frontend/modules/Fitness/hooks/useGovernanceDisplay.js'
);

const ZONE_META = {
  map: {
    cool: { id: 'cool', name: 'Cool', color: '#94a3b8', rank: 0, min: 0 },
    active: { id: 'active', name: 'Active', color: '#22c55e', rank: 1, min: 100 },
    warm: { id: 'warm', name: 'Warm', color: '#eab308', rank: 2, min: 130 }
  },
  rankMap: { cool: 0, active: 1, warm: 2 },
  infoMap: {
    cool: { id: 'cool', name: 'Cool', color: '#94a3b8' },
    active: { id: 'active', name: 'Active', color: '#22c55e' },
    warm: { id: 'warm', name: 'Warm', color: '#eab308' }
  }
};

const makeDisplayMap = (entries) => {
  const map = new Map();
  entries.forEach(e => map.set(e.id.toLowerCase(), e));
  return map;
};

describe('resolveGovernanceDisplay', () => {
  test('returns null for ungoverned content', () => {
    const result = resolveGovernanceDisplay(
      { isGoverned: false },
      new Map(),
      ZONE_META
    );
    expect(result).toBeNull();
  });

  test('returns show:false for unlocked', () => {
    const result = resolveGovernanceDisplay(
      { isGoverned: true, status: 'unlocked', requirements: [] },
      new Map(),
      ZONE_META
    );
    expect(result.show).toBe(false);
    expect(result.status).toBe('unlocked');
  });

  test('resolves pending rows from requirements + display map', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'user-1', displayName: 'Alice', avatarSrc: '/img/alice.jpg',
        heartRate: 95, zoneId: 'cool', zoneName: 'Cool', zoneColor: '#94a3b8',
        progress: 0.3, zoneSequence: [], targetHeartRate: 100
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'pending',
        requirements: [
          { zone: 'warm', rule: 'all', missingUsers: ['user-1'], satisfied: false }
        ],
        activeParticipants: ['user-1']
      },
      displayMap,
      ZONE_META
    );

    expect(result.show).toBe(true);
    expect(result.status).toBe('pending');
    expect(result.rows.length).toBe(1);

    const row = result.rows[0];
    expect(row.displayName).toBe('Alice');
    expect(row.avatarSrc).toBe('/img/alice.jpg');
    expect(row.heartRate).toBe(95);
    expect(row.currentZone.id).toBe('cool');
    expect(row.currentZone.color).toBe('#94a3b8');
    expect(row.targetZone.id).toBe('warm');
    expect(row.targetZone.color).toBe('#eab308');
  });

  test('warning includes deadline and gracePeriodTotal', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'user-1', displayName: 'Alice', avatarSrc: '/img/alice.jpg',
        heartRate: 85, zoneId: 'cool', zoneName: 'Cool', zoneColor: '#94a3b8',
        progress: 0.2, zoneSequence: [], targetHeartRate: 100
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'warning',
        requirements: [
          { zone: 'active', rule: 'all', missingUsers: ['user-1'], satisfied: false }
        ],
        deadline: Date.now() + 20000,
        gracePeriodTotal: 30,
        activeParticipants: ['user-1']
      },
      displayMap,
      ZONE_META
    );

    expect(result.status).toBe('warning');
    expect(result.deadline).toBeDefined();
    expect(result.gracePeriodTotal).toBe(30);
    expect(result.rows.length).toBe(1);
  });

  test('deduplicates users across multiple requirements', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'user-1', displayName: 'Alice', avatarSrc: '/img/a.jpg',
        heartRate: 85, zoneId: 'cool', zoneName: 'Cool', zoneColor: '#94a3b8',
        progress: 0.2, zoneSequence: [], targetHeartRate: 100
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'pending',
        requirements: [
          { zone: 'active', rule: 'all', missingUsers: ['user-1'], satisfied: false },
          { zone: 'warm', rule: 'all', missingUsers: ['user-1'], satisfied: false }
        ],
        activeParticipants: ['user-1']
      },
      displayMap,
      ZONE_META
    );

    // User appears once, with highest-severity target zone
    expect(result.rows.length).toBe(1);
  });

  test('handles missing user in display map gracefully', () => {
    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'pending',
        requirements: [
          { zone: 'warm', rule: 'all', missingUsers: ['unknown-user'], satisfied: false }
        ],
        activeParticipants: ['unknown-user']
      },
      new Map(),
      ZONE_META
    );

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].displayName).toBe('unknown-user');  // fallback
    expect(result.rows[0].currentZone).toBeNull();
  });

  test('includes challenge rows when challenge has missingUsers', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'user-1', displayName: 'Alice', avatarSrc: '/img/a.jpg',
        heartRate: 120, zoneId: 'active', zoneName: 'Active', zoneColor: '#22c55e',
        progress: 0.6, zoneSequence: [], targetHeartRate: 130
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'locked',
        requirements: [],
        videoLocked: true,
        challenge: {
          id: 'ch-1', status: 'active', zone: 'warm',
          missingUsers: ['user-1'], metUsers: [],
          requiredCount: 1, actualCount: 0
        },
        activeParticipants: ['user-1']
      },
      displayMap,
      ZONE_META
    );

    expect(result.show).toBe(true);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].targetZone.id).toBe('warm');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs --no-coverage
```

Expected: FAIL — module does not exist.

**Step 3: Implement useGovernanceDisplay**

Create `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js`:

```javascript
import { useMemo } from 'react';

const FALLBACK_AVATAR = '/static/img/users/user';
const normalize = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/**
 * Pure function: resolve governance decisions + display map → display rows.
 * Exported for testability. Used via useGovernanceDisplay hook.
 */
export function resolveGovernanceDisplay(govState, displayMap, zoneMeta) {
  if (!govState?.isGoverned) return null;

  const { status, requirements, challenge, deadline, gracePeriodTotal, videoLocked } = govState;

  if (status === 'unlocked') {
    return { show: false, status, rows: [] };
  }

  // Collect all (userId, targetZoneId) pairs from unsatisfied requirements + active challenge
  const userTargets = new Map(); // userId → targetZoneId (highest severity wins)
  const zoneMap = zoneMeta?.map || {};
  const rankOf = (zoneId) => zoneMap[zoneId]?.rank ?? -1;

  // Base requirements
  (requirements || []).forEach((req) => {
    if (req.satisfied) return;
    const targetZoneId = req.zone || null;
    (req.missingUsers || []).forEach((userId) => {
      const key = normalize(userId);
      const existing = userTargets.get(key);
      if (!existing || rankOf(targetZoneId) > rankOf(existing.targetZoneId)) {
        userTargets.set(key, { userId, targetZoneId });
      }
    });
  });

  // Challenge requirements (if active and has missing users)
  if (challenge && challenge.status === 'active' && Array.isArray(challenge.missingUsers)) {
    const targetZoneId = challenge.zone || null;
    challenge.missingUsers.forEach((userId) => {
      const key = normalize(userId);
      const existing = userTargets.get(key);
      if (!existing || rankOf(targetZoneId) > rankOf(existing.targetZoneId)) {
        userTargets.set(key, { userId, targetZoneId });
      }
    });
  }

  // Resolve each user against the display map
  const rows = [];
  for (const [key, { userId, targetZoneId }] of userTargets) {
    const display = displayMap.get(key);
    const targetZone = targetZoneId ? (zoneMap[targetZoneId] || null) : null;
    const currentZoneId = display?.zoneId || null;
    const currentZone = currentZoneId ? (zoneMap[currentZoneId] || null) : null;

    rows.push({
      key: key,
      userId,
      displayName: display?.displayName || userId,
      avatarSrc: display?.avatarSrc || FALLBACK_AVATAR,
      heartRate: display?.heartRate ?? null,
      currentZone,
      targetZone,
      zoneSequence: display?.zoneSequence || [],
      progress: display?.progress ?? null,
      targetHeartRate: display?.targetHeartRate ?? null,
      groupLabel: display?.groupLabel || null
    });
  }

  // Sort by severity (highest target zone first)
  rows.sort((a, b) => rankOf(b.targetZone?.id) - rankOf(a.targetZone?.id));

  const show = rows.length > 0 || status === 'locked' || status === 'pending';

  return {
    show,
    status,
    deadline: deadline || null,
    gracePeriodTotal: gracePeriodTotal || null,
    videoLocked: videoLocked || false,
    challenge: challenge || null,
    rows
  };
}

/**
 * React hook: joins governance decisions with participant display data.
 * Replaces useGovernanceOverlay + warningOffenders + lockRows.
 */
export function useGovernanceDisplay(govState, displayMap, zoneMeta) {
  return useMemo(
    () => resolveGovernanceDisplay(govState, displayMap, zoneMeta),
    [govState, displayMap, zoneMeta]
  );
}
```

**Step 4: Run test to verify it passes**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs --no-coverage
```

Expected: 7 PASS.

**Step 5: Run full fitness suite — no regressions**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/ --no-coverage --testPathIgnorePatterns='/\.worktrees/'
```

Expected: 33+ suites pass, 0 failures. (New hook is additive, not wired yet.)

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs
git commit -m "feat: useGovernanceDisplay hook — thin join of decisions + display data"
```

---

### Task 4: Update GovernanceStateOverlay to accept new display format

Modify `GovernanceStateOverlay` to render from the new `governanceDisplay` shape (`{ show, status, rows, deadline, ... }`) instead of three separate props.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx:8-110` (GovernanceWarningOverlay), `103-260` (GovernancePanelOverlay), `309-369` (main component)
- Test: Runtime tests validate behavior

**Step 1: Update GovernanceWarningOverlay to accept rows**

The `GovernanceWarningOverlay` component (line 8) currently receives `offenders` — each with `{ key, displayLabel, heartRate, avatarSrc, zoneColor, progressPercent, targetZoneColor }`.

The new `rows` have `{ key, displayName, heartRate, avatarSrc, currentZone, targetZone, progress }`.

Update the component to accept rows and derive chip display data:

```javascript
const GovernanceWarningOverlay = React.memo(function GovernanceWarningOverlay({ countdown, countdownTotal, rows }) {
  const remaining = Number.isFinite(countdown) ? Math.max(countdown, 0) : 0;
  const total = Number.isFinite(countdownTotal) ? Math.max(countdownTotal, 1) : 1;
  const progress = Math.max(0, Math.min(1, remaining / total));

  return (
    <div className="governance-progress-overlay" aria-hidden="true">
      {Array.isArray(rows) && rows.length > 0 ? (
        <div className="governance-progress-overlay__offenders">
          {rows.map((row) => {
            const chipProgress = Number.isFinite(row.progress) ? Math.max(0, Math.min(100, Math.round(row.progress * 100))) : 0;
            const borderStyle = row.currentZone?.color ? { borderColor: row.currentZone.color } : undefined;
            const progressColor = row.targetZone?.color || row.currentZone?.color || 'rgba(56, 189, 248, 0.95)';
            return (
              <div className="governance-progress-overlay__chip" key={row.key} style={borderStyle}>
                {/* ... same JSX structure, using row.displayName, row.heartRate, row.avatarSrc, chipProgress, progressColor ... */}
              </div>
            );
          })}
        </div>
      ) : null}
      {/* countdown track unchanged */}
    </div>
  );
});
```

**Step 2: Update GovernancePanelOverlay to accept rows**

The `GovernancePanelOverlay` (line 103) currently receives `lockRows` — each with `{ key, displayLabel, avatarSrc, currentZone, targetZone, currentLabel, targetLabel, heartRate, targetHeartRate, progressPercent, progressGradient, intermediateZones }`.

Update to accept `rows` from the new format. The row structure is similar — `currentZone` and `targetZone` are zone objects with `{ id, name, color }`.

The key change: the old `lockRows` had pre-computed `progressGradient` and `intermediateZones`. The new format doesn't pre-compute these (YAGNI — we can add back if needed or compute inline). For now, use a simple progress fill with `targetZone.color`.

**Step 3: Update main GovernanceStateOverlay to accept governanceDisplay**

Replace the three-prop interface with a single `display` prop:

```javascript
const GovernanceStateOverlay = ({ display }) => {
  if (!display?.show) return null;

  const { remaining: countdown } = useDeadlineCountdown(
    display.deadline,
    display.gracePeriodTotal || 30
  );

  const audioTrackKey = useMemo(() => {
    if (display.status === 'pending') return 'init';
    if (display.status === 'locked') return 'locked';
    return null;
  }, [display.status]);

  if (display.status === 'warning') {
    return (
      <>
        <GovernanceAudioPlayer trackKey={audioTrackKey} />
        <GovernanceWarningOverlay
          countdown={countdown}
          countdownTotal={display.gracePeriodTotal}
          rows={display.rows}
        />
      </>
    );
  }

  // pending, locked, challenge-failed
  return (
    <>
      <GovernanceAudioPlayer trackKey={audioTrackKey} />
      <GovernancePanelOverlay display={display} />
    </>
  );
};
```

**Step 4: Do NOT wire to FitnessPlayerOverlay yet** — this task only modifies GovernanceStateOverlay. The old props are still passed; we wire the new path in Task 5.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx
git commit -m "refactor: GovernanceStateOverlay accepts governanceDisplay format"
```

---

### Task 5: Wire FitnessPlayerOverlay to use new hook

Connect everything: FitnessPlayerOverlay uses `useGovernanceDisplay` instead of `useGovernanceOverlay` + `warningOffenders` + `lockRows`.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx:309-1111`

**Step 1: Import the new hook and read context values**

At the top of `FitnessPlayerOverlay` component (line 309), add:

```javascript
import { useGovernanceDisplay } from './hooks/useGovernanceDisplay.js';
```

Inside the component, after existing context reads (~line 311):

```javascript
const participantDisplayMap = fitnessCtx?.participantDisplayMap;
const zoneMetadata = fitnessCtx?.zoneMetadata;
```

**Step 2: Replace overlay computation**

Replace the three useMemos with the new hook. After the existing `governanceState` read:

```javascript
const governanceDisplay = useGovernanceDisplay(governanceState, participantDisplayMap, zoneMetadata);
```

**Step 3: Update GovernanceStateOverlay rendering**

Replace lines 1105-1111:

```javascript
const primaryOverlay = governanceDisplay?.show ? (
  <GovernanceStateOverlay display={governanceDisplay} />
) : null;
```

**Step 4: Update references to old overlay**

The component uses `overlay` in several other places:
- `isGovernanceLocked` (line 333) — replace with `governanceDisplay?.status === 'locked'`
- `overlay?.status` in useEffect deps — replace with `governanceDisplay?.status`
- `overlay?.category` in useEffect deps — remove (no longer has category)
- CSS filter class from `overlay.filterClass` — derive from status: `status === 'warning' ? 'governance-filter-warning' : status === 'locked' ? 'governance-filter-critical' : ''`

Leave the old `useGovernanceOverlay`, `warningOffenders`, `lockRows`, `getParticipantZone` etc. in place for now — they become dead code but don't break anything. We delete them in Task 7.

**Step 5: Run runtime tests**

```bash
npx playwright test tests/live/flow/fitness/governance-transition-tightness.runtime.test.mjs --reporter=line
```

Expected: 3 PASS (no "Waiting" flash, chip colors correct, hydration < 2s).

**Step 6: Run full fitness unit suite**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/ --no-coverage --testPathIgnorePatterns='/\.worktrees/'
```

Expected: 33+ suites pass, 0 failures.

**Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx
git commit -m "refactor: wire FitnessPlayerOverlay to useGovernanceDisplay hook"
```

---

### Task 6: Strip display data from GovernanceEngine

Now that the overlay reads display data from `ParticipantDisplayMap` and zone colors from `zoneMetadata`, the engine no longer needs to embed display data in its state.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1092-1118` (lockRows participantZones), `1528` (zoneColor in _buildRequirementShell), `1610` (zoneColor in _evaluateZoneRequirement), `1049-1175` (_composeState lockRows)
- Modify: `tests/isolated/domain/fitness/legacy/governance-transition-tightness.unit.test.mjs` (update assertions)

**Step 1: Remove zoneColor from _evaluateZoneRequirement**

In `frontend/src/hooks/fitness/GovernanceEngine.js`, line 1610, remove:

```javascript
zoneColor: zoneInfo?.color || null,
```

**Step 2: Remove zoneColor from _buildRequirementShell**

Line 1528, remove:

```javascript
zoneColor: zoneInfo?.color || null,
```

**Step 3: Remove participantZones from _composeState lockRows**

Lines 1096-1117 — revert the `.map()` to the simple version without participantZones:

```javascript
).map((entry) => ({
  ...entry,
  participantKey: entry.participantKey || null,
  targetZoneId: entry.targetZoneId || entry.zone || null,
  severity: entry.severity != null ? entry.severity : this._getZoneRank(entry.targetZoneId)
}));
```

**Step 4: Remove lockRows from _composeState entirely**

The overlay no longer reads `lockRows` from governance state — it builds rows from `requirements[].missingUsers` + `ParticipantDisplayMap`. Remove the `lockRowsNormalized` computation and `enforceOneRowPerParticipant` call. The `lockRows` field in the returned state object becomes `undefined` or is removed.

**Note:** Keep `requirements` in the state — the overlay needs `requirements[].missingUsers` and `requirements[].zone`.

**Step 5: Update unit tests**

In `governance-transition-tightness.unit.test.mjs`:
- Remove assertions for `lockRows[0].zoneColor` and `lockRows[0].participantZones` (4 tests in "zone color" describe)
- Remove assertions for `lockRows[0].missingUsers` — instead assert on `requirements[0].missingUsers`
- Update "lockRows completeness" tests to check `requirements` instead of `lockRows`

**Step 6: Run tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/ --no-coverage --testPathIgnorePatterns='/\.worktrees/'
```

Expected: All pass after test updates.

```bash
npx playwright test tests/live/flow/fitness/governance-transition-tightness.runtime.test.mjs --reporter=line
```

Expected: 3 PASS.

**Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/isolated/domain/fitness/legacy/governance-transition-tightness.unit.test.mjs
git commit -m "refactor: strip display data from GovernanceEngine — decisions only"
```

---

### Task 7: Delete dead overlay code

Remove the old overlay computation code that's no longer wired.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`

**Step 1: Remove old hook and useMemos**

Delete these blocks from FitnessPlayerOverlay.jsx:
- `useGovernanceOverlay` hook definition (lines 49-318)
- `warningOffenders` useMemo (lines 582-658)
- `lockRows` useMemo (lines 660-1053)
- `getParticipantZone` callback (lines 520-567)
- `resolveParticipantVitals` callback (lines 451-480)
- `computeGovernanceProgress` callback (lines 569-580)
- `participantMap` useMemo (lines 499-507)
- `findZoneByLabel` callback (lines 498-506)
- Local `zoneMetadata` useMemo (lines 409-430)
- `normalizeZoneId` local function (lines 444-450)
- Remove the `useGovernanceOverlay` named export

**Step 2: Remove unused imports**

Remove imports only used by deleted code:
- `COOL_ZONE_PROGRESS_MARGIN`, `calculateZoneProgressTowardsTarget`, `normalizeZoneId as normalizeZoneIdForOverlay` from `useFitnessSession.js` (if no longer used)

**Step 3: Remove participantZones from useGovernanceOverlay warning case**

This was already deleted in Step 1 (the entire hook is gone).

**Step 4: Run tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/ --no-coverage --testPathIgnorePatterns='/\.worktrees/'
```

```bash
npx playwright test tests/live/flow/fitness/governance-transition-tightness.runtime.test.mjs --reporter=line
```

Expected: All pass.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx
git commit -m "refactor: delete ~270 lines of dead overlay re-derivation code"
```

---

### Task 8: Deprecate old FitnessContext exports

Remove or alias old context exports that were replaced by `participantDisplayMap` and `zoneMetadata`.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`

**Step 1: Grep for remaining consumers**

Before deleting, check who still uses the old exports:

```bash
# Check which files use getUserVitals, getZoneProfile, userZoneProgress
grep -r "getUserVitals\|getZoneProfile\|userZoneProgress" frontend/src/modules/ --include='*.jsx' --include='*.js' -l
```

Expected consumers (from earlier grep):
- `FitnessPlayerOverlay.jsx` — already migrated (Task 5/7)
- `FitnessSidebar/FitnessUsers.jsx` — still uses them
- `shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx`
- `SidebarFooter.jsx`
- `FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx`
- `FitnessPlugins/useFitnessPlugin.js`

**Step 2: Keep old exports for now, mark deprecated**

Since sidebar and other components still use `getUserVitals`, `getZoneProfile`, and `userZoneProgress`, keep them in the context value but add comments:

```javascript
// DEPRECATED: Use participantDisplayMap instead. These remain for sidebar/plugin consumers.
getUserVitals,    // → participantDisplayMap.get(name)
getZoneProfile,   // → participantDisplayMap.get(name).zoneId/zoneColor/etc
userZoneProgress, // → participantDisplayMap.get(name).progress
```

Delete the old `zoneRankMap` and `zoneInfoMap` memos — replace with derivations from `zoneMetadata`:

```javascript
const zoneRankMap = zoneMetadata.rankMap;
const zoneInfoMap = zoneMetadata.infoMap;
```

**Step 3: Run full test suite**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/ --no-coverage --testPathIgnorePatterns='/\.worktrees/'
```

```bash
npx playwright test tests/live/flow/fitness/governance-transition-tightness.runtime.test.mjs --reporter=line
```

Expected: All pass.

**Step 4: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "refactor: deprecate old vitals exports, derive zoneRankMap/zoneInfoMap from zoneMetadata"
```

---

### Verification Summary

After all 8 tasks, run the full verification:

| Check | Command | Expected |
|-------|---------|----------|
| Fitness unit tests | `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/ --no-coverage --testPathIgnorePatterns='/\.worktrees/'` | 35+ suites, 320+ tests, 0 failures |
| Governance runtime | `npx playwright test tests/live/flow/fitness/governance-transition-tightness.runtime.test.mjs --reporter=line` | 3 pass |
| No "Waiting" flash | Runtime test 1 | No empty rows when device active |
| Chip color correct | Runtime test 2 | Border color matches user's current zone |
| Hydration < 2s | Runtime test 3 | Lock screen shows name within 2s |

### What Changed (Summary)

| Before | After |
|--------|-------|
| Zone metadata computed 3 times | Once (`buildZoneMetadata` in FitnessContext) |
| 6 sources queried per participant | 1 (`participantDisplayMap`) |
| ~270 lines in 3 useMemos + callbacks | ~60 lines in `useGovernanceDisplay` |
| GovernanceEngine embeds zoneColor, participantZones, lockRows | IDs only — no display data |
| Overlay dispatches on `category` string | Dispatches on `status` |
| Governance dependency for zone display | None — `participantDisplayMap` works for all content |
