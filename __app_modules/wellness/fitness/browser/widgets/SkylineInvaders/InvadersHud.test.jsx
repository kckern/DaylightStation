import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import InvadersHud, { formatClock } from './InvadersHud.jsx';
import { createGameState } from '../../lib/skylineInvaders/engine.js';

const level = { id: 'invaders-test', duration_s: 90, cannons: 1, pass: { kills: 30, base_hp_min: 0 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2 }] };

function renderHud(over = {}) {
  const { state: stateOver = {}, ...props } = over;
  const state = { ...createGameState(level, { seed: 1 }), ...stateOver };
  return render(
    <InvadersHud state={state} level={level} gesture="wiper" aimStatus={{ lost: false, mode: 'pose' }} poseStatus={{ state: 'detecting' }} partner={null} {...props} />,
  );
}
const notes = () => screen.queryAllByRole('status').map((node) => node.textContent).filter(Boolean);

describe('InvadersHud', () => {
  it('shows kills against the pass mark, the score, and the combo only once it is a streak', () => {
    renderHud({ state: { kills: 7, score: 2340, combo: 3 } });
    expect(screen.getByTestId('skyline-invaders-hud').tagName).toBe('HEADER');
    expect(screen.getByTestId('invaders-kills').textContent).toBe('7 / 30');
    expect(screen.getByTestId('invaders-kills').getAttribute('data-passed')).toBe('false');
    expect(screen.getByTestId('invaders-score').textContent).toBe('2,340');
    expect(screen.getByTestId('invaders-combo').textContent).toBe('x3');
  });

  it('hides the combo at one or none, and marks the kills once the pass mark is reached', () => {
    renderHud({ state: { kills: 30, combo: 1 } });
    expect(screen.queryByTestId('invaders-combo')).toBeNull();
    expect(screen.getByTestId('invaders-kills').getAttribute('data-passed')).toBe('true');
    expect(screen.getByTestId('invaders-kills').textContent).toBe('30');
  });

  it('drops the target once the round is past it, so it never reads "45 / 30"', () => {
    renderHud({ state: { kills: 45 } });
    expect(screen.getByTestId('invaders-kills').textContent).toBe('45');
    expect(screen.getByLabelText('45 shot down, target of 30 reached')).toBeTruthy();
  });

  it('counts the time left down as m:ss and never below zero', () => {
    const view = renderHud({ state: { time: 17.2 } });
    expect(screen.getByTestId('invaders-time').textContent).toBe('1:13');
    expect(screen.getByTestId('invaders-time').getAttribute('data-urgent')).toBe('false');
    expect(screen.getByLabelText('Time left').firstChild.style.width).toBe(`${((90 - 17.2) / 90) * 100}%`);
    view.unmount();
    renderHud({ state: { time: 95 } });
    expect(screen.getByTestId('invaders-time').textContent).toBe('0:00');
    expect(formatClock(9.01)).toBe('0:10');
    expect(formatClock(-3)).toBe('0:00');
  });

  it('turns the clock urgent in the last ten seconds', () => {
    renderHud({ state: { time: 81 } });
    expect(screen.getByTestId('invaders-time').getAttribute('data-urgent')).toBe('true');
  });

  // Only the weapon in hand is spelled out; every step is named for a screen reader.
  const ladder = () => [...screen.getByTestId('invaders-weapon').querySelectorAll('li')].map((li) => [li.getAttribute('aria-label'), li.className]);

  it('shows the weapon ladder with the weapon in hand lit', () => {
    const view = renderHud();
    expect(screen.getByTestId('invaders-weapon').getAttribute('data-tier')).toBe('small');
    expect(ladder()).toEqual([['Single', 'is-current'], ['Double', ''], ['Spread', ''], ['Bomb', '']]);
    view.unmount();
    renderHud({ state: { weapon: { level: 2, meter: 0.4, idleS: 0, peak: 2 } } });
    expect(screen.getByTestId('invaders-weapon').getAttribute('data-tier')).toBe('spread');
    expect(ladder()).toEqual([['Single', 'is-done'], ['Double', 'is-done'], ['Spread', 'is-current'], ['Bomb', '']]);
    expect(screen.getByLabelText('Weapon: Spread')).toBeTruthy();
  });

  it('shows the power meter filling, and tells the shooter to stomp when a bomb is ready', () => {
    const view = renderHud({ state: { weapon: { level: 1, meter: 0.4, idleS: 0, peak: 1 } } });
    const power = screen.getByTestId('invaders-power');
    expect(within(power).getByText('Power')).toBeTruthy();
    expect(within(power).getByLabelText('Power 40%').firstChild.style.width).toBe('40%');
    expect(power.getAttribute('data-full')).toBe('false');
    view.unmount();
    renderHud({ state: { weapon: { level: 2, meter: 1, idleS: 0, peak: 2 } } });
    expect(screen.getByTestId('invaders-weapon').getAttribute('data-bomb')).toBe('true');
    expect(within(screen.getByTestId('invaders-power')).getByText('Stomp!')).toBeTruthy();
    expect(screen.getByLabelText('Bomb ready: stomp to drop it')).toBeTruthy();
    expect(ladder()[3]).toEqual(['Bomb', 'is-current']);
  });

  it('shows the fuel gauge against the tank, and tells the shooter to step when it is empty', () => {
    const view = renderHud({ state: { fuel: 2.5 } });
    const fuel = screen.getByTestId('invaders-fuel');
    expect(within(fuel).getByText('Fuel')).toBeTruthy();
    expect(within(fuel).getByLabelText('Fuel 50%').firstChild.style.width).toBe('50%');
    expect(fuel.getAttribute('data-empty')).toBe('false');
    view.unmount();
    renderHud({ state: { fuel: 0 } });
    expect(screen.getByTestId('invaders-fuel').getAttribute('data-empty')).toBe('true');
    expect(within(screen.getByTestId('invaders-fuel')).getByText('Step!')).toBeTruthy();
  });

  it('names the controls in use, and makes way for an aim note', () => {
    const view = renderHud({ gesture: 'twist' });
    expect(screen.getByTestId('invaders-controls').textContent).toBe('Twist');
    expect(screen.getByTestId('skyline-invaders-hud').getAttribute('data-gesture')).toBe('twist');
    expect(notes()).toEqual([]);
    view.unmount();
    renderHud({ aimStatus: { lost: true, mode: 'pose' } });
    expect(screen.queryByTestId('invaders-controls')).toBeNull();
  });

  it('tells the shooter how to get their aim back', () => {
    const view = renderHud({ aimStatus: { lost: true, mode: 'pose' } });
    expect(notes()).toEqual(['Step into view']);
    view.unmount();
    renderHud({ aimStatus: { lost: true, mode: 'manual' }, poseStatus: { state: 'camera-denied' } });
    expect(notes()).toEqual(['Gamepad aim']);
  });

  it('says the camera is still starting, rather than asking the defender to step into view', () => {
    renderHud({ aimStatus: { lost: true, mode: 'manual' }, poseStatus: { state: 'loading' } });
    expect(notes()).toEqual(['Camera starting']);
  });

  it('shows the boost only with a partner: the meter while it fills, the label and seconds while it runs', () => {
    const view = renderHud({ state: { boost: { meter: 0.5, next: 1, used: 1, active: null } } });
    expect(screen.queryByTestId('invaders-boost')).toBeNull();
    view.unmount();

    const filling = renderHud({ partner: { riderId: 'kid' }, state: { boost: { meter: 0.5, next: 1, used: 1, active: null } } });
    const boost = screen.getByTestId('invaders-boost');
    expect(boost.getAttribute('data-boost')).toBe('filling');
    expect(within(boost).getByLabelText('Boost 50%').firstChild.style.width).toBe('50%');
    expect(within(boost).getByText('Shield')).toBeTruthy();          // next in the rotation: rapid, shield, twin
    filling.unmount();

    renderHud({ partner: { riderId: 'kid' }, state: { boost: { meter: 0, next: 3, used: 3, active: { kind: 'twin', remaining: 4.2 } } } });
    const running = screen.getByTestId('invaders-boost');
    expect(running.getAttribute('data-boost')).toBe('twin');
    expect(within(running).getByText('Twin cannon')).toBeTruthy();
    expect(within(running).getByText('5s')).toBeTruthy();
  });

  it('reports base health through the meter', () => {
    renderHud({ state: { base: { hp: 65, maxHp: 100, buildings: [] } } });
    const meter = screen.getByRole('meter', { name: 'Base' });
    expect(meter.getAttribute('aria-valuenow')).toBe('65');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
    expect(screen.getByTestId('invaders-base').textContent).toBe('65');
  });
});
