import { describe, expect, it } from 'vitest';
import { layoutForItem, mediaForItem } from './itemLayout.js';

describe('layoutForItem', () => {
  it('a flashcard is always flashcard-front at shown time, even in practice/gloss-first mode, unless the gloss faces up', () => {
    expect(layoutForItem({ type: 'flashcard', mode: 'stream' })).toBe('flashcard-front');
    expect(layoutForItem({ type: 'flashcard', mode: 'intro' })).toBe('flashcard-front');
    expect(layoutForItem({ type: 'flashcard', mode: 'practice', front: 'term' })).toBe('flashcard-front');
  });

  it('a practice flashcard with the gloss facing up shows the back — picture if the word has one, else text', () => {
    expect(layoutForItem({ type: 'flashcard', mode: 'practice', front: 'gloss', word: { media: { image: 'x' } } })).toBe('flashcard-back-picture');
    expect(layoutForItem({ type: 'flashcard', mode: 'practice', front: 'gloss', word: { media: {} } })).toBe('flashcard-back-text');
  });

  it('choice layouts follow the cue type', () => {
    expect(layoutForItem({ type: 'choice', cue: { type: 'image' } })).toBe('choice-picture-cue');
    expect(layoutForItem({ type: 'choice', cue: { type: 'audio' } })).toBe('choice-audio-cue');
    expect(layoutForItem({ type: 'choice' })).toBe('choice-text-cue');
    expect(layoutForItem({ type: 'choice', cue: { type: 'anchor', text: 'x', image: true, audio: true } })).toBe('choice-picture-cue');
    expect(layoutForItem({ type: 'choice', cue: { type: 'anchor', text: 'x', image: false, audio: true } })).toBe('choice-text-cue');
  });

  it('copy and typed both use the type layout', () => {
    expect(layoutForItem({ type: 'copy' })).toBe('type');
    expect(layoutForItem({ type: 'typed' })).toBe('type');
  });

  it('drill steps map to their own screen', () => {
    expect(layoutForItem({ type: 'drill', step: 'look' })).toBe('look');
    expect(layoutForItem({ type: 'drill', step: 'tiles' })).toBe('tiles');
    expect(layoutForItem({ type: 'drill', step: 'say-after' })).toBe('say');
    expect(layoutForItem({ type: 'drill', step: 'unknown-step' })).toBeNull();
  });

  it('menu, words, summary, match and listen map directly', () => {
    expect(layoutForItem({ type: 'menu' })).toBe('menu');
    expect(layoutForItem({ type: 'words' })).toBe('words');
    expect(layoutForItem({ type: 'summary' })).toBe('summary');
    expect(layoutForItem({ type: 'match' })).toBe('match');
    expect(layoutForItem({ type: 'listen' })).toBe('look');
  });

  it('a null item is a null layout, not a throw', () => {
    expect(layoutForItem(null)).toBeNull();
  });
});

describe('mediaForItem', () => {
  it('an explicit cue type wins', () => {
    expect(mediaForItem({ cue: { type: 'image' } })).toBe('image');
    expect(mediaForItem({ cue: { type: 'audio' } })).toBe('audio');
    expect(mediaForItem({ cue: { type: 'text' } })).toBe('text');
    expect(mediaForItem({ cue: { type: 'anchor', text: 'x', image: true, audio: true } })).toBe('image');
    expect(mediaForItem({ cue: { type: 'anchor', text: 'x', image: false, audio: true } })).toBe('text');
  });

  it('with no cue, falls back to the word/assets media presence', () => {
    expect(mediaForItem({ word: { media: { image: 'x' } } })).toBe('image');
    expect(mediaForItem({ assets: { audio: 'a' } })).toBe('audio');
    expect(mediaForItem({ assets: { glossAudio: 'g' } })).toBe('audio');
    expect(mediaForItem({ word: { media: {} } })).toBeNull();
  });

  it('a null item is null media, not a throw', () => {
    expect(mediaForItem(null)).toBeNull();
  });
});
