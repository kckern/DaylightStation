import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { windowChords } from './harmonicClassify.mjs';
import { pcSetToTriad } from './harmonicClassify.mjs';
import { classifyHarmony } from './harmonicClassify.mjs';

const BAR = 480 * 4;
const notes = [
  { ticks: 0, durationTicks: 240, midi: 60 },
  { ticks: 0, durationTicks: 240, midi: 64 },
  { ticks: 0, durationTicks: 240, midi: 67 },
  { ticks: BAR, durationTicks: 240, midi: 69 },
  { ticks: BAR, durationTicks: 240, midi: 60 },
  { ticks: BAR, durationTicks: 240, midi: 64 },
];

describe('windowChords', () => {
  it('returns one pitch-class set per bar', () => {
    const out = windowChords(notes, { ppq: 480, beats: 4, beatType: 4 });
    assert.equal(out.length, 2);
    assert.deepEqual([...out[0]].sort((a, b) => a - b), [0, 4, 7]);
    assert.deepEqual([...out[1]].sort((a, b) => a - b), [0, 4, 9]);
  });
  it('returns [] for no notes', () => {
    assert.deepEqual(windowChords([], { ppq: 480, beats: 4, beatType: 4 }), []);
  });
});

describe('pcSetToTriad', () => {
  it('names a major triad', () => {
    assert.deepEqual(pcSetToTriad(new Set([0, 4, 7])), { root: 0, quality: 'major' });
  });
  it('names a minor triad', () => {
    assert.deepEqual(pcSetToTriad(new Set([9, 0, 4])), { root: 9, quality: 'minor' });
  });
  it('picks the best-fitting triad from an extended set', () => {
    assert.deepEqual(pcSetToTriad(new Set([0, 4, 7, 11])), { root: 0, quality: 'major' });
  });
  it('returns null when no triad fits (e.g. a single note)', () => {
    assert.equal(pcSetToTriad(new Set([0])), null);
  });
});

const BAR2 = 480 * 4;
const cMajThenAMin = [
  { ticks: 0, durationTicks: 240, midi: 60 },
  { ticks: 0, durationTicks: 240, midi: 64 },
  { ticks: 0, durationTicks: 240, midi: 67 },
  { ticks: BAR2, durationTicks: 240, midi: 69 },
  { ticks: BAR2, durationTicks: 240, midi: 60 },
  { ticks: BAR2, durationTicks: 240, midi: 64 },
];

describe('classifyHarmony', () => {
  it('derives roman, barSpan and a signature from notes', () => {
    const r = classifyHarmony(cMajThenAMin, { ppq: 480, beats: 4, beatType: 4 });
    assert.deepEqual(r.roman, ['I', 'vi']);
    assert.equal(r.barSpan, 2);
    assert.equal(r.signature, 'I-vi');
    assert.ok(r.confidence > 0 && r.confidence <= 1);
  });
  it('reports low/zero confidence and null roman when no chords resolve', () => {
    const single = [{ ticks: 0, durationTicks: 240, midi: 60 }];
    const r = classifyHarmony(single, { ppq: 480, beats: 4, beatType: 4 });
    assert.equal(r.roman, null);
    assert.equal(r.signature, null);
    assert.equal(r.confidence, 0);
  });
});
