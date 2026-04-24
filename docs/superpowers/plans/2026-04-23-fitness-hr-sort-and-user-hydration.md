# Fitness HR Zone Sort and User Hydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two FitnessChart bugs. Issue A: hydrate the legend's offline/historical participants from session participant metadata (and the ZoneProfileStore / participantDisplayMap) instead of falling back to raw user IDs. Issue B: within an HR zone, sort the chart's legend by zone progress (and then zoneIndex / raw HR / id) so someone further through "Warm" appears above someone newer to "Warm" even if the latter currently has higher raw HR.

**Architecture:** Both fixes land in the same surfaces: the FitnessChart legend, built in `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` via the `filterEntries` memo (line 1179-1187) from `allEntries` (line 461). That collection is populated by two code paths: (a) live "present" participants through `useRaceChartData` (line 90-251), and (b) historical/offline participants through `useRaceChartWithHistory`'s historical branch (line 304-378). The historical branch is where Issue A is rooted — it writes `name: slug` and `avatarUrl: null` for users not currently in the roster (line 355-371). Issue A is fixed by passing a name/avatar lookup (built from `fitnessSessionInstance.snapshot.usersMeta` and the live `participantDisplayMap`) into `useRaceChartWithHistory`. Issue B is fixed by introducing a new comparator (`compareLegendEntries`) in `frontend/src/modules/Fitness/widgets/FitnessChart/layout/utils/sort.js` and applying it in the `filterEntries` memo. The existing `compareAvatars` is used for chart-positioning and stays untouched (it operates on chart-space `x/y/value = cumulative beats`, not HR zone progress).

**Tech Stack:** React 18, Jest (ESM), JavaScript/JSX. Test files live in `tests/unit/fitness/*.test.mjs` and `tests/isolated/domain/fitness/legacy/*.unit.test.mjs`.

**Spec:** None separate — the bug bash items in the task brief are the spec. Both issues (A: offline user hydration, B: HR zone secondary sort by progress %) are captured in this plan's task sections below.

---

## File Structure

| File | Role | Change |
|---|---|---|
| `frontend/src/modules/Fitness/widgets/FitnessChart/layout/utils/sort.js` | Comparator utilities (chart-positioning) | Add new `compareLegendEntries` export; leave `compareAvatars` alone |
| `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` | Legend build + historical participant hydration | (1) Build + thread a `historicalParticipantMeta` lookup down to `useRaceChartWithHistory`. (2) Apply new sort in `filterEntries` memo. (3) Use meta for offline users' name/avatar. |
| `frontend/src/hooks/fitness/participantDisplayMap.js` | Display-entry builder | Add `zoneIndex` to each entry (surfaces `profile.zoneSnapshot?.zoneIndex` so Issue B can sort without digging) |
| `frontend/src/context/FitnessContext.jsx` | Session context value | Expose `sessionParticipantsMeta` (from `fitnessSessionInstance.snapshot.usersMeta`) on the context value so the chart can use it for offline hydration |
| `tests/unit/fitness/legend-sort.test.mjs` | NEW test file for `compareLegendEntries` | Full coverage of the four-key sort order |
| `tests/unit/fitness/legend-hydration.test.mjs` | NEW test file for the offline-user resolver helper | Covers the priority chain (session meta → displayMap → raw slug) |
| `tests/isolated/domain/fitness/legacy/participant-display-map.unit.test.mjs` | Existing displayMap tests | Add one test locking in the new `zoneIndex` field |

**Offline-hydration resolver strategy:** Rather than expand `useRaceChartWithHistory` into a deeply-coupled hook, we extract a small pure function `resolveHistoricalParticipant(slug, { sessionParticipantsMeta, displayMap })` that returns `{ name, avatarUrl, profileId }`. It lives in `FitnessChart.jsx` as a top-level helper (matching `slugifyId`, `cacheEntryEqual`, etc.) and is unit-testable via a separate test file.

---

## Background — Data Shapes and Resolution Chain

**Session participant metadata** (persisted, available via `fitnessSessionInstance.snapshot.usersMeta`, which is a `Map<string, { name, displayName, age, hrDeviceId, cadenceDeviceId }>`). Set in `frontend/src/hooks/fitness/FitnessSession.js:1762-1768`. This is the per-session record that survives even when a participant drops their device.

**ZoneProfileStore profiles** (live — `session.zoneProfileStore.getProfiles()`). Carries `{ id, name, displayName, heartRate, currentZoneId, progress, zoneSnapshot: { zoneIndex, ... } }`. Gone once the profile is evicted (offline users not here).

**participantDisplayMap** (derived — `buildParticipantDisplayMap(profiles, roster)`). Has `displayName`, `avatarSrc`, `progress`, `zoneId`, etc. but NOT `zoneIndex` yet. We add `zoneIndex` in Task 3.

**Historical participant slugs** (`fitnessCtx.fitnessSessionInstance.getHistoricalParticipants()`). Plain `string[]` of user IDs ever seen in the session.

**Resolution chain for offline user display (required by Issue A):**

1. `displayMap.get(slug)` → if hit and it has a `displayName` that isn't just the raw slug, use it.
2. `sessionParticipantsMeta.get(slug)` → use `.displayName` or `.name` (per `FitnessSession.js:1762`, both are populated to `user.name`).
3. Fall back to `slug` (capitalized first letter, matching `sessionDataAdapter.js:96`).

Avatar URL: always use `DaylightMediaPath('/static/img/users/${slug}')` (standard derivation — no persistence needed; the /static/img/users/ static route serves these).

---

## Task 1: Add `compareLegendEntries` comparator (RED)

**Files:**
- Create: `tests/unit/fitness/legend-sort.test.mjs`

- [ ] **Step 1: Create the new failing test file**

Create `tests/unit/fitness/legend-sort.test.mjs` with this content:

```js
// tests/unit/fitness/legend-sort.test.mjs
import { describe, it, expect } from '@jest/globals';
import { compareLegendEntries } from '#frontend/modules/Fitness/widgets/FitnessChart/layout/utils/sort.js';

// Shape the comparator expects (the relevant fields from an allEntries[i]-derived
// legend entry). Extra fields (name, avatarUrl, color) are ignored.
const entry = (overrides) => ({
  id: 'alice',
  zoneIndex: 0,
  progress: 0,
  heartRate: 0,
  ...overrides
});

describe('compareLegendEntries', () => {
  it('sorts by zoneIndex DESC first (higher zone on top)', () => {
    const a = entry({ id: 'a', zoneIndex: 2, progress: 0.1, heartRate: 150 });
    const b = entry({ id: 'b', zoneIndex: 1, progress: 0.9, heartRate: 180 });
    expect([b, a].sort(compareLegendEntries).map(e => e.id)).toEqual(['a', 'b']);
  });

  it('within the same zone, sorts by progress DESC', () => {
    // Warm zone, different per-user thresholds — a is 80% through, b is 20%.
    // b has a higher raw HR but is newer to the zone.
    const a = entry({ id: 'a', zoneIndex: 2, progress: 0.8, heartRate: 140 });
    const b = entry({ id: 'b', zoneIndex: 2, progress: 0.2, heartRate: 160 });
    expect([b, a].sort(compareLegendEntries).map(e => e.id)).toEqual(['a', 'b']);
  });

  it('within same zone and same progress, sorts by heartRate DESC', () => {
    const a = entry({ id: 'a', zoneIndex: 2, progress: 0.5, heartRate: 150 });
    const b = entry({ id: 'b', zoneIndex: 2, progress: 0.5, heartRate: 155 });
    expect([a, b].sort(compareLegendEntries).map(e => e.id)).toEqual(['b', 'a']);
  });

  it('final tiebreak is id ASC (deterministic)', () => {
    const a = entry({ id: 'zeb',   zoneIndex: 1, progress: 0.3, heartRate: 120 });
    const b = entry({ id: 'alice', zoneIndex: 1, progress: 0.3, heartRate: 120 });
    expect([a, b].sort(compareLegendEntries).map(e => e.id)).toEqual(['alice', 'zeb']);
  });

  it('treats missing progress/zoneIndex/heartRate as 0 (stable for offline users)', () => {
    const active  = entry({ id: 'active',  zoneIndex: 1, progress: 0.5, heartRate: 140 });
    const offline = entry({ id: 'offline', zoneIndex: undefined, progress: undefined, heartRate: undefined });
    expect([offline, active].sort(compareLegendEntries).map(e => e.id)).toEqual(['active', 'offline']);
  });

  it('is a proper comparator — produces a stable total order across permutations', () => {
    const entries = [
      entry({ id: 'a', zoneIndex: 2, progress: 0.8, heartRate: 140 }),
      entry({ id: 'b', zoneIndex: 2, progress: 0.2, heartRate: 160 }),
      entry({ id: 'c', zoneIndex: 1, progress: 0.9, heartRate: 130 }),
      entry({ id: 'd', zoneIndex: 1, progress: 0.9, heartRate: 130 }), // tie with c on 3 keys; id breaks
      entry({ id: 'e', zoneIndex: 0, progress: 0,   heartRate: 70  }),
    ];
    const sorted1 = [...entries].sort(compareLegendEntries).map(e => e.id);
    const sorted2 = [...entries].reverse().sort(compareLegendEntries).map(e => e.id);
    expect(sorted1).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(sorted2).toEqual(sorted1);
  });
});
```

- [ ] **Step 2: Run the tests — expect all 6 to FAIL with module-not-found / export-not-found**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/legend-sort.test.mjs`

Expected: 6 failing tests. The failure mode is `compareLegendEntries is not a function` or `SyntaxError: The requested module '...sort.js' does not provide an export named 'compareLegendEntries'`.

- [ ] **Step 3: Commit the failing tests**

```bash
cd /opt/Code/DaylightStation
git add tests/unit/fitness/legend-sort.test.mjs
git commit -m "test(fitness): failing tests for compareLegendEntries (HR zone progress sort)"
```

---

## Task 2: Implement `compareLegendEntries` (GREEN)

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/layout/utils/sort.js`

- [ ] **Step 1: Append the new exported comparator to `sort.js`**

Open `frontend/src/modules/Fitness/widgets/FitnessChart/layout/utils/sort.js`. Leave the existing `compareAvatars` export untouched. Append after line 28:

```js

/**
 * Comparator for the FitnessChart legend / roster list (Issue B).
 *
 * Sorts participants so that, within a given HR zone, the user furthest
 * through the zone (higher `progress` 0..1) appears first. This diverges
 * from raw-HR sort because each user has different per-user zone
 * thresholds (e.g. two users at 140 BPM can be 80% vs 20% through "Warm").
 *
 * Keys (all descending unless noted):
 *   1. zoneIndex  — higher zone (e.g. On Fire > Warm > Cool) first
 *   2. progress   — further through the current zone first (0..1)
 *   3. heartRate  — raw HR, tiebreak within same progress
 *   4. id         — ASC, deterministic final tiebreak
 *
 * Missing fields are treated as 0 so offline users (no live HR data)
 * fall to the bottom of their zone, then to the bottom overall.
 *
 * @param {{id?: string, zoneIndex?: number, progress?: number, heartRate?: number}} a
 * @param {{id?: string, zoneIndex?: number, progress?: number, heartRate?: number}} b
 * @returns {number}
 */
export const compareLegendEntries = (a, b) => {
  const za = Number.isFinite(a?.zoneIndex) ? a.zoneIndex : 0;
  const zb = Number.isFinite(b?.zoneIndex) ? b.zoneIndex : 0;
  if (za !== zb) return zb - za;

  const pa = Number.isFinite(a?.progress) ? a.progress : 0;
  const pb = Number.isFinite(b?.progress) ? b.progress : 0;
  if (pa !== pb) return pb - pa;

  const ha = Number.isFinite(a?.heartRate) ? a.heartRate : 0;
  const hb = Number.isFinite(b?.heartRate) ? b.heartRate : 0;
  if (ha !== hb) return hb - ha;

  const ida = a?.id || '';
  const idb = b?.id || '';
  return ida.localeCompare(idb);
};
```

- [ ] **Step 2: Run tests — all 6 should PASS**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/legend-sort.test.mjs`

Expected: 6 passing tests.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/widgets/FitnessChart/layout/utils/sort.js
git commit -m "feat(fitness): add compareLegendEntries for HR zone progress sort"
```

---

## Task 3: Surface `zoneIndex` on participantDisplayMap entries (RED → GREEN)

**Files:**
- Modify: `tests/isolated/domain/fitness/legacy/participant-display-map.unit.test.mjs`
- Modify: `frontend/src/hooks/fitness/participantDisplayMap.js`

- [ ] **Step 1: Add a failing test for `zoneIndex` in the existing display-map test file**

Open `tests/isolated/domain/fitness/legacy/participant-display-map.unit.test.mjs`. Inside the top-level `describe('buildParticipantDisplayMap', ...)` block, immediately after the first `test(...)` block (after the closing `});` on line 44), add:

```js
  test('surfaces zoneIndex from profile.zoneSnapshot for sort keys', () => {
    const profiles = [
      {
        id: 'warm-user',
        name: 'Warm User',
        displayName: 'Warm User',
        heartRate: 140,
        currentZoneId: 'warm',
        currentZoneColor: '#eab308',
        progress: 0.8,
        zoneSnapshot: { zoneIndex: 2 }
      }
    ];
    const roster = [{ id: 'warm-user', name: 'Warm User' }];
    const map = buildParticipantDisplayMap(profiles, roster);
    const entry = map.get('warm user');
    expect(entry).toBeDefined();
    expect(entry.zoneIndex).toBe(2);
    expect(entry.progress).toBe(0.8);
  });

  test('falls back to null zoneIndex when zoneSnapshot is missing', () => {
    const profiles = [
      { id: 'no-snap', name: 'No Snap', displayName: 'No Snap', progress: null }
    ];
    const roster = [{ id: 'no-snap', name: 'No Snap' }];
    const map = buildParticipantDisplayMap(profiles, roster);
    const entry = map.get('no snap');
    expect(entry).toBeDefined();
    expect(entry.zoneIndex).toBeNull();
  });
```

- [ ] **Step 2: Run the display-map tests — expect the 2 new tests to FAIL**

Run: `cd /opt/Code/DaylightStation && npx jest tests/isolated/domain/fitness/legacy/participant-display-map.unit.test.mjs`

Expected: the 2 new tests fail with `expect(received).toBe(expected) // Expected: 2 / Received: undefined`. Existing tests still pass.

- [ ] **Step 3: Commit the failing tests**

```bash
cd /opt/Code/DaylightStation
git add tests/isolated/domain/fitness/legacy/participant-display-map.unit.test.mjs
git commit -m "test(fitness): failing tests for zoneIndex on participantDisplayMap entries"
```

- [ ] **Step 4: Implement — add `zoneIndex` to the returned entry**

Open `frontend/src/hooks/fitness/participantDisplayMap.js`. In `buildEntry` (lines 31-52), add the `zoneIndex` field. Replace lines 37-51 with:

```js
    return {
      id: profile?.id || resolvedProfileId || id,
      displayName: profile?.displayName || profile?.name || rosterEntry?.displayLabel || rosterEntry?.name || id,
      avatarSrc,
      heartRate: profile?.heartRate ?? rosterEntry?.heartRate ?? null,
      zoneId: profile?.currentZoneId || rosterEntry?.zoneId || null,
      zoneName: profile?.currentZoneName || null,
      zoneColor: profile?.currentZoneColor || rosterEntry?.zoneColor || null,
      zoneIndex: Number.isFinite(profile?.zoneSnapshot?.zoneIndex)
        ? profile.zoneSnapshot.zoneIndex
        : null,
      progress: profile?.progress ?? null,
      targetHeartRate: profile?.targetHeartRate ?? null,
      zoneSequence: profile?.zoneSequence || [],
      groupLabel: profile?.groupLabel || rosterEntry?.groupLabel || null,
      source: profile ? (profile.source || 'profile') : 'roster',
      updatedAt: profile?.updatedAt || null
    };
```

- [ ] **Step 5: Run tests — all should PASS**

Run: `cd /opt/Code/DaylightStation && npx jest tests/isolated/domain/fitness/legacy/participant-display-map.unit.test.mjs`

Expected: all 7 tests pass (5 existing + 2 new).

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/hooks/fitness/participantDisplayMap.js
git commit -m "feat(fitness): surface zoneIndex on participantDisplayMap entries"
```

---

## Task 4: Wire legend to use `compareLegendEntries` (sort filterEntries)

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx`

Because `filterEntries` in the chart is built from `allEntries`, and `allEntries` does NOT currently carry `zoneIndex`/`progress`/`heartRate` on the entry, we need to pull those from `participantDisplayMap` for each entry at sort time. The chart already gets `participantDisplayMap` via `useFitnessContext` on the context consumer side.

- [ ] **Step 1: Add the import for the comparator** — find the existing layout import (around line 15) and add:

```jsx
import { compareLegendEntries } from './layout/utils/sort.js';
```

- [ ] **Step 2: Pull `participantDisplayMap` and `sessionParticipantsMeta` from `useFitnessModule`** — change the destructure block at lines 739-748 to add:

```jsx
		participantDisplayMap,     // SSoT for name/avatar/progress/zoneIndex per participant
		sessionParticipantsMeta    // Persisted session meta (for offline hydration — Issue A)
```

- [ ] **Step 3: Expose `participantDisplayMap` and `sessionParticipantsMeta` from `useFitnessModule.js`** — open `frontend/src/modules/Fitness/player/useFitnessModule.js`. After line 94 (`userVitalsMap: fitnessCtx.userVitals,`), add:

```js
    participantDisplayMap: fitnessCtx.participantDisplayMap,
    sessionParticipantsMeta: fitnessCtx.sessionParticipantsMeta,
```

- [ ] **Step 4: Expose `sessionParticipantsMeta` from `FitnessContext.jsx`** — `participantDisplayMap` is already exported (line 2258). Add `sessionParticipantsMeta`. After line 1495 (the existing displayMap memo), insert:

```jsx

  // Persisted session participants metadata — used by the FitnessChart legend
  // to hydrate names/avatars for offline (historical) participants whose live
  // ZoneProfileStore profile is gone.
  const sessionParticipantsMeta = React.useMemo(() => {
    const meta = session?.snapshot?.usersMeta;
    if (!(meta instanceof Map)) return new Map();
    return meta;
  }, [session, version]);
```

Then in the returned context value, after line 2258 (`participantDisplayMap,`), add:

```jsx
    sessionParticipantsMeta,
```

- [ ] **Step 5: Rewrite the `filterEntries` memo** — find lines 1179-1187 and replace with:

```jsx
	const filterEntries = useMemo(() => {
		if (allEntries.length <= 1) return [];
		const slugify = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
		const enriched = allEntries.map(entry => {
			const displayEntry = participantDisplayMap?.get(slugify(entry.id))
				|| participantDisplayMap?.get(slugify(entry.profileId))
				|| participantDisplayMap?.get(slugify(entry.name))
				|| null;
			return {
				id: entry.id,
				name: entry.name || 'Unknown',
				color: entry.color || '#9ca3af',
				avatarUrl: entry.avatarUrl,
				zoneIndex: displayEntry?.zoneIndex ?? null,
				progress: displayEntry?.progress ?? null,
				heartRate: displayEntry?.heartRate ?? null,
			};
		});
		enriched.sort(compareLegendEntries);
		return enriched;
	}, [allEntries, participantDisplayMap]);
```

- [ ] **Step 6: Run tests** — `npx jest tests/unit/fitness/legend-sort.test.mjs tests/isolated/domain/fitness/legacy/participant-display-map.unit.test.mjs` — expect green.

- [ ] **Step 7: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx \
        frontend/src/modules/Fitness/player/useFitnessModule.js \
        frontend/src/context/FitnessContext.jsx
git commit -m "feat(fitness): sort FitnessChart legend by HR zone progress"
```

---

## Task 5: Hydrate offline legend entries from session metadata (RED)

**Files:**
- Create: `tests/unit/fitness/legend-hydration.test.mjs`

- [ ] **Step 1: Create the new failing test file**

Create `tests/unit/fitness/legend-hydration.test.mjs` with:

```js
// tests/unit/fitness/legend-hydration.test.mjs
import { describe, it, expect } from '@jest/globals';
import { resolveHistoricalParticipant } from '#frontend/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx';

describe('resolveHistoricalParticipant', () => {
  it('returns displayMap entry when it has a non-slug displayName', () => {
    const displayMap = new Map([
      ['kckern', { displayName: 'KC Kern', avatarSrc: '/avatars/kc.png', id: 'kckern' }]
    ]);
    const sessionMeta = new Map();
    const out = resolveHistoricalParticipant('kckern', { displayMap, sessionMeta });
    expect(out.name).toBe('KC Kern');
    expect(out.avatarUrl).toBe('/avatars/kc.png');
    expect(out.profileId).toBe('kckern');
  });

  it('falls back to sessionMeta when displayMap misses', () => {
    const displayMap = new Map();
    const sessionMeta = new Map([['alan', { name: 'alan', displayName: 'Alan' }]]);
    const out = resolveHistoricalParticipant('alan', { displayMap, sessionMeta });
    expect(out.name).toBe('Alan');
    expect(out.avatarUrl).toContain('/static/img/users/alan');
    expect(out.profileId).toBe('alan');
  });

  it('prefers sessionMeta.name when sessionMeta.displayName is missing', () => {
    const displayMap = new Map();
    const sessionMeta = new Map([['felix', { name: 'Felix' }]]);
    const out = resolveHistoricalParticipant('felix', { displayMap, sessionMeta });
    expect(out.name).toBe('Felix');
  });

  it('falls back to capitalized slug when neither displayMap nor sessionMeta has info', () => {
    const displayMap = new Map();
    const sessionMeta = new Map();
    const out = resolveHistoricalParticipant('milo', { displayMap, sessionMeta });
    expect(out.name).toBe('Milo');
    expect(out.avatarUrl).toContain('/static/img/users/milo');
    expect(out.profileId).toBe('milo');
  });

  it('returns raw slug when slug is a single character', () => {
    const out = resolveHistoricalParticipant('x', { displayMap: new Map(), sessionMeta: new Map() });
    expect(out.name).toBe('X');
  });

  it('handles missing/null slug gracefully', () => {
    const out = resolveHistoricalParticipant(null, { displayMap: new Map(), sessionMeta: new Map() });
    expect(out.name).toBe('Unknown');
    expect(out.profileId).toBe(null);
  });

  it('prefers displayMap over sessionMeta when both present', () => {
    const displayMap = new Map([['alan', { displayName: 'Alan B.', avatarSrc: '/dm/alan.png', id: 'alan' }]]);
    const sessionMeta = new Map([['alan', { displayName: 'Alan (session)' }]]);
    const out = resolveHistoricalParticipant('alan', { displayMap, sessionMeta });
    expect(out.name).toBe('Alan B.');
    expect(out.avatarUrl).toBe('/dm/alan.png');
  });
});
```

- [ ] **Step 2: Run — expect all 7 to FAIL**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/legend-hydration.test.mjs`

Expected: all 7 fail with `does not provide an export named 'resolveHistoricalParticipant'`.

- [ ] **Step 3: Commit failing tests**

```bash
cd /opt/Code/DaylightStation
git add tests/unit/fitness/legend-hydration.test.mjs
git commit -m "test(fitness): failing tests for offline participant hydration helper"
```

---

## Task 6: Implement `resolveHistoricalParticipant` + apply in chart (GREEN)

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx`

- [ ] **Step 1: Add the exported helper near other top-level helpers** — after `slugifyId` (line 28-36), insert:

```jsx

/**
 * Resolve an offline (historical) participant's display fields.
 *
 * Resolution chain (first non-empty wins):
 *   1. participantDisplayMap.get(slug) — live zone-profile-backed display
 *   2. sessionParticipantsMeta.get(slug) — persisted session metadata
 *   3. Capitalized slug as last resort
 *
 * @param {string} slug
 * @param {{ displayMap?: Map, sessionMeta?: Map }} sources
 * @returns {{ name: string, avatarUrl: string|null, profileId: string|null }}
 */
export const resolveHistoricalParticipant = (slug, sources = {}) => {
	if (!slug || typeof slug !== 'string') {
		return { name: 'Unknown', avatarUrl: null, profileId: null };
	}
	const key = slug.trim().toLowerCase();
	const displayMap = sources.displayMap instanceof Map ? sources.displayMap : null;
	const sessionMeta = sources.sessionMeta instanceof Map ? sources.sessionMeta : null;

	const dmEntry = displayMap?.get(key) || null;
	const metaEntry = sessionMeta?.get(slug) || sessionMeta?.get(key) || null;

	const capSlug = key.charAt(0).toUpperCase() + key.slice(1);

	const dmName = dmEntry?.displayName;
	const dmNameIsReal = dmName && String(dmName).trim().toLowerCase() !== key;
	let name = capSlug;
	if (dmNameIsReal) name = dmName;
	else if (metaEntry?.displayName && String(metaEntry.displayName).trim()) name = metaEntry.displayName;
	else if (metaEntry?.name && String(metaEntry.name).trim()) name = metaEntry.name;

	const avatarUrl = dmEntry?.avatarSrc || `/static/img/users/${key}`;

	return {
		name,
		avatarUrl,
		profileId: dmEntry?.id || slug
	};
};
```

- [ ] **Step 2: Run hydration tests — all 7 should PASS**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/legend-hydration.test.mjs`

Expected: all 7 pass.

- [ ] **Step 3: Thread the resolver into `useRaceChartWithHistory`** — Replace the signature at line 283 with:

```jsx
const useRaceChartWithHistory = (roster, getSeries, timebase, historicalParticipantIds = [], options = {}) => {
	const { activityMonitor, zoneConfig, sessionId, resolveHistorical } = options;
	const { entries: presentEntries } = useRaceChartData(roster, getSeries, timebase, { activityMonitor, zoneConfig });
```

In the historical-entry build inside `setParticipantCache` (lines 355-371), replace the historical-entry literal with:

```jsx
				const hydrated = typeof resolveHistorical === 'function'
					? resolveHistorical(slug)
					: { name: slug, avatarUrl: null, profileId: slug };
				next[slug] = {
					id: slug,
					name: hydrated.name || slug,
					profileId: hydrated.profileId || slug,
					avatarUrl: hydrated.avatarUrl || null,
					color: getZoneColor(null),
					beats,
					segments,
					zones,
					active,
					maxVal,
					lastIndex,
					lastSeenTick: lastIndex,
					lastValue,
					status: ParticipantStatus.REMOVED,
					absentSinceTick: lastIndex
				};
```

- [ ] **Step 4: Wire the resolver from FitnessChart down** — find lines 810-819 and replace with:

```jsx
	const resolveHistorical = useCallback((slug) => {
		return resolveHistoricalParticipant(slug, {
			displayMap: participantDisplayMap,
			sessionMeta: sessionParticipantsMeta
		});
	}, [participantDisplayMap, sessionParticipantsMeta]);

	const { allEntries, presentEntries, absentEntries, dropoutMarkers, maxValue, maxIndex } = useRaceChartWithHistory(
		chartParticipants,
		chartGetSeries,
		chartTimebase,
		chartHistorical,
		{ activityMonitor: chartActivityMonitor, zoneConfig: chartZoneConfig, sessionId: chartSessionId, resolveHistorical }
	);
```

- [ ] **Step 5: Run both new test files** — `npx jest tests/unit/fitness/legend-hydration.test.mjs tests/unit/fitness/legend-sort.test.mjs`. Expect 14 passing.

- [ ] **Step 6: Run broader fitness suite** — `npx jest tests/unit/fitness/ tests/isolated/domain/fitness/legacy/`. Expect green (no regressions).

- [ ] **Step 7: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx
git commit -m "fix(fitness): hydrate offline legend entries from session meta + displayMap"
```

---

## Task 7: End-to-end validation against a real multi-participant session

- [ ] **Step 1: Confirm session YAML carries `display_name` for all participants**

Run:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/history/fitness/2026-04-20/20260420193931.yml' | head -25
```

Expected: `participants:` block shows `display_name:` for all four entries (`kckern`, `alan`, `felix`, `milo`).

- [ ] **Step 2: Load a historical session in the UI and verify legend behavior**

Open the DaylightStation UI, navigate to the Fitness history view, open the session above. Verify:
1. The legend shows `KC Kern`, `Alan`, `Felix`, `Milo` with avatars — NOT raw slugs like `kckern` with no avatar.
2. Within an HR zone, sort tracks progress, not raw HR (live data only — historical view falls back to heartRate DESC / id ASC since `progress` is null).

- [ ] **Step 3: Final test sweep**

```bash
cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/legend-sort.test.mjs tests/unit/fitness/legend-hydration.test.mjs tests/isolated/domain/fitness/legacy/participant-display-map.unit.test.mjs
```

Expected: 21 tests pass total.

---

## Done

- **Issue A — User hydration:** Legend now resolves offline participants via `participantDisplayMap` + `sessionParticipantsMeta` instead of raw slugs. New helper `resolveHistoricalParticipant` exported from `FitnessChart.jsx` and unit-tested.
- **Issue B — HR zone sort:** New `compareLegendEntries` in `layout/utils/sort.js` sorts by `zoneIndex DESC → progress DESC → heartRate DESC → id ASC`. `compareAvatars` (chart positioning) unchanged.
- **Enabling changes:** `participantDisplayMap` carries `zoneIndex`; `FitnessContext` exposes `sessionParticipantsMeta`; `useFitnessModule` forwards both.
- **Tests:** 7 sort + 7 hydration + 2 display-map = 16 new test cases.
