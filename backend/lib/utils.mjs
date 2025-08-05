export const slugify = (text) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w\-]+/g, '') // Remove all non-word chars
    .replace(/\-\-+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, ''); // Trim - from end of text
};

/**
 * Media watching utility functions
 * Centralized logic for determining watch status
 */

// Thresholds for media progress
const WATCHED_THRESHOLD = 90;           // 90% or higher is considered "watched"
const WATCHED_SECONDS_REMAINING = 20;  // 20 seconds remaining is considered "watched"
const MIN_PROGRESS_THRESHOLD = 15;     // Below 15% is considered no meaningful progress
const ALTERNATIVE_WATCHED_THRESHOLD = 50; // Alternative threshold used in some contexts

/**
 * Check if media item is considered "watched" based on percent completion or seconds remaining
 * @param {number|object} percentOrItem - Either a percent number or an object with percent/seconds properties
 * @param {number} [threshold=WATCHED_THRESHOLD] - Custom threshold (default 90)
 * @returns {boolean} - True if considered watched
 */
export const isWatched = (percentOrItem, threshold = WATCHED_THRESHOLD) => {
  const item = typeof percentOrItem === 'number' ? { percent: percentOrItem } : percentOrItem;
  const { percent, seconds } = item || {};
  
  if (percent == null) return false;
  
  // Check percent threshold first
  if (percent >= threshold) return true;
  
  // Check seconds remaining by deriving duration from percent and seconds
  if (seconds != null && percent > 0) {
    const derivedDuration = calculateDuration(percent, seconds);
    if (derivedDuration > 0) {
      const secondsRemaining = derivedDuration - seconds;
      if (secondsRemaining <= WATCHED_SECONDS_REMAINING) {
        return true;
      }
    }
  }
  
  return false;
};

/**
 * Check if media item has meaningful progress (above minimum threshold)
 * @param {number|object} percentOrItem - Either a percent number or an object with percent property
 * @returns {boolean} - True if has meaningful progress
 */
export const hasProgress = (percentOrItem) => {
  const percent = typeof percentOrItem === 'number' ? percentOrItem : percentOrItem?.percent;
  return percent != null && percent > MIN_PROGRESS_THRESHOLD;
};

/**
 * Get the effective percent for filtering (0 if below minimum progress)
 * @param {number} percent - The raw percent value
 * @returns {number} - Effective percent (0 if below minimum)
 */
export const getEffectivePercent = (percent) => {
  return percent > MIN_PROGRESS_THRESHOLD ? percent : 0;
};

/**
 * Calculate duration from percent and seconds if duration is not available
 * @param {number} percent - The completion percentage
 * @param {number} seconds - The seconds watched
 * @returns {number} - Calculated duration or 0 if cannot calculate
 */
export const calculateDuration = (percent, seconds) => {
  if (!percent || percent <= 0 || !seconds) return 0;
  return Math.round(seconds / (percent / 100));
};

/**
 * Categorize media items by watch status
 * @param {Array} items - Array of items with media_key or percent
 * @param {Object} log - Log object with media_key -> {percent, seconds} mapping
 * @returns {Object} - {watched: [], inProgress: [], unwatched: []}
 */
export const categorizeByWatchStatus = (items, log = {}) => {
  const watched = [];
  const inProgress = [];
  const unwatched = [];

  items.forEach(item => {
    const key = typeof item === 'string' ? item : item.media_key;
    const logEntry = log[key];
    const percent = logEntry?.percent || item?.percent || 0;
    const seconds = logEntry?.seconds || item?.seconds;

    // Create a complete item object for isWatched check
    const watchCheckItem = { percent, seconds };

    if (isWatched(watchCheckItem)) {
      watched.push(item);
    } else if (percent > 0) {
      inProgress.push(item);
    } else {
      unwatched.push(item);
    }
  });

  return { watched, inProgress, unwatched };
};
