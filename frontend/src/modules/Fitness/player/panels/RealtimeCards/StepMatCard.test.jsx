import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StepMatCard } from './StepMatCard.jsx';

vi.mock('@/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

const snapshot = {
  equipmentId: 'step_mat', matId: 'garage-step-mat', online: true, active: true,
  engaged: true, seenThisSession: true, lastSeenAt: Date.now(), stepsPerMinute: 36,
  sessionSteps: 42, sessionStomps: 5,
};

afterEach(() => vi.useRealTimers());

describe('StepMatCard', () => {
  it('shows live rate/totals and assigns an active HR participant on tap', () => {
    const onAssign = vi.fn();
    render(<StepMatCard
      equipment={{ id: 'step_mat', name: 'Step Mat' }}
      snapshot={snapshot}
      participants={[{ id: 'user_2', displayLabel: 'User_2' }]}
      onAssign={onAssign}
    />);
    expect(screen.getByText('36')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    fireEvent.pointerDown(screen.getByLabelText(/42 steps, 5 stomps/i));
    fireEvent.pointerUp(screen.getByLabelText(/42 steps, 5 stomps/i));
    fireEvent.click(screen.getByLabelText(/42 steps, 5 stomps/i));
    fireEvent.click(screen.getByRole('button', { name: /user_2/i }));
    expect(onAssign).toHaveBeenCalledWith('user_2');
  });

  it('requires a hold and confirmation to disengage', () => {
    vi.useFakeTimers();
    const confirm = vi.fn(() => true);
    Object.defineProperty(window, 'confirm', { configurable: true, value: confirm });
    const onDisengage = vi.fn();
    render(<StepMatCard equipment={{ name: 'Step Mat' }} snapshot={snapshot} onDisengage={onDisengage} />);
    const card = screen.getByLabelText(/hold to release mat/i);
    fireEvent.pointerDown(card);
    vi.advanceTimersByTime(700);
    expect(confirm).toHaveBeenCalledOnce();
    expect(onDisengage).toHaveBeenCalledOnce();
    delete window.confirm;
  });

  it('opens from the keyboard, traps focus, and returns it to the card on Escape', () => {
    render(<StepMatCard equipment={{ name: 'Step Mat' }} snapshot={snapshot} />);
    const card = screen.getByRole('button', { name: /42 steps, 5 stomps/i });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Choose who is stepping' })).toBeTruthy();
    const close = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(card);
  });
});
