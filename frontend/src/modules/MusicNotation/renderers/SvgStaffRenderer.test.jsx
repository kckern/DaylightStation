import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SvgStaffRenderer, ACCIDENTAL_WIDTH, ACCIDENTAL_HEIGHT } from './SvgStaffRenderer.jsx';

const translateX = (el) => Number(/translate\(([-\d.]+)/.exec(el.getAttribute('transform'))[1]);

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
    // Ghost ellipses use a 0.5 opacity attribute.
    const ghosts = [...container.querySelectorAll('ellipse')].filter(
      (e) => e.getAttribute('opacity') === '0.5'
    );
    expect(ghosts).toHaveLength(1);
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
    expect(container.querySelector('.action-staff__stem').getAttribute('x1')).toBe('57');
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
