/**
 * UPC Gateway
 * @module adapters/nutribot/UPCGateway
 *
 * Implements UPC barcode lookup using Open Food Facts API
 * with Nutritionix fallback.
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { normalizeProductNutrition, normalizeNutritionixNutrition } from './normalizeProductNutrition.mjs';

// Default barcode image fallback
const BARCODE_IMAGE_FALLBACK = (upc) => `https://images.barcodespider.com/upcimage/${upc}.jpg`;

// Open Food Facts API
const OPEN_FOOD_FACTS_API = 'https://world.openfoodfacts.org/api/v0/product';

// Nutritionix API
const NUTRITIONIX_API = 'https://trackapi.nutritionix.com/v2/search/item';

/**
 * UPC Gateway - looks up products by barcode
 */
export class UPCGateway {
  #httpClient;
  #calorieColorService;
  #nutritionix;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('#system/services/HttpClient.mjs').HttpClient} deps.httpClient
   * @param {import('#domains/nutrition/services/CalorieColorService.mjs').CalorieColorService} [deps.calorieColorService]
   * @param {{ appId: string, appKey: string }} [deps.nutritionix] - Nutritionix credentials for fallback lookups
   * @param {Object} [deps.logger]
   */
  constructor(deps = {}) {
    if (!deps.httpClient) {
      throw new InfrastructureError('UPCGateway requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }
    this.#httpClient = deps.httpClient;
    this.#calorieColorService = deps.calorieColorService;
    this.#nutritionix = (deps.nutritionix?.appId && deps.nutritionix?.appKey) ? deps.nutritionix : null;
    this.#logger = deps.logger || console;
  }

  /**
   * Look up a product by UPC
   * @param {string} upc - UPC barcode (12-13 digits)
   * @returns {Promise<Object|null>} Product data or null if not found
   */
  async lookup(upc) {
    this.#logger.debug?.('upc.lookup.start', { upc });

    const normalizedUpc = this.#normalizeUpc(upc);

    try {
      const product = await this.#lookupOpenFoodFacts(normalizedUpc);
      if (product) {
        this.#logger.info?.('upc.lookup.found', {
          upc: normalizedUpc,
          source: 'openfoodfacts',
          name: product.name,
          hasImage: !!product.imageUrl,
        });
        return product;
      }

      // Fallback to Nutritionix
      if (this.#nutritionix) {
        const nxProduct = await this.#lookupNutritionix(normalizedUpc);
        if (nxProduct) {
          this.#logger.info?.('upc.lookup.found', {
            upc: normalizedUpc,
            source: 'nutritionix',
            name: nxProduct.name,
          });
          return nxProduct;
        }
      }

      this.#logger.info?.('upc.lookup.notFound', { upc: normalizedUpc });
      return null;
    } catch (error) {
      this.#logger.error?.('upc.lookup.error', { upc: normalizedUpc, error: error.message });
      return null;
    }
  }

  /**
   * Look up product from Open Food Facts
   * @private
   */
  async #lookupOpenFoodFacts(upc) {
    try {
      const response = await this.#httpClient.get(`${OPEN_FOOD_FACTS_API}/${upc}.json`, {
        headers: {
          'User-Agent': 'DaylightStation/1.0 (nutribot)',
        },
      });

      if (!response.ok) {
        this.#logger.debug?.('upc.off.httpError', { upc, status: response.status });
        return null;
      }

      const data = response.data;

      if (data.status !== 1 || !data.product) {
        this.#logger.debug?.('upc.off.notFound', { upc, status: data.status });
        return null;
      }

      const p = data.product;
      const { nutrition, serving, nutritionLookup } = normalizeProductNutrition(p);

      return {
        upc,
        name: p.product_name || p.product_name_en || 'Unknown Product',
        brand: p.brands || null,
        imageUrl: p.image_url || p.image_front_url || BARCODE_IMAGE_FALLBACK(upc),
        icon: '🍽️',
        noomColor: serving.unit === 'g' ? this.#inferNoomColor(nutrition, p.categories_tags || [], serving.size) : 'yellow',
        serving,
        nutritionLookup,

        nutrition,
      };
    } catch (error) {
      this.#logger.debug?.('upc.off.error', { upc, error: error.message });
      return null;
    }
  }

  /**
   * Look up product from Nutritionix (fallback)
   * @private
   */
  async #lookupNutritionix(upc) {
    try {
      const response = await this.#httpClient.get(`${NUTRITIONIX_API}?upc=${upc}`, {
        headers: {
          'x-app-id': this.#nutritionix.appId,
          'x-app-key': this.#nutritionix.appKey,
        },
      });

      if (!response.ok || !response.data?.foods?.length) {
        this.#logger.debug?.('upc.nutritionix.notFound', { upc, status: response.status });
        return null;
      }

      const food = response.data.foods[0];
      const normalized = normalizeNutritionixNutrition(food);
      const { nutrition, serving } = normalized;

      return {
        upc,
        name: food.food_name || 'Unknown Product',
        brand: food.brand_name || null,
        imageUrl: food.photo?.thumb || BARCODE_IMAGE_FALLBACK(upc),
        icon: '🍽️',
        noomColor: serving.unit === 'g' ? this.#inferNoomColor(nutrition, [], serving.size) : 'yellow',
        ...normalized,
      };
    } catch (error) {
      this.#logger.debug?.('upc.nutritionix.error', { upc, error: error.message });
      return null;
    }
  }

  /**
   * Infer color classification from nutrition and serving size
   * Uses CalorieColorService if injected, otherwise falls back to inline logic
   * @private
   */
  #inferNoomColor(nutrition, categories, servingGrams = 100) {
    // Use domain service if available
    if (this.#calorieColorService) {
      return this.#calorieColorService.classifyByDensity({
        calories: nutrition.calories,
        servingGrams,
        categories,
      });
    }

    // Fallback: inline logic for backwards compatibility
    const greenCategories = ['vegetables', 'fruits', 'salads', 'leafy'];
    const isGreenCategory = categories.some((cat) => greenCategories.some((g) => cat.toLowerCase().includes(g)));
    if (isGreenCategory) return 'green';

    const grams = Number(servingGrams) || 100;
    const calories = Number(nutrition.calories) || 0;
    const caloriesPerGram = grams > 0 ? calories / grams : 0;

    if (caloriesPerGram < 1.0) return 'green';
    if (caloriesPerGram <= 2.4) return 'yellow';
    return 'orange';
  }

  /**
   * Normalize UPC code
   * @private
   */
  #normalizeUpc(upc) {
    let normalized = String(upc).replace(/\D/g, '');
    if (normalized.length < 12) {
      normalized = normalized.padStart(12, '0');
    }
    return normalized;
  }

  /**
   * Check if a string looks like a UPC barcode
   * @static
   */
  static isUPC(text) {
    if (!text || typeof text !== 'string') return false;
    const digitsOnly = text.replace(/\D/g, '');
    return digitsOnly.length >= 8 && digitsOnly.length <= 14;
  }

  /**
   * Extract UPC from text
   * @static
   */
  static extractUPC(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/\b\d{8,14}\b/);
    if (match) return match[0];
    const stripped = text.replace(/\D/g, '');
    if (stripped.length >= 8 && stripped.length <= 14) return stripped;
    return null;
  }
}

export default UPCGateway;
