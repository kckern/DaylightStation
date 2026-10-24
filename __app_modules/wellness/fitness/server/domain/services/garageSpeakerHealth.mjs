/**
 * Garage speaker health vocabulary.
 *
 * Home Assistant's `automation.garage_speaker_plug_enforcement` is the only
 * thing that can see the garage speaker die: the speaker shuts itself off
 * (0 W behind a plug that still reports on) and the plug's power sensor is
 * the only witness. The automation reports each step of its recovery here so
 * the episode reaches the log store instead of living only in HA's recorder.
 * See __docs/reference/fitness/garage-speaker-recovery.md.
 *
 * Pure: validates and normalizes one report. No I/O.
 */

/** Event name -> log level. The set is closed: anything else is rejected. */
export const GARAGE_SPEAKER_EVENTS = Object.freeze({
  dropout: 'warn',
  power_cycle: 'warn',
  recovered: 'info',
  gave_up: 'error',
});

const GAVE_UP_REASONS = new Set(['no_power_after_cycle', 'cap_reached']);

const finiteOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * @param {Object} raw - request body from Home Assistant
 * @returns {{ ok: true, event: string, level: string, data: Object } | { ok: false, reason: string }}
 */
export function normalizeGarageSpeakerReport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'invalid_body' };
  const { event } = raw;
  if (typeof event !== 'string' || !Object.hasOwn(GARAGE_SPEAKER_EVENTS, event)) {
    return { ok: false, reason: 'unknown_event' };
  }
  let reason = null;
  if (event === 'gave_up') {
    if (!GAVE_UP_REASONS.has(raw.reason)) return { ok: false, reason: 'invalid_gave_up_reason' };
    reason = raw.reason;
  }
  const cycle = finiteOrNull(raw.cycle);
  const cyclesLastHour = finiteOrNull(raw.cyclesLastHour);
  return {
    ok: true,
    event,
    level: GARAGE_SPEAKER_EVENTS[event],
    data: {
      powerW: finiteOrNull(raw.powerW),
      currentA: finiteOrNull(raw.currentA),
      // Seconds since the speaker's power sensor last changed, i.e. how long it
      // has been dark (dropout / power_cycle / gave_up) or how long recovery took.
      durationS: finiteOrNull(raw.durationS),
      cycle: cycle === null ? null : Math.trunc(cycle),
      cyclesLastHour: cyclesLastHour === null ? null : Math.trunc(cyclesLastHour),
      reason,
      haContextId: typeof raw.haContextId === 'string' && raw.haContextId ? raw.haContextId.slice(0, 64) : null,
    },
  };
}
