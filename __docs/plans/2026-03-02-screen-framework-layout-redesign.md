# Screen Framework Layout Redesign — Area / Panel / Widget Taxonomy

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current flat node model (slot/widget/children) with a clear three-level hierarchy (Area → Panel → Widget) and a unified dynamic replacement API.

**Architecture:** Config-driven flex layout with three semantic levels inferred from tree depth. A single `ScreenProvider` context holds the live layout tree and exposes `replace(nodeId, subtree)` / `restore(nodeId)` for dynamic content swapping at any level. The current `ScreenSlotProvider` and slot system are removed entirely.

**Tech Stack:** React context, CSS custom properties, existing WidgetRegistry

---

## Current State

### Files involved
- `frontend/src/screen-framework/panels/PanelRenderer.jsx` — recursive renderer (3 node types: slot, widget, children)
- `frontend/src/screen-framework/panels/PanelRenderer.css` — `.screen-panel`, `.screen-panel--widget`
- `frontend/src/screen-framework/slots/ScreenSlotProvider.jsx` — slot state management (`useSlot`, `useSlotState`)
- `frontend/src/screen-framework/index.js` — barrel exports (v0.3.0)
- `frontend/src/screen-framework/ScreenRenderer.jsx` — standalone screen entry point
- `frontend/src/Apps/FitnessApp.jsx` — fitness home uses `ScreenSlotProvider` + `PanelRenderer`
- `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessSessionsWidget.jsx` — uses `useSlot('detail-area')`

### Current node model (flat)
```
node.slot     → SlotNode (dynamic replacement point with default subtree)
node.widget   → Leaf (renders registered component)
node.children → Branch (flex container, recurse)
```

All three are the same "node" type — no semantic distinction between layout regions, visual containers, and rendered components.

---

## New Taxonomy

### Three levels, inferred from tree structure

| Level | Inferred when | Role | CSS class |
|-------|--------------|------|-----------|
| **Area** | Depth 1 (direct children of `layout`) | Top-level layout region. Owns flex sizing. | `.screen-area` |
| **Panel** | Depth 2+ container, or depth 2+ node with `widget:` | Visual card/container. Owns chrome (bg, border, padding, radius). | `.screen-panel` |
| **Widget** | Leaf node with `widget:` property | Rendered React component. | `.screen-widget` |

### Inference rules
1. `layout.children[*]` → **Area**
2. Any node with `widget:` and no `children:` → **Widget** (auto-wrapped in Panel if parent is Area)
3. Intermediate containers (depth 2+, have `children:`) → **Panel**
4. Override: any node can set `type: area|panel|widget` explicitly

### Addressing (IDs)
- **Explicit:** `id: right-area` in config (preferred for nodes you want to target)
- **Auto-fallback:** path-based IDs generated at render time (`area-0`, `area-1.panel-0`, `area-1.panel-0.widget-0`)
- Only nodes with IDs (explicit or auto) are addressable via `replace`/`restore`

### Full-panel widget (auto-detect)
When a panel has exactly **one** widget child:
- The widget inherits the panel's chrome (border, padding, radius, background)
- The inner `.screen-widget` wrapper suppresses its own chrome (no border-within-border)
- **Opt out:** set `fullPanel: false` on the panel node to keep inner chrome

---

## Dynamic Replacement Interface

### Single provider: `ScreenProvider`

Replaces `ScreenSlotProvider`. Holds the original config tree + active replacement state.

```jsx
<ScreenProvider config={layoutConfig}>
  <PanelRenderer />
</ScreenProvider>
```

### Single hook: `useScreen()`

```jsx
const { replace, restore, getNode } = useScreen();
```

#### `replace(nodeId, subtree)` → revert handle
Replaces the node's entire subtree. The replacement provides its own complete subtree (full subtree replace — the replacement owns everything below it).

Returns a revert handle for stack-like undo.

```jsx
// Replace an area
const r1 = replace('right-area', {
  children: [{ widget: 'fitness:chart', props: { sessionId } }]
});

// Replace a panel
const r2 = replace('weight-panel', {
  widget: 'fitness:trend', props: { range: '90d' }
});

// Stack-like revert (undo last replacement only)
r2.revert();  // weight-panel back to state before r2

// Nuclear reset to original YAML config
restore('right-area');  // clears entire replacement stack for this node
```

#### `restore(nodeId)`
Resets node to its original config-defined state. Clears all replacement history for that node.

#### `getNode(nodeId)` → node state
Returns current state of a node. Useful for conditional logic.

```jsx
const node = getNode('right-area');
if (node.replaced) {
  restore('right-area');
} else {
  replace('right-area', detailSubtree);
}
```

### State model (inside ScreenProvider)

```javascript
{
  originalConfig: { /* full layout tree from YAML */ },
  replacements: {
    // Per-node replacement stack (most recent on top)
    'right-area': [
      { subtree: { children: [...] }, id: 'r1' }
    ],
    'weight-panel': [
      { subtree: { widget: '...', props: {} }, id: 'r2' }
    ]
  }
}
```

`PanelRenderer` reads the merged tree (original + active replacements) from context. When a replacement exists for a node ID, the replacement subtree is rendered instead of the original.

---

## Config Format

Keeps existing YAML shape. Slot nodes removed, `id:` added where needed.

### Before (current)
```yaml
layout:
  direction: row
  gap: 1rem
  children:
    - widget: "fitness:sessions"
      basis: "33%"
    - slot: detail-area
      default:
        direction: column
        gap: 0.5rem
        children:
          - widget: "fitness:weight"
          - widget: "fitness:nutrition"
    - direction: column
      gap: 0.5rem
      children:
        - widget: "fitness:upnext"
        - widget: "fitness:coach"
```

### After (new)
```yaml
layout:
  direction: row
  gap: 1rem
  children:
    - id: left-area
      basis: "33%"
      children:
        - widget: "fitness:sessions"
    - id: right-area
      basis: "66%"
      direction: column
      gap: 0.5rem
      children:
        - direction: row
          gap: 0.5rem
          children:
            - id: weight-panel
              widget: "fitness:weight"
            - widget: "fitness:upnext"
        - direction: row
          gap: 0.5rem
          children:
            - widget: "fitness:nutrition"
            - widget: "fitness:coach"

```

### Changes from current format
- `slot:` and `default:` nodes → removed (replaced by `id:` on any node)
- `id:` → optional on any node, auto-generated if absent
- `fullPanel: false` → optional opt-out for full-panel widget auto-detect
- `type: area|panel|widget` → optional explicit override for inference
- Everything else unchanged: `direction`, `gap`, `basis`, `grow`, `widget`, `children`, `theme`

---

## Rendering Logic

### PanelRenderer rewrite

No longer receives `node` as a prop. Reads from `ScreenProvider` context.

```
PanelRenderer(nodeId)
│
├── Read node from ScreenProvider (original config merged with active replacements)
│
├── Classify node:
│   ├── Has children:  → Container (Area at depth 1, Panel at depth 2+)
│   ├── Has widget:    → Leaf widget
│   └── Both           → Not valid (widget: means leaf, children: means container)
│
├── Container rendering:
│   ├── <div> with flex props (direction, gap, justify, align)
│   ├── If Area (depth 1): .screen-area class, area sizing (basis, grow, shrink)
│   ├── If Panel (depth 2+): .screen-panel class, panel chrome via theme vars
│   └── Recurse into children
│
└── Leaf rendering:
    ├── Look up widget in WidgetRegistry
    ├── Full-panel detection:
    │   ├── Am I the only child of my parent?
    │   │   YES + parent hasn't set fullPanel:false
    │   │   → .screen-widget--full (no inner chrome)
    │   │   NO → .screen-widget (inner chrome applied)
    └── Render component with props from node
```

### CSS changes

```css
/* Area — layout region, no visual chrome */
.screen-area {
  display: flex;
  min-width: 0;
  min-height: 0;
}

/* Panel — visual container with chrome */
.screen-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  background: var(--screen-panel-bg, transparent);
  border-radius: var(--screen-panel-radius, 0);
  box-shadow: var(--screen-panel-shadow, none);
  padding: var(--screen-panel-padding, 0);
  border: var(--screen-panel-border, none);
  backdrop-filter: var(--screen-panel-blur, none);
  font-family: var(--screen-font-family, inherit);
  color: var(--screen-font-color, inherit);
}

/* Widget — inner wrapper */
.screen-widget {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  flex-direction: column;
  display: flex;
}

/* Full-panel widget — merge chrome with panel, suppress inner wrapper */
.screen-widget--full {
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
}
```

---

## Module Integration

FitnessModules become widgets from the screen-framework's perspective. Inside, they own their world:

- **Custom CSS:** Module defines its own styles (e.g., `.camera-layout-full`). The screen-framework's container just gives it a flex box.
- **Nested screen-framework:** A module can nest its own `<ScreenProvider>` + `<PanelRenderer>` for sub-layouts. Separate context = no conflicts.
- **Mixed:** Part screen-framework, part custom CSS.

Widgets rendered by the screen-framework receive a `mode` prop so modules can adapt if needed. The module interface will be redesigned as needed to fit cleanly.

---

## Migration Path

| Component | Change | Effort |
|-----------|--------|--------|
| `ScreenSlotProvider` | **Delete** — replaced by `ScreenProvider` | Remove file |
| `useSlot` / `useSlotState` | **Delete** — replaced by `useScreen()` | Remove file |
| `ScreenProvider` (new) | **Create** — holds config tree + replacement state | New file |
| `PanelRenderer` | **Rewrite** — read from context, classify nodes, full-panel detect | Moderate |
| `PanelRenderer.css` | **Rewrite** — `.screen-area`, `.screen-panel`, `.screen-widget`, `.screen-widget--full` | Small |
| `ScreenDataProvider` | **No change** | None |
| `ScreenOverlayProvider` | **No change** | None |
| `WidgetRegistry` | **No change** | None |
| `ScreenRenderer` | **Update** — swap `ScreenSlotProvider` for `ScreenProvider` | Small |
| `FitnessApp.jsx` | **Update** — swap `ScreenSlotProvider` for `ScreenProvider`, pass config | Small |
| `FitnessSessionsWidget` | **Update** — `useSlot()` → `useScreen().replace()` | Small |
| `fitness.yml` config | **Update** — remove `slot:`/`default:`, add `id:` fields | Small |
| `index.js` barrel | **Update** — export `ScreenProvider`, `useScreen` instead of slot exports | Small |

### Migration order
1. Create `ScreenProvider` with `replace`/`restore`/`getNode`
2. Rewrite `PanelRenderer` to read from context + full-panel detection
3. Update CSS (`.screen-area`, `.screen-panel`, `.screen-widget`)
4. Update `FitnessApp.jsx` and widget consumers
5. Update `fitness.yml` config (remove slots, add IDs)
6. Delete slot files
7. Update barrel exports

### No breaking changes to
Data layer, overlay system, input system, widget registry, any non-fitness screen configs (they get auto-IDs and work as before).
