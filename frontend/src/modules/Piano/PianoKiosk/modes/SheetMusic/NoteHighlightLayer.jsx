import { useLayoutEffect } from 'react';

const LIT = 'piano-note-lit'; // upcoming / expected note at the cursor
const HIT = 'piano-note-hit'; // struck correctly (adds a glow)
const PENDING = 'piano-note-pending'; // expected here, still outstanding (Learn)

/**
 * NoteHighlightLayer — lights up the CURRENT step's active-staff noteheads by
 * recolouring the ENGRAVED note itself (OSMD's per-note SVG `<g>`), rather than
 * painting an overlay rectangle over it. Toggles CSS classes + a `--nh-color`
 * custom property on each note's element; the actual fill swap lives in CSS
 * (`.piano-note-lit` / `.piano-note-hit` under `.musicxml-renderer__svg`), where
 * a stylesheet rule cleanly overrides vexflow's black `fill` attribute.
 *
 * Renders nothing. On every state change it reverts the notes it previously lit
 * (effect cleanup) before lighting the new set, so no stale colour lingers — and
 * it clears on unmount too. Notes whose graphical element is missing (rare
 * fallback geometry) simply aren't tinted; the cursor band still marks the column.
 *
 * @param {object}  p
 * @param {{notes: Array<{midi,staff,el}>}} [p.step]
 * @param {Object<number,boolean>} p.activeParts - { [staff]: on }
 * @param {Set<number>} [p.struck]  - midis struck at this step (→ hit glow)
 * @param {string} [p.accent] - light-up colour (matches the mode's cursor colour)
 * @param {boolean} [p.showPending] - mark expected-but-unstruck noteheads. Learn
 *   advances only when EVERY active-staff note of the step is struck; without
 *   this the struck note takes the hit colour and the user has no way to see
 *   they still owe the other hand (audit H3).
 */
export default function NoteHighlightLayer({ step, activeParts = {}, struck, accent, showPending = false }) {
  useLayoutEffect(() => {
    const lit = [];
    for (const note of step?.notes || []) {
      const el = note.el;
      if (!el || !activeParts[note.staff]) continue; // deactivated staff / no element
      el.classList.add(LIT);
      if (struck?.has(note.midi)) el.classList.add(HIT);
      else if (showPending) el.classList.add(PENDING);
      if (accent) el.style.setProperty('--nh-color', accent);
      lit.push(el);
    }
    return () => {
      for (const el of lit) {
        el.classList.remove(LIT, HIT, PENDING);
        el.style.removeProperty('--nh-color');
      }
    };
  }, [step, activeParts, struck, accent, showPending]);

  return null;
}
