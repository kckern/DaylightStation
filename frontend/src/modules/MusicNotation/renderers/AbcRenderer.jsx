import { useEffect, useRef, useState } from 'react';
import abcjs from 'abcjs';
import 'abcjs/abcjs-audio.css';
import { generateAbc } from './abc.js';

/**
 * Walk an abcjs tune object and return, per staff, the ordered pitched-note
 * elements with their SVG nodes — so a caller can light up individual noteheads
 * (e.g. a MIDI follow-along). Index N within a staff maps 1:1 to the Nth played
 * note of that staff's voice (rests excluded), matching a flattened drill hand.
 *
 * @returns {Array<Array<{ midi:number|null, els: SVGElement[] }>>} notes per staff
 */
export function collectStaffNotes(tune) {
  const staves = []; // staffIndex → [{ midi, els }]
  const lines = tune?.lines || [];
  for (const line of lines) {
    const staff = line.staff;
    if (!Array.isArray(staff)) continue;
    staff.forEach((st, si) => {
      const bucket = staves[si] || (staves[si] = []);
      (st.voices || []).forEach((voice) => {
        (voice || []).forEach((el) => {
          if (el.el_type !== 'note' || el.rest) return;
          const abs = el.abselem;
          const els = (abs?.elemset && abs.elemset.length ? abs.elemset : abs?.heads) || [];
          const midi = el.midiPitches?.[0]?.pitch ?? null;
          bucket.push({ midi, els: Array.from(els).filter(Boolean) });
        });
      });
    });
  }
  return staves;
}

/**
 * AbcRenderer — renders a set of notes (or a pre-built ABC tune) as a grand-staff
 * snippet via abcjs.
 *
 * Presentational: given the notes to show and a key signature, it builds the ABC
 * string (model-backed) and paints it. Stateful concerns (decay, key detection,
 * follow cursor) belong to the caller. When `onRender` is supplied, it is called
 * after each paint with `(tuneObject, staffNotes)` so the caller can drive
 * notehead highlighting without reaching into abcjs internals.
 *
 * @param {Map} notes - Map of MIDI note → note data (only keys are used)
 * @param {string} abc - a pre-built tune string (takes precedence over `notes`)
 * @param {string} keySignature - e.g. 'C', 'G', 'F'
 * @param {number} [scale=1.5] - abcjs render scale
 * @param {string} [className='abc-renderer'] - class on the render container
 * @param {boolean} [singleLine=false] - render the whole voice on one horizontal
 *   line (no wrapping) for a teleprompter-style scrolling follow-along
 * @param {(tune:object, staffNotes:Array)=>void} [onRender] - post-paint hook
 */
export function AbcRenderer({ notes, abc, keySignature = 'C', scale = 1.5, className = 'abc-renderer', singleLine = false, onRender }) {
  const containerRef = useRef(null);
  const onRenderRef = useRef(onRender);
  onRenderRef.current = onRender;
  const [error, setError] = useState(null);

  // `abc` (a pre-built tune string, e.g. a Hanon melodic figure) takes precedence
  // over `notes` (a Map rendered as a single chord).
  const notesKey = abc ?? (notes ? Array.from(notes.keys()).sort((a, b) => a - b).join(',') : '');

  useEffect(() => {
    if (!containerRef.current) return;
    try {
      const tune = abc ?? generateAbc(notes, keySignature);
      const containerWidth = containerRef.current.parentElement?.offsetWidth || 600;
      const sidePad = 12;
      // singleLine: force one long horizontal staff line (no wrapping) so a
      // follow-along cursor can scroll it like a teleprompter. A staffwidth wider
      // than the content keeps abcjs from wrapping; the parent scrolls to reveal
      // it. Must stay UNDER the browser/WebView max SVG dimension (~32767px on the
      // SM-T590 — 100000 rendered blank), so size it to the note count and cap it.
      let staffwidth = Math.max(120, containerWidth - sidePad * 2);
      if (singleLine) {
        const noteCount = typeof tune === 'string' ? (tune.match(/[A-Ga-gz]/g) || []).length : 0;
        staffwidth = Math.min(30000, Math.max(800, noteCount * 22));
      }
      const result = abcjs.renderAbc(containerRef.current, tune, {
        staffwidth,
        paddingtop: 0,
        paddingbottom: 0,
        paddingleft: sidePad,
        paddingright: sidePad,
        add_classes: true,
        scale,
      });
      const tuneObject = Array.isArray(result) ? result[0] : result;
      if (onRenderRef.current && tuneObject) {
        onRenderRef.current(tuneObject, collectStaffNotes(tuneObject));
      }
    } catch (e) {
      console.error('abcjs render error:', e.message);
      setError(e.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey, keySignature, scale, singleLine]);

  if (error) {
    return <span style={{ color: 'red', fontSize: '12px' }}>{error}</span>;
  }

  return <div className={className} ref={containerRef} />;
}

export default AbcRenderer;
