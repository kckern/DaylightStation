/**
 * One note, drawn on its staff — a rim label for the reading vocabulary.
 *
 * These sit in the board's margin, eight down the left and eight across the
 * bottom, at maybe a centimetre each on the kiosk. That rules out a real
 * engraver: it is five lines, a notehead, and ledger lines where the note has
 * left the staff, drawn as SVG paths so nothing depends on a music font being
 * present (the kiosk WebView renders missing glyphs as tofu, which would turn
 * the whole axis into boxes).
 *
 * No clef glyph. The axis carries it — ranks are always bass, files are always
 * treble — and a clef legible at this size would crowd out the note it
 * qualifies. The rail names the two staves in words once, which is where a
 * player learning the board looks anyway.
 */

/** Diatonic step of a MIDI note above the bottom line of its staff. */
export function staffStep(midi, clef) {
  const DIATONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // C D E F G A B, sharps share
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const absolute = octave * 7 + DIATONIC[pc];
  // Bottom lines: treble E4, bass G2.
  const bottom = clef === 'bass' ? 2 * 7 + 4 : 4 * 7 + 2;
  return absolute - bottom;
}

const LINE_GAP = 6;      // px between staff lines in viewBox units
const STAFF_TOP = 4;     // y of the top line
const HEIGHT = STAFF_TOP + LINE_GAP * 4 + 4;

export function StaffNoteLabel({ midi, clef = 'treble', width = 26 }) {
  const step = staffStep(midi, clef);
  // Step 0 is the bottom line; each step is half a gap, upward.
  const y = STAFF_TOP + LINE_GAP * 4 - (step * LINE_GAP) / 2;
  const lines = [0, 1, 2, 3, 4].map((index) => STAFF_TOP + index * LINE_GAP);

  // Ledger lines for anything at or beyond one step outside the staff, on the
  // even (line) positions only — a note in a space needs the ledger below it.
  const ledgers = [];
  for (let s = -2; s >= step; s -= 2) ledgers.push(STAFF_TOP + LINE_GAP * 4 - (s * LINE_GAP) / 2);
  for (let s = 10; s <= step; s += 2) ledgers.push(STAFF_TOP + LINE_GAP * 4 - (s * LINE_GAP) / 2);

  const cx = width / 2;
  return (
    <svg
      className="chess-staff-label"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      width={width}
      height={HEIGHT}
      role="img"
      aria-label={`${clef} clef note`}
      focusable="false"
    >
      {lines.map((lineY) => (
        <line key={lineY} x1="1" x2={width - 1} y1={lineY} y2={lineY} className="chess-staff-label__line" />
      ))}
      {ledgers.map((ledgerY) => (
        <line key={`l${ledgerY}`} x1={cx - 5} x2={cx + 5} y1={ledgerY} y2={ledgerY} className="chess-staff-label__ledger" />
      ))}
      <ellipse cx={cx} cy={y} rx="3.6" ry="2.7" className="chess-staff-label__head" transform={`rotate(-18 ${cx} ${y})`} />
    </svg>
  );
}

export default StaffNoteLabel;
