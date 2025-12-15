/**
 * Mock UPC Gateway
 * @module cli/mocks/MockUPCGateway
 * 
 * Provides UPC product lookups using a local database for CLI testing.
 */

import { createLogger } from '../../_lib/logging/index.mjs';

/**
 * Built-in UPC database with common products
 */
const BUILTIN_UPC_DATABASE = {
  // Beverages
  '049000042566': {
    name: 'Coca-Cola Classic',
    brand: 'Coca-Cola',
    imageUrl: 'https://via.placeholder.com/200?text=Coke',
    servings: [
      { name: '1 can (12 fl oz)', grams: 355, calories: 140, protein: 0, carbs: 39, fat: 0 },
      { name: '1 bottle (20 fl oz)', grams: 591, calories: 240, protein: 0, carbs: 65, fat: 0 },
    ],
  },
  '012000001536': {
    name: 'Pepsi',
    brand: 'PepsiCo',
    imageUrl: 'https://via.placeholder.com/200?text=Pepsi',
    servings: [
      { name: '1 can (12 fl oz)', grams: 355, calories: 150, protein: 0, carbs: 41, fat: 0 },
    ],
  },
  
  // Snacks
  '028400090865': {
    name: "Lay's Classic Potato Chips",
    brand: "Lay's",
    imageUrl: 'https://via.placeholder.com/200?text=Lays',
    servings: [
      { name: '1 oz (about 15 chips)', grams: 28, calories: 160, protein: 2, carbs: 15, fat: 10 },
      { name: '1 bag (2.625 oz)', grams: 74, calories: 420, protein: 5, carbs: 40, fat: 26 },
    ],
  },
  '040000495796': {
    name: "M&M's Peanut",
    brand: 'Mars',
    imageUrl: 'https://via.placeholder.com/200?text=MMs',
    servings: [
      { name: '1 pack (1.74 oz)', grams: 49, calories: 250, protein: 5, carbs: 30, fat: 13 },
      { name: '1/4 cup', grams: 42, calories: 210, protein: 4, carbs: 25, fat: 11 },
    ],
  },
  '030000311103': {
    name: 'Quaker Oats Old Fashioned',
    brand: 'Quaker',
    imageUrl: 'https://via.placeholder.com/200?text=Oats',
    servings: [
      { name: '1/2 cup dry', grams: 40, calories: 150, protein: 5, carbs: 27, fat: 3 },
      { name: '1 cup dry', grams: 80, calories: 300, protein: 10, carbs: 54, fat: 6 },
    ],
  },

  // Dairy
  '070470496443': {
    name: 'Chobani Greek Yogurt Vanilla',
    brand: 'Chobani',
    imageUrl: 'https://via.placeholder.com/200?text=Chobani',
    servings: [
      { name: '1 container (5.3 oz)', grams: 150, calories: 120, protein: 12, carbs: 14, fat: 2 },
    ],
  },
  '041220576074': {
    name: 'Fairlife 2% Milk',
    brand: 'Fairlife',
    imageUrl: 'https://via.placeholder.com/200?text=Fairlife',
    servings: [
      { name: '1 cup', grams: 240, calories: 120, protein: 13, carbs: 6, fat: 5 },
      { name: '1/2 cup', grams: 120, calories: 60, protein: 6, carbs: 3, fat: 2 },
    ],
  },

  // Bars & Energy
  '722252100900': {
    name: 'RXBAR Chocolate Sea Salt',
    brand: 'RXBAR',
    imageUrl: 'https://via.placeholder.com/200?text=RXBAR',
    servings: [
      { name: '1 bar', grams: 52, calories: 210, protein: 12, carbs: 24, fat: 9 },
    ],
  },
  '850251004032': {
    name: 'Quest Bar Cookies & Cream',
    brand: 'Quest Nutrition',
    imageUrl: 'https://via.placeholder.com/200?text=Quest',
    servings: [
      { name: '1 bar', grams: 60, calories: 190, protein: 21, carbs: 21, fat: 8 },
    ],
  },
  '613008739591': {
    name: 'Cliff Bar Chocolate Chip',
    brand: 'Clif',
    imageUrl: 'https://via.placeholder.com/200?text=Clif',
    servings: [
      { name: '1 bar', grams: 68, calories: 250, protein: 9, carbs: 45, fat: 5 },
    ],
  },

  // Bread & Grains
  '072250013727': {
    name: "Dave's Killer Bread 21 Whole Grains",
    brand: "Dave's Killer Bread",
    imageUrl: 'https://via.placeholder.com/200?text=DKB',
    servings: [
      { name: '1 slice', grams: 45, calories: 110, protein: 5, carbs: 22, fat: 1 },
      { name: '2 slices', grams: 90, calories: 220, protein: 10, carbs: 44, fat: 2 },
    ],
  },
  '021000658831': {
    name: 'Minute Rice White',
    brand: 'Minute',
    imageUrl: 'https://via.placeholder.com/200?text=Rice',
    servings: [
      { name: '1/2 cup dry', grams: 95, calories: 160, protein: 3, carbs: 36, fat: 0 },
      { name: '1 cup cooked', grams: 175, calories: 170, protein: 4, carbs: 37, fat: 0 },
    ],
  },

  // Condiments
  '013000006408': {
    name: 'Heinz Tomato Ketchup',
    brand: 'Heinz',
    imageUrl: 'https://via.placeholder.com/200?text=Ketchup',
    servings: [
      { name: '1 tbsp', grams: 17, calories: 20, protein: 0, carbs: 5, fat: 0 },
      { name: '1/4 cup', grams: 68, calories: 80, protein: 0, carbs: 20, fat: 0 },
    ],
  },
  '054100710000': {
    name: 'Hidden Valley Ranch',
    brand: 'Hidden Valley',
    imageUrl: 'https://via.placeholder.com/200?text=Ranch',
    servings: [
      { name: '2 tbsp', grams: 30, calories: 140, protein: 0, carbs: 1, fat: 15 },
    ],
  },

  // Frozen Foods
  '013120004315': {
    name: "Amy's Cheese Pizza",
    brand: "Amy's Kitchen",
    imageUrl: 'https://via.placeholder.com/200?text=Pizza',
    servings: [
      { name: '1/3 pizza', grams: 113, calories: 290, protein: 12, carbs: 37, fat: 11 },
      { name: '1/2 pizza', grams: 170, calories: 435, protein: 18, carbs: 56, fat: 17 },
    ],
  },
  '021131501167': {
    name: "Trader Joe's Chicken Tikka Masala",
    brand: "Trader Joe's",
    imageUrl: 'https://via.placeholder.com/200?text=TikkaMasala',
    servings: [
      { name: '1 package', grams: 340, calories: 430, protein: 26, carbs: 52, fat: 13 },
      { name: '1/2 package', grams: 170, calories: 215, protein: 13, carbs: 26, fat: 6 },
    ],
  },

  // Meat & Protein
  '041130218231': {
    name: 'Applegate Turkey Breast',
    brand: 'Applegate',
    imageUrl: 'https://via.placeholder.com/200?text=Turkey',
    servings: [
      { name: '2 oz', grams: 56, calories: 50, protein: 10, carbs: 1, fat: 0 },
      { name: '4 oz', grams: 112, calories: 100, protein: 20, carbs: 2, fat: 0 },
    ],
  },
};

/**
 * Mock UPC Gateway
 */
export class MockUPCGateway {
  #database;
  #logger;
  #responseDelay;

  /**
   * @param {Object} [options]
   * @param {Object} [options.additionalProducts] - Additional products to include
   * @param {number} [options.responseDelay=200] - Simulated lookup delay
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    this.#database = { ...BUILTIN_UPC_DATABASE, ...(options.additionalProducts || {}) };
    this.#responseDelay = options.responseDelay ?? 200;
    this.#logger = options.logger || createLogger({ source: 'cli:upc', app: 'cli' });
  }

  /**
   * Look up a product by UPC
   * @param {string} upc - UPC barcode
   * @returns {Promise<Object|null>}
   */
  async lookup(upc) {
    this.#logger.debug('lookup', { upc });

    // Simulate network delay
    if (this.#responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.#responseDelay));
    }

    // Normalize UPC (remove leading zeros, handle UPC-A vs UPC-E)
    const normalizedUpc = this.#normalizeUpc(upc);
    
    const product = this.#database[normalizedUpc];
    
    if (product) {
      this.#logger.info('lookup.found', { upc: normalizedUpc, name: product.name });
      return {
        upc: normalizedUpc,
        ...product,
        servings: product.servings.map(s => ({
          ...s,
          color: this.#determineColor(s),
        })),
      };
    }

    this.#logger.info('lookup.notFound', { upc: normalizedUpc });
    return null;
  }

  /**
   * Add a product to the database
   * @param {string} upc
   * @param {Object} product
   */
  addProduct(upc, product) {
    const normalizedUpc = this.#normalizeUpc(upc);
    this.#database[normalizedUpc] = product;
    this.#logger.debug('addProduct', { upc: normalizedUpc, name: product.name });
  }

  /**
   * Remove a product from the database
   * @param {string} upc
   */
  removeProduct(upc) {
    const normalizedUpc = this.#normalizeUpc(upc);
    delete this.#database[normalizedUpc];
    this.#logger.debug('removeProduct', { upc: normalizedUpc });
  }

  /**
   * Get all products (for debugging)
   */
  getAllProducts() {
    return { ...this.#database };
  }

  /**
   * Get product count
   */
  get productCount() {
    return Object.keys(this.#database).length;
  }

  /**
   * Set response delay
   * @param {number} delayMs
   */
  setResponseDelay(delayMs) {
    this.#responseDelay = delayMs;
  }

  // ==================== Private Helpers ====================

  /**
   * Normalize UPC code
   * @private
   */
  #normalizeUpc(upc) {
    // Remove any non-digit characters
    let normalized = upc.replace(/\D/g, '');
    
    // Pad to 12 digits if shorter
    if (normalized.length < 12) {
      normalized = normalized.padStart(12, '0');
    }
    
    // Trim to 12 digits if longer
    if (normalized.length > 12) {
      normalized = normalized.slice(-12);
    }
    
    return normalized;
  }

  /**
   * Determine color category based on nutrition
   * @private
   */
  #determineColor(serving) {
    const caloriesPerGram = serving.calories / serving.grams;
    const proteinRatio = (serving.protein * 4) / serving.calories; // Protein calories as % of total
    const fatRatio = (serving.fat * 9) / serving.calories; // Fat calories as % of total
    
    // Green: Low calorie density, high protein ratio
    if (caloriesPerGram < 1.2 && proteinRatio > 0.3) {
      return 'green';
    }
    
    // Orange: High calorie density or high fat ratio
    if (caloriesPerGram > 3 || fatRatio > 0.5) {
      return 'orange';
    }
    
    // Yellow: Everything else
    return 'yellow';
  }
}

export default MockUPCGateway;
