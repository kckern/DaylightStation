# Nutribot User ID Resolution Audit

**Date:** 2026-01-30  
**Issue:** Data being written to `telegram:b6898194425_c575596036` instead of `kckern`

## Problem Summary

Nutribot is writing user data to conversation-ID-based paths (`telegram:b6898194425_c575596036`) instead of resolved username paths (`kckern`), causing data fragmentation across multiple directories.

## Root Cause

The `platformUserId` field is `null` in input events, causing user resolution to fail and fall back to `conversationId`.

## Data Flow Analysis

```
1. Telegram webhook
   ↓
2. TelegramWebhookParser.parse() → adds metadata.from
   ↓
3. TelegramChatRef.fromTelegramUpdate() → extracts chatId from update
   ↓
4. toInputEvent(parsed, telegramRef) → sets platformUserId
   ↓
5. NutribotInputRouter.#resolveUserId() → calls userResolver.resolveUser(platform, platformUserId)
   ↓
6. UserResolver.resolveUser() → looks up in identityMappings
   ↓
7. ConfigService.resolveUsername() → checks config.identityMappings[platform][platformUserId]
   ↓
8. YamlFoodLogDatastore.#getPath(userId) → constructs file path
```

## Identity Mapping

**User Profile:** `/data/users/kckern/profile.yml`
```yaml
identities:
  telegram:
    user_id: "575596036"  # ← This is the USER ID (from.id)
```

**Identity Mappings (built from profiles):**
```javascript
{
  telegram: {
    "575596036": "kckern"  // platform ID → username
  }
}
```

## The Bug

In `toInputEvent()` ([IInputEvent.mjs:47](backend/src/1_adapters/telegram/IInputEvent.mjs#L47)):
```javascript
platformUserId: telegramRef ? telegramRef.platformUserId : parsed.metadata?.from?.id?.toString(),
```

The issue:
- `TelegramChatRef.platformUserId` returns the **chat ID** (from `update.callback_query.message.chat.id`)
- But the user profile has the **user ID** (from `update.callback_query.from.id`)
- For private chats, these MAY be the same, but the code should use `.from.id` for user identity resolution

## Evidence from Logs

Prod logs show `platformUserId: null` in recent events:
```json
{"event":"logImage.complete","conversationId":"telegram:b6898194425_c575596036","platformUserId":null}
{"event":"logUPC.complete","conversationId":"telegram:b6898194425_c575596036","platformUserId":null}
```

No "resolveUserId" logs found, suggesting resolution is failing silently and falling back.

## Current State

Two user directories exist:
1. `/data/users/kckern/` - Correct location with profile
2. `/data/users/telegram:b6898194425_c575596036/` - Fallback location with recent nutribot data
   - Only contains: `lifelog/nutrition/nutriday.yml` and `nutrilist.yml`
   - Created on 2026-01-30 at 13:02 (today)

## Scope of Impact

**All three bot routers are affected** by the same `platformUserId` extraction issue:

1. **NutribotInputRouter** ([src/1_adapters/nutribot/NutribotInputRouter.mjs:394](backend/src/1_adapters/nutribot/NutribotInputRouter.mjs#L394))
   - ✅ **CONFIRMED AFFECTED** - Writing to wrong directory
   - Uses `this.#resolveUserId(event)` which depends on `event.platformUserId`
   - All use cases (AcceptFoodLog, GenerateDailyReport, etc.) receive incorrect userId

2. **JournalistInputRouter** ([src/1_adapters/journalist/JournalistInputRouter.mjs:446](backend/src/1_adapters/journalist/JournalistInputRouter.mjs#L446))
   - ⚠️ **POTENTIALLY AFFECTED** - Same resolution logic
   - Uses `this.#resolveUserId()` with identical implementation
   - No incorrect data found yet (only nutribot data in telegram directory)
   - Would fail on callback-based interactions (button presses)

3. **HomeBotInputRouter** ([src/1_adapters/homebot/HomeBotInputRouter.mjs:169](backend/src/1_adapters/homebot/HomeBotInputRouter.mjs#L169))
   - ⚠️ **POTENTIALLY AFFECTED** - Same resolution logic
   - Uses `this.#resolveUserId()` with identical implementation
   - Would fail if using Telegram callbacks

## Recommended Fix

**Option 1:** Fix `TelegramChatRef.platformUserId` to return user ID instead of chat ID

**Core Issue:**
- `/backend/src/1_adapters/telegram/TelegramChatRef.mjs` - Chat reference (needs fix)
- `/backend/src/1_adapters/telegram/TelegramWebhookParser.mjs` - Webhook parser (correctly extracts from.id)
- `/backend/src/1_adapters/telegram/IInputEvent.mjs` - Event transformation (needs fix)

**Affected Routers (all have same bug):**
- `/backend/src/1_adapters/nutribot/NutribotInputRouter.mjs` - User resolution caller (CONFIRMED AFFECTED)
- `/backend/src/1_adapters/journalist/JournalistInputRouter.mjs` - User resolution caller (POTENTIALLY AFFECTED)
- `/backend/src/1_adapters/homebot/HomeBotInputRouter.mjs` - User resolution caller (POTENTIALLY AFFECTED)

**Identity Resolution Chain:**
- `/backend/src/0_system/users/UserResolver.mjs` - Identity resolver
- `/backend/src/0_system/config/configLoader.mjs` - Builds identity mappings
- `/data/users/kckern/profile.yml` - User profile with telegram user_id

**Data Persistence:**
- `/backend/src/1_adapters/persistence/yaml/YamlFoodLogDatastore.mjs` - File path construction
- `/backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs` - File path construction
- All nutribot use cases in `/backend/src/3_applications/nutribot/usecases/`7):
```javascript
platformUserId: parsed.metadata?.from?.id?.toString() || telegramRef?.platformUserId,
```
Prioritize `.from.id` over `telegramRef.platformUserId`.

## Migration Plan

Once fixed:
1. Test user resolution works correctly
2. Migrate data from `telegram:b6898194425_c575596036/` to `kckern/`
3. Clean up orphaned directory

## Related Files

- `/backend/src/1_adapters/telegram/TelegramChatRef.mjs` - Chat reference (needs fix)
- `/backend/src/1_adapters/telegram/TelegramWebhookParser.mjs` - Webhook parser (correctly extracts from.id)
- `/backend/src/1_adapters/telegram/IInputEvent.mjs` - Event transformation (needs fix)
- `/backend/src/1_adapters/nutribot/NutribotInputRouter.mjs` - User resolution caller
- `/backend/src/0_system/users/UserResolver.mjs` - Identity resolver
- `/backend/src/0_system/config/configLoader.mjs` - Builds identity mappings
- `/backend/src/1_adapters/persistence/yaml/YamlFoodLogDatastore.mjs` - File path construction
- `/data/users/kckern/profile.yml` - User profile with telegram user_id

## Status

- [x] Root cause identified
- [x] Fix implemented
- [ ] Fix tested (integration)
- [ ] Data migrated
- [ ] Cleanup completed

## Additional Findings

A second bug was discovered during implementation:
- `LogFoodFromUPC.mjs:137` and `SelectUPCPortion.mjs:81` were ignoring the passed `userId` parameter and extracting incorrectly from `conversationId` using `split('_').pop()`.
- This caused data to be written to `c575596036/` instead of `kckern/`.
- Both bugs have been fixed.
