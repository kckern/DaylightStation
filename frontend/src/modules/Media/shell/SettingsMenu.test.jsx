import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rename = vi.fn();
vi.mock('../identity/useClientIdentity.js', () => ({
  useClientIdentity: () => ({ name: 'Kitchen tablet', room: 'Kitchen', rename }),
}));
vi.mock('../fleet/useFleetContext.js', () => ({
  useFleetContext: () => ({ devices: [{ id: 'browser:other', name: 'Dad laptop' }] }),
}));

import { SettingsMenu } from './SettingsMenu.jsx';

beforeEach(() => rename.mockReset());

describe('SettingsMenu device identity', () => {
  it('renames this browser inside the app while supplying existing names for uniqueness', async () => {
    render(<MantineProvider><SettingsMenu onResetSession={vi.fn()} /></MantineProvider>);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));
    fireEvent.click(await screen.findByTestId('settings-rename-device'));
    const input = await screen.findByRole('textbox', { name: 'Device name' });
    fireEvent.change(input, { target: { value: 'Wall tablet' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Room' }), { target: { value: 'Breakfast nook' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save device name' }));
    expect(rename).toHaveBeenCalledWith({ name: 'Wall tablet', room: 'Breakfast nook', existingNames: ['Dad laptop'] });
  });
});
