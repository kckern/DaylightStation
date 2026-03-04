# SelectUPCPortion: Preserve Photo on Accept

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When accepting a UPC food item, update the existing photo message in-place (preserving the image) instead of deleting it and sending a text-only replacement.

**Architecture:** Align `SelectUPCPortion` with the pattern already used by `AcceptFoodLog` — update the message caption + remove buttons instead of delete+resend. The Telegram adapter already supports `{ caption: ..., choices: [] }` for photo messages via `editMessageCaption`.

**Tech Stack:** Node.js, Telegram Bot API (`editMessageCaption`), Jest

---

### Task 1: Add test for message update-in-place behavior

**Files:**
- Modify: `tests/unit/suite/applications/nutribot/SelectUPCPortion.test.mjs`

**Step 1: Write the failing test**

Add a new `describe` block after the existing `userId handling` block:

```javascript
describe('message handling on accept', () => {
  it('updates message in-place with caption instead of deleting and resending', async () => {
    // UPC logs have metadata.source = 'upc' and a product image
    mockFoodLogStore.findByUuid = jest.fn().mockResolvedValue({
      id: 'abc123',
      userId: 'kckern',
      status: 'pending',
      items: [{ label: 'Diet Coke', grams: 355, calories: 0, unit: 'g', amount: 1 }],
      meal: { date: '2026-02-12' },
      metadata: { source: 'upc', messageId: '50' },
    });

    await useCase.execute({
      userId: 'kckern',
      conversationId: 'telegram:b6898194425_c575596036',
      logUuid: 'abc123',
      portionFactor: 1,
      messageId: '50',
    });

    // Should update message caption in-place (not delete)
    expect(mockMessaging.updateMessage).toHaveBeenCalledWith(
      'telegram:b6898194425_c575596036',
      '50',
      expect.objectContaining({
        caption: expect.any(String),
        choices: [],
      })
    );

    // Should NOT delete the message (photo should be preserved)
    expect(mockMessaging.deleteMessage).not.toHaveBeenCalled();

    // Should NOT send a new text message as replacement
    expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/applications/nutribot/SelectUPCPortion.test.mjs -v`

Expected: FAIL — `deleteMessage` IS called, `updateMessage` is NOT called with caption.

---

### Task 2: Fix SelectUPCPortion to update message in-place

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/SelectUPCPortion.mjs`

**Step 1: Add formatters import**

At the top of the file, add:

```javascript
import { formatFoodList, formatDateHeader } from '#domains/nutrition/entities/formatters.mjs';
```

**Step 2: Replace the confirmation message + delete logic (lines 144-156)**

Replace the current block:

```javascript
        // Send confirmation message
        const confirmMsg = this.#formatConfirmation(scaledItems, logDate);
        await this.#messagingGateway.sendMessage(conversationId, confirmMsg, { responseContext });
      }

      // Delete the portion selection message
      if (messageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore
        }
      }
```

With:

```javascript
      }

      // Update the existing message in-place (preserving photo if present)
      if (messageId) {
        try {
          const dateHeader = logDate ? formatDateHeader(logDate, { now: new Date() }).replace('🕒', '✅') : '';
          const foodList = formatFoodList(scaledItems);
          const acceptedText = `${dateHeader}\n\n${foodList}`;

          // UPC messages are photo messages — update caption to preserve image
          await this.#messagingGateway.updateMessage(conversationId, messageId, {
            caption: acceptedText,
            choices: [],
            inline: true,
          });
        } catch (e) {
          this.#logger.warn?.('selectPortion.updateMessageFailed', { error: e.message });
          // Fallback: send text confirmation if update fails
          const confirmMsg = this.#formatConfirmation(scaledItems, logDate);
          await this.#messagingGateway.sendMessage(conversationId, confirmMsg, { responseContext });
        }
      }
```

**Step 3: Remove the unused `#formatConfirmation` method (lines 24-47)**

Delete the entire `#formatConfirmation` method since it's no longer used. The `formatDateHeader` + `formatFoodList` imports provide consistent formatting matching `AcceptFoodLog`.

**Step 4: Run test to verify it passes**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/applications/nutribot/SelectUPCPortion.test.mjs -v`

Expected: PASS — all tests green.

**Step 5: Commit**

```bash
git add tests/unit/suite/applications/nutribot/SelectUPCPortion.test.mjs backend/src/3_applications/nutribot/usecases/SelectUPCPortion.mjs
git commit -m "fix(nutribot): preserve photo when accepting UPC food items

SelectUPCPortion was deleting the photo message and sending a text-only
replacement. Now updates the caption in-place like AcceptFoodLog does,
preserving the product image in the chat.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Build, deploy, and verify

**Step 1: Build Docker image**

```bash
docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```

**Step 2: Redeploy**

```bash
docker stop daylight-station && docker rm daylight-station && \
docker run -d --name daylight-station --restart unless-stopped \
  --network kckern-net -p 3111:3111 \
  -v /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data:/usr/src/app/data \
  -v /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media:/usr/src/app/media \
  kckern/daylight-station:latest
```

**Step 3: Verify via Telegram**

Scan a UPC barcode, accept the portion, and confirm the product image stays in the chat with the updated caption.
