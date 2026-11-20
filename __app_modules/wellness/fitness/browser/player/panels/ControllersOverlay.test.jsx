import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const apiSpy = vi.fn();
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...a) => apiSpy(...a), DaylightMediaPath: (p) => p }));
const bluetooth = {
  inventory: [{ address: 'AA:BB:CC:11:22:33', name: 'R1', kind: 'keyboard', hid: true, paired: true, connected: true, input: true }],
  scan: null, pairing: null, forgetResult: null,
  requestInventory: vi.fn(), startScan: vi.fn(), stopScan: vi.fn(), pairAddress: vi.fn(), forget: vi.fn(),
};
// The Bluetooth state lives in its own context (FitnessBluetoothContext), not the main fitness context.
vi.mock('../../context/FitnessBluetoothContext.jsx', () => ({ useFitnessBluetoothState: () => ({ bluetooth }) }));

import ControllersOverlay from './ControllersOverlay.jsx';

const library = { input: { keyboard: { up: 'ArrowUp' }, controllers: [{ id: 'pad', label: 'Garage Pad', match: 'TestPad', pairing: { steps: ['Hold PAIR.'] } }] } };

describe('ControllersOverlay', () => {
  beforeEach(() => { apiSpy.mockReset(); bluetooth.requestInventory.mockReset(); });

  it('renders nothing when closed', () => {
    render(<ControllersOverlay open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiSpy).not.toHaveBeenCalled();
  });

  it('is the Bluetooth screen, labelled by its heading, fed from the context and input.yml', async () => {
    apiSpy.mockResolvedValueOnce(library);
    render(<ControllersOverlay open onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Bluetooth' });
    expect(dialog).toBeTruthy();
    expect(screen.getByText('Loading the controller list…')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'How to pair Garage Pad' })).toBeTruthy());
    expect(document.querySelector('[data-address="AA:BB:CC:11:22:33"]').textContent).toContain('Connected');
    expect(bluetooth.requestInventory).toHaveBeenCalled();
    expect(apiSpy).toHaveBeenCalledWith('api/v1/emulator/library');
  });

  it('a failed library load says so plainly; search still works', async () => {
    apiSpy.mockRejectedValueOnce(new Error('HTTP 502 Bad Gateway'));
    render(<ControllersOverlay open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Could not load the controller list. Search and Forget still work.')).toBeTruthy());
    expect(document.body.textContent).not.toContain('502');
    expect(screen.getByRole('button', { name: 'Search for devices' })).toBeTruthy();
  });

  it('Escape closes from the list, and a keyboard press never reaches the page behind', async () => {
    apiSpy.mockResolvedValueOnce(library);
    const onClose = vi.fn();
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    render(<ControllersOverlay open onClose={onClose} />);
    await act(async () => {});
    fireEvent.keyDown(document.body, { key: 'Escape' });
    window.removeEventListener('keydown', behind);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
  });

  it('fetches the library again when reopened', async () => {
    apiSpy.mockResolvedValue(library);
    const { rerender } = render(<ControllersOverlay open onClose={vi.fn()} />);
    await act(async () => {});
    rerender(<ControllersOverlay open={false} onClose={vi.fn()} />);
    rerender(<ControllersOverlay open onClose={vi.fn()} />);
    await act(async () => {});
    expect(apiSpy).toHaveBeenCalledTimes(2);
  });
});
