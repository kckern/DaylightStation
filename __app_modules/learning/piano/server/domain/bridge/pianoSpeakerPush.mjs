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
/** Self-repair readiness problems, in words a parent can act on. */
const PROBLEM_WORDS = {
  'plug-unavailable': "the piano's smart plug is not answering",
  'no-plug-configured': 'no smart plug is set up for the piano',
  'bridge-endpoints-missing': 'the tablet app is missing its repair commands',
  'no-notify-target': 'no phone is set up to receive alerts',
};

/** Which kind of fix each ladder rung is, for the weekly summary. */
const RUNG_FIX = { 1: 'by reconnecting', 2: 'by a Bluetooth reset', 3: 'by a Bluetooth reset', 4: 'by restarting the piano', 5: 'by restarting the piano' };

function fixParts(byRung = {}) {
  const totals = new Map();
  for (const [rung, n] of Object.entries(byRung)) {
    const label = RUNG_FIX[rung];
    if (label && n > 0) totals.set(label, (totals.get(label) ?? 0) + n);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => `${n} ${label}`);
}

const SKIP_WHY = {
  'no-plug': 'no plug is set up for it',
  'power-unknown': 'its power reading was unavailable',
  'plug-cap': 'it was already restarted twice this hour',
};

export function composePianoSpeakerPush({
  kind, deviceId, location = null, downMs = null, reason = null, skipped = [],
  problems = [], drops = 0, byRung = {}, gaveUp = 0,
} = {}) {
  const room = clean(location);
  const where = room ? ` (${room})` : '';
  const tag = `piano-speaker-${deviceId || 'tablet'}`;
  const healthTag = `piano-speaker-health-${deviceId || 'tablet'}`;
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
      message: `Tried the Bluetooth fixes; the piano was not restarted because ${SKIP_WHY[plugSkip.reason]}. Switch the piano off and on.`,
      data: alarm,
    };
  }
  if (kind === 'needs-help') {
    return {
      title: `🎹 Piano speaker won't reconnect${where}`,
      message: "Tried 5 fixes, including restarting the piano. Switch the piano off and on; if the speaker still won't connect, re-pair it from the kiosk's Bluetooth panel within a few seconds of switching the piano on.",
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
  if (kind === 'not-ready') {
    const words = (problems ?? []).map((p) => PROBLEM_WORDS[p] ?? p);
    return {
      title: `Piano speaker self-repair is broken${where}`,
      message: `If the speaker drops it will not fix itself: ${words.join('; ')}.`,
      data: pushData({ tag: healthTag, channel: 'Household alerts' }),
    };
  }
  if (kind === 'ready-again') {
    return {
      title: `Piano speaker self-repair is working again${where}`,
      message: 'Every link it needs is answering.',
      data: pushData({ tag: healthTag, channel: 'Household alerts', alertOnce: true }),
    };
  }
  if (kind === 'weekly') {
    const parts = fixParts(byRung);
    const fixed = Object.entries(byRung ?? {}).reduce((n, [rung, c]) => n + (RUNG_FIX[rung] ? c : 0), 0);
    const total = Math.max(drops, fixed + gaveUp);
    const head = total === 1 ? 'Dropped once' : `Dropped ${total} times`;
    let message;
    if (!gaveUp && fixed > 0 && fixed === total) {
      message = `${head} and fixed itself${total === 1 ? '' : ' every time'}: ${parts.join(', ')}.`;
    } else {
      // Some drops ended with the piano switched off (or are still open): say only what is known.
      const bits = parts.map((p) => p.replace(/^(\d+) by /, '$1 fixed by '));
      const person = gaveUp === 1 && total === 1 ? 'it' : String(gaveUp);
      if (gaveUp && !bits.length) message = `${head}, and ${person} needed a person.`;
      else if (gaveUp) message = `${head}: ${bits.join(', ')}, and ${gaveUp} needed a person.`;
      else if (bits.length) message = `${head}: ${bits.join(', ')}.`;
      else message = `${head}.`;
    }
    return {
      title: `🎹 Piano speaker this week${where}`,
      message,
      data: pushData({ tag: `piano-speaker-weekly-${deviceId || 'tablet'}`, channel: 'Household alerts', alertOnce: true }),
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
