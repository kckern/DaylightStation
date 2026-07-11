import { describe, it, expect } from 'vitest';
import { parseSeedTsv, convertSeed } from './convertSeed.mjs';
import { resolveSeason } from './config.mjs';

const SEED = [
  'Artist / Source\tSong Title\tCategory / Vibe\tKey Feature',
  'Frank Sinatra\tMy Way\tTheatrical Crooner\tDramatic',
  'Elton John\tCircle of Life\tPiano Rock Master / Disney\tMajestic',
  'Nobody\tMystery\tUncharted Genre\tNope',
].join('\n');

describe('parseSeedTsv', () => {
  it('reads the four seed columns and skips the header', () => {
    const rows = parseSeedTsv(SEED);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ artist: 'Frank Sinatra', song: 'My Way', category: 'Theatrical Crooner', feature: 'Dramatic' });
  });
});

describe('convertSeed', () => {
  it('maps categories to season numbers and reports unmatched rows', () => {
    const { rows, unmatched } = convertSeed(parseSeedTsv(SEED), resolveSeason);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ season: 1, episode: null, artist: 'Frank Sinatra', song: 'My Way', searchHint: '', status: 'pending', videoId: '' });
    expect(rows[1].season).toBe(2); // "Piano Rock Master / Disney" → first match Piano Men
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].category).toBe('Uncharted Genre');
  });
});
