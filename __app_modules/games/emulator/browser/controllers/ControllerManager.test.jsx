import React from 'react';
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import ControllerManager from './ControllerManager.jsx';
import { getActionBus } from '../../../../../frontend/src/lib/input/ActionBus.js';

const pad = (over) => ({ address: 'E4:17:D8:1C:7C:7A', name: '8Bitdo SN30 Pro', type: 'classic', bond: 'bonded', connected: false, profiles: [], manageable: true, ...over });
const snapshot = (devices, extra = {}) => ({ ok: true, adapter: { supported: true, enabled: true, discovering: false }, devices, pairing: null, lastError: null,
  capabilities: { scan: true, pair: true, unpair: true, input: true, pin: true, confirm: false }, ...extra });
const clientFor = (getState) => ({ state: vi.fn(async () => structuredClone(getState())), command: vi.fn(async () => ({ ok: true, accepted: true })) });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('lists every pad by observed status with the actions that status allows, and remotes as view only', async () => {
  const state = snapshot([
    pad({ address: 'E4:17:D8:00:00:01', connected: true, profiles: ['input'] }),
    pad({ address: 'E4:17:D8:00:00:02' }),
    pad({ address: 'E4:17:D8:00:00:03', bond: 'none', connected: false }),
    { address: '3C:6D:66:06:E4:B5', name: 'NVIDIA SHIELD Remote', bond: 'bonded', connected: true, manageable: false },
  ]);
  render(<ControllerManager deviceId="tv" client={clientFor(() => state)} onClose={() => {}} />);
  expect(await screen.findByText('Connected')).toBeTruthy();
  expect(screen.getByText('Paired · not connected')).toBeTruthy();
  expect(screen.getByText('Found · not paired')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Fix' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Pair' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Re-pair' })).toHaveLength(2);
  expect(screen.getByText(/NVIDIA SHIELD Remote — Connected/)).toBeTruthy();
});

it('Forget asks first; Back cancels the question, not the screen', async () => {
  const onClose = vi.fn();
  const client = clientFor(() => snapshot([pad()]));
  render(<ControllerManager deviceId="tv" client={client} onClose={onClose} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Forget' }));
  expect(screen.getByRole('alertdialog', { name: 'Confirm forget' })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  expect(client.command).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('Fix shows the step checklist and finishes on an observed connection', async () => {
  vi.useFakeTimers();
  const state = snapshot([pad()]);
  const client = clientFor(() => state);
  client.command.mockImplementation(async (action) => { if (action === 'connect') setTimeout(() => { state.devices[0].connected = true; state.devices[0].profiles = ['input']; }, 1500); return { ok: true, accepted: true }; });
  render(<ControllerManager deviceId="tv" client={client} onClose={() => {}} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  fireEvent.click(screen.getByRole('button', { name: 'Fix' }));
  expect(screen.getByRole('dialog', { name: /Fixing 8Bitdo SN30 Pro/ })).toBeTruthy();
  expect(screen.getByText('Reconnect')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(screen.getByText('Ready to play')).toBeTruthy();
  expect(client.command.mock.calls.map((c) => c[0])).toEqual(['connect']);
});

it('remote arrows move between rows and within a row', async () => {
  render(<ControllerManager deviceId="tv" client={clientFor(() => snapshot([pad()]))} onClose={() => {}} />);
  const fix = await screen.findByRole('button', { name: 'Fix' });
  await vi.waitFor(() => expect(document.activeElement).toBe(fix));
  fireEvent.keyDown(window, { key: 'ArrowUp' });
  expect(document.activeElement.textContent).toBe('Find new controllers');
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(fix);
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(document.activeElement.textContent).toBe('Connect');
  fireEvent.keyDown(window, { key: 'ArrowUp' });
  expect(document.activeElement.textContent).toBe('Back');
});

it('one dropped status read does not disable the buttons', async () => {
  vi.useFakeTimers();
  let fail = false;
  const client = { state: vi.fn(async () => { if (fail) throw new Error('offline'); return snapshot([pad()]); }), command: vi.fn() };
  render(<ControllerManager deviceId="tv" client={client} onClose={() => {}} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  fail = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  expect(screen.getByRole('button', { name: 'Fix' }).disabled).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.getByRole('button', { name: 'Fix' }).disabled).toBe(true);
  expect(screen.getByText('Bluetooth status unavailable')).toBeTruthy();
});

it('when a row swaps its buttons, focus stays on that row', async () => {
  vi.useFakeTimers();
  const second = pad({ address: 'E4:17:D8:00:00:09', name: 'Second pad' });
  const state = snapshot([pad(), second]);
  render(<ControllerManager deviceId="tv" client={clientFor(() => state)} onClose={() => {}} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  const secondConnect = screen.getAllByRole('button', { name: 'Connect' })[1];
  act(() => secondConnect.focus());
  state.devices[1].connected = true; state.devices[1].profiles = ['input'];
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  expect(document.activeElement.closest('li').textContent).toMatch(/Second pad/);
});

const gamepad = (index, id, pressedIdx = []) => ({ index, id, connected: true, axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressedIdx.includes(i), value: pressedIdx.includes(i) ? 1 : 0 })) });

it('mashing a connected pad lights its row lamp and the live panel, and never acts on the screen', async () => {
  let pads = [gamepad(0, '8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6101)')];
  vi.stubGlobal('navigator', { ...navigator, getGamepads: () => pads });
  const onClose = vi.fn();
  const client = clientFor(() => snapshot([pad({ connected: true, profiles: ['input'] })]));
  render(<ControllerManager deviceId="tv" client={client} onClose={onClose} />);
  await screen.findByRole('button', { name: 'Disconnect' });
  expect(screen.getByText('Player 1')).toBeTruthy();
  expect(screen.getByText('Press a button')).toBeTruthy();
  pads = [gamepad(0, '8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6101)', [4])];
  expect(await screen.findByText('I’m here!')).toBeTruthy();
  expect(screen.getByText(/I’m here! L/)).toBeTruthy();
  // The screen host's GamepadAdapter emits L1 as 'escape' on the bus first: claimed here.
  expect(getActionBus().emit('escape', {})).toBe(true);
  expect(getActionBus().emit('select', {})).toBe(true);
  // ...and its synthetic key, if one were sent, is swallowed too.
  const synthetic = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  synthetic.__gamepadSynthetic = true;
  window.dispatchEvent(synthetic);
  expect(onClose).not.toHaveBeenCalled();
  expect(client.command).not.toHaveBeenCalled();
  pads = [gamepad(0, '8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6101)')];
  await vi.waitFor(() => expect(screen.queryByText('I’m here!')).toBeNull(), { timeout: 2000 });
  fireEvent.keyDown(window, { key: 'Escape' }); // the remote's Back still works
  expect(onClose).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

it('a pad lying on a held button does not lock out the remote', async () => {
  vi.stubGlobal('navigator', { ...navigator, getGamepads: () => [gamepad(0, '8Bitdo SN30 Pro', [0])] });
  const onClose = vi.fn();
  render(<ControllerManager deviceId="tv" client={clientFor(() => snapshot([pad()]))} onClose={onClose} />);
  await screen.findByRole('button', { name: 'Fix' });
  await new Promise((r) => setTimeout(r, 300)); // past the press edge window
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

it('releases the bus when it closes', async () => {
  const { unmount } = render(<ControllerManager deviceId="tv" client={clientFor(() => snapshot([]))} onClose={() => {}} />);
  expect(getActionBus().emit('escape', {})).toBe(true);
  unmount();
  expect(getActionBus().emit('escape', {})).toBe(false);
});

it('lists only paired non-controllers as view-only, not whatever a search turned up nearby', async () => {
  render(<ControllerManager deviceId="tv" client={clientFor(() => snapshot([pad(),
    { address: '3C:6D:66:06:E4:B5', name: 'NVIDIA SHIELD Remote', bond: 'bonded', connected: true, manageable: false },
    { address: '11:22:33:44:55:66', name: '[LG] webOS TV', bond: 'none', connected: false, manageable: false },
    { address: '11:22:33:44:55:67', name: 'Unnamed device', bond: 'none', connected: false, manageable: false }]))} onClose={() => {}} />);
  expect(await screen.findByText(/NVIDIA SHIELD Remote — Connected/)).toBeTruthy();
  expect(screen.queryByText(/webOS|Unnamed/)).toBeNull();
});
