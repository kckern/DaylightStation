import { describe, it, expect } from 'vitest';
import { drumForNote, DEFAULT_SPLIT } from './producerKeys.js';

const KIT = [{ id: 'kick' }, { id: 'snare' }, { id: 'hat' }, { id: 'clap' }];

describe('drumForNote', () => {
  it('returns null for melodic keys at/above the split', () => {
    expect(drumForNote(DEFAULT_SPLIT, DEFAULT_SPLIT, KIT)).toBeNull();
    expect(drumForNote(60, DEFAULT_SPLIT, KIT)).toBeNull();
  });
  it('maps low white keys to one-shots, cycling through the kit', () => {
    // C2 (36) and C3-ish lower whites map into the kit in order.
    const c2 = drumForNote(36, DEFAULT_SPLIT, KIT);
    const d2 = drumForNote(38, DEFAULT_SPLIT, KIT);
    expect(KIT.map((k) => k.id)).toContain(c2);
    expect(KIT.map((k) => k.id)).toContain(d2);
    expect(c2).not.toBe(d2); // adjacent white keys differ
  });
  it('ignores black keys in the drum zone', () => {
    expect(drumForNote(37, DEFAULT_SPLIT, KIT)).toBeNull(); // C#2
  });
  it('returns null when there are no one-shots', () => {
    expect(drumForNote(36, DEFAULT_SPLIT, [])).toBeNull();
  });
});
