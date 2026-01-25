# Bot Wiring Audit Report

**Date:** 2026-01-24
**Scope:** Nutribot, Journalist, Homebot webhook and use case wiring
**Trigger:** Production errors after DDD migration webhook cutover

---

## Executive Summary

After cutting over Telegram webhooks to the new DDD backend, production logs revealed multiple wiring errors across all three bots. Investigation uncovered systematic antipatterns in how adapters communicate with use cases, leading to a comprehensive audit and refactoring.

**Key Findings:**
- Property name mismatches between router layer and use case layer
- Missing required dependencies (conversationStateStore) in two bots
- Inconsistent input shape expectations across similar use cases
- Telegram-specific knowledge leaking into application layer

---

## 1. Production Errors Encountered

### 1.1 Nutribot Errors

| Error | Location | Root Cause |
|-------|----------|------------|
| `Cannot read properties of undefined (reading 'fileId')` | LogFoodFromVoice | Router passed `fileId` directly; use case expected `voiceData: { fileId }` |
| `Cannot read properties of undefined (reading 'url')` | LogFoodFromImage | Router passed `fileId` directly; use case expected `imageData: { fileId, caption }` |
| `The "path" argument must be of type string. Received undefined` | AcceptFoodLog, DiscardFoodLog, ReviseFoodLog | Router passed `logId`; use cases expected `logUuid` |
| `webhook.callback.unknown` | WebhookHandler | Legacy callback format not mapped to new action constants |

### 1.2 Journalist Errors

| Error | Location | Root Cause |
|-------|----------|------------|
| `Cannot read properties of null (reading 'get')` | Multiple use cases | `conversationStateStore: null` in app.mjs bootstrap |

### 1.3 Homebot Errors

| Error | Location | Root Cause |
|-------|----------|------------|
| `conversationStateStore is required` | Container initialization | `conversationStateStore: null` in app.mjs bootstrap |

---

## 2. Antipatterns Identified

### 2.1 Telegram Knowledge in Application Layer

**Problem:** The original `WebhookHandler.mjs` in `3_applications/nutribot/handlers/` contained Telegram-specific concepts (callback acknowledgement, fileId handling).

**Principle Violated:** Application layer should be platform-agnostic. It should not know whether input came from Telegram, a REST API, or a CLI.

**Solution:** Created adapter layer components:
- `IInputEvent.mjs` - Platform-agnostic input event interface
- `createBotWebhookHandler.mjs` - Telegram-specific webhook handling
- `NutribotInputRouter.mjs` - Routes IInputEvents to use cases

### 2.2 Inconsistent Use Case Input Shapes

**Problem:** Similar use cases expected different input shapes:

```javascript
// LogFoodFromText expects:
{ userId, conversationId, text, messageId }

// LogFoodFromVoice expects:
{ userId, conversationId, voiceData: { fileId }, messageId }

// LogFoodFromImage expects:
{ userId, conversationId, imageData: { fileId, caption }, messageId }

// AcceptFoodLog expects:
{ userId, conversationId, logUuid, messageId }  // Note: logUuid, not logId
```

**Principle Violated:** Consistency and least surprise. Similar operations should have similar interfaces.

**Impact:** Easy to make typos (`logId` vs `logUuid`) that only fail at runtime.

### 2.3 Silent Null Dependencies

**Problem:** Bootstrap code passed `null` for required dependencies:

```javascript
// app.mjs - before fix
const journalistServices = createJournalistServices({
  // ...
  conversationStateStore: null,  // Required but null!
});
```

**Principle Violated:** Fail-fast. Required dependencies should fail at startup, not at first use.

**Impact:** Services appeared to start successfully but failed on first webhook.

### 2.4 No Input Validation at Boundaries

**Problem:** Use cases don't validate their input shapes, leading to cryptic errors deep in execution:

```
Cannot read properties of undefined (reading 'fileId')
```

Instead of:

```
LogFoodFromVoice: Missing required field 'voiceData.fileId'
```

**Principle Violated:** Validate at boundaries, fail with helpful messages.

---

## 3. Fixes Applied

### 3.1 New Shared Infrastructure

| File | Purpose |
|------|---------|
| `2_adapters/telegram/IInputEvent.mjs` | Standardized input event interface |
| `2_adapters/telegram/createBotWebhookHandler.mjs` | Factory for Telegram webhook handlers |
| `2_adapters/BaseInputRouter.mjs` | Abstract base class for input routing |
| `2_adapters/nutribot/NutribotInputRouter.mjs` | Nutribot-specific event routing |

### 3.2 Property Name Fixes (NutribotInputRouter)

```javascript
// Before (wrong)
case CallbackActions.ACCEPT_LOG:
  return await useCase.execute({
    userId: ...,
    logId: decoded.id,  // WRONG
    messageId: ...
  });

// After (correct)
case CallbackActions.ACCEPT_LOG:
  return await useCase.execute({
    userId: ...,
    conversationId: event.conversationId,  // Added
    logUuid: decoded.id,  // Fixed property name
    messageId: ...
  });
```

### 3.3 State Store Wiring (app.mjs)

```javascript
// Added for Journalist
const journalistStateStore = new YamlConversationStateStore({
  basePath: join(dataDir, 'chatbots', 'journalist', 'conversations')
});

// Added for Homebot
const homebotStateStore = new YamlConversationStateStore({
  basePath: join(dataDir, 'chatbots', 'homebot', 'conversations')
});
```

### 3.4 Router Refactoring

All three bot routers (`nutribot.mjs`, `journalist.mjs`, `homebot.mjs`) now use the shared `createBotWebhookHandler` pattern, reducing duplication and ensuring consistent error handling.

---

## 4. Additional Issues Found (Not Yet Fixed)

### 4.1 Nutribot

| Issue | Severity | Description |
|-------|----------|-------------|
| ReviseFoodLog `itemId` ignored | Low | Router passes `itemId` but use case doesn't use it |

### 4.2 Journalist

| Issue | Severity | Description |
|-------|----------|-------------|
| HandleSlashCommand missing `userId` | Medium | Hardcoded fallback to 'kckern' |
| No input validation | Low | Use cases accept any shape without validation |

### 4.3 Homebot

| Issue | Severity | Description |
|-------|----------|-------------|
| AssignItemToUser `websocketBroadcast` unused | Low | Receives but never stores/uses |
| Inconsistent `conversationStateStore.set()` | Low | ToggleCategory and ProcessGratitudeInput call with different signatures |

---

## 5. Recommendations

### 5.1 Immediate (Before Deploy)

1. **Review fixes above** - All critical errors are addressed
2. **Test callbacks manually** - Accept/Reject/Revise food logs
3. **Verify state persistence** - Check journalist and homebot can maintain conversation state

### 5.2 Short-term

1. **Add input validation** - Each use case should validate its input shape at the start
2. **Standardize use case interfaces** - Create consistent patterns for similar operations
3. **Add integration tests** - Cover webhook → use case → response flow

### 5.3 Long-term

1. **Use TypeScript or JSDoc types** - Catch property name mismatches at dev time
2. **Dependency injection validation** - Fail at startup if required deps are null
3. **Contract testing** - Verify adapter ↔ use case contracts match

---

## 6. Files Changed

```
backend/src/0_infrastructure/bootstrap.mjs         |   1 -
backend/src/2_adapters/homebot/HomeBotInputRouter.mjs  | 128 +++---
backend/src/2_adapters/journalist/JournalistInputRouter.mjs | 35 ++-
backend/src/2_adapters/telegram/index.mjs          |   2 +
backend/src/3_applications/nutribot/handlers/WebhookHandler.mjs | 20 +-
backend/src/4_api/routers/homebot.mjs              |  81 +---
backend/src/4_api/routers/journalist.mjs           |  92 +---
backend/src/4_api/routers/nutribot.mjs             |  73 +--
backend/src/app.mjs                                |  17 +-
```

---

## 7. Lessons Learned

1. **Test webhooks in staging first** - Catching these in prod was avoidable
2. **Property names matter** - `logId` vs `logUuid` caused production failures
3. **Null dependencies should fail fast** - Not on first user interaction
4. **Platform-specific code belongs in adapters** - Not in application layer
5. **Similar operations should have similar interfaces** - Reduces cognitive load and errors
