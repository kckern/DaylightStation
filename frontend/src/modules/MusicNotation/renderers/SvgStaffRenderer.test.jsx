import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SvgStaffRenderer } from './SvgStaffRenderer.jsx';

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
});
