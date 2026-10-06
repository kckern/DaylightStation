// The header's destination control: "Playing on <name> ⌄" — never a hash — that
// opens the cast preferences, absorbs the cast icon, and answers a pending
// first-use naming prompt when it is reached for.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const state = vi.hoisted(() => ({ targetIds: [], devices: [] }));
vi.mock('./useCastTarget.js', () => ({
  useCastTarget: () => ({ mode: 'transfer', targetIds: state.targetIds, setMode: vi.fn(), toggleTarget: vi.fn() }),
}));
vi.mock('../fleet/useFleetContext.js', () => ({ useFleetContext: () => ({ devices: state.devices }) }));

import { CastTargetChip } from './CastTargetChip.jsx';
import { ClientIdentityContext } from '../identity/ClientIdentityProvider.jsx';

function renderChip(identity = { displayName: 'Browser 4778f429', firstUse: false, completeFirstUse: vi.fn() }) {
  render(
    <MantineProvider>
      <ClientIdentityContext.Provider value={identity}><CastTargetChip /></ClientIdentityContext.Provider>
    </MantineProvider>,
  );
  return identity;
}

beforeEach(() => { state.targetIds = []; state.devices = [{ id: 'kitchen', name: 'Kitchen' }, { id: 'living', name: 'Living Room' }]; });

describe('CastTargetChip as the destination control', () => {
  it('reads "Playing on this device" for a browser nobody has named — never the machine hash', () => {
    renderChip();
    expect(screen.getByTestId('destination-control-name')).toHaveTextContent('This device');
    expect(document.body.textContent).not.toMatch(/Browser 4778f429/);
  });

  it("reads this browser's own name once it has one", () => {
    renderChip({ displayName: 'Kitchen iPad', firstUse: false, completeFirstUse: vi.fn() });
    expect(screen.getByTestId('destination-control-name')).toHaveTextContent('Kitchen iPad');
  });

  it('names several screens "Kitchen + Living Room"', () => {
    state.targetIds = ['kitchen', 'living'];
    renderChip();
    expect(screen.getByTestId('destination-control-name')).toHaveTextContent('Kitchen + Living Room');
  });

  it('is one 44px-class control named "Playing on …" that opens the cast preferences', async () => {
    renderChip();
    const control = screen.getByTestId('cast-target-chip');
    expect(control).toHaveAccessibleName(/^Playing on This device/);
    expect(control).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(control);
    expect(await screen.findByTestId('cast-popover')).toBeInTheDocument();
    expect(screen.getByTestId('cast-target-checkbox-kitchen')).toBeInTheDocument();
    expect(screen.getByTestId('cast-mode-fork')).toBeInTheDocument();
  });

  it('answers a pending first-use naming prompt ("Not now") when it is reached for', () => {
    const identity = renderChip({ displayName: null, firstUse: true, completeFirstUse: vi.fn() });
    fireEvent.click(screen.getByTestId('cast-target-chip'));
    expect(identity.completeFirstUse).toHaveBeenCalledWith('skipped');
  });
});
