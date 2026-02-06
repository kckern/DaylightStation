# App Registry Design

**Date:** 2026-02-06
**Status:** Approved

## Problem

Menu items that reference apps (e.g. `app:family-selector/felix`, `app:webcam`, `app:gratitude`) show as "Unknown - Unresolved" in the admin UI. The system knows how to resolve Plex, Immich, hymn, and media content, but has no concept of apps as selectable content. Additionally, AppContainer uses a hardcoded if/else chain to route apps to components.

## Decision

The app registry lives on the frontend as a JS module — not as a backend content source adapter. Apps are shipped code with frontend components, unlike Plex/Immich which are environment-dependent external services. The registry is the single source of truth for app metadata, used by both the admin UI and AppContainer.

## Design

### Registry Module

**Location:** `frontend/src/lib/appRegistry.js`

```js
export const APP_REGISTRY = {
  'webcam':          { label: 'Webcam',          param: null, component: () => import('...') },
  'gratitude':       { label: 'Gratitude & Hope', param: null, component: () => import('...') },
  'wrapup':          { label: 'Wrap Up',          param: null, component: () => import('...') },
  'office_off':      { label: 'Office Off',       param: null, component: () => import('...') },
  'keycode':         { label: 'Key Test',         param: null, component: () => import('...') },
  'family-selector': { label: 'Family Selector',  param: { name: 'winner', options: 'household' }, component: () => import('...') },
  'art':             { label: 'Art',              param: { name: 'path' }, component: () => import('...') },
  'glympse':         { label: 'Glympse',          param: { name: 'id' }, component: () => import('...') },
  'websocket':       { label: 'WebSocket',        param: { name: 'path' }, component: () => import('...') },
};
```

### Param Config Shapes

Each entry's `param` field can be:

- **`null`** — App takes no parameters (webcam, gratitude, wrapup, etc.)
- **`{ name: 'path' }`** — Free text input, no constrained options (art, websocket)
- **`{ name: 'winner', options: 'household' }`** — Dynamic options resolved at runtime via keyword
- **`{ name: 'theme', options: 'sacrifice,nativity,christmas' }`** — Static CSV options rendered as dropdown

### Exported Helpers

- `getApp(id)` — Lookup by ID, returns registry entry or null
- `searchApps(query)` — Fuzzy-match against label/id, returns matching entries
- `resolveAppDisplay(inputString)` — Parses `app:family-selector/felix` into `{ appId, param, label, paramLabel }`
- `resolveParamOptions(param)` — Returns `[{ value, label }]` for dropdowns, or `null` for free text

### Param Options Resolver

```js
const OPTION_RESOLVERS = {
  household: async () => {
    const data = await DaylightAPI('/api/v1/gratitude/bootstrap');
    return (data.users || []).map(u => ({ value: u.id, label: u.group_label || u.name || u.id }));
  },
};

export async function resolveParamOptions(param) {
  if (!param?.options) return null;
  if (param.options.includes(',')) {
    return param.options.split(',').map(v => ({ value: v.trim(), label: v.trim() }));
  }
  const resolver = OPTION_RESOLVERS[param.options];
  return resolver ? resolver() : null;
}
```

New dynamic option types are added as entries in `OPTION_RESOLVERS`. Only `household` is needed initially.

### Admin UI Integration

**Content display (ListsItemRow):** When `input` starts with `app:`, use `resolveAppDisplay()` from the registry to show the app label, param value, and "APP" badge — replacing the current "Unknown - Unresolved" warning.

**Content selection (ContentSearchCombobox):** When user types a search query:
1. Search the backend as usual (Plex, media, hymns, etc.)
2. Also call `searchApps(query)` locally against the registry
3. Merge app results into the dropdown under an "Apps" group header

When the user selects an app from the dropdown:
- **No param** → Set input to `app:webcam`, done
- **Has param with options** → Secondary dropdown appears with resolved options. Selecting one sets input to `app:family-selector/felix`
- **Has param, no options (free text)** → Text input appears. On blur/enter, sets input to `app:art/nativity`

### AppContainer Refactor

Replace the hardcoded if/else chain with registry-driven rendering:

```jsx
import { getApp } from '../../lib/appRegistry.js';

export default function AppContainer({ open, clear }) {
  const rawApp = open?.app || open?.open || open;
  const [app, paramFromApp] = typeof rawApp === 'string' ? rawApp.split('/') : [rawApp, null];
  const param = paramFromApp || open?.param || null;

  const entry = getApp(app);
  if (!entry) return <div>Unknown app: {app}</div>;

  const Component = lazy(entry.component);
  return (
    <Suspense fallback={null}>
      <Component {...{ [entry.param?.name || 'param']: param, clear }} />
    </Suspense>
  );
}
```

Adding a new app becomes a single registry entry plus the component module. No more editing AppContainer routing.

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/lib/appRegistry.js` | **New** — registry, helpers, param resolver |
| `frontend/src/modules/AppContainer/AppContainer.jsx` | Replace if/else with registry-driven lazy rendering |
| `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` (or display subcomponent) | Resolve `app:` inputs from registry |
| `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx` (or equivalent) | Inject local app search results, add param picker UI |

## Not In Scope

- No backend AppAdapter or new API endpoints
- No changes to YAML menu file format (already uses `app:id/param`)
- No changes to individual app components
- Dynamic option types beyond `household` (add later as needed)
