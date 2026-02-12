# LogFoodFromImage: Show Photo During Analysis

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Send the food image as a photo with "Analyzing..." as caption upfront, then update the caption in-place on success/failure — instead of sending a text status and later replacing it with a separate photo.

**Architecture:** Reorder the execute() flow so image resolution and download happen before the status message. Send a photo with the status caption via `sendPhoto`. On success, update the caption with food list + add buttons via `updateMessage`. On failure, update the caption with the error message. This eliminates the delete+resend pattern entirely.

**Tech Stack:** Node.js, Telegram Bot API (`sendPhoto` + `editMessageCaption`)

---

### Task 1: Write tests for photo-first status behavior

**Files:**
- Create: `tests/unit/suite/applications/nutribot/LogFoodFromImage.test.mjs`

**Step 1: Write the test file**

```javascript
// tests/unit/suite/applications/nutribot/LogFoodFromImage.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { LogFoodFromImage } from '#apps/nutribot/usecases/LogFoodFromImage.mjs';

describe('LogFoodFromImage', () => {
  let useCase;
  let mockMessaging;
  let mockAI;
  let mockFoodLogStore;
  let mockConversationStateStore;

  beforeEach(() => {
    mockMessaging = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: '100' }),
      sendPhoto: jest.fn().mockResolvedValue({ messageId: '200' }),
      updateMessage: jest.fn().mockResolvedValue({}),
      deleteMessage: jest.fn().mockResolvedValue({}),
      getFileUrl: jest.fn(),
    };

    mockAI = {
      chatWithImage: jest.fn().mockResolvedValue(JSON.stringify({
        items: [{
          name: 'Chicken Breast',
          icon: 'chicken',
          noom_color: 'green',
          quantity: 1,
          unit: 'piece',
          grams: 150,
          calories: 230,
          protein: 43,
          carbs: 0,
          fat: 5,
          fiber: 0,
          sugar: 0,
          sodium: 70,
          cholesterol: 100,
        }],
      })),
    };

    mockFoodLogStore = {
      save: jest.fn().mockResolvedValue({}),
    };

    mockConversationStateStore = {
      get: jest.fn().mockResolvedValue(null),
      clear: jest.fn().mockResolvedValue({}),
    };

    useCase = new LogFoodFromImage({
      messagingGateway: mockMessaging,
      aiGateway: mockAI,
      foodLogStore: mockFoodLogStore,
      conversationStateStore: mockConversationStateStore,
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  });

  describe('photo-first status', () => {
    it('sends photo with analyzing caption as the status message', async () => {
      await useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:bot_chat',
        imageData: { url: 'https://example.com/food.jpg' },
      });

      // Should send photo with status caption (not a text message)
      expect(mockMessaging.sendPhoto).toHaveBeenCalledWith(
        expect.anything(), // photo source (URL or buffer)
        expect.stringContaining('Analyzing'),
        expect.any(Object)
      );
    });

    it('updates photo caption in-place on success instead of delete+resend', async () => {
      await useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:bot_chat',
        imageData: { url: 'https://example.com/food.jpg' },
      });

      // sendPhoto called once (for status), NOT twice
      expect(mockMessaging.sendPhoto).toHaveBeenCalledTimes(1);

      // Caption updated in-place with food list + buttons
      expect(mockMessaging.updateMessage).toHaveBeenCalledWith(
        '200', // messageId from sendPhoto
        expect.objectContaining({
          caption: expect.any(String),
          choices: expect.any(Array),
        })
      );

      // Status message should NOT be deleted (photo stays)
      expect(mockMessaging.deleteMessage).not.toHaveBeenCalled();
    });

    it('updates photo caption with error on failure (no food detected)', async () => {
      mockAI.chatWithImage = jest.fn().mockResolvedValue('No food visible in this image.');

      await useCase.execute({
        userId: 'kckern',
        conversationId: 'telegram:bot_chat',
        imageData: { url: 'https://example.com/food.jpg' },
      });

      // Photo was sent with status caption
      expect(mockMessaging.sendPhoto).toHaveBeenCalledTimes(1);

      // Caption updated with error message (not text update)
      expect(mockMessaging.updateMessage).toHaveBeenCalledWith(
        '200',
        expect.objectContaining({
          caption: expect.stringContaining("couldn't identify"),
        })
      );

      // No text message sent
      expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/applications/nutribot/LogFoodFromImage.test.mjs --verbose`

Expected: FAIL — currently sends text status via `sendMessage`, not `sendPhoto`.

---

### Task 2: Refactor execute() to send photo first, then update caption

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs`

**Step 1: Replace the execute() method body**

The new flow reorders the steps:
1. Clean up old status messages (unchanged)
2. Resolve image URL (moved up from old step 2)
3. Download image to buffer (moved up from old step 8)
4. Send photo with "Analyzing..." caption (replaces old text status)
5. Process image for AI if needed (unchanged)
6. Call AI (unchanged)
7. Parse response (unchanged)
8. On failure: update caption with error
9. On success: update caption with food list + buttons

Replace everything inside `execute()` from line 98 (`try {`) through line 298 (`throw error;`) with:

```javascript
    try {
      // 0. Clean up lingering status messages
      if (this.#conversationStateStore) {
        try {
          const existingState = await this.#conversationStateStore.get(conversationId);
          const oldStatusMsgId = existingState?.flowState?.statusMessageId;
          if (oldStatusMsgId) {
            try {
              await messaging.deleteMessage(oldStatusMsgId);
            } catch (e) {
              this.#logger.debug?.('logImage.deleteOldStatus.failed', { error: e.message });
            }
          }
        } catch (e) {
          this.#logger.debug?.('logImage.cleanupState.failed', { error: e.message });
        }
      }

      // 1. Resolve image URL
      let imageUrl = imageData.url;
      if (imageData.fileId && messaging.getFileUrl) {
        imageUrl = await messaging.getFileUrl(imageData.fileId);
      }

      // 2. Download image to buffer for sendPhoto
      let photoSource;
      if (imageUrl && imageUrl.startsWith('http')) {
        try {
          const dlResponse = await fetch(imageUrl);
          const arrayBuffer = await dlResponse.arrayBuffer();
          photoSource = Buffer.from(arrayBuffer);
        } catch (e) {
          this.#logger.warn?.('logImage.download.failed', { conversationId, error: e.message });
          photoSource = imageUrl; // Fallback to URL
        }
      } else {
        photoSource = imageUrl || imageData.fileId;
      }

      // 3. Send photo with analyzing caption as status
      const { messageId: photoMsgId } = await messaging.sendPhoto(
        photoSource,
        '🔍 Analyzing image for nutrition...',
        {}
      );

      // Delete user's original image (now that we've re-sent it)
      if (userMessageId) {
        try {
          await messaging.deleteMessage(userMessageId);
        } catch (e) {
          this.#logger.debug?.('logImage.deleteUserMessage.failed', { error: e.message });
        }
      }

      // 4. Process image for AI if processor available
      let imageForAI = photoSource;
      if (this.#imageProcessor && imageUrl?.startsWith('http')) {
        try {
          const base64Image = await this.#imageProcessor.downloadAndProcess(imageUrl);
          if (base64Image) {
            imageForAI = base64Image;
            this.#logger.info?.('logImage.imageProcessed', { conversationId, format: 'base64' });
          }
        } catch (e) {
          this.#logger.warn?.('logImage.imageProcessor.failed', { conversationId, error: e.message });
        }
      } else if (typeof photoSource === 'string') {
        // URL or file_id — pass as-is to AI
        imageForAI = photoSource;
      }
      // If photoSource is a Buffer, pass it directly (AI gateway should handle buffers)

      this.#logger.info?.('logImage.aiCall', {
        conversationId,
        imageType: Buffer.isBuffer(imageForAI) ? 'buffer' : (typeof imageForAI === 'string' && imageForAI.startsWith('data:') ? 'base64' : 'url'),
        imageUrl: typeof imageForAI === 'string' && !imageForAI.startsWith('data:') ? imageForAI.substring(0, 120) : undefined,
        hasImageProcessor: !!this.#imageProcessor,
      });

      // 5. Call AI for food detection
      const prompt = this.#buildDetectionPrompt();
      const response = await this.#aiGateway.chatWithImage(prompt, imageForAI, { maxTokens: 1000 });

      this.#logger.info?.('logImage.aiResponse', {
        conversationId,
        responseLength: response?.length || 0,
        responsePreview: response?.substring(0, 200),
      });

      // 6. Parse response into food items
      const foodItems = this.#parseFoodResponse(response);

      if (foodItems.length === 0) {
        this.#logger.warn?.('logImage.noFoodDetected', {
          conversationId,
          imageUrl: imageUrl?.substring(0, 120),
          aiResponseLength: response?.length || 0,
          aiResponsePreview: response?.substring(0, 300),
        });
        // Update photo caption with error (photo stays visible)
        await messaging.updateMessage(photoMsgId, {
          caption: "❓ I couldn't identify any food in this image. Could you describe what you're eating?",
        });
        return { success: false, error: 'No food detected' };
      }

      // 7. Create NutriLog domain entity
      const timezone = this.#getTimezone();
      const now = new Date();
      const localDate = now.toLocaleDateString('en-CA', { timeZone: timezone });
      const localHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }));

      let mealTime = 'morning';
      if (localHour >= 11 && localHour < 14) mealTime = 'afternoon';
      else if (localHour >= 14 && localHour < 20) mealTime = 'evening';
      else if (localHour >= 20 || localHour < 5) mealTime = 'night';

      const nutriLog = NutriLog.create({
        userId: conversationId.split(':')[0] === 'cli' ? 'cli-user' : userId,
        conversationId,
        items: foodItems,
        meal: {
          date: localDate,
          time: mealTime,
        },
        metadata: {
          source: 'image',
          imageUrl: imageUrl,
        },
        timezone,
        timestamp: now,
      });

      // 8. Save NutriLog
      if (this.#foodLogStore) {
        await this.#foodLogStore.save(nutriLog);
      }

      // 9. Update photo caption with food list + action buttons
      const caption = this.#formatFoodCaption(foodItems, nutriLog.date || localDate);
      const buttons = this.#buildActionButtons(nutriLog.id);

      await messaging.updateMessage(photoMsgId, {
        caption,
        choices: buttons,
        inline: true,
      });

      // 10. Update NutriLog with messageId
      if (this.#foodLogStore && photoMsgId) {
        const updatedLog = nutriLog.with({
          metadata: { ...nutriLog.metadata, messageId: String(photoMsgId) },
        }, new Date());
        await this.#foodLogStore.save(updatedLog);
      }

      this.#logger.info?.('logImage.complete', {
        conversationId,
        itemCount: foodItems.length,
        logUuid: nutriLog.id,
      });

      return {
        success: true,
        nutrilogUuid: nutriLog.id,
        messageId: photoMsgId,
        itemCount: foodItems.length,
      };
    } catch (error) {
      this.#logger.error?.('logImage.error', {
        conversationId,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
        imageUrl: imageData?.url?.substring(0, 120),
      });
      throw error;
    }
```

**Step 2: Run tests to verify they pass**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/applications/nutribot/LogFoodFromImage.test.mjs --verbose`

Expected: PASS — all 3 tests green.

**Step 3: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs tests/unit/suite/applications/nutribot/LogFoodFromImage.test.mjs
git commit -m "feat(nutribot): show image during analysis with caption status

Send the food image as a photo with 'Analyzing...' caption immediately,
then update the caption in-place with results or error. Eliminates the
text-only status followed by delete+resend photo pattern.

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

Send a food photo. Confirm:
1. The image appears immediately with "🔍 Analyzing image for nutrition..." caption
2. After AI processes, the caption updates to the food list with Accept/Revise/Discard buttons
3. The image stays visible throughout the entire flow
