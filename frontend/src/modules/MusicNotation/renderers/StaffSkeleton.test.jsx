import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import StaffSkeleton from './StaffSkeleton.jsx';

describe('StaffSkeleton', () => {
  it('renders shimmer stave bands, aria-hidden', () => {
    const { container } = render(<StaffSkeleton systems={3} />);
    const root = container.querySelector('.staff-skeleton');
    expect(root).toBeTruthy();
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('.staff-skeleton__system')).toHaveLength(3);
    // each system draws 5 staff lines
    expect(container.querySelectorAll('.staff-skeleton__system:first-child .staff-skeleton__line')).toHaveLength(5);
  });

  it('defaults to 4 systems when unspecified', () => {
    const { container } = render(<StaffSkeleton />);
    expect(container.querySelectorAll('.staff-skeleton__system')).toHaveLength(4);
  });
});
