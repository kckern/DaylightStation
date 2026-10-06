import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rename = vi.fn();
const push = vi.fn();
vi.mock('../identity/useClientIdentity.js', () => ({
  useClientIdentity: () => ({ name: 'Kitchen tablet', room: 'Kitchen', deviceId: 'browser:me', rename }),
}));
vi.mock('../fleet/useFleetContext.js', () => ({
  useFleetContext: () => ({
    devices: [{ id: 'browser:other', name: 'Dad laptop' }, { id: 'livingroom-tv', screenId: 'fleet:livingroom-tv', name: 'Den TV' }],
    registry: { byId: new Map() },
  }),
}));
vi.mock('./NavProvider.jsx', () => ({ useNav: () => ({ push }) }));

import { SettingsMenu } from './SettingsMenu.jsx';

beforeEach(() => { rename.mockReset(); push.mockReset(); });

async function openRename() {
  render(<MantineProvider><SettingsMenu onResetSession={vi.fn()} /></MantineProvider>);
  fireEvent.click(screen.getByTestId('settings-menu-trigger'));
  fireEvent.click(await screen.findByTestId('settings-rename-device'));
  return screen.findByTestId('settings-rename-name');
}

describe('SettingsMenu device identity', () => {
  it('renames this browser inside the app while supplying existing names for uniqueness', async () => {
    rename.mockResolvedValue({ ok: true });
    const input = await openRename();
    fireEvent.change(input, { target: { value: 'Wall tablet' } });
    fireEvent.change(screen.getByTestId('settings-rename-room'), { target: { value: 'Breakfast nook' } });
    fireEvent.click(screen.getByTestId('settings-rename-save'));
    await waitFor(() => expect(rename).toHaveBeenCalledWith({
      name: 'Wall tablet', room: 'Breakfast nook', existingNames: ['Dad laptop', 'Den TV'],
    }));
    await waitFor(() => expect(screen.queryByTestId('settings-rename-dialog')).toBeNull());
  });

  it('offers the free suggestion when the name is taken (RQ-HOUSE-06)', async () => {
    rename
      .mockResolvedValueOnce({ ok: false, code: 'NAME_TAKEN', heldBy: 'fleet:livingroom-tv', suggestion: 'Den TV (2)' })
      .mockResolvedValueOnce({ ok: true });
    const input = await openRename();
    fireEvent.change(input, { target: { value: 'Den TV' } });
    fireEvent.click(screen.getByTestId('settings-rename-save'));
    expect(await screen.findByTestId('settings-rename-taken')).toHaveTextContent('“Den TV” is already the name of Den TV.');
    fireEvent.click(screen.getByTestId('settings-rename-use-suggestion'));
    await waitFor(() => expect(rename).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Den TV (2)' })));
  });

  it('lists the routines a rename touches and resends with confirm', async () => {
    rename
      .mockResolvedValueOnce({ ok: false, code: 'ROUTINES_TARGET', routines: [{ id: 'automation:a', name: 'Morning program' }] })
      .mockResolvedValueOnce({ ok: true });
    const input = await openRename();
    fireEvent.change(input, { target: { value: 'Poo' } });
    fireEvent.click(screen.getByTestId('settings-rename-save'));
    expect(await screen.findByTestId('settings-rename-routines')).toHaveTextContent('Morning program');
    fireEvent.click(screen.getByTestId('settings-rename-confirm'));
    await waitFor(() => expect(rename).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Poo', confirm: true })));
  });

  it('leads to screen admin and routine history', async () => {
    render(<MantineProvider><SettingsMenu onResetSession={vi.fn()} /></MantineProvider>);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));
    fireEvent.click(await screen.findByTestId('settings-manage-screens'));
    expect(push).toHaveBeenCalledWith('screens', {});
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));
    fireEvent.click(await screen.findByTestId('settings-routine-history'));
    expect(push).toHaveBeenCalledWith('routines', {});
  });
});
