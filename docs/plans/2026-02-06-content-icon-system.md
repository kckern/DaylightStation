# Content Icon System

**Date:** 2026-02-06
**Status:** Approved

## Summary

Add SVG icon support to content collections (hymn, primary, scripture) and registered apps (gratitude, webcam, etc.) so they display meaningful thumbnails in the admin UI instead of letter initials.

## Two Icon Sources

1. **Collections** (hymn, primary, scripture): SVG files in the data mount, served by backend
2. **Apps** (gratitude, webcam, art, etc.): SVG files in the codebase, bundled by Vite

## Design

### Collection Icons (data-mounted)

**Resolution chain** (in adapter `getItem()` / `getList()`):
1. `manifest.yml` → `icon` field (explicit relative path)
2. Convention `icon.svg` in collection directory
3. `null` → frontend falls back to Tabler icon

**Backend route**: `GET /api/v1/local-content/collection-icon/:adapter/:collection`
Serves the resolved icon file from data path with `Content-Type: image/svg+xml`.

**Adapter changes**: `SingingAdapter` and `NarratedAdapter` include `thumbnail` URL in item and list responses when an icon is found.

### App Icons (codebase-bundled)

**Location**: `frontend/src/assets/app-icons/{appId}.svg`
Vite resolves static imports to hashed URLs.

**Registry change**: Add `icon` field (imported SVG URL) and `iconFallback` (Tabler component) to `APP_REGISTRY` entries.

**Frontend wiring**: `fetchContentMetadata()` sets `thumbnail` from `entry.icon` instead of `null`.

### Fallback Chain

1. `thumbnail` URL → `<img>` (custom SVG)
2. `iconFallback` Tabler icon → icon component
3. Letter initial (existing)

### Tabler Fallback Mapping

**Apps:**
| App | Icon |
|-----|------|
| webcam | IconCamera |
| gratitude | IconHeart |
| wrapup | IconFlag |
| office_off | IconPower |
| keycode | IconKeyboard |
| family-selector | IconUsers |
| art | IconPalette |
| glympse | IconMapPin |
| websocket | IconPlugConnected |

**Collections:**
| Collection | Icon |
|-----------|------|
| hymn | IconMusic |
| primary | IconMusic |
| scripture | IconBook |

## Implementation Steps

### Step 1: Create placeholder SVGs for apps
- Create `frontend/src/assets/app-icons/` directory
- Generate 9 placeholder SVGs (one per registered app)

### Step 2: Update app registry with icon imports
- Add static SVG imports to `appRegistry.js`
- Add `icon` and `iconFallback` fields to each registry entry

### Step 3: Wire app icons into admin frontend
- Update `fetchContentMetadata()` in ListsItemRow.jsx to use `entry.icon` as thumbnail
- Update `getAvatarContent()` to check `iconFallback` before letter initial
- Add Tabler fallback icons for collection sources to TYPE_ICONS

### Step 4: Add icon resolution to SingingAdapter
- Add `_resolveIcon(collection)` method: checks manifest `icon` → convention `icon.svg`
- Include `thumbnail` URL in `getItem()` and `getList()` responses

### Step 5: Add icon resolution to NarratedAdapter
- Same as Step 4 for NarratedAdapter

### Step 6: Add backend route to serve collection icons
- New route in localContent router: `GET /collection-icon/:adapter/:collection`
- Reads icon file from adapter's data path, serves with SVG content type
- 404 if no icon found

## Files Changed

- **New**: `frontend/src/assets/app-icons/*.svg` (9 placeholders)
- **Edit**: `frontend/src/lib/appRegistry.js`
- **Edit**: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`
- **Edit**: `backend/src/1_adapters/content/singing/SingingAdapter.mjs`
- **Edit**: `backend/src/1_adapters/content/narrated/NarratedAdapter.mjs`
- **Edit**: `backend/src/4_api/v1/routers/localContent.mjs`
