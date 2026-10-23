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

/** Why the plug rungs did not run, in words a parent can act on. */
const SKIP_WHY = {
  'no-plug': 'no plug is set up for it',
  'power-unknown': 'its power reading was unavailable',
  'plug-cap': 'it was already restarted twice this hour',
};

export function composePianoSpeakerPush({ kind, deviceId, location = null, downMs = null, reason = null, skipped = [] } = {}) {
  const room = clean(location);
  const where = room ? ` (${room})` : '';
  const tag = `piano-speaker-${deviceId || 'tablet'}`;
  const alarm = pushData({ tag, channel: 'Household alerts', importance: 'high' });

  if (kind === 'needs-help' && reason === 'piano-stayed-off') {
    return {
      title: `🎹 Piano didn't come back on${where}`,
      message: "The speaker fix switched the piano's plug off and on, but the piano is still off. Switch the piano on.",
      data: alarm,
    };
  }
  const plugSkip = (skipped ?? []).find((s) => SKIP_WHY[s?.reason]);
  if (kind === 'needs-help' && plugSkip) {
    return {
      title: `🎹 Piano speaker won't reconnect${where}`,
      message: `Tried the Bluetooth fixes; the piano was not restarted because ${SKIP_WHY[plugSkip.reason]}. Check the Bluetooth dongle on the piano, then switch the piano off and on.`,
      data: alarm,
    };
  }
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
