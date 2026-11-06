import { describe, it, expect } from 'vitest';
import { filterSummary, isProvisional } from './filterSummary.js';
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
  it('is true when any mute or bleep is not ms/frame precise', () => {
    expect(isProvisional([c('mute', { precision: 'ms' }), c('bleep', { precision: 'srt-line' })])).toBe(true);
  });
  it('ignores approximate skips and blurs', () => {
    expect(isProvisional([c('mute', { precision: 'frame' }), c('skip', { precision: 'second-approx' })])).toBe(false);
  });
});

describe('precision rule shared with the resolver', () => {
  it('treats exactly the resolver\'s precise levels as not provisional', () => {
    expect([...PRECISE].sort()).toEqual(['frame', 'ms']);
    for (const precision of PRECISE) expect(isProvisional([c('mute', { precision })])).toBe(false);
  });
});
