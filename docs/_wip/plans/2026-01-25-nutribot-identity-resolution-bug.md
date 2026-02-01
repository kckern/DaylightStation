# Bug Report: Nutribot Identity Resolution Failure

**Date:** 2026-01-25  
**Severity:** High  
**Module:** Nutribot Webhook / Identity Resolution  
**Status:** 🔍 Under Investigation  

---

## Executive Summary

Nutribot is saving user data to conversation-ID-based paths (`telegram:b6898194425_c575596036`) instead of resolved username paths (`kckern`). This causes:
- Data fragmentation across multiple user directories
- Report generation showing 0 calories (can't find the correct data files)
- Potential data loss for affected users

---

## Observed Behavior

### Symptom
Data files are being created at:
```
data/users/telegram:b6898194425_c575596036/lifelog/nutrition/
```

Instead of the expected:
```
data/users/kckern/lifelog/nutrition/
```

### Impact
- Daily reports show "0 cal" because they look in the wrong directory
- New food logs are inaccessible to existing report infrastructure
- User data is fragmented across multiple paths

---

## Root Cause Analysis

### Identity Resolution Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Telegram Webhook Request                        │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  TelegramWebhookParser.parse()                                      │
│  Extracts: from.id, chat.id, message content                        │
│  Output: { userId, metadata: { from: { id: 575596036 } } }          │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  toInputEvent(parsed, telegramRef)                                  │
│  Creates IInputEvent with:                                          │
│    - platform: 'telegram'                                           │
│    - platformUserId: telegramRef.platformUserId OR from.id          │
│    - conversationId: 'telegram:b{botId}_c{chatId}'                  │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  NutribotInputRouter.#resolveUserId(event)                          │
│                                                                     │
│  if (userResolver && event.platform && event.platformUserId) {      │
│    username = userResolver.resolveUser(platform, platformUserId)    │
│    if (username) return username;  // ✅ Should return 'kckern'     │
│  }                                                                  │
│  return event.conversationId;  // ❌ Fallback being hit             │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  UserResolver.resolveUser('telegram', '575596036')                  │
│                                                                     │
│  Looks up: chatbotsConfig.identity_mappings.telegram['575596036']   │
│  Expected: 'kckern'                                                 │
│  Actual: ??? (possibly null or not reached)                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Configuration (Correct)

**chatbots.yml:**
```yaml
identity_mappings:
  telegram:
    "575596036": kckern
```

### Suspected Failure Points

| # | Condition | Expected | Suspected Issue |
|---|-----------|----------|-----------------|
| 1 | `this.#userResolver` | `UserResolver instance` | May be `null` if not passed to NutribotInputRouter |
| 2 | `event.platform` | `'telegram'` | May be `undefined` if toInputEvent not called |
| 3 | `event.platformUserId` | `'575596036'` | May be `undefined` if TelegramChatRef fails |
| 4 | `resolveUser()` return | `'kckern'` | May return `null` if config not loaded |

### Most Likely Cause

Based on code review, the most likely cause is **condition #1 or #3**:

1. **userResolver not passed**: If the router construction doesn't receive `userResolver`, identity resolution is skipped entirely.

2. **platformUserId extraction failure**: The `TelegramChatRef.platformUserId` getter returns `chatId`, but `toInputEvent` falls back to `from.id` only when `telegramRef` is null. If `TelegramChatRef.fromTelegramUpdate()` fails silently, `telegramRef` could be null.

---

## Debug Logging Added

Added diagnostic logging to [NutribotInputRouter.mjs](backend/src/2_adapters/nutribot/NutribotInputRouter.mjs#L208):

```javascript
#resolveUserId(event) {
  this.logger.debug?.('nutribot.resolveUserId.attempt', {
    hasUserResolver: !!this.#userResolver,
    platform: event.platform,
    platformUserId: event.platformUserId,
    conversationId: event.conversationId,
  });
  // ... resolution logic ...
}
```

**Events to monitor:**
- `nutribot.resolveUserId.attempt` - Shows input values
- `nutribot.resolveUserId.resolved` - Successful resolution
- `nutribot.resolveUserId.skipResolution` - Which condition failed
- `nutribot.userResolver.notFound` - Mapping not found

---

## Recommendations

### Immediate Fix

1. **Verify userResolver is passed** in [app.mjs](backend/src/app.mjs#L692):
   ```javascript
   v1Routers.nutribot = createNutribotApiRouter({
     nutribotServices,
     userResolver,  // ← Verify this is not undefined
     // ...
   });
   ```

2. **Add constructor validation** in NutribotInputRouter:
   ```javascript
   constructor(container, options = {}) {
     super(container, options);
     this.#userResolver = options.userResolver;
     if (!this.#userResolver) {
       this.logger.warn?.('nutribot.userResolver.missing', {
         message: 'Identity resolution will use conversationId fallback'
       });
     }
   }
   ```

### Data Migration

After fixing, migrate affected data:
```bash
# Move data from conversation-ID path to username path
mv "data/users/telegram:b6898194425_c575596036/lifelog/nutrition/"* \
   "data/users/kckern/lifelog/nutrition/"
```

### Long-term Improvements

1. **Fail-fast validation**: Throw error if userResolver is missing in production
2. **Audit trail**: Log resolved userIds in food log entries for debugging
3. **Unit tests**: Add tests verifying identity resolution with mock userResolver

---

## Files Involved

| File | Role |
|------|------|
| [NutribotInputRouter.mjs](backend/src/2_adapters/nutribot/NutribotInputRouter.mjs) | Identity resolution logic |
| [UserResolver.mjs](backend/src/0_infrastructure/users/UserResolver.mjs) | Platform → username mapping |
| [TelegramChatRef.mjs](backend/src/2_adapters/telegram/TelegramChatRef.mjs) | Platform ID extraction |
| [IInputEvent.mjs](backend/src/2_adapters/telegram/IInputEvent.mjs) | Event transformation |
| [createBotWebhookHandler.mjs](backend/src/2_adapters/telegram/createBotWebhookHandler.mjs) | Webhook processing |
| [nutribot.mjs (router)](backend/src/4_api/routers/nutribot.mjs) | Router creation |
| [app.mjs](backend/src/app.mjs) | Dependency injection |

---

## Next Steps

1. [ ] Trigger a nutribot message and check dev logs for `resolveUserId` events
2. [ ] Identify which condition is failing
3. [ ] Apply targeted fix
4. [ ] Migrate affected user data
5. [ ] Deploy fix to production
6. [ ] Verify reports work correctly

---

## Related Issues

- [2026-01-25-nutribot-file-extension-bug-report.md](2026-01-25-nutribot-file-extension-bug-report.md) - YAML file extension mismatch (fixed)

---

**Report Prepared By:** GitHub Copilot  
**Reviewed By:** _________________  
**Date:** 2026-01-25
