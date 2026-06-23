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
});
