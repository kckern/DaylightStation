/** Published Health nutrition contract; implementation remains owned by Health. */
export { MealTimes, getMealTimeFromHour, validateFoodItem, validateMealTime } from "./domain/nutrition/entities/schemas.mjs";
export { NOOM_COLOR_EMOJI } from "./domain/nutrition/entities/formatters.mjs";
export { usableServing } from "./domain/health/entities/FoodCatalogEntry.mjs";
export { computeNutrition } from "./domain/nutrition/index.mjs";
