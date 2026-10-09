/**
 * Phone copy for the piano-bridge supervisor
 * (docs/reference/notifications/push-standard.md: names not ids, local times,
 * one tag per device so a later state replaces the earlier card).
 *
 * Three states share one tag: `down` (the bridge process is gone and automatic
 * restarts failed), `one-way` (the bridge runs but the piano stopped echoing),
 * and `recovered`. A recovery replaces the alarm card without ringing again.
 * Pure: the caller supplies the times and the household timezone.
 *
 * @module 2_domains/devices/pianoBridgePush
 */
import { formatClockTime, formatDuration, pushData } from '#domains/notification/push/pushText.mjs';

const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * @param {Object} event
 * @param {'down'|'one-way'|'recovered'} event.kind
 * @param {string} event.deviceId - rides only in the tag, never in the text
 * @param {string} [event.location] - configured room name, e.g. 'Yellow Room'
 * @param {string} [event.since] - ISO time the problem started
 * @param {number} [event.downMs] - for `recovered`: how long it lasted
 * @param {string} [event.timezone]
 * @returns {{title:string, message:string, data:Object}|null}
 */
export function composePianoBridgePush({
  kind, deviceId, location = null, since = null, downMs = null, timezone = null,
} = {}) {
  const room = clean(location);
  const where = room ? ` (${room})` : '';
  const at = formatClockTime(since, timezone);
  const tag = `piano-bridge-${deviceId || 'tablet'}`;
  const alarm = pushData({ tag, channel: 'Household alerts', importance: 'high' });

  if (kind === 'down') {
    return {
      title: `🎹 Piano sound is down${where}`,
      message: [
        at ? `The piano bridge app stopped at ${at}.` : 'The piano bridge app stopped.',
        'Automatic restarts have not brought it back.',
        'Open Piano Bridge on the tablet, or power-cycle the tablet.',
      ].join(' '),
      data: alarm,
    };
  }
  if (kind === 'one-way') {
    return {
      title: `🎹 The piano is not receiving sound${where}`,
      message: [
        at ? `Keys still reach the screen, but the piano has not answered since ${at}.`
          : 'Keys still reach the screen, but the piano is not answering.',
        'The bridge is still trying to repair the link.',
      ].join(' '),
      data: alarm,
    };
  }
  if (kind === 'recovered') {
    const span = formatDuration(downMs);
    return {
      title: `🎹 Piano sound is back${where}`,
      message: span ? `Working again after ${span}.` : 'Working again.',
      data: pushData({ tag, channel: 'Household alerts', alertOnce: true }),
    };
  }
  return null;
}

export default composePianoBridgePush;
