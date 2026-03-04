# Barcode Photo Status Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the plain-text "looking up barcode..." status with a photo message showing a generated barcode image and animated caption.

**Architecture:** New `BarcodeImageAdapter` wraps bwip-js to produce PNG buffers. New `createPhotoStatusIndicator` method on IResponseContext/TelegramResponseContext sends photo + animates caption via `editMessageCaption`. LogFoodFromUPC use case wires them together, with graceful fallback to text-only status if barcode generator unavailable.

**Tech Stack:** bwip-js (already installed v4.7.0), Telegram Bot API (`sendPhoto`, `editMessageCaption`)

---

### Task 1: BarcodeImageAdapter

**Files:**
- Create: `backend/src/1_adapters/nutribot/BarcodeImageAdapter.mjs`

**Step 1: Write the adapter**

```javascript
/**
 * BarcodeImageAdapter
 * @module adapters/nutribot/BarcodeImageAdapter
 *
 * Generates barcode images as PNG buffers using bwip-js.
 */

import bwipjs from 'bwip-js';

export class BarcodeImageAdapter {
  #logger;

  constructor(deps = {}) {
    this.#logger = deps.logger || console;
  }

  /**
   * Generate a barcode PNG image buffer
   * @param {string} upc - UPC/EAN barcode string
   * @returns {Promise<Buffer>} PNG image buffer
   */
  async generate(upc) {
    const normalized = String(upc).replace(/\D/g, '');

    // Pick barcode type based on digit count
    const bcid = normalized.length === 13 ? 'ean13'
      : normalized.length === 12 ? 'upca'
      : normalized.length === 8 ? 'ean8'
      : 'code128';

    try {
      const png = await bwipjs.toBuffer({
        bcid,
        text: normalized,
        scale: 3,
        height: 10,
        includetext: true,
        textxalign: 'center',
      });
      return png;
    } catch (error) {
      this.#logger.warn?.('barcode.generate.failed', { upc: normalized, bcid, error: error.message });
      throw error;
    }
  }
}

export default BarcodeImageAdapter;
```

**Step 2: Verify bwip-js import works**

Run: `node -e "import('bwip-js').then(m => console.log('OK:', typeof m.default.toBuffer))"`
Expected: `OK: function`

**Step 3: Commit**

```bash
git add backend/src/1_adapters/nutribot/BarcodeImageAdapter.mjs
git commit -m "feat(nutribot): add BarcodeImageAdapter wrapping bwip-js"
```

---

### Task 2: Add createPhotoStatusIndicator to IResponseContext port

**Files:**
- Modify: `backend/src/3_applications/nutribot/ports/IResponseContext.mjs:91` (add method after createStatusIndicator)

**Step 1: Add method signature to port interface**

After the existing `createStatusIndicator` method (line 91), add:

```javascript
  /**
   * Create a photo-based status indicator for a long-running operation.
   * Sends a photo with animated caption while waiting.
   *
   * @param {Buffer|string} imageSource - Photo buffer, URL, or file ID
   * @param {string} initialCaption - Initial caption text
   * @param {Object} [options] - Options
   * @param {string[]} [options.frames] - Animation frames to append to caption
   * @param {number} [options.interval=2000] - Animation interval in ms
   * @returns {Promise<IStatusIndicator>}
   */
  async createPhotoStatusIndicator(imageSource, initialCaption, options = {}) {},
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/nutribot/ports/IResponseContext.mjs
git commit -m "feat(nutribot): add createPhotoStatusIndicator to IResponseContext port"
```

---

### Task 3: Implement createPhotoStatusIndicator in TelegramResponseContext

**Files:**
- Modify: `backend/src/1_adapters/telegram/TelegramResponseContext.mjs:192` (add method before "Additional Methods" section)

**Step 1: Add implementation**

Insert before line 194 (`// ============ Additional Methods`):

```javascript
  /**
   * Create a photo-based status indicator with animated caption.
   * Sends photo immediately, then cycles caption frames via editMessageCaption.
   *
   * @param {Buffer|string} imageSource - Photo buffer, URL, or file ID
   * @param {string} initialCaption - Initial caption text
   * @param {Object} [options] - Options
   * @param {string[]} [options.frames] - Animation frames to append to caption
   * @param {number} [options.interval=2000] - Animation interval in ms
   * @returns {Promise<IStatusIndicator>}
   */
  async createPhotoStatusIndicator(imageSource, initialCaption, options = {}) {
    const { frames = null, interval = 2000 } = options;
    const shouldAnimate = Array.isArray(frames) && frames.length > 0;

    // Send photo with initial caption
    const initialDisplay = shouldAnimate ? `${initialCaption}${frames[0]}` : initialCaption;
    const { messageId } = await this.sendPhoto(imageSource, initialDisplay, {});

    let animationTimer = null;
    let currentFrame = 0;
    const baseCaption = initialCaption;

    // Start caption animation if frames provided
    if (shouldAnimate) {
      animationTimer = setInterval(async () => {
        currentFrame = (currentFrame + 1) % frames.length;
        try {
          await this.updateMessage(messageId, {
            caption: `${baseCaption}${frames[currentFrame]}`,
          });
        } catch (e) {
          // Ignore update failures during animation (message may be gone)
        }
      }, interval);
    }

    const cleanup = () => {
      if (animationTimer) {
        clearInterval(animationTimer);
        animationTimer = null;
      }
    };

    const ctx = this;

    return {
      messageId,

      async finish(content, options = {}) {
        cleanup();
        await ctx.updateMessage(messageId, {
          caption: content,
          ...options,
        });
        return messageId;
      },

      async cancel() {
        cleanup();
        try {
          await ctx.deleteMessage(messageId);
        } catch (e) {
          // Ignore - message may already be gone
        }
      },
    };
  }
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/telegram/TelegramResponseContext.mjs
git commit -m "feat(telegram): implement createPhotoStatusIndicator in TelegramResponseContext"
```

---

### Task 4: Wire BarcodeImageAdapter into NutribotContainer and bootstrap

**Files:**
- Modify: `backend/src/3_applications/nutribot/NutribotContainer.mjs:98-113` (accept barcodeGenerator option)
- Modify: `backend/src/3_applications/nutribot/NutribotContainer.mjs:216-229` (pass to LogFoodFromUPC)
- Modify: `backend/src/0_system/bootstrap.mjs:1935-1992` (create and pass BarcodeImageAdapter)

**Step 1: Add barcodeGenerator to NutribotContainer**

In the constructor (around line 98), add to the options destructuring and field storage:

After line 112 (`this.#reportRenderer = options.reportRenderer;`), add:
```javascript
    this.#barcodeGenerator = options.barcodeGenerator;
```

Add a private field after line 56 (`#reportRenderer;`):
```javascript
  #barcodeGenerator;
```

**Step 2: Pass barcodeGenerator to LogFoodFromUPC**

In `getLogFoodFromUPC()` (line 218), add `barcodeGenerator` to the deps object:

```javascript
  getLogFoodFromUPC() {
    if (!this.#logFoodFromUPC) {
      this.#logFoodFromUPC = new LogFoodFromUPC({
        messagingGateway: this.getMessagingGateway(),
        upcGateway: this.#upcGateway,
        aiGateway: this.#aiGateway,
        googleImageGateway: this.#googleImageGateway,
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        logger: this.#logger,
        barcodeGenerator: this.#barcodeGenerator,
      });
    }
    return this.#logFoodFromUPC;
  }
```

**Step 3: Create BarcodeImageAdapter in bootstrap**

In `createNutribotServices` (bootstrap.mjs around line 1978), add after the existing adapter creation:

```javascript
  // Barcode image generator (optional - for UPC photo status)
  const { BarcodeImageAdapter } = await import('#adapters/nutribot/BarcodeImageAdapter.mjs');
  const barcodeGenerator = new BarcodeImageAdapter({ logger });
```

Then pass it to the container constructor (around line 1981):

```javascript
  const nutribotContainer = new NutribotContainer(nutribotConfig, {
    messagingGateway: telegramAdapter,
    aiGateway,
    upcGateway,
    googleImageGateway,
    foodLogStore,
    nutriListStore,
    nutriCoachStore,
    conversationStateStore,
    reportRenderer,
    barcodeGenerator,
    logger
  });
```

**Step 4: Commit**

```bash
git add backend/src/3_applications/nutribot/NutribotContainer.mjs backend/src/0_system/bootstrap.mjs
git commit -m "feat(nutribot): wire BarcodeImageAdapter into container and bootstrap"
```

---

### Task 5: Update LogFoodFromUPC to use barcode photo status

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs:63-92` (status indicator section)

**Step 1: Update execute() to generate barcode and use photo status**

Replace lines 69-92 (the status indicator creation block) with:

```javascript
    let status = null;
    let statusMsgId = null;

    try {
      // 1. Delete original user message
      if (messageId) {
        try {
          await messaging.deleteMessage(messageId);
        } catch (e) {
          this.#logger.warn?.('logUPC.deleteOriginalFailed', { error: e.message });
        }
      }

      // 2. Create status indicator — photo with barcode if available, text otherwise
      const animationOpts = { frames: ['.', '..', '...'], interval: 2000 };
      const statusCaption = `🔍 Looking up barcode ${upc}`;

      if (this.#barcodeGenerator && messaging.createPhotoStatusIndicator) {
        try {
          const barcodeBuffer = await this.#barcodeGenerator.generate(upc);
          status = await messaging.createPhotoStatusIndicator(barcodeBuffer, statusCaption, animationOpts);
          statusMsgId = status.messageId;
        } catch (e) {
          this.#logger.warn?.('logUPC.barcodeGenFailed', { upc, error: e.message });
          // Fall through to text status below
        }
      }

      if (!status) {
        if (messaging.createStatusIndicator) {
          status = await messaging.createStatusIndicator(statusCaption, animationOpts);
          statusMsgId = status.messageId;
        } else {
          const statusMsg = await messaging.sendMessage(`${statusCaption}...`);
          statusMsgId = statusMsg.messageId;
        }
      }
```

The rest of the execute() method (lines 94 onward: UPC lookup, classification, food item creation, status cancel, product photo send) stays exactly the same.

**Step 2: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs
git commit -m "feat(nutribot): use barcode photo as status indicator during UPC lookup"
```

---

### Task 6: Smoke test

**Step 1: Verify import chain works**

Run: `node -e "import('./backend/src/1_adapters/nutribot/BarcodeImageAdapter.mjs').then(m => { const a = new m.BarcodeImageAdapter(); a.generate('012345678905').then(buf => console.log('PNG buffer size:', buf.length)) })"`
Expected: `PNG buffer size: <some number>`

**Step 2: Start dev server and test with a real UPC scan via Telegram**

Run: `npm run dev` (if not already running)

Send a UPC barcode to the Telegram bot. Expected behavior:
1. Barcode photo appears with animated "🔍 Looking up barcode..." caption
2. Caption animates `.` → `..` → `...` cycling
3. After lookup completes, barcode photo is deleted
4. Product photo with portion buttons appears (unchanged from before)

**Step 3: Commit any fixes**
