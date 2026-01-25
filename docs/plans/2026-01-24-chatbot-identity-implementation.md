# Chatbot Identity Standardization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement clean separation between conversation routing and user identity resolution across the chatbot framework.

**Architecture:** ConfigLoader loads household app configs; ConfigService exposes `getHouseholdAppConfig()`; UserResolver uses ConfigService for platform→user lookups; adapters extract platformUserId; application layer uses injected UserResolver.

**Tech Stack:** Node.js ES Modules, Jest, YAML config

---

## Task 1: Create Household App Config File

**Files:**
- Create: `data/households/default/apps/chatbots.yml` (on production data mount)
- Modify: `data/system/apps/chatbots.yml` (remove identity_mappings)

**Step 1: Create household chatbots config**

Create file at `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/households/default/apps/chatbots.yml`:

```yaml
# Chatbot identity mappings for this household
# Maps platform user IDs to system usernames

identity_mappings:
  telegram:
    "575596036": kckern
```

**Step 2: Remove identity_mappings from system config**

In `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/system/apps/chatbots.yml`, remove lines 83-88:

```yaml
# DELETE THIS SECTION:
# -----------------------------------------------------------------------------
# Platform Identity Mappings
# -----------------------------------------------------------------------------
identity_mappings:
  telegram:
    "575596036": kckern
```

**Step 3: Commit data changes**

```bash
cd /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data
git add households/default/apps/chatbots.yml system/apps/chatbots.yml
git commit -m "refactor: move identity_mappings from system to household config

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add Test Fixtures for Household App Config

**Files:**
- Create: `tests/_fixtures/data/households/_test/apps/chatbots.yml`

**Step 1: Create test fixture**

```yaml
# Test chatbot identity mappings
identity_mappings:
  telegram:
    "111111111": _alice
    "222222222": _bob
  discord:
    "333333333": _alice
```

**Step 2: Commit**

```bash
git add tests/_fixtures/data/households/_test/apps/chatbots.yml
git commit -m "test: add chatbots config fixture for household app loading

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Update ConfigLoader to Load Household Apps

**Files:**
- Modify: `backend/src/0_infrastructure/config/configLoader.mjs:167-180`
- Test: `tests/unit/suite/infrastructure/config/configLoader.test.mjs` (create if needed)

**Step 1: Write the failing test**

Create `tests/unit/suite/infrastructure/config/configLoader.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '#backend/src/0_infrastructure/config/configLoader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, '../../../../_fixtures/data');

describe('configLoader', () => {
  describe('loadConfig', () => {
    it('loads household apps from households/{hid}/apps/', () => {
      const config = loadConfig(fixturesPath);

      expect(config.households._test.apps).toBeDefined();
      expect(config.households._test.apps.chatbots).toBeDefined();
      expect(config.households._test.apps.chatbots.identity_mappings).toBeDefined();
      expect(config.households._test.apps.chatbots.identity_mappings.telegram['111111111']).toBe('_alice');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/infrastructure/config/configLoader.test.mjs -v`

Expected: FAIL with "Cannot read properties of undefined (reading 'apps')" or similar

**Step 3: Implement loadHouseholdApps in configLoader.mjs**

Add after line 178 (inside `loadAllHouseholds` function):

```javascript
function loadAllHouseholds(dataDir) {
  const householdsDir = path.join(dataDir, 'households');
  const households = {};

  for (const hid of listDirs(householdsDir)) {
    const configPath = path.join(householdsDir, hid, 'household.yml');
    const config = readYaml(configPath);
    if (config) {
      households[hid] = {
        ...config,
        apps: loadHouseholdApps(householdsDir, hid),  // ADD THIS
      };
    }
  }

  return households;
}

// ADD THIS NEW FUNCTION after loadAllHouseholds:
function loadHouseholdApps(householdsDir, hid) {
  const appsDir = path.join(householdsDir, hid, 'apps');
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
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/infrastructure/config/configLoader.test.mjs -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_infrastructure/config/configLoader.mjs \
        tests/unit/suite/infrastructure/config/configLoader.test.mjs
git commit -m "feat(config): load household app configs from households/{hid}/apps/

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add getHouseholdAppConfig to ConfigService

**Files:**
- Modify: `backend/src/0_infrastructure/config/ConfigService.mjs:74-80`
- Test: `tests/unit/suite/infrastructure/config/ConfigService.test.mjs` (create if needed)

**Step 1: Write the failing test**

Create `tests/unit/suite/infrastructure/config/ConfigService.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';
import { ConfigService } from '#backend/src/0_infrastructure/config/ConfigService.mjs';

describe('ConfigService', () => {
  describe('getHouseholdAppConfig', () => {
    const mockConfig = {
      system: { defaultHouseholdId: 'default' },
      households: {
        default: {
          apps: {
            chatbots: {
              identity_mappings: {
                telegram: { '575596036': 'kckern' }
              }
            }
          }
        }
      }
    };

    it('returns household app config by name', () => {
      const service = new ConfigService(mockConfig);
      const chatbotsConfig = service.getHouseholdAppConfig('default', 'chatbots');

      expect(chatbotsConfig).toBeDefined();
      expect(chatbotsConfig.identity_mappings.telegram['575596036']).toBe('kckern');
    });

    it('uses default household when not specified', () => {
      const service = new ConfigService(mockConfig);
      const chatbotsConfig = service.getHouseholdAppConfig(null, 'chatbots');

      expect(chatbotsConfig.identity_mappings.telegram['575596036']).toBe('kckern');
    });

    it('returns null for non-existent app', () => {
      const service = new ConfigService(mockConfig);
      const result = service.getHouseholdAppConfig('default', 'nonexistent');

      expect(result).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/infrastructure/config/ConfigService.test.mjs -v`

Expected: FAIL with "service.getHouseholdAppConfig is not a function"

**Step 3: Implement getHouseholdAppConfig**

Add to `ConfigService.mjs` after `getAppConfig` method (around line 80):

```javascript
  /**
   * Get app configuration scoped to a household
   * @param {string|null} householdId - Household ID, defaults to default household
   * @param {string} appName - App name (e.g., 'chatbots', 'fitness')
   * @returns {object|null}
   */
  getHouseholdAppConfig(householdId, appName) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households?.[hid]?.apps?.[appName] ?? null;
  }
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/infrastructure/config/ConfigService.test.mjs -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_infrastructure/config/ConfigService.mjs \
        tests/unit/suite/infrastructure/config/ConfigService.test.mjs
git commit -m "feat(config): add getHouseholdAppConfig to ConfigService

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add platformUserId to TelegramChatRef

**Files:**
- Modify: `backend/src/2_adapters/telegram/TelegramChatRef.mjs:63-71`
- Test: `tests/unit/suite/adapters/telegram/TelegramChatRef.test.mjs` (create if needed)

**Step 1: Write the failing test**

Create `tests/unit/suite/adapters/telegram/TelegramChatRef.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';
import { TelegramChatRef } from '#backend/src/2_adapters/telegram/TelegramChatRef.mjs';

describe('TelegramChatRef', () => {
  describe('platformUserId', () => {
    it('returns chatId as platformUserId', () => {
      const ref = new TelegramChatRef('6898194425', '575596036');

      expect(ref.platformUserId).toBe('575596036');
    });

    it('platformUserId is independent of botId', () => {
      const ref1 = new TelegramChatRef('6898194425', '575596036');
      const ref2 = new TelegramChatRef('9999999999', '575596036');

      expect(ref1.platformUserId).toBe(ref2.platformUserId);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/adapters/telegram/TelegramChatRef.test.mjs -v`

Expected: FAIL with "ref.platformUserId is undefined"

**Step 3: Implement platformUserId getter**

Add to `TelegramChatRef.mjs` after the `chatIdNumeric` getter (around line 71):

```javascript
  /**
   * Get the platform user ID for identity resolution
   * This is the chat ID without bot context - used to look up system user
   * @returns {string}
   */
  get platformUserId() {
    return this.#chatId;
  }
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/adapters/telegram/TelegramChatRef.test.mjs -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/telegram/TelegramChatRef.mjs \
        tests/unit/suite/adapters/telegram/TelegramChatRef.test.mjs
git commit -m "feat(telegram): add platformUserId getter to TelegramChatRef

Used for identity resolution - returns chatId without bot context.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Update IInputEvent with platform and platformUserId

**Files:**
- Modify: `backend/src/2_adapters/telegram/IInputEvent.mjs:22-28,47-68`

**Step 1: Update JSDoc typedef**

Update the `IInputEvent` typedef (lines 22-28):

```javascript
/**
 * @typedef {Object} IInputEvent
 * @property {InputEventType} type - Event type
 * @property {string} conversationId - Unique conversation identifier (for routing/state)
 * @property {string} platform - Platform name (e.g., 'telegram', 'discord')
 * @property {string} platformUserId - Platform-specific user ID (for identity resolution)
 * @property {string} messageId - Message ID within conversation
 * @property {InputEventPayload} payload - Type-specific payload data
 * @property {InputEventMetadata} metadata - Sender/context metadata
 */
```

**Step 2: Update toInputEvent function signature and implementation**

Update the function (lines 42-68):

```javascript
/**
 * Transform TelegramWebhookParser output to standardized IInputEvent
 * @param {Object} parsed - Output from TelegramWebhookParser.parse()
 * @param {import('./TelegramChatRef.mjs').TelegramChatRef} telegramRef - Telegram chat reference
 * @returns {IInputEvent|null}
 */
export function toInputEvent(parsed, telegramRef) {
  if (!parsed) return null;

  return {
    type: parsed.type,
    conversationId: telegramRef ? telegramRef.toConversationId().toString() : parsed.userId,
    platform: 'telegram',
    platformUserId: telegramRef ? telegramRef.platformUserId : parsed.metadata?.from?.id?.toString(),
    messageId: parsed.messageId,
    payload: {
      text: parsed.text,
      fileId: parsed.fileId,
      callbackData: parsed.callbackData,
      callbackId: parsed.callbackId,
      command: parsed.command,
    },
    metadata: {
      senderId: parsed.metadata?.from?.id?.toString(),
      firstName: parsed.metadata?.from?.first_name,
      username: parsed.metadata?.from?.username,
      chatType: parsed.metadata?.chatType,
    },
  };
}
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/telegram/IInputEvent.mjs
git commit -m "feat(telegram): add platform and platformUserId to IInputEvent

- platform: identifies the source platform ('telegram')
- platformUserId: used for identity resolution (chatId without bot context)
- toInputEvent now accepts TelegramChatRef for proper ID extraction

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Refactor UserResolver to Use ConfigService

**Files:**
- Modify: `backend/src/0_infrastructure/users/UserResolver.mjs`
- Test: `tests/unit/suite/infrastructure/users/UserResolver.test.mjs` (create)

**Step 1: Write the failing test**

Create `tests/unit/suite/infrastructure/users/UserResolver.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';
import { UserResolver } from '#backend/src/0_infrastructure/users/UserResolver.mjs';

describe('UserResolver', () => {
  const mockConfigService = {
    getDefaultHouseholdId: () => 'default',
    getHouseholdAppConfig: (hid, appName) => {
      if (appName === 'chatbots') {
        return {
          identity_mappings: {
            telegram: {
              '575596036': 'kckern',
              '123456789': 'kirk',
            },
            discord: {
              '987654321': 'kckern',
            },
          },
        };
      }
      return null;
    },
  };

  describe('resolveUser', () => {
    it('resolves telegram user to system user', () => {
      const resolver = new UserResolver(mockConfigService);

      expect(resolver.resolveUser('telegram', '575596036')).toBe('kckern');
      expect(resolver.resolveUser('telegram', '123456789')).toBe('kirk');
    });

    it('resolves discord user to system user', () => {
      const resolver = new UserResolver(mockConfigService);

      expect(resolver.resolveUser('discord', '987654321')).toBe('kckern');
    });

    it('returns null for unknown platform user', () => {
      const resolver = new UserResolver(mockConfigService);

      expect(resolver.resolveUser('telegram', '999999999')).toBeNull();
    });

    it('returns null for unknown platform', () => {
      const resolver = new UserResolver(mockConfigService);

      expect(resolver.resolveUser('slack', '575596036')).toBeNull();
    });

    it('accepts explicit household override', () => {
      const multiHouseholdConfig = {
        getDefaultHouseholdId: () => 'default',
        getHouseholdAppConfig: (hid, appName) => {
          if (appName === 'chatbots' && hid === 'other') {
            return {
              identity_mappings: {
                telegram: { '575596036': 'other_user' },
              },
            };
          }
          return null;
        },
      };

      const resolver = new UserResolver(multiHouseholdConfig);

      expect(resolver.resolveUser('telegram', '575596036', 'other')).toBe('other_user');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/infrastructure/users/UserResolver.test.mjs -v`

Expected: FAIL

**Step 3: Rewrite UserResolver to use ConfigService**

Replace contents of `backend/src/0_infrastructure/users/UserResolver.mjs`:

```javascript
/**
 * User Resolver
 * @module infrastructure/users/UserResolver
 *
 * Resolves platform-specific user identifiers to system usernames
 * using household-scoped identity mappings from ConfigService.
 */

import { createLogger } from '../logging/logger.js';

/**
 * Resolves platform users to system usernames
 */
export class UserResolver {
  #configService;
  #logger;

  /**
   * @param {Object} configService - ConfigService instance
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(configService, options = {}) {
    this.#configService = configService;
    this.#logger = options.logger || createLogger({ source: 'user-resolver', app: 'chatbots' });
  }

  /**
   * Resolve a platform user ID to a system username
   *
   * @param {string} platform - Platform name ('telegram', 'discord', etc.)
   * @param {string} platformUserId - Platform-specific user identifier
   * @param {string} [householdId] - Optional household override, defaults to default household
   * @returns {string|null} - System username or null if not found
   */
  resolveUser(platform, platformUserId, householdId = null) {
    if (!platform || !platformUserId) return null;

    const hid = householdId ?? this.#configService.getDefaultHouseholdId();
    const chatbotsConfig = this.#configService.getHouseholdAppConfig(hid, 'chatbots');

    const username = chatbotsConfig?.identity_mappings?.[platform]?.[String(platformUserId)] ?? null;

    if (!username) {
      this.#logger.debug?.('userResolver.notFound', { platform, platformUserId, householdId: hid });
    }

    return username;
  }

  /**
   * Check if a platform user is known
   *
   * @param {string} platform - Platform name
   * @param {string} platformUserId - Platform-specific user identifier
   * @param {string} [householdId] - Optional household override
   * @returns {boolean}
   */
  isKnownUser(platform, platformUserId, householdId = null) {
    return this.resolveUser(platform, platformUserId, householdId) !== null;
  }
}

export default UserResolver;
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/infrastructure/users/UserResolver.test.mjs -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_infrastructure/users/UserResolver.mjs \
        tests/unit/suite/infrastructure/users/UserResolver.test.mjs
git commit -m "refactor(users): UserResolver now uses ConfigService for identity mappings

- Reads from household-scoped chatbots config via getHouseholdAppConfig
- resolveUser(platform, platformUserId, householdId?) API
- Supports multiple platforms (telegram, discord, etc.)
- Defaults to default household, allows explicit override

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Update Webhook Handler to Pass Platform Identity

**Files:**
- Modify: `backend/src/4_api/handlers/nutribot/index.mjs` (or equivalent webhook handler)

**Step 1: Find and update webhook handlers**

The webhook handlers need to:
1. Create TelegramChatRef from the parsed update
2. Pass telegramRef to toInputEvent
3. The resulting IInputEvent now has `platform` and `platformUserId`

This task is about wiring - ensure handlers pass the TelegramChatRef to toInputEvent.

**Step 2: Commit**

```bash
git add backend/src/4_api/handlers/
git commit -m "feat(webhook): pass TelegramChatRef to toInputEvent for identity extraction

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Update Input Routers to Use UserResolver

**Files:**
- Modify: `backend/src/2_adapters/nutribot/NutribotInputRouter.mjs`
- Modify: Other input routers as needed

**Step 1: Update NutribotInputRouter to inject and use UserResolver**

The router should:
1. Receive UserResolver in constructor
2. Call `userResolver.resolveUser(event.platform, event.platformUserId)` to get system user
3. Pass system user to use cases

**Step 2: Commit**

```bash
git add backend/src/2_adapters/
git commit -m "feat(routers): use UserResolver for platform identity resolution

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Wire UserResolver in Bootstrap/App

**Files:**
- Modify: `backend/src/app.mjs` or `backend/src/0_infrastructure/bootstrap.mjs`

**Step 1: Create and inject UserResolver**

```javascript
import { UserResolver } from './0_infrastructure/users/UserResolver.mjs';

// After configService is created:
const userResolver = new UserResolver(configService);

// Pass to bot containers:
const nutribotContainer = createNutribotServices({
  userResolver,
  // ... other deps
});
```

**Step 2: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(bootstrap): wire UserResolver with ConfigService

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Remove Legacy Identity Resolution from Bot Configs

**Files:**
- Modify: `backend/src/3_applications/nutribot/config/NutriBotConfig.mjs`
- Modify: Other bot configs as needed

**Step 1: Remove getUserIdFromConversation and related methods from NutriBotConfig**

The bot-specific config should no longer handle identity resolution. Remove:
- `#conversationToUser` map
- `#buildUserMappings()` identity portions
- `getUserIdFromConversation()`
- `getUserForConversation()`

Keep bot-specific concerns like goals, storage paths, etc.

**Step 2: Commit**

```bash
git add backend/src/3_applications/
git commit -m "refactor(nutribot): remove identity resolution from bot config

Identity resolution now handled by UserResolver at infrastructure layer.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Create household chatbots.yml | data config files |
| 2 | Add test fixtures | tests/_fixtures |
| 3 | ConfigLoader loads household apps | configLoader.mjs |
| 4 | ConfigService.getHouseholdAppConfig | ConfigService.mjs |
| 5 | TelegramChatRef.platformUserId | TelegramChatRef.mjs |
| 6 | IInputEvent platform fields | IInputEvent.mjs |
| 7 | Refactor UserResolver | UserResolver.mjs |
| 8 | Update webhook handlers | handlers/*.mjs |
| 9 | Update input routers | routers/*.mjs |
| 10 | Wire in bootstrap | app.mjs |
| 11 | Remove legacy resolution | NutriBotConfig.mjs |
