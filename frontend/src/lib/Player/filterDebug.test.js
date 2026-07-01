import { describe, it, expect } from 'vitest';
import {
  activeCueAt,
  nextCueAfter,
  computeGoto,
  debugCueState,
  DEFAULT_LEAD_SEC,
} from './filterDebug.js';

// Effective cues are always sorted by `in` (resolveEffectiveCues guarantees it).
const cues = [
  { id: 'a', effect: 'mute', category: 'language/profanity/fuck', in: 10, out: 10.5 },
  { id: 'b', effect: 'skip', category: 'violence/graphic', in: 100, out: 130 },
  { id: 'c', effect: 'bleep', category: 'language/profanity/shit', in: 200, out: 200.4 },
];

describe('activeCueAt', () => {
  it('returns the cue whose [in,out) contains t', () => {
    expect(activeCueAt(cues, 10.2)?.id).toBe('a');
    expect(activeCueAt(cues, 115)?.id).toBe('b');
  });
  it('is end-exclusive and returns null outside any cue', () => {
    expect(activeCueAt(cues, 10.5)).toBeNull(); // out is exclusive
    expect(activeCueAt(cues, 50)).toBeNull();
    expect(activeCueAt(cues, 0)).toBeNull();
  });
  it('tolerates empty/nullish input', () => {
    expect(activeCueAt([], 5)).toBeNull();
    expect(activeCueAt(null, 5)).toBeNull();
  });
});

describe('nextCueAfter', () => {
  it('returns the earliest cue starting strictly after t', () => {
    expect(nextCueAfter(cues, 0)?.id).toBe('a');
    expect(nextCueAfter(cues, 10)?.id).toBe('b'); // skips a cue you are inside/at its start
    expect(nextCueAfter(cues, 115)?.id).toBe('c');
  });
  it('returns null past the last cue', () => {
    expect(nextCueAfter(cues, 300)).toBeNull();
  });
});

describe('computeGoto', () => {
  it('next → lands LEAD seconds before the next cue in-point', () => {
    const g = computeGoto(cues, 0, 'next');
    expect(g.cue.id).toBe('a');
    expect(g.targetTime).toBeCloseTo(10 - DEFAULT_LEAD_SEC, 5);
  });
  it('next skips the cue currently under the playhead', () => {
    const g = computeGoto(cues, 105, 'next');
    expect(g.cue.id).toBe('c');
    expect(g.targetTime).toBeCloseTo(200 - DEFAULT_LEAD_SEC, 5);
  });
  it('prev → last cue whose in-point is before (t - LEAD), so repeated prev walks back', () => {
    // Standing at a's lead-in (t = 8.5) must NOT re-snap to a; there is no earlier cue.
    expect(computeGoto(cues, 10 - DEFAULT_LEAD_SEC, 'prev')).toBeNull();
    // From INSIDE b, prev replays b (jumps to b's own lead-in) — you're mid-cue, not at it.
    const replay = computeGoto(cues, 115, 'prev');
    expect(replay.cue.id).toBe('b');
    expect(replay.targetTime).toBeCloseTo(100 - DEFAULT_LEAD_SEC, 5);
    // A second prev from that lead-in walks back to a (b is now excluded by the threshold).
    const back = computeGoto(cues, replay.targetTime, 'prev');
    expect(back.cue.id).toBe('a');
    expect(back.targetTime).toBeCloseTo(10 - DEFAULT_LEAD_SEC, 5);
  });
  it('clamps the target time at 0', () => {
    const near = [{ id: 'z', effect: 'mute', in: 0.5, out: 1 }];
    expect(computeGoto(near, -1, 'next').targetTime).toBe(0);
  });
  it('honors a custom lead', () => {
    expect(computeGoto(cues, 0, 'next', 3).targetTime).toBeCloseTo(7, 5);
  });
  it('returns null when there is no cue in the requested direction', () => {
    expect(computeGoto(cues, 300, 'next')).toBeNull();
    expect(computeGoto([], 0, 'next')).toBeNull();
  });
});

describe('debugCueState', () => {
  it('reports the firing cue when the playhead is inside one', () => {
    const s = debugCueState(cues, 10.2);
    expect(s.firing).toBe(true);
    expect(s.focus.id).toBe('a');
    expect(s.index).toBe(1);
    expect(s.total).toBe(3);
    expect(s.countdownSec).toBeNull();
  });
  it('reports the next armed cue + countdown when between cues', () => {
    const s = debugCueState(cues, 90);
    expect(s.firing).toBe(false);
    expect(s.focus.id).toBe('b');
    expect(s.index).toBe(2);
    expect(s.countdownSec).toBeCloseTo(10, 5); // 100 - 90
  });
  it('flags canPrev/canNext at the edges', () => {
    const first = debugCueState(cues, 0);
    expect(first.canPrev).toBe(false);
    expect(first.canNext).toBe(true);
    const past = debugCueState(cues, 300);
    expect(past.focus).toBeNull();
    expect(past.canNext).toBe(false);
    expect(past.canPrev).toBe(true);
  });
  it('handles no cues', () => {
    const s = debugCueState([], 5);
    expect(s.focus).toBeNull();
    expect(s.total).toBe(0);
    expect(s.canPrev).toBe(false);
    expect(s.canNext).toBe(false);
  });
});
