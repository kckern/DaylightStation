import { describe, it, expect } from 'vitest';
import {
  measuredTarget, levelTarget, parseCaptionCues, transcriptFor, normalizeExpectation, spearman,
  RUBRIC_INSTRUCTIONS, RUBRIC_LEVELS, LEVEL_TARGETS_DEFAULT, DEFAULT_TARGET_NPM, contentHash,
} from './lessonExpectation.mjs';

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hi there, welcome back.

2
00:01:01,200 --> 00:01:04,000
Now it's your turn.
Play along with me.
`;

describe('lessonExpectation helpers', () => {
  it('measuredTarget: slowest engaged rate, 0 under 6, capped at 40', () => {
    expect(measuredTarget({ minNpm: 16 })).toBe(16);
    expect(measuredTarget({ minNpm: 3 })).toBe(0);
    expect(measuredTarget({ minNpm: 128 })).toBe(40);
  });

  it('levelTarget rounds the score to a level', () => {
    expect(levelTarget(2.4)).toEqual({ level: 2, targetNpm: 13 });
    expect(levelTarget(0.3)).toEqual({ level: 0, targetNpm: 0 });
    expect(levelTarget(9)).toEqual({ level: 3, targetNpm: 25 });
    expect(levelTarget(1, [0, 2, 4, 6])).toEqual({ level: 1, targetNpm: 2 });
  });

  it('parses an SRT into a [mm:ss] transcript', () => {
    const cues = parseCaptionCues(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[1].startSec).toBeCloseTo(61.2, 3);
    const tx = transcriptFor(cues);
    expect(tx).toContain('[01:01]');
    expect(tx).toContain("Now it's your turn. Play along with me.");
  });

  it('transcript caps at 20 000 chars', () => {
    const cues = Array.from({ length: 3000 }, (_, i) => ({ startSec: i, text: 'play this note again please' }));
    expect(transcriptFor(cues).length).toBeLessThanOrEqual(20000);
  });

  it('normalizeExpectation rejects a negative target or a missing source', () => {
    expect(normalizeExpectation({ plexId: '1', source: 'ai', targetNpm: -1 })).toBeNull();
    expect(normalizeExpectation({ plexId: '1', targetNpm: 5 })).toBeNull();
    const ok = normalizeExpectation({ plexId: 'plex:1', source: 'measured', targetNpm: 16 });
    expect(ok.plexId).toBe('1');
    expect(ok.targetNpm).toBe(16);
  });

  it('spearman of a monotone pair is 1', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 45])).toBeCloseTo(1, 9);
    expect(spearman([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 9);
  });

  it('carries the rubric copy and defaults', () => {
    expect(RUBRIC_INSTRUCTIONS).toMatch(/^How much of this piano lesson/);
    expect(RUBRIC_LEVELS).toHaveLength(4);
    expect(RUBRIC_LEVELS[0]).toMatch(/^Watch only/);
    expect(LEVEL_TARGETS_DEFAULT).toEqual([0, 5, 13, 25]);
    expect(DEFAULT_TARGET_NPM).toBe(0);
  });
  it('contentHash is stable and changes with content', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
    expect(contentHash('abc')).toMatch(/^[0-9a-f]{16}$/);
  });
  it('normalizeExpectation keeps a missing levelScore/confidence as null, not 0', () => {
    const e = normalizeExpectation({ plexId: '1', source: 'measured', targetNpm: 9, levelScore: null, confidence: null, durationSec: null });
    expect(e.levelScore).toBeNull();
    expect(e.confidence).toBeNull();
    expect(e.durationSec).toBeNull();
  });
});
