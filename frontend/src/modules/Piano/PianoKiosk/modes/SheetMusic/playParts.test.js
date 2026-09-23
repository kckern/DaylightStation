import { describe, it, expect } from 'vitest';
import { partsOf, buildPlayTimeline } from './playParts.js';

const NOTES = [
  { midi: 76, staff: 0, onsetQuarter: 0, durationQuarters: 1 },
  { midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 2 },
  { midi: 77, staff: 0, onsetQuarter: 1, durationQuarters: 1 },
];
const EVENTS = [{ onsetQuarter: 0, midi: 76 }, { onsetQuarter: 1, midi: 77 }];
const MAP = [{ onsetQuarter: 0, bpm: 60 }];

describe('partsOf', () => {
  it('lists distinct staves in order with default role play', () => {
    expect(partsOf(NOTES)).toEqual([{ staff: 0, role: 'play' }, { staff: 1, role: 'play' }]);
  });
});

describe('buildPlayTimeline', () => {
  it('merges cursor steps with note on/offs for audible parts only, time-sorted', () => {
    const tl = buildPlayTimeline(EVENTS, NOTES, MAP, { 0: 'mute', 1: 'play' });
    expect(tl.map((e) => e.kind ?? e.type)).toEqual(['step', 'note_on', 'step', 'note_off']);
    expect(tl.find((e) => e.type === 'note_on').note).toBe(40); // only the active (LH) staff sounds
  });
});

