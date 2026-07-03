import { useLayoutEffect, useRef, useState } from 'react';
import { renderChordStaff } from './chordStaff.js';
import './ChordStaffRenderer.scss';

/**
 * ChordStaffRenderer — React wrapper over the VexFlow chord engraving.
 *
 * Renders the current chord as a compact grand staff. The host div OWNS its
 * bounding box (see ChordStaffRenderer.scss: the SVG is absolutely positioned so
 * it can never drive layout). A ResizeObserver measures the real box and feeds a
 * bucketed aspect into the engraving so a wide box WIDENS the stave to fill it.
 * Re-renders only when the chord, key, or (bucketed) aspect changes.
 *
 * @param {Map} notes - MIDI note → data (only keys are used)
 * @param {string} [keySignature='C']
 * @param {string} [className='chord-staff']
 */
export function ChordStaffRenderer({ notes, keySignature = 'C', className = 'chord-staff' }) {
  const ref = useRef(null);
  const [aspect, setAspect] = useState(null);
  const notesKey = notes ? [...notes.keys()].sort((a, b) => a - b).join(',') : '';

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      // Bucket to 0.05 so live-resize noise doesn't thrash VexFlow re-renders.
      const next = Math.round((width / height) * 20) / 20;
      setAspect((prev) => (prev === next ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const host = ref.current;
    if (host) renderChordStaff(host, { notes, keySignature, aspect });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey, keySignature, aspect]);

  return <div className={className} ref={ref} />;
}

export default ChordStaffRenderer;
