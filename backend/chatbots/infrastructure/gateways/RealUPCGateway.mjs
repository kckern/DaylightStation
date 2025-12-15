/**
 * Real UPC Gateway
 * @module infrastructure/gateways/RealUPCGateway
 * 
 * Implements IUPCGateway using the journalist/lib/upc.mjs APIs.
 * Fetches product data from OpenFoodFacts, Edamam, and provides
 * Google image search fallback.
 */

import { createLogger } from '../../_lib/logging/index.mjs';

// Default barcode image fallback
const BARCODE_IMAGE_FALLBACK = (upc) => `https://images.barcodespider.com/upcimage/${upc}.jpg`;

/**
 * Real UPC Gateway - production implementation
 */
export class RealUPCGateway {
  #upcLookupFn;
  #logger;
  #responseDelay;

  /**
   * @param {Object} deps
   * @param {Function} deps.upcLookup - The upcLookup function from journalist/lib/upc.mjs
   * @param {Object} [deps.logger]
   * @param {number} [deps.responseDelay=0] - Optional delay for testing
   */
  constructor(deps = {}) {
    this.#upcLookupFn = deps.upcLookup;
    this.#logger = deps.logger || createLogger({ source: 'upc-gateway', app: 'nutribot' });
    this.#responseDelay = deps.responseDelay || 0;
  }

  /**
   * Look up a product by UPC
   * @param {string} upc - UPC barcode (12-13 digits)
   * @returns {Promise<Object|null>} Product data or null if not found
   */
  async lookup(upc) {
    this.#logger.debug('lookup.start', { upc });

    // Optional delay for testing
    if (this.#responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.#responseDelay));
    }

    // Normalize UPC
    const normalizedUpc = this.#normalizeUpc(upc);

    try {
      // Call the journalist upcLookup function
      if (!this.#upcLookupFn) {
        this.#logger.warn('lookup.noFunction', { upc: normalizedUpc });
        return null;
      }

      const rawProduct = await this.#upcLookupFn(normalizedUpc);

      if (!rawProduct) {
        this.#logger.info('lookup.notFound', { upc: normalizedUpc });
        return null;
      }

      // Transform to expected format
      const product = this.#transformProduct(rawProduct, normalizedUpc);
      
      this.#logger.info('lookup.found', { 
        upc: normalizedUpc, 
        name: product.name,
        hasImage: !!product.imageUrl,
        servingCount: product.servings?.length || 0,
      });

      return product;

    } catch (error) {
      this.#logger.error('lookup.error', { upc: normalizedUpc, error: error.message });
      return null;
    }
  }

  /**
   * Transform raw upc.mjs response to gateway format
   * @private
   */
  #transformProduct(raw, upc) {
    // Extract nutrition from raw.nutrients
    const nutrition = {
      calories: raw.nutrients?.calories || 0,
      protein: raw.nutrients?.protein || 0,
      carbs: raw.nutrients?.carbs || 0,
      fat: raw.nutrients?.fat || 0,
      fiber: raw.nutrients?.fiber || 0,
      sugar: raw.nutrients?.sugar || 0,
      sodium: raw.nutrients?.sodium || 0,
      cholesterol: raw.nutrients?.cholesterol || 0,
    };

    // Get primary serving size
    const primaryServing = raw.servingSizes?.[0] || { quantity: 100, label: 'g' };
    
    // Build servings array with portion options
    const servings = this.#buildServingsArray(raw, nutrition, primaryServing);

    // Get image URL with fallbacks
    const imageUrl = this.#resolveImageUrl(raw, upc);

    return {
      upc,
      name: raw.label || raw.product_name || 'Unknown Product',
      brand: raw.brand || null,
      imageUrl,
      icon: raw.icon || '🍽️',
      noomColor: raw.noom_color || 'yellow',
      
      // Primary serving info
      serving: {
        size: primaryServing.quantity || 100,
        unit: primaryServing.label || 'g',
      },
      
      // Nutrition per serving
      nutrition,
      
      // Multiple serving options
      servings,
      
      // Container info
      servingsPerContainer: raw.servingsPerContainer || 1,
      
      // Raw data for debugging
      raw: raw,
    };
  }

  /**
   * Build servings array with multiple portion options
   * @private
   */
  #buildServingsArray(raw, baseNutrition, primaryServing) {
    const servings = [];
    const baseGrams = primaryServing.quantity || 100;
    const baseLabel = primaryServing.label || 'g';

    // If raw has multiple servingSizes, use them
    if (raw.servingSizes && raw.servingSizes.length > 0) {
      for (const serving of raw.servingSizes) {
        const grams = serving.quantity || 100;
        const ratio = grams / baseGrams;
        
        servings.push({
          name: `${grams} ${serving.label || 'g'}`,
          grams,
          calories: Math.round(baseNutrition.calories * ratio),
          protein: Math.round(baseNutrition.protein * ratio * 10) / 10,
          carbs: Math.round(baseNutrition.carbs * ratio * 10) / 10,
          fat: Math.round(baseNutrition.fat * ratio * 10) / 10,
          color: raw.noom_color || this.#determineColor(baseNutrition.calories * ratio, grams),
        });
      }
    }

    // Add standard portion options if we only have one serving
    if (servings.length <= 1) {
      const portions = [
        { label: '¼ serving', factor: 0.25 },
        { label: '½ serving', factor: 0.5 },
        { label: '1 serving', factor: 1 },
        { label: '1½ servings', factor: 1.5 },
        { label: '2 servings', factor: 2 },
      ];

      for (const portion of portions) {
        const grams = Math.round(baseGrams * portion.factor);
        servings.push({
          name: portion.label,
          grams,
          calories: Math.round(baseNutrition.calories * portion.factor),
          protein: Math.round(baseNutrition.protein * portion.factor * 10) / 10,
          carbs: Math.round(baseNutrition.carbs * portion.factor * 10) / 10,
          fat: Math.round(baseNutrition.fat * portion.factor * 10) / 10,
          color: raw.noom_color || this.#determineColor(baseNutrition.calories * portion.factor, grams),
        });
      }
    }

    // If we have servingsPerContainer, add "whole container" option
    if (raw.servingsPerContainer && raw.servingsPerContainer > 1) {
      const containerGrams = Math.round(baseGrams * raw.servingsPerContainer);
      servings.push({
        name: `Whole container (${raw.servingsPerContainer} servings)`,
        grams: containerGrams,
        calories: Math.round(baseNutrition.calories * raw.servingsPerContainer),
        protein: Math.round(baseNutrition.protein * raw.servingsPerContainer * 10) / 10,
        carbs: Math.round(baseNutrition.carbs * raw.servingsPerContainer * 10) / 10,
        fat: Math.round(baseNutrition.fat * raw.servingsPerContainer * 10) / 10,
        color: 'orange', // Whole container is usually orange/red
      });
    }

    return servings;
  }

  /**
   * Resolve image URL with fallbacks
   * @private
   */
  #resolveImageUrl(raw, upc) {
    // Priority 1: Product image from API
    if (raw.image && typeof raw.image === 'string' && raw.image.length > 0) {
      return raw.image;
    }

    // Priority 2: Image URL field
    if (raw.imageUrl && typeof raw.imageUrl === 'string' && raw.imageUrl.length > 0) {
      return raw.imageUrl;
    }

    // Priority 3: Barcode Spider fallback
    return BARCODE_IMAGE_FALLBACK(upc);
  }

  /**
   * Determine Noom color based on calories and weight
   * @private
   */
  #determineColor(calories, grams) {
    if (!calories || !grams) return 'yellow';
    
    const caloriesPerGram = calories / grams;
    
    // Green: < 1 cal/g (fruits, vegetables, lean proteins)
    if (caloriesPerGram < 1) {
      return 'green';
    }
    
    // Orange/Red: > 3 cal/g (processed foods, sweets, oils)
    if (caloriesPerGram > 3) {
      return 'orange';
    }
    
    // Yellow: 1-3 cal/g (grains, dairy, moderate foods)
    return 'yellow';
  }

  /**
   * Normalize UPC code
   * @private
   */
  #normalizeUpc(upc) {
    // Remove any non-digit characters
    let normalized = String(upc).replace(/\D/g, '');
    
    // Handle UPC-A (12 digits) vs EAN-13 (13 digits)
    // Pad to 12 digits if shorter
    if (normalized.length < 12) {
      normalized = normalized.padStart(12, '0');
    }
    
    return normalized;
  }

  /**
   * Check if a string looks like a UPC barcode
   * @static
   * @param {string} text
   * @returns {boolean}
   */
  static isUPC(text) {
    if (!text || typeof text !== 'string') return false;
    const digitsOnly = text.replace(/\D/g, '');
    // UPC-A is 12 digits, EAN-13 is 13 digits
    return digitsOnly.length >= 8 && digitsOnly.length <= 14;
  }

  /**
   * Extract UPC from text (if present)
   * @static
   * @param {string} text
   * @returns {string|null}
   */
  static extractUPC(text) {
    if (!text || typeof text !== 'string') return null;
    
    // Look for 8-14 consecutive digits
    const match = text.match(/\b\d{8,14}\b/);
    if (match) {
      return match[0];
    }
    
    // Check if entire text (stripped) is a barcode
    const stripped = text.replace(/\D/g, '');
    if (stripped.length >= 8 && stripped.length <= 14) {
      return stripped;
    }
    
    return null;
  }
}

export default RealUPCGateway;
