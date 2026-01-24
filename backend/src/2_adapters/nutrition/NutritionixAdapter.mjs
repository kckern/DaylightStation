// backend/src/2_adapters/nutrition/NutritionixAdapter.mjs

/**
 * Nutritionix API adapter implementing INutritionLookup
 */
export class NutritionixAdapter {
  #appId;
  #appKey;
  #baseUrl;
  #logger;

  constructor(config) {
    if (!config.appId || !config.appKey) {
      throw new Error('NutritionixAdapter requires appId and appKey');
    }
    this.#appId = config.appId;
    this.#appKey = config.appKey;
    this.#baseUrl = 'https://trackapi.nutritionix.com/v2';
    this.#logger = config.logger || console;
  }

  async #callApi(endpoint, method = 'GET', body = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-app-id': this.#appId,
        'x-app-key': this.#appKey
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.#baseUrl}${endpoint}`, options);
    const data = await response.json();

    if (!response.ok) {
      this.#logger.error?.('nutritionix.error', { endpoint, error: data });
      throw new Error(`Nutritionix API error: ${data.message || response.statusText}`);
    }

    return data;
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
