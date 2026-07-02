/**
 * voiceRouter — tiered GM voice dispatch for the Producer (design doc §2).
 *
 * Takes `(channel, note, velocity)` events (Task 4.2's transport feeds these
 * from loop playback) and delivers each to the best available "tier" — an
 * adapter over a voice backend (onboard Roland via BLE, browser gmSynth, and
 * eventually the APK sfizz tier). Tiers are supplied in PRIORITY ORDER
 * (highest first); routing is per-channel via each tier's `supports(channel)`.
 *
 * Tier adapter contract (Task 3.2 builds the real ones):
 *   { id, supports(channel) → bool, noteOn(ch, note, vel), noteOff(ch, note),
 *     setProgram(ch, program), setGain(ch, gain), allNotesOff(ch?) }
 *
 * Channel convention: 0-indexed (0..15), matching gmSynth (drums = channel 9).
 *
 * Contracts this router owns:
 * - Velocity 0 is normalized to noteOff HERE — tiers (per gmSynth's documented
 *   contract) only ever see velocity 1..127 on noteOn.
 * - STICKY NOTE-OFF: the tier that accepted a noteOn is remembered per
 *   channel+note, and the matching noteOff goes to that SAME tier even if its
 *   supports() has since flipped false (a tier flapping mid-note must not
 *   orphan the note-off / leave a stuck voice). Unknown note-offs go
 *   best-effort to the first supporting tier (duplicate offs are harmless).
 * - configureLayer fans program/gain to EVERY supporting tier, so a tier that
 *   later takes over a channel already holds the right program (idempotent,
 *   cheap calls).
 * - Performance path NEVER throws: tier calls are wrapped, errors are logged
 *   (sampled) and a failing noteOn fails over to the next supporting tier.
 * - `onNotes` tap ({ type: 'on'|'off', channel, note }) fires after successful
 *   dispatch — the keyboard-visualization feed. The router does NOT filter
 *   channels; the tap consumer decides what to visualize (see §5 / Task 3.2).
 *
 * Deliberately dumb and fast: synchronous, no async, no per-note allocation
 * beyond the note-memory map entries (deleted on off / allNotesOff / panic).
 */
import getLogger from '../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'voice-router' });
  return _logger;
}

const SAMPLE_OPTS = { maxPerMinute: 10, aggregate: true };

/**
 * Create a voice router.
 *
 * @param {object} opts
 * @param {Array<object>} opts.tiers - ordered tier adapters, highest priority first.
 * @param {(evt: { type: 'on'|'off', channel: number, note: number }) => void} [opts.onNotes]
 *   - optional tap fired after successful dispatch (visualization feed).
 * @returns {{ noteOn, noteOff, configureLayer, allNotesOff, panic, dispose }}
 */
export function createVoiceRouter({ tiers = [], onNotes } = {}) {
  let disposed = false;
  let tierList = [...tiers];
  let notesTap = onNotes || null;
  /** `${channel}:${note}` → tier that accepted the note-on (sticky note-off) */
  const noteMemory = new Map();

  const keyOf = (channel, note) => `${channel}:${note}`;

  function tierError(tier, op, channel, note, err) {
    logger().sampled(
      'voice-router.tier-error',
      { tier: tier?.id, op, channel, note, error: err?.message },
      SAMPLE_OPTS,
    );
  }

  function supports(tier, channel) {
    try {
      return !!tier.supports(channel);
    } catch (err) {
      tierError(tier, 'supports', channel, undefined, err);
      return false;
    }
  }

  function firstSupporting(channel) {
    for (const tier of tierList) {
      if (supports(tier, channel)) return tier;
    }
    return null;
  }

  function emitTap(type, channel, note) {
    if (!notesTap) return;
    try {
      notesTap({ type, channel, note });
    } catch (err) {
      logger().sampled('voice-router.tap-error', { type, channel, note, error: err?.message }, SAMPLE_OPTS);
    }
  }

  /**
   * Play a note. Velocity 0 → noteOff (normalized here, per gmSynth contract).
   * Dispatches to the first supporting tier; on tier error, fails over to the
   * next supporting tier, remembering whichever tier actually accepted it.
   */
  function noteOn(channel, note, velocity) {
    if (disposed) return;
    if (velocity === 0) {
      noteOff(channel, note);
      return;
    }
    let accepted = null;
    for (const tier of tierList) {
      if (!supports(tier, channel)) continue;
      try {
        tier.noteOn(channel, note, velocity);
        accepted = tier;
        break;
      } catch (err) {
        tierError(tier, 'noteOn', channel, note, err); // failover: try next supporting tier
      }
    }
    if (!accepted) {
      logger().sampled('voice-router.note-dropped', { op: 'noteOn', channel, note }, SAMPLE_OPTS);
      return;
    }
    noteMemory.set(keyOf(channel, note), accepted);
    emitTap('on', channel, note);
  }

  /**
   * Release a note. Routes to the remembered tier (sticky, even if its
   * supports() has flipped); unknown notes go best-effort to the first
   * supporting tier. Memory is cleared either way.
   */
  function noteOff(channel, note) {
    if (disposed) return;
    const key = keyOf(channel, note);
    const remembered = noteMemory.get(key);
    noteMemory.delete(key);
    const tier = remembered || firstSupporting(channel);
    if (!tier) {
      logger().sampled('voice-router.note-dropped', { op: 'noteOff', channel, note }, SAMPLE_OPTS);
      return;
    }
    let delivered = false;
    try {
      tier.noteOff(channel, note);
      delivered = true;
    } catch (err) {
      tierError(tier, 'noteOff', channel, note, err);
    }
    // Tap fires when delivered, or when we had a remembered 'on' (its memory is
    // gone now — the visualization must not leak a stuck key on tier error).
    if (delivered || remembered) emitTap('off', channel, note);
  }

  /**
   * Forward program/gain to EVERY tier supporting the channel (a tier that
   * later takes the channel over must already hold the right program).
   * Undefined fields are skipped.
   */
  function configureLayer(channel, { program, gain } = {}) {
    if (disposed) return;
    for (const tier of tierList) {
      if (!supports(tier, channel)) continue;
      if (program !== undefined) {
        try {
          tier.setProgram(channel, program);
        } catch (err) {
          tierError(tier, 'setProgram', channel, undefined, err);
        }
      }
      if (gain !== undefined) {
        try {
          tier.setGain(channel, gain);
        } catch (err) {
          tierError(tier, 'setGain', channel, undefined, err);
        }
      }
    }
  }

  /** allNotesOff() on EVERY tier regardless of supports; clears all note memory. */
  function panic() {
    if (disposed) return;
    doPanic();
  }

  function doPanic() {
    for (const tier of tierList) {
      try {
        tier.allNotesOff();
      } catch (err) {
        tierError(tier, 'allNotesOff', undefined, undefined, err);
      }
    }
    noteMemory.clear();
  }

  /** Per-channel panic: every supporting tier + clear that channel's memory. */
  function allNotesOff(channel) {
    if (disposed) return;
    if (channel == null) {
      doPanic();
      return;
    }
    for (const tier of tierList) {
      if (!supports(tier, channel)) continue;
      try {
        tier.allNotesOff(channel);
      } catch (err) {
        tierError(tier, 'allNotesOff', channel, undefined, err);
      }
    }
    const prefix = `${channel}:`;
    for (const key of noteMemory.keys()) {
      if (key.startsWith(prefix)) noteMemory.delete(key);
    }
  }

  /** Panic + drop references. Subsequent calls are silent no-ops. */
  function dispose() {
    if (disposed) return;
    doPanic();
    disposed = true;
    tierList = [];
    notesTap = null;
    logger().info('voice-router.disposed', {});
  }

  logger().info('voice-router.created', { tiers: tierList.map((t) => t?.id) });

  return {
    noteOn,
    noteOff,
    configureLayer,
    allNotesOff,
    panic,
    dispose,
  };
}

export default createVoiceRouter;
