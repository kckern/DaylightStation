import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LifeMeter, MomentBanner } from './index.js';
import { LifeMeter as ChromeLifeMeter } from '../../../../../../__app_modules/learning/piano/browser/game-platform/chrome/index.js';

describe('LifeMeter', () => {
  it('renders notches and rounds partial health up', () => {
    const { container } = render(<LifeMeter current={27.5} maximum={28} />);
    expect(container.querySelectorAll('.game-hud-life__notch')).toHaveLength(28);
    expect(container.querySelectorAll('.is-active')).toHaveLength(28);
    expect(container.firstChild.getAttribute('aria-valuenow')).toBe('28');
    expect(container.firstChild.getAttribute('role')).toBe('meter');
  });
  it('clamps negative health to zero', () => {
    const { container } = render(<LifeMeter current={-3} maximum={28} />);
    expect(container.querySelectorAll('.is-active')).toHaveLength(0);
    expect(container.firstChild.getAttribute('aria-valuenow')).toBe('0');
  });
  it('marks danger at or below dangerAt', () => {
    const low = render(<LifeMeter current={7} maximum={28} />);
    expect(low.container.querySelectorAll('.is-danger')).toHaveLength(7);
    const ok = render(<LifeMeter current={8} maximum={28} />);
    expect(ok.container.querySelectorAll('.is-danger')).toHaveLength(0);
  });
  it('renders glyphs', () => {
    const { container } = render(<LifeMeter variant="glyphs" current={3} ariaLabel="3 hearts left" />);
    expect(container.textContent).toBe('♥♥♥');
    expect(container.querySelector('[aria-label="3 hearts left"]')).not.toBeNull();
    const empty = render(<LifeMeter variant="glyphs" current={0} ariaLabel="none" />);
    expect(empty.container.textContent).toBe('♡');
  });
});

describe('MomentBanner', () => {
  it('announces text and replaces its node when the key changes', () => {
    const { getByRole, rerender } = render(<MomentBanner text="Checkpoint 2" momentKey="a" />);
    const first = getByRole('status');
    expect(first.textContent).toBe('Checkpoint 2');
    rerender(<MomentBanner text="Checkpoint 2" momentKey="b" />);
    expect(getByRole('status')).not.toBe(first);
  });
  it('renders nothing without text or title', () => {
    const { container } = render(<MomentBanner momentKey="a" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('piano chrome re-export', () => {
  it('is the kit LifeMeter', () => {
    expect(ChromeLifeMeter).toBe(LifeMeter);
  });
});
