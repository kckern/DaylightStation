/**
 * Food Item Formatters
 * @module nutrition/entities/formatters
 *
 * Shared formatting utilities for consistent food item display.
 */

/**
 * Noom color to emoji mapping
 */
export const NOOM_COLOR_EMOJI = {
  green: '🟢',
  yellow: '🟡',
  orange: '🟠',
};

/**
 * Get emoji for a noom color
 * @param {string} color - green, yellow, or orange
 * @returns {string} Emoji or white circle fallback
 */
export function getNoomColorEmoji(color) {
  return NOOM_COLOR_EMOJI[color] || '⚪';
}

/**
 * Get time of day string from hour
 * @param {number} hour - Hour of day (0-23)
 * @returns {string} morning, midday, evening, or night
 */
export function getTimeOfDay(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'midday';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/**
 * Get hour in a specific timezone for a given Date
 * @param {Date} now - The date/time to get the hour for (required, from application layer)
 * @param {string} timezone - IANA timezone string (e.g., 'America/Los_Angeles')
 * @returns {number} Hour of day (0-23)
 */
export function getHourInTimezone(now, timezone) {
  if (!now || !(now instanceof Date)) {
    throw new Error('now date required for getHourInTimezone');
  }
  const timeStr = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false
  });
  return parseInt(timeStr, 10);
}

/**
 * @deprecated Use getHourInTimezone(now, timezone) instead - requires Date parameter
 * Get current hour in a specific timezone
 * @param {string} timezone - IANA timezone string (e.g., 'America/Los_Angeles')
 * @returns {number} Hour of day (0-23)
 */
export function getCurrentHourInTimezone(timezone) {
  // Legacy function - callers should migrate to getHourInTimezone
  return getHourInTimezone(new Date(), timezone);
}

/**
 * Format date header for display
 * Format: "🕒 Tue, 11 Nov 2025 evening"
 * @param {string} date - Date string YYYY-MM-DD
 * @param {Object} [options] - Options
 * @param {string} [options.timeOfDay] - Optional time of day override
 * @param {string} [options.timezone] - Timezone for current time (default: America/Los_Angeles)
 * @param {Date} [options.now] - Current date/time for time of day calculation (required if timeOfDay not provided)
 * @returns {string} Formatted date header
 */
export function formatDateHeader(date, options = {}) {
  const { timeOfDay, timezone = 'America/Los_Angeles', now } = options;
  const logDate = new Date(date + 'T12:00:00');

  // Format: "Tue, 11 Nov 2025"
  const dayName = logDate.toLocaleDateString('en-US', { weekday: 'short', timeZone: timezone });
  const day = logDate.getDate();
  const month = logDate.toLocaleDateString('en-US', { month: 'short', timeZone: timezone });
  const year = logDate.getFullYear();

  // If timeOfDay not provided, require now parameter
  let time = timeOfDay;
  if (!time) {
    if (!now || !(now instanceof Date)) {
      throw new Error('now date required for formatDateHeader when timeOfDay not provided');
    }
    time = getTimeOfDay(getHourInTimezone(now, timezone));
  }

  return `🕒 ${dayName}, ${day} ${month} ${year} ${time}`;
}

/**
 * Format a single food item for display
 * @param {Object} item - Food item with name, quantity, unit, calories, color
 * @returns {string} Formatted string like "🟢 Apple 150g"
 */
export function formatFoodItem(item) {
  const color = getNoomColorEmoji(item.color || item.noom_color);
  const name = item.label || item.name || 'Unknown';
  // Prefer grams when available, rounding to avoid false precision
  if (item.grams) {
    const gramsRounded = Math.max(1, Math.round(item.grams / 5) * 5);
    return `${color} ${name} ${gramsRounded}g`;
  }

  const amount = item.amount || item.quantity || '';
  const unit = item.unit || '';
  const amountStr = amount ? ` ${amount}${unit}` : '';
  return `${color} ${name}${amountStr}`;
}

/**
 * Format a list of food items for display
 * @param {Object[]} items - Array of food items
 * @returns {string} Newline-separated formatted items
 */
export function formatFoodList(items) {
  if (!items || items.length === 0) return '';
  return items.map(formatFoodItem).join('\n');
}

export default {
  NOOM_COLOR_EMOJI,
  getNoomColorEmoji,
  getTimeOfDay,
  getHourInTimezone,
  getCurrentHourInTimezone, // deprecated, use getHourInTimezone
  formatDateHeader,
  formatFoodItem,
  formatFoodList,
};
