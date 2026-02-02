// backend/src/2_domains/content/services/RelevanceScoringService.mjs

import { getCategoryScore } from '../value-objects/ContentCategory.mjs';

/**
 * Domain service for calculating search relevance scores.
 *
 * Pure domain logic - no knowledge of specific adapters or sources.
 * Uses category from item.metadata.category to determine base score.
 */
export class RelevanceScoringService {
  /**
   * Calculate relevance score for an item.
   *
   * @param {Object} item - Item to score
   * @param {string} [item.title] - Item title
   * @param {Object} [item.metadata] - Item metadata
   * @param {string} [item.metadata.category] - Content category (from ContentCategory enum)
   * @param {number} [item.childCount] - Number of children (for containers)
   * @param {boolean} [item._idMatch] - Whether this was a direct ID match
   * @param {string} [searchText] - Search text for title matching bonus
   * @returns {number} Relevance score (higher = more relevant)
   */
  static score(item, searchText = '') {
    // ID match always wins
    if (item._idMatch) return 1000;

    // Get base score from category
    const category = item.metadata?.category;
    let score = getCategoryScore(category);

    // Title match bonuses
    if (searchText && item.title) {
      const title = item.title.toLowerCase();
      const search = searchText.toLowerCase();

      if (title === search) {
        score += 20; // Exact match
      } else if (title.startsWith(search)) {
        score += 10; // Starts with
      } else if (title.includes(search)) {
        score += 5; // Contains
      }
    }

    // Child count bonus for containers (up to +5)
    const childCount = item.childCount || item.metadata?.childCount || 0;
    if (childCount > 0) {
      score += Math.min(childCount / 100, 5);
    }

    return score;
  }

  /**
   * Sort items by relevance score (descending).
   *
   * @param {Object[]} items - Items to sort
   * @param {string} [searchText] - Search text for title matching
   * @returns {Object[]} New array sorted by relevance
   */
  static sortByRelevance(items, searchText = '') {
    return [...items].sort((a, b) => {
      const scoreA = RelevanceScoringService.score(a, searchText);
      const scoreB = RelevanceScoringService.score(b, searchText);
      return scoreB - scoreA;
    });
  }
}

export default RelevanceScoringService;
