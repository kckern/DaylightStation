import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ProgressRing from './ProgressRing.jsx';

describe('ProgressRing', () => {
  it('renders the label and clamps percent into the --p custom property', () => {
    const { container } = render(<ProgressRing percent={140} label="2/6" />);
    const el = container.querySelector('.psc-ring');
    expect(el.style.getPropertyValue('--p')).toBe('100');
    expect(el.textContent).toContain('2/6');
  });
  it('shows a check and the done modifier when done', () => {
    const { container } = render(<ProgressRing done percent={100} />);
    const el = container.querySelector('.psc-ring');
    expect(el.className).toContain('is-done');
    expect(el.textContent).toContain('✓');
  });
});
