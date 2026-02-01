# Media Progress Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename WatchStore → MediaProgressMemory, remove legacy file-based history loading, and add domain service for watch status classification.

**Architecture:** Rename entity/interface/implementation files, update all imports, remove legacy `historyPath` code from adapters, and add new `IMediaProgressClassifier` domain service with default implementation.

**Tech Stack:** Node.js ES modules, YAML persistence

---

## Task 1: Rename WatchState entity to MediaProgress

**Files:**
- Rename: `backend/src/1_domains/content/entities/WatchState.mjs` → `MediaProgress.mjs`
- Modify: `backend/src/1_domains/content/entities/MediaProgress.mjs`
- Modify: `backend/src/1_domains/content/index.mjs`

**Step 1: Rename the file**

```bash
mv backend/src/1_domains/content/entities/WatchState.mjs backend/src/1_domains/content/entities/MediaProgress.mjs
```

**Step 2: Update class and type names in MediaProgress.mjs**

Replace all occurrences:
- `WatchStateProps` → `MediaProgressProps`
- `WatchState` → `MediaProgress`
- Update file header comment

**Step 3: Update index.mjs export**

In `backend/src/1_domains/content/index.mjs`, change:
```javascript
export { WatchState } from './entities/WatchState.mjs';
```
To:
```javascript
export { MediaProgress } from './entities/MediaProgress.mjs';
```

**Step 4: Verify syntax**

```bash
cd backend && node --check src/1_domains/content/entities/MediaProgress.mjs
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: rename WatchState entity to MediaProgress"
```

---

## Task 2: Rename IWatchStateDatastore port to IMediaProgressMemory

**Files:**
- Rename: `backend/src/3_applications/content/ports/IWatchStateDatastore.mjs` → `IMediaProgressMemory.mjs`
- Modify: `backend/src/3_applications/content/ports/IMediaProgressMemory.mjs`
- Modify: `backend/src/3_applications/content/ports/index.mjs`

**Step 1: Rename the file**

```bash
mv backend/src/3_applications/content/ports/IWatchStateDatastore.mjs backend/src/3_applications/content/ports/IMediaProgressMemory.mjs
```

**Step 2: Update interface and function names**

In the renamed file, replace:
- `IWatchStateDatastore` → `IMediaProgressMemory`
- `validateWatchStateDatastore` → `validateMediaProgressMemory`
- `WatchState` → `MediaProgress` in JSDoc
- Update import path to MediaProgress entity

**Step 3: Update index.mjs export**

```javascript
export { IMediaProgressMemory, validateMediaProgressMemory } from './IMediaProgressMemory.mjs';
```

**Step 4: Verify syntax**

```bash
cd backend && node --check src/3_applications/content/ports/IMediaProgressMemory.mjs
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: rename IWatchStateDatastore to IMediaProgressMemory"
```

---

## Task 3: Rename YamlWatchStateDatastore to YamlMediaProgressMemory

**Files:**
- Rename: `backend/src/2_adapters/persistence/yaml/YamlWatchStateDatastore.mjs` → `YamlMediaProgressMemory.mjs`
- Modify: `backend/src/2_adapters/persistence/yaml/YamlMediaProgressMemory.mjs`

**Step 1: Rename the file**

```bash
mv backend/src/2_adapters/persistence/yaml/YamlWatchStateDatastore.mjs backend/src/2_adapters/persistence/yaml/YamlMediaProgressMemory.mjs
```

**Step 2: Update class name and imports**

Replace:
- `YamlWatchStateDatastore` → `YamlMediaProgressMemory`
- `WatchState` → `MediaProgress` in imports and JSDoc
- `IWatchStateDatastore` → `IMediaProgressMemory`
- Update file header comment

**Step 3: Verify syntax**

```bash
cd backend && node --check src/2_adapters/persistence/yaml/YamlMediaProgressMemory.mjs
```

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: rename YamlWatchStateDatastore to YamlMediaProgressMemory"
```

---

## Task 4: Update bootstrap.mjs with new names

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Update imports**

Change:
```javascript
import { YamlWatchStateDatastore } from '#adapters/persistence/yaml/YamlWatchStateDatastore.mjs';
```
To:
```javascript
import { YamlMediaProgressMemory } from '#adapters/persistence/yaml/YamlMediaProgressMemory.mjs';
```

**Step 2: Rename createWatchStore function**

Change function name and internals:
```javascript
export function createMediaProgressMemory(config) {
  return new YamlMediaProgressMemory({
    basePath: config.mediaProgressPath
  });
}
```

**Step 3: Update createContentRegistry**

Change parameter name in deps destructuring:
```javascript
const { httpClient, mediaProgressMemory } = deps;
```

Update PlexAdapter instantiation:
```javascript
registry.register(new PlexAdapter({
  host: config.plex.host,
  token: config.plex.token,
  mediaProgressMemory,  // renamed from watchStore
}, { httpClient }));
```

**Step 4: Verify syntax**

```bash
cd backend && node --check src/0_system/bootstrap.mjs
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: update bootstrap with MediaProgressMemory names"
```

---

## Task 5: Update app.mjs with new names

**Files:**
- Modify: `backend/src/app.mjs`

**Step 1: Update variable names**

Change:
- `watchStatePath` → `mediaProgressPath`
- `watchStore` → `mediaProgressMemory`
- `createWatchStore` → `createMediaProgressMemory`

**Step 2: Update createContentRegistry call**

```javascript
const mediaProgressMemory = createMediaProgressMemory({ mediaProgressPath });

const contentRegistry = createContentRegistry({
  // ... config
}, { httpClient: axios, mediaProgressMemory });
```

**Step 3: Update contentRouters call**

```javascript
const contentRouters = createApiRouters({
  registry: contentRegistry,
  mediaProgressMemory,  // renamed
  // ... rest
});
```

**Step 4: Verify syntax**

```bash
cd backend && node --check src/app.mjs
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: update app.mjs with MediaProgressMemory names"
```

---

## Task 6: Update play.mjs router with new names

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs`

**Step 1: Update parameter names**

In `createPlayRouter` function signature and body:
- `watchStore` → `mediaProgressMemory`

**Step 2: Update all usages**

Replace all `watchStore.` with `mediaProgressMemory.`

**Step 3: Verify syntax**

```bash
cd backend && node --check src/4_api/v1/routers/play.mjs
```

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: update play router with mediaProgressMemory"
```

---

## Task 7: Update content.mjs router with new names

**Files:**
- Modify: `backend/src/4_api/v1/routers/content.mjs`

**Step 1: Update parameter names and usages**

- `watchStore` → `mediaProgressMemory`
- `WatchState` → `MediaProgress` in imports

**Step 2: Verify syntax**

```bash
cd backend && node --check src/4_api/v1/routers/content.mjs
```

**Step 3: Commit**

```bash
git add -A && git commit -m "refactor: update content router with mediaProgressMemory"
```

---

## Task 8: Update PlexAdapter - rename and remove legacy

**Files:**
- Modify: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs`

**Step 1: Rename watchStore to mediaProgressMemory**

In constructor:
```javascript
this.mediaProgressMemory = config.mediaProgressMemory || null;
```

**Step 2: Remove legacy historyPath code**

Delete these properties and methods:
- `this.historyPath` property
- `this._historyLoader` property
- `this._historyClearer` property
- `_loadHistoryFromFiles()` method
- `_clearHistoryFromFiles()` method
- `setHistoryLoader()` method
- `setHistoryClearer()` method

**Step 3: Simplify constructor**

Remove the if/else for historyLoader setup:
```javascript
this.mediaProgressMemory = config.mediaProgressMemory || null;
// Remove all historyPath related code
```

**Step 4: Update _loadViewingHistoryAsync**

Rename `watchStore` references to `mediaProgressMemory`:
```javascript
async _loadViewingHistoryAsync(storagePath = 'plex') {
  if (!this.mediaProgressMemory) {
    return {};
  }
  // ... rest using this.mediaProgressMemory
}
```

**Step 5: Remove _loadViewingHistory sync method**

Since we're removing file-based loading, update callers to use async method.

**Step 6: Verify syntax**

```bash
cd backend && node --check src/2_adapters/content/media/plex/PlexAdapter.mjs
```

**Step 7: Commit**

```bash
git add -A && git commit -m "refactor(plex-adapter): rename to mediaProgressMemory, remove legacy historyPath"
```

---

## Task 9: Update FilesystemAdapter - remove legacy

**Files:**
- Modify: `backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs`

**Step 1: Add mediaProgressMemory to constructor**

```javascript
this.mediaProgressMemory = config.mediaProgressMemory || null;
```

**Step 2: Remove legacy code**

Delete:
- `this.historyPath` property
- `_loadWatchState()` method

**Step 3: Update getStoragePath if needed**

Ensure it returns appropriate path for media files (e.g., `'media'`).

**Step 4: Verify syntax**

```bash
cd backend && node --check src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(filesystem-adapter): remove legacy historyPath"
```

---

## Task 10: Update LocalContentAdapter - remove legacy

**Files:**
- Modify: `backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs`

**Step 1: Add mediaProgressMemory to constructor**

```javascript
this.mediaProgressMemory = config.mediaProgressMemory || null;
```

**Step 2: Remove legacy code**

Delete:
- `this.historyPath` property
- `_loadWatchState()` method

**Step 3: Update methods that used _loadWatchState**

Replace with async mediaProgressMemory calls or remove if not needed.

**Step 4: Verify syntax**

```bash
cd backend && node --check src/2_adapters/content/local-content/LocalContentAdapter.mjs
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(local-content-adapter): remove legacy historyPath"
```

---

## Task 11: Update FolderAdapter - remove legacy

**Files:**
- Modify: `backend/src/2_adapters/content/folder/FolderAdapter.mjs`

**Step 1: Add mediaProgressMemory to constructor**

```javascript
this.mediaProgressMemory = config.mediaProgressMemory || null;
```

**Step 2: Remove legacy code**

Delete:
- `this.historyPath` property
- `_loadWatchState()` method
- `_loadPlexWatchState()` method

**Step 3: Update methods that used watch state loading**

Replace with async mediaProgressMemory calls.

**Step 4: Verify syntax**

```bash
cd backend && node --check src/2_adapters/content/folder/FolderAdapter.mjs
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(folder-adapter): remove legacy historyPath"
```

---

## Task 12: Update bootstrap to remove mediaMemoryPath

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Remove mediaMemoryPath from config**

In `createContentRegistry`, remove `mediaMemoryPath` from adapter configs since they no longer use it.

**Step 2: Pass mediaProgressMemory to all adapters**

Update FilesystemAdapter, LocalContentAdapter, FolderAdapter instantiation:
```javascript
registry.register(new FilesystemAdapter({
  mediaBasePath: config.mediaBasePath,
  mediaProgressMemory,  // Add this
}));
```

**Step 3: Verify syntax**

```bash
cd backend && node --check src/0_system/bootstrap.mjs
```

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor(bootstrap): wire mediaProgressMemory to all adapters"
```

---

## Task 13: Create IMediaProgressClassifier interface

**Files:**
- Create: `backend/src/1_domains/content/services/IMediaProgressClassifier.mjs`

**Step 1: Create the interface**

```javascript
// backend/src/1_domains/content/services/IMediaProgressClassifier.mjs

/**
 * Interface for classifying media progress status
 */
export class IMediaProgressClassifier {
  /**
   * Classify media progress status
   * @param {import('../entities/MediaProgress.mjs').MediaProgress} progress
   * @param {Object} [contentMeta] - Optional content metadata
   * @param {number} [contentMeta.duration] - Content duration in seconds
   * @param {string} [contentMeta.type] - Content type (movie, episode, etc.)
   * @returns {'unwatched' | 'in_progress' | 'watched'}
   */
  classify(progress, contentMeta = {}) {
    throw new Error('IMediaProgressClassifier.classify must be implemented');
  }
}
```

**Step 2: Verify syntax**

```bash
cd backend && node --check src/1_domains/content/services/IMediaProgressClassifier.mjs
```

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add IMediaProgressClassifier interface"
```

---

## Task 14: Create DefaultMediaProgressClassifier

**Files:**
- Create: `backend/src/1_domains/content/services/DefaultMediaProgressClassifier.mjs`

**Step 1: Create the default implementation**

```javascript
// backend/src/1_domains/content/services/DefaultMediaProgressClassifier.mjs

import { IMediaProgressClassifier } from './IMediaProgressClassifier.mjs';

/**
 * Default implementation of media progress classification
 */
export class DefaultMediaProgressClassifier extends IMediaProgressClassifier {
  constructor(config = {}) {
    super();
    this.config = {
      watchedPercentThreshold: 90,
      minWatchTimeSeconds: 60,
      shortformDurationSeconds: 900,
      shortformPercentThreshold: 95,
      remainingSecondsThreshold: 120,
      ...config
    };
  }

  /**
   * @param {import('../entities/MediaProgress.mjs').MediaProgress} progress
   * @param {Object} [contentMeta]
   * @returns {'unwatched' | 'in_progress' | 'watched'}
   */
  classify(progress, contentMeta = {}) {
    const { playhead, duration, watchTime } = progress;
    const percent = progress.percent ?? 0;
    const {
      watchedPercentThreshold,
      minWatchTimeSeconds,
      shortformDurationSeconds,
      shortformPercentThreshold,
      remainingSecondsThreshold
    } = this.config;

    // No progress = unwatched
    if (!playhead || playhead === 0) {
      return 'unwatched';
    }

    // Insufficient actual watch time (anti-seeking protection)
    if (watchTime !== undefined && watchTime < minWatchTimeSeconds) {
      return 'in_progress';
    }

    // Determine threshold based on content length
    const contentDuration = contentMeta.duration || duration || 0;
    const isShortform = contentDuration > 0 && contentDuration < shortformDurationSeconds;
    const percentThreshold = isShortform ? shortformPercentThreshold : watchedPercentThreshold;

    // Check remaining time
    const remaining = contentDuration > 0 ? contentDuration - playhead : Infinity;

    // Watched if percent threshold met OR less than threshold seconds remaining
    if (percent >= percentThreshold || (remaining < remainingSecondsThreshold && remaining >= 0)) {
      return 'watched';
    }

    return 'in_progress';
  }
}
```

**Step 2: Verify syntax**

```bash
cd backend && node --check src/1_domains/content/services/DefaultMediaProgressClassifier.mjs
```

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add DefaultMediaProgressClassifier implementation"
```

---

## Task 15: Export classifier from domain index

**Files:**
- Modify: `backend/src/1_domains/content/index.mjs`

**Step 1: Add exports**

```javascript
export { IMediaProgressClassifier } from './services/IMediaProgressClassifier.mjs';
export { DefaultMediaProgressClassifier } from './services/DefaultMediaProgressClassifier.mjs';
```

**Step 2: Verify syntax**

```bash
cd backend && node --check src/1_domains/content/index.mjs
```

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: export MediaProgressClassifier from content domain"
```

---

## Task 16: Update QueueService with new names

**Files:**
- Modify: `backend/src/1_domains/content/services/QueueService.mjs`

**Step 1: Update WatchState references to MediaProgress**

Search and replace `WatchState` → `MediaProgress` in imports and usages.

**Step 2: Verify syntax**

```bash
cd backend && node --check src/1_domains/content/services/QueueService.mjs
```

**Step 3: Commit**

```bash
git add -A && git commit -m "refactor: update QueueService with MediaProgress names"
```

---

## Task 17: Final verification and cleanup

**Step 1: Check for any remaining WatchState/watchStore references**

```bash
grep -r "WatchState\|watchStore\|WatchStateDatastore" backend/src --include="*.mjs" | grep -v node_modules
```

Fix any remaining references.

**Step 2: Verify app imports cleanly**

```bash
cd backend && node -e "import('./src/app.mjs').then(() => console.log('OK')).catch(e => console.error(e))"
```

**Step 3: Run syntax check on all modified files**

```bash
cd backend && node --check src/app.mjs && echo "All syntax checks passed"
```

**Step 4: Final commit**

```bash
git add -A && git commit -m "refactor: complete MediaProgress rename and legacy cleanup"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Rename WatchState entity → MediaProgress |
| 2 | Rename IWatchStateDatastore → IMediaProgressMemory |
| 3 | Rename YamlWatchStateDatastore → YamlMediaProgressMemory |
| 4 | Update bootstrap.mjs |
| 5 | Update app.mjs |
| 6 | Update play.mjs router |
| 7 | Update content.mjs router |
| 8 | Update PlexAdapter (rename + remove legacy) |
| 9 | Update FilesystemAdapter (remove legacy) |
| 10 | Update LocalContentAdapter (remove legacy) |
| 11 | Update FolderAdapter (remove legacy) |
| 12 | Update bootstrap to wire all adapters |
| 13 | Create IMediaProgressClassifier interface |
| 14 | Create DefaultMediaProgressClassifier |
| 15 | Export classifier from domain |
| 16 | Update QueueService |
| 17 | Final verification |
