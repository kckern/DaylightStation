import { describe, it, expect } from 'vitest';
import { mp3RelForMidiRel } from '#domains/pianoaudio/pianoAudioPaths.mjs';

describe('mp3RelForMidiRel', () => {
  it('swaps .mid for .mp3 preserving jamcorder subdirs', () => {
    expect(mp3RelForMidiRel('jamcorder/2025/2025-12/2025-12-22 18.35.16.mid'))
      .toBe('jamcorder/2025/2025-12/2025-12-22 18.35.16.mp3');
  });

  it('swaps .mid for .mp3 preserving per-user subdirs', () => {
    expect(mp3RelForMidiRel('kckern/2026-01-02/take1.mid'))
      .toBe('kckern/2026-01-02/take1.mp3');
  });

  it('normalizes an uppercase .MID extension to lowercase .mp3', () => {
    expect(mp3RelForMidiRel('a.MID')).toBe('a.mp3');
  });

  it('throws on a non-.mid path', () => {
    expect(() => mp3RelForMidiRel('notes.txt')).toThrow();
  });

  it('throws on a non-string input', () => {
    expect(() => mp3RelForMidiRel(null)).toThrow();
  });
});
