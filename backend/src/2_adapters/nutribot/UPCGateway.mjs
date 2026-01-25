/**
 * UPC Gateway
 * @module adapters/nutribot/UPCGateway
 *
 * Implements UPC barcode lookup using Open Food Facts API.
 */

// Default barcode image fallback
const BARCODE_IMAGE_FALLBACK = (upc) => `https://images.barcodespider.com/upcimage/${upc}.jpg`;

// Open Food Facts API
const OPEN_FOOD_FACTS_API = 'https://world.openfoodfacts.org/api/v0/product';

/**
 * UPC Gateway - looks up products by barcode
 */
export class UPCGateway {
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} [deps.logger]
   */
  constructor(deps = {}) {
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
          name: product.name,
          hasImage: !!product.imageUrl,
        });
        return product;
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
      const response = await fetch(`${OPEN_FOOD_FACTS_API}/${upc}.json`, {
        headers: {
          'User-Agent': 'DaylightStation/1.0 (nutribot)',
        },
      });

      if (!response.ok) {
        this.#logger.debug?.('upc.off.httpError', { upc, status: response.status });
        return null;
      }

      const data = await response.json();

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
   * Infer Noom color from nutrition and serving size
   * - Green: < 1.0 cal/g
   * - Yellow: 1.0-2.4 cal/g
   * - Orange: > 2.4 cal/g
   * @private
   */
  #inferNoomColor(nutrition, categories, servingGrams = 100) {
    // Check categories for green foods
    const greenCategories = ['vegetables', 'fruits', 'salads', 'leafy'];
    const isGreenCategory = categories.some((cat) => greenCategories.some((g) => cat.toLowerCase().includes(g)));
    if (isGreenCategory) return 'green';

    // Calculate calorie density
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
