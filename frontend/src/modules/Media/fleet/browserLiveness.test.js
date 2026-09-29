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
});
