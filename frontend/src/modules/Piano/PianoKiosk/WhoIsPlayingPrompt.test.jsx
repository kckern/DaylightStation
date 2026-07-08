import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import WhoIsPlayingPrompt from './WhoIsPlayingPrompt.jsx';

const users = [{ id: 'kc', name: 'KC' }, { id: 'user_3', name: 'User_3' }];
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('WhoIsPlayingPrompt', () => {
  it('renders only roster faces — never a Guest card', () => {
    render(<WhoIsPlayingPrompt open users={users} onPick={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText('KC')).toBeTruthy();
    expect(screen.getByText('User_3')).toBeTruthy();
    expect(screen.queryByText('Guest')).toBeNull();
  });
  it('tapping a face calls onPick with that id', () => {
    const onPick = vi.fn();
    render(<WhoIsPlayingPrompt open users={users} onPick={onPick} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText('User_3'));
    expect(onPick).toHaveBeenCalledWith('user_3');
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

  it('shows relational labels (Dad/Mom) when the kids are in the roster, no subtitle', () => {
    const family = [
      { id: 'user_1', name: 'User_1', group_label: 'Dad' },
      { id: 'user_9', name: 'User_9', group_label: 'Mom' },
      { id: 'user_2', name: 'User_2' },
    ];
    const { container } = render(<WhoIsPlayingPrompt open users={family} onPick={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText('Dad')).toBeTruthy();
    expect(screen.getByText('Mom')).toBeTruthy();
    expect(screen.getByText('User_2')).toBeTruthy();
    expect(screen.queryByText('User_1')).toBeNull();        // relational label replaces the full name
    expect(container.querySelector('.piano-usercard__label')).toBeNull(); // no alternate-name subtitle
  });

  it('uses full names when no kids are present (adults only)', () => {
    const adults = [
      { id: 'user_1', name: 'User_1', group_label: 'Dad' },
      { id: 'user_9', name: 'User_9', group_label: 'Mom' },
    ];
    render(<WhoIsPlayingPrompt open users={adults} onPick={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText('User_1')).toBeTruthy();
    expect(screen.queryByText('Dad')).toBeNull();
  });

  it('still calls onPick with the user id (not the resolved label)', () => {
    const onPick = vi.fn();
    const family = [{ id: 'user_1', name: 'User_1', group_label: 'Dad' }, { id: 'user_2', name: 'User_2' }];
    render(<WhoIsPlayingPrompt open users={family} onPick={onPick} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText('Dad'));
    expect(onPick).toHaveBeenCalledWith('user_1');
  });

  it('paginates a roster larger than one 3×2 page, showing dots and switching pages', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, name: `U${i}` }));
    const { container } = render(<WhoIsPlayingPrompt open users={twelve} onPick={() => {}} onDismiss={() => {}} />);
    // Page 1: first 6 faces only (3×2).
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

describe('WhoIsPlayingPrompt screen-off button', () => {
  it('renders no screen-off button without onScreenOff', () => {
    render(<WhoIsPlayingPrompt open users={users} onPick={() => {}} onDismiss={() => {}} />);
    expect(screen.queryByRole('button', { name: /turn off screen/i })).toBeNull();
  });

  it('two-tap arms then confirms onScreenOff', () => {
    const onScreenOff = vi.fn();
    render(<WhoIsPlayingPrompt open users={users} onPick={() => {}} onDismiss={() => {}} onScreenOff={onScreenOff} />);
    fireEvent.click(screen.getByRole('button', { name: /turn off screen/i })); // arms only
    expect(onScreenOff).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /tap again to confirm/i }));
    expect(onScreenOff).toHaveBeenCalledTimes(1);
  });
});
