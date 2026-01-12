/**
 * Lifelog Extractors Registry
 *
 * Exports all available extractors for use by LifelogAggregator.
 * Each extractor handles a specific data source and knows how to:
 * 1. Extract data for a specific date
 * 2. Format that data as a human-readable summary
 *
 * @module journalist/extractors
 */

// Interface and categories
import { ILifelogExtractor, ExtractorCategory } from './ILifelogExtractor.mjs';

// Health extractors
import { WeightExtractor, weightExtractor } from './WeightExtractor.mjs';
import { GarminExtractor, garminExtractor } from './GarminExtractor.mjs';
import { NutritionExtractor, nutritionExtractor } from './NutritionExtractor.mjs';

// Fitness extractors
import { StravaExtractor, stravaExtractor } from './StravaExtractor.mjs';
import { FitnessExtractor, fitnessExtractor } from './FitnessExtractor.mjs';

// Productivity extractors
import { CalendarExtractor, calendarExtractor } from './CalendarExtractor.mjs';
import { GithubExtractor, githubExtractor } from './GithubExtractor.mjs';
import { TodoistExtractor, todoistExtractor } from './TodoistExtractor.mjs';
import { ClickupExtractor, clickupExtractor } from './ClickupExtractor.mjs';
import { GmailExtractor, gmailExtractor } from './GmailExtractor.mjs';

// Social extractors
import { RedditExtractor, redditExtractor } from './RedditExtractor.mjs';
import { LastfmExtractor, lastfmExtractor } from './LastfmExtractor.mjs';
import { CheckinsExtractor, checkinsExtractor } from './CheckinsExtractor.mjs';
import { ShoppingExtractor, shoppingExtractor } from './ShoppingExtractor.mjs';

// Journal extractors
import { JournalistExtractor, journalistExtractor } from './JournalistExtractor.mjs';

// Re-export all
export {
  // Interface
  ILifelogExtractor,
  ExtractorCategory,
  // Health
  WeightExtractor,
  weightExtractor,
  GarminExtractor,
  garminExtractor,
  NutritionExtractor,
  nutritionExtractor,
  // Fitness
  StravaExtractor,
  stravaExtractor,
  FitnessExtractor,
  fitnessExtractor,
  // Productivity
  CalendarExtractor,
  calendarExtractor,
  GithubExtractor,
  githubExtractor,
  TodoistExtractor,
  todoistExtractor,
  ClickupExtractor,
  clickupExtractor,
  GmailExtractor,
  gmailExtractor,
  // Social
  RedditExtractor,
  redditExtractor,
  LastfmExtractor,
  lastfmExtractor,
  CheckinsExtractor,
  checkinsExtractor,
  ShoppingExtractor,
  shoppingExtractor,
  // Journal
  JournalistExtractor,
  journalistExtractor,
};

/**
 * All extractors in priority order
 * Tier 0: HIGHEST PRIORITY - User's own words
 * Tier 1: High value, primary data sources
 * Tier 2: Medium value, supplementary data
 */
export const extractors = [
  // Tier 0: User's own words - MOST VALUABLE, never truncate
  journalistExtractor, // User's own journal entries and voice notes - TOP PRIORITY

  // Tier 1: Primary sources
  garminExtractor, // Best aggregated health data
  stravaExtractor, // Detailed workouts
  calendarExtractor, // Calendar events (date-keyed lifelog)
  checkinsExtractor, // Locations
  githubExtractor, // Code activity
  nutritionExtractor, // Nutrition tracking from NutriBot
  shoppingExtractor, // Shopping receipts and spending

  // Tier 2: Productivity & Communication
  todoistExtractor, // Completed tasks
  clickupExtractor, // Completed ClickUp tasks
  gmailExtractor, // Email activity (sent + important received)

  // Tier 3: Supplementary
  lastfmExtractor, // Music listening
  redditExtractor, // Social activity
  weightExtractor, // Weight trends (may overlap with garmin)
  fitnessExtractor, // Fitness fallback (may overlap with strava)
];

/**
 * Get extractor by source name
 * @param {string} source - Source name (e.g., 'garmin', 'strava')
 * @returns {ILifelogExtractor|undefined} Extractor or undefined
 */
export function getExtractor(source) {
  return extractors.find((e) => e.source === source);
}

/**
 * Get extractors by category
 * @param {string} category - Category (e.g., 'health', 'fitness', 'calendar')
 * @returns {Array<ILifelogExtractor>} Array of extractors in that category
 */
export function getExtractorsByCategory(category) {
  return extractors.filter((e) => e.category === category);
}

export default extractors;
