import { describe, it, expect } from 'vitest';
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
});
