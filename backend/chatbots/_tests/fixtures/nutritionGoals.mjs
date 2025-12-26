import { DEFAULT_NUTRITION_GOALS } from '../../bots/nutribot/config/NutriBotConfig.mjs';

// Shared test fixtures for nutrition goals to avoid hardcoding defaults across tests
export const TEST_GOALS = DEFAULT_NUTRITION_GOALS;

export const CUSTOM_TEST_GOALS = {
  lowCalorie: { ...DEFAULT_NUTRITION_GOALS, calories: 1600 },
  highProtein: { ...DEFAULT_NUTRITION_GOALS, protein: 200 },
  minimal: { calories: DEFAULT_NUTRITION_GOALS.calories, protein: DEFAULT_NUTRITION_GOALS.protein },
};
