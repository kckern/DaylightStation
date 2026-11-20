import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const apiSpy = vi.fn();
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...a) => apiSpy(...a), DaylightMediaPath: (p) => p }));
const pairController = vi.fn();
vi.mock('../../context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({ btInventory: [], controllerPairing: null, pairController, forgetController: vi.fn(), controllerForget: null }),
}));

import ControllersOverlay from './ControllersOverlay.jsx';

describe('ControllersOverlay', () => {
  it('renders nothing when closed', () => {
    render(<ControllersOverlay open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiSpy).not.toHaveBeenCalled();
  });

  it('loads controllers from the emulator library and wires pairing to the context', async () => {
    apiSpy.mockResolvedValueOnce({ input: { controllers: [{ id: 'x', label: 'Pad X', match: 'X' }] } });
    render(<ControllersOverlay open onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Controllers' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Pad X')).toBeTruthy());
    expect(apiSpy).toHaveBeenCalledWith('api/v1/emulator/library');
    fireEvent.click(screen.getByRole('button', { name: /Add a new device/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start search/ }));
    expect(pairController.mock.calls[0][0].mode).toBe('add');
  });

  it('still offers Add a new device when the library fails', async () => {
    apiSpy.mockRejectedValueOnce(new Error('boom'));
    render(<ControllersOverlay open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/boom/));
    expect(screen.getByRole('button', { name: /Add a new device/ })).toBeTruthy();
  });

  it('Close and Escape call onClose', () => {
    apiSpy.mockResolvedValueOnce({ input: { controllers: [] } });
    const onClose = vi.fn();
    render(<ControllersOverlay open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close controllers' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
