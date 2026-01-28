# Watch State SSOT Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix play/log writes not being visible to fitness endpoint by making WatchStore the single source of truth.

**Architecture:** Update WatchStore to support nested paths, inject it into PlexAdapter, and change the base path from `dataBasePath` to `householdDir`. PlexAdapter will use WatchStore instead of loading its own files.

**Tech Stack:** Node.js, Express, YAML persistence, ES modules

---

## Task 1: Update YamlWatchStateDatastore to support nested paths

**Files:**
- Modify: `backend/src/2_adapters/persistence/yaml/YamlWatchStateDatastore.mjs:35-38`

**Step 1: Update `_getBasePath()` to allow subdirectories**

Current code (line 35-38):
```javascript
_getBasePath(storagePath) {
  const safePath = storagePath.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(this.basePath, safePath);
}
```

Replace with:
```javascript
_getBasePath(storagePath) {
  // Sanitize each path segment but preserve directory structure
  const safePath = storagePath
    .split('/')
    .map(segment => segment.replace(/[^a-zA-Z0-9-_]/g, '_'))
    .join('/');
  return path.join(this.basePath, `${safePath}.yml`);
}
```

**Step 2: Update `_readFile()` to handle .yml extension**

Current code (line 45-48):
```javascript
_readFile(storagePath) {
  const basePath = this._getBasePath(storagePath);
  return loadYamlSafe(basePath) || {};
}
```

No change needed - `_getBasePath` now adds `.yml` extension.

**Step 3: Verify backend syntax**

Run: `cd backend && node --check src/2_adapters/persistence/yaml/YamlWatchStateDatastore.mjs`
Expected: No output (success)

**Step 4: Commit**

```bash
git add backend/src/2_adapters/persistence/yaml/YamlWatchStateDatastore.mjs
git commit -m "feat(watch-state): support nested storage paths

Update _getBasePath() to preserve directory structure in storagePath.
Allows paths like 'plex/14_fitness' to create nested files."
```

---

## Task 2: Update PlexAdapter to accept and use WatchStore

**Files:**
- Modify: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs:52-58, 545-547`

**Step 1: Add watchStore to constructor**

Find (around line 52):
```javascript
this.proxyPath = config.proxyPath || '/api/v1/proxy/plex';
this.historyPath = config.historyPath || null;

// Set up built-in history loader if historyPath provided
if (this.historyPath) {
  this._historyLoader = () => this._loadHistoryFromFiles();
  this._historyClearer = (keys) => this._clearHistoryFromFiles(keys);
}
```

Replace with:
```javascript
this.proxyPath = config.proxyPath || '/api/v1/proxy/plex';
this.watchStore = config.watchStore || null;
this.historyPath = config.historyPath || null;

// Set up history loader - prefer watchStore, fall back to file-based
if (this.watchStore) {
  // WatchStore-based loading (new SSOT approach)
  this._historyLoader = null; // Will use async method instead
} else if (this.historyPath) {
  // Legacy file-based loading (deprecated)
  this._historyLoader = () => this._loadHistoryFromFiles();
  this._historyClearer = (keys) => this._clearHistoryFromFiles(keys);
}
```

**Step 2: Update `getStoragePath()` to return library-specific path**

Find (around line 545-547):
```javascript
async getStoragePath(id) {
  return 'plex';
}
```

Replace with:
```javascript
async getStoragePath(id) {
  // Strip plex: prefix if present
  const localId = String(id).replace(/^plex:/, '');

  try {
    const item = await this.getItem(`plex:${localId}`);
    if (item?.metadata?.librarySectionID) {
      const libraryId = item.metadata.librarySectionID;
      const libraryName = (item.metadata.librarySectionTitle || 'media')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      return `plex/${libraryId}_${libraryName}`;
    }
  } catch (e) {
    // Fall back to generic plex path on error
  }
  return 'plex';
}
```

**Step 3: Add async method to load viewing history from WatchStore**

Find `_loadViewingHistory()` method (around line 909-914) and add a new method after it:

```javascript
/**
 * Load viewing history from WatchStore (async version)
 * @param {string} [storagePath='plex'] - Storage path to load from
 * @returns {Promise<Object>} History object mapping bare plex keys to watch state
 */
async _loadViewingHistoryAsync(storagePath = 'plex') {
  if (!this.watchStore) {
    // Fall back to sync loader if no watchStore
    return this._loadViewingHistory();
  }

  try {
    const states = await this.watchStore.getAll(storagePath);
    const history = {};
    for (const state of states) {
      // Strip plex: prefix from key for adapter compatibility
      const bareKey = state.itemId.replace(/^plex:/, '');
      history[bareKey] = {
        playhead: state.playhead || 0,
        percent: state.percent || 0,
        lastPlayed: state.lastPlayed || null,
        mediaDuration: state.duration || 0
      };
    }
    return history;
  } catch (e) {
    console.error('[PlexAdapter] Error loading history from WatchStore:', e.message);
    return {};
  }
}
```

**Step 4: Verify backend syntax**

Run: `cd backend && node --check src/2_adapters/content/media/plex/PlexAdapter.mjs`
Expected: No output (success)

**Step 5: Commit**

```bash
git add backend/src/2_adapters/content/media/plex/PlexAdapter.mjs
git commit -m "feat(plex-adapter): add WatchStore support

- Accept watchStore in constructor config
- Update getStoragePath() to return library-specific path
- Add _loadViewingHistoryAsync() for WatchStore-based loading
- Maintain backward compatibility with historyPath"
```

---

## Task 3: Update bootstrap to wire WatchStore to PlexAdapter

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:185-208`

**Step 1: Update createContentRegistry signature and PlexAdapter instantiation**

Find (lines 185-208):
```javascript
/**
 * Create and configure content source registry
 * @param {Object} config - Configuration object
 * ...
 * @param {Object} deps - Dependencies
 * @param {Object} [deps.httpClient] - HTTP client for making requests
 * @returns {ContentSourceRegistry}
 */
export function createContentRegistry(config, deps = {}) {
  const registry = new ContentSourceRegistry();

  // Register filesystem adapter
  if (config.mediaBasePath) {
    registry.register(new FilesystemAdapter({
      mediaBasePath: config.mediaBasePath,
      historyPath: config.mediaMemoryPath ? `${config.mediaMemoryPath}/media` : null
    }));
  }

  // Register Plex adapter if configured
  if (config.plex?.host && deps.httpClient) {
    registry.register(new PlexAdapter({
      host: config.plex.host,
      token: config.plex.token,
      historyPath: config.mediaMemoryPath ? `${config.mediaMemoryPath}/plex` : null
    }, { httpClient: deps.httpClient }));
  }
```

Replace with:
```javascript
/**
 * Create and configure content source registry
 * @param {Object} config - Configuration object
 * ...
 * @param {Object} deps - Dependencies
 * @param {Object} [deps.httpClient] - HTTP client for making requests
 * @param {Object} [deps.watchStore] - Watch state store for progress persistence
 * @returns {ContentSourceRegistry}
 */
export function createContentRegistry(config, deps = {}) {
  const { httpClient, watchStore } = deps;
  const registry = new ContentSourceRegistry();

  // Register filesystem adapter
  if (config.mediaBasePath) {
    registry.register(new FilesystemAdapter({
      mediaBasePath: config.mediaBasePath,
      historyPath: config.mediaMemoryPath ? `${config.mediaMemoryPath}/media` : null
    }));
  }

  // Register Plex adapter if configured
  if (config.plex?.host && httpClient) {
    registry.register(new PlexAdapter({
      host: config.plex.host,
      token: config.plex.token,
      watchStore,  // Inject WatchStore (preferred)
      historyPath: config.mediaMemoryPath ? `${config.mediaMemoryPath}/plex` : null  // Fallback
    }, { httpClient }));
  }
```

**Step 2: Verify backend syntax**

Run: `cd backend && node --check src/0_system/bootstrap.mjs`
Expected: No output (success)

**Step 3: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(bootstrap): wire WatchStore to PlexAdapter

Pass watchStore to createContentRegistry deps.
PlexAdapter now receives watchStore for SSOT watch state."
```

---

## Task 4: Update app.mjs to use householdDir for watchStatePath

**Files:**
- Modify: `backend/src/app.mjs:257-261`

**Step 1: Create watchStore before contentRegistry and use householdDir**

Find (lines 257-261):
```javascript
}, { httpClient: axios });

// Watch state path - use history/media_memory under data path (matches legacy structure)
const watchStatePath = configService.getPath('watchState') || `${dataBasePath}/history/media_memory`;
const watchStore = createWatchStore({ watchStatePath });
```

Replace with:
```javascript
}, { httpClient: axios });

// Watch state path - use household-scoped path (SSOT for watch state)
const watchStatePath = configService.getPath('watchState') || `${householdDir}/history/media_memory`;
const watchStore = createWatchStore({ watchStatePath });
```

**Step 2: Pass watchStore to createContentRegistry**

Find (lines 249-257):
```javascript
const contentRegistry = createContentRegistry({
  mediaBasePath,
  plex: mediaLibConfig,  // Bootstrap key stays 'plex' for now
  dataPath: contentPath,
  watchlistPath,
  mediaMemoryPath,
  nomusicLabels,
  musicOverlayPlaylist
}, { httpClient: axios });
```

Replace with:
```javascript
// Watch state path - use household-scoped path (SSOT for watch state)
const watchStatePath = configService.getPath('watchState') || `${householdDir}/history/media_memory`;
const watchStore = createWatchStore({ watchStatePath });

const contentRegistry = createContentRegistry({
  mediaBasePath,
  plex: mediaLibConfig,  // Bootstrap key stays 'plex' for now
  dataPath: contentPath,
  watchlistPath,
  mediaMemoryPath,
  nomusicLabels,
  musicOverlayPlaylist
}, { httpClient: axios, watchStore });
```

**Step 3: Remove duplicate watchStore creation**

Delete the old lines (formerly 259-261):
```javascript
// Watch state path - use history/media_memory under data path (matches legacy structure)
const watchStatePath = configService.getPath('watchState') || `${dataBasePath}/history/media_memory`;
const watchStore = createWatchStore({ watchStatePath });
```

**Step 4: Verify backend syntax**

Run: `cd backend && node --check src/app.mjs`
Expected: No output (success)

**Step 5: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(app): use householdDir for watch state path

- Move watchStore creation before contentRegistry
- Pass watchStore to createContentRegistry
- Use householdDir instead of dataBasePath for household isolation"
```

---

## Task 5: Update fitness router to use async history loading

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:129-152`

**Step 1: Check current implementation**

Read fitness.mjs around line 129-152 to see how it loads viewing history.

**Step 2: Update to use async method if adapter supports it**

Find the viewing history merge block:
```javascript
// Merge viewing history from local YAML files
if (typeof adapter._loadViewingHistory === 'function') {
  const viewingHistory = adapter._loadViewingHistory();
```

Replace with:
```javascript
// Merge viewing history - prefer async WatchStore method
let viewingHistory = {};
if (typeof adapter._loadViewingHistoryAsync === 'function') {
  viewingHistory = await adapter._loadViewingHistoryAsync();
} else if (typeof adapter._loadViewingHistory === 'function') {
  viewingHistory = adapter._loadViewingHistory();
}
if (viewingHistory && Object.keys(viewingHistory).length > 0) {
```

**Step 3: Verify backend syntax**

Run: `cd backend && node --check src/4_api/v1/routers/fitness.mjs`
Expected: No output (success)

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs
git commit -m "feat(fitness): use async history loading from WatchStore

Prefer _loadViewingHistoryAsync() for WatchStore-based loading.
Fall back to sync method for backward compatibility."
```

---

## Task 6: Create data migration script

**Files:**
- Create: `backend/scripts/migrate-watch-state.mjs`

**Step 1: Create migration script**

```javascript
#!/usr/bin/env node
/**
 * Migrate watch state data to household-scoped WatchStore format
 *
 * Reads from:
 * - dataBasePath/history/media_memory/plex.yml (WatchStore format, prefixed keys)
 * - householdDir/history/media_memory/plex/*.yml (legacy format, bare keys)
 *
 * Writes to:
 * - householdDir/history/media_memory/plex.yml (merged, prefixed keys)
 *
 * Usage: node backend/scripts/migrate-watch-state.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const DRY_RUN = process.argv.includes('--dry-run');

// Paths - adjust these for your environment
const DATA_BASE_PATH = process.env.DATA_PATH || '/usr/src/app/data';
const HOUSEHOLD_DIR = process.env.HOUSEHOLD_DIR || `${DATA_BASE_PATH}/household`;

const OLD_WATCHSTORE_PATH = `${DATA_BASE_PATH}/history/media_memory/plex.yml`;
const LEGACY_PLEX_DIR = `${HOUSEHOLD_DIR}/history/media_memory/plex`;
const NEW_WATCHSTORE_PATH = `${HOUSEHOLD_DIR}/history/media_memory/plex.yml`;

function loadYaml(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) || {};
  } catch (e) {
    console.error(`Error loading ${filePath}:`, e.message);
    return null;
  }
}

function saveYaml(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, yaml.dump(data, { lineWidth: -1 }));
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  // Handle various date formats
  const d = new Date(dateStr.replace(' ', 'T').replace(/\./g, ':'));
  return isNaN(d.getTime()) ? null : d;
}

function main() {
  console.log('Watch State Migration Script');
  console.log('============================');
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Old WatchStore: ${OLD_WATCHSTORE_PATH}`);
  console.log(`Legacy Plex dir: ${LEGACY_PLEX_DIR}`);
  console.log(`New WatchStore: ${NEW_WATCHSTORE_PATH}`);
  console.log('');

  const merged = {};
  let oldCount = 0, legacyCount = 0, conflictCount = 0;

  // Load old WatchStore data (prefixed keys like "plex:664036")
  const oldData = loadYaml(OLD_WATCHSTORE_PATH);
  if (oldData) {
    for (const [key, value] of Object.entries(oldData)) {
      // Normalize to prefixed format
      const normalizedKey = key.startsWith('plex:') ? key : `plex:${key}`;
      merged[normalizedKey] = value;
      oldCount++;
    }
    console.log(`Loaded ${oldCount} entries from old WatchStore`);
  }

  // Load legacy plex directory files (bare keys like "664036")
  if (fs.existsSync(LEGACY_PLEX_DIR)) {
    const files = fs.readdirSync(LEGACY_PLEX_DIR).filter(f => f.endsWith('.yml'));
    for (const file of files) {
      if (file.startsWith('_') || file.startsWith('.')) continue;

      const filePath = path.join(LEGACY_PLEX_DIR, file);
      const data = loadYaml(filePath);
      if (!data) continue;

      for (const [key, value] of Object.entries(data)) {
        const normalizedKey = key.startsWith('plex:') ? key : `plex:${key}`;

        // Check for conflict
        if (merged[normalizedKey]) {
          const existingDate = parseDate(merged[normalizedKey].lastPlayed);
          const newDate = parseDate(value.lastPlayed);

          // Keep the one with more recent lastPlayed
          if (newDate && (!existingDate || newDate > existingDate)) {
            console.log(`  Conflict: ${normalizedKey} - using legacy (newer)`);
            merged[normalizedKey] = {
              playhead: value.playhead || value.seconds || 0,
              duration: value.mediaDuration || value.duration || 0,
              percent: value.percent || 0,
              playCount: (merged[normalizedKey].playCount || 0) + (value.playCount || 1),
              lastPlayed: value.lastPlayed,
              watchTime: (merged[normalizedKey].watchTime || 0) + (value.watchTime || 0)
            };
            conflictCount++;
          } else {
            console.log(`  Conflict: ${normalizedKey} - keeping existing (newer)`);
            conflictCount++;
          }
        } else {
          merged[normalizedKey] = {
            playhead: value.playhead || value.seconds || 0,
            duration: value.mediaDuration || value.duration || 0,
            percent: value.percent || 0,
            playCount: value.playCount || 1,
            lastPlayed: value.lastPlayed || null,
            watchTime: value.watchTime || 0
          };
          legacyCount++;
        }
      }
    }
    console.log(`Loaded ${legacyCount} entries from legacy plex directory`);
  }

  console.log('');
  console.log(`Total merged entries: ${Object.keys(merged).length}`);
  console.log(`Conflicts resolved: ${conflictCount}`);

  if (DRY_RUN) {
    console.log('');
    console.log('DRY RUN - no files written');
    console.log('Sample merged data:');
    const sample = Object.entries(merged).slice(0, 3);
    for (const [key, value] of sample) {
      console.log(`  ${key}: lastPlayed=${value.lastPlayed}, percent=${value.percent}`);
    }
  } else {
    saveYaml(NEW_WATCHSTORE_PATH, merged);
    console.log('');
    console.log(`Written to: ${NEW_WATCHSTORE_PATH}`);

    // Create backup of old files
    const backupDir = `${HOUSEHOLD_DIR}/history/media_memory/_backup_${Date.now()}`;
    if (fs.existsSync(OLD_WATCHSTORE_PATH)) {
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(OLD_WATCHSTORE_PATH, `${backupDir}/old_plex.yml`);
      console.log(`Backed up old WatchStore to ${backupDir}/old_plex.yml`);
    }
  }
}

main();
```

**Step 2: Make executable**

Run: `chmod +x backend/scripts/migrate-watch-state.mjs`

**Step 3: Commit**

```bash
git add backend/scripts/migrate-watch-state.mjs
git commit -m "feat: add watch state migration script

Merges data from old WatchStore and legacy plex directory
into new household-scoped format with prefixed keys."
```

---

## Task 7: Test the changes

**Step 1: Run backend syntax check**

Run: `cd backend && node --check src/app.mjs`
Expected: No output (success)

**Step 2: Start backend and verify startup**

Run: `cd backend && timeout 10 node index.js 2>&1 | head -30`
Expected: Server starts without import errors

**Step 3: Test play/log endpoint writes to correct location**

Run (after starting backend):
```bash
curl -X POST http://localhost:3112/api/v1/play/log \
  -H "Content-Type: application/json" \
  -d '{"type":"plex","media_key":"999999","seconds":100,"percent":"50"}'
```
Expected: Success response with storagePath

**Step 4: Verify file location**

Check that the write went to household path, not global path.

**Step 5: Commit final verification**

```bash
git add -A
git commit -m "test: verify watch state SSOT implementation

All syntax checks pass, backend starts successfully."
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Update YamlWatchStateDatastore for nested paths |
| 2 | Update PlexAdapter with WatchStore support |
| 3 | Update bootstrap wiring |
| 4 | Update app.mjs to use householdDir |
| 5 | Update fitness router for async loading |
| 6 | Create migration script |
| 7 | Test and verify |
