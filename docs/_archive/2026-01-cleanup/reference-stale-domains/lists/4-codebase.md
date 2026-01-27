# Lists Codebase Reference

## Backend

### Core Adapter

| File | Description |
|------|-------------|
| `backend/src/2_adapters/content/folder/FolderAdapter.mjs` | Main adapter for lists.yml parsing and transformation |

**Key methods:**
- `getList(folderId, options)` - Load folder items with watch state
- `_parseInput(input)` - Parse input string to source/id
- `_loadWatchState(category)` - Load playback progress
- `_hasNomusicLabel(plexId)` - Check for nomusic Plex label

### Legacy Support

| File | Description |
|------|-------------|
| `backend/_legacy/jobs/nav.mjs` | Legacy item processing (`processListItem`) |
| `backend/_legacy/routers/fetch.mjs` | Legacy `/data/list/*` endpoints |

### API Routes

| File | Description |
|------|-------------|
| `backend/src/4_api/routers/contentRouter.mjs` | `/api/v1/list/*` endpoints |

## Frontend

### Menu Components

| File | Description |
|------|-------------|
| `frontend/src/modules/Menu/Menu.jsx` | TVMenu and KeypadMenu components |
| `frontend/src/modules/Menu/MenuStack.jsx` | Menu navigation state and routing |
| `frontend/src/modules/Menu/PlexMenuRouter.jsx` | Routes Plex items to appropriate views |

### Player Integration

| File | Description |
|------|-------------|
| `frontend/src/modules/Player/hooks/useQueueController.js` | Queue expansion and management |
| `frontend/src/modules/Player/lib/api.js` | Queue flattening utilities |

### App Entry Points

| File | Description |
|------|-------------|
| `frontend/src/Apps/TVApp.jsx` | Loads TVApp folder |
| `frontend/src/Apps/OfficeApp.jsx` | Loads Office Program folder |

## Tests

| File | Description |
|------|-------------|
| `tests/unit/suite/adapters/content/folder/folderAdapterListAction.unit.test.mjs` | Action type logic tests |
| `tests/runtime/tv-app/tv-menu-action-parity.runtime.test.mjs` | API schema parity tests |
| `tests/runtime/tv-app/tv-folder-submenu.runtime.test.mjs` | FHE submenu navigation tests |
| `tests/runtime/tv-app/tv-chosen-season-list.runtime.test.mjs` | Show/season list tests |

## Data Files

| Path | Description |
|------|-------------|
| `data/households/{hid}/state/lists.yml` | Menu item definitions |
| `data/households/{hid}/state/watch/*.yml` | Watch progress by category |
