import { describe, it, expect } from 'vitest';
import { pairingGuides, buildPairTargets, pairingStatus, controllerOsState } from "./pairingGuide.js";

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
