/**
 * Food Item Formatters
 * @module nutribot/domain/formatters
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
 * Format date header for display
 * Format: "🕒 Tue, 11 Nov 2025 evening"
 * @param {string} date - Date string YYYY-MM-DD
 * @param {string} [timeOfDay] - Optional time of day override
 * @returns {string} Formatted date header
 */
export function formatDateHeader(date, timeOfDay) {
  const logDate = new Date(date + 'T12:00:00');
  
  // Format: "Tue, 11 Nov 2025"
  const dayName = logDate.toLocaleDateString('en-US', { weekday: 'short' });
  const day = logDate.getDate();
  const month = logDate.toLocaleDateString('en-US', { month: 'short' });
  const year = logDate.getFullYear();
  
  const time = timeOfDay || getTimeOfDay(new Date().getHours());
  
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
  const amount = item.grams || item.amount || item.quantity || '';
  const unit = item.unit || (item.grams ? 'g' : '');
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
  formatDateHeader,
  formatFoodItem,
  formatFoodList,
};
