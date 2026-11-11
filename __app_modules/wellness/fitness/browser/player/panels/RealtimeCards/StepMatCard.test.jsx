import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StepMatCard } from "./StepMatCard.jsx";

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

  it('asks "Who\'s stepping?" with the mat glyph, never a photo, when nobody has been picked', () => {
    const { container } = render(
      <StepMatCard equipment={{ id: 'step_mat', name: 'Step Mat', image: 'mat.jpg' }} snapshot={snapshot} />
    );
    const prompt = container.querySelector('.step-mat-card__who');
    expect(prompt).toBeTruthy();
    expect(prompt.textContent).toMatch(/who.s stepping\?/i);
    expect(container.querySelector('.step-mat-card__face [data-glyph="step-mat"]')).toBeTruthy();
    expect(container.querySelector('.step-mat-card').className).toContain('step-mat-card--unpicked');
    expect(container.querySelector('.step-mat-card__face img')).toBeNull();
    expect(container.querySelector('.step-mat-card__who img')).toBeNull();
    expect(screen.getByRole('button', { name: /who.s stepping\? Tap to pick/i })).toBeTruthy();
  });

  it('a plain tap on an unpicked card opens the picker', () => {
    render(<StepMatCard equipment={{ name: 'Step Mat' }} snapshot={snapshot}
      participants={[{ id: 'user_2', displayLabel: 'User_2' }]} />);
    const card = screen.getByRole('button', { name: /who.s stepping/i });
    fireEvent.pointerDown(card);
    fireEvent.pointerUp(card);
    fireEvent.click(card);
    expect(screen.getByRole('dialog', { name: 'Choose who is stepping' })).toBeTruthy();
  });

  it('shows the picked rider; tapping the face opens the picker to change or release them', () => {
    const onAssign = vi.fn();
    const { container } = render(
      <StepMatCard equipment={{ id: 'step_mat', name: 'Step Mat' }} snapshot={snapshot} assignedUserId="user_2"
        participants={[{ id: 'user_2', displayLabel: 'User_2' }]} onAssign={onAssign} />
    );
    expect(container.querySelector('.step-mat-card__who')).toBeNull();
    const photo = container.querySelector('.step-mat-card__face img');
    expect(photo.getAttribute('src')).toMatch(/\/static\/img\/users\/user_2$/);
    fireEvent.pointerDown(photo);
    fireEvent.pointerUp(photo);
    fireEvent.click(photo);
    expect(screen.getByRole('dialog', { name: 'Choose who is stepping' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unassign' }));
    expect(onAssign).toHaveBeenCalledWith(null);
  });

  it('falls back to the glyph if the picked rider photo fails', () => {
    const { container } = render(
      <StepMatCard equipment={{ id: 'step_mat', name: 'Step Mat' }} snapshot={snapshot} assignedUserId="user_2" />
    );
    fireEvent.error(container.querySelector('.step-mat-card__face img'));
    expect(container.querySelector('.step-mat-card__face img')).toBeNull();
    expect(container.querySelector('.step-mat-card__face [data-glyph="step-mat"]')).toBeTruthy();
  });

  it.each([
    [{ online: true, active: true, engaged: true }, 'stepping', 'Stepping'],
    [{ online: true, active: false, engaged: true }, 'dormant', 'Dormant'],
    [{ online: true, active: false, engaged: false }, 'ready', 'Ready'],
    [{ online: false, active: false, engaged: true }, 'offline', 'Offline'],
  ])('labels state %o as %s', (overrides, state, label) => {
    const { container } = render(<StepMatCard equipment={{ name: 'Step Mat' }} snapshot={{ ...snapshot, ...overrides }} />);
    const pill = container.querySelector('.step-mat-card__state');
    expect(pill.getAttribute('data-state')).toBe(state);
    expect(pill.textContent).toBe(label);
    expect(container.querySelector('.fitness-device').className).toContain(`step-mat-card--${state}`);
    expect(screen.getByRole('button', { name: new RegExp(`stomps\\. ${label}\\. Who.s stepping\\? Tap`) })).toBeTruthy();
  });

  it('lays out SPM, steps and stomps as one row of labelled numbers', () => {
    const { container } = render(<StepMatCard equipment={{ name: 'Step Mat' }} snapshot={{ ...snapshot, stepsPerMinute: 35.6 }} />);
    expect(container.querySelector('.step-mat-card__stat--rate').textContent).toBe('36SPM');
    const stats = [...container.querySelectorAll('.step-mat-card__stats .step-mat-card__stat')].map((el) => el.textContent);
    expect(stats).toEqual(['36SPM', '42Steps', '5Stomps']);
  });

  it('renders zeros rather than NaN when the snapshot has no numbers yet', () => {
    const { container } = render(
      <StepMatCard
        equipment={{ name: 'Step Mat' }}
        snapshot={{ ...snapshot, stepsPerMinute: undefined, sessionSteps: null, sessionStomps: undefined }}
      />
    );
    expect(container.querySelector('.step-mat-card__stat--rate strong').textContent).toBe('0');
    expect(container.textContent).not.toContain('NaN');
  });
});
