import { useLayoutEffect, useState } from 'react';
import { WetNoteGlyph } from '../../PianoKiosk/modes/Composer/wetGlyphs.jsx';
import { ghostPlacement } from './wrongNoteGhost.js';

/**
 * WrongNoteGhost — draws the note you actually played, faintly, beside the note
 * you owed. Mounted only while the last input was wrong; the red mark on the
 * engraved notehead keeps saying which note was expected, and this says which
 * one arrived instead.
 *
 * It measures the LIVE engraving rather than deriving positions from the ABC
 * string: abcjs re-lays the staff out on every resize and scales the whole SVG
 * to fit the card, so the only trustworthy source of "where is the top line and
 * how far apart are they" is the staff lines as painted. Measuring in a layout
 * effect means the ghost is positioned before the browser paints it — it never
 * appears at the wrong pitch first and corrects itself.
 *
 * Renders nothing when the staff cannot be measured (mid re-engrave) or the clef
 * is one WetNoteGlyph cannot place a pitch on. A ghost on the wrong line would
 * teach the wrong note, so not drawing is the honest failure.
 *
 * @param {object} p
 * @param {HTMLElement|null} p.container - the positioned box the overlay fills
 * @param {SVGElement|null} p.anchor - the expected note's engraved element
 * @param {number|null} p.midi - the pitch that was actually played
 * @param {string|null} p.clefType - abcjs clef type of the engraved staff
 * @param {string} [p.keyName] - the exercise's key signature
 * @param {number} [p.engraving] - bumped on every repaint, so the ghost
 *   re-measures when abcjs re-lays the staff out (resize, new challenge)
 */
export function WrongNoteGhost({ container, anchor, midi, clefType, keyName, engraving = 0 }) {
  const [placement, setPlacement] = useState(null);

  useLayoutEffect(() => {
    if (!container || !anchor || !Number.isFinite(midi)) { setPlacement(null); return; }
    const lines = container.querySelectorAll('.abcjs-staff > *');
    setPlacement(ghostPlacement({
      midi,
      clefType,
      keyName,
      anchorRect: anchor.getBoundingClientRect(),
      originRect: container.getBoundingClientRect(),
      lineRects: Array.from(lines, (line) => line.getBoundingClientRect()),
    }));
  }, [container, anchor, midi, clefType, keyName, engraving]);

  if (!placement) return null;

  return (
    <svg className="piano-scale-ghost" aria-hidden="true">
      <g className="piano-scale-ghost__note">
        <WetNoteGlyph
          x={placement.x}
          staff={placement.staff}
          pitch={placement.pitch}
          clef={placement.clef}
          classPrefix="piano-scale-ghost"
        />
      </g>
    </svg>
  );
}

export default WrongNoteGhost;
