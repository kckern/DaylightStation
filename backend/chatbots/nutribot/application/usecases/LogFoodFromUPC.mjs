/**
 * Log Food From UPC Use Case
 * @module nutribot/application/usecases/LogFoodFromUPC
 * 
 * Looks up product by UPC barcode and creates a pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Log food from UPC use case
 */
export class LogFoodFromUPC {
  #messagingGateway;
  #upcGateway;
  #aiGateway;
  #nutrilogRepository;
  #conversationStateStore;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#upcGateway = deps.upcGateway;
    this.#aiGateway = deps.aiGateway;
    this.#nutrilogRepository = deps.nutrilogRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {string} input.upc
   * @param {string} [input.messageId]
   */
  async execute(input) {
    const { userId, conversationId, upc, messageId } = input;

    this.#logger.debug('logUPC.start', { conversationId, upc });

    try {
      // 1. Delete original user message
      if (messageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore delete errors
        }
      }

      // 2. Send "Looking up..." message
      const { messageId: statusMsgId } = await this.#messagingGateway.sendMessage(
        conversationId,
        '🔍 Looking up barcode...',
        {}
      );

      // 3. Call UPC gateway
      let product = null;
      if (this.#upcGateway) {
        product = await this.#upcGateway.lookup(upc);
      }

      if (!product) {
        await this.#messagingGateway.updateMessage(conversationId, statusMsgId, {
          text: `❓ Product not found for barcode: ${upc}\n\nYou can describe the food instead.`,
        });
        return { success: false, error: 'Product not found' };
      }

      // 4. Classify product (icon, noom color) if AI available
      let classification = { icon: '🍽️', noomColor: 'yellow' };
      if (this.#aiGateway) {
        try {
          classification = await this.#classifyProduct(product);
        } catch (e) {
          // Use defaults
        }
      }

      // 5. Create food item from product
      const foodItem = {
        name: product.name,
        brand: product.brand,
        quantity: 1,
        unit: product.serving?.unit || 'serving',
        grams: product.serving?.size || 100,
        calories: product.nutrition?.calories || 0,
        protein: product.nutrition?.protein || 0,
        carbs: product.nutrition?.carbs || 0,
        fat: product.nutrition?.fat || 0,
        upc: upc,
        icon: classification.icon,
        noomColor: classification.noomColor,
      };

      // 6. Create log data object
      const nutriLog = {
        uuid: uuidv4(),
        chatId: conversationId,
        items: [foodItem],
        source: 'upc',
        sourceUpc: upc,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      // 7. Save NutriLog
      if (this.#nutrilogRepository) {
        await this.#nutrilogRepository.save(nutriLog);
      }

      // 8. Update conversation state
      if (this.#conversationStateStore) {
        await this.#conversationStateStore.set(conversationId, {
          flow: 'upc_portion',
          pendingLogUuid: nutriLog.uuid,
          productData: product,
        });
      }

      // 9. Build portion selection message
      const caption = this.#buildProductCaption(product, foodItem);
      const portionButtons = this.#buildPortionButtons(nutriLog.uuid);

      // 10. Send product image if available, or update message
      if (product.imageUrl) {
        await this.#messagingGateway.deleteMessage(conversationId, statusMsgId);
        await this.#messagingGateway.sendPhoto(conversationId, product.imageUrl, {
          caption,
          choices: portionButtons,
          inline: true,
        });
      } else {
        await this.#messagingGateway.updateMessage(conversationId, statusMsgId, {
          text: caption,
          choices: portionButtons,
          inline: true,
        });
      }

      this.#logger.info('logUPC.complete', { 
        conversationId, 
        upc,
        productName: product.name,
        logUuid: nutriLog.uuid,
      });

      return {
        success: true,
        nutrilogUuid: nutriLog.uuid,
        product,
      };
    } catch (error) {
      this.#logger.error('logUPC.error', { conversationId, upc, error: error.message });
      throw error;
    }
  }

  /**
   * Classify product using AI
   * @private
   */
  async #classifyProduct(product) {
    const prompt = [
      {
        role: 'system',
        content: `Classify this food product:
1. Pick an emoji icon that best represents it
2. Assign a Noom color: green (whole foods), yellow (lean proteins, whole grains), red (processed/high cal)

Respond in JSON: { "icon": "🍎", "noomColor": "green" }`,
      },
      {
        role: 'user',
        content: `Product: ${product.name}${product.brand ? ` by ${product.brand}` : ''}\nCalories: ${product.nutrition?.calories || 'unknown'}`,
      },
    ];

    const response = await this.#aiGateway.chat(prompt, { maxTokens: 50 });
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return { icon: '🍽️', noomColor: 'yellow' };
  }

  /**
   * Build product caption
   * @private
   */
  #buildProductCaption(product, foodItem) {
    const lines = [
      `${foodItem.icon} **${product.name}**`,
      product.brand ? `_${product.brand}_` : null,
      '',
      `📊 Per serving (${product.serving?.size || 100}${product.serving?.unit || 'g'}):`,
      `• Calories: ${foodItem.calories}`,
      `• Protein: ${foodItem.protein}g`,
      `• Carbs: ${foodItem.carbs}g`,
      `• Fat: ${foodItem.fat}g`,
      '',
      'Select portion:',
    ];
    return lines.filter(Boolean).join('\n');
  }

  /**
   * Build portion selection buttons
   * @private
   */
  #buildPortionButtons(logUuid) {
    return [
      [
        { text: '¼', callback_data: `portion:0.25` },
        { text: '½', callback_data: `portion:0.5` },
        { text: '1', callback_data: `portion:1` },
        { text: '1½', callback_data: `portion:1.5` },
        { text: '2', callback_data: `portion:2` },
      ],
      [
        { text: '🗑️ Cancel', callback_data: `discard:${logUuid}` },
      ],
    ];
  }
}

export default LogFoodFromUPC;
