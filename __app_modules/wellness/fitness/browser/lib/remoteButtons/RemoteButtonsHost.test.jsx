import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiSpy = vi.fn();
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...a) => apiSpy(...a), DaylightMediaPath: (p) => p, DaylightImagePath: (p) => p }));
const listeners = new Set();
const bluetooth = { subscribeRemoteKeys: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
vi.mock('../../context/FitnessBluetoothContext.jsx', () => ({ useFitnessBluetoothState: () => ({ bluetooth }) }));
const identity = { registerAdmin: vi.fn(), clearUnlock: vi.fn(), unlockState: 'scanning', unlockedUser: null };
vi.mock('../../identity/useIdentity.js', () => ({ useOptionalIdentity: () => identity }));

import { RemoteButtonsHost } from './RemoteButtonsHost.jsx';
import { useBluetoothScreenBluetooth } from './remoteButtonsContext.js';

const RIGHT = 'AA:BB:CC:00:00:01'; // made-up fixture
let seen;
function Probe() { seen = useBluetoothScreenBluetooth(); return null; }
const push = (msg) => act(() => { listeners.forEach((f) => f(msg)); });

describe('RemoteButtonsHost', () => {
  beforeEach(() => { apiSpy.mockReset(); identity.registerAdmin.mockReset(); listeners.clear(); });

  it('loads the saved buttons and hands them to the Bluetooth screen with the action groups', async () => {
    apiSpy.mockResolvedValueOnce({ remotes: { [RIGHT]: { buttons: { MediaPlayPause: 'up' } } } });
    render(<RemoteButtonsHost kiosk={false}><Probe /></RemoteButtonsHost>);
    await waitFor(() => expect(seen.remoteButtons.remotes[RIGHT]).toBeTruthy());
    expect(apiSpy).toHaveBeenCalledWith('api/v1/fitness/remote-buttons');
    expect(seen.remoteButtons.groups.map((g) => g.label)).toEqual(['Playback', 'Navigate', 'Nothing']);
  });

  it('save PUTs by address and keeps what the server returns', async () => {
    apiSpy.mockResolvedValueOnce({ remotes: {} });
    render(<RemoteButtonsHost kiosk={false}><Probe /></RemoteButtonsHost>);
    await waitFor(() => expect(seen.remoteButtons.loaded).toBe(true));
    apiSpy.mockResolvedValueOnce({ remotes: { [RIGHT]: { buttons: { ButtonA: 'select' } } } });
    await act(async () => { await seen.remoteButtons.save(RIGHT, { buttons: { ButtonA: 'select' } }, { label: 'R', updatedBy: 'admin1' }); });
    expect(apiSpy).toHaveBeenLastCalledWith(`api/v1/fitness/remote-buttons/${encodeURIComponent(RIGHT)}`, { buttons: { ButtonA: 'select' }, label: 'R', updatedBy: 'admin1' }, 'PUT');
    expect(seen.remoteButtons.remotes[RIGHT].buttons.ButtonA).toBe('select');
  });

  it('on the kiosk, Edit asks for an admin fingerprint; off it, there is no reader and it opens', async () => {
    apiSpy.mockResolvedValue({ remotes: {} });
    const { unmount } = render(<RemoteButtonsHost kiosk={false}><Probe /></RemoteButtonsHost>);
    expect(await seen.remoteButtons.requestEditUnlock({ address: RIGHT })).toMatchObject({ granted: true });
    expect(identity.registerAdmin).not.toHaveBeenCalled();
    unmount();
    render(<RemoteButtonsHost kiosk><Probe /></RemoteButtonsHost>);
    identity.registerAdmin.mockResolvedValueOnce({ matched: true, userId: 'admin1' });
    let r;
    await act(async () => { r = await seen.remoteButtons.requestEditUnlock({ address: RIGHT, label: 'Right remote' }); });
    expect(identity.registerAdmin).toHaveBeenCalledWith('remote_buttons');
    expect(r).toEqual({ granted: true, userId: 'admin1' });
    identity.registerAdmin.mockResolvedValueOnce({ matched: false, reason: 'cancelled' });
    await act(async () => { r = await seen.remoteButtons.requestEditUnlock({ address: RIGHT }); });
    expect(r).toMatchObject({ granted: false });
  });

  it('on the kiosk a saved press reaches the page as its key, the browser copy is held back, and a mounted remote resolves by position', async () => {
    const LEFT = 'AA:BB:CC:00:00:02';
    // Fixture: the left remote is mounted so the rider's Up is its printed "forward".
    const controllers = [{ address: LEFT, buttons: { forward: 'MediaTrackNext', call: 'MediaPlayPause' }, positions: { up: 'forward', center: 'call' } }];
    apiSpy.mockImplementation(async (path) => (path === 'api/v1/emulator/library'
      ? { input: { controllers } }
      : { remotes: { [RIGHT]: { buttons: { MediaPlayPause: 'down' } }, [LEFT]: { positions: { up: 'left' } } } }));
    render(<RemoteButtonsHost kiosk><Probe /></RemoteButtonsHost>);
    await waitFor(() => expect(seen.remoteButtons.loaded).toBe(true));
    await waitFor(() => expect(apiSpy).toHaveBeenCalledWith('api/v1/emulator/library'));
    await act(async () => { await Promise.resolve(); });
    const keys = [];
    const on = (e) => keys.push(e.key);
    window.addEventListener('keydown', on);
    try {
      push({ address: RIGHT, key: 'MediaPlayPause', state: 'down' });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'MediaPlayPause', bubbles: true, cancelable: true }));
      push({ address: LEFT, key: 'MediaTrackNext', state: 'down' });
      expect(keys).toEqual(['ArrowDown', 'ArrowLeft']);
    } finally { window.removeEventListener('keydown', on); }
  });
});
