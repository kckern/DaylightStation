# Screen Nav Wiring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire fitness navbar to support `screen` and `module_menu` nav types, replacing the unhandled `plugin_direct`/`plugin_menu` types. Enable config-driven screen-framework dashboards and fullscreen widgets from navbar navigation.

**Architecture:** Generalize `home_screen` into a `screens` map in fitness.yml. Add `screen` case to `handleNavigate` switch and `isNavItemActive`. New `activeScreen` state var holds the current screen_id. URL pattern: `/fitness/screen/{id}`. Backward-compatible normalization handles old `home_screen` format.

**Tech Stack:** React, react-router-dom, screen-framework (ScreenProvider, ScreenDataProvider, PanelRenderer), FitnessModuleContainer

---

### Task 1: Update fitness.yml config

**Files:**
- Modify: `data/household/config/fitness.yml` (remote, via Dropbox path)

**Step 1: Rename `home_screen` to `screens.home` and fix nav item types**

Change the config from:
```yaml
home_screen:
  theme: { ... }
  data: { ... }
  layout: { ... }
```
to:
```yaml
screens:
  home:
    theme: { ... }
    data: { ... }
    layout: { ... }
```

Change nav items:
```yaml
# Was: type: plugin_direct → now: type: screen
- type: screen
  name: Home
  icon: home
  order: 0
  className: nav-home
  target:
    screen_id: home

# Was: type: plugin_menu → now: type: module_menu
- type: module_menu
  name: Fitness Apps
  icon: apps
  order: 130
  target:
    menu_id: app_menu1
```

**Step 2: Verify YAML parses correctly**

Run: `node -e "const y=require('js-yaml');const fs=require('fs');console.log(JSON.stringify(Object.keys(y.load(fs.readFileSync('/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/fitness.yml','utf8')))))"`

Expected: Keys include `screens` (not `home_screen`), and nav_items contain `type: screen` and `type: module_menu`.

**Step 3: Commit**

```
feat(fitness): migrate config to screens map and fix nav types
```

---

### Task 2: Add `activeScreen` state and backward-compat normalization in FitnessApp

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`

**Step 1: Add `activeScreen` state variable**

At line 43, after `const [activeModule, setActiveModule] = useState(null);`, add:

```javascript
const [activeScreen, setActiveScreen] = useState(null); // screen_id from screens config
```

**Step 2: Update config normalization to support both `home_screen` and `screens`**

In the `fetchFitnessData` effect (around line 863), add `'screens'` to the `unifyKeys` array. Then after the unify loop, add backward-compat migration:

```javascript
const unifyKeys = ['ant_devices','equipment','users','coin_time_unit_ms','zones','plex','governance','ambient_led','device_colors','devices','home_screen','screens'];
```

After the `unifyKeys.forEach(...)` block, add:

```javascript
// Backward compat: wrap legacy home_screen into screens map
if (response.fitness.home_screen && !response.fitness.screens) {
  response.fitness.screens = { home: response.fitness.home_screen };
}
// Clean up legacy key if screens map exists
if (response.fitness.screens) {
  delete response.fitness.home_screen;
}
```

**Step 3: Replace `homeScreenConfig` with `screensConfig`**

Replace the `homeScreenConfig` useMemo (around line 648):

```javascript
// Old:
const homeScreenConfig = useMemo(() => {
  const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
  return root?.home_screen || null;
}, [fitnessConfiguration]);

// New:
const screensConfig = useMemo(() => {
  const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
  return root?.screens || {};
}, [fitnessConfiguration]);
```

**Step 4: Update `homeScreenSources` to be generic `screenSources`**

Replace the `homeScreenSources` useMemo (around line 654):

```javascript
// Resolve data sources for active screen, injecting dashboard URL with primary userId
const screenSources = useMemo(() => {
  const screenCfg = activeScreen ? screensConfig[activeScreen] : null;
  if (!screenCfg?.data) return {};
  const sources = { ...screenCfg.data };
  const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
  const primaryUser = root?.users?.primary?.[0];
  if (primaryUser) {
    const userId = primaryUser.id || primaryUser.profileId;
    sources.dashboard = { source: `/api/v1/health-dashboard/${userId}`, refresh: 300 };
  }
  return sources;
}, [activeScreen, screensConfig, fitnessConfiguration]);
```

**Step 5: Commit**

```
refactor(fitness): add activeScreen state and screens config normalization
```

---

### Task 3: Wire `screen` case into `handleNavigate`

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`

**Step 1: Add `screen` case to handleNavigate switch (around line 751)**

After the `case 'movie':` block (line 826), add before `case 'custom_action':`:

```javascript
case 'screen':
  setActiveScreen(target.screen_id);
  setActiveCollection(null);
  setActiveModule(null);
  setSelectedShow(null);
  setCurrentView('screen');
  navigate(`/fitness/screen/${target.screen_id}`, { replace: true });
  break;
```

**Step 2: Update the auto-navigation effect to use `screens` instead of `homeScreenConfig`**

Replace the home auto-navigation block (lines 978-983):

```javascript
// Old:
if (homeScreenConfig && activeCollection == null && activeModule == null && currentView === 'menu') {
  setCurrentView('home');
  navigate('/fitness/home', { replace: true });
  return;
}

// New: Default to first screen if screens config exists
const screenIds = Object.keys(screensConfig);
if (screenIds.length > 0 && activeCollection == null && activeModule == null && activeScreen == null && currentView === 'menu') {
  setActiveScreen(screenIds[0]);
  setCurrentView('screen');
  navigate(`/fitness/screen/${screenIds[0]}`, { replace: true });
  return;
}
```

Update the guard at the top of that effect (line 971) to also skip for `screen`:

```javascript
// Old:
if (currentView === 'users' || currentView === 'show' || currentView === 'home') {

// New:
if (currentView === 'users' || currentView === 'show' || currentView === 'screen') {
```

Update the effect dependency array to replace `homeScreenConfig` with `screensConfig` and add `activeScreen`.

**Step 3: Commit**

```
feat(fitness): wire screen nav type into handleNavigate
```

---

### Task 4: Update URL init and routing for `/fitness/screen/:id`

**Files:**
- Modify: `frontend/src/hooks/fitness/useFitnessUrlParams.js`
- Modify: `frontend/src/Apps/FitnessApp.jsx`

**Step 1: Update URL comment header in useFitnessUrlParams.js**

Replace `/fitness/home` with `/fitness/screen/:id` in the comment block (line 7):

```javascript
 *   /fitness/screen/:id           → screen view (screen-framework dashboard)
```

Remove the old `/fitness/home` line.

**Step 2: Update URL init effect in FitnessApp.jsx (around line 943)**

Replace the `view === 'home'` branch:

```javascript
// Old:
} else if (view === 'home') {
  setCurrentView('home');

// New:
} else if (view === 'screen' && id) {
  setActiveScreen(id);
  setCurrentView('screen');
} else if (view === 'home') {
  // Backward compat: /fitness/home → /fitness/screen/home
  setActiveScreen('home');
  setCurrentView('screen');
  navigate('/fitness/screen/home', { replace: true });
```

**Step 3: Commit**

```
feat(fitness): support /fitness/screen/:id URL routing
```

---

### Task 5: Update screen rendering block

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`

**Step 1: Replace the home render block with generic screen render block**

Replace lines 1124-1138:

```jsx
{/* Old: */}
{currentView === 'home' && homeScreenConfig && (
  <div className="home-app">
    <FitnessScreenProvider ...>
      <ScreenDataProvider sources={homeScreenSources}>
        <ScreenProvider config={{ ...homeScreenConfig.layout, theme: homeScreenConfig.theme }}>
          <PanelRenderer />
        </ScreenProvider>
      </ScreenDataProvider>
    </FitnessScreenProvider>
  </div>
)}
```

With:

```jsx
{currentView === 'screen' && activeScreen && screensConfig[activeScreen] && (
  <div className="screen-app">
    <FitnessScreenProvider
      onPlay={handleHomePlay}
      onNavigate={handleNavigate}
      onCtaAction={(cta) => logger.info('fitness-cta-action', { action: cta.action })}
    >
      <ScreenDataProvider sources={screenSources}>
        <ScreenProvider config={{
          ...screensConfig[activeScreen].layout,
          theme: screensConfig[activeScreen].theme
        }}>
          <PanelRenderer />
        </ScreenProvider>
      </ScreenDataProvider>
    </FitnessScreenProvider>
  </div>
)}
```

**Step 2: Commit**

```
feat(fitness): render screens generically from screensConfig map
```

---

### Task 6: Update `isNavItemActive` in navigationUtils.js

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/navigationUtils.js`

**Step 1: Add `activeScreen` to destructuring and add `screen` case**

Update `isNavItemActive` (line 29):

```javascript
const { currentView, activeCollection, activeModule, activeScreen } = currentState;
```

Add case before `default:`:

```javascript
case 'screen':
  return currentView === 'screen' && activeScreen === item.target.screen_id;
```

**Step 2: Update `getNavItemDeepLink` to handle `screen` type**

Add case in the switch (around line 70):

```javascript
case 'screen':
  return `#/fitness/screen/${item.target.screen_id}`;
```

**Step 3: Commit**

```
feat(fitness): add screen type to nav active state and deep links
```

---

### Task 7: Pass `activeScreen` to navbar current state

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`

**Step 1: Add `activeScreen` to the currentState prop passed to FitnessNavbar**

Update the navbar props (around line 1112):

```jsx
currentState={{
  currentView,
  activeCollection,
  activeModule,
  activeScreen
}}
```

**Step 2: Commit**

```
feat(fitness): pass activeScreen to navbar for active highlighting
```

---

### Task 8: Update admin UI type options

**Files:**
- Modify: `frontend/src/modules/Admin/Apps/FitnessConfig.jsx`

**Step 1: Replace plugin types in NAV_ITEM_COLUMNS options (around line 131)**

```javascript
// Old:
{ value: 'plugin_direct', label: 'Plugin Direct' },
{ value: 'plugin_menu', label: 'Plugin Menu' },

// New:
{ value: 'screen', label: 'Screen' },
{ value: 'module_menu', label: 'Module Menu' },
{ value: 'module_direct', label: 'Module Direct' },
```

**Step 2: Update createDefaults (around line 287)**

```javascript
// Old:
createDefaults={{ name: '', type: 'plugin_direct', icon: '', order: 0 }}

// New:
createDefaults={{ name: '', type: 'screen', icon: '', order: 0 }}
```

**Step 3: Commit**

```
feat(fitness): update admin UI nav item type options
```

---

### Task 9: Clean up dead references

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`

**Step 1: Remove unused `homeScreenConfig` and `homeScreenSources` variables**

These were replaced by `screensConfig` and `screenSources` in Task 2. Verify no remaining references.

**Step 2: Remove the CSS class `home-app` if only used for the home render block**

Check `FitnessApp.scss` — if `.home-app` has no styles, the class change to `.screen-app` needs no CSS update. If it does have styles, rename to `.screen-app`.

**Step 3: Commit**

```
chore(fitness): remove dead homeScreenConfig references
```

---

### Task 10: Verify end-to-end

**Step 1: Start dev server and verify**

- Navigate to `/fitness` → should auto-navigate to `/fitness/screen/home`
- Click other nav items (Favorites, Strength, etc.) → should load collections
- Click Home in navbar → should navigate back to `/fitness/screen/home` with active highlight
- Click Fitness Apps → should load module menu
- Direct URL `/fitness/home` → should redirect to `/fitness/screen/home` (backward compat)
- Direct URL `/fitness/screen/home` → should load home dashboard

**Step 2: Final commit if any fixes needed**
