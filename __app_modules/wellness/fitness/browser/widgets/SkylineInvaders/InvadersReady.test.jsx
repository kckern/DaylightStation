import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLog = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => mockLog }) }));

import InvadersReady from './InvadersReady.jsx';
import { GESTURE_INFO } from '../../lib/skylineInvaders/gestures.js';

let seen;
let tracker;
const DETECTING = { state: 'detecting' };
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const stand = () => { seen = { body: true, wide: null }; };
const leave = () => { seen = { body: false, wide: null }; };
const hold = () => Number(screen.getByRole('progressbar', { name: 'In view' }).getAttribute('aria-valuenow'));

function mount(over = {}) {
  const props = { tracker, poseStatus: DETECTING, onDone: vi.fn(), waveName: 'First Light', gesture: 'wiper', ...over };
  return { props, ...render(<InvadersReady {...props} />) };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockLog.info.mockClear();
  leave();
  tracker = { presence: () => seen };
});
afterEach(() => vi.useRealTimers());

describe('InvadersReady', () => {
  it('asks the defender onto the mat, and nothing else: no reach is measured', () => {
    mount();
    expect(screen.getByRole('heading').textContent).toBe('Stand on the mat.');
    expect(screen.getByTestId('skyline-invaders-ready').getAttribute('data-step')).toBe('framing');
    expect(screen.queryByText(/Reach/)).toBeNull();
    expect(screen.queryByLabelText('Steps')).toBeNull();
    expect(screen.getByText('First Light')).toBeTruthy();
  });

  it('starts the round once head and shoulders have been in view for a second, hands or no hands', () => {
    const { props } = mount();
    tick(3000);
    expect(props.onDone).not.toHaveBeenCalled();
    stand();
    tick(600);
    expect(props.onDone).not.toHaveBeenCalled();
    expect(hold()).toBeGreaterThan(40);
    tick(500);
    expect(props.onDone).toHaveBeenCalledTimes(1);
    tick(2000);
    expect(props.onDone).toHaveBeenCalledTimes(1);
    expect(mockLog.info).toHaveBeenCalledWith('skyline_invaders.lobby.ready.in_view', { elapsedMs: expect.any(Number) });
  });

  it('restarts the second when the defender steps out', () => {
    const { props } = mount();
    stand(); tick(700);
    leave(); tick(200);
    expect(hold()).toBe(0);
    stand(); tick(700);
    expect(props.onDone).not.toHaveBeenCalled();
    tick(400);
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });

  it('shows how the defender\'s own controls work, and how to fire', () => {
    const first = mount({ gesture: 'twist' });
    expect(screen.getByTestId('invaders-ready-how').textContent).toBe(GESTURE_INFO.twist.how);
    expect(screen.getByText('Step to fire · Keep stepping · Stomp for the bomb')).toBeTruthy();
    first.unmount();
    mount({ gesture: null, mat: false });
    expect(screen.queryByTestId('invaders-ready-how')).toBeNull();
    expect(screen.getByText('A or Space to fire · B or X for the bomb')).toBeTruthy();
  });

  it('does not poll a camera that is not there', () => {
    const { props } = mount({ poseStatus: { state: 'camera-denied' } });
    stand(); tick(3000);
    expect(props.onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId('skyline-invaders-ready').getAttribute('data-step')).toBe('unavailable');
  });
});
