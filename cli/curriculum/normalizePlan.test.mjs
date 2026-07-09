import { describe, it, expect } from 'vitest';
import { baseCourseAndPart, classify, songFields } from './normalizePlan.mjs';

describe('baseCourseAndPart', () => {
  it('strips a trailing en-dash part number', () => {
    expect(baseCourseAndPart('Silent Night – Rhumba 1')).toEqual({ base: 'Silent Night – Rhumba', part: 1 });
    expect(baseCourseAndPart('Jazz Swing Rhythm Essentials – 2')).toEqual({ base: 'Jazz Swing Rhythm Essentials', part: 2 });
  });
  it('strips a trailing bare part number', () => {
    expect(baseCourseAndPart('Epic Minor Chords 2')).toEqual({ base: 'Epic Minor Chords', part: 2 });
  });
  it('leaves single-part courses untouched', () => {
    expect(baseCourseAndPart('Altered Dominant Rootless Voicings')).toEqual({ base: 'Altered Dominant Rootless Voicings', part: null });
  });
  it('does not strip a number that is part of the name', () => {
    expect(baseCourseAndPart('5 Jazz Comping Approaches 1')).toEqual({ base: '5 Jazz Comping Approaches', part: 1 });
    expect(baseCourseAndPart('2-5-1 Soloing with Bebop Scales')).toEqual({ base: '2-5-1 Soloing with Bebop Scales', part: null });
  });
});

describe('classify', () => {
  it('routes practice sources into new season 0 with topic groups', () => {
    expect(classify(0, 'Practice Essentials Course')).toMatchObject({ lane: 'practice', newSeason: 0, seasonName: 'Practice', group: 'How to Practice' });
    expect(classify(5, 'The Major Blues Scale (Gospel Scale)')).toMatchObject({ lane: 'practice', newSeason: 0, group: 'Scales' });
    expect(classify(9, 'Two-Hand Coordination Exercises')).toMatchObject({ lane: 'practice', newSeason: 0, group: 'Two-Hand Coordination' });
    expect(classify(9, 'Dominant 7th Chord Exercises')).toMatchObject({ lane: 'practice', newSeason: 0, group: 'Chord & Voicing Exercises' });
  });
  it('splits old Season 08 by strand: essentials→Lessons(6), exercises→Practice(0)', () => {
    expect(classify(8, 'Jazz Swing Rhythm Essentials')).toMatchObject({ lane: 'lessons', newSeason: 6, seasonName: 'Comping & Rhythm', group: 'Rhythm Essentials' });
    expect(classify(8, 'Bossa Nova – Rhythm Exercises')).toMatchObject({ lane: 'practice', newSeason: 0, group: 'Rhythm Exercises' });
  });
  it('combines old S01+S02 into Soloing with per-source groups', () => {
    expect(classify(1, 'Pop Soloing With Chord Tone Targets')).toMatchObject({ newSeason: 1, seasonName: 'Soloing', group: 'Pop Soloing' });
    expect(classify(2, '2-5-1 Soloing with Bebop Scales')).toMatchObject({ newSeason: 1, seasonName: 'Soloing', group: '2-5-1 Soloing' });
  });
  it('splits old Season 04 into Voicings / Theory / Lead Sheets', () => {
    expect(classify(4, 'Major Drop 2 Voicings')).toMatchObject({ newSeason: 3, seasonName: 'Chord Voicings', group: 'Drop 2 Voicings' });
    expect(classify(4, 'Dominant Quartal Voicings')).toMatchObject({ newSeason: 3, group: 'Quartal Voicings' });
    expect(classify(4, 'Minor Block Chords')).toMatchObject({ newSeason: 3, group: 'Block Chords' });
    expect(classify(4, 'Major Chord Rootless Voicings')).toMatchObject({ newSeason: 3, group: 'Rootless Voicings' });
    expect(classify(4, 'Piano Chord Extensions')).toMatchObject({ newSeason: 4, seasonName: 'Chord Theory & Color', group: null });
    expect(classify(4, 'Passing Chords & Reharmonization')).toMatchObject({ newSeason: 4, group: null });
    expect(classify(4, 'Play Piano Lead Sheets With Block Chords')).toMatchObject({ newSeason: 5, seasonName: 'Lead Sheet Application', group: null });
  });
  it('maps remaining lessons seasons and repertoire treatments', () => {
    expect(classify(3, 'Scales for Improv on 7th Chords')).toMatchObject({ lane: 'lessons', newSeason: 2, seasonName: 'Improvisation' });
    expect(classify(6, 'Jazzy Blues Comping')).toMatchObject({ newSeason: 6, seasonName: 'Comping & Rhythm', group: 'Comping' });
    expect(classify(7, 'Soloing Over a Turnaround')).toMatchObject({ newSeason: 7, seasonName: 'Intros, Endings & Fills' });
    expect(classify(10, 'Autumn Leaves')).toMatchObject({ lane: 'repertoire', newSeason: 8, seasonName: 'Song Library', treatment: 'tutorial' });
    expect(classify(11, 'Autumn Leaves – Challenge')).toMatchObject({ lane: 'repertoire', newSeason: 8, treatment: 'challenge' });
    expect(classify(12, 'Jazz Swing Accompaniment')).toMatchObject({ lane: 'repertoire', newSeason: 8, treatment: 'accompaniment' });
  });
  it('keeps an in-lesson exercise inside its Lessons season (S07 exception)', () => {
    expect(classify(7, 'Major Turnaround Exercises With 7th Chords')).toMatchObject({ lane: 'lessons', newSeason: 7 });
  });
});

describe('songFields', () => {
  it('merges punctuation/casing/treatment variants to one key', () => {
    const a = songFields('Fly Me To The Moon', []);
    const b = songFields('Fly Me to the Moon – Challenge', []);
    const c = songFields('Fly Me To The Moon – Challenge', []);
    expect(a.songKey).toBe(b.songKey);
    expect(b.songKey).toBe(c.songKey);
    expect(a.song).toBe('Fly Me To The Moon');   // display from the first/tutorial form
    expect(a.skillChallenge).toBe(false);
  });
  it('strips a trailing style token that matches the episode styles', () => {
    const jb = songFields('Silent Night – Jazz Ballad', ['Jazz Ballads']);
    const rh = songFields('Silent Night – Rhumba', ['Latin']);
    expect(jb.songKey).toBe('silent night');
    expect(rh.songKey).toBe('silent night');
  });
  it('flags non-song challenges as skillChallenge with null song', () => {
    for (const n of ['Blues Improvisation Challenge', 'The 10-Lesson Blues Challenge', 'The Halloween Progression Challenge', 'Jazz Ballad Soloing Challenge']) {
      const r = songFields(n, []);
      expect(r.skillChallenge).toBe(true);
      expect(r.song).toBeNull();
      expect(r.songKey).toBeNull();
    }
  });
  it('matches SKILL_CHALLENGE with en-dash variant', () => {
    expect(songFields('The 10–Lesson Blues Challenge', []).skillChallenge).toBe(true);
  });
  it('does NOT treat a technique course with an example song as that song', () => {
    // "Ear Training With Holiday Songs 1" is a technique course, not a Silent Night song.
    const r = songFields('Ear Training With Holiday Songs', []);
    expect(r.songKey).toBe('ear training with holiday songs');
    expect(r.skillChallenge).toBe(false);
  });
});
