# Fitness Navigation System Redesign

**Date:** December 27, 2025  
**Status:** Proposal  
**Author:** System Analysis

---

## Executive Summary

The current fitness navigation system was originally designed for a single content type (Plex collections), but has evolved to support multiple navigation targets including:
- Plex media collections (videos/shows)
- App menus (intermediary menus for plugins)
- Direct plugin access (desired: home button → fitness_chart)

The current data model does not support this flexibility, requiring a redesign to accommodate diverse navigation patterns.

---

## Current System Analysis

### 1. Navigation Flow (As Implemented)

```
┌─────────────────────────────────────────────────────────────┐
│                    FitnessNavbar.jsx                        │
│         Renders items from config.yml collections           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────┴───────────────┐
              │                               │
     onContentSelect('collection', {...})     │
              │                               │
              ▼                               ▼
      ┌───────────────┐              ┌───────────────────┐
      │ FitnessMenu   │              │ FitnessPluginMenu │
      │ (Plex Shows)  │              │   (App List)      │
      └───────────────┘              └───────────────────┘
              │                               │
              ▼                               ▼
      onContentSelect('show')       onContentSelect('plugin')
              │                               │
              ▼                               ▼
      ┌───────────────┐              ┌───────────────────┐
      │ FitnessShow   │              │FitnessPluginCntr  │
      │  (Player)     │              │   (Standalone)    │
      └───────────────┘              └───────────────────┘
```

### 2. Current Data Structure

**config.yml:**
```yaml
plex:
  collections:
    - id: 671468
      name: Favorites
      icon: star
    - id: 364853
      name: Strength
      icon: weights
    # ... more Plex collections
    - id: app_menu1        # ← Mixed type: references app_menu
      name: Fitness Apps
      icon: apps
      
  app_menus:
    - name: Fitness Apps
      id: app_menu1
      items:
        - name: Fitness Chart
          id: fitness_chart
        - name: Camera View
          id: camera_view
```

### 3. Current Limitations

#### Problem 1: Type Ambiguity
- Collections array mixes Plex collection IDs (integers) with app menu IDs (strings)
- No explicit `type` field to distinguish navigation targets
- Logic must infer type based on ID matching against `app_menus`

#### Problem 2: No Direct Plugin Access
- Cannot add a "Home" button that goes directly to a plugin
- Must always go through an intermediary menu
- Navbar expects all items to be either collections or app_menus

#### Problem 3: Tight Coupling
```jsx
// FitnessNavbar always calls:
onContentSelect('collection', collection)

// FitnessMenu then determines:
if (activeAppMenu) {
  return <FitnessPluginMenu />
} else {
  return <Plex shows list />
}
```

This coupling makes it impossible to:
- Add direct links to plugins
- Add custom action buttons (e.g., "Settings", "History")
- Support future content types without major refactoring

#### Problem 4: Header/Footer Position Constraints
- Navbar header is currently empty (`<div className="navbar-header"></div>`)
- Footer is fixed with SidebarFooter component
- No structured way to add items to these positions

---

## Proposed Solution: Universal Navigation Items

### 1. New Data Structure

Replace `collections` array with unified `nav_items` - a flat list with explicit types:

```yaml
plex:
  library_id: 6
  
  # Unified navigation structure (flat list, rendered in order)
  nav_items:
    - type: plugin_direct
      name: Home
      icon: home
      order: 0                    # Optional: explicit ordering
      className: nav-home         # Optional: custom CSS class
      target:
        plugin_id: fitness_chart
    
    - type: plex_collection
      name: Favorites
      icon: star
      order: 10
      target:
        collection_id: 671468
    
    - type: plex_collection
      name: Strength
      icon: weights
      order: 20
      target:
        collection_id: 364853
    
    - type: plex_collection_group
      name: TV Shows
      icon: tv
      target:
        collection_ids: [672868, 672379]
    
    - type: plugin_menu
      name: Fitness Apps
      icon: apps
      target:
        menu_id: app_menu1
    
    - type: view_direct
      name: Camera
      icon: camera
      order: 999                  # Push to end
      className: nav-camera-view
      target:
        view: users
  
  # App menus remain separate (referenced by nav_items)
  app_menus:
    - id: app_menu1
      name: Fitness Apps
      items:
        - name: Fitness Chart
          id: fitness_chart
        - name: Camera View
          id: camera_view
        - name: Jumping Jack Game
          id: jumping_jack_game
```

**Optional Fields:**
- `order` (number): Explicit sort order. Items without `order` maintain array position.
- `className` (string): Custom CSS class in addition to default `nav-item--${type}` class.

**Note**: Visual positioning (header/footer/main) is handled via CSS classes based on item type, custom className, or order value, not in configuration.

### 2. Navigation Item Schema

**Required Fields:**
- `type` (string): Navigation item type (see table below)
- `name` (string): Display name
- `icon` (string): Icon identifier
- `target` (object): Type-specific target configuration

**Optional Fields:**
- `order` (number): Sort order (lower = earlier)
- `className` (string): Custom CSS class

**Navigation Item Types:**

| Type | Description | Target Structure | Deep Link Pattern |
|------|-------------|------------------|-------------------|
| `plex_collection` | Single Plex collection | `{ collection_id: 671468 }` | `#/fitness/collection/:id` |
| `plex_collection_group` | Multiple collections merged | `{ collection_ids: [672868, 672379] }` | `#/fitness/collections/:ids` |
| `plugin_menu` | Menu of plugins | `{ menu_id: "app_menu1" }` | `#/fitness/menu/:id` |
| `plugin_direct` | Direct plugin launch | `{ plugin_id: "fitness_chart", config?: {} }` | `#/fitness/plugin/:id` |
| `view_direct` | Switch to app view | `{ view: "users" \| "menu" }` | `#/fitness/view/:view` |
| `custom_action` | Custom behavior | `{ action: string, params?: {} }` | N/A |

---

## Implementation Strategy

### Phase 1: Create Navigation Utilities

Create helper functions for navigation item processing:

```javascript
// frontend/src/modules/Fitness/lib/navigationUtils.js

/**
 * Sort navigation items by order field, falling back to array position
 */
export function sortNavItems(navItems) {
  return [...navItems].sort((a, b) => {
    const orderA = a.order ?? navItems.indexOf(a);
    const orderB = b.order ?? navItems.indexOf(b);
    return orderA - orderB;
  });
}

/**
 * Generate CSS class names for a nav item
 */
export function getNavItemClasses(item, isActive = false) {
  return [
    'nav-item',
    `nav-item--${item.type}`,
    item.className,
    isActive && 'nav-item--active'
  ].filter(Boolean).join(' ');
}

/**
 * Determine if a nav item is currently active
 */
export function isNavItemActive(item, currentState) {
  const { currentView, activeCollection, activePlugin } = currentState;
  
  switch (item.type) {
    case 'plex_collection':
      return String(activeCollection) === String(item.target.collection_id);
      
    case 'plex_collection_group':
      if (Array.isArray(activeCollection)) {
        return item.target.collection_ids.some(id => 
          activeCollection.includes(id)
        );
      }
      return item.target.collection_ids.includes(activeCollection);
      
    case 'plugin_menu':
      return String(activeCollection) === String(item.target.menu_id);
      
    case 'plugin_direct':
      return currentView === 'plugin' && 
             activePlugin?.id === item.target.plugin_id;
      
    case 'view_direct':
      return currentView === item.target.view;
      
    default:
      return false;
  }
}

/**
 * Generate deep link URL for a nav item
 */
export function getNavItemDeepLink(item) {
  switch (item.type) {
    case 'plex_collection':
      return `#/fitness/collection/${item.target.collection_id}`;
      
    case 'plex_collection_group':
      return `#/fitness/collections/${item.target.collection_ids.join(',')}`;
      
    case 'plugin_menu':
      return `#/fitness/menu/${item.target.menu_id}`;
      
    case 'plugin_direct':
      return `#/fitness/plugin/${item.target.plugin_id}`;
      
    case 'view_direct':
      return `#/fitness/view/${item.target.view}`;
      
    default:
      return '#/fitness';
  }
}
```

### Phase 2: Update FitnessNavbar Component

Replace existing component with new navigation system:

```jsx
// frontend/src/modules/Fitness/FitnessNavbar.jsx
import React, { useMemo } from 'react';
import { DaylightImagePath } from '../../lib/api.mjs';
import SidebarFooter from './SidebarFooter.jsx';
import { sortNavItems, getNavItemClasses, isNavItemActive } from './lib/navigationUtils';
import './FitnessNavbar.scss';

const FitnessNavbar = ({ 
  navItems = [],
  currentState = {},
  onNavigate 
}) => {
  const sortedItems = useMemo(() => sortNavItems(navItems), [navItems]);
  
  const getCollectionIcon = (icon) => {
    if (!icon) return null;
    return DaylightImagePath(`icons/${icon}.svg`);
  };

  const handleItemClick = (item) => {
    if (onNavigate) {
      onNavigate(item.type, item.target, item);
    }
  };

  return (
    <div className="fitness-navbar">
      <div className="navbar-header">
        {/* Reserved for future use */}
      </div>
      
      <nav className="navbar-nav">
        {sortedItems.length === 0 ? (
          <div className="loading-state">
            <div className="loading-icon">⏳</div>
          </div>
        ) : (
          sortedItems.map((item, index) => {
            const isActive = isNavItemActive(item, currentState);
            const classNames = getNavItemClasses(item, isActive);
            
            return (
              <button
                key={item.id || index}
                className={classNames}
                onPointerDown={() => handleItemClick(item)}
              >
                <div className="nav-icon">
                  {item.icon ? (
                    <img 
                      src={getCollectionIcon(item.icon)} 
                      alt={item.name}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'inline';
                      }}
                    />
                  ) : (
                    <span>📺</span>
                  )}
                  <span style={{display: 'none'}}>📺</span>
                </div>
                <span className="nav-label">{item.name}</span>
              </button>
            );
          })
        )}
      </nav>

      <SidebarFooter onContentSelect={onNavigate} />
    </div>
  );
};

export default FitnessNavbar;
```

### Phase 3: Update FitnessApp Navigation Handler

Replace `handleContentSelect` with new `handleNavigate` function:

```jsx
// frontend/src/Apps/FitnessApp.jsx

// Replace existing handleContentSelect with:
const handleNavigate = (type, target, item) => {
  logger.info('fitness-navigate', { type, target });
  
  switch (type) {
    case 'plex_collection':
      setActiveCollection(target.collection_id);
      setCurrentView('menu');
      setSelectedShow(null);
      break;
      
    case 'plex_collection_group':
      setActiveCollection(target.collection_ids);
      setCurrentView('menu');
      setSelectedShow(null);
      break;
      
    case 'plugin_menu':
      setActiveCollection(target.menu_id);
      setCurrentView('menu');
      setSelectedShow(null);
      break;
      
    case 'plugin_direct':
      setActivePlugin({ 
        id: target.plugin_id, 
        ...(target.config || {}) 
      });
      setCurrentView('plugin');
      setSelectedShow(null);
      break;
      
    case 'view_direct':
      setCurrentView(target.view);
      setSelectedShow(null);
      break;
      
    case 'custom_action':
      handleCustomAction(target.action, target.params);
      break;
      
    default:
      logger.warn('fitness-navigate-unknown', { type });
  }
};

// Update FitnessNavbar usage:
<FitnessNavbar 
  navItems={fitnessConfiguration?.fitness?.plex?.nav_items || []}
  currentState={{
    currentView,
    activeCollection,
    activePlugin
  }}
  onNavigate={handleNavigate}
/>
```

### Phase 4: Add CSS for New Classes

```scss
// frontend/src/modules/Fitness/FitnessNavbar.scss

.nav-item {
  // Base styles...
  
  &--active {
    background: rgba(255, 255, 255, 0.1);
    border-left: 3px solid var(--accent-color);
  }
  
  // Type-specific styles
  &--plugin_direct {
    // Optional: Style direct plugin links differently
  }
  
  &--view_direct {
    // Optional: Style view links differently
  }
  
  &--plex_collection,
  &--plex_collection_group {
    // Collection styles
  }
  
  &--plugin_menu {
    // Plugin menu styles
  }
}

// Custom class examples (from config.yml className field)
.nav-home {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.nav-camera {
  margin-top: auto; // Push to bottom
}
```

### Phase 5: Update Config File

Replace `collections` with `nav_items` in config.yml:

```yaml
plex:
  library_id: 6
  
  # OLD - Remove this:
  # collections:
  #   - id: 671468
  #     name: Favorites
  #     ...
  
  # NEW - Add this:
  nav_items:
    - type: plugin_direct
      name: Home
      icon: home
      order: 0
      className: nav-home
      target:
        plugin_id: fitness_chart
    
    - type: plex_collection
      name: Favorites
      icon: star
      order: 10
      target:
        collection_id: 671468
    
    # ... rest of nav items
  
  # app_menus remain unchanged
  app_menus:
    - id: app_menu1
      name: Fitness Apps
      items:
        - name: Fitness Chart
          id: fitness_chart
```

### Phase 6: Deep Link Router (Optional)

Add URL routing support for deep links:

```javascript
// frontend/src/modules/Fitness/lib/navigationRouter.js

export function parseDeepLink(hash) {
  const match = hash.match(/#\/fitness\/(\w+)\/([\w,]+)/);
  if (!match) return null;
  
  const [, type, value] = match;
  
  switch (type) {
    case 'collection':
      return { type: 'plex_collection', target: { collection_id: parseInt(value) }};
    case 'collections':
      return { type: 'plex_collection_group', target: { collection_ids: value.split(',').map(Number) }};
    case 'plugin':
      return { type: 'plugin_direct', target: { plugin_id: value }};
    case 'menu':
      return { type: 'plugin_menu', target: { menu_id: value }};
    case 'view':
      return { type: 'view_direct', target: { view: value }};
    default:
      return null;
  }
}

// In FitnessApp.jsx, add effect to handle deep links:
useEffect(() => {
  const handleHashChange = () => {
    const navAction = parseDeepLink(window.location.hash);
    if (navAction) {
      handleNavigate(navAction.type, navAction.target);
    }
  };
  
  window.addEventListener('hashchange', handleHashChange);
  handleHashChange(); // Handle initial load
  
  return () => window.removeEventListener('hashchange', handleHashChange);
}, []);
```

---

## Migration Path

### Breaking Changes

**This is a breaking change.** Old config files using `collections` array will not work.

**Required Actions:**
1. Update all `config.yml` files to use new `nav_items` structure
2. Remove all references to `collections` array
3. Update any custom scripts that reference `collections`

### Migration Steps

**Step 1: Update Backend API (if applicable)**
- Ensure `/api/fitness` endpoint returns `nav_items` instead of `collections`
- If backend processes config.yml, update parsing logic

**Step 2: Update Config Files**
```bash
# Backup current config
cp config.yml config.yml.backup

# Update to new format (see Phase 5 example)
# Replace collections array with nav_items
```

**Step 3: Update Frontend Code**
- Replace FitnessNavbar.jsx (Phase 2)
- Update FitnessApp.jsx navigation handler (Phase 3)
- Add navigation utilities (Phase 1)
- Update SCSS (Phase 4)

**Step 4: Test Navigation**
- Test each nav item type
- Verify active state highlighting
- Test custom CSS classes
- Verify ordering works correctly

**Step 5: Deploy**
- Deploy backend config changes
- Deploy frontend code
- Monitor for errors

### Rollback Plan

If issues arise, revert to backup:
```bash
# Restore old config
cp config.yml.backup config.yml

# Redeploy previous version of frontend code
git revert <commit-hash>
```

---

## Component Changes Summary

| Component | Change Type | Description |
|-----------|-------------|-------------|
| FitnessNavbar.jsx | **Replace** | Complete rewrite with new nav system |
| FitnessApp.jsx | **Modify** | Replace handleContentSelect with handleNavigate |
| navigationUtils.js | **Create** | New utility file for nav logic |
| navigationRouter.js | **Create** | Optional: Deep link support |
| FitnessNavbar.scss | **Update** | Add new type-based classes |
| config.yml | **Breaking** | Replace collections with nav_items |

---

## Example Use Cases

### Use Case 1: Home Button
```yaml
nav_type: plugin_direct
    name: Dashboard
    icon: home
    target:
      plugin_id: fitness_chart
```

### Use Case 2: Quick Camera Access
```yaml
nav_items:
  - type: view_direct
    name: Live Cam
    icon: camera
    target:
      view: users
```

### Use Case 3: Settings Menu
```yaml
nav_items:
  - type: plugin_direct
    name: Settings
    icon: settings
    target:
      plugin_id: settings_panel
      config:
        tab: general
```

### Use Case 4: Multi-Collection "Kids" Section
```yaml
nav_items:
  - position: main
    type: plex_collection_group
    name: Kids
    icon: kids
    target:
      collection_ids: [387010, 450232, 672606]
```

---

## Benefits

### 1. Flexibility
- ✅ Add direct plugin links
- ✅ Support any content type
- ✅ Customize header/footer
- ✅ Custom actions

### 2. Cla actions
- ✅ Simple flat list structure

### 2. Clarity
- ✅ Explicit `type` field (no inference)
- ✅ Self-documenting structure
- ✅ Easier debugging
- ✅ Predictable ordering

### 3. Extensibility
- ✅ Add new types without breaking changes
- ✅ Per-item configuration
- ✅ CSS-based visual positioning

### 4. Maintainability
- ✅ Backward compatible via adapter
- ✅ Single source of truth for navigation
- ✅ Type-safe navigation handling
- ✅ Separation of concerns (config vs presentation)
## Design Decisions

### 1. Active State Logic
**Question**: How should we determine which nav item is "active" when viewing a plugin that was launched directly vs. through a menu?

**Decision**: Match based on current view state:
- For `plex_collection`: Active when `activeCollection` matches `target.collection_id`
- For `plugin_direct`: Active when `currentView === 'plugin'` and `activePlugin.id` matches `target.plugin_id`
- For `plugin_menu`: Active when viewing the menu itself
- For `view_direct`: Active when `currentView` matches `target.view`

### 2. Custom CSS Classes
**Question**: Should we add an optional `className` field to nav items for custom styling?

**Decision**: **Yes**. Add optional `className` field to allow custom styling while maintaining default type-based classes (`nav-item--${type}`).

```yaml
nav_items:
  - type: plugin_direct
    name: Home
    icon: home
    className: nav-home-button  # ← Optional custom class
    target:
      plugin_id: fitness_chart
```

### 3. Deep Linking
**Question**: Should nav items support URL-based deep linking for sharing/bookmarking specific views?

**Decision**: **Yes**. Each nav item type should generate a unique URL pattern that can be bookmarked or shared. Router will be updated to parse and handle these deep links.

**URL Patterns:**
- `#/fitness/collection/671468` → plex_collection
- `#/fitness/plugin/fitness_chart` → plugin_direct
- `#/fitness/view/users` → view_direct
- `#/fitness/menu/app_menu1` → plugin_menu

### 4. Dynamic Items
**Question**: Should we support dynamically generated nav items (e.g., "Recently Played" collection)?

**Decision**: **No**. Dynamic content is handled within specific plugins, not the nav system. Plugins can expose collections or views that static nav items link to. This keeps the nav config simple and declarative.

Example: A "History" plugin could maintain a "Recently Played" collection that a static nav item links to.

### 5. Permissions & Visibility
**Question**: Should nav items support visibility rules based on user/device state?

**Decision**: **No**. The fitness app operates at household-level. Permission/visibility logic should be handled within the plugins or views themselves, not at the navigation layer. This maintains separation of concerns.

### 6. Item Ordering
**Question**: Should we support explicit ordering of nav items beyond their array position?

**Decision**: **Yes**. Add optional `order` field (number) to allow fine-grained control of item sequence. Items without `order` maintain their array position. Items with `order` are sorted numerically.

```yaml
nav_items:
  - type: plugin_direct
    name: Home
    order: 0  # ← Always first
    icon: home
    target:
      plugin_id: fitness_chart
  
  - type: plex_collection
    name: Favorites
    order: 10
    # ... more items ...
  
  - type: view_direct
    name: Camera
    order: 999  # ← Always last
    icon: camera
    target:
      view: users
```

## Next Steps

1. **Review & Approve**: Stakeholder review of proposed structure
2. **Prototype**: Build adapter and test with existing config
3. **Documentation**: Update config.yml documentation
4. **Implementation**: Roll out phase-by-phase
5. **Migration**: Convert production configs to new format

---

## Appendix A: Component Changes Summary

| Component | Change Required | Breaking? |
|-----------|----------------|-----------|
| FitnessNavbar.jsx | Update to render by position | No (with adapter) |
| FitnessApp.jsx | Update handleContentSelect → handleNavigate | No (internal) |
| FitnessMenu.jsx | Accept normalized nav items | No |
| config.yml | Add nav_items strand sorted by order
  nav_items:
    # Quick access at top
    - type: plugin_direct
      name: Home
      icon: home
      order: 0
      className: nav-home
      target:
        plugin_id: fitness_chart
    
    # Content collections
    - type: plex_collection
      name: Favorites
      icon: star
      order: 10
      target:
        collection_id: 671468
    
    - type: plex_collection
      name: Strength
      icon: weights
      order: 20
      target:
        collection_id: 364853
    
    - type: plex_collection
      name: Cardio
      icon: cardio
      order: 30
      target:
        collection_id: 603181
    
    - type: plex_collection_group
      name: Kids
      icon: kids
      order: 40
      target:
        collection_ids: [387010, 672606]
    
    - type: plugin_menu
      name: Apps
      icon: apps
      order: 50
      target:
        menu_id: app_menu1
    
    # Utilities at bottom
    - type: view_direct
      name: Camera
      icon: camera
      order: 999
      className: nav-Kids
      icon: kids
      target:
        collection_ids: [387010, 672606]
    
    - type: plugin_menu
      name: Apps
      icon: apps
      target:
        menu_id: app_menu1
    
    # Utilities at bottom
    - icon: camera
      target:
        view: users
  
  # App menus (unchanged)
  app_menus:
    - id: app_menu1
      name: Fitness Apps
      items:
        - name: Fitness Chart
          id: fitness_chart
        - name: Camera View
          id: camera_view
        - name: Jumping Jack Game
          id: jumping_jack_game
```
