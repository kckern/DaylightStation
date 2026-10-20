/**
 * Phone copy for harvester health transitions
 * (__docs/reference/notifications/push-standard.md: names, local times, a tag).
 * Pure: the caller supplies the times, the household timezone and `now`.
 */
import { formatClockTime, formatDuration, formatStudyDay, pushData, titleCaseId } from './pushText.mjs';

const NAMES = {
  withings: 'Withings', strava: 'Strava', fitsync: 'FitnessSyncer', gcal: 'Google Calendar', gmail: 'Gmail',
  lastfm: 'Last.fm', todoist: 'Todoist', clickup: 'ClickUp', github: 'GitHub', reddit: 'Reddit',
  letterboxd: 'Letterboxd', goodreads: 'Goodreads', foursquare: 'Foursquare', buxfer: 'Buxfer',
  weather: 'Weather', shopping: 'Shopping', jamcorder: 'Jamcorder',
};
export const harvesterDisplayName = (serviceId) => NAMES[serviceId] || titleCaseId(serviceId) || 'A data source';

// Services with a reconnect button in Admin, Integrations.
const RECONNECTABLE = new Set(['withings']);

const DAY_MS = 24 * 60 * 60 * 1000;

// Raw provider errors are for logs; the phone gets a plain reason.
export function plainHarvestError(error) {
  const raw = String(error ?? '').trim();
  if (!raw) return 'an unexpected error';
  if (/auth|refresh|token|401|403|sign-in|unauthori[sz]ed/i.test(raw)) return 'sign-in expired';
  if (/429|rate limit/i.test(raw)) return 'rate limit reached';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|timeout/i.test(raw)) return 'service could not be reached';
  return 'an unexpected error';
}

/** '2026-10-01T19:00:00Z' → '2026-10-01' as the household's calendar reads it. */
function localDay(iso, timezone) {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone || undefined }).format(ms);
  } catch {
    return null;
  }
}

// Under a day: 'for 3 hr (last worked 9:00 AM)'. Longer: 'since Thu Oct 1'.
function sinceClause(lastSuccessAt, now, timezone) {
  if (!lastSuccessAt) return '';
  const elapsed = Date.parse(now) - Date.parse(lastSuccessAt);
  if (elapsed >= DAY_MS) {
    const day = formatStudyDay(localDay(lastSuccessAt, timezone));
    return day ? ` since ${day}` : '';
  }
  const span = formatDuration(elapsed);
  const clock = formatClockTime(lastSuccessAt, timezone);
  return span && clock ? ` for ${span} (last worked ${clock})` : '';
}

/**
 * @param {Object} t
 * @param {string} t.serviceId
 * @param {'failing'|'stale'|'recovered'} t.status
 * @param {string} [t.error] - raw error; rendered through plainHarvestError
 * @param {string} [t.lastSuccessAt] - ISO
 * @param {string} [t.latestDate] - 'YYYY-MM-DD' of the newest entry
 * @param {string} t.now - ISO
 * @param {string} [t.timezone]
 * @returns {{title: string, message: string, data: Object}}
 */
export function composeHarvesterHealthPush({ serviceId, status, error = null, lastSuccessAt = null, latestDate = null, now, timezone = null }) {
  const name = harvesterDisplayName(serviceId);
  const data = pushData({
    tag: `harvester-health-${serviceId}`,
    channel: 'Household alerts',
    importance: status === 'recovered' ? 'low' : 'high',
    alertOnce: status === 'recovered',
  });

  if (status === 'recovered') return { title: `✅ ${name} syncing again`, message: `New ${name} data is coming in.`, data };

  if (status === 'stale') {
    const day = latestDate ? formatStudyDay(latestDate) : null;
    return { title: `⚠️ No new ${name} data`, message: day ? `The newest entry is from ${day}.` : `${name} has sent nothing new.`, data };
  }

  const reason = plainHarvestError(error);
  const fix = reason === 'sign-in expired' && RECONNECTABLE.has(serviceId)
    ? ` Reconnect it in Admin, Integrations, ${name}.`
    : '';
  return { title: `⚠️ ${name} stopped syncing`, message: `No sync${sinceClause(lastSuccessAt, now, timezone)}: ${reason}.${fix}`, data };
}
