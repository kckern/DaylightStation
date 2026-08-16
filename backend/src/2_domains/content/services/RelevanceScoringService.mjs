// backend/src/2_domains/content/services/RelevanceScoringService.mjs

import { getCategoryScore, getCategoryTiebreak } from '../value-objects/ContentCategory.mjs';

/**
 * Domain service for calculating search relevance scores.
 *
 * Pure domain logic - no knowledge of specific adapters or sources.
 *
 * Two distinct modes, because they answer different questions:
 *
 *  - **No search text** (browse): the only available signal is what kind of
 *    thing an item is, so the category scale (10..150) orders the list —
 *    shows and playlists above loose episodes.
 *
 *  - **With search text** (search): match quality is the sort key and category
 *    is only a tiebreaker between equally good matches. Scoring category first
 *    made episodes, tracks and image files unreachable: their category floor
 *    (10..20) sat below the ceiling of any container category (125..150), so a
 *    perfect exact-title episode lost to a movie that merely contained the term
 *    somewhere in a long subtitle. See
 *    docs/_wip/audits/2026-08-16-content-search-and-image-preview-audit.md.
 */

/** Direct-id matches short-circuit everything else. */
const ID_MATCH_SCORE = 10000;

/**
 * Match-quality tiers. Ordered and spaced so that no combination of the
 * secondary signals below (coverage 0..100, category 0..9, childCount 0..5)
 * can promote a weaker tier above a stronger one.
 */
const MATCH_EXACT = 2000;          // title is exactly the query
const MATCH_PREFIX = 1600;         // title starts with the whole query
const MATCH_TOKENS_ORDERED = 1200; // every token a whole word, in query order
const MATCH_TOKENS_ALL = 1000;     // every token a whole word, any order
const MATCH_TOKENS_WORD_PREFIX = 800; // every token prefixes some word (typeahead)
const MATCH_TOKENS_SUBSTRING = 600;   // every token appears somewhere

/**
 * Cross-field matches (tokens satisfied only once the show/season/subtitle is
 * folded in) rank below the same tier scored on the title alone, but still
 * above any weaker title-only tier.
 */
const CROSS_FIELD_FACTOR = 0.45;

/** Ceiling for the coverage bonus (see #coverageBonus). */
const MAX_COVERAGE_BONUS = 100;

/** Ceiling for the container childCount nudge. */
const MAX_CHILD_COUNT_BONUS = 5;

/**
 * Fold a string into comparable tokens: lowercase, punctuation to spaces,
 * whitespace collapsed. Keeps digits (episode numbers, hymn numbers) intact.
 *
 * Apostrophes are stripped rather than turned into spaces, so "Job's" folds to
 * one token "jobs" and matches a query typed either way. Real titles use both
 * the straight and the typographic apostrophe ("Job’s Challenge", "Pharaoh's
 * Dream"), and splitting on them would leave a stray "s" token that no query
 * ever supplies.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/['‘’ʼ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Classify how well a normalized field satisfies the query.
 * @param {string} field - Normalized haystack
 * @param {string} query - Normalized full query
 * @param {string[]} tokens - Normalized query tokens
 * @returns {number} One of the MATCH_* tiers, or 0 for no match
 */
function matchTier(field, query, tokens) {
  if (!field || !tokens.length) return 0;

  if (field === query) return MATCH_EXACT;
  if (field.startsWith(query)) return MATCH_PREFIX;

  const words = field.split(' ');

  // Whole-word matches, tracking position so we can tell ordered from scattered.
  const positions = tokens.map(token => words.indexOf(token));
  if (positions.every(pos => pos !== -1)) {
    const ordered = positions.every((pos, i) => i === 0 || pos > positions[i - 1]);
    return ordered ? MATCH_TOKENS_ORDERED : MATCH_TOKENS_ALL;
  }

  // Typeahead: every token prefixes some word ("est" -> "esther").
  if (tokens.every(token => words.some(word => word.startsWith(token)))) {
    return MATCH_TOKENS_WORD_PREFIX;
  }

  // Weakest accepted match: every token appears somewhere in the field.
  if (tokens.every(token => field.includes(token))) {
    return MATCH_TOKENS_SUBSTRING;
  }

  return 0;
}

/**
 * Fraction of the matched field the query actually accounts for, as a 0..100
 * bonus. This is the signal that separates "Job" from "Cracking the PM
 * Interview: How to Land a Product Manager Job in Technology" — both contain
 * the term, but the first IS the term.
 * @param {string} field - Normalized field the match was found in
 * @param {string[]} tokens - Normalized query tokens
 * @returns {number} 0..MAX_COVERAGE_BONUS
 */
function coverageBonus(field, tokens) {
  if (!field) return 0;
  const matchedChars = tokens.reduce((sum, token) => sum + token.length, 0);
  const ratio = Math.min(matchedChars / field.length, 1);
  return Math.round(ratio * MAX_COVERAGE_BONUS);
}

/**
 * Context fields a token may match when it is not in the title — the show,
 * season, or subtitle. Lets "scripture stories job" find the episode "Job"
 * of "Scripture Stories", which no title-only match can do.
 * @param {Object} item
 * @returns {string} Normalized context text
 */
function contextText(item) {
  const parts = [
    item.metadata?.grandparentTitle,
    item.metadata?.parentTitle,
    item.subtitle,
    item.metadata?.librarySectionTitle
  ].filter(Boolean);
  return normalizeText(parts.join(' '));
}

export class RelevanceScoringService {
  /**
   * Calculate relevance score for an item.
   *
   * @param {Object} item - Item to score
   * @param {string} [item.title] - Item title
   * @param {string} [item.subtitle] - Secondary line (episode blurb, speaker)
   * @param {Object} [item.metadata] - Item metadata
   * @param {string} [item.metadata.category] - Content category (from ContentCategory enum)
   * @param {string} [item.metadata.grandparentTitle] - Show title, when the item is an episode
   * @param {string} [item.metadata.parentTitle] - Season/album title
   * @param {number} [item.childCount] - Number of children (for containers)
   * @param {boolean} [item._idMatch] - Whether this was a direct ID match
   * @param {string} [searchText] - Search text
   * @returns {number} Relevance score (higher = more relevant). 0 means the
   *   item does not match the search text at all and should be filtered out
   *   by the caller rather than shown as a result.
   */
  static score(item, searchText = '') {
    // ID match always wins
    if (item._idMatch) return ID_MATCH_SCORE;

    const childCount = item.childCount || item.metadata?.childCount || 0;
    const childBonus = childCount > 0
      ? Math.min(childCount / 100, MAX_CHILD_COUNT_BONUS)
      : 0;

    const query = normalizeText(searchText);

    // Browse ordering: no text to match against, so kind-of-thing is the
    // whole signal. This is the original category scale, unchanged.
    if (!query) {
      return getCategoryScore(item.metadata?.category) + childBonus;
    }

    const tokens = query.split(' ').filter(Boolean);
    const title = normalizeText(item.title);

    let base = matchTier(title, query, tokens);
    let matchedField = title;

    // Not satisfiable from the title alone — retry across the show/season
    // context before giving up.
    if (!base) {
      const context = contextText(item);
      if (context) {
        const combined = `${title} ${context}`.trim();
        const crossTier = matchTier(combined, query, tokens);
        if (crossTier) {
          base = Math.round(crossTier * CROSS_FIELD_FACTOR);
          matchedField = combined;
        }
      }
    }

    // No token matched anywhere. Returning 0 (rather than a category score)
    // is what lets the caller drop non-matches instead of padding the result
    // list with whatever the adapters happened to return.
    if (!base) return 0;

    return base
      + coverageBonus(matchedField, tokens)
      + getCategoryTiebreak(item.metadata?.category)
      + childBonus;
  }

  /**
   * Sort items by relevance score (descending).
   *
   * Does NOT drop zero-scored items — filtering is the caller's policy
   * decision (see ContentQueryService, which applies a relevance floor when
   * the query carries text).
   *
   * @param {Object[]} items - Items to sort
   * @param {string} [searchText] - Search text for title matching
   * @returns {Object[]} New array sorted by relevance
   */
  static sortByRelevance(items, searchText = '') {
    return [...items]
      .map((item, index) => ({ item, index, score: RelevanceScoringService.score(item, searchText) }))
      // Stable within ties: preserve arrival order so equally-relevant results
      // do not reshuffle between identical queries.
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))
      .map(entry => entry.item);
  }

  /**
   * Whether an item matches the search text at all.
   * @param {Object} item
   * @param {string} [searchText]
   * @returns {boolean}
   */
  static matches(item, searchText = '') {
    if (!normalizeText(searchText)) return true;
    return RelevanceScoringService.score(item, searchText) > 0;
  }
}

export default RelevanceScoringService;
