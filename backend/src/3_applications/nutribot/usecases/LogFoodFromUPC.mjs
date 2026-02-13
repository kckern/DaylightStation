/**
 * Log Food From UPC Use Case
 * @module nutribot/usecases/LogFoodFromUPC
 *
 * Looks up product by UPC barcode and creates a pending log.
 */

import { NutriLog } from '#domains/nutrition/entities/NutriLog.mjs';

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
    const { userId, conversationId, upc, messageId, responseContext } = input;

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

      // 3. Call UPC gateway
      let product = null;
      if (this.#upcGateway) {
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
        return { success: false, error: 'Product not found' };
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
      const grams = Number(product.serving?.size) || 100;
      const foodItem = {
        label: product.name,
        icon: classification.icon,
        grams: grams > 0 ? grams : 100,
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

      // 6. Create NutriLog entity
      const timezone = this.#config?.getUserTimezone?.(userId) || 'America/Los_Angeles';
      const now = new Date();
      const nutriLog = NutriLog.create({
        userId,
        conversationId,
        items: [foodItem],
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
