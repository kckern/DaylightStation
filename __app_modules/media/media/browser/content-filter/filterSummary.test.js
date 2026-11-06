import { describe, it, expect } from 'vitest';
import { filterSummary, isProvisional, unrefinedWordCount, bumperStartWindowSec } from './filterSummary.js';
import { PRECISE } from './contentFilter.js';

const c = (effect, extra = {}) => ({ id: `${effect}-${Math.random()}`, effect, in: 0, out: 1, ...extra });

describe('filterSummary', () => {
  it('counts words, blurred scenes, skipped scenes and credits separately', () => {
    const cues = [c('mute'), c('mute'), c('full-blur'), c('skip'),
      c('skip', { category: 'credits/opening_credits' })];
    expect(filterSummary(cues)).toBe('2 words muted · 1 scene blurred · 1 scene skipped · credits skipped');
  });
  it('says bleeped when every word is bleeped, and muted or bleeped when mixed', () => {
    expect(filterSummary([c('bleep')])).toBe('1 word bleeped');
    expect(filterSummary([c('bleep'), c('mute')])).toBe('2 words muted or bleeped');
  });
  it('counts skip-card as a skipped scene and black as hidden', () => {
    expect(filterSummary([c('skip-card'), c('black')])).toBe('1 scene hidden · 1 scene skipped');
  });
  it('returns an empty string when nothing is filtered', () => {
    expect(filterSummary([])).toBe('');
  });
});

describe('isProvisional', () => {
  it('is false when the EDL carries any certification level', () => {
    expect(isProvisional([c('mute', { precision: 'second-approx' })], { level: 'machine' })).toBe(false);
  });
  it('is true with no certification block, even when every word cue is precise', () => {
    expect(isProvisional([c('mute', { precision: 'ms' })])).toBe(true);
    expect(isProvisional([])).toBe(true);
  });
  it("is true for the server's explicit level 'none'", () => {
    expect(isProvisional([], { level: 'none', blocking: ['va1'] })).toBe(true);
    expect(isProvisional([], { level: 'parent' })).toBe(false);
  });
});

describe('unrefinedWordCount', () => {
  it('counts mute/bleep cues not at a precise level, ignoring skips and blurs', () => {
    expect(unrefinedWordCount([
      c('mute', { precision: 'ms' }), c('bleep', { precision: 'srt-line' }),
      c('mute', { precision: 'second-approx' }), c('skip', { precision: 'second-approx' }),
    ])).toBe(2);
  });
  it('uses exactly the resolver\'s precise levels', () => {
    expect([...PRECISE].sort()).toEqual(['frame', 'ms']);
    for (const precision of PRECISE) expect(unrefinedWordCount([c('mute', { precision })])).toBe(0);
  });
});

describe('bumperStartWindowSec', () => {
  it('extends past an opening skip (BTTF credits 0–18 s)', () => {
    expect(bumperStartWindowSec([c('skip', { in: 0, out: 18 })])).toBe(19);
  });
  it('keeps the base window when no skip starts inside it', () => {
    expect(bumperStartWindowSec([c('skip', { in: 300, out: 320 }), c('mute', { in: 1, out: 2 })])).toBe(5);
  });
});

describe('filterSummary with scenes', () => {
  it('counts a blackout scene once, however many pieces it has', () => {
    const cues = [
      { effect: 'blackout', scene: 's1', firstPiece: true }, { effect: 'blackout', scene: 's1', firstPiece: false },
      { effect: 'blackout', scene: 's2', firstPiece: true },
    ];
    expect(filterSummary(cues)).toBe('2 scenes hidden');
  });
});
