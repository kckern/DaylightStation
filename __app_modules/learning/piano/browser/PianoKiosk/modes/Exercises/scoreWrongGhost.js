/**
 * scoreWrongGhost — a wrong note drawn on the ENGRAVED staff, at the pitch played.
 *
 * The drill's score passage (ScorePassage, OSMD/VexFlow ink) answers a wrong note
 * by flashing the note that was owed. That says "no" but not "you played this":
 * for a reader that is enough, for a child who is learning where the notes live
 * it is not. With `wrongNoteGhosts` on (per learner, `sheetmusic.learners`), the
 * played pitch is drawn as a translucent copy of the owed notehead, moved up or
 * down the staff by the number of letter steps between the two pitches, with the
 * ledger lines it needs and a small sharp or flat when the key is a black one.
 *
 * Geometry is taken from the engraving itself, never from a second layout model:
 * a notehead is one staff space tall, so half its height is one staff step, and
 * the owed note's own pitch and clef give where the bottom line is. Everything is
 * inserted as a sibling of the owed note's group, in that group's coordinate space,
 * so a resize or a zoomed viewBox moves the ghost with the score.
 *
 * The pure part (`ghostPlacement`) is what the tests pin; `paintWrongGhost` is the
 * thin DOM step.
 */
import { spellMidi } from '../../../../../../../__capabilities/music-notation/browser/model/spellMidi.js';
import { ledgerLineYs } from '../../../../../../../__capabilities/music-notation/browser/renderers/staffGlyphs.jsx';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Letter-step number of a spelled pitch: C4 = 28, D4 = 29 … */
const diatonic = ({ step, octave }) => octave * 7 + LETTERS.indexOf(step);

/** The bottom line of each clef, as a letter-step number (G clef: E4; F clef: G2; C clef: F3). */
const BOTTOM_LINE = { G: diatonic({ step: 'E', octave: 4 }), F: diatonic({ step: 'G', octave: 2 }), C: diatonic({ step: 'F', octave: 3 }) };

/**
 * Where the ghost goes, relative to the owed notehead's centre.
 * @param {{owedMidi:number, wrongMidi:number, fifths?:number, clef?:string, half:number, headWidth:number}} p
 *   `half` is one staff step (half a line spacing) in SVG units; `clef` is 'G' | 'F' | 'C'.
 * @returns {null|{steps:number, dx:number, dy:number, alter:number, position:number, ledgerYs:number[]}}
 *   `dy`/`dx` move the ghost from the owed head; `ledgerYs` are relative to the owed head's centre.
 *   Null when the pitches are the same (not a mistake).
 */
export function ghostPlacement({ owedMidi, wrongMidi, fifths = 0, clef = 'G', half, headWidth }) {
  if (owedMidi === wrongMidi || !(half > 0)) return null;
  const owed = spellMidi(owedMidi, fifths);
  const wrong = spellMidi(wrongMidi, fifths);
  const steps = diatonic(wrong) - diatonic(owed);
  const bottom = BOTTOM_LINE[clef] ?? BOTTOM_LINE.G;
  // Staff position: 0 is the bottom line, one unit per step (ghostEngraving.js's convention).
  const position = diatonic(wrong) - bottom;
  const owedPosition = diatonic(owed) - bottom;
  // A second or a unison (another accidental) would sit on the owed head: put it beside, touching.
  const dx = Math.abs(steps) <= 1 ? headWidth : 0;
  const dy = -steps * half;
  // The bottom line, measured from the owed head's centre (y grows downward).
  const bottomLineY = owedPosition * half;
  return { steps, dx, dy, alter: wrong.alter, position, ledgerYs: ledgerLineYs(position, bottomLineY, half) };
}

const el = (doc, name, attrs) => {
  const node = doc.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

/**
 * Paint the ghost next to an engraved note. Returns the inserted group (call
 * `.remove()` to clear it), or null when there is nothing to draw.
 * @param {{el: Element, midi: number}} owed The engraved owed note (osmdRender's per-note group).
 * @param {number} wrongMidi
 * @param {{fifths?: number, clef?: string}} [context]
 */
export function paintWrongGhost(owed, wrongMidi, { fifths = 0, clef = 'G' } = {}) {
  const group = owed?.el;
  const parent = group?.parentNode;
  if (!group || !parent || typeof group.getBBox !== 'function') return null;
  const head = group.querySelector?.('.vf-notehead') ?? group;
  let box;
  try { box = head.getBBox(); } catch { return null; }
  if (!box?.height || !box?.width) return null;
  const half = box.height / 2;
  const placed = ghostPlacement({ owedMidi: owed.midi, wrongMidi, fifths, clef, half, headWidth: box.width });
  if (!placed) return null;
  const doc = group.ownerDocument;
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  const ghost = el(doc, 'g', { class: 'piano-note-ghost', 'aria-hidden': 'true', 'data-ghost-midi': wrongMidi });
  const stroke = Math.max(1, half * 0.22);
  const ghostX = centreX + placed.dx;
  for (const y of placed.ledgerYs) {
    ghost.appendChild(el(doc, 'line', {
      class: 'piano-note-ghost__ledger', x1: ghostX - box.width * 0.85, x2: ghostX + box.width * 0.85,
      y1: centreY + y, y2: centreY + y, 'stroke-width': stroke,
    }));
  }
  const copy = head.cloneNode(true);
  copy.removeAttribute?.('id');
  const shifted = el(doc, 'g', { class: 'piano-note-ghost__head', transform: `translate(${placed.dx} ${placed.dy})` });
  shifted.appendChild(copy);
  ghost.appendChild(shifted);
  if (placed.alter) {
    // A hand-drawn sharp or flat: Unicode music glyphs render as tofu on the kiosk.
    const x = ghostX - box.width * 1.15;
    const y = centreY + placed.dy;
    const h = half * 2.6;
    const d = placed.alter > 0
      ? `M${x - half * 0.3} ${y - h / 2} V${y + h / 2} M${x + half * 0.3} ${y - h / 2 - half * 0.2} V${y + h / 2 - half * 0.2}`
        + ` M${x - half * 0.75} ${y - half * 0.35} L${x + half * 0.75} ${y - half * 0.75} M${x - half * 0.75} ${y + half * 0.55} L${x + half * 0.75} ${y + half * 0.15}`
      : `M${x - half * 0.4} ${y - h * 0.7} V${y + half * 0.6} Q${x + half * 0.9} ${y - half * 0.2} ${x - half * 0.4} ${y + half * 0.6}`;
    ghost.appendChild(el(doc, 'path', { class: 'piano-note-ghost__accidental', d, fill: 'none', 'stroke-width': stroke }));
  }
  parent.insertBefore(ghost, group.nextSibling);
  return ghost;
}
