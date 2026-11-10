/**
 * Phone copy for a garage speaker recovery that gave up
 * (__docs/reference/notifications/push-standard.md: a tag, no ids, plain text).
 * Pure. Home Assistant relays the facts; the words are composed here.
 */
import { formatDuration, pushData } from '#domains/notification/push/pushText.mjs';

/**
 * @param {Object} t
 * @param {'no_power_after_cycle'|'cap_reached'} t.reason
 * @param {number|null} [t.cycle] - power cycles this episode
 * @param {number|null} [t.cyclesLastHour]
 * @param {number|null} [t.durationS] - how long the speaker has been dark
 * @returns {{title: string, message: string, data: Object}}
 */
export function composeGarageSpeakerGaveUpPush({ reason, cycle = null, cyclesLastHour = null, durationS = null }) {
  const data = pushData({ tag: 'garage-speaker-recovery', channel: 'Household alerts', importance: 'high' });
  const dark = Number.isFinite(durationS) && durationS > 0 ? formatDuration(durationS * 1000) : null;
  const silent = dark ? `The garage speaker has been silent for ${dark}` : 'The garage speaker is silent';
  if (reason === 'cap_reached') {
    const n = Number.isFinite(cyclesLastHour) && cyclesLastHour > 0 ? cyclesLastHour : 2;
    return {
      title: '🔇 Garage speaker out',
      message: `${silent}. It was already power-cycled ${n === 1 ? 'once' : `${n} times`} this hour, so it was left alone. Press the button on the speaker plug, or check the speaker’s power brick.`,
      data,
    };
  }
  const tries = Number.isFinite(cycle) && cycle > 1 ? `${cycle} power cycles` : 'a power cycle';
  return {
    title: '🔇 Garage speaker out',
    message: `${silent} and did not come back after ${tries}. Press the button on the speaker plug, or check the speaker’s power brick.`,
    data,
  };
}
