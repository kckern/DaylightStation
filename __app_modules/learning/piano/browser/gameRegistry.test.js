import { describe, expect, it } from 'vitest';

import { getGameEntry, getGameIds } from './gameRegistry.js';

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
