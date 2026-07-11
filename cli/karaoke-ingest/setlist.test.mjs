import { describe, it, expect } from 'vitest';
import { parseSetlist, serializeSetlist } from './setlist.mjs';

const HEADER = 'season\tepisode\tartist\tsong\tsearch_hint\tstatus\tvideo_id';

describe('parseSetlist', () => {
  it('parses rows with typed season/episode and empties', () => {
    const tsv = `${HEADER}\n6\t3\tColdplay\tViva la Vida\t\tdownloaded\tabc123\n1\t\tFrank Sinatra\tMy Way\thq\tpending\t`;
    const rows = parseSetlist(tsv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ season: 6, episode: 3, artist: 'Coldplay', song: 'Viva la Vida', searchHint: '', status: 'downloaded', videoId: 'abc123' });
    expect(rows[1]).toEqual({ season: 1, episode: null, artist: 'Frank Sinatra', song: 'My Way', searchHint: 'hq', status: 'pending', videoId: '' });
  });

  it('ignores blank lines and tolerates a missing header', () => {
    const tsv = `2\t\tElton John\tYour Song\t\tpending\t\n\n`;
    const rows = parseSetlist(tsv);
    expect(rows).toHaveLength(1);
    expect(rows[0].artist).toBe('Elton John');
  });
});

describe('serializeSetlist', () => {
  it('round-trips through parse', () => {
    const rows = [
      { season: 6, episode: 3, artist: 'Coldplay', song: 'Viva la Vida', searchHint: '', status: 'downloaded', videoId: 'abc123' },
      { season: 1, episode: null, artist: 'Frank Sinatra', song: 'My Way', searchHint: 'hq', status: 'pending', videoId: '' },
    ];
    const out = serializeSetlist(rows);
    expect(out.startsWith(HEADER)).toBe(true);
    expect(parseSetlist(out)).toEqual(rows);
  });
});
