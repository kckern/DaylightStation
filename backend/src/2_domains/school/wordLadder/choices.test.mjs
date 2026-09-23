import { describe, expect, it } from 'vitest';
import { channelFor, cueFor, pickMeaningChoices, pickTermChoices } from './choices.mjs';

const entry = (id, term, gloss, kind = 'word') => ({
  id, term, gloss, kind, decoys: { term: [`${term}1`, `${term}2`, `${term}3`], gloss: [`${gloss}A`, `${gloss}B`, `${gloss}C`] },
});
const gawi = entry('gawi', '가위', 'Scissors');

describe('choices', () => {
  it('pick-meaning is the gloss plus authored gloss decoys, deterministic', () => {
    const a = pickMeaningChoices(gawi, 'seed');
    expect(a.answer).toBe('Scissors');
    expect([...a.choices].sort()).toEqual(['Scissors', 'ScissorsA', 'ScissorsB', 'ScissorsC'].sort());
    expect(pickMeaningChoices(gawi, 'seed')).toEqual(a);
  });
  it('pick-term prefers introduced same-kind deck words, backfills authored', () => {
    const known = [entry('pul', '풀', 'Glue'), entry('chaek', '책', 'Book')];
    const r = pickTermChoices(gawi, known, 's');
    expect(r.answer).toBe('가위');
    expect(r.choices).toHaveLength(4);
    expect(r.choices).toEqual(expect.arrayContaining(['가위', '풀', '책']));
  });
  it('cues rotate over what exists; never image without one', () => {
    expect(cueFor(gawi, { image: false, glossAudio: false }, 's')).toEqual({ type: 'text', text: 'Scissors' });
    const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((seed) => cueFor(gawi, { image: true, glossAudio: true }, seed).type));
    expect(seen.size).toBeGreaterThan(1);
  });
  it('channel falls back to read without term audio', () => {
    expect(channelFor({ audio: true })).toBe('hear');
    expect(channelFor({ audio: false })).toBe('read');
  });
});
