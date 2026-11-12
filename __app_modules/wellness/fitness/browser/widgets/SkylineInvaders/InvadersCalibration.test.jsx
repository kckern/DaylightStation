import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLog = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => mockLog }) }));
vi.mock('../../lib/useGamepadKeys.js', () => ({ useGamepadKeys: () => {} }));

import InvadersCalibration from './InvadersCalibration.jsx';

let seen;
let tracker;
const DETECTING = { state: 'detecting' };
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const step = () => screen.getByTestId('skyline-invaders-calibration').getAttribute('data-step');
const stand = () => { seen = { body: true, offset: null, wide: null }; };
const reach = (offset) => { seen = { body: true, offset, wide: false }; };
const key = (k) => act(() => { fireEvent.keyDown(window, { key: k }); });

function mount(over = {}) {
  const props = { tracker, poseStatus: DETECTING, onDone: vi.fn(), onSkip: vi.fn(), ...over };
  return { props, ...render(<InvadersCalibration {...props} />) };
}
// Framing, then both reaches held still.
async function passFraming() { stand(); tick(1100); }

beforeEach(() => {
  vi.useFakeTimers();
  mockLog.info.mockClear();
  seen = { body: false, offset: null, wide: null };
  tracker = { presence: () => seen, setCalibration: vi.fn() };
});
afterEach(() => vi.useRealTimers());

describe('InvadersCalibration', () => {
  it('waits on the framing step until head and shoulders have been in view for a second, hands or no hands', () => {
    mount();
    expect(step()).toBe('framing');
    tick(3000);
    expect(step()).toBe('framing');
    stand();
    tick(600);
    expect(step()).toBe('framing');
    tick(500);
    expect(step()).toBe('left');
  });

  it('restarts the framing second when the player steps out', () => {
    mount();
    stand(); tick(700);
    seen = { body: false, offset: null, wide: null }; tick(200);
    stand(); tick(700);
    expect(step()).toBe('framing');
    tick(400);
    expect(step()).toBe('left');
  });

  it('never asks for raised arms', () => {
    mount();
    passFraming();
    expect(screen.getByRole('heading').textContent).toMatch(/left/i);
    expect(document.body.textContent).not.toMatch(/above|overhead|over your head|raise/i);
  });

  it('does not capture a wobbling reach, and captures one that is held', () => {
    mount();
    passFraming();
    for (let i = 0; i < 20; i += 1) { reach(i % 2 ? -1.0 : -1.5); tick(100); }
    expect(step()).toBe('left');
    reach(-1.4); tick(900);
    expect(step()).toBe('right');
  });

  it('does not take hands resting in the middle for a reach', () => {
    mount();
    passFraming();
    reach(0.05); tick(2000);
    expect(step()).toBe('left');
  });

  it('sets the tracker calibration and reports it, left before right, after both reaches', () => {
    const { props } = mount();
    passFraming();
    reach(-1.4); tick(900);
    reach(1.2); tick(900);
    expect(tracker.setCalibration).toHaveBeenCalledTimes(1);
    const calibration = tracker.setCalibration.mock.calls[0][0];
    expect(calibration.left).toBeCloseTo(-1.4);
    expect(calibration.right).toBeCloseTo(1.2);
    expect(props.onDone).toHaveBeenCalledWith(calibration);
    expect(mockLog.info).toHaveBeenCalledWith('skyline_invaders.lobby.calibrated', expect.objectContaining({ left: expect.any(Number), right: expect.any(Number), span: expect.any(Number) }));
  });

  it('starts over at the left reach with a clear message when the two reaches are too close', () => {
    const { props } = mount();
    passFraming();
    reach(-0.45); tick(900);
    reach(0.45); tick(900);
    expect(props.onDone).not.toHaveBeenCalled();
    expect(tracker.setCalibration).not.toHaveBeenCalled();
    expect(step()).toBe('left');
    expect(screen.getByRole('alert').textContent).toMatch(/Reach further apart/);
  });

  it('can be driven by hand on every step: a press continues past framing and takes the reach as it stands', () => {
    const { props } = mount();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(step()).toBe('left');
    reach(-1.3); tick(150);
    key('Enter');
    expect(step()).toBe('right');
    reach(1.1); tick(150);
    fireEvent.click(screen.getByRole('button', { name: /Use this position/ }));
    expect(props.onDone).toHaveBeenCalledWith({ left: expect.closeTo(-1.3), right: expect.closeTo(1.1) });
  });

  it('says what is missing when a reach is pressed with no hands in view, and stays put', () => {
    mount();
    passFraming();
    stand();
    key('Enter');
    expect(step()).toBe('left');
    expect(screen.getByRole('alert').textContent).toMatch(/hands/i);
  });

  it('skips from any step by button, Escape or gamepad B', () => {
    const { props } = mount();
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    key('Escape');
    expect(props.onSkip).toHaveBeenCalledTimes(2);
  });

  it('shows why and offers only the skip when the camera is unavailable', () => {
    const { props } = mount({ poseStatus: { state: 'camera-denied', error: 'Permission denied' } });
    expect(screen.getByRole('alert').textContent).toMatch(/camera/i);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    key('Enter');
    expect(props.onSkip).toHaveBeenCalledTimes(1);
  });

  it('says the vision engine is still loading while it is', () => {
    mount({ poseStatus: { state: 'loading' } });
    expect(screen.getByText(/Vision engine loading/)).toBeTruthy();
  });

  it('logs each step it reaches', () => {
    mount();
    passFraming();
    expect(mockLog.info).toHaveBeenCalledWith('skyline_invaders.lobby.calibration.step', expect.objectContaining({ step: 'left' }));
  });

  it('leaves no timer behind on unmount', () => {
    const { unmount } = mount();
    passFraming();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
