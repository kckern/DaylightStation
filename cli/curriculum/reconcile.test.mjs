import { describe, it, expect } from 'vitest';
import { parseAllLeaves, composeRatingKeyMap } from './reconcile.mjs';

const XML = `<MediaContainer size="2">
  <Video ratingKey="676057" parentIndex="6" index="1" title="a"/>
  <Video title="b" index="2" ratingKey="676058" parentIndex="6"/>
</MediaContainer>`;

describe('parseAllLeaves', () => {
  it('parses ratingKey/season/episode regardless of attribute order', () => {
    expect(parseAllLeaves(XML)).toEqual([
      { ratingKey: '676057', season: 6, episode: 1 },
      { ratingKey: '676058', season: 6, episode: 2 },
    ]);
  });
});

describe('composeRatingKeyMap', () => {
  it('maps old→new ratingKey through the plan (season,episode) pairing', () => {
    const before = [{ ratingKey: '676057', season: 6, episode: 1 }];          // old S6E1
    const plan = { episodes: [{ oldSeason: 6, oldEpisode: 1, newSeason: 6, newEpisode: 3 }] };
    const after = [{ ratingKey: '999001', season: 6, episode: 3 }];           // new S6E3
    const { map, unmatched } = composeRatingKeyMap({ before, plan, after });
    expect(map).toEqual({ '676057': '999001' });
    expect(unmatched).toEqual([]);
  });
  it('reports an old ratingKey that has no new counterpart', () => {
    const before = [{ ratingKey: '676057', season: 6, episode: 1 }];
    const plan = { episodes: [{ oldSeason: 6, oldEpisode: 1, newSeason: 6, newEpisode: 3 }] };
    const after = [];  // rescan didn't produce the new episode
    const { map, unmatched } = composeRatingKeyMap({ before, plan, after });
    expect(map).toEqual({});
    expect(unmatched).toEqual(['676057']);
  });
});
