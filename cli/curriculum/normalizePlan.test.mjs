import { describe, it, expect } from 'vitest';
import { baseCourseAndPart, classify, songFields, cleanTitle } from './normalizePlan.mjs';

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

describe('cleanTitle', () => {
  it('strips the "Course N – " prefix', () => {
    expect(cleanTitle('Silent Night – Rhumba 1 – Rhumba Groove Exercise', 'Silent Night – Rhumba 1'))
      .toBe('Rhumba Groove Exercise');
    expect(cleanTitle('Soloing Over a Turnaround 2 – Stride, Walking Bass', 'Soloing Over a Turnaround 2'))
      .toBe('Stride, Walking Bass');
  });
  it('leaves a title without the course prefix unchanged', () => {
    expect(cleanTitle('How to Practice', 'Practice Essentials Course')).toBe('How to Practice');
  });
  it('never returns empty (falls back to full title)', () => {
    expect(cleanTitle('Jazzy Blues Comping', 'Jazzy Blues Comping')).toBe('Jazzy Blues Comping');
  });
});

import { buildNormalizationPlan } from './normalizePlan.mjs';

const rec = (o) => ({ file: 'x.nfo', styles: [], wistia: 'w'+Math.abs(o.oldEpisode), ...o });

describe('buildNormalizationPlan', () => {
  it('renumbers each new season 1..N by (oldSeason, oldEpisode) and conserves count', () => {
    const recs = [
      rec({ oldSeason: 2, oldEpisode: 5, course: '2-5-1 Soloing with Bebop Scales', title: '2-5-1 Soloing with Bebop Scales – A' }),
      rec({ oldSeason: 1, oldEpisode: 9, course: 'Pop Soloing', title: 'Pop Soloing – Intro' }),
      rec({ oldSeason: 1, oldEpisode: 3, course: 'Pop Soloing', title: 'Pop Soloing – Setup' }),
    ];
    const plan = buildNormalizationPlan(recs);
    expect(plan.episodes.length).toBe(3);
    const soloing = plan.episodes.filter((e) => e.newSeason === 1).sort((a, b) => a.newEpisode - b.newEpisode);
    // old S1E3, S1E9, then S2E5 → new E1,E2,E3
    expect(soloing.map((e) => [e.oldSeason, e.oldEpisode, e.newEpisode]))
      .toEqual([[1, 3, 1], [1, 9, 2], [2, 5, 3]]);
    expect(soloing[0].newDir).toBe('Season 01 - Soloing');
    expect(soloing[0].newBasename).toBe('Piano With Jonny - S01E01 - Setup');
  });
  it('collapses multi-part courses under one base with part numbers', () => {
    const recs = [
      rec({ oldSeason: 7, oldEpisode: 56, course: 'Soloing Over a Turnaround 2', title: 'Soloing Over a Turnaround 2 – Stride' }),
      rec({ oldSeason: 7, oldEpisode: 34, course: 'Soloing Over a Turnaround 1', title: 'Soloing Over a Turnaround 1 – Progression' }),
    ];
    const plan = buildNormalizationPlan(recs);
    const bases = plan.episodes.map((e) => ({ base: e.base, part: e.part, title: e.newTitle }));
    expect(bases).toContainEqual({ base: 'Soloing Over a Turnaround', part: 1, title: 'Progression' });
    expect(bases).toContainEqual({ base: 'Soloing Over a Turnaround', part: 2, title: 'Stride' });
  });
  it('emits a song-merge row joining treatment variants', () => {
    const recs = [
      rec({ oldSeason: 10, oldEpisode: 1, course: 'Fly Me To The Moon', title: 'Fly Me To The Moon – A' }),
      rec({ oldSeason: 11, oldEpisode: 2, course: 'Fly Me to the Moon – Challenge', title: 'Fly Me to the Moon – Challenge – B' }),
      rec({ oldSeason: 12, oldEpisode: 3, course: 'Fly Me To The Moon Accompaniment', title: 'Fly Me To The Moon Accompaniment – C' }),
    ];
    const plan = buildNormalizationPlan(recs);
    const row = plan.songMerge.find((r) => r.songKey === 'fly me to the moon');
    expect(row).toBeTruthy();
    expect(row.treatments.sort()).toEqual(['accompaniment', 'challenge', 'tutorial']);
    expect(row.count).toBe(3);
  });
  it('summarizes seasons with per-group counts', () => {
    const recs = [
      rec({ oldSeason: 4, oldEpisode: 1, course: 'Major Drop 2 Voicings', title: 'Major Drop 2 Voicings – A' }),
      rec({ oldSeason: 4, oldEpisode: 2, course: 'Minor Block Chords', title: 'Minor Block Chords – A' }),
    ];
    const plan = buildNormalizationPlan(recs);
    const s3 = plan.seasons.find((s) => s.newSeason === 3);
    expect(s3).toMatchObject({ seasonName: 'Chord Voicings', lane: 'lessons', count: 2 });
    expect(s3.groups.map((g) => g.name).sort()).toEqual(['Block Chords', 'Drop 2 Voicings']);
  });
  it('picks a deterministic tutorial-form song display regardless of record order', () => {
    const recs = [
      rec({ oldSeason: 12, oldEpisode: 3, course: 'Fly Me To The Moon Accompaniment', title: 'x' }),
      rec({ oldSeason: 11, oldEpisode: 2, course: 'Fly Me to the Moon – Challenge', title: 'x' }),
      rec({ oldSeason: 10, oldEpisode: 1, course: 'Fly Me To The Moon', title: 'x' }),
    ];
    const row = buildNormalizationPlan(recs).songMerge.find((r) => r.songKey === 'fly me to the moon');
    expect(row.song).toBe('Fly Me To The Moon');
  });
});
