// backend/src/4_api/v1/parsers/rangeParser.mjs

/**
 * Parse a duration string into seconds or a range of seconds.
 * Formats: 30, 3m, 1h, 1h30m, 3m..10m, ..5m, 30m..
 *
 * @param {string} value - Duration string
 * @returns {{ value?: number, from?: number|null, to?: number|null } | null}
 */
export function parseDuration(value) {
  if (!value || typeof value !== 'string') return null;

  // Check for range
  if (value.includes('..')) {
    const { from, to } = parseRange(value);
    return {
      from: from ? parseDurationValue(from) : null,
      to: to ? parseDurationValue(to) : null,
    };
  }

  const seconds = parseDurationValue(value);
  if (seconds === null) return null;
  return { value: seconds };
}

/**
 * Parse a single duration value to seconds.
 * @param {string} value
 * @returns {number|null}
 */
function parseDurationValue(value) {
  if (!value) return null;

  // Plain number = seconds
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10);
  }

  // Hours and/or minutes: 1h, 30m, 1h30m
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?$/);
  if (!match || (!match[1] && !match[2])) return null;

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  return hours * 3600 + minutes * 60;
}

/**
 * Season definitions (month ranges).
 */
const SEASONS = {
  spring: { fromMonth: 3, toMonth: 5 },
  summer: { fromMonth: 6, toMonth: 8 },
  fall: { fromMonth: 9, toMonth: 11 },
  autumn: { fromMonth: 9, toMonth: 11 },
  winter: { fromMonth: 12, toMonth: 2 }, // Crosses year boundary
};

/**
 * Parse a time string into a date or date range.
 * Formats: 2025, 2025-06, 2025-06-15, 2024..2025, summer
 *
 * @param {string} value - Time string
 * @returns {{ value?: string, from?: string, to?: string } | null}
 */
export function parseTime(value) {
  if (!value || typeof value !== 'string') return null;

  const lowerValue = value.toLowerCase();

  // Check for season
  if (SEASONS[lowerValue]) {
    const season = SEASONS[lowerValue];
    const year = new Date().getFullYear();
    const fromMonth = String(season.fromMonth).padStart(2, '0');
    const toMonth = String(season.toMonth).padStart(2, '0');
    const toDay = new Date(year, season.toMonth, 0).getDate(); // Last day of month
    return {
      from: `${year}-${fromMonth}-01`,
      to: `${year}-${toMonth}-${String(toDay).padStart(2, '0')}`,
    };
  }

  // Check for range
  if (value.includes('..')) {
    const { from, to } = parseRange(value);
    const fromDate = from ? parseTimeValue(from, 'start') : null;
    const toDate = to ? parseTimeValue(to, 'end') : null;
    return { from: fromDate, to: toDate };
  }

  // Single value
  const result = parseTimeValue(value, 'single');
  if (!result) return null;

  // If it's a year or year-month, return as range
  if (/^\d{4}$/.test(value)) {
    return {
      from: `${value}-01-01`,
      to: `${value}-12-31`,
    };
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return {
      from: `${value}-01`,
      to: `${value}-${String(lastDay).padStart(2, '0')}`,
    };
  }

  return { value: result };
}

/**
 * Parse a single time value to ISO date string.
 * @param {string} value
 * @param {'start'|'end'|'single'} mode
 * @returns {string|null}
 */
function parseTimeValue(value, mode) {
  if (!value) return null;

  // Full date: 2025-06-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  // Year-month: 2025-06
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-').map(Number);
    if (mode === 'end') {
      const lastDay = new Date(year, month, 0).getDate();
      return `${value}-${String(lastDay).padStart(2, '0')}`;
    }
    return `${value}-01`;
  }

  // Year: 2025
  if (/^\d{4}$/.test(value)) {
    return mode === 'end' ? `${value}-12-31` : `${value}-01-01`;
  }

  return null;
}

/**
 * Parse a generic range string.
 * Formats: a..b, ..b, a.., value
 *
 * @param {string} value
 * @returns {{ value?: string, from?: string|null, to?: string|null }}
 */
export function parseRange(value) {
  if (!value || typeof value !== 'string') {
    return { value: '' };
  }

  if (!value.includes('..')) {
    return { value };
  }

  const [from, to] = value.split('..');
  return {
    from: from || null,
    to: to || null,
  };
}

export default { parseDuration, parseTime, parseRange };
