# Nutribot Image Retry Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `LogFoodFromImage` hits a hard error and a status photo exists, attach an inline `🔄 Retry` button under the failure caption so the user can re-run detection against the same image.

**Architecture:** Write retry state (`{ imageData, retryMessageId }`) to `conversationStateStore` on failure. Callback `{cmd: 'ir'}` dispatches to a new `RetryImageDetection` use case that clears state, deletes the stale error photo, and delegates to `LogFoodFromImage.execute` with the stored `imageData`. Callback payload stays tiny; all data lives in conversation state (Telegram's 64-byte callback_data limit would otherwise overflow on a `fileId`).

**Tech Stack:** Node.js ESM, Jest (isolated tests), existing DDD structure (`1_adapters/nutribot`, `3_applications/nutribot`).

**Spec:** `docs/superpowers/specs/2026-04-20-nutribot-image-retry-button-design.md`

---

## File Structure

**New files:**
- `backend/src/3_applications/nutribot/usecases/RetryImageDetection.mjs` — new use case, single responsibility: validate retry state, clean up old photo, delegate to `LogFoodFromImage`.
- `tests/isolated/nutribot/image-retry.test.mjs` — isolated tests for the new use case and the `LogFoodFromImage` catch-path changes.

**Modified files:**
- `backend/src/1_adapters/nutribot/lib/callback.mjs` — add `RETRY_IMAGE` constant.
- `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs` — dispatch `'ir'` callbacks; extend legacy action map.
- `backend/src/3_applications/nutribot/usecases/index.mjs` — re-export `RetryImageDetection`.
- `backend/src/3_applications/nutribot/NutribotContainer.mjs` — wire up `getRetryImageDetection()`, add private field, import.
- `backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs` — in the outer catch, write retry state and include retry button in the error-caption update.

---

## Task 1: Add `RETRY_IMAGE` to `CallbackActions`

**Files:**
- Modify: `backend/src/1_adapters/nutribot/lib/callback.mjs:33-42`

- [ ] **Step 1: Add the constant**

Change the `CallbackActions` object to include the new entry:

```javascript
export const CallbackActions = {
  ACCEPT_LOG: 'accept_log',
  REJECT_LOG: 'reject_log',
  DELETE_LOG: 'delete_log',
  REVISE_ITEM: 'revise_item',
  CANCEL_REVISION: 'cancel_revision',
  DATE_SELECT: 'date_select',
  PORTION_ADJUST: 'portion_adjust',
  CONFIRM_ALL: 'confirm_all',
  RETRY_IMAGE: 'retry_image'
};
```

- [ ] **Step 2: Verify nothing broke**

Run: `npx jest tests/isolated/nutribot/revision-flow.test.mjs --silent`
Expected: PASS (existing tests unaffected)

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/nutribot/lib/callback.mjs
git commit -m "feat(nutribot): add RETRY_IMAGE callback action"
```

---

## Task 2: Create `RetryImageDetection` use case — failing tests

**Files:**
- Create: `tests/isolated/nutribot/image-retry.test.mjs`

- [ ] **Step 1: Write the test file with the `RetryImageDetection` suite**

```javascript
/**
 * Image Retry Tests
 *
 * - RetryImageDetection: validates state, cleans up stale photo, delegates to LogFoodFromImage.
 * - LogFoodFromImage catch path: writes retry state and attaches retry button on hard failure.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RetryImageDetection } from '#apps/nutribot/usecases/RetryImageDetection.mjs';

function buildRetryDeps(overrides = {}) {
  const conversationStateStore = {
    get: jest.fn().mockResolvedValue({
      activeFlow: 'image_retry',
      flowState: {
        imageData: { fileId: 'tg-file-abc' },
        retryMessageId: 'photo-msg-1',
      },
    }),
    clear: jest.fn().mockResolvedValue({}),
  };

  const logFoodFromImage = {
    execute: jest.fn().mockResolvedValue({ success: true, nutrilogUuid: 'uuid-1', messageId: 'new-photo-2', itemCount: 1 }),
  };

  const messagingGateway = {
    sendMessage: jest.fn().mockResolvedValue({ messageId: 'gw-msg-1' }),
    deleteMessage: jest.fn().mockResolvedValue({}),
  };

  const responseContext = {
    sendMessage: jest.fn().mockResolvedValue({ messageId: 'ctx-msg-1' }),
    deleteMessage: jest.fn().mockResolvedValue({}),
  };

  const logger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  return {
    conversationStateStore,
    logFoodFromImage,
    messagingGateway,
    responseContext,
    logger,
    ...overrides,
  };
}

describe('RetryImageDetection', () => {
  let deps;
  let useCase;

  beforeEach(() => {
    deps = buildRetryDeps();
    useCase = new RetryImageDetection(deps);
  });

  it('reads state, clears it, deletes old photo, and delegates to LogFoodFromImage', async () => {
    const result = await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:conv-1',
      responseContext: deps.responseContext,
    });

    expect(deps.conversationStateStore.clear).toHaveBeenCalledWith('telegram:conv-1');
    expect(deps.responseContext.deleteMessage).toHaveBeenCalledWith('photo-msg-1');

    expect(deps.logFoodFromImage.execute).toHaveBeenCalledTimes(1);
    const [input] = deps.logFoodFromImage.execute.mock.calls[0];
    expect(input.imageData).toEqual({ fileId: 'tg-file-abc' });
    expect(input.conversationId).toBe('telegram:conv-1');
    expect(input.userId).toBe('kckern');
    expect(input.messageId).toBeNull();
    expect(input.responseContext).toBe(deps.responseContext);

    expect(result).toEqual({ success: true, nutrilogUuid: 'uuid-1', messageId: 'new-photo-2', itemCount: 1 });
  });

  it('returns stale when state is missing', async () => {
    deps.conversationStateStore.get.mockResolvedValue(null);
    useCase = new RetryImageDetection(deps);

    const result = await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:conv-1',
      responseContext: deps.responseContext,
    });

    expect(result).toEqual({ success: false, error: 'stale' });
    expect(deps.responseContext.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('no longer available')
    );
    expect(deps.logFoodFromImage.execute).not.toHaveBeenCalled();
    expect(deps.conversationStateStore.clear).not.toHaveBeenCalled();
  });

  it('returns stale when activeFlow is not image_retry', async () => {
    deps.conversationStateStore.get.mockResolvedValue({
      activeFlow: 'revision',
      flowState: { imageData: { fileId: 'anything' } },
    });
    useCase = new RetryImageDetection(deps);

    const result = await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:conv-1',
      responseContext: deps.responseContext,
    });

    expect(result).toEqual({ success: false, error: 'stale' });
    expect(deps.logFoodFromImage.execute).not.toHaveBeenCalled();
  });

  it('returns stale when imageData.fileId is missing', async () => {
    deps.conversationStateStore.get.mockResolvedValue({
      activeFlow: 'image_retry',
      flowState: { retryMessageId: 'photo-msg-1' },
    });
    useCase = new RetryImageDetection(deps);

    const result = await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:conv-1',
      responseContext: deps.responseContext,
    });

    expect(result).toEqual({ success: false, error: 'stale' });
    expect(deps.logFoodFromImage.execute).not.toHaveBeenCalled();
  });

  it('proceeds when delete of old photo fails', async () => {
    deps.responseContext.deleteMessage.mockRejectedValue(new Error('Message to delete not found'));
    useCase = new RetryImageDetection(deps);

    const result = await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:conv-1',
      responseContext: deps.responseContext,
    });

    expect(deps.logFoodFromImage.execute).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(deps.logger.debug).toHaveBeenCalledWith(
      'retryImage.deleteOldPhoto.failed',
      expect.any(Object)
    );
  });

  it('falls back to messagingGateway.sendMessage for stale when no responseContext', async () => {
    deps.conversationStateStore.get.mockResolvedValue(null);
    useCase = new RetryImageDetection(deps);

    const result = await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:conv-1',
      responseContext: null,
    });

    expect(result).toEqual({ success: false, error: 'stale' });
    expect(deps.messagingGateway.sendMessage).toHaveBeenCalledWith(
      'telegram:conv-1',
      expect.stringContaining('no longer available')
    );
  });

  it('throws during construction if required deps are missing', () => {
    expect(() => new RetryImageDetection({ logFoodFromImage: {} })).toThrow(/conversationStateStore/);
    expect(() => new RetryImageDetection({ conversationStateStore: {} })).toThrow(/logFoodFromImage/);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx jest tests/isolated/nutribot/image-retry.test.mjs --silent`
Expected: FAIL — cannot find module `RetryImageDetection.mjs`.

---

## Task 3: Create `RetryImageDetection` use case — implementation

**Files:**
- Create: `backend/src/3_applications/nutribot/usecases/RetryImageDetection.mjs`
- Modify: `backend/src/3_applications/nutribot/usecases/index.mjs`

- [ ] **Step 1: Write the use case**

Create `backend/src/3_applications/nutribot/usecases/RetryImageDetection.mjs`:

```javascript
/**
 * Retry Image Detection Use Case
 * @module nutribot/usecases/RetryImageDetection
 *
 * Handles the 'ir' retry callback emitted by a failed LogFoodFromImage.
 * Reads retry state from conversationStateStore, cleans up the stale
 * error-caption photo, and re-invokes LogFoodFromImage with the stored
 * imageData.
 */

export class RetryImageDetection {
  #conversationStateStore;
  #logFoodFromImage;
  #messagingGateway;
  #logger;

  constructor(deps) {
    if (!deps.conversationStateStore) throw new Error('conversationStateStore is required');
    if (!deps.logFoodFromImage) throw new Error('logFoodFromImage is required');

    this.#conversationStateStore = deps.conversationStateStore;
    this.#logFoodFromImage = deps.logFoodFromImage;
    this.#messagingGateway = deps.messagingGateway;
    this.#logger = deps.logger || console;
  }

  async execute({ userId, conversationId, responseContext }) {
    const state = await this.#conversationStateStore.get(conversationId);
    const flowState = state?.flowState;

    if (state?.activeFlow !== 'image_retry' || !flowState?.imageData?.fileId) {
      this.#logger.info?.('retryImage.stale', { conversationId, hasState: !!state });
      const staleMessage = '🚫 This retry is no longer available.';
      if (responseContext?.sendMessage) {
        await responseContext.sendMessage(staleMessage);
      } else if (this.#messagingGateway?.sendMessage) {
        await this.#messagingGateway.sendMessage(conversationId, staleMessage);
      }
      return { success: false, error: 'stale' };
    }

    const { imageData, retryMessageId } = flowState;

    await this.#conversationStateStore.clear(conversationId);

    if (retryMessageId) {
      try {
        if (responseContext?.deleteMessage) {
          await responseContext.deleteMessage(retryMessageId);
        } else if (this.#messagingGateway?.deleteMessage) {
          await this.#messagingGateway.deleteMessage(conversationId, retryMessageId);
        }
      } catch (e) {
        this.#logger.debug?.('retryImage.deleteOldPhoto.failed', { error: e.message });
      }
    }

    this.#logger.info?.('retryImage.dispatch', { conversationId, fileId: imageData.fileId });

    return await this.#logFoodFromImage.execute({
      userId,
      conversationId,
      imageData,
      messageId: null,
      responseContext,
    });
  }
}

export default RetryImageDetection;
```

- [ ] **Step 2: Export from the usecases index**

Add to `backend/src/3_applications/nutribot/usecases/index.mjs`. Insert after the `LogFoodFromUPC` / `SelectUPCPortion` exports, in a new `// Image Retry` section before `// Revision Flow`:

```javascript
// Image Retry
export { RetryImageDetection } from './RetryImageDetection.mjs';
```

- [ ] **Step 3: Run the tests**

Run: `npx jest tests/isolated/nutribot/image-retry.test.mjs --silent`
Expected: PASS (all seven `RetryImageDetection` tests pass).

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/RetryImageDetection.mjs \
         backend/src/3_applications/nutribot/usecases/index.mjs \
         tests/isolated/nutribot/image-retry.test.mjs
git commit -m "feat(nutribot): add RetryImageDetection use case"
```

---

## Task 4: Wire `RetryImageDetection` into `NutribotContainer`

**Files:**
- Modify: `backend/src/3_applications/nutribot/NutribotContainer.mjs`

- [ ] **Step 1: Add the import**

In the `import { ... } from './usecases/index.mjs';` block near the top of the file, add `RetryImageDetection` in alphabetical neighborhood with the other logging use cases (just below `LogFoodFromUPC`):

```javascript
import {
  LogFoodFromImage,
  LogFoodFromText,
  LogFoodFromVoice,
  LogFoodFromUPC,
  RetryImageDetection,
  AcceptFoodLog,
  // ... rest unchanged
} from './usecases/index.mjs';
```

- [ ] **Step 2: Add the private field**

Find the section of private field declarations for use cases (look for `#logFoodFromImage;`). Add a new private field immediately after it:

```javascript
  #retryImageDetection;
```

- [ ] **Step 3: Add the factory method**

Immediately after the `getLogFoodFromUPC()` method (ends with `return this.#logFoodFromUPC;`), add:

```javascript
  getRetryImageDetection() {
    if (!this.#retryImageDetection) {
      this.#retryImageDetection = new RetryImageDetection({
        conversationStateStore: this.#conversationStateStore,
        logFoodFromImage: this.getLogFoodFromImage(),
        messagingGateway: this.getMessagingGateway(),
        logger: this.#logger,
      });
    }
    return this.#retryImageDetection;
  }
```

- [ ] **Step 4: Verify no regressions**

Run: `npx jest tests/isolated/nutribot/ --silent`
Expected: PASS (revision-flow + image-retry suites both pass).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/NutribotContainer.mjs
git commit -m "feat(nutribot): wire RetryImageDetection into container"
```

---

## Task 5: Dispatch `'ir'` callbacks in `NutribotInputRouter`

**Files:**
- Modify: `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs:128-199`

- [ ] **Step 1: Extend the legacy action map**

Locate the `legacyActionMap` object inside `handleCallback` (around line 135). Add the new mapping:

```javascript
    const legacyActionMap = {
      a: CallbackActions.ACCEPT_LOG,
      r: CallbackActions.REVISE_ITEM,
      x: CallbackActions.REJECT_LOG,
      ir: CallbackActions.RETRY_IMAGE,
    };
```

- [ ] **Step 2: Add the switch case**

Inside the same `switch (action)` block, after the existing `case 'p'` and `case 'ra'` cases (and before the `default` case if any), add:

```javascript
      case CallbackActions.RETRY_IMAGE: {
        const useCase = this.container.getRetryImageDetection();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          responseContext,
        });
      }
```

If there is no `default` case, place it before the closing `}` of the switch. Confirm by reading the file around line 199 before editing.

- [ ] **Step 3: Verify existing behaviour**

Run: `npx jest tests/isolated/nutribot/ --silent`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/1_adapters/nutribot/NutribotInputRouter.mjs
git commit -m "feat(nutribot): dispatch 'ir' callbacks to RetryImageDetection"
```

---

## Task 6: Write failing tests for `LogFoodFromImage` catch-path changes

**Files:**
- Modify: `tests/isolated/nutribot/image-retry.test.mjs`

- [ ] **Step 1: Append the `LogFoodFromImage — retry button on failure` describe block**

Append to the bottom of `tests/isolated/nutribot/image-retry.test.mjs`:

```javascript
import { LogFoodFromImage } from '#apps/nutribot/usecases/LogFoodFromImage.mjs';

function buildImageDeps(overrides = {}) {
  const messagingGateway = {
    sendMessage: jest.fn().mockResolvedValue({ messageId: 'gw-msg-1' }),
    sendPhoto: jest.fn().mockResolvedValue({ messageId: 'photo-msg-1' }),
    updateMessage: jest.fn().mockResolvedValue({}),
    deleteMessage: jest.fn().mockResolvedValue({}),
    getFileUrl: jest.fn().mockResolvedValue(null), // force use of fileId fallback
  };

  const aiGateway = {
    chatWithImage: jest.fn().mockRejectedValue(new Error('getaddrinfo EAI_AGAIN api.openai.com')),
  };

  const foodLogStore = {
    findByUuid: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue({}),
  };

  const conversationStateStore = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue({}),
    clear: jest.fn().mockResolvedValue({}),
  };

  const responseContext = {
    sendMessage: jest.fn().mockResolvedValue({ messageId: 'ctx-msg-1' }),
    sendPhoto: jest.fn().mockResolvedValue({ messageId: 'photo-msg-1' }),
    updateMessage: jest.fn().mockResolvedValue({}),
    deleteMessage: jest.fn().mockResolvedValue({}),
    getFileUrl: jest.fn().mockResolvedValue(null),
  };

  const logger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  return {
    messagingGateway,
    aiGateway,
    foodLogStore,
    conversationStateStore,
    responseContext,
    logger,
    config: { getDefaultTimezone: () => 'America/Los_Angeles' },
    encodeCallback: (cmd, data) => JSON.stringify({ cmd, ...data }),
    foodIconsString: 'apple banana default',
    ...overrides,
  };
}

describe('LogFoodFromImage — retry button on failure', () => {
  let deps;
  let useCase;

  beforeEach(() => {
    deps = buildImageDeps();
    useCase = new LogFoodFromImage(deps);
  });

  it('writes retry state and attaches retry button when AI call fails', async () => {
    await expect(
      useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:conv-1',
        imageData: { fileId: 'tg-file-abc' },
        messageId: 'user-msg-1',
        responseContext: deps.responseContext,
      })
    ).rejects.toThrow('EAI_AGAIN');

    expect(deps.conversationStateStore.set).toHaveBeenCalledWith(
      'telegram:conv-1',
      expect.objectContaining({
        activeFlow: 'image_retry',
        flowState: expect.objectContaining({
          imageData: expect.objectContaining({ fileId: 'tg-file-abc' }),
          retryMessageId: 'photo-msg-1',
        }),
      })
    );

    const updateCalls = deps.responseContext.updateMessage.mock.calls;
    const errorUpdate = updateCalls.find(([msgId, payload]) => msgId === 'photo-msg-1' && payload.choices);
    expect(errorUpdate).toBeTruthy();

    const [, payload] = errorUpdate;
    expect(payload.caption).toMatch(/Retry/);
    expect(payload.inline).toBe(true);
    expect(payload.choices).toEqual([
      [expect.objectContaining({ text: '🔄 Retry', callback_data: expect.any(String) })],
    ]);

    const decoded = JSON.parse(payload.choices[0][0].callback_data);
    expect(decoded).toEqual({ cmd: 'ir' });
  });

  it('falls back to button-less caption when state write fails', async () => {
    deps.conversationStateStore.set.mockRejectedValue(new Error('redis down'));
    useCase = new LogFoodFromImage(deps);

    await expect(
      useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:conv-1',
        imageData: { fileId: 'tg-file-abc' },
        messageId: 'user-msg-1',
        responseContext: deps.responseContext,
      })
    ).rejects.toThrow('EAI_AGAIN');

    const updateCalls = deps.responseContext.updateMessage.mock.calls;
    const errorUpdate = updateCalls.find(([msgId]) => msgId === 'photo-msg-1');
    expect(errorUpdate).toBeTruthy();
    expect(errorUpdate[1].choices).toBeUndefined();
    expect(errorUpdate[1].caption).toMatch(/trouble analyzing/);

    expect(deps.logger.warn).toHaveBeenCalledWith(
      'logImage.retryState.failed',
      expect.any(Object)
    );
  });

  it('does not write state or update caption when sendPhoto fails before photoMsgId exists', async () => {
    deps.responseContext.sendPhoto.mockRejectedValue(new Error('getaddrinfo EAI_AGAIN api.telegram.org'));
    useCase = new LogFoodFromImage(deps);

    await expect(
      useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:conv-1',
        imageData: { fileId: 'tg-file-abc' },
        messageId: 'user-msg-1',
        responseContext: deps.responseContext,
      })
    ).rejects.toThrow('EAI_AGAIN');

    expect(deps.conversationStateStore.set).not.toHaveBeenCalled();
    expect(deps.responseContext.updateMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx jest tests/isolated/nutribot/image-retry.test.mjs --silent`
Expected: FAIL on the new `LogFoodFromImage — retry button on failure` block:
- Test 1: state.set not called, no `choices` in payload.
- Test 2: same — no warn log.
- Test 3: likely already passes (no changes needed yet) — that's OK; confirms invariant holds pre-change.

---

## Task 7: Implement `LogFoodFromImage` catch-path changes

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs:302-322`

- [ ] **Step 1: Replace the catch block**

Replace the existing outer catch block (current lines 302–322) with:

```javascript
    } catch (error) {
      this.#logger.error?.('logImage.error', {
        conversationId,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
        imageUrl: imageData?.url?.substring(0, 120),
      });

      let retryStateWritten = false;
      if (photoMsgId && this.#conversationStateStore) {
        try {
          await this.#conversationStateStore.set(conversationId, {
            activeFlow: 'image_retry',
            flowState: {
              imageData: {
                fileId: imageData?.fileId,
                url: imageData?.url,
              },
              retryMessageId: photoMsgId,
            },
          });
          retryStateWritten = true;
        } catch (e) {
          this.#logger.warn?.('logImage.retryState.failed', {
            conversationId,
            error: e.message,
          });
        }
      }

      // Update the status photo so the user isn't left hanging
      if (photoMsgId) {
        const updatePayload = retryStateWritten
          ? {
              caption: '❌ Sorry, I had trouble analyzing this image. Tap 🔄 Retry to try again, or describe the food instead.',
              choices: [[{ text: '🔄 Retry', callback_data: this.#encodeCallback('ir', {}) }]],
              inline: true,
            }
          : {
              caption: '❌ Sorry, I had trouble analyzing this image. Please try again or describe the food instead.',
            };

        try {
          await messaging.updateMessage(photoMsgId, updatePayload);
        } catch (e) {
          this.#logger.debug?.('logImage.updateError.failed', { error: e.message });
        }
      }

      throw error;
    }
```

Key changes from the existing block:
- New state-write try/catch directly after the error log.
- Caption-update payload now conditionally includes `choices` + `inline: true`.
- When state write fails, caption text reverts to the existing wording (no reference to a Retry button that isn't there).

- [ ] **Step 2: Run tests**

Run: `npx jest tests/isolated/nutribot/image-retry.test.mjs --silent`
Expected: PASS (all three `LogFoodFromImage — retry button on failure` tests pass, all previous `RetryImageDetection` tests still pass).

- [ ] **Step 3: Run full nutribot isolated suite**

Run: `npx jest tests/isolated/nutribot/ --silent`
Expected: PASS (revision-flow + image-retry).

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs \
         tests/isolated/nutribot/image-retry.test.mjs
git commit -m "feat(nutribot): attach retry button to image-detection failure"
```

---

## Task 8: Wider regression check

**Files:** None.

- [ ] **Step 1: Run any touching-file jest tests**

Run: `npx jest tests/unit/suite/applications/nutribot/ tests/isolated/nutribot/ tests/isolated/adapter/nutribot/ --silent`
Expected: PASS. If pre-existing failures exist unrelated to this work, document them but do not attempt to fix in this plan — note them and move on.

- [ ] **Step 2: Static check**

Read `backend/src/3_applications/nutribot/NutribotContainer.mjs` to confirm the `RetryImageDetection` import, private field declaration, and factory method are all in place and consistent.

Read `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs` to confirm the `'ir'` case and legacy map entry are present.

- [ ] **Step 3: No commit if no changes**

Only commit if Step 2 uncovered something that needed fixing.

---

## Task 9: Manual smoke test (optional, recommended before deploy)

**Files:** None.

This task requires the dev server running and a Telegram client. Skip if the engineer is not able to exercise the bot end-to-end.

- [ ] **Step 1: Start the dev server**

Check if a dev server is already running: `ss -tlnp | grep 3112` (per `CLAUDE.md`). If not running, start it: `node backend/index.js`.

- [ ] **Step 2: Force an image-detection failure**

Easiest way: temporarily inject an error in `LogFoodFromImage.execute` after `photoMsgId` is set (e.g., throw `new Error('test failure')` right before the `this.#aiGateway.chatWithImage` call — line 198). Restart the dev server.

Alternative (if you don't want to modify code): disconnect the container's DNS to `api.openai.com` briefly, but this is fragile — code injection is usually easier.

- [ ] **Step 3: Send a food image via Telegram**

Open the nutribot in Telegram, send any food image. Expected sequence:
1. Image appears in chat with `🔍 Analyzing image for nutrition...` caption.
2. Caption updates to `❌ Sorry, I had trouble analyzing this image. Tap 🔄 Retry to try again, or describe the food instead.` with a single `🔄 Retry` button underneath.

- [ ] **Step 4: Remove the forced error and click Retry**

Remove the injected error from Step 2, restart the dev server, click `🔄 Retry` on the error photo. Expected: old photo vanishes, new `🔍 Analyzing...` photo appears, then standard result caption with Accept/Revise/Discard buttons.

- [ ] **Step 5: Stale-state click**

Send another image, wait for success, then manually clear conversation state (e.g., click Accept on a previous result). Click `🔄 Retry` on any old error-caption photo that's still in your chat — expected: new text message `🚫 This retry is no longer available.`

- [ ] **Step 6: Undo smoke-test hackery**

Ensure the forced-error injection from Step 2 is removed. No commit needed if nothing changed.

---

## Notes for the implementer

- Test files pass callback payloads as `JSON.stringify({ cmd, ...data })`, producing `{"cmd":"ir"}`. The real container wires the same default because `NutribotContainer.getLogFoodFromImage()` does not inject a custom `encodeCallback`. Either a `cmd` or `a` key is accepted by the router's decoder, so either encoder works at runtime.
- `conversationStateStore.get` returning `null` vs. an object with empty `flowState` must both be treated as "stale" — the guard `state?.activeFlow !== 'image_retry' || !flowState?.imageData?.fileId` handles both.
- When the original photo was posted via `responseContext.sendPhoto` (the DDD path), delete must also go through `responseContext.deleteMessage`. The use case picks the right one based on which interface is supplied.
- Do not attempt to restore the deleted error photo if `LogFoodFromImage.execute` fails again — the new failure will emit its own status photo + retry button, and the user is no worse off than they were.
- Unlimited retry attempts are intentional. Each failure writes fresh state, each retry click clears it. No rate-limiting in scope.
