import { useEffect, useMemo, useRef, useState } from 'react';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { createHumanNoteClassifier } from './humanNoteClassifier.js';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-human-notes' });
  return _logger;
}

const EMPTY = new Map();

/**
 * useHumanNotes — the note stream with the piano's own traffic taken out
 * (rhythm/drum loop, accompaniment channels, clockwork playback; see
 * humanNoteClassifier). One classifier per mount, fed from the raw note tap so
 * it sees every note-on in order.
 *
 * Returns:
 *   humanNoteAt — Date.now() of the last note a person played (0 = none yet).
 *     Anything that means "someone is at the piano" keys off this, never off
 *     activeNotes.
 *   humanHeld   — Map<note, velocity> of keys whose latest note-on was human.
 *     Intersect with the store's activeNotes (which sweeps lost note-offs)
 *     before matching against a prompt.
 *   loopPitches() — pitches the running rhythm loop plays (never ask for one).
 */
export function useHumanNotes({ enabled = true, context } = {}) {
  const { subscribe } = usePianoMidi() || {};
  const classifierRef = useRef(null);
  if (!classifierRef.current) classifierRef.current = createHumanNoteClassifier();
  const [humanNoteAt, setHumanNoteAt] = useState(0);
  const [humanHeld, setHumanHeld] = useState(EMPTY);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    if (!enabled || typeof subscribe !== 'function') return undefined;
    const c = classifierRef.current;
    let filtered = 0;
    const unsubscribe = subscribe((evt) => {
      if (evt?.type === 'note_on') {
        const v = c.classify(evt);
        if (v.transition) {
          logger().info('piano.presence.rhythm-loop', {
            state: v.transition === 'loop-on' ? 'on' : 'off',
            pitches: [...c.loopPitches].sort((a, b) => a - b),
            ...contextRef.current,
          });
        }
        if (v.human) {
          setHumanNoteAt(Date.now());
          setHumanHeld((prev) => new Map(prev).set(evt.note, evt.velocity));
        } else {
          filtered += 1;
          logger().sampled('piano.presence.note-filtered', {
            reason: v.reason, note: evt.note, filteredSoFar: filtered, ...contextRef.current,
          }, { maxPerMinute: 4, aggregate: true });
          // A machine note-on on a key a person was holding takes the key over.
          setHumanHeld((prev) => {
            if (!prev.has(evt.note)) return prev;
            const next = new Map(prev);
            next.delete(evt.note);
            return next;
          });
        }
      } else if (evt?.type === 'note_off') {
        setHumanHeld((prev) => {
          if (!prev.has(evt.note)) return prev;
          const next = new Map(prev);
          next.delete(evt.note);
          return next;
        });
      }
    });
    return () => {
      unsubscribe?.();
      const { human, machine } = c.counts;
      if (machine > 0) logger().info('piano.presence.summary', { human, machine, ...contextRef.current });
    };
  }, [enabled, subscribe]);

  return useMemo(() => ({
    humanNoteAt,
    humanHeld,
    loopPitches: () => classifierRef.current.loopPitches,
  }), [humanNoteAt, humanHeld]);
}

/** activeNotes restricted to keys a person is holding (Map in, Map out). */
export function humanActiveNotes(activeNotes, humanHeld) {
  if (!activeNotes || activeNotes.size === 0 || !humanHeld || humanHeld.size === 0) return EMPTY;
  const out = new Map();
  for (const [note, info] of activeNotes) if (humanHeld.has(note)) out.set(note, info);
  return out;
}

export default useHumanNotes;
