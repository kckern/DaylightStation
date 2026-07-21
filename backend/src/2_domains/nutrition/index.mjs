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

// Scan vocabulary (fridge-sheet QR grammar)
export {
  parseScan,
  encodeDensity,
  encodeContainer,
  RESET_CODE,
  MAX_DENSITY_LEVEL,
} from './services/ScanVocabularyService.mjs';

// Scan nutrition math (net weight, calories, macro split)
export {
  computeNet,
  computeNutrition,
} from './services/ScanNutritionService.mjs';

// Value objects
export { Composition } from './value-objects/index.mjs';

// Composition buffer (order-independent per-scale slot state machine)
export { createCompositionBuffer } from './CompositionBuffer.mjs';

// Services
export { FoodLogService } from './services/FoodLogService.mjs';
