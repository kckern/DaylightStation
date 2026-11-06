import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LifeMeter, MomentBanner } from './index.js';

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
    expect(container.querySelector('[aria-label="3 hearts left"]').getAttribute('role')).toBe('img');
    const empty = render(<LifeMeter variant="glyphs" current={0} ariaLabel="none" />);
    expect(empty.container.textContent).toBe('♡');
  });
  it('names a glyph meter even without ariaLabel', () => {
    const { container } = render(<LifeMeter variant="glyphs" current={2} label="hearts" />);
    const img = container.querySelector('[role="img"]');
    expect(img.getAttribute('aria-label')).toBe('2 hearts');
    const below = render(<LifeMeter variant="glyphs" current={-1} />);
    expect(below.container.querySelector('[role="img"]').getAttribute('aria-label')).toBe('0 Health');
  });
});

describe('MomentBanner', () => {
  it('announces text and replaces its node when the key changes', () => {
    const { getByRole, container, rerender } = render(<MomentBanner text="Checkpoint 2" momentKey="a" />);
    const region = getByRole('status');
    expect(region.textContent).toBe('Checkpoint 2');
    const first = container.querySelector('.game-hud-moment');
    expect(first.textContent).toBe('Checkpoint 2');
    rerender(<MomentBanner text="Checkpoint 2" momentKey="b" />);
    expect(getByRole('status')).toBe(region);
    expect(container.querySelector('.game-hud-moment')).not.toBe(first);
  });
  it('renders nothing without text or title', () => {
    const { container, getByRole } = render(<MomentBanner momentKey="a" />);
    expect(container.querySelector('.game-hud-moment')).toBeNull();
    expect(getByRole('status').childNodes).toHaveLength(0);
  });
  it('keeps the live region mounted and puts className on the visual child', () => {
    const { getByRole, container, rerender } = render(<MomentBanner momentKey="a" className="x-banner" />);
    const region = getByRole('status');
    expect(region.className).toBe('game-hud-moment-region');
    expect(region.getAttribute('aria-live')).toBe('polite');
    rerender(<MomentBanner title="LEVEL UP!" subtitle="Canyon" momentKey="b" className="x-banner" />);
    expect(getByRole('status')).toBe(region);
    expect(container.querySelector('.game-hud-moment.x-banner').parentElement).toBe(region);
    expect(region.classList.contains('x-banner')).toBe(false);
  });
});
