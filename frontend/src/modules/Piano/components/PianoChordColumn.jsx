import { useMemo } from 'react';
import { CurrentChordStaff } from './CurrentChordStaff.jsx';
import { CircleOfFifths } from './CircleOfFifths.jsx';
import { ChordNamePanel } from './ChordNamePanel.jsx';
import { detectKey } from '../../MusicNotation/model/keySignature.js';

/**
 * Vertical chord-theory column — the sidebar companion to StudioTriptych (which
 * lays the same three pieces out horizontally). Circle of fifths pinned at the
 * top, the live current-chord grand staff vertically centered in the flexible
 * middle, and the chord-name badge pinned at the bottom. The top and bottom are
 * fixed-size so their centers don't shift as the staff content changes.
 *
 * @param {Map} activeNotes - live MIDI surface (Map<midi, data>); only keys matter
 * @param {number} [circleSize=160] - intrinsic px size of the circle-of-fifths SVG
 */
export function PianoChordColumn({ activeNotes, circleSize = 160 }) {
  const midiNotes = useMemo(() => [...activeNotes.keys()], [activeNotes]);
  const pitchClasses = useMemo(() => midiNotes.map((n) => n % 12), [midiNotes]);
  // Light, momentary key read for the circle's soft key-region ring; the staff
  // keeps its own rolling detection (mirrors StudioTriptych).
  const detectedKey = useMemo(() => detectKey(pitchClasses, 'C'), [pitchClasses]);

  return (
    <div className="piano-chord-column">
      <div className="piano-chord-column__circle">
        <CircleOfFifths pitchClasses={pitchClasses} detectedKey={detectedKey} size={circleSize} />
      </div>
      <div className="piano-chord-column__staff">
        <CurrentChordStaff activeNotes={activeNotes} />
      </div>
      <div className="piano-chord-column__chord">
        <ChordNamePanel midiNotes={midiNotes} />
      </div>
    </div>
  );
}

export default PianoChordColumn;
