import { useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { identifyChord } from '../theory/chordNaming.js';
import './ChordNamePanel.scss';

/**
 * Live chord-name read-out. Identifies the chord from the currently sounding MIDI
 * notes and shows its display name (e.g. "D minor", "C major / E", "G 7"). The
 * naming logic is the unit-tested theory/chordNaming.js model.
 *
 * @param {number[]} midiNotes - active MIDI note numbers
 */
export function ChordNamePanel({ midiNotes = [] }) {
  const logger = useMemo(() => getLogger().child({ component: 'chord-name-panel' }), []);
  const chord = useMemo(() => identifyChord(midiNotes), [midiNotes]);

  logger.sampled('chord.identify', { quality: chord.quality, name: chord.displayName },
    { maxPerMinute: 30, aggregate: true });

  const hasName = !!chord.displayName;
  return (
    <div className="piano-chord-name" aria-live="polite">
      <div className={`piano-chord-name__plaque${hasName ? '' : ' is-empty'}`}>
        <span className="piano-chord-name__eyebrow">Chord</span>
        <span className="piano-chord-name__value">{hasName ? chord.displayName : '—'}</span>
      </div>
    </div>
  );
}

export default ChordNamePanel;
