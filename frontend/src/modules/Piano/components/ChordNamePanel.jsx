import { useMemo, useState, useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { identifyChord } from '../theory/chordNaming.js';
import './ChordNamePanel.scss';

/** How long the last chord LINGERS after the keys are released, so a quick
 *  lift-and-replace never blanks the panel. Cleared early when a new chord
 *  takes its place. */
const RELEASE_HOLD_MS = 500;

/**
 * Live chord-name read-out. Identifies the chord from the currently sounding MIDI
 * notes and shows its display name (e.g. "D minor", "C 7 / E", "C 9"). The naming
 * logic is the unit-tested theory/chordNaming.js model.
 *
 * Persistence: a live chord shows instantly, but on release the last chord holds
 * for `holdMs` before clearing — the read-out no longer flickers away the instant
 * a finger lifts. A new chord replaces it immediately (no wait).
 *
 * @param {number[]} midiNotes - active MIDI note numbers
 * @param {number} [holdMs] - linger after release (default 500ms)
 */
export function ChordNamePanel({ midiNotes = [], holdMs = RELEASE_HOLD_MS }) {
  const logger = useMemo(() => getLogger().child({ component: 'chord-name-panel' }), []);
  const chord = useMemo(() => identifyChord(midiNotes), [midiNotes]);

  const [shown, setShown] = useState(chord);
  const timerRef = useRef(null);

  useEffect(() => {
    if (chord.displayName) {
      // A live chord wins immediately and cancels any pending clear.
      clearTimeout(timerRef.current);
      timerRef.current = null;
      setShown(chord);
    } else if (timerRef.current == null) {
      // Keys released — let the current read-out linger, then clear.
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setShown(chord); // the empty chord captured at release
      }, holdMs);
    }
  }, [chord, holdMs]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  logger.sampled('chord.identify', { quality: chord.quality, name: chord.displayName },
    { maxPerMinute: 30, aggregate: true });

  const hasName = !!shown.displayName;
  const held = hasName && !chord.displayName; // showing a lingering (released) chord
  return (
    <div className="piano-chord-name" aria-live="polite">
      <div className={`piano-chord-name__plaque${hasName ? '' : ' is-empty'}${held ? ' is-held' : ''}`}>
        <span className="piano-chord-name__eyebrow">Chord</span>
        <span className="piano-chord-name__value">{hasName ? shown.displayName : '—'}</span>
      </div>
    </div>
  );
}

export default ChordNamePanel;
