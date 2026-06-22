import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { ControllerStatus } from './ControllerStatus.jsx';

const controllers = [
  { id: '8bitdo_sn30', label: '8BitDo SN30 Pro', match: '8BitDo' },
  { id: 'xbox', label: 'Xbox Wireless', match: 'Xbox|045e' },
];

function pad({ index = 0, id = 'Generic', buttons = [] } = {}) {
  return {
    index,
    id,
    connected: true,
    buttons: buttons.map((pressed) => ({ pressed, value: pressed ? 1 : 0 })),
    axes: [],
  };
}

describe('ControllerStatus', () => {
  it('shows a connected 8BitDo in both known and connected lists', () => {
    const getGamepads = () => [pad({ index: 0, id: '8BitDo SN30 Pro' })];
    let container;
    act(() => {
      ({ container } = render(<ControllerStatus controllers={controllers} getGamepads={getGamepads} />));
    });

    const knownRow = container.querySelector('[data-controller-id="8bitdo_sn30"]');
    expect(knownRow).toBeTruthy();
    expect(knownRow.className).toContain('ccs-on');
    expect(knownRow.textContent).toContain('1 of 1 connected');

    const player = container.querySelector('.ccs-connected-row .ccs-player');
    expect(player).toBeTruthy();
    expect(player.textContent).toContain('Player 1');
    expect(player.textContent).toContain('8BitDo SN30 Pro');

    // Xbox row present but not connected.
    const xbox = container.querySelector('[data-controller-id="xbox"]');
    expect(xbox.className).not.toContain('ccs-on');
  });

  it('highlights the active pad (press-to-identify)', () => {
    const getGamepads = () => [pad({ index: 0, id: 'Xbox', buttons: [true] })];
    let container;
    act(() => {
      ({ container } = render(<ControllerStatus controllers={controllers} getGamepads={getGamepads} />));
    });
    const row = container.querySelector('.ccs-connected-row');
    expect(row.className).toContain('gp-active');
  });

  it('shows the keyboard-fallback empty state when nothing is connected', () => {
    const getGamepads = () => [];
    let container;
    act(() => {
      ({ container } = render(<ControllerStatus controllers={controllers} getGamepads={getGamepads} />));
    });
    expect(container.querySelector('.ccs-connected-row')).toBeNull();
    const empty = container.querySelector('.ccs-empty');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('keyboard always works');
    expect(empty.textContent).toContain('Enter = Start');
  });

  it('omits the OS badge entirely when btInventory is absent (browser-only mode)', () => {
    const getGamepads = () => [pad({ index: 0, id: '8BitDo SN30 Pro' })];
    let container;
    act(() => {
      ({ container } = render(<ControllerStatus controllers={controllers} getGamepads={getGamepads} />));
    });
    // Browser badge still works exactly as before.
    const knownRow = container.querySelector('[data-controller-id="8bitdo_sn30"]');
    expect(knownRow.textContent).toContain('1 of 1 connected');
    // No OS column anywhere.
    expect(container.querySelector('.ccs-os-badge')).toBeNull();
  });

  it('renders an OS badge with battery when btInventory matches by MAC', () => {
    const ctrls = [
      { id: '8bitdo_sn30', label: '8BitDo SN30 Pro', match: '8BitDo', address: 'AA:BB:CC:DD:EE:FF' },
      { id: 'xbox', label: 'Xbox Wireless', match: 'Xbox', address: '11:22:33:44:55:66' },
    ];
    const btInventory = [
      { address: 'aa:bb:cc:dd:ee:ff', name: '8BitDo', connected: true, battery: 75 },
    ];
    const getGamepads = () => [];
    let container;
    act(() => {
      ({ container } = render(
        <ControllerStatus controllers={ctrls} getGamepads={getGamepads} btInventory={btInventory} />,
      ));
    });

    const sn30 = container.querySelector('[data-controller-id="8bitdo_sn30"] .ccs-os-badge');
    expect(sn30).toBeTruthy();
    expect(sn30.className).toContain('ccs-os-on');
    expect(sn30.textContent).toContain('BT: connected');
    expect(sn30.textContent).toContain('75%');

    // Xbox MAC not in feed → BT: off.
    const xbox = container.querySelector('[data-controller-id="xbox"] .ccs-os-badge');
    expect(xbox).toBeTruthy();
    expect(xbox.className).toContain('ccs-os-off');
    expect(xbox.textContent).toContain('BT: off');
  });

  describe('pairing affordance', () => {
    it('renders no Pair button when onPair is absent', () => {
      const getGamepads = () => [];
      let container;
      act(() => {
        ({ container } = render(<ControllerStatus controllers={controllers} getGamepads={getGamepads} />));
      });
      expect(container.querySelector('.ccs-pair-button')).toBeNull();
    });

    it('renders the Pair button and calls onPair on click', () => {
      const onPair = vi.fn();
      const getGamepads = () => [];
      let container;
      act(() => {
        ({ container } = render(
          <ControllerStatus controllers={controllers} getGamepads={getGamepads} onPair={onPair} />,
        ));
      });
      const button = container.querySelector('.ccs-pair-button');
      expect(button).toBeTruthy();
      expect(button.textContent).toContain('Pair controller');
      expect(button.disabled).toBe(false);
      act(() => button.click());
      expect(onPair).toHaveBeenCalledTimes(1);
    });

    it('shows scanning label + disabled + progress affordance while scanning', () => {
      const onPair = vi.fn();
      const getGamepads = () => [];
      let container;
      act(() => {
        ({ container } = render(
          <ControllerStatus
            controllers={controllers}
            getGamepads={getGamepads}
            onPair={onPair}
            pairing={{ phase: 'scanning', durationMs: 30000 }}
          />,
        ));
      });
      const button = container.querySelector('.ccs-pair-button');
      expect(button.disabled).toBe(true);
      expect(button.textContent).toContain('Scanning for controllers');
      expect(container.querySelector('.ccs-pair-progress')).toBeTruthy();
    });

    it('shows "Paired: {name}" on the paired phase', () => {
      const getGamepads = () => [];
      let container;
      act(() => {
        ({ container } = render(
          <ControllerStatus
            controllers={controllers}
            getGamepads={getGamepads}
            onPair={vi.fn()}
            pairing={{ phase: 'paired', device: { name: '8BitDo SN30 Pro' } }}
          />,
        ));
      });
      const button = container.querySelector('.ccs-pair-button');
      expect(button.textContent).toContain('Paired: 8BitDo SN30 Pro');
    });

    it('shows "Done — N paired" and re-enables on the done phase', () => {
      const getGamepads = () => [];
      let container;
      act(() => {
        ({ container } = render(
          <ControllerStatus
            controllers={controllers}
            getGamepads={getGamepads}
            onPair={vi.fn()}
            pairing={{ phase: 'done', paired: [{ name: 'A' }, { name: 'B' }] }}
          />,
        ));
      });
      const button = container.querySelector('.ccs-pair-button');
      expect(button.textContent).toContain('Done — 2 paired');
      expect(button.disabled).toBe(false);
    });

    it('shows the error message and re-enables on the error phase', () => {
      const onPair = vi.fn();
      const getGamepads = () => [];
      let container;
      act(() => {
        ({ container } = render(
          <ControllerStatus
            controllers={controllers}
            getGamepads={getGamepads}
            onPair={onPair}
            pairing={{ phase: 'error', message: 'bridge offline' }}
          />,
        ));
      });
      const button = container.querySelector('.ccs-pair-button');
      expect(button.textContent).toContain('Pairing failed — bridge offline');
      expect(button.disabled).toBe(false);
      act(() => button.click());
      expect(onPair).toHaveBeenCalledTimes(1);
    });
  });
});
