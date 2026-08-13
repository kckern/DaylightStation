import { useLayoutEffect, useRef, useState } from 'react';
import { renderChordStaff } from './chordStaff.js';
import './ChordStaffRenderer.scss';

/**
 * ChordStaffRenderer — React wrapper over the VexFlow chord engraving.
 *
 * Renders the live note flow as a grand staff. The host div OWNS its bounding box
 * (see ChordStaffRenderer.scss: the SVG is absolutely positioned so it can never
 * drive layout). A ResizeObserver measures the real box and feeds a bucketed aspect
 * into the engraving so a wide box WIDENS the stave to fill it. Re-renders only when
 * the flow, key, or (bucketed) aspect changes.
 *
 * @param {Array<number[]|{midis: number[], spelling?: Map}>} [columns] - the note flow,
 *   oldest → newest (see model/noteFlow.js); columns may carry a chord spelling
 * @param {Map} [notes] - single-chord form: MIDI note → data (only keys are used)
 * @param {string} [keySignature='C']
 * @param {string} [className='chord-staff']
 */
export function ChordStaffRenderer({ columns, notes, keySignature = 'C', className = 'chord-staff' }) {
  const ref = useRef(null);
  const [aspect, setAspect] = useState(null);
  // Identity of what is drawn — columns are ordered, so this must not be sorted
  // across them: [[60],[64]] and [[64],[60]] are different pictures. Duration is part
  // of the identity too: the newest column promotes from a quarter to a half without
  // any note changing, and that has to repaint.
  const notesKey = columns
    ? columns
      .map((col) => {
        const midis = Array.isArray(col) ? col : col?.midis ?? [];
        const duration = Array.isArray(col) ? '' : col?.duration ?? '';
        return `${[...midis].sort((a, b) => a - b).join('.')}:${duration}`;
      })
      .join('|')
    : notes ? [...notes.keys()].sort((a, b) => a - b).join(',') : '';

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
    if (host) renderChordStaff(host, { columns, notes, keySignature, aspect });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey, keySignature, aspect]);

  return <div className={className} ref={ref} />;
}

export default ChordStaffRenderer;
