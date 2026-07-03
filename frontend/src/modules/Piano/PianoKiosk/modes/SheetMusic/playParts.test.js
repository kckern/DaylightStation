import { describe, it, expect } from 'vitest';
import { partsOf, cyclePart, buildPlayTimeline, youMidisAt, allPlayRoles } from './playParts.js';

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

describe('cyclePart', () => {
  it('cycles play → you → mute → play', () => {
    expect(cyclePart('play')).toBe('you');
    expect(cyclePart('you')).toBe('mute');
    expect(cyclePart('mute')).toBe('play');
  });
});

describe('buildPlayTimeline', () => {
  it('merges cursor steps with note on/offs for audible parts only, time-sorted', () => {
    const tl = buildPlayTimeline(EVENTS, NOTES, MAP, { 0: 'you', 1: 'play' });
    expect(tl.map((e) => e.kind ?? e.type)).toEqual(['step', 'note_on', 'step', 'note_off']);
    expect(tl.find((e) => e.type === 'note_on').note).toBe(40); // only the LH sounds
  });
});

describe('youMidisAt', () => {
  it('returns the you-part pitches at an onset', () => {
    expect([...youMidisAt(NOTES, { 0: 'you', 1: 'play' }, 0)]).toEqual([76]);
    expect(youMidisAt(NOTES, { 0: 'play', 1: 'play' }, 0)).toBeNull();
  });
});

describe('allPlayRoles', () => {
  it('sets every staff to play', () => {
    expect(allPlayRoles([{ staff: 0 }, { staff: 1 }])).toEqual({ 0: 'play', 1: 'play' });
  });
  it('handles empty', () => { expect(allPlayRoles([])).toEqual({}); });
});
