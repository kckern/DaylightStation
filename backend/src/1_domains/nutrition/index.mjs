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
export { IFoodLogDatastore, isFoodLogDatastore, assertFoodLogDatastore } from '../../3_applications/nutribot/ports/IFoodLogDatastore.mjs';
export { INutriListDatastore, isNutriListDatastore } from '../../3_applications/nutribot/ports/INutriListDatastore.mjs';
export { INutriCoachDatastore, isNutriCoachDatastore } from '../../3_applications/nutribot/ports/INutriCoachDatastore.mjs';

// Services
export { FoodLogService } from './services/FoodLogService.mjs';
