/**
 * Nutribot Application Module
 * @module nutribot
 *
 * Main entry point for the Nutribot application.
 * Exports the container, config, and use cases.
 */

export { NutribotContainer } from './NutribotContainer.mjs';
export { NutriBotConfig, DEFAULT_NUTRITION_GOALS } from './config/NutriBotConfig.mjs';

// Re-export all use cases for convenience
export * from './usecases/index.mjs';
