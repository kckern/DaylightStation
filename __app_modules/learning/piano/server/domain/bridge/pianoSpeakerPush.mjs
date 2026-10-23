/**
 * Phone copy for the piano speaker self-healing ladder
 * (__docs/reference/notifications/push-standard.md: names not ids, one tag per
 * device so the "back" card replaces the alarm).
 *
 * Its own tag (`piano-speaker-*`), not the bridge supervisor's, so a speaker
 * card can never overwrite a "bridge is down" card or vice versa.
 *
 * @module learning/piano/server/domain/bridge/pianoSpeakerPush
 */
import { formatDuration, pushData } from '#domains/notification/push/pushText.mjs';

const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

export function composePianoSpeakerPush({ kind, deviceId, location = null, downMs = null } = {}) {
  const room = clean(location);
  const where = room ? ` (${room})` : '';
  const tag = `piano-speaker-${deviceId || 'tablet'}`;
  const alarm = pushData({ tag, channel: 'Household alerts', importance: 'high' });

  if (kind === 'needs-help') {
    return {
      title: `🎹 Piano speaker won't reconnect${where}`,
      message: 'Tried 5 fixes, including restarting the piano. Check the Bluetooth dongle on the piano, then switch the piano off and on.',
      data: alarm,
    };
  }
  if (kind === 'unpowered') {
    return {
      title: `🔌 Piano is unpowered${where}`,
      message: "The speaker fix switched the piano's plug off and could not turn it back on. Turn the piano plug on in Home Assistant.",
      data: alarm,
    };
  }
  if (kind === 'back') {
    const span = formatDuration(downMs);
    return {
      title: `🎹 Piano speaker is back${where}`,
      message: span ? `Working again after ${span}.` : 'Working again.',
      data: pushData({ tag, channel: 'Household alerts', alertOnce: true }),
    };
  }
  return null;
}

export default composePianoSpeakerPush;
