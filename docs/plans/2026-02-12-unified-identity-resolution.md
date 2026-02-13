# Unified Identity Resolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace three inconsistent identity resolution paths with a single domain-owned service and Telegram adapter, eliminating the class of bugs where malformed conversationIds cause silent Telegram delivery failures.

**Architecture:** Domain layer (`2_domains/messaging/`) owns identity resolution via `UserIdentityService` (pure, Map-based) and `ResolvedIdentity` value object. Adapter layer (`1_adapters/messaging/`) provides `TelegramIdentityAdapter` that combines `UserIdentityService` + `TelegramChatRef` to produce valid `ConversationId` values. All entry points (webhook, direct API, morning handler) converge on this adapter via DI.

**Tech Stack:** Node.js ES modules, Jest for testing, existing DDD layer structure.

**Design doc:** `docs/plans/2026-02-12-unified-identity-resolution-design.md`

---

## Task 1: Create ResolvedIdentity value object

**Files:**
- Create: `backend/src/2_domains/messaging/value-objects/ResolvedIdentity.mjs`
- Modify: `backend/src/2_domains/messaging/value-objects/index.mjs`
- Modify: `backend/src/2_domains/messaging/index.mjs`
- Test: `tests/isolated/domain/messaging/value-objects/ResolvedIdentity.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from '@jest/globals';
import { ResolvedIdentity } from '#domains/messaging/value-objects/ResolvedIdentity.mjs';
import { ConversationId } from '#domains/messaging/value-objects/ConversationId.mjs';

describe('ResolvedIdentity', () => {
  const conversationId = new ConversationId('telegram', 'b123_c456');

  it('creates with username and conversationId', () => {
    const identity = new ResolvedIdentity({ username: 'kckern', conversationId });

    expect(identity.username).toBe('kckern');
    expect(identity.conversationId).toBe(conversationId);
  });

  it('allows null username (unknown user)', () => {
    const identity = new ResolvedIdentity({ username: null, conversationId });

    expect(identity.username).toBeNull();
    expect(identity.conversationId).toBe(conversationId);
  });

  it('requires conversationId', () => {
    expect(() => new ResolvedIdentity({ username: 'kckern' }))
      .toThrow('conversationId is required');
  });

  it('is immutable', () => {
    const identity = new ResolvedIdentity({ username: 'kckern', conversationId });

    expect(Object.isFrozen(identity)).toBe(true);
  });

  it('converts conversationId to string', () => {
    const identity = new ResolvedIdentity({ username: 'kckern', conversationId });

    expect(identity.conversationIdString).toBe('telegram:b123_c456');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/domain/messaging/value-objects/ResolvedIdentity.test.mjs --no-cache`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `backend/src/2_domains/messaging/value-objects/ResolvedIdentity.mjs`:

```javascript
/**
 * ResolvedIdentity value object
 * @module domains/messaging/value-objects/ResolvedIdentity
 *
 * Represents a fully-resolved user identity: system username + valid ConversationId.
 * Immutable. Created by platform-specific identity adapters.
 */

import { ValidationError } from '../../core/errors/index.mjs';
import { ConversationId } from './ConversationId.mjs';

export class ResolvedIdentity {
  #username;
  #conversationId;

  /**
   * @param {Object} params
   * @param {string|null} params.username - System username, null if unknown
   * @param {ConversationId} params.conversationId - Valid domain ConversationId
   */
  constructor({ username = null, conversationId } = {}) {
    if (!conversationId || !(conversationId instanceof ConversationId)) {
      throw new ValidationError('conversationId is required and must be a ConversationId instance', {
        code: 'INVALID_IDENTITY',
      });
    }

    this.#username = username;
    this.#conversationId = conversationId;
    Object.freeze(this);
  }

  get username() { return this.#username; }
  get conversationId() { return this.#conversationId; }
  get conversationIdString() { return this.#conversationId.toString(); }

  toJSON() {
    return { username: this.#username, conversationId: this.#conversationId.toJSON() };
  }
}

export default ResolvedIdentity;
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/domain/messaging/value-objects/ResolvedIdentity.test.mjs --no-cache`
Expected: PASS (5 tests)

**Step 5: Update barrel exports**

Add to `backend/src/2_domains/messaging/value-objects/index.mjs` (line 6):
```javascript
export * from './ResolvedIdentity.mjs';
```

Add to `backend/src/2_domains/messaging/index.mjs` (after line 10, in value objects section — the barrel already re-exports `./value-objects/index.mjs` so this should propagate automatically, but verify).

**Step 6: Commit**

```bash
git add backend/src/2_domains/messaging/value-objects/ResolvedIdentity.mjs \
       backend/src/2_domains/messaging/value-objects/index.mjs \
       tests/isolated/domain/messaging/value-objects/ResolvedIdentity.test.mjs
git commit -m "feat(messaging): add ResolvedIdentity value object"
```

---

## Task 2: Create UserIdentityService domain service

**Files:**
- Create: `backend/src/2_domains/messaging/services/UserIdentityService.mjs`
- Modify: `backend/src/2_domains/messaging/index.mjs`
- Test: `tests/isolated/domain/messaging/services/UserIdentityService.test.mjs`

**Context:** This replaces `UserResolver` from `backend/src/0_system/users/UserResolver.mjs`. Same logic, but in the domain layer, receiving identity mappings as plain data instead of `ConfigService`.

**Step 1: Write the failing test**

Use the same mock data structure from `tests/isolated/assembly/infrastructure/users/UserResolver.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';
import { UserIdentityService } from '#domains/messaging/services/UserIdentityService.mjs';

const mappings = {
  telegram: {
    '575596036': 'kckern',
    '123456789': 'kirk',
  },
  discord: {
    '987654321': 'kckern',
  },
};

describe('UserIdentityService', () => {
  describe('resolveUsername', () => {
    it('resolves telegram user to system username', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolveUsername('telegram', '575596036')).toBe('kckern');
      expect(service.resolveUsername('telegram', '123456789')).toBe('kirk');
    });

    it('resolves discord user to system username', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolveUsername('discord', '987654321')).toBe('kckern');
    });

    it('returns null for unknown platform user', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolveUsername('telegram', '999999999')).toBeNull();
    });

    it('returns null for unknown platform', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolveUsername('slack', '575596036')).toBeNull();
    });

    it('returns null for null/undefined inputs', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolveUsername(null, '575596036')).toBeNull();
      expect(service.resolveUsername('telegram', null)).toBeNull();
    });

    it('coerces numeric platformId to string', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolveUsername('telegram', 575596036)).toBe('kckern');
    });
  });

  describe('resolvePlatformId', () => {
    it('resolves system username to telegram user ID', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolvePlatformId('telegram', 'kckern')).toBe('575596036');
    });

    it('returns null for unknown username', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolvePlatformId('telegram', 'nobody')).toBeNull();
    });

    it('returns null for null inputs', () => {
      const service = new UserIdentityService(mappings);
      expect(service.resolvePlatformId(null, 'kckern')).toBeNull();
      expect(service.resolvePlatformId('telegram', null)).toBeNull();
    });
  });

  describe('isKnownUser', () => {
    it('returns true for known users', () => {
      const service = new UserIdentityService(mappings);
      expect(service.isKnownUser('telegram', '575596036')).toBe(true);
    });

    it('returns false for unknown users', () => {
      const service = new UserIdentityService(mappings);
      expect(service.isKnownUser('telegram', '999999999')).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/domain/messaging/services/UserIdentityService.test.mjs --no-cache`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `backend/src/2_domains/messaging/services/UserIdentityService.mjs`:

```javascript
/**
 * UserIdentityService - platform-agnostic identity resolution
 * @module domains/messaging/services/UserIdentityService
 *
 * Resolves platform-specific user IDs to system usernames and vice versa.
 * Receives identity mappings as plain data — no I/O, no ConfigService dependency.
 */

export class UserIdentityService {
  #mappings;

  /**
   * @param {Object} identityMappings - Map of platform → { platformId: username }
   * @example
   * new UserIdentityService({
   *   telegram: { '575596036': 'kckern' },
   *   discord: { '987654321': 'kckern' },
   * })
   */
  constructor(identityMappings = {}) {
    this.#mappings = identityMappings;
  }

  /**
   * Resolve a platform user ID to a system username
   * @param {string} platform - Platform name ('telegram', 'discord', etc.)
   * @param {string|number} platformId - Platform-specific user identifier
   * @returns {string|null} System username or null
   */
  resolveUsername(platform, platformId) {
    if (!platform || platformId == null) return null;
    return this.#mappings[platform]?.[String(platformId)] ?? null;
  }

  /**
   * Resolve a system username to a platform user ID (reverse lookup)
   * @param {string} platform - Platform name
   * @param {string} username - System username
   * @returns {string|null} Platform user ID or null
   */
  resolvePlatformId(platform, username) {
    if (!platform || !username) return null;
    const platformMappings = this.#mappings[platform];
    if (!platformMappings) return null;
    for (const [platformId, user] of Object.entries(platformMappings)) {
      if (user === username) return platformId;
    }
    return null;
  }

  /**
   * Check if a platform user is known
   * @param {string} platform - Platform name
   * @param {string|number} platformId - Platform-specific user identifier
   * @returns {boolean}
   */
  isKnownUser(platform, platformId) {
    return this.resolveUsername(platform, platformId) !== null;
  }
}

export default UserIdentityService;
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/domain/messaging/services/UserIdentityService.test.mjs --no-cache`
Expected: PASS (9 tests)

**Step 5: Update barrel export**

Add to `backend/src/2_domains/messaging/index.mjs` (after line 23):
```javascript
export { UserIdentityService } from './services/UserIdentityService.mjs';
```

**Step 6: Commit**

```bash
git add backend/src/2_domains/messaging/services/UserIdentityService.mjs \
       backend/src/2_domains/messaging/index.mjs \
       tests/isolated/domain/messaging/services/UserIdentityService.test.mjs
git commit -m "feat(messaging): add UserIdentityService domain service"
```

---

## Task 3: Create TelegramIdentityAdapter

**Files:**
- Create: `backend/src/1_adapters/messaging/TelegramIdentityAdapter.mjs`
- Test: `tests/isolated/adapter/messaging/TelegramIdentityAdapter.test.mjs`

**Context:** This adapter combines `UserIdentityService` (domain) with `TelegramChatRef` (adapter) to produce `ResolvedIdentity` values with valid canonical `ConversationId` (`telegram:b{botId}_c{chatId}` format). See `TelegramChatRef.toConversationId()` at `backend/src/1_adapters/telegram/TelegramChatRef.mjs:96-101`.

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from '@jest/globals';
import { TelegramIdentityAdapter } from '#adapters/messaging/TelegramIdentityAdapter.mjs';
import { UserIdentityService } from '#domains/messaging/services/UserIdentityService.mjs';

const mappings = {
  telegram: {
    '575596036': 'kckern',
    '123456789': 'kirk',
  },
};

const botConfigs = {
  nutribot: { botId: '6898194425' },
  journalist: { botId: '7777777777' },
};

const identityService = new UserIdentityService(mappings);

describe('TelegramIdentityAdapter', () => {
  describe('resolve by platformUserId', () => {
    it('produces valid ResolvedIdentity with canonical conversationId', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      const result = adapter.resolve('nutribot', { platformUserId: '575596036' });

      expect(result.username).toBe('kckern');
      expect(result.conversationIdString).toBe('telegram:b6898194425_c575596036');
    });

    it('returns null username for unknown platformUserId', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      const result = adapter.resolve('nutribot', { platformUserId: '999999999' });

      expect(result.username).toBeNull();
      expect(result.conversationIdString).toBe('telegram:b6898194425_c999999999');
    });
  });

  describe('resolve by username', () => {
    it('produces valid ResolvedIdentity from system username', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      const result = adapter.resolve('nutribot', { username: 'kckern' });

      expect(result.username).toBe('kckern');
      expect(result.conversationIdString).toBe('telegram:b6898194425_c575596036');
    });

    it('throws when username has no platform ID', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      expect(() => adapter.resolve('nutribot', { username: 'nobody' }))
        .toThrow();
    });
  });

  describe('resolve by conversationId', () => {
    it('parses canonical format and resolves username', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      const result = adapter.resolve('nutribot', { conversationId: 'telegram:b6898194425_c575596036' });

      expect(result.username).toBe('kckern');
      expect(result.conversationIdString).toBe('telegram:b6898194425_c575596036');
    });
  });

  describe('error cases', () => {
    it('throws when botName has no config', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      expect(() => adapter.resolve('unknownbot', { platformUserId: '575596036' }))
        .toThrow(/bot config/i);
    });

    it('throws when no resolvable input provided', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      expect(() => adapter.resolve('nutribot', {}))
        .toThrow();
    });
  });

  describe('uses correct bot for conversationId', () => {
    it('different bots produce different conversationIds for same user', () => {
      const adapter = new TelegramIdentityAdapter({ userIdentityService: identityService, botConfigs });

      const nutribot = adapter.resolve('nutribot', { platformUserId: '575596036' });
      const journalist = adapter.resolve('journalist', { platformUserId: '575596036' });

      expect(nutribot.conversationIdString).toBe('telegram:b6898194425_c575596036');
      expect(journalist.conversationIdString).toBe('telegram:b7777777777_c575596036');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/adapter/messaging/TelegramIdentityAdapter.test.mjs --no-cache`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `backend/src/1_adapters/messaging/TelegramIdentityAdapter.mjs`:

```javascript
/**
 * TelegramIdentityAdapter
 * @module adapters/messaging/TelegramIdentityAdapter
 *
 * Telegram-specific identity resolution. Combines UserIdentityService (domain)
 * with TelegramChatRef to produce ResolvedIdentity with valid ConversationId.
 *
 * This is the ONLY place Telegram conversationIds should be constructed.
 */

import { TelegramChatRef } from '../telegram/TelegramChatRef.mjs';
import { ConversationId } from '#domains/messaging/value-objects/ConversationId.mjs';
import { ResolvedIdentity } from '#domains/messaging/value-objects/ResolvedIdentity.mjs';
import { ValidationError } from '#system/utils/errors/index.mjs';

export class TelegramIdentityAdapter {
  #userIdentityService;
  #botConfigs;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('#domains/messaging/services/UserIdentityService.mjs').UserIdentityService} deps.userIdentityService
   * @param {Object} deps.botConfigs - Map of botName → { botId }
   * @param {Object} [deps.logger]
   */
  constructor({ userIdentityService, botConfigs, logger } = {}) {
    this.#userIdentityService = userIdentityService;
    this.#botConfigs = botConfigs || {};
    this.#logger = logger || console;
  }

  /**
   * Resolve identity for a Telegram bot interaction.
   *
   * @param {string} botName - 'nutribot', 'journalist', 'homebot'
   * @param {Object} input - At least one of: platformUserId, username, conversationId
   * @param {string} [input.platformUserId] - Telegram user ID
   * @param {string} [input.username] - System username
   * @param {string} [input.conversationId] - Existing conversationId string to parse
   * @returns {ResolvedIdentity}
   * @throws {ValidationError}
   */
  resolve(botName, { platformUserId, username, conversationId } = {}) {
    const botConfig = this.#botConfigs[botName];
    if (!botConfig?.botId) {
      throw new ValidationError(`No bot config found for "${botName}"`, {
        code: 'MISSING_BOT_CONFIG',
        botName,
      });
    }
    const { botId } = botConfig;

    // Resolve by platformUserId
    if (platformUserId) {
      const resolvedUsername = this.#userIdentityService.resolveUsername('telegram', platformUserId);
      const chatRef = new TelegramChatRef(botId, platformUserId);
      return new ResolvedIdentity({
        username: resolvedUsername,
        conversationId: chatRef.toConversationId(),
      });
    }

    // Resolve by username
    if (username) {
      const resolvedPlatformId = this.#userIdentityService.resolvePlatformId('telegram', username);
      if (!resolvedPlatformId) {
        throw new ValidationError(`Cannot resolve Telegram ID for username "${username}"`, {
          code: 'PLATFORM_ID_NOT_FOUND',
          username,
          platform: 'telegram',
        });
      }
      const chatRef = new TelegramChatRef(botId, resolvedPlatformId);
      return new ResolvedIdentity({
        username,
        conversationId: chatRef.toConversationId(),
      });
    }

    // Resolve by existing conversationId
    if (conversationId) {
      const parsed = ConversationId.parse(conversationId);
      const chatRef = TelegramChatRef.fromConversationId(parsed);
      const resolvedUsername = this.#userIdentityService.resolveUsername('telegram', chatRef.chatId);
      return new ResolvedIdentity({
        username: resolvedUsername,
        conversationId: parsed,
      });
    }

    throw new ValidationError('No resolvable input provided. Need platformUserId, username, or conversationId.', {
      code: 'NO_IDENTITY_INPUT',
    });
  }
}

export default TelegramIdentityAdapter;
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/adapter/messaging/TelegramIdentityAdapter.test.mjs --no-cache`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/messaging/TelegramIdentityAdapter.mjs \
       tests/isolated/adapter/messaging/TelegramIdentityAdapter.test.mjs
git commit -m "feat(messaging): add TelegramIdentityAdapter"
```

---

## Task 4: Wire into bootstrap and deprecate UserResolver

**Files:**
- Modify: `backend/src/app.mjs:245-248` — create `UserIdentityService` + `TelegramIdentityAdapter`
- Modify: `backend/src/0_system/users/UserResolver.mjs` — delegate to `UserIdentityService`
- Modify: `backend/src/0_system/bootstrap.mjs:2274-2311` — pass adapter to nutribot router factory
- Modify: `backend/src/0_system/bootstrap.mjs:2033-2063` — pass adapter to journalist router factory
- Modify: `backend/src/0_system/bootstrap.mjs:2125-2166` — pass adapter to homebot router factory

**Step 1: Update app.mjs to create domain service**

In `backend/src/app.mjs`, after line 248 (where `userResolver` is created), add:

```javascript
// Domain identity service (replaces UserResolver for identity resolution)
const { UserIdentityService } = await import('#domains/messaging/services/UserIdentityService.mjs');
const userIdentityService = new UserIdentityService(
  configService.getConfig?.().identityMappings || {}
);
```

Check how to access identity mappings from ConfigService. See `configLoader.mjs:416-432` — they're built as `config.identityMappings`. Verify the accessor exists or read it via an appropriate ConfigService method.

**Step 2: Create TelegramIdentityAdapter in app.mjs**

After the `userIdentityService` creation, add:

```javascript
const { TelegramIdentityAdapter } = await import('#adapters/messaging/TelegramIdentityAdapter.mjs');

// Collect bot IDs from system bot configs
const systemBots = configService.getSystemConfig('bots') || {};
const botConfigs = {};
for (const [botName, botConfig] of Object.entries(systemBots)) {
  if (botConfig?.telegram?.bot_id) {
    botConfigs[botName] = { botId: botConfig.telegram.bot_id };
  }
}

const telegramIdentityAdapter = new TelegramIdentityAdapter({
  userIdentityService,
  botConfigs,
  logger: rootLogger.child({ module: 'telegram-identity' }),
});
```

**Step 3: Pass adapter through bootstrap factory calls**

For each `create*ApiRouter` call in `app.mjs`, add `telegramIdentityAdapter` to the config object. Then update the factory functions in `bootstrap.mjs` to accept and pass it through.

The factories to update:
- `createNutribotApiRouter` (bootstrap.mjs:2274) — add `telegramIdentityAdapter` param, pass to router factory
- `createJournalistApiRouter` (bootstrap.mjs:2033) — same
- `createHomebotApiRouter` (bootstrap.mjs:2125) — same

**Step 4: Deprecate UserResolver**

Update `backend/src/0_system/users/UserResolver.mjs` to delegate:

```javascript
/**
 * @deprecated Use UserIdentityService from 2_domains/messaging/services/ instead.
 * This wrapper exists for backward compatibility during migration.
 */
export class UserResolver {
  #userIdentityService;
  #configService;
  #logger;

  constructor(configService, options = {}) {
    this.#configService = configService;
    this.#logger = options.logger || console;

    // If a UserIdentityService is injected, delegate to it
    if (options.userIdentityService) {
      this.#userIdentityService = options.userIdentityService;
    }
  }

  resolveUser(platform, platformUserId, householdId = null) {
    if (!platform || !platformUserId) return null;

    if (this.#userIdentityService) {
      return this.#userIdentityService.resolveUsername(platform, platformUserId);
    }

    // Legacy fallback
    return this.#configService.resolveUsername(platform, platformUserId);
  }

  isKnownUser(platform, platformUserId, householdId = null) {
    return this.resolveUser(platform, platformUserId, householdId) !== null;
  }
}
```

**Step 5: Run existing UserResolver tests to verify backward compat**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/assembly/infrastructure/users/UserResolver.test.mjs --no-cache`
Expected: PASS (all existing tests still pass)

**Step 6: Commit**

```bash
git add backend/src/app.mjs \
       backend/src/0_system/users/UserResolver.mjs \
       backend/src/0_system/bootstrap.mjs
git commit -m "refactor: wire UserIdentityService and TelegramIdentityAdapter into bootstrap"
```

---

## Task 5: Migrate nutribot direct API handlers

**Files:**
- Modify: `backend/src/4_api/v1/handlers/nutribot/directInput.mjs:19-52` — replace `resolveUserContext()`
- Modify: `backend/src/4_api/v1/routers/nutribot.mjs` — pass adapter to handlers

**Context:** Currently `resolveUserContext()` (directInput.mjs:19-52) hand-builds `telegram:${botId}_${userId}` which breaks when botId is undefined. Replace with `TelegramIdentityAdapter.resolve()`.

**Step 1: Update resolveUserContext to use adapter**

Replace the `resolveUserContext` function in `directInput.mjs:19-52` with:

```javascript
/**
 * Resolve user identity for direct API calls using TelegramIdentityAdapter
 * @param {Object} options
 * @param {import('#adapters/messaging/TelegramIdentityAdapter.mjs').TelegramIdentityAdapter} options.identityAdapter
 * @param {Object} options.body - Request body
 * @param {Object} [options.query] - Request query params
 * @returns {{ username: string|null, conversationId: string }}
 */
function resolveUserContext({ identityAdapter, body, query = {} }) {
  const member = body.member || query.member;
  const platformUserId = body.user_id || query.user_id || body.chat_id || query.chat_id;

  let identity;
  if (platformUserId) {
    identity = identityAdapter.resolve('nutribot', { platformUserId: String(platformUserId) });
  } else if (member) {
    identity = identityAdapter.resolve('nutribot', { username: member });
  } else {
    // No explicit user — adapter will throw, caller should handle
    throw new Error('Could not resolve user. Provide member or user_id parameter.');
  }

  return {
    userId: identity.username || platformUserId || member,
    conversationId: identity.conversationIdString,
  };
}
```

**Step 2: Update handler factories to accept adapter**

Each handler factory (`directUPCHandler`, `directImageHandler`, `directTextHandler`) needs the adapter injected. Update their signatures to accept it and pass to `resolveUserContext`.

**Step 3: Update the nutribot router** to pass the adapter to handler factories.

Check `backend/src/4_api/v1/routers/nutribot.mjs` for where `directUPCHandler`, etc. are called, and ensure the adapter is passed through.

**Step 4: Test manually**

With the dev server running, test the direct UPC endpoint:
```bash
curl -s "http://localhost:3112/api/v1/nutribot/upc?upc=0102638000060&member=kckern" | jq '.ok'
```
Expected: `true` (or at minimum, no `telegram:undefined_*` in logs)

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/handlers/nutribot/directInput.mjs \
       backend/src/4_api/v1/routers/nutribot.mjs
git commit -m "fix(nutribot): use TelegramIdentityAdapter for direct API identity resolution"
```

---

## Task 6: Migrate journalist morning handler

**Files:**
- Modify: `backend/src/4_api/v1/handlers/journalist/morning.mjs:85-108` — replace `resolveConversationId()`

**Context:** Currently `resolveConversationId()` (morning.mjs:85-108) uses a different `userResolver.getUser()` method and hand-builds `telegram:${user.telegram_bot_id}_${user.telegram_user_id}`. Replace with `TelegramIdentityAdapter.resolve()`.

**Step 1: Update resolveConversationId**

Replace the function with:

```javascript
function resolveConversationId(identityAdapter, username, logger) {
  if (!username) {
    logger?.warn?.('journalist.morning.noUsername');
    return null;
  }

  try {
    const identity = identityAdapter.resolve('journalist', { username });
    return identity.conversationIdString;
  } catch (e) {
    logger?.warn?.('journalist.morning.identityResolutionFailed', {
      username, error: e.message,
    });
    return null;
  }
}
```

**Step 2: Update handler factory** to accept and use the adapter.

**Step 3: Update bootstrap wiring** — pass `telegramIdentityAdapter` to journalist router factory.

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/handlers/journalist/morning.mjs
git commit -m "fix(journalist): use TelegramIdentityAdapter for morning handler identity"
```

---

## Task 7: Migrate InputRouter #resolveUserId methods

**Files:**
- Modify: `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs:395-426`
- Modify: `backend/src/1_adapters/journalist/JournalistInputRouter.mjs:446-480`
- Modify: `backend/src/1_adapters/homebot/HomeBotInputRouter.mjs:168-202`

**Context:** All three InputRouters have identical `#resolveUserId(event)` methods that use `UserResolver`. Migrate to `UserIdentityService` directly (these already have `platformUserId` from the webhook parser, they just need username resolution — no conversationId construction needed here).

**Step 1: Update constructor to accept UserIdentityService**

In each router's constructor, accept `userIdentityService` alongside (or instead of) `userResolver`:

```javascript
constructor(container, options = {}) {
  // ...existing code...
  this.#userIdentityService = options.userIdentityService || null;
  this.#userResolver = options.userResolver; // keep for backward compat
}
```

**Step 2: Update #resolveUserId to prefer domain service**

```javascript
#resolveUserId(event) {
  const service = this.#userIdentityService;
  if (service && event.platform && event.platformUserId) {
    const username = service.resolveUsername(event.platform, event.platformUserId);
    if (username) return username;

    this.logger.warn?.('inputRouter.identity.notFound', {
      platform: event.platform,
      platformUserId: event.platformUserId,
    });
  }

  // Fallback to legacy UserResolver if domain service not available
  if (this.#userResolver && event.platform && event.platformUserId) {
    const username = this.#userResolver.resolveUser(event.platform, event.platformUserId);
    if (username) return username;
  }

  return event.conversationId;
}
```

**Step 3: Update bootstrap** to pass `userIdentityService` to InputRouter constructors.

**Step 4: Run all existing tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/ --no-cache`
Expected: All existing tests pass

**Step 5: Commit**

```bash
git add backend/src/1_adapters/nutribot/NutribotInputRouter.mjs \
       backend/src/1_adapters/journalist/JournalistInputRouter.mjs \
       backend/src/1_adapters/homebot/HomeBotInputRouter.mjs \
       backend/src/0_system/bootstrap.mjs
git commit -m "refactor(routers): migrate InputRouters to UserIdentityService"
```

---

## Task 8: Clean up TelegramWebhookParser conversationId construction

**Files:**
- Modify: `backend/src/1_adapters/telegram/TelegramWebhookParser.mjs:36-41` — remove `#buildConversationId()`

**Context:** `TelegramWebhookParser.#buildConversationId()` (line 36-41) produces the old `telegram:{botId}_{userId}` format. This is only used as a fallback in `IInputEvent.toInputEvent()` (line 46-48) when `telegramRef` is null. With the adapter in place, this fallback path should also use proper resolution.

**Step 1: Examine the fallback in IInputEvent.mjs**

Read `backend/src/1_adapters/telegram/IInputEvent.mjs:41-64` to understand how `parsed.userId` is used as a fallback.

**Step 2: Update strategy**

Two options:
- Remove `#buildConversationId` entirely and have the parser return `null` for userId (let the webhook handler use `TelegramIdentityAdapter` instead)
- Or keep `#buildConversationId` but update it to use `TelegramChatRef.toConversationId()` format

The cleaner approach: keep the parser producing a raw parsed object (chatId, fromId, metadata), and let `createBotWebhookHandler` use `TelegramIdentityAdapter` to produce the `ResolvedIdentity`. This moves conversationId construction entirely out of the parser.

**Step 3: Update `createBotWebhookHandler`** to use `TelegramIdentityAdapter` for identity resolution instead of constructing conversationIds in the parser.

**Step 4: Run all tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/ --no-cache`
Expected: All pass

**Step 5: Commit**

```bash
git add backend/src/1_adapters/telegram/TelegramWebhookParser.mjs \
       backend/src/1_adapters/telegram/createBotWebhookHandler.mjs \
       backend/src/1_adapters/telegram/IInputEvent.mjs
git commit -m "refactor(telegram): remove conversationId construction from webhook parser"
```

---

## Task 9: Integration verification

**Step 1: Run all isolated tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/ --no-cache
```
Expected: All pass

**Step 2: Check for any remaining hand-rolled conversationId construction**

```bash
grep -rn 'telegram:\${' backend/src/ --include='*.mjs'
```
Expected: No results (all `telegram:${botId}_${userId}` patterns eliminated)

**Step 3: Check prod logs after deploy** (manual step)

After deployment, scan for:
- `telegram.chatId.parseError` events — should stop appearing
- `telegram:undefined_*` patterns — should be gone
- `telegram:b*_c*` patterns in new log entries — confirms canonical format

**Step 4: Final commit**

```bash
git commit --allow-empty -m "chore: unified identity resolution migration complete"
```

---

## Summary

| Task | Creates | Tests |
|------|---------|-------|
| 1 | `ResolvedIdentity` value object | 5 unit tests |
| 2 | `UserIdentityService` domain service | 9 unit tests |
| 3 | `TelegramIdentityAdapter` | 7 unit tests |
| 4 | Bootstrap wiring | Existing tests pass |
| 5 | Nutribot direct API fix | Manual API test |
| 6 | Journalist morning fix | — |
| 7 | InputRouter migration | Existing tests pass |
| 8 | Webhook parser cleanup | Existing tests pass |
| 9 | Integration verification | Full test suite |
