/**
 * Nutrition Domain barrel export
 * @module nutrition
 */

// Value Objects
export { Composition } from './value-objects/index.mjs';

// Entities
export { NutriLog } from './entities/NutriLog.mjs';
export { FoodItem } from './entities/FoodItem.mjs';

// Entities — schemas and validation
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

// Entities — formatters
export {
  NOOM_COLOR_EMOJI,
  getNoomColorEmoji,
  getTimeOfDay,
  getCurrentHourInTimezone,
  formatDateHeader,
  formatFoodItem,
  formatFoodList,
} from './entities/formatters.mjs';

// Services
export { FoodLogService } from './services/FoodLogService.mjs';

// Services — scan vocabulary (fridge-sheet QR grammar)
export {
  parseScan,
  encodeDensity,
  encodeContainer,
  RESET_CODE,
  MAX_DENSITY_LEVEL,
} from './services/ScanVocabularyService.mjs';

// Services — scan nutrition math (net weight, calories, macro split)
export {
  computeNet,
  computeNutrition,
} from './services/ScanNutritionService.mjs';
