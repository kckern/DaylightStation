import { useMemo } from 'react';
import { CurrentChordStaff } from './CurrentChordStaff.jsx';
import { CircleOfFifths } from './CircleOfFifths.jsx';
import { ChordNamePanel } from './ChordNamePanel.jsx';
import { detectKey } from '../../MusicNotation/model/keySignature.js';

/**
 * Music-theory triptych — the opt-in content for the Studio top pane. Drops into
 * StudioTopPane's content slot as `children` (with `align="stretch"`): a
 * circle-of-fifths on the left lighting the sounding pitch classes, the existing
 * current-chord grand staff in the middle, and a live chord name on the right.
 *
 * The StudioTopPane shell still owns the fixed height + generous vertical padding;
 * this component only splits that slot into three columns. The default (staff-only)
 * Studio top pane is unchanged — this is rendered only when the user opts in.
 *
 * @param {Map} activeNotes - live MIDI surface (Map<midi, data>); only keys matter for theory
 */
export function StudioTriptych({ activeNotes }) {
  const midiNotes = useMemo(() => [...activeNotes.keys()], [activeNotes]);
  const pitchClasses = useMemo(() => midiNotes.map((n) => n % 12), [midiNotes]);
  // Light, momentary key read for the circle's soft key-region ring. The middle
  // staff keeps its own rolling detection; this one is intentionally stateless.
  const detectedKey = useMemo(() => detectKey(pitchClasses, 'C'), [pitchClasses]);

  return (
    <div className="piano-triptych">
      <div className="piano-triptych__side piano-triptych__circle">
        <CircleOfFifths pitchClasses={pitchClasses} detectedKey={detectedKey} size={184} />
      </div>
      <div className="piano-triptych__center">
        <CurrentChordStaff activeNotes={activeNotes} />
      </div>
      <div className="piano-triptych__side piano-triptych__chord">
        <ChordNamePanel midiNotes={midiNotes} />
      </div>
    </div>
  );
}

export default StudioTriptych;
