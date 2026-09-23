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
  // Ruling 2026-09-23 (owner): anchor-side cues show text + picture + audio
  // together; the prompt is never the test. One bundle, no random kind.
  it('the cue is one anchor bundle: the gloss, plus whether a picture and gloss audio exist', () => {
    expect(cueFor(gawi, { image: false, glossAudio: false }, 's')).toEqual({ type: 'anchor', text: 'Scissors', image: false, audio: false });
    expect(cueFor(gawi, { image: true, glossAudio: true }, 's')).toEqual({ type: 'anchor', text: 'Scissors', image: true, audio: true });
    expect(cueFor(gawi, { image: true }, 's')).toEqual({ type: 'anchor', text: 'Scissors', image: true, audio: false });
    expect(cueFor(gawi, { glossAudio: true }, 's')).toEqual({ type: 'anchor', text: 'Scissors', image: false, audio: true });
  });
  it('the bundle is deterministic: the seed changes nothing', () => {
    const cues = ['a', 'b', 'c', 'd'].map((seed) => cueFor(gawi, { image: true, glossAudio: true }, seed));
    expect(new Set(cues.map((c) => JSON.stringify(c))).size).toBe(1);
    expect(cueFor(gawi)).toEqual({ type: 'anchor', text: 'Scissors', image: false, audio: false });
  });
  it('channel falls back to read without term audio', () => {
    expect(channelFor({ audio: true })).toBe('hear');
    expect(channelFor({ audio: false })).toBe('read');
  });
});
