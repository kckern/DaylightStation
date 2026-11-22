import { formatDateRange } from '../../../lib/format.js';

export function formatLogRangeTitle(period, { startDate, endDate } = {}) {
  const range = formatDateRange(startDate, endDate);
  return range ? `${period} · ${range}` : period;
}

export default formatLogRangeTitle;
