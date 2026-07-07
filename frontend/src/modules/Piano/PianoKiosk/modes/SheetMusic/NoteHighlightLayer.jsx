import React from 'react';

/**
 * NoteHighlightLayer — per-notehead light-up overlay for the sheet-music player.
 *
 * Pure/presentational: renders one absolutely-positioned chip over every note of
 * the current step that belongs to an ACTIVE staff, coloured by its state:
 *   target — expected here, not yet struck (dim ink ring, "you are here")
 *   hit    — struck correctly (solid accent fill + glow)
 *   missed — flagged missed (brief red flash)
 * Non-active-staff notes are omitted entirely. Positioned in the same offset-space
 * as the cursor overlay (boxes already in px from OSMD geometry), so it drops into
 * the MusicXmlRenderer children next to the cursor. `pointer-events: none` is CSS.
 *
 * @param {object}  p
 * @param {{notes: Array<{midi,staff,x,top,bottom,width}>}} [p.step]
 * @param {Object<number,boolean>} p.activeParts - { [staff]: on }
 * @param {Set<number>} [p.struck]  - midis struck at this step (→ hit)
 * @param {Set<number>} [p.missed]  - midis flagged missed (→ missed)
 * @param {number} [p.scale=1]
 * @param {string} [p.accent] - light-up colour (matches the mode's cursor colour)
 */
export default function NoteHighlightLayer({ step, activeParts = {}, struck, missed, scale = 1, accent }) {
  const notes = step?.notes;
  if (!notes || !notes.length) return null;

  return (
    <>
      {notes.map((box, i) => {
        if (!activeParts[box.staff]) return null; // deactivated staff — omit
        const state = missed?.has(box.midi) ? 'missed' : struck?.has(box.midi) ? 'hit' : 'target';
        const w = box.width * scale;
        return (
          <div
            key={`${box.staff}:${box.midi}:${i}`}
            className={`piano-score-note piano-score-note--${state}`}
            style={{
              transform: `translate3d(${box.x - w / 2}px, ${box.top}px, 0)`,
              width: w,
              height: box.bottom - box.top,
              '--nh-color': accent,
            }}
          />
        );
      })}
    </>
  );
}
