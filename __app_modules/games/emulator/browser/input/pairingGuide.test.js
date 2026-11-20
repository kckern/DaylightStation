import { describe, it, expect } from 'vitest';
import {
  pairingGuides, buildPairTargets, pairingStatus, controllerOsState,
  ADD_DEVICE_STEPS, otherBtDevices, deviceOsStatus,
} from "./pairingGuide.js";

const SFC30 = {
  id: '8bitdo_sfc30',
  label: '8BitDo SFC30',
  match: '8Bitdo|SFC30|2dc8',
  address: 'E4:17:D8:C6:54:F0',
  pairing: {
    mode: 'Android (D-input)',
    pin: '0000',
    steps: ['Hold START 3s to turn it off.', 'Hold START 1s to turn it on.', 'Hold SELECT 3s until the LED blinks fast.'],
    troubleshoot: 'Charge it if the LED is red.',
  },
};
const XBOX = { id: 'xbox', label: 'Xbox Wireless', match: 'Xbox|045e' };

describe('pairingGuides', () => {
  it('lists only controllers with steps, normalised', () => {
    expect(pairingGuides([SFC30, XBOX])).toEqual([{
      id: '8bitdo_sfc30', label: '8BitDo SFC30', mode: 'Android (D-input)',
      steps: SFC30.pairing.steps, troubleshoot: 'Charge it if the LED is red.',
    }]);
    expect(pairingGuides(null)).toEqual([]);
  });
});

describe('buildPairTargets', () => {
  it('derives name from match and MAC prefix from the address OUI; carries the PIN', () => {
    expect(buildPairTargets([SFC30, XBOX])).toEqual([
      { id: '8bitdo_sfc30', label: '8BitDo SFC30', name: '8Bitdo|SFC30|2dc8', macPrefix: 'E4:17:D8', pin: '0000' },
      { id: 'xbox', label: 'Xbox Wireless', name: 'Xbox|045e' },
    ]);
  });
  it('restricts to one controller and prefers explicit pairing.name / mac_prefix', () => {
    const c = { ...SFC30, pairing: { ...SFC30.pairing, name: '8bitdo', mac_prefix: 'e4:17:d8' } };
    expect(buildPairTargets([c, XBOX], '8bitdo_sfc30')).toEqual([
      { id: '8bitdo_sfc30', label: '8BitDo SFC30', name: '8bitdo', macPrefix: 'E4:17:D8', pin: '0000' },
    ]);
  });
});

describe('controllerOsState', () => {
  const dev = (o) => ({ address: 'E4:17:D8:C6:54:F0', name: '8Bitdo SFC30 GamePad', connected: false, paired: true, input: false, ...o });
  it('walks the lifecycle states', () => {
    expect(controllerOsState(SFC30, undefined).status).toBe('unknown');
    expect(controllerOsState(SFC30, []).status).toBe('not-paired');
    expect(controllerOsState(SFC30, [dev({ paired: false, connected: true, attempting: true })]).status).toBe('unpaired');
    expect(controllerOsState(SFC30, [dev({})]).status).toBe('asleep');
    expect(controllerOsState(SFC30, [dev({ connected: true })]).status).toBe('connecting');
    expect(controllerOsState(SFC30, [dev({ connected: true, input: true })]).status).toBe('ready');
  });
  it('matches by name when the configured address differs (a replacement pad)', () => {
    expect(controllerOsState(SFC30, [dev({ address: 'E4:17:D8:00:00:01', connected: true, input: true })]).status).toBe('ready');
  });
});

describe('pairingStatus', () => {
  it('an outdated satellite wins over every later phase of the window', () => {
    const want = {
      busy: false, tone: 'error',
      text: 'The garage box needs an update before it can add new devices. Pairing a listed controller still works.',
      retry: false,
    };
    for (const phase of ['scanning', 'pairing', 'paired', 'error']) {
      expect(pairingStatus({ phase, satelliteOutdated: true, device: { name: 'Pad' } }, 'add')).toEqual(want);
    }
    expect(pairingStatus({ phase: 'done', satelliteOutdated: true, paired: [{ name: 'Pad' }] }, 'add')).toEqual(want);
  });
  it('idle → no text', () => {
    expect(pairingStatus(null)).toEqual({ busy: false, tone: 'idle', text: null, retry: false });
  });
  it('busy phases name the device', () => {
    const s = pairingStatus({ phase: 'hid-wait', device: { name: '8Bitdo SFC30 GamePad' } });
    expect(s.busy).toBe(true);
    expect(s.text).toMatch(/8Bitdo SFC30 GamePad/);
    expect(pairingStatus({ phase: 'scanning', durationMs: 60000 }).text).toMatch(/60s/);
  });
  it('done with nothing found points at the pairing-mode LED', () => {
    const s = pairingStatus({ phase: 'done', paired: [], reason: 'none-found' });
    expect(s).toMatchObject({ busy: false, tone: 'error', retry: true });
    expect(s.text).toMatch(/LED/);
  });
  it('done paired → ok; no-response / no-input / pair-failed → retry with their own words', () => {
    expect(pairingStatus({ phase: 'done', paired: [{ name: 'Pad' }] })).toMatchObject({ tone: 'ok', retry: false });
    expect(pairingStatus({ phase: 'done', paired: [], reason: 'no-response' }).text).toMatch(/did not answer/);
    expect(pairingStatus({ phase: 'done', paired: [], reason: 'no-input' }).text).toMatch(/never came up/);
    expect(pairingStatus({ phase: 'done', paired: [], reason: 'pair-failed' }).text).toMatch(/would not pair/);
  });
});

describe('pairingStatus — add mode wording', () => {
  const add = (p) => pairingStatus(p, 'add');
  it('speaks of a device, not a controller', () => {
    expect(add({ phase: 'scanning', durationMs: 60000 }).text).toBe('Looking for the device… (up to 60s)');
    expect(add({ phase: 'done', paired: [] }).text)
      .toBe('No new device found. Check it is in pairing mode (light blinking fast), then try again.');
    expect(add({ phase: 'done', paired: [], reason: 'no-input' }).text)
      .toBe('Paired, but it never came up as an input device. Switch it off and on, then try again.');
    expect(add({ phase: 'done', paired: [], reason: 'pair-failed' }).text).not.toMatch(/controller/);
    expect(add({ phase: 'pairing' }).text).toBe('Pairing the device…');
    expect(add({ phase: 'found', device: { name: 'R1' } }).text).toBe('Found R1 — pairing…');
    expect(add({ phase: 'done', paired: [], reason: 'no-input' }).retry).toBe(true);
  });
  it('repair mode (and no mode) keeps the controller wording', () => {
    for (const m of ['repair', undefined]) {
      expect(pairingStatus({ phase: 'scanning', durationMs: 60000 }, m).text).toBe('Looking for the controller… (up to 60s)');
      expect(pairingStatus({ phase: 'done', paired: [] }, m).text).toMatch(/^No controller found/);
      expect(pairingStatus({ phase: 'done', paired: [], reason: 'no-input' }, m).text).toMatch(/never came up as a controller/);
      expect(pairingStatus({ phase: 'pairing' }, m).text).toBe('Pairing the controller…');
    }
  });
});

describe('pairingStatus — already paired', () => {
  it('does not claim a fresh pairing when the window short-circuited', () => {
    const s = pairingStatus({ phase: 'done', reason: 'already-paired', paired: [{ name: '8Bitdo SFC30 GamePad' }] });
    expect(s.tone).toBe('info');
    expect(s.busy).toBe(false);
    expect(s.text).toMatch(/already connected/);
    expect(s.text).toMatch(/Add a new device/);
  });
});

describe('ADD_DEVICE_STEPS', () => {
  it('is a non-empty list of strings', () => {
    expect(ADD_DEVICE_STEPS.length).toBeGreaterThan(1);
    ADD_DEVICE_STEPS.forEach((s) => expect(typeof s).toBe('string'));
  });
});

describe('otherBtDevices', () => {
  const inv = [
    { address: 'E4:17:D8:C6:54:F0', name: '8Bitdo SFC30 GamePad', connected: true, paired: true, input: true, kind: 'gamepad' },
    { address: '11:22:33:44:55:66', name: 'R1', connected: true, paired: true, input: true, kind: 'keyboard', battery: 80 },
    { address: 'AA:BB:CC:00:00:01', name: 'JBL Flip 5', connected: true, paired: true, input: false, kind: null },
    { address: 'AA:BB:CC:00:00:02', name: 'Mystery', connected: false, paired: true, input: false, kind: 'mouse' },
  ];
  it('lists input devices that match no configured controller, with a status', () => {
    const out = otherBtDevices([SFC30], inv);
    expect(out.map((d) => d.address)).toEqual(['11:22:33:44:55:66', 'AA:BB:CC:00:00:02']);
    expect(out[0].status).toBe('ready');
    expect(out[1].status).toBe('asleep');
  });
  it('is empty without an inventory feed', () => {
    expect(otherBtDevices([SFC30], null)).toEqual([]);
  });
  it('lists a sleeping HID device whose kind is unknown', () => {
    const ring = { address: '11:22:33:44:55:77', name: 'Ring', kind: null, hid: true, input: false, paired: true, connected: false };
    const out = otherBtDevices([], [ring]);
    expect(out.map((d) => d.address)).toEqual(['11:22:33:44:55:77']);
    expect(out[0].status).toBe('asleep');
  });
  it('leaves out a speaker whose AVRCP node shows as an input device', () => {
    const speaker = { address: 'AA:BB:CC:00:00:03', name: 'JBL', kind: null, hid: false, input: true, paired: true, connected: true };
    expect(otherBtDevices([], [speaker])).toEqual([]);
  });
});

describe('deviceOsStatus', () => {
  it('reads the lifecycle from one inventory row', () => {
    expect(deviceOsStatus({ paired: false, connected: true })).toBe('unpaired');
    expect(deviceOsStatus({ paired: true, connected: true, input: true })).toBe('ready');
    expect(deviceOsStatus({ paired: true, connected: true, input: false })).toBe('connecting');
    expect(deviceOsStatus({ paired: true, connected: false })).toBe('asleep');
  });
});
