import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { midiToPitch, midiToScore } from './midiToScore.mjs';

describe('midiToPitch', () => {
  it('spells naturals and sharps (C=0 reference, sharp default)', () => {
    assert.deepEqual(midiToPitch(60), { step: 'C', octave: 4, alter: 0 });
    assert.deepEqual(midiToPitch(61), { step: 'C', octave: 4, alter: 1 });
    assert.deepEqual(midiToPitch(66), { step: 'F', octave: 4, alter: 1 });
    assert.deepEqual(midiToPitch(59), { step: 'B', octave: 3, alter: 0 });
    assert.deepEqual(midiToPitch(21), { step: 'A', octave: 0, alter: 0 }); // lowest piano key
  });
});

describe('midiToScore', () => {
  const parsed = {
    ppq: 480,
    tempo: 120,
    timeSig: [4, 4],
    notes: [
      { ticks: 0, durationTicks: 480, midi: 60 },
      { ticks: 480, durationTicks: 240, midi: 64 },
      { ticks: 1920, durationTicks: 480, midi: 67 },
    ],
  };

  it('emits a parseMusicXml-compatible score shell', () => {
    const score = midiToScore(parsed);
    assert.equal(score.tempo, 120);
    assert.deepEqual(score.timeSig, { beats: 4, beatType: 4 });
    assert.deepEqual(score.key, { fifths: 0 });
    assert.equal(score.parts.length, 1);
  });

  it('converts ticks to absolute quarter-beat onsets and durations', () => {
    const notes = midiToScore(parsed).parts[0].notes;
    assert.equal(notes[0].onsetQuarter, 0);
    assert.equal(notes[0].durationQuarters, 1);
    assert.equal(notes[1].onsetQuarter, 1); // 480 / 480 ppq
    assert.equal(notes[1].durationQuarters, 0.5);
    assert.equal(notes[2].onsetQuarter, 4); // 1920 / 480 = bar 2 downbeat
  });

  it('carries midi + spelled pitch and marks notes non-rest', () => {
    const n = midiToScore(parsed).parts[0].notes[1];
    assert.equal(n.midi, 64);
    assert.deepEqual(n.pitch, { step: 'E', octave: 4, alter: 0 });
    assert.equal(n.rest, false);
  });

  it('sorts notes by onset', () => {
    const shuffled = { ...parsed, notes: [parsed.notes[2], parsed.notes[0], parsed.notes[1]] };
    const onsets = midiToScore(shuffled).parts[0].notes.map((n) => n.onsetQuarter);
    assert.deepEqual(onsets, [0, 1, 4]);
  });
});
