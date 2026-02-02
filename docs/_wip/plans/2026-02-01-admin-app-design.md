# AdminApp Design - Infinity Migration

**Date:** 2026-02-01
**Status:** Implemented
**Goal:** Replace Infinity-managed state files with self-contained admin UI

---

## Problem

The `data/household/state/` folder contains YAML files synced from Infinity (startinfinity.com), a kanban tool. This creates:

1. **Editing friction** - Changes require Infinity's web UI
2. **Data structure limitations** - Flat arrays with `folder` tags instead of real hierarchy
3. **Dependency risk** - External service controls data pipeline
4. **Antipatterns in codebase** - Infinity concepts (uid, folder) leaked into adapters like FolderAdapter

---

## Solution

Build AdminApp - a self-contained admin UI that:
- Provides CRUD for household config
- Uses proper file-per-folder structure
- Removes Infinity dependency
- Follows existing app config patterns (like FitnessApp)

---

## Data Architecture

### New Structure

```
data/household/
├── apps/
│   ├── fitness/config.yml     # Exists - app-specific config
│   ├── tv/config.yml          # NEW - TVApp nav, menus
│   └── office/config.yml      # NEW - keyboard mappings
│
├── config/
│   ├── devices.yml            # Exists
│   ├── household.yml          # Exists
│   ├── integrations.yml       # Exists
│   ├── playback.yml           # NEW - volume/rate overrides
│   └── watchlists/            # NEW - household content lists
│       ├── parenting.yml
│       ├── fhe.yml
│       ├── morning-program.yml
│       ├── scripture.yml
│       └── ...
│
└── state/                     # LEGACY - deprecate after migration
    ├── lists.yml
    ├── watchlist.yml
    ├── keyboard.yml
    └── ...
```

### Key Distinctions

| Type | Scope | Location |
|------|-------|----------|
| App config | App-specific nav/settings | `apps/{app}/config.yml` |
| Content lists | Household-wide content | `config/watchlists/*.yml` |
| System settings | Playback, devices | `config/*.yml` |

### Item Schema (new format)

```yaml
# data/household/config/watchlists/parenting.yml
- label: Raising Kids Emotionally
  input: plex:311549
  action: Play
  active: true

- label: Screen Time Balance
  input: plex:394500
  action: Play
  active: false
  image: /media/img/lists/019b436a-f458-711a-9517-32fca72b7dff.jpg
```

**Removed from legacy format:**
- `uid` - Infinity's external ID
- `folder` - folder = filename now
- Infinity image URLs - use local `/media/img/lists/{uuid}.jpg` paths

---

## App Taxonomy

```
Apps
├── Player-Enabled Apps (can play media)
│   ├── Direct Player (TVApp, OfficeApp)
│   │   └── Uses <Player> directly
│   │
│   └── Governed Player (FitnessApp)
│       └── Custom wrapper (<FitnessPlayer>)
│
└── Data Apps (no playback)
    ├── Display Apps (FinanceApp, HealthApp)
    └── Admin Apps (AdminApp) ← NEW
```

---

## Frontend: AdminApp

### Route

- AdminApp replaces RootApp at `/`
- `/admin` redirects to `/`

### Tech Stack

- React + Mantine 7 (already installed)
- Classic SaaS layout (sidebar nav + main content)
- Follow existing patterns from FitnessApp/FinanceApp

### Architecture Patterns

**Provider Wrapping:**
```jsx
// AdminApp.jsx
<MantineProvider>
  <AdminProvider>  {/* Context for admin state */}
    <AdminLayout>
      <Outlet />   {/* React Router nested routes */}
    </AdminLayout>
  </AdminProvider>
</MantineProvider>
```

**Logging (required):**
```javascript
const logger = useMemo(() => getChildLogger({ app: 'admin' }), []);
logger.info('admin.lists.loaded', { folder, count: items.length });
```

**API Calls (use DaylightAPI):**
```javascript
import { DaylightAPI } from '../lib/api.mjs';

const data = await DaylightAPI('api/v1/admin/content/lists');
await DaylightAPI('api/v1/admin/content/lists/parenting/items', item, 'POST');
```

**State Management:**
```javascript
// Loading/error/data pattern
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);
const [data, setData] = useState(null);

useEffect(() => {
  const fetch = async () => {
    try {
      setLoading(true);
      const result = await DaylightAPI('...');
      setData(result);
    } catch (err) {
      setError(err);
      logger.error('admin.fetch.failed', { message: err.message });
    } finally {
      setLoading(false);
    }
  };
  fetch();
}, []);
```

### Navigation Structure

```
CONTENT
├── Lists        ← MVP: Full CRUD (Infinity migration)
├── Menus        ← Placeholder
└── Playlists    ← Placeholder

APPS
├── TV           ← Placeholder (apps/tv/config.yml)
├── Office       ← Placeholder (apps/office/config.yml)
└── Fitness      ← Placeholder (read-only view)

HOUSEHOLD
├── Users        ← Placeholder
├── Devices      ← Placeholder
└── Rooms        ← Placeholder

SYSTEM
├── Playback     ← Placeholder
└── Integrations ← Placeholder
```

### Layout Design

```
┌─────────────────────────────────────────────────────────┐
│  Logo/Title                              [User] [Logout]│
├────────────┬────────────────────────────────────────────┤
│            │                                            │
│  CONTENT   │  Breadcrumb: Content > Lists > Parenting   │
│  ├ Lists ← │ ────────────────────────────────────────── │
│  ├ Menus   │                                            │
│  └ Playlist│  [+ Add Item]              [Search...]     │
│            │ ────────────────────────────────────────── │
│  APPS      │  ┌─────────────────────────────────────┐   │
│  ├ TV      │  │ ≡  [img] Raising Kids Emotionally  │   │
│  ├ Office  │  │         plex:311549    ○ Active    │   │
│  └ Fitness │  ├─────────────────────────────────────┤   │
│            │  │ ≡  [img] Screen Time Balance       │   │
│  HOUSEHOLD │  │         plex:394500    ○ Inactive  │   │
│  ├ Users   │  └─────────────────────────────────────┘   │
│  ├ Devices │                                            │
│  └ Rooms   │                                            │
│            │                                            │
│  SYSTEM    │                                            │
│  ├ Playback│                                            │
│  └ Integr. │                                            │
│            │                                            │
└────────────┴────────────────────────────────────────────┘
```

### Component Specifications

#### AdminLayout.jsx
- Mantine `AppShell` with `Navbar` and `Header`
- Responsive: sidebar collapses on mobile
- Breadcrumb in header derived from route

#### AdminNav.jsx
- Mantine `NavLink` components grouped by section
- Active state from React Router location
- Section headers: CONTENT, APPS, HOUSEHOLD, SYSTEM

#### ListsIndex.jsx (Content > Lists landing)
| Element | Component | Behavior |
|---------|-----------|----------|
| Folder cards | `SimpleGrid` + `Card` | Click → navigate to folder |
| Folder count | `Badge` | Show item count per folder |
| New folder | `Button` + `Modal` | Create new watchlist file |

#### ListsFolder.jsx (Content > Lists > {folder})
| Element | Component | Behavior |
|---------|-----------|----------|
| Item list | `DragDropContext` + custom rows | Reorderable list |
| Add button | `Button` | Opens ListsItemEditor modal |
| Search filter | `TextInput` | Filter visible items |
| Bulk actions | `ActionIcon` group | Delete selected, toggle active |

#### ListsItemRow.jsx (single draggable row)
| Element | Component | Behavior |
|---------|-----------|----------|
| Drag handle | `≡` icon | Draggable via @dnd-kit |
| Thumbnail | `Image` or `Avatar` | From image field or Plex thumb |
| Label | `Text` | Primary identifier |
| Input badge | `Badge` | Shows `plex:123` or `media:path` |
| Active toggle | `Switch` | Inline toggle, auto-saves |
| Actions | `Menu` | Edit, Delete, Duplicate |

#### ListsItemEditor.jsx (modal for add/edit)
| Field | Component | Notes |
|-------|-----------|-------|
| Label | `TextInput` | Required |
| Input | `Autocomplete` | ContentQueryService search |
| Action | `Select` | Play, Queue, Display, Read |
| Active | `Switch` | Default: true |
| Image | `FileInput` + preview | Upload or paste URL |

**Autocomplete behavior:**
```
User types: "raising"
↓
GET /api/v1/content/search?source=plex&q=raising
↓
Dropdown shows:
  [thumb] Raising Kids Emotionally (Movie, 2019)
  [thumb] Raising Arizona (Movie, 1987)
↓
User selects → input field populated with "plex:311549"
```

### MVP Scope

Only **Content > Lists** is fully functional in v1:
- List all folders (parenting, fhe, etc.)
- View items in folder
- Add/edit/delete items
- Drag-drop reorder (via @dnd-kit/core)
- Toggle active state (inline)
- Image upload (multipart to backend)
- Content search autocomplete (via existing ContentQueryService)

### Mantine Components Used

```javascript
// Layout
import { AppShell, Navbar, Header, NavLink, Breadcrumbs } from '@mantine/core';

// Lists
import { Card, SimpleGrid, Badge, Group, Stack, Text } from '@mantine/core';

// Forms
import { TextInput, Select, Switch, FileInput, Autocomplete } from '@mantine/core';

// Feedback
import { Modal, Menu, ActionIcon, Button, Alert, Loader } from '@mantine/core';

// Media
import { Image, Avatar } from '@mantine/core';
```

### Drag-and-Drop

Use `@dnd-kit/core` (already in codebase for FitnessApp):
```javascript
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
```

On drag end → PUT `/api/v1/admin/content/lists/:folder` with reordered array

---

## Backend API

### Architecture Patterns

**Router Location:**
```
backend/src/4_api/v1/routers/admin/
├── content.mjs      # Lists CRUD
├── apps.mjs         # App config CRUD
└── images.mjs       # Image upload
```

**Router Factory Pattern:**
```javascript
// content.mjs
import { asyncHandler } from '#system/http/middleware/asyncHandler.mjs';
import { loadYaml, saveYaml, deleteYaml } from '#system/utils/FileIO.mjs';
import { ValidationError, NotFoundError } from '#system/utils/errors/index.mjs';

/**
 * Admin Content Router
 *
 * Endpoints:
 *   GET  /lists              - List all folders
 *   GET  /lists/:folder      - Get items in folder
 *   PUT  /lists/:folder      - Update folder (reorder)
 *   POST /lists/:folder/items - Add item
 *   ...
 */
export function createAdminContentRouter(config) {
  const { configService, userDataService, logger = console } = config;
  const router = express.Router();

  // Routes here...

  return router;
}
```

**Multi-Household Support:**
```javascript
router.get('/lists', asyncHandler(async (req, res) => {
  const hid = req.query.household || configService.getDefaultHouseholdId();
  // Use hid for all file paths
}));
```

### Admin API (`/api/v1/admin/`)

Config CRUD only - no duplication of content queries.

#### Content Lists Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/content/lists` | List all folder names with item counts |
| POST | `/content/lists` | Create new folder |
| GET | `/content/lists/:folder` | Get all items in folder |
| PUT | `/content/lists/:folder` | Replace folder contents (reorder) |
| DELETE | `/content/lists/:folder` | Delete entire folder |
| POST | `/content/lists/:folder/items` | Add item to folder |
| PUT | `/content/lists/:folder/items/:index` | Update item at index |
| DELETE | `/content/lists/:folder/items/:index` | Remove item at index |

#### Endpoint Specifications

**GET /content/lists**
```javascript
// Response
{
  "folders": [
    { "name": "parenting", "count": 12, "path": "config/watchlists/parenting.yml" },
    { "name": "fhe", "count": 8, "path": "config/watchlists/fhe.yml" },
    { "name": "scripture", "count": 24, "path": "config/watchlists/scripture.yml" }
  ],
  "household": "default"
}
```

**POST /content/lists**
```javascript
// Request
{ "name": "Morning Program" }

// Processing
// - Kebab-case: "morning-program"
// - Validate: /^[a-z0-9-]+$/
// - Create empty: config/watchlists/morning-program.yml

// Response
{ "ok": true, "folder": "morning-program", "path": "config/watchlists/morning-program.yml" }

// Errors
// 400: { "error": "Invalid folder name", "hint": "Use alphanumeric and hyphens only" }
// 409: { "error": "Folder already exists", "folder": "morning-program" }
```

**GET /content/lists/:folder**
```javascript
// Response
{
  "folder": "parenting",
  "items": [
    {
      "index": 0,
      "label": "Raising Kids Emotionally",
      "input": "plex:311549",
      "action": "Play",
      "active": true,
      "image": "/media/img/lists/019b436a-....jpg"
    },
    {
      "index": 1,
      "label": "Screen Time Balance",
      "input": "plex:394500",
      "action": "Play",
      "active": false,
      "image": null
    }
  ],
  "count": 2,
  "household": "default"
}

// Errors
// 404: { "error": "Folder not found", "folder": "nonexistent" }
```

**PUT /content/lists/:folder**
```javascript
// Request (full replacement for reorder)
{
  "items": [
    { "label": "Screen Time Balance", "input": "plex:394500", "action": "Play", "active": false },
    { "label": "Raising Kids Emotionally", "input": "plex:311549", "action": "Play", "active": true }
  ]
}

// Response
{ "ok": true, "folder": "parenting", "count": 2 }
```

**POST /content/lists/:folder/items**
```javascript
// Request
{
  "label": "New Parenting Video",
  "input": "plex:999999",
  "action": "Play",
  "active": true,
  "image": "/media/img/lists/abc123.jpg"  // optional
}

// Response
{ "ok": true, "index": 2, "folder": "parenting" }

// Errors
// 400: { "error": "Missing required field", "field": "label" }
// 400: { "error": "Missing required field", "field": "input" }
```

**PUT /content/lists/:folder/items/:index**
```javascript
// Request (partial update)
{ "active": false }

// or full update
{
  "label": "Updated Label",
  "input": "plex:888888",
  "action": "Queue",
  "active": true
}

// Response
{ "ok": true, "index": 1, "folder": "parenting" }

// Errors
// 404: { "error": "Item not found", "index": 99, "folder": "parenting" }
```

**DELETE /content/lists/:folder/items/:index**
```javascript
// Response
{ "ok": true, "deleted": { "index": 1, "label": "Screen Time Balance" } }
```

#### Image Upload Endpoint

**POST /content/images**
```javascript
// Request: multipart/form-data
// Field: "file" (image/jpeg, image/png, image/webp)

// Processing:
// 1. Generate UUID
// 2. Save to /media/img/lists/{uuid}.jpg
// 3. Return path

// Response
{
  "ok": true,
  "path": "/media/img/lists/abc12345-6789-....jpg",
  "size": 245000,
  "type": "image/jpeg"
}

// Errors
// 400: { "error": "No file uploaded" }
// 400: { "error": "Invalid file type", "allowed": ["image/jpeg", "image/png", "image/webp"] }
// 413: { "error": "File too large", "maxSize": "5MB" }
```

#### App Config Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/apps/:app/config` | Get app config |
| PUT | `/apps/:app/config` | Update app config |

```javascript
// GET /apps/tv/config
{
  "app": "tv",
  "config": { /* contents of apps/tv/config.yml */ },
  "path": "apps/tv/config.yml"
}

// PUT /apps/tv/config
// Request: full config object
// Response: { "ok": true, "app": "tv" }
```

### Error Handling

Use domain error classes (auto-converted to HTTP status by middleware):

```javascript
import { ValidationError, NotFoundError, ConflictError } from '#system/utils/errors/index.mjs';

// In route handler:
if (!label) throw new ValidationError('Missing required field', { field: 'label' });
if (!folderExists) throw new NotFoundError('Folder', folderName);
if (folderExists) throw new ConflictError('Folder already exists', { folder: folderName });
```

| Error Class | HTTP Status |
|-------------|-------------|
| ValidationError | 400 |
| NotFoundError | 404 |
| ConflictError | 409 |
| BusinessRuleError | 422 |

### File I/O

All YAML operations via FileIO.mjs:

```javascript
import { loadYaml, saveYaml, loadYamlSafe } from '#system/utils/FileIO.mjs';

// Read folder
const items = loadYamlSafe(watchlistPath) || [];

// Write folder
saveYaml(watchlistPath, items);

// Path construction
const watchlistPath = path.join(
  userDataService.getHouseholdPath(hid),
  'config/watchlists',
  `${folder}.yml`
);
```

### Existing APIs (reuse)

Frontend uses existing content APIs for autocomplete:
- `GET /api/v1/content/search?source=plex&q=...` - Search Plex library
- `GET /api/v1/content/plex/info/:id` - Get Plex item details (for thumbnail)

### Validation Rules

| Field | Rule | Error |
|-------|------|-------|
| folder name | `/^[a-z0-9-]+$/` | "Invalid folder name" |
| label | required, non-empty | "Missing required field: label" |
| input | required, format `source:id` | "Missing required field: input" |
| action | enum: Play, Queue, Display, Read | "Invalid action" |
| active | boolean | (default: true) |
| image | valid path or null | (optional) |
| index | integer >= 0 | "Invalid index" |

### Logging

```javascript
logger.info?.('admin.lists.created', { folder, hid });
logger.info?.('admin.lists.item.added', { folder, index, label });
logger.info?.('admin.lists.reordered', { folder, count });
logger.warn?.('admin.lists.item.not-found', { folder, index });
logger.error?.('admin.lists.save.failed', { folder, error: err.message });
```

---

## Migration Strategy

### State File Inventory

Current `data/household/state/` contents:

| File | Size | Purpose | Target Location |
|------|------|---------|-----------------|
| `lists.yml` | 46KB | Content lists by folder | `config/watchlists/*.yml` |
| `keyboard.yml` | 3KB | Office keypad bindings | `apps/office/config.yml` |
| `mediamenu.yml` | 8KB | TV menu items | `apps/tv/config.yml` |
| `media_config.yml` | 8KB | Playback overrides | `config/playback.yml` |
| `watchlist.yml` | 406KB | Watch progress tracking | Keep as-is (runtime state) |
| `entropy.yml` | 10KB | Random content pool | `config/entropy.yml` |
| `nav.yml` | 2KB | App navigation | `config/nav.yml` |
| `videomenu.yml` | 8KB | Video menu items | Merge into `apps/tv/config.yml` |
| `youtube.yml` | 2KB | YouTube channels | `config/youtube.yml` |
| `weather.yml` | 12KB | Weather cache | Keep as-is (runtime cache) |
| `watchhistory.yml` | ~0 | Watch history | Keep as-is (runtime state) |

### lists.yml → config/watchlists/

**Source structure (flat array with folder tags):**
```yaml
# state/lists.yml - all items in one file
- label: Raising Kids
  input: plex:311549
  folder: Parenting        # ← folder as tag
  uid: abc123...           # ← Infinity ID (remove)

- label: FHE Activity
  input: media:fhe/games
  folder: FHE              # ← different folder
  uid: def456...
```

**Target structure (file-per-folder):**
```yaml
# config/watchlists/parenting.yml
- label: Raising Kids
  input: plex:311549
  action: Play
  active: true
  # No folder field - filename IS the folder
  # No uid field - Infinity concept removed

# config/watchlists/fhe.yml
- label: FHE Activity
  input: media:fhe/games
  action: Play
  active: true
```

**Folder distribution in lists.yml:**
| Folder | Items | Target File |
|--------|-------|-------------|
| TVApp | 36 | `watchlists/tvapp.yml` |
| Office Program | 15 | `watchlists/office-program.yml` |
| Scripture | 10 | `watchlists/scripture.yml` |
| LDS | 10 | `watchlists/lds.yml` |
| Kids | 10 | `watchlists/kids.yml` |
| Health | 10 | `watchlists/health.yml` |
| FHE | 10 | `watchlists/fhe.yml` |
| Education | 10 | `watchlists/education.yml` |
| Ambient | 10 | `watchlists/ambient.yml` |
| TV | 10 | `watchlists/tv.yml` |
| Music | 9 | `watchlists/music.yml` |
| Morning Program | 9 | `watchlists/morning-program.yml` |
| Music Queue | 8 | `watchlists/music-queue.yml` |
| *(others)* | 21 | Various |

### keyboard.yml → apps/office/config.yml

**Source:**
```yaml
# state/keyboard.yml
- key: '1'
  label: play
  function: playback
  params: play
  folder: Office Keypad    # ← remove
  uid: abc123...           # ← remove
```

**Target:**
```yaml
# apps/office/config.yml
keypad:
  - key: '1'
    label: play
    function: playback
    params: play
```

### mediamenu.yml → apps/tv/config.yml

**Source:**
```yaml
# state/mediamenu.yml
- label: Baby Joy Joy
  menu: Kids Shows
  type: Plex
  key: '409169'
  folder: Kids             # ← remove
  uid: abc123...           # ← remove
```

**Target:**
```yaml
# apps/tv/config.yml
menus:
  kids:
    - label: Baby Joy Joy
      input: plex:409169
      continuous: true
      shuffle: false
```

### media_config.yml → config/playback.yml

**Source:**
```yaml
# state/media_config.yml
- note: Classical
  media_key: '622894'
  kind: Plex
  volume: 100
  rate: 200
  shuffle: true
  folder: Media            # ← remove
  uid: abc123...           # ← remove
  image: https://...       # ← migrate to local
```

**Target:**
```yaml
# config/playback.yml
overrides:
  - input: plex:622894
    label: Classical
    volume: 100
    rate: 200
    shuffle: true
    image: /media/img/lists/abc123.jpg
```

### Schema Transformations

| Legacy Field | New Field | Transformation |
|--------------|-----------|----------------|
| `folder` | *(filename)* | Remove; folder = filename |
| `uid` | *(remove)* | Infinity ID, not needed |
| `type` + `key` | `input` | Combine: `plex:123`, `media:path` |
| `kind` + `media_key` | `input` | Combine: `plex:123`, `media:path` |
| `image` (Infinity URL) | `image` | Download → `/media/img/lists/{uuid}.jpg` |
| `hide` | `active` | Invert: `hide: true` → `active: false` |
| `menu` | *(context)* | Used for grouping, may inform target file |

### Migration Script

A one-time migration script to run:

```javascript
// scripts/migrate-state-to-config.mjs

import { loadYaml, saveYaml } from '#system/utils/FileIO.mjs';
import { v4 as uuid } from 'uuid';
import path from 'path';

const HOUSEHOLD_PATH = process.env.HOUSEHOLD_PATH;
const MEDIA_PATH = process.env.MEDIA_PATH;

async function migrateLists() {
  const lists = loadYaml(path.join(HOUSEHOLD_PATH, 'state/lists.yml'));

  // Group by folder
  const byFolder = {};
  for (const item of lists) {
    const folder = kebabCase(item.folder);
    if (!byFolder[folder]) byFolder[folder] = [];

    byFolder[folder].push({
      label: item.label,
      input: transformInput(item),
      action: item.action || 'Play',
      active: item.hide !== true,
      image: await migrateImage(item.image)
    });
  }

  // Write individual files
  for (const [folder, items] of Object.entries(byFolder)) {
    const outPath = path.join(HOUSEHOLD_PATH, `config/watchlists/${folder}.yml`);
    saveYaml(outPath, items);
    console.log(`Migrated ${items.length} items to ${folder}.yml`);
  }
}

function transformInput(item) {
  if (item.type === 'Plex') return `plex:${item.key}`;
  if (item.type === 'Local') return `media:${item.key}`;
  if (item.kind === 'Plex') return `plex:${item.media_key}`;
  if (item.kind === 'Media') return `media:${item.media_key}`;
  return item.input || `unknown:${item.key || item.media_key}`;
}

async function migrateImage(imageUrl) {
  if (!imageUrl) return null;
  if (!imageUrl.includes('startinfinity.com')) return imageUrl;

  // Download and save locally
  const id = uuid();
  const localPath = `/media/img/lists/${id}.jpg`;
  try {
    const response = await fetch(imageUrl);
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      await fs.writeFile(path.join(MEDIA_PATH, `img/lists/${id}.jpg`), Buffer.from(buffer));
      return localPath;
    }
  } catch (e) {
    console.warn(`Failed to migrate image: ${e.message}`);
  }
  return null; // Infinity URL expired
}

function kebabCase(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}
```

### Parallel Operation

During migration:

1. **AdminApp writes to new location** (`config/watchlists/`)
2. **Backend reads from both** (new takes precedence)
3. **Migrate content gradually** via UI or script
4. **Once migrated**, remove InfinityHarvester and delete `state/`

### Backend Read Priority

```javascript
// In FolderAdapter or new WatchlistAdapter
async getList(folder) {
  const hid = this.configService.getDefaultHouseholdId();
  const basePath = this.userDataService.getHouseholdPath(hid);

  // Try new location first
  const newPath = path.join(basePath, `config/watchlists/${folder}.yml`);
  const newData = loadYamlSafe(newPath);
  if (newData) return newData;

  // Fall back to legacy
  const legacyPath = path.join(basePath, 'state/lists.yml');
  const legacy = loadYamlSafe(legacyPath) || [];
  return legacy
    .filter(item => kebabCase(item.folder) === folder)
    .map(item => ({
      label: item.label,
      input: transformInput(item),
      action: item.action || 'Play',
      active: item.hide !== true,
      image: item.image
    }));
}
```

### Deprecation Path

| Phase | Action | Removes |
|-------|--------|---------|
| 1 | AdminApp + parallel read | Nothing yet |
| 2 | Run migration script | Nothing yet |
| 3 | Verify all data migrated | `InfinityHarvester.mjs` |
| 4 | Remove fallback read logic | `state/lists.yml` |
| 5 | Clean up FolderAdapter | `uid`, `folder` field handling |

### Files to Delete After Migration

```
state/
├── lists.yml              # → config/watchlists/*.yml
├── keyboard.yml           # → apps/office/config.yml
├── mediamenu.yml          # → apps/tv/config.yml
├── videomenu.yml          # → apps/tv/config.yml
├── media_config.yml       # → config/playback.yml
├── nav.yml                # → config/nav.yml
├── entropy.yml            # → config/entropy.yml
└── youtube.yml            # → config/youtube.yml

# KEEP (runtime state, not config):
├── watchlist.yml          # Watch progress - runtime
├── watchhistory.yml       # Watch history - runtime
└── weather.yml            # Weather cache - runtime
```

### Image Migration

Legacy files contain Infinity signed URLs:
```
https://app.startinfinity.com/api/attachments/get?access_key=eyJ...&signature=...
```

These URLs **expire**. Migration approach:

1. **Migration script** → Download all Infinity images → save to `/media/img/lists/{uuid}.jpg`
2. **On edit via AdminApp** → If image is Infinity URL, attempt download → save locally → update reference
3. **Fallback rendering** → If Infinity URL, show placeholder (expired)

**Image endpoint:**
```
POST /api/v1/admin/content/images
Body: multipart/form-data (file)
Returns: { path: "/media/img/lists/{uuid}.jpg" }
```

---

## File Structure

### Frontend

```
frontend/src/
├── Apps/
│   ├── AdminApp.jsx           # NEW - main admin app entry
│   └── AdminApp.scss          # NEW - admin-specific styles
│
├── context/
│   └── AdminContext.jsx       # NEW - admin state provider
│
├── modules/
│   └── Admin/                 # NEW
│       ├── AdminLayout.jsx    # AppShell wrapper (nav + header + content)
│       ├── AdminNav.jsx       # Sidebar NavLink groups
│       ├── AdminHeader.jsx    # Header with breadcrumb + user
│       │
│       ├── ContentLists/
│       │   ├── index.js           # Route exports
│       │   ├── ListsIndex.jsx     # Folder grid view
│       │   ├── ListsFolder.jsx    # Items table with DnD
│       │   ├── ListsItemRow.jsx   # Draggable row component
│       │   ├── ListsItemEditor.jsx # Add/edit modal
│       │   ├── ListsFolderCreate.jsx # New folder modal
│       │   └── ContentLists.scss  # Section styles
│       │
│       └── Placeholders/
│           └── ComingSoon.jsx # "Coming soon" placeholder
│
├── hooks/
│   └── admin/
│       ├── useAdminLists.js   # CRUD: folders, items, reorder
│       ├── useContentSearch.js # Autocomplete via /content/search
│       └── useImageUpload.js  # Upload to /admin/content/images
│
└── main.jsx                   # Update routes for AdminApp
```

### Backend

```
backend/src/
├── 4_api/v1/routers/
│   ├── api.mjs                # ADD: mount admin routes
│   └── admin/                 # NEW directory
│       ├── content.mjs        # Lists CRUD router
│       ├── apps.mjs           # App config router
│       └── images.mjs         # Image upload router
│
└── 3_application/             # If service layer needed
    └── admin/
        └── AdminContentService.mjs  # Optional: complex operations
```

### Data

```
data/household/
├── config/
│   └── watchlists/            # NEW directory
│       ├── parenting.yml      # Migrated from lists.yml
│       ├── fhe.yml
│       ├── morning-program.yml
│       └── scripture.yml
│
└── apps/
    ├── tv/config.yml          # NEW (future)
    └── office/config.yml      # NEW (future)
```

---

## Resolved Questions

### 1. Image Storage

Images go to `/media/img/lists/` using UUID filenames (existing convention):

```
/media/img/
├── lists/          ← List item images (UUID: 019b436a-...jpg)
├── icons/          ← App icons (semantic: cardio.svg)
├── users/          ← User avatars (username: kckern.jpg)
├── equipment/      ← Fitness equipment (semantic: niceday.jpg)
├── nav/            ← Navigation images (UUID)
├── art/            ← Art/religious imagery (categorized)
└── ...
```

**AdminApp uploads → `/media/img/lists/{uuid}.jpg`**

This replaces the Infinity signed URLs (which expire) with permanent local paths.

### 2. Folder Creation

Allow creating new folders from UI. Folder name = filename (lowercase, kebab-case).
- User enters "Morning Program" → creates `morning-program.yml`
- Validation: alphanumeric + hyphens only

### 3. Validation

Soft validation (warn, don't block):
- Invalid Plex IDs → warning icon, allow save
- Missing images → fallback to content thumbnail
- ContentQueryService provides autocomplete to minimize errors

### 4. Auth

Use existing household auth. AdminApp is household-level config management, same auth scope as other household features.

---

## Next Steps

1. Create AdminApp scaffold (route, layout, nav)
2. Implement Content > Lists UI
3. Add backend admin API endpoints
4. Wire up content search autocomplete
5. Add image upload
6. Test parallel read with legacy data

---

## Implementation Notes

**Completed:** 2026-02-01

### Files Created

**Backend:**
- `backend/src/4_api/v1/routers/admin/content.mjs` - Lists CRUD API
- `backend/src/4_api/v1/routers/admin/images.mjs` - Image upload API
- `backend/src/4_api/v1/routers/admin/index.mjs` - Combined admin router

**Frontend:**
- `frontend/src/Apps/AdminApp.jsx` - App entry point
- `frontend/src/modules/Admin/AdminLayout.jsx` - AppShell layout
- `frontend/src/modules/Admin/AdminNav.jsx` - Sidebar navigation
- `frontend/src/modules/Admin/AdminHeader.jsx` - Header with breadcrumbs
- `frontend/src/modules/Admin/ContentLists/ListsIndex.jsx` - Folder grid
- `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx` - Items view with DnD
- `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` - Draggable row
- `frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx` - Add/edit modal
- `frontend/src/hooks/admin/useAdminLists.js` - API hook

**Scripts:**
- `scripts/migrate-lists-to-watchlists.mjs` - Data migration

### Deferred to Future Work

- Content search autocomplete (uses existing /content/search)
- App config editors (TV, Office, Fitness)
- Household management (Users, Devices, Rooms)
- System settings (Playback, Integrations)
