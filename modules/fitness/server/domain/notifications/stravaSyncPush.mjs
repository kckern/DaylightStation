/**
 * Phone copy for Strava sync health transitions
 * (docs/reference/notifications/push-standard.md: local times, a tag, no ids).
 * Pure: the caller supplies the times, the household timezone and `now`.
 */
import { formatClockTime, formatDuration, pushData } from '#domains/notification/push/pushText.mjs';

// Raw provider errors are for logs; the phone gets a plain reason.
export function plainSyncError(error) {
  const raw = String(error ?? '').trim();
  if (!raw) return null;
  if (/401|access token|refresh ?token|sign-in|unauthori[sz]ed/i.test(raw)) return 'Strava sign-in expired';
  if (/429|rate limit/i.test(raw)) return 'Strava rate limit reached';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|timeout/i.test(raw)) return 'Strava could not be reached';
  return 'an unexpected error (details in the logs)';
}

const WHAT = {
  harvest: 'Activities haven’t been pulled from Strava',
  sweep: 'Titles, notes and timelines haven’t synced with Strava',
};

function since({ lastSuccessAt, now, timezone }) {
  const span = formatDuration(Date.parse(now) - Date.parse(lastSuccessAt ?? ''));
  const clock = formatClockTime(lastSuccessAt, timezone);
  if (span && clock) return `for ${span} (last worked ${clock})`;
  return 'since the server started';
}

/**
 * @param {Object} t
 * @param {'harvest'|'sweep'|'webhook'|'integrity'} t.stage
 * @param {'stale'|'recovered'} t.status
 * @param {string} [t.lastSuccessAt] - ISO
 * @param {string} [t.error] - raw error; rendered through plainSyncError
 * @param {string[]} [t.activityNames] - webhook stage: activities with no webhook
 * @param {number} [t.count] - integrity stage: sessions still flagged
 * @param {string} t.now - ISO
 * @param {string} [t.timezone]
 * @returns {{title: string, message: string, data: Object}}
 */
export function composeStravaSyncPush({ stage, status, lastSuccessAt = null, error = null, activityNames = [], count = 0, now, timezone = null }) {
  const data = pushData({
    tag: `strava-sync-${stage}`,
    channel: 'Household alerts',
    importance: status === 'stale' ? 'high' : 'low',
    alertOnce: status === 'recovered',
  });

  if (status === 'recovered') {
    const what = { harvest: 'Pulling activities', sweep: 'Syncing titles and notes', webhook: 'Strava webhooks', integrity: 'Workout timelines' }[stage];
    return { title: '✅ Strava sync recovered', message: `${what} working again`, data };
  }

  if (stage === 'webhook') {
    const names = activityNames.filter(Boolean);
    const n = names.length || count || 1;
    const list = names.slice(0, 3).map(name => `“${name}”`).join(', ');
    return {
      title: '⚠️ Strava webhooks missing',
      message: `${n === 1 ? 'An activity' : `${n} activities`} arrived without a webhook, so ${n === 1 ? 'it wasn’t' : 'they weren’t'} matched to a workout${list ? `: ${list}` : ''}`,
      data,
    };
  }

  if (stage === 'integrity') {
    const n = count || 1;
    return {
      title: '⚠️ Workout data needs a look',
      message: `${n === 1 ? 'A Strava workout still has' : `${n} Strava workouts still have`} a timeline that doesn’t match the activity after a day of retries`,
      data,
    };
  }

  const reason = plainSyncError(error);
  return {
    title: '⚠️ Strava sync stalled',
    message: `${WHAT[stage]} ${since({ lastSuccessAt, now, timezone })}${reason ? `. Last error: ${reason}` : ''}`,
    data,
  };
}

export default composeStravaSyncPush;
