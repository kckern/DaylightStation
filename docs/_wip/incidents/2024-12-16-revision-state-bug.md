# Incident Report: NutriBot Revision Flow State Not Persisting

**Date:** 2025-12-16  
**Status:** 🔴 ACTIVE  
**Severity:** HIGH  
**Impact:** Revision feature completely broken - users cannot edit food entries

---

## Executive Summary

When users press the "Revise" button on a food log, the system enters revision mode but subsequent text input is **incorrectly routed to `LogFoodFromText`** instead of `ProcessRevisionInput`, causing the error "I couldn't identify any food from your description."

---

## Timeline

| Time | Event |
|------|-------|
| 06:26:18 | User logs "1 apple" → `logText.complete` |
| 06:26:21 | User presses Revise button → `reviseLog.modeEnabled` |
| 06:26:33 | User types revision text → **NO `router.text.revision` log** |
| 06:26:33 | Result: "I couldn't identify any food" error |

---

## Root Cause Analysis

### Primary Issue: Router Not Detecting Revision State

The `UnifiedEventRouter` is supposed to check conversation state and route to `ProcessRevisionInput` when in revision mode. However, the router's state detection is failing.

**Expected Log Sequence:**
```
router.text.revision {"logUuid":"..."}   // Router detects revision state
processRevision.start                     // Routes to ProcessRevisionInput
processRevision.complete                  // Success
```

**Actual Log Sequence:**
```
webhook.processed (2645ms)                // Processed, but...
// NO router.text.revision log!
// NO processRevision.start log!
```

### State File Analysis

The state IS being saved correctly by `ReviseFoodLog`:

**File:** `data/journalist/nutribot/nutricursors/telegram:6898194425_575596036.yaml`
```yaml
activeFlow: revision
flowState:
  pendingLogUuid: c990fb7b-44b4-40dd-9829-961b72c6bfed
  originalMessageId: '5086'
updatedAt: '2025-12-16T06:26:21.336Z'
expiresAt: '2025-12-16T07:26:21.336Z'
```

State is correctly saved with:
- ✅ `activeFlow: revision`
- ✅ `flowState.pendingLogUuid` set
- ✅ File exists at correct path

### The Bug Location

**File:** `backend/chatbots/application/routing/UnifiedEventRouter.mjs` (lines 88-108)

```javascript
async #handleText(conversationId, text, messageId) {
  // Check conversation state for revision flow
  const conversationStateStore = this.#container.getConversationStateStore();
  if (conversationStateStore) {
    const state = await conversationStateStore.get(conversationId);
    
    if (state?.activeFlow === 'revision' && state?.flowState?.pendingLogUuid) {
      this.#logger.debug('router.text.revision', { logUuid: state.flowState.pendingLogUuid });
      const useCase = this.#container.getProcessRevisionInput();
      return useCase.execute({
        userId: conversationId,
        conversationId,
        text,
        messageId,
      });
    }
  }
  // Falls through to LogFoodFromText
}
```

### Hypothesis: State Store Not Returning Data

The state file exists, but `conversationStateStore.get()` may be:
1. **Returning null** - File not found or path mismatch
2. **Returning expired state** - TTL may have been exceeded
3. **StateStore not initialized** - Container may not have state store

---

## Investigation: Possible Causes

### Cause 1: ConversationId Format Mismatch

The state is saved under `telegram:6898194425_575596036` but there may be a mismatch in how the conversationId is constructed between:
- `TelegramInputAdapter.buildConversationId()` → `telegram:{botId}_{userId}`
- `FileConversationStateStore.#getPath()` → Uses `ChatId.from().toString()`

**Verification needed:** Add logging to see exact conversationId being passed to state store.

### Cause 2: Container Missing State Store

The NutribotContainer may not have the `conversationStateStore` properly initialized when the router is created.

**From api.mjs (line 86-88):**
```javascript
const conversationStateStore = new FileConversationStateStore({
  storePath: 'journalist/nutribot/nutricursors',
  logger
});
```

This looks correct, but we need to verify it's being passed to the container.

### Cause 3: State File Path Resolution

`FileConversationStateStore` uses `loadFile()` from `io.mjs` which prepends `backend/data/`. 

**Expected path:** `backend/data/journalist/nutribot/nutricursors/telegram:6898194425_575596036.yaml`

The file exists at this path, so path resolution appears correct.

### Cause 4: Async/Race Condition

State may be saved but not yet available when router reads it (unlikely given 12 second gap).

---

## Test Coverage Gap

### Why Tests Pass But Production Fails

**Current Test (WRONG):**
```javascript
// Calls ProcessRevisionInput directly - BYPASSES ROUTER!
const processRevisionInput = nutribot.getProcessRevisionInput();
await processRevisionInput.execute({ ... });
```

**Should Be (CORRECT):**
```javascript
// Route through UnifiedEventRouter - SAME AS PRODUCTION
const router = new UnifiedEventRouter(nutribot);
const event = createInputEvent({ type: 'TEXT', ... });
await router.route(event);
```

The test was passing because it called the use case directly, completely bypassing the router's state detection logic.

---

## Bugs Found and Fixed (So Far)

| # | Bug | File | Status |
|---|-----|------|--------|
| 1 | `state.flow` should be `state.activeFlow` | UnifiedEventRouter.mjs:96 | ✅ Fixed |
| 2 | `state.pendingLogUuid` should be `state.flowState?.pendingLogUuid` | UnifiedEventRouter.mjs:96 | ✅ Fixed |
| 3 | `item.name` should be `item.label` | ReviseFoodLog.mjs:67 | ✅ Fixed |
| 4 | `item.quantity` should be `item.amount` | ReviseFoodLog.mjs:65 | ✅ Fixed |
| 5 | Missing `updateItems()` method | NutriLogRepository.mjs | ✅ Added |
| 6 | Items not transformed to FoodItem format | ProcessRevisionInput.mjs | ✅ Fixed |
| 7 | Unit test used wrong state structure | UnifiedEventRouter.test.mjs | ✅ Fixed |
| 8 | Integration test bypassed router | RevisionBug.integration.test.mjs | ✅ Fixed |

**Despite all these fixes, the bug persists in production.**

---

## Next Steps to Debug

1. **Add verbose logging to FileConversationStateStore.get():**
   - Log the exact path being checked
   - Log whether file exists
   - Log the raw data loaded
   - Log any parsing errors

2. **Add logging to UnifiedEventRouter.#handleText():**
   - Log whether state store exists
   - Log the raw state returned
   - Log the exact condition being checked

3. **Verify container initialization:**
   - Log what dependencies are passed to NutribotContainer
   - Ensure getConversationStateStore() returns the FileConversationStateStore

4. **Check legacy code interference:**
   - The `journalist/foodlog_hook.mjs` has its own cursor system (`getNutriCursor`)
   - May be legacy routes still active that handle some messages

---

## Legacy Code Conflict

There are TWO systems handling NutriBot:

### New Framework (chatbots/)
- `UnifiedEventRouter` → `ProcessRevisionInput`
- State: `FileConversationStateStore` at `journalist/nutribot/nutricursors/`
- ConversationId: `telegram:{botId}_{userId}`

### Legacy Framework (journalist/)
- `foodlog_hook.mjs` → direct processing
- State: `getNutriCursor()` from `db.mjs`
- ChatId: `b{botId}_u{userId}`

The legacy `foodlog_hook.mjs` is 1030 lines and has its own:
- State management (`cursor.revising`, `cursor.adjusting`)
- Telegram message handling
- Food processing logic

**This dual system is a major source of complexity and potential bugs.**

---

## Recommended Actions

### Immediate (Debug)
1. Add debug logging to production
2. Identify exactly where state lookup fails
3. Deploy fix

### Short-term (Stabilize)
1. Remove legacy `foodlog_hook.mjs` fallback from api.mjs
2. Ensure ALL routes go through new framework
3. Add comprehensive integration tests through router

### Long-term (Cleanup)
1. Delete or archive legacy journalist/* code
2. Migrate any remaining functionality to chatbots/
3. Remove dual-state-management complexity

---

## Appendix: Key Files

| File | Purpose |
|------|---------|
| `backend/api.mjs` | Main router, initializes NutribotContainer |
| `backend/chatbots/application/routing/UnifiedEventRouter.mjs` | Routes events to use cases |
| `backend/chatbots/infrastructure/persistence/FileConversationStateStore.mjs` | Stores conversation state |
| `backend/chatbots/nutribot/application/usecases/ReviseFoodLog.mjs` | Enables revision mode |
| `backend/chatbots/nutribot/application/usecases/ProcessRevisionInput.mjs` | Processes revision text |
| `backend/journalist/foodlog_hook.mjs` | LEGACY - 1030 lines of conflicting code |

---

## Log Samples

### Successful Log (Test Environment)
```
[DEBUG] router.text {"conversationId":"cli:nutribot:revision-bug-1765865440739","textLength":11}
[DEBUG] state-store.get {"chatId":"cli:nutribot:revision-bug-1765865440739"}
[DEBUG] router.text.revision {"logUuid":"b55f26ae-1ae8-4252-91d1-c3a3ac537973"}
[DEBUG] processRevision.start {"conversationId":"cli:nutribot:revision-bug-1765865440739"}
[INFO] processRevision.complete {"logUuid":"b55f26ae-1ae8-4252-91d1-c3a3ac537973","itemCount":1}
```

### Failed Log (Production)
```
{"ts":"2025-12-16T06:26:21.338Z","level":"info","event":"reviseLog.modeEnabled","data":{"conversationId":"telegram:6898194425_575596036","logUuid":"c990fb7b-44b4-40dd-9829-961b72c6bfed"}}
{"ts":"2025-12-16T06:26:33.013Z","level":"info","event":"webhook.processed","data":{"traceId":"d0269ab0-19cf-4860-a3c9-be13cd340191","durationMs":2645}}
// NO router.text.revision log!
// NO processRevision.start log!
// NO state-store.get log!
```

**Critical Observation:** No `state-store.get` log in production means the state store lookup isn't even being attempted, OR the logging isn't reaching that code path.
