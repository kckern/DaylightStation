import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import WhoIsPlayingPrompt from './WhoIsPlayingPrompt.jsx';

const users = [{ id: 'kc', name: 'KC' }, { id: 'milo', name: 'Milo' }];
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('WhoIsPlayingPrompt', () => {
  it('renders only roster faces — never a Guest card', () => {
    render(<WhoIsPlayingPrompt open users={users} onPick={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText('KC')).toBeTruthy();
    expect(screen.getByText('Milo')).toBeTruthy();
    expect(screen.queryByText('Guest')).toBeNull();
  });
  it('tapping a face calls onPick with that id', () => {
    const onPick = vi.fn();
    render(<WhoIsPlayingPrompt open users={users} onPick={onPick} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText('Milo'));
    expect(onPick).toHaveBeenCalledWith('milo');
  });
  it('the ✕ / backdrop dismiss calls onDismiss (→ caller sets Guest)', () => {
    const onDismiss = vi.fn();
    render(<WhoIsPlayingPrompt open users={users} onPick={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
  it('auto-dismisses after timeoutMs', () => {
    const onDismiss = vi.fn();
    render(<WhoIsPlayingPrompt open users={users} onPick={() => {}} onDismiss={onDismiss} timeoutMs={30000} />);
    act(() => { vi.advanceTimersByTime(30000); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
  it('renders nothing when closed', () => {
    const { container } = render(<WhoIsPlayingPrompt open={false} users={users} onPick={() => {}} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('exposes a balanced column count on the grid (6 → 3 cols)', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `u${i}`, name: `U${i}` }));
    const { container } = render(<WhoIsPlayingPrompt open users={six} onPick={() => {}} onDismiss={() => {}} />);
    const grid = container.querySelector('.piano-userpicker__grid');
    expect(grid.getAttribute('data-columns')).toBe('3');
  });

  it('paginates a roster larger than 9, showing dots and switching pages', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, name: `U${i}` }));
    const { container } = render(<WhoIsPlayingPrompt open users={twelve} onPick={() => {}} onDismiss={() => {}} />);
    // Page 1: first 9 faces only.
    expect(screen.getByText('U0')).toBeTruthy();
    expect(screen.queryByText('U9')).toBeNull();
    const dots = container.querySelectorAll('.piano-userpicker__dot');
    expect(dots).toHaveLength(2);
    // Switch to page 2 → the overflow faces appear.
    fireEvent.click(dots[1]);
    expect(screen.getByText('U9')).toBeTruthy();
    expect(screen.queryByText('U0')).toBeNull();
  });
});
