# Fitness Participant Sort SSOT Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make participant ordering correct and single-sourced, by keying zone-progress lookups on stable profile IDs instead of display names and collapsing the four divergent sort/lookup implementations into one domain-layer SSOT.

**Architecture:** Three new/repaired domain pieces — a `zoneProgressIndex` module (multi-alias lookup, ID-first precedence), a repaired `sortByZoneRank` (currently dead code that reads the wrong zone field), and `ParticipantFactory.fromRosterEntry` carrying `rawZoneId` + `zoneProgress` onto the entity. `FitnessContext` then sorts **once** so `activeHeartRateParticipants` is delivered pre-sorted; every consumer inherits the order and the inline comparator in `FitnessUsers.jsx` is deleted.

**Tech Stack:** React 18, Vitest (config at repo root `vitest.config.mjs`, `@` → `frontend/src`), plain ES modules in the Fitness domain layer.

---

## Background: the bug this fixes

Observed on the garage kiosk (2026-07-21): Felix at 127 BPM sorted **above** Dad at 115 BPM, even though both cards showed the same `ACTIVE` zone badge and Dad's progress bar rendered visibly fuller (≈2/3 through active vs Felix's ≈1/3). The card display was right; the sort was wrong.

**Root cause — a name-keyed lookup that misses whenever group labels are active:**

1. `userZoneProgress` is keyed **only** by `entry.name`, the user's given name — `FitnessContext.jsx:2116` (`progressMap.set(entry.name, {...})`). The value object it stores has no `name` field, so the back-compat aliasing branch in `FitnessUsers.jsx:351-356` (`if (value?.name)`) never fires. One key per user, and it's the given name.
2. The sort resolves its lookup key via `resolveCanonicalUserName(a.deviceId)` — `FitnessUsers.jsx:628-629` → `getDisplayName(deviceId).displayName` (`:407-411`).
3. `resolveDisplayName`'s **first** priority rule is the group label — `frontend/src/lib/userDisplayName.js:30-33`, matching when `ctx.preferGroupLabels && ctx.ownership?.groupLabel`.
4. `preferGroupLabels` is true whenever 2+ HR devices are present (`FitnessContext.jsx:1584`). The context's own comment at `:1933-1934` names the exact case: *"nickname (\"Dad\") only when 2+ HR participants are present, else the given name."*

So with two riders on, the sort asks for `"Dad"`, the map only holds the given name, `lookupZoneProgress` is a bare `Map.get` with no fallback (`:368-371`), and `?? 0` (`:630-631`) silently pins Dad's progress to **0**. Felix (a kid, no `group_label`) resolves name-to-name and keeps his real 0.33. Zone rank ties, so progress decides: 0.33 > 0 → Felix on top.

The card display path avoids this only by accident — it tries `participantEntry?.name` **first** through a 5-deep fallback chain (`:912-924`), which hits the given name. Two code paths, two resolution chains, silent disagreement.

**Why it's invisible:** the miss degrades to `0` with no log. It also cannot reproduce with a single rider, because `preferGroupLabels` is false then.

### The four divergent implementations being collapsed

| # | Location | What it does |
|---|---|---|
| 1 | `FitnessUsers.jsx:621-637` | Live inline HR comparator (the one in use) |
| 2 | `ParticipantFactory.js:178-197` | `sortByZoneRank` — identical intent, **zero importers**, and reads committed `zoneId` + a `zoneProgress` that is never populated (`:82` reads `rosterEntry.zoneProgress`, which `ParticipantRoster` never emits) |
| 3 | `FitnessUsers.jsx:344-366` | `userZoneProgress` Map-or-object normalization |
| 4 | `SidebarFooter.jsx:165-169` + `FullscreenVitalsOverlay.jsx:119-123` | Two more, differently-written normalizations of the same input |

### Deliberately preserved

Sorting continues to read the **raw/live** zone, not the hysteresis-smoothed committed zone. That is an intentional documented choice (`FitnessUsers.jsx:607-620`) so card color, progress fill, and order track HR together. Hysteresis stays in force for governance. Do not "fix" this.

---

## Task 0: Set up an isolated worktree

The current branch `feature/ds6878-spp` carries unrelated in-flight work (DS6878 SPP relay, portal-keys). Do not build on it.

**Step 1: Confirm the deploy tree isn't ahead**

Per `CLAUDE.local.md`, local git is often behind the homeserver deploy tree. Run:

```bash
git fetch origin
ssh homeserver.local 'cd /opt/Code/DaylightStation && git branch --show-current && git log --oneline origin/main..HEAD | head'
```

Expected: no unpushed commits touching `frontend/src/modules/Fitness/` or `frontend/src/context/FitnessContext.jsx`. If there are, integrate them before proceeding.

**Step 2: Create the worktree**

REQUIRED SUB-SKILL: Use superpowers:using-git-worktrees.

```bash
git worktree add .worktrees/fitness-sort-ssot -b feature/fitness-sort-ssot main
cd .worktrees/fitness-sort-ssot
ln -s ../../node_modules node_modules
```

Expected: `node_modules` symlink resolves; `npx vitest --version` prints a version.

Note: `vitest.config.mjs:56-62` excludes `.worktrees/**` from glob runs, so pass explicit test paths (every command below does).

---

## Task 1: Zone-progress index module (the lookup SSOT)

Replaces implementations #3 and #4 and fixes the name-key miss. ID-first precedence in three passes, so a group label can never shadow a profile ID.

**Files:**
- Create: `frontend/src/modules/Fitness/domain/zoneProgressIndex.js`
- Test: `frontend/src/modules/Fitness/domain/zoneProgressIndex.test.js`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { buildZoneProgressIndex, lookupZoneProgress } from './zoneProgressIndex.js';

// Mirrors FitnessContext userVitalsMap: keyed by user.id, value carries
// name (given name) + displayLabel (group label when preferGroupLabels).
const VITALS = new Map([
  ['user_1', { name: 'Kevin', displayLabel: 'Dad', progress: 0.66, profileId: 'user_1' }],
  ['user_4', { name: 'Felix', displayLabel: 'Felix', progress: 0.33, profileId: 'user_4' }],
]);

describe('buildZoneProgressIndex', () => {
  it('indexes by profileId', () => {
    const index = buildZoneProgressIndex(VITALS);
    expect(index.get('user_1').progress).toBe(0.66);
  });

  it('indexes by given name', () => {
    const index = buildZoneProgressIndex(VITALS);
    expect(index.get('Kevin').progress).toBe(0.66);
  });

  it('REGRESSION: indexes by group-label displayLabel', () => {
    // The 2026-07-21 sidebar-sort bug: the sort asked for "Dad" and got nothing.
    const index = buildZoneProgressIndex(VITALS);
    expect(index.get('Dad').progress).toBe(0.66);
  });

  it('gives profileId precedence when a display label collides with another id', () => {
    const colliding = new Map([
      ['Dad', { name: 'Someone', displayLabel: 'Someone', progress: 0.1, profileId: 'Dad' }],
      ['user_1', { name: 'Kevin', displayLabel: 'Dad', progress: 0.66, profileId: 'user_1' }],
    ]);
    const index = buildZoneProgressIndex(colliding);
    expect(index.get('Dad').progress).toBe(0.1); // the real id wins
  });

  it('accepts a plain object as well as a Map', () => {
    const index = buildZoneProgressIndex({ user_1: { name: 'Kevin', progress: 0.5 } });
    expect(index.get('Kevin').progress).toBe(0.5);
  });

  it('returns an empty index for null/undefined', () => {
    expect(buildZoneProgressIndex(null).size).toBe(0);
    expect(buildZoneProgressIndex(undefined).size).toBe(0);
  });

  it('skips blank and whitespace-only aliases', () => {
    const index = buildZoneProgressIndex(new Map([['u', { name: '   ', progress: 0.2, profileId: 'u' }]]));
    expect(index.has('')).toBe(false);
    expect(index.get('u').progress).toBe(0.2);
  });
});

describe('lookupZoneProgress', () => {
  it('tries keys in order and returns the first hit', () => {
    const index = buildZoneProgressIndex(VITALS);
    const hit = lookupZoneProgress(index, { profileId: 'user_1', name: 'Kevin' });
    expect(hit.progress).toBe(0.66);
  });

  it('falls through a missing profileId to the name', () => {
    const index = buildZoneProgressIndex(VITALS);
    expect(lookupZoneProgress(index, { profileId: 'nope', name: 'Felix' }).progress).toBe(0.33);
  });

  it('returns null when nothing matches', () => {
    const index = buildZoneProgressIndex(VITALS);
    expect(lookupZoneProgress(index, { profileId: 'ghost' })).toBeNull();
  });

  it('returns null for a null index', () => {
    expect(lookupZoneProgress(null, { profileId: 'user_1' })).toBeNull();
  });
});
```

**Step 2: Run it to verify it fails**

```bash
npx vitest run frontend/src/modules/Fitness/domain/zoneProgressIndex.test.js
```

Expected: FAIL — `Failed to resolve import "./zoneProgressIndex.js"`.

**Step 3: Write the implementation**

```javascript
/**
 * zoneProgressIndex — SSOT for resolving a participant's zone-progress entry.
 *
 * Why this exists (2026-07-21 sidebar-sort bug): `userZoneProgress` was keyed
 * ONLY by the user's given name, while the sidebar sort looked entries up by
 * DISPLAY name. `resolveDisplayName` returns the group label ("Dad") first
 * whenever 2+ HR participants are present (userDisplayName.js:30-33), so every
 * lookup for a user with a `group_label` missed and silently degraded to
 * progress 0 — mis-ordering the roster whenever more than one rider was on.
 *
 * The fix is to index every alias a caller might hold, with stable IDs taking
 * precedence over human-facing strings, and to give callers one lookup helper
 * instead of four hand-rolled ones.
 *
 * @module Fitness/domain/zoneProgressIndex
 */

/**
 * Build a lookup index from a userVitals collection.
 *
 * Aliases are added in three passes so precedence is deterministic regardless
 * of iteration order: profile IDs (stable, never a display string) > given
 * names > display labels (group labels like "Dad", which can legitimately
 * collide across users). First writer wins within a pass.
 *
 * @param {Map<string, Object>|Object|null} userVitals - keyed by profile ID
 * @returns {Map<string, Object>} alias → progress entry
 */
export const buildZoneProgressIndex = (userVitals) => {
  const index = new Map();
  if (!userVitals) return index;

  const raw = [];
  if (userVitals instanceof Map) {
    userVitals.forEach((value, key) => { if (value) raw.push([key, value]); });
  } else if (typeof userVitals === 'object') {
    Object.entries(userVitals).forEach(([key, value]) => { if (value) raw.push([key, value]); });
  }

  // Normalize once so every alias points at the same object identity.
  const entries = raw.map(([key, vitals]) => ({
    ...vitals,
    profileId: vitals.profileId ?? key ?? null,
  }));

  const addAlias = (key, value) => {
    if (key == null) return;
    const normalized = String(key).trim();
    if (!normalized || index.has(normalized)) return;
    index.set(normalized, value);
  };

  entries.forEach((entry) => addAlias(entry.profileId, entry));
  entries.forEach((entry) => addAlias(entry.name, entry));
  entries.forEach((entry) => addAlias(entry.displayLabel, entry));

  return index;
};

/**
 * Resolve a progress entry from any identifier a caller happens to hold.
 *
 * @param {Map<string, Object>|null} index - from buildZoneProgressIndex
 * @param {Object|Array} keys - { profileId, id, name, displayLabel, deviceId } or an ordered array
 * @returns {Object|null}
 */
export const lookupZoneProgress = (index, keys) => {
  if (!index || !keys) return null;

  const candidates = Array.isArray(keys)
    ? keys
    : [keys.profileId, keys.id, keys.name, keys.displayLabel, keys.deviceId];

  for (const candidate of candidates) {
    if (candidate == null) continue;
    const hit = index.get(String(candidate).trim());
    if (hit) return hit;
  }
  return null;
};

export default { buildZoneProgressIndex, lookupZoneProgress };
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run frontend/src/modules/Fitness/domain/zoneProgressIndex.test.js
```

Expected: PASS, 12 tests.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/domain/zoneProgressIndex.js \
        frontend/src/modules/Fitness/domain/zoneProgressIndex.test.js
git commit -m "feat(fitness): add zoneProgressIndex SSOT with ID-first alias precedence"
```

---

## Task 2: Repair `sortByZoneRank` into the sorting SSOT

`sortByZoneRank` already exists with the right intent but has two defects that would make it wrong the moment anything imported it: it reads the **committed** `zoneId` (should be raw/live), and its rank map is a caller-supplied default of `{}` so every zone ranks `-1`.

**Files:**
- Modify: `frontend/src/modules/Fitness/domain/ParticipantFactory.js:178-197` and the export block at `:221-229`
- Test: `frontend/src/modules/Fitness/domain/participantSort.test.js`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { sortByZoneRank, ZONE_RANK_MAP } from './ParticipantFactory.js';

const p = (over) => ({
  id: 'p', name: 'p', rawZoneId: 'active', zoneProgress: 0, isActive: true, ...over,
});

describe('ZONE_RANK_MAP', () => {
  it('ranks the five canonical zones coolest to hottest', () => {
    expect(ZONE_RANK_MAP).toEqual({ cool: 0, active: 1, warm: 2, hot: 3, fire: 4 });
  });
});

describe('sortByZoneRank', () => {
  it('REGRESSION 2026-07-21: within one zone, higher progress wins regardless of raw BPM', () => {
    // Felix 127 BPM @ 1/3 through active; Dad 115 BPM @ 2/3 through active.
    // Dad must be on top — the sidebar showed the reverse when Dad's progress
    // lookup missed on his group label and degraded to 0.
    const felix = p({ id: 'user_4', name: 'Felix', zoneProgress: 0.33, heartRate: 127 });
    const dad = p({ id: 'user_1', name: 'Kevin', zoneProgress: 0.66, heartRate: 115 });
    expect(sortByZoneRank([felix, dad]).map((x) => x.id)).toEqual(['user_1', 'user_4']);
  });

  it('ranks a hotter zone above a cooler one regardless of progress', () => {
    const warmLow = p({ id: 'warm', rawZoneId: 'warm', zoneProgress: 0.01 });
    const activeHigh = p({ id: 'active', rawZoneId: 'active', zoneProgress: 0.99 });
    expect(sortByZoneRank([activeHigh, warmLow]).map((x) => x.id)).toEqual(['warm', 'active']);
  });

  it('sorts on the RAW zone, not the hysteresis-smoothed committed zone', () => {
    // Committed zone would order these backwards; raw must win.
    const a = p({ id: 'a', rawZoneId: 'hot', zoneId: 'cool' });
    const b = p({ id: 'b', rawZoneId: 'cool', zoneId: 'hot' });
    expect(sortByZoneRank([b, a]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('falls back to committed zoneId when rawZoneId is absent', () => {
    const a = p({ id: 'a', rawZoneId: null, zoneId: 'fire' });
    const b = p({ id: 'b', rawZoneId: null, zoneId: 'cool' });
    expect(sortByZoneRank([b, a]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('sinks zoneless participants to the bottom', () => {
    const none = p({ id: 'none', rawZoneId: null, zoneId: null });
    const cool = p({ id: 'cool', rawZoneId: 'cool' });
    expect(sortByZoneRank([none, cool]).map((x) => x.id)).toEqual(['cool', 'none']);
  });

  it('is case-insensitive on zone ids', () => {
    const a = p({ id: 'a', rawZoneId: 'FIRE' });
    const b = p({ id: 'b', rawZoneId: 'cool' });
    expect(sortByZoneRank([b, a]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('breaks progress ties with active before inactive', () => {
    const inactive = p({ id: 'inactive', isActive: false, zoneProgress: 0.5 });
    const active = p({ id: 'active', isActive: true, zoneProgress: 0.5 });
    expect(sortByZoneRank([inactive, active]).map((x) => x.id)).toEqual(['active', 'inactive']);
  });

  it('is deterministic on a total tie, via id', () => {
    const b = p({ id: 'bbb' });
    const a = p({ id: 'aaa' });
    expect(sortByZoneRank([b, a]).map((x) => x.id)).toEqual(['aaa', 'bbb']);
  });

  it('treats a null/NaN zoneProgress as 0 rather than throwing', () => {
    const nullProg = p({ id: 'null', zoneProgress: null });
    const real = p({ id: 'real', zoneProgress: 0.2 });
    expect(sortByZoneRank([nullProg, real]).map((x) => x.id)).toEqual(['real', 'null']);
  });

  it('does not mutate the input array', () => {
    const input = [p({ id: 'b', zoneProgress: 0.1 }), p({ id: 'a', zoneProgress: 0.9 })];
    const before = input.map((x) => x.id);
    sortByZoneRank(input);
    expect(input.map((x) => x.id)).toEqual(before);
  });

  it('returns an empty array for a non-array input', () => {
    expect(sortByZoneRank(null)).toEqual([]);
  });
});
```

**Step 2: Run it to verify it fails**

```bash
npx vitest run frontend/src/modules/Fitness/domain/participantSort.test.js
```

Expected: FAIL — `ZONE_RANK_MAP` is not exported; the raw-zone and null-input tests fail.

**Step 3: Replace `sortByZoneRank` (`ParticipantFactory.js:171-197`)**

```javascript
/**
 * Canonical zone ranking, coolest → hottest.
 *
 * SSOT: previously duplicated as CONFIG.zone.rankMap in FitnessUsers.jsx.
 * Import this instead of redeclaring it.
 */
export const ZONE_RANK_MAP = Object.freeze({ cool: 0, active: 1, warm: 2, hot: 3, fire: 4 });

/**
 * Rank a participant by their LIVE zone.
 *
 * Deliberately prefers `rawZoneId` over the committed `zoneId`: the committed
 * zone is hysteresis-smoothed for governance stability, and using it here would
 * desync sort order from the card color and progress bar, which both render
 * live state. Hysteresis remains in force for governance decisions only.
 */
const rankOf = (participant, zoneRankMap) => {
  const zoneId = participant?.rawZoneId || participant?.zoneId || null;
  if (!zoneId) return -1;
  return zoneRankMap[String(zoneId).toLowerCase()] ?? -1;
};

/**
 * THE sort for heart-rate participants. Order: live zone rank desc →
 * progress-within-zone desc → active before inactive → id asc (determinism).
 *
 * Progress is only meaningful as a tiebreaker WITHIN a zone, since each user
 * has their own BPM ranges — see docs/_wip/plans/2026-07-21-fitness-participant-sort-ssot.md.
 *
 * @param {import('./Participant.js').Participant[]} participants
 * @param {Object} [zoneRankMap] - defaults to ZONE_RANK_MAP
 * @returns {import('./Participant.js').Participant[]} a new sorted array
 */
export const sortByZoneRank = (participants, zoneRankMap = ZONE_RANK_MAP) => {
  if (!Array.isArray(participants)) return [];

  return [...participants].sort((a, b) => {
    const aRank = rankOf(a, zoneRankMap);
    const bRank = rankOf(b, zoneRankMap);
    if (bRank !== aRank) return bRank - aRank;

    const aProgress = Number.isFinite(a?.zoneProgress) ? a.zoneProgress : 0;
    const bProgress = Number.isFinite(b?.zoneProgress) ? b.zoneProgress : 0;
    if (bProgress !== aProgress) return bProgress - aProgress;

    if (a?.isActive && !b?.isActive) return -1;
    if (!a?.isActive && b?.isActive) return 1;

    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  });
};
```

**Step 4: Add `ZONE_RANK_MAP` to the default export (`:221-229`)**

```javascript
export default {
  fromRosterEntry,
  fromRoster,
  determineActiveStatus,
  resolveZoneInfo,
  lookupZoneColor,
  sortByZoneRank,
  ZONE_RANK_MAP,
  validateParticipants
};
```

**Step 5: Run tests to verify they pass**

```bash
npx vitest run frontend/src/modules/Fitness/domain/participantSort.test.js
```

Expected: PASS, 12 tests.

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/domain/ParticipantFactory.js \
        frontend/src/modules/Fitness/domain/participantSort.test.js
git commit -m "fix(fitness): sortByZoneRank reads raw zone, ships canonical ZONE_RANK_MAP"
```

---

## Task 3: Carry `rawZoneId` and `zoneProgress` onto the Participant entity

`fromRosterEntry:82` currently reads `rosterEntry.zoneProgress`, which `ParticipantRoster` **never emits** — so it is always `null`. Populate it from the index instead. `ParticipantRoster` *does* already emit `rawZoneId`/`rawZoneColor` (`ParticipantRoster.js:698-699`); pass them through so the sort needs no ambient lookup.

**Files:**
- Modify: `frontend/src/modules/Fitness/domain/ParticipantFactory.js` (imports, `fromRosterEntry`)
- Test: `frontend/src/modules/Fitness/domain/participantFactory.zone.test.js`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { fromRosterEntry } from './ParticipantFactory.js';
import { buildZoneProgressIndex } from './zoneProgressIndex.js';

const ROSTER_ENTRY = {
  id: 'user_1',
  profileId: 'user_1',
  name: 'Kevin',
  displayLabel: 'Dad',
  hrDeviceId: '10366',
  heartRate: 115,
  zoneId: 'cool',       // committed (hysteresis-smoothed)
  rawZoneId: 'active',  // live
  rawZoneColor: '#51cf66',
  isActive: true,
};

describe('fromRosterEntry zone fields', () => {
  it('carries rawZoneId through to the entity', () => {
    expect(fromRosterEntry(ROSTER_ENTRY).rawZoneId).toBe('active');
  });

  it('normalizes rawZoneId to lowercase', () => {
    expect(fromRosterEntry({ ...ROSTER_ENTRY, rawZoneId: 'ACTIVE' }).rawZoneId).toBe('active');
  });

  it('falls back to the committed zone when rawZoneId is absent', () => {
    expect(fromRosterEntry({ ...ROSTER_ENTRY, rawZoneId: null }).rawZoneId).toBe('cool');
  });

  it('REGRESSION: resolves zoneProgress by profileId even when displayLabel is a group label', () => {
    const index = buildZoneProgressIndex(
      new Map([['user_1', { name: 'Kevin', displayLabel: 'Dad', progress: 0.66, profileId: 'user_1' }]])
    );
    expect(fromRosterEntry(ROSTER_ENTRY, { zoneProgressIndex: index }).zoneProgress).toBe(0.66);
  });

  it('leaves zoneProgress null when no index is supplied', () => {
    expect(fromRosterEntry(ROSTER_ENTRY).zoneProgress).toBeNull();
  });

  it('leaves zoneProgress null on an index miss rather than coercing to 0', () => {
    const index = buildZoneProgressIndex(new Map([['other', { name: 'Other', progress: 0.5 }]]));
    expect(fromRosterEntry(ROSTER_ENTRY, { zoneProgressIndex: index }).zoneProgress).toBeNull();
  });
});
```

Note: a miss stays `null`, not `0`. `sortByZoneRank` coerces to 0 for ordering, but keeping `null` on the entity lets Task 6 detect and log real misses.

**Step 2: Run it to verify it fails**

```bash
npx vitest run frontend/src/modules/Fitness/domain/participantFactory.zone.test.js
```

Expected: FAIL — `rawZoneId` is `undefined`; `zoneProgress` is `null` on the regression case.

**Step 3: Add the import at the top of `ParticipantFactory.js` (after `:17`)**

```javascript
import { lookupZoneProgress } from './zoneProgressIndex.js';
```

**Step 4: Destructure the new option in `fromRosterEntry` (`:41-46`)**

```javascript
  const {
    devices = [],
    zoneConfig = [],
    inactiveTimeout = DEFAULT_INACTIVE_TIMEOUT,
    getDisplayLabel,
    zoneProgressIndex = null
  } = options;
```

**Step 5: Resolve progress after `displayLabel` is computed (insert after `:68`)**

```javascript
  // Resolve zone progress by STABLE ID first. Looking this up by display name
  // is what broke the sidebar sort on 2026-07-21 — see zoneProgressIndex.js.
  const progressEntry = zoneProgressIndex
    ? lookupZoneProgress(zoneProgressIndex, {
        profileId: rosterEntry.profileId || id,
        id,
        name: rosterEntry.name,
        displayLabel,
        deviceId: rosterEntry.hrDeviceId
      })
    : null;
```

**Step 6: Replace the `zoneProgress` line (`:82`) and add the raw-zone fields**

```javascript
    zoneId,
    zoneColor,
    // Live (non-hysteresis) zone — what the cards render and what sortByZoneRank
    // ranks on. Falls back to the committed zone when the roster has no raw value.
    rawZoneId: rosterEntry.rawZoneId ? String(rosterEntry.rawZoneId).toLowerCase() : zoneId,
    rawZoneColor: rosterEntry.rawZoneColor || zoneColor,
    // null (not 0) on a miss, so Task 6's diagnostic can tell a miss from a real 0.
    zoneProgress: Number.isFinite(progressEntry?.progress) ? progressEntry.progress : null,
```

**Step 7: Run tests to verify they pass**

```bash
npx vitest run frontend/src/modules/Fitness/domain/participantFactory.zone.test.js
```

Expected: PASS, 6 tests.

**Step 8: Run the whole Fitness domain + roster suite for regressions**

```bash
npx vitest run frontend/src/modules/Fitness/domain/ frontend/src/hooks/fitness/
```

Expected: PASS. If `ParticipantRoster.*.test.js` fails, the entity shape changed under a consumer — fix before continuing, don't paper over it.

**Step 9: Commit**

```bash
git add frontend/src/modules/Fitness/domain/ParticipantFactory.js \
        frontend/src/modules/Fitness/domain/participantFactory.zone.test.js
git commit -m "feat(fitness): carry rawZoneId + id-resolved zoneProgress onto Participant"
```

---

## Task 4: Sort once in FitnessContext

Makes `activeHeartRateParticipants` pre-sorted, so ordering is a property of the SSOT selector rather than something each panel re-derives.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx` (imports; move + rewrite the `activeHeartRateParticipants` memo at `:1706-1715`; add `zoneProgressIndex` after `userVitalsMap` at `:1886`)

**⚠️ Declaration-order hazard — read before editing.** `activeHeartRateParticipants` sits at `:1706`, but `userVitalsMap` (its new dependency) is not declared until `:1848`. Referencing it in place throws a TDZ `ReferenceError` at runtime. You must **move** the memo, not just edit it. The move is safe:

- `activeHeartRateParticipants` is consumed only at `:2581` (the context value) — verify with `grep -n "activeHeartRateParticipants" frontend/src/context/FitnessContext.jsx` before and after.
- Its own deps all precede `:1886`: `participantRoster` `:1646`, `getDisplayLabel` `:1602`, plus `heartRateDevices` / `zoneConfig` / `ant_devices`.
- `userVitalsMap`'s deps all precede it too: `allUsers` `:1503`, `preferGroupLabels` `:1584`, `deviceAssignmentMap` `:1776`.

**Step 1: Add imports at the top of the file**

```javascript
import { buildZoneProgressIndex } from '@/modules/Fitness/domain/zoneProgressIndex.js';
import { sortByZoneRank } from '@/modules/Fitness/domain/ParticipantFactory.js';
```

(If `ParticipantFactory` is already imported as a namespace, use `ParticipantFactory.sortByZoneRank` instead of adding a second import.)

**Step 2: Delete the memo at `:1706-1715` entirely**

Leave the Phase 3 SSOT comment block at `:1696-1704` where it is and add one line under it:

```javascript
  // NOTE: the activeHeartRateParticipants memo now lives below userVitalsMap,
  // because it consumes the zone-progress index derived from it.
```

**Step 3: Insert the new block immediately after the `userVitalsMap` memo (after `:1886`)**

```javascript
  // Zone-progress lookup index. Keyed by profile ID, given name, AND display
  // label so a caller holding any of them resolves the same entry. Before this,
  // userZoneProgress was name-keyed only and every group-labelled user ("Dad")
  // missed — silently sorting them as progress 0. See
  // docs/_wip/plans/2026-07-21-fitness-participant-sort-ssot.md
  const zoneProgressIndex = React.useMemo(
    () => buildZoneProgressIndex(userVitalsMap),
    [userVitalsMap]
  );

  // Phase 3 SSOT: participant domain entities, PRE-SORTED.
  // Consumers must render in the order given and must not re-sort.
  const activeHeartRateParticipants = React.useMemo(() => {
    const inactiveTimeout = ant_devices?.timeout?.inactive ?? 60000;

    const participants = ParticipantFactory.fromRoster(participantRoster, {
      devices: heartRateDevices,
      zoneConfig,
      inactiveTimeout,
      getDisplayLabel,
      zoneProgressIndex
    });

    return sortByZoneRank(participants);
  }, [participantRoster, heartRateDevices, zoneConfig, ant_devices, getDisplayLabel, zoneProgressIndex]);
```

**Step 4: Verify no TDZ violation and no stray references**

```bash
grep -n "activeHeartRateParticipants\|zoneProgressIndex\|userVitalsMap =" frontend/src/context/FitnessContext.jsx
```

Expected: `userVitalsMap` declaration line < `zoneProgressIndex` line < `activeHeartRateParticipants` line < `2581`.

**Step 5: Run the frontend Fitness suites**

```bash
npx vitest run frontend/src/modules/Fitness/ frontend/src/hooks/fitness/ frontend/src/context/
```

Expected: PASS.

**Step 6: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "feat(fitness): sort activeHeartRateParticipants once in context (SSOT)"
```

---

## Task 5: Delete the inline comparator in FitnessUsers

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx` — `:45-48` (CONFIG.zone.rankMap), `:344-371` (zoneProgressMap + lookupZoneProgress), `:598-668` (sort effect)

**Step 1: Import the canonical rank map**

Add to the imports and delete `rankMap` from `CONFIG.zone` (`:47`), keeping `canonical`:

```javascript
import { ZONE_RANK_MAP } from '@/modules/Fitness/domain/ParticipantFactory.js';
```

```javascript
  zone: {
    canonical: ['cool','active','warm','hot','fire']
  },
```

Then replace the `zoneRankMap` binding at `:519`:

```javascript
  const zoneRankMap = ZONE_RANK_MAP;
```

**Step 2: Replace the local `zoneProgressMap` + `lookupZoneProgress` (`:344-371`)**

```javascript
  // Zone-progress index now comes from the context SSOT. The old local
  // normalization keyed only what FitnessContext happened to key, which is how
  // the group-label lookup miss went unnoticed. See zoneProgressIndex.js.
  const zoneProgressIndex = React.useMemo(
    () => buildZoneProgressIndex(userZoneProgress),
    [userZoneProgress]
  );

  const lookupZoneProgress = React.useCallback(
    (idOrName) => lookupZoneProgressFromIndex(zoneProgressIndex, [idOrName]),
    [zoneProgressIndex]
  );
```

with imports:

```javascript
import {
  buildZoneProgressIndex,
  lookupZoneProgress as lookupZoneProgressFromIndex
} from '@/modules/Fitness/domain/zoneProgressIndex.js';
```

This keeps `lookupZoneProgress`'s existing single-argument call sites (the card display chain at `:912-924`) working unchanged, while routing them through the aliased index.

**Step 3: Delete the HR comparator from the sort effect (`:621-637`)**

`hrDevices` arrives pre-sorted from context. Replace lines 601 and 621-637 with:

```javascript
    // activeHeartRateParticipants is PRE-SORTED by sortByZoneRank in
    // FitnessContext (the sorting SSOT). Do not re-sort here — a second
    // comparator is exactly what desynced order from card display in the
    // 2026-07-21 bug.
    const hrDevices = [...(activeHeartRateParticipants || [])];
```

Leave the RPM (`:640-646`) and equipment (`:648-659`) sorts alone — different domain, out of scope.

**Step 4: Verify nothing else references the deleted bindings**

```bash
grep -n "CONFIG.zone.rankMap\|zoneProgressMap" frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx
```

Expected: no output.

**Step 5: Run the suite**

```bash
npx vitest run frontend/src/modules/Fitness/
```

Expected: PASS.

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx
git commit -m "refactor(fitness): drop FitnessUsers inline HR comparator, consume sorted SSOT"
```

---

## Task 6: Diagnostic for future key drift

The original bug was invisible because a miss degraded to `0` with no signal. Make the next one loud.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx` (inside the `activeHeartRateParticipants` memo from Task 4)

**Step 1: Add the warn inside the memo, before `return sortByZoneRank(participants)`**

```javascript
    // A participant with a live heart rate but no resolvable progress entry means
    // the index and the entity disagree on identity — the 2026-07-21 failure mode.
    // Warn (not debug): this silently corrupts sort order.
    const unresolved = participants.filter(
      (p) => Number.isFinite(p.heartRate) && p.heartRate > 0 && p.zoneProgress === null
    );
    if (unresolved.length > 0) {
      getLogger().sampled('fitness.zone_progress.lookup_miss', {
        count: unresolved.length,
        participants: unresolved.map((p) => ({
          id: p.id,
          name: p.name,
          displayLabel: p.displayLabel,
          heartRate: p.heartRate
        })),
        indexKeys: zoneProgressIndex.size
      }, { maxPerMinute: 6, aggregate: true });
    }
```

Use the existing `getLogger` import in `FitnessContext.jsx` (confirm with `grep -n "getLogger" frontend/src/context/FitnessContext.jsx`). Per `CLAUDE.md`, never use raw `console.*`.

Note: `logger.sampled` emits at info level in this framework; if a true `warn` level is wanted here, use `getLogger().warn(...)` and accept the un-sampled volume, or keep `sampled` for rate limiting. Prefer `sampled` — a persistent mismatch would otherwise storm the session log.

**Step 2: Verify it stays quiet on the happy path**

```bash
npx vitest run frontend/src/context/
```

Expected: PASS, no new log noise in output.

**Step 3: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "feat(fitness): warn on zone-progress lookup misses"
```

---

## Task 7: Collapse the two remaining normalizations

Finishes the SSOT. Lower risk than Tasks 1-6 — do it only after those are green.

**Files:**
- Modify: `frontend/src/modules/Fitness/nav/SidebarFooter.jsx:165-169`
- Modify: `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx:119-123`

**Step 1: SidebarFooter — replace the local normalization**

```javascript
import { buildZoneProgressIndex } from '@/modules/Fitness/domain/zoneProgressIndex.js';

  const zoneProgressIndex = React.useMemo(
    () => buildZoneProgressIndex(userZoneProgress),
    [userZoneProgress]
  );
```

Update its consumers to read from `zoneProgressIndex` (same `Map` interface, so `.get(...)` call sites work as-is — but they now also resolve by profile ID and display label).

**Step 2: FullscreenVitalsOverlay — replace the inline Map-or-object branch (`:119-123`)**

```javascript
        const progressEntry = lookupZoneProgress(zoneProgressIndex, {
          profileId: user?.id,
          name: user?.name,
          displayLabel: user?.displayLabel
        });
```

with the index built the same way, and `userZoneProgress` swapped for `zoneProgressIndex` in the dep array at `:146`.

**Step 3: Run the overlay's existing test**

```bash
npx vitest run frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.test.jsx
```

Expected: PASS (it passes `userZoneProgress: null`, which `buildZoneProgressIndex` handles — covered by Task 1's null test).

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/nav/SidebarFooter.jsx \
        frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx
git commit -m "refactor(fitness): route remaining zone-progress reads through the index SSOT"
```

---

## Task 8: Verify on the real kiosk

REQUIRED SUB-SKILL: Use superpowers:verification-before-completion. Unit tests do **not** close this out — the bug only manifests with 2+ live riders where one has a `group_label`, which no unit test observes end-to-end.

**Step 1: Full frontend suite**

```bash
npx vitest run frontend/src/modules/Fitness/ frontend/src/hooks/fitness/ frontend/src/context/
npm run test:unit:vitest
```

Expected: PASS both.

**Step 2: Confirm the group-label precondition in real config**

The bug needs a user with `group_label` set. Verify at least one configured rider has one:

```bash
grep -rn "group_label" "$DAYLIGHT_BASE_PATH/data/household/config/" | head
```

Expected: at least one match (the "Dad" case). If none, the reproduction conditions differ from the 2026-07-21 screenshot — re-verify the root cause before claiming a fix.

**Step 3: Live check with two riders**

Per `CLAUDE.local.md`, the fitness app runs in Firefox kiosk on the garage box, not the Shield. Start a session with **two** HR straps — one on a group-labelled user (Dad), one on a non-labelled user (Felix) — and get both into the same zone at different progress.

Assert: the rider with the fuller progress bar is on top. That is the exact inversion from the screenshot.

Per `feedback_dont_ask_check_yourself`, get a screenshot and verify it yourself rather than asking KC to eyeball it.

**Step 4: Confirm the diagnostic is silent**

With `window.DAYLIGHT_LOG_LEVEL = 'debug'` in the kiosk console, confirm **no** `fitness.zone_progress.lookup_miss` events fire during a healthy two-rider session. Any occurrence means an alias is still unindexed.

**Step 5: Update docs**

- Add a "Participant sort order" section to the Fitness reference docs pointing at `sortByZoneRank` as the SSOT and stating that consumers must not re-sort.
- Move this plan to `docs/_archive/` once merged, per `CLAUDE.md` doc rules.

**Step 6: Merge**

REQUIRED SUB-SKILL: Use superpowers:finishing-a-development-branch. Per `CLAUDE.md`: merge directly into `main`, no PR, then delete the branch and record it in `docs/_archive/deleted-branches.md`. Per `feedback_commit_policy_feature_branches`, get KC's sign-off before the merge to `main` and any deploy.

---

## Out of scope

- **RPM and equipment sorts** (`FitnessUsers.jsx:640-659`) — different domain. Note the equipment sort has no deterministic final tiebreak, so equal-value equipment can swap on re-sort. Worth a follow-up, not this change.
- **Raw vs committed zone for sorting** — sorting stays on the raw/live zone by design (`FitnessUsers.jsx:607-620`). Changing it would desync order from card color.
- **FlipMove churn** — sorting on live zone means cards re-order on every zone-boundary cross. Pre-existing, unchanged here.
- **`getRawZoneId`'s 3-tier fallback** (`FitnessUsers.jsx:534-562`) — now redundant for the sort (which reads `participant.rawZoneId`) but still used for card display. Collapsing it is a follow-up.
