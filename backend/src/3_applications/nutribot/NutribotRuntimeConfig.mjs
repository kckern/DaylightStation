export const DEFAULT_NUTRITION_GOALS = Object.freeze({
  calories: 2000,
  calories_min: 1600,
  calories_max: 2000,
  protein: 150,
  carbs: 200,
  fat: 65,
  fiber: 30,
  sodium: 2300,
});

/** Supplies the legacy Nutribot config interface without putting defaults in composition. */
export function createNutribotRuntimeConfig(rawConfig = {}) {
  return {
    ...rawConfig,
    getUserGoals: rawConfig?.getUserGoals?.bind(rawConfig) || (() => DEFAULT_NUTRITION_GOALS),
    getUserTimezone: rawConfig?.getUserTimezone?.bind(rawConfig) || (() => 'America/Los_Angeles'),
    getDefaultTimezone: rawConfig?.getDefaultTimezone?.bind(rawConfig) || (() => 'America/Los_Angeles'),
    getThresholds: rawConfig?.getThresholds?.bind(rawConfig) || (() => ({ daily: 2000 })),
  };
}
