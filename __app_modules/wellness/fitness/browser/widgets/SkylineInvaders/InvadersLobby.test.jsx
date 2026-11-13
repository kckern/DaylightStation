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
    poseStatus: DETECTING, controls: { gesture: 'wiper' }, onPickControls: vi.fn(),
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

  it('sends a shooter who has not picked their controls to the intro before they can start', () => {
    const { props } = renderLobby({ controls: null });
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
    const pick = screen.getByRole('button', { name: /Pick your controls/ });
    expect(pick.classList.contains('is-primary')).toBe(true);
    fireEvent.click(pick);
    key('Enter');
    expect(props.onPickControls).toHaveBeenCalledTimes(2);
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it('a shooter with saved controls goes straight to Start, with Change controls beside it', () => {
    const { props } = renderLobby({ controls: { gesture: 'twist' } });
    expect(screen.getByRole('button', { name: /^Start/ }).classList.contains('is-primary')).toBe(true);
    expect(screen.getByTestId('invaders-controls-chosen').textContent).toBe('ControlsTwist');
    const change = screen.getByRole('button', { name: /Change controls/ });
    expect(change.textContent).toContain('Twist');
    fireEvent.click(change);
    expect(props.onPickControls).toHaveBeenCalledTimes(1);
  });

  it('ignores a saved gesture the game no longer has', () => {
    renderLobby({ controls: { gesture: 'offset' } });
    expect(screen.getByRole('button', { name: /Pick your controls/ })).toBeTruthy();
  });

  it('does not block on a loading camera: Start works on gamepad aim and the note says the camera is starting', () => {
    const { props } = renderLobby({ controls: null, poseStatus: { state: 'loading' } });
    expect(screen.getByText(/Camera starting/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Start/ }));
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it('says how to aim when the camera is unavailable, and starts without any controls picked', () => {
    const { props } = renderLobby({ controls: null, poseStatus: { state: 'camera-denied' } });
    expect(screen.getByText(/Camera off/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /controls/ })).toBeNull();
    key('Enter');
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it('says whether the camera can see the shooter', () => {
    vi.useFakeTimers();
    let body = false;
    renderLobby({ tracker: { presence: () => ({ body, wide: null }) } });
    expect(screen.getByTestId('invaders-camera-note').textContent).toBe('Stand on the mat where the camera can see you');
    body = true;
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('invaders-camera-note').textContent).toBe('The camera can see you');
  });

  it('has an Exit button, and Escape leaves the game', () => {
    const onExit = vi.fn();
    renderLobby({ onExit });
    fireEvent.click(screen.getByRole('button', { name: /^Exit/ }));
    expect(onExit).toHaveBeenLastCalledWith('button');
    key('Escape');
    expect(onExit).toHaveBeenLastCalledWith('back');
    expect(screen.getByText(/Escape or B leaves the game/)).toBeTruthy();
  });

  it('Escape closes the shooter picker before it leaves the game, and there is no Exit without a way out', () => {
    const onExit = vi.fn();
    const first = renderLobby({ onExit });
    fireEvent.click(screen.getByRole('button', { name: 'Change shooter' }));
    key('Escape');
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Who is shooting?' })).toBeNull();
    first.unmount();
    renderLobby();
    expect(screen.queryByRole('button', { name: /^Exit/ })).toBeNull();
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
    const { props } = renderLobby();
    key('ArrowDown');
    key('Enter');
    expect(props.onPickControls).toHaveBeenCalledTimes(1);
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it('notes a missing step mat and still lets the shooter be picked', () => {
    const { props } = renderLobby({ mat: null, shooter: null });
    expect(screen.getByText(/No step mat found/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: 'Who is shooting?' })).getByRole('button', { name: 'Kid' }));
    expect(props.onPickShooter).toHaveBeenCalledWith('kid');
  });

  it('only tells the players to do what they can do: arms and mat, or gamepad and keys', () => {
    const first = renderLobby();
    expect(screen.getByTestId('invaders-howto').textContent).toBe('Elbows in, hands up. Tilt your forearms left and right like wipers. Step on the mat to fire, and keep stepping to keep firing.');
    first.unmount();
    renderLobby({ mat: null, controls: null, poseStatus: { state: 'camera-denied' } });
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
    const tracker = { presence: () => ({ body: true, wide }) };
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
