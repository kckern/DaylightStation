# ConfigService Redesign

## Problem

The current config system has two overlapping classes (ConfigService and ConfigProvider) with 60+ methods, 63% of which are never called. Both classes contain:

- Dual-source fallback chains that obscure the source of truth
- Hardcoded magic values masquerading as defaults
- Synchronous file I/O scattered throughout runtime code
- Broken patterns like `process.env.path?.data` (env vars are flat strings)
- Business logic mixed with config access

Testing requires mocking file systems or singleton state. Debugging config issues requires tracing through multiple fallback paths.

## Solution

Replace both classes with a single ConfigService that:

1. Loads all config at startup from the file system
2. Validates against a schema (fail fast)
3. Serves from memory (no runtime I/O)
4. Accepts config via constructor (testable)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Startup                              │
│  index.js calls initConfigService(dataDir)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      configLoader.mjs                        │
│  Reads YAML files from disk, assembles config object        │
│  - data/system/system.yml                                   │
│  - data/system/secrets.yml                                  │
│  - data/households/*/household.yml                          │
│  - data/users/*/profile.yml                                 │
│  - data/users/*/auth/*.yml                                  │
│  - data/households/*/auth/*.yml                             │
│  - data/system/apps/*.yml                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    configValidator.mjs                       │
│  Checks config against schema                               │
│  Throws ConfigValidationError if invalid                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     ConfigService.mjs                        │
│  Pure class - receives config object via constructor        │
│  All methods are simple property lookups                    │
│  No I/O, no fallbacks, no side effects                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Singleton                             │
│  configService export for convenient imports                │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

Create these files in `backend/lib/config/v2/`:

```
backend/lib/config/v2/
├── ConfigService.mjs      # Pure config accessor class
├── configLoader.mjs       # File I/O, assembles config object
├── configValidator.mjs    # Schema validation
├── configSchema.mjs       # Schema definition
└── index.mjs              # Factory, singleton, exports
```

## Data Directory Structure

The loader expects this structure:

```
data/
├── system/
│   ├── system.yml              # System-wide settings
│   ├── secrets.yml             # API keys, tokens
│   └── apps/
│       ├── chatbots.yml        # App-specific config
│       └── fitness.yml
├── households/
│   └── {householdId}/
│       ├── household.yml       # Household config (head, users, timezone)
│       └── auth/
│           ├── plex.yml        # Household service credentials
│           └── homeassistant.yml
└── users/
    └── {username}/
        ├── profile.yml         # User profile
        └── auth/
            ├── strava.yml      # User service credentials
            └── withings.yml
```

---

## Implementation Details

### 1. ConfigService.mjs

The core class. Pure data accessor with no I/O.

```javascript
// backend/lib/config/v2/ConfigService.mjs

/**
 * Pure configuration accessor.
 * Receives pre-loaded, validated config via constructor.
 * All methods are simple property lookups - no I/O, no fallbacks.
 */
export class ConfigService {
  #config;

  constructor(config) {
    this.#config = Object.freeze(config);
  }

  // ─── Secrets ───────────────────────────────────────────────

  getSecret(key) {
    return this.#config.secrets?.[key] ?? null;
  }

  // ─── Households ────────────────────────────────────────────

  getDefaultHouseholdId() {
    return this.#config.system.defaultHouseholdId;
  }

  getHeadOfHousehold(householdId = null) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households[hid]?.head ?? null;
  }

  getHouseholdUsers(householdId) {
    return this.#config.households[householdId]?.users ?? [];
  }

  getHouseholdTimezone(householdId) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households[hid]?.timezone
        ?? this.#config.system.timezone;
  }

  // ─── Users ─────────────────────────────────────────────────

  getUserProfile(username) {
    return this.#config.users[username] ?? null;
  }

  getAllUserProfiles() {
    return new Map(Object.entries(this.#config.users));
  }

  resolveUsername(platform, platformId) {
    return this.#config.identityMappings?.[platform]?.[String(platformId)] ?? null;
  }

  // ─── Auth ──────────────────────────────────────────────────

  getUserAuth(service, username = null) {
    const user = username ?? this.getHeadOfHousehold();
    if (!user) return null;
    return this.#config.auth.users?.[user]?.[service] ?? null;
  }

  getHouseholdAuth(service, householdId = null) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.auth.households?.[hid]?.[service] ?? null;
  }

  // ─── Apps ──────────────────────────────────────────────────

  getAppConfig(appName, pathStr = null) {
    const config = this.#config.apps[appName] ?? null;
    if (!pathStr || !config) return config;
    return resolvePath(config, pathStr);
  }

  // ─── Paths ─────────────────────────────────────────────────

  getDataDir() {
    return this.#config.system.dataDir;
  }

  getUserDir(username) {
    return `${this.#config.system.dataDir}/users/${username}`;
  }

  getConfigDir() {
    return this.#config.system.configDir;
  }

  // ─── Convenience ───────────────────────────────────────────

  isReady() {
    return true;  // Always ready - validated at construction
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function resolvePath(obj, pathStr) {
  const parts = pathStr.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return null;
    current = current[part];
  }
  return current ?? null;
}

export default ConfigService;
```

### 2. configSchema.mjs

Declares required vs optional fields.

```javascript
// backend/lib/config/v2/configSchema.mjs

/**
 * Config schema definition.
 *
 * Structure:
 *   required: true/false - fail validation if missing
 *   type: 'string' | 'array' | 'object' | 'map'
 *   default: value to use if missing (only for required: false)
 *   properties: nested schema for objects
 *   valueSchema: schema for map values
 */
export const configSchema = {
  system: {
    required: true,
    type: 'object',
    properties: {
      dataDir: { required: true, type: 'string' },
      configDir: { required: true, type: 'string' },
      defaultHouseholdId: { required: true, type: 'string' },
      timezone: { required: false, type: 'string', default: 'America/Los_Angeles' },
    }
  },

  secrets: {
    required: true,
    type: 'object',
    properties: {
      OPENAI_API_KEY: { required: true, type: 'string' },
      TELEGRAM_NUTRIBOT_TOKEN: { required: false, type: 'string' },
      TELEGRAM_JOURNALIST_BOT_TOKEN: { required: false, type: 'string' },
    }
  },

  households: {
    required: true,
    type: 'map',
    minSize: 1,
    valueSchema: {
      head: { required: true, type: 'string' },
      users: { required: true, type: 'array' },
      timezone: { required: false, type: 'string' },
    }
  },

  users: {
    required: true,
    type: 'map',
    minSize: 1,
    // User profiles are flexible - validated only for existence
  },

  auth: {
    required: true,
    type: 'object',
    properties: {
      users: { required: false, type: 'map' },
      households: { required: false, type: 'map' },
    }
  },

  apps: {
    required: false,
    type: 'map',
  },

  identityMappings: {
    required: false,
    type: 'map',
  },
};

export default configSchema;
```

### 3. configLoader.mjs

Reads files from disk, assembles config object.

```javascript
// backend/lib/config/v2/configLoader.mjs

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * Load all config from the data directory.
 * Returns a unified config object ready for validation.
 *
 * @param {string} dataDir - Path to data directory
 * @returns {object} Unified config object
 */
export function loadConfig(dataDir) {
  const config = {
    system: loadSystemConfig(dataDir),
    secrets: loadSecrets(dataDir),
    households: loadAllHouseholds(dataDir),
    users: loadAllUsers(dataDir),
    auth: loadAllAuth(dataDir),
    apps: loadAllApps(dataDir),
    identityMappings: {},
  };

  // Build identity mappings from user profiles
  config.identityMappings = buildIdentityMappings(config.users);

  return config;
}

// ─── System ──────────────────────────────────────────────────

function loadSystemConfig(dataDir) {
  const systemPath = path.join(dataDir, 'system', 'system.yml');
  const systemYml = readYaml(systemPath) ?? {};

  return {
    dataDir,
    configDir: path.join(dataDir, 'system'),
    defaultHouseholdId: systemYml.households?.default ?? 'default',
    timezone: systemYml.timezone ?? 'America/Los_Angeles',
  };
}

// ─── Secrets ─────────────────────────────────────────────────

function loadSecrets(dataDir) {
  const secretsPath = path.join(dataDir, 'system', 'secrets.yml');
  return readYaml(secretsPath) ?? {};
}

// ─── Households ──────────────────────────────────────────────

function loadAllHouseholds(dataDir) {
  const householdsDir = path.join(dataDir, 'households');
  const households = {};

  for (const hid of listDirs(householdsDir)) {
    const configPath = path.join(householdsDir, hid, 'household.yml');
    const config = readYaml(configPath);
    if (config) {
      households[hid] = config;
    }
  }

  return households;
}

// ─── Users ───────────────────────────────────────────────────

function loadAllUsers(dataDir) {
  const usersDir = path.join(dataDir, 'users');
  const users = {};

  for (const username of listDirs(usersDir)) {
    const profilePath = path.join(usersDir, username, 'profile.yml');
    const profile = readYaml(profilePath);
    if (profile) {
      users[username] = profile;
    }
  }

  return users;
}

// ─── Auth ────────────────────────────────────────────────────

function loadAllAuth(dataDir) {
  return {
    users: loadUserAuth(dataDir),
    households: loadHouseholdAuth(dataDir),
  };
}

function loadUserAuth(dataDir) {
  const usersDir = path.join(dataDir, 'users');
  const auth = {};

  for (const username of listDirs(usersDir)) {
    const authDir = path.join(usersDir, username, 'auth');
    if (!fs.existsSync(authDir)) continue;

    auth[username] = {};
    for (const file of listYamlFiles(authDir)) {
      const service = path.basename(file, '.yml');
      const creds = readYaml(file);
      if (creds) {
        auth[username][service] = creds;
      }
    }
  }

  return auth;
}

function loadHouseholdAuth(dataDir) {
  const householdsDir = path.join(dataDir, 'households');
  const auth = {};

  for (const hid of listDirs(householdsDir)) {
    const authDir = path.join(householdsDir, hid, 'auth');
    if (!fs.existsSync(authDir)) continue;

    auth[hid] = {};
    for (const file of listYamlFiles(authDir)) {
      const service = path.basename(file, '.yml');
      const creds = readYaml(file);
      if (creds) {
        auth[hid][service] = creds;
      }
    }
  }

  return auth;
}

// ─── Apps ────────────────────────────────────────────────────

function loadAllApps(dataDir) {
  const appsDir = path.join(dataDir, 'system', 'apps');
  const apps = {};

  for (const file of listYamlFiles(appsDir)) {
    const appName = path.basename(file, '.yml');
    const config = readYaml(file);
    if (config) {
      apps[appName] = config;
    }
  }

  return apps;
}

// ─── Identity Mappings ───────────────────────────────────────

function buildIdentityMappings(users) {
  const mappings = {};

  for (const [username, profile] of Object.entries(users)) {
    const identities = profile.identities ?? {};

    for (const [platform, data] of Object.entries(identities)) {
      const platformId = data.user_id ?? data.id;
      if (platformId) {
        mappings[platform] ??= {};
        mappings[platform][String(platformId)] = username;
      }
    }
  }

  return mappings;
}

// ─── File Helpers ────────────────────────────────────────────

function readYaml(filePath) {
  if (!fs.existsSync(filePath)) return null;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) ?? null;
  } catch (err) {
    console.error(`Failed to parse ${filePath}: ${err.message}`);
    return null;
  }
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir).filter(name => {
    if (name.startsWith('.') || name.startsWith('_') || name === 'example') {
      return false;
    }
    return fs.statSync(path.join(dir, name)).isDirectory();
  });
}

function listYamlFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => (f.endsWith('.yml') || f.endsWith('.yaml')) && !f.startsWith('.'))
    .map(f => path.join(dir, f));
}

export default loadConfig;
```

### 4. configValidator.mjs

Validates config against schema, throws on failure.

```javascript
// backend/lib/config/v2/configValidator.mjs

import { configSchema } from './configSchema.mjs';

/**
 * Error thrown when config validation fails.
 * Contains structured error list and checked file paths.
 */
export class ConfigValidationError extends Error {
  constructor(errors, checkedPaths = []) {
    super(formatErrors(errors, checkedPaths));
    this.name = 'ConfigValidationError';
    this.errors = errors;
    this.checkedPaths = checkedPaths;
  }
}

/**
 * Validate config object against schema.
 * Throws ConfigValidationError if invalid.
 *
 * @param {object} config - Config object from loader
 * @param {string} dataDir - Data directory (for error messages)
 * @returns {object} The validated config (unchanged)
 */
export function validateConfig(config, dataDir) {
  const errors = [];
  const checkedPaths = [
    `${dataDir}/system/system.yml`,
    `${dataDir}/system/secrets.yml`,
  ];

  // Validate system section
  if (!config.system) {
    errors.push({ path: 'system', message: 'missing required section' });
  } else {
    validateObject(config.system, configSchema.system.properties, 'system', errors);
  }

  // Validate secrets section
  if (!config.secrets) {
    errors.push({ path: 'secrets', message: 'missing required section' });
  } else {
    validateObject(config.secrets, configSchema.secrets.properties, 'secrets', errors);
  }

  // Validate households
  if (!config.households || Object.keys(config.households).length === 0) {
    errors.push({ path: 'households', message: 'at least one household required' });
  } else {
    for (const [hid, household] of Object.entries(config.households)) {
      checkedPaths.push(`${dataDir}/households/${hid}/household.yml`);
      validateObject(household, configSchema.households.valueSchema, `households.${hid}`, errors);
    }
  }

  // Validate users exist
  if (!config.users || Object.keys(config.users).length === 0) {
    errors.push({ path: 'users', message: 'at least one user required' });
  }

  // Cross-reference: default household exists
  const defaultHid = config.system?.defaultHouseholdId;
  if (defaultHid && config.households && !config.households[defaultHid]) {
    errors.push({
      path: 'system.defaultHouseholdId',
      message: `references '${defaultHid}' but household does not exist`,
    });
  }

  // Cross-reference: household users exist
  for (const [hid, household] of Object.entries(config.households ?? {})) {
    for (const username of household.users ?? []) {
      if (!config.users?.[username]) {
        errors.push({
          path: `households.${hid}.users`,
          message: `references user '${username}' but no profile found`,
        });
        checkedPaths.push(`${dataDir}/users/${username}/profile.yml`);
      }
    }
  }

  // Cross-reference: household head is in users list
  for (const [hid, household] of Object.entries(config.households ?? {})) {
    if (household.head && household.users && !household.users.includes(household.head)) {
      errors.push({
        path: `households.${hid}.head`,
        message: `head '${household.head}' is not in users list`,
      });
    }
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(errors, checkedPaths);
  }

  return config;
}

// ─── Helpers ─────────────────────────────────────────────────

function validateObject(obj, schema, pathPrefix, errors) {
  if (!schema) return;

  for (const [key, rules] of Object.entries(schema)) {
    const fullPath = `${pathPrefix}.${key}`;
    const value = obj?.[key];

    // Check required
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push({ path: fullPath, message: 'required but missing' });
      continue;
    }

    // Skip type check if value is missing and not required
    if (value === undefined || value === null) continue;

    // Check type
    if (rules.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (rules.type !== 'map' && actualType !== rules.type) {
        errors.push({ path: fullPath, message: `expected ${rules.type}, got ${actualType}` });
      }
    }
  }
}

function formatErrors(errors, checkedPaths) {
  const lines = ['Config validation failed:', ''];

  for (const err of errors) {
    lines.push(`  ✗ ${err.path}: ${err.message}`);
  }

  if (checkedPaths.length > 0) {
    lines.push('', 'Checked locations:');
    for (const p of [...new Set(checkedPaths)]) {
      lines.push(`  - ${p}`);
    }
  }

  return lines.join('\n');
}

export default validateConfig;
```

### 5. index.mjs

Factory, singleton, and exports.

```javascript
// backend/lib/config/v2/index.mjs

import { ConfigService } from './ConfigService.mjs';
import { loadConfig } from './configLoader.mjs';
import { validateConfig, ConfigValidationError } from './configValidator.mjs';

let instance = null;

/**
 * Create a ConfigService from files on disk.
 * Loads config, validates against schema, returns service instance.
 *
 * @param {string} dataDir - Path to data directory
 * @returns {ConfigService}
 * @throws {ConfigValidationError} If config is invalid
 */
export function createConfigService(dataDir) {
  const config = loadConfig(dataDir);
  validateConfig(config, dataDir);
  return new ConfigService(config);
}

/**
 * Initialize the singleton instance.
 * Call once at application startup.
 *
 * @param {string} dataDir - Path to data directory
 * @returns {ConfigService}
 * @throws {Error} If already initialized
 * @throws {ConfigValidationError} If config is invalid
 */
export function initConfigService(dataDir) {
  if (instance) {
    throw new Error('ConfigService already initialized');
  }
  instance = createConfigService(dataDir);
  return instance;
}

/**
 * Get the singleton instance.
 *
 * @returns {ConfigService}
 * @throws {Error} If not yet initialized
 */
export function getConfigService() {
  if (!instance) {
    throw new Error(
      'ConfigService not initialized. Call initConfigService(dataDir) at startup.'
    );
  }
  return instance;
}

/**
 * Convenience proxy for direct import.
 *
 * Usage:
 *   import { configService } from './config/v2/index.mjs';
 *   const key = configService.getSecret('API_KEY');
 */
export const configService = new Proxy({}, {
  get(_, prop) {
    return getConfigService()[prop];
  }
});

/**
 * Reset singleton instance.
 * For testing only - allows re-initialization.
 */
export function resetConfigService() {
  instance = null;
}

/**
 * Create ConfigService directly from config object.
 * For testing - skips file I/O and validation.
 *
 * @param {object} config - Pre-built config object
 * @returns {ConfigService}
 */
export function createTestConfigService(config) {
  return new ConfigService(config);
}

// Re-exports
export { ConfigService } from './ConfigService.mjs';
export { ConfigValidationError } from './configValidator.mjs';
export { configSchema } from './configSchema.mjs';

export default configService;
```

---

## Migration Plan

### Phase 1: Add New Implementation

**Goal:** Create new implementation alongside existing code. No breaking changes.

**Files to create:**
- `backend/lib/config/v2/ConfigService.mjs`
- `backend/lib/config/v2/configLoader.mjs`
- `backend/lib/config/v2/configValidator.mjs`
- `backend/lib/config/v2/configSchema.mjs`
- `backend/lib/config/v2/index.mjs`

**Tests to write:**
- `backend/lib/config/v2/__tests__/ConfigService.test.mjs`
- `backend/lib/config/v2/__tests__/configLoader.test.mjs`
- `backend/lib/config/v2/__tests__/configValidator.test.mjs`

**Validation:**
1. Run loader against production data directory
2. Confirm all current config values are loaded correctly
3. Compare output of new methods vs old methods

### Phase 2: Wire Up Startup

**Goal:** Initialize new ConfigService at app startup. Old code still works.

**Changes:**

```javascript
// backend/index.js

import { initConfigService } from './lib/config/v2/index.mjs';

// Early in startup, before other imports that need config
const dataDir = process.env.DAYLIGHT_DATA_PATH || '/data';
try {
  initConfigService(dataDir);
  console.log('ConfigService initialized');
} catch (err) {
  console.error('Config validation failed:');
  console.error(err.message);
  process.exit(1);
}
```

**Validation:**
1. App starts successfully with valid config
2. App fails to start with invalid config (missing secrets, etc.)
3. Error message clearly identifies what's missing

### Phase 3: Migrate Consumers

**Goal:** Update all imports from old ConfigService to new.

**Migration pattern:**

```javascript
// Before
import { configService } from '../lib/config/ConfigService.mjs';
import { getConfigProvider } from '../chatbots/_lib/config/ConfigProvider.mjs';

// After
import { configService } from '../lib/config/v2/index.mjs';
```

**Files to migrate (52 total):**

| Domain | Files | Priority |
|--------|-------|----------|
| Core lib | 24 files in `lib/` | High - most usage |
| Routers | 8 files in `routers/` | High |
| Chatbots | 6 files in `chatbots/` | Medium |
| Jobs | 2 files in `jobs/` | Low |
| Scripts | 3 files in `scripts/` | Low |
| API | `api.mjs` | High |
| Startup | `index.js` | Done in Phase 2 |

**Method mapping:**

| Old Method | New Method | Notes |
|------------|------------|-------|
| `configService.getDefaultHouseholdId()` | Same | No change |
| `configService.getHeadOfHousehold()` | Same | No change |
| `configService.getUserAuth(svc, user)` | Same | No change |
| `configService.getHouseholdAuth(svc, hid)` | Same | No change |
| `configService.getSecret(key)` | Same | No change |
| `configService.getUserProfile(user)` | Same | No change |
| `configService.getAllUserProfiles()` | Same | No change |
| `configService.getAppConfig(app, path)` | Same | No change |
| `configService.getDataDir()` | Same | No change |
| `configService.isReady()` | Same | Always returns true |
| `configProvider.getTelegramToken(bot)` | `configService.getSecret('TELEGRAM_..._TOKEN')` | See below |
| `configProvider.getOpenAIKey()` | `configService.getSecret('OPENAI_API_KEY')` | Direct secret access |
| `configProvider.getBotConfig(name)` | `configService.getAppConfig('chatbots', 'bots.' + name)` | Via app config |

**ConfigProvider method migrations:**

```javascript
// getTelegramToken('nutribot')
// Before
const token = configProvider.getTelegramToken('nutribot');

// After
const token = configService.getSecret('TELEGRAM_NUTRIBOT_TOKEN');

// getBotConfig('journalist')
// Before
const config = configProvider.getBotConfig('journalist');

// After
const botConfig = configService.getAppConfig('chatbots', 'bots.journalist');
const config = {
  name: 'journalist',
  telegramBotId: botConfig.telegram_bot_id,
  token: configService.getSecret('TELEGRAM_JOURNALIST_BOT_TOKEN'),
  webhookUrl: botConfig.webhooks?.[env] ?? '',
};
```

**Strategy:**
1. Migrate one domain at a time
2. Test after each file
3. Create small PRs (5-10 files each)

### Phase 4: Delete Old Code

**Goal:** Remove deprecated code once all consumers migrated.

**Files to delete:**
- `backend/lib/config/ConfigService.mjs` (old version)
- `backend/lib/config/UserDataService.mjs` (if unused)
- `backend/chatbots/_lib/config/ConfigProvider.mjs`

**Cleanup:**
- Move `v2/` contents up to `config/`
- Update all imports to remove `/v2`
- Delete `v2/` directory

---

## Testing

### Unit Tests for ConfigService

```javascript
// backend/lib/config/v2/__tests__/ConfigService.test.mjs

import { createTestConfigService } from '../index.mjs';

const mockConfig = {
  system: {
    dataDir: '/data',
    configDir: '/data/system',
    defaultHouseholdId: 'home',
    timezone: 'America/Los_Angeles',
  },
  secrets: {
    OPENAI_API_KEY: 'sk-test-key',
    TELEGRAM_NUTRIBOT_TOKEN: 'bot-token',
  },
  households: {
    home: {
      head: 'alice',
      users: ['alice', 'bob'],
      timezone: 'America/New_York',
    },
  },
  users: {
    alice: { name: 'Alice', identities: { telegram: { user_id: '12345' } } },
    bob: { name: 'Bob' },
  },
  auth: {
    users: {
      alice: { strava: { token: 'strava-token' } },
    },
    households: {
      home: { plex: { token: 'plex-token' } },
    },
  },
  apps: {
    chatbots: { bots: { nutribot: { telegram_bot_id: '999' } } },
  },
  identityMappings: {
    telegram: { '12345': 'alice' },
  },
};

describe('ConfigService', () => {
  let svc;

  beforeEach(() => {
    svc = createTestConfigService(mockConfig);
  });

  describe('secrets', () => {
    test('returns secret by key', () => {
      expect(svc.getSecret('OPENAI_API_KEY')).toBe('sk-test-key');
    });

    test('returns null for missing secret', () => {
      expect(svc.getSecret('MISSING_KEY')).toBeNull();
    });
  });

  describe('households', () => {
    test('returns default household id', () => {
      expect(svc.getDefaultHouseholdId()).toBe('home');
    });

    test('returns head of household', () => {
      expect(svc.getHeadOfHousehold()).toBe('alice');
      expect(svc.getHeadOfHousehold('home')).toBe('alice');
    });

    test('returns household users', () => {
      expect(svc.getHouseholdUsers('home')).toEqual(['alice', 'bob']);
    });

    test('returns household timezone with fallback', () => {
      expect(svc.getHouseholdTimezone('home')).toBe('America/New_York');
    });
  });

  describe('users', () => {
    test('returns user profile', () => {
      expect(svc.getUserProfile('alice').name).toBe('Alice');
    });

    test('returns null for missing user', () => {
      expect(svc.getUserProfile('unknown')).toBeNull();
    });

    test('resolves username from platform identity', () => {
      expect(svc.resolveUsername('telegram', '12345')).toBe('alice');
      expect(svc.resolveUsername('telegram', '99999')).toBeNull();
    });
  });

  describe('auth', () => {
    test('returns user auth', () => {
      expect(svc.getUserAuth('strava', 'alice').token).toBe('strava-token');
    });

    test('returns household auth', () => {
      expect(svc.getHouseholdAuth('plex', 'home').token).toBe('plex-token');
    });

    test('uses head of household as default user', () => {
      expect(svc.getUserAuth('strava').token).toBe('strava-token');
    });
  });

  describe('apps', () => {
    test('returns full app config', () => {
      expect(svc.getAppConfig('chatbots').bots.nutribot.telegram_bot_id).toBe('999');
    });

    test('returns nested app config by path', () => {
      expect(svc.getAppConfig('chatbots', 'bots.nutribot.telegram_bot_id')).toBe('999');
    });
  });
});
```

### Integration Test with Fixtures

```javascript
// backend/lib/config/v2/__tests__/integration.test.mjs

import { createConfigService } from '../index.mjs';
import path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

describe('ConfigService integration', () => {
  test('loads config from fixtures directory', () => {
    const svc = createConfigService(fixturesDir);

    expect(svc.getDefaultHouseholdId()).toBe('test-household');
    expect(svc.getHeadOfHousehold()).toBe('testuser');
    expect(svc.getSecret('TEST_API_KEY')).toBe('test-key-value');
  });
});
```

### Test Fixtures Structure

```
backend/lib/config/v2/__tests__/fixtures/
├── system/
│   ├── system.yml
│   ├── secrets.yml
│   └── apps/
│       └── chatbots.yml
├── households/
│   └── test-household/
│       └── household.yml
└── users/
    └── testuser/
        └── profile.yml
```

---

## Appendix: Unused Methods to Delete

### ConfigService (old) - 20 methods never called

- `getLegacyConfig()`
- `getSystem()`
- `isInitialized()`
- `getDefaultHouseholdConfig()`
- `listHouseholds()`
- `getUserAppConfig()`
- `getHouseholdAppConfig()`
- `getState()`
- `getMergedHouseholdAppConfig()`
- `writeHouseholdState()`
- `getLifelogPath()`
- `getUserAuthPath()`
- `listUsers()`
- `getSystemConfigDir()`
- `getSystemStateDir()`
- `getAppsDefaultsDir()`
- `getHouseholdDir()`
- `getHouseholdStateDir()`
- `getHouseholdAppDir()`
- `getContentDir()`

### ConfigProvider - 17 methods never called

- `getUser()`
- `getInternalUserId()`
- `getAllUsers()`
- `getUserGoals()`
- `getTimezone()`
- `getEnvironment()`
- `isProduction()`
- `getAppConfig()`
- `getNutribotDataPath()`
- `getTelegramWebhookUrl()`
- `getNutritionixCredentials()`
- `getEdamamCredentials()`
- `getUPCiteKey()`
- `getMySQLConfig()`
- `getRawAppConfig()`
- `getNutritionGoals()`
- `#deepMerge()` (private)

---

## Related Code

- Current: `backend/lib/config/ConfigService.mjs`
- Current: `backend/chatbots/_lib/config/ConfigProvider.mjs`
- Startup: `backend/index.js`
- Usage audit: See Phase 3 migration list
