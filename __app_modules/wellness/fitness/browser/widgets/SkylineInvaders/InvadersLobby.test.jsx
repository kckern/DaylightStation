import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pad = vi.hoisted(() => ({ onKey: null, active: null }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }) }) }));
vi.mock('../../lib/useGamepadKeys.js', () => ({ useGamepadKeys: (active, onKey) => { pad.active = active; pad.onKey = onKey; } }));

import InvadersLobby, { defaultLevelId } from './InvadersLobby.jsx';

const level = (id, name) => ({ id, name, duration_s: 90, cannons: 1, pass: { kills: 20, base_hp_min: 0 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 2 }] });
const levels = [level('invaders-1-1', 'First Wave'), level('invaders-1-2', 'Drone Swarm'), level('invaders-1-3', 'Bomber Run')];
const world = {
  next: 'invaders-1-2',
  levels: [
    { id: 'invaders-1-1', name: 'First Wave', status: 'completed', best: { stars: 2, score: 900 } },
    { id: 'invaders-1-2', name: 'Drone Swarm', status: 'open' },
    { id: 'invaders-1-3', name: 'Bomber Run', status: 'locked' },
  ],
};
const DETECTING = { state: 'detecting', fps: 13 };

function renderLobby(over = {}) {
  const props = {
    levels, world, chosenLevelId: null, onChooseLevel: vi.fn(), onRequestUnlock: vi.fn(),
    shooter: { id: 'kid', name: 'Kid' }, candidates: [{ id: 'kid', name: 'Kid' }, { id: 'test-rider', name: 'Test Rider' }], onPickShooter: vi.fn(),
    mat: { equipmentId: 'step-mat', matId: 'mat-a1' }, partner: null,
    poseStatus: DETECTING, calibrated: true, onCalibrate: vi.fn(),
    access: { unlocked: true, state: 'complete' }, onRequestAdmin: vi.fn(), onStart: vi.fn(),
    ...over,
  };
  return { props, ...render(<InvadersLobby {...props} />) };
}
const tile = (name) => screen.getByRole('button', { name: new RegExp(name) });
const key = (k, init = {}) => act(() => { fireEvent.keyDown(window, { key: k, ...init }); });

beforeEach(() => { pad.onKey = null; });
afterEach(() => vi.useRealTimers());

describe('defaultLevelId', () => {
  it('is the next level on the world map, else the first open level', () => {
    expect(defaultLevelId(levels, world)).toBe('invaders-1-2');
    expect(defaultLevelId(levels, null)).toBe('invaders-1-1');
    expect(defaultLevelId(levels, { next: 'gone', levels: world.levels })).toBe('invaders-1-1');
  });
});

describe('InvadersLobby', () => {
  it('offers the next level on the world map by default, with stars on a finished one', () => {
    renderLobby();
    expect(tile('Drone Swarm').getAttribute('aria-pressed')).toBe('true');
    expect(tile('First Wave').getAttribute('aria-pressed')).toBe('false');
    expect(within(tile('First Wave')).getByLabelText('2 of 3 stars')).toBeTruthy();
  });

  it('asks for an unlock when a locked level is tapped, and chooses an open one', () => {
    const { props } = renderLobby();
    fireEvent.click(tile('Bomber Run'));
    expect(props.onRequestUnlock).toHaveBeenCalledWith(expect.objectContaining({ id: 'invaders-1-3' }));
    expect(props.onChooseLevel).not.toHaveBeenCalled();
    fireEvent.click(tile('First Wave'));
    expect(props.onChooseLevel).toHaveBeenCalledWith('invaders-1-1');
  });

  it('shows the shooter picker only without a shooter, and reports the pick', () => {
    const first = renderLobby();
    expect(screen.queryByRole('group', { name: 'Who is shooting?' })).toBeNull();
    expect(screen.getByTestId('invaders-shooter').textContent).toContain('Kid');
    first.unmount();
    const { props } = renderLobby({ shooter: null });
    const picker = screen.getByRole('group', { name: 'Who is shooting?' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Test Rider' }));
    expect(props.onPickShooter).toHaveBeenCalledWith('test-rider');
  });

  it('while picking, the names and the lobby action share one row (fits the 777 px garage screen)', () => {
    const { container } = renderLobby({ shooter: null });
    const rows = container.querySelectorAll('.skyline-invaders__actions');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByRole('button', { name: 'Test Rider' })).toBeTruthy();
    expect(within(rows[0]).getByRole('button', { name: /^Start/ })).toBeTruthy();
  });

  it('lets the shooter be changed after one is set', () => {
    const { props } = renderLobby();
    fireEvent.click(screen.getByRole('button', { name: 'Change shooter' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Who is shooting?' })).getByRole('button', { name: 'Test Rider' }));
    expect(props.onPickShooter).toHaveBeenCalledWith('test-rider');
  });

  it('disables Start without a shooter and says why', () => {
    const { props } = renderLobby({ shooter: null });
    const start = screen.getByRole('button', { name: /^Start/ });
    expect(start.disabled).toBe(true);
    expect(start.textContent).toContain('Pick who is shooting');
    fireEvent.click(start);
    key('Enter');
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it('swaps Start for Ask a grown-up while school-day access is locked', () => {
    const { props } = renderLobby({ access: { unlocked: false, state: 'incomplete' } });
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ask a grown-up/ }));
    expect(props.onRequestAdmin).toHaveBeenCalledTimes(1);
    key('Enter');
    expect(props.onRequestAdmin).toHaveBeenCalledTimes(2);
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it('leads with Calibrate for an uncalibrated pose player and keeps gamepad start as the second action', () => {
    const { props } = renderLobby({ calibrated: false });
    fireEvent.click(screen.getByRole('button', { name: /Calibrate/ }));
    expect(props.onCalibrate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Start with gamepad aim/ }));
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it('does not block on a loading camera: Start works and the note says the vision engine is loading', () => {
    const { props } = renderLobby({ calibrated: false, poseStatus: { state: 'loading' } });
    expect(screen.getByText(/Vision engine loading/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Start/ }));
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it('says how to aim when the camera is unavailable, and starts without calibration', () => {
    const { props } = renderLobby({ calibrated: false, poseStatus: { state: 'camera-denied' } });
    expect(screen.getByText(/Camera off/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Calibrate/ })).toBeNull();
    key('Enter');
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it('presses the primary action with Enter or any foot-pad letter, and moves the level with the arrows among open levels', () => {
    const { props } = renderLobby();
    key('ArrowLeft');
    expect(props.onChooseLevel).toHaveBeenLastCalledWith('invaders-1-1');
    key('ArrowRight');   // from the default (1-2) the next one is locked: stay
    expect(props.onChooseLevel).toHaveBeenCalledTimes(1);
    key('Enter');
    key('m');
    expect(props.onStart).toHaveBeenCalledTimes(2);
  });

  it('ignores the OS-bound digits', () => {
    const { props } = renderLobby();
    key('4', { code: 'Digit4' });
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it('is driven by the gamepad through the same actions', () => {
    const { props } = renderLobby({ chosenLevelId: 'invaders-1-1' });
    expect(pad.active).toBe(true);
    act(() => pad.onKey('ArrowRight'));
    expect(props.onChooseLevel).toHaveBeenLastCalledWith('invaders-1-2');
    act(() => pad.onKey('Enter'));
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it('moves between the actions with up and down', () => {
    const { props } = renderLobby({ calibrated: false });
    key('ArrowDown');
    key('Enter');
    expect(props.onStart).toHaveBeenCalledTimes(1);
    expect(props.onCalibrate).not.toHaveBeenCalled();
  });

  it('notes a missing step mat and still lets the shooter be picked', () => {
    const { props } = renderLobby({ mat: null, shooter: null });
    expect(screen.getByText(/No step mat found/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: 'Who is shooting?' })).getByRole('button', { name: 'Kid' }));
    expect(props.onPickShooter).toHaveBeenCalledWith('kid');
  });

  it('only tells the players to do what they can do: arms and mat, or gamepad and keys', () => {
    const first = renderLobby();
    expect(screen.getByTestId('invaders-howto').textContent).toBe('Point both arms to aim. Step onto the mat to fire.');
    first.unmount();
    renderLobby({ mat: null, calibrated: false, poseStatus: { state: 'camera-denied' } });
    expect(screen.getByTestId('invaders-howto').textContent).toBe('Aim with the gamepad stick or the arrow keys. Press A or Space to fire.');
  });

  it('names the boost partner only when there is one', () => {
    const first = renderLobby();
    expect(screen.queryByTestId('invaders-partner')).toBeNull();
    first.unmount();
    renderLobby({ partner: { riderId: 'test-rider', name: 'Test Rider' } });
    expect(screen.getByTestId('invaders-partner').textContent).toBe('Boost partnerTest Rider');
  });

  it('starts hands-free when both arms are held out to the sides', () => {
    vi.useFakeTimers();
    let wide = false;
    const tracker = { presence: () => ({ body: true, offset: null, wide }) };
    const { props } = renderLobby({ tracker });
    act(() => vi.advanceTimersByTime(300));
    wide = true;
    act(() => vi.advanceTimersByTime(600));
    expect(props.onStart).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(600));
    expect(props.onStart).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(3000));   // still held: one press only
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });
});
