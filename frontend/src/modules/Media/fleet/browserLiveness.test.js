import { describe, expect, it } from 'vitest';
import { browserDisplayState, sortFleetDevices } from './browserLiveness.js';

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
});
