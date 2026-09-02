import { describe, it, expect } from 'vitest';
import { instrumentIcon } from './instrumentIcon.js';

describe('instrumentIcon', () => {
  it('maps common families to a house icon name', () => {
    expect(instrumentIcon('Acoustic Grand')).toBe('piano');
    expect(instrumentIcon('Electric Piano 1')).toBe('piano');
    expect(instrumentIcon('Church Organ')).toBe('family-keys');
    expect(instrumentIcon('Vibraphone')).toBe('family-keys');
    expect(instrumentIcon('Nylon Guitar')).toBe('family-guitar');
    expect(instrumentIcon('Fingered Bass')).toBe('family-guitar');
    expect(instrumentIcon('String Ensemble')).toBe('family-strings');
    expect(instrumentIcon('Tenor Sax')).toBe('family-winds');
    expect(instrumentIcon('Trumpet')).toBe('family-winds');
    expect(instrumentIcon('Pan Flute')).toBe('family-winds');
    expect(instrumentIcon('Synth Voice')).toBe('studio');
    expect(instrumentIcon('Standard Kit')).toBe('family-fun');
    expect(instrumentIcon('Saw Lead')).toBe('family-synths');
    expect(instrumentIcon('Erhu')).toBe('family-world');
    expect(instrumentIcon('Sitar')).toBe('family-world');
  });

  it('falls back to the music note for unknown / empty names', () => {
    expect(instrumentIcon('Whatchamacallit')).toBe('music');
    expect(instrumentIcon('')).toBe('music');
    expect(instrumentIcon(null)).toBe('music');
  });
});
