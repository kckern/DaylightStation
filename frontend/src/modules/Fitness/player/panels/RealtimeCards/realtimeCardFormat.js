// realtimeCardFormat.js — pure formatting helpers for BaseRealtimeCard.jsx,
// split out so Fast Refresh can hot-reload the card component on its own.

/**
 * Format time ago string
 */
export const formatTimeAgo = (timestamp, labels = {}) => {
  if (!timestamp) return labels.TIME_NEVER || 'Never';
  const diffMs = Date.now() - timestamp;
  if (diffMs < 5000) return labels.TIME_JUST_NOW || 'Just now';
  if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}${labels.TIME_SECONDS_SUFFIX || 's ago'}`;
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}${labels.TIME_MINUTES_SUFFIX || 'm ago'}`;
  return `${Math.floor(diffMs / 3600000)}${labels.TIME_HOURS_SUFFIX || 'h ago'}`;
};
