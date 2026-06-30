import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseKeyFolder, extractBpm, extractReverb, extractDegrees, extractChords,
  kebab, filenameToLoopMeta,
} from './loopMeta.mjs';

describe('parseKeyFolder', () => {
  it('parses the "X Major - Y Minor" form', () => {
    assert.deepEqual(parseKeyFolder('Gb Major - Eb Minor'), { major: 6, minor: 3, raw: 'Gb Major - Eb Minor' });
    assert.deepEqual(parseKeyFolder('C Major - A Minor'), { major: 0, minor: 9, raw: 'C Major - A Minor' });
  });
  it('parses the compact "XMaj_YMin" form', () => {
    assert.deepEqual(parseKeyFolder('EMaj_C#Min'), { major: 4, minor: 1, raw: 'EMaj_C#Min' });
    assert.deepEqual(parseKeyFolder('CMaj_AMin'), { major: 0, minor: 9, raw: 'CMaj_AMin' });
  });
  it('returns null for non-key folders', () => {
    assert.equal(parseKeyFolder('Metallica'), null);
    assert.equal(parseKeyFolder('2 - Catchy'), null);
  });
});

describe('extractBpm', () => {
  it('pulls BPM out of a name', () => {
    assert.equal(extractBpm('One_Chorus_E-A-G-F#m_100BPM'), 100);
    assert.equal(extractBpm('35_Darkness_Intense_Cinematic_137BPM'), 137);
    assert.equal(extractBpm('Catchy_Madness_5-6-1_DRY'), null);
  });
});

describe('extractReverb', () => {
  it('detects WET/DRY suffix', () => {
    assert.equal(extractReverb('Catchy_Madness_5-6-1_DRY'), 'dry');
    assert.equal(extractReverb('Quick_Moves_7-1-7-6_WET'), 'wet');
    assert.equal(extractReverb('One_Chorus_E-A-G-F#m_100BPM'), null);
  });
});

describe('extractDegrees', () => {
  it('extracts the scale-degree run from a melody name', () => {
    assert.deepEqual(extractDegrees('Catchy_Madness_5-6-1_DRY'), [5, 6, 1]);
    assert.deepEqual(extractDegrees('Catchy_Soul_3-5-2-3-3-5-2-1_WET'), [3, 5, 2, 3, 3, 5, 2, 1]);
    assert.deepEqual(extractDegrees('1-2-3-4 Catchy Pattern_WET'), [1, 2, 3, 4]);
  });
  it('returns null when there is no degree run', () => {
    assert.equal(extractDegrees('One_Chorus_E-A-G-F#m'), null);
  });
});

describe('extractChords', () => {
  it('extracts a hyphenated chord run', () => {
    assert.deepEqual(extractChords('235_Ebm-Db-Gb-Abm-Gb-Cb'), ['Ebm', 'Db', 'Gb', 'Abm', 'Gb', 'Cb']);
    assert.deepEqual(extractChords('One_Chorus_E-A-G-F#m_100BPM'), ['E', 'A', 'G', 'F#m']);
    assert.deepEqual(extractChords('Niko_Kotoulas_Bassline_1_C-Eb-Ab-Bb'), ['C', 'Eb', 'Ab', 'Bb']);
  });
  it('returns null when there is no chord run', () => {
    assert.equal(extractChords('Catchy_Madness_5-6-1_DRY'), null);
  });
});

describe('kebab', () => {
  it('kebab-cases names, dropping noise', () => {
    assert.equal(kebab('Catchy_Madness'), 'catchy-madness');
    assert.equal(kebab('One Chorus'), 'one-chorus');
    assert.equal(kebab('F#m7(b5)'), 'f-m7-b5');
  });
});

describe('filenameToLoopMeta', () => {
  it('parses a NikoChord progression', () => {
    const m = filenameToLoopMeta('2000_NikoChord_Pack/201-250/Gb Major - Eb Minor/Chords/235_Ebm-Db-Gb-Abm-Gb-Cb.mid');
    assert.equal(m.source, 'niko-chord');
    assert.equal(m.type, 'chord-progression');
    assert.deepEqual(m.key, { major: 6, minor: 3, raw: 'Gb Major - Eb Minor' });
    assert.equal(m.index, 235);
    assert.deepEqual(m.chords, ['Ebm', 'Db', 'Gb', 'Abm', 'Gb', 'Cb']);
    assert.equal(m.reverb, null);
  });

  it('parses a melody starter with mood + degrees + reverb', () => {
    const m = filenameToLoopMeta('Top_100_Melody_Starters/Gb Major - Eb Minor/Top 100 Melody Starters/2 - Catchy/Catchy_Madness_5-6-1_DRY.mid');
    assert.equal(m.source, 'melody-starters');
    assert.equal(m.type, 'melody');
    assert.equal(m.mood, 'Catchy');
    assert.deepEqual(m.degrees, [5, 6, 1]);
    assert.equal(m.reverb, 'dry');
  });

  it('parses a famous-song snippet with artist + bpm + chords', () => {
    const m = filenameToLoopMeta('FamousMIDI_Bonus/Classics/EMaj_C#Min/Metallica/One_Chorus_E-A-G-F#m_100BPM.mid');
    assert.equal(m.source, 'famous');
    assert.equal(m.category, 'Classics');
    assert.equal(m.artist, 'Metallica');
    assert.equal(m.bpm, 100);
    assert.deepEqual(m.chords, ['E', 'A', 'G', 'F#m']);
    assert.equal(m.key.major, 4);
  });

  it('does not mistake a digit-led filename for a mood folder', () => {
    const m = filenameToLoopMeta('Top_100_Melody_Starters/C Major - A Minor/Top 100 Melody Starters/2 - Catchy/1-2-3-4 Catchy Pattern_WET.mid');
    assert.equal(m.mood, 'Catchy'); // from the "2 - Catchy" folder, not the filename
  });

  it('falls back to the filename key suffix for "Original_Key" famous files', () => {
    const m = filenameToLoopMeta('FamousMIDI_Bonus/TopHits/Original_Key/Justin Bieber/Love_Yourself_Verse_E-B-C#m-F#m-E-B_100BPM_EMajor.mid');
    assert.equal(m.key.major, 4); // E major from "_EMajor" suffix
    assert.equal(m.artist, 'Justin Bieber');
    assert.equal(m.bpm, 100);
  });

  it('pulls BPM + descriptor from the parent folder for "Best Ideas"', () => {
    const m = filenameToLoopMeta('Niko_MIDI_Pack_/B Major - G# Minor/1 - Best Ideas/51-75/68_Beautiful_Peaceful_Rhythm_118BPM/Niko_Kotoulas_Idea_68_WET.mid');
    assert.equal(m.type, 'idea');
    assert.equal(m.bpm, 118);
    assert.equal(m.reverb, 'wet');
    assert.equal(m.key.major, 11); // B major
    assert.match(m.descriptor, /Beautiful/);
  });

  it('always yields a kebab slug and the original path', () => {
    const rel = 'FamousMIDI_Bonus/Classics/EMaj_C#Min/Metallica/One_Chorus_E-A-G-F#m_100BPM.mid';
    const m = filenameToLoopMeta(rel);
    assert.equal(m.sourcePath, rel);
    assert.match(m.slug, /^[a-z0-9-]+$/);
  });
});
