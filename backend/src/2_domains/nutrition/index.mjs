/**
 * Nutrition Domain barrel export
 * @module nutrition
 */

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

// Services — scan vocabulary (fridge-sheet QR grammar)
export {
  parseScan,
  encodeDensity,
  encodeContainer,
  encodeControl,
  CONTROL_VERBS,
  RESET_CODE,
  MAX_DENSITY_CODE,
  MAX_DENSITY_LEVEL,
} from './services/ScanVocabularyService.mjs';

// Services — what a scale observation's value may be, per kind
export {
  validateObservationValue,
  validateWeightValue,
  validateWeightUnit,
  validateDensityValue,
  validateContainerValue,
  validateUpcValue,
} from './services/ObservationValue.mjs';

// Services — scan nutrition math (net weight, calories, macro split)
export {
  computeNet,
  computeNutrition,
} from './services/ScanNutritionService.mjs';
