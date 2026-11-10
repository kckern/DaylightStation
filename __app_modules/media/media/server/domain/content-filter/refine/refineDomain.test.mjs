import { describe, expect, it } from 'vitest';
import { initialKind, wordMatcher, isWordLabel } from './cueKinds.mjs';
import { cellRect, subCells, boundingRect, assessTrack, simplifyTrack, overlap } from './regionTrack.mjs';
import { fitSync } from './syncFit.mjs';

describe('cueKinds', () => {
  it('classifies by type, category and label shape', () => {
    expect(initialKind({ type: 'mute', category: 'language/blasphemy/god', label: 'G*d' })).toEqual({ kind: 'speech', needsRouting: false });
    expect(initialKind({ type: 'skip', category: 'credits/opening_credits', label: 'Opening Credits' }).kind).toBe('credits');
    expect(initialKind({ type: 'skip', category: 'kissing/kissing_normal', label: 'A girl kisses a boy.' }).kind).toBe('visual');
    expect(initialKind({ type: 'skip', category: 'language/language_sexual/x', label: 'Titles are shown on a sign.' })).toEqual({ kind: 'speech-line', needsRouting: true });
    expect(initialKind({ type: 'mute', category: 'violence/implied', label: 'Gunfire can be heard.' }).kind).toBe('sound');
  });

  it('tells word labels from prose', () => {
    expect(isWordLabel('G*d')).toBe(true);
    expect(isWordLabel('Irish bug')).toBe(true);
    expect(isWordLabel('A man refers to spilling a drink.')).toBe(false);
  });

  it('matches spoken forms of a censored word, including compounds', () => {
    const god = wordMatcher({ category: 'language/blasphemy/god', label: 'G*d' });
    expect(['God,', 'goddammit!', "god's"].every(god)).toBe(true);
    expect(god('good')).toBe(false);
    const damn = wordMatcher({ category: 'language/profanity/damn', label: 'd*mn' });
    expect(damn('Goddammit')).toBe(true);
    const odd = wordMatcher({ category: 'language/other_childish', label: 'b*tthead' });
    expect(odd('Butthead!')).toBe(true);
    expect(wordMatcher({ category: 'x', label: 'A teenage boy says something.' })).toBeNull();
  });
});

describe('regionTrack', () => {
  it('maps cells to rects and nests grids', () => {
    expect(cellRect(3, 4)).toEqual({ x: 1 / 3, y: 1 / 3, w: 1 / 3, h: 1 / 3 });
    expect(subCells(3, 4, 6)).toEqual([14, 15, 20, 21]);
    expect(() => subCells(3, 0, 5)).toThrow(/nest/);
    expect(boundingRect(6, [0, 1, 6, 7])).toEqual({ x: 0, y: 0, w: 0.333, h: 0.333 });
  });

  it('accepts a steady track and rejects jumpy, abstaining or frame-filling ones', () => {
    const steady = [{ in: 0, grid: 6, cells: [0, 1] }, { in: 0.5, grid: 6, cells: [1, 2] }, { in: 1, grid: 6, cells: [1, 2] }];
    expect(overlap([0, 1], [1, 2])).toBeCloseTo(1 / 3);
    expect(assessTrack(steady, { minOverlap: 0.3 })).toEqual({ trackable: true });
    expect(assessTrack([{ grid: 6, cells: [0] }, { grid: 6, cells: [35] }]).reason).toBe('jumpy');
    expect(assessTrack([{ grid: 3, cells: [0, 1, 2, 3, 4] }]).reason).toBe('covers-most');
    expect(assessTrack([{ grid: 3, cells: null }, { grid: 3, cells: [0] }]).reason).toBe('abstain');
    expect(simplifyTrack(steady)).toHaveLength(2);
  });
});

describe('fitSync', () => {
  it('recovers a drifting clock and ignores outliers', () => {
    const pairs = Array.from({ length: 40 }, (_, i) => ({ x: i * 170, y: i * 170 * 0.99936 + 7.66 + ((i * 7) % 5 - 2) * 0.3 }));
    pairs.push({ x: 1000, y: 1050 }, { x: 3000, y: 2900 });
    const fit = fitSync(pairs);
    expect(fit.scale).toBeCloseTo(0.99936, 4);
    expect(fit.offset).toBeCloseTo(7.66, 0);
    expect(fit.used).toBe(40);
  });

  it('refuses too few pairs', () => {
    expect(fitSync([{ x: 1, y: 2 }])).toBeNull();
  });
});

describe('wordPairs', () => {
  it('finds the coarse offset by voting and keeps unambiguous matches', async () => {
    const { wordPairs } = await import('./syncFit.mjs');
    const is = (x) => (w) => w.toLowerCase() === x;
    const words = [{ w: 'god', s: 107.5 }, { w: 'damn', s: 210.2 }, { w: 'god', s: 309.9 }, { w: 'god', s: 312 }, { w: 'hell', s: 50 }];
    const tags = [{ t: 100, match: is('god') }, { t: 202, match: is('damn') }, { t: 302, match: is('god') }];
    const { coarse, pairs } = wordPairs(tags, words);
    expect(coarse).toBeGreaterThanOrEqual(7);
    expect(coarse).toBeLessThanOrEqual(9);
    expect(pairs).toEqual([{ x: 100, y: 107.5, wi: 0 }, { x: 202, y: 210.2, wi: 1 }]);
  });
});
