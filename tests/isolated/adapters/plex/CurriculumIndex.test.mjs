import { describe, it, expect } from 'vitest';
import { mergeEpisode, mergeSeason } from '#adapters/content/media/plex/CurriculumIndex.mjs';

const index = {
  show: 676490,
  seasons: { '10': { title: 'Song Tutorials', category: 'repertoire', kind: 'tutorial', facets: ['difficulty','instructor','style'], episodes: 1052 },
             '1': { title: 'Pop Soloing', category: 'lesson', sequential: true } },
  episodes: { '10:1': { title: 'Ain\'t Misbehavin\' - 1 - Intro', course: 'Ain\'t Misbehavin\' - 1', styles: ['Jazz Ballads'], skill: 'Beginner', instructor: 'John Proulx', focus: ['Songs'], type: 'Course' } },
};

describe('mergeEpisode', () => {
  it('returns corrected title + piano fields for a known episode', () => {
    const r = mergeEpisode(index, { season: 10, episode: 1 });
    expect(r.title).toBe('Ain\'t Misbehavin\' - 1 - Intro');
    expect(r.piano).toMatchObject({ course: 'Ain\'t Misbehavin\' - 1', styles: ['Jazz Ballads'], skill: 'Beginner', instructor: 'John Proulx' });
  });
  it('returns null for an unknown episode', () => {
    expect(mergeEpisode(index, { season: 99, episode: 9 })).toBeNull();
  });
});

describe('mergeSeason', () => {
  it('returns the category block', () => {
    expect(mergeSeason(index, 10).piano).toMatchObject({ category: 'repertoire', kind: 'tutorial', facets: ['difficulty','instructor','style'] });
    expect(mergeSeason(index, 1).piano).toMatchObject({ category: 'lesson', sequential: true });
  });
});
