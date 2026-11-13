import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pad = vi.hoisted(() => ({ onKey: null }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }) }) }));
vi.mock('../../lib/useGamepadKeys.js', () => ({ useGamepadKeys: (active, onKey) => { pad.onKey = active ? onKey : null; } }));

import InvadersControls from './InvadersControls.jsx';
import GestureDemo from './GestureDemo.jsx';
import { GESTURES, GESTURE_INFO } from '../../lib/skylineInvaders/gestures.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';
import { createAimTracker } from './useInvadersAim.js';
import { poseForLane, wiperPose } from './invadersTestKit.js';

let tracker;
let listeners;
const bus = { subscribeToAppEvent: (type, cb) => { listeners.set(type, cb); return () => listeners.delete(type); } };
const mat = (type, id = 'mat-a1') => act(() => { listeners.get(type)?.({ type, payload: { id }, source: id, timestamp: Date.now() }); });
const key = (k) => act(() => { fireEvent.keyDown(window, { key: k }); });
const name = () => screen.getByTestId('invaders-controls-name').textContent;
const target = (id) => document.querySelector(`[data-practice-target="${id}"]`);
// Hold a pose for `ms`, a frame every 100 ms, with the clock moving.
const hold = (pose, ms) => { for (let t = 0; t < ms; t += 100) act(() => { tracker.processPoses(pose ? [pose] : []); vi.advanceTimersByTime(100); }); };

function renderControls(over = {}) {
  const props = {
    tracker, current: null, shooter: { id: 'kid', name: 'Kid' }, poseStatus: { state: 'detecting' }, matId: 'mat-a1',
    subscribeToAppEvent: bus.subscribeToAppEvent, onChoose: vi.fn(), onClose: vi.fn(), onTryout: vi.fn(), onCard: vi.fn(), onTick: vi.fn(), ...over,
  };
  return { props, ...render(<InvadersControls {...props} />) };
}

beforeEach(() => {
  vi.useFakeTimers();
  listeners = new Map();
  tracker = createAimTracker();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('GestureDemo', () => {
  it.each(GESTURES)('draws a moving figure for %s', (gesture) => {
    const { container } = render(<GestureDemo gesture={gesture} />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('data-demo')).toBe(gesture);
    expect(svg.classList.contains(`skyline-invaders__demo--${gesture}`)).toBe(true);
    expect(svg.querySelectorAll('.skyline-invaders__demo-move').length).toBeGreaterThan(0);   // something moves
    expect(svg.querySelectorAll('.skyline-invaders__demo-hand').length).toBeGreaterThan(0);
  });
});

describe('InvadersControls', () => {
  it('opens on the first card: the demo, the name, one line of how, and every control on screen', () => {
    renderControls();
    expect(name()).toBe('Wipers');
    expect(document.querySelector('[data-demo="wiper"]')).not.toBeNull();
    expect(screen.getByTestId('invaders-controls-how').textContent).toBe(GESTURE_INFO.wiper.how);
    expect(screen.getByText(/Kid: pick your controls · 1 of 8/)).toBeTruthy();
    expect(screen.getByTestId('invaders-controls-keys').textContent).toBe('STEP on the mat for the next one. STOMP to pick this one. Or tap a button, press any key, or A on the gamepad. Up and down change the card.');
    expect(['Use these controls', 'Next', 'Back', 'Not now'].map((label) => !!screen.getByRole('button', { name: new RegExp(`^${label}`) }))).toEqual([true, true, true, true]);
    expect(tracker.gesture()).toBe('wiper');
  });

  it('does not mention the mat when there is none', () => {
    renderControls({ matId: null });
    expect(screen.getByTestId('invaders-controls-keys').textContent).not.toMatch(/STEP|STOMP/);
  });

  it('a step on the shooter mat is the next card, and the tracker follows the card', () => {
    const { props } = renderControls();
    mat('pressure-mat:step');
    expect(name()).toBe('Twist');
    expect(tracker.gesture()).toBe('twist');
    mat('pressure-mat:step', 'mat-b2');
    expect(name()).toBe('Twist');
    expect(props.onTryout).toHaveBeenCalledTimes(1);
    expect(props.onTryout.mock.calls[0][0]).toMatchObject({ gesture: 'wiper', how: 'step' });
    expect(props.onCard.mock.calls.map(([gesture]) => gesture)).toEqual(['wiper', 'twist']);
  });

  it('a stomp picks the card in hand', () => {
    const { props } = renderControls();
    mat('pressure-mat:step');
    mat('pressure-mat:stomp');
    expect(props.onChoose).toHaveBeenCalledWith('twist', 'stomp');
    expect(props.onTryout.mock.calls[1][0]).toMatchObject({ gesture: 'twist', how: 'chosen-stomp' });
  });

  it('walks all eight cards and wraps, forward and back', () => {
    renderControls();
    const seen = [name()];
    for (let i = 0; i < 8; i += 1) { fireEvent.click(screen.getByRole('button', { name: /^Next/ })); seen.push(name()); }
    expect(seen).toEqual([...GESTURES.map((id) => GESTURE_INFO[id].label), 'Wipers']);
    fireEvent.click(screen.getByRole('button', { name: /^Back/ }));
    expect(name()).toBe('Hop');
  });

  it('is driven by the keyboard, the foot pad and the gamepad: a plain key picks, up and down turn the cards, Escape leaves', () => {
    const { props } = renderControls();
    key('ArrowDown');
    expect(name()).toBe('Twist');
    key('ArrowUp');
    expect(name()).toBe('Wipers');
    act(() => pad.onKey('ArrowDown'));
    expect(name()).toBe('Twist');
    key('m');                                  // a foot-pad letter presses the focused button: Use these controls
    expect(props.onChoose).toHaveBeenCalledWith('twist', 'button');
    key('ArrowRight'); key('Enter');           // focus moves to Next
    expect(name()).toBe('Wings');
    key('Escape');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('the real cannon follows the gesture and lights each practice target it rests on', () => {
    const { props } = renderControls();
    hold(wiperPose(0), 300);
    expect(target('left').getAttribute('data-lit')).toBe('false');
    hold(poseForLane(0), 1200);
    expect(document.querySelector('[data-cannon]').getAttribute('data-lane')).toBe('0');
    expect(target('left').getAttribute('data-reached')).toBe('true');
    expect(screen.getByTestId('invaders-controls-task').textContent).toBe('Light the three targets: 1 of 3');
    hold(poseForLane(7), 1200);
    hold(poseForLane(4), 1200);
    expect(['left', 'centre', 'right'].map((id) => target(id).getAttribute('data-reached'))).toEqual(['true', 'true', 'true']);
    expect(screen.getByTestId('invaders-controls-task').textContent).toBe('All three lit!');
    fireEvent.click(screen.getByRole('button', { name: /^Use these controls/ }));
    const summary = props.onTryout.mock.calls[0][0];
    expect(summary).toMatchObject({ gesture: 'wiper', how: 'chosen-button', reached: 3 });
    expect(summary.leftMs).toBeLessThan(summary.rightMs);
    expect(summary.rightMs).toBeLessThan(summary.centreMs);
    expect(props.onTick).toHaveBeenCalled();
    // Nothing falls and nothing is fired in a tryout.
    expect(document.querySelectorAll('[data-threat], [data-shot], [data-fuel-bar]')).toHaveLength(0);
  });

  it('moves on by itself after the card time, so eight cards cannot take five minutes', () => {
    const { props } = renderControls();
    act(() => { vi.advanceTimersByTime(INVADERS_TUNABLES.tryoutCardS * 1000 - 200); });
    expect(name()).toBe('Wipers');
    act(() => { vi.advanceTimersByTime(400); });
    expect(name()).toBe('Twist');
    expect(props.onTryout).toHaveBeenCalledTimes(1);
    expect(props.onTryout.mock.calls[0][0]).toMatchObject({ how: 'timeout', reached: 0 });
    expect(INVADERS_TUNABLES.tryoutCardS * GESTURES.length).toBeLessThanOrEqual(180);
  });

  it('opens on the gesture the shooter already has, offers to keep it, and logs a close', () => {
    const { props } = renderControls({ current: 'sprinkler' });
    expect(name()).toBe('Sprinkler');
    fireEvent.click(screen.getByRole('button', { name: /^Keep Sprinkler/ }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onTryout.mock.calls[0][0]).toMatchObject({ gesture: 'sprinkler', how: 'closed' });
    expect(props.onChoose).not.toHaveBeenCalled();
  });

  it('says why the cannon is not following: camera off, camera starting, or nobody in view', () => {
    const task = () => screen.getByTestId('invaders-controls-task').textContent;
    const first = renderControls({ poseStatus: { state: 'camera-denied' } });
    expect(task()).toMatch(/camera is off/);
    first.unmount();
    const second = renderControls({ poseStatus: { state: 'loading' } });
    expect(task()).toMatch(/camera is starting/);
    second.unmount();
    renderControls();
    act(() => { vi.advanceTimersByTime(100); });
    expect(task()).toMatch(/where the camera can see you/);
  });

  it('stops listening to the mat while a prompt covers it', () => {
    renderControls({ active: false });
    expect(listeners.size).toBe(0);
  });
});
