# Nutribot Revision Message Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the nutribot "Revise" flow so revision instructions (e.g., "double the recipe") update the original message in-place instead of creating new messages, and properly clean up conversation state.

**Architecture:** The revision flow has two code paths: the router path (`NutribotInputRouter` → `ProcessRevisionInput`) and the fallback path (`LogFoodFromText` → `#tryRevisionFallback`). In production, the fallback path always runs because the router's state lookup is unreliable. We fix the fallback path to be first-class (short-circuit early, no new messages, proper cleanup), fix `ProcessRevisionInput` to use `responseContext`, and add diagnostic logging to the router.

**Tech Stack:** Node.js ES modules (.mjs), Express, Telegram Bot API, YAML-based state persistence

**Bug Report:** `docs/_wip/bugs/2026-03-22-nutribot-revision-creates-new-messages.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs` | Modify | Short-circuit revision mode: skip status message creation, skip generic AI call, go directly to revision-aware prompt, update original message, clear state |
| `backend/src/3_applications/nutribot/usecases/ProcessRevisionInput.mjs` | Modify | Accept and use `responseContext` instead of direct `messagingGateway` calls |
| `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs` | Modify | Add diagnostic logging when state check fails |
| `tests/isolated/nutribot/revision-flow.test.mjs` | Create | Unit tests for the revision flow in LogFoodFromText |

---

### Task 1: Fix LogFoodFromText — Short-Circuit Revision Mode

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs:91-215`

The core fix. When `isRevisionMode` is true, the `execute()` method should NOT create a new status message or call the generic food detection AI. Instead, it should immediately delegate to revision handling using the original message.

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/nutribot/revision-flow.test.mjs`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LogFoodFromText } from '../../../backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs';

describe('LogFoodFromText — revision mode', () => {
  let useCase;
  let mockMessaging;
  let mockAiGateway;
  let mockFoodLogStore;
  let mockStateStore;
  let mockResponseContext;

  const CONVERSATION_ID = 'telegram:bot_user';
  const PENDING_LOG_UUID = 'log-uuid-123';
  const ORIGINAL_MSG_ID = 'msg-456';

  const existingLog = {
    id: PENDING_LOG_UUID,
    status: 'pending',
    items: [
      { id: 'item-1', label: 'Green Peas', grams: 240, calories: 200, protein: 13, carbs: 36, fat: 1, unit: 'g', amount: 240, color: 'green', icon: 'peas', fiber: 0, sugar: 0, sodium: 0, cholesterol: 0 },
    ],
    meal: { date: '2026-03-22' },
    metadata: { source: 'image' },
  };

  beforeEach(() => {
    mockMessaging = {
      sendMessage: vi.fn().mockResolvedValue({ messageId: 'new-msg' }),
      updateMessage: vi.fn().mockResolvedValue({}),
      deleteMessage: vi.fn().mockResolvedValue({}),
      createStatusIndicator: vi.fn().mockResolvedValue({
        messageId: 'status-msg',
        finish: vi.fn().mockResolvedValue({}),
      }),
    };

    mockAiGateway = {
      chat: vi.fn().mockResolvedValue(JSON.stringify({
        date: '2026-03-22',
        items: [
          { name: 'Green Peas', icon: 'peas', noom_color: 'green', quantity: 1, unit: 'g', grams: 480, calories: 400, protein: 26, carbs: 72, fat: 2 },
        ],
      })),
    };

    mockFoodLogStore = {
      findByUuid: vi.fn().mockResolvedValue(existingLog),
      save: vi.fn().mockResolvedValue({}),
    };

    mockStateStore = {
      get: vi.fn().mockResolvedValue({
        activeFlow: 'revision',
        flowState: { pendingLogUuid: PENDING_LOG_UUID, originalMessageId: ORIGINAL_MSG_ID },
      }),
      set: vi.fn().mockResolvedValue({}),
      clear: vi.fn().mockResolvedValue({}),
    };

    mockResponseContext = {
      sendMessage: vi.fn().mockResolvedValue({ messageId: 'new-msg' }),
      updateMessage: vi.fn().mockResolvedValue({}),
      deleteMessage: vi.fn().mockResolvedValue({}),
      createStatusIndicator: vi.fn().mockResolvedValue({
        messageId: 'status-msg',
        finish: vi.fn().mockResolvedValue({}),
      }),
    };

    useCase = new LogFoodFromText({
      messagingGateway: mockMessaging,
      aiGateway: mockAiGateway,
      foodLogStore: mockFoodLogStore,
      conversationStateStore: mockStateStore,
      config: { getDefaultTimezone: () => 'America/Los_Angeles' },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
  });

  it('should NOT create a new status message when in revision mode', async () => {
    await useCase.execute({
      userId: 'kckern',
      conversationId: CONVERSATION_ID,
      text: 'Double the recipe.',
      messageId: 'user-msg-789',
      responseContext: mockResponseContext,
    });

    // Should NOT call createStatusIndicator or sendMessage for a new "Analyzing..." message
    expect(mockResponseContext.createStatusIndicator).not.toHaveBeenCalled();
    expect(mockResponseContext.sendMessage).not.toHaveBeenCalled();
  });

  it('should update the ORIGINAL message with revised items', async () => {
    await useCase.execute({
      userId: 'kckern',
      conversationId: CONVERSATION_ID,
      text: 'Double the recipe.',
      messageId: 'user-msg-789',
      responseContext: mockResponseContext,
    });

    // Should update the original message (ORIGINAL_MSG_ID), not a new one
    expect(mockResponseContext.updateMessage).toHaveBeenCalledWith(
      ORIGINAL_MSG_ID,
      expect.objectContaining({
        choices: expect.any(Array),
        inline: true,
      }),
    );
  });

  it('should clear conversation state after successful revision', async () => {
    await useCase.execute({
      userId: 'kckern',
      conversationId: CONVERSATION_ID,
      text: 'Double the recipe.',
      messageId: 'user-msg-789',
      responseContext: mockResponseContext,
    });

    expect(mockStateStore.clear).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it('should delete the user revision message', async () => {
    await useCase.execute({
      userId: 'kckern',
      conversationId: CONVERSATION_ID,
      text: 'Double the recipe.',
      messageId: 'user-msg-789',
      responseContext: mockResponseContext,
    });

    expect(mockResponseContext.deleteMessage).toHaveBeenCalledWith('user-msg-789');
  });

  it('should call AI with revision-aware prompt including original items', async () => {
    await useCase.execute({
      userId: 'kckern',
      conversationId: CONVERSATION_ID,
      text: 'Double the recipe.',
      messageId: 'user-msg-789',
      responseContext: mockResponseContext,
    });

    // AI should be called exactly once (not twice — once for generic detect then again for fallback)
    expect(mockAiGateway.chat).toHaveBeenCalledTimes(1);

    // The prompt should include original items context
    const prompt = mockAiGateway.chat.mock.calls[0][0];
    const systemContent = prompt.find(m => m.role === 'system')?.content || '';
    expect(systemContent).toContain('Green Peas');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/isolated/nutribot/revision-flow.test.mjs`
Expected: FAIL — tests should fail because LogFoodFromText currently creates a new status message and doesn't short-circuit.

- [ ] **Step 3: Implement the revision short-circuit in LogFoodFromText.execute()**

In `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs`, modify `execute()` to add a short-circuit after the revision mode detection (after line 111, before line 113). When `isRevisionMode && pendingLogUuid`, bypass the normal flow entirely:

```javascript
    // SHORT-CIRCUIT: If in revision mode, handle revision directly
    // Do NOT create new messages or call generic food detection
    if (isRevisionMode && pendingLogUuid) {
      this.#logger.info?.('logText.revisionShortCircuit', {
        conversationId, pendingLogUuid, originalMessageId, text,
      });

      return await this.#handleRevisionDirect({
        userId,
        conversationId,
        pendingLogUuid,
        originalMessageId,
        text,
        messageId,
        messaging,
      });
    }
```

Then add the `#handleRevisionDirect` method (a new private method) that:

1. Shows "Processing..." on the **original** message (using `originalMessageId` from state)
2. Loads the existing log
3. Calls AI with the revision-aware contextual prompt (includes original items)
4. Parses response
5. Updates the log with revised items
6. Clears conversation state
7. Updates the **original** message with revised items + Accept/Revise/Discard buttons
8. Deletes the user's text message

```javascript
  /**
   * Handle revision mode directly — no new messages, update original in-place
   * @private
   */
  async #handleRevisionDirect({ userId, conversationId, pendingLogUuid, originalMessageId, text, messageId, messaging }) {
    // 1. Load existing log
    let targetLog = null;
    if (this.#foodLogStore) {
      targetLog = await this.#foodLogStore.findByUuid(pendingLogUuid, userId);
    }

    if (!targetLog || targetLog.status !== 'pending') {
      this.#logger.warn?.('logText.revisionDirect.logNotFound', { conversationId, pendingLogUuid });
      // Clear stale revision state and fall through to normal flow
      if (this.#conversationStateStore) {
        await this.#conversationStateStore.clear(conversationId);
      }
      return null; // Caller should fall through to normal LogFoodFromText flow
    }

    // 2. Show processing indicator on the ORIGINAL message
    if (originalMessageId) {
      try {
        const isImageLog = targetLog.metadata?.source === 'image';
        const updatePayload = isImageLog
          ? { caption: '⏳ Processing revision...', choices: [], inline: true }
          : { text: '⏳ Processing revision...', choices: [], inline: true };
        await messaging.updateMessage(originalMessageId, updatePayload);
      } catch (e) {
        this.#logger.debug?.('logText.revisionDirect.processingIndicator.failed', { error: e.message });
      }
    }

    // 3. Delete user's text message
    if (messageId) {
      await this.#deleteMessageWithRetry(messaging, messageId);
    }

    // 4. Build contextual revision prompt with original items
    const originalItems = (targetLog.items || [])
      .map((item) => {
        const qty = item.quantity || item.amount || 1;
        const unit = item.unit || '';
        const name = item.label || item.name || 'Unknown';
        return `- ${qty} ${unit} ${name} (${item.calories || 0} cal)`;
      })
      .join('\n');

    const contextualText = `Original items:\n${originalItems}\n\nUser revision: "${text}"`;
    const prompt = this.#buildDetectionPrompt(contextualText);
    const response = await this.#aiGateway.chat(prompt, { maxTokens: 4096 });

    // 5. Parse response
    const { items: revisedItems, date: revisedDate, time: revisedTime } = this.#parseFoodResponse(response);
    const finalItems = revisedItems.length > 0 ? revisedItems : targetLog.items || [];

    if (finalItems.length === 0) {
      this.#logger.warn?.('logText.revisionDirect.noItems', { conversationId });
      // Restore original message with buttons
      if (originalMessageId) {
        const buttons = this.#buildActionButtons(targetLog.id);
        const logDate = targetLog.meal?.date || targetLog.date;
        const dateHeader = formatDateHeader(logDate, { timezone: this.#getTimezone(), now: new Date() });
        const foodList = formatFoodList(targetLog.items || []);
        const isImageLog = targetLog.metadata?.source === 'image';
        const restorePayload = isImageLog
          ? { caption: `${dateHeader}\n\n${foodList}`, choices: buttons, inline: true }
          : { text: `${dateHeader}\n\n${foodList}`, choices: buttons, inline: true };
        await messaging.updateMessage(originalMessageId, restorePayload);
      }
      return { success: false, error: 'Revision produced no items' };
    }

    // 6. Update log with revised items
    const revisionTimestamp = new Date();
    let updatedLog = targetLog.updateItems(finalItems, revisionTimestamp);

    if (revisedDate && revisedDate !== (targetLog.meal?.date || targetLog.date)) {
      updatedLog = updatedLog.updateDate(revisedDate, revisedTime, revisionTimestamp);
    }

    if (this.#foodLogStore) {
      await this.#foodLogStore.save(updatedLog);
    }

    // 7. Clear conversation state
    if (this.#conversationStateStore) {
      await this.#conversationStateStore.clear(conversationId);
      this.#logger.debug?.('logText.revisionDirect.stateCleared', { conversationId });
    }

    // 8. Update the ORIGINAL message with revised items + buttons
    const finalDate = updatedLog.meal?.date || updatedLog.date;
    const dateHeader = formatDateHeader(finalDate, { timezone: this.#getTimezone(), now: new Date() });
    const foodList = formatFoodList(finalItems);
    const buttons = this.#buildActionButtons(updatedLog.id);
    const messageToUpdate = originalMessageId;

    if (messageToUpdate) {
      const isImageLog = targetLog.metadata?.source === 'image';
      const updatePayload = isImageLog
        ? { caption: `${dateHeader}\n\n${foodList}`, choices: buttons, inline: true }
        : { text: `${dateHeader}\n\n${foodList}`, choices: buttons, inline: true };
      await messaging.updateMessage(messageToUpdate, updatePayload);
    } else {
      // No original message ID — send as new message (shouldn't happen)
      await messaging.sendMessage(`${dateHeader}\n\n${foodList}`, {
        choices: buttons,
        inline: true,
      });
    }

    this.#logger.info?.('logText.revisionDirect.complete', {
      conversationId,
      logUuid: updatedLog.id,
      itemCount: finalItems.length,
    });

    return {
      success: true,
      nutrilogUuid: updatedLog.id,
      messageId: messageToUpdate,
      itemCount: finalItems.length,
      revised: true,
    };
  }
```

The short-circuit in `execute()` handles the null return (log not found / stale state) by sending an error message — **never** falling through to the normal food detection flow, which would treat the revision text as a new food entry:

```javascript
    if (isRevisionMode && pendingLogUuid) {
      this.#logger.info?.('logText.revisionShortCircuit', {
        conversationId, pendingLogUuid, originalMessageId, text,
      });

      const revisionResult = await this.#handleRevisionDirect({
        userId, conversationId, pendingLogUuid, originalMessageId,
        text, messageId, messaging,
      });

      if (revisionResult) return revisionResult;

      // Stale revision state — log not found or not pending.
      // Do NOT fall through to normal food detection (would treat "double the recipe" as food).
      this.#logger.warn?.('logText.revisionShortCircuit.staleState', { conversationId, pendingLogUuid });
      await messaging.sendMessage('Your revision session has expired. Please log the food again and try revising.', {});
      if (messageId) await this.#deleteMessageWithRetry(messaging, messageId);
      return { success: false, error: 'Revision session expired' };
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/isolated/nutribot/revision-flow.test.mjs`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs tests/isolated/nutribot/revision-flow.test.mjs
git commit -m "fix(nutribot): short-circuit revision mode in LogFoodFromText

When in revision mode, skip new status message creation and generic
food detection. Directly load existing log, call AI with revision-aware
prompt, update the original message in-place, and clear state."
```

---

### Task 2: Fix #tryRevisionFallback — Clear State and Update Correct Message

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs:597-683`

Even though the short-circuit from Task 1 should handle most cases, the fallback should still work correctly as defense-in-depth. Two fixes:
1. Clear conversation state after successful revision
2. Read and use `originalMessageId` from state

- [ ] **Step 1: Verify fallback fixes via code inspection (no separate test needed)**

The `#tryRevisionFallback` path is defense-in-depth — the short-circuit in Task 1 now handles all revision cases. The fallback will only fire if somehow `isRevisionMode` is false but the state is still set (shouldn't happen). The fixes in Step 2 are small and mechanical (add `clear()` call, read `originalMessageId` from state). No new test is needed — the Task 1 tests already cover the primary flow.

- [ ] **Step 2: Fix #tryRevisionFallback to clear state and use originalMessageId**

In `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs`, modify `#tryRevisionFallback`:

At line ~605, after getting the state, also extract `originalMessageId`:

```javascript
    let pendingLogUuid = null;
    let originalMessageId = null;
    if (this.#conversationStateStore) {
      const state = await this.#conversationStateStore.get(conversationId);
      pendingLogUuid = state?.flowState?.pendingLogUuid;
      originalMessageId = state?.flowState?.originalMessageId;
    }
```

At line ~600, change `messageToUpdate` to prefer `originalMessageId`:

```javascript
    const messageToUpdate = originalMessageId || existingLogMessageId || statusMsgId;
```

After the log save (around line ~662), add state clearing:

```javascript
    // Clear revision state
    if (this.#conversationStateStore) {
      await this.#conversationStateStore.clear(conversationId);
      this.#logger.debug?.('logText.revisionFallback.stateCleared', { conversationId });
    }
```

And after updating the original message, delete the status message if it's different:

```javascript
    // Delete the status/"Analyzing..." message if we updated a different message
    if (statusMsgId && statusMsgId !== messageToUpdate) {
      try {
        await messaging.deleteMessage(statusMsgId);
      } catch (e) {
        this.#logger.debug?.('logText.revisionFallback.deleteStatus.failed', { error: e.message });
      }
    }
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/isolated/nutribot/revision-flow.test.mjs`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs
git commit -m "fix(nutribot): clear state and use originalMessageId in revision fallback

Defense-in-depth: if the short-circuit doesn't handle revision, the
fallback now clears conversation state, uses the original message ID,
and deletes the stale status message."
```

---

### Task 3: Fix ProcessRevisionInput — Use responseContext

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/ProcessRevisionInput.mjs:48-158`
- Modify: `backend/src/3_applications/nutribot/NutribotContainer.mjs:284-295`

`ProcessRevisionInput` uses `this.#messagingGateway.deleteMessage(conversationId, messageId)` and `this.#messagingGateway.updateMessage(conversationId, ...)` directly. The rest of the system passes `responseContext` which has simpler signatures (no conversationId parameter). This use case needs to accept and use `responseContext`.

**Note:** `ProcessRevisionInput` sets state to `activeFlow: 'food_confirmation'` after revision (line 118-124), while the new `#handleRevisionDirect` calls `clear()`. This is an intentional difference — `food_confirmation` was the original design for a multi-step flow, but in practice the Accept/Revise/Discard buttons handle confirmation via callbacks, not state-based routing. Both approaches work because the short-circuit only fires on `activeFlow === 'revision'`, and neither `food_confirmation` nor cleared state matches that condition.

- [ ] **Step 1: Write a failing test**

Add to `tests/isolated/nutribot/revision-flow.test.mjs`:

```javascript
import { ProcessRevisionInput } from '../../../backend/src/3_applications/nutribot/usecases/ProcessRevisionInput.mjs';

describe('ProcessRevisionInput — responseContext', () => {
  it('should use responseContext for message operations when available', async () => {
    const mockResponseContext = {
      updateMessage: vi.fn().mockResolvedValue({}),
      deleteMessage: vi.fn().mockResolvedValue({}),
      sendMessage: vi.fn().mockResolvedValue({ messageId: 'msg' }),
    };

    const mockStateStore = {
      get: vi.fn().mockResolvedValue({
        activeFlow: 'revision',
        flowState: { pendingLogUuid: 'log-1', originalMessageId: 'orig-msg' },
      }),
      set: vi.fn().mockResolvedValue({}),
      clear: vi.fn().mockResolvedValue({}),
    };

    const mockAi = {
      chat: vi.fn().mockResolvedValue(JSON.stringify({
        items: [{ name: 'Doubled Peas', noom_color: 'green', quantity: 1, unit: 'g', grams: 480, calories: 400, protein: 26, carbs: 72, fat: 2 }],
      })),
    };

    const mockLogStore = {
      findByUuid: vi.fn().mockResolvedValue({
        id: 'log-1',
        items: [{ label: 'Peas', grams: 240, calories: 200 }],
        meal: { date: '2026-03-22' },
        metadata: { source: 'text' },
      }),
      updateItems: vi.fn().mockResolvedValue({}),
    };

    const useCase = new ProcessRevisionInput({
      messagingGateway: { sendMessage: vi.fn(), updateMessage: vi.fn(), deleteMessage: vi.fn() },
      aiGateway: mockAi,
      foodLogStore: mockLogStore,
      conversationStateStore: mockStateStore,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:bot_user',
      text: 'Double the recipe.',
      messageId: 'user-msg',
      responseContext: mockResponseContext,
    });

    // Should use responseContext, not messagingGateway
    expect(mockResponseContext.deleteMessage).toHaveBeenCalledWith('user-msg');
    expect(mockResponseContext.updateMessage).toHaveBeenCalledWith(
      'orig-msg',
      expect.objectContaining({ choices: expect.any(Array) }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/nutribot/revision-flow.test.mjs`
Expected: FAIL — ProcessRevisionInput doesn't accept or use responseContext

- [ ] **Step 3: Modify ProcessRevisionInput to use responseContext**

In `ProcessRevisionInput.mjs`, add `responseContext` to the `execute` input destructuring (line 49):

```javascript
  async execute(input) {
    const { userId, conversationId, text, messageId, responseContext } = input;
```

Add a `#getMessaging` helper (same pattern as other use cases):

```javascript
  #getMessaging(responseContext, conversationId) {
    if (responseContext) return responseContext;
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates),
      deleteMessage: (msgId) => this.#messagingGateway.deleteMessage(conversationId, msgId),
    };
  }
```

Replace all direct `this.#messagingGateway.*` calls with `messaging.*` calls:

- Line 70: `await this.#messagingGateway.deleteMessage(conversationId, messageId)` → `await messaging.deleteMessage(messageId)`
- Line 80: `await this.#messagingGateway.updateMessage(conversationId, originalMessageId, {...})` → `await messaging.updateMessage(originalMessageId, {...})`
- Line 107: `await this.#messagingGateway.sendMessage(conversationId, ...)` → `await messaging.sendMessage(...)`
- Line 136: `await this.#messagingGateway.updateMessage(conversationId, originalMessageId, ...)` → `await messaging.updateMessage(originalMessageId, ...)`
- Line 138: `await this.#messagingGateway.sendMessage(conversationId, ...)` → `await messaging.sendMessage(...)`

Initialize `messaging` at the top of `execute`:

```javascript
    const messaging = this.#getMessaging(responseContext, conversationId);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/nutribot/revision-flow.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/ProcessRevisionInput.mjs
git commit -m "fix(nutribot): ProcessRevisionInput uses responseContext

Align with other use cases by accepting responseContext and using it
for message operations instead of calling messagingGateway with
conversationId directly."
```

---

### Task 4: Add Router Diagnostic Logging

**Files:**
- Modify: `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs:31-56`

We can't determine from current logs why the router's state check fails. Add logging to make it observable.

- [ ] **Step 1: Add logging to handleText state check**

In `NutribotInputRouter.mjs`, modify the `handleText` method (lines 31-56). Add logging at each decision point:

```javascript
  async handleText(event, responseContext) {
    // Check if we're in revision mode
    const conversationStateStore = this.container.getConversationStateStore?.();

    if (!conversationStateStore) {
      this.logger.debug?.('nutribot.handleText.noStateStore');
    }

    if (conversationStateStore) {
      try {
        const state = await conversationStateStore.get(event.conversationId);
        const pendingLogUuid = state?.flowState?.pendingLogUuid;

        this.logger.debug?.('nutribot.handleText.stateCheck', {
          conversationId: event.conversationId,
          hasState: !!state,
          activeFlow: state?.activeFlow || null,
          hasPendingLogUuid: !!pendingLogUuid,
        });

        if (state?.activeFlow === 'revision' && pendingLogUuid) {
          this.logger.info?.('nutribot.handleText.revisionRouted', {
            conversationId: event.conversationId,
            pendingLogUuid,
            text: event.payload.text?.substring(0, 50),
          });
          // Route to ProcessRevisionInput
          const useCase = this.container.getProcessRevisionInput();
          const result = await useCase.execute({
            userId: this.#resolveUserId(event),
            conversationId: event.conversationId,
            logUuid: pendingLogUuid,
            text: event.payload.text,
            messageId: event.messageId,
            responseContext,
          });
          return { ok: true, result };
        }
      } catch (e) {
        this.logger.warn?.('nutribot.handleText.stateCheck.error', {
          conversationId: event.conversationId,
          error: e.message,
        });
      }
    }

    // Default: log new food
    const useCase = this.container.getLogFoodFromText();
    // ... rest unchanged
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `npx vitest run tests/isolated/nutribot/`
Expected: PASS — logging changes are additive

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/nutribot/NutribotInputRouter.mjs
git commit -m "fix(nutribot): add diagnostic logging to router revision state check

Log state check results in handleText so we can observe why the router
falls through to LogFoodFromText instead of ProcessRevisionInput."
```

---

### Task 5: Integration Verification

No code changes. Deploy and test in production.

- [ ] **Step 1: Build and deploy**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .

sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 2: Test the revision flow end-to-end**

1. Send a food photo or text to the nutribot Telegram bot
2. Click "Revise" on the food log message
3. Type "Double the recipe."
4. **Verify:** The original message updates in-place with doubled values — no new messages
5. **Verify:** The "Cancel" button is gone, replaced with Accept/Revise/Discard
6. **Verify:** Accepting the revised log works normally

- [ ] **Step 3: Check logs for new diagnostic output**

```bash
sudo docker logs daylight-station 2>&1 | grep -E "revisionShortCircuit|revisionDirect|stateCheck|revisionRouted" | tail -20
```

Verify that either `revisionShortCircuit` (LogFoodFromText handled it) or `revisionRouted` (router handled it) appears. If `stateCheck` shows `hasState: false`, that confirms the router issue and the short-circuit is correctly compensating.

- [ ] **Step 4: Archive the bug report**

Move `docs/_wip/bugs/2026-03-22-nutribot-revision-creates-new-messages.md` to `docs/_archive/` if all tests pass.
