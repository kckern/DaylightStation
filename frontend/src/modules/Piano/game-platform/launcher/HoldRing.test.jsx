import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HoldRing from './HoldRing.jsx';

describe('HoldRing', () => {
  it('renders a ring that fills over the hold window', () => {
    const { container } = render(<HoldRing holdMs={2000} />);
    const ring = container.querySelector('.nl-hold');
    expect(ring).toBeTruthy();
    expect(ring.style.animationDuration).toBe('2000ms');
  });

  it('is decorative — it carries no accessible name', () => {
    const { container } = render(<HoldRing />);
    expect(container.querySelector('.nl-hold').getAttribute('aria-hidden')).toBe('true');
  });
});
