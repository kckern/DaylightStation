import { describe, it, expect, vi, afterEach } from 'vitest';
import { playSound } from './playSound.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('playSound', () => {
  it('is silent (no-op) when the url is null/empty/undefined', () => {
    expect(playSound(null)).toBe(false);
    expect(playSound('')).toBe(false);
    expect(playSound(undefined)).toBe(false);
  });

  it('attempts playback for a configured url and never throws', () => {
    expect(() => playSound('beep.mp3')).not.toThrow();
    expect(playSound('beep.mp3')).toBe(true);
  });

  it('returns false when no Audio constructor is available', () => {
    vi.stubGlobal('Audio', undefined);
    expect(playSound('x.mp3')).toBe(false);
  });
});
