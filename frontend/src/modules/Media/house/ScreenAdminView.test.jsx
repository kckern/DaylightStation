// RQ-HOUSE-08 (HOUSE.6a): add a screen with a name and room, name/room any
// screen, merge a duplicate (confirm, then Undo/Unmerge), retire after the
// routines are shown, "Not seen lately", restore.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { DispatchContext } from '../cast/DispatchProvider.jsx';

const ctx = vi.hoisted(() => ({ registry: null }));
const api = vi.hoisted(() => ({}));
vi.mock('../fleet/useFleetContext.js', () => ({ useFleetContext: () => ({ registry: ctx.registry, devices: [] }) }));
vi.mock('./houseApi.js', async (orig) => ({ ...(await orig()), houseApi: api }));

import { ScreenAdminView } from './ScreenAdminView.jsx';

const recordLocal = vi.fn();
const wrap = () => render(
  <MantineProvider>
    <DispatchContext.Provider value={{ recordLocal }}><ScreenAdminView /></DispatchContext.Provider>
  </MantineProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  const screens = [
    { id: 'fleet:livingroom-tv', kind: 'screen', name: 'Den TV', wasName: 'Living Room TV', room: 'Den', online: true, aliases: [] },
    { id: 'browser:new', kind: 'browser', name: 'Kitchen tablet (aaaa1111)', room: null, lastSeen: new Date().toISOString(), aliases: [] },
    { id: 'browser:old', kind: 'browser', name: 'Kitchen tablet', room: 'Kitchen', lastSeen: new Date().toISOString(), aliases: [] },
  ];
  const byId = new Map(screens.map((s) => [s.id, s]));
  ctx.registry = {
    loaded: true, available: true, error: null, screens,
    notSeenLately: [{ id: 'browser:gone', kind: 'browser', name: 'Old phone', lastSeen: '2026-08-01T00:00:00.000Z', aliases: [] }],
    retired: [{ id: 'screen:attic', kind: 'added', name: 'Attic TV' }],
    byId, refresh: vi.fn(async () => {}),
  };
  Object.assign(api, {
    addScreen: vi.fn(async ({ name, room }) => ({ screen: { id: 'screen:den', name, room } })),
    renameScreen: vi.fn(async (id, { name }) => ({ screen: { id, name }, routines: [] })),
    setScreenRoom: vi.fn(async (id, room) => ({ screen: { id, room } })),
    mergeScreen: vi.fn(async () => ({ screen: {}, movedSpots: 1 })),
    unmergeScreen: vi.fn(async () => ({ screen: { name: 'Kitchen tablet (aaaa1111)' } })),
    screenRoutines: vi.fn(async (id) => ({ items: id === 'fleet:livingroom-tv' ? [{ id: 'automation:k1', name: 'Kitchen Button 1' }] : [] })),
    retireScreen: vi.fn(async () => ({ screen: {}, routines: [] })),
    restoreScreen: vi.fn(async (id) => ({ screen: { id, name: 'Attic TV' } })),
    setRoomNeighbours: vi.fn(async (room, neighbours) => ({ roomAdjacency: { [room]: neighbours } })),
  });
});

describe('ScreenAdminView room neighbours (PLACE.4a/AC6)', () => {
  it('shows each room with its neighbours and saves a mutual link from the checkboxes', async () => {
    ctx.registry.roomAdjacency = { Kitchen: ['Den'] };
    wrap();
    expect(screen.getByTestId('screen-admin-room-near-den')).toHaveTextContent('Next to Kitchen');
    fireEvent.click(screen.getByTestId('screen-admin-room-edit-den'));
    const kitchen = within(await screen.findByTestId('room-neighbours-dialog')).getByRole('checkbox', { name: 'Kitchen' });
    expect(kitchen).toBeChecked();
    fireEvent.click(kitchen);
    fireEvent.click(screen.getByTestId('room-neighbours-save'));
    await waitFor(() => expect(api.setRoomNeighbours).toHaveBeenCalledWith('Den', []));
    expect(ctx.registry.refresh).toHaveBeenCalled();
  });

  it('is hidden while the household has fewer than two rooms', () => {
    ctx.registry.screens = ctx.registry.screens.map((s) => ({ ...s, room: 'Den' }));
    wrap();
    expect(screen.queryByTestId('screen-admin-rooms')).toBeNull();
  });
});

describe('ScreenAdminView', () => {
  it('lists every screen with room and old name, folds silent ones and retired ones away', () => {
    wrap();
    expect(screen.getByTestId('screen-admin-item-fleet:livingroom-tv')).toHaveTextContent('Den TV(was Living Room TV)· Den');
    expect(screen.getByTestId('screen-admin-not-seen')).toHaveTextContent('Not seen lately (1)');
    expect(screen.getByTestId('screen-admin-retired')).toHaveTextContent('Attic TV');
    // A configured screen cannot be merged away.
    expect(screen.queryByTestId('screen-admin-merge-fleet:livingroom-tv')).toBeNull();
  });

  it('adds a screen with a name and a room', async () => {
    wrap();
    fireEvent.change(screen.getByTestId('screen-admin-add-name'), { target: { value: 'Den speaker' } });
    fireEvent.change(screen.getByTestId('screen-admin-add-room'), { target: { value: 'Den' } });
    fireEvent.click(screen.getByTestId('screen-admin-add-save'));
    await waitFor(() => expect(api.addScreen).toHaveBeenCalledWith({ name: 'Den speaker', room: 'Den' }));
    expect(ctx.registry.refresh).toHaveBeenCalled();
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'screenAdded', command: { copy: { primary: 'Added Den speaker', secondary: 'Den' } } }));
  });

  it('sets a screen\'s name and room', async () => {
    wrap();
    fireEvent.click(screen.getByTestId('screen-admin-rename-browser:new'));
    fireEvent.change(await screen.findByTestId('screen-admin-rename-name'), { target: { value: 'Pantry tablet' } });
    fireEvent.change(screen.getByTestId('screen-admin-rename-room'), { target: { value: 'Pantry' } });
    fireEvent.click(screen.getByTestId('screen-admin-rename-save'));
    await waitFor(() => expect(api.renameScreen).toHaveBeenCalledWith('browser:new', { name: 'Pantry tablet', confirm: undefined, onCollision: undefined }));
    await waitFor(() => expect(api.setScreenRoom).toHaveBeenCalledWith('browser:new', 'Pantry'));
  });

  it('retires only after showing the routines that point at the screen', async () => {
    wrap();
    fireEvent.click(screen.getByTestId('screen-admin-retire-fleet:livingroom-tv'));
    const routines = await screen.findByTestId('screen-admin-retire-routines');
    expect(routines).toHaveTextContent('Kitchen Button 1');
    expect(api.retireScreen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-ok'));
    await waitFor(() => expect(api.retireScreen).toHaveBeenCalledWith('fleet:livingroom-tv', { confirm: true }));
  });

  it('merges a duplicate into its earlier self after confirmation, with Undo on the outcome', async () => {
    wrap();
    fireEvent.click(screen.getByTestId('screen-admin-merge-browser:new'));
    const dialog = await screen.findByTestId('screen-admin-merge-dialog');
    expect(screen.getByTestId('confirm-ok')).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Kitchen tablet · Kitchen' }));
    fireEvent.click(screen.getByTestId('confirm-ok'));
    await waitFor(() => expect(api.mergeScreen).toHaveBeenCalledWith('browser:new', { into: 'browser:old', confirm: true }));
    const outcome = recordLocal.mock.calls.find(([r]) => r.kind === 'screenMerged')[0];
    expect(outcome.command.copy.primary).toBe('Merged Kitchen tablet (aaaa1111) into Kitchen tablet');
    await outcome.undo.run();
    expect(api.unmergeScreen).toHaveBeenCalledWith('browser:new');
  });

  it('shows merged duplicates by name after a reload, and folds unnamed browsers away', () => {
    ctx.registry.screens[1] = { ...ctx.registry.screens[1], aliases: ['browser:gone2'], aliasNames: { 'browser:gone2': 'Pantry tablet' } };
    ctx.registry.unnamed = [{ id: 'browser:ghost', kind: 'browser', name: 'Browser ghost123', aliases: [] }];
    wrap();
    expect(screen.getByTestId('screen-admin-aliases-browser:new')).toHaveTextContent('Includes Pantry tablet');
    expect(screen.getByTestId('screen-admin-unnamed')).toHaveTextContent('Unnamed browsers (1)');
    expect(screen.getByTestId('screen-admin-list')).not.toHaveTextContent('ghost123');
  });

  it('restores a retired screen', async () => {
    wrap();
    fireEvent.click(screen.getByTestId('screen-admin-restore-screen:attic'));
    await waitFor(() => expect(api.restoreScreen).toHaveBeenCalledWith('screen:attic'));
  });
});
