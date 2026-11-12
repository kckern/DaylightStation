import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import InvadersHud, { formatClock } from './InvadersHud.jsx';
import { createGameState } from '../../lib/skylineInvaders/engine.js';

const level = { id: 'invaders-test', duration_s: 90, cannons: 1, pass: { kills: 30, base_hp_min: 0 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2 }] };
const TIER = { tier: 'spread', zoneId: 'hot', trusted: true };

function renderHud(over = {}) {
  const { state: stateOver = {}, ...props } = over;
  const state = { ...createGameState(level, { seed: 1 }), ...stateOver };
  return render(
    <InvadersHud state={state} level={level} tier={TIER} aimStatus={{ lost: false, mode: 'pose' }} poseStatus={{ state: 'detecting' }} partner={null} shooterName="test-rider" {...props} />,
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
    expect(screen.getByTestId('invaders-combo').textContent).toBe('×3');
  });

  it('hides the combo at one or none, and marks the kills once the pass mark is reached', () => {
    renderHud({ state: { kills: 30, combo: 1 } });
    expect(screen.queryByTestId('invaders-combo')).toBeNull();
    expect(screen.getByTestId('invaders-kills').getAttribute('data-passed')).toBe('true');
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

  it('names the shot tier, and says why it is small when no heart rate can be trusted', () => {
    const view = renderHud();
    const badge = screen.getByTestId('invaders-tier');
    expect(badge.getAttribute('data-tier')).toBe('spread');
    expect(within(badge).getByText('Spread')).toBeTruthy();
    expect(within(badge).getByText('test-rider')).toBeTruthy();
    expect(notes()).toEqual([]);
    view.unmount();
    renderHud({ tier: { tier: 'small', zoneId: null, trusted: false } });
    expect(screen.getByTestId('invaders-tier').getAttribute('data-tier')).toBe('small');
    expect(notes()).toEqual(['No trusted heart rate — small shots']);
  });

  it('tells the shooter how to get their aim back', () => {
    const view = renderHud({ aimStatus: { lost: true, mode: 'pose' } });
    expect(notes()).toEqual(['Step into view']);
    view.unmount();
    renderHud({ aimStatus: { lost: true, mode: 'manual' }, poseStatus: { state: 'camera-denied' } });
    expect(notes()).toEqual(['Camera off — aim with the gamepad']);
  });

  it('tells a player who skipped calibration how to aim, without blaming the camera', () => {
    renderHud({ aimStatus: { lost: true, mode: 'manual' }, poseStatus: { state: 'detecting' } });
    expect(notes()).toEqual(['Gamepad aim — stick or arrow keys']);
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
