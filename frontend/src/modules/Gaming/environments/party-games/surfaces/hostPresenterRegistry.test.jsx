import { describe, expect, it } from 'vitest';
import { PARTY_GAMES_HOST_REGISTRY } from './hostPresenterRegistry.js';

describe('Party Games host presenter registry', () => {
  it('registers every mounted Party Games experience by experience identity', () => {
    expect(Object.keys(PARTY_GAMES_HOST_REGISTRY).sort()).toEqual(['activity-party', 'charades', 'dice', 'jeopardy', 'selector']);
    expect(Object.values(PARTY_GAMES_HOST_REGISTRY).every((presenter) => typeof presenter === 'function')).toBe(true);
  });
});
