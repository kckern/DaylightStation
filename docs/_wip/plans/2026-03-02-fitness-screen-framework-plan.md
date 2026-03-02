# Fitness Screen-Framework Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the FitnessApp HomeApp plugin with a screen-framework-driven home view, rename "plugin" to "module" throughout, and unify the widget/plugin registries into one namespaced registry with optional metadata.

**Architecture:** FitnessApp embeds screen-framework composable pieces (PanelRenderer + ScreenDataProvider) as its home view — not as a standalone ScreenRenderer. A new ScreenSlotProvider enables in-place panel replacement. All fitness modules register in the unified namespaced widget registry with manifest metadata.

**Tech Stack:** React, screen-framework (PanelRenderer, ScreenDataProvider, WidgetRegistry), YAML config via backend API

**Design doc:** `docs/_wip/plans/2026-03-02-fitness-home-screen-framework-design.md`

---

## Task 1: Extend Widget Registry with Metadata Support

**Files:**
- Modify: `frontend/src/screen-framework/widgets/registry.js`
- Modify: `frontend/src/screen-framework/index.js` (add new exports)

**Step 1: Update registry internals**

Change the internal Map to store `{ component, meta }` tuples. Keep `get()` backward compatible (returns Component). Add `getMeta()` and `list(namespace)`.

```javascript
// frontend/src/screen-framework/widgets/registry.js
export class WidgetRegistry {
  constructor() {
    this.widgets = new Map();
  }

  register(name, component, meta = null) {
    this.widgets.set(name, { component, meta });
  }

  has(name) {
    return this.widgets.has(name);
  }

  get(name) {
    const entry = this.widgets.get(name);
    return entry?.component || null;
  }

  getMeta(name) {
    const entry = this.widgets.get(name);
    return entry?.meta || null;
  }

  list(namespace) {
    const keys = Array.from(this.widgets.keys());
    if (!namespace) return keys;
    const prefix = namespace.endsWith(':') ? namespace : `${namespace}:`;
    return keys.filter(k => k.startsWith(prefix));
  }

  clear() {
    this.widgets.clear();
  }
}

let defaultRegistry = null;

export function getWidgetRegistry() {
  if (!defaultRegistry) {
    defaultRegistry = new WidgetRegistry();
  }
  return defaultRegistry;
}

export function resetWidgetRegistry() {
  defaultRegistry = null;
}
```

**Step 2: Verify builtins still work**

`registerBuiltinWidgets()` in `frontend/src/screen-framework/widgets/builtins.js` calls `registry.register('clock', Time)` — the third `meta` param defaults to `null`, so this is backward compatible. No changes needed.

**Step 3: Export getMeta from index**

In `frontend/src/screen-framework/index.js`, the widget exports at line 37-38 already export `WidgetRegistry`, `getWidgetRegistry`, and `resetWidgetRegistry`. No additional exports needed — `getMeta` is a method on the registry instance.

**Step 4: Commit**

```bash
git add frontend/src/screen-framework/widgets/registry.js
git commit -m "feat(screen-framework): extend widget registry with metadata and namespace support"
```

---

## Task 2: Add ScreenSlotProvider and useSlot Hook

**Files:**
- Create: `frontend/src/screen-framework/slots/ScreenSlotProvider.jsx`
- Modify: `frontend/src/screen-framework/index.js` (add slot exports)

**Step 1: Create the slot provider and hook**

```jsx
// frontend/src/screen-framework/slots/ScreenSlotProvider.jsx
import React, { createContext, useContext, useState, useCallback } from 'react';

const SlotContext = createContext({});

export function ScreenSlotProvider({ children }) {
  const [slots, setSlots] = useState({});

  const showSlot = useCallback((slotName, widget, props = {}) => {
    setSlots(prev => ({ ...prev, [slotName]: { widget, props } }));
  }, []);

  const dismissSlot = useCallback((slotName) => {
    setSlots(prev => {
      const next = { ...prev };
      delete next[slotName];
      return next;
    });
  }, []);

  return (
    <SlotContext.Provider value={{ slots, showSlot, dismissSlot }}>
      {children}
    </SlotContext.Provider>
  );
}

/**
 * useSlot - Control a named slot from any widget.
 *
 * @param {string} slotName - The slot to target (matches `slot:` key in layout config)
 * @returns {{ show: (widget, props?) => void, dismiss: () => void, active: boolean }}
 */
export function useSlot(slotName) {
  const { slots, showSlot, dismissSlot } = useContext(SlotContext);
  return {
    show: (widget, props) => showSlot(slotName, widget, props),
    dismiss: () => dismissSlot(slotName),
    active: Boolean(slots[slotName]),
  };
}

/**
 * useSlotState - Read the current state of a named slot (used by PanelRenderer).
 *
 * @param {string} slotName
 * @returns {{ widget: string, props: object } | null}
 */
export function useSlotState(slotName) {
  const { slots } = useContext(SlotContext);
  return slots[slotName] || null;
}
```

**Step 2: Export from screen-framework index**

Add to `frontend/src/screen-framework/index.js`:

```javascript
// Slot system
export { ScreenSlotProvider, useSlot, useSlotState } from './slots/ScreenSlotProvider.jsx';
```

**Step 3: Commit**

```bash
git add frontend/src/screen-framework/slots/ScreenSlotProvider.jsx frontend/src/screen-framework/index.js
git commit -m "feat(screen-framework): add ScreenSlotProvider and useSlot hook for dynamic panel replacement"
```

---

## Task 3: Extend PanelRenderer with Slot Node Support

**Files:**
- Modify: `frontend/src/screen-framework/panels/PanelRenderer.jsx`

**Step 1: Add slot node handling**

The current PanelRenderer handles two node types: `widget` (leaf) and `children` (branch). Add a third: `slot`. When a slot is active, render the swapped widget. Otherwise render `node.default` as a subtree.

```jsx
// frontend/src/screen-framework/panels/PanelRenderer.jsx
import React from 'react';
import { getWidgetRegistry } from '../widgets/registry.js';
import { useSlotState } from '../slots/ScreenSlotProvider.jsx';
import './PanelRenderer.css';

function themeVars(theme) {
  if (!theme) return {};
  return Object.fromEntries(
    Object.entries(theme).map(([k, v]) => [`--screen-${k}`, v])
  );
}

function flexItemStyle(node) {
  return {
    flexGrow: node.grow ?? 1,
    flexShrink: node.shrink ?? 1,
    flexBasis: node.basis || 'auto',
    overflow: node.overflow || undefined,
  };
}

function SlotNode({ node }) {
  const slotState = useSlotState(node.slot);
  const theme = themeVars(node.theme);

  if (slotState) {
    const registry = getWidgetRegistry();
    const Component = registry.get(slotState.widget);
    if (!Component) return null;

    return (
      <div
        className="screen-panel screen-panel--widget screen-panel--slot-active"
        style={{ ...flexItemStyle(node), ...theme }}
      >
        <Component {...slotState.props} />
      </div>
    );
  }

  // Render default subtree
  if (node.default) {
    return <PanelRenderer node={{ ...node.default, grow: node.grow, shrink: node.shrink, basis: node.basis }} />;
  }

  return null;
}

export function PanelRenderer({ node }) {
  if (!node) return null;

  const theme = themeVars(node.theme);

  // Slot node — dynamic replacement
  if (node.slot) {
    return <SlotNode node={node} />;
  }

  // Leaf node — render widget
  if (node.widget) {
    const registry = getWidgetRegistry();
    const Component = registry.get(node.widget);
    if (!Component) return null;

    return (
      <div
        className="screen-panel screen-panel--widget"
        style={{ ...flexItemStyle(node), ...theme }}
      >
        <Component />
      </div>
    );
  }

  // Branch node — flex container
  if (node.children) {
    return (
      <div
        className="screen-panel"
        style={{
          flexDirection: node.direction || 'row',
          justifyContent: node.justify || undefined,
          alignItems: node.align || 'stretch',
          gap: node.gap || undefined,
          ...flexItemStyle(node),
          ...theme,
        }}
      >
        {node.children.map((child, i) => (
          <PanelRenderer key={child.widget || child.slot || `panel-${i}`} node={child} />
        ))}
      </div>
    );
  }

  return null;
}
```

**Step 2: Commit**

```bash
git add frontend/src/screen-framework/panels/PanelRenderer.jsx
git commit -m "feat(screen-framework): add slot node support to PanelRenderer"
```

---

## Task 4: Rename FitnessPlugins → FitnessModules (Directory + Files)

This is a large mechanical rename. The key files to rename:

**Files:**
- Rename directory: `frontend/src/modules/Fitness/FitnessPlugins/` → `frontend/src/modules/Fitness/FitnessModules/`
- Inside that directory, rename:
  - `plugins/` → `modules/`
  - `FitnessPluginContainer.jsx` → `FitnessModuleContainer.jsx`
  - `FitnessPluginContainer.scss` → `FitnessModuleContainer.scss`
  - `FitnessPluginMenu.jsx` → `FitnessModuleMenu.jsx`
  - `FitnessPluginMenu.scss` → `FitnessModuleMenu.scss`
  - `FitnessPluginErrorBoundary.jsx` → `FitnessModuleErrorBoundary.jsx`
  - `FitnessPluginLoader.jsx` → `FitnessModuleLoader.jsx`
  - `FitnessPluginLoader.scss` → `FitnessModuleLoader.scss`
  - `useFitnessPlugin.js` → `useFitnessModule.js`
  - `usePluginStorage.js` → `useModuleStorage.js`

**Step 1: Rename the top-level directory and subdirectory**

```bash
cd frontend/src/modules/Fitness
git mv FitnessPlugins FitnessModules
cd FitnessModules
git mv plugins modules
```

**Step 2: Rename individual files**

```bash
git mv FitnessPluginContainer.jsx FitnessModuleContainer.jsx
git mv FitnessPluginContainer.scss FitnessModuleContainer.scss
git mv FitnessPluginMenu.jsx FitnessModuleMenu.jsx
git mv FitnessPluginMenu.scss FitnessModuleMenu.scss
git mv FitnessPluginErrorBoundary.jsx FitnessModuleErrorBoundary.jsx
git mv FitnessPluginLoader.jsx FitnessModuleLoader.jsx
git mv FitnessPluginLoader.scss FitnessModuleLoader.scss
git mv useFitnessPlugin.js useFitnessModule.js
git mv usePluginStorage.js useModuleStorage.js
```

**Step 3: Update all internal references**

Every file that imports from `FitnessPlugins/` or references `Plugin` in variable names needs updating. Key files (42 files reference "plugin" — see grep results). The critical ones:

- `FitnessModuleContainer.jsx`: Update imports, CSS class names (`fitness-plugin-*` → `fitness-module-*`), component name, error messages
- `FitnessModuleMenu.jsx`: Update imports, text labels ("Fitness Plugins" → "Fitness Modules"), CSS class names
- `FitnessModuleErrorBoundary.jsx`: Update text ("Plugin Error" → "Module Error")
- `FitnessModuleLoader.jsx`: No text changes needed, just filename
- `useFitnessModule.js`: Rename function `useFitnessPlugin` → `useFitnessModule`
- `useModuleStorage.js`: Rename `PLUGIN_STORAGE_PREFIX` → `MODULE_STORAGE_PREFIX`, value `'fitness_plugin_'` → `'fitness_module_'` (note: this changes localStorage keys — existing stored data won't migrate, which is fine for plugin settings)
- `index.js`: Update all import paths from `./plugins/` → `./modules/`
- `registry.js`: Rename `PLUGIN_REGISTRY` → `MODULE_REGISTRY`, `registerPlugin` → `registerModule`, `getPlugin` → `getModule`, `getPluginManifest` → `getModulManifest`, `listPlugins` → `listModules`

- **FitnessApp.jsx** (lines 10, 34, 712-763, 911-913, 1101-1110):
  - Import: `FitnessPluginContainer` → `FitnessModuleContainer` (update path)
  - State: `activePlugin` → `activeModule`, `setActivePlugin` → `setActiveModule`
  - View: `'plugin'` → `'module'` in all `setCurrentView` and `currentView ===` checks
  - Nav types: `'plugin_menu'` → `'module_menu'`, `'plugin_direct'` → `'module_direct'`, `'plugin'` → `'module'` in `handleNavigate`

- **useFitnessUrlParams.js** (line 10, 42):
  - Comment: `plugin view` → `module view`
  - URL pattern: `/fitness/plugin/:id` → `/fitness/module/:id`

- **FitnessNavbar.jsx/scss**: Any `plugin` CSS classes or nav item type references

- **All module components** that import from parent path (`../../index`, `../registry`, etc.): Update import paths

- **FitnessPlayerOverlay.jsx, FitnessSidebar*, FitnessMenu.jsx**: Update any plugin references

**Step 4: Search for any remaining `plugin` references in the Fitness module tree**

```bash
grep -r "plugin\|Plugin" frontend/src/modules/Fitness/ --include="*.{js,jsx,scss}" -l
```

Fix any remaining references.

**Step 5: Verify the app compiles**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build --mode development 2>&1 | head -30
```

Expected: No import errors.

**Step 6: Commit**

```bash
git add -A frontend/src/modules/Fitness/
git add frontend/src/Apps/FitnessApp.jsx
git add frontend/src/hooks/fitness/useFitnessUrlParams.js
git commit -m "refactor(fitness): rename plugin → module throughout FitnessApp and FitnessModules"
```

---

## Task 5: Migrate Fitness Module Registry to Widget Registry

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessModules/registry.js` (simplify to re-export or bridge)
- Modify: `frontend/src/modules/Fitness/FitnessModules/index.js` (register into widget registry)
- Modify: `frontend/src/modules/Fitness/FitnessModules/FitnessModuleContainer.jsx` (use widget registry)
- Modify: `frontend/src/modules/Fitness/FitnessModules/FitnessModuleMenu.jsx` (use widget registry)

**Step 1: Update index.js to register modules in the widget registry**

Replace the old `registerPlugin()` calls with widget registry registrations using `fitness:` namespace:

```javascript
// frontend/src/modules/Fitness/FitnessModules/index.js
import { getWidgetRegistry } from '../../../screen-framework/widgets/registry.js';

// Import modules
import FitnessChartApp, { manifest as fitnessChartManifest } from './modules/FitnessChartApp/index.jsx';
import CameraViewApp, { manifest as cameraViewManifest } from './modules/CameraViewApp/index.jsx';
import JumpingJackGame, { manifest as jumpingJackManifest } from './modules/JumpingJackGame/index.jsx';
import ComponentShowcase, { manifest as showcaseManifest } from './modules/ComponentShowcase/index.jsx';
import HomeApp, { manifest as homeManifest } from './modules/HomeApp/index.jsx';
import PoseDemo, { manifest as poseDemoManifest } from './modules/PoseDemo/index.jsx';
import VibrationApp, { manifest as vibrationManifest } from './modules/VibrationApp/index.jsx';
import SessionBrowserApp, { manifest as sessionBrowserManifest } from './modules/SessionBrowserApp/index.jsx';
import FitnessSessionApp, { manifest as fitnessSessionManifest } from './modules/FitnessSessionApp/index.jsx';

// Register all fitness modules in the unified widget registry with fitness: namespace
const registry = getWidgetRegistry();

registry.register('fitness:chart', FitnessChartApp, fitnessChartManifest);
registry.register('fitness:camera', CameraViewApp, cameraViewManifest);
registry.register('fitness:jumping-jacks', JumpingJackGame, jumpingJackManifest);
registry.register('fitness:showcase', ComponentShowcase, showcaseManifest);
registry.register('fitness:home', HomeApp, homeManifest);
registry.register('fitness:pose-demo', PoseDemo, poseDemoManifest);
registry.register('fitness:vibration', VibrationApp, vibrationManifest);
registry.register('fitness:session-browser', SessionBrowserApp, sessionBrowserManifest);
registry.register('fitness:session', FitnessSessionApp, fitnessSessionManifest);

// Convenience re-exports for FitnessModuleContainer (bridges old API to new registry)
export function getModule(moduleId) {
  // Try fitness-namespaced first, then legacy ID
  return registry.get(`fitness:${moduleId}`) || registry.get(moduleId);
}

export function getModuleManifest(moduleId) {
  return registry.getMeta(`fitness:${moduleId}`) || registry.getMeta(moduleId);
}

export function listModules() {
  return registry.list('fitness').map(key => {
    const id = key.replace('fitness:', '');
    const meta = registry.getMeta(key);
    return { id, ...meta };
  });
}
```

**Step 2: Update FitnessModuleContainer to use the new exports**

In `FitnessModuleContainer.jsx`, update the import at line 3:

```javascript
// Before
import { getPlugin, getPluginManifest } from './index';
// After
import { getModule, getModuleManifest } from './index';
```

And update the usage at lines 11-12:

```javascript
// Before
const PluginComponent = getPlugin(pluginId);
const manifest = getPluginManifest(pluginId);
// After
const ModuleComponent = getModule(pluginId);
const manifest = getModuleManifest(pluginId);
```

Update the component reference in the render (line 30):
```javascript
// Before
<PluginComponent ... />
// After
<ModuleComponent ... />
```

And the not-found message (line 16):
```javascript
// Before
return <div className="fitness-module-not-found">Plugin not found: {pluginId}</div>;
// After
return <div className="fitness-module-not-found">Module not found: {pluginId}</div>;
```

**Step 3: Update FitnessModuleMenu to use the new exports**

In `FitnessModuleMenu.jsx`, update the import at line 3:

```javascript
// Before
import { listPlugins, getPluginManifest } from './index';
// After
import { listModules, getModuleManifest } from './index';
```

Update all references to `getPluginManifest` → `getModuleManifest` and `listPlugins` → `listModules`.

**Step 4: Delete the old registry.js**

The old `registry.js` with `PLUGIN_REGISTRY` is no longer needed — `index.js` now handles registration directly into the widget registry.

```bash
rm frontend/src/modules/Fitness/FitnessModules/registry.js
```

**Step 5: Verify build**

```bash
npx vite build --mode development 2>&1 | head -30
```

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessModules/
git commit -m "feat(fitness): migrate module registry to unified widget registry with fitness: namespace"
```

---

## Task 6: Create FitnessScreenProvider Context

**Files:**
- Create: `frontend/src/modules/Fitness/FitnessScreenProvider.jsx`

**Step 1: Create the action bridge context**

This thin context bridges widget actions (play, navigate) to FitnessApp's handlers. Widgets use `useFitnessScreen()` to get callbacks.

```jsx
// frontend/src/modules/Fitness/FitnessScreenProvider.jsx
import React, { createContext, useContext } from 'react';

const FitnessScreenContext = createContext(null);

/**
 * FitnessScreenProvider - Bridges screen-framework widgets to FitnessApp actions.
 *
 * @param {Function} props.onPlay - Add item to fitness play queue
 * @param {Function} props.onNavigate - Navigate to show/module/menu
 * @param {Function} props.onCtaAction - Handle coach CTA actions
 */
export function FitnessScreenProvider({ onPlay, onNavigate, onCtaAction, children }) {
  const value = { onPlay, onNavigate, onCtaAction };
  return (
    <FitnessScreenContext.Provider value={value}>
      {children}
    </FitnessScreenContext.Provider>
  );
}

/**
 * useFitnessScreen - Access FitnessApp action callbacks from within a screen-framework widget.
 */
export function useFitnessScreen() {
  const ctx = useContext(FitnessScreenContext);
  if (!ctx) {
    return { onPlay: null, onNavigate: null, onCtaAction: null };
  }
  return ctx;
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessScreenProvider.jsx
git commit -m "feat(fitness): add FitnessScreenProvider context for widget-to-app action bridge"
```

---

## Task 7: Create Fitness Dashboard Widgets

**Files:**
- Create: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessSessionsWidget.jsx`
- Create: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessWeightWidget.jsx`
- Create: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessNutritionWidget.jsx`
- Create: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessUpNextWidget.jsx`
- Create: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessCoachWidget.jsx`
- Create: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/index.js`
- Reference: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/DashboardWidgets.jsx` (reuse existing card components)
- Reference: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/useDashboardData.js` (reuse parsing functions)

These are thin wrapper components that:
1. Pull data via `useScreenData(key)`
2. Parse it using existing functions from `useDashboardData.js`
3. Render existing card components from `DashboardWidgets.jsx`
4. For actions, use `useFitnessScreen()` and `useSlot()`

**Step 1: Create FitnessSessionsWidget**

```jsx
// frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessSessionsWidget.jsx
import React, { useState, useEffect } from 'react';
import { useScreenData } from '../../../../../screen-framework/data/ScreenDataProvider.jsx';
import { useSlot } from '../../../../../screen-framework/slots/ScreenSlotProvider.jsx';
import { WorkoutsCard } from '../DashboardWidgets.jsx';

export default function FitnessSessionsWidget() {
  const rawSessions = useScreenData('sessions');
  const { show } = useSlot('detail-area');
  const [selectedSessionId, setSelectedSessionId] = useState(null);

  const sessions = rawSessions?.sessions || [];

  const handleSessionClick = (sessionId) => {
    setSelectedSessionId(sessionId);
    show('fitness:chart', { sessionId });
  };

  return (
    <WorkoutsCard
      sessions={sessions}
      onSessionClick={handleSessionClick}
      selectedSessionId={selectedSessionId}
    />
  );
}
```

**Step 2: Create FitnessWeightWidget**

```jsx
// frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessWeightWidget.jsx
import React from 'react';
import { useScreenData } from '../../../../../screen-framework/data/ScreenDataProvider.jsx';
import { WeightTrendCard } from '../DashboardWidgets.jsx';
import { Skeleton } from '@mantine/core';

function parseWeightData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const dates = Object.keys(raw).sort().reverse();
  if (!dates.length) return null;
  const latest = raw[dates[0]];
  return {
    current: latest.lbs_adjusted_average || latest.lbs,
    fatPercent: latest.fat_percent_average || latest.fat_percent,
    trend7d: latest.lbs_adjusted_average_7day_trend || null,
  };
}

export default function FitnessWeightWidget() {
  const rawWeight = useScreenData('weight');
  if (!rawWeight) return <Skeleton height={120} />;
  const weight = parseWeightData(rawWeight);
  return <WeightTrendCard weight={weight} />;
}
```

**Step 3: Create FitnessNutritionWidget**

```jsx
// frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessNutritionWidget.jsx
import React from 'react';
import { useScreenData } from '../../../../../screen-framework/data/ScreenDataProvider.jsx';
import { NutritionCard } from '../DashboardWidgets.jsx';
import { Skeleton } from '@mantine/core';

function parseNutritionHistory(raw) {
  if (!raw?.data || typeof raw.data !== 'object') return [];
  return Object.entries(raw.data)
    .filter(([, v]) => v?.nutrition)
    .map(([date, v]) => ({
      date,
      calories: v.nutrition.calories || 0,
      protein: v.nutrition.protein || 0,
      carbs: v.nutrition.carbs || 0,
      fat: v.nutrition.fat || 0,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export default function FitnessNutritionWidget() {
  const rawHealth = useScreenData('nutrition');
  if (!rawHealth) return <Skeleton height={200} />;
  const nutrition = parseNutritionHistory(rawHealth);
  return <NutritionCard nutrition={nutrition} />;
}
```

**Step 4: Create FitnessUpNextWidget**

```jsx
// frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessUpNextWidget.jsx
import React from 'react';
import { useScreenData } from '../../../../../screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '../../../../Fitness/FitnessScreenProvider.jsx';
import { UpNextCard } from '../DashboardWidgets.jsx';
import { parseContentId } from '../useDashboardData.js';
import { DaylightMediaPath } from '../../../../../lib/api.mjs';

export default function FitnessUpNextWidget() {
  const dashboard = useScreenData('dashboard');
  const { onPlay } = useFitnessScreen();

  if (!dashboard?.dashboard?.curated) return null;

  const handlePlay = (contentItem) => {
    if (!contentItem?.content_id || !onPlay) return;
    const { source, localId } = parseContentId(contentItem.content_id);
    onPlay({
      id: localId,
      contentSource: source,
      type: 'episode',
      title: contentItem.title,
      videoUrl: DaylightMediaPath(`api/v1/play/${source}/${localId}`),
      image: DaylightMediaPath(`api/v1/display/${source}/${localId}`),
      duration: contentItem.duration,
    });
  };

  return <UpNextCard curated={dashboard.dashboard.curated} onPlay={handlePlay} />;
}
```

**Step 5: Create FitnessCoachWidget**

```jsx
// frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessCoachWidget.jsx
import React from 'react';
import { useScreenData } from '../../../../../screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '../../../../Fitness/FitnessScreenProvider.jsx';
import { CoachCard } from '../DashboardWidgets.jsx';

export default function FitnessCoachWidget() {
  const dashboard = useScreenData('dashboard');
  const nutrition = useScreenData('nutrition');
  const { onCtaAction } = useFitnessScreen();

  if (!dashboard?.dashboard?.coach) return null;

  return (
    <CoachCard
      coach={dashboard.dashboard.coach}
      liveNutrition={nutrition?.data ? { logged: true } : null}
      onCtaAction={onCtaAction}
    />
  );
}
```

**Step 6: Create widget index and register in widget registry**

```javascript
// frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/index.js
export { default as FitnessSessionsWidget } from './FitnessSessionsWidget.jsx';
export { default as FitnessWeightWidget } from './FitnessWeightWidget.jsx';
export { default as FitnessNutritionWidget } from './FitnessNutritionWidget.jsx';
export { default as FitnessUpNextWidget } from './FitnessUpNextWidget.jsx';
export { default as FitnessCoachWidget } from './FitnessCoachWidget.jsx';
```

Then in `frontend/src/modules/Fitness/FitnessModules/index.js`, add these registrations:

```javascript
// Dashboard widgets (screen-framework compatible)
import {
  FitnessSessionsWidget,
  FitnessWeightWidget,
  FitnessNutritionWidget,
  FitnessUpNextWidget,
  FitnessCoachWidget,
} from './modules/HomeApp/widgets/index.js';

registry.register('fitness:sessions', FitnessSessionsWidget);
registry.register('fitness:weight', FitnessWeightWidget);
registry.register('fitness:nutrition', FitnessNutritionWidget);
registry.register('fitness:upnext', FitnessUpNextWidget);
registry.register('fitness:coach', FitnessCoachWidget);
```

**Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/
git add frontend/src/modules/Fitness/FitnessModules/index.js
git commit -m "feat(fitness): create dashboard widgets for screen-framework integration"
```

---

## Task 8: Add home_screen Config to Backend Fitness API

**Files:**
- Modify: Backend fitness config loader to include `home_screen` layout
- The exact file depends on how the fitness config is assembled. Check:
  - `backend/src/4_api/v1/routers/fitness.mjs`
  - `data/household/config/fitness.yml` or equivalent

**Step 1: Determine where fitness config is assembled**

Read `backend/src/4_api/v1/routers/fitness.mjs` to find the GET handler for `/api/v1/fitness`. The response object needs a new `home_screen` section.

**Step 2: Add `home_screen` to the fitness config YAML**

Add to the fitness configuration file (likely `data/household[-{hid}]/apps/fitness/config.yml` or `data/household/config/fitness.yml`):

```yaml
home_screen:
  theme:
    panel-bg: rgba(255, 255, 255, 0.06)
    panel-radius: 12px
    panel-shadow: 0 4px 16px rgba(0, 0, 0, 0.3)
    panel-border: 1px solid rgba(255, 255, 255, 0.12)
    panel-blur: blur(12px)
    panel-padding: 1rem
    font-family: Roboto Condensed, sans-serif
    font-color: "#e0e0e0"
  data:
    weight:
      source: /api/v1/health/weight
      refresh: 300
    nutrition:
      source: /api/v1/health/daily?days=10
      refresh: 300
    sessions:
      source: /api/v1/fitness/sessions?since=30d&limit=20
      refresh: 300
  layout:
    direction: row
    gap: 1rem
    children:
      - widget: fitness:sessions
        basis: 33%
      - slot: detail-area
        default:
          direction: column
          gap: 0.5rem
          children:
            - widget: fitness:weight
            - widget: fitness:nutrition
      - direction: column
        gap: 0.5rem
        children:
          - widget: fitness:upnext
          - widget: fitness:coach
```

**Step 3: Verify the config appears in API response**

```bash
curl -s http://localhost:3112/api/v1/fitness | jq '.fitness.home_screen.layout.children | length'
```

Expected: `3`

**Step 4: Commit**

```bash
git add data/ backend/
git commit -m "feat(fitness): add home_screen layout config to fitness API response"
```

---

## Task 9: Wire Up Home View in FitnessApp

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`

**Step 1: Add imports**

Add these imports to the top of `FitnessApp.jsx`:

```javascript
import { ScreenDataProvider } from '../screen-framework/data/ScreenDataProvider.jsx';
import { ScreenSlotProvider } from '../screen-framework/slots/ScreenSlotProvider.jsx';
import { PanelRenderer } from '../screen-framework/panels/PanelRenderer.jsx';
import { FitnessScreenProvider } from '../modules/Fitness/FitnessScreenProvider.jsx';
import { registerBuiltinWidgets } from '../screen-framework/widgets/builtins.js';
// Ensure fitness modules are registered in widget registry
import '../modules/Fitness/FitnessModules/index.js';
```

**Step 2: Register builtin widgets on mount**

Inside the `FitnessApp` component, add a one-time registration effect (or call it at module scope):

```javascript
// At module scope (outside component), register builtins once
registerBuiltinWidgets();
```

**Step 3: Extract home screen config from fitness configuration**

Add a `useMemo` to extract the home screen config:

```javascript
const homeScreenConfig = useMemo(() => {
  const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
  return root?.home_screen || null;
}, [fitnessConfiguration]);
```

**Step 4: Add home view handler for play actions**

The `FitnessScreenProvider` needs `onPlay` to add to the queue and `onNavigate` to switch views:

```javascript
const handleHomePlay = useCallback((queueItem) => {
  setFitnessPlayQueue(prev => [...prev, queueItem]);
  const episodeId = String(queueItem.id).replace(/^[a-z]+:/i, '');
  if (episodeId) {
    navigate(`/fitness/play/${episodeId}`, { replace: true });
  }
}, [navigate]);
```

**Step 5: Add home view rendering**

In the render section (around line 1077-1111), add the home view before/alongside the existing menu view:

```jsx
{currentView === 'home' && homeScreenConfig && (
  <FitnessScreenProvider
    onPlay={handleHomePlay}
    onNavigate={handleNavigate}
    onCtaAction={(cta) => logger.info('fitness-cta-action', { action: cta.action })}
  >
    <ScreenDataProvider sources={homeScreenConfig.data || {}}>
      <ScreenSlotProvider>
        <PanelRenderer node={homeScreenConfig.layout} />
      </ScreenSlotProvider>
    </ScreenDataProvider>
  </FitnessScreenProvider>
)}
```

**Step 6: Update currentView init and URL handling**

In `useFitnessUrlParams.js`, add support for `/fitness/home` route:

The URL init effect (line 868-926) already handles `view === 'menu'` as default. Add handling so that when no specific URL view is set and config has `home_screen`, default to `'home'`:

In the nav init effect (line 929-952), if `homeScreenConfig` exists and no active collection/plugin, set view to `'home'` instead of auto-navigating to first nav item:

```javascript
// Replace the auto-navigate to first nav item logic
if (homeScreenConfig && activeCollection == null && activeModule == null && currentView === 'menu') {
  setCurrentView('home');
  navigate('/fitness/home', { replace: true });
  return;
}
```

**Step 7: Verify the home view renders**

Start the dev server, navigate to `/fitness/home`, and confirm the dashboard widgets appear in the 3-column layout.

**Step 8: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx frontend/src/hooks/fitness/useFitnessUrlParams.js
git commit -m "feat(fitness): wire up screen-framework home view in FitnessApp"
```

---

## Task 10: Add Home to Navbar Navigation

**Files:**
- Modify: Backend fitness config to add a `home` nav item
- Modify: `frontend/src/modules/Fitness/FitnessNavbar.jsx` (if needed for home icon/styling)

**Step 1: Add home nav item to fitness config**

In the fitness config's `nav_items` array, add a home entry. The exact format follows the existing nav item pattern (check `sortNavItems` in `frontend/src/modules/Fitness/lib/navigationUtils.js`):

```yaml
nav_items:
  - name: Home
    type: view_direct
    icon: home
    target:
      view: home
    sort_order: -1   # First item
```

**Step 2: Handle `view_direct` for home in FitnessApp**

The `handleNavigate` function already handles `view_direct` (line 765-773). It sets `currentView` to `target.view`. For `home`, this should just work — it will set `currentView` to `'home'` and navigate to `/fitness/home`.

Add the URL navigation for home in the `view_direct` case:

```javascript
case 'view_direct':
  setActiveCollection(null);
  setActiveModule(null);
  setCurrentView(target.view);
  setSelectedShow(null);
  if (target.view === 'users') {
    navigate('/fitness/users', { replace: true });
  } else if (target.view === 'home') {
    navigate('/fitness/home', { replace: true });
  }
  break;
```

**Step 3: Commit**

```bash
git add data/ frontend/src/Apps/FitnessApp.jsx
git commit -m "feat(fitness): add Home to navbar navigation"
```

---

## Task 11: Retire Old HomeApp Module

**Files:**
- Remove: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/HomeApp.jsx` (the old full-page dashboard)
- Keep: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/DashboardWidgets.jsx` (still used by widgets)
- Keep: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/useDashboardData.js` (parseContentId still used)
- Keep: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/HomeApp.scss` (review — may need partial keep for card styles)
- Modify: `frontend/src/modules/Fitness/FitnessModules/index.js` (remove HomeApp module registration)

**Step 1: Remove the HomeApp module registration**

In `index.js`, remove:
```javascript
import HomeApp, { manifest as homeManifest } from './modules/HomeApp/index.jsx';
registry.register('fitness:home', HomeApp, homeManifest);
```

**Step 2: Update HomeApp/index.jsx**

Since the widgets directory now exports the screen-framework-compatible widgets, update the index to only export the pieces still needed:

```javascript
// frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/index.jsx
export { DashboardCard } from './DashboardWidgets.jsx';
export { parseContentId } from './useDashboardData.js';
```

**Step 3: Delete the old HomeApp.jsx**

```bash
rm frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/HomeApp.jsx
rm frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/manifest.js
```

**Step 4: Verify build and test**

```bash
npx vite build --mode development 2>&1 | head -30
```

Navigate to `/fitness/home` — should render via screen-framework widgets, not the old HomeApp component.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessModules/
git commit -m "feat(fitness): retire old HomeApp module, dashboard now powered by screen-framework"
```

---

## Summary

| Task | What | Key Files |
|------|------|-----------|
| 1 | Extend widget registry with metadata | `screen-framework/widgets/registry.js` |
| 2 | Add ScreenSlotProvider + useSlot | `screen-framework/slots/ScreenSlotProvider.jsx` |
| 3 | Extend PanelRenderer with slot nodes | `screen-framework/panels/PanelRenderer.jsx` |
| 4 | Rename FitnessPlugins → FitnessModules | ~42 files across `modules/Fitness/` |
| 5 | Migrate module registry to widget registry | `FitnessModules/index.js`, container, menu |
| 6 | Create FitnessScreenProvider context | `modules/Fitness/FitnessScreenProvider.jsx` |
| 7 | Create dashboard widgets | `HomeApp/widgets/*.jsx` |
| 8 | Add home_screen config to backend | `data/` config files, fitness router |
| 9 | Wire up home view in FitnessApp | `Apps/FitnessApp.jsx` |
| 10 | Add Home to navbar | Config + FitnessApp navigate handler |
| 11 | Retire old HomeApp module | `HomeApp/HomeApp.jsx`, `manifest.js` |
