import { describe, it, expect } from 'vitest';
import { collapseResultEditions } from './collapseResultEditions.js';

describe('collapseResultEditions', () => {
  it('lists one album once across editions but keeps same-named episodes apart', () => {
    const rows = [
      { id: 'plex:1', title: 'Persuasion', type: 'album' }, { id: 'plex:2', title: 'Persuasion', type: 'album' },
      { id: 'plex:3', title: 'Pilot', type: 'episode', parentTitle: 'A' }, { id: 'plex:4', title: 'Pilot', type: 'episode', parentTitle: 'B' },
    ];
    expect(collapseResultEditions(rows).map(r => r.id)).toEqual(['plex:1', 'plex:3', 'plex:4']);
  });
  it('tolerates junk', () => { expect(collapseResultEditions(undefined)).toEqual([]); });
});
