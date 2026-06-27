import { useLayoutEffect, useRef } from 'react';
import { renderChordStaff } from './chordStaff.js';

/**
 * ChordStaffRenderer — React wrapper over the VexFlow chord engraving.
 *
 * Renders the current chord as a compact, centered grand staff and re-fits it
 * whenever the container resizes (a ResizeObserver — the piece the abcjs path
 * lacked, which is why it never re-flowed on orientation/sidebar changes).
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
    if (!host) return undefined;
    const draw = () => renderChordStaff(host, { notes, keySignature });
    draw();
    // Re-fit to the container's live width (orientation, sidebar resize, etc.).
    let ro;
    const target = host.parentElement;
    if (target && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => draw());
      ro.observe(target);
    }
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey, keySignature]);

  return <div className={className} ref={ref} />;
}

export default ChordStaffRenderer;
