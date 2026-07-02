/**
 * onboardGmTier — VoiceRouter tier 1: the Roland's onboard GM engine over
 * BLE-MIDI (design §2 / Task 3.2).
 *
 * ── The injected `sendMidi` bag ─────────────────────────────────────────────
 * This tier does NOT import useWebMidiBLE — the Producer shell wires a small
 * function bag from the hook's return (all functions; all optional-safe here):
 *
 *   {
 *     isConnected():                    boolean — e.g. `() => midi.connected`.
 *                                       False (or a throw) makes supports()
 *                                       false so the router falls to tier 2.
 *     sendNote(note, velocity, channel) — note-on ONLY (useWebMidiBLE.sendNote
 *                                       with no durationMs; the tier holds
 *                                       notes indefinitely).
 *     sendNoteOff(note, channel)        — independent note-off ([0x80|ch]).
 *     sendProgramChange(program, channel)
 *     sendControlChange(cc, value, channel)
 *   }
 *
 * Argument-order note: the hook's senders are (note, velocity, channel) /
 * (program, channel) — piano-first; the tier contract is (channel, note, vel)
 * — router-first. The mapping happens HERE, nowhere else.
 *
 * The hook's PC/CC senders carry the BLE "one-turn-late" flush fix (trailing
 * re-send); routing through them — not raw bytes — keeps that behavior.
 *
 * ── Gain = velocity scaling, deliberately ───────────────────────────────────
 * setGain STORES a per-channel gain (default 1) and scales outgoing noteOn
 * velocities: `clamp(round(vel * gain), 1, 127)`. The Roland has no per-channel
 * volume we trust (CC7 support unverified on this piano), so we do not send
 * CC7; floor 1 keeps a note from turning into an accidental note-off, cap 127
 * keeps `& 0x7f` masking downstream from wrapping loud into quiet.
 *
 * `enabled` is the piano.yml capability flag (config.producer?.voiceTiers?
 * .onboardGm), static at creation — the shell recreates the tier on config
 * change.
 *
 * Contract: NEVER throws — every sender call is wrapped; failures log
 * (sampled on the note path, warn on the control path) and drop.
 */
import getLogger from '../../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'onboard-gm-tier' });
  return _logger;
}

const SAMPLE_OPTS = { maxPerMinute: 10, aggregate: true };
const ALL_NOTES_OFF_CC = 123;

/**
 * @param {object} opts
 * @param {object|null} opts.sendMidi - function bag (shape documented above).
 * @param {boolean} [opts.enabled=false] - piano.yml capability flag.
 * @returns VoiceRouter tier adapter (id 'onboard-gm').
 */
export function createOnboardGmTier({ sendMidi, enabled = false } = {}) {
  /** channel → gain multiplier (default 1; velocity scaling, see header). */
  const gains = new Map();

  function supports() {
    if (!enabled || !sendMidi) return false;
    try {
      return !!sendMidi.isConnected();
    } catch (err) {
      logger().sampled('onboard-gm-tier.error', { op: 'isConnected', error: err?.message }, SAMPLE_OPTS);
      return false;
    }
  }

  function noteOn(channel, note, velocity) {
    if (!sendMidi) return;
    const gain = gains.get(channel) ?? 1;
    const scaled = Math.min(127, Math.max(1, Math.round(velocity * gain)));
    try {
      sendMidi.sendNote(note, scaled, channel);
    } catch (err) {
      logger().sampled('onboard-gm-tier.error', { op: 'noteOn', channel, note, error: err?.message }, SAMPLE_OPTS);
    }
  }

  function noteOff(channel, note) {
    if (!sendMidi) return;
    try {
      sendMidi.sendNoteOff(note, channel);
    } catch (err) {
      logger().sampled('onboard-gm-tier.error', { op: 'noteOff', channel, note, error: err?.message }, SAMPLE_OPTS);
    }
  }

  function setProgram(channel, program) {
    if (!sendMidi) return;
    try {
      sendMidi.sendProgramChange(program, channel);
    } catch (err) {
      logger().warn('onboard-gm-tier.error', { op: 'setProgram', channel, program, error: err?.message });
    }
  }

  function setGain(channel, gain) {
    if (!(Number.isFinite(gain) && gain >= 0)) return; // bad gain: keep the last good one
    gains.set(channel, gain);
  }

  /** CC123 All Notes Off on one channel, or all 16 when called with no arg. */
  function allNotesOff(channel) {
    if (!sendMidi) return;
    const targets = channel == null ? Array.from({ length: 16 }, (_, ch) => ch) : [channel];
    for (const ch of targets) {
      try {
        sendMidi.sendControlChange(ALL_NOTES_OFF_CC, 0, ch);
      } catch (err) {
        logger().warn('onboard-gm-tier.error', { op: 'allNotesOff', channel: ch, error: err?.message });
      }
    }
  }

  return {
    id: 'onboard-gm',
    supports,
    noteOn,
    noteOff,
    setProgram,
    setGain,
    allNotesOff,
  };
}

export default createOnboardGmTier;
