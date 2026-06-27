import { useLayoutEffect, useRef, useState } from 'react';
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
 * @param {boolean} [pinStaff=false] - keep the STAVE fixed and centered: after
 *   each paint, translate the SVG so the staff lines' midpoint sits at the
 *   container's center on BOTH axes. Vertically this prevents the "rug pull"
 *   where ledger lines grow the SVG and shift the stave; horizontally it
 *   counters abcjs left-aligning the music inside a full-width SVG (sparse/empty
 *   chords would otherwise hug the left). For live chord displays; leave off for
 *   scrolling teleprompter drills.
 * @param {(tune:object, staffNotes:Array)=>void} [onRender] - post-paint hook
 */
export function AbcRenderer({ notes, abc, keySignature = 'C', scale = 1.5, className = 'abc-renderer', singleLine = false, pinStaff = false, onRender }) {
  const containerRef = useRef(null);
  const onRenderRef = useRef(onRender);
  onRenderRef.current = onRender;
  const [error, setError] = useState(null);

  // `abc` (a pre-built tune string, e.g. a Hanon melodic figure) takes precedence
  // over `notes` (a Map rendered as a single chord).
  const notesKey = abc ?? (notes ? Array.from(notes.keys()).sort((a, b) => a - b).join(',') : '');

  // Holds the latest render closure so a ResizeObserver can re-render with current
  // props (staffwidth + pin both depend on the live container width) without
  // re-subscribing the observer on every prop change.
  const renderRef = useRef(() => {});

  useLayoutEffect(() => {
    const render = () => {
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

      // Pin the stave: measure the rendered staff lines and translate the SVG so
      // their vertical midpoint lands at the container's center. abcjs grows the
      // SVG asymmetrically as ledger lines appear above/below, so centering the
      // SVG box would slide the stave around (the "rug pull"). Measuring the
      // staff lines themselves — which never move relative to the music — keeps
      // the stave fixed no matter how high or low the current note is. Runs in a
      // layout effect, so it applies before paint (no visible jump).
      if (pinStaff) {
        const container = containerRef.current;
        const svg = container.querySelector('svg');
        const staffEls = container.querySelectorAll('.abcjs-staff');
        if (svg && staffEls.length) {
          svg.style.transform = 'none';
          const cRect = container.getBoundingClientRect();
          let top = Infinity;
          let bottom = -Infinity;
          let left = Infinity;
          let right = -Infinity;
          staffEls.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;
            top = Math.min(top, r.top);
            bottom = Math.max(bottom, r.bottom);
            left = Math.min(left, r.left);
            right = Math.max(right, r.right);
          });
          if (Number.isFinite(top) && Number.isFinite(bottom)) {
            const staffMidY = (top + bottom) / 2;
            const containerMidY = cRect.top + cRect.height / 2;
            const dy = Math.round(containerMidY - staffMidY);
            // abcjs sizes the SVG to staffwidth but left-aligns the music and
            // draws the staff lines only out to the final barline, so a sparse
            // chord (or empty staff) leaves blank space on the right and reads as
            // left-aligned. Mirror the vertical pin: measure the staff lines'
            // horizontal extent and translate so their midpoint lands at the
            // container's center.
            let dx = 0;
            if (Number.isFinite(left) && Number.isFinite(right)) {
              const staffMidX = (left + right) / 2;
              const containerMidX = cRect.left + cRect.width / 2;
              dx = Math.round(containerMidX - staffMidX);
            }
            svg.style.transform = `translate(${dx}px, ${dy}px)`;
          }
        }
      }

      if (onRenderRef.current && tuneObject) {
        onRenderRef.current(tuneObject, collectStaffNotes(tuneObject));
      }
    } catch (e) {
      console.error('abcjs render error:', e.message);
      setError(e.message);
    }
    };
    renderRef.current = render;
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey, keySignature, scale, singleLine, pinStaff]);

  // When the container resizes (e.g. the player sidebar widens once the video's
  // aspect ratio resolves and the JS-sized stack settles), a one-shot mount-time
  // pin would leave the staff off-center. Re-render on resize so the staffwidth
  // and the horizontal/vertical pin track the live container size. Only for the
  // pinned live-chord display — the scrolling teleprompter manages its own width.
  useLayoutEffect(() => {
    if (!pinStaff || !containerRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const target = containerRef.current.parentElement || containerRef.current;
    const ro = new ResizeObserver(() => renderRef.current?.());
    ro.observe(target);
    return () => ro.disconnect();
  }, [pinStaff]);

  if (error) {
    return <span style={{ color: 'red', fontSize: '12px' }}>{error}</span>;
  }

  return <div className={className} ref={containerRef} />;
}

export default AbcRenderer;
