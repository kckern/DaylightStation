/**
 * Lifelog Extractors Registry
 * 
 * Exports all available extractors for use by LifelogAggregator.
 * Each extractor handles a specific data source and knows how to:
 * 1. Extract data for a specific date
 * 2. Format that data as a human-readable summary
 */

import { garminExtractor } from './garmin.mjs';
import { stravaExtractor } from './strava.mjs';
import { fitnessExtractor } from './fitness.mjs';
import { weightExtractor } from './weight.mjs';
import { eventsExtractor } from './events.mjs';
import { githubExtractor } from './github.mjs';
import { checkinsExtractor } from './checkins.mjs';
import { redditExtractor } from './reddit.mjs';

// Export individual extractors
export {
  garminExtractor,
  stravaExtractor,
  fitnessExtractor,
  weightExtractor,
  eventsExtractor,
  githubExtractor,
  checkinsExtractor,
  redditExtractor
};

/**
 * All extractors in priority order
 * Tier 1: High value, primary data sources
 * Tier 2: Medium value, supplementary data
 */
export const extractors = [
  // Tier 1: Primary sources
  garminExtractor,    // Best aggregated health data
  stravaExtractor,    // Detailed workouts
  eventsExtractor,    // Calendar
  checkinsExtractor,  // Locations
  githubExtractor,    // Code activity
  
  // Tier 2: Supplementary
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
