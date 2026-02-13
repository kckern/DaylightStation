/**
 * UPC Gateway
 * @module adapters/nutribot/UPCGateway
 *
 * Implements UPC barcode lookup using Open Food Facts API
 * with Nutritionix fallback.
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';

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
      const nutriments = p.nutriments || {};

      // Get serving size info
      const servingSize = Number(p.serving_quantity) || 100;
      const servingUnit = p.serving_quantity_unit || 'g';

      // Calculate nutrition per serving (OFF gives per 100g, so scale if needed)
      const scaleFactor = servingSize / 100;

      const nutrition = {
        calories: Math.round((nutriments['energy-kcal_100g'] || nutriments['energy-kcal'] || 0) * scaleFactor),
        protein: Math.round((nutriments.proteins_100g || nutriments.proteins || 0) * scaleFactor * 10) / 10,
        carbs: Math.round((nutriments.carbohydrates_100g || nutriments.carbohydrates || 0) * scaleFactor * 10) / 10,
        fat: Math.round((nutriments.fat_100g || nutriments.fat || 0) * scaleFactor * 10) / 10,
        fiber: Math.round((nutriments.fiber_100g || nutriments.fiber || 0) * scaleFactor * 10) / 10,
        sugar: Math.round((nutriments.sugars_100g || nutriments.sugars || 0) * scaleFactor * 10) / 10,
        sodium: Math.round((nutriments.sodium_100g || nutriments.sodium || 0) * scaleFactor * 1000),
        cholesterol: Math.round((nutriments.cholesterol_100g || nutriments.cholesterol || 0) * scaleFactor * 1000),
      };

      return {
        upc,
        name: p.product_name || p.product_name_en || 'Unknown Product',
        brand: p.brands || null,
        imageUrl: p.image_url || p.image_front_url || BARCODE_IMAGE_FALLBACK(upc),
        icon: '🍽️',
        noomColor: this.#inferNoomColor(nutrition, p.categories_tags || [], servingSize),

        serving: {
          size: servingSize,
          unit: servingUnit,
        },

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
      const servingGrams = food.serving_weight_grams || 100;

      const nutrition = {
        calories: Math.round(food.nf_calories || 0),
        protein: Math.round((food.nf_protein || 0) * 10) / 10,
        carbs: Math.round((food.nf_total_carbohydrate || 0) * 10) / 10,
        fat: Math.round((food.nf_total_fat || 0) * 10) / 10,
        fiber: Math.round((food.nf_dietary_fiber || 0) * 10) / 10,
        sugar: Math.round((food.nf_sugars || 0) * 10) / 10,
        sodium: Math.round(food.nf_sodium || 0),
        cholesterol: Math.round(food.nf_cholesterol || 0),
      };

      return {
        upc,
        name: food.food_name || 'Unknown Product',
        brand: food.brand_name || null,
        imageUrl: food.photo?.thumb || BARCODE_IMAGE_FALLBACK(upc),
        icon: '🍽️',
        noomColor: this.#inferNoomColor(nutrition, [], servingGrams),
        serving: {
          size: servingGrams,
          unit: food.serving_unit || 'g',
        },
        nutrition,
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
