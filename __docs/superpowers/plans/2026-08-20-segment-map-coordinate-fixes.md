# Segment Map Coordinate & Fold Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 bugs in the segment map's fold/heading machinery found by audit — the coordinate-space mismatch between placed and drawn rails, the missing `shortNeeds` metric, wrong scene numeral derivation, dead CSS, and the legacy heading-row reservation.

**Architecture:** The root cause is that `foldGroups` and the level-0 Part heading row are computed from `placedRail` (full, pre-collapse) but consumed in drawn-rail (post-collapse) coordinate space. The fix moves both onto `drawnRail`. Independently, `shortNeeds` is computed but never stored, scene numerals are positional instead of ordinal, and two CSS rules are dead.

**Tech Stack:** React (JSX), SCSS, vitest (test runner). All changes in `frontend/src/modules/Surround/`.

## Global Constraints

- Run vitest from main repo binary: `/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs --reporter=verbose <spec>`
- No new dependencies.
- `ROMAN` table goes to XII (index 12). Scene ordinals beyond 12 fall back to Arabic.

---

### Task 1: Move foldGroups and Part headings onto drawnRail (bugs 1, 2, 5)

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx:519-556` (foldGroups, foldSceneCounts)
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx:1084-1106` (Part heading render)

**Interfaces:**
- Consumes: `drawnRail` (post-collapse placed segments), `railGroups` (from band.js), `activeIndex` (drawn-rail index)
- Produces: `drawnPartGroups` (replaces `foldGroups`), corrected `foldSceneCounts`, corrected Part heading row

The core issue: `foldGroups = groupLevels[0]` is in placed-rail coordinates (53 entries) but `activeIndex` and `shares` are in drawn-rail coordinates (~25 entries). This causes `railFolds` to fold the wrong Parts, the Part heading `groupBasis` to sum the wrong shares, and `foldSceneCounts` to key against mismatched indices.

- [ ] **Step 1: Replace `foldGroups` with drawn-rail Part groups**

In `SegmentMap.jsx`, replace lines 519-523:

```jsx
// BEFORE
const foldGroups = groupLevels[0] ?? EMPTY_GROUPS;
const folds = useMemo(
  () => railFolds({ groups: foldGroups, activeIndex }),
  [foldGroups, activeIndex],
);
```

with:

```jsx
const drawnPartGroups = useMemo(() => {
  if (!composed || groupLevels.length === 0) return EMPTY_GROUPS;
  if (nested) return railGroups(drawnRail, (segment) => segment?.ancestors?.[0] ?? null);
  return groupLevels[0];
}, [composed, nested, drawnRail, groupLevels]);
const folds = useMemo(
  () => railFolds({ groups: drawnPartGroups, activeIndex }),
  [drawnPartGroups, activeIndex],
);
```

- [ ] **Step 2: Fix foldSceneCounts to derive from drawn coordinates**

Replace lines 542-556:

```jsx
const foldSceneCounts = useMemo(() => {
  if (!folds.length || groupLevels.length < 2) return new Map();
  const counts = new Map();
  folds.forEach((fold) => {
    const scenes = new Set();
    for (let i = fold.from; i < fold.from + fold.count; i += 1) {
      const sceneIdx = drawnRail[i]?.segment?.ancestors?.[1]?.index;
      if (sceneIdx != null) scenes.add(sceneIdx);
    }
    counts.set(fold.index, scenes.size);
  });
  return counts;
}, [folds, groupLevels.length, drawnRail]);
```

- [ ] **Step 3: Use drawnPartGroups for Part heading row**

Replace lines 1084-1106:

```jsx
{drawnPartGroups.length > 0 && (
  <div
    className="surround-segment-map__groups"
    data-testid={groupLevels.length > 1 ? 'surround-part-groups' : 'surround-segment-groups'}
    data-level={0}
    aria-hidden="true"
  >
    {drawnPartGroups.map((group) => (
      <span
        key={`${group.index ?? 'none'}:${group.from}`}
        className={`surround-segment-map__group${groupLevels.length > 1 ? ' surround-segment-map__group--part' : ''}`}
        data-testid={groupLevels.length > 1 ? 'surround-part-group-label' : 'surround-group-label'}
        data-span={group.count}
        style={{ flexBasis: `${groupBasis(group) * 100}%` }}
      >
        {groupLevels.length > 1
          ? partDesignation(group.title)
          : group.title ?? ''}
      </span>
    ))}
  </div>
)}
```

Note: this also applies the `__group--part` CSS class (fixing bug 9 / dead CSS).

- [ ] **Step 4: Update fold measurement and log to use drawnPartGroups**

In `measureRail` (~line 676-694), replace references to `foldGroups` with `drawnPartGroups`:

```jsx
// In the useCallback dependency array (~line 694):
}, [named, segments, drawnPartGroups]);

// In the measurement loop (~line 676-682):
drawnPartGroups.forEach((run) => {
  const short = partDesignation(run.title);
  if (!short || labels[short] !== undefined) return;
  labelProbe.textContent = short;
  labels[short] = labelProbe.getBoundingClientRect().width;
});
```

- [ ] **Step 5: Run tests**

Run: `/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs --reporter=verbose frontend/src/modules/Surround/modules/SegmentMap.test.jsx frontend/src/modules/Surround/band.test.js frontend/src/modules/Surround/folds.test.js`

Expected: PASS (existing tests cover single-level rails; nested/Messiah paths are not yet tested but must not regress single-level).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Surround/modules/SegmentMap.jsx
git commit -m "fix(surround): foldGroups and Part headings use drawn-rail coordinates

The fold machinery and Part heading row were computed from placedRail
(full 53 segments) but consumed in drawnRail space (post-collapse ~25).
This caused folds to target the wrong Parts and headings to span the
wrong segments. Both now derive from drawnRail."
```

---

### Task 2: Store shortNeeds in metrics (bug 3)

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx:181-183` (UNMEASURED_RAIL)
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx:693` (setMetrics call)

**Interfaces:**
- Consumes: `shortNeeds` array from `measureRail`
- Produces: `metrics.shortNeeds` available at line 709

- [ ] **Step 1: Add shortNeeds to UNMEASURED_RAIL**

At line 181-183, add `shortNeeds: []`:

```jsx
const UNMEASURED_RAIL = Object.freeze({
  chromePx: 0, needs: [], shortNeeds: [], labels: Object.freeze({}), pillPx: 0,
});
```

- [ ] **Step 2: Include shortNeeds in setMetrics**

At line 693, change:

```jsx
setMetrics({ chromePx, needs, labels, pillPx });
```

to:

```jsx
setMetrics({ chromePx, needs, shortNeeds, labels, pillPx });
```

- [ ] **Step 3: Run tests**

Run: `/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs --reporter=verbose frontend/src/modules/Surround/modules/SegmentMap.test.jsx frontend/src/modules/Surround/band.measure.test.jsx`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Surround/modules/SegmentMap.jsx
git commit -m "fix(surround): store shortNeeds in metrics — prevents TypeError on all-short rails"
```

---

### Task 3: Scene numerals use work-wide ordinal, not drawn position (bug 4)

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx:1118-1123` (scene label derivation)

**Interfaces:**
- Consumes: `drawnSceneGroups` (drawn-rail scene runs), `groupLevels[1]` (full-rail scene runs for ordinal lookup), `activeSceneIndex`
- Produces: corrected scene labels — Roman numeral from work-wide ordinal, not positional `gi`

The problem: `ROMAN[gi + 1]` where `gi` is the scene's position in the drawn run array — this shifts when Parts fold. The ordinal should come from the scene's `index` within Part One's scene list.

- [ ] **Step 1: Derive scene ordinal from the full groupLevels**

Replace lines 1118-1123 in the scene heading render:

```jsx
{drawnSceneGroups.map((group) => {
  const isActive = group.index === activeSceneIndex;
  const isCollapsed = segments[group.from]?.collapsed;
  // The ordinal is the scene's position within its Part, not its
  // position in the drawn run array (which shifts when Parts fold).
  // Find the scene's Part, then count which scene within that Part.
  const partIdx = drawnRail[group.from]?.segment?.ancestors?.[0]?.index;
  const partScenes = groupLevels.length > 1
    ? groupLevels[1].filter((s) => {
        const si = placedRail[s.from]?.segment?.ancestors?.[0]?.index;
        return si === partIdx;
      })
    : [];
  const ordinal = partScenes.findIndex((s) => s.index === group.index) + 1;
  const label = isCollapsed ? ''
    : isActive ? (group.title ?? '')
      : ROMAN[ordinal] ?? String(ordinal);
  return (
```

- [ ] **Step 2: Run tests**

Run: `/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs --reporter=verbose frontend/src/modules/Surround/modules/SegmentMap.test.jsx`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Surround/modules/SegmentMap.jsx
git commit -m "fix(surround): scene numerals use work-wide Part-local ordinal

ROMAN[gi+1] used the drawn run position, which shifted when Parts
folded. Now derives the ordinal from the scene's position within its
own Part in the full groupLevels."
```

---

### Task 4: Fix legacy heading row height reservation (bug 6)

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx` — the `--group-rows` CSS var computation

**Interfaces:**
- Consumes: `drawnPartGroups.length`, `drawnSceneGroups.length`
- Produces: correct `--group-rows` count matching actual rendered rows

- [ ] **Step 1: Find and fix --group-rows**

Search for where `--group-rows` is set:

```bash
grep -n 'group-rows' frontend/src/modules/Surround/modules/SegmentMap.jsx
```

The var should count the actually rendered rows: `(drawnPartGroups.length > 0 ? 1 : 0) + (drawnSceneGroups.length > 0 ? 1 : 0)` instead of `groupLevels.length`.

- [ ] **Step 2: Run tests**

Run: `/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs --reporter=verbose frontend/src/modules/Surround/modules/SegmentMap.test.jsx`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Surround/modules/SegmentMap.jsx
git commit -m "fix(surround): --group-rows counts rendered heading rows, not groupLevels.length"
```

---

### Task 5: Clean up dead CSS and apply __group--part (bug 9, smell 10)

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.scss:200-204` (revive `__group--part`)
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.scss:688-691` (simplify `__group--collapsed`)

**Interfaces:**
- Consumes: `__group--part` class applied in Task 1's step 3
- Produces: visual emphasis on Part-level headings; collapsed labels use `visibility: hidden`

- [ ] **Step 1: Verify __group--part is now emitted by Task 1**

Confirm the JSX from Task 1 step 3 emits `surround-segment-map__group--part`. (It does — the `className` includes it when `groupLevels.length > 1`.)

- [ ] **Step 2: Replace opacity: 0 with visibility: hidden**

At line 688-691, change:

```scss
.surround-segment-map__group--collapsed {
  opacity: 0;
  pointer-events: none;
}
```

to:

```scss
.surround-segment-map__group--collapsed {
  visibility: hidden;
}
```

- [ ] **Step 3: Run tests**

Run: `/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs --reporter=verbose frontend/src/modules/Surround/modules/SegmentMap.test.jsx`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Surround/modules/SegmentMap.scss
git commit -m "fix(surround): revive __group--part CSS, collapsed labels use visibility: hidden"
```

---

### Task 6: Guard activeSceneIndex against ungrouped runs (smell 11)

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx:534-540` (activeSceneIndex)

**Interfaces:**
- Consumes: `drawnSceneGroups`, `activeIndex`
- Produces: `activeSceneIndex` that is never `null` when ungrouped runs exist

- [ ] **Step 1: Guard the null === null match**

Change `activeSceneIndex` to only return `run.index` when it's a finite number:

```jsx
const activeSceneIndex = useMemo(() => {
  if (!drawnSceneGroups.length || activeIndex < 0) return -1;
  for (const run of drawnSceneGroups) {
    if (activeIndex >= run.from && activeIndex < run.from + run.count) {
      return run.index ?? -1;
    }
  }
  return -1;
}, [drawnSceneGroups, activeIndex]);
```

And in the scene render, change `group.index === activeSceneIndex` — with both sides now using `-1` as "none", `null === null` no longer matches.

- [ ] **Step 2: Run tests**

Run: `/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs --reporter=verbose frontend/src/modules/Surround/modules/SegmentMap.test.jsx`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Surround/modules/SegmentMap.jsx
git commit -m "fix(surround): activeSceneIndex uses -1 sentinel, not null — prevents ungrouped collision"
```
