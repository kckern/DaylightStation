// backend/src/2_adapters/nutrition/NutritionixAdapter.mjs

/**
 * Nutritionix API adapter implementing INutritionLookup
 */
export class NutritionixAdapter {
  #appId;
  #appKey;
  #baseUrl;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.appId - Nutritionix app ID
   * @param {string} config.appKey - Nutritionix app key
   * @param {Object} deps
   * @param {import('#system/services/HttpClient.mjs').HttpClient} deps.httpClient
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(config, deps = {}) {
    if (!config.appId || !config.appKey) {
      throw new Error('NutritionixAdapter requires appId and appKey');
    }
    if (!deps.httpClient) {
      throw new Error('NutritionixAdapter requires httpClient');
    }
    this.#appId = config.appId;
    this.#appKey = config.appKey;
    this.#baseUrl = 'https://trackapi.nutritionix.com/v2';
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;
  }

  async #callApi(endpoint, method = 'GET', body = null) {
    const headers = {
      'Content-Type': 'application/json',
      'x-app-id': this.#appId,
      'x-app-key': this.#appKey
    };

    const url = `${this.#baseUrl}${endpoint}`;

    try {
      let response;
      if (method === 'GET') {
        response = await this.#httpClient.get(url, { headers });
      } else {
        response = await this.#httpClient.post(url, body, { headers });
      }

      if (!response.ok) {
        this.#logger.error?.('nutritionix.error', { endpoint, error: response.data });
        throw new Error(`Nutrition API error: ${response.data?.message || response.status}`);
      }

      return response.data;
    } catch (error) {
      if (error.code) {
        // HttpError from httpClient
        this.#logger.error?.('nutritionix.error', { endpoint, error: error.message, code: error.code });
        throw new Error(`Nutrition API error: ${error.message}`);
      }
      throw error;
    }
  }

  #mapNutritionixToFoodData(food) {
    return {
      label: food.food_name,
      icon: this.#getFoodIcon(food.food_name),
      grams: food.serving_weight_grams || 100,
      unit: food.serving_unit || 'g',
      amount: food.serving_qty || 1,
      calories: Math.round(food.nf_calories || 0),
      protein: Math.round(food.nf_protein || 0),
      carbs: Math.round(food.nf_total_carbohydrate || 0),
      fat: Math.round(food.nf_total_fat || 0),
      fiber: Math.round(food.nf_dietary_fiber || 0),
      sodium: Math.round(food.nf_sodium || 0),
      sugar: Math.round(food.nf_sugars || 0),
      cholesterol: Math.round(food.nf_cholesterol || 0),
      color: this.#calculateNoomColor(food.nf_calories, food.serving_weight_grams)
    };
  }

  #calculateNoomColor(calories, grams) {
    if (!calories || !grams) return 'yellow';
    const density = calories / grams;
    if (density < 1) return 'green';
    if (density < 2.4) return 'yellow';
    return 'orange';
  }

  #getFoodIcon(foodName) {
    const lowerName = foodName.toLowerCase();
    if (lowerName.includes('apple')) return '🍎';
    if (lowerName.includes('banana')) return '🍌';
    if (lowerName.includes('chicken')) return '🍗';
    if (lowerName.includes('egg')) return '🥚';
    if (lowerName.includes('bread')) return '🍞';
    if (lowerName.includes('rice')) return '🍚';
    if (lowerName.includes('salad')) return '🥗';
    if (lowerName.includes('coffee')) return '☕';
    return '🍽️';
  }

  async lookupByName(foodName) {
    const data = await this.#callApi('/natural/nutrients', 'POST', {
      query: foodName
    });

    if (!data.foods || data.foods.length === 0) {
      return null;
    }

    this.#logger.debug?.('nutritionix.lookup.name', {
      query: foodName,
      results: data.foods.length
    });

    return data.foods.map(food => this.#mapNutritionixToFoodData(food));
  }

  async lookupByUPC(barcode) {
    const data = await this.#callApi(`/search/item?upc=${barcode}`);

    if (!data.foods || data.foods.length === 0) {
      return null;
    }

    this.#logger.debug?.('nutritionix.lookup.upc', {
      barcode,
      product: data.foods[0]?.food_name
    });

    return this.#mapNutritionixToFoodData(data.foods[0]);
  }
}
