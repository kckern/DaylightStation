// The header's destination control: "Playing on <name> ⌄" — never a hash — that
// opens the cast preferences, absorbs the cast icon, and answers a pending
// first-use naming prompt when it is reached for. Its name is the search
// chip's own (useDestinationLabel), so the phone header and the search agree.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const state = vi.hoisted(() => ({ targetIds: [], here: false, devices: [] }));
vi.mock("./useCastTarget.js", () => ({
  useCastTarget: () => ({ mode: 'transfer', targetIds: state.targetIds, setMode: vi.fn(), toggleTarget: vi.fn() }),
}));
vi.mock("../fleet/useFleetContext.js", () => ({ useFleetContext: () => ({ devices: state.devices }) }));
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import { CastTargetChip } from "./CastTargetChip.jsx";
import { CastTargetContext } from "./CastTargetProvider.jsx";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { ClientIdentityContext } from "../identity/ClientIdentityProvider.jsx";
import { DestinationChip } from "../search/DestinationChip.jsx";
import { habitsStore, resetHabitsStoreForTests } from "../habits/mediaHabits.js";

function renderChip(identity = { displayName: 'Browser 4778f429', firstUse: false, completeFirstUse: vi.fn() }, { withSearchChip = false } = {}) {
  const aim = { mode: 'transfer', targetIds: state.targetIds, here: state.here, setTargets: vi.fn(), setMode: vi.fn(), toggleTarget: vi.fn(), clearTargets: vi.fn() };
  render(
    <MantineProvider>
      <FleetContext.Provider value={{ devices: state.devices, loading: false, error: null, identity: { deviceId: 'browser:me' } }}>
        <CastTargetContext.Provider value={aim}>
          <ClientIdentityContext.Provider value={identity}>
            <CastTargetChip />
            {withSearchChip && <DestinationChip />}
          </ClientIdentityContext.Provider>
        </CastTargetContext.Provider>
      </FleetContext.Provider>
    </MantineProvider>,
  );
  return identity;
}

beforeEach(() => {
  localStorage.clear();
  resetHabitsStoreForTests();
  state.targetIds = [];
  state.here = false;
  state.devices = [{ id: 'kitchen', name: 'Kitchen' }, { id: 'living', name: 'Living Room' }];
});

describe('CastTargetChip as the destination control', () => {
  it('with nothing chosen and no usual screen it says a screen is still to choose — never "This device", never the machine hash', () => {
    renderChip();
    expect(screen.getByTestId('destination-control-name')).toHaveTextContent('Choose a screen');
    expect(screen.getByTestId('cast-target-chip')).toHaveAccessibleName(/^No screen chosen yet/);
    expect(document.body.textContent).not.toMatch(/Browser 4778f429/);
    expect(document.body.textContent).not.toMatch(/Playing on/);
  });

  it('This device chosen on purpose reads "Playing on This device"', () => {
    state.here = true;
    renderChip({ displayName: 'Kitchen iPad', firstUse: false, completeFirstUse: vi.fn() });
    expect(screen.getByTestId('destination-control-name')).toHaveTextContent('This device');
    expect(screen.getByTestId('cast-target-chip')).toHaveAccessibleName(/^Playing on This device/);
  });

  it('with nothing chosen it names the learned film screen', () => {
    habitsStore().recordScreen('video', ['living']);
    renderChip();
    expect(screen.getByTestId('destination-control-name')).toHaveTextContent('Living Room');
  });

  it('names several screens "Kitchen + Living Room"', () => {
    state.targetIds = ['kitchen', 'living'];
    renderChip();
    expect(screen.getByTestId('destination-control-name')).toHaveTextContent('Kitchen + Living Room');
  });

  it.each([
    ['nothing chosen', () => {}],
    ['This device', () => { state.here = true; }],
    ['learned', () => { habitsStore().recordScreen('video', ['kitchen']); }],
    ['aimed', () => { state.targetIds = ['living']; }],
  ])('agrees with the search chip: %s', (_name, arrange) => {
    arrange();
    renderChip(undefined, { withSearchChip: true });
    const header = screen.getByTestId('destination-control-name').textContent;
    expect(screen.getByTestId('search-destination-chip').textContent).toBe(`▶ ${header}`);
  });

  it('is one 44px-class control named "Playing on …" that opens the cast preferences', async () => {
    state.here = true;
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
