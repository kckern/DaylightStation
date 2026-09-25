// frontend/src/lib/ui/Toast.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastRegion, Toast } from './Toast.jsx';

afterEach(() => vi.useRealTimers());

describe('Toast', () => {
  it('renders in a region portalled to <body>, outside the page flow', () => {
    const { container } = render(<main><ToastRegion label="Log"><Toast message="Moved to Lunch" /></ToastRegion></main>);
    const toast = screen.getByText('Moved to Lunch').closest('.ds-toast');
    expect(toast.closest('.ds-toasts').parentElement).toBe(document.body);
    expect(container.contains(toast)).toBe(false);
    expect(screen.getByRole('region', { name: 'Log' })).toBeTruthy();
  });

  it('portals into the themed .ds-root when there is one, so it has the theme colors', () => {
    const { container } = render(<div className="ds-root"><main><ToastRegion><Toast message="Copied" /></ToastRegion></main></div>);
    const region = screen.getByText('Copied').closest('.ds-toasts');
    expect(region.parentElement).toBe(container.querySelector('.ds-root'));
    expect(container.querySelector('main').contains(region)).toBe(false);
  });

  it('an error is an alert; information is a status', () => {
    render(<><Toast tone="error" message="Couldn't move" /><Toast message="Copied" /></>);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't move");
    expect(screen.getByRole('status').textContent).toContain('Copied');
  });

  it('auto-closes information after autoCloseMs, and pauses while the pointer is on it', () => {
    vi.useFakeTimers();
    const onAutoClose = vi.fn();
    render(<Toast message="Copied" autoCloseMs={6000} onAutoClose={onAutoClose} />);
    const toast = screen.getByRole('status');
    act(() => vi.advanceTimersByTime(4000));
    fireEvent.pointerEnter(toast);
    act(() => vi.advanceTimersByTime(10000));
    expect(onAutoClose).not.toHaveBeenCalled();
    fireEvent.pointerLeave(toast);
    act(() => vi.advanceTimersByTime(6000));
    expect(onAutoClose).toHaveBeenCalledTimes(1);
  });

  it('never auto-closes without autoCloseMs (anything carrying an action)', () => {
    vi.useFakeTimers();
    const onAutoClose = vi.fn();
    render(<Toast message="Eggs deleted." onAutoClose={onAutoClose}><button>Undo</button></Toast>);
    act(() => vi.advanceTimersByTime(600000));
    expect(onAutoClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });
});
