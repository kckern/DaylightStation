import { describe, it, expect } from 'vitest';
import { hasGovernedLabel, isGovernedContainer, toTagSet, normalizeTag } from './governedContent.js';

const GOVERNED = new Set(['kidsfun']);
const TYPES = new Set(['show', 'movie']);

describe('governedContent — trigger SSoT', () => {
  describe('hasGovernedLabel (the trigger)', () => {
    it('true when content carries a governed label (case/space-insensitive)', () => {
      expect(hasGovernedLabel(['KidsFun'], GOVERNED)).toBe(true);
      expect(hasGovernedLabel([' kidsfun '], GOVERNED)).toBe(true);
      expect(hasGovernedLabel([{ tag: 'KidsFun' }], GOVERNED)).toBe(true);
    });

    it('false when content carries no governed label', () => {
      expect(hasGovernedLabel(['Cardio'], GOVERNED)).toBe(false);
      expect(hasGovernedLabel([], GOVERNED)).toBe(false);
      expect(hasGovernedLabel(null, GOVERNED)).toBe(false);
    });

    it('false when no governed labels are configured (governance off)', () => {
      expect(hasGovernedLabel(['KidsFun'], new Set())).toBe(false);
      expect(hasGovernedLabel(['KidsFun'], [])).toBe(false);
    });

    it('type is NEVER the trigger — only labels count', () => {
      // A "show"/"movie"/"workout" type with no governed label is NOT governed.
      expect(hasGovernedLabel([], GOVERNED)).toBe(false);
    });
  });

  describe('isGovernedContainer (show/movie icon: trigger + type scope)', () => {
    it('governed: has the label AND type is in scope', () => {
      expect(isGovernedContainer({ type: 'show', labels: ['KidsFun'] }, GOVERNED, TYPES)).toBe(true);
      expect(isGovernedContainer({ type: 'movie', labels: ['KidsFun'] }, GOVERNED, TYPES)).toBe(true);
    });

    it('NOT governed: type in scope but no governed label (the 673634 bug)', () => {
      // "Yuvi—Story Aerobics": type=show, labels=[] → must NOT lock.
      expect(isGovernedContainer({ type: 'show', labels: [] }, GOVERNED, TYPES)).toBe(false);
    });

    it('NOT governed: has the label but type is outside the scope', () => {
      expect(isGovernedContainer({ type: 'track', labels: ['KidsFun'] }, GOVERNED, TYPES)).toBe(false);
    });

    it('empty type scope = any type eligible (label still required)', () => {
      expect(isGovernedContainer({ type: 'anything', labels: ['KidsFun'] }, GOVERNED, new Set())).toBe(true);
      expect(isGovernedContainer({ type: 'anything', labels: [] }, GOVERNED, new Set())).toBe(false);
    });
  });

  describe('helpers', () => {
    it('normalizeTag lower-cases and trims; non-strings → ""', () => {
      expect(normalizeTag('  Foo ')).toBe('foo');
      expect(normalizeTag(null)).toBe('');
    });
    it('toTagSet passes a Set through and normalizes arrays of strings/tags', () => {
      const s = new Set(['a']);
      expect(toTagSet(s)).toBe(s);
      expect([...toTagSet([' A ', { tag: 'B' }, 3, null])]).toEqual(['a', 'b']);
    });
  });
});
