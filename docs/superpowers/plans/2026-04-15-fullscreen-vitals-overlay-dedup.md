# FullscreenVitalsOverlay Deduplication

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the duplicate FullscreenVitalsOverlay component — replace the broken shared/integrations copy with a re-export of the working player/overlays copy.

**Architecture:** The player copy is the canonical implementation. The shared copy's RPM section is broken (`cadenceDevices` is not exposed in FitnessContext, so it always gets `[]`). Both copies take only `{ visible }` as a prop and pull everything from `useFitnessContext()`. Replace the shared copy with a one-line re-export, delete its dead SCSS, and update the re-export chain.

**Tech Stack:** React, SCSS, Vite

---

## Current State

Two copies exist with different RPM handling:

| | Player (`player/overlays/`) | Shared (`shared/integrations/`) |
|---|---|---|
| HR section | Works (identical logic) | Works (identical logic) |
| RPM section | Works — filters `allDevices` for RPM types | **Broken** — uses `cadenceDevices` which is not in context value (always `[]`) |
| BLE devices | Handled in equipmentMap | Not handled |
| SCSS | Uses `@use '../../shared/styles/rpm-device'` mixins | Inline styles (no mixins) |
| Equipment resolution | Direct equipmentMap lookup | Uses `getDeviceAssignment` (dead — cadenceDevices is empty) |

**Consumers:**
- `FitnessPlayerOverlay.jsx` — imports default from `player/overlays/FullscreenVitalsOverlay.jsx`
- `FitnessSessionApp.jsx` — imports named `{ FullscreenVitalsOverlay }` from `@/modules/Fitness/shared/integrations`

**Re-export chain for shared path:**
```
FitnessSessionApp.jsx
  → @/modules/Fitness/shared/integrations (index.js)
    → ./FullscreenVitalsOverlay (FullscreenVitalsOverlay/index.js)
      → ./FullscreenVitalsOverlay (FullscreenVitalsOverlay.jsx)
```

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Rewrite | `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx` | Re-export from player/overlays |
| Rewrite | `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/index.js` | Re-export default + named |
| Delete | `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.scss` | Dead code — player copy's SCSS is used |
| Verify | `frontend/src/modules/Fitness/shared/integrations/index.js` | Ensure re-export still works |
| Verify | `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx` | Canonical copy, no changes needed |

---

## Task 1: Replace Shared Copy With Re-Export

**Files:**
- Rewrite: `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx`
- Rewrite: `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/index.js`
- Delete: `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.scss`
- Verify: `frontend/src/modules/Fitness/shared/integrations/index.js`

The canonical copy (`player/overlays/FullscreenVitalsOverlay.jsx`) exports only `default`. The consumer (`FitnessSessionApp.jsx`) imports `{ FullscreenVitalsOverlay }` via the shared/integrations barrel. The re-export must bridge this — expose the default export as both default and named.

- [ ] **Step 1: Check what the parent barrel exports**

Read `frontend/src/modules/Fitness/shared/integrations/index.js` and confirm:
```javascript
export { default as FullscreenVitalsOverlay } from './FullscreenVitalsOverlay';
```

This re-exports the default from `FullscreenVitalsOverlay/index.js` as a named export. The chain must preserve this.

- [ ] **Step 2: Replace FullscreenVitalsOverlay.jsx with re-export**

Replace the entire contents of `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx` with:

```javascript
// Deduplicated — canonical copy lives in player/overlays.
// The shared copy's RPM section was broken (cadenceDevices not in context).
export { default } from '../../../player/overlays/FullscreenVitalsOverlay.jsx';
```

- [ ] **Step 3: Update index.js to re-export both default and named**

Replace the entire contents of `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/index.js` with:

```javascript
export { default, default as FullscreenVitalsOverlay } from './FullscreenVitalsOverlay';
```

This ensures:
- `import X from '...'` gets the default (used by the directory barrel)
- `import { FullscreenVitalsOverlay } from '...'` also works (defensive)

- [ ] **Step 4: Delete dead SCSS**

```bash
rm frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.scss
```

The re-exported component uses the player copy's SCSS (`player/overlays/FullscreenVitalsOverlay.scss`), which uses shared SCSS mixins from `shared/styles/rpm-device`. This file is no longer imported by anything.

- [ ] **Step 5: Verify the parent barrel doesn't need changes**

Read `frontend/src/modules/Fitness/shared/integrations/index.js`. It should have:
```javascript
export { default as FullscreenVitalsOverlay } from './FullscreenVitalsOverlay';
```

This imports from `FullscreenVitalsOverlay/index.js` (directory import), which now re-exports from the JSX re-export, which re-exports from the player copy. The chain is: `integrations/index.js` → `FullscreenVitalsOverlay/index.js` → `FullscreenVitalsOverlay.jsx` → `player/overlays/FullscreenVitalsOverlay.jsx`. No changes needed to the parent barrel.

- [ ] **Step 6: Verify build succeeds**

Run: `cd frontend && npx vite build 2>&1 | tail -5`
Expected: `built in Xs` — no errors. Both consumers (`FitnessPlayerOverlay.jsx` and `FitnessSessionApp.jsx`) should resolve correctly.

- [ ] **Step 7: Verify both import paths resolve to the same module**

Run:
```bash
grep -rn 'FullscreenVitalsOverlay' frontend/src/modules/Fitness/ --include="*.jsx" --include="*.js" | grep -v node_modules | grep -v '.scss'
```

Confirm:
- `FitnessPlayerOverlay.jsx` still imports default from `./overlays/FullscreenVitalsOverlay.jsx`
- `FitnessSessionApp.jsx` still imports named from `@/modules/Fitness/shared/integrations`
- `shared/integrations/index.js` re-exports from `./FullscreenVitalsOverlay`
- `FullscreenVitalsOverlay/index.js` re-exports from `./FullscreenVitalsOverlay`
- `FullscreenVitalsOverlay.jsx` re-exports from `../../../player/overlays/FullscreenVitalsOverlay.jsx`

Both paths terminate at the same canonical file.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/
git commit -m "refactor(fitness): deduplicate FullscreenVitalsOverlay — shared copy re-exports player copy"
```

---

## Task 2: Migrate Player Copy to Use `rpmDevices` Selector

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx:97-99, 174-206`

The player copy manually filters `allDevices` for RPM types. FitnessContext already exposes a `rpmDevices` selector (line 1360) that does exactly this filtering. Switch to it — reduces coupling to `allDevices` (which is deprecated per context comment) and eliminates duplicate filter logic.

- [ ] **Step 1: Update context destructuring (line 97-108)**

Find:
```javascript
  const {
    heartRateDevices = [],
    allDevices = [],
    getUserByDevice,
    userCurrentZones,
    zones,
    users: allUsers = [],
    usersConfigRaw = {},
    equipment = [],
    deviceConfiguration,
    userZoneProgress
  } = fitnessCtx || {};
```

Replace `allDevices = []` with `rpmDevices = []`:
```javascript
  const {
    heartRateDevices = [],
    rpmDevices = [],
    getUserByDevice,
    userCurrentZones,
    zones,
    users: allUsers = [],
    usersConfigRaw = {},
    equipment = [],
    deviceConfiguration,
    userZoneProgress
  } = fitnessCtx || {};
```

- [ ] **Step 2: Simplify rpmItems memo (lines 174-206)**

Find:
```javascript
  const rpmItems = useMemo(() => {
    const cadenceConfig = deviceConfiguration?.cadence || {};
    // Filter RPM devices from allDevices (same approach as FitnessUsers)
    const allRpmDevices = allDevices.filter(d =>
      d.type === 'cadence' || d.type === 'stationary_bike' ||
      d.type === 'ab_roller' || d.type === 'jumprope'
    );

    return allRpmDevices.map((device) => {
```

Replace with:
```javascript
  const rpmItems = useMemo(() => {
    const cadenceConfig = deviceConfiguration?.cadence || {};

    return rpmDevices.map((device) => {
```

- [ ] **Step 3: Update useMemo dependency array (line 206)**

Find:
```javascript
  }, [allDevices, equipmentMap, equipment, deviceConfiguration?.cadence]);
```

Replace with:
```javascript
  }, [rpmDevices, equipmentMap, equipment, deviceConfiguration?.cadence]);
```

- [ ] **Step 4: Verify build succeeds**

Run: `cd frontend && npx vite build 2>&1 | tail -5`
Expected: `built in Xs` — no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx
git commit -m "refactor(fitness): FullscreenVitalsOverlay uses rpmDevices selector instead of filtering allDevices"
```
