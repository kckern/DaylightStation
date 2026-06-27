import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { computeStatus, mergeKnown, useGamepadStatus } from './useGamepadStatus.js';

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
    expect(computeStatus(pads, null).known).toEqual([]);
    expect(computeStatus(pads, []).connected[0].matchedId).toBeNull();
  });
});

describe('mergeKnown (OS-level BT inventory merge)', () => {
  const withAddr = [
    { id: '8bitdo_sn30', label: '8BitDo', match: '8BitDo', address: 'AA:BB:CC:DD:EE:FF' },
    { id: 'xbox', label: 'Xbox', match: 'Xbox', address: '11:22:33:44:55:66' },
    { id: 'no_addr', label: 'No Address', match: 'Nope' }, // no address field
  ];

  it('no btInventory → os is null for every row', () => {
    const known = mergeKnown(withAddr, []);
    expect(known.every((k) => k.os === null)).toBe(true);
  });

  it('matching address in feed → os.connected true + battery (case-insensitive)', () => {
    const bt = [{ address: 'aa:bb:cc:dd:ee:ff', name: '8BitDo', connected: true, battery: 75 }];
    const known = mergeKnown(withAddr, [], bt);
    const row = known.find((k) => k.id === '8bitdo_sn30');
    expect(row.os).toEqual({ connected: true, battery: 75 });
  });

  it('address present but NOT in feed → os.connected false, battery null', () => {
    const bt = [{ address: 'AA:BB:CC:DD:EE:FF', name: '8BitDo', connected: true, battery: 90 }];
    const known = mergeKnown(withAddr, [], bt);
    const row = known.find((k) => k.id === 'xbox'); // its MAC is absent from feed
    expect(row.os).toEqual({ connected: false, battery: null });
  });

  it('feed device present but connected:false → os.connected false', () => {
    const bt = [{ address: 'AA:BB:CC:DD:EE:FF', name: '8BitDo', connected: false, battery: null }];
    const row = mergeKnown(withAddr, [], bt).find((k) => k.id === '8bitdo_sn30');
    expect(row.os).toEqual({ connected: false, battery: null });
  });

  it('controller with no address field → os null even when feed present', () => {
    const bt = [{ address: 'AA:BB:CC:DD:EE:FF', name: 'x', connected: true, battery: 50 }];
    const row = mergeKnown(withAddr, [], bt).find((k) => k.id === 'no_addr');
    expect(row.os).toBeNull();
  });

  it('missing battery in matched device → battery null but connected preserved', () => {
    const bt = [{ address: 'AA:BB:CC:DD:EE:FF', name: '8BitDo', connected: true }];
    const row = mergeKnown(withAddr, [], bt).find((k) => k.id === '8bitdo_sn30');
    expect(row.os).toEqual({ connected: true, battery: null });
  });

  it('computeStatus threads btInventory into known', () => {
    const bt = [{ address: 'AA:BB:CC:DD:EE:FF', name: '8BitDo', connected: true, battery: 42 }];
    const { known } = computeStatus([], withAddr, { btInventory: bt });
    expect(known.find((k) => k.id === '8bitdo_sn30').os).toEqual({ connected: true, battery: 42 });
  });

  it('carries the controller address onto the known row', () => {
    const rows = mergeKnown([{ id: 'a', label: '8BitDo', address: 'AA:BB:CC:DD:EE:FF' }], [], null);
    expect(rows[0].address).toBe('AA:BB:CC:DD:EE:FF');
  });

  it('address is null when the config has none', () => {
    const rows = mergeKnown([{ id: 'b', label: 'Pad' }], [], null);
    expect(rows[0].address).toBe(null);
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
