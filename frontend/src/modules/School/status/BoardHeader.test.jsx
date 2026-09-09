import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import BoardHeader from './BoardHeader.jsx';

afterEach(() => { vi.useRealTimers(); });

describe('BoardHeader', () => {
  it('heads the board with the time and the date, not the word "Today"', () => {
    render(<BoardHeader now={new Date('2026-09-09T11:57:00')} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/11:57/);
    expect(screen.getByText(/Wednesday/)).toBeTruthy();
    expect(screen.getByText(/September 9/)).toBeTruthy();
    expect(screen.queryByText('Today')).toBeNull();
  });

  it('carries whatever rides on its right — the book door', () => {
    render(<BoardHeader now={new Date('2026-09-09T11:57:00')}><button type="button">Log a book</button></BoardHeader>);
    expect(screen.getByRole('button', { name: 'Log a book' })).toBeTruthy();
  });

  // The board itself renders nothing on a settled-empty day. The header is a
  // sibling precisely so the door does not vanish with it.
  it('stands on its own, with no board beside it', () => {
    const { container } = render(<BoardHeader now={new Date('2026-09-09T11:57:00')} />);
    expect(container.querySelector('.school-board-header')).not.toBeNull();
  });

  it('lands on the minute boundary rather than 60s after mount', () => {
    vi.useFakeTimers();
    // 20s past the minute: the first update is owed in 40s, not 60.
    vi.setSystemTime(new Date('2026-09-09T11:57:20'));
    render(<BoardHeader />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/11:57/);
    // Advancing fake timers advances the fake clock with them, so the time is
    // carried by the advance alone — setting it again would double-count.
    act(() => { vi.advanceTimersByTime(39_000); });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/11:57/);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/11:58/);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/11:59/);
  });

  it('arms no timers at all when handed a fixed instant', () => {
    vi.useFakeTimers();
    render(<BoardHeader now={new Date('2026-09-09T11:57:00')} />);
    expect(vi.getTimerCount()).toBe(0);
  });
});
