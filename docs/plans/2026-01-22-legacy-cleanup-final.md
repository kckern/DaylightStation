# Legacy Cleanup Final Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate all `_legacy/lib/` imports from `backend/src/`, completing the ConfigService SSOT migration.

**Architecture:** Update import paths from legacy shims to new locations, migrate remaining io.mjs usages to UserDataService or dedicated services, then delete the legacy shim files.

**Tech Stack:** Node.js ES Modules, ConfigService, UserDataService

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | Update logging config imports | 2 modify |
| 2 | Migrate io.mjs to dedicated IOService | 1 create, 1 modify |
| 3 | Update app.mjs io.mjs imports | 1 modify |
| 4 | Delete legacy logging shim | 1 delete |
| 5 | Final verification | 0 |

**Out of Scope (separate project):**
- Chatbots subsystem (`_legacy/chatbots/`) - 300+ files, requires dedicated migration
- Legacy routers (`_legacy/routers/`) - used by cron jobs, separate concern
- Legacy lib utilities (budget.mjs, infinity.mjs, entropy.mjs) - domain-specific, migrate with features

---

## Task 1: Update Logging Config Imports

**Files:**
- Modify: `backend/src/server.mjs`
- Modify: `backend/src/app.mjs`

**Context:** The `_legacy/lib/logging/config.js` is already a re-export shim pointing to `src/0_infrastructure/logging/config.js`. We just need to update the import paths.

**Step 1: Read current imports in server.mjs**

```bash
grep -n "_legacy/lib/logging" backend/src/server.mjs
```

**Step 2: Update server.mjs imports**

Change lines 14 and 20:

Before:
```javascript
import { hydrateProcessEnvFromConfigs } from '../_legacy/lib/logging/config.js';
import { loadLoggingConfig, resolveLoggerLevel, getLoggingTags } from '../_legacy/lib/logging/config.js';
```

After:
```javascript
import { hydrateProcessEnvFromConfigs } from './0_infrastructure/logging/config.js';
import { loadLoggingConfig, resolveLoggerLevel, getLoggingTags } from './0_infrastructure/logging/config.js';
```

**Step 3: Update app.mjs imports**

Change line 22:

Before:
```javascript
import { loadLoggingConfig, resolveLoggerLevel } from '../_legacy/lib/logging/config.js';
```

After:
```javascript
import { loadLoggingConfig, resolveLoggerLevel } from './0_infrastructure/logging/config.js';
```

**Step 4: Verify no legacy logging imports remain**

```bash
grep -rn "_legacy/lib/logging" backend/src/ --include="*.mjs" --include="*.js"
```

Expected: No matches

**Step 5: Run tests**

```bash
npm run test:unit -- --testPathPattern="server|app" --passWithNoTests
```

**Step 6: Commit**

```bash
git add backend/src/server.mjs backend/src/app.mjs
git commit -m "refactor: update logging imports to new location

- server.mjs: import from src/0_infrastructure/logging/config.js
- app.mjs: import from src/0_infrastructure/logging/config.js
- Removes dependency on _legacy/lib/logging shim

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create IOService for Content/State Operations

**Files:**
- Create: `backend/src/0_infrastructure/io/IOService.mjs`
- Modify: `backend/src/0_infrastructure/io/index.mjs` (create if needed)

**Context:** The `_legacy/lib/io.mjs` provides `loadFile`, `saveFile`, `userLoadFile`, `userLoadCurrent`, `loadRandom`, `loadFileByPrefix`. These need a proper home in the new architecture.

**Step 1: Create IOService.mjs**

```javascript
/**
 * IOService - Content and State File Operations
 *
 * Provides YAML file operations for:
 * - Content files (read-only content like songs, quotes)
 * - State files (runtime state like watchlists, weather cache)
 * - Random content selection
 *
 * For user-namespaced data, use UserDataService instead.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { configService } from '../config/index.mjs';
import { createLogger } from '../logging/logger.js';

const logger = createLogger({
  source: 'backend',
  app: 'io-service'
});

// Custom YAML schema for flow sequences (arrays of numbers on one line)
class FlowSequence extends Array {}

const FlowSequenceType = new yaml.Type('tag:yaml.org,2002:seq', {
  kind: 'sequence',
  instanceOf: FlowSequence,
  represent: (sequence) => sequence,
  defaultStyle: 'flow'
});

const CUSTOM_YAML_SCHEMA = yaml.DEFAULT_SCHEMA.extend([FlowSequenceType]);

// Per-path write queues to avoid concurrent save collisions
const SAVE_QUEUES = globalThis.__daylightSaveQueues || new Map();
globalThis.__daylightSaveQueues = SAVE_QUEUES;

/**
 * Mark arrays of integers as flow sequences for compact YAML output
 */
const markFlowSequences = (value) => {
  if (Array.isArray(value)) {
    const processed = value.map((item) => markFlowSequences(item));
    const isAllIntegers = processed.length > 0 &&
      processed.every(v => v === null || (typeof v === 'number' && Number.isInteger(v)));
    if (isAllIntegers) {
      const flowSequence = new FlowSequence();
      processed.forEach((item) => flowSequence.push(item));
      return flowSequence;
    }
    return processed;
  }

  if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      value[key] = markFlowSequences(value[key]);
    });
  }

  return value;
};

export class IOService {
  #dataDir = null;

  constructor() {
    // Lazy init from ConfigService
  }

  #ensureDataDir() {
    if (!this.#dataDir) {
      this.#dataDir = configService.getDataDir();
    }
    return this.#dataDir;
  }

  /**
   * Load a YAML file from the data directory
   * @param {string} relativePath - Path relative to data dir (without .yml extension)
   * @returns {object|null}
   */
  loadFile(relativePath) {
    const dataDir = this.#ensureDataDir();
    const cleanPath = relativePath.replace(/\.(ya?ml)$/, '');

    // Try both .yml and .yaml extensions
    for (const ext of ['.yml', '.yaml']) {
      const fullPath = path.join(dataDir, cleanPath + ext);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          return yaml.load(content) || null;
        } catch (err) {
          logger.error('io.loadFile.parseError', { path: fullPath, error: err.message });
          return null;
        }
      }
    }

    return null;
  }

  /**
   * Save data to a YAML file in the data directory
   * Uses write queue to prevent concurrent writes to same file
   * @param {string} relativePath - Path relative to data dir (without .yml extension)
   * @param {object} data - Data to save
   * @returns {boolean}
   */
  async saveFile(relativePath, data) {
    const dataDir = this.#ensureDataDir();
    const cleanPath = relativePath.replace(/\.(ya?ml)$/, '');
    const fullPath = path.join(dataDir, cleanPath + '.yml');

    // Queue write to prevent concurrent saves
    const queue = SAVE_QUEUES.get(fullPath) || Promise.resolve();
    const writePromise = queue.then(async () => {
      try {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const markedData = markFlowSequences(structuredClone(data));
        const content = yaml.dump(markedData, {
          schema: CUSTOM_YAML_SCHEMA,
          lineWidth: -1,
          quotingType: '"'
        });

        fs.writeFileSync(fullPath, content, 'utf8');
        return true;
      } catch (err) {
        logger.error('io.saveFile.error', { path: fullPath, error: err.message });
        return false;
      }
    });

    SAVE_QUEUES.set(fullPath, writePromise);
    return writePromise;
  }

  /**
   * Load a random YAML file from a folder
   * @param {string} folder - Folder path relative to data dir
   * @returns {object|null}
   */
  loadRandom(folder) {
    const dataDir = this.#ensureDataDir();
    const fullPath = path.join(dataDir, folder);

    if (!fs.existsSync(fullPath)) {
      logger.warn('io.loadRandom.folderMissing', { path: fullPath });
      return null;
    }

    const files = fs.readdirSync(fullPath).filter(file =>
      (file.endsWith('.yml') || file.endsWith('.yaml')) && !file.startsWith('._')
    );

    if (files.length === 0) {
      logger.warn('io.loadRandom.noFiles', { path: fullPath });
      return null;
    }

    const randomFile = files[Math.floor(Math.random() * files.length)];
    return this.loadFile(path.join(folder, randomFile.replace(/\.(ya?ml)$/, '')));
  }

  /**
   * Load a file by numeric prefix from a folder
   * Matches files like "0017-some-title.yml" when given prefix "17"
   * @param {string} folder - Folder path relative to data dir
   * @param {string} prefix - Numeric prefix to match
   * @returns {object|null}
   */
  loadFileByPrefix(folder, prefix) {
    const dataDir = this.#ensureDataDir();
    const fullPath = path.join(dataDir, folder);

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const normalizedPrefix = String(prefix).replace(/^0+/, '') || '0';
    const files = fs.readdirSync(fullPath).filter(file =>
      (file.endsWith('.yml') || file.endsWith('.yaml')) && !file.startsWith('._')
    );

    const matchingFile = files.find(file => {
      const match = file.match(/^(\d+)/);
      if (!match) return false;
      const fileNum = match[1].replace(/^0+/, '') || '0';
      return fileNum === normalizedPrefix;
    });

    if (!matchingFile) {
      return null;
    }

    return this.loadFile(path.join(folder, matchingFile.replace(/\.(ya?ml)$/, '')));
  }
}

// Singleton
export const ioService = new IOService();
export default ioService;
```

**Step 2: Create index.mjs for io module**

Create `backend/src/0_infrastructure/io/index.mjs`:

```javascript
export { IOService, ioService } from './IOService.mjs';
export default ioService;
```

**Step 3: Verify module loads**

```bash
node -e "
import('./backend/src/0_infrastructure/io/index.mjs').then(m => {
  console.log('IOService:', typeof m.ioService.loadFile);
});
"
```

Expected: `IOService: function`

**Step 4: Commit**

```bash
git add backend/src/0_infrastructure/io/
git commit -m "feat(io): add IOService for content/state file operations

- loadFile, saveFile for YAML operations
- loadRandom for random content selection
- loadFileByPrefix for numbered files
- Write queue prevents concurrent save collisions

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Update app.mjs io.mjs Imports

**Files:**
- Modify: `backend/src/app.mjs`

**Context:** app.mjs has dynamic imports of `_legacy/lib/io.mjs`. Update these to use the new IOService.

**Step 1: Find io.mjs usages in app.mjs**

```bash
grep -n "_legacy/lib/io.mjs" backend/src/app.mjs
```

**Step 2: Update content router imports (around line 236)**

Before:
```javascript
const { loadFile: contentLoadFile, saveFile: contentSaveFile } = await import('../_legacy/lib/io.mjs');
```

After:
```javascript
const { ioService } = await import('./0_infrastructure/io/index.mjs');
const contentLoadFile = (path) => ioService.loadFile(path);
const contentSaveFile = (path, data) => ioService.saveFile(path, data);
```

**Step 3: Update user data imports (around line 271)**

The `userLoadFile` and `userLoadCurrent` should use UserDataService. Find what they're used for:

Before:
```javascript
const { userLoadFile, userLoadCurrent } = await import('../_legacy/lib/io.mjs');
```

After:
```javascript
const { userDataService } = await import('./0_infrastructure/config/UserDataService.mjs');
// userLoadFile and userLoadCurrent replaced with userDataService methods
```

Note: This may require examining how `userLoadFile` and `userLoadCurrent` are used to properly map to UserDataService methods.

**Step 4: Update home assistant imports (around line 516)**

Before:
```javascript
const { loadFile, saveFile } = await import('../_legacy/lib/io.mjs');
```

After:
```javascript
const { ioService } = await import('./0_infrastructure/io/index.mjs');
const loadFile = (path) => ioService.loadFile(path);
const saveFile = (path, data) => ioService.saveFile(path, data);
```

**Step 5: Verify no io.mjs imports remain**

```bash
grep -n "_legacy/lib/io.mjs" backend/src/app.mjs
```

Expected: No matches

**Step 6: Run tests**

```bash
npm run test:integration
```

**Step 7: Commit**

```bash
git add backend/src/app.mjs
git commit -m "refactor(app): migrate io.mjs imports to IOService

- Content operations use ioService.loadFile/saveFile
- User operations use userDataService
- Removes dependency on _legacy/lib/io.mjs

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Delete Legacy Logging Shim

**Files:**
- Delete: `backend/_legacy/lib/logging/config.js`

**Step 1: Verify no consumers of legacy logging shim**

```bash
grep -rn "_legacy/lib/logging" backend/ --include="*.mjs" --include="*.js" | grep -v node_modules
```

Expected: No matches (or only the file itself)

**Step 2: Delete the shim file**

```bash
rm backend/_legacy/lib/logging/config.js
```

**Step 3: Check if logging directory is now empty**

```bash
ls backend/_legacy/lib/logging/
```

If empty, delete the directory:
```bash
rmdir backend/_legacy/lib/logging/
```

**Step 4: Commit**

```bash
git add -A backend/_legacy/lib/logging/
git commit -m "chore: delete legacy logging config shim

All consumers now import from src/0_infrastructure/logging/config.js directly.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Final Verification

**Step 1: Check remaining _legacy/lib imports**

```bash
grep -rn "_legacy/lib/" backend/src/ --include="*.mjs" --include="*.js" | grep -v "node_modules"
```

Document what remains:
- `ArchiveService.mjs` - used for archive operations (domain-specific)
- `budget.mjs` - finance domain (separate migration)
- `infinity.mjs` - finance domain (separate migration)
- `entropy.mjs` - stats/analytics (separate migration)

**Step 2: Run full test suite**

```bash
npm run test:unit
npm run test:integration
```

**Step 3: Start server and verify**

```bash
node backend/index.js
```

Expected: Server starts without errors

**Step 4: Create summary of remaining legacy items**

Document in a new file what still needs migration (for future reference):

```bash
cat > docs/_wip/2026-01-22-remaining-legacy-items.md << 'EOF'
# Remaining Legacy Items

## _legacy/lib/ (Domain-Specific)

These remain because they're tightly coupled to specific features:

| File | Domain | Migrated When |
|------|--------|---------------|
| ArchiveService.mjs | content | Archive feature refactor |
| budget.mjs | finance | Finance app refactor |
| infinity.mjs | finance | Finance app refactor |
| entropy.mjs | analytics | Analytics feature refactor |

## _legacy/chatbots/ (Separate Subsystem)

300+ files. Requires dedicated migration project.

## _legacy/routers/ (Cron Jobs)

Used by scheduled jobs. Migrate when cron system is refactored.
EOF
```

**Step 5: Final commit**

```bash
git add docs/_wip/2026-01-22-remaining-legacy-items.md
git commit -m "docs: document remaining legacy items for future migration

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

After all tasks:

- [ ] `grep -rn "_legacy/lib/logging" backend/src/` returns no matches
- [ ] `grep -rn "_legacy/lib/io.mjs" backend/src/` returns no matches
- [ ] IOService loads and works: `ioService.loadFile('content/quotes')`
- [ ] Server starts: `node backend/index.js`
- [ ] Unit tests pass: `npm run test:unit`
- [ ] Integration tests pass: `npm run test:integration`

## What Remains (Documented, Not Blocked)

These are intentionally left for future work:
- Domain-specific libs (budget, entropy, archive) - migrate with their features
- Chatbots subsystem - 300+ files, dedicated project
- Legacy routers - migrate with cron system refactor
