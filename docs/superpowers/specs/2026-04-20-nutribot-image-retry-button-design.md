# Nutribot Image Retry Button — Design

**Date:** 2026-04-20
**Status:** Approved for planning
**Scope:** Single feature, one implementation plan

## Problem

When `LogFoodFromImage` hits a hard error (AI call fails, Telegram call fails mid-flow, image download fails), the status photo caption is updated to:

> ❌ Sorry, I had trouble analyzing this image. Please try again or describe the food instead.

The user has no way to retry without re-uploading the image. Observed failure modes from production logs include transient `EAI_AGAIN` DNS failures against `api.openai.com` and `api.telegram.org`, which are exactly the cases where a retry would likely succeed.

## Goal

Add a single inline `🔄 Retry` button under the failure-message caption. Clicking it re-runs detection against the same image.

## Non-Goals

- Retry for the "no food detected" soft-failure path (`LogFoodFromImage.mjs:216`). Retrying the same image against the same model with the same prompt does not help — user must re-frame or describe the food.
- Retry when the initial `sendPhoto` itself fails (no `photoMsgId` exists). There is no photo to attach a button to, and the Telegram API is already unreachable by definition.
- Automatic retries or backoff in the AI adapter layer. Out of scope.
- Persistence of retry state across server restarts beyond what `conversationStateStore` already provides.

## Architecture

### Overview

Three touch points:

1. **`LogFoodFromImage.mjs` outer catch (line 302)** — on failure where `photoMsgId` exists, write retry state to `conversationStateStore`, update caption with an inline retry button. Re-throw exception as today.
2. **`NutribotInputRouter.handleCallback` (line 128)** — dispatch new short-code `'ir'` to a new use case.
3. **New use case `RetryImageDetection`** — reads retry state, deletes the stale error photo, delegates to `LogFoodFromImage.execute` with the stored `imageData`.

### State shape

Written to `conversationStateStore` keyed by `conversationId` at time of failure:

```js
{
  activeFlow: 'image_retry',
  flowState: {
    imageData: { fileId, url },   // original input; url optional
    retryMessageId: photoMsgId,   // error-caption photo to clean up on retry
  }
}
```

Naturally overwritten when the user sends a new image — `LogFoodFromImage.execute` already runs state cleanup at the start of the flow (lines 104–119).

### Callback payload

Existing encoder: `encodeCallback(cmd, data) → JSON.stringify({cmd, ...data})`. New code uses no id:

```json
{"cmd":"ir"}
```

Well under Telegram's 64-byte callback_data limit. All payload data lives in conversation state.

### Retry flow

User clicks `🔄 Retry`:

1. Telegram webhook → `NutribotInputRouter.handleCallback` decodes `{cmd: 'ir'}`.
2. Dispatches to `RetryImageDetection.execute({ userId, conversationId, responseContext })`.
3. Use case reads state:
   - If `state?.activeFlow !== 'image_retry'` or `!state.flowState?.imageData?.fileId`, send "🚫 This retry is no longer available." via `responseContext.sendMessage` and return `{ success: false, error: 'stale' }`. Do not call `LogFoodFromImage`.
4. On valid state: clear state, best-effort delete the error-caption photo (`state.flowState.retryMessageId`), then invoke `LogFoodFromImage.execute({ userId, conversationId, imageData, messageId: null, responseContext })`.
5. `LogFoodFromImage` runs its normal flow: sends a fresh status photo, detects food, posts results (or hits another failure, which writes new retry state and shows the button again).

User-visible sequence: `[❌ error]` → (deleted) → `[🔍 Analyzing...]` → `[✅ results]` or another retry-able error.

## Components

### Changes to `backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs`

In the outer catch block (lines 302–322), after logging the error, **before** updating the caption:

1. If `photoMsgId` exists and `conversationStateStore` is present, write retry state:
   ```js
   await this.#conversationStateStore.set(conversationId, {
     activeFlow: 'image_retry',
     flowState: {
       imageData: { fileId: imageData?.fileId, url: imageData?.url },
       retryMessageId: photoMsgId,
     },
   });
   ```
   Wrap in try/catch; on failure, log `logImage.retryState.failed` at warn level and continue — the user still sees the error caption, just without a retry button.

2. Update the caption-update call to include the button:
   ```js
   await messaging.updateMessage(photoMsgId, {
     caption: '❌ Sorry, I had trouble analyzing this image. Tap 🔄 Retry to try again, or describe the food instead.',
     choices: [[{ text: '🔄 Retry', callback_data: this.#encodeCallback('ir', {}) }]],
     inline: true,
   });
   ```
   Only include `choices` when state was successfully written; otherwise fall back to the caption-only update (preserves current behavior).

3. Re-throw the error as today (line 321). The router's existing error-logging path at `nutribot.webhook.error` is unchanged.

### New use case `backend/src/3_applications/nutribot/usecases/RetryImageDetection.mjs`

```js
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
      const messaging = responseContext || this.#messagingGateway;
      const send = responseContext
        ? (text) => responseContext.sendMessage(text)
        : (text) => this.#messagingGateway.sendMessage(conversationId, text);
      await send('🚫 This retry is no longer available.');
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
```

Wired into `NutribotContainer` with a factory method `getRetryImageDetection()` that lazily constructs the instance using the container's existing `getLogFoodFromImage()`, `conversationStateStore`, `messagingGateway`, and `logger`.

### Changes to `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs`

Add to the `handleCallback` switch (after existing `'p'` and `'ra'` cases):

```js
case CallbackActions.RETRY_IMAGE: {
  const useCase = this.container.getRetryImageDetection();
  return await useCase.execute({
    userId: this.#resolveUserId(event),
    conversationId: event.conversationId,
    responseContext,
  });
}
```

Add to the legacy action map:
```js
const legacyActionMap = {
  a: CallbackActions.ACCEPT_LOG,
  r: CallbackActions.REVISE_ITEM,
  x: CallbackActions.REJECT_LOG,
  ir: CallbackActions.RETRY_IMAGE,
};
```

### Changes to `CallbackActions` enum

Add `RETRY_IMAGE: 'retry_image'` to the exported enum in `backend/src/1_adapters/nutribot/lib/callback.mjs`. Re-export path `backend/src/3_applications/nutribot/lib/index.mjs` already pulls the constant through — no change needed there.

### Changes to `backend/src/3_applications/nutribot/usecases/index.mjs`

Export the new `RetryImageDetection` class alongside existing exports.

## Error Handling

| Failure | Behavior |
|---|---|
| `conversationStateStore.set` fails during error path | Log `logImage.retryState.failed` warn; update caption without retry button; user still sees error message |
| `conversationStateStore.get` fails in retry use case | Let it throw — router's existing error logger catches and reports via `router.error` |
| Old-photo delete fails in retry use case | Log debug; continue — `LogFoodFromImage.execute` will post a new status photo anyway |
| State present but `imageData.fileId` missing (malformed) | Treated as stale; "🚫 This retry is no longer available." message |
| Retry succeeds but then fails again | Normal failure path runs — new retry state, new retry button. Unlimited retries allowed |
| User sends a new image while retry state is pending | `LogFoodFromImage.execute` start-of-flow cleanup runs (lines 104–119); retry state is overwritten by the new flow's state writes. Orphan error-caption photo remains in chat until user clicks its retry button (which would now fail "stale"). Acceptable |

## Testing

New tests in the existing `tests/isolated/nutribot/` pattern (jest + mocked deps, following `revision-flow.test.mjs`).

### `LogFoodFromImage` (new test file `tests/isolated/nutribot/image-retry.test.mjs`)

Co-locate with the new `RetryImageDetection` tests below in the same file under two top-level `describe` blocks.

1. **On AI failure writes retry state:** mock `aiGateway.chatWithImage` to reject. Assert:
   - `conversationStateStore.set` called with `{ activeFlow: 'image_retry', flowState: { imageData: { fileId: 'test-file-id' }, retryMessageId: <photoMsgId> } }`
   - `updateMessage` called on `photoMsgId` with `choices` defined and `inline: true`
   - The button's `callback_data` decodes to `{ cmd: 'ir' }`
   - Original error is re-thrown

2. **State-write failure still shows error caption without button:** mock `conversationStateStore.set` to reject. Assert:
   - `updateMessage` called with caption only; no `choices`
   - Original error still re-thrown

3. **No photoMsgId → no state write, no button:** mock `sendPhoto` to reject (causes `photoMsgId` to stay null). Assert:
   - `conversationStateStore.set` NOT called
   - `updateMessage` NOT called
   - Error re-thrown

### `RetryImageDetection` (same file, separate `describe` block)

1. **Happy path:** state is valid `image_retry` with `fileId`. Assert:
   - `conversationStateStore.clear` called with conversationId
   - `responseContext.deleteMessage` called with `retryMessageId`
   - `logFoodFromImage.execute` called with `imageData` matching state

2. **Stale — no state:** `get` returns null. Assert:
   - Sends "🚫 This retry is no longer available." via `responseContext.sendMessage`
   - Returns `{ success: false, error: 'stale' }`
   - `logFoodFromImage.execute` NOT called
   - `clear` NOT called

3. **Stale — wrong activeFlow:** `get` returns `{ activeFlow: 'revision', ... }`. Same assertions as case 2.

4. **Stale — missing imageData.fileId:** `get` returns valid activeFlow but no fileId. Same assertions as case 2.

5. **Delete-old-photo failure is non-fatal:** `responseContext.deleteMessage` rejects. Assert:
   - `logFoodFromImage.execute` STILL called
   - Debug log emitted

### Router

Not new — existing `NutribotInputRouter` tests (wherever they live) should cover the new `'ir'` dispatch via pattern match. Plan will confirm during implementation.

## Security / Trust

- Callback data contains no secrets — retry ticket is cleared-text `{cmd: 'ir'}`.
- Retry state is scoped to `conversationId`. A user can only trigger retry for their own conversation (Telegram's webhook sender is authoritative).
- File IDs stored in conversation state are Telegram file IDs (not URLs with signed tokens). No privacy escalation.

## Rollout

Single PR, no flags, no migration. Existing conversations without the new state simply won't show the retry button; next failure will populate state and the button appears. Safe to deploy incrementally.
