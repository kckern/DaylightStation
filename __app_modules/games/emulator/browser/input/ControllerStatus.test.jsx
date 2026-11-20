import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { ControllerStatus } from "./ControllerStatus.jsx";

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
    expect(sn30.textContent).toContain('Ready');
    expect(sn30.textContent).toContain('75%');

    // Xbox MAC not in the bonded inventory → not paired.
    const xbox = container.querySelector('[data-controller-id="xbox"] .ccs-os-badge');
    expect(xbox).toBeTruthy();
    expect(xbox.className).toContain('ccs-os-off');
    expect(xbox.textContent).toContain('Not paired');
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

  describe('guided pairing (steps from config)', () => {
    const guided = [{
      id: '8bitdo_sfc30', label: '8BitDo SFC30', match: '8Bitdo', address: 'E4:17:D8:C6:54:F0',
      pairing: { pin: '0000', mode: 'Android (D-input)', steps: ['Hold START 3s.', 'Hold SELECT 3s until it blinks fast.'] },
    }];

    it('Pair opens the steps first; start sends targets with the PIN', () => {
      const onPair = vi.fn();
      let container;
      act(() => {
        ({ container } = render(<ControllerStatus controllers={guided} getGamepads={() => []} btInventory={[]} onPair={onPair} />));
      });
      act(() => container.querySelector('.ccs-pair-button').click());
      expect(onPair).not.toHaveBeenCalled();
      const steps = [...container.querySelectorAll('.ccs-guide-steps li')].map((li) => li.textContent);
      expect(steps).toEqual(['Hold START 3s.', 'Hold SELECT 3s until it blinks fast.']);
      act(() => container.querySelector('.ccs-guide-start').click());
      expect(onPair).toHaveBeenCalledWith({
        controllerId: '8bitdo_sfc30',
        targets: [{ id: '8bitdo_sfc30', label: '8BitDo SFC30', name: '8Bitdo', macPrefix: 'E4:17:D8', pin: '0000' }],
        mode: 'repair',
      });
    });

    it('keeps the steps on screen with live progress while the window runs', () => {
      let container;
      act(() => {
        ({ container } = render(
          <ControllerStatus controllers={guided} getGamepads={() => []} btInventory={[]} onPair={vi.fn()}
            pairing={{ phase: 'pairing', device: { name: '8Bitdo SFC30 GamePad' } }} />,
        ));
      });
      expect(container.querySelectorAll('.ccs-guide-steps li').length).toBe(2);
      expect(container.querySelector('.ccs-pair-status').textContent).toMatch(/Pairing 8Bitdo SFC30 GamePad/);
      expect(container.querySelector('.ccs-guide-start').disabled).toBe(true);
    });

    it('a pad dialing in without a bond says so and offers Pair', () => {
      let container;
      act(() => {
        ({ container } = render(
          <ControllerStatus controllers={guided} getGamepads={() => []} onPair={vi.fn()} onForget={vi.fn()}
            btInventory={[{ address: 'E4:17:D8:C6:54:F0', name: '8Bitdo SFC30 GamePad', connected: true, paired: false, attempting: true }]} />,
        ));
      });
      const row = container.querySelector('[data-controller-id="8bitdo_sfc30"]');
      expect(row.dataset.osStatus).toBe('unpaired');
      expect(row.querySelector('.ccs-unpaired-notice').textContent).toMatch(/trying to connect but isn.t paired/);
      // No bond → nothing to forget.
      expect(row.querySelector('.ccs-forget-button')).toBeNull();
      act(() => row.querySelector('.ccs-unpaired-notice button').click());
      expect(container.querySelector('.ccs-guide-steps')).toBeTruthy();
    });

    it('an asleep bonded pad says press START', () => {
      let container;
      act(() => {
        ({ container } = render(
          <ControllerStatus controllers={guided} getGamepads={() => []}
            btInventory={[{ address: 'E4:17:D8:C6:54:F0', name: '8Bitdo SFC30 GamePad', connected: false, paired: true, input: false }]} />,
        ));
      });
      expect(container.querySelector('.ccs-os-badge').textContent).toMatch(/press START/);
    });

    it('a successful forget tells you how to pair again', () => {
      let container;
      act(() => {
        ({ container } = render(
          <ControllerStatus controllers={guided} getGamepads={() => []} btInventory={[]}
            forgetResult={{ address: 'E4:17:D8:C6:54:F0', success: true }} />,
        ));
      });
      expect(container.querySelector('.ccs-forget-result').textContent)
        .toBe('Forgotten. To use it again, put the controller in pairing mode and press Pair controller.');
    });
  });

  describe('forget affordance', () => {
    const ctrlsWithAddr = [
      { id: '8bitdo_sn30', label: '8BitDo SN30 Pro', match: '8BitDo', address: 'AA:BB:CC:DD:EE:FF' },
    ];
    const btInventory = [
      { address: 'aa:bb:cc:dd:ee:ff', name: '8BitDo', connected: true, battery: 75 },
    ];
    const getGamepads = () => [pad({ index: 0, id: '8BitDo SN30 Pro' })];

    it('renders a Forget button for a known row with an address and calls onForget with that address', () => {
      const onForget = vi.fn();
      let container;
      act(() => {
        ({ container } = render(
          <ControllerStatus
            controllers={ctrlsWithAddr}
            getGamepads={getGamepads}
            btInventory={btInventory}
            onForget={onForget}
          />,
        ));
      });
      const button = container.querySelector('[data-controller-id="8bitdo_sn30"] .ccs-forget-button');
      expect(button).toBeTruthy();
      act(() => button.click());
      expect(onForget).toHaveBeenCalledTimes(1);
      expect(onForget).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
    });

    it('renders no Forget button when onForget is absent (backward-compatible)', () => {
      let container;
      act(() => {
        ({ container } = render(
          <ControllerStatus
            controllers={ctrlsWithAddr}
            getGamepads={getGamepads}
            btInventory={btInventory}
          />,
        ));
      });
      expect(container.querySelector('.ccs-forget-button')).toBeNull();
    });

    it('renders no Forget button for a row with no address even when onForget is provided', () => {
      const onForget = vi.fn();
      const noAddr = [{ id: 'xbox', label: 'Xbox Wireless', match: 'Xbox' }];
      let container;
      act(() => {
        ({ container } = render(
          <ControllerStatus
            controllers={noAddr}
            getGamepads={() => [pad({ index: 0, id: 'Xbox' })]}
            onForget={onForget}
          />,
        ));
      });
      expect(container.querySelector('[data-controller-id="xbox"] .ccs-forget-button')).toBeNull();
    });
  });
});

describe('ControllerStatus — add a new device', () => {
  const SFC30 = { id: '8bitdo_sfc30', label: '8BitDo SFC30', match: '8Bitdo', address: 'E4:17:D8:C6:54:F0',
    pairing: { steps: ['Hold SELECT.'] } };

  it('opens the generic steps and sends an add-mode request', () => {
    const onPair = vi.fn();
    const { getByRole, getByText } = render(
      <ControllerStatus controllers={[SFC30]} getGamepads={() => []} btInventory={[]} onPair={onPair} />,
    );
    fireEvent.click(getByRole('button', { name: /Add a new device/ }));
    expect(getByText(/put it in pairing mode/i)).toBeTruthy();
    fireEvent.click(getByRole('button', { name: /Start search/ }));
    expect(onPair).toHaveBeenCalledTimes(1);
    expect(onPair.mock.calls[0][0].mode).toBe('add');
    expect(onPair.mock.calls[0][0].controllerId).toBeNull();
  });

  it('keeps the add panel open while an add window runs', () => {
    const { rerender, getByRole, container } = render(
      <ControllerStatus controllers={[SFC30]} getGamepads={() => []} btInventory={[]} onPair={vi.fn()} />,
    );
    fireEvent.click(getByRole('button', { name: /Add a new device/ }));
    fireEvent.click(getByRole('button', { name: /Start search/ }));
    rerender(<ControllerStatus controllers={[SFC30]} getGamepads={() => []} btInventory={[]} onPair={vi.fn()}
      pairing={{ phase: 'scanning', durationMs: 60000, mode: 'add' }} />);
    expect(container.querySelector('.ccs-add-guide')).toBeTruthy();
    expect(container.querySelector('.ccs-pair-guide:not(.ccs-add-guide)')).toBeNull();
  });

  it('a fresh mount mid add-window shows the add panel, not the repair guide', () => {
    const { container } = render(
      <ControllerStatus controllers={[SFC30]} getGamepads={() => []} btInventory={[]} onPair={vi.fn()}
        pairing={{ phase: 'found', mode: 'add', device: { name: 'R1' } }} />,
    );
    expect(container.querySelector('.ccs-add-guide')).toBeTruthy();
    expect(container.querySelector('.ccs-pair-guide:not(.ccs-add-guide)')).toBeNull();
  });

  it('repair pairing still sends repair mode', () => {
    const onPair = vi.fn();
    const { getByRole } = render(
      <ControllerStatus controllers={[SFC30]} getGamepads={() => []} btInventory={[]} onPair={onPair} />,
    );
    fireEvent.click(getByRole('button', { name: /Pair controller/ }));
    fireEvent.click(getByRole('button', { name: /start pairing/ }));
    expect(onPair.mock.calls[0][0].mode).toBe('repair');
  });
});

describe('ControllerStatus — other Bluetooth devices', () => {
  it('lists an unconfigured input device with status, battery and Forget', () => {
    const onForget = vi.fn();
    const inv = [{ address: '11:22:33:44:55:66', name: 'R1', connected: true, paired: true, input: true, kind: 'keyboard', battery: 80 }];
    const { container, getByRole } = render(
      <ControllerStatus controllers={[]} getGamepads={() => []} btInventory={inv} onForget={onForget} />,
    );
    const row = container.querySelector('.ccs-other-row[data-address="11:22:33:44:55:66"]');
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('R1');
    expect(row.textContent).toContain('Ready');
    expect(row.textContent).toContain('80%');
    fireEvent.click(getByRole('button', { name: 'Forget R1' }));
    expect(onForget).toHaveBeenCalledWith('11:22:33:44:55:66');
  });

  it('renders no other-devices section without a BT feed', () => {
    const { container } = render(<ControllerStatus controllers={[]} getGamepads={() => []} />);
    expect(container.querySelector('.ccs-other')).toBeNull();
  });
});

describe('ControllerStatus — panel state', () => {
  const SFC30 = { id: '8bitdo_sfc30', label: '8BitDo SFC30', match: '8Bitdo', address: 'E4:17:D8:C6:54:F0',
    pairing: { steps: ['Hold SELECT.'] } };
  const OLD = { phase: 'done', reason: 'already-paired', requestId: 'old', paired: [{ name: '8Bitdo SFC30 GamePad' }] };

  it('a newly opened add panel does not show the previous window\'s result', () => {
    const { getByRole, container } = render(
      <ControllerStatus controllers={[SFC30]} getGamepads={() => []} btInventory={[]} onPair={vi.fn()} pairing={OLD} />,
    );
    fireEvent.click(getByRole('button', { name: /Add a new device/ }));
    const panel = container.querySelector('.ccs-add-guide');
    expect(panel.querySelector('.ccs-pair-status')).toBeNull();
    expect(panel.querySelector('.ccs-guide-start').textContent).toBe('Start search');
  });

  it('a newly opened repair guide does not show the previous window\'s retry', () => {
    const failed = { phase: 'done', paired: [], requestId: 'old' };
    const { getByRole, container } = render(
      <ControllerStatus controllers={[SFC30]} getGamepads={() => []} btInventory={[]} onPair={vi.fn()} pairing={failed} />,
    );
    fireEvent.click(getByRole('button', { name: /Pair controller/ }));
    const guide = container.querySelector('.ccs-pair-guide');
    expect(guide.querySelector('.ccs-pair-status')).toBeNull();
    expect(guide.querySelector('.ccs-guide-start').textContent).toMatch(/start pairing/);
  });

  it('shows the result of a window this panel started', () => {
    const onPair = vi.fn(() => 'new');
    const props = { controllers: [SFC30], getGamepads: () => [], btInventory: [], onPair };
    const { getByRole, container, rerender } = render(<ControllerStatus {...props} pairing={OLD} />);
    fireEvent.click(getByRole('button', { name: /Add a new device/ }));
    fireEvent.click(getByRole('button', { name: /Start search/ }));
    rerender(<ControllerStatus {...props} pairing={{ phase: 'done', paired: [], requestId: 'new', mode: 'add' }} />);
    expect(container.querySelector('.ccs-add-guide .ccs-pair-status').textContent).toMatch(/No new device found/);
    expect(container.querySelector('.ccs-add-guide .ccs-guide-start').textContent).toBe('Try again');
  });

  it('Pair on an unpaired configured pad closes the add panel and opens its guide', () => {
    const inv = [{ address: 'E4:17:D8:C6:54:F0', name: '8Bitdo SFC30 GamePad', connected: true, paired: false, attempting: true }];
    const { getByRole, container } = render(
      <ControllerStatus controllers={[SFC30]} getGamepads={() => []} btInventory={inv} onPair={vi.fn()} />,
    );
    fireEvent.click(getByRole('button', { name: /Add a new device/ }));
    expect(container.querySelector('.ccs-add-guide')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Pair 8BitDo SFC30' }));
    expect(container.querySelector('.ccs-add-guide')).toBeNull();
    expect(container.querySelector('.ccs-guide-steps').textContent).toContain('Hold SELECT.');
  });

  it('add-mode progress uses device wording', () => {
    const { container } = render(
      <ControllerStatus controllers={[SFC30]} getGamepads={() => []} btInventory={[]} onPair={vi.fn()}
        pairing={{ phase: 'scanning', durationMs: 60000, mode: 'add', requestId: 'n' }} />,
    );
    expect(container.querySelector('.ccs-add-guide .ccs-pair-status').textContent).toMatch(/Looking for the device/);
  });

  it('forgetting an unconfigured device says to use Add a new device', () => {
    const { container } = render(
      <ControllerStatus controllers={[SFC30]} getGamepads={() => []} btInventory={[]}
        forgetResult={{ address: '11:22:33:44:55:66', success: true }} />,
    );
    expect(container.querySelector('.ccs-forget-result').textContent)
      .toBe('Forgotten. To use it again, put it in pairing mode and press Add a new device.');
  });

  it('shows the last result next to the Pair button when there are no guides', () => {
    const { container } = render(
      <ControllerStatus controllers={[]} getGamepads={() => []} onPair={vi.fn()}
        pairing={{ phase: 'done', reason: 'no-input', paired: [] }} />,
    );
    expect(container.querySelector('.ccs-pair .ccs-pair-status').textContent).toMatch(/never came up/);
  });

  it('does not repeat the Pair button label as a status line', () => {
    const { container } = render(
      <ControllerStatus controllers={[]} getGamepads={() => []} onPair={vi.fn()}
        pairing={{ phase: 'error', message: 'bridge offline' }} />,
    );
    expect(container.querySelector('.ccs-pair .ccs-pair-status')).toBeNull();
  });

  it('the Add button is disabled while any window runs', () => {
    const { getByRole } = render(
      <ControllerStatus controllers={[]} getGamepads={() => []} onPair={vi.fn()}
        pairing={{ phase: 'pairing', device: { name: 'X' } }} />,
    );
    expect(getByRole('button', { name: /Add a new device/ }).disabled).toBe(true);
  });

  it('moves focus to the start button when a panel opens', () => {
    const { getByRole } = render(
      <ControllerStatus controllers={[SFC30]} getGamepads={() => []} btInventory={[]} onPair={vi.fn()} />,
    );
    fireEvent.click(getByRole('button', { name: /Add a new device/ }));
    expect(document.activeElement).toBe(getByRole('button', { name: 'Start search' }));
    fireEvent.click(getByRole('button', { name: 'Close' }));
    fireEvent.click(getByRole('button', { name: /Pair controller/ }));
    expect(document.activeElement).toBe(getByRole('button', { name: /start pairing/ }));
  });

  it('button emoji are hidden from the accessible name', () => {
    const { getByRole } = render(
      <ControllerStatus controllers={[SFC30]} getGamepads={() => []} btInventory={[]} onPair={vi.fn()} />,
    );
    expect(getByRole('button', { name: 'Add a new device' })).toBeTruthy();
    expect(getByRole('button', { name: 'Pair controller' })).toBeTruthy();
  });

  it('an unpaired other device offers Add again, which opens the add panel', () => {
    const inv = [{ address: '11:22:33:44:55:66', name: 'R1', connected: true, paired: false, kind: 'keyboard' }];
    const { getByRole, container } = render(
      <ControllerStatus controllers={[]} getGamepads={() => []} btInventory={inv} onPair={vi.fn()} onForget={vi.fn()} />,
    );
    const row = container.querySelector('.ccs-other-row');
    expect(row.querySelector('.ccs-forget-button')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Add R1 again' }));
    expect(container.querySelector('.ccs-add-guide')).toBeTruthy();
  });
});
