/**
 * The owner push for a lesson sitting whose presence check-in reached the top
 * of the ladder (two hands-together scales): the child kept coming back only
 * to dismiss the check-in. Off unless `videos.practice.presence_ladder.
 * notify_top_rung` is true. Follows __docs/reference/notifications/push-standard.md:
 * names not ids, a local spoken time, a tag on every push.
 *
 * Pure: the caller passes the time and the household zone.
 */
import { formatClockTime, pushData } from '#domains/notification/push/pushText.mjs';

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * `startedAt` is when the sitting began (its first progress post); `day` the
 * household date the push is tagged with.
 * @param {{ child?: string|null, lesson?: string|null, minimalCheckIns: number, startedAt?: string|null,
 *   timezone?: string|null, userId: string, day: string }} input
 * @returns {{ title: string, message: string, data: object }}
 */
export function composePresenceLadderPush({ child = null, lesson = null, minimalCheckIns = 0, startedAt = null, timezone = null, userId, day }) {
  const who = text(child);
  const what = text(lesson) ?? 'Piano lesson';
  const n = Math.max(0, Math.trunc(Number(minimalCheckIns)) || 0);
  const time = startedAt ? formatClockTime(startedAt, timezone) : null;
  const title = who ? `🎹 ${who} — ${what}` : `🎹 ${what}`;
  const message = `Came back only to dismiss ${n} check-in${n === 1 ? '' : 's'} this lesson — it now asks for two hands-together scales.${time ? ` The lesson started at ${time}.` : ''}`;
  const tag = `piano-presence-${String(userId ?? '').replace(/\s+/g, '_')}-${day}`;
  return { title, message, data: pushData({ tag, channel: 'School needs you', importance: 'high' }) };
}

export default composePresenceLadderPush;
