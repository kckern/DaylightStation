/**
 * NutriBot domain module barrel export
 * @module nutribot/domain
 */

export { FoodItem } from './FoodItem.mjs';
export { NutriLog } from './NutriLog.mjs';
export {
  // Enum arrays
  NoomColors,
  LogStatuses,
  MealTimes,
  SourceTypes,
  
  // Validators
  validateNoomColor,
  validateLogStatus,
  validateMealTime,
  validateFoodItem,
  validateMeal,
  validateNutriLog,
  
  // Utility functions
  getMealTimeFromHour,
  getMealLabel,
  getColorLabel,
} from './schemas.mjs';
