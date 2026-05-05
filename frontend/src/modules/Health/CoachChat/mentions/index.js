// frontend/src/modules/Health/CoachChat/mentions/index.js
import { MENTION_CATEGORIES, FALLBACK_SUGGEST_ENDPOINT, buildAttachment } from './vocabulary.config.js';
import { suggestPeriods } from './suggestPeriods.js';
import { suggestRecentDays } from './suggestRecentDays.js';
import { suggestMetrics } from './suggestMetrics.js';

/**
 * Run the suggestion fetch for a given category + prefix + userId.
 * The active category determines which adapter is used. When no category
 * is selected (bare `@`), we hit the fallback /all endpoint.
 */
export async function fetchSuggestions({ category, prefix, userId, has = null }) {
  if (!category) {
    // /all fallback
    if (!userId) return [];
    const u = new URL(FALLBACK_SUGGEST_ENDPOINT, window.location.origin);
    u.searchParams.set('user', userId);
    if (prefix) u.searchParams.set('prefix', prefix);
    try {
      const res = await fetch(u.toString());
      if (!res.ok) return [];
      const data = await res.json();
      return data.suggestions || [];
    } catch { return []; }
  }

  if (category === 'period') return suggestPeriods({ prefix, userId });
  if (category === 'day' || category === 'workout' || category === 'nutrition' || category === 'weight') {
    const hasFilter = category === 'day' ? null : category;
    const out = await suggestRecentDays({ prefix, userId, has: hasFilter });
    // Tag with activeCategory so buildAttachment knows the user's intent
    return out.map(s => ({ ...s, activeCategory: category }));
  }
  if (category === 'metric_snapshot') return suggestMetrics({ prefix });
  return [];
}

export { MENTION_CATEGORIES, buildAttachment };
