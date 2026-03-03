# Fitness Screen-Framework Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all issues identified in the final code review of the fitness screen-framework integration.

**Architecture:** Targeted fixes across existing files — no new files, no new patterns. Each task is a self-contained edit-and-commit.

**Tech Stack:** React, screen-framework, structured logging framework

---

## Task 1: Add Missing `dashboard` Data Source to Home Screen Config

The `FitnessUpNextWidget` and `FitnessCoachWidget` call `useScreenData('dashboard')` but the config has no `dashboard` data source, so they always render nothing. The dashboard API needs a userId: `/api/v1/health-dashboard/{userId}`. Since `ScreenDataProvider` doesn't support template variables, FitnessApp must resolve the URL and merge it into the sources before passing them.

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`

**Step 1: Add a `useMemo` to compute resolved data sources**

Find the existing `homeScreenConfig` memo (around line 648-651):

```javascript
const homeScreenConfig = useMemo(() => {
  const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
  return root?.home_screen || null;
}, [fitnessConfiguration]);
```

Add a new memo right after it that resolves the data sources with the primary user's dashboard URL:

```javascript
const homeScreenSources = useMemo(() => {
  if (!homeScreenConfig?.data) return {};
  const sources = { ...homeScreenConfig.data };
  // Resolve dashboard source with primary user ID
  const root = fitnessConfiguration?.fitness || fitnessConfiguration || {};
  const primaryUser = root?.users?.primary?.[0];
  if (primaryUser) {
    const userId = primaryUser.id || primaryUser.profileId;
    sources.dashboard = { source: `/api/v1/health-dashboard/${userId}`, refresh: 300 };
  }
  return sources;
}, [homeScreenConfig, fitnessConfiguration]);
```

**Step 2: Update ScreenDataProvider to use resolved sources**

Find the home view rendering block (around line 1111-1123). Change:

```jsx
<ScreenDataProvider sources={homeScreenConfig.data || {}}>
```

To:

```jsx
<ScreenDataProvider sources={homeScreenSources}>
```

**Step 3: Verify build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "fix(fitness): resolve dashboard data source with primary userId for home screen"
```

---

## Task 2: Rename `pluginId` Prop to `moduleId`

The `pluginId` prop name was missed in the Task 4 rename. It appears in `FitnessModuleContainer.jsx`, `FitnessModuleErrorBoundary.jsx`, and all callers (`FitnessApp.jsx`, `FitnessPlayerOverlay.jsx`).

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessModules/FitnessModuleContainer.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessModules/FitnessModuleErrorBoundary.jsx`
- Modify: `frontend/src/Apps/FitnessApp.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`

**Step 1: Update FitnessModuleContainer.jsx**

At line 9, change the prop destructuring:
```javascript
// Before
const FitnessModuleContainer = ({ pluginId, mode = 'standalone', onClose, config = {} }) => {
// After
const FitnessModuleContainer = ({ moduleId, mode = 'standalone', onClose, config = {} }) => {
```

Replace all `pluginId` references within the file with `moduleId` (lines 11, 12, 16, 25).

**Step 2: Update FitnessModuleErrorBoundary.jsx**

At line 11, change the prop destructuring:
```javascript
// Before
const { pluginId, sessionInstance } = this.props;
// After
const { moduleId, sessionInstance } = this.props;
```

Update line 15 (`pluginId,` → `moduleId,`) and line 21 (`[${pluginId}]` → `[${moduleId}]`).

**Step 3: Update FitnessApp.jsx callers**

At line 1125:
```javascript
// Before
<FitnessModuleContainer pluginId="fitness_session" mode="standalone" />
// After
<FitnessModuleContainer moduleId="fitness_session" mode="standalone" />
```

At line 1149:
```javascript
// Before
pluginId={activeModule.id}
// After
moduleId={activeModule.id}
```

**Step 4: Update FitnessPlayerOverlay.jsx**

At line 155:
```javascript
// Before
pluginId={fitnessCtx.overlayApp.id}
// After
moduleId={fitnessCtx.overlayApp.id}
```

**Step 5: Verify build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessModules/FitnessModuleContainer.jsx frontend/src/modules/Fitness/FitnessModules/FitnessModuleErrorBoundary.jsx frontend/src/Apps/FitnessApp.jsx frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx
git commit -m "refactor(fitness): rename pluginId prop to moduleId in FitnessModuleContainer"
```

---

## Task 3: Memoize FitnessScreenProvider Context Value

The context value object is recreated on every render, causing unnecessary re-renders of all consumers.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessScreenProvider.jsx`

**Step 1: Add useMemo import and memoize the value**

Change line 1 to add `useMemo`:
```javascript
// Before
import React, { createContext, useContext } from 'react';
// After
import React, { createContext, useContext, useMemo } from 'react';
```

Change line 13 to memoize:
```javascript
// Before
const value = { onPlay, onNavigate, onCtaAction };
// After
const value = useMemo(() => ({ onPlay, onNavigate, onCtaAction }), [onPlay, onNavigate, onCtaAction]);
```

**Step 2: Verify build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessScreenProvider.jsx
git commit -m "fix(fitness): memoize FitnessScreenProvider context value to prevent unnecessary re-renders"
```

---

## Task 4: Replace Raw `console.error` with Structured Logger

Three files use raw `console.error` which violates the project's logging rules (see CLAUDE.md). Replace with the structured logging framework.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessModules/FitnessModuleMenu.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessModules/FitnessModuleErrorBoundary.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessModules/useModuleStorage.js`

**Step 1: Fix FitnessModuleMenu.jsx**

Add logger import at the top (after existing imports, before component):
```javascript
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'FitnessModuleMenu' });
  return _logger;
}
```

At line 38, replace:
```javascript
// Before
console.error('Failed to load module menu:', err);
// After
logger().error('module-menu-load-failed', { error: err.message });
```

**Step 2: Fix FitnessModuleErrorBoundary.jsx**

Add logger import at the top:
```javascript
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'FitnessModuleErrorBoundary' });
  return _logger;
}
```

At line 21, replace:
```javascript
// Before
console.error(`Fitness Module Error [${moduleId}]:`, error, errorInfo);
// After
logger().error('module-error', { moduleId, error: error.message, stack: error.stack, componentStack: errorInfo.componentStack });
```

(Note: This file was updated in Task 2 so the variable is now `moduleId`, not `pluginId`.)

**Step 3: Fix useModuleStorage.js**

Add logger import at the top:
```javascript
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useModuleStorage' });
  return _logger;
}
```

At line 26, replace:
```javascript
// Before
console.error(`Failed to save module setting: ${key}`, e);
// After
logger().warn('module-storage-save-failed', { key, error: e.message });
```

**Step 4: Verify build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessModules/FitnessModuleMenu.jsx frontend/src/modules/Fitness/FitnessModules/FitnessModuleErrorBoundary.jsx frontend/src/modules/Fitness/FitnessModules/useModuleStorage.js
git commit -m "fix(fitness): replace raw console.error with structured logger in module files"
```

---

## Task 5: Use DaylightMediaPath in FitnessUpNextWidget

The widget constructs raw relative paths for `videoUrl` and `image` instead of using `DaylightMediaPath`, which handles path rewriting and potential origin differences.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessUpNextWidget.jsx`

**Step 1: Add DaylightMediaPath import**

Add after line 1:
```javascript
import { DaylightMediaPath } from '../../../../../../lib/api.mjs';
```

**Step 2: Update the URL construction**

At lines 21-22, change:
```javascript
// Before
videoUrl: `/api/v1/play/${source}/${localId}`,
image: `/api/v1/display/${source}/${localId}`,
// After
videoUrl: DaylightMediaPath(`api/v1/play/${source}/${localId}`),
image: DaylightMediaPath(`api/v1/display/${source}/${localId}`),
```

Note: `DaylightMediaPath` strips leading slashes, so pass without leading `/`.

**Step 3: Verify build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vite build --mode development 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessModules/modules/HomeApp/widgets/FitnessUpNextWidget.jsx
git commit -m "fix(fitness): use DaylightMediaPath for URL construction in FitnessUpNextWidget"
```

---

## Task 6: Document `/fitness/home` Route in URL Parser Comments

The URL parser's header comment doesn't list the `/fitness/home` route, making it incomplete documentation.

**Files:**
- Modify: `frontend/src/hooks/fitness/useFitnessUrlParams.js`

**Step 1: Add the home route to the comment block**

At lines 6-11, update the URL patterns list:

```javascript
// Before (lines 6-11)
 *   /fitness                     → menu view (no ID)
 *   /fitness/menu/:id            → menu view with video ID(s)
 *   /fitness/show/:id            → show view
 *   /fitness/play/:id            → play view
 *   /fitness/module/:id          → module view
 *   /fitness/users               → users view

// After
 *   /fitness                     → menu view (no ID)
 *   /fitness/home                → home view (screen-framework dashboard)
 *   /fitness/menu/:id            → menu view with video ID(s)
 *   /fitness/show/:id            → show view
 *   /fitness/play/:id            → play view
 *   /fitness/module/:id          → module view
 *   /fitness/users               → users view
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/fitness/useFitnessUrlParams.js
git commit -m "docs(fitness): add /fitness/home route to URL parser comments"
```

---

## Summary

| Task | Issue | Priority | Files |
|------|-------|----------|-------|
| 1 | Missing dashboard data source — UpNext/Coach render nothing | Critical | FitnessApp.jsx |
| 2 | `pluginId` prop → `moduleId` | Important | 4 files |
| 3 | Context value not memoized | Important | FitnessScreenProvider.jsx |
| 4 | Raw `console.error` → structured logger | Important | 3 files |
| 5 | Raw paths → `DaylightMediaPath` | Important | FitnessUpNextWidget.jsx |
| 6 | Missing `/fitness/home` in URL parser docs | Suggestion | useFitnessUrlParams.js |
