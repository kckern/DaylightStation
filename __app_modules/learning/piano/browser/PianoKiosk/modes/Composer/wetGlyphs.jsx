// wetGlyphs.jsx — hand-drawn SVG note glyph shared by every "wet ink" surface
// (Composer's PendingLayer today; LearnInk later). Extracted from
// PendingLayer.jsx (wave-3 D prep) so the geometry lives in one place instead
// of being copy-pasted per surface.
//
// Glyphs are hand-drawn SVG, never Unicode music characters — U+266F/U+266D and
// the U+1D15x note glyphs render as tofu in the kiosk's browser. Same rule and
// reason as DurationPalette.jsx.

import { staffPositionOf, WET_RX_UNITS, stemDirectionFor, stemLengthUnits } from './wetGlyphGeometry.js';

const TOP_LINE = 8; // 5 lines, so the top line is 8 half-steps up

// Flags per note value. Without these a classified eighth (task 27 assigns
// 'eighth'/'16th' from held time) is pixel-identical to a quarter, so the
// classification is invisible to the kid it was built for. Hand-drawn SVG only —
// the U+1D15x glyphs are tofu on the kiosk.
const flagCountFor = (type) => (type === 'eighth' ? 1 : type === '16th' ? 2 : 0);

/**
 * Renders one note glyph (ledger lines, stem, flags, accidental, notehead, dots)
 * as a flat list of SVG children — no wrapping <g>, so callers can drop the
 * output directly into their own <svg> alongside rests or other markup.
 *
 * @param {'up'|'down'} [stemDirection] - overrides the per-note rule. Callers
 *   that render a SIMULTANEITY pass the group's direction (stemDirectionFor of
 *   every member's position) so a chord's stems agree; callers rendering
 *   independent events (LearnInkLayer) omit it and get the per-note rule.
 */
export function WetNoteGlyph({ x, staff, pitch, clef, type = 'quarter', dots = 0, stemDirection = null, classPrefix = 'composer-wet-note', className = '' }) {
  const { top, lineSpacing } = staff;
  const half = lineSpacing / 2;
  // `top` is the TOP line; five lines with four gaps put the bottom line 4 spaces down.
  const bottomLineY = top + lineSpacing * 4;
  const yFor = (position) => bottomLineY - position * half;

  const rx = lineSpacing * WET_RX_UNITS;
  const ry = lineSpacing * 0.42;

  const position = staffPositionOf(pitch || {}, clef);
  const y = yFor(position);
  const direction = stemDirection === 'up' || stemDirection === 'down' ? stemDirection : stemDirectionFor([position]);
  const stemLen = lineSpacing * stemLengthUnits(position, direction);
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

  // Stem up on the right, down on the left; which one comes from `direction`
  // (per-note rule, or the group's direction when a caller passed one). Length
  // is 3.5 spaces except for far-ledgered notes, which reach the middle line.
  if (type !== 'whole') {
    const up = direction === 'up';
    const stemX = up ? x + rx * 0.92 : x - rx * 0.92;
    const tipY = up ? y - stemLen : y + stemLen;
    const stroke = Math.max(1, lineSpacing * 0.12);
    glyphs.push(
      <line
        key="stem"
        className={prefixClass('stem')}
        x1={stemX}
        y1={y}
        x2={stemX}
        y2={tipY}
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    );

    // Flags hang off the stem TIP and always curl to the RIGHT of the stem,
    // back toward the notehead — the same shape for up and down stems, mirrored
    // in y. Proportions rescaled from DurationPalette's NoteGlyph so the toolbar
    // and the staff draw the same eighth.
    const s = up ? 1 : -1; // +y is "toward the notehead" for an up stem
    for (let f = 0; f < flagCountFor(type); f++) {
      const startY = tipY + s * lineSpacing * 0.45 * f;
      glyphs.push(
        <path
          key={`flag-${f}`}
          className={prefixClass('flag')}
          d={`M ${stemX} ${startY} q ${lineSpacing * 0.68} ${s * lineSpacing * 0.27} ${lineSpacing * 0.45} ${s * lineSpacing * 0.92}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      );
    }
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
