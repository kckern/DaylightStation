import { describe, expect, it } from 'vitest';
import { browserDisplayState, mergeCanonicalFleetState, sortFleetDevices } from './browserLiveness.js';

describe('browser fleet liveness', () => {
  it('marks a silent disconnected browser uncertain after two minutes, not immediately off', () => {
    expect(browserDisplayState({ connected: false, lastHeardMs: 119_999, state: 'idle' })).toBe('idle');
    expect(browserDisplayState({ connected: false, lastHeardMs: 120_001, state: 'idle' })).toBe('uncertain');
  });

  it('keeps connected idle browsers idle and sorts playing rows before idle and uncertain rows', () => {
    expect(browserDisplayState({ connected: true, lastHeardMs: 900_000, state: 'idle' })).toBe('idle');
    expect(sortFleetDevices([
      { id: 'uncertain', displayState: 'uncertain' },
      { id: 'idle', displayState: 'idle' },
      { id: 'playing', displayState: 'playing' },
      { id: 'paused', displayState: 'paused' },
    ]).map(({ id }) => id)).toEqual(['playing', 'paused', 'idle', 'uncertain']);
  });

  it('merges canonical live state into configured rows before sorting physical and browser devices', () => {
    const configured = [
      { id: 'physical-idle', name: 'Physical idle' },
      { id: 'physical-playing', name: 'Physical playing' },
      { id: 'physical-off', name: 'Physical off' },
    ];
    const live = new Map([
      ['physical-idle', { snapshot: { state: 'idle' }, offline: false }],
      ['physical-playing', { snapshot: { state: 'playing' }, offline: false }],
      ['physical-off', { snapshot: { state: 'paused' }, offline: true }],
    ]);
    const browsers = [{ id: 'browser:paused', name: 'Browser paused', type: 'browser', state: 'paused' }];

    const merged = mergeCanonicalFleetState(configured, live);
    expect(sortFleetDevices([...merged, ...browsers]).map(({ id, state }) => [id, state])).toEqual([
      ['physical-playing', 'playing'],
      ['browser:paused', 'paused'],
      ['physical-idle', 'idle'],
      ['physical-off', 'off'],
    ]);
  });

  it('keeps configured state for a device with no live entry and never ranks it above live ones', () => {
    const merged = mergeCanonicalFleetState([{ id: 'quiet', state: 'idle' }, { id: 'tv' }],
      new Map([['tv', { snapshot: { state: 'playing' }, offline: false }]]));
    expect(merged.find(d => d.id === 'quiet')).toMatchObject({ state: 'idle', displayState: 'idle' });
    expect(sortFleetDevices(merged).map(d => d.id)).toEqual(['tv', 'quiet']);
  });

  it('shows an offline device as off even if its last snapshot said playing', () => {
    const [row] = mergeCanonicalFleetState([{ id: 'tv' }], new Map([['tv', { snapshot: { state: 'playing' }, offline: true }]]));
    expect(row).toMatchObject({ state: 'off', displayState: 'off' });
  });

  it('does not mutate the configured device objects', () => {
    const devices = [{ id: 'tv', state: 'idle' }];
    mergeCanonicalFleetState(devices, new Map([['tv', { snapshot: { state: 'playing' } }]]));
    expect(devices[0]).toEqual({ id: 'tv', state: 'idle' });
  });

  it('trusts a silent configured device\'s last snapshot for two minutes, then shows uncertain, not playing forever', () => {
    const lastSeenAt = '2026-01-01T00:00:00.000Z';
    const entries = new Map([['tv', { snapshot: { state: 'playing' }, offline: false, lastSeenAt }]]);

    const before = mergeCanonicalFleetState([{ id: 'tv' }], entries, { now: () => Date.parse(lastSeenAt) + 119_999 });
    expect(before[0]).toMatchObject({ state: 'playing', displayState: 'playing' });

    const after = mergeCanonicalFleetState([{ id: 'tv' }], entries, { now: () => Date.parse(lastSeenAt) + 120_001 });
    expect(after[0]).toMatchObject({ state: 'uncertain', displayState: 'uncertain' });
  });

  it('ranks ready, ended, and error sessions above off and unknown devices', () => {
    const order = sortFleetDevices([
      { id: 'off-device', displayState: 'off' },
      { id: 'unknown-device', displayState: 'unknown' },
      { id: 'ready-device', displayState: 'ready' },
      { id: 'ended-device', displayState: 'ended' },
      { id: 'error-device', displayState: 'error' },
    ]).map(d => d.id);
    for (const liveDeviceId of ['ready-device', 'ended-device', 'error-device']) {
      expect(order.indexOf(liveDeviceId)).toBeLessThan(order.indexOf('off-device'));
      expect(order.indexOf(liveDeviceId)).toBeLessThan(order.indexOf('unknown-device'));
    }
    expect(order.indexOf('off-device')).toBeLessThan(order.indexOf('unknown-device'));
  });
});
