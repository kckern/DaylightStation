import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { windowChords } from './harmonicClassify.mjs';

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
