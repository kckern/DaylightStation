import { describe, it, expect } from 'vitest';
import {
  kindOf, effectWord, effectChip, effectSentence, sourceOf, categoryText, clock, lengthText, awayText, certificationText, rowLabel,
} from './effectKinds.js';

describe('effectKinds', () => {
  it('sorts every effect into one of four kinds', () => {
    expect(['mute', 'bleep'].map(kindOf)).toEqual(['words', 'words']);
    expect(['blur', 'full-blur', 'pixelate', 'censor-bar'].map(kindOf)).toEqual(Array(4).fill('picture'));
    expect(['blackout', 'title-card'].map(kindOf)).toEqual(['hidden', 'hidden']);
    expect(['skip', 'skip-card'].map(kindOf)).toEqual(['skipped', 'skipped']);
  });

  it('speaks in user words, not effect ids', () => {
    expect(effectWord('blackout')).toBe('hidden');
    expect(effectChip('mute')).toBe('Muted');
    expect(effectSentence('bleep')).toMatch(/bleep covers/);
    expect(rowLabel({ effect: 'blur' })).toBe('Scene blurred');
  });

  it('says what was found', () => {
    expect(sourceOf({ effect: 'mute' })).toBe('Word');
    expect(sourceOf({ effect: 'blur' })).toBe('Visual');
    expect(sourceOf({ effect: 'blur', scene: 'x' })).toBe('Scene');
  });

  it('names categories plainly', () => {
    expect(categoryText('language/profanity/damn')).toBe('Language: profanity');
    expect(categoryText('scene/violence_blood_gore')).toBe('Violence');
    expect(categoryText('language/language_sexual/other_sexual')).toBe('Language: sexual');
    expect(categoryText('')).toBeNull();
  });

  it('formats times', () => {
    expect(clock(75)).toBe('1:15');
    expect(clock(4000)).toBe('1:06:40');
    expect(clock(179.86, { precise: true })).toBe('2:59.9');
    expect(lengthText(0.34)).toBe('0.3 s');
    expect(lengthText(192)).toBe('3 min 12 s');
    expect(awayText(50)).toBe('in 50 s');
    expect(awayText(72)).toBe('in 1:12');
    expect(awayText(174)).toBe('in 2:54');
  });

  it('explains certification', () => {
    expect(certificationText('machine').tone).toBe('good');
    expect(certificationText(null).tone).toBe('caution');
  });
});
