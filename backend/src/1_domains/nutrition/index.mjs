/**
 * Nutrition Domain barrel export
 * @module nutrition
 */

// Entities
export { NutriLog } from './entities/NutriLog.mjs';
export { FoodItem } from './entities/FoodItem.mjs';

// Schemas and validation
export {
  NoomColors,
  LogStatuses,
  MealTimes,
  SourceTypes,
  validateNoomColor,
  validateLogStatus,
  validateMealTime,
  validateFoodItem,
  validateMeal,
  validateNutriLog,
  getMealTimeFromHour,
  getMealLabel,
  getColorLabel,
} from './entities/schemas.mjs';

// Formatters
export {
  NOOM_COLOR_EMOJI,
  getNoomColorEmoji,
  getTimeOfDay,
  getCurrentHourInTimezone,
  formatDateHeader,
  formatFoodItem,
  formatFoodList,
} from './entities/formatters.mjs';

// Ports (re-exported from application layer for backward compatibility)
export { IFoodLogStore, isFoodLogStore, assertFoodLogStore } from '../../3_applications/nutribot/ports/IFoodLogStore.mjs';
export { INutriListStore, isNutriListStore } from '../../3_applications/nutribot/ports/INutriListStore.mjs';
export { INutriCoachStore, isNutriCoachStore } from '../../3_applications/nutribot/ports/INutriCoachStore.mjs';

// Services
export { FoodLogService } from './services/FoodLogService.mjs';
