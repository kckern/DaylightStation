/** Persistence and lookup contracts shared by Health capture clients. */
export { IFoodLogDatastore, isFoodLogDatastore, assertFoodLogDatastore } from './application/nutrition/ports/IFoodLogDatastore.mjs';
export { INutriListDatastore, isNutriListDatastore } from './application/nutrition/ports/INutriListDatastore.mjs';
export { INutriLogDatastore, isNutriLogDatastore } from './application/nutrition/ports/INutriLogDatastore.mjs';
export { INutritionLookup, isNutritionLookup } from './application/nutrition/ports/INutritionLookup.mjs';
