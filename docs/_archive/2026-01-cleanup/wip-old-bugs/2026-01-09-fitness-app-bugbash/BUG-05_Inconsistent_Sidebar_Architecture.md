# BUG-05: Inconsistent Sidebar Architecture (Chart App)

**Date Reported:** 2026-01-09  
**Category:** 👆 Interaction & Core Architecture  
**Priority:** Medium  
**Status:** Open

---

## Summary

The Chart App displays different layouts depending on how it is accessed:
- Opening from **Fitness Plugins Menu** = No Sidebar
- Opening from **Nav Footer** = Includes Sidebar (better UI)

## Expected Behavior

The Sidebar should be a common, reusable UI element that can be attached to any app or plugin with explicit logic for which plugins should inherit it.

## Current Behavior

The Sidebar appears to be bound specifically to the "Fitness Player" context rather than being a standalone component that any plugin can use.

---

## Technical Analysis

### Relevant Components

| File | Purpose |
|------|---------|
| [`FitnessPlayerSidebar.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerSidebar.jsx) | Player-bound sidebar wrapper |
| [`FitnessSidebar.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessSidebar.jsx) | Core sidebar component |
| [`FitnessPluginContainer.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlugins/FitnessPluginContainer.jsx) | Plugin loading container |
| [`FitnessPluginMenu.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlugins/FitnessPluginMenu.jsx) | Plugin menu display |
| [`FitnessNavbar.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessNavbar.jsx) | Navigation footer with sidebar footer |

### Architecture Issue

**Current Structure:**

```
FitnessPlayer
└── FitnessPlayerSidebar (always present when player active)
    └── FitnessPluginContainer (pluginId="fitness_session")
        └── [Active Plugin Component]

vs.

FitnessApp (via Plugin Menu)
└── FitnessPluginContainer (standalone mode)
    └── FitnessChartApp (NO sidebar)
```

The sidebar is rendered inside `FitnessPlayer.jsx` (lines 1396-1410):

```jsx
<div
  className={`fitness-player-sidebar ${sidebarSide}`}
  style={{ width: sidebarRenderWidth }}
>
  <div className="sidebar-content">
    <FitnessPluginContainer pluginId="fitness_session" mode="standalone" />
  </div>
</div>
```

But when plugins are opened from the Plugin Menu, they use `FitnessPluginContainer` directly without the sidebar wrapper:

```jsx
// In FitnessPluginContainer.jsx
const FitnessPluginContainer = ({ pluginId, mode = 'standalone', onClose, config = {} }) => {
  // Renders plugin directly without sidebar consideration
  return (
    <div className={`fitness-plugin-container mode-${mode}`}>
      <PluginComponent mode={mode} onClose={onClose} ... />
    </div>
  );
};
```

### Navigation Path Difference

**Path A (With Sidebar):**
1. FitnessNavbar → onNavigate → opens Chart in Player context
2. FitnessPlayer wrapper provides sidebar

**Path B (Without Sidebar):**
1. FitnessPluginMenu → onPluginSelect → opens Chart app directly
2. No sidebar wrapper provided

---

## Recommended Fix

### Option A: Plugin Manifest Sidebar Declaration (Preferred)

Add a `sidebar` property to plugin manifests:

```javascript
// In plugin manifest (e.g., FitnessChartApp manifest)
export const manifest = {
  id: 'fitness_chart',
  name: 'Chart App',
  sidebar: true,           // ← Declares sidebar requirement
  sidebarPosition: 'right', // ← Optional: left/right
  // ... other manifest properties
};
```

Update `FitnessPluginContainer.jsx` to conditionally wrap with sidebar:

```jsx
const FitnessPluginContainer = ({ pluginId, mode, onClose, config }) => {
  const manifest = getPluginManifest(pluginId);
  const needsSidebar = manifest?.sidebar && mode !== 'minimal';
  
  if (needsSidebar) {
    return (
      <PluginWithSidebar manifest={manifest} mode={mode}>
        <PluginComponent mode={mode} onClose={onClose} config={config} />
      </PluginWithSidebar>
    );
  }
  
  return (
    <div className={`fitness-plugin-container mode-${mode}`}>
      <PluginComponent mode={mode} onClose={onClose} config={config} />
    </div>
  );
};
```

### Option B: Create Shared Sidebar Layout Component

Extract sidebar as a standalone layout component:

```jsx
// New: shared/layouts/WithSidebar.jsx
const WithSidebar = ({ children, sidebarContent, position = 'right' }) => {
  return (
    <div className={`with-sidebar sidebar-${position}`}>
      <div className="main-content">{children}</div>
      <aside className="sidebar-panel">{sidebarContent}</aside>
    </div>
  );
};
```

### Option C: Mode-Based Rendering in Plugin

Let individual plugins request sidebar through mode prop:

```jsx
// In FitnessChartApp.jsx
const FitnessChartApp = ({ mode, onClose, config }) => {
  const wrapWithSidebar = mode === 'full' || mode === 'with-sidebar';
  
  if (wrapWithSidebar) {
    return <SidebarLayout><ChartContent /></SidebarLayout>;
  }
  return <ChartContent />;
};
```

---

## Files to Modify

1. **Primary**: [`FitnessPluginContainer.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlugins/FitnessPluginContainer.jsx) - Add sidebar-aware rendering
2. **Plugin Manifests**: Update manifests to declare sidebar needs
3. **Create**: New shared sidebar layout component if using Option B
4. **Consider**: Extract sidebar logic from `FitnessPlayerSidebar.jsx` into reusable component

---

## Verification Steps

1. Open Fitness App
2. Navigate to Chart App via Fitness Plugins Menu
3. Verify sidebar is present (after fix)
4. Navigate to Chart App via Nav Footer
5. Verify identical sidebar layout
6. Test with other plugins (should respect their manifest settings)

---

## Impact Analysis

| Plugin | Current Sidebar | Expected Sidebar |
|--------|-----------------|------------------|
| Chart App | Inconsistent | Yes |
| Music Player | Via Player | Yes |
| Session Browser | Unknown | TBD |
| Component Showcase | No | No (dev tool) |

---

*For testing, assign to: QA Team*  
*For development, assign to: Frontend Architecture Team*
