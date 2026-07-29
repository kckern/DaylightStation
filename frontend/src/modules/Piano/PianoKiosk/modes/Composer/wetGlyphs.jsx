// wetGlyphs.jsx — hand-drawn SVG note glyph shared by every "wet ink" surface
// (Composer's PendingLayer today; LearnInk later). Extracted from
// PendingLayer.jsx (wave-3 D prep) so the geometry lives in one place instead
// of being copy-pasted per surface.
//
// Glyphs are hand-drawn SVG, never Unicode music characters — U+266F/U+266D and
// the U+1D15x note glyphs render as tofu in the kiosk's browser. Same rule and
// reason as DurationPalette.jsx.

const STEP_DIATONIC = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

// Absolute diatonic index, matching MusicNotation/model/pitch.js's convention
// (C4 = 28, E4 = 30).
const absDiatonic = ({ step, octave }) => octave * 7 + (STEP_DIATONIC[step] ?? 0);

// Bottom staff line as an absolute diatonic index: treble = E4 (30), bass = G2
// (18) — the same constants pitch.js uses.
const bottomLineDiatonic = (clef) => (clef?.sign === 'F' ? 18 : 30);

/**
 * Staff HALF-STEPS above the bottom line: 0 = bottom line, 1 = the space above
 * it, 2 = the next line up; negative = below the staff.
 *
 * Deliberately NOT routed through pitch.js's getStaffPosition(midiNote), for two
 * reasons. (1) That helper picks the clef FROM the pitch (absDiatonic >= 28 →
 * treble), but the Composer is a fixed-clef staff — anything a left hand plays
 * would be measured against a bass staff bottom line while the engraving shows
 * treble. (2) Going pitch → MIDI → position throws away the spelling the model
 * already stores: C#4 and Db4 are one MIDI number but two different staff lines,
 * and the helper would re-guess between them. `step` is both simpler and right.
 */
export const staffPositionOf = (pitch, clef) => absDiatonic(pitch) - bottomLineDiatonic(clef);

// Wet-ink glyph geometry, in staff-line-spacing units (the engraving zoom
// varies, so nothing here can be a pixel constant). Notehead proportions come
// from DurationPalette's NoteGlyph (rx 5 / ry 3.4), rescaled.
//
// EXPORTED because EditorSurface must agree with them: it computes `anchorX`
// (where note 0 paints) and the wet caret position (which clears the LAST
// note's right edge) from the same numbers. Tuning note spacing here without
// them would silently drift the anchor and the caret off the glyphs.
export const WET_ADVANCE_UNITS = 2.4; // note centre → next note centre
export const WET_RX_UNITS = 0.62;     // notehead half-width

const MIDDLE_LINE = 4; // position of the centre staff line — the stem-flip point
const TOP_LINE = 8; // 5 lines, so the top line is 8 half-steps up

/**
 * Renders one note glyph (ledger lines, stem, accidental, notehead, dots) as a
 * flat list of SVG children — no wrapping <g>, so callers can drop the output
 * directly into their own <svg> alongside rests or other markup.
 */
export function WetNoteGlyph({ x, staff, pitch, clef, type = 'quarter', dots = 0, classPrefix = 'composer-wet-note', className = '' }) {
  const { top, lineSpacing } = staff;
  const half = lineSpacing / 2;
  // `top` is the TOP line; five lines with four gaps put the bottom line 4 spaces down.
  const bottomLineY = top + lineSpacing * 4;
  const yFor = (position) => bottomLineY - position * half;

  const rx = lineSpacing * WET_RX_UNITS;
  const ry = lineSpacing * 0.42;
  const stemLen = lineSpacing * 3.5;

  const position = staffPositionOf(pitch || {}, clef);
  const y = yFor(position);
  const hollow = type === 'half' || type === 'whole';
  const prefixClass = (suffix) => (className ? `${classPrefix}__${suffix} ${className}` : `${classPrefix}__${suffix}`);

  const glyphs = [];

  // Ledger lines, one per line position beyond the staff, above and below. Kids
  // hit this immediately — middle C is position -2 on a treble staff.
  const ledgers = [];
  for (let p = -2; p >= position; p -= 2) ledgers.push(p);
  for (let p = TOP_LINE + 2; p <= position; p += 2) ledgers.push(p);
  const ledgerHalfWidth = rx * 1.6; // extends a little past the notehead
  ledgers.forEach((p) => {
    glyphs.push(
      <line
        key={`ledger-${p}`}
        className={prefixClass('ledger')}
        x1={x - ledgerHalfWidth}
        y1={yFor(p)}
        x2={x + ledgerHalfWidth}
        y2={yFor(p)}
        stroke="currentColor"
        strokeWidth={Math.max(1, lineSpacing * 0.1)}
      />
    );
  });

  // Stem up on the right below the middle line, down on the left at or above
  // it — standard engraving, and it keeps high notes from running off the top
  // of the system.
  if (type !== 'whole') {
    const up = position < MIDDLE_LINE;
    const stemX = up ? x + rx * 0.92 : x - rx * 0.92;
    glyphs.push(
      <line
        key="stem"
        className={prefixClass('stem')}
        x1={stemX}
        y1={y}
        x2={stemX}
        y2={up ? y - stemLen : y + stemLen}
        stroke="currentColor"
        strokeWidth={Math.max(1, lineSpacing * 0.12)}
        strokeLinecap="round"
      />
    );
  }

  if (pitch?.alter) glyphs.push(accidental(pitch.alter, x - rx * 2.6, y, lineSpacing, classPrefix, className));

  glyphs.push(
    <ellipse
      key="head"
      className={prefixClass('head')}
      cx={x}
      cy={y}
      rx={rx}
      ry={ry}
      transform={`rotate(-20 ${x} ${y})`}
      fill={hollow ? 'none' : 'currentColor'}
      stroke="currentColor"
      strokeWidth={hollow ? Math.max(1, lineSpacing * 0.17) : 0}
    />
  );

  if (dots) {
    glyphs.push(
      <circle
        key="dot"
        className={prefixClass('dot')}
        cx={x + rx * 1.8}
        // A dot sits in the space, so nudge it off a line note.
        cy={position % 2 === 0 ? y - half : y}
        r={lineSpacing * 0.15}
        fill="currentColor"
      />
    );
  }

  return glyphs;
}

// Sharp = two verticals crossed by two rising strokes; flat = a stem with a bowl.
// Drawn geometry rather than ♯/♭ characters, per the no-Unicode-glyph rule above.
function accidental(alter, x, y, lineSpacing, classPrefix, className) {
  const s = lineSpacing;
  const w = Math.max(1, s * 0.11);
  const common = { stroke: 'currentColor', strokeWidth: w, strokeLinecap: 'round' };
  const accClass = className ? `${classPrefix}__acc ${className}` : `${classPrefix}__acc`;
  if (alter > 0) {
    return (
      <g key="acc" className={accClass} data-acc="sharp">
        <line x1={x - s * 0.16} y1={y - s * 0.7} x2={x - s * 0.16} y2={y + s * 0.62} {...common} />
        <line x1={x + s * 0.16} y1={y - s * 0.78} x2={x + s * 0.16} y2={y + s * 0.54} {...common} />
        <line x1={x - s * 0.36} y1={y - s * 0.06} x2={x + s * 0.36} y2={y - s * 0.24} {...common} />
        <line x1={x - s * 0.36} y1={y + s * 0.36} x2={x + s * 0.36} y2={y + s * 0.18} {...common} />
      </g>
    );
  }
  return (
    <g key="acc" className={accClass} data-acc="flat">
      <line x1={x - s * 0.2} y1={y - s * 0.95} x2={x - s * 0.2} y2={y + s * 0.4} {...common} />
      <path
        d={`M ${x - s * 0.2} ${y - s * 0.08} q ${s * 0.55} ${-s * 0.34} ${s * 0.44} ${s * 0.24} q ${-s * 0.08} ${s * 0.26} ${-s * 0.44} ${s * 0.24}`}
        fill="none"
        {...common}
      />
    </g>
  );
}
