// wrongNoteGhost.js — where the note you ACTUALLY played goes on the card game's
// staff, so a wrong note says "you played THIS" and not merely "not that".
//
// The red mark on the expected notehead only ever states which note was owed. A
// kid who plays G for F sees the F flash red and has to work out, unaided, what
// they hit instead. Drawing the played pitch as a ghost next to it turns the
// correction into a comparison you can read off the staff: two noteheads, one
// engraved and one faint, the distance between them being the mistake.
//
// Nothing here touches the DOM. The layer measures; this module decides.

import { spellMidi } from '../../../MusicNotation/model/spellMidi.js';
import { KEY_SIGNATURES } from '../../../MusicNotation/model/keySignature.js';

// Only the two clefs WetNoteGlyph can place a pitch on (it knows a treble and a
// bass bottom line, nothing else). An alto or percussion staff returns null and
// the ghost is simply not drawn — a notehead on the wrong line is worse than no
// notehead at all, and the red mark still names the note that was owed.
const CLEF_SIGN = { treble: 'G', bass: 'F' };

/**
 * abcjs clef type → the clef sign WetNoteGlyph expects. Octave-transposing
 * variants ('treble-8', 'bass+8') engrave on the SAME lines as their base clef,
 * so they resolve to the same sign.
 */
export function clefSignFor(clefType) {
  if (typeof clefType !== 'string') return null;
  return CLEF_SIGN[clefType.split(/[+-]/)[0].trim()] || null;
}

/** The clef of the first engraved staff in an abcjs tune, or null. */
export function scaleClefType(tune) {
  const line = (tune?.lines || []).find((l) => Array.isArray(l.staff) && l.staff.length);
  return line?.staff?.[0]?.clef?.type ?? null;
}

/**
 * Key name ('D', 'Bb') → fifths, so the ghost is SPELLED in the exercise's key:
 * a wrong C♯ in D major must be written as C♯ and not D♭, or the ghost lands a
 * staff line away from the note the player's finger was actually on.
 */
export function fifthsForKeyName(name) {
  const key = KEY_SIGNATURES[name];
  if (!key) return 0; // unknown/modal name — spell with sharps rather than refuse
  if (key.sharps.length) return key.sharps.length;
  if (key.flats.length) return -key.flats.length;
  return 0; // C major — written out so an empty key signature is +0, never -0
}

/**
 * Staff geometry from the rendered staff LINES, never from the containing group's
 * box. abcjs strokes the lines with real thickness, so a group box overstates the
 * span by one stroke width — about a quarter of a step per space, which walks a
 * ledger-line pitch visibly off its line. Line CENTRES are exact.
 *
 * @param {Array<{top:number, height:number}>} lineRects - the 5 staff-line rects
 * @param {number} [originY=0] - y of the coordinate space to report in (the
 *   overlay's own box), subtracted from the result
 * @returns {{top:number, lineSpacing:number}|null} top = TOP line's centre
 */
export function staffMetrics(lineRects, originY = 0) {
  if (!Array.isArray(lineRects) || lineRects.length < 2) return null;
  const centres = lineRects
    .filter((r) => r && Number.isFinite(r.top) && Number.isFinite(r.height))
    .map((r) => r.top + r.height / 2)
    .sort((a, b) => a - b);
  if (centres.length < 2) return null;
  const lineSpacing = (centres[centres.length - 1] - centres[0]) / (centres.length - 1);
  if (!(lineSpacing > 0)) return null;
  return { top: centres[0] - originY, lineSpacing };
}

// How far right of the expected note the ghost sits, in staff spaces. Enough to
// clear the notehead (and its stem) so the two are legibly separate, close
// enough that they read as one comparison rather than two events. A same-line
// mistake (F vs F♯) would otherwise sit exactly on top of the red mark.
export const GHOST_GAP_SPACES = 0.9;

/**
 * Everything the ghost layer needs to draw, or null when it cannot be placed
 * honestly. Callers pass DOM measurements; the geometry decisions live here.
 *
 * @param {object} p
 * @param {number} p.midi - the pitch that was actually played
 * @param {string} p.clefType - abcjs clef type of the engraved staff
 * @param {string} [p.keyName] - the exercise's key signature name
 * @param {{right:number}} p.anchorRect - box of the expected note's element
 * @param {{left:number, top:number}} p.originRect - box of the overlay
 * @param {Array<{top:number, height:number}>} p.lineRects - staff-line boxes
 */
export function ghostPlacement({ midi, clefType, keyName, anchorRect, originRect, lineRects }) {
  const sign = clefSignFor(clefType);
  if (!sign || !Number.isFinite(midi) || !anchorRect || !originRect) return null;
  const metrics = staffMetrics(lineRects, originRect.top);
  if (!metrics) return null;
  return {
    x: anchorRect.right - originRect.left + metrics.lineSpacing * GHOST_GAP_SPACES,
    staff: { top: metrics.top, lineSpacing: metrics.lineSpacing },
    clef: { sign },
    pitch: spellMidi(midi, fifthsForKeyName(keyName)),
  };
}

export default ghostPlacement;
