# ArtMode Per-Screen Ambient Dimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ArtMode auto-dim from the sensor of the room it runs in (office dims off the office sensor, living-room off the kitchen) using a per-room curve, instead of one hardcoded `ambient` topic + a curve duplicated across presets.

**Architecture:** Producer/consumer split. The backend reads `ambient.yml` **zones** (`{topic, entities}`) and starts one `AmbientLightService` per zone, each broadcasting lux on its topic. Each **screen config** declares the zone topic it consumes plus a curve tuned to that sensor. `ArtMode` reads its screen's ambient from a new React context and subscribes to that topic.

**Tech Stack:** Node ESM (`.mjs`) backend, React (`.jsx`) frontend, vitest unit tests, Docker deploy. Data-volume YAML configs edited via `sudo docker exec` heredoc.

**Spec:** `docs/superpowers/specs/2026-06-15-artmode-per-screen-ambient-design.md`

**Test command (single file):**
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs <path-to-test>
```

---

## File Structure

- Create `backend/src/3_applications/home-automation/ambientZones.mjs` — pure `normalizeAmbientZones(config)` + `startAmbientZones({...})` loop (injectable service factory). One responsibility: turn ambient config into running per-zone services.
- Modify `backend/src/app.mjs:1679-1694` — replace the single-zone wiring with the zones helpers.
- Create `frontend/src/screen-framework/widgets/resolveAmbient.js` — pure: pick screen ambient over preset ambient, normalize.
- Create `frontend/src/screen-framework/ambient/ScreenAmbientContext.jsx` — `ScreenAmbientProvider` + `useScreenAmbient()`.
- Modify `frontend/src/screen-framework/ScreenRenderer.jsx:355-378` — wrap the tree in `ScreenAmbientProvider value={config.ambient}`.
- Modify `frontend/src/screen-framework/widgets/ArtMode.jsx` (imports; lines 54-55; lines 165-168) — use `useScreenAmbient()` + `resolveAmbient()`.
- Data volume: `data/household/config/ambient.yml` (zones), `data/household/screens/office.yml` (ambient block), `data/household/screens/living-room.yml` (ambient block).
- Tests: `tests/unit/home-automation/ambientZones.test.mjs`, `tests/unit/screen-framework/resolveAmbient.test.mjs`, `tests/unit/screen-framework/useScreenAmbient.test.jsx`, `tests/unit/screen-framework/ArtModeAmbient.test.jsx`.

---

## Task 1: Backend — `normalizeAmbientZones` (pure)

**Files:**
- Create: `backend/src/3_applications/home-automation/ambientZones.mjs`
- Test: `tests/unit/home-automation/ambientZones.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/home-automation/ambientZones.test.mjs`:

```js
import { normalizeAmbientZones } from '../../../backend/src/3_applications/home-automation/ambientZones.mjs';

describe('normalizeAmbientZones', () => {
  it('passes through a zones list', () => {
    const cfg = { zones: [
      { topic: 'ambient', entities: ['sensor.k1', 'sensor.k2'] },
      { topic: 'ambient:office', entities: ['sensor.o1'] },
    ] };
    expect(normalizeAmbientZones(cfg)).toEqual([
      { topic: 'ambient', entities: ['sensor.k1', 'sensor.k2'] },
      { topic: 'ambient:office', entities: ['sensor.o1'] },
    ]);
  });

  it('normalizes a legacy illuminance block to one default zone', () => {
    const cfg = { illuminance: { entities: ['sensor.k1', 'sensor.k2'] } };
    expect(normalizeAmbientZones(cfg)).toEqual([
      { topic: 'ambient', entities: ['sensor.k1', 'sensor.k2'] },
    ]);
  });

  it('honors a legacy illuminance.topic', () => {
    const cfg = { illuminance: { topic: 'lux', entities: ['sensor.k1'] } };
    expect(normalizeAmbientZones(cfg)).toEqual([{ topic: 'lux', entities: ['sensor.k1'] }]);
  });

  it('drops zones missing a topic or with no entities', () => {
    const cfg = { zones: [
      { topic: '', entities: ['sensor.x'] },
      { topic: 'ok', entities: [] },
      { entities: ['sensor.y'] },
      { topic: 'good', entities: ['sensor.z', 7, ''] },
    ] };
    expect(normalizeAmbientZones(cfg)).toEqual([{ topic: 'good', entities: ['sensor.z'] }]);
  });

  it('returns [] for empty/absent config', () => {
    expect(normalizeAmbientZones(undefined)).toEqual([]);
    expect(normalizeAmbientZones({})).toEqual([]);
    expect(normalizeAmbientZones({ illuminance: { entities: [] } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/home-automation/ambientZones.test.mjs`
Expected: FAIL — `normalizeAmbientZones` not exported / module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `backend/src/3_applications/home-automation/ambientZones.mjs`:

```js
/**
 * ambientZones — turn the `ambient.yml` config into a list of running per-zone
 * AmbientLightService instances. Each zone is one room's sensor set broadcasting
 * lux on its own eventbus topic.
 */
import { createAmbientLightService } from './AmbientLightService.mjs';

/**
 * Normalize ambient config into `[{ topic, entities }]`.
 * Accepts a `zones:` list, or a legacy single `illuminance:` block (→ one zone,
 * topic defaults to 'ambient'). Zones without a topic or with no string entities
 * are dropped.
 */
export function normalizeAmbientZones(config) {
  const out = [];
  const push = (topic, entities) => {
    const t = (typeof topic === 'string' && topic.trim()) ? topic.trim() : null;
    const ents = Array.isArray(entities)
      ? entities.filter((e) => typeof e === 'string' && e)
      : [];
    if (t && ents.length) out.push({ topic: t, entities: ents });
  };
  if (Array.isArray(config?.zones)) {
    for (const z of config.zones) push(z?.topic, z?.entities);
    return out;
  }
  if (config?.illuminance) push(config.illuminance.topic || 'ambient', config.illuminance.entities);
  return out;
}

export default normalizeAmbientZones;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/home-automation/ambientZones.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/home-automation/ambientZones.mjs tests/unit/home-automation/ambientZones.test.mjs
git commit -m "feat(ambient): normalizeAmbientZones — parse zones / legacy illuminance"
```

---

## Task 2: Backend — `startAmbientZones` (per-zone service loop)

**Files:**
- Modify: `backend/src/3_applications/home-automation/ambientZones.mjs`
- Test: `tests/unit/home-automation/ambientZones.test.mjs`

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/home-automation/ambientZones.test.mjs`:

```js
import { startAmbientZones } from '../../../backend/src/3_applications/home-automation/ambientZones.mjs';

describe('startAmbientZones', () => {
  const haGateway = { getConnection: () => ({ baseUrl: 'http://ha:8123', token: 'T' }) };
  const eventBus = { broadcast: () => {} };
  const logger = { info: () => {}, warn: () => {} };

  it('starts one service per zone with that zone config', () => {
    const calls = [];
    const createService = (opts) => {
      calls.push(opts);
      return { start: () => { opts.__started = true; } };
    };
    const zones = [
      { topic: 'ambient', entities: ['sensor.k1'] },
      { topic: 'ambient:office', entities: ['sensor.o1'] },
    ];
    const started = startAmbientZones({ zones, haGateway, eventBus, logger, createService });
    expect(started).toHaveLength(2);
    expect(calls.map((c) => c.config)).toEqual([
      { entities: ['sensor.k1'], topic: 'ambient' },
      { entities: ['sensor.o1'], topic: 'ambient:office' },
    ]);
    expect(calls.every((c) => c.__started)).toBe(true);
  });

  it('starts nothing when the HA gateway cannot connect', () => {
    const createService = () => { throw new Error('should not be called'); };
    const started = startAmbientZones({
      zones: [{ topic: 'ambient', entities: ['sensor.k1'] }],
      haGateway: {}, eventBus, logger, createService,
    });
    expect(started).toEqual([]);
  });

  it('starts nothing for an empty zone list', () => {
    const started = startAmbientZones({ zones: [], haGateway, eventBus, logger, createService: () => ({ start() {} }) });
    expect(started).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/home-automation/ambientZones.test.mjs`
Expected: FAIL — `startAmbientZones` is not a function.

- [ ] **Step 3: Implement `startAmbientZones`**

In `backend/src/3_applications/home-automation/ambientZones.mjs`, add above `export default`:

```js
/**
 * Start one AmbientLightService per zone. No-op (returns []) if the HA gateway
 * can't provide a connection. `createService` is injectable for tests.
 */
export function startAmbientZones({
  zones, haGateway, eventBus, logger,
  createService = createAmbientLightService,
}) {
  if (!haGateway?.getConnection) return [];
  const started = [];
  for (const zone of zones) {
    const svc = createService({
      haGateway, eventBus,
      config: { entities: zone.entities, topic: zone.topic },
      logger,
    });
    svc.start();
    started.push(svc);
  }
  return started;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/home-automation/ambientZones.test.mjs`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/home-automation/ambientZones.mjs tests/unit/home-automation/ambientZones.test.mjs
git commit -m "feat(ambient): startAmbientZones — one service per zone"
```

---

## Task 3: Backend — wire `app.mjs` to per-zone services

**Files:**
- Modify: `backend/src/app.mjs` (import near top with other home-automation imports; the ambient block at lines 1679-1694)

No new unit test (bootstrap wiring; the logic is covered by Task 1-2 and verified live in Task 7). This task is a mechanical swap.

- [ ] **Step 1: Add the import**

Find the existing import (line ~195):
```js
import { createAmbientLightService } from './3_applications/home-automation/AmbientLightService.mjs';
```
Add immediately after it:
```js
import { normalizeAmbientZones, startAmbientZones } from './3_applications/home-automation/ambientZones.mjs';
```
(`createAmbientLightService` is no longer referenced directly in `app.mjs` after this task; leave the import — it is harmless — or remove it if lint flags it.)

- [ ] **Step 2: Replace the ambient wiring block**

Replace the block at `backend/src/app.mjs:1679-1694`:

```js
  // Ambient brightness: HA illuminance sensors → eventbus 'ambient' → ArtMode dim.
  // ambient.yml lives under the household config dir → read via the household apps map.
  const ambientConfig = configService.getHouseholdAppConfig(null, 'ambient') || {};
  if (ambientConfig?.illuminance?.entities?.length && homeAutomationAdapters.haGateway?.getConnection) {
    const ambientLight = createAmbientLightService({
      haGateway: homeAutomationAdapters.haGateway,
      eventBus,
      config: {
        entities: ambientConfig.illuminance.entities,
        topic: ambientConfig.illuminance.topic || 'ambient',
      },
      logger: rootLogger.child({ module: 'ambient-light' }),
    });
    ambientLight.start();
  }
```

with:

```js
  // Ambient brightness: HA illuminance sensors → per-zone eventbus topics → ArtMode dim.
  // ambient.yml lives under the household config dir → read via the household apps map.
  // Each zone (room) broadcasts its lux on its own topic; the screen config picks the
  // topic + curve for that room. See ambientZones.mjs.
  const ambientConfig = configService.getHouseholdAppConfig(null, 'ambient') || {};
  const ambientZones = normalizeAmbientZones(ambientConfig);
  startAmbientZones({
    zones: ambientZones,
    haGateway: homeAutomationAdapters.haGateway,
    eventBus,
    logger: rootLogger.child({ module: 'ambient-light' }),
  });
```

- [ ] **Step 3: Verify the backend boots (syntax + wiring)**

Run: `node --check backend/src/app.mjs`
Expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(ambient): wire app.mjs to per-zone ambient services"
```

---

## Task 4: Frontend — `resolveAmbient` (pure)

**Files:**
- Create: `frontend/src/screen-framework/widgets/resolveAmbient.js`
- Test: `tests/unit/screen-framework/resolveAmbient.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/screen-framework/resolveAmbient.test.mjs`:

```js
import { resolveAmbient } from '../../../frontend/src/screen-framework/widgets/resolveAmbient.js';

const curveA = [{ lux: 0, dim: 0.9 }, { lux: 100, dim: 0.2 }];
const curveB = [{ lux: 0, dim: 0.8 }, { lux: 50, dim: 0.1 }];

describe('resolveAmbient', () => {
  it('prefers screen ambient and fills its topic', () => {
    const screen = { topic: 'ambient:office', curve: curveA, defaultLux: 36 };
    expect(resolveAmbient(screen, null)).toEqual({ topic: 'ambient:office', curve: curveA, defaultLux: 36 });
  });

  it('falls back to preset ambient with a default topic when no screen ambient', () => {
    const preset = { curve: curveB, defaultLux: 80 };
    expect(resolveAmbient(null, preset)).toEqual({ topic: 'ambient', curve: curveB, defaultLux: 80 });
  });

  it('uses screen ambient over preset ambient when both present', () => {
    const screen = { topic: 'ambient:office', curve: curveA, defaultLux: 36 };
    const preset = { curve: curveB, defaultLux: 80 };
    expect(resolveAmbient(screen, preset).curve).toBe(curveA);
  });

  it('ignores ambient configs without a curve', () => {
    expect(resolveAmbient({ topic: 'x' }, null)).toBe(null);
    expect(resolveAmbient(null, { defaultLux: 5 })).toBe(null);
    expect(resolveAmbient(null, null)).toBe(null);
  });

  it('defaults defaultLux to 0 when missing or non-finite', () => {
    expect(resolveAmbient({ topic: 't', curve: curveA }, null).defaultLux).toBe(0);
    expect(resolveAmbient({ topic: 't', curve: curveA, defaultLux: 'x' }, null).defaultLux).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/screen-framework/resolveAmbient.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `frontend/src/screen-framework/widgets/resolveAmbient.js`:

```js
// resolveAmbient — choose which ambient config ArtMode should use.
// Screen ambient (per-room sensor topic + curve) wins; preset ambient is a legacy
// fallback (no topic of its own → the default 'ambient' topic). Returns null when
// neither carries a curve (→ ArtMode does not dim).
export function resolveAmbient(screenAmbient, presetAmbient) {
  const pick = (screenAmbient && Array.isArray(screenAmbient.curve)) ? screenAmbient
    : ((presetAmbient && Array.isArray(presetAmbient.curve)) ? presetAmbient : null);
  if (!pick) return null;
  const defaultLux = Number.isFinite(pick.defaultLux) ? pick.defaultLux : 0;
  return { topic: pick.topic || 'ambient', curve: pick.curve, defaultLux };
}

export default resolveAmbient;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/screen-framework/resolveAmbient.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/widgets/resolveAmbient.js tests/unit/screen-framework/resolveAmbient.test.mjs
git commit -m "feat(artmode): resolveAmbient — screen ambient over preset"
```

---

## Task 5: Frontend — `ScreenAmbientProvider` + `useScreenAmbient`

**Files:**
- Create: `frontend/src/screen-framework/ambient/ScreenAmbientContext.jsx`
- Test: `tests/unit/screen-framework/useScreenAmbient.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/screen-framework/useScreenAmbient.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderHook } from '@testing-library/react';
import {
  ScreenAmbientProvider,
  useScreenAmbient,
} from '../../../frontend/src/screen-framework/ambient/ScreenAmbientContext.jsx';

describe('useScreenAmbient', () => {
  it('returns the provided ambient config', () => {
    const ambient = { topic: 'ambient:office', curve: [{ lux: 0, dim: 0.9 }], defaultLux: 36 };
    const wrapper = ({ children }) => (
      <ScreenAmbientProvider value={ambient}>{children}</ScreenAmbientProvider>
    );
    const { result } = renderHook(() => useScreenAmbient(), { wrapper });
    expect(result.current).toEqual(ambient);
  });

  it('returns null when no value is provided', () => {
    const wrapper = ({ children }) => (
      <ScreenAmbientProvider value={undefined}>{children}</ScreenAmbientProvider>
    );
    const { result } = renderHook(() => useScreenAmbient(), { wrapper });
    expect(result.current).toBe(null);
  });

  it('returns null with no provider at all', () => {
    const { result } = renderHook(() => useScreenAmbient());
    expect(result.current).toBe(null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/screen-framework/useScreenAmbient.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `frontend/src/screen-framework/ambient/ScreenAmbientContext.jsx`:

```jsx
import React, { createContext, useContext } from 'react';

/**
 * ScreenAmbientContext — carries the current screen's ambient config
 * ({ topic, curve, defaultLux } | null) so widgets like ArtMode dim from the
 * sensor of the room they run in, regardless of how they were mounted
 * (screensaver, triggered scene, or menu).
 */
const ScreenAmbientContext = createContext(null);

export function ScreenAmbientProvider({ value, children }) {
  return (
    <ScreenAmbientContext.Provider value={value ?? null}>
      {children}
    </ScreenAmbientContext.Provider>
  );
}

export function useScreenAmbient() {
  return useContext(ScreenAmbientContext);
}

export default ScreenAmbientContext;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/screen-framework/useScreenAmbient.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/ambient/ScreenAmbientContext.jsx tests/unit/screen-framework/useScreenAmbient.test.jsx
git commit -m "feat(screen): ScreenAmbientProvider + useScreenAmbient context"
```

---

## Task 6: Frontend — wire `ScreenRenderer` to provide screen ambient

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx` (import block near top; render tree at lines 355-378)

No new unit test (provider placement; covered live + by Task 5). Mechanical wiring.

- [ ] **Step 1: Add the import**

Near the other screen-framework imports at the top of `frontend/src/screen-framework/ScreenRenderer.jsx` (e.g. after the `ScreenScreensaver` import on line 20), add:

```js
import { ScreenAmbientProvider } from './ambient/ScreenAmbientContext.jsx';
```

- [ ] **Step 2: Wrap the tree with the provider**

In the returned JSX, wrap the existing `<MenuNavigationProvider>` subtree so overlays (where ArtMode mounts) are inside it. Change:

```jsx
            <MasterVolumeToast />
            <MenuNavigationProvider>
              <ScreenOverlayProvider>
```

to:

```jsx
            <MasterVolumeToast />
            <ScreenAmbientProvider value={config.ambient}>
            <MenuNavigationProvider>
              <ScreenOverlayProvider>
```

and add the matching close tag. Change:

```jsx
              </ScreenOverlayProvider>
            </MenuNavigationProvider>
          </ScreenVolumeProvider>
```

to:

```jsx
              </ScreenOverlayProvider>
            </MenuNavigationProvider>
            </ScreenAmbientProvider>
          </ScreenVolumeProvider>
```

- [ ] **Step 3: Verify the bundle parses**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/screen-framework/useScreenSubscriptions.test.jsx`
Expected: PASS (existing test still green — confirms the screen-framework imports resolve).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(screen): provide config.ambient via ScreenAmbientProvider"
```

---

## Task 7: Frontend — ArtMode consumes per-screen ambient

**Files:**
- Modify: `frontend/src/screen-framework/widgets/ArtMode.jsx` (imports lines 1-11; lines 54-55; lines 165-168)
- Test: `tests/unit/screen-framework/ArtModeAmbient.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/screen-framework/ArtModeAmbient.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// Capture the topics ArtMode subscribes to.
let capturedTopics = null;
vi.mock('../../../frontend/src/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: vi.fn((topics) => { capturedTopics = topics; }),
}));

// Stub the heavy / IO deps so ArtMode mounts cheaply.
vi.mock('../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => new Promise(() => {})), // never resolves: skip load() side effects
  DaylightMediaPath: (p) => `/${p}`,
}));
vi.mock('../../../frontend/src/lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../frontend/src/lib/Player/useBackgroundMusic.js', () => ({
  useBackgroundMusic: () => ({}),
}));

import ArtMode from '../../../frontend/src/screen-framework/widgets/ArtMode.jsx';
import { ScreenAmbientProvider } from '../../../frontend/src/screen-framework/ambient/ScreenAmbientContext.jsx';

const officeAmbient = {
  topic: 'ambient:office',
  defaultLux: 36,
  curve: [{ lux: 0, dim: 0.9 }, { lux: 30, dim: 0.32 }, { lux: 200, dim: 0.05 }],
};

describe('ArtMode ambient subscription', () => {
  beforeEach(() => { capturedTopics = null; });

  it('subscribes to the screen ambient topic, not the hardcoded one', () => {
    render(
      <ScreenAmbientProvider value={officeAmbient}>
        <ArtMode placard={false} />
      </ScreenAmbientProvider>
    );
    expect(capturedTopics).toEqual(['ambient:office']);
  });

  it('falls back to the preset ambient topic when no screen ambient', () => {
    render(
      <ScreenAmbientProvider value={null}>
        <ArtMode placard={false} ambient={{ curve: [{ lux: 0, dim: 0.5 }], defaultLux: 80 }} />
      </ScreenAmbientProvider>
    );
    expect(capturedTopics).toEqual(['ambient']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/screen-framework/ArtModeAmbient.test.jsx`
Expected: FAIL — ArtMode still subscribes to `['ambient']` for the first case (or imports error before edits).

- [ ] **Step 3: Update ArtMode imports**

In `frontend/src/screen-framework/widgets/ArtMode.jsx`, after the `luxToDim` import (line 10) add:

```js
import { useScreenAmbient } from '../ambient/ScreenAmbientContext.jsx';
import { resolveAmbient } from './resolveAmbient.js';
```

- [ ] **Step 4: Resolve ambient inside the component**

Replace lines 54-55:

```js
  const ambientCurve = ambient?.curve ?? null;
  const [autoDim, setAutoDim] = useState(() => (ambientCurve ? luxToDim(ambient?.defaultLux ?? 0, ambientCurve) : 0));
```

with:

```js
  const screenAmbient = useScreenAmbient();
  const resolvedAmbient = useMemo(() => resolveAmbient(screenAmbient, ambient), [screenAmbient, ambient]);
  const ambientCurve = resolvedAmbient?.curve ?? null;
  const ambientTopic = resolvedAmbient?.topic ?? 'ambient';
  const [autoDim, setAutoDim] = useState(() => (ambientCurve ? luxToDim(resolvedAmbient?.defaultLux ?? 0, ambientCurve) : 0));
```

(`useMemo` is already imported on line 2.)

- [ ] **Step 5: Subscribe to the resolved topic**

Replace lines 165-168:

```js
  useWebSocketSubscription(['ambient'], (msg) => {
    if (!ambientCurve || !msg) return;
    setAutoDim(luxToDim(Number(msg.lux), ambientCurve));
  }, [ambientCurve]);
```

with:

```js
  useWebSocketSubscription([ambientTopic], (msg) => {
    if (!ambientCurve || !msg) return;
    setAutoDim(luxToDim(Number(msg.lux), ambientCurve));
  }, [ambientCurve, ambientTopic]);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/screen-framework/ArtModeAmbient.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full art + screen-framework unit suites for regressions**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art tests/unit/screen-framework tests/unit/home-automation`
Expected: PASS (all green).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/screen-framework/widgets/ArtMode.jsx tests/unit/screen-framework/ArtModeAmbient.test.jsx
git commit -m "feat(artmode): dim from per-screen ambient zone"
```

---

## Task 8: Config — ambient.yml zones + screen ambient blocks (data volume)

**Files (data volume, edited in the running container):**
- `data/household/config/ambient.yml`
- `data/household/screens/office.yml`
- `data/household/screens/living-room.yml`

No unit test (runtime config). Verified live in Task 9.

- [ ] **Step 1: Rewrite `ambient.yml` with zones**

Run (writes the full file — never `sed -i` on YAML):

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/ambient.yml << 'EOF'
# Ambient illuminance zones. Each zone broadcasts max(lux) of its sensors on its
# own eventbus topic; the screen config (data/household/screens/*.yml) maps a topic
# to a dim curve tuned for that room's sensor.
zones:
  - topic: ambient            # kitchen — living-room screen
    entities:
      - sensor.kitchen_desk_nightlight_illuminance
      - sensor.kitchen_night_light_illuminance
  - topic: ambient:office     # office screen
    entities:
      - sensor.office_tv_nightlight_illuminance
EOF"
```

- [ ] **Step 2: Verify ambient.yml**

Run: `sudo docker exec daylight-station sh -c 'cat data/household/config/ambient.yml'`
Expected: the zones YAML above (two zones).

- [ ] **Step 3: Confirm office.yml has no existing `ambient:` block, then append one**

Run: `sudo docker exec daylight-station sh -c 'grep -n "^ambient:" data/household/screens/office.yml || echo NONE'`
Expected: `NONE`.

Then append:

```bash
sudo docker exec daylight-station sh -c "cat >> data/household/screens/office.yml << 'EOF'

# Ambient auto-dim: office TV nightlight sensor (~36lx in normal light).
ambient:
  topic: ambient:office
  defaultLux: 36
  curve:
    - { lux: 0,   dim: 0.90 }
    - { lux: 10,  dim: 0.60 }
    - { lux: 30,  dim: 0.32 }
    - { lux: 80,  dim: 0.15 }
    - { lux: 200, dim: 0.05 }
EOF"
```

- [ ] **Step 4: Confirm living-room.yml has no existing `ambient:` block, then append one**

Run: `sudo docker exec daylight-station sh -c 'grep -n "^ambient:" data/household/screens/living-room.yml || echo NONE'`
Expected: `NONE`.

Then append (kitchen sensor topic + the curve presets used until now):

```bash
sudo docker exec daylight-station sh -c "cat >> data/household/screens/living-room.yml << 'EOF'

# Ambient auto-dim: kitchen nightlight sensors (~140lx in normal light).
ambient:
  topic: ambient
  defaultLux: 80
  curve:
    - { lux: 0,   dim: 0.92 }
    - { lux: 5,   dim: 0.85 }
    - { lux: 40,  dim: 0.55 }
    - { lux: 150, dim: 0.32 }
    - { lux: 400, dim: 0.15 }
EOF"
```

- [ ] **Step 5: Verify both screen configs parse and expose ambient via the API**

Run:
```bash
sudo docker exec daylight-station sh -c 'node -e "const y=require(\"js-yaml\");const fs=require(\"fs\");for (const s of [\"office\",\"living-room\"]){const c=y.load(fs.readFileSync(\"data/household/screens/\"+s+\".yml\",\"utf8\"));console.log(s, JSON.stringify(c.ambient))}"'
```
Expected: each screen prints its `ambient` object with `topic`, `defaultLux`, `curve`.

(No git commit — these files live in the data volume, not the repo.)

---

## Task 9: Deploy + live verification

**Files:** none (build/deploy/verify).

- [ ] **Step 1: Confirm working tree is committed**

Run: `git status --porcelain`
Expected: empty (all code committed in Tasks 1-7). If anything remains, commit it before building.

- [ ] **Step 2: Build the image** (hold any unrelated WIP stash until BUILD_OK)

```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  . && echo BUILD_OK
```
Expected: `BUILD_OK`.

- [ ] **Step 3: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```
Expected: container starts; `sudo docker ps | grep daylight-station` shows it running.

- [ ] **Step 4: Confirm both ambient zones started**

Run (wait ~10s after deploy for HA seed):
```bash
sudo docker logs daylight-station 2>&1 | grep -iE "ambient" | tail -20
```
Expected: `ambient.ws.open` and seed/broadcast lines for both topics (`ambient` and `ambient:office`); no `ambient.disabled`.

- [ ] **Step 5: Trigger kids art on the office TV and verify it dims off the office zone**

```bash
curl -s "http://localhost:3111/api/v1/device/office-tv/load?display=art:kids" >/dev/null
sleep 3
sudo docker logs daylight-station 2>&1 | grep -iE "websocket.load.display|commands.display|action.scene.show|artmode" | tail -15
```
Expected: `websocket.load.display` → (frontend) `commands.display` → `action.scene.show {preset: kids}` → `artmode.mount` → `artmode.loaded`.
(If the first dispatch races the post-deploy WS reconnect — only the backend `websocket.load.display` with no frontend reaction — re-run the curl once the office screen has reconnected.)

- [ ] **Step 6: Confirm the office dim tracks the office sensor**

The office ArtMode is now subscribed to `ambient:office`. Sanity-check the sensor value and that the broadcast topic exists:
```bash
sudo docker exec daylight-station sh -c 'TOKEN=$(grep token data/household/auth/homeassistant.yml | cut -d" " -f2) && curl -s http://homeassistant:8123/api/states/sensor.office_tv_nightlight_illuminance -H "Authorization: Bearer $TOKEN" | tr "," "\n" | grep "\"state\""'
```
Expected: a current lux reading (e.g. ~36); the office art's dim corresponds to that lux through the office curve (lux 36 → dim ≈ 0.28). Living-room art (if shown) still tracks the kitchen sensors on `ambient`.

---

## Self-Review

**1. Spec coverage:**
- Multi-zone producer (`ambient.yml` zones, one service per zone, legacy fallback) → Tasks 1, 2, 3, 8. ✓
- Screen config owns the mapping (`ambient` block per screen) → Task 8. ✓
- Frontend per-screen consumer (`ScreenAmbientProvider`/`useScreenAmbient`, ArtMode resolution order screen→preset→none, subscribe to screen topic, keep `luxToDim`/initial-from-`defaultLux`) → Tasks 4, 5, 6, 7. ✓
- Error handling (no block → fallback/no dim; empty zone → disabled; malformed zones dropped) → Tasks 1 (drop), 4 (null→no dim), service unchanged (disabled). ✓
- Testing (zone parse, wiring count, useScreenAmbient, ArtMode topic, live) → Tasks 1, 2, 5, 7, 9. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; every test step has full assertions. ✓

**3. Type consistency:** `normalizeAmbientZones`/`startAmbientZones` signatures match between Tasks 1-3. `resolveAmbient(screenAmbient, presetAmbient)` → `{topic, curve, defaultLux}|null` consistent across Tasks 4 and 7. `ScreenAmbientProvider value=` / `useScreenAmbient()` consistent across Tasks 5, 6, 7. Zone shape `{topic, entities}` consistent across Tasks 1, 2, 3, 8. ✓
