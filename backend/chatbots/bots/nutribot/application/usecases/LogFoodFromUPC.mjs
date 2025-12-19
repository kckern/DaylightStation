/**
 * Log Food From UPC Use Case
 * @module nutribot/application/usecases/LogFoodFromUPC
 * 
 * Looks up product by UPC barcode and creates a pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../../../_lib/logging/index.mjs';
import { ConversationState } from '../../../../domain/entities/ConversationState.mjs';
import { NutriLog } from '../../domain/NutriLog.mjs';
import { createCanvas } from 'canvas';
import bwipjs from 'bwip-js';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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
        `🔍 Looking up barcode ${upc}...`
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

      // 5. Create food item from product (using FoodItem expected field names)
      const foodItem = {
        label: product.name,           // FoodItem uses 'label' not 'name'
        icon: classification.icon,
        grams: product.serving?.size || 100,
        unit: product.serving?.unit || 'serving',
        amount: 1,
        color: classification.noomColor, // FoodItem uses 'color' not 'noomColor'
        // Nutrition fields
        calories: product.nutrition?.calories ?? 0,
        protein: product.nutrition?.protein ?? 0,
        carbs: product.nutrition?.carbs ?? 0,
        fat: product.nutrition?.fat ?? 0,
        fiber: product.nutrition?.fiber ?? 0,
        sugar: product.nutrition?.sugar ?? 0,
        sodium: product.nutrition?.sodium ?? 0,
        cholesterol: product.nutrition?.cholesterol ?? 0,
      };

      // 6. Create NutriLog entity
      const userId = conversationId.split('_').pop(); // Extract user ID from conversationId
      const nutriLog = NutriLog.create({
        userId,
        conversationId,
        items: [foodItem],
        metadata: {
          source: 'upc',
          sourceUpc: upc,
        },
      });

      // 7. Save NutriLog
      if (this.#nutrilogRepository) {
        await this.#nutrilogRepository.save(nutriLog);
      }

      // 8. Update conversation state
      if (this.#conversationStateStore) {
        const state = ConversationState.create(conversationId, {
          activeFlow: 'upc_portion',
          flowState: { 
            pendingLogUuid: nutriLog.id,
            productData: product,
          },
        });
        await this.#conversationStateStore.set(conversationId, state);
      }

      // 9. Build portion selection message
      const caption = this.#buildProductCaption(product, foodItem);
      const portionButtons = this.#buildPortionButtons(nutriLog.id);

      // 10. Get or generate image (always send photo, never text)
      await this.#messagingGateway.deleteMessage(conversationId, statusMsgId);
      
      let imagePath = null;
      
      // Try to fetch product image locally
      if (product.imageUrl) {
        try {
          imagePath = await this.#downloadImageToTemp(product.imageUrl, upc);
          this.#logger.debug('logUPC.imageFetched', { upc, imagePath });
        } catch (e) {
          this.#logger.warn('logUPC.imageFetchFailed', { upc, error: e.message });
        }
      }
      
      // Always generate barcode image if no product image available
      if (!imagePath) {
        imagePath = await this.#generateBarcodeImage(upc, product.name);
        this.#logger.debug('logUPC.barcodeGenerated', { upc, imagePath });
      }
      
      // Always send photo (barcode fallback guarantees we have an image)
      await this.#messagingGateway.sendPhoto(conversationId, imagePath, {
        caption,
        choices: portionButtons,
        inline: true,
      });

      this.#logger.info('logUPC.complete', { 
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
      this.#logger.error('logUPC.error', { conversationId, upc, error: error.message });
      throw error;
    }
  }

  /**
   * Classify product using AI
   * @private
   */
  async #classifyProduct(product) {
    const { FOOD_ICONS_STRING } = await import('../constants/foodIcons.mjs');
    const availableIcons = FOOD_ICONS_STRING.split(' ');

    const prompt = [
      {
        role: 'system',
        content: `You are matching food products to icon filenames. Available icons:
${FOOD_ICONS_STRING}

Choose the MOST relevant icon filename for the product and assign a Noom color:
- green: whole fruits, vegetables, leafy greens
- yellow: lean proteins, whole grains, legumes
- orange: processed foods, high-calorie items

Respond ONLY in JSON: { "icon": "apple", "noomColor": "green" }
If unsure, use "default" icon.`,
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
      // Validate icon exists
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
    const brandSuffix = product.brand ? ` (${product.brand})` : '';
    
    const lines = [
      `${servingSize}${servingUnit} ${product.name}${brandSuffix}`,
      '',
      `🔥 Calories: ${foodItem.calories}`,
      `🍖 Protein: ${foodItem.protein}g`,
      `🍏 Carbs: ${foodItem.carbs}g`,
      `🧀 Fat: ${foodItem.fat}g`,
    ];
    return lines.join('\n');
  }

  /**
   * Build portion selection buttons (matches legacy foodlog_hook.mjs format)
   * @private
   */
  #buildPortionButtons(logUuid) {
    return [
      // One serving row
      [
        { text: '1 serving', callback_data: `portion:1` },
      ],
      // Fraction row
      [
        { text: '¼', callback_data: `portion:0.25` },
        { text: '⅓', callback_data: `portion:0.33` },
        { text: '½', callback_data: `portion:0.5` },
        { text: '⅔', callback_data: `portion:0.67` },
        { text: '¾', callback_data: `portion:0.75` },
      ],
      // Multiplier row
      [
        { text: '×1¼', callback_data: `portion:1.25` },
        { text: '×1½', callback_data: `portion:1.5` },
        { text: '×2', callback_data: `portion:2` },
        { text: '×3', callback_data: `portion:3` },
        { text: '×4', callback_data: `portion:4` },
      ],
      // Cancel row
      [
        { text: '❌ Cancel', callback_data: `discard:${logUuid}` },
      ],
    ];
  }

  /**
   * Download image to temp directory
   * @private
   */
  async #downloadImageToTemp(imageUrl, upc) {
    const tmpDir = path.join(os.tmpdir(), 'nutribot-upc');
    await fs.mkdir(tmpDir, { recursive: true });
    
    // Handle proxy URLs from upc.mjs (format: .../nutribot/images/{encodedUrl}/{productName}/{upc})
    // Extract the original image URL if it's a proxy URL
    let actualUrl = imageUrl;
    if (imageUrl.includes('/nutribot/images/')) {
      const parts = imageUrl.split('/nutribot/images/');
      if (parts[1]) {
        // The encoded URL is the first path segment after /nutribot/images/
        const encodedPart = parts[1].split('/')[0];
        try {
          actualUrl = decodeURIComponent(encodedPart);
        } catch (e) {
          // Keep original if decode fails
        }
      }
    }
    
    // Get extension from actual URL
    const urlPath = actualUrl.split('?')[0];
    const ext = urlPath.split('.').pop()?.toLowerCase() || 'jpg';
    const safeExt = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? ext : 'jpg';
    const filePath = path.join(tmpDir, `${upc}-${Date.now()}.${safeExt}`);
    
    const response = await axios.get(actualUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
    });
    
    await fs.writeFile(filePath, response.data);
    return filePath;
  }

  /**
   * Generate a barcode image for the UPC (similar to food_report.mjs generateBarcode)
   * @private
   */
  async #generateBarcodeImage(upc, productName) {
    const tmpDir = path.join(os.tmpdir(), 'nutribot-upc');
    await fs.mkdir(tmpDir, { recursive: true });
    
    const canvasWidth = 400;
    const canvasHeight = 200;
    const margin = { top: 20, right: 20, bottom: 50, left: 20 };

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');
    
    // White background
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Generate the barcode using bwip-js (code128 like reference)
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: 'code128',
      text: upc,
      scale: 3,
      height: canvasHeight - margin.top - margin.bottom,
      includetext: false,
    });

    // Load and draw barcode
    const { loadImage } = await import('canvas');
    const barcodeImage = await loadImage(barcodeBuffer);
    
    ctx.drawImage(
      barcodeImage,
      margin.left,
      margin.top,
      canvasWidth - margin.left - margin.right,
      canvasHeight - margin.top - margin.bottom - 30
    );

    // Draw UPC number centered
    ctx.font = 'bold 24px Arial';
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.fillText(upc, canvasWidth / 2, canvasHeight - margin.bottom + 30);
    
    // Draw product name (truncated) at top
    ctx.font = '14px Arial';
    const truncatedName = productName.length > 45 
      ? productName.substring(0, 42) + '...' 
      : productName;
    ctx.fillText(truncatedName, canvasWidth / 2, canvasHeight - 5);

    // Save to file
    const filePath = path.join(tmpDir, `barcode-${upc}-${Date.now()}.png`);
    const buffer = canvas.toBuffer('image/png');
    await fs.writeFile(filePath, buffer);
    
    return filePath;
  }
}

export default LogFoodFromUPC;
