// frontend/src/modules/Health/CoachChat/mentions/vocabulary.config.js
/**
 * Mention vocabulary — declarative list of @-mention categories.
 * Adding/removing/relabeling a category is a data edit, not a code change.
 *
 * Each entry feeds:
 *   - the assistant-ui mention extension (trigger + search)
 *   - the suggestion API fanout (suggestEndpoint)
 *   - the chip rendering registry (chipKey → chips/index.js)
 *   - the attachment payload shape sent to the agent
 */
export const MENTION_CATEGORIES = [
  {
    key: 'period',
    label: 'Period',
    triggerPrefix: '@period:',
    icon: 'calendar',
    color: 'blue',
    suggestEndpoint: '/api/v1/health/mentions/periods',
    chipKey: 'period',
  },
  {
    key: 'day',
    label: 'Day',
    triggerPrefix: '@day:',
    icon: 'calendar-event',
    color: 'gray',
    suggestEndpoint: '/api/v1/health/mentions/recent-days',
    chipKey: 'day',
  },
  {
    key: 'workout',
    label: 'Workout',
    triggerPrefix: '@workout:',
    icon: 'run',
    color: 'orange',
    suggestEndpoint: '/api/v1/health/mentions/recent-days?has=workout',
    chipKey: 'workout',
  },
  {
    key: 'nutrition',
    label: 'Nutrition',
    triggerPrefix: '@nutrition:',
    icon: 'apple',
    color: 'green',
    suggestEndpoint: '/api/v1/health/mentions/recent-days?has=nutrition',
    chipKey: 'nutrition',
  },
  {
    key: 'weight',
    label: 'Weight',
    triggerPrefix: '@weight:',
    icon: 'scale',
    color: 'cyan',
    suggestEndpoint: '/api/v1/health/mentions/recent-days?has=weight',
    chipKey: 'weight',
  },
  {
    key: 'metric_snapshot',
    label: 'Metric snapshot',
    triggerPrefix: '@metric:',
    icon: 'chart-line',
    color: 'violet',
    suggestEndpoint: '/api/v1/health/mentions/metrics',
    chipKey: 'metric_snapshot',
  },
];

/**
 * Bare `@` (no category prefix) calls this endpoint for a merged top list.
 */
export const FALLBACK_SUGGEST_ENDPOINT = '/api/v1/health/mentions/all';

/**
 * Build the attachment payload for an attachment given the user's selection.
 * The category key comes from the chosen suggestion's `group`; the rest is
 * the suggestion's payload as returned by the backend.
 */
export function buildAttachment(suggestion) {
  const { group, slug, label, value, has } = suggestion;
  if (group === 'period') {
    return { type: 'period', value, label };
  }
  if (group === 'day') {
    return { type: 'day', date: value?.date ?? slug, label };
  }
  if (group === 'metric') {
    // Pure metric needs to be paired with a period to become a snapshot.
    // For the v1 vocabulary, we treat selecting just a metric as a metric_snapshot
    // anchored to last_30d by default; the user can edit the period inline later.
    return {
      type: 'metric_snapshot',
      metric: value?.metric ?? slug,
      period: { rolling: 'last_30d' },
      label: `${label} (last 30d)`,
    };
  }
  // The day-suggestion endpoint is reused for workout/nutrition/weight — disambiguate
  // by category prefix the user typed. The mention extension passes the active
  // category through suggestion.activeCategory if a triggerPrefix matched.
  if (group === 'day' && suggestion.activeCategory && suggestion.activeCategory !== 'day') {
    return { type: suggestion.activeCategory, date: value?.date ?? slug, label };
  }
  // Fallback
  return { type: group, ...value, label };
}
