import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BluetoothPanel from './BluetoothPanel.jsx';

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }));
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => logs }) }));
const address = 'AA:BB:CC:DD:EE:FF';
const makeState = (changes = {}) => ({ ok: true, adapter: { supported: true, enabled: true, discovering: false, name: 'Tablet' }, devices: [], pairing: null, lastError: null, capabilities: { scan: true, pair: true, unpair: true, audio: true, midi: true, pin: true, confirm: false }, ...changes });
const device = (changes = {}) => ({ address, name: 'Piano speaker', type: 'classic', bond: 'bonded', connected: false, profiles: [], role: null, rssi: -40, ...changes });
let current;
let requests;
const flush = () => act(async () => {});
const press = async (name) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); };

beforeEach(() => {
  vi.useFakeTimers();
  current = makeState(); requests = [];
  Object.values(logs).forEach((log) => log.mockClear());
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    requests.push({ path: url.replace('http://localhost:8770', ''), ...options, body: options.body && JSON.parse(options.body) });
    return { ok: true, json: async () => options.method === 'GET' ? structuredClone(current) : { ok: true, accepted: true } };
  }));
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const mount = async () => { const result = render(<BluetoothPanel onBack={vi.fn()} />); await flush(); return result; };
const sent = (path) => requests.filter((request) => request.path === `/bluetooth/${path}` && request.method === 'POST');

describe('Bluetooth in the piano kiosk', () => {
  it('shows paired and nearby devices with actual bond and profile states', async () => {
    current.devices = [device({ connected: true, profiles: ['audio'], role: 'audio' }), device({ address: '11:22:33:44:55:66', name: 'Keyboard', bond: 'none', type: 'le' })];
    await mount();
    expect(screen.getByRole('group', { name: 'Paired devices' })).toHaveTextContent('Piano speaker');
    expect(screen.getByRole('group', { name: 'Nearby devices' })).toHaveTextContent('Keyboard');
    expect(screen.getByText('Connected: audio')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect audio' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect MIDI' })).toBeTruthy();
  });

  it('connects nearby unbonded BLE MIDI without requiring pairing', async () => {
    current.devices = [device({ bond: 'none', type: 'le' })];
    await mount();
    expect(screen.getByRole('button', { name: 'Pair' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Connect audio' })).toBeDisabled();
    await press('Connect MIDI');
    expect(sent('connect')[0].body).toEqual({ address, profile: 'midi' });
    expect(sent('pair')).toHaveLength(0);
  });

  it('disconnects connected unbonded BLE MIDI from its actual profile state', async () => {
    current.devices = [device({ bond: 'none', type: 'le', connected: true, profiles: ['midi'], role: 'midi' })];
    await mount();
    await press('Disconnect MIDI');
    expect(sent('disconnect')[0].body).toEqual({ address, profile: 'midi' });
    expect(screen.getByRole('button', { name: 'Disconnect MIDI' })).toBeTruthy();
    current.devices[0].connected = false;
    current.devices[0].profiles = [];
    await tick();
    expect(screen.getByRole('button', { name: 'Connect MIDI' })).toBeTruthy();
  });

  it('scans asynchronously, stops, and never treats command acceptance as discovery or connection', async () => {
    current.devices = [device()];
    await mount();
    await press('Scan for devices');
    expect(sent('scan')[0].body).toEqual({ durationMs: 12000 });
    expect(screen.queryByText('Scanning…')).toBeNull();
    current.adapter.discovering = true;
    await tick();
    expect(screen.getByText('Scanning…')).toBeTruthy();
    await press('Stop scan');
    expect(sent('scan/stop')).toHaveLength(1);
    current.adapter.discovering = false;
    await tick();
    await press('Connect audio');
    expect(sent('connect')[0].body).toEqual({ address, profile: 'audio' });
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Disconnect audio' })).toBeNull();
    current.devices[0].connected = true;
    current.devices[0].profiles = ['audio'];
    await tick();
    await press('Disconnect audio');
    expect(sent('disconnect')[0].body).toEqual({ address, profile: 'audio' });
  });

  it('pairs nearby devices and requires explicit confirmation before forgetting', async () => {
    current.devices = [device({ bond: 'none' })];
    await mount();
    await press('Pair');
    expect(sent('pair')[0].body).toEqual({ address });
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
    current.devices[0].bond = 'bonded';
    await tick();
    await press('Forget');
    expect(sent('unpair')).toHaveLength(0);
    expect(screen.getByText(/Forget Piano speaker/)).toBeTruthy();
    await press('Cancel');
    expect(sent('unpair')).toHaveLength(0);
    await press('Forget');
    await press('Confirm forget');
    expect(sent('unpair')[0].body).toEqual({ address });
  });

  it('sends a PIN only to the bridge, clears it and never logs it', async () => {
    current.pairing = { address, name: 'Keyboard', variant: 'pin', passkey: null, expiresAtMs: Date.now() + 30000, error: null };
    await mount();
    fireEvent.change(screen.getByLabelText('Pairing PIN'), { target: { value: '928461' } });
    await press('Send PIN');
    expect(sent('pairing')[0].body).toEqual({ address, accept: true, pin: '928461' });
    expect(screen.getByLabelText('Pairing PIN')).toHaveValue('');
    expect(JSON.stringify(Object.values(logs).flatMap((log) => log.mock.calls))).not.toContain('928461');
  });

  it('shows numeric confirmation limitations and never sends unsupported acceptance', async () => {
    current.pairing = { address, name: 'Keyboard', variant: 'confirm', passkey: 12345, expiresAtMs: Date.now() + 30000, error: null };
    await mount();
    expect(screen.getByText('012345')).toBeTruthy();
    expect(screen.getByText(/cannot confirm.*Android/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm pairing' })).toBeDisabled();
    await press('Confirm pairing');
    expect(sent('pairing')).toHaveLength(0);
    await press('Reject pairing');
    expect(sent('pairing')[0].body).toEqual({ address, accept: false });
  });

  it.each([false, true])('shows the Android approval instruction without an API confirmation button in system-dialog mode (confirm=%s)', async (confirm) => {
    current.capabilities.confirm = confirm;
    current.capabilities.confirmationMode = 'system-dialog';
    current.pairing = { address, name: 'Keyboard', variant: 'consent', passkey: null, expiresAtMs: Date.now() + 30000, error: null };
    await mount();
    expect(screen.getByText('Approve pairing in Android’s pairing request. If it closes, cancel and pair again.')).toBeTruthy();
    expect(screen.queryByText(/cannot confirm.*Android/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue pairing' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm pairing' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reject pairing' })).toBeEnabled();
    expect(sent('pairing')).toHaveLength(0);
  });

  it('handles supported confirmation, display codes and expired pairing', async () => {
    current.capabilities.confirm = true;
    current.pairing = { address, name: 'Keyboard', variant: 'confirm', passkey: 888888, expiresAtMs: Date.now() + 30000, error: null };
    await mount();
    await press('Confirm pairing');
    expect(sent('pairing')[0].body.accept).toBe(true);
    current.pairing.variant = 'display';
    await tick();
    expect(screen.getByText(/Enter this code on Keyboard/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm pairing' })).toBeNull();
    current.pairing.expiresAtMs = Date.now() - 1;
    await tick();
    expect(screen.getByText(/Pairing request expired/)).toBeTruthy();
  });

  it('shows bridge errors and disables device commands when state becomes unavailable', async () => {
    current.devices = [device()];
    await mount();
    fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ ok: false, code: 'permission_denied', error: 'Bluetooth permission required' }) });
    await press('Connect audio');
    expect(screen.getByRole('alert')).toHaveTextContent('Bluetooth permission required');
    await tick();
    expect(screen.getByRole('button', { name: 'Connect audio' })).toBeDisabled();
  });

  it('keeps a rejected command visible when status polling recovers', async () => {
    current.devices = [device()];
    await mount();
    fetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ ok: false, code: 'audio_failed', error: 'Speaker rejected audio connection' }) });
    await press('Connect audio');
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('Speaker rejected audio connection');
  });

  it('pages long device lists and lets nearby selection choose the pair target', async () => {
    current.devices = Array.from({ length: 6 }, (_, index) => device({ address: `11:22:33:44:55:0${index}`, name: `Keyboard ${index}`, bond: 'none' }));
    await mount();
    const nearby = screen.getByRole('group', { name: 'Nearby devices' });
    expect(within(nearby).queryByText('Keyboard 5')).toBeNull();
    await press('Next nearby devices');
    fireEvent.click(within(nearby).getByRole('button', { name: /Keyboard 5/ }));
    await press('Pair');
    expect(sent('pair')[0].body).toEqual({ address: '11:22:33:44:55:05' });
  });

  it('takes focus inside the in-drawer Bluetooth view', async () => {
    await mount();
    expect(screen.getByRole('button', { name: 'Back to maintenance' })).toHaveFocus();
  });

  it('powers the adapter only on request and disables scan until actual power state changes', async () => {
    current.adapter.enabled = false;
    await mount();
    expect(screen.getByText('Bluetooth off')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scan for devices' })).toBeDisabled();
    await press('Turn Bluetooth on');
    expect(sent('power')[0].body).toEqual({ enabled: true });
    expect(screen.getByText('Bluetooth off')).toBeTruthy();
    current.adapter.enabled = true;
    await tick();
    await press('Turn Bluetooth off');
    expect(sent('power')[1].body).toEqual({ enabled: false });
  });

  it('shows unsupported hardware and native errors without opening another app', async () => {
    current.adapter.supported = false;
    current.lastError = { code: 'unsupported', error: 'No Bluetooth adapter' };
    await mount();
    expect(screen.getByRole('alert')).toHaveTextContent('No Bluetooth adapter');
    expect(screen.getByText('Bluetooth unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn Bluetooth off' })).toBeDisabled();
  });

  it('stops discovery and polling when the panel unmounts', async () => {
    current.adapter.discovering = true;
    const { unmount } = await mount();
    unmount();
    await flush();
    expect(sent('scan/stop')).toHaveLength(1);
    const reads = requests.filter((request) => request.method === 'GET').length;
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(requests.filter((request) => request.method === 'GET')).toHaveLength(reads);
    expect(vi.getTimerCount()).toBe(0);
  });
});
