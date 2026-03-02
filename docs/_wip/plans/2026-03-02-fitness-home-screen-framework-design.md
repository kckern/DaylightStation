# Fitness Home Screen-Framework Integration Design

**Date:** 2026-03-02
**Status:** Draft

## Summary

Replace the FitnessApp HomeApp plugin with a screen-framework-driven home view. Rename "plugin" to "module" throughout. Unify the widget and plugin registries into a single namespaced widget registry with optional metadata. Add dynamic slot capability to the screen-framework for in-place panel replacement.

## Goals

1. **Layout flexibility** — Config-driven (YAML) layout so widgets can be rearranged without code changes
2. **Reuse existing widgets** — Mix fitness widgets with general-purpose ones (clock, weather, health, etc.)
3. **Unified kiosk UX** — Same theming, layout engine, and widget patterns as other screen-framework displays
4. **Replace plugin terminology** — "Plugin" is inaccurate; rename to "module" throughout FitnessApp
5. **One registry** — Merge the screen widget registry and fitness plugin registry into one namespaced registry with optional manifest metadata

## Architecture

### View System

FitnessApp's `currentView` state cycles between views:

| View | What renders | Driven by |
|------|-------------|-----------|
| `'home'` | Screen-framework (`ScreenDataProvider` + `PanelRenderer`) | Config embedded in fitness API response |
| `'menu'` | `FitnessMenu` | Hardcoded component |
| `'show'` | `FitnessShow` | Hardcoded component |
| `'module'` | Standalone module (chart, game, vibration, etc.) | Module registry (renamed from plugin) |

The **player** remains an overlay on top of everything (unchanged).

### Screen Inside FitnessApp

The screen-framework's `ScreenRenderer` is designed for standalone routes (like `/screen/office`). In FitnessApp, the screen lives *inside* the app as one of its view panels — not as the root.

When `currentView === 'home'`, FitnessApp mounts the composable pieces directly:

```jsx
<FitnessScreenProvider onPlay={handlePlay} onNavigate={handleNavigate}>
  <ScreenDataProvider config={homeScreenConfig}>
    <ScreenSlotProvider>
      <PanelRenderer layout={homeScreenConfig.layout} />
    </ScreenSlotProvider>
  </ScreenDataProvider>
</FitnessScreenProvider>
```

FitnessApp keeps owning: navigation, play queue overlay, kiosk mode, FitnessContext.

### Config Source

The home screen config is embedded in the `/api/v1/fitness` response under a `home_screen` key:

```json
{
  "fitness": {
    "users": { ... },
    "content": { ... },
    "home_screen": {
      "theme": { ... },
      "data": {
        "weight": { "source": "/api/v1/health/weight", "refresh": 300 },
        "nutrition": { "source": "/api/v1/health/daily?days=10", "refresh": 300 },
        "sessions": { "source": "/api/v1/fitness/sessions?since=30d&limit=20", "refresh": 300 },
        "dashboard": { "source": "/api/v1/health-dashboard/{userId}", "refresh": 300 }
      },
      "layout": {
        "direction": "row",
        "gap": "1rem",
        "children": [
          { "widget": "fitness:sessions", "basis": "33%" },
          {
            "slot": "detail-area",
            "default": {
              "direction": "column",
              "gap": "0.5rem",
              "children": [
                { "widget": "fitness:weight" },
                { "widget": "fitness:nutrition" }
              ]
            }
          },
          {
            "direction": "column",
            "gap": "0.5rem",
            "children": [
              { "widget": "fitness:upnext" },
              { "widget": "fitness:coach" }
            ]
          }
        ]
      }
    }
  }
}
```

---

## Unified Namespaced Widget Registry

### Problem: Two Registries

Today there are two separate registries that don't talk to each other:

| | Screen Widget Registry | Fitness Plugin Registry |
|---|---|---|
| **Storage** | `Map<string, Component>` | `Object<id, {default, manifest}>` |
| **Used by** | `PanelRenderer` | `FitnessPluginContainer` |
| **Metadata** | None | Rich manifest (modes, requirements, dimensions) |

### Solution: Extend Widget Registry

One registry with namespaced keys and optional metadata. Backward-compatible API:

```javascript
// Builtins — no metadata needed (always widget-compatible)
registry.register('clock', TimeComponent);
registry.register('weather', WeatherComponent);

// Fitness modules — with manifest metadata
registry.register('fitness:chart', FitnessChartApp, {
  modes: { standalone: true, overlay: true, sidebar: true, mini: true },
  requires: { participants: true, heartRate: true },
  dimensions: { mini: { width: 200, height: 150 } }
});

registry.register('fitness:jumping-jacks', JumpingJackGame, {
  modes: { standalone: true, overlay: true, sidebar: false, mini: false },
  requires: { sessionActive: true, camera: true },
  category: 'games'
});

// Backward-compatible accessors
registry.get('fitness:chart');      // → Component (unchanged API)
registry.getMeta('fitness:chart');  // → { modes, requires, ... } or null
registry.has('fitness:chart');      // → true
registry.list();                    // → ['clock', 'weather', ..., 'fitness:chart', ...]
registry.list('fitness');           // → ['fitness:chart', 'fitness:sessions', ...] (namespace filter)
```

### Internal Storage Change

```javascript
// Before: Map<string, Component>
// After:  Map<string, { component, meta }>

get(name) {
  const entry = this.widgets.get(name);
  return entry?.component || null;  // backward compat
}

getMeta(name) {
  const entry = this.widgets.get(name);
  return entry?.meta || null;
}
```

### Namespace Convention

| Namespace | Scope | Examples |
|-----------|-------|---------|
| *(none)* | General-purpose builtins | `clock`, `weather`, `calendar`, `finance`, `health` |
| `fitness:` | Fitness domain modules | `fitness:chart`, `fitness:sessions`, `fitness:jumping-jacks` |

Additional namespaces can be added later (e.g., `media:`, `admin:`) as other apps adopt the screen-framework.

### Module Classification

Not all fitness modules are the same. The manifest's `modes` field determines how each can be used:

| Module | Registry key | Widget in layout? | Fullscreen? | Panel/sidebar? | Nature |
|--------|-------------|:-:|:-:|:-:|--------|
| FitnessChartApp | `fitness:chart` | mini | standalone, overlay | sidebar | Widget-compatible |
| VibrationApp | `fitness:vibration` | — | standalone | overlay, sidebar | Widget-compatible |
| CameraViewApp | `fitness:camera` | mini | standalone | sidebar | Panel in broader context |
| FitnessSessionApp | `fitness:session` | — | standalone | — | Full standalone experience |
| SessionBrowserApp | `fitness:session-browser` | — | standalone | — | Standalone browse view |
| JumpingJackGame | `fitness:jumping-jacks` | — | standalone, overlay | — | Full-screen game |
| PoseDemo | `fitness:pose-demo` | — | standalone, overlay | sidebar | Full-screen game |
| ComponentShowcase | `fitness:showcase` | — | standalone | — | Dev tool |

**HomeApp is retired** — replaced by the screen-framework home layout.

### Fitness Home Dashboard Widgets (new, extracted from HomeApp)

These are new widget-only components extracted from the current HomeApp, registered as screen-framework widgets:

| Registry key | Component | Data key | Description |
|-------------|-----------|----------|-------------|
| `fitness:sessions` | WorkoutsCard (refactored) | `sessions` | Recent session history, triggers slot swap |
| `fitness:weight` | WeightTrendCard (refactored) | `weight` | Current weight + 7d trend |
| `fitness:nutrition` | NutritionCard (refactored) | `nutrition` | 10-day calorie/macro history |
| `fitness:upnext` | UpNextCard (refactored) | `dashboard` | Curated next workout with play button |
| `fitness:coach` | CoachCard (refactored) | `dashboard` | AI coach briefing + CTAs |

---

## Widget Data Flow

All widgets get data through `useScreenData(key)`:

```jsx
function FitnessWeightWidget() {
  const weightData = useScreenData('weight');
  if (!weightData) return <Skeleton />;
  const weight = parseWeightData(weightData);
  return <WeightTrendCard weight={weight} />;
}
```

Data sources are defined in the config's `data:` section and fetched/refreshed by `ScreenDataProvider`.

## Widget Actions

Fitness widgets need to trigger FitnessApp actions (play content, navigate). A thin `FitnessScreenContext` bridges this:

```jsx
// In a widget
const { onPlay } = useFitnessScreen();
<button onPointerDown={() => onPlay(item)}>Play</button>
```

---

## Dynamic Slots (New Screen-Framework Feature)

### Problem

PanelRenderer currently renders a static layout tree. The fitness home needs in-place panel replacement (clicking a session replaces the weight/nutrition column with a session chart).

### Solution: Slot Context Hook

Add a `ScreenSlotProvider` context and `useSlot()` hook to the screen-framework.

**Config format:**
```yaml
children:
  - widget: fitness:sessions
    basis: 33%
  - slot: detail-area
    default:
      direction: column
      children:
        - widget: fitness:weight
        - widget: fitness:nutrition
```

**PanelRenderer behavior:**
- When encountering a `slot:` node, render default children normally
- Subscribe to `ScreenSlotProvider` state for that slot name
- When slot is activated, replace default children with the specified widget + props

**Widget API:**
```jsx
const { show, dismiss } = useSlot('detail-area');

// Trigger swap
const handleSessionClick = (sessionId) => {
  show('fitness:chart', { sessionId });
};

// Dismiss returns to default
<button onPointerDown={dismiss}>Back to dashboard</button>
```

**State shape:**
```javascript
{
  'detail-area': null,  // showing default
  // or
  'detail-area': { widget: 'fitness:chart', props: { sessionId: '...' } }
}
```

**PanelRenderer implementation:**
```jsx
if (node.slot) {
  const slotState = useSlotState(node.slot);
  if (slotState) {
    const Widget = widgetRegistry.get(slotState.widget);
    return <Widget {...slotState.props} />;
  }
  return renderNode(node.default);
}
```

---

## Rename: Plugin to Module

### FitnessApp.jsx Changes

| Current | New |
|---------|-----|
| `activePlugin` state | `activeModule` |
| `setActivePlugin` | `setActiveModule` |
| `currentView === 'plugin'` | `currentView === 'module'` |
| `FitnessPluginContainer` | `FitnessModuleContainer` |
| URL: `/fitness/plugin/:id` | `/fitness/module/:id` |

### Navigation Type Strings

| Current | New |
|---------|-----|
| `plugin_menu` | `module_menu` |
| `plugin_direct` | `module_direct` |
| `plugin` | `module` |

### File/Directory Renames

| Current | New |
|---------|-----|
| `FitnessPlugins/` | `FitnessModules/` |
| `FitnessPluginContainer.jsx` | `FitnessModuleContainer.jsx` |
| `FitnessPluginMenu.jsx` | `FitnessModuleMenu.jsx` |
| `plugins/` subdirectory | `modules/` |
| `registry.js` (plugin registry) | Retired — merged into screen-framework widget registry |
| `index.js` (auto-registration) | Updated to register into widget registry with `fitness:` namespace |

### What Stays the Same

- Individual module component names (FitnessChartApp, JumpingJackGame, etc.)
- Manifest format (becomes the `meta` parameter in widget registry registration)
- Module display modes: `standalone`, `sidebar`, `overlay`, `mini`

---

## Migration Path

### Phase 1: Extend Widget Registry
- Add optional `meta` parameter to `register()`
- Add `getMeta()` accessor
- Add `list(namespace)` namespace filtering
- Backward compatible — existing `get()` and `register()` calls unchanged

### Phase 2: Dynamic Slot Feature
- Add `ScreenSlotProvider` and `useSlot()` hook to screen-framework
- Extend PanelRenderer to handle `slot:` nodes
- Test with mock widgets

### Phase 3: Plugin-to-Module Rename
- Rename `FitnessPlugins/` → `FitnessModules/`
- Rename container, menu, registry files
- Update state variables, URL routes, nav type strings in FitnessApp.jsx
- Update imports throughout

### Phase 4: Migrate Modules to Widget Registry
- Register all fitness modules into the widget registry with `fitness:` namespace
- Attach manifest as metadata via `register(name, component, manifest)`
- Update `FitnessModuleContainer` to look up from widget registry instead of old plugin registry
- Retire old plugin `registry.js`

### Phase 5: Fitness Dashboard Widgets
- Extract HomeApp's DashboardWidgets into standalone screen-framework widgets
- Refactor to use `useScreenData()` instead of `useDashboardData`
- Register as `fitness:sessions`, `fitness:weight`, `fitness:nutrition`, `fitness:upnext`, `fitness:coach`

### Phase 6: FitnessApp Home View
- Add `home_screen` config to backend fitness API response
- Mount `ScreenDataProvider` + `ScreenSlotProvider` + `PanelRenderer` when `currentView === 'home'`
- Wire `FitnessScreenProvider` for play/navigate actions
- Add 'home' to navbar navigation

### Phase 7: Retire HomeApp Module
- Remove `FitnessModules/modules/HomeApp/`
- Remove `useDashboardData.js` (data now via ScreenDataProvider)
- Clean up widget registration entry
