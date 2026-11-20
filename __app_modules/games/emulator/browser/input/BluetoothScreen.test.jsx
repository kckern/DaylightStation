import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BluetoothScreen } from './BluetoothScreen.jsx';

const CONTROLLERS = [
  { id: 'pad', label: 'Garage Pad', match: 'TestPad', address: 'E4:17:D8:00:00:01',
    pairing: { name: 'TestPad', mac_prefix: 'E4:17:D8', mode: 'Pairing mode', steps: ['Hold PAIR for 3 seconds.'], troubleshoot: 'Charge it.' } },
  { id: 'ph', label: 'Placeholder Pad', match: 'Nothing' },
];
const PAD = { address: 'E4:17:D8:00:00:01', name: 'TestPad GamePad', kind: 'gamepad', gamepad: true, trusted: true, hid: true, paired: true, connected: true, input: true, battery: 80 };
const RING = { address: 'AA:BB:CC:11:22:33', name: 'R1', kind: 'keyboard', hid: true, trusted: true, paired: true, connected: false };
const NEAR_RING = { address: 'AA:BB:CC:11:22:44', name: 'R2', kind: 'keyboard', hid: true, rssi: -60 };
const NEAR_SPEAKER = { address: '11:22:33:44:55:66', name: 'JBL', kind: null, hid: false, rssi: -40 };
const NEAR_PAD = { address: 'E4:17:D8:00:00:09', name: 'TestPad GamePad', kind: 'gamepad', hid: true, rssi: -70 };

const makeBt = (over = {}) => ({
  inventory: [PAD, RING], scan: null, pairing: null, forgetResult: null,
  requestInventory: vi.fn(), startScan: vi.fn(() => 'scan-1'), stopScan: vi.fn(), pairAddress: vi.fn(() => 'pair-1'), forget: vi.fn(),
  ...over,
});
const ui = (bt, props = {}) => (
  <BluetoothScreen controllers={CONTROLLERS} keyboardMap={{ up: 'ArrowUp', a: 'x' }} getGamepads={() => []} bluetooth={bt} onClose={props.onClose || vi.fn()} host="test" {...props} />
);
const scanning = (devices) => ({ phase: 'scanning', requestId: 'scan-1', endsAt: Date.now() + 42000, devices });
const press = (key) => fireEvent.keyDown(document.activeElement || document.body, { key });

describe('BluetoothScreen', () => {
  it('asks for the inventory on mount', () => {
    const bt = makeBt();
    render(ui(bt));
    expect(bt.requestInventory).toHaveBeenCalledTimes(1);
  });

  it('paired rows: config label, one status, address tail; no browser-pad counts', () => {
    render(ui(makeBt()));
    const pad = document.querySelector('[data-address="E4:17:D8:00:00:01"]');
    expect(pad.textContent).toContain('Garage Pad');
    expect(pad.textContent).toContain('Connected · 80%');
    expect(pad.textContent).toContain('…00:01');
    expect(document.querySelector('[data-address="AA:BB:CC:11:22:33"]').textContent).toContain('Not connected');
    expect(screen.queryByText(/of \d+ connected|No controllers connected|Ready/)).toBeNull();
  });

  it('a configured controller that is not paired shows How to pair; a placeholder never shows', () => {
    render(ui(makeBt({ inventory: [RING] })));
    expect(screen.getByRole('button', { name: 'How to pair Garage Pad' })).toBeTruthy();
    expect(screen.queryByText(/Placeholder Pad/)).toBeNull();
  });

  it('Forget needs a second press', () => {
    const bt = makeBt();
    render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Forget R1' }));
    expect(bt.forget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Press again to forget R1' }));
    expect(bt.forget).toHaveBeenCalledWith('AA:BB:CC:11:22:33');
  });

  it('focus stays inside when the forgotten row disappears', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Forget R1' }));
    screen.getByRole('button', { name: 'Press again to forget R1' }).focus();
    fireEvent.click(document.activeElement);
    rerender(ui({ ...bt, inventory: [PAD], forgetResult: { address: 'AA:BB:CC:11:22:33', success: true } }));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.querySelector('.bluetooth-screen').contains(document.activeElement)).toBe(true);
    expect(screen.getByText('Forgotten. To use it again, search for it and pick it.')).toBeTruthy();
  });

  it('a forget result from before the screen opened is not shown', () => {
    render(ui(makeBt({ forgetResult: { address: 'AA:BB:CC:11:22:33', success: true } })));
    expect(screen.queryByText(/Forgotten/)).toBeNull();
  });

  it('search: countdown, input devices by default, Show everything, Paired badge', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    expect(bt.startScan).toHaveBeenCalledTimes(1);
    rerender(ui({ ...bt, scan: scanning([NEAR_RING, NEAR_SPEAKER, { ...RING, rssi: -50 }]) }));
    // `now` was read at mount, a moment before endsAt was set: 42 or 43.
    expect(screen.getByRole('status').textContent).toMatch(/^Searching… 4[23] s$/);
    expect(screen.getByRole('button', { name: 'Pair R2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pair R1' }).textContent).toContain('Paired');
    expect(screen.queryByRole('button', { name: 'Pair JBL' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show everything (1 more)' }));
    expect(screen.getByRole('button', { name: 'Pair JBL' })).toBeTruthy();
  });

  it('pick pairs exactly that address; a passkey is shown big; success opens the key test', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    rerender(ui({ ...bt, scan: scanning([NEAR_RING]) }));
    fireEvent.click(screen.getByRole('button', { name: 'Pair R2' }));
    expect(bt.pairAddress).toHaveBeenCalledWith({ address: 'AA:BB:CC:11:22:44', controllerId: null, label: 'R2', pin: null });
    rerender(ui({ ...bt, pairing: { requestId: 'pair-1', phase: 'passkey', passkey: '012345', mode: 'address' } }));
    expect(screen.getByText('Type 012345 on R2, then press Enter.')).toBeTruthy();
    expect(screen.getByLabelText('Code 012345').textContent).toBe('012345');
    rerender(ui({ ...bt, pairing: { requestId: 'pair-1', phase: 'paired', mode: 'address' } }));
    expect(screen.getByText('Press a button on R2')).toBeTruthy();
  });

  it('a configured controller found nearby is named from input.yml, highlighted first, and paired with its PIN', () => {
    const controllers = [{ ...CONTROLLERS[0], pairing: { ...CONTROLLERS[0].pairing, pin: '0000' } }];
    const bt = makeBt({ inventory: [RING] });
    const { rerender } = render(ui(bt, { controllers }));
    fireEvent.click(screen.getByRole('button', { name: 'How to pair Garage Pad' }));
    expect(screen.getByText('Hold PAIR for 3 seconds.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search for it' }));
    rerender(ui({ ...bt, scan: scanning([NEAR_RING, NEAR_PAD]) }, { controllers }));
    const picks = [...document.querySelectorAll('.bts-nearby-list .bts-pick')];
    expect(picks[0].getAttribute('aria-label')).toBe('Pair Garage Pad');
    expect(picks[0].closest('li').className).toContain('bts-highlight');
    fireEvent.click(picks[0]);
    expect(bt.pairAddress).toHaveBeenCalledWith({ address: 'E4:17:D8:00:00:09', controllerId: 'pad', label: 'Garage Pad', pin: '0000' });
  });

  it('a failure is one plain sentence and a next step, never the raw error', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    rerender(ui({ ...bt, scan: scanning([NEAR_RING]) }));
    fireEvent.click(screen.getByRole('button', { name: 'Pair R2' }));
    rerender(ui({ ...bt, pairing: { requestId: 'pair-1', phase: 'done', reason: 'pair-failed', code: 'auth-failed', message: 'org.bluez.Error.AuthenticationFailed', paired: [] } }));
    expect(screen.getByText('R2 refused the pairing.')).toBeTruthy();
    expect(screen.getByText('Put it back in pairing mode, then search again.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/org\.bluez|bluetoothctl/);
    expect(screen.getByRole('button', { name: 'Search again' })).toBeTruthy();
  });

  it('Escape: search → stops and back to the list; list → close', () => {
    const bt = makeBt();
    const onClose = vi.fn();
    const { rerender } = render(ui(bt, { onClose }));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    rerender(ui({ ...bt, scan: scanning([]) }, { onClose }));
    press('Escape');
    expect(bt.stopScan).toHaveBeenCalledWith('back');
    rerender(ui({ ...bt, scan: { phase: 'done', requestId: 'scan-1', devices: [] } }, { onClose }));
    expect(screen.getByRole('button', { name: 'Search for devices' })).toBeTruthy();
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closing the screen stops a running search', () => {
    const bt = makeBt();
    const { rerender, unmount } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    rerender(ui({ ...bt, scan: scanning([]) }));
    unmount();
    expect(bt.stopScan).toHaveBeenCalledWith('close');
  });

  it('an old satellite: the search says it needs an update', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    rerender(ui({ ...bt, scan: { phase: 'done', requestId: 'scan-1', reason: 'satellite-outdated', devices: [] } }));
    expect(screen.getByRole('status').textContent).toBe('The garage Bluetooth service needs an update.');
    // No "Nothing found yet… keep it close" under it: that is not what went wrong.
    expect(screen.queryByText(/Nothing found yet/)).toBeNull();
  });

  it('the countdown never shows more than the search has left', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    rerender(ui({ ...bt, scan: { phase: 'scanning', requestId: 'scan-1', endsAt: Date.now() + 60000, devices: [] } }));
    expect(screen.getByRole('status').textContent).toBe('Searching… 60 s');
  });

  it('Test on a connected row opens the key test; Escape there returns to the list', () => {
    render(ui(makeBt()));
    fireEvent.click(screen.getByRole('button', { name: 'Test Garage Pad' }));
    expect(screen.getByText('Press a button on Garage Pad')).toBeTruthy();
    act(() => { press('Escape'); });
    expect(screen.getByRole('button', { name: 'Search for devices' })).toBeTruthy();
  });

  it('without a bluetooth feed it says so', () => {
    render(ui(null));
    expect(screen.getByText('Bluetooth is not available on this screen.')).toBeTruthy();
  });

  it('rows heard during a search stay pickable after it ends', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    rerender(ui({ ...bt, scan: scanning([NEAR_RING]) }));
    rerender(ui({ ...bt, scan: { phase: 'done', requestId: 'scan-1', reason: 'timeout', devices: [] } }));
    expect(screen.getByRole('status').textContent).toBe('Search ended.');
    expect(screen.getByRole('button', { name: 'Pair R2' })).toBeTruthy();
    expect(document.activeElement.textContent).toBe('Search again');
  });

  it('another pairing already running: plain words, focus on Search again', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    rerender(ui({ ...bt, scan: scanning([NEAR_RING]) }));
    fireEvent.click(screen.getByRole('button', { name: 'Pair R2' }));
    rerender(ui({ ...bt, pairing: { requestId: 'pair-1', phase: 'done', paired: [], reason: 'busy' } }));
    expect(screen.getByRole('status').textContent).toBe('Already pairing another device — wait for it to finish.');
    expect(document.activeElement.textContent).toBe('Search again');
  });

  it('opening the key test never leaves focus on the page', () => {
    render(ui(makeBt()));
    fireEvent.click(screen.getByRole('button', { name: 'Test Garage Pad' }));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement.textContent).toBe('Done');
  });

  it('every view keeps focus inside the screen', () => {
    const bt = makeBt({ inventory: [RING] });
    const { rerender } = render(ui(bt));
    const inside = () => document.querySelector('.bluetooth-screen').contains(document.activeElement);
    expect(inside()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'How to pair Garage Pad' }));
    expect(inside()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Search for it' }));
    expect(inside()).toBe(true);
    rerender(ui({ ...bt, scan: scanning([NEAR_PAD]) }));
    fireEvent.click(screen.getByRole('button', { name: 'Pair Garage Pad' }));
    expect(inside()).toBe(true);
    rerender(ui({ ...bt, pairing: { requestId: 'pair-1', phase: 'passkey', passkey: '000123' } }));
    expect(inside()).toBe(true);
  });
});
