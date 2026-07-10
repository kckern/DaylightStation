import { describe, it, expect } from 'vitest';
import { mergeEpisode, mergeSeason } from '#adapters/content/media/plex/CurriculumIndex.mjs';

// Mirrors the real 9-season 676490.json shapes post-reorg.
const index = {
  show: 676490,
  seasons: {
    '8': { title: 'Song Library', lane: 'repertoire', facets: ['difficulty', 'instructor', 'style'], episodes: 1515 },
    '1': { title: 'Soloing', lane: 'lessons', sequential: true, groups: ['Pop Soloing', '2-5-1 Soloing'] },
    '0': { title: 'Practice', lane: 'practice', groups: ['How to Practice', 'Scales'] },
  },
  episodes: {
    '8:100': { title: 'Learn the Lead Sheet', course: 'Misty', styles: ['Jazz Ballads'], skill: 'Beginner', instructor: 'John Proulx', type: 'Course', lane: 'repertoire', song: 'Misty', treatment: 'tutorial', part: 2 },
    '1:5': { title: 'Line Building', course: 'Pop Soloing with Chord Tone Targets', styles: ['Pop'], skill: 'Beginner', instructor: 'Jonny May', type: 'Workshop', lane: 'lessons', group: 'Pop Soloing' },
    '8:200': { title: 'Day 1', course: '10-Lesson Blues Challenge', styles: ['Blues'], skill: 'Intermediate', instructor: 'Jonny May', type: 'Course', lane: 'repertoire', treatment: 'challenge', skillChallenge: true },
  },
};

describe('mergeEpisode', () => {
  it('surfaces the full lane-model piano block for a repertoire episode', () => {
    const r = mergeEpisode(index, { season: 8, episode: 100 });
    expect(r.title).toBe('Learn the Lead Sheet');
    expect(r.piano).toMatchObject({ course: 'Misty', lane: 'repertoire', song: 'Misty', treatment: 'tutorial', part: 2, styles: ['Jazz Ballads'], skill: 'Beginner', instructor: 'John Proulx' });
  });
  it('surfaces lane + group for a lessons episode, omitting absent fields', () => {
    const r = mergeEpisode(index, { season: 1, episode: 5 });
    expect(r.piano).toMatchObject({ lane: 'lessons', group: 'Pop Soloing' });
    expect(r.piano.song).toBeUndefined();
    expect(r.piano.part).toBeUndefined();
  });
  it('surfaces skillChallenge', () => {
    const r = mergeEpisode(index, { season: 8, episode: 200 });
    expect(r.piano).toMatchObject({ skillChallenge: true, treatment: 'challenge' });
    expect(r.piano.song).toBeUndefined();
  });
  it('returns null for an unknown episode', () => {
    expect(mergeEpisode(index, { season: 99, episode: 9 })).toBeNull();
  });
});

describe('mergeSeason', () => {
  it('returns the lane block with groups', () => {
    expect(mergeSeason(index, 8).piano).toMatchObject({ lane: 'repertoire', facets: ['difficulty', 'instructor', 'style'] });
    expect(mergeSeason(index, 1).piano).toMatchObject({ lane: 'lessons', sequential: true, groups: ['Pop Soloing', '2-5-1 Soloing'] });
    expect(mergeSeason(index, 0).piano).toMatchObject({ lane: 'practice' });
  });
  it('does not emit legacy category/kind keys', () => {
    const p = mergeSeason(index, 8).piano;
    expect(p.category).toBeUndefined();
    expect(p.kind).toBeUndefined();
  });
});
