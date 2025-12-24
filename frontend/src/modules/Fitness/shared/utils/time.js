/**
 * Time Formatting Utilities
 * 
 * Centralized time formatting functions for consistent display
 * across the Fitness module (shell and apps).
 */

/**
 * Format seconds into a time string
 * @param {number} seconds - Total seconds to format
 * @param {Object} options - Formatting options
 * @param {string} options.format - 'mm:ss' | 'hh:mm:ss' | 'auto' (default: 'auto')
 * @param {boolean} options.padHours - Pad hours with leading zero (default: true)
 * @param {boolean} options.showZeroHours - Show hours even if 0 when format is 'hh:mm:ss' (default: false)
 * @returns {string} Formatted time string
 */
export const formatTime = (seconds, options = {}) => {
  const {
    format = 'auto',
    padHours = true,
    showZeroHours = false
  } = options;

  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return format === 'hh:mm:ss' || showZeroHours ? '00:00:00' : '00:00';
  }

  const totalSeconds = Math.floor(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const paddedMins = String(mins).padStart(2, '0');
  const paddedSecs = String(secs).padStart(2, '0');
  const paddedHrs = padHours ? String(hrs).padStart(2, '0') : String(hrs);

  // Determine format
  if (format === 'mm:ss') {
    // Always MM:SS, even if > 60 minutes
    const totalMins = Math.floor(totalSeconds / 60);
    return `${String(totalMins).padStart(2, '0')}:${paddedSecs}`;
  }

  if (format === 'hh:mm:ss') {
    return `${paddedHrs}:${paddedMins}:${paddedSecs}`;
  }

  // Auto format: show hours only if needed
  if (hrs > 0 || showZeroHours) {
    return `${paddedHrs}:${paddedMins}:${paddedSecs}`;
  }

  return `${paddedMins}:${paddedSecs}`;
};

/**
 * Calculate elapsed seconds from a start time
 * @param {number|Date|string} startTime - Start timestamp (epoch ms, Date, or ISO string)
 * @param {number|Date|string} [endTime] - End timestamp (defaults to now)
 * @returns {number} Elapsed seconds (0 if invalid)
 */
export const getElapsedSeconds = (startTime, endTime = Date.now()) => {
  const start = normalizeTimestamp(startTime);
  const end = normalizeTimestamp(endTime);

  if (start == null || end == null) {
    return 0;
  }

  return Math.max(0, Math.floor((end - start) / 1000));
};

/**
 * Format elapsed time from a start timestamp
 * @param {number|Date|string} startTime - Start timestamp
 * @param {Object} options - Formatting options (same as formatTime)
 * @returns {string} Formatted elapsed time
 */
export const formatElapsed = (startTime, options = {}) => {
  const elapsed = getElapsedSeconds(startTime);
  return formatTime(elapsed, options);
};

/**
 * Parse a time string into total seconds
 * @param {string} timeString - Time string in MM:SS or HH:MM:SS format
 * @returns {number|null} Total seconds, or null if invalid
 */
export const parseTime = (timeString) => {
  if (typeof timeString !== 'string') {
    return null;
  }

  const parts = timeString.trim().split(':').map(Number);

  if (parts.some((p) => !Number.isFinite(p) || p < 0)) {
    return null;
  }

  if (parts.length === 2) {
    // MM:SS
    const [mins, secs] = parts;
    return mins * 60 + secs;
  }

  if (parts.length === 3) {
    // HH:MM:SS
    const [hrs, mins, secs] = parts;
    return hrs * 3600 + mins * 60 + secs;
  }

  return null;
};

/**
 * Format a duration in a human-readable way
 * @param {number} seconds - Duration in seconds
 * @param {Object} options - Formatting options
 * @param {boolean} options.compact - Use compact format (default: false)
 * @param {boolean} options.showSeconds - Show seconds for durations >= 1 minute (default: true)
 * @returns {string} Human-readable duration
 */
export const formatDuration = (seconds, options = {}) => {
  const { compact = false, showSeconds = true } = options;

  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return compact ? '0s' : '0 seconds';
  }

  const totalSeconds = Math.floor(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const parts = [];

  if (hrs > 0) {
    parts.push(compact ? `${hrs}h` : `${hrs} hour${hrs !== 1 ? 's' : ''}`);
  }

  if (mins > 0) {
    parts.push(compact ? `${mins}m` : `${mins} minute${mins !== 1 ? 's' : ''}`);
  }

  if ((secs > 0 && showSeconds) || parts.length === 0) {
    parts.push(compact ? `${secs}s` : `${secs} second${secs !== 1 ? 's' : ''}`);
  }

  return compact ? parts.join(' ') : parts.join(', ');
};

/**
 * Normalize various timestamp formats to epoch milliseconds
 * @param {number|Date|string} timestamp - Timestamp in various formats
 * @returns {number|null} Epoch milliseconds, or null if invalid
 */
export const normalizeTimestamp = (timestamp) => {
  if (timestamp == null) {
    return null;
  }

  // Already epoch ms
  if (typeof timestamp === 'number') {
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  // Date object
  if (timestamp instanceof Date) {
    const ms = timestamp.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  // ISO string or other parseable format
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

/**
 * Get countdown remaining from a target time
 * @param {number|Date|string} targetTime - Target timestamp
 * @param {number|Date|string} [currentTime] - Current timestamp (defaults to now)
 * @returns {number} Remaining seconds (0 if past target)
 */
export const getCountdownRemaining = (targetTime, currentTime = Date.now()) => {
  const target = normalizeTimestamp(targetTime);
  const current = normalizeTimestamp(currentTime);

  if (target == null || current == null) {
    return 0;
  }

  return Math.max(0, Math.floor((target - current) / 1000));
};

export default {
  formatTime,
  formatElapsed,
  parseTime,
  formatDuration,
  getElapsedSeconds,
  getCountdownRemaining,
  normalizeTimestamp
};
