# AdminApp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an AdminApp that provides CRUD for household config, replacing Infinity-managed state files with self-contained admin UI.

**Architecture:** React frontend with Mantine 7 components in classic SaaS layout (sidebar nav + main content). Backend exposes admin API endpoints under `/api/v1/admin/` using existing router factory patterns. MVP focuses on Content > Lists functionality with drag-drop reordering.

**Tech Stack:** React, Mantine 7, @dnd-kit/core (already installed), Express routers, YAML file storage via FileIO.mjs

---

## Phase 1: Backend API Foundation

### Task 1: Create Admin Content Router Factory

**Files:**
- Create: `backend/src/4_api/v1/routers/admin/content.mjs`

**Step 1: Write the failing test**

Create a minimal test to verify the router factory exists and returns a router.

```javascript
// tests/unit/api/admin/content.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { createAdminContentRouter } from '../../../../backend/src/4_api/v1/routers/admin/content.mjs';

describe('Admin Content Router', () => {
  it('should create a router with required dependencies', () => {
    const mockConfig = {
      userDataService: { getHouseholdPath: vi.fn(() => '/data/household') },
      configService: { getDefaultHouseholdId: vi.fn(() => 'default') },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    };

    const router = createAdminContentRouter(mockConfig);
    expect(router).toBeDefined();
    expect(typeof router.get).toBe('function');
    expect(typeof router.post).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/api/admin/content.test.mjs`
Expected: FAIL with "Cannot find module" or "createAdminContentRouter is not a function"

**Step 3: Write minimal implementation**

```javascript
// backend/src/4_api/v1/routers/admin/content.mjs
import express from 'express';
import path from 'path';
import { loadYamlSafe, saveYaml, listYamlFiles, ensureDir, deleteYaml } from '#system/utils/FileIO.mjs';
import { ValidationError, NotFoundError, ConflictError } from '#system/utils/errors/index.mjs';

/**
 * Admin Content Router
 *
 * Endpoints:
 *   GET  /lists              - List all folders
 *   POST /lists              - Create new folder
 *   GET  /lists/:folder      - Get items in folder
 *   PUT  /lists/:folder      - Update folder (reorder)
 *   DELETE /lists/:folder    - Delete folder
 *   POST /lists/:folder/items - Add item
 *   PUT  /lists/:folder/items/:index - Update item at index
 *   DELETE /lists/:folder/items/:index - Remove item at index
 *
 * @param {Object} config
 * @param {Object} config.userDataService - For household path resolution
 * @param {Object} config.configService - For default household ID
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAdminContentRouter(config) {
  const { userDataService, configService, logger = console } = config;
  const router = express.Router();

  // Helper: get watchlists directory path for a household
  function getWatchlistsPath(hid) {
    const basePath = userDataService.getHouseholdPath(hid);
    return path.join(basePath, 'config', 'watchlists');
  }

  // Helper: get path for a specific watchlist file
  function getWatchlistFilePath(hid, folder) {
    return path.join(getWatchlistsPath(hid), folder);
  }

  // Helper: validate folder name (kebab-case, alphanumeric with hyphens)
  function validateFolderName(name) {
    const kebab = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!kebab || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(kebab)) {
      throw new ValidationError('Invalid folder name', { hint: 'Use alphanumeric and hyphens only' });
    }
    return kebab;
  }

  // GET /lists - List all folders with item counts
  router.get('/lists', async (req, res, next) => {
    try {
      const hid = req.query.household || configService.getDefaultHouseholdId();
      const watchlistsPath = getWatchlistsPath(hid);

      ensureDir(watchlistsPath);

      const files = listYamlFiles(watchlistsPath);
      const folders = files.map(file => {
        const name = path.basename(file, path.extname(file));
        const items = loadYamlSafe(file) || [];
        return {
          name,
          count: items.length,
          path: `config/watchlists/${name}.yml`
        };
      });

      logger.info?.('admin.lists.listed', { hid, folderCount: folders.length });
      res.json({ folders, household: hid });
    } catch (error) {
      next(error);
    }
  });

  // POST /lists - Create new folder
  router.post('/lists', async (req, res, next) => {
    try {
      const hid = req.query.household || configService.getDefaultHouseholdId();
      const { name } = req.body;

      if (!name) {
        throw new ValidationError('Missing required field', { field: 'name' });
      }

      const folder = validateFolderName(name);
      const filePath = getWatchlistFilePath(hid, folder);

      const existing = loadYamlSafe(filePath);
      if (existing !== null) {
        throw new ConflictError('Folder already exists', { folder });
      }

      ensureDir(path.dirname(filePath));
      saveYaml(filePath, []);

      logger.info?.('admin.lists.created', { folder, hid });
      res.json({ ok: true, folder, path: `config/watchlists/${folder}.yml` });
    } catch (error) {
      next(error);
    }
  });

  // GET /lists/:folder - Get items in folder
  router.get('/lists/:folder', async (req, res, next) => {
    try {
      const hid = req.query.household || configService.getDefaultHouseholdId();
      const { folder } = req.params;
      const filePath = getWatchlistFilePath(hid, folder);

      const items = loadYamlSafe(filePath);
      if (items === null) {
        throw new NotFoundError('Folder', folder);
      }

      const itemsWithIndex = items.map((item, index) => ({ index, ...item }));

      logger.info?.('admin.lists.loaded', { folder, count: items.length, hid });
      res.json({ folder, items: itemsWithIndex, count: items.length, household: hid });
    } catch (error) {
      next(error);
    }
  });

  // PUT /lists/:folder - Replace folder contents (reorder)
  router.put('/lists/:folder', async (req, res, next) => {
    try {
      const hid = req.query.household || configService.getDefaultHouseholdId();
      const { folder } = req.params;
      const { items } = req.body;
      const filePath = getWatchlistFilePath(hid, folder);

      const existing = loadYamlSafe(filePath);
      if (existing === null) {
        throw new NotFoundError('Folder', folder);
      }

      if (!Array.isArray(items)) {
        throw new ValidationError('Items must be an array');
      }

      // Strip index field before saving
      const cleanItems = items.map(({ index, ...rest }) => rest);
      saveYaml(filePath, cleanItems);

      logger.info?.('admin.lists.reordered', { folder, count: cleanItems.length, hid });
      res.json({ ok: true, folder, count: cleanItems.length });
    } catch (error) {
      next(error);
    }
  });

  // DELETE /lists/:folder - Delete entire folder
  router.delete('/lists/:folder', async (req, res, next) => {
    try {
      const hid = req.query.household || configService.getDefaultHouseholdId();
      const { folder } = req.params;
      const filePath = getWatchlistFilePath(hid, folder);

      const existing = loadYamlSafe(filePath);
      if (existing === null) {
        throw new NotFoundError('Folder', folder);
      }

      deleteYaml(filePath);

      logger.info?.('admin.lists.deleted', { folder, hid });
      res.json({ ok: true, folder });
    } catch (error) {
      next(error);
    }
  });

  // POST /lists/:folder/items - Add item to folder
  router.post('/lists/:folder/items', async (req, res, next) => {
    try {
      const hid = req.query.household || configService.getDefaultHouseholdId();
      const { folder } = req.params;
      const { label, input, action = 'Play', active = true, image = null } = req.body;
      const filePath = getWatchlistFilePath(hid, folder);

      if (!label) throw new ValidationError('Missing required field', { field: 'label' });
      if (!input) throw new ValidationError('Missing required field', { field: 'input' });

      const items = loadYamlSafe(filePath);
      if (items === null) {
        throw new NotFoundError('Folder', folder);
      }

      const newItem = { label, input, action, active };
      if (image) newItem.image = image;

      items.push(newItem);
      saveYaml(filePath, items);

      const index = items.length - 1;
      logger.info?.('admin.lists.item.added', { folder, index, label, hid });
      res.json({ ok: true, index, folder });
    } catch (error) {
      next(error);
    }
  });

  // PUT /lists/:folder/items/:index - Update item at index
  router.put('/lists/:folder/items/:index', async (req, res, next) => {
    try {
      const hid = req.query.household || configService.getDefaultHouseholdId();
      const { folder, index: indexStr } = req.params;
      const index = parseInt(indexStr, 10);
      const filePath = getWatchlistFilePath(hid, folder);

      if (isNaN(index) || index < 0) {
        throw new ValidationError('Invalid index', { index: indexStr });
      }

      const items = loadYamlSafe(filePath);
      if (items === null) {
        throw new NotFoundError('Folder', folder);
      }

      if (index >= items.length) {
        throw new NotFoundError('Item', `${folder}[${index}]`);
      }

      // Partial update - merge with existing
      const existing = items[index];
      const { label, input, action, active, image } = req.body;

      if (label !== undefined) existing.label = label;
      if (input !== undefined) existing.input = input;
      if (action !== undefined) existing.action = action;
      if (active !== undefined) existing.active = active;
      if (image !== undefined) existing.image = image;

      items[index] = existing;
      saveYaml(filePath, items);

      logger.info?.('admin.lists.item.updated', { folder, index, hid });
      res.json({ ok: true, index, folder });
    } catch (error) {
      next(error);
    }
  });

  // DELETE /lists/:folder/items/:index - Remove item at index
  router.delete('/lists/:folder/items/:index', async (req, res, next) => {
    try {
      const hid = req.query.household || configService.getDefaultHouseholdId();
      const { folder, index: indexStr } = req.params;
      const index = parseInt(indexStr, 10);
      const filePath = getWatchlistFilePath(hid, folder);

      if (isNaN(index) || index < 0) {
        throw new ValidationError('Invalid index', { index: indexStr });
      }

      const items = loadYamlSafe(filePath);
      if (items === null) {
        throw new NotFoundError('Folder', folder);
      }

      if (index >= items.length) {
        throw new NotFoundError('Item', `${folder}[${index}]`);
      }

      const deleted = items.splice(index, 1)[0];
      saveYaml(filePath, items);

      logger.info?.('admin.lists.item.deleted', { folder, index, label: deleted.label, hid });
      res.json({ ok: true, deleted: { index, label: deleted.label } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/api/admin/content.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/api/admin/content.test.mjs backend/src/4_api/v1/routers/admin/content.mjs
git commit -m "$(cat <<'EOF'
feat(api): add admin content router for lists CRUD

Adds router factory for managing watchlist content:
- GET/POST /lists for folder management
- GET/PUT/DELETE /lists/:folder for folder items
- POST/PUT/DELETE /lists/:folder/items/:index for item CRUD

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create Admin Images Router for File Uploads

**Files:**
- Create: `backend/src/4_api/v1/routers/admin/images.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/api/admin/images.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { createAdminImagesRouter } from '../../../../backend/src/4_api/v1/routers/admin/images.mjs';

describe('Admin Images Router', () => {
  it('should create a router with required dependencies', () => {
    const mockConfig = {
      mediaPath: '/media',
      logger: { info: vi.fn(), error: vi.fn() }
    };

    const router = createAdminImagesRouter(mockConfig);
    expect(router).toBeDefined();
    expect(typeof router.post).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/api/admin/images.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/4_api/v1/routers/admin/images.mjs
import express from 'express';
import multer from 'multer';
import path from 'path';
import { v7 as uuidv7 } from 'uuid';
import { ensureDir, writeBinary } from '#system/utils/FileIO.mjs';
import { ValidationError } from '#system/utils/errors/index.mjs';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Admin Images Router
 *
 * Endpoints:
 *   POST /upload - Upload image file
 *
 * @param {Object} config
 * @param {string} config.mediaPath - Base path for media files
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAdminImagesRouter(config) {
  const { mediaPath, logger = console } = config;
  const router = express.Router();

  // Configure multer for memory storage
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE },
    fileFilter: (req, file, cb) => {
      if (ALLOWED_TYPES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new ValidationError('Invalid file type', { allowed: ALLOWED_TYPES }));
      }
    }
  });

  // POST /upload - Upload image file
  router.post('/upload', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ValidationError('No file uploaded');
      }

      const { buffer, mimetype, size } = req.file;
      const ext = mimetype === 'image/png' ? 'png' :
                  mimetype === 'image/webp' ? 'webp' : 'jpg';

      const id = uuidv7();
      const filename = `${id}.${ext}`;
      const listsImgDir = path.join(mediaPath, 'img', 'lists');
      const filePath = path.join(listsImgDir, filename);
      const publicPath = `/media/img/lists/${filename}`;

      ensureDir(listsImgDir);
      writeBinary(filePath, buffer);

      logger.info?.('admin.images.uploaded', { filename, size, type: mimetype });
      res.json({
        ok: true,
        path: publicPath,
        size,
        type: mimetype
      });
    } catch (error) {
      next(error);
    }
  });

  // Error handler for multer errors
  router.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large', maxSize: '5MB' });
    }
    next(err);
  });

  return router;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/api/admin/images.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/api/admin/images.test.mjs backend/src/4_api/v1/routers/admin/images.mjs
git commit -m "$(cat <<'EOF'
feat(api): add admin images router for file uploads

Handles image uploads for list items:
- POST /upload with multipart/form-data
- Saves to /media/img/lists/{uuid}.ext
- Returns public path for frontend use

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Create Combined Admin Router and Mount in App

**Files:**
- Create: `backend/src/4_api/v1/routers/admin/index.mjs`
- Modify: `backend/src/4_api/v1/routers/api.mjs:53-81`
- Modify: `backend/src/app.mjs:474-484`

**Step 1: Create the combined admin router**

```javascript
// backend/src/4_api/v1/routers/admin/index.mjs
import express from 'express';
import { createAdminContentRouter } from './content.mjs';
import { createAdminImagesRouter } from './images.mjs';
import { createEventBusRouter } from './eventbus.mjs';

/**
 * Combined Admin Router
 *
 * Mounts all admin sub-routers:
 *   /content/* - List/folder management
 *   /images/*  - Image uploads
 *   /ws/*      - EventBus/WebSocket management
 *
 * @param {Object} config
 * @param {Object} config.userDataService
 * @param {Object} config.configService
 * @param {string} config.mediaPath
 * @param {Object} [config.eventBus]
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createAdminRouter(config) {
  const { userDataService, configService, mediaPath, eventBus, logger = console } = config;
  const router = express.Router();

  // Mount content router
  const contentRouter = createAdminContentRouter({
    userDataService,
    configService,
    logger: logger.child?.({ submodule: 'content' }) || logger
  });
  router.use('/content', contentRouter);

  // Mount images router
  const imagesRouter = createAdminImagesRouter({
    mediaPath,
    logger: logger.child?.({ submodule: 'images' }) || logger
  });
  router.use('/images', imagesRouter);

  // Mount eventbus router (existing)
  if (eventBus) {
    const eventBusRouter = createEventBusRouter({
      eventBus,
      logger: logger.child?.({ submodule: 'eventbus' }) || logger
    });
    router.use('/ws', eventBusRouter);
  }

  logger.info?.('admin.router.mounted', { subroutes: ['/content', '/images', '/ws'] });
  return router;
}

export { createAdminContentRouter } from './content.mjs';
export { createAdminImagesRouter } from './images.mjs';
export { createEventBusRouter } from './eventbus.mjs';
```

**Step 2: Update api.mjs route map**

In `backend/src/4_api/v1/routers/api.mjs`, add `/admin` to the routeMap (around line 53-81):

```javascript
// Add to routeMap object (after existing entries)
'/admin': 'admin',
```

**Step 3: Update app.mjs to create and register admin router**

In `backend/src/app.mjs`, add the admin router creation after line 484:

```javascript
// Import at top of file (around line 90)
import { createAdminRouter } from './4_api/v1/routers/admin/index.mjs';

// After v1Routers initialization (around line 484)
v1Routers.admin = createAdminRouter({
  userDataService,
  configService,
  mediaPath: imgBasePath,  // Uses existing imgBasePath variable
  eventBus,
  logger: rootLogger.child({ module: 'admin-api' })
});
```

**Step 4: Run integration test**

Run: `npm test -- tests/live/api/admin.test.mjs` (will create this test later)
Or manually test: `curl http://localhost:3112/api/v1/admin/content/lists`
Expected: JSON response with folders array

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/index.mjs backend/src/4_api/v1/routers/api.mjs backend/src/app.mjs
git commit -m "$(cat <<'EOF'
feat(api): mount admin router at /api/v1/admin

Combines content, images, and eventbus routers under /admin namespace.
Endpoints now available:
- /api/v1/admin/content/lists
- /api/v1/admin/images/upload
- /api/v1/admin/ws/*

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Frontend Foundation

### Task 4: Create AdminApp Entry Point

**Files:**
- Create: `frontend/src/Apps/AdminApp.jsx`
- Create: `frontend/src/Apps/AdminApp.scss`
- Modify: `frontend/src/main.jsx:1-15,83-97`

**Step 1: Create AdminApp component**

```jsx
// frontend/src/Apps/AdminApp.jsx
import React, { useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MantineProvider, createTheme } from '@mantine/core';
import { getChildLogger } from '../lib/logging/childLogger.js';
import AdminLayout from '../modules/Admin/AdminLayout.jsx';
import ListsIndex from '../modules/Admin/ContentLists/ListsIndex.jsx';
import ListsFolder from '../modules/Admin/ContentLists/ListsFolder.jsx';
import ComingSoon from '../modules/Admin/Placeholders/ComingSoon.jsx';
import './AdminApp.scss';
import '@mantine/core/styles.css';

const theme = createTheme({
  primaryColor: 'blue',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
});

function AdminApp() {
  const logger = useMemo(() => getChildLogger({ app: 'admin' }), []);

  React.useEffect(() => {
    logger.info('admin.app.mounted');
  }, [logger]);

  return (
    <MantineProvider theme={theme}>
      <div className="App admin-app">
        <Routes>
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="content/lists" replace />} />
            <Route path="content/lists" element={<ListsIndex />} />
            <Route path="content/lists/:folder" element={<ListsFolder />} />
            <Route path="content/menus" element={<ComingSoon title="Menus" />} />
            <Route path="content/playlists" element={<ComingSoon title="Playlists" />} />
            <Route path="apps/*" element={<ComingSoon title="App Config" />} />
            <Route path="household/*" element={<ComingSoon title="Household" />} />
            <Route path="system/*" element={<ComingSoon title="System" />} />
            <Route path="*" element={<Navigate to="content/lists" replace />} />
          </Route>
        </Routes>
      </div>
    </MantineProvider>
  );
}

export default AdminApp;
```

**Step 2: Create AdminApp styles**

```scss
// frontend/src/Apps/AdminApp.scss
.admin-app {
  width: 100vw;
  height: 100vh;
  background-color: #f8f9fa;
  overflow: hidden;
}
```

**Step 3: Update main.jsx to add route**

```jsx
// Add import at top (around line 13)
import AdminApp from './Apps/AdminApp.jsx';

// Add route (around line 84, before the catch-all)
<Route path="/admin/*" element={<AdminApp />} />
```

**Step 4: Verify routing works**

Run: `npm run dev`
Navigate to: `http://localhost:5173/admin`
Expected: Should load AdminApp (may show errors for missing components - that's OK)

**Step 5: Commit**

```bash
git add frontend/src/Apps/AdminApp.jsx frontend/src/Apps/AdminApp.scss frontend/src/main.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): add AdminApp entry point and route

Creates AdminApp scaffold with:
- MantineProvider theme wrapper
- React Router nested routes
- Redirect to /admin/content/lists by default

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Create AdminLayout with Sidebar Navigation

**Files:**
- Create: `frontend/src/modules/Admin/AdminLayout.jsx`
- Create: `frontend/src/modules/Admin/AdminNav.jsx`
- Create: `frontend/src/modules/Admin/AdminHeader.jsx`
- Create: `frontend/src/modules/Admin/Admin.scss`

**Step 1: Create AdminLayout**

```jsx
// frontend/src/modules/Admin/AdminLayout.jsx
import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppShell, Burger, Group, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import AdminNav from './AdminNav.jsx';
import AdminHeader from './AdminHeader.jsx';
import './Admin.scss';

function AdminLayout() {
  const [opened, { toggle }] = useDisclosure();
  const location = useLocation();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 250, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <AdminHeader opened={opened} toggle={toggle} />
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <AdminNav />
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

export default AdminLayout;
```

**Step 2: Create AdminNav**

```jsx
// frontend/src/modules/Admin/AdminNav.jsx
import React from 'react';
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { NavLink, Stack, Text, Divider } from '@mantine/core';
import {
  IconList, IconMenu2, IconPlaylist,
  IconDeviceTv, IconKeyboard, IconRun,
  IconUsers, IconDevices, IconHome,
  IconPlayerPlay, IconSettings
} from '@tabler/icons-react';

const navSections = [
  {
    label: 'CONTENT',
    items: [
      { label: 'Lists', icon: IconList, to: '/admin/content/lists' },
      { label: 'Menus', icon: IconMenu2, to: '/admin/content/menus' },
      { label: 'Playlists', icon: IconPlaylist, to: '/admin/content/playlists' },
    ]
  },
  {
    label: 'APPS',
    items: [
      { label: 'TV', icon: IconDeviceTv, to: '/admin/apps/tv' },
      { label: 'Office', icon: IconKeyboard, to: '/admin/apps/office' },
      { label: 'Fitness', icon: IconRun, to: '/admin/apps/fitness' },
    ]
  },
  {
    label: 'HOUSEHOLD',
    items: [
      { label: 'Users', icon: IconUsers, to: '/admin/household/users' },
      { label: 'Devices', icon: IconDevices, to: '/admin/household/devices' },
      { label: 'Rooms', icon: IconHome, to: '/admin/household/rooms' },
    ]
  },
  {
    label: 'SYSTEM',
    items: [
      { label: 'Playback', icon: IconPlayerPlay, to: '/admin/system/playback' },
      { label: 'Integrations', icon: IconSettings, to: '/admin/system/integrations' },
    ]
  }
];

function AdminNav() {
  const location = useLocation();

  return (
    <Stack gap="xs">
      {navSections.map((section, idx) => (
        <React.Fragment key={section.label}>
          {idx > 0 && <Divider my="xs" />}
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={4}>
            {section.label}
          </Text>
          {section.items.map(item => (
            <NavLink
              key={item.to}
              component={RouterNavLink}
              to={item.to}
              label={item.label}
              leftSection={<item.icon size={16} stroke={1.5} />}
              active={location.pathname.startsWith(item.to)}
              variant="light"
            />
          ))}
        </React.Fragment>
      ))}
    </Stack>
  );
}

export default AdminNav;
```

**Step 3: Create AdminHeader**

```jsx
// frontend/src/modules/Admin/AdminHeader.jsx
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Group, Burger, Text, Breadcrumbs, Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';

function AdminHeader({ opened, toggle }) {
  const location = useLocation();

  // Build breadcrumbs from path
  const pathParts = location.pathname.split('/').filter(Boolean);
  const breadcrumbs = pathParts.map((part, idx) => {
    const path = '/' + pathParts.slice(0, idx + 1).join('/');
    const label = part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' ');
    const isLast = idx === pathParts.length - 1;

    return isLast ? (
      <Text key={path} size="sm" fw={500}>{label}</Text>
    ) : (
      <Anchor key={path} component={Link} to={path} size="sm">
        {label}
      </Anchor>
    );
  });

  return (
    <Group h="100%" px="md" justify="space-between">
      <Group>
        <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
        <Text size="lg" fw={700}>DaylightStation</Text>
      </Group>

      <Breadcrumbs separator="›">
        {breadcrumbs}
      </Breadcrumbs>

      <div style={{ width: 100 }} /> {/* Spacer for balance */}
    </Group>
  );
}

export default AdminHeader;
```

**Step 4: Create Admin styles**

```scss
// frontend/src/modules/Admin/Admin.scss
.admin-layout {
  .mantine-AppShell-navbar {
    background-color: #fff;
    border-right: 1px solid #e9ecef;
  }

  .mantine-AppShell-header {
    background-color: #fff;
    border-bottom: 1px solid #e9ecef;
  }

  .mantine-AppShell-main {
    background-color: #f8f9fa;
  }
}
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Admin/AdminLayout.jsx frontend/src/modules/Admin/AdminNav.jsx frontend/src/modules/Admin/AdminHeader.jsx frontend/src/modules/Admin/Admin.scss
git commit -m "$(cat <<'EOF'
feat(frontend): add AdminLayout with sidebar navigation

Creates SaaS-style layout with:
- AppShell wrapper (header + navbar + main)
- Section-grouped navigation links
- Dynamic breadcrumbs from URL path
- Responsive burger menu for mobile

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Create Placeholder Components

**Files:**
- Create: `frontend/src/modules/Admin/Placeholders/ComingSoon.jsx`

**Step 1: Create ComingSoon placeholder**

```jsx
// frontend/src/modules/Admin/Placeholders/ComingSoon.jsx
import React from 'react';
import { Center, Stack, Title, Text, ThemeIcon } from '@mantine/core';
import { IconHammer } from '@tabler/icons-react';

function ComingSoon({ title = 'This Feature' }) {
  return (
    <Center h="60vh">
      <Stack align="center" gap="md">
        <ThemeIcon size={80} radius="xl" variant="light" color="gray">
          <IconHammer size={40} />
        </ThemeIcon>
        <Title order={2}>{title}</Title>
        <Text c="dimmed" ta="center" maw={400}>
          This section is under construction. Check back later for updates.
        </Text>
      </Stack>
    </Center>
  );
}

export default ComingSoon;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/Placeholders/ComingSoon.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): add ComingSoon placeholder component

Simple placeholder for unimplemented admin sections.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Lists Feature (MVP)

### Task 7: Create useAdminLists Hook

**Files:**
- Create: `frontend/src/hooks/admin/useAdminLists.js`

**Step 1: Create the hook**

```javascript
// frontend/src/hooks/admin/useAdminLists.js
import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import { getChildLogger } from '../../lib/logging/childLogger.js';

const API_BASE = '/api/v1/admin/content';

/**
 * Hook for managing admin lists (folders and items)
 *
 * @returns {Object} Lists state and methods
 */
export function useAdminLists() {
  const logger = useMemo(() => getChildLogger({ hook: 'useAdminLists' }), []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [folders, setFolders] = useState([]);
  const [items, setItems] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);

  // Fetch all folders
  const fetchFolders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await DaylightAPI(`${API_BASE}/lists`);
      setFolders(data.folders || []);
      logger.info('admin.lists.folders.fetched', { count: data.folders?.length });
      return data.folders;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.folders.fetch.failed', { message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  // Fetch items in a folder
  const fetchItems = useCallback(async (folder) => {
    setLoading(true);
    setError(null);
    try {
      const data = await DaylightAPI(`${API_BASE}/lists/${folder}`);
      setItems(data.items || []);
      setCurrentFolder(folder);
      logger.info('admin.lists.items.fetched', { folder, count: data.items?.length });
      return data.items;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.items.fetch.failed', { folder, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  // Create a new folder
  const createFolder = useCallback(async (name) => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}/lists`, { name }, 'POST');
      logger.info('admin.lists.folder.created', { folder: result.folder });
      await fetchFolders(); // Refresh list
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.folder.create.failed', { name, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchFolders, logger]);

  // Delete a folder
  const deleteFolder = useCallback(async (folder) => {
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${folder}`, {}, 'DELETE');
      logger.info('admin.lists.folder.deleted', { folder });
      await fetchFolders(); // Refresh list
    } catch (err) {
      setError(err);
      logger.error('admin.lists.folder.delete.failed', { folder, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchFolders, logger]);

  // Add an item to current folder
  const addItem = useCallback(async (item) => {
    if (!currentFolder) throw new Error('No folder selected');
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}/lists/${currentFolder}/items`, item, 'POST');
      logger.info('admin.lists.item.added', { folder: currentFolder, index: result.index });
      await fetchItems(currentFolder); // Refresh list
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.lists.item.add.failed', { folder: currentFolder, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentFolder, fetchItems, logger]);

  // Update an item
  const updateItem = useCallback(async (index, updates) => {
    if (!currentFolder) throw new Error('No folder selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentFolder}/items/${index}`, updates, 'PUT');
      logger.info('admin.lists.item.updated', { folder: currentFolder, index });
      await fetchItems(currentFolder); // Refresh list
    } catch (err) {
      setError(err);
      logger.error('admin.lists.item.update.failed', { folder: currentFolder, index, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentFolder, fetchItems, logger]);

  // Delete an item
  const deleteItem = useCallback(async (index) => {
    if (!currentFolder) throw new Error('No folder selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentFolder}/items/${index}`, {}, 'DELETE');
      logger.info('admin.lists.item.deleted', { folder: currentFolder, index });
      await fetchItems(currentFolder); // Refresh list
    } catch (err) {
      setError(err);
      logger.error('admin.lists.item.delete.failed', { folder: currentFolder, index, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentFolder, fetchItems, logger]);

  // Reorder items (full replacement)
  const reorderItems = useCallback(async (newItems) => {
    if (!currentFolder) throw new Error('No folder selected');
    setLoading(true);
    setError(null);
    try {
      await DaylightAPI(`${API_BASE}/lists/${currentFolder}`, { items: newItems }, 'PUT');
      setItems(newItems.map((item, index) => ({ ...item, index })));
      logger.info('admin.lists.reordered', { folder: currentFolder, count: newItems.length });
    } catch (err) {
      setError(err);
      logger.error('admin.lists.reorder.failed', { folder: currentFolder, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentFolder, logger]);

  // Toggle item active state (inline)
  const toggleItemActive = useCallback(async (index) => {
    const item = items.find(i => i.index === index);
    if (!item) return;
    await updateItem(index, { active: !item.active });
  }, [items, updateItem]);

  return {
    // State
    loading,
    error,
    folders,
    items,
    currentFolder,

    // Folder operations
    fetchFolders,
    createFolder,
    deleteFolder,

    // Item operations
    fetchItems,
    addItem,
    updateItem,
    deleteItem,
    reorderItems,
    toggleItemActive,

    // Helpers
    clearError: () => setError(null)
  };
}

export default useAdminLists;
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/admin/useAdminLists.js
git commit -m "$(cat <<'EOF'
feat(frontend): add useAdminLists hook for CRUD operations

Provides complete folder/item management:
- fetchFolders, createFolder, deleteFolder
- fetchItems, addItem, updateItem, deleteItem
- reorderItems, toggleItemActive
- Loading/error state management

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Create ListsIndex Component (Folder Grid)

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/ListsIndex.jsx`
- Create: `frontend/src/modules/Admin/ContentLists/ListsFolderCreate.jsx`
- Create: `frontend/src/modules/Admin/ContentLists/ContentLists.scss`

**Step 1: Create ListsIndex**

```jsx
// frontend/src/modules/Admin/ContentLists/ListsIndex.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  SimpleGrid, Card, Text, Badge, Group, Button,
  Center, Loader, Alert, Stack, Title
} from '@mantine/core';
import { IconPlus, IconFolder, IconAlertCircle } from '@tabler/icons-react';
import { useAdminLists } from '../../../hooks/admin/useAdminLists.js';
import ListsFolderCreate from './ListsFolderCreate.jsx';
import './ContentLists.scss';

function ListsIndex() {
  const navigate = useNavigate();
  const { folders, loading, error, fetchFolders, createFolder } = useAdminLists();
  const [createModalOpen, setCreateModalOpen] = useState(false);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  const handleFolderClick = (folder) => {
    navigate(`/admin/content/lists/${folder.name}`);
  };

  const handleCreateFolder = async (name) => {
    await createFolder(name);
    setCreateModalOpen(false);
  };

  if (loading && folders.length === 0) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Content Lists</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setCreateModalOpen(true)}
        >
          New Folder
        </Button>
      </Group>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error.message || 'Failed to load folders'}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md">
        {folders.map(folder => (
          <Card
            key={folder.name}
            shadow="sm"
            padding="lg"
            radius="md"
            withBorder
            className="folder-card"
            onClick={() => handleFolderClick(folder)}
          >
            <Group justify="space-between">
              <Group gap="xs">
                <IconFolder size={24} stroke={1.5} />
                <Text fw={500} tt="capitalize">
                  {folder.name.replace(/-/g, ' ')}
                </Text>
              </Group>
              <Badge color="blue" variant="light">
                {folder.count}
              </Badge>
            </Group>
          </Card>
        ))}
      </SimpleGrid>

      {folders.length === 0 && !loading && (
        <Center h="40vh">
          <Stack align="center">
            <IconFolder size={48} stroke={1} color="gray" />
            <Text c="dimmed">No folders yet. Create one to get started.</Text>
          </Stack>
        </Center>
      )}

      <ListsFolderCreate
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateFolder}
        loading={loading}
      />
    </Stack>
  );
}

export default ListsIndex;
```

**Step 2: Create ListsFolderCreate modal**

```jsx
// frontend/src/modules/Admin/ContentLists/ListsFolderCreate.jsx
import React, { useState } from 'react';
import { Modal, TextInput, Button, Group, Stack } from '@mantine/core';

function ListsFolderCreate({ opened, onClose, onCreate, loading }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Folder name is required');
      return;
    }
    try {
      await onCreate(name.trim());
      setName('');
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to create folder');
    }
  };

  const handleClose = () => {
    setName('');
    setError('');
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Create New Folder"
      centered
    >
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput
            label="Folder Name"
            placeholder="e.g., Morning Program"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={error}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={handleClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Create</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default ListsFolderCreate;
```

**Step 3: Create styles**

```scss
// frontend/src/modules/Admin/ContentLists/ContentLists.scss
.folder-card {
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
}

.lists-folder {
  .item-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: white;
    border: 1px solid #e9ecef;
    border-radius: 8px;
    margin-bottom: 8px;

    &:hover {
      border-color: #228be6;
    }

    .drag-handle {
      cursor: grab;
      color: #adb5bd;

      &:active {
        cursor: grabbing;
      }
    }

    .item-thumbnail {
      width: 48px;
      height: 48px;
      border-radius: 4px;
      object-fit: cover;
      background: #f1f3f5;
    }

    .item-info {
      flex: 1;
      min-width: 0;

      .item-label {
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .item-input {
        font-size: 12px;
        color: #868e96;
      }
    }
  }
}
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsIndex.jsx frontend/src/modules/Admin/ContentLists/ListsFolderCreate.jsx frontend/src/modules/Admin/ContentLists/ContentLists.scss
git commit -m "$(cat <<'EOF'
feat(frontend): add ListsIndex and folder creation

Displays folder grid with item counts.
New Folder modal with name input.
Clickable cards navigate to folder detail.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Create ListsFolder Component (Items View)

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx`
- Create: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

**Step 1: Create ListsFolder**

```jsx
// frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Stack, Group, Title, Button, TextInput, Center, Loader, Alert,
  ActionIcon, Menu
} from '@mantine/core';
import {
  IconPlus, IconSearch, IconArrowLeft, IconAlertCircle,
  IconTrash, IconDotsVertical
} from '@tabler/icons-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, arrayMove
} from '@dnd-kit/sortable';
import { useAdminLists } from '../../../hooks/admin/useAdminLists.js';
import ListsItemRow from './ListsItemRow.jsx';
import ListsItemEditor from './ListsItemEditor.jsx';
import './ContentLists.scss';

function ListsFolder() {
  const { folder } = useParams();
  const navigate = useNavigate();
  const {
    items, loading, error,
    fetchItems, addItem, updateItem, deleteItem, reorderItems, toggleItemActive,
    deleteFolder
  } = useAdminLists();

  const [searchQuery, setSearchQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  useEffect(() => {
    if (folder) {
      fetchItems(folder);
    }
  }, [folder, fetchItems]);

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(item =>
      item.label?.toLowerCase().includes(query) ||
      item.input?.toLowerCase().includes(query)
    );
  }, [items, searchQuery]);

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex(i => i.index === active.id);
    const newIndex = items.findIndex(i => i.index === over.id);

    const reordered = arrayMove(items, oldIndex, newIndex);
    await reorderItems(reordered);
  };

  const handleAddItem = () => {
    setEditingItem(null);
    setEditorOpen(true);
  };

  const handleEditItem = (item) => {
    setEditingItem(item);
    setEditorOpen(true);
  };

  const handleSaveItem = async (itemData) => {
    if (editingItem) {
      await updateItem(editingItem.index, itemData);
    } else {
      await addItem(itemData);
    }
    setEditorOpen(false);
    setEditingItem(null);
  };

  const handleDeleteFolder = async () => {
    if (window.confirm(`Delete folder "${folder}"? This cannot be undone.`)) {
      await deleteFolder(folder);
      navigate('/admin/content/lists');
    }
  };

  if (loading && items.length === 0) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  const folderTitle = folder.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <Stack gap="md" className="lists-folder">
      <Group justify="space-between">
        <Group>
          <ActionIcon variant="subtle" onClick={() => navigate('/admin/content/lists')}>
            <IconArrowLeft size={20} />
          </ActionIcon>
          <Title order={2}>{folderTitle}</Title>
        </Group>
        <Group>
          <TextInput
            placeholder="Search items..."
            leftSection={<IconSearch size={16} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 200 }}
          />
          <Button leftSection={<IconPlus size={16} />} onClick={handleAddItem}>
            Add Item
          </Button>
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle">
                <IconDotsVertical size={20} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={handleDeleteFolder}
              >
                Delete Folder
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error.message || 'Failed to load items'}
        </Alert>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={filteredItems.map(i => i.index)}
          strategy={verticalListSortingStrategy}
        >
          {filteredItems.map(item => (
            <ListsItemRow
              key={item.index}
              item={item}
              onEdit={() => handleEditItem(item)}
              onDelete={() => deleteItem(item.index)}
              onToggleActive={() => toggleItemActive(item.index)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {filteredItems.length === 0 && !loading && (
        <Center h="40vh">
          <Stack align="center">
            <IconSearch size={48} stroke={1} color="gray" />
            <Title order={4} c="dimmed">
              {searchQuery ? 'No matching items' : 'No items yet'}
            </Title>
          </Stack>
        </Center>
      )}

      <ListsItemEditor
        opened={editorOpen}
        onClose={() => { setEditorOpen(false); setEditingItem(null); }}
        onSave={handleSaveItem}
        item={editingItem}
        loading={loading}
      />
    </Stack>
  );
}

export default ListsFolder;
```

**Step 2: Create ListsItemRow**

```jsx
// frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
import React from 'react';
import { Group, Text, Badge, Switch, ActionIcon, Menu, Avatar } from '@mantine/core';
import { IconGripVertical, IconEdit, IconTrash, IconCopy, IconDotsVertical } from '@tabler/icons-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function ListsItemRow({ item, onEdit, onDelete, onToggleActive }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.index
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="item-row">
      <div className="drag-handle" {...attributes} {...listeners}>
        <IconGripVertical size={20} />
      </div>

      <Avatar
        src={item.image}
        size={48}
        radius="sm"
        className="item-thumbnail"
      >
        {item.label?.[0]}
      </Avatar>

      <div className="item-info">
        <Text className="item-label">{item.label}</Text>
        <Text className="item-input">{item.input}</Text>
      </div>

      <Badge color={item.action === 'Play' ? 'blue' : 'gray'} variant="light">
        {item.action || 'Play'}
      </Badge>

      <Switch
        checked={item.active !== false}
        onChange={onToggleActive}
        size="sm"
      />

      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="subtle">
            <IconDotsVertical size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconEdit size={16} />} onClick={onEdit}>
            Edit
          </Menu.Item>
          <Menu.Item leftSection={<IconCopy size={16} />}>
            Duplicate
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={onDelete}>
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}

export default ListsItemRow;
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): add ListsFolder with drag-drop reordering

Displays items in draggable rows with:
- @dnd-kit sortable context
- Search filter
- Inline active toggle
- Edit/delete actions menu

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Create ListsItemEditor Modal

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx`

**Step 1: Create ListsItemEditor**

```jsx
// frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx
import React, { useState, useEffect } from 'react';
import { Modal, TextInput, Select, Switch, Group, Stack, Button, FileInput, Image } from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';

const ACTION_OPTIONS = [
  { value: 'Play', label: 'Play' },
  { value: 'Queue', label: 'Queue' },
  { value: 'Display', label: 'Display' },
  { value: 'Read', label: 'Read' },
];

function ListsItemEditor({ opened, onClose, onSave, item, loading }) {
  const [formData, setFormData] = useState({
    label: '',
    input: '',
    action: 'Play',
    active: true,
    image: null
  });
  const [imageFile, setImageFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState({});

  // Reset form when modal opens
  useEffect(() => {
    if (opened) {
      if (item) {
        setFormData({
          label: item.label || '',
          input: item.input || '',
          action: item.action || 'Play',
          active: item.active !== false,
          image: item.image || null
        });
      } else {
        setFormData({
          label: '',
          input: '',
          action: 'Play',
          active: true,
          image: null
        });
      }
      setImageFile(null);
      setErrors({});
    }
  }, [opened, item]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: null }));
  };

  const handleImageUpload = async (file) => {
    if (!file) {
      setImageFile(null);
      return;
    }

    setImageFile(file);
    setUploading(true);

    try {
      const formDataObj = new FormData();
      formDataObj.append('file', file);

      // Use fetch for multipart upload
      const response = await fetch('/api/v1/admin/images/upload', {
        method: 'POST',
        body: formDataObj
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();
      handleInputChange('image', result.path);
    } catch (err) {
      setErrors(prev => ({ ...prev, image: 'Failed to upload image' }));
    } finally {
      setUploading(false);
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.label.trim()) {
      newErrors.label = 'Label is required';
    }
    if (!formData.input.trim()) {
      newErrors.input = 'Input is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    await onSave({
      label: formData.label.trim(),
      input: formData.input.trim(),
      action: formData.action,
      active: formData.active,
      image: formData.image
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={item ? 'Edit Item' : 'Add Item'}
      centered
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput
            label="Label"
            placeholder="e.g., Raising Kids Emotionally"
            value={formData.label}
            onChange={(e) => handleInputChange('label', e.target.value)}
            error={errors.label}
            required
            data-autofocus
          />

          <TextInput
            label="Input"
            placeholder="e.g., plex:311549 or media:path/to/file"
            description="Format: source:id (plex:123, media:path, youtube:xyz)"
            value={formData.input}
            onChange={(e) => handleInputChange('input', e.target.value)}
            error={errors.input}
            required
          />

          <Select
            label="Action"
            data={ACTION_OPTIONS}
            value={formData.action}
            onChange={(value) => handleInputChange('action', value)}
          />

          <Switch
            label="Active"
            description="Inactive items are hidden from lists"
            checked={formData.active}
            onChange={(e) => handleInputChange('active', e.target.checked)}
          />

          <FileInput
            label="Image"
            description="Optional thumbnail image"
            placeholder="Click to upload"
            leftSection={<IconUpload size={16} />}
            accept="image/jpeg,image/png,image/webp"
            value={imageFile}
            onChange={handleImageUpload}
            error={errors.image}
          />

          {formData.image && (
            <Image
              src={formData.image}
              height={100}
              fit="contain"
              radius="sm"
            />
          )}

          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading || uploading}>
              {item ? 'Save Changes' : 'Add Item'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default ListsItemEditor;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): add ListsItemEditor modal

Form for adding/editing list items with:
- Label, input, action fields
- Active toggle
- Image upload with preview

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Create Module Index and Verify Integration

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/index.js`
- Create: `frontend/src/modules/Admin/index.js`

**Step 1: Create module exports**

```javascript
// frontend/src/modules/Admin/ContentLists/index.js
export { default as ListsIndex } from './ListsIndex.jsx';
export { default as ListsFolder } from './ListsFolder.jsx';
export { default as ListsItemRow } from './ListsItemRow.jsx';
export { default as ListsItemEditor } from './ListsItemEditor.jsx';
export { default as ListsFolderCreate } from './ListsFolderCreate.jsx';
```

```javascript
// frontend/src/modules/Admin/index.js
export { default as AdminLayout } from './AdminLayout.jsx';
export { default as AdminNav } from './AdminNav.jsx';
export { default as AdminHeader } from './AdminHeader.jsx';
export * from './ContentLists/index.js';
```

**Step 2: Run full integration test**

Run: `npm run dev`
Navigate to: `http://localhost:5173/admin/content/lists`

Test checklist:
- [ ] Folder grid displays
- [ ] "New Folder" button opens modal
- [ ] Creating folder adds to grid
- [ ] Clicking folder navigates to items view
- [ ] "Add Item" opens editor modal
- [ ] Creating item adds to list
- [ ] Drag-drop reorders items
- [ ] Active toggle works inline
- [ ] Edit opens pre-filled modal
- [ ] Delete removes item
- [ ] Back button returns to folder grid

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/index.js frontend/src/modules/Admin/index.js
git commit -m "$(cat <<'EOF'
feat(frontend): add Admin module exports

Barrel exports for cleaner imports.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Data Migration (Optional - Run When Ready)

### Task 12: Create Migration Script

**Files:**
- Create: `scripts/migrate-lists-to-watchlists.mjs`

**Step 1: Create migration script**

```javascript
#!/usr/bin/env node
// scripts/migrate-lists-to-watchlists.mjs
/**
 * Migration Script: state/lists.yml → config/watchlists/*.yml
 *
 * Transforms flat array with folder tags into file-per-folder structure.
 * Run with: node scripts/migrate-lists-to-watchlists.mjs --dry-run
 *
 * Options:
 *   --dry-run    Show what would be migrated without writing files
 *   --household  Specify household ID (default: from config)
 */

import { loadYaml, saveYaml, ensureDir, fileExists } from '../backend/src/0_system/utils/FileIO.mjs';
import { configService, userDataService } from '../backend/src/0_system/config/index.mjs';
import path from 'path';
import { v7 as uuidv7 } from 'uuid';
import https from 'https';
import fs from 'fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const householdArg = args.find(a => a.startsWith('--household='));
const householdId = householdArg?.split('=')[1] || configService.getDefaultHouseholdId();

function kebabCase(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function transformInput(item) {
  // Legacy formats to new unified format
  if (item.type === 'Plex') return `plex:${item.key}`;
  if (item.type === 'Local') return `media:${item.key}`;
  if (item.kind === 'Plex') return `plex:${item.media_key}`;
  if (item.kind === 'Media') return `media:${item.media_key}`;
  if (item.input) return item.input; // Already in new format
  return `unknown:${item.key || item.media_key || 'unknown'}`;
}

async function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

async function migrateImage(imageUrl, mediaPath) {
  if (!imageUrl) return null;

  // Skip if already local
  if (imageUrl.startsWith('/media/')) return imageUrl;

  // Only migrate Infinity URLs
  if (!imageUrl.includes('startinfinity.com')) {
    console.log(`  [SKIP] Non-Infinity URL: ${imageUrl.slice(0, 50)}...`);
    return imageUrl;
  }

  const id = uuidv7();
  const localPath = `/media/img/lists/${id}.jpg`;
  const fullPath = path.join(mediaPath, 'img', 'lists', `${id}.jpg`);

  if (dryRun) {
    console.log(`  [DRY-RUN] Would download image to ${localPath}`);
    return localPath;
  }

  try {
    ensureDir(path.dirname(fullPath));
    await downloadImage(imageUrl, fullPath);
    console.log(`  [OK] Downloaded image to ${localPath}`);
    return localPath;
  } catch (err) {
    console.log(`  [WARN] Failed to download image: ${err.message}`);
    return null; // Image expired or inaccessible
  }
}

async function migrate() {
  console.log(`\n=== Lists Migration ===`);
  console.log(`Household: ${householdId}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  const householdPath = userDataService.getHouseholdPath(householdId);
  const sourcePath = path.join(householdPath, 'state', 'lists.yml');
  const targetDir = path.join(householdPath, 'config', 'watchlists');

  // Get media path from config or environment
  const mediaPath = process.env.MEDIA_PATH || '/media';

  if (!fileExists(sourcePath)) {
    console.log(`Source file not found: ${sourcePath}`);
    process.exit(1);
  }

  const items = loadYaml(sourcePath);
  console.log(`Found ${items.length} items in source file\n`);

  // Group by folder
  const byFolder = {};
  for (const item of items) {
    const folder = kebabCase(item.folder || 'uncategorized');
    if (!byFolder[folder]) byFolder[folder] = [];
    byFolder[folder].push(item);
  }

  console.log(`Folders: ${Object.keys(byFolder).length}\n`);

  // Process each folder
  for (const [folder, folderItems] of Object.entries(byFolder)) {
    console.log(`\n[${folder}] - ${folderItems.length} items`);

    const transformed = [];
    for (const item of folderItems) {
      const newItem = {
        label: item.label,
        input: transformInput(item),
        action: item.action || 'Play',
        active: item.hide !== true
      };

      // Migrate image if present
      if (item.image) {
        newItem.image = await migrateImage(item.image, mediaPath);
      }

      transformed.push(newItem);
    }

    const targetPath = path.join(targetDir, `${folder}.yml`);

    if (dryRun) {
      console.log(`  [DRY-RUN] Would write ${transformed.length} items to ${targetPath}`);
    } else {
      ensureDir(targetDir);
      saveYaml(targetPath, transformed);
      console.log(`  [OK] Wrote ${transformed.length} items to ${folder}.yml`);
    }
  }

  console.log(`\n=== Migration ${dryRun ? 'Preview' : 'Complete'} ===\n`);

  if (!dryRun) {
    console.log('Next steps:');
    console.log('1. Verify migrated files in config/watchlists/');
    console.log('2. Test AdminApp with new data');
    console.log('3. Once verified, you can archive state/lists.yml');
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

**Step 2: Commit**

```bash
git add scripts/migrate-lists-to-watchlists.mjs
git commit -m "$(cat <<'EOF'
feat(scripts): add lists migration script

Transforms state/lists.yml to config/watchlists/*.yml:
- Groups items by folder (file-per-folder)
- Transforms legacy input formats
- Downloads Infinity images to local storage
- Supports --dry-run for preview

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Testing and Polish

### Task 13: Add API Integration Tests

**Files:**
- Create: `tests/live/api/admin/content.test.mjs`

**Step 1: Create integration tests**

```javascript
// tests/live/api/admin/content.test.mjs
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';

const API_BASE = '/api/v1/admin/content';
const TEST_FOLDER = 'test-folder-' + Date.now();

describe('Admin Content API', () => {
  beforeAll(async () => {
    // Clean up any existing test folder
    try {
      await DaylightAPI(`${API_BASE}/lists/${TEST_FOLDER}`, {}, 'DELETE');
    } catch (e) {
      // Ignore if doesn't exist
    }
  });

  afterAll(async () => {
    // Clean up test folder
    try {
      await DaylightAPI(`${API_BASE}/lists/${TEST_FOLDER}`, {}, 'DELETE');
    } catch (e) {
      // Ignore
    }
  });

  describe('Folders', () => {
    it('GET /lists should return folders array', async () => {
      const result = await DaylightAPI(`${API_BASE}/lists`);
      expect(result).toHaveProperty('folders');
      expect(Array.isArray(result.folders)).toBe(true);
    });

    it('POST /lists should create folder', async () => {
      const result = await DaylightAPI(`${API_BASE}/lists`, { name: TEST_FOLDER }, 'POST');
      expect(result.ok).toBe(true);
      expect(result.folder).toBe(TEST_FOLDER.toLowerCase());
    });

    it('POST /lists should reject duplicate folder', async () => {
      await expect(
        DaylightAPI(`${API_BASE}/lists`, { name: TEST_FOLDER }, 'POST')
      ).rejects.toThrow();
    });

    it('GET /lists/:folder should return items', async () => {
      const result = await DaylightAPI(`${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}`);
      expect(result).toHaveProperty('items');
      expect(result.items).toEqual([]);
    });
  });

  describe('Items', () => {
    it('POST /lists/:folder/items should add item', async () => {
      const item = { label: 'Test Item', input: 'plex:123', action: 'Play' };
      const result = await DaylightAPI(
        `${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}/items`,
        item,
        'POST'
      );
      expect(result.ok).toBe(true);
      expect(result.index).toBe(0);
    });

    it('PUT /lists/:folder/items/:index should update item', async () => {
      const result = await DaylightAPI(
        `${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}/items/0`,
        { label: 'Updated Item' },
        'PUT'
      );
      expect(result.ok).toBe(true);
    });

    it('DELETE /lists/:folder/items/:index should remove item', async () => {
      const result = await DaylightAPI(
        `${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}/items/0`,
        {},
        'DELETE'
      );
      expect(result.ok).toBe(true);
      expect(result.deleted.label).toBe('Updated Item');
    });
  });

  describe('Reorder', () => {
    it('PUT /lists/:folder should reorder items', async () => {
      // Add multiple items
      await DaylightAPI(`${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}/items`,
        { label: 'Item A', input: 'plex:1' }, 'POST');
      await DaylightAPI(`${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}/items`,
        { label: 'Item B', input: 'plex:2' }, 'POST');

      // Get current items
      const before = await DaylightAPI(`${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}`);
      expect(before.items[0].label).toBe('Item A');

      // Reorder
      const reordered = [before.items[1], before.items[0]];
      await DaylightAPI(
        `${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}`,
        { items: reordered },
        'PUT'
      );

      // Verify order changed
      const after = await DaylightAPI(`${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}`);
      expect(after.items[0].label).toBe('Item B');
    });
  });
});
```

**Step 2: Run tests**

Run: `npm test -- tests/live/api/admin/content.test.mjs`
Expected: All tests pass

**Step 3: Commit**

```bash
git add tests/live/api/admin/content.test.mjs
git commit -m "$(cat <<'EOF'
test(api): add admin content API integration tests

Tests folder and item CRUD operations:
- List/create/delete folders
- Add/update/delete items
- Reorder items

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Final Cleanup and Documentation

**Files:**
- Modify: `docs/plans/2026-02-01-admin-app-design.md` (update status)

**Step 1: Update design doc status**

Change line 4 from:
```markdown
**Status:** Draft
```
To:
```markdown
**Status:** Implemented
```

And add to the end of the file:
```markdown
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
```

**Step 2: Commit**

```bash
git add docs/plans/2026-02-01-admin-app-design.md
git commit -m "$(cat <<'EOF'
docs: mark AdminApp design as implemented

Updates status and adds implementation notes.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

This plan implements the AdminApp MVP in 14 tasks:

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-3 | Backend API (content router, images router, mounting) |
| 2 | 4-6 | Frontend foundation (AdminApp, layout, navigation, placeholders) |
| 3 | 7-11 | Lists feature (hook, folder grid, items view, editor, exports) |
| 4 | 12 | Data migration script (optional) |
| 5 | 13-14 | Testing and documentation |

**Key patterns followed:**
- Router factory pattern from `fitness.mjs`
- AppShell layout from Mantine 7
- @dnd-kit for drag-drop (existing in codebase)
- useAdminLists hook pattern similar to other domain hooks
- TDD: test → implement → verify → commit

**Dependencies:**
- `@tabler/icons-react` - Icon library (likely needs install: `npm install @tabler/icons-react`)
- `@dnd-kit/core` + `@dnd-kit/sortable` - Already installed
- `multer` - Already installed (used by existing image uploads)
- `uuid` - Already installed

**Deferred scope:**
- Content search autocomplete
- App config editing (TV, Office, Fitness)
- Household management
- System settings
