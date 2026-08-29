import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OpponentPanel from './OpponentPanel.jsx';

describe('OpponentPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn(() => ({ matches: false }));
  });
  afterEach(() => vi.useRealTimers());

  it('renders a deterministic fallback face and normalized ladder tally', () => {
    const first = render(<OpponentPanel opponent={{ name: 'Pip' }} ladder={{ position: 1, total: 21, wins: 2, needed: 5 }} />);
    const markup = first.container.querySelector('.pg-opponent__identicon').innerHTML;
    expect(first.getByText('Opponent 1 of 21 · 2 of 5 wins')).toBeTruthy();
    first.unmount();
    const second = render(<OpponentPanel opponent={{ name: 'Pip' }} />);
    expect(second.container.querySelector('.pg-opponent__identicon').innerHTML).toBe(markup);
  });

  it('falls back to the identicon when authored artwork fails', () => {
    const { container } = render(<OpponentPanel opponent={{ name: 'Pip', art: '/missing.png' }} />);
    fireEvent.error(container.querySelector('.pg-opponent__art'));
    expect(container.querySelector('.pg-opponent__identicon')).toBeTruthy();
  });

  it('shows thinking and mood state and opens the shared roster action', () => {
    const onOpenRoster = vi.fn();
    const { container, getByRole } = render(
      <OpponentPanel opponent={{ name: 'Pip' }} thinkMs={1200} mood="pleased" onOpenRoster={onOpenRoster} />,
    );
    const panel = container.querySelector('.pg-opponent');
    expect(panel.classList.contains('pg-opponent--thinking')).toBe(true);
    expect(panel.classList.contains('pg-opponent--pleased')).toBe(true);
    fireEvent.click(getByRole('button', { name: /see all opponents/i }));
    expect(onOpenRoster).toHaveBeenCalledOnce();
  });

  it('types speech visually while announcing the complete line', () => {
    const { container, getByRole } = render(<OpponentPanel opponent={{ name: 'Pip' }} speech={{ eventId: 'g:2', quip: 'Your move.' }} />);
    expect(getByRole('status').textContent).toBe('Your move.');
    expect(container.querySelector('.pg-opponent__speech > [aria-hidden="true"]').textContent).toBe('');
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector('.pg-opponent__speech > [aria-hidden="true"]').textContent).toBe('Your move.');
  });

  it('shows speech immediately for reduced motion', () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    const { container } = render(<OpponentPanel opponent={{ name: 'Pip' }} speech={{ eventId: 'g:2', quip: 'Your move.' }} />);
    expect(container.querySelector('.pg-opponent__speech > [aria-hidden="true"]').textContent).toBe('Your move.');
  });
});
