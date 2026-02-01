// backend/src/2_domains/content/services/CanvasSelectionService.mjs

/**
 * Pure domain service for canvas art selection.
 * No I/O, no infrastructure knowledge - just selection logic.
 */
export class CanvasSelectionService {
  /**
   * Filter items by context criteria
   * @param {Array} items - Pool of DisplayableItems
   * @param {Object} context - Filter criteria { categories?, tags? }
   * @returns {Array} Filtered items
   */
  selectForContext(items, context) {
    let result = [...items];

    if (context.categories?.length > 0) {
      result = result.filter(item =>
        context.categories.includes(item.category)
      );
    }

    if (context.tags?.length > 0) {
      result = result.filter(item =>
        context.tags.some(tag => item.tags?.includes(tag))
      );
    }

    return result;
  }

  /**
   * Pick next item respecting history and mode
   * @param {Array} pool - Available items
   * @param {string[]} shownHistory - IDs of recently shown items
   * @param {Object} options - { mode: 'random' | 'sequential' }
   * @returns {Object|null} Selected item or null if pool empty
   */
  pickNext(pool, shownHistory, options) {
    if (pool.length === 0) return null;

    // Filter out recently shown
    let candidates = pool.filter(item => !shownHistory.includes(item.id));

    // Reset if all shown
    if (candidates.length === 0) {
      candidates = pool;
    }

    if (options.mode === 'sequential') {
      // Find first item not in history, or first item if all shown
      const lastShown = shownHistory[shownHistory.length - 1];
      const lastIndex = pool.findIndex(item => item.id === lastShown);
      const nextIndex = (lastIndex + 1) % pool.length;
      return pool[nextIndex];
    }

    // Random selection
    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex];
  }

  /**
   * Merge context layers (time < calendar < device)
   * @param {Object} timeContext - Time-of-day context
   * @param {Object} calendarContext - Calendar/holiday context
   * @param {Object} deviceContext - Device-specific overrides
   * @returns {Object} Merged context filters
   */
  buildContextFilters(timeContext, calendarContext, deviceContext) {
    // Merge tags (additive)
    const tags = [
      ...(timeContext.tags || []),
      ...(calendarContext.tags || []),
      ...(deviceContext.tags || []),
    ];

    // Categories from device (most specific)
    const categories = deviceContext.categories ||
                       calendarContext.categories ||
                       timeContext.categories ||
                       [];

    // Frame style: device > calendar > time
    const frameStyle = deviceContext.frameStyle ??
                       calendarContext.frameStyle ??
                       timeContext.frameStyle ??
                       'classic';

    return { tags, categories, frameStyle };
  }
}

export default CanvasSelectionService;
