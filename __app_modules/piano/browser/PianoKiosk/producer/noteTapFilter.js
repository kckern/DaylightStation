/**
 * noteTapFilter — keyboard-visualization channel filter for the VoiceRouter's
 * `onNotes` tap (design §2 / Task 3.2).
 *
 * The router's tap is deliberately unfiltered; the CONSUMER decides what the
 * on-screen PianoKeyboard shows. Per design §2: harmonic/bass layers light the
 * keys, percussion and dense melody don't. These are tiny pure helpers — the
 * Producer shell wires them in Task 4.4 (mirroring how Producer.jsx feeds
 * `loopNotes` from transport.loopNotesRef today).
 *
 * Both helpers expose `setVisibleChannels(iterable)` because layers' channels
 * change as layers come and go.
 */

/**
 * Predicate over tap events: `{ type, channel, note } → bool`.
 *
 * @param {object} [opts]
 * @param {Iterable<number>} [opts.visibleChannels] - channels to pass (Set or array).
 * @returns {(evt: { channel: number }) => boolean} with `.setVisibleChannels(iterable)`.
 */
export function createNoteTapFilter({ visibleChannels } = {}) {
  let visible = new Set(visibleChannels ?? []);
  const filter = (evt) => visible.has(evt?.channel);
  filter.setVisibleChannels = (channels) => {
    visible = new Set(channels ?? []);
  };
  return filter;
}

/**
 * Tap consumer that maintains the set of SOUNDING notes on visible channels
 * and pushes it to React state. Wire as `router.onNotes` → this tap, and
 * `onSet` → `setLoopNotes` (PianoKeyboard's `loopNotes` prop).
 *
 * - `onSet` always receives a NEW Set (React state identity), only on actual
 *   change (retriggers and unknown offs don't churn renders).
 * - Notes are tracked per channel+note, so the same pitch held on two visible
 *   channels stays lit until BOTH release.
 * - `setVisibleChannels` prunes now-hidden channels' sounding notes: a layer
 *   removed mid-note must not leave its keys lit.
 *
 * @param {object} [opts]
 * @param {Iterable<number>} [opts.visibleChannels]
 * @param {(notes: Set<number>) => void} [opts.onSet]
 * @returns {(evt: { type: 'on'|'off', channel: number, note: number }) => void}
 *   with `.setVisibleChannels(iterable)` and `.clear()`.
 */
export function makeLoopNotesTap({ visibleChannels, onSet } = {}) {
  let visible = new Set(visibleChannels ?? []);
  /** `${channel}:${note}` → note (per-channel so shared pitches release right). */
  const sounding = new Map();

  const emit = () => {
    if (!onSet) return;
    onSet(new Set(sounding.values()));
  };

  const tap = (evt) => {
    if (!evt) return;
    const { type, channel, note } = evt;
    const key = `${channel}:${note}`;
    if (type === 'on') {
      if (!visible.has(channel) || sounding.has(key)) return;
      sounding.set(key, note);
      emit();
    } else if (type === 'off') {
      if (sounding.delete(key)) emit();
    }
  };

  tap.setVisibleChannels = (channels) => {
    visible = new Set(channels ?? []);
    let pruned = false;
    for (const key of sounding.keys()) {
      const channel = Number(key.slice(0, key.indexOf(':')));
      if (!visible.has(channel)) {
        sounding.delete(key);
        pruned = true;
      }
    }
    if (pruned) emit();
  };

  tap.clear = () => {
    if (sounding.size === 0) return;
    sounding.clear();
    emit();
  };

  return tap;
}

export default makeLoopNotesTap;
