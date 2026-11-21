import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BluetoothScreen } from './BluetoothScreen.jsx';

const CONTROLLERS = [
  { id: 'pad', label: 'Garage Pad', match: 'TestPad', address: 'E4:17:D8:00:00:01',
    pairing: { name: 'TestPad', mac_prefix: 'E4:17:D8', mode: 'Pairing mode', steps: ['Hold PAIR for 3 seconds.'], troubleshoot: 'Charge it.' } },
  { id: 'ph', label: 'Placeholder Pad', match: 'Nothing' },
  { id: 'remote_r', kind: 'remote', label: 'Right remote', model: 'Handlebar remote', placement: 'Bike, right side', address: 'AA:BB:CD:00:00:55', layout: 'row',
    buttons: { call: 'MediaPlayPause', forward: 'MediaTrackNext', plus: 'AudioVolumeUp' } },
];
const PAD = { address: 'E4:17:D8:00:00:01', name: 'TestPad GamePad', kind: 'gamepad', gamepad: true, trusted: true, hid: true, paired: true, connected: true, input: true, battery: 80 };
const RING = { address: 'AA:BB:CC:11:22:33', name: 'R1', kind: 'keyboard', hid: true, trusted: true, paired: true, connected: false };
const REMOTE = { address: 'AA:BB:CD:00:00:55', name: 'Handlebar remote', kind: 'keyboard', hid: true, trusted: true, paired: true, connected: true, input: true };
const NEAR_RING = { address: 'AA:BB:CC:11:22:44', name: 'R2', kind: 'keyboard', hid: true, rssi: -60 };
const NEAR_SPEAKER = { address: '11:22:33:44:55:66', name: 'JBL', kind: null, hid: false, rssi: -40 };
const NEAR_PAD = { address: 'E4:17:D8:00:00:09', name: 'TestPad GamePad', kind: 'gamepad', hid: true, rssi: -70 };
const GROUPS = [
  { id: 'playback', label: 'Playback', actions: [{ id: 'play-pause', label: 'Play/pause' }, { id: 'next', label: 'Next' }] },
  { id: 'navigate', label: 'Navigate', actions: [{ id: 'up', label: 'Up' }, { id: 'select', label: 'Select' }] },
  { id: 'nothing', label: 'Nothing', actions: [{ id: 'none', label: 'Nothing' }] },
];

// A fake garage feed: tests push `bt.remote.key` messages through it.
function remoteFeed() {
  const fns = new Set();
  return {
    subscribe: (fn) => { fns.add(fn); return () => fns.delete(fn); },
    push: (msg) => act(() => { fns.forEach((f) => f(msg)); }),
  };
}

const makeBt = (over = {}) => ({
  inventory: [PAD, RING], scan: null, pairing: null, forgetResult: null,
  requestInventory: vi.fn(), startScan: vi.fn(() => 'scan-1'), stopScan: vi.fn(), pairAddress: vi.fn(() => 'pair-1'), forget: vi.fn(),
  ...over,
});
const ui = (bt, props = {}) => (
  <BluetoothScreen controllers={CONTROLLERS} keyboardMap={{ up: 'ArrowUp', a: 'x' }} getGamepads={() => []} bluetooth={bt} onClose={props.onClose || vi.fn()} host="test" {...props} />
);
const scanning = (devices, requestId = 'scan-1') => ({ phase: 'scanning', requestId, endsAt: Date.now() + 42000, devices });
const press = (key) => fireEvent.keyDown(document.activeElement || document.body, { key });
const row = (address) => document.querySelector(`.bts-device[data-address="${address}"]`);
const cap = (key) => document.querySelector(`.bts-cap[data-cap="${key}"]`);

describe('BluetoothScreen: list and device page', () => {
  it('asks for the inventory on mount', () => {
    const bt = makeBt();
    render(ui(bt));
    expect(bt.requestInventory).toHaveBeenCalledTimes(1);
  });

  it('rows: config label, placement or type, one status word with no middle dot; the battery on the page', () => {
    render(ui(makeBt({ inventory: [PAD, RING, REMOTE] })));
    expect(row(PAD.address).textContent).toContain('Garage Pad');
    expect(row(PAD.address).textContent).toContain('Connected');
    expect(row(REMOTE.address).textContent).toContain('Bike, right side');
    expect(row(RING.address).textContent).toContain('Not connected');
    expect(document.body.textContent).not.toContain(' · ');
    // The first connected device's page opens beside the list.
    expect(screen.getByRole('region', { name: 'Garage Pad' }).textContent).toContain('Battery 80%');
  });

  it('a configured controller that is not paired shows How to pair; a placeholder never shows', () => {
    render(ui(makeBt({ inventory: [RING] })));
    expect(screen.getByRole('button', { name: /How to pair Garage Pad/ })).toBeTruthy();
    expect(screen.queryByText(/Placeholder Pad/)).toBeNull();
  });

  it('picking a row shows that device; Forget on its page needs a second press', () => {
    const bt = makeBt();
    render(ui(bt));
    fireEvent.click(row(RING.address));
    expect(row(RING.address).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Forget R1' }));
    expect(bt.forget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Press again to forget R1' }));
    expect(bt.forget).toHaveBeenCalledWith('AA:BB:CC:11:22:33');
  });

  it('focus stays inside when the forgotten device disappears, and the Forgotten line shows', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(row(RING.address));
    fireEvent.click(screen.getByRole('button', { name: 'Forget R1' }));
    screen.getByRole('button', { name: 'Press again to forget R1' }).focus();
    fireEvent.click(document.activeElement);
    rerender(ui({ ...bt, inventory: [PAD], forgetResult: { address: 'AA:BB:CC:11:22:33', success: true } }));
    expect(document.querySelector('.bluetooth-screen').contains(document.activeElement)).toBe(true);
    expect(screen.getByText('Forgotten. To use it again, search for it and pick it.')).toBeTruthy();
  });

  it('a forget result from before the screen opened is not shown', () => {
    render(ui(makeBt({ forgetResult: { address: 'AA:BB:CC:11:22:33', success: true } })));
    expect(screen.queryByText(/Forgotten/)).toBeNull();
  });

  it('a remote page shows its face from input.yml; a press from THIS remote sinks and lights its keycap, released on up', () => {
    const feed = remoteFeed();
    render(ui(makeBt({ inventory: [REMOTE], subscribeRemoteKeys: feed.subscribe })));
    expect(document.querySelector('.bts-face').dataset.layout).toBe('row');
    expect([...document.querySelectorAll('.bts-cap-legend')].map((n) => n.textContent)).toEqual(['Call', 'Forward', 'Plus']);
    expect(cap('MediaPlayPause').className).not.toContain('is-held');
    expect(document.querySelector('.bts-cap-seen')).toBeNull();
    // Another remote of the same model sends the same key: nothing lights here.
    feed.push({ address: 'AA:BB:CC:11:22:99', key: 'MediaPlayPause', state: 'down' });
    expect(cap('MediaPlayPause').className).not.toContain('is-held');
    feed.push({ address: REMOTE.address, key: 'MediaPlayPause', state: 'down' });
    expect(cap('MediaPlayPause').className).toContain('is-held');
    feed.push({ address: REMOTE.address, key: 'MediaPlayPause', state: 'up' });
    expect(cap('MediaPlayPause').className).not.toContain('is-held');
    // It worked this visit: marked; the others stay plain.
    expect(cap('MediaPlayPause').querySelector('.bts-cap-seen')).toBeTruthy();
    expect(cap('MediaTrackNext').querySelector('.bts-cap-seen')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe("Games can't use these keys yet.");
  });

  it('under each keycap: its saved action, else Not set', () => {
    const bt = makeBt({ inventory: [REMOTE], remoteButtons: { remotes: { [REMOTE.address]: { buttons: { MediaTrackNext: 'up' } } }, groups: GROUPS } });
    render(ui(bt));
    expect(cap('MediaTrackNext').querySelector('.bts-cap-action').textContent).toBe('Up');
    expect(cap('MediaPlayPause').querySelector('.bts-cap-action').textContent).toBe('Not set');
  });

  it("the remote's own keys light its face and do not move the focus", () => {
    const feed = remoteFeed();
    render(ui(makeBt({ inventory: [REMOTE, RING], subscribeRemoteKeys: feed.subscribe })));
    const before = document.activeElement;
    press('MediaTrackNext'); // useScreenNav would move down on this key elsewhere
    expect(document.activeElement).toBe(before);
    press('ArrowDown');
    expect(document.activeElement).not.toBe(before);
  });

  it('a device with no input.yml entry builds keycaps from the keys it sends, first-seen order', () => {
    const feed = remoteFeed();
    const ring = { ...RING, connected: true, input: true };
    render(ui(makeBt({ inventory: [ring], subscribeRemoteKeys: feed.subscribe })));
    expect(screen.getByText('Press its buttons to add them here.')).toBeTruthy();
    feed.push({ address: ring.address, key: 'ArrowUp', state: 'down' });
    feed.push({ address: ring.address, key: 'Enter', state: 'down' });
    expect([...document.querySelectorAll('.bts-cap-legend')].map((n) => n.textContent)).toEqual(['Up arrow', 'Enter']);
    expect(screen.getByRole('status').textContent).toBe('Games can use these keys: Up arrow.');
  });

  it('a gamepad page shows the standard face and lights from the Gamepad API', async () => {
    let pads = [{ index: 0, id: 'pad', buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })), axes: [0, 0] }];
    const getGamepads = () => pads;
    render(ui(makeBt({ inventory: [PAD] }), { getGamepads }));
    expect(document.querySelector('.bts-face').dataset.layout).toBe('pad');
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    pads = [{ ...pads[0], buttons: pads[0].buttons.map((b, i) => (i === 0 ? { pressed: true, value: 1 } : b)) }];
    await waitFor(() => expect(cap('pad:0').className).toContain('is-held'));
    expect(cap('pad:0').querySelector('.bts-cap-action').textContent).toBe('Select');
    expect(screen.getByRole('status').textContent).toBe('Games can use this as a controller.');
  });

  it('without a bluetooth feed it says so', () => {
    render(ui(null));
    expect(screen.getByText('Bluetooth is not available on this screen.')).toBeTruthy();
  });

  it('claims the open remote so the host performs none of its actions while it is tried', () => {
    const release = vi.fn();
    const claim = vi.fn(() => release);
    const { unmount } = render(ui(makeBt({ inventory: [REMOTE], remoteButtons: { remotes: {}, groups: GROUPS, claim } })));
    expect(claim).toHaveBeenCalledWith(REMOTE.address);
    unmount();
    expect(release).toHaveBeenCalled();
  });
});

describe('BluetoothScreen: editing buttons', () => {
  const setup = (unlock = { granted: true, userId: 'admin1' }) => {
    const feed = remoteFeed();
    const remoteButtons = {
      remotes: {}, groups: GROUPS, claim: () => () => {},
      requestEditUnlock: vi.fn(async () => unlock),
      save: vi.fn(async () => ({})),
    };
    const bt = makeBt({ inventory: [REMOTE], subscribeRemoteKeys: feed.subscribe, remoteButtons });
    const utils = render(ui(bt));
    return { ...utils, feed, remoteButtons, bt };
  };

  it('Edit buttons asks for the admin unlock; denied stays on the page', async () => {
    const { remoteButtons } = setup({ granted: false, reason: 'cancelled' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit buttons' })); });
    expect(remoteButtons.requestEditUnlock).toHaveBeenCalledWith({ address: REMOTE.address, label: 'Right remote' });
    expect(screen.queryByRole('region', { name: /^Edit buttons on/ })).toBeNull();
  });

  it('press the physical button to pick it, tap an action, Done saves and the page shows it', async () => {
    const { feed, remoteButtons, bt, rerender } = setup();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit buttons' })); });
    expect(screen.getByRole('region', { name: 'Edit buttons on Right remote' })).toBeTruthy();
    // The first keycap starts picked; a press on the remote picks its own.
    expect(cap('MediaPlayPause').getAttribute('aria-pressed')).toBe('true');
    feed.push({ address: REMOTE.address, key: 'AudioVolumeUp', state: 'down' });
    expect(cap('AudioVolumeUp').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Up' }));
    expect(cap('AudioVolumeUp').querySelector('.bts-cap-action').textContent).toBe('Up');
    // Tapping a keycap picks it too.
    fireEvent.click(cap('MediaTrackNext'));
    fireEvent.click(screen.getByRole('button', { name: 'Nothing' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); });
    expect(remoteButtons.save).toHaveBeenCalledWith(REMOTE.address, { buttons: { AudioVolumeUp: 'up', MediaTrackNext: 'none' } }, { label: 'Right remote', updatedBy: 'admin1' });
    // Back on the page, with what the host now holds.
    rerender(ui({ ...bt, remoteButtons: { ...remoteButtons, remotes: { [REMOTE.address]: { buttons: { AudioVolumeUp: 'up', MediaTrackNext: 'none' } } } } }));
    expect(screen.getByRole('button', { name: 'Edit buttons' })).toBeTruthy();
    expect(cap('AudioVolumeUp').querySelector('.bts-cap-action').textContent).toBe('Up');
    expect(cap('MediaTrackNext').querySelector('.bts-cap-action').textContent).toBe('Nothing');
  });

  it('Cancel (or Escape) drops the changes; a failed save stays in the editor and says so', async () => {
    const { remoteButtons } = setup();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit buttons' })); });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    act(() => { press('Escape'); });
    expect(remoteButtons.save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit buttons' })).toBeTruthy();

    remoteButtons.save.mockRejectedValueOnce(new Error('HTTP 500'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit buttons' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); });
    expect(screen.getByRole('alert').textContent).toBe('Could not save the buttons. Try Done again.');
  });

  it('a remote with positions: is drawn as mounted, lights by position, and saves by position', async () => {
    // Fixture: mounted turned a quarter, so the rider's Up is the printed "forward".
    const mounted = { id: 'm', kind: 'remote', label: 'Mounted remote', address: 'AA:BB:CD:00:00:77',
      positions: { up: 'forward', down: 'reverse', left: 'minus', right: 'plus', center: 'call' },
      buttons: { call: 'MediaPlayPause', forward: 'MediaTrackNext', reverse: 'MediaTrackPrevious', plus: 'AudioVolumeUp', minus: 'AudioVolumeDown' } };
    const dev = { ...REMOTE, address: mounted.address };
    const feed = remoteFeed();
    const remoteButtons = { remotes: { [dev.address]: { positions: { center: 'play-pause' }, buttons: { MediaPlayPause: 'none' } } }, groups: GROUPS, claim: () => () => {},
      requestEditUnlock: vi.fn(async () => ({ granted: true, userId: 'a' })), save: vi.fn(async () => ({})) };
    render(ui(makeBt({ inventory: [dev], subscribeRemoteKeys: feed.subscribe, remoteButtons }), { controllers: [mounted] }));
    expect(document.querySelector('.bts-face').dataset.layout).toBe('cross');
    expect([...document.querySelectorAll('.bts-cap-legend')].map((n) => n.textContent)).toEqual(['Up', 'Left', 'Centre', 'Right', 'Down']);
    expect(cap('up').querySelector('.bts-cap-printed').textContent).toBe('Forward');
    // Saved by position: Centre reads the positions map, not the key's.
    expect(cap('center').querySelector('.bts-cap-action').textContent).toBe('Play/pause');
    feed.push({ address: dev.address, key: 'MediaTrackNext', state: 'down' });
    expect(cap('up').className).toContain('is-held');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit buttons' })); });
    feed.push({ address: dev.address, key: 'AudioVolumeDown', state: 'down' });
    expect(cap('left').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Up' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); });
    expect(remoteButtons.save).toHaveBeenCalledWith(dev.address, { positions: { center: 'play-pause', left: 'up' } }, { label: 'Mounted remote', updatedBy: 'a' });
  });

  it('a gamepad has no Edit buttons', () => {
    render(ui(makeBt({ inventory: [PAD], remoteButtons: { remotes: {}, groups: GROUPS, requestEditUnlock: vi.fn(), save: vi.fn(), claim: () => () => {} } })));
    expect(screen.queryByRole('button', { name: 'Edit buttons' })).toBeNull();
  });
});

describe('BluetoothScreen: search and pairing', () => {
  it('search: countdown, input devices by default, Show everything, Paired badge', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    expect(bt.startScan).toHaveBeenCalledTimes(1);
    rerender(ui({ ...bt, scan: scanning([NEAR_RING, NEAR_SPEAKER, { ...RING, rssi: -50 }]) }));
    expect(screen.getByRole('status').textContent).toMatch(/^Searching… 4[23] s$/);
    expect(screen.getByRole('button', { name: 'Pair R2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pair R1' }).textContent).toContain('Paired');
    expect(screen.queryByRole('button', { name: 'Pair JBL' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show everything (1 more)' }));
    expect(screen.getByRole('button', { name: 'Pair JBL' })).toBeTruthy();
  });

  it('rows keep first-seen order: late names and new devices never move a row; a dropped device keeps its row', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    const order = () => [...document.querySelectorAll('.bts-nearby-list li')].map((li) => li.dataset.address);
    const zed = { address: 'AA:00:00:00:00:01', name: 'Zed', kind: 'keyboard', rssi: -60 };
    const unnamed = { address: 'AA:00:00:00:00:02', name: '', kind: 'keyboard', rssi: -60 };
    rerender(ui({ ...bt, scan: scanning([zed, unnamed]) }));
    expect(order()).toEqual([zed.address, unnamed.address]);
    // The unnamed one learns a name that sorts first, and a new device arrives.
    rerender(ui({ ...bt, scan: scanning([{ ...unnamed, name: 'Alpha' }, zed, NEAR_RING]) }));
    expect(order()).toEqual([zed.address, unnamed.address, NEAR_RING.address]);
    // Zed drops out of the snapshot: its row stays, with no signal.
    rerender(ui({ ...bt, scan: scanning([{ ...unnamed, name: 'Alpha' }, NEAR_RING]) }));
    expect(order()).toEqual([zed.address, unnamed.address, NEAR_RING.address]);
    expect(document.querySelector(`li[data-address="${zed.address}"] .bts-bars`).dataset.bars).toBe('0');
  });

  it('pick pairs exactly that address; a passkey is shown big; success opens its page', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    rerender(ui({ ...bt, scan: scanning([NEAR_RING]) }));
    fireEvent.click(screen.getByRole('button', { name: 'Pair R2' }));
    expect(bt.pairAddress).toHaveBeenCalledWith({ address: 'AA:BB:CC:11:22:44', controllerId: null, label: 'R2', pin: null });
    rerender(ui({ ...bt, pairing: { requestId: 'pair-1', phase: 'passkey', passkey: '012345', mode: 'address' } }));
    expect(screen.getByText('Type 012345 on R2, then press Enter.')).toBeTruthy();
    expect(screen.getByLabelText('Code 012345').textContent).toBe('012345');
    const r2 = { ...NEAR_RING, paired: true, connected: true, input: true };
    rerender(ui({ ...bt, inventory: [PAD, RING, r2], pairing: { requestId: 'pair-1', phase: 'paired', mode: 'address' } }));
    expect(screen.getByRole('region', { name: 'R2' })).toBeTruthy();
    expect(screen.getByText('Press a button on R2.')).toBeTruthy();
  });

  it('a configured controller found nearby is named from input.yml, marked (not moved), and paired with its PIN', () => {
    const controllers = [{ ...CONTROLLERS[0], pairing: { ...CONTROLLERS[0].pairing, pin: '0000' } }];
    const bt = makeBt({ inventory: [RING] });
    const { rerender } = render(ui(bt, { controllers }));
    fireEvent.click(screen.getByRole('button', { name: /How to pair Garage Pad/ }));
    expect(screen.getByText('Hold PAIR for 3 seconds.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search for it' }));
    rerender(ui({ ...bt, scan: scanning([NEAR_RING, NEAR_PAD]) }, { controllers }));
    const picks = [...document.querySelectorAll('.bts-nearby-list .bts-nearby')];
    expect(picks[1].getAttribute('aria-label')).toBe('Pair Garage Pad');
    expect(picks[1].className).toContain('bts-highlight');
    fireEvent.click(picks[1]);
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
    expect(screen.queryByText(/Nothing found yet/)).toBeNull();
  });

  it('the countdown never shows more than the search has left', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    rerender(ui({ ...bt, scan: { phase: 'scanning', requestId: 'scan-1', endsAt: Date.now() + 60000, devices: [] } }));
    expect(screen.getByRole('status').textContent).toBe('Searching… 60 s');
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

  it('every view keeps focus inside the screen', () => {
    const bt = makeBt({ inventory: [RING] });
    const { rerender } = render(ui(bt));
    const inside = () => document.querySelector('.bluetooth-screen').contains(document.activeElement);
    expect(inside()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /How to pair Garage Pad/ }));
    expect(inside()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Search for it' }));
    expect(inside()).toBe(true);
    rerender(ui({ ...bt, scan: scanning([NEAR_PAD]) }));
    fireEvent.click(screen.getByRole('button', { name: 'Pair Garage Pad' }));
    expect(inside()).toBe(true);
    rerender(ui({ ...bt, pairing: { requestId: 'pair-1', phase: 'passkey', passkey: '000123' } }));
    expect(inside()).toBe(true);
  });

  it('picking a device stops the running search first', () => {
    const bt = makeBt();
    const { rerender } = render(ui(bt));
    fireEvent.click(screen.getByRole('button', { name: 'Search for devices' }));
    rerender(ui({ ...bt, scan: scanning([NEAR_RING]) }));
    fireEvent.click(screen.getByRole('button', { name: 'Pair R2' }));
    expect(bt.stopScan).toHaveBeenCalledWith('pick');
    expect(bt.stopScan.mock.invocationCallOrder[0]).toBeLessThan(bt.pairAddress.mock.invocationCallOrder[0]);
  });

  it('the list says a pairing is running when one started elsewhere', () => {
    render(ui(makeBt({ pairing: { requestId: 'other', phase: 'pairing', device: { address: 'AA:BB:CC:11:22:99', name: 'Pad' } } })));
    expect(screen.getByText('Pairing Pad…')).toBeTruthy();
  });

  it('a pairing started elsewhere is named from input.yml when the device matches, and disables Forget', () => {
    render(ui(makeBt({ pairing: { requestId: 'other', phase: 'pairing', device: { address: 'E4:17:D8:00:00:09', name: 'TestPad GamePad' } } })));
    expect(screen.getByText('Pairing Garage Pad…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Forget Garage Pad' }).disabled).toBe(true);
  });

  it('the Forgotten message goes away after a few seconds', () => {
    vi.useFakeTimers();
    try {
      const bt = makeBt();
      const { rerender } = render(ui(bt));
      fireEvent.click(row(RING.address));
      fireEvent.click(screen.getByRole('button', { name: 'Forget R1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Press again to forget R1' }));
      rerender(ui({ ...bt, inventory: [PAD], forgetResult: { address: 'AA:BB:CC:11:22:33', success: true } }));
      expect(screen.getByText(/^Forgotten/)).toBeTruthy();
      act(() => { vi.advanceTimersByTime(6500); });
      expect(screen.queryByText(/^Forgotten/)).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
