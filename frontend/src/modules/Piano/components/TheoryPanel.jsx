import { useMemo } from 'react';
import { CurrentChordStaff } from './CurrentChordStaff.jsx';
import { CircleOfFifths } from './CircleOfFifths.jsx';
import { ChordNamePanel } from './ChordNamePanel.jsx';
import { identifyChord } from '../theory/chordNaming.js';
import { useDetectedKey } from './useDetectedKey.js';
import './TheoryPanel.scss';

/**
 * Unified music-theory composite — circle of fifths · live grand staff · chord
 * name. Replaces the two hand-rolled layouts (StudioTriptych's horizontal grid
 * and PianoChordColumn's vertical flex) with a single flexbox component driven
 * by a `layout` prop:
 *   - `layout="row"`    → horizontal (circle | staff | chord), Studio top pane.
 *   - `layout="column"` → vertical (circle / staff / chord), Videos sidebar.
 *
 * The circle and chord plaque size fluidly off their slots (CSS scales the
 * circle's 220px viewBox to fill an aspect-locked square); the middle staff
 * flexes to fill the remaining space. As with the originals, the circle takes a
 * shared rolling key read (useDetectedKey) that drives BOTH its soft key-region
 * ring AND the staff's key signature, so the two always agree and follow the key
 * being played. CurrentChordStaff (not ChordStaffRenderer) is used so
 * note-decay/peak behavior is preserved.
 *
 * @param {Map} activeNotes - live MIDI surface (Map<midi, data>); only keys matter for theory
 * @param {'row'|'column'} [layout='row'] - orientation of the three slots
 */
export function TheoryPanel({ activeNotes, layout = 'row' }) {
  const midiNotes = useMemo(() => [...activeNotes.keys()], [activeNotes]);
  const pitchClasses = useMemo(() => midiNotes.map((n) => n % 12), [midiNotes]);
  // One shared rolling key, fed to BOTH the circle and the staff so they agree.
  const detectedKey = useDetectedKey(activeNotes);
  // The identified chord's root pitch class → the circle emphasises that degree.
  const rootPc = useMemo(() => identifyChord(midiNotes).root, [midiNotes]);

  return (
    <div className={`theory-panel theory-panel--${layout}`}>
      <div className="theory-panel__circle">
        <div className="theory-panel__circle-box">
          <CircleOfFifths pitchClasses={pitchClasses} detectedKey={detectedKey} rootPc={rootPc} />
        </div>
      </div>
      <div className="theory-panel__staff">
        <CurrentChordStaff activeNotes={activeNotes} detectedKey={detectedKey} />
      </div>
      <div className="theory-panel__chord">
        <ChordNamePanel midiNotes={midiNotes} />
      </div>
    </div>
  );
}

export default TheoryPanel;
