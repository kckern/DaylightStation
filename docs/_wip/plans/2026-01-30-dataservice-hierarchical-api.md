# DataService Hierarchical API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `UserDataService` with a hierarchical `DataService` that provides namespaced read/write methods with sensible defaults.

**Architecture:** Create `DataService` with three sub-objects (`user`, `household`, `system`) each exposing `read(path, id?)` and `write(path, data, id?)`. Path is always first (required), scope identifier is second (optional with defaults from ConfigService).

**Tech Stack:** Node.js ES Modules, js-yaml, ConfigService for defaults

---

## API Design

```javascript
// New hierarchical API
dataService.user.read('lifelog/nutrition', username?)      // defaults to head of household
dataService.user.write('lifelog/nutrition', data, username?)
dataService.household.read('shared/weather', hid?)         // defaults to main household
dataService.household.write('shared/weather', data, hid?)
dataService.system.read('state/cron-runtime')              // no default needed
dataService.system.write('state/cron-runtime', data)
```

## File Paths

| Scope | Base Path | Example Full Path |
|-------|-----------|-------------------|
| user | `{dataDir}/users/{username}/` | `data/users/kenny/lifelog/nutrition.yml` |
| household | `{dataDir}/household[-{hid}]/` | `data/household/common/weather.yml` |
| system | `{dataDir}/system/` | `data/system/state/cron-runtime.yml` |

---

### Task 1: Create DataService Core

**Files:**
- Create: `backend/src/0_system/config/DataService.mjs`
- Test: `tests/unit/suite/config/DataService.test.mjs`

**Step 1: Write the failing test for DataService structure**

```javascript
// tests/unit/suite/config/DataService.test.mjs
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

describe('DataService', () => {
  describe('structure', () => {
    it('should have user, household, and system sub-objects', async () => {
      const { DataService } = await import('#system/config/DataService.mjs');

      const mockConfigService = {
        getDataDir: () => '/tmp/test-data',
        getDefaultHouseholdId: () => 'default',
        getHeadOfHousehold: () => 'kenny'
      };

      const ds = new DataService({ configService: mockConfigService });

      expect(ds.user).toBeDefined();
      expect(ds.household).toBeDefined();
      expect(ds.system).toBeDefined();
      expect(typeof ds.user.read).toBe('function');
      expect(typeof ds.user.write).toBe('function');
      expect(typeof ds.household.read).toBe('function');
      expect(typeof ds.household.write).toBe('function');
      expect(typeof ds.system.read).toBe('function');
      expect(typeof ds.system.write).toBe('function');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=DataService.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal DataService implementation**

```javascript
// backend/src/0_system/config/DataService.mjs
/**
 * DataService - Hierarchical Data Persistence
 *
 * Provides namespaced read/write for three scopes:
 * - user: Per-user data (lifelog, auth, apps)
 * - household: Shared household data (weather, gratitude)
 * - system: Global system data (cron state, job config)
 *
 * Path is always first param, scope identifier is optional second param
 * with sensible defaults from ConfigService.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class DataService {
  #configService;
  #dataDir;

  constructor({ configService }) {
    if (!configService) {
      throw new InfrastructureError('DataService requires configService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'configService'
      });
    }
    this.#configService = configService;
    this.#dataDir = configService.getDataDir();

    // Bind sub-objects
    this.user = {
      read: this.#readUser.bind(this),
      write: this.#writeUser.bind(this)
    };
    this.household = {
      read: this.#readHousehold.bind(this),
      write: this.#writeHousehold.bind(this)
    };
    this.system = {
      read: this.#readSystem.bind(this),
      write: this.#writeSystem.bind(this)
    };
  }

  // ─── Internal Helpers ───────────────────────────────────────

  #resolvePath(basePath) {
    let resolved = basePath;
    if (!resolved.match(/\.(ya?ml|json)$/)) {
      resolved += '.yml';
    }
    return resolved;
  }

  #readYaml(absolutePath) {
    try {
      if (!fs.existsSync(absolutePath)) return null;
      const content = fs.readFileSync(absolutePath, 'utf8');
      return yaml.load(content) || null;
    } catch (err) {
      return null;
    }
  }

  #writeYaml(absolutePath, data) {
    try {
      const dir = path.dirname(absolutePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const content = yaml.dump(data, { lineWidth: -1, quotingType: '"' });
      fs.writeFileSync(absolutePath, content, 'utf8');
      return true;
    } catch (err) {
      return false;
    }
  }

  // ─── User Scope ─────────────────────────────────────────────

  #readUser(relativePath, username) {
    const user = username ?? this.#configService.getHeadOfHousehold();
    if (!user) return null;
    const fullPath = this.#resolvePath(
      path.join(this.#dataDir, 'users', user, relativePath)
    );
    return this.#readYaml(fullPath);
  }

  #writeUser(relativePath, data, username) {
    const user = username ?? this.#configService.getHeadOfHousehold();
    if (!user) return false;
    const fullPath = this.#resolvePath(
      path.join(this.#dataDir, 'users', user, relativePath)
    );
    return this.#writeYaml(fullPath, data);
  }

  // ─── Household Scope ────────────────────────────────────────

  #readHousehold(relativePath, householdId) {
    const hid = householdId ?? this.#configService.getDefaultHouseholdId();
    const folderName = hid === 'default' ? 'household' : `household-${hid}`;
    const fullPath = this.#resolvePath(
      path.join(this.#dataDir, folderName, relativePath)
    );
    return this.#readYaml(fullPath);
  }

  #writeHousehold(relativePath, data, householdId) {
    const hid = householdId ?? this.#configService.getDefaultHouseholdId();
    const folderName = hid === 'default' ? 'household' : `household-${hid}`;
    const fullPath = this.#resolvePath(
      path.join(this.#dataDir, folderName, relativePath)
    );
    return this.#writeYaml(fullPath, data);
  }

  // ─── System Scope ───────────────────────────────────────────

  #readSystem(relativePath) {
    const fullPath = this.#resolvePath(
      path.join(this.#dataDir, 'system', relativePath)
    );
    return this.#readYaml(fullPath);
  }

  #writeSystem(relativePath, data) {
    const fullPath = this.#resolvePath(
      path.join(this.#dataDir, 'system', relativePath)
    );
    return this.#writeYaml(fullPath, data);
  }
}

export default DataService;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=DataService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_system/config/DataService.mjs tests/unit/suite/config/DataService.test.mjs
git commit -m "feat: add DataService with hierarchical API structure"
```

---

### Task 2: Add User Scope Read/Write Tests

**Files:**
- Modify: `tests/unit/suite/config/DataService.test.mjs`

**Step 1: Write failing tests for user scope**

```javascript
  describe('user scope', () => {
    let ds;
    let testDir;

    beforeEach(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-test-'));
      fs.mkdirSync(path.join(testDir, 'users', 'kenny', 'lifelog'), { recursive: true });

      const mockConfigService = {
        getDataDir: () => testDir,
        getDefaultHouseholdId: () => 'default',
        getHeadOfHousehold: () => 'kenny'
      };

      ds = new DataService({ configService: mockConfigService });
    });

    afterEach(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should read user data with explicit username', () => {
      const testData = { items: [1, 2, 3] };
      const filePath = path.join(testDir, 'users', 'kenny', 'lifelog', 'test.yml');
      fs.writeFileSync(filePath, yaml.dump(testData));

      const result = ds.user.read('lifelog/test', 'kenny');
      expect(result).toEqual(testData);
    });

    it('should default to head of household when username omitted', () => {
      const testData = { defaultUser: true };
      const filePath = path.join(testDir, 'users', 'kenny', 'mydata.yml');
      fs.writeFileSync(filePath, yaml.dump(testData));

      const result = ds.user.read('mydata');
      expect(result).toEqual(testData);
    });

    it('should write user data and create directories', () => {
      const testData = { written: true };

      const result = ds.user.write('apps/newapp/config', testData, 'kenny');

      expect(result).toBe(true);
      const filePath = path.join(testDir, 'users', 'kenny', 'apps', 'newapp', 'config.yml');
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
```

**Step 2: Run tests**

Run: `npm test -- --testPathPattern=DataService.test.mjs`
Expected: PASS (implementation already supports this)

**Step 3: Commit**

```bash
git add tests/unit/suite/config/DataService.test.mjs
git commit -m "test: add user scope read/write tests for DataService"
```

---

### Task 3: Add Household and System Scope Tests

**Files:**
- Modify: `tests/unit/suite/config/DataService.test.mjs`

**Step 1: Write tests for household scope**

```javascript
  describe('household scope', () => {
    let ds;
    let testDir;

    beforeEach(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-test-'));
      fs.mkdirSync(path.join(testDir, 'household', 'shared'), { recursive: true });

      const mockConfigService = {
        getDataDir: () => testDir,
        getDefaultHouseholdId: () => 'default',
        getHeadOfHousehold: () => 'kenny'
      };

      ds = new DataService({ configService: mockConfigService });
    });

    afterEach(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should read from default household when hid omitted', () => {
      const testData = { weather: 'sunny' };
      const filePath = path.join(testDir, 'household', 'shared', 'weather.yml');
      fs.writeFileSync(filePath, yaml.dump(testData));

      const result = ds.household.read('shared/weather');
      expect(result).toEqual(testData);
    });

    it('should read from specific household when hid provided', () => {
      fs.mkdirSync(path.join(testDir, 'household-other', 'shared'), { recursive: true });
      const testData = { weather: 'rainy' };
      const filePath = path.join(testDir, 'household-other', 'shared', 'weather.yml');
      fs.writeFileSync(filePath, yaml.dump(testData));

      const result = ds.household.read('shared/weather', 'other');
      expect(result).toEqual(testData);
    });

    it('should write household data', () => {
      const testData = { gratitude: ['item1'] };

      const result = ds.household.write('common/gratitude', testData);

      expect(result).toBe(true);
      const filePath = path.join(testDir, 'household', 'common', 'gratitude.yml');
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
```

**Step 2: Write tests for system scope**

```javascript
  describe('system scope', () => {
    let ds;
    let testDir;

    beforeEach(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-test-'));
      fs.mkdirSync(path.join(testDir, 'system', 'state'), { recursive: true });

      const mockConfigService = {
        getDataDir: () => testDir,
        getDefaultHouseholdId: () => 'default',
        getHeadOfHousehold: () => 'kenny'
      };

      ds = new DataService({ configService: mockConfigService });
    });

    afterEach(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should read system data', () => {
      const testData = { jobs: ['job1', 'job2'] };
      const filePath = path.join(testDir, 'system', 'config', 'jobs.yml');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, yaml.dump(testData));

      const result = ds.system.read('config/jobs');
      expect(result).toEqual(testData);
    });

    it('should write system data', () => {
      const testData = { lastRun: '2026-01-30' };

      const result = ds.system.write('state/cron-runtime', testData);

      expect(result).toBe(true);
      const filePath = path.join(testDir, 'system', 'state', 'cron-runtime.yml');
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
```

**Step 3: Run tests**

Run: `npm test -- --testPathPattern=DataService.test.mjs`
Expected: PASS

**Step 4: Commit**

```bash
git add tests/unit/suite/config/DataService.test.mjs
git commit -m "test: add household and system scope tests for DataService"
```

---

### Task 4: Export DataService from Config Index

**Files:**
- Modify: `backend/src/0_system/config/index.mjs`

**Step 1: Add DataService singleton export**

Add after line 134 (after userDataService export):

```javascript
// DataService singleton with lazy initialization
import { DataService } from './DataService.mjs';

let dataServiceInstance = null;

export function getDataService() {
  if (!dataServiceInstance) {
    dataServiceInstance = new DataService({ configService: getConfigService() });
  }
  return dataServiceInstance;
}

export const dataService = new Proxy({}, {
  get(_, prop) {
    const svc = getDataService();
    const value = svc[prop];
    if (typeof value === 'function') {
      return value.bind(svc);
    }
    return value;
  }
});

export { DataService } from './DataService.mjs';
```

**Step 2: Verify syntax**

Run: `node --check backend/src/0_system/config/index.mjs`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/0_system/config/index.mjs
git commit -m "feat: export dataService singleton from config index"
```

---

### Task 5: Update YamlNutriLogDatastore to Use DataService

**Files:**
- Modify: `backend/src/2_adapters/persistence/yaml/YamlNutriLogDatastore.mjs`

**Step 1: Update imports and constructor**

Replace `userDataService` with `dataService`:

```javascript
// backend/src/2_adapters/persistence/yaml/YamlNutriLogDatastore.mjs
import { NutriLog } from '#domains/lifelog/entities/NutriLog.mjs';
import { nowTs24 } from '#system/utils/index.mjs';
import { INutriLogDatastore } from '#apps/nutribot/ports/INutriLogDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const NUTRILOG_PATH = 'lifelog/nutrition/nutrilog';

export class YamlNutriLogDatastore extends INutriLogDatastore {
  #dataService;
  #logger;

  constructor(config) {
    super();
    if (!config.dataService) {
      throw new InfrastructureError('YamlNutriLogDatastore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService'
      });
    }
    this.#dataService = config.dataService;
    this.#logger = config.logger || console;
  }

  #loadLogs(userId) {
    const data = this.#dataService.user.read(NUTRILOG_PATH, userId);
    return data || {};
  }

  #saveLogs(userId, logs) {
    const result = this.#dataService.user.write(NUTRILOG_PATH, logs, userId);
    if (!result) {
      this.#logger.error?.('nutrilog.save.failed', { userId });
    }
    return result;
  }

  // ... rest of methods unchanged
}
```

**Step 2: Verify syntax**

Run: `node --check backend/src/2_adapters/persistence/yaml/YamlNutriLogDatastore.mjs`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/2_adapters/persistence/yaml/YamlNutriLogDatastore.mjs
git commit -m "refactor: update YamlNutriLogDatastore to use dataService"
```

---

### Task 6: Update YamlJournalEntryRepository to Use DataService

**Files:**
- Modify: `backend/src/2_adapters/persistence/yaml/YamlJournalEntryRepository.mjs`

**Step 1: Update to use dataService**

Change the `#loadData` and `#saveData` methods:

```javascript
  #loadData(conversationId) {
    const { username, relativePath } = this.#getStorageInfo(conversationId);
    const data = this.#dataService.user.read(relativePath, username);
    return data || { messages: [] };
  }

  #saveData(conversationId, data) {
    const { username, relativePath } = this.#getStorageInfo(conversationId);
    const result = this.#dataService.user.write(relativePath, data, username);
    if (!result) {
      this.#logger.error?.('journal.save.failed', { username, relativePath });
    }
    return result;
  }
```

Update constructor to require `dataService` instead of `userDataService`.

**Step 2: Verify syntax**

Run: `node --check backend/src/2_adapters/persistence/yaml/YamlJournalEntryRepository.mjs`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/2_adapters/persistence/yaml/YamlJournalEntryRepository.mjs
git commit -m "refactor: update YamlJournalEntryRepository to use dataService"
```

---

### Task 7: Update YamlWeatherDatastore to Use DataService

**Files:**
- Modify: `backend/src/2_adapters/persistence/yaml/YamlWeatherDatastore.mjs`

**Step 1: Update to use dataService.household**

```javascript
export class YamlWeatherDatastore {
  #dataService;
  #householdId;
  #logger;

  constructor({ dataService, configService, householdId, logger = console }) {
    if (!dataService) {
      throw new InfrastructureError('YamlWeatherDatastore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService'
      });
    }

    this.#dataService = dataService;
    this.#householdId = householdId || configService?.getDefaultHouseholdId() || 'default';
    this.#logger = logger;
  }

  async save(data) {
    this.#logger.debug?.('weather.store.save', { householdId: this.#householdId });
    const result = this.#dataService.household.write('shared/weather', data, this.#householdId);
    if (!result) {
      this.#logger.error?.('weather.store.save.failed', { householdId: this.#householdId });
    }
    return result;
  }

  async load() {
    const data = this.#dataService.household.read('shared/weather', this.#householdId);
    if (!data) {
      this.#logger.debug?.('weather.store.load.notFound', { householdId: this.#householdId });
    }
    return data;
  }
}
```

**Step 2: Verify syntax**

Run: `node --check backend/src/2_adapters/persistence/yaml/YamlWeatherDatastore.mjs`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/2_adapters/persistence/yaml/YamlWeatherDatastore.mjs
git commit -m "refactor: update YamlWeatherDatastore to use dataService.household"
```

---

### Task 8: Update YamlStateDatastore to Use DataService

**Files:**
- Modify: `backend/src/2_adapters/scheduling/YamlStateDatastore.mjs`

**Step 1: Update to use dataService.system**

```javascript
export class YamlStateDatastore extends IStateDatastore {
  #dataService;
  #logger;

  constructor({ dataService, logger = console }) {
    super();
    if (!dataService) {
      throw new InfrastructureError('YamlStateDatastore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService'
      });
    }
    this.#dataService = dataService;
    this.#logger = logger;
  }

  loadRawState() {
    try {
      const state = this.#dataService.system.read('state/cron-runtime');
      if (state && typeof state === 'object') {
        return state;
      }

      const backup = this.#dataService.system.read('state/cron-runtime_bak');
      if (backup && typeof backup === 'object') {
        this.#logger.info?.('scheduler.stateStore.restored_from_backup');
        this.#dataService.system.write('state/cron-runtime', backup);
        return backup;
      }

      return {};
    } catch (error) {
      this.#logger.error?.('scheduler.stateStore.load_error', { error: error.message });
      return {};
    }
  }

  // ... update other methods similarly
}
```

**Step 2: Verify syntax**

Run: `node --check backend/src/2_adapters/scheduling/YamlStateDatastore.mjs`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/2_adapters/scheduling/YamlStateDatastore.mjs
git commit -m "refactor: update YamlStateDatastore to use dataService.system"
```

---

### Task 9: Update YamlJobDatastore to Use DataService

**Files:**
- Modify: `backend/src/2_adapters/scheduling/YamlJobDatastore.mjs`

**Step 1: Update to use dataService.system**

```javascript
export class YamlJobDatastore extends IJobDatastore {
  #dataService;
  #logger;
  #jobsCache = null;

  constructor({ dataService, logger = console }) {
    super();
    if (!dataService) {
      throw new InfrastructureError('YamlJobDatastore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService'
      });
    }
    this.#dataService = dataService;
    this.#logger = logger;
  }

  async loadJobs() {
    if (this.#jobsCache) {
      return this.#jobsCache;
    }

    try {
      const jobsData = this.#dataService.system.read('config/jobs');
      // ... rest unchanged
    }
  }
}
```

**Step 2: Verify syntax**

Run: `node --check backend/src/2_adapters/scheduling/YamlJobDatastore.mjs`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/2_adapters/scheduling/YamlJobDatastore.mjs
git commit -m "refactor: update YamlJobDatastore to use dataService.system"
```

---

### Task 10: Update YamlGratitudeDatastore to Use DataService

**Files:**
- Modify: `backend/src/2_adapters/persistence/yaml/YamlGratitudeDatastore.mjs`

**Step 1: Update to use dataService.household**

Replace `userDataService.readHouseholdSharedData` with `dataService.household.read`.

**Step 2: Verify syntax**

Run: `node --check backend/src/2_adapters/persistence/yaml/YamlGratitudeDatastore.mjs`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/2_adapters/persistence/yaml/YamlGratitudeDatastore.mjs
git commit -m "refactor: update YamlGratitudeDatastore to use dataService.household"
```

---

### Task 11: Update Bootstrap Factory Functions

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Import dataService**

Add to imports:
```javascript
import { dataService } from '#system/config/index.mjs';
```

**Step 2: Update factory functions**

Replace `userDataService` parameters with `dataService` in:
- `createNutribotServices`
- `createJournalingServices`
- `createHarvesterServices`
- Any other functions creating the updated datastores

**Step 3: Verify syntax**

Run: `node --check backend/src/0_system/bootstrap.mjs`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "refactor: update bootstrap factory functions to use dataService"
```

---

### Task 12: Update app.mjs Wiring

**Files:**
- Modify: `backend/src/app.mjs`

**Step 1: Import dataService**

Add to imports:
```javascript
import { dataService } from './0_system/config/index.mjs';
```

**Step 2: Update datastore instantiation**

Replace all `userDataService` usages with `dataService` where datastores are created.

**Step 3: Run full test suite**

Run: `npm test`
Expected: Same pass/fail count as before (no regressions)

**Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "refactor: update app.mjs to use dataService"
```

---

### Task 13: Fix YamlMessageQueueRepository (Bug Fix)

**Files:**
- Modify: `backend/src/2_adapters/persistence/yaml/YamlMessageQueueRepository.mjs`

This file has the same bug as YamlJournalEntryRepository - calling non-existent methods `readData`/`writeData`.

**Step 1: Update to use dataService.user**

```javascript
  #loadData(conversationId) {
    const username = this.#getUsername(conversationId);
    const data = this.#dataService.user.read('apps/journalist/queue', username);
    return data || { queue: [] };
  }

  #saveData(conversationId, data) {
    const username = this.#getUsername(conversationId);
    return this.#dataService.user.write('apps/journalist/queue', data, username);
  }
```

**Step 2: Verify syntax**

Run: `node --check backend/src/2_adapters/persistence/yaml/YamlMessageQueueRepository.mjs`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/2_adapters/persistence/yaml/YamlMessageQueueRepository.mjs
git commit -m "fix: update YamlMessageQueueRepository to use dataService (was calling non-existent methods)"
```

---

### Task 14: Update YamlHealthDatastore

**Files:**
- Modify: `backend/src/2_adapters/persistence/yaml/YamlHealthDatastore.mjs`

**Step 1: Update to use dataService.user**

Replace `userDataService.readUserData` with `dataService.user.read`.

**Step 2: Verify syntax**

Run: `node --check backend/src/2_adapters/persistence/yaml/YamlHealthDatastore.mjs`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/2_adapters/persistence/yaml/YamlHealthDatastore.mjs
git commit -m "refactor: update YamlHealthDatastore to use dataService"
```

---

### Task 15: Deprecate UserDataService

**Files:**
- Modify: `backend/src/0_system/config/UserDataService.mjs`

**Step 1: Add deprecation notice**

Add at top of file:
```javascript
/**
 * @deprecated Use DataService instead. This service will be removed in a future version.
 * Migration:
 *   userDataService.readUserData(user, path) → dataService.user.read(path, user)
 *   userDataService.writeUserData(user, path, data) → dataService.user.write(path, data, user)
 *   userDataService.readHouseholdSharedData(hid, path) → dataService.household.read(path, hid)
 *   userDataService.readSystemData(path) → dataService.system.read(path)
 */
```

**Step 2: Commit**

```bash
git add backend/src/0_system/config/UserDataService.mjs
git commit -m "deprecate: mark UserDataService as deprecated in favor of DataService"
```

---

### Task 16: Run Full Test Suite and Verify

**Step 1: Run tests**

Run: `npm test`
Expected: Same pass/fail count as baseline (72 failed, 90 passed)

**Step 2: Verify syntax on all modified files**

Run: `node --check backend/src/app.mjs && node --check backend/src/0_system/bootstrap.mjs`
Expected: No errors

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete DataService migration with hierarchical API"
```

---

## Summary

| Old API | New API |
|---------|---------|
| `userDataService.readUserData(user, path)` | `dataService.user.read(path, user?)` |
| `userDataService.writeUserData(user, path, data)` | `dataService.user.write(path, data, user?)` |
| `userDataService.readHouseholdSharedData(hid, path)` | `dataService.household.read(path, hid?)` |
| `userDataService.writeHouseholdSharedData(hid, path, data)` | `dataService.household.write(path, data, hid?)` |
| `userDataService.readSystemData(path)` | `dataService.system.read(path)` |
| `userDataService.writeSystemData(path, data)` | `dataService.system.write(path, data)` |

Path first, scope identifier second (optional with sensible defaults).
