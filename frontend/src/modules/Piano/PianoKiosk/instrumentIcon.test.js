import { describe, it, expect } from 'vitest';
import { instrumentEmoji } from './instrumentIcon.js';

describe('instrumentEmoji', () => {
  it('maps common families to a glyph', () => {
    expect(instrumentEmoji('Acoustic Grand')).toBe('🎹');
    expect(instrumentEmoji('Electric Piano 1')).toBe('🎹');
    expect(instrumentEmoji('Church Organ')).toBe('🪗');
    expect(instrumentEmoji('Nylon Guitar')).toBe('🎸');
    expect(instrumentEmoji('Fingered Bass')).toBe('🎸');
    expect(instrumentEmoji('String Ensemble')).toBe('🎻');
    expect(instrumentEmoji('Tenor Sax')).toBe('🎷');
    expect(instrumentEmoji('Trumpet')).toBe('🎺');
    expect(instrumentEmoji('Pan Flute')).toBe('🪈');
    expect(instrumentEmoji('Synth Voice')).toBe('🎤');
    expect(instrumentEmoji('Standard Kit')).toBe('🥁');
    expect(instrumentEmoji('Vibraphone')).toBe('🔔');
    expect(instrumentEmoji('Saw Lead')).toBe('🎛️');
  });

  it('falls back to a music note for unknown / empty names', () => {
    expect(instrumentEmoji('Whatchamacallit')).toBe('🎵');
    expect(instrumentEmoji('')).toBe('🎵');
    expect(instrumentEmoji(null)).toBe('🎵');
    expect(instrumentEmoji(undefined)).toBe('🎵');
  });

  it('prefers the more specific rule (bass over guitar family)', () => {
    expect(instrumentEmoji('Slap Bass')).toBe('🎸'); // both bass+guitar map to 🎸 anyway
    expect(instrumentEmoji('Acoustic Bass')).toBe('🎸');
  });
});
