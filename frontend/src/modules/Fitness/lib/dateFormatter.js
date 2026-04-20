const DEFAULT_FORMAT_OPTS = { weekday: 'short', month: 'short', day: 'numeric' };

/**
 * Format a date/ISO string as "Mon, Apr 20" (short weekday, short month, numeric day).
 * Returns empty string for null/undefined/invalid input.
 */
export function formatFitnessDate(input, opts = DEFAULT_FORMAT_OPTS) {
  if (input == null || input === '') return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', opts).format(d);
}

export default formatFitnessDate;
