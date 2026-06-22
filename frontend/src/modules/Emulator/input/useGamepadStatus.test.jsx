import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { computeStatus, useGamepadStatus } from './useGamepadStatus.js';

const controllers = [
  { id: '8bitdo_sn30', label: '8BitDo SN30 Pro', match: '8BitDo' },
  { id: 'xbox', label: 'Xbox Wireless', match: 'Xbox|045e' },
  { id: 'dualshock', label: 'PlayStation DualShock', match: 'DualShock|054c' },
  { id: 'switch_pro', label: 'Switch Pro Controller', match: 'Pro Controller|057e', count: 2 },
];

/** Minimal fake Gamepad. */
function pad({ index = 0, id = 'Generic', buttons = [], axes = [] } = {}) {
  return {
    index,
    id,
    connected: true,
    buttons: buttons.map((pressed) => ({ pressed, value: pressed ? 1 : 0 })),
    axes,
  };
}

describe('computeStatus', () => {
  it('matches a pad to a controller config by regex (case-insensitive)', () => {
    const pads = [pad({ index: 0, id: '8BitDo SN30 Pro' })];
    const { connected } = computeStatus(pads, controllers, {});
    expect(connected).toHaveLength(1);
    expect(connected[0].slot).toBe(0);
    expect(connected[0].matchedId).toBe('8bitdo_sn30');
  });

  it('matches a pad by vendor hex substring (045e -> Xbox)', () => {
    const pads = [pad({ index: 1, id: 'Wireless Controller (Vendor: 045e Product: 02fd)' })];
    const { connected } = computeStatus(pads, controllers, {});
    expect(connected[0].matchedId).toBe('xbox');
  });

  it('unmatched pad gets matchedId null', () => {
    const pads = [pad({ index: 0, id: 'No Name Brand X' })];
    const { connected } = computeStatus(pads, controllers, {});
    expect(connected[0].matchedId).toBeNull();
  });

  it('filters out null gamepad slots', () => {
    const pads = [null, pad({ index: 2, id: 'Xbox' }), null];
    const { connected } = computeStatus(pads, controllers, {});
    expect(connected).toHaveLength(1);
    expect(connected[0].slot).toBe(2);
  });

  it('aggregates connectedCount when two pads match one config', () => {
    const pads = [
      pad({ index: 0, id: 'Switch Pro Controller' }),
      pad({ index: 1, id: 'Pro Controller #2' }),
    ];
    const { known } = computeStatus(pads, controllers, {});
    const sw = known.find((k) => k.id === 'switch_pro');
    expect(sw.connectedCount).toBe(2);
    expect(sw.connected).toBe(true);
    expect(sw.count).toBe(2); // expected count from config
  });

  it('defaults expected count to 1 when not configured', () => {
    const { known } = computeStatus([], controllers, {});
    const xbox = known.find((k) => k.id === 'xbox');
    expect(xbox.count).toBe(1);
    expect(xbox.connectedCount).toBe(0);
    expect(xbox.connected).toBe(false);
  });

  it('flags active when any button is pressed this poll', () => {
    const pads = [pad({ index: 0, id: 'Xbox', buttons: [false, true, false] })];
    const { connected } = computeStatus(pads, controllers, {});
    expect(connected[0].active).toBe(true);
  });

  it('flags active when an axis exceeds the deadzone', () => {
    const pads = [pad({ index: 0, id: 'Xbox', axes: [0.9, 0] })];
    const { connected } = computeStatus(pads, controllers, {});
    expect(connected[0].active).toBe(true);
  });

  it('idle pad (no press, axes within deadzone) is not active', () => {
    const pads = [pad({ index: 0, id: 'Xbox', buttons: [false, false], axes: [0.01, -0.02] })];
    const { connected } = computeStatus(pads, controllers, {});
    expect(connected[0].active).toBe(false);
  });

  it('tolerates empty/non-array controllersConfig', () => {
    const pads = [pad({ index: 0, id: 'Xbox' })];
    expect(computeStatus(pads, null, {}).known).toEqual([]);
    expect(computeStatus(pads, [], {}).connected[0].matchedId).toBeNull();
  });
});

describe('useGamepadStatus (hook)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function Probe({ getGamepads }) {
    const { connected, known } = useGamepadStatus(controllers, { getGamepads, pollMs: 100 });
    return (
      <div>
        <span data-testid="connected">{connected.length}</span>
        <span data-testid="known-connected">{known.filter((k) => k.connected).map((k) => k.id).join(',')}</span>
      </div>
    );
  }

  it('reports connected pads from injected getGamepads', () => {
    const getGamepads = () => [pad({ index: 0, id: '8BitDo SN30 Pro' })];
    let container;
    act(() => {
      ({ container } = render(<Probe getGamepads={getGamepads} />));
    });
    expect(container.querySelector('[data-testid="connected"]').textContent).toBe('1');
    expect(container.querySelector('[data-testid="known-connected"]').textContent).toBe('8bitdo_sn30');
  });

  it('picks up a newly connected pad on the poll interval', () => {
    let pads = [];
    const getGamepads = () => pads;
    let container;
    act(() => {
      ({ container } = render(<Probe getGamepads={getGamepads} />));
    });
    expect(container.querySelector('[data-testid="connected"]').textContent).toBe('0');
    pads = [pad({ index: 0, id: 'Xbox' })];
    act(() => vi.advanceTimersByTime(150));
    expect(container.querySelector('[data-testid="connected"]').textContent).toBe('1');
  });
});
