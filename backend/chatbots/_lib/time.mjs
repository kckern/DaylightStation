import { createLogger } from './logging/index.mjs';

const defaultLogger = createLogger({ source: 'time', app: 'shared' });

function getFormatter(timezone = 'America/Los_Angeles') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

export function formatLocalTimestamp(date = new Date(), timezone = 'America/Los_Angeles', logger = defaultLogger) {
  try {
    const parts = getFormatter(timezone).formatToParts(date);
    const asMap = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const year = asMap.year;
    const month = asMap.month;
    const day = asMap.day;
    const hour = asMap.hour;
    const minute = asMap.minute;
    const second = asMap.second;
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  } catch (err) {
    logger?.warn?.('time.formatLocalTimestamp.failed', { error: err.message, timezone });
    // Fallback to ISO without timezone formatting
    return new Date(date).toISOString().replace('T', ' ').split('.')[0];
  }
}

export function parseToDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
}
