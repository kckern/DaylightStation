import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { FilterBumper, FilterBadge } from './FilterChrome.jsx';

describe('FilterBumper', () => {
  it('shows the edited-for-content line and the summary', () => {
    const { getByText } = render(<FilterBumper summary="2 words muted" art={null} theme={{}} />);
    expect(getByText('Edited for content')).toBeTruthy();
    expect(getByText('2 words muted')).toBeTruthy();
  });
  it('shows the logo when art provides one, and hides it if it fails to load', () => {
    const { container } = render(<FilterBumper summary="" art={{ logo: '/logo', background: '/bg' }} theme={{}} />);
    const img = container.querySelector('img');
    expect(img.getAttribute('src')).toBe('/logo');
    act(() => { img.dispatchEvent(new Event('error')); });
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('FilterBadge', () => {
  it.each(['certified', 'provisional', 'failed'])('renders the %s state', (state) => {
    const { container } = render(<FilterBadge state={state} fireCount={0} />);
    expect(container.querySelector(`[data-filter-badge="${state}"]`)).toBeTruthy();
  });
  it('is display-only: aria-hidden, no pointer events, not focusable', () => {
    const { container } = render(<FilterBadge state="certified" fireCount={0} />);
    const el = container.querySelector('[data-filter-badge]');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.pointerEvents).toBe('none');
    expect(el.getAttribute('tabindex')).toBeNull();
  });
  it('pulses when fireCount advances, then settles', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<FilterBadge state="certified" fireCount={0} />);
    const el = () => container.querySelector('[data-filter-badge]');
    expect(el().dataset.pulse).toBe('0');
    rerender(<FilterBadge state="certified" fireCount={1} />);
    expect(el().dataset.pulse).toBe('1');
    act(() => { vi.advanceTimersByTime(700); });
    expect(el().dataset.pulse).toBe('0');
    vi.useRealTimers();
  });
});
