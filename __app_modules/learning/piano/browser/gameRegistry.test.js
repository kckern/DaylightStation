import { describe, expect, it } from 'vitest';

import { gameOwnsEdgeHold, getGameEntry, getGameIds } from './gameRegistry.js';

describe('piano game registry ordering', () => {
  it('publishes Connect Four as the eighth game', () => {
    const gameIds = getGameIds();

    expect(gameIds[7]).toBe('connect-four');
    expect(getGameEntry(gameIds[7])).toMatchObject({
      label: 'Connect Four',
      status: 'released',
    });
  });
});

describe('the edge-key hold', () => {
  it('Sheet Music owns it (its menu); no game does', () => {
    expect(getGameEntry('sheet-music').ownsEdgeHold).toBe(true);
    expect(getGameIds().filter((id) => getGameEntry(id).ownsEdgeHold)).toEqual(['sheet-music']);
  });
});

describe('gameOwnsEdgeHold', () => {
  it('a crashed Sheet Music gives the hold back to the launcher, so the screen is never stuck', () => {
    expect(gameOwnsEdgeHold('sheet-music')).toBe(true);
    expect(gameOwnsEdgeHold('sheet-music', { crashed: true })).toBe(false);
    expect(gameOwnsEdgeHold('tetris')).toBe(false);
    expect(gameOwnsEdgeHold(null)).toBe(false);
  });
});
