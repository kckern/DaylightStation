# Unified Identity Resolution

**Date:** 2026-02-12
**Status:** Approved
**Trigger:** Production error — `telegram:undefined_575596036` conversationId from direct API path

---

## Problem

Identity resolution (mapping platform users to system usernames and building valid ConversationIds) is implemented three different ways:

| Path | Implementation | Uses UserResolver? | Works? |
|------|---------------|-------------------|--------|
| Webhook (all bots) | `TelegramWebhookParser` → `IInputEvent` → `InputRouter.#resolveUserId()` | Yes | Yes |
| Nutribot direct API | `resolveUserContext()` in `directInput.mjs` — hand-rolled string interpolation | No | Broken |
| Journalist morning API | `resolveConversationId()` — different userResolver with `getUser()` | Different one | Fragile |

The direct API path constructs conversationIds via `telegram:${botId}_${userId}`. When `botId` is undefined, this produces `telegram:undefined_575596036`. Even with a valid botId, this format can't be parsed by `TelegramChatRef.fromConversationId()` (which expects `b{botId}_c{chatId}`), so Telegram message delivery silently fails.

### Root architectural flaw

`UserResolver` lives in `0_system/users/` but identity resolution is domain logic, not infrastructure plumbing. Because it's in the system layer, it can't use domain value objects (`ConversationId`, `TelegramChatRef`), so every consumer hand-rolls the last mile. There's no single path that goes from "some user identifier" to "valid resolved identity."

---

## Design

### New files

| File | Layer | Purpose |
|------|-------|---------|
| `2_domains/messaging/services/UserIdentityService.mjs` | Domain | Pure identity resolution: platform ID ↔ username. Receives mappings as `Map`, no I/O. |
| `2_domains/messaging/value-objects/ResolvedIdentity.mjs` | Domain | Value object: `{ username, conversationId }`. Immutable. |
| `1_adapters/messaging/TelegramIdentityAdapter.mjs` | Adapter | Telegram-specific: combines `UserIdentityService` + `TelegramChatRef` to produce `ResolvedIdentity` with valid `ConversationId`. |

### Modified files

| File | Change |
|------|--------|
| `0_system/bootstrap.mjs` | Create `UserIdentityService` with mappings from ConfigService, create `TelegramIdentityAdapter`, inject into consumers |
| `0_system/users/UserResolver.mjs` | Deprecate — thin wrapper delegating to `UserIdentityService` during migration, then remove |
| `4_api/v1/handlers/nutribot/directInput.mjs` | Replace `resolveUserContext()` with `TelegramIdentityAdapter.resolve()` |
| `4_api/v1/handlers/journalist/morning.mjs` | Replace `resolveConversationId()` with `TelegramIdentityAdapter.resolve()` |
| `1_adapters/nutribot/NutribotInputRouter.mjs` | Replace `#resolveUserId()` with `UserIdentityService` |
| `1_adapters/journalist/JournalistInputRouter.mjs` | Same pattern |
| `1_adapters/homebot/HomeBotInputRouter.mjs` | Same pattern |
| `1_adapters/telegram/TelegramWebhookParser.mjs` | Remove `#buildConversationId()` — return raw parsed fields, let adapter build ConversationId |

### Layer responsibilities

```
Domain (2_domains/messaging/)
├── UserIdentityService    — pure: platformId ↔ username (Map-based, no I/O)
├── ResolvedIdentity       — value object: { username, conversationId }
└── ConversationId         — existing value object: { channel, identifier }

Adapter (1_adapters/messaging/)
├── TelegramIdentityAdapter — resolve(botName, input) → ResolvedIdentity
│   Uses: UserIdentityService + TelegramChatRef + bot config
└── TelegramChatRef         — existing: builds ConversationId from botId + chatId

System (0_system/)
├── ConfigService           — unchanged: provides identity mappings + bot configs
├── UserResolver            — deprecated wrapper → UserIdentityService
└── bootstrap.mjs           — wires everything together
```

### UserIdentityService API

```js
// 2_domains/messaging/services/UserIdentityService.mjs
export class UserIdentityService {
  #mappings; // { telegram: { '575596036': 'kckern' }, ... }

  constructor(identityMappings) {
    this.#mappings = Object.freeze(identityMappings);
  }

  resolveUsername(platform, platformId) → string|null
  resolvePlatformId(platform, username) → string|null
  isKnownUser(platform, platformId) → boolean
}
```

Receives identity mappings as plain data from bootstrap. Pure, testable, no ConfigService dependency.

### TelegramIdentityAdapter API

```js
// 1_adapters/messaging/TelegramIdentityAdapter.mjs
export class TelegramIdentityAdapter {
  constructor({ userIdentityService, botConfigs, logger })

  /**
   * @param {string} botName - 'nutribot', 'journalist', 'homebot'
   * @param {Object} input - At least one of: platformUserId, username, conversationId
   * @returns {ResolvedIdentity} { username, conversationId }
   * @throws {ValidationError} if botId not found or no valid input
   */
  resolve(botName, { platform, platformUserId, username, conversationId })
}
```

Resolution logic:
1. Look up `botId` for `botName` from bot configs → throw if missing
2. If `platformUserId` → resolve username via `UserIdentityService`, build `TelegramChatRef(botId, platformUserId)` → `ConversationId`
3. If `username` → resolve platformUserId via `UserIdentityService`, build `TelegramChatRef(botId, platformUserId)` → `ConversationId`
4. If `conversationId` → parse via `TelegramChatRef.fromConversationId()`, resolve username from chatId
5. Return `ResolvedIdentity { username, conversationId }`

### Data flow (after)

**Webhook path:**
```
Telegram webhook
  → TelegramWebhookParser.parse()     → { type, chatId, fromId, metadata }
  → TelegramIdentityAdapter.resolve() → ResolvedIdentity
  → InputRouter.route(event)          → use case
```

**Direct API path:**
```
HTTP request (member=kckern or user_id=575596036)
  → TelegramIdentityAdapter.resolve('nutribot', { username: 'kckern' })
  → ResolvedIdentity { username: 'kckern', conversationId }
  → use case
```

Both paths produce identical, valid ConversationIds.

### ConversationId format

Canonical format: `telegram:b{botId}_c{chatId}` (from `TelegramChatRef.toConversationId()`).

This is the only format that `TelegramChatRef.fromConversationId()` and `TelegramAdapter.extractChatId()` can parse back to a chat ID. The old `telegram:{botId}_{userId}` format from `TelegramWebhookParser` is eliminated.

### Migration

**Conversation state files** keyed on old format:
- `TelegramIdentityAdapter` accepts both formats when parsing existing conversationIds (delegates to `TelegramChatRef.fromLegacyPath()` for old-format keys)
- New writes use canonical format
- Old data works until naturally overwritten

**UserResolver deprecation:**
- Wrap to delegate to `UserIdentityService` during migration period
- Remove after all direct callers are migrated

### Error handling

- `TelegramIdentityAdapter.resolve()` throws `ValidationError` if bot config missing or no resolvable input
- Username resolution failure → `username: null` in result (warning, not error)
- No silent fallback to malformed strings — the `telegram:undefined_*` class of bug becomes impossible

### Testing

- `UserIdentityService`: unit tests with mock mappings — pure logic
- `TelegramIdentityAdapter`: unit tests with mock service + configs
- Integration: verify direct API handlers produce conversationIds parseable by `TelegramAdapter.extractChatId()`

---

## DDD compliance

| Principle | How this design follows it |
|-----------|---------------------------|
| Domain is pure, no I/O | `UserIdentityService` receives mappings as data, no ConfigService import |
| Adapters implement platform specifics | `TelegramIdentityAdapter` knows Telegram, domain doesn't |
| System layer has no domain knowledge | ConfigService provides raw data, bootstrap wires |
| Dependency rules respected | Domain ← Adapter ← API; no upward imports |
| Future platforms | New adapter (e.g., `DiscordIdentityAdapter`) implements same pattern, domain unchanged |
