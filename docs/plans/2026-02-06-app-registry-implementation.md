# App Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a frontend app registry so apps are selectable content in the admin menu editor and AppContainer routes from a single source of truth.

**Architecture:** A JS module (`appRegistry.js`) maps app IDs to metadata (label, param config, lazy component import). The admin UI's content combobox and display components read from this registry to resolve `app:` items locally instead of calling the backend. AppContainer replaces its if/else chain with registry-driven lazy loading.

**Tech Stack:** React (lazy/Suspense), Mantine UI components, existing DaylightAPI fetch helper

**Design doc:** `docs/plans/2026-02-06-app-registry-design.md`

---

### Task 1: Create the App Registry Module

**Files:**
- Create: `frontend/src/lib/appRegistry.js`

**Step 1: Create the registry with all app entries**

```js
// frontend/src/lib/appRegistry.js
import { DaylightAPI } from './api.mjs';

/**
 * App Registry — single source of truth for all launchable apps.
 * Used by AppContainer (routing) and admin UI (content selection/display).
 */
export const APP_REGISTRY = {
  'webcam':          { label: 'Webcam',           param: null, component: () => import('../modules/AppContainer/Apps/Webcam/Webcam.jsx') },
  'gratitude':       { label: 'Gratitude & Hope',  param: null, component: () => import('../modules/AppContainer/Apps/Gratitude/Gratitude.jsx') },
  'wrapup':          { label: 'Wrap Up',           param: null, component: () => import('../modules/AppContainer/Apps/WrapUp/WrapUp.jsx') },
  'office_off':      { label: 'Office Off',        param: null, component: () => import('../modules/AppContainer/Apps/OfficeOff/OfficeOff.jsx') },
  'keycode':         { label: 'Key Test',          param: null, component: () => import('../modules/AppContainer/Apps/KeyTest/KeyTest.jsx') },
  'family-selector': { label: 'Family Selector',   param: { name: 'winner', options: 'household' }, component: () => import('../modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx') },
  'art':             { label: 'Art',               param: { name: 'path' }, component: () => import('../modules/AppContainer/Apps/Art/Art.jsx') },
  'glympse':         { label: 'Glympse',           param: { name: 'id' }, component: () => import('../modules/AppContainer/Apps/Glympse/Glympse.jsx') },
  'websocket':       { label: 'WebSocket',         param: { name: 'path' }, component: () => import('../modules/AppContainer/Apps/WebSocket/WebSocket.jsx') },
};

/**
 * Lookup an app by ID.
 * @param {string} id - e.g. 'webcam', 'family-selector'
 * @returns {object|null} Registry entry or null
 */
export function getApp(id) {
  return APP_REGISTRY[id] || null;
}

/**
 * Search apps by query string (matches against id and label).
 * @param {string} query
 * @returns {Array<{id: string, ...entry}>} Matching entries with id attached
 */
export function searchApps(query) {
  if (!query || query.length < 1) return [];
  const q = query.toLowerCase();
  return Object.entries(APP_REGISTRY)
    .filter(([id, entry]) => id.includes(q) || entry.label.toLowerCase().includes(q))
    .map(([id, entry]) => ({ id, ...entry }));
}

/**
 * Parse an app input string like "app:family-selector/felix" into parts.
 * @param {string} input - Raw input value from menu item
 * @returns {object|null} { appId, paramValue, label, fullId } or null if not an app input
 */
export function resolveAppDisplay(input) {
  if (!input || !input.startsWith('app:')) return null;
  const rest = input.slice(4); // strip "app:"
  const slashIdx = rest.indexOf('/');
  const appId = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  const paramValue = slashIdx === -1 ? null : rest.slice(slashIdx + 1);
  const entry = getApp(appId);
  if (!entry) return null;
  return {
    appId,
    paramValue,
    label: entry.label,
    paramName: entry.param?.name || null,
    fullId: input,
  };
}

// --- Param Options Resolver ---

const OPTION_RESOLVERS = {
  household: async () => {
    const data = await DaylightAPI('/api/v1/gratitude/bootstrap');
    return (data.users || []).map(u => ({
      value: u.id,
      label: u.group_label || u.name || u.id,
    }));
  },
};

/**
 * Resolve param options for an app's param config.
 * @param {object|null} param - The param config from registry entry
 * @returns {Promise<Array<{value,label}>|null>} Options array for dropdown, or null for free text
 */
export async function resolveParamOptions(param) {
  if (!param?.options) return null;

  // CSV string → static options
  if (param.options.includes(',')) {
    return param.options.split(',').map(v => ({ value: v.trim(), label: v.trim() }));
  }

  // Keyword → dynamic resolver
  const resolver = OPTION_RESOLVERS[param.options];
  return resolver ? resolver() : null;
}
```

**Step 2: Verify the module loads without errors**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && node -e "import('./frontend/src/lib/appRegistry.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`

This will likely fail due to JSX/import syntax — that's fine, it's a frontend module. The real test is the dev server (Task 4). Just visually confirm the file has no syntax errors.

**Step 3: Commit**

```bash
git add frontend/src/lib/appRegistry.js
git commit -m "feat: add app registry module with metadata, search, and param resolver"
```

---

### Task 2: Refactor AppContainer to Use Registry

**Files:**
- Modify: `frontend/src/modules/AppContainer/AppContainer.jsx`

**Step 1: Replace the hardcoded if/else chain**

The current file (lines 1-56) imports all 9 app components individually and uses an if/else chain. Replace the entire file with:

```jsx
// frontend/src/modules/AppContainer/AppContainer.jsx
import { useEffect, useMemo, lazy, Suspense } from "react";
import "./AppContainer.scss";
import { getApp } from "../../lib/appRegistry.js";
import { getChildLogger } from "../../lib/logging/singleton.js";

export default function AppContainer({ open, clear }) {
  // Parse app string - may contain param after slash (e.g., "art/nativity")
  const rawApp = open?.app || open?.open || open;
  const [app, paramFromApp] = typeof rawApp === 'string' ? rawApp.split('/') : [rawApp, null];
  const param = paramFromApp || open?.param || null;
  const logger = useMemo(() => getChildLogger({ app: 'app-container' }), []);

  useEffect(() => {
    logger.info('app-container-open', { app, param });
  }, [app, param, logger]);

  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === "Escape") {
        clear();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clear]);

  const entry = getApp(app);

  if (!entry) {
    return (
      <div>
        <h2>App Container</h2>
        <pre>{JSON.stringify({ app, param, open }, null, 2)}</pre>
      </div>
    );
  }

  const Component = lazy(entry.component);
  const appProps = { clear };
  if (entry.param?.name && param) {
    appProps[entry.param.name] = param;
  }

  return (
    <Suspense fallback={null}>
      <Component {...appProps} />
    </Suspense>
  );
}
```

Key changes:
- Remove all 9 static imports (lines 3-11 of original)
- Replace if/else chain (lines 39-47) with `lazy(entry.component)`
- Prop name comes from `entry.param.name` so each app gets its expected prop
- `clear` is always passed as a common prop
- Unknown app fallback preserved (the JSON debug view)

**Step 2: Verify dev server compiles**

Run: `curl -s http://localhost:3111/ | head -5` (check Vite dev server still serves)

If dev server isn't running, check with `lsof -i :3111` first.

**Step 3: Commit**

```bash
git add frontend/src/modules/AppContainer/AppContainer.jsx
git commit -m "refactor: replace AppContainer if/else chain with registry-driven lazy loading"
```

---

### Task 3: Resolve App Items in Admin Content Display

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` (around line 548 and 1246-1267)

**Step 1: Add app resolution to `fetchContentMetadata`**

In `ListsItemRow.jsx`, find the `fetchContentMetadata` function (line 548). Add app resolution **before** the API call so `app:` items never hit the backend.

Find this block (lines 556-561):

```js
  // Parse source:id format (trim whitespace from parts)
  const match = value.match(/^([^:]+):\s*(.+)$/);
  if (!match) {
    // Format can't be parsed - return unresolved
    return { value, unresolved: true };
  }
```

Insert **before** that block (after line 554, after the cache check):

```js
  // Resolve app items locally from registry (no backend call needed)
  if (value.startsWith('app:')) {
    const { resolveAppDisplay } = await import('../../lib/appRegistry.js');
    const appInfo = resolveAppDisplay(value);
    if (appInfo) {
      const info = {
        value,
        title: appInfo.paramValue
          ? `${appInfo.label} / ${appInfo.paramValue}`
          : appInfo.label,
        source: 'app',
        type: 'app',
        thumbnail: null,
        unresolved: false,
      };
      contentInfoCache.set(value, info);
      return info;
    }
    // Unknown app — fall through to unresolved
    return { value, title: value.slice(4), source: 'app', type: null, unresolved: true };
  }
```

**Step 2: Add 'app' to SOURCE_COLORS**

Find the `SOURCE_COLORS` object (around line 221 in ListsItemRow.jsx — look for `const SOURCE_COLORS`). Add the app entry:

```js
  app: 'teal',
```

**Step 3: Add 'app' to TYPE_LABELS**

Find the `TYPE_LABELS` object (around line 255). Add:

```js
  app: 'App',
```

**Step 4: Verify by checking an existing menu with app items in the admin UI**

Open the admin UI in a browser: navigate to the admin panel and open a menu that contains `app:` items (like the "Fhe" menu from the screenshot). The items should now show the app label with a teal "APP" badge instead of the yellow "Unknown - Unresolved" warning.

**Step 5: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat: resolve app items from registry in admin content display"
```

---

### Task 4: Add App Results to Content Search Combobox

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` (the `ContentSearchCombobox` function starting at line 596)

This is the trickiest task. The combobox needs to:
1. Include app results in search
2. Let users select apps
3. Show a param picker for parameterized apps

**Step 1: Inject app search results alongside API results**

Find the search effect (around line 646-680) that fetches from `/api/v1/content/query/search`. After the API results are set, merge in app results.

Find this block (around line 659-670):

```js
          const results = (data.items || []).map(item => ({
            value: item.id || `${item.source}:${item.localId}`,
            title: item.title,
            source: item.source,
            type: item.metadata?.type || item.type,
            thumbnail: item.thumbnail,
            grandparent: item.metadata?.grandparentTitle,
            parent: item.metadata?.parentTitle,
            library: item.metadata?.librarySectionTitle,
            itemCount: item.metadata?.childCount ?? item.metadata?.leafCount ?? null
          }));
          setSearchResults(results);
```

Replace `setSearchResults(results);` with:

```js
          // Merge in local app results
          const { searchApps } = await import('../../lib/appRegistry.js');
          const appMatches = searchApps(debouncedSearch).map(app => ({
            value: `app:${app.id}`,
            title: app.label,
            source: 'app',
            type: 'app',
            thumbnail: null,
            isApp: true,
            appId: app.id,
            hasParam: !!app.param,
            param: app.param,
          }));
          setSearchResults([...appMatches, ...results]);
```

**Step 2: Add app param picker state**

At the top of the `ContentSearchCombobox` function (after line 616), add:

```js
  const [pendingApp, setPendingApp] = useState(null); // {appId, param} — waiting for param input
  const [paramOptions, setParamOptions] = useState(null); // [{value, label}] or null
  const [paramInput, setParamInput] = useState('');
```

**Step 3: Handle app selection with param picker**

Find `handleOptionSelect` (around line 682-690):

```js
  const handleOptionSelect = (val) => {
    onChange(val);
    setSearchQuery('');
    setIsEditing(false);
    setBrowseItems([]);
    setNavStack([]);
    setCurrentParent(null);
    combobox.closeDropdown();
  };
```

Replace with:

```js
  const handleOptionSelect = async (val) => {
    // Check if this is an app with params
    const item = [...searchResults, ...browseItems].find(r => r.value === val);
    if (item?.isApp && item.hasParam) {
      // App needs a parameter — show param picker
      setPendingApp({ appId: item.appId, param: item.param });
      setParamInput('');
      const { resolveParamOptions } = await import('../../lib/appRegistry.js');
      const options = await resolveParamOptions(item.param);
      setParamOptions(options);
      combobox.closeDropdown();
      return;
    }

    onChange(val);
    setSearchQuery('');
    setIsEditing(false);
    setBrowseItems([]);
    setNavStack([]);
    setCurrentParent(null);
    setPendingApp(null);
    setParamOptions(null);
    combobox.closeDropdown();
  };
```

**Step 4: Add param picker UI**

Find the editing mode return statement (around line 1290, `// Editing mode - show combobox`). Wrap it so the param picker can appear instead. **Before** the `return (` on that line, add:

```jsx
  // Param picker mode — app selected, waiting for param
  if (pendingApp) {
    const finishWithParam = (paramVal) => {
      const fullId = paramVal
        ? `app:${pendingApp.appId}/${paramVal}`
        : `app:${pendingApp.appId}`;
      onChange(fullId);
      setSearchQuery('');
      setIsEditing(false);
      setPendingApp(null);
      setParamOptions(null);
      setParamInput('');
    };

    const cancelParam = () => {
      setPendingApp(null);
      setParamOptions(null);
      setParamInput('');
    };

    // Dropdown options
    if (paramOptions) {
      return (
        <Box>
          <Text size="xs" c="dimmed" mb={4}>
            {APP_REGISTRY_LABEL}: Select {pendingApp.param.name}
          </Text>
          <Combobox
            store={combobox}
            onOptionSubmit={(val) => finishWithParam(val)}
          >
            <Combobox.Target>
              <InputBase
                ref={inputRef}
                size="xs"
                pointer
                rightSection={<Combobox.Chevron />}
                rightSectionPointerEvents="none"
                value={paramInput}
                onChange={(e) => setParamInput(e.currentTarget.value)}
                onClick={() => combobox.openDropdown()}
                onFocus={() => combobox.openDropdown()}
                onBlur={() => { /* keep open */ }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancelParam();
                }}
                placeholder={`Choose ${pendingApp.param.name}...`}
                autoFocus
                styles={{ input: { minHeight: 24, height: 24, fontSize: 12 } }}
              />
            </Combobox.Target>
            <Combobox.Dropdown>
              <Combobox.Options>
                <ScrollArea.Autosize mah={200}>
                  {paramOptions
                    .filter(o => !paramInput || o.label.toLowerCase().includes(paramInput.toLowerCase()))
                    .map(o => (
                      <Combobox.Option key={o.value} value={o.value}>
                        <Text size="xs">{o.label}</Text>
                      </Combobox.Option>
                    ))}
                </ScrollArea.Autosize>
              </Combobox.Options>
            </Combobox.Dropdown>
          </Combobox>
        </Box>
      );
    }

    // Free text input (no options defined)
    return (
      <Box>
        <Text size="xs" c="dimmed" mb={4}>
          Enter {pendingApp.param.name}:
        </Text>
        <TextInput
          ref={inputRef}
          size="xs"
          value={paramInput}
          onChange={(e) => setParamInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && paramInput) finishWithParam(paramInput);
            if (e.key === 'Escape') cancelParam();
          }}
          onBlur={() => {
            if (paramInput) finishWithParam(paramInput);
            else cancelParam();
          }}
          placeholder={`Type ${pendingApp.param.name}...`}
          autoFocus
          styles={{ input: { minHeight: 24, height: 24, fontSize: 12 } }}
        />
      </Box>
    );
  }
```

Also add this constant near the top of the file (after the imports, around line 19):

```js
const APP_REGISTRY_LABEL = 'App';
```

**Step 5: Verify end-to-end in the admin UI**

1. Open the admin panel, navigate to a menu folder
2. Click on the content combobox for an empty row
3. Type "webcam" — should see "Webcam" with source badge "app" in results
4. Select it — should set input to `app:webcam`
5. Type "family" — should see "Family Selector" in results
6. Select it — should show param picker dropdown with household members
7. Select a member — should set input to `app:family-selector/felix`

**Step 6: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat: add app search results and param picker to content combobox"
```

---

### Task 5: Add "Open" to Action Options

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` (line 20-26)

The screenshot shows app items with "OPEN" action, but the current `ACTION_OPTIONS` array doesn't include it.

**Step 1: Add "Open" to the action options**

Find (line 20-26):

```js
const ACTION_OPTIONS = [
  { value: 'Play', label: 'Play' },
  { value: 'Queue', label: 'Queue' },
  { value: 'List', label: 'List' },
  { value: 'Display', label: 'Display' },
  { value: 'Read', label: 'Read' },
];
```

Replace with:

```js
const ACTION_OPTIONS = [
  { value: 'Play', label: 'Play' },
  { value: 'Queue', label: 'Queue' },
  { value: 'List', label: 'List' },
  { value: 'Open', label: 'Open' },
  { value: 'Display', label: 'Display' },
  { value: 'Read', label: 'Read' },
];
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat: add Open to action options for app items"
```

---

### Task 6: Manual Smoke Test

**No files changed — verification only.**

**Step 1: Ensure dev server is running**

```bash
lsof -i :3111
```

If not running: `cd /Users/kckern/Documents/GitHub/DaylightStation && npm run dev`

**Step 2: Test app display resolution**

Open the admin UI and navigate to a menu that has `app:` items. Verify:
- [x] App items show label + teal "APP" badge (not yellow warning)
- [x] Parameterized apps show `Label / param` format (e.g. "Family Selector / felix")

**Step 3: Test app search and selection**

In any menu item's content combobox:
- [x] Searching "web" shows "Webcam" in results with "app" source badge
- [x] Selecting "Webcam" sets input to `app:webcam`
- [x] Searching "family" shows "Family Selector"
- [x] Selecting "Family Selector" shows param picker with household members
- [x] Selecting a member sets input to `app:family-selector/memberid`
- [x] Searching "art" shows "Art", selecting shows free-text param input

**Step 4: Test AppContainer runtime**

Navigate to the TV view and trigger an app via menu to verify lazy loading works:
- [x] Apps still launch correctly
- [x] Parameterized apps receive correct props
- [x] Escape key still closes apps
