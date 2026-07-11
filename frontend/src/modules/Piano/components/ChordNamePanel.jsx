import { useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { identifyChord } from '../theory/chordNaming.js';
import { useStableChord } from './useStableChord.js';
import './ChordNamePanel.scss';

/** How long the last chord LINGERS after the keys are released, so a quick
 *  lift-and-replace never blanks the panel. */
const RELEASE_HOLD_MS = 500;
/** Onset settle window — a new chord must hold this long before it replaces the
 *  shown one, so transient partial chords during a roll/transition don't flash. */
const SETTLE_MS = 80;

/**
 * Live chord-name read-out. Identifies the chord from the currently sounding MIDI
 * notes and shows its display name (e.g. "D minor", "C 7 / E", "C 9"). The naming
 * logic is the unit-tested theory/chordNaming.js model.
 *
 * Stability (useStableChord): a new chord must settle for `settleMs` before it
 * shows, so rolling/transitioning between chords doesn't flash intermediate
 * partial chords; on release the last chord lingers `holdMs` before blanking.
 *
 * @param {number[]} midiNotes - active MIDI note numbers
 * @param {number} [holdMs] - linger after release (default 500ms)
 * @param {number} [settleMs] - onset settle window (default 80ms)
 */
export function ChordNamePanel({ midiNotes = [], holdMs = RELEASE_HOLD_MS, settleMs = SETTLE_MS }) {
  const logger = useMemo(() => getLogger().child({ component: 'chord-name-panel' }), []);
  const chord = useMemo(() => identifyChord(midiNotes), [midiNotes]);
  const shown = useStableChord(chord, { settleMs, holdMs });

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
