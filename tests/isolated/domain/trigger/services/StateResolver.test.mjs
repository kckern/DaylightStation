import { describe, it, expect } from 'vitest';
import { StateResolver } from '#domains/trigger/services/StateResolver.mjs';

const baseRegistry = {
  locations: {
    livingroom: {
      target: 'livingroom-tv',
      auth_token: null,
      states: {
        off: { action: 'clear' },
        on: { action: 'play', queue: 'ambient' },
      },
    },
  },
};

describe('StateResolver', () => {
  it('returns null when location is not registered', () => {
    const result = StateResolver.resolve({ location: 'unknown', value: 'off', registry: baseRegistry });
    expect(result).toBeNull();
  });

  it('returns null when state value is not in the location map', () => {
    const result = StateResolver.resolve({ location: 'livingroom', value: 'glitch', registry: baseRegistry });
    expect(result).toBeNull();
  });

  it('produces an intent with the location target and the state-entry action', () => {
    const result = StateResolver.resolve({ location: 'livingroom', value: 'off', registry: baseRegistry });
    expect(result).toEqual({
      action: 'clear',
      target: 'livingroom-tv',
      params: {},
    });
  });

  it('flows non-reserved state-entry fields into params', () => {
    const result = StateResolver.resolve({ location: 'livingroom', value: 'on', registry: baseRegistry });
    expect(result.action).toBe('play');
    expect(result.target).toBe('livingroom-tv');
    expect(result.params).toEqual({ queue: 'ambient' });
  });

  it('lowercases the input value', () => {
    const result = StateResolver.resolve({ location: 'livingroom', value: 'OFF', registry: baseRegistry });
    expect(result?.action).toBe('clear');
  });

  it('throws when state entry has no action', () => {
    const registry = {
      locations: {
        livingroom: { target: 'tv', states: { off: {} } },
      },
    };
    expect(() => StateResolver.resolve({ location: 'livingroom', value: 'off', registry }))
      .toThrow(/state.*action/i);
  });
});
