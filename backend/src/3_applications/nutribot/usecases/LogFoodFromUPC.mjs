/**
 * Log Food From UPC Use Case
 * @module nutribot/usecases/LogFoodFromUPC
 *
 * Looks up product by UPC barcode and creates a pending log.
 */

import { createNutriLog } from '../nutriLogRecords.mjs';
import { getMealTimeFromHour } from '#domains/nutrition/entities/schemas.mjs';
import { formatLocalTimestamp } from '#domains/core/utils/time.mjs';

/**
 * Log food from UPC use case
 */
export class LogFoodFromUPC {
  #messagingGateway;
  #upcGateway;
  #aiGateway;
  #googleImageGateway;
  #foodLogStore;
  #conversationStateStore;
  #config;
  #logger;
  #encodeCallback;
  #foodIconsString;
  #barcodeGenerator;
  #catalogService;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#upcGateway = deps.upcGateway;
    this.#aiGateway = deps.aiGateway;
    this.#googleImageGateway = deps.googleImageGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
    this.#foodIconsString = deps.foodIconsString || 'apple banana bread cheese chicken default';
    this.#barcodeGenerator = deps.barcodeGenerator; // Optional: for generating barcode images
    this.#catalogService = deps.catalogService || null;
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(responseContext, conversationId) {
    if (responseContext) {
      return responseContext;
    }
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      sendPhoto: (src, caption, options) => this.#messagingGateway.sendPhoto(conversationId, src, caption, options),
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates),
      deleteMessage: (msgId) => this.#messagingGateway.deleteMessage(conversationId, msgId),
    };
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   */
  async execute(input) {
    const {
      userId, conversationId, upc, messageId,
      // The day the client is LOOKING AT (`YYYY-MM-DD`). ABSENT MEANS TODAY,
      // and absent is the ONLY thing Telegram/the scale ever send — which is
      // why `meal` is passed only when a date arrives, leaving NutriLog's own
      // clock default byte-identical for every existing caller.
      date: viewedDate = null,
      responseContext,
    } = input;

    this.#logger.debug?.('logUPC.start', { conversationId, upc, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, conversationId);
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

      // 3. Resolve product: user's catalog first (custom mappings win and can
      // override bad upstream data — spec Data model §3), then the gateway.
      let product = null;
      if (this.#catalogService?.getByUpc) {
        try {
          const entry = await this.#catalogService.getByUpc(upc, userId);
          if (entry) {
            product = {
              name: entry.name,
              brand: null,
              imageUrl: null,
              serving: { size: entry.canonicalGrams, unit: 'g' },
              icon: entry.icon,
              foodId: entry.id,
              nutrition: { ...entry.nutrients },
            };
            this.#logger.info?.('logUPC.catalogHit', { upc, name: entry.name });
          }
        } catch (e) {
          this.#logger.warn?.('logUPC.catalogLookupFailed', { upc, error: e.message });
        }
      }
      if (!product && this.#upcGateway) {
        product = await this.#upcGateway.lookup(upc);
      }

      if (!product) {
        if (status) {
          await status.finish(`❓ Product not found for barcode: ${upc}\n\nYou can describe the food instead.`);
        } else {
          await messaging.updateMessage(statusMsgId, {
            text: `❓ Product not found for barcode: ${upc}\n\nYou can describe the food instead.`,
          });
        }
        return { success: false, error: 'Product not found', unknownUpc: true, upc };
      }

      // 4. Classify product if AI available
      let classification = { icon: 'default', noomColor: 'yellow' };
      if (this.#aiGateway) {
        try {
          classification = await this.#classifyProduct(product);
        } catch (e) {
          this.#logger.warn?.('upc.classify.failed', { upc, error: e.message });
        }

        if (!classification?.icon || classification.icon === 'default') {
          try {
            const icon = await this.#selectIconFromList(product);
            classification.icon = icon || 'default';
          } catch (e) {
            this.#logger.warn?.('upc.iconSelect.failed', { upc, error: e.message });
          }
        }
      }

      // 5. Create food item from product
      const grams = ['g', 'gram', 'grams'].includes(String(product.serving?.unit).toLowerCase())
        && Number(product.serving?.size) > 0 ? Number(product.serving.size) : null;
      const foodItem = {
        label: product.name,
        icon: product.icon || classification.icon,
        foodId: product.foodId || null,
        grams,
        unit: product.serving?.unit || 'serving',
        amount: 1,
        color: classification.noomColor,
        calories: Number(product.nutrition?.calories) || 0,
        protein: Number(product.nutrition?.protein) || 0,
        carbs: Number(product.nutrition?.carbs) || 0,
        fat: Number(product.nutrition?.fat) || 0,
        fiber: Number(product.nutrition?.fiber) || 0,
        sugar: Number(product.nutrition?.sugar) || 0,
        sodium: Number(product.nutrition?.sodium) || 0,
        cholesterol: Number(product.nutrition?.cholesterol) || 0,
      };
      if (this.#catalogService?.resolveIdentity) Object.assign(foodItem, await this.#catalogService.resolveIdentity(foodItem, userId));

      // 6. Create NutriLog entity
      const timezone = this.#config?.getUserTimezone?.(userId) || 'America/Los_Angeles';
      const now = new Date();
      // Decision 2.24: on a day that is not today the clock's hour names no
      // meal on that day, so the day is filled from its first one.
      const meal = viewedDate
        ? {
          date: viewedDate,
          time: viewedDate === formatLocalTimestamp(now, timezone).split(' ')[0]
            ? getMealTimeFromHour(now.getHours())
            : 'morning',
        }
        : undefined;
      const nutriLog = createNutriLog({
        userId,
        conversationId,
        items: [foodItem],
        ...(meal ? { meal } : {}),
        metadata: {
          source: 'upc',
          sourceUpc: upc,
        },
        timezone,
        timestamp: now,
      });

      // 7. Save NutriLog
      if (this.#foodLogStore) {
        await this.#foodLogStore.save(nutriLog);
      }

      // 7b. Record food item in catalog for quick-add
      if (this.#catalogService) {
        try {
          await this.#catalogService.recordUsage({
            foodId: foodItem.foodId,
            name: foodItem.label,
            calories: foodItem.calories,
            protein: foodItem.protein,
            carbs: foodItem.carbs,
            fat: foodItem.fat,
            // The serving the panel describes, which is what makes this row an
            // observation rather than a bare total.
            grams: foodItem.grams,
            unit: foodItem.unit,
            amount: foodItem.amount,
            // PROVENANCE. This use case has always had the barcode in scope and
            // has always thrown it away, hard-coding `source: 'nutritionix'`
            // like the two AI capture paths — which is why all 683 catalog
            // entries claimed the same source and not one carried a UPC, across
            // 224 UPC logs. Writing it revives `getByUpc` and the UPC index,
            // and lets the derivation weight a manufacturer's own panel above a
            // model's guess. It does NOT gate anything: a source gate would
            // freeze 84% of these foods at whichever row wrote first.
            source: 'upc',
            barcodeUpc: upc,
          }, userId);
        } catch (err) {
          this.#logger.warn?.('nutribot.catalog.record_failed', { name: foodItem.label, error: err.message });
        }
      }

      // 8. Build portion selection message
      const caption = this.#buildProductCaption(product, foodItem);
      const portionButtons = this.#buildPortionButtons(nutriLog.id);

      // 9. Cancel status indicator (deletes message) before sending photo
      if (status) {
        await status.cancel();
      } else {
        await messaging.deleteMessage(statusMsgId);
      }

      // 10. Send photo message (messaging platform fetches remote URLs directly)
      let photoMsgId;
      if (product.imageUrl) {
        const result = await messaging.sendPhoto(product.imageUrl, caption, {
          choices: portionButtons,
          inline: true,
        });
        photoMsgId = result.messageId;
      } else {
        const result = await messaging.sendMessage( caption, {
          choices: portionButtons,
          inline: true,
        });
        photoMsgId = result.messageId;
      }

      // Update NutriLog with messageId
      if (this.#foodLogStore && photoMsgId) {
        const updatedLog = nutriLog.with({
          metadata: { ...nutriLog.metadata, messageId: String(photoMsgId) },
        }, new Date());
        await this.#foodLogStore.save(updatedLog);
      }

      this.#logger.info?.('logUPC.complete', {
        conversationId,
        upc,
        productName: product.name,
        logUuid: nutriLog.id,
      });

      return {
        success: true,
        nutrilogUuid: nutriLog.id,
        product,
      };
    } catch (error) {
      this.#logger.error?.('logUPC.error', { conversationId, upc, error: error.message });

      if (status || statusMsgId) {
        try {
          const isNetworkError = error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'EAI_AGAIN';
          const errorMsg = isNetworkError ? `⚠️ Network timeout looking up barcode ${upc}\n\nPlease try again.` : `❌ Error looking up barcode ${upc}\n\n${error.message}`;
          if (status) {
            await status.finish(errorMsg);
          } else {
            await messaging.updateMessage(statusMsgId, { text: errorMsg });
          }
        } catch (e) {
          this.#logger.debug?.('logUPC.updateError.failed', { error: e.message });
        }
      }

      throw error;
    }
  }

  /**
   * Select icon from list
   * @private
   */
  async #selectIconFromList(product) {
    if (!this.#aiGateway) return 'default';

    const availableIcons = this.#foodIconsString.split(' ');

    const prompt = [
      {
        role: 'system',
        content: `Pick the best matching icon filename for the product from this list:
${this.#foodIconsString}

Respond ONLY as JSON: { "icon": "<filename>" }`,
      },
      {
        role: 'user',
        content: `Product: ${product.name}${product.brand ? ` by ${product.brand}` : ''}
Calories: ${product.nutrition?.calories ?? 'unknown'}`,
      },
    ];

    const response = await this.#aiGateway.chat(prompt, { maxTokens: 40 });
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) return 'default';
    const parsed = JSON.parse(match[0]);
    const icon = parsed.icon;
    if (availableIcons.includes(icon)) return icon;
    return 'default';
  }

  /**
   * Classify product using AI
   * @private
   */
  async #classifyProduct(product) {
    const availableIcons = this.#foodIconsString.split(' ');

    const prompt = [
      {
        role: 'system',
        content: `You are matching food products to icon filenames. Available icons:
${this.#foodIconsString}

Choose the MOST relevant icon filename for the product and assign a Noom color:
- green: whole fruits, vegetables, leafy greens
- yellow: lean proteins, whole grains, legumes
- orange: processed foods, high-calorie items

Respond ONLY in JSON: { "icon": "apple", "noomColor": "green" }`,
      },
      {
        role: 'user',
        content: `Product: ${product.name}${product.brand ? ` by ${product.brand}` : ''}\nCalories: ${product.nutrition?.calories || 'unknown'}`,
      },
    ];

    const response = await this.#aiGateway.chat(prompt, { maxTokens: 100 });
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (!availableIcons.includes(parsed.icon)) {
        parsed.icon = 'default';
      }
      return parsed;
    }
    return { icon: 'default', noomColor: 'yellow' };
  }

  /**
   * Build product caption
   * @private
   */
  #buildProductCaption(product, foodItem) {
    const servingSize = product.serving?.size || 100;
    const servingUnit = product.serving?.unit || 'g';
    const brandAlreadyInName = product.brand && product.name.toLowerCase().includes(product.brand.toLowerCase());
    const brandSuffix = product.brand && !brandAlreadyInName ? ` (${product.brand})` : '';
    const colorEmoji = { green: '🟢', yellow: '🟡', orange: '🟠' }[foodItem.color] || '🟡';

    return [
      `${colorEmoji} ${servingSize}${servingUnit} ${product.name}${brandSuffix}`,
      '',
      `🔥 Calories: ${foodItem.calories}`,
      `🍖 Protein: ${foodItem.protein}g`,
      `🍏 Carbs: ${foodItem.carbs}g`,
      `🧀 Fat: ${foodItem.fat}g`,
    ].join('\n');
  }

  /**
   * Build portion selection buttons
   * @private
   */
  #buildPortionButtons(logUuid) {
    return [
      [{ text: '1 serving', callback_data: this.#encodeCallback('p', { id: logUuid, f: 1 }) }],
      [
        { text: '¼', callback_data: this.#encodeCallback('p', { id: logUuid, f: 0.25 }) },
        { text: '⅓', callback_data: this.#encodeCallback('p', { id: logUuid, f: 0.33 }) },
        { text: '½', callback_data: this.#encodeCallback('p', { id: logUuid, f: 0.5 }) },
        { text: '⅔', callback_data: this.#encodeCallback('p', { id: logUuid, f: 0.67 }) },
        { text: '¾', callback_data: this.#encodeCallback('p', { id: logUuid, f: 0.75 }) },
      ],
      [
        { text: '×1¼', callback_data: this.#encodeCallback('p', { id: logUuid, f: 1.25 }) },
        { text: '×1½', callback_data: this.#encodeCallback('p', { id: logUuid, f: 1.5 }) },
        { text: '×2', callback_data: this.#encodeCallback('p', { id: logUuid, f: 2 }) },
        { text: '×3', callback_data: this.#encodeCallback('p', { id: logUuid, f: 3 }) },
        { text: '×4', callback_data: this.#encodeCallback('p', { id: logUuid, f: 4 }) },
      ],
      [{ text: '❌ Cancel', callback_data: this.#encodeCallback('x', { id: logUuid }) }],
    ];
  }
}

export default LogFoodFromUPC;
