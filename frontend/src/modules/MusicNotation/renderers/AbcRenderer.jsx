import { useEffect, useRef, useState } from 'react';
import abcjs from 'abcjs';
import 'abcjs/abcjs-audio.css';
import { generateAbc } from './abc.js';

/**
 * AbcRenderer — renders a set of notes as a grand-staff snippet via abcjs.
 *
 * Presentational: given the notes to show and a key signature, it builds the ABC
 * string (model-backed) and paints it. Stateful concerns (decay, key detection)
 * belong to the caller. Extracted from CurrentChordStaff so the abcjs backend is
 * one of several MusicNotation renderers behind a shared model.
 *
 * @param {Map} notes - Map of MIDI note → note data (only keys are used)
 * @param {string} keySignature - e.g. 'C', 'G', 'F'
 * @param {number} [scale=1.5] - abcjs render scale
 * @param {string} [className='abc-renderer'] - class on the render container
 *   (lets callers keep their existing abcjs styling hooks)
 */
export function AbcRenderer({ notes, keySignature = 'C', scale = 1.5, className = 'abc-renderer' }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);

  const notesKey = Array.from(notes.keys()).sort((a, b) => a - b).join(',');

  useEffect(() => {
    if (!containerRef.current) return;
    try {
      const abc = generateAbc(notes, keySignature);
      const containerWidth = containerRef.current.parentElement?.offsetWidth || 600;
      const sidePad = 12;
      abcjs.renderAbc(containerRef.current, abc, {
        staffwidth: Math.max(120, containerWidth - sidePad * 2),
        paddingtop: 0,
        paddingbottom: 0,
        paddingleft: sidePad,
        paddingright: sidePad,
        add_classes: true,
        scale,
      });
    } catch (e) {
      console.error('abcjs render error:', e.message);
      setError(e.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey, keySignature, scale]);

  if (error) {
    return <span style={{ color: 'red', fontSize: '12px' }}>{error}</span>;
  }

  return <div className={className} ref={containerRef} />;
}

export default AbcRenderer;
