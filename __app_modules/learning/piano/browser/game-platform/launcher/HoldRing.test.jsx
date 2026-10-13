import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HoldRing from './HoldRing.jsx';

describe('HoldRing', () => {
  it('sweeps an arc over the hold window', () => {
    const { container } = render(<HoldRing holdMs={2000} />);
    expect(container.querySelector('.nl-hold')).toBeTruthy();
    // The duration rides the ARC, which is the element that animates. It used to
    // be a conic-gradient driven by an @property angle; where that registration
    // does not take the gradient cannot animate at all, and the ring showed as a
    // solid dark disc for the whole hold and then vanished.
    const arc = container.querySelector('.nl-hold__arc');
    expect(arc).toBeTruthy();
    expect(arc.style.animationDuration).toBe('2000ms');
  });

  it('draws a track behind the arc, so a part-filled ring reads as a fraction', () => {
    const { container } = render(<HoldRing />);
    expect(container.querySelector('.nl-hold__track')).toBeTruthy();
  });

  it('says what holding does', () => {
    const { container } = render(<HoldRing />);
    expect(container.textContent).toContain('HOLD TO QUIT');
  });

  it('is decorative — it carries no accessible name', () => {
    const { container } = render(<HoldRing />);
    expect(container.querySelector('.nl-hold').getAttribute('aria-hidden')).toBe('true');
  });
});
