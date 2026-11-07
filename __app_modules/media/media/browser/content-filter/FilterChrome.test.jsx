import { describe, it, expect, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
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
  it('hides a logo narrower than 300 px once it loads', () => {
    const { container } = render(<FilterBumper summary="" art={{ logo: '/logo', background: '/bg' }} theme={{}} />);
    const img = container.querySelector('img');
    Object.defineProperty(img, 'naturalWidth', { value: 54, configurable: true });
    act(() => { img.dispatchEvent(new Event('load')); });
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('FilterBadge', () => {
  it.each(['certified', 'provisional', 'failed'])('renders the %s state', (state) => {
    const { container } = render(<FilterBadge state={state} active={false} />);
    expect(container.querySelector(`[data-filter-badge="${state}"]`)).toBeTruthy();
  });
  it('is display-only without onOpen: aria-hidden, no pointer events, not focusable', () => {
    const { container } = render(<FilterBadge state="certified" active={false} />);
    const el = container.querySelector('[data-filter-badge]');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.pointerEvents).toBe('none');
    expect(el.getAttribute('tabindex')).toBeNull();
  });
  it('glows gold while active, dim at 0.4 when not', () => {
    const { container, rerender } = render(<FilterBadge state="certified" active />);
    const el = () => container.querySelector('[data-filter-badge]');
    expect(container.querySelector('path').getAttribute('fill')).toBe('#ffd54a');
    expect(el().getAttribute('data-active')).toBe('1');
    expect(el().style.opacity).toBe('1');
    rerender(<FilterBadge state="certified" active={false} />);
    expect(el().getAttribute('data-active')).toBeNull();
    expect(el().style.opacity).toBe('0.4');
  });
  it('click calls onOpen once without bubbling; mouse-only (tabIndex -1, no key handler)', () => {
    const onOpen = vi.fn();
    const parent = vi.fn();
    const { container } = render(<div onClick={parent}><FilterBadge state="certified" active={false} onOpen={onOpen} /></div>);
    const el = container.querySelector('[data-filter-badge]');
    expect(el.tabIndex).toBe(-1);
    expect(el.getAttribute('role')).toBe('button');
    expect(el.style.pointerEvents).toBe('auto');
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(el);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
  });
});
