# Entry Point ConfigService Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the 3 remaining legacy config files by migrating entry points to use ConfigService directly.

**Architecture:** Move UserService to the new config location, simplify entry points (index.js, server.mjs, app.mjs) to use `initConfigService(dataDir)` instead of the legacy pathResolver + loader pattern, then delete the legacy files.

**Tech Stack:** Node.js ES Modules, ConfigService

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | Move UserService to new location | 2 create, 1 modify |
| 2 | Simplify backend/index.js | 1 modify |
| 3 | Simplify backend/src/server.mjs | 1 modify |
| 4 | Simplify backend/src/app.mjs | 1 modify |
| 5 | Delete legacy files | 3 delete |
| 6 | Final verification | 0 |

---

## Task 1: Move UserService to New Location

**Files:**
- Copy: `backend/_legacy/lib/config/UserService.mjs` → `backend/src/0_infrastructure/config/UserService.mjs`
- Modify: `backend/src/0_infrastructure/config/index.mjs`

**Step 1: Check if UserService already exists in new location**

Run: `ls -la backend/src/0_infrastructure/config/UserService.mjs`

If it exists, skip to Step 3. If not, continue to Step 2.

**Step 2: Copy UserService to new location**

The file already uses ConfigService internally. Update the import path:

```javascript
/**
 * UserService - User Profile and Resolution
 *
 * Handles:
 * - Loading user profiles from data/users/{id}/profile.yml
 * - Hydrating fitness users (resolving IDs to full profiles)
 * - Platform identity resolution
 */

import { configService } from './index.mjs';

// Note: Logger import needs to be updated if moving from legacy
// For now, use console.warn as fallback
const logger = {
  warn: (msg, data) => console.warn(`[UserService] ${msg}`, data || '')
};

class UserService {
  #configService = null;

  constructor(cfgService = configService) {
    this.#configService = cfgService;
  }

  /**
   * Get a user profile by username
   * @param {string} username
   * @returns {object|null}
   */
  getProfile(username) {
    return this.#configService.getUserProfile(username);
  }

  /**
   * Get all user profiles
   * @returns {Map<string, object>}
   */
  getAllProfiles() {
    return this.#configService.getAllUserProfiles();
  }

  /**
   * Hydrate a list of user IDs into full user objects
   * Combines profile data with any inline data provided
   *
   * @param {Array<string|object>} userList - List of user IDs (strings) or inline objects
   * @param {object} [deviceMappings] - Optional device->user mappings to attach HR device
   * @returns {Array<object>} - Fully hydrated user objects
   */
  hydrateUsers(userList, deviceMappings = {}) {
    if (!Array.isArray(userList)) return [];

    return userList.map(entry => {
      // If it's already a full object (inline definition), return as-is
      if (typeof entry === 'object' && entry !== null) {
        return entry;
      }

      // It's a string ID - load from profile
      const username = String(entry);
      const profile = this.getProfile(username);

      if (!profile) {
        // No profile found - return minimal object
        logger.warn('user.profile_not_found', { username });
        return { id: username, name: username };
      }

      // Build hydrated user object
      const hydrated = {
        id: profile.username || username,
        profileId: profile.username || username,
        name: profile.display_name || profile.username || username,
        birthyear: profile.birthyear,
        group_label: profile.group_label,
      };

      // Add fitness-specific data if available
      const fitnessConfig = profile.apps?.fitness;
      if (fitnessConfig) {
        if (fitnessConfig.heart_rate_zones) {
          hydrated.zones = fitnessConfig.heart_rate_zones;
        }
        if (fitnessConfig.max_heart_rate) {
          hydrated.max_heart_rate = fitnessConfig.max_heart_rate;
        }
        if (fitnessConfig.resting_heart_rate) {
          hydrated.resting_heart_rate = fitnessConfig.resting_heart_rate;
        }
      }

      // Attach HR device ID if mapped
      if (deviceMappings.heart_rate) {
        for (const [deviceId, userId] of Object.entries(deviceMappings.heart_rate)) {
          if (userId === username) {
            hydrated.hr = parseInt(deviceId, 10);
            break;
          }
        }
      }

      return hydrated;
    }).filter(Boolean);
  }

  /**
   * Hydrate fitness config - replaces primary user IDs with full profiles
   * While preserving family/friends as inline definitions
   *
   * @param {object} fitnessConfig - Raw fitness config
   * @param {string} [householdId] - Optional household ID
   * @returns {object} - Hydrated fitness config
   */
  hydrateFitnessConfig(fitnessConfig, householdId = null) {
    if (!fitnessConfig) return fitnessConfig;

    const hydrated = { ...fitnessConfig };
    const deviceMappings = fitnessConfig.devices || {};

    // Hydrate users
    if (fitnessConfig.users) {
      hydrated.users = { ...fitnessConfig.users };

      // Primary users are IDs - hydrate them from profiles
      if (Array.isArray(fitnessConfig.users.primary)) {
        hydrated.users.primary = this.hydrateUsers(
          fitnessConfig.users.primary,
          deviceMappings
        );
      }

      // Family and friends stay as-is (inline definitions)
      if (Array.isArray(fitnessConfig.users.family)) {
        hydrated.users.family = fitnessConfig.users.family.map(user => ({
          ...user,
          id: user.id || user.name?.toLowerCase().replace(/\s+/g, '_'),
        }));
      }

      if (Array.isArray(fitnessConfig.users.friends)) {
        hydrated.users.friends = fitnessConfig.users.friends.map(user => ({
          ...user,
          id: user.id || user.name?.toLowerCase().replace(/\s+/g, '_'),
        }));
      }
    }

    // Convert device mappings to legacy format for backwards compatibility
    if (fitnessConfig.devices && fitnessConfig.device_colors) {
      hydrated.ant_devices = {
        ...fitnessConfig.ant_devices,
        hr: fitnessConfig.device_colors.heart_rate || {},
        cadence: fitnessConfig.device_colors.cadence || {},
      };
    }

    return hydrated;
  }

  /**
   * Resolve a username from a platform identity
   * @param {string} platform - Platform name (telegram, garmin, etc.)
   * @param {string} platformId - Platform user ID
   * @returns {string|null}
   */
  resolveFromPlatform(platform, platformId) {
    return this.#configService.resolveUsername(platform, platformId);
  }
}

// Singleton instance
export const userService = new UserService();

export { UserService };
export default userService;
```

**Step 3: Export UserService from config index**

Add to `backend/src/0_infrastructure/config/index.mjs`:

```javascript
// Add this export near the other exports
export { userService, UserService } from './UserService.mjs';
```

**Step 4: Verify module loads**

Run: `node -e "import('./backend/src/0_infrastructure/config/index.mjs').then(m => console.log('userService:', typeof m.userService))"`

Expected: `userService: object`

**Step 5: Commit**

```bash
git add backend/src/0_infrastructure/config/UserService.mjs backend/src/0_infrastructure/config/index.mjs
git commit -m "feat(config): add UserService to new config location

Moves user hydration logic to the new ConfigService location.
UserService already used ConfigService internally."
```

---

## Task 2: Simplify backend/index.js

**Files:**
- Modify: `backend/index.js`

**Step 1: Read current file to understand structure**

Run: `head -80 backend/index.js`

**Step 2: Update imports**

Remove:
```javascript
import { resolveConfigPaths, getConfigFilePaths } from './_legacy/lib/config/pathResolver.mjs';
import { loadAllConfig } from './_legacy/lib/config/loader.mjs';
import { initConfigService as initLegacyConfigService, ConfigValidationError as LegacyConfigValidationError } from './_legacy/lib/config/index.mjs';
```

Add:
```javascript
import { existsSync } from 'fs';
import { initConfigService, configService, ConfigValidationError } from './src/0_infrastructure/config/index.mjs';
```

**Step 3: Simplify bootstrap logic**

Replace the config resolution block with:

```javascript
// Detect Docker environment
const isDocker = existsSync('/.dockerenv');

// Get data directory from environment
const dataDir = isDocker
  ? '/usr/src/app/data'
  : process.env.DAYLIGHT_DATA_PATH;

if (!dataDir) {
  console.error('[Bootstrap] DAYLIGHT_DATA_PATH not set. Cannot start.');
  process.exit(1);
}

// Initialize ConfigService (loads all YAML configs)
try {
  initConfigService(dataDir);
  console.log(`[Bootstrap] ConfigService initialized from ${dataDir}`);
} catch (err) {
  if (err instanceof ConfigValidationError) {
    console.error('[Bootstrap] Config validation failed:', err.message);
  } else {
    console.error('[Bootstrap] Failed to load config:', err.message);
  }
  process.exit(1);
}
```

**Step 4: Remove any remaining loadAllConfig calls**

Search for `loadAllConfig` and remove or replace with ConfigService methods.

**Step 5: Test startup**

Run: `node backend/index.js`

Expected: Server starts (or fails on unrelated issues)

**Step 6: Commit**

```bash
git add backend/index.js
git commit -m "refactor(bootstrap): simplify index.js to use ConfigService directly

- Remove pathResolver and loader imports
- Use initConfigService(dataDir) for all config loading
- Inline isDocker detection (one line)"
```

---

## Task 3: Simplify backend/src/server.mjs

**Files:**
- Modify: `backend/src/server.mjs`

**Step 1: Read current imports**

Run: `head -40 backend/src/server.mjs`

**Step 2: Update imports**

Remove:
```javascript
import { resolveConfigPaths, getConfigFilePaths } from '../_legacy/lib/config/pathResolver.mjs';
```

The file should already import from ConfigService. If not, add:
```javascript
import { configService } from './0_infrastructure/config/index.mjs';
```

**Step 3: Replace resolveConfigPaths usage**

Find where `resolveConfigPaths` is called and replace:

Before:
```javascript
const configPaths = resolveConfigPaths({ isDocker, codebaseDir });
const { configDir, dataDir } = configPaths;
```

After:
```javascript
// ConfigService already initialized by index.js
const dataDir = configService.getDataDir();
const configDir = configService.getConfigDir();
```

**Step 4: Replace any process.env.PORT with ConfigService**

Change:
```javascript
const port = process.env.PORT || 3111;
```

To:
```javascript
const port = configService.getPort();
```

**Step 5: Replace process.env.LOGGLY_* with ConfigService**

Change:
```javascript
const logglySubdomain = process.env.LOGGLY_SUBDOMAIN || process.env.LOGGLY_SUB_DOMAIN;
```

To:
```javascript
const logglySubdomain = configService.getSecret('LOGGLY_SUBDOMAIN');
```

**Step 6: Test server startup**

Run: `node backend/index.js`

Expected: Server starts

**Step 7: Commit**

```bash
git add backend/src/server.mjs
git commit -m "refactor(server): remove legacy pathResolver, use ConfigService

- Get paths from configService.getDataDir()/getConfigDir()
- Get port from configService.getPort()
- Get secrets from configService.getSecret()"
```

---

## Task 4: Simplify backend/src/app.mjs

**Files:**
- Modify: `backend/src/app.mjs`

**Step 1: Update imports**

Remove:
```javascript
import { loadAllConfig, logConfigSummary } from '../_legacy/lib/config/loader.mjs';
import { userService } from '../_legacy/lib/config/UserService.mjs';
```

Add/update:
```javascript
import { configService, userService } from './0_infrastructure/config/index.mjs';
```

**Step 2: Remove loadAllConfig call**

Find the `loadAllConfig` call (around line 128) and remove it. ConfigService is already initialized by index.js before createApp is called.

**Step 3: Remove logConfigSummary call**

Remove any `logConfigSummary(configResult)` calls.

**Step 4: Verify userService usage still works**

The `userService` is passed to the fitness router. Ensure the import path is updated but usage remains the same:

```javascript
// In createFitnessRouter call
createFitnessRouter({
  // ...
  userService,  // Now imported from new location
  // ...
})
```

**Step 5: Test app startup**

Run: `node backend/index.js`

Expected: Server starts, fitness routes work

**Step 6: Commit**

```bash
git add backend/src/app.mjs
git commit -m "refactor(app): remove legacy loader, import userService from new location

- ConfigService already initialized by bootstrap
- userService now comes from src/0_infrastructure/config/"
```

---

## Task 5: Delete Legacy Files

**Files:**
- Delete: `backend/_legacy/lib/config/pathResolver.mjs`
- Delete: `backend/_legacy/lib/config/loader.mjs`
- Delete: `backend/_legacy/lib/config/UserService.mjs`

**Step 1: Verify no remaining imports**

Run: `grep -r "pathResolver\|loader\.mjs\|UserService" backend/ --include="*.mjs" --include="*.js" | grep -v node_modules | grep "_legacy/lib/config"`

Expected: No matches (or only the files we're about to delete)

**Step 2: Delete the files**

```bash
rm backend/_legacy/lib/config/pathResolver.mjs
rm backend/_legacy/lib/config/loader.mjs
rm backend/_legacy/lib/config/UserService.mjs
```

**Step 3: Check what's left in legacy config**

Run: `ls backend/_legacy/lib/config/`

Expected: Only `index.mjs` (the re-export shim)

**Step 4: Run tests**

Run: `npm test`

Expected: Tests pass (or fail on unrelated issues)

**Step 5: Commit**

```bash
git add -A backend/_legacy/lib/config/
git commit -m "chore: delete legacy pathResolver, loader, UserService

All entry points now use ConfigService directly.
Only the re-export shim remains in _legacy/lib/config/."
```

---

## Task 6: Final Verification

**Step 1: Verify no legacy config imports remain (except shim)**

Run: `grep -r "_legacy/lib/config" backend/ --include="*.mjs" --include="*.js" | grep -v "index.mjs"`

Expected: No matches

**Step 2: Verify server starts**

Run: `node backend/index.js`

Expected: Server starts without errors

**Step 3: Verify ConfigService is SSOT**

Run: `grep -rn "process\.env\." backend/src/ --include="*.mjs" | grep -v "DAYLIGHT_DATA_PATH\|DAYLIGHT_ENV\|NODE_ENV" | head -20`

Document any remaining process.env usages for future cleanup (adapters, harvesters).

**Step 4: Update legacy shim to warn about deleted files**

If any code still tries to import the deleted files, the error will be clear. No action needed.

**Step 5: Summary commit (if any final cleanup)**

```bash
git add -A
git commit -m "chore: entry point ConfigService migration complete"
```

---

## Verification Checklist

After all tasks:

- [ ] `backend/_legacy/lib/config/` contains only `index.mjs`
- [ ] No imports of `pathResolver`, `loader`, or `UserService` from legacy location
- [ ] Server starts with `node backend/index.js`
- [ ] `userService` works (fitness config hydration)
- [ ] All tests pass (or fail on unrelated issues)

## Follow-up Work (Out of Scope)

These remain for future cleanup:
- Adapter process.env usages (PlexProxy, Immich, etc.)
- Harvester process.env usages (timezone, auth fallbacks)
- Chatbot subsystem legacy config usage
