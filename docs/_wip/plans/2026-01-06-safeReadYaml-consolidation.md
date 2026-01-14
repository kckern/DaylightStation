# safeReadYaml Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate 4 duplicate `safeReadYaml` implementations into a proper architecture with bootstrap and runtime layers.

**Architecture:**
- Create `bootstrap-yaml.mjs` for pre-env config loading (logging/config.js, ConfigService bootstrap)
- Refactor `UserDataService.mjs` to use `io.mjs` for runtime data access (gains write queue)
- Delete dead code from `UserService.mjs`

**Tech Stack:** Node.js, js-yaml, yaml packages, Jest for testing

---

## Task 1: Delete Dead Code from UserService.mjs

**Files:**
- Modify: `backend/lib/config/UserService.mjs:10-12,19-29`

**Step 1: Remove unused imports**

Remove lines 10-12 (fs, path, parse imports that are only used by dead safeReadYaml):

```javascript
// DELETE these lines:
import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';
```

**Step 2: Remove dead safeReadYaml function**

Remove lines 19-29 (the entire safeReadYaml function that is never called):

```javascript
// DELETE this entire function:
// Safe YAML reader
const safeReadYaml = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return parse(raw) || {};
    }
  } catch (err) {
    console.error(`[UserService] Failed to read ${filePath}:`, err?.message || err);
  }
  return null;
};
```

**Step 3: Verify no broken imports**

Run: `node --check backend/lib/config/UserService.mjs`
Expected: No output (syntax OK)

**Step 4: Commit**

```bash
git add backend/lib/config/UserService.mjs
git commit -m "refactor(config): remove dead safeReadYaml from UserService

The function was defined but never called - all methods delegate to ConfigService."
```

---

## Task 2: Create Bootstrap YAML Utility

**Files:**
- Create: `backend/lib/bootstrap-yaml.mjs`
- Test: `tests/assembly/bootstrap-yaml.assembly.test.mjs`

**Step 1: Write the test file**

```javascript
// tests/assembly/bootstrap-yaml.assembly.test.mjs
import { describe, it, expect } from '@jest/globals';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('bootstrap-yaml.mjs', () => {
  let bootstrapReadYaml;

  beforeAll(async () => {
    const mod = await import('../../backend/lib/bootstrap-yaml.mjs');
    bootstrapReadYaml = mod.bootstrapReadYaml;
  });

  it('exports bootstrapReadYaml function', () => {
    expect(typeof bootstrapReadYaml).toBe('function');
  });

  it('returns {} for non-existent file', () => {
    const result = bootstrapReadYaml('/nonexistent/path.yml');
    expect(result).toEqual({});
  });

  it('returns {} for empty file', () => {
    const tmpFile = path.join(os.tmpdir(), `test-empty-${Date.now()}.yml`);
    fs.writeFileSync(tmpFile, '', 'utf8');
    try {
      const result = bootstrapReadYaml(tmpFile);
      expect(result).toEqual({});
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('parses valid YAML file', () => {
    const tmpFile = path.join(os.tmpdir(), `test-valid-${Date.now()}.yml`);
    fs.writeFileSync(tmpFile, 'key: value\nnested:\n  foo: bar', 'utf8');
    try {
      const result = bootstrapReadYaml(tmpFile);
      expect(result).toEqual({ key: 'value', nested: { foo: 'bar' } });
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('returns {} for invalid YAML (does not throw)', () => {
    const tmpFile = path.join(os.tmpdir(), `test-invalid-${Date.now()}.yml`);
    fs.writeFileSync(tmpFile, ':\n  - invalid: yaml: content:', 'utf8');
    try {
      const result = bootstrapReadYaml(tmpFile);
      expect(result).toEqual({});
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:assembly -- --testPathPattern=bootstrap-yaml`
Expected: FAIL - Cannot find module

**Step 3: Create the bootstrap-yaml module**

```javascript
// backend/lib/bootstrap-yaml.mjs
/**
 * Bootstrap YAML Reader
 *
 * Minimal YAML reader for bootstrap/config loading BEFORE process.env is set.
 *
 * Key properties:
 * - Returns {} on missing file (for config merging with spread)
 * - Returns {} on parse error (graceful degradation)
 * - No logger dependency (avoids circular imports)
 * - Uses stderr for errors (always available)
 *
 * DO NOT USE FOR RUNTIME DATA - use io.mjs instead (has write queue, etc.)
 */

import fs from 'fs';
import { parse } from 'yaml';

/**
 * Read and parse a YAML file for bootstrap configuration.
 * Returns {} on any failure to support config merging: { ...defaults, ...loaded }
 *
 * @param {string} filePath - Absolute path to YAML file
 * @returns {object} Parsed YAML or empty object
 */
export const bootstrapReadYaml = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return parse(raw) || {};
    }
  } catch (err) {
    process.stderr.write(`[bootstrap] Failed to read ${filePath}: ${err?.message || err}\n`);
  }
  return {};
};
```

**Step 4: Run test to verify it passes**

Run: `npm run test:assembly -- --testPathPattern=bootstrap-yaml`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/lib/bootstrap-yaml.mjs tests/assembly/bootstrap-yaml.assembly.test.mjs
git commit -m "feat(config): add bootstrap-yaml utility for pre-env config loading

Extracted from logging/config.js to share with ConfigService.
Returns {} on failure for safe config merging with spread operator."
```

---

## Task 3: Migrate logging/config.js to Use Bootstrap Utility

**Files:**
- Modify: `backend/lib/logging/config.js:1-24`

**Step 1: Update imports**

Replace the `yaml` import and remove inline safeReadYaml. Change lines 1-24:

FROM:
```javascript
import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';

const DEFAULT_CONFIG = {
  defaultLevel: 'info',
  loggers: {},
  tags: ['backend']
};

let cachedConfig = null;

const safeReadYaml = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return parse(raw) || {};
    }
  } catch (err) {
    const line = `[logging-config] failed to read ${filePath} ${err?.message || err}\n`;
    process.stderr.write(line);
  }
  return {};
};
```

TO:
```javascript
import fs from 'fs';
import path from 'path';
import { bootstrapReadYaml } from './bootstrap-yaml.mjs';

const DEFAULT_CONFIG = {
  defaultLevel: 'info',
  loggers: {},
  tags: ['backend']
};

let cachedConfig = null;

// Use shared bootstrap utility (returns {} on failure for config merging)
const safeReadYaml = bootstrapReadYaml;
```

**Step 2: Verify syntax**

Run: `node --check backend/lib/logging/config.js`
Expected: No output (syntax OK)

**Step 3: Run existing tests**

Run: `npm run test:assembly`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add backend/lib/logging/config.js
git commit -m "refactor(logging): use shared bootstrap-yaml utility

Replaces inline safeReadYaml with shared bootstrapReadYaml.
Behavior unchanged - both return {} on failure."
```

---

## Task 4: Add Runtime YAML Test for ConfigService

**Files:**
- Create: `tests/assembly/config-service.assembly.test.mjs`

**Step 1: Write the test**

```javascript
// tests/assembly/config-service.assembly.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('ConfigService assembly', () => {
  let configService;

  beforeAll(async () => {
    // Set test data path before importing
    const testDataPath = path.join(__dirname, '../_fixtures/data');
    process.env = {
      ...process.env,
      path: {
        ...(process.env.path || {}),
        data: testDataPath
      }
    };

    const mod = await import('../../backend/lib/config/ConfigService.mjs');
    configService = mod.configService;
    configService.init({ dataDir: testDataPath });
  });

  it('loads _test household config', () => {
    const config = configService.getHouseholdConfig('_test');
    expect(config).toBeDefined();
    expect(config.id).toBe('_test');
    expect(config.head).toBe('_alice');
  });

  it('loads _alice user profile', () => {
    const profile = configService.getUserProfile('_alice');
    expect(profile).toBeDefined();
    expect(profile.username).toBe('_alice');
  });

  it('returns null for non-existent household', () => {
    const config = configService.getHouseholdConfig('nonexistent');
    expect(config).toBeNull();
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npm run test:assembly -- --testPathPattern=config-service`
Expected: All tests PASS (ConfigService already works)

**Step 3: Commit**

```bash
git add tests/assembly/config-service.assembly.test.mjs
git commit -m "test(config): add ConfigService assembly tests

Verifies household and user profile loading with test fixtures."
```

---

## Task 5: Migrate ConfigService Bootstrap Methods to Shared Utility

**Files:**
- Modify: `backend/lib/config/ConfigService.mjs:22-40`

**Step 1: Update imports and safeReadYaml**

Change lines 22-40:

FROM:
```javascript
import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';
import createLogger from '../logging/logger.js';

const logger = createLogger({ app: 'config' });

// Safe YAML reader with error handling
const safeReadYaml = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return parse(raw) || {};
    }
  } catch (err) {
    console.error(`[ConfigService] Failed to read ${filePath}:`, err?.message || err);
  }
  return null;
};
```

TO:
```javascript
import fs from 'fs';
import path from 'path';
import { bootstrapReadYaml } from './bootstrap-yaml.mjs';
import createLogger from '../logging/logger.js';

const logger = createLogger({ app: 'config' });

// Bootstrap: returns {} on failure (for config merging)
// Runtime methods that need null on missing should check fs.existsSync first
const safeReadYaml = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  const result = bootstrapReadYaml(filePath);
  // bootstrapReadYaml returns {} on parse error, convert to null for runtime semantics
  return (result && Object.keys(result).length > 0) ? result : null;
};
```

**Step 2: Verify syntax**

Run: `node --check backend/lib/config/ConfigService.mjs`
Expected: No output (syntax OK)

**Step 3: Run tests**

Run: `npm run test:assembly`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add backend/lib/config/ConfigService.mjs
git commit -m "refactor(config): use shared bootstrap-yaml in ConfigService

Wraps bootstrapReadYaml to maintain null-on-missing semantics for runtime methods
while sharing the core YAML parsing logic."
```

---

## Task 6: Add UserDataService Tests Before Refactoring

**Files:**
- Create: `tests/assembly/user-data-service.assembly.test.mjs`

**Step 1: Write the test**

```javascript
// tests/assembly/user-data-service.assembly.test.mjs
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('UserDataService assembly', () => {
  let userDataService;
  let configService;
  const testDataPath = path.join(__dirname, '../_fixtures/data');

  beforeAll(async () => {
    // Set test data path before importing
    process.env = {
      ...process.env,
      path: {
        ...(process.env.path || {}),
        data: testDataPath
      }
    };

    const configMod = await import('../../backend/lib/config/ConfigService.mjs');
    configService = configMod.configService;
    configService.init({ dataDir: testDataPath });

    const userDataMod = await import('../../backend/lib/config/UserDataService.mjs');
    userDataService = userDataMod.userDataService;
  });

  describe('household data operations', () => {
    it('reads household app data', () => {
      const config = userDataService.readHouseholdAppData('_test', 'fitness', 'config');
      expect(config).toBeDefined();
      expect(config.session_duration).toBeDefined();
    });

    it('returns null for non-existent household', () => {
      const result = userDataService.readHouseholdAppData('nonexistent', 'fitness', 'config');
      expect(result).toBeNull();
    });
  });

  describe('user data operations', () => {
    it('reads user lifelog data', () => {
      const data = userDataService.getLifelogData('_alice', 'fitness');
      expect(data).toBeDefined();
    });

    it('returns null for non-existent user data', () => {
      const result = userDataService.getLifelogData('_alice', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('write operations', () => {
    const tmpHouseholdId = `_test_write_${Date.now()}`;
    const tmpHouseholdDir = path.join(testDataPath, 'households', tmpHouseholdId);

    afterAll(() => {
      // Cleanup
      if (fs.existsSync(tmpHouseholdDir)) {
        fs.rmSync(tmpHouseholdDir, { recursive: true });
      }
    });

    it('writes household shared data', () => {
      // Create household directory first
      userDataService.createHouseholdDirectory(tmpHouseholdId);

      const testData = { test: 'value', number: 42 };
      const result = userDataService.writeHouseholdSharedData(tmpHouseholdId, 'test-data', testData);
      expect(result).toBe(true);

      // Read it back
      const readBack = userDataService.readHouseholdSharedData(tmpHouseholdId, 'test-data');
      expect(readBack).toEqual(testData);
    });
  });
});
```

**Step 2: Run test to verify current behavior**

Run: `npm run test:assembly -- --testPathPattern=user-data-service`
Expected: All tests PASS (establishes baseline)

**Step 3: Commit**

```bash
git add tests/assembly/user-data-service.assembly.test.mjs
git commit -m "test(user-data): add UserDataService assembly tests

Establishes baseline behavior before refactoring to use io.mjs."
```

---

## Task 7: Refactor UserDataService to Use io.mjs

**Files:**
- Modify: `backend/lib/config/UserDataService.mjs`

**Step 1: Update imports**

Change the imports at the top of the file:

FROM:
```javascript
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { configService } from './ConfigService.mjs';
import { createLogger } from '../logging/logger.js';
```

TO:
```javascript
import fs from 'fs';
import path from 'path';
import { configService } from './ConfigService.mjs';
import { createLogger } from '../logging/logger.js';
import { loadFile, saveFile } from '../io.mjs';
```

**Step 2: Remove safeReadYaml and safeWriteYaml functions**

Delete lines 26-70 (the safeReadYaml and safeWriteYaml functions).

**Step 3: Create internal helper to convert absolute to relative paths**

Add after the logger creation:

```javascript
/**
 * Convert absolute path to relative path for io.mjs
 * io.mjs expects paths relative to process.env.path.data
 */
const toRelativePath = (absolutePath) => {
  const dataDir = configService.getDataDir() || process.env.path?.data;
  if (!dataDir) return null;
  if (absolutePath.startsWith(dataDir)) {
    return absolutePath.slice(dataDir.length).replace(/^[/\\]+/, '');
  }
  return absolutePath;
};

/**
 * Read YAML file using io.mjs (with write queue protection on saves)
 */
const readYaml = (absolutePath) => {
  const relativePath = toRelativePath(absolutePath);
  if (!relativePath) return null;
  // Strip .yml/.yaml extension - io.mjs adds it back
  const pathWithoutExt = relativePath.replace(/\.(ya?ml)$/, '');
  return loadFile(pathWithoutExt);
};

/**
 * Write YAML file using io.mjs (with write queue for concurrency safety)
 */
const writeYaml = (absolutePath, data) => {
  const relativePath = toRelativePath(absolutePath);
  if (!relativePath) return false;
  const pathWithoutExt = relativePath.replace(/\.(ya?ml)$/, '');
  return saveFile(pathWithoutExt, data);
};
```

**Step 4: Update readHouseholdSharedData to use readYaml**

Change the `readHouseholdSharedData` method:

FROM:
```javascript
readHouseholdSharedData(householdId, dataPath) {
  let fullPath = this.getHouseholdSharedPath(householdId, dataPath);
  if (!fullPath) return null;

  // Add extension if not present - prefer .yml, fallback to .yaml
  if (!fullPath.match(/\.(ya?ml|json)$/)) {
    if (fs.existsSync(fullPath + '.yml')) {
      fullPath += '.yml';
    } else if (fs.existsSync(fullPath + '.yaml')) {
      fullPath += '.yaml';
    } else {
      fullPath += '.yml';
    }
  }

  return safeReadYaml(fullPath);
}
```

TO:
```javascript
readHouseholdSharedData(householdId, dataPath) {
  let fullPath = this.getHouseholdSharedPath(householdId, dataPath);
  if (!fullPath) return null;

  // Add extension for existence check, but readYaml handles extension stripping
  if (!fullPath.match(/\.(ya?ml|json)$/)) {
    fullPath += '.yml';
  }

  return readYaml(fullPath);
}
```

**Step 5: Update writeHouseholdSharedData to use writeYaml**

FROM:
```javascript
writeHouseholdSharedData(householdId, dataPath, data) {
  let fullPath = this.getHouseholdSharedPath(householdId, dataPath);
  if (!fullPath) return false;

  if (!fullPath.match(/\.(ya?ml|json)$/)) {
    fullPath += '.yml';
  }

  return safeWriteYaml(fullPath, data);
}
```

TO:
```javascript
writeHouseholdSharedData(householdId, dataPath, data) {
  let fullPath = this.getHouseholdSharedPath(householdId, dataPath);
  if (!fullPath) return false;

  if (!fullPath.match(/\.(ya?ml|json)$/)) {
    fullPath += '.yml';
  }

  return writeYaml(fullPath, data);
}
```

**Step 6: Update readHouseholdAppData**

FROM:
```javascript
readHouseholdAppData(householdId, appName, dataPath) {
  let fullPath = this.getHouseholdAppPath(householdId, appName, dataPath);
  if (!fullPath) return null;

  if (!fullPath.match(/\.(ya?ml|json)$/)) {
    if (fs.existsSync(fullPath + '.yml')) {
      fullPath += '.yml';
    } else if (fs.existsSync(fullPath + '.yaml')) {
      fullPath += '.yaml';
    } else {
      fullPath += '.yml';
    }
  }

  return safeReadYaml(fullPath);
}
```

TO:
```javascript
readHouseholdAppData(householdId, appName, dataPath) {
  let fullPath = this.getHouseholdAppPath(householdId, appName, dataPath);
  if (!fullPath) return null;

  if (!fullPath.match(/\.(ya?ml|json)$/)) {
    fullPath += '.yml';
  }

  return readYaml(fullPath);
}
```

**Step 7: Update writeHouseholdAppData**

FROM:
```javascript
writeHouseholdAppData(householdId, appName, dataPath, data) {
  let fullPath = this.getHouseholdAppPath(householdId, appName, dataPath);
  if (!fullPath) return false;

  if (!fullPath.match(/\.(ya?ml|json)$/)) {
    fullPath += '.yml';
  }

  return safeWriteYaml(fullPath, data);
}
```

TO:
```javascript
writeHouseholdAppData(householdId, appName, dataPath, data) {
  let fullPath = this.getHouseholdAppPath(householdId, appName, dataPath);
  if (!fullPath) return false;

  if (!fullPath.match(/\.(ya?ml|json)$/)) {
    fullPath += '.yml';
  }

  return writeYaml(fullPath, data);
}
```

**Step 8: Update readUserData**

FROM:
```javascript
readUserData(username, dataPath) {
  let fullPath = this.getUserDataPath(username, dataPath);
  if (!fullPath) return null;

  // Add extension if not present - prefer .yml, fallback to .yaml
  if (!fullPath.match(/\.(ya?ml|json)$/)) {
    if (fs.existsSync(fullPath + '.yml')) {
      fullPath += '.yml';
    } else if (fs.existsSync(fullPath + '.yaml')) {
      fullPath += '.yaml';
    } else {
      fullPath += '.yml'; // Default
    }
  }

  return safeReadYaml(fullPath);
}
```

TO:
```javascript
readUserData(username, dataPath) {
  let fullPath = this.getUserDataPath(username, dataPath);
  if (!fullPath) return null;

  if (!fullPath.match(/\.(ya?ml|json)$/)) {
    fullPath += '.yml';
  }

  return readYaml(fullPath);
}
```

**Step 9: Update writeUserData**

FROM:
```javascript
writeUserData(username, dataPath, data) {
  let fullPath = this.getUserDataPath(username, dataPath);
  if (!fullPath) return false;

  // Add extension if not present
  if (!fullPath.match(/\.(ya?ml|json)$/)) {
    fullPath += '.yml';
  }

  return safeWriteYaml(fullPath, data);
}
```

TO:
```javascript
writeUserData(username, dataPath, data) {
  let fullPath = this.getUserDataPath(username, dataPath);
  if (!fullPath) return false;

  if (!fullPath.match(/\.(ya?ml|json)$/)) {
    fullPath += '.yml';
  }

  return writeYaml(fullPath, data);
}
```

**Step 10: Update readLegacyData**

FROM:
```javascript
readLegacyData(legacyPath, username = null) {
  // ... existing code ...
  if (fs.existsSync(legacyPathWithExt)) {
    // Log deprecation warning once per path
    if (!deprecationWarnings.has(legacyPath)) {
      deprecationWarnings.add(legacyPath);
      logger.warn('user-data.legacy-path-used', {
        legacyPath,
        message: `Legacy path "${legacyPath}" used - migrate to user-namespaced path`,
        suggestedPath: username ? `users/${username}/${legacyPath}` : `users/{username}/${legacyPath}`
      });
    }
    return safeReadYaml(legacyPathWithExt);
  }

  return null;
}
```

TO:
```javascript
readLegacyData(legacyPath, username = null) {
  // Try user-namespaced first if username provided
  if (username) {
    const userData = this.readUserData(username, legacyPath);
    if (userData !== null) {
      return userData;
    }
  }

  // Fall back to legacy path using io.mjs loadFile
  // (io.mjs handles deprecation warnings internally)
  return loadFile(legacyPath);
}
```

**Step 11: Update migrateData to use writeYaml**

In the `migrateData` method, change the read call:

FROM:
```javascript
const data = safeReadYaml(sourcePath);
```

TO:
```javascript
const data = readYaml(sourcePath);
```

**Step 12: Verify syntax**

Run: `node --check backend/lib/config/UserDataService.mjs`
Expected: No output (syntax OK)

**Step 13: Run tests**

Run: `npm run test:assembly -- --testPathPattern=user-data-service`
Expected: All tests PASS

**Step 14: Commit**

```bash
git add backend/lib/config/UserDataService.mjs
git commit -m "refactor(user-data): use io.mjs for YAML operations

UserDataService now uses io.mjs's loadFile/saveFile internally.
Benefits:
- Write queue prevents concurrent write corruption
- Flow sequences for prettier YAML output
- Circular reference protection
- Consistent path translation and deprecation warnings"
```

---

## Task 8: Integration Test - Full Stack Verification

**Files:**
- None (verification only)

**Step 1: Run all assembly tests**

Run: `npm run test:assembly`
Expected: All tests PASS

**Step 2: Check dev server starts**

Run: `npm run dev` (in background, check logs)
Expected: Server starts without errors

**Step 3: Commit documentation update**

```bash
git add docs/_wip/audits/2026-01-06-safeReadYaml-consolidation-analysis.md
git commit -m "docs: add safeReadYaml consolidation analysis

Documents the architectural decisions behind the YAML reading layers:
- bootstrap-yaml.mjs for pre-env config loading
- io.mjs for runtime data with write queue protection"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `backend/lib/config/UserService.mjs` | Delete dead `safeReadYaml` and unused imports |
| `backend/lib/bootstrap-yaml.mjs` | NEW - Shared bootstrap YAML reader |
| `backend/lib/logging/config.js` | Use `bootstrapReadYaml` from shared utility |
| `backend/lib/config/ConfigService.mjs` | Use `bootstrapReadYaml` from shared utility |
| `backend/lib/config/UserDataService.mjs` | Use `io.mjs` for all YAML operations |
| `tests/assembly/bootstrap-yaml.assembly.test.mjs` | NEW - Tests for bootstrap utility |
| `tests/assembly/config-service.assembly.test.mjs` | NEW - Tests for ConfigService |
| `tests/assembly/user-data-service.assembly.test.mjs` | NEW - Tests for UserDataService |

## Architecture After Consolidation

```
                    ┌─────────────────────────┐
                    │    bootstrap-yaml.mjs   │
                    │  (pre-env, returns {})  │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 │
   ┌──────────────────┐ ┌──────────────────┐     │
   │ logging/config.js│ │ ConfigService.mjs│     │
   │   (bootstrap)    │ │   (bootstrap)    │     │
   └──────────────────┘ └──────────────────┘     │
                                                  │
                    ┌─────────────────────────┐   │
                    │       io.mjs            │   │
                    │  (runtime, write queue) │◄──┘
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │  UserDataService.mjs    │
                    │      (runtime)          │
                    └─────────────────────────┘
```
