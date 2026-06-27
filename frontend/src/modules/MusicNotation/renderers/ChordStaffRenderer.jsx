import { useLayoutEffect, useRef } from 'react';
import { renderChordStaff } from './chordStaff.js';

/**
 * ChordStaffRenderer — React wrapper over the VexFlow chord engraving.
 *
 * Renders the current chord as a compact grand staff. The SVG carries a viewBox
 * so the browser scales it to fit (and center within) its container — so resize /
 * orientation / DPR are handled by CSS, not JS. Re-renders only when the chord or
 * key changes.
 *
 * @param {Map} notes - MIDI note → data (only keys are used)
 * @param {string} [keySignature='C']
 * @param {string} [className='chord-staff']
 */
export function ChordStaffRenderer({ notes, keySignature = 'C', className = 'chord-staff' }) {
  const ref = useRef(null);
  const notesKey = notes ? [...notes.keys()].sort((a, b) => a - b).join(',') : '';

  useLayoutEffect(() => {
    const host = ref.current;
    if (host) renderChordStaff(host, { notes, keySignature });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey, keySignature]);

  return <div className={className} ref={ref} />;
}

export default ChordStaffRenderer;
