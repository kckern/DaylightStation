import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SvgStaffRenderer, ACCIDENTAL_WIDTH, ACCIDENTAL_HEIGHT } from './SvgStaffRenderer.jsx';
import { clefRightEdge, NOTEHEAD_RX } from './staffGlyphs.jsx';

const translateX = (el) => Number(/translate\(([-\d.]+)/.exec(el.getAttribute('transform'))[1]);

/**
 * The x of the column most noteheads share.
 *
 * Absolute x is no longer a constant: a group whose leftmost ink would land on
 * the clef shifts right to clear it, which is the point of the clef-clearance
 * rule. Tests about stems and displacement therefore ask where the heads
 * actually are rather than asserting a number that was only ever true for
 * chords that happened not to need the shift.
 */
const mainColumnX = (container) => {
  const counts = new Map();
  for (const note of container.querySelectorAll('.action-staff__note')) {
    const cx = Number(note.getAttribute('cx'));
    counts.set(cx, (counts.get(cx) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
};
const stemX = (container) => Number(container.querySelector('.action-staff__stem').getAttribute('x1'));
const noteXs = (container) => [...container.querySelectorAll('.action-staff__note')]
  .map((n) => Number(n.getAttribute('cx')));

describe('SvgStaffRenderer', () => {
  it('renders the staff area with five staff lines', () => {
    const { container } = render(<SvgStaffRenderer targetPitches={[60, 64, 67]} />);
    expect(container.querySelector('.action-staff__staff-area')).toBeTruthy();
    expect(container.querySelectorAll('.action-staff__lines-svg line')).toHaveLength(5);
  });

  it('renders a notehead per target pitch', () => {
    const { container } = render(<SvgStaffRenderer targetPitches={[60, 64, 67]} />);
    expect(container.querySelectorAll('.action-staff__note')).toHaveLength(3);
  });

  it('handles an empty target set without throwing', () => {
    const { container } = render(<SvgStaffRenderer targetPitches={[]} />);
    expect(container.querySelector('.action-staff__staff-area')).toBeTruthy();
    expect(container.querySelectorAll('.action-staff__note')).toHaveLength(0);
  });

  it('renders ghost notes for pressed keys not in the target set', () => {
    const active = new Map([[62, { velocity: 80 }]]); // D4, not a target
    const { container } = render(
      <SvgStaffRenderer targetPitches={[60]} activeNotes={active} />
    );
    expect(container.querySelectorAll('.action-staff__ghost')).toHaveLength(1);
  });

  // The MIDI providers hand over a Map; a host that has already split the held
  // set by axis has a plain array, and making it build a throwaway Map per
  // render to be let in is a tax on the rim, where sixteen cards each take a
  // slice of the same held set.
  it.each([
    ['a Map', new Map([[62, { velocity: 80 }]])],
    ['a Set', new Set([62])],
    ['an array', [62]],
  ])('accepts pressed notes as %s', (_label, active) => {
    const { container } = render(
      <SvgStaffRenderer targetPitches={[60]} activeNotes={active} />
    );
    expect(container.querySelectorAll('.action-staff__ghost')).toHaveLength(1);
  });

  it('does not ghost a pressed key that is already a target', () => {
    const { container } = render(
      <SvgStaffRenderer targetPitches={[60, 64]} activeNotes={[60]} />
    );
    expect(container.querySelectorAll('.action-staff__ghost')).toHaveLength(0);
  });

  it('skips a pressed key that is off this staff entirely', () => {
    // C2 on a treble staff: far below the -3 floor, so drawing it would push
    // ink outside the card's own viewBox and say nothing about the target.
    const { container } = render(
      <SvgStaffRenderer targetPitches={[72]} activeNotes={[36]} />
    );
    expect(container.querySelectorAll('.action-staff__ghost')).toHaveLength(0);
  });

  it('gives a ghost below the staff its ledger lines', () => {
    // C4 on a staff whose target is high enough to be treble-clef: one ledger.
    const { container } = render(
      <SvgStaffRenderer targetPitches={[72]} activeNotes={[60]} />
    );
    const ghost = container.querySelector('.action-staff__ghost');
    expect(ghost.querySelectorAll('line').length).toBeGreaterThan(0);
  });

  it('ghosts share the noteheads column so the comparison is vertical', () => {
    const { container } = render(
      <SvgStaffRenderer targetPitches={[60]} activeNotes={[62]} />
    );
    const ink = container.querySelector('.action-staff__note');
    const ghost = container.querySelector('.action-staff__ghost ellipse');
    expect(ghost.getAttribute('cx')).toBe(ink.getAttribute('cx'));
  });

  // Stem rules are shared with wet ink (MusicNotation/model/stems.js): the
  // notehead farthest from the middle line decides, and a middle-line note
  // stems DOWN — engraving convention, the opposite of the old avg<=4 rule.
  it('a middle-line note (B4) stems DOWN, matching wet ink', () => {
    const { container } = render(<SvgStaffRenderer targetPitches={[71]} />);
    expect(container.querySelector('.action-staff__stem').getAttribute('x1')).toBe('57'); // baseX - 8 = down
  });

  it('a low note (E4) stems UP', () => {
    const { container } = render(<SvgStaffRenderer targetPitches={[64]} />);
    expect(container.querySelector('.action-staff__stem').getAttribute('x1')).toBe('73'); // baseX + 8 = up
  });

  it('the farthest-from-middle notehead decides a chord, not the average', () => {
    // Positions 2/3/6: avg 3.67 (old rule → up); farthest is 6, two above the
    // middle line (correct rule → down).
    const { container } = render(<SvgStaffRenderer targetPitches={[67, 69, 74]} />);
    expect(stemX(container)).toBe(mainColumnX(container) - 8); // left of the heads = down
  });

  // ── Noteheads across the stem (model/chordLayout.js) ───────────────────────
  // A second cannot share a column, and the head that steps aside steps ACROSS
  // THE STEM — never to the empty side, which leaves it floating away from the
  // chord with a gap where the stem should be. Both halves of this rule were
  // inverted, so in a triad it read as the MIDDLE note having wandered off.

  it('an up-stem chord displaces the UPPER note of a second to the right', () => {
    // C4/D4/G4 → positions -2/-1/2. Farthest from the middle line is -2, below
    // it, so the group stems UP and the stem is on the right.
    const { container } = render(<SvgStaffRenderer targetPitches={[60, 62, 67]} />);
    const xs = noteXs(container); // ascending pitch order is the render order
    const main = mainColumnX(container);
    expect(stemX(container)).toBe(main + 8);   // stem on the right
    expect(xs[0]).toBe(main);                  // C4 stays in the column
    expect(xs[1]).toBeGreaterThan(main);       // D4, the upper of the second, crosses it
    expect(xs[2]).toBe(main);
  });

  it('a down-stem chord displaces the LOWER note of a second to the left', () => {
    const { container } = render(<SvgStaffRenderer targetPitches={[67, 69, 74]} />);
    const xs = noteXs(container);
    const main = mainColumnX(container);
    expect(stemX(container)).toBe(main - 8);   // stem on the left
    expect(xs[0]).toBeLessThan(main);          // G4, the lower of the second, crosses it
    expect(xs[1]).toBe(main);
    expect(xs[2]).toBe(main);
  });

  it('keeps the group clear of the clef when a head or accidental would reach it', () => {
    // A down-stem chord displaces a head a full notehead-width left, which at
    // the nominal column puts it inside the clef's box. The group shifts.
    const { container } = render(<SvgStaffRenderer targetPitches={[67, 69, 74]} />);
    expect(Math.min(...noteXs(container)) - NOTEHEAD_RX)
      .toBeGreaterThanOrEqual(clefRightEdge(14) - 0.01);
  });

  // ── Accidentals ────────────────────────────────────────────────────────────
  // Sharps/flats must read as PART of the note: drawn SVG shapes (never a
  // font-dependent Unicode <text>, which renders thin/small and with
  // unpredictable metrics on the kiosk WebView), sized against the staff, and
  // placed with clear margin so they never overlap the notehead.

  it('a black-key target draws its accidental as shapes, never as <text>', () => {
    const { container } = render(<SvgStaffRenderer targetPitches={[61]} />); // C#4/Db4
    const acc = container.querySelector('.action-staff__accidental');
    expect(acc).toBeTruthy();
    expect(acc.querySelector('text')).toBeNull();
    expect(acc.querySelectorAll('path, line, rect, polygon').length).toBeGreaterThan(0);
    // The only <text> left in the notation svg is the clef glyph.
    expect(container.querySelectorAll('.action-staff__notation-svg text')).toHaveLength(1);
  });

  it('the accidental clears the notehead by a real margin (no overlap)', () => {
    const { container } = render(<SvgStaffRenderer targetPitches={[61]} />);
    const acc = container.querySelector('.action-staff__accidental');
    const note = container.querySelector('.action-staff__note');
    const noteLeftEdge = Number(note.getAttribute('cx')) - Number(note.getAttribute('rx'));
    const accRightEdge = translateX(acc) + ACCIDENTAL_WIDTH / 2;
    expect(accRightEdge).toBeLessThanOrEqual(noteLeftEdge - 2);
  });

  it('the accidental is sized to the staff, not a token glyph', () => {
    // Notehead is 13 units tall (ry 6.5); a legible accidental spans well past
    // it — at least 1.6 staff spaces tall and wider than half a notehead.
    expect(ACCIDENTAL_HEIGHT).toBeGreaterThanOrEqual(22);
    expect(ACCIDENTAL_WIDTH).toBeGreaterThanOrEqual(9);
  });

  it('two accidentals in a chord stagger into separate columns', () => {
    const { container } = render(<SvgStaffRenderer targetPitches={[61, 66]} />); // C#4 + F#4
    const accs = container.querySelectorAll('.action-staff__accidental');
    expect(accs).toHaveLength(2);
    expect(translateX(accs[0])).not.toBe(translateX(accs[1]));
  });

  it('the accidental tints with the note when matched', () => {
    const { container } = render(<SvgStaffRenderer targetPitches={[61]} matched />);
    const acc = container.querySelector('.action-staff__accidental');
    expect(acc.getAttribute('class')).toContain('action-staff__accidental--matched');
  });
});
