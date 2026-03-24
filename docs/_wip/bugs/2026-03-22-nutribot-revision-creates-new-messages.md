# Bug: Nutribot Revision Creates New Messages Instead of Updating Original

**Date:** 2026-03-22
**Severity:** High — revision flow is fundamentally broken in production
**Affected component:** `backend/src/1_adapters/nutribot/`, `backend/src/3_applications/nutribot/usecases/`

---

## Summary

When a user clicks "Revise" on a food log and types a revision instruction (e.g., "Double the recipe"), the system creates new messages instead of updating the original in-place. The original message is left behind with a stale "Cancel" button, and the revised food list appears in a separate new message.

## Observed Behavior (Production, 2026-03-22 14:58 UTC)

1. User logged 5 food items from an image → message shows items with Accept/Revise/Discard buttons (logUuid: `vpMIhhQn0r`)
2. User clicked "Revise" → message updated to show items with "Cancel" button (correct)
3. User typed "Double the recipe."
4. **NEW message appeared**: "Analyzing... 'Double the recipe.'" (wrong — should update original)
5. After ~17 seconds, the NEW message was updated with the doubled food list + Accept/Revise/Discard buttons
6. **Original message remained** with stale "Cancel" button (never cleaned up)

**Result:** Two messages in chat — the stale original and a new one with the revised items.

## Expected Behavior

The original message (the one showing the food log) should be updated in-place with the revised items. No new messages should be created. The flow should be: original message shows "Processing..." → original message shows revised items with Accept/Revise/Discard buttons.

## Root Cause Analysis

There are **three cascading failures** in the revision flow:

### Failure 1: Router State Lookup Fails — Wrong Code Path

**File:** `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs:31-56`

The router checks `this.container.getConversationStateStore?.()` to detect revision mode and route to `ProcessRevisionInput`. This lookup either returns null (container method doesn't exist) or the state lookup fails, so the text is routed to `LogFoodFromText` instead.

**Evidence:** Logs show `logText.start` (LogFoodFromText) instead of `processRevision.start` (ProcessRevisionInput). No router-level revision debug log is emitted.

### Failure 2: LogFoodFromText Creates a New Status Message Before Checking Revision

**File:** `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs:99-133`

`LogFoodFromText` does detect revision mode at lines 99-111, but then proceeds to create a NEW "Analyzing..." status message at lines 122-133 regardless. The revision handling at line 170 requires `foodItems.length > 0`, but the AI returns 0 items for "Double the recipe" (not a food description). So it falls through to `#tryRevisionFallback()` at line 194.

```
logText.start           → detects revision mode ✓
creates status message  → NEW message created ✗ (should use original)
AI call                 → 0 items returned (correct — not a food)
#handleRevision check   → skipped (needs items > 0)
#tryRevisionFallback    → handles revision but on the WRONG message
```

### Failure 3: tryRevisionFallback Doesn't Update Original Message or Clear State

**File:** `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs:597-683`

The fallback method updates `statusMsgId` (the new "Analyzing..." message) with the revised food list, not the `originalMessageId` from the conversation state. It also **never clears the conversation state**, leaving `activeFlow: 'revision'` set — meaning subsequent text messages will also hit the revision path.

The `originalMessageId` stored in `flowState` by `ReviseFoodLog` is never read by the fallback.

### Contributing Factor: `conversation.state.user_not_found`

**File:** `backend/src/1_adapters/messaging/YamlConversationStateDatastore.mjs:78-93`

The conversationId `telegram:b6898194425_c575596036` is parsed to extract userId `c575596036`, which doesn't resolve via `userResolver.resolveUser('telegram', 'c575596036')`. The store falls back to an `_unknown` user directory. This is consistent between `set()` and `get()` so the state is actually read/written correctly — the warning is noise. But it suggests the conversationId format may be misunderstood (the `c575596036` might be a chat ID, not a Telegram user ID).

## Flow Diagram (Actual vs Expected)

### Actual (Broken)
```
User clicks Revise
  → ReviseFoodLog: updates original msg with Cancel button ✓
  → Sets state: activeFlow='revision', pendingLogUuid, originalMessageId ✓

User types "Double the recipe."
  → Router: state check fails → routes to LogFoodFromText ✗
  → LogFoodFromText: detects revision mode
  → Creates NEW "Analyzing..." message ✗
  → AI returns 0 food items (not a food description)
  → #handleRevision skipped (needs items)
  → #tryRevisionFallback: calls AI with context → gets revised items
  → Updates the NEW message with revised items ✗
  → Original message left with stale "Cancel" button ✗
  → Conversation state NOT cleared ✗
```

### Expected (Correct)
```
User clicks Revise
  → ReviseFoodLog: updates original msg with Cancel button ✓

User types "Double the recipe."
  → Router: detects revision mode → routes to ProcessRevisionInput ✓
  → ProcessRevisionInput: updates ORIGINAL message with "Processing..." ✓
  → AI applies revision to existing items → gets revised items ✓
  → Updates ORIGINAL message with revised items and Accept/Revise/Discard ✓
  → Clears revision state ✓
  → Deletes user's text message ✓
```

## Affected Files

| File | Issue |
|------|-------|
| `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs:31-56` | `getConversationStateStore()` returns null or state lookup fails — revision mode not detected |
| `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs:113-133` | Creates new status message even when in revision mode |
| `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs:597-683` | `#tryRevisionFallback` doesn't use `originalMessageId`, doesn't clear state |
| `backend/src/3_applications/nutribot/usecases/ProcessRevisionInput.mjs` | Never reached due to router failure (this code works correctly if invoked) |
| `backend/src/1_adapters/messaging/YamlConversationStateDatastore.mjs:78-93` | `user_not_found` warning for conversationId userId extraction — benign but noisy |

## Fix Strategy

### Primary Fix: Ensure Router Routes to ProcessRevisionInput

The router at `NutribotInputRouter.mjs:33` calls `this.container.getConversationStateStore?.()`. Verify that:
1. The container actually exposes this method
2. The returned store is the same instance used by other use cases
3. The `get()` call works with the same conversationId format

If the container doesn't expose the store, the router can never detect revision mode and `ProcessRevisionInput` is dead code.

### Secondary Fix: LogFoodFromText Revision Path

If the router fix isn't feasible short-term, fix the fallback path in `LogFoodFromText`:

1. **Don't create new status message in revision mode** — when `isRevisionMode` is true, skip the status indicator creation and use the `originalMessageId` from state
2. **Route directly to contextual AI call** — when `isRevisionMode` is true, skip the generic food detection and go straight to the revision-aware prompt
3. **Clear conversation state after successful revision** — add `this.#conversationStateStore.clear(conversationId)` in `#tryRevisionFallback`
4. **Update the original message** — read `originalMessageId` from state and update that instead of the status message

### Cleanup Fix: User Resolution Warning

The `c575596036` in the conversationId format `telegram:b6898194425_c575596036` should be investigated. It may be a chat ID rather than a user ID. Either:
- Fix the parsing to use the correct segment as user ID
- Or register this ID in the user resolver mapping

## Log Evidence

```
14:58:43.584 WARN  conversation.state.user_not_found  userId=c575596036
14:58:43.585 INFO  reviseLog.stateSet                  activeFlow=revision
14:58:43.948 INFO  reviseLog.modeEnabled               logUuid=vpMIhhQn0r
14:58:56.395 INFO  logText.start                       text="Double the recipe."  ← WRONG use case
14:58:56.395 WARN  conversation.state.user_not_found   userId=c575596036
14:58:57.358 WARN  conversation.state.user_not_found   userId=c575596036
14:58:57.390 INFO  logText.revisionFallback             targetLogUuid=vpMIhhQn0r
14:59:14.110 INFO  logText.revisionFallback.success     itemCount=5
```

Note: `processRevision.start` never appears — `ProcessRevisionInput` was never invoked.
