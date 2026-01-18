/**
 * Lifelog Extractors Registry
 * 
 * Exports all available extractors for use by LifelogAggregator.
 * Each extractor handles a specific data source and knows how to:
 * 1. Extract data for a specific date
 * 2. Format that data as a human-readable summary
 */

import { stravaExtractor } from './strava.mjs';
import { fitnessExtractor } from './fitness.mjs';
import { weightExtractor } from './weight.mjs';
import { eventsExtractor } from './events.mjs';
import { calendarExtractor } from './calendar.mjs';
import { githubExtractor } from './github.mjs';
import { checkinsExtractor } from './checkins.mjs';
import { redditExtractor } from './reddit.mjs';
import { nutritionExtractor } from './nutrition.mjs';
import { lastfmExtractor } from './lastfm.mjs';
import { shoppingExtractor } from './shopping.mjs';
import { journalistExtractor } from './journalist.mjs';
import { gmailExtractor } from './gmail.mjs';
import { todoistExtractor } from './todoist.mjs';
import { clickupExtractor } from './clickup.mjs';

// Export individual extractors
export {
  stravaExtractor,
  fitnessExtractor,
  weightExtractor,
  eventsExtractor,
  calendarExtractor,
  githubExtractor,
  checkinsExtractor,
  redditExtractor,
  nutritionExtractor,
  lastfmExtractor,
  shoppingExtractor,
  journalistExtractor,
  gmailExtractor,
  todoistExtractor,
  clickupExtractor
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
  stravaExtractor,    // Detailed workouts
  calendarExtractor,  // Calendar events (date-keyed lifelog)
  // eventsExtractor removed - was duplicate of calendarExtractor, both output "CALENDAR EVENTS"
  checkinsExtractor,  // Locations
  githubExtractor,    // Code activity
  nutritionExtractor, // Nutrition tracking from NutriBot
  shoppingExtractor,  // Shopping receipts and spending
  
  // Tier 2: Productivity & Communication
  todoistExtractor,   // Completed tasks
  clickupExtractor,   // Completed ClickUp tasks
  gmailExtractor,     // Email activity (sent + important received)
  
  // Tier 3: Supplementary
  lastfmExtractor,    // Music listening
  redditExtractor,    // Social activity
  weightExtractor,    // Weight trends (may overlap with garmin)
  fitnessExtractor,   // Fitness fallback (may overlap with strava)
];

/**
 * Get extractor by source name
 * @param {string} source - Source name (e.g., 'garmin', 'strava')
 * @returns {Object|undefined} Extractor or undefined
 */
export function getExtractor(source) {
  return extractors.find(e => e.source === source);
}

/**
 * Get extractors by category
 * @param {string} category - Category (e.g., 'health', 'fitness', 'calendar')
 * @returns {Array} Array of extractors in that category
 */
export function getExtractorsByCategory(category) {
  return extractors.filter(e => e.category === category);
}

export default extractors;
