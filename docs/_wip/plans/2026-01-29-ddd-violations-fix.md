# DDD Application Layer Violations Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix DDD violations in `3_applications/` layer: remove fs/path imports, vendor names in code/comments, and format-specific logic.

**Architecture:** Extract file operations to `IMediaStorageRepository` port; rename vendor-specific methods/keys to generic terms; clean up port interface comments.

**Tech Stack:** Node.js ES modules, DDD ports pattern

---

## Task 1: Create IMediaStorageRepository Port

**Files:**
- Create: `backend/src/3_applications/media/ports/IMediaStorageRepository.mjs`

**Step 1: Create the port interface**

This port abstracts file system operations needed by FreshVideoService.

```javascript
// backend/src/3_applications/media/ports/IMediaStorageRepository.mjs

/**
 * IMediaStorageRepository - Port interface for media file storage operations
 *
 * Abstracts file system operations for the media application layer.
 * Implementations handle the actual storage (local fs, S3, etc.)
 *
 * @module applications/media/ports/IMediaStorageRepository
 */

/**
 * @typedef {Object} FileInfo
 * @property {string} path - Full file path
 * @property {string} name - File name
 * @property {string} datePrefix - Date prefix (YYYYMMDD) extracted from name
 * @property {number} mtimeMs - Last modified timestamp
 */

/**
 * @typedef {Object} LockResult
 * @property {boolean} acquired - Whether lock was acquired
 * @property {Function} [release] - Release function (if acquired)
 */

export const IMediaStorageRepository = {
  /**
   * Ensure a directory exists
   * @param {string} dirPath - Directory path
   * @returns {Promise<void>}
   */
  async ensureDir(dirPath) {},

  /**
   * Check if a file exists
   * @param {string} filePath - File path
   * @returns {Promise<boolean>}
   */
  async exists(filePath) {},

  /**
   * List subdirectories in a directory
   * @param {string} dirPath - Directory path
   * @returns {Promise<string[]>} - Array of directory names
   */
  async listSubdirectories(dirPath) {},

  /**
   * List files in a directory with metadata
   * @param {string} dirPath - Directory path
   * @param {Object} [options]
   * @param {string} [options.extension] - Filter by extension
   * @param {RegExp} [options.pattern] - Filter by pattern
   * @returns {Promise<FileInfo[]>}
   */
  async listFiles(dirPath, options) {},

  /**
   * Delete a file
   * @param {string} filePath - File path
   * @returns {Promise<boolean>} - True if deleted, false if not found
   */
  async deleteFile(filePath) {},

  /**
   * Acquire an exclusive lock
   * @param {string} lockName - Lock identifier
   * @param {Object} [options]
   * @param {number} [options.staleMs] - Consider lock stale after this many ms
   * @returns {Promise<LockResult>}
   */
  async acquireLock(lockName, options) {},

  /**
   * Get file stats
   * @param {string} filePath - File path
   * @returns {Promise<{mtimeMs: number, isDirectory: boolean, isFile: boolean}|null>}
   */
  async stat(filePath) {},

  /**
   * Join path segments
   * @param {...string} segments - Path segments
   * @returns {string}
   */
  joinPath(...segments) {},
};

/**
 * Type guard for IMediaStorageRepository
 * @param {Object} obj
 * @returns {boolean}
 */
export function isMediaStorageRepository(obj) {
  return obj &&
    typeof obj.ensureDir === 'function' &&
    typeof obj.exists === 'function' &&
    typeof obj.listFiles === 'function' &&
    typeof obj.deleteFile === 'function' &&
    typeof obj.acquireLock === 'function';
}
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/media/ports/IMediaStorageRepository.mjs
git commit -m "feat(media): add IMediaStorageRepository port interface"
```

---

## Task 2: Create LocalMediaStorageAdapter

**Files:**
- Create: `backend/src/2_adapters/media/LocalMediaStorageAdapter.mjs`
- Modify: `backend/src/2_adapters/media/index.mjs`

**Step 1: Create the adapter**

```javascript
// backend/src/2_adapters/media/LocalMediaStorageAdapter.mjs

/**
 * LocalMediaStorageAdapter - Local filesystem implementation of IMediaStorageRepository
 *
 * @module adapters/media/LocalMediaStorageAdapter
 */

import fs from 'fs';
import path from 'path';
import { nowTs24 } from '#system/utils/index.mjs';

export class LocalMediaStorageAdapter {
  #logger;
  #basePath;

  constructor({ basePath, logger } = {}) {
    this.#basePath = basePath || '';
    this.#logger = logger || console;
  }

  async ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  async exists(filePath) {
    return fs.existsSync(filePath);
  }

  async listSubdirectories(dirPath) {
    if (!fs.existsSync(dirPath)) return [];

    const entries = fs.readdirSync(dirPath);
    const dirs = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      try {
        if (fs.statSync(fullPath).isDirectory()) {
          dirs.push(entry);
        }
      } catch (_) {
        // Skip on error
      }
    }

    return dirs;
  }

  async listFiles(dirPath, options = {}) {
    if (!fs.existsSync(dirPath)) return [];

    const { extension, pattern } = options;
    const entries = fs.readdirSync(dirPath);
    const files = [];

    for (const name of entries) {
      const fullPath = path.join(dirPath, name);

      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;

        // Filter by extension
        if (extension && !name.endsWith(extension)) continue;

        // Filter by pattern
        if (pattern && !pattern.test(name)) continue;

        // Extract date prefix (assumes YYYYMMDD.ext format)
        const datePrefix = name.split('.')[0];

        files.push({
          path: fullPath,
          name,
          datePrefix,
          mtimeMs: stat.mtimeMs,
        });
      } catch (_) {
        // Skip on error
      }
    }

    return files;
  }

  async deleteFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) return false;
      fs.unlinkSync(filePath);
      return true;
    } catch (e) {
      this.#logger.warn?.('storage.deleteError', { path: filePath, error: e.message });
      return false;
    }
  }

  async acquireLock(lockName, options = {}) {
    const { staleMs = 60 * 60 * 1000 } = options;
    const lockPath = path.join(this.#basePath, `${lockName}.lock`);

    try {
      // Check for stale lock
      if (fs.existsSync(lockPath)) {
        const stat = fs.statSync(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > staleMs) {
          this.#logger.warn?.('storage.staleLock', { lockName, ageMins: Math.round(ageMs / 60000) });
          fs.unlinkSync(lockPath);
        }
      }

      // Atomic create using 'wx' flag
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: nowTs24() }));
      fs.closeSync(fd);

      return {
        acquired: true,
        release: () => {
          try { fs.unlinkSync(lockPath); } catch (_) {}
        }
      };
    } catch (e) {
      return { acquired: false };
    }
  }

  async stat(filePath) {
    try {
      const stat = fs.statSync(filePath);
      return {
        mtimeMs: stat.mtimeMs,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
      };
    } catch (_) {
      return null;
    }
  }

  joinPath(...segments) {
    return path.join(...segments);
  }
}

export default LocalMediaStorageAdapter;
```

**Step 2: Update index.mjs**

Add to existing exports:

```javascript
export { LocalMediaStorageAdapter } from './LocalMediaStorageAdapter.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/media/
git commit -m "feat(adapters): add LocalMediaStorageAdapter"
```

---

## Task 3: Refactor FreshVideoService to Use Repository

**Files:**
- Modify: `backend/src/3_applications/media/services/FreshVideoService.mjs`

**Step 1: Update imports and constructor**

Remove:
```javascript
import fs from 'fs';
import path from 'path';
```

Update constructor to accept `storageRepository`:
```javascript
constructor({ videoSourceGateway, storageRepository, configLoader, mediaPath, logger, options = {} }) {
  if (!videoSourceGateway) throw new Error('FreshVideoService requires videoSourceGateway');
  if (!storageRepository) throw new Error('FreshVideoService requires storageRepository');
  if (!configLoader) throw new Error('FreshVideoService requires configLoader');
  if (!mediaPath) throw new Error('FreshVideoService requires mediaPath');

  this.#videoSourceGateway = videoSourceGateway;
  this.#storageRepository = storageRepository;
  // ... rest
}
```

**Step 2: Refactor all methods to use repository**

Replace direct fs/path calls with repository methods:

- `this.#ensureDir(path)` → `await this.#storageRepository.ensureDir(path)`
- `fs.existsSync(path)` → `await this.#storageRepository.exists(path)`
- `fs.readdirSync(path)` → `await this.#storageRepository.listFiles(path)` or `listSubdirectories`
- `fs.unlinkSync(path)` → `await this.#storageRepository.deleteFile(path)`
- `path.join(a, b)` → `this.#storageRepository.joinPath(a, b)`
- Lock logic → `await this.#storageRepository.acquireLock('freshvideo', { staleMs })`

**Step 3: Remove format-specific knowledge**

Change:
```javascript
const validPattern = /^\d{8}\.mp4$/;
const todayFile = `${today}.mp4`;
if (file.endsWith('.mp4'))
```

To use options passed from outside or query the gateway:
```javascript
// Pass expected extension as option or let gateway report it
const fileExtension = this.#options.fileExtension || '.mp4';
const validPattern = new RegExp(`^\\d{8}\\${fileExtension}$`);
```

**Step 4: Full refactored file**

```javascript
/**
 * FreshVideoService
 *
 * Application layer service for orchestrating daily video downloads.
 * Delegates file operations to storageRepository (no direct fs/path usage).
 *
 * @module applications/media/services/FreshVideoService
 */

import { nowTs24 } from '#system/utils/index.mjs';

export class FreshVideoService {
  #videoSourceGateway;
  #storageRepository;
  #configLoader;
  #mediaPath;
  #logger;
  #options;

  constructor({ videoSourceGateway, storageRepository, configLoader, mediaPath, logger, options = {} }) {
    if (!videoSourceGateway) throw new Error('FreshVideoService requires videoSourceGateway');
    if (!storageRepository) throw new Error('FreshVideoService requires storageRepository');
    if (!configLoader) throw new Error('FreshVideoService requires configLoader');
    if (!mediaPath) throw new Error('FreshVideoService requires mediaPath');

    this.#videoSourceGateway = videoSourceGateway;
    this.#storageRepository = storageRepository;
    this.#configLoader = configLoader;
    this.#mediaPath = mediaPath;
    this.#logger = logger || console;
    this.#options = {
      daysToKeep: 10,
      processTimeout: 300000,
      audioLang: 'en',
      lockStaleMs: 60 * 60 * 1000,
      fileExtension: '.mp4',
      ...options
    };
  }

  #formatDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  #getCutoffDate() {
    const date = new Date();
    date.setDate(date.getDate() - this.#options.daysToKeep);
    return this.#formatDate(date);
  }

  async #cleanupOldFiles() {
    const deleted = [];
    const cutoff = this.#getCutoffDate();

    const subdirs = await this.#storageRepository.listSubdirectories(this.#mediaPath);

    for (const folder of subdirs) {
      const folderPath = this.#storageRepository.joinPath(this.#mediaPath, folder);
      const files = await this.#storageRepository.listFiles(folderPath);

      for (const file of files) {
        if (file.datePrefix < cutoff) {
          const success = await this.#storageRepository.deleteFile(file.path);
          if (success) {
            deleted.push(file.path);
            this.#logger.info?.('freshvideo.deletedOld', { path: file.path });
          }
        }
      }
    }

    return deleted;
  }

  async #cleanupInvalidFiles(dirPath) {
    const ext = this.#options.fileExtension;
    const validPattern = new RegExp(`^\\d{8}\\${ext.replace('.', '\\.')}$`);
    let count = 0;

    const files = await this.#storageRepository.listFiles(dirPath);

    for (const file of files) {
      if (!validPattern.test(file.name)) {
        const success = await this.#storageRepository.deleteFile(file.path);
        if (success) {
          count++;
          this.#logger.debug?.('freshvideo.removedInvalid', { path: file.path });
        }
      }
    }

    return count;
  }

  async #downloadSource(source) {
    const providerDir = this.#storageRepository.joinPath(this.#mediaPath, source.provider);
    await this.#storageRepository.ensureDir(providerDir);

    const today = this.#formatDate();
    const todayFile = `${today}${this.#options.fileExtension}`;
    const todayPath = this.#storageRepository.joinPath(providerDir, todayFile);

    if (await this.#storageRepository.exists(todayPath)) {
      this.#logger.info?.('freshvideo.alreadyExists', { provider: source.provider, path: todayPath });
      return { success: true, skipped: true, filePath: todayPath };
    }

    const result = await this.#videoSourceGateway.downloadLatest(source, {
      outputDir: providerDir,
      timeoutMs: this.#options.processTimeout,
      preferredLang: this.#options.audioLang
    });

    if (result.success) {
      this.#logger.info?.('freshvideo.downloadSuccess', { provider: source.provider, filePath: result.filePath });
    } else {
      this.#logger.error?.('freshvideo.downloadFailed', { provider: source.provider, error: result.error });
    }

    return result;
  }

  async #getValidFiles() {
    const files = [];
    const cutoff = this.#getCutoffDate();
    const ext = this.#options.fileExtension;

    const subdirs = await this.#storageRepository.listSubdirectories(this.#mediaPath);

    for (const folder of subdirs) {
      const folderPath = this.#storageRepository.joinPath(this.#mediaPath, folder);
      const folderFiles = await this.#storageRepository.listFiles(folderPath, { extension: ext });

      for (const file of folderFiles) {
        if (file.datePrefix >= cutoff) {
          files.push(file.path);
        }
      }
    }

    return files;
  }

  async run() {
    await this.#storageRepository.ensureDir(this.#mediaPath);

    const lockResult = await this.#storageRepository.acquireLock('freshvideo', {
      staleMs: this.#options.lockStaleMs
    });

    if (!lockResult.acquired) {
      this.#logger.warn?.('freshvideo.lockHeld', { message: 'Another instance is running' });
      return { skipped: true, reason: 'lock_held', deleted: [], providers: [], files: [] };
    }

    try {
      const sources = await this.#configLoader();
      if (!Array.isArray(sources) || sources.length === 0) {
        this.#logger.warn?.('freshvideo.noConfig', { message: 'No sources configured' });
        return { skipped: true, reason: 'no_config', deleted: [], providers: [], files: [] };
      }

      const deleted = await this.#cleanupOldFiles();
      await this.#cleanupInvalidFiles(this.#mediaPath);

      const providers = [];
      const results = [];

      for (const source of sources) {
        const result = await this.#downloadSource(source);
        providers.push(source.provider);
        results.push({ provider: source.provider, ...result });

        const providerDir = this.#storageRepository.joinPath(this.#mediaPath, source.provider);
        await this.#cleanupInvalidFiles(providerDir);
      }

      const files = await this.#getValidFiles();

      return { skipped: false, deleted, providers, files, results };

    } finally {
      lockResult.release();
    }
  }
}

export default FreshVideoService;
```

**Step 5: Commit**

```bash
git add backend/src/3_applications/media/services/FreshVideoService.mjs
git commit -m "refactor(media): use IMediaStorageRepository instead of direct fs/path"
```

---

## Task 4: Update Bootstrap Wiring

**Files:**
- Modify: `backend/src/app.mjs`

**Step 1: Import LocalMediaStorageAdapter**

Add after YtDlpAdapter import:
```javascript
import { YtDlpAdapter } from './2_adapters/media/YtDlpAdapter.mjs';
import { LocalMediaStorageAdapter } from './2_adapters/media/LocalMediaStorageAdapter.mjs';
```

**Step 2: Update handler registration**

Change:
```javascript
const videoSourceGateway = new YtDlpAdapter({
  logger: rootLogger.child({ module: 'ytdlp' })
});

mediaExecutor.register('youtube', createFreshVideoJobHandler({
  videoSourceGateway,
  loadFile,
  mediaPath,
  logger: rootLogger.child({ module: 'freshvideo' })
}));
```

To:
```javascript
const videoSourceGateway = new YtDlpAdapter({
  logger: rootLogger.child({ module: 'ytdlp' })
});

const mediaStorageRepository = new LocalMediaStorageAdapter({
  basePath: mediaPath,
  logger: rootLogger.child({ module: 'media-storage' })
});

mediaExecutor.register('youtube', createFreshVideoJobHandler({
  videoSourceGateway,
  storageRepository: mediaStorageRepository,
  loadFile,
  mediaPath,
  logger: rootLogger.child({ module: 'freshvideo' })
}));
```

**Step 3: Update YouTubeJobHandler**

Modify `backend/src/3_applications/media/YouTubeJobHandler.mjs` to pass storageRepository:

```javascript
export function createFreshVideoJobHandler({ videoSourceGateway, storageRepository, loadFile, mediaPath, logger }) {
  const service = new FreshVideoService({
    videoSourceGateway,
    storageRepository,
    configLoader: () => loadFile('state/youtube'),
    mediaPath,
    logger,
  });
  // ... rest unchanged
}
```

**Step 4: Commit**

```bash
git add backend/src/app.mjs backend/src/3_applications/media/YouTubeJobHandler.mjs
git commit -m "refactor(bootstrap): wire LocalMediaStorageAdapter into FreshVideoService"
```

---

## Task 5: Fix IHealthDataDatastore Vendor Method Name

**Files:**
- Modify: `backend/src/3_applications/health/ports/IHealthDataDatastore.mjs`

**Step 1: Rename method**

Change:
```javascript
/**
 * Load Strava workout data for a user
 * @param {string} userId
 * @returns {Promise<Object>} Strava data keyed by date
 */
async loadStravaData(userId) {
  throw new Error('Not implemented');
}
```

To:
```javascript
/**
 * Load workout/activity data for a user (from fitness tracking sources)
 * @param {string} userId
 * @returns {Promise<Object>} Activity data keyed by date
 */
async loadActivityData(userId) {
  throw new Error('Not implemented');
}
```

**Step 2: Find and update all callers**

Search for `loadStravaData` in the codebase and update to `loadActivityData`.

**Step 3: Commit**

```bash
git add backend/src/3_applications/health/
git commit -m "refactor(health): rename loadStravaData to loadActivityData"
```

---

## Task 6: Fix SOURCE_ICONS Vendor Keys

**Files:**
- Modify: `backend/src/3_applications/journalist/usecases/SendMorningDebrief.mjs`

**Step 1: Rename vendor keys to generic terms**

Change:
```javascript
const SOURCE_ICONS = {
  strava: '🏋️',
  fitness: '🏃',
  weight: '⚖️',
  events: '📆',
  github: '💻',
  checkins: '📍',
  reddit: '💬',
};
```

To:
```javascript
const SOURCE_ICONS = {
  activity: '🏋️',    // was: strava
  fitness: '🏃',
  weight: '⚖️',
  events: '📆',
  code: '💻',         // was: github
  checkins: '📍',
  social: '💬',       // was: reddit
};
```

**Step 2: Update source data to use new keys**

Check where sources are defined and update mappings. This may require updating the lifelog source names or adding a mapping layer.

**Step 3: Commit**

```bash
git add backend/src/3_applications/journalist/
git commit -m "refactor(journalist): rename vendor source keys to generic terms"
```

---

## Task 7: Clean Up Port Interface Comments

**Files:**
- Modify: `backend/src/3_applications/common/ports/IMessagingGateway.mjs`
- Modify: `backend/src/3_applications/common/ports/IAIGateway.mjs`

**Step 1: Update IMessagingGateway**

Change:
```javascript
/**
 * IMessagingGateway - Port interface for messaging platforms
 *
 * Implementations:
 * - TelegramAdapter: Telegram Bot API
 * - MockMessagingGateway: In-memory mock for testing
 */
```

To:
```javascript
/**
 * IMessagingGateway - Port interface for messaging platforms
 *
 * Implementations vary by provider (see 2_adapters/messaging/).
 */
```

**Step 2: Update IAIGateway**

Change:
```javascript
/**
 * IAIGateway Port Interface
 *
 * Abstract interface for AI/LLM services.
 * Implementations: OpenAIAdapter, AnthropicAdapter
 */
```

To:
```javascript
/**
 * IAIGateway Port Interface
 *
 * Abstract interface for AI/LLM services.
 * Implementations vary by provider (see 2_adapters/ai/).
 */
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/common/ports/
git commit -m "refactor(ports): remove vendor names from port interface comments"
```

---

## Task 8: Update Media Index Exports

**Files:**
- Modify: `backend/src/3_applications/media/index.mjs`

**Step 1: Add new port export**

```javascript
export { IMediaStorageRepository, isMediaStorageRepository } from './ports/IMediaStorageRepository.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/media/index.mjs
git commit -m "refactor(media): export IMediaStorageRepository port"
```

---

## Task 9: Verify and Test

**Step 1: Run tests**

```bash
npm test
```

**Step 2: Verify module loading**

```bash
node -e "import('./backend/src/3_applications/media/index.mjs').then(() => console.log('OK')).catch(e => console.error(e))"
```

**Step 3: Check for remaining violations**

```bash
grep -r "import fs from" backend/src/3_applications/
grep -r "import path from" backend/src/3_applications/
grep -r "strava\|github\|reddit\|telegram\|openai\|anthropic" backend/src/3_applications/ --include="*.mjs" | grep -v "// was:"
```

**Step 4: Final commit if needed**

```bash
git add -A
git commit -m "fix: address remaining DDD violations"
```

---

## Summary

| Task | Files | Fix |
|------|-------|-----|
| 1 | IMediaStorageRepository | New port for file ops |
| 2 | LocalMediaStorageAdapter | Adapter implementing port |
| 3 | FreshVideoService | Remove fs/path, use repository |
| 4 | app.mjs, YouTubeJobHandler | Wire new dependency |
| 5 | IHealthDataDatastore | Rename `loadStravaData` → `loadActivityData` |
| 6 | SendMorningDebrief | Rename vendor keys in SOURCE_ICONS |
| 7 | Port interfaces | Remove vendor names from comments |
| 8 | media/index.mjs | Export new port |
| 9 | Tests | Verify all passes |
