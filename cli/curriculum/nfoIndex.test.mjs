import { describe, it, expect } from 'vitest';
import { parseEpisodeNfo, parseSeasonNfo, buildIndex } from './nfoIndex.mjs';

const EP = `<?xml version="1.0"?><episodedetails>
  <title>Ain't Misbehavin' - 1 - Intro</title><season>10</season><episode>1</episode>
  <plot>Intro. From "Ain't Misbehavin' - 1" by Piano With Jonny.</plot>
  <genre>Music</genre><genre>Educational</genre><genre>Jazz Ballads</genre>
  <tag>Course: Ain't Misbehavin' - 1</tag><tag>Skill Level: Beginner</tag>
  <tag>Focus: Songs</tag><tag>Type: Course</tag><credits>John Proulx</credits>
</episodedetails>`;

describe('parseEpisodeNfo', () => {
  it('extracts fields and picks the non-generic genre as style', () => {
    expect(parseEpisodeNfo(EP)).toEqual({
      season: 10, episode: 1,
      title: 'Ain\'t Misbehavin\' - 1 - Intro',
      plot: 'Intro. From "Ain\'t Misbehavin\' - 1" by Piano With Jonny.',
      course: 'Ain\'t Misbehavin\' - 1', style: 'Jazz Ballads',
      skill: 'Beginner', focus: ['Songs'], type: 'Course', instructor: 'John Proulx',
    });
  });
});

describe('parseSeasonNfo', () => {
  it('reads season number + title', () => {
    expect(parseSeasonNfo('<season><seasonnumber>11</seasonnumber><title>Song - Challenges</title></season>'))
      .toEqual({ season: 11, title: 'Song - Challenges' });
  });
});

describe('buildIndex', () => {
  it('keys episodes by season:episode and merges season meta + counts', () => {
    const idx = buildIndex({
      show: 676490,
      seasonMeta: { 10: { category: 'repertoire', kind: 'tutorial', facets: ['difficulty','instructor','style'] } },
      episodes: [parseEpisodeNfo(EP)],
    });
    expect(idx.show).toBe(676490);
    expect(idx.episodes['10:1'].course).toBe('Ain\'t Misbehavin\' - 1');
    expect(idx.seasons['10']).toMatchObject({ category: 'repertoire', kind: 'tutorial', episodes: 1 });
  });
});
