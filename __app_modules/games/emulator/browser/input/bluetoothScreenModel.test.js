import { describe, it, expect } from 'vitest';
import {
  extendNearbyOrder, mergeHeard,
  addressTail, rssiBars, displayName, matchController, pairedRows, pairHints, nearbyRows,
  hiddenNearbyCount, pairView, scanView, forgetText,
} from './bluetoothScreenModel.js';

const PAD_CFG = {
  id: 'pad', label: 'Garage Pad', match: 'TestPad', address: 'E4:17:D8:00:00:01',
  pairing: { name: 'TestPad', mac_prefix: 'E4:17:D8', wake: 'Press START to wake it.', mode: 'Pairing mode',
    steps: ['Hold PAIR for 3 seconds.', ' '], troubleshoot: 'Charge it.', pin: '0000' },
};
const PLACEHOLDER = { id: 'ph', label: 'Placeholder', match: 'Nothing' };
const CONTROLLERS = [PAD_CFG, PLACEHOLDER];
const PAD = { address: 'e4:17:d8:00:00:01', name: 'TestPad GamePad', kind: 'gamepad', gamepad: true, trusted: true, paired: true, connected: true, input: true, battery: 80 };
const RING = { address: 'AA:BB:CC:11:22:33', name: 'R1', kind: 'keyboard', hid: true, paired: true, connected: false };
const SPEAKER = { address: '11:22:33:44:55:66', name: 'JBL', kind: null, hid: false, paired: true, connected: true };

describe('small helpers', () => {
  it('addressTail shows the last two octets', () => expect(addressTail('aa:bb:cc:11:22:33')).toBe('…22:33'));
  it('rssiBars', () => {
    expect([-50, -60, -70, -85, -95, undefined].map(rssiBars)).toEqual([4, 3, 2, 1, 0, 0]);
  });
  it('displayName falls back by kind', () => {
    expect(displayName({ name: ' ', kind: 'keyboard' })).toBe('Unnamed keyboard');
    expect(displayName({})).toBe('Unnamed device');
  });
  it('matchController: address, then Bluetooth name, then vendor prefix', () => {
    expect(matchController(PAD, CONTROLLERS)?.id).toBe('pad');
    expect(matchController({ address: '00:00:00:00:00:01', name: 'TestPad 2' }, CONTROLLERS)?.id).toBe('pad');
    expect(matchController({ address: 'E4:17:D8:99:99:99', name: '' }, CONTROLLERS)?.id).toBe('pad');
    expect(matchController(RING, CONTROLLERS)).toBeNull();
  });
});

describe('pairedRows', () => {
  it('one status per row, config label, input devices only', () => {
    const rows = pairedRows([PAD, RING, SPEAKER], CONTROLLERS);
    expect(rows.map((r) => [r.name, r.statusText, r.battery, r.tail])).toEqual([
      ['Garage Pad', 'Connected', 'Battery 80%', '…00:01'],
      ['R1', 'Not connected', null, '…22:33'],
    ]);
    expect(rows[0]).toMatchObject({ address: 'E4:17:D8:00:00:01', controllerId: 'pad', pin: '0000', typeLabel: 'Controller', bonded: true });
  });
  it('asleep pads carry the wake hint from input.yml', () => {
    const [row] = pairedRows([{ ...PAD, connected: false }], CONTROLLERS);
    expect(row).toMatchObject({ status: 'asleep', statusText: 'Asleep', wakeHint: 'Press START to wake it.' });
  });
  it('a pad dialing in on a dropped bond needs pairing again', () => {
    const [row] = pairedRows([{ ...RING, paired: false, connected: true }], []);
    expect(row).toMatchObject({ status: 'needs-pairing', statusText: 'Needs pairing again', bonded: false });
  });
  it('connected without an input device is Connecting…', () => {
    expect(pairedRows([{ ...RING, connected: true, input: false }], [])[0].statusText).toBe('Connecting…');
  });
  it('no feed = no rows', () => expect(pairedRows(null, CONTROLLERS)).toEqual([]));
});

describe('pairHints', () => {
  it('only configured controllers with steps that are not paired', () => {
    expect(pairHints(CONTROLLERS, [RING])).toEqual([{ id: 'pad', label: 'Garage Pad', mode: 'Pairing mode', steps: ['Hold PAIR for 3 seconds.'], troubleshoot: 'Charge it.' }]);
    expect(pairHints(CONTROLLERS, [PAD])).toEqual([]);
  });
});

describe('nearbyRows', () => {
  const near = [
    { address: 'AA:BB:CC:11:22:33', name: 'R1', kind: 'keyboard', hid: true, rssi: -60 },
    { address: '11:22:33:44:55:66', name: 'JBL', kind: null, hid: false, rssi: -40 },
    { address: 'E4:17:D8:00:00:02', name: 'TestPad GamePad', kind: 'gamepad', hid: true, rssi: -80 },
  ];
  it('input devices by default, in first-seen order; a highlight marks, never moves; Paired badge from the inventory', () => {
    const rows = nearbyRows(near, { inventory: [RING], controllers: CONTROLLERS, highlightId: 'pad' });
    expect(rows.map((r) => [r.name, r.highlight, r.paired, r.bars])).toEqual([
      ['R1', false, true, 3],
      ['Garage Pad', true, false, 1],
    ]);
    expect(rows[1]).toMatchObject({ controllerId: 'pad', pin: '0000', kind: 'gamepad' });
  });
  it('a given order wins over arrival order; unknown addresses append', () => {
    const order = ['E4:17:D8:00:00:02'];
    expect(nearbyRows(near, { order }).map((r) => r.address)).toEqual(['E4:17:D8:00:00:02', 'AA:BB:CC:11:22:33']);
    expect(extendNearbyOrder(order, near)).toEqual(['E4:17:D8:00:00:02', 'AA:BB:CC:11:22:33', '11:22:33:44:55:66']);
    expect(extendNearbyOrder(order, [])).toBe(order);
  });
  it('mergeHeard keeps a device that dropped out, with no signal', () => {
    const a = mergeHeard(new Map(), near);
    const b = mergeHeard(a, [near[0]]);
    expect([...b.keys()]).toEqual(near.map((d) => d.address));
    expect(b.get('E4:17:D8:00:00:02').heard).toBe(false);
    expect(nearbyRows([...b.values()], {}).find((r) => r.address === 'E4:17:D8:00:00:02').bars).toBe(0);
  });
  it('show everything adds the rest', () => {
    expect(nearbyRows(near, { showAll: true }).map((r) => r.name)).toContain('JBL');
    expect(hiddenNearbyCount(near)).toBe(1);
  });
});

describe('pairView', () => {
  it('passkey: big code, plain words', () => {
    expect(pairView({ phase: 'passkey', passkey: '012345' }, 'R1')).toMatchObject({ busy: true, text: 'Type 012345 on R1, then press Enter.', passkey: '012345' });
  });
  it('progress words', () => {
    expect(pairView({ phase: 'scanning', optimistic: true }, 'R1').text).toBe('Looking for R1…');
    expect(pairView({ phase: 'pairing' }, 'R1').text).toBe('Pairing R1…');
    expect(pairView({ phase: 'hid-wait' }, 'R1').text).toBe('Connecting R1…');
  });
  it('success', () => {
    expect(pairView({ phase: 'paired' }, 'R1')).toMatchObject({ busy: false, tone: 'ok', text: 'Connected.' });
    expect(pairView({ phase: 'done', paired: [], reason: 'already-paired' }, 'R1').tone).toBe('ok');
  });
  it('failures are one plain sentence plus one next step, never the raw error', () => {
    const v = pairView({ phase: 'done', reason: 'pair-failed', code: 'auth-failed', message: 'org.bluez.Error.AuthenticationFailed' }, 'R1');
    expect(v).toMatchObject({ busy: false, tone: 'error', text: 'R1 refused the pairing.', next: 'Put it back in pairing mode, then search again.' });
    expect(pairView({ phase: 'done', reason: 'no-input', paired: [] }, 'R1').text).toBe('R1 paired, but no presses came through.');
    expect(pairView({ phase: 'done', reason: 'none-found', paired: [] }, 'R1').text).toBe('R1 did not show up.');
    expect(pairView({ phase: 'done', reason: 'unsupported-mode' }, 'R1').text).toBe('The garage Bluetooth service needs an update.');
    expect(pairView({ phase: 'scanning', satelliteOutdated: true }, 'R1').text).toBe('The garage Bluetooth service needs an update.');
  });
});

describe('scanView and forgetText', () => {
  it('countdown', () => {
    expect(scanView({ phase: 'scanning', endsAt: 42000 }, 0).text).toBe('Searching… 42 s');
    expect(scanView({ phase: 'done', reason: 'satellite-outdated' }, 0)).toMatchObject({ active: false, tone: 'error', text: 'The garage Bluetooth service needs an update.' });
    expect(scanView({ phase: 'done', reason: 'timeout' }, 0).text).toBe('Search ended.');
  });
  it('forget words', () => {
    expect(forgetText({ address: 'A', success: true })).toBe('Forgotten. To use it again, search for it and pick it.');
    expect(forgetText({ address: 'A', success: false, error: 'remove-failed' })).toBe('Could not forget it. Try again.');
    expect(forgetText(null)).toBeNull();
  });
});

describe('satellite answers the plan did not cover', () => {
  it('a pair request that met another open window says so plainly', () => {
    expect(pairView({ phase: 'done', paired: [], reason: 'busy' }, 'R1')).toMatchObject({
      busy: false, tone: 'error', text: 'Already pairing another device — wait for it to finish.',
    });
  });
  it('a refused address is plain words', () => {
    expect(pairView({ phase: 'done', paired: [], reason: 'invalid-address' }, 'R1')).toMatchObject({ tone: 'error', text: 'R1 could not be paired from here.' });
  });
  it('an error line holds the screen busy until the window ends', () => {
    const v = pairView({ phase: 'error', code: 'auth-failed', message: 'org.bluez.Error.AuthenticationFailed' }, 'R1');
    expect(v).toMatchObject({ busy: true, tone: 'error', text: 'R1 refused the pairing.' });
  });
  it('nothing on screen ever carries the raw message', () => {
    const phases = ['error', 'done'].flatMap((phase) => ['auth-failed', 'unknown', 'busy', null].map((code) => ({ phase, code, reason: 'pair-failed', message: 'org.bluez.Error.Failed: br-connection-busy', paired: [] })));
    for (const p of phases) {
      const v = pairView(p, 'R1');
      expect(`${v.text} ${v.next}`).not.toMatch(/bluez|br-connection/i);
    }
  });
  it('a search refused while pairing', () => {
    expect(scanView({ phase: 'done', reason: 'busy' }, 0).text).toBe('Bluetooth is busy pairing. Search again in a moment.');
  });
  it('a pairing cut off by a dropped connection says so', () => {
    expect(pairView({ phase: 'done', paired: [], reason: 'interrupted' }, 'R1')).toMatchObject({ tone: 'error', text: 'Lost touch with the garage Bluetooth service.', next: 'Search again.' });
  });
});
