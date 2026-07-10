import { describe, it, expect } from 'vitest';
import { partitionSongs, availableTreatments, TREATMENTS } from './repertoire.js';

const ep = (song, treatment, extra = {}) => ({ title: `${song} ep`, piano: { song, treatment, course: song, ...extra } });

describe('partitionSongs', () => {
  it('merges treatments of one song into one entry', () => {
    const { songs } = partitionSongs([
      ep('Misty', 'tutorial'), ep('Misty', 'tutorial'),
      ep('Misty', 'challenge'), ep('Misty', 'accompaniment'),
    ]);
    expect(songs).toHaveLength(1);
    expect(songs[0].title).toBe('Misty');
    expect(songs[0].treatments.tutorial).toHaveLength(2);
    expect(songs[0].treatments.challenge).toHaveLength(1);
    expect(songs[0].treatments.accompaniment).toHaveLength(1);
    expect(songs[0].count).toBe(4);
  });
  it('sorts songs alphabetically, case-insensitive', () => {
    const { songs } = partitionSongs([ep('blue Moon', 'tutorial'), ep('Autumn Leaves', 'tutorial')]);
    expect(songs.map((s) => s.title)).toEqual(['Autumn Leaves', 'blue Moon']);
  });
  it('routes skillChallenge items to the shelf, grouped by course', () => {
    const { songs, skillChallenges } = partitionSongs([
      { title: 'Day 1', piano: { course: '10-Lesson Blues Challenge', treatment: 'challenge', skillChallenge: true } },
      { title: 'Day 2', piano: { course: '10-Lesson Blues Challenge', treatment: 'challenge', skillChallenge: true } },
      ep('Misty', 'tutorial'),
    ]);
    expect(songs).toHaveLength(1);
    expect(skillChallenges).toHaveLength(1);
    expect(skillChallenges[0].title).toBe('10-Lesson Blues Challenge');
    expect(skillChallenges[0].lessons).toHaveLength(2);
  });
  it('falls back to course/title when song is absent', () => {
    const { songs } = partitionSongs([{ title: 'Solo ep', piano: { course: 'Some Course', treatment: 'tutorial' } }]);
    expect(songs[0].title).toBe('Some Course');
  });
});

describe('availableTreatments', () => {
  it('returns present treatments in canonical order', () => {
    const { songs } = partitionSongs([ep('Misty', 'accompaniment'), ep('Misty', 'tutorial')]);
    expect(availableTreatments(songs[0]).map((t) => t.key)).toEqual(['tutorial', 'accompaniment']);
  });
  it('TREATMENTS carries the copy contract', () => {
    expect(TREATMENTS.map((t) => t.action)).toEqual(['Learn it', 'Master it', 'Comp it']);
    expect(TREATMENTS.map((t) => t.chip)).toEqual(['Tutorial', 'Challenge', 'Accompaniment']);
  });
});
