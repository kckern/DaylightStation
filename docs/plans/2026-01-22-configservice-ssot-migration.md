# ConfigService SSOT Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `backend/src/0_infrastructure/config/` the single source of truth. Deprecate and remove `backend/_legacy/lib/config/`.

**Architecture:** All config access flows through the new ConfigService. Tests use `createTestConfigService()` from the new location. Legacy config module becomes a re-export shim during transition, then gets deleted.

**Tech Stack:** Node.js, Vitest, ES Modules

---

## Summary

| Phase | Tasks | Files Changed |
|-------|-------|---------------|
| 1 | Create test fixtures for ConfigService | 3 |
| 2 | Migrate tests to new ConfigService | 22 |
| 3 | Convert legacy config to re-export shim | 1 |
| 4 | Remove process.env spreading | 6 |
| 5 | Delete legacy config | 12 |

---

## Task 1: Create Test Config Fixture

**Files:**
- Create: `tests/_fixtures/config/testConfig.mjs`
- Create: `tests/_fixtures/config/mockConfigs.mjs`

**Step 1: Create test config helper**

```javascript
// tests/_fixtures/config/testConfig.mjs
/**
 * Test Configuration Helper
 *
 * Provides ConfigService instances for tests without touching real config files.
 * Uses DAYLIGHT_DATA_PATH if available, otherwise uses mock config.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import {
  createTestConfigService,
  initConfigService,
  resetConfigService,
  configService
} from '#backend/src/0_infrastructure/config/index.mjs';
import { defaultMockConfig } from './mockConfigs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Initialize ConfigService for integration tests.
 * Uses DAYLIGHT_DATA_PATH env var to find real config.
 *
 * @returns {ConfigService}
 * @throws {Error} If DAYLIGHT_DATA_PATH not set
 */
export function initTestConfigService() {
  const dataDir = process.env.DAYLIGHT_DATA_PATH;
  if (!dataDir) {
    throw new Error(
      'DAYLIGHT_DATA_PATH not set. Required for integration tests.\n' +
      'Set it in .env or use createMockConfigService() for unit tests.'
    );
  }

  if (configService.isReady()) {
    resetConfigService();
  }

  return initConfigService(dataDir);
}

/**
 * Create a mock ConfigService for unit tests.
 * No file I/O - uses provided config or defaults.
 *
 * @param {object} overrides - Config overrides merged with defaults
 * @returns {ConfigService}
 */
export function createMockConfigService(overrides = {}) {
  const config = deepMerge(defaultMockConfig, overrides);
  return createTestConfigService(config);
}

/**
 * Reset ConfigService singleton.
 * Call in afterEach() to ensure test isolation.
 */
export { resetConfigService };

/**
 * Get the ConfigService singleton proxy.
 * Throws if not initialized.
 */
export { configService };

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] ?? {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
```

**Step 2: Create mock config defaults**

```javascript
// tests/_fixtures/config/mockConfigs.mjs
/**
 * Mock Config Objects for Tests
 *
 * Provides realistic config structures for unit tests.
 */

export const defaultMockConfig = {
  system: {
    dataDir: '/test/data',
    configDir: '/test/data/system',
    mediaDir: '/test/media',
    env: 'test',
    defaultHouseholdId: 'test-household',
    timezone: 'UTC',
    server: {
      port: 3333
    },
    paths: {
      media: '/test/media',
      watchState: '/test/data/history/media_memory',
      img: '/test/media/img'
    },
    scheduler: {
      enabled: false
    }
  },
  secrets: {
    OPENAI_API_KEY: 'test-openai-key',
    LOGGLY_TOKEN: null,
    LOGGLY_SUBDOMAIN: null
  },
  households: {
    'test-household': {
      head: 'test-user',
      users: ['test-user'],
      timezone: 'UTC'
    }
  },
  users: {
    'test-user': {
      name: 'Test User',
      household_id: 'test-household'
    }
  },
  auth: {
    users: {
      'test-user': {
        strava: { client_id: 'test-strava-id' },
        withings: { client_id: 'test-withings-id' }
      }
    },
    households: {
      'test-household': {
        plex: { token: 'test-plex-token', server_url: 'http://localhost:32400' },
        homeassistant: { token: 'test-ha-token', host: 'http://localhost:8123' }
      }
    }
  },
  apps: {},
  identityMappings: {}
};

/**
 * Config with Plex configured
 */
export const plexMockConfig = {
  ...defaultMockConfig,
  auth: {
    ...defaultMockConfig.auth,
    households: {
      'test-household': {
        plex: {
          token: 'test-plex-token',
          server_url: 'http://localhost:32400'
        }
      }
    }
  }
};

/**
 * Config with multiple users
 */
export const multiUserMockConfig = {
  ...defaultMockConfig,
  users: {
    'alice': { name: 'Alice', household_id: 'test-household' },
    'bob': { name: 'Bob', household_id: 'test-household' },
    'charlie': { name: 'Charlie', household_id: 'test-household' }
  },
  households: {
    'test-household': {
      head: 'alice',
      users: ['alice', 'bob', 'charlie'],
      timezone: 'America/Los_Angeles'
    }
  }
};
```

**Step 3: Run existing tests to verify no regressions**

Run: `npm test -- --run tests/unit/suite/infrastructure/config/`
Expected: All existing ConfigService tests pass

**Step 4: Commit**

```bash
git add tests/_fixtures/config/
git commit -m "test(config): add test fixtures for ConfigService

- testConfig.mjs: helpers for init/mock ConfigService
- mockConfigs.mjs: default mock configs for unit tests

Prepares for migration from legacy config to new ConfigService."
```

---

## Task 2: Update testServer.mjs to Use New ConfigService

**Files:**
- Modify: `tests/integration/suite/api/_utils/testServer.mjs`

**Step 1: Update imports**

Change:
```javascript
import {
  initConfigService,
  resetConfigService,
  configService
} from '#backend/_legacy/lib/config/index.mjs';
import { resolveConfigPaths } from '#backend/_legacy/lib/config/pathResolver.mjs';
```

To:
```javascript
import {
  initConfigService,
  resetConfigService,
  configService
} from '#backend/src/0_infrastructure/config/index.mjs';
```

**Step 2: Simplify loadTestConfig to use DAYLIGHT_DATA_PATH directly**

Replace the `loadTestConfig` function:

```javascript
export async function loadTestConfig() {
  const yaml = await import('js-yaml');

  // Use DAYLIGHT_DATA_PATH directly (no pathResolver needed)
  const dataPath = process.env.DAYLIGHT_DATA_PATH;

  if (!dataPath) {
    throw new Error(
      'TEST CONFIG ERROR: DAYLIGHT_DATA_PATH not set.\n' +
      'Add it to your .env file.'
    );
  }

  if (!fs.existsSync(dataPath)) {
    throw new Error(
      `TEST CONFIG ERROR: Data path does not exist: ${dataPath}\n` +
      'Ensure the path is correct and accessible.'
    );
  }

  // Load system-local.yml for local overrides
  const envName = process.env.DAYLIGHT_ENV;
  let localConfig = {};
  if (envName) {
    const localPath = path.join(dataPath, 'system', `system-local.${envName}.yml`);
    if (fs.existsSync(localPath)) {
      localConfig = yaml.load(fs.readFileSync(localPath, 'utf8')) || {};
    }
  }

  // Get media path from local config or default
  const mediaPath = localConfig.paths?.media || path.join(dataPath, '../media');

  // Initialize ConfigService
  if (configService.isReady()) {
    resetConfigService();
  }
  initConfigService(dataPath);

  // Get Plex config from ConfigService
  const plexAuth = configService.getHouseholdAuth('plex') || {};
  const plexConfig = {
    host: plexAuth.server_url || localConfig.plex?.host || null,
    token: plexAuth.token || null
  };

  return {
    mounts: {
      data: dataPath,
      media: mediaPath
    },
    plex: plexConfig,
    householdId: configService.getDefaultHouseholdId()
  };
}
```

**Step 3: Run integration tests**

Run: `npm test -- --run tests/integration/suite/api/`
Expected: PASS (or skip if Plex unavailable)

**Step 4: Commit**

```bash
git add tests/integration/suite/api/_utils/testServer.mjs
git commit -m "refactor(tests): migrate testServer to new ConfigService

- Remove dependency on legacy pathResolver
- Use DAYLIGHT_DATA_PATH directly
- Get config via ConfigService methods"
```

---

## Task 3: Migrate External Integration Tests (Batch 1)

**Files to modify (11 files):**
- `tests/integration/external/budget/budget.live.test.mjs`
- `tests/integration/external/clickup/clickup.live.test.mjs`
- `tests/integration/external/fitness/fitness.live.test.mjs`
- `tests/integration/external/foursquare/foursquare.live.test.mjs`
- `tests/integration/external/gcal/gcal.live.test.mjs`
- `tests/integration/external/github/github.live.test.mjs`
- `tests/integration/external/gmail/gmail.live.test.mjs`
- `tests/integration/external/goodreads/goodreads.live.test.mjs`
- `tests/integration/external/health/health.live.test.mjs`
- `tests/integration/external/lastfm/lastfm.live.test.mjs`
- `tests/integration/external/ldsgc/ldsgc.live.test.mjs`

**Step 1: Create sed command to update imports**

For each file, change:
```javascript
from '#backend/_legacy/lib/config/index.mjs'
```
To:
```javascript
from '#backend/src/0_infrastructure/config/index.mjs'
```

**Step 2: Run batch update**

```bash
find tests/integration/external -name "*.test.mjs" -exec sed -i \
  "s|#backend/_legacy/lib/config/index.mjs|#backend/src/0_infrastructure/config/index.mjs|g" {} \;
```

**Step 3: Verify no remaining legacy imports in batch**

Run: `grep -r "_legacy/lib/config" tests/integration/external/`
Expected: No matches

**Step 4: Run one test to verify**

Run: `npm test -- --run tests/integration/external/health/health.live.test.mjs`
Expected: PASS (or skip if service unavailable)

**Step 5: Commit**

```bash
git add tests/integration/external/
git commit -m "refactor(tests): migrate external integration tests to new ConfigService"
```

---

## Task 4: Migrate Remaining External Tests (Batch 2)

**Files to modify (7 files):**
- `tests/integration/external/letterboxd/letterboxd.live.test.mjs`
- `tests/integration/external/reddit/reddit.live.test.mjs`
- `tests/integration/external/scripture/scripture.live.test.mjs`
- `tests/integration/external/shopping/shopping.live.test.mjs`
- `tests/integration/external/strava/strava.live.test.mjs`
- `tests/integration/external/todoist/todoist.live.test.mjs`
- `tests/integration/external/weather/weather.live.test.mjs`
- `tests/integration/external/withings/withings.live.test.mjs`
- `tests/integration/external/youtube/youtube.live.test.mjs`

**Step 1: Verify batch 1 sed already handled these**

Run: `grep -r "_legacy/lib/config" tests/integration/external/`
Expected: No matches (sed in Task 3 should have caught all)

**Step 2: If any remain, update manually**

Check and fix any missed files.

**Step 3: Run all external tests**

Run: `npm test -- --run tests/integration/external/ --reporter=dot`
Expected: Tests pass or skip appropriately

**Step 4: Commit if changes made**

```bash
git add tests/integration/external/
git commit -m "refactor(tests): complete migration of external tests to new ConfigService"
```

---

## Task 5: Migrate Unit Tests

**Files:**
- Modify: `tests/unit/suite/config/ConfigService.test.mjs`

**Step 1: Update import**

Change:
```javascript
import {
  ConfigService,
  createTestConfigService,
  // ...
} from '#backend/_legacy/lib/config/index.mjs';
```

To:
```javascript
import {
  ConfigService,
  createTestConfigService,
  // ...
} from '#backend/src/0_infrastructure/config/index.mjs';
```

**Step 2: Run unit tests**

Run: `npm test -- --run tests/unit/suite/config/`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/unit/suite/config/
git commit -m "refactor(tests): migrate ConfigService unit tests to new location"
```

---

## Task 6: Convert Legacy Config to Re-export Shim

**Files:**
- Modify: `backend/_legacy/lib/config/index.mjs`

**Step 1: Replace entire file with re-exports**

```javascript
/**
 * DEPRECATED: Legacy Config Re-export Shim
 *
 * This module re-exports from the new location for backwards compatibility.
 * All new code should import from:
 *   #backend/src/0_infrastructure/config/index.mjs
 *
 * This shim will be removed in a future release.
 */

console.warn(
  '[DEPRECATION] Importing from #backend/_legacy/lib/config is deprecated.\n' +
  'Update imports to: #backend/src/0_infrastructure/config/index.mjs'
);

export {
  ConfigService,
  configService,
  createConfigService,
  initConfigService,
  getConfigService,
  resetConfigService,
  createTestConfigService,
  ConfigValidationError,
  configSchema,
  loadConfig,
  validateConfig
} from '#backend/src/0_infrastructure/config/index.mjs';

export { default } from '#backend/src/0_infrastructure/config/index.mjs';
```

**Step 2: Run all tests**

Run: `npm test`
Expected: PASS (with deprecation warnings in console)

**Step 3: Commit**

```bash
git add backend/_legacy/lib/config/index.mjs
git commit -m "refactor(config): convert legacy config to re-export shim

Imports from _legacy/lib/config now emit deprecation warning
and re-export from new location."
```

---

## Task 7: Remove process.env Spreading from server.mjs

**Files:**
- Modify: `backend/src/server.mjs`

**Step 1: Find and remove the spreading line**

Find line ~72:
```javascript
process.env = { ...process.env, isDocker, ...configResult.config };
```

Remove it entirely. The `isDocker` value should be passed explicitly where needed.

**Step 2: Pass isDocker to createApp**

Ensure `createApp` receives `isDocker` as a parameter, not via process.env.

**Step 3: Run server test**

Run: `node backend/index.js` and verify startup
Expected: Server starts without errors

**Step 4: Commit**

```bash
git add backend/src/server.mjs
git commit -m "refactor(server): remove process.env spreading

isDocker passed explicitly instead of via process.env"
```

---

## Task 8: Remove process.env Spreading from app.mjs

**Files:**
- Modify: `backend/src/app.mjs`

**Step 1: Find and remove the spreading line**

Find line ~135:
```javascript
process.env = { ...process.env, isDocker, ...configResult.config };
```

Remove it.

**Step 2: Update config access to use ConfigService**

Replace `process.env.path?.data` with `configService.getDataDir()`, etc.
(This is a larger change - see migration plan Phase 3 for full list)

**Step 3: Run server**

Run: `npm run dev` and verify startup
Expected: Server starts

**Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "refactor(app): remove process.env spreading, use ConfigService"
```

---

## Task 9: Remove process.env Spreading from Remaining Files

**Files:**
- `backend/index.js` (line ~74)
- `backend/_legacy/app.mjs` (line ~108)
- `backend/src/0_infrastructure/logging/config.js` (line ~139)

**Step 1: Update each file**

Remove the `process.env = { ...spread }` pattern from each.

**Step 2: Run tests**

Run: `npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add backend/index.js backend/_legacy/app.mjs backend/src/0_infrastructure/logging/config.js
git commit -m "refactor: remove all process.env spreading"
```

---

## Task 10: Delete Legacy Config Files

**Files to delete:**
- `backend/_legacy/lib/config/ConfigService.mjs`
- `backend/_legacy/lib/config/configLoader.mjs`
- `backend/_legacy/lib/config/configSchema.mjs`
- `backend/_legacy/lib/config/configValidator.mjs`
- `backend/_legacy/lib/config/healthcheck.mjs`
- `backend/_legacy/lib/config/init.mjs`
- `backend/_legacy/lib/config/loader.mjs`
- `backend/_legacy/lib/config/pathResolver.mjs`
- `backend/_legacy/lib/config/UserDataService.mjs`
- `backend/_legacy/lib/config/UserService.mjs`
- `backend/_legacy/lib/config/validate-production.mjs`

**Step 1: Verify no imports remain**

Run: `grep -r "from.*_legacy/lib/config" backend/ tests/ --include="*.mjs" --include="*.js" | grep -v "index.mjs"`
Expected: No matches (only index.mjs should import from legacy)

**Step 2: Delete files**

```bash
rm backend/_legacy/lib/config/ConfigService.mjs
rm backend/_legacy/lib/config/configLoader.mjs
rm backend/_legacy/lib/config/configSchema.mjs
rm backend/_legacy/lib/config/configValidator.mjs
rm backend/_legacy/lib/config/healthcheck.mjs
rm backend/_legacy/lib/config/init.mjs
rm backend/_legacy/lib/config/loader.mjs
rm backend/_legacy/lib/config/pathResolver.mjs
rm backend/_legacy/lib/config/UserDataService.mjs
rm backend/_legacy/lib/config/UserService.mjs
rm backend/_legacy/lib/config/validate-production.mjs
```

**Step 3: Run tests**

Run: `npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add -A backend/_legacy/lib/config/
git commit -m "chore: delete legacy config files

ConfigService SSOT migration complete.
All config now flows through backend/src/0_infrastructure/config/"
```

---

## Task 11: Update .env.example

**Files:**
- Modify: `.env.example`

**Step 1: Simplify to only allowed vars**

```bash
# DaylightStation Environment Configuration
#
# Only two variables are needed:

# Required: Path to data directory containing system/*.yml configs
DAYLIGHT_DATA_PATH=/path/to/data

# Optional: Environment name for system-local.{env}.yml overrides
DAYLIGHT_ENV=dev

# All other configuration (port, timezone, secrets, auth) belongs in:
# - data/system/system.yml
# - data/system/secrets.yml
# - data/system/apps/*.yml
# - data/households/*/auth/*.yml
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: update .env.example with SSOT config approach"
```

---

## Task 12: Final Verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Start dev server**

Run: `npm run dev`
Expected: Server starts without deprecation warnings

**Step 3: Verify no legacy config imports remain**

Run: `grep -r "_legacy/lib/config" --include="*.mjs" --include="*.js" .`
Expected: Only the re-export shim in `backend/_legacy/lib/config/index.mjs`

**Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: ConfigService SSOT migration complete"
```

---

## Verification Checklist

After all tasks complete:

- [ ] All tests pass
- [ ] Server starts without errors
- [ ] No deprecation warnings in normal operation
- [ ] `grep -r "process\.env\s*=" backend/` returns no spreading
- [ ] Only `DAYLIGHT_DATA_PATH` and `DAYLIGHT_ENV` read from process.env
- [ ] Legacy config directory only contains re-export shim
