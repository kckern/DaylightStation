import { describe, it, expect } from 'vitest';
import { instrumentIcon } from './instrumentIcon.js';
import { ALL_VOICES } from './devices/suzukiMdg400.js';
import { FAMILIES, familyOf } from './voiceFamilies.js';

describe('instrumentIcon', () => {
  it('maps common families to a house icon name', () => {
    expect(instrumentIcon('Acoustic Grand')).toBe('piano');
    expect(instrumentIcon('Bright Acoustic')).toBe('piano');
    expect(instrumentIcon('Electric Piano 1')).toBe('piano');
    expect(instrumentIcon('Church Organ')).toBe('family-keys');
    expect(instrumentIcon('Vibraphone')).toBe('family-keys');
    expect(instrumentIcon('Nylon Guitar')).toBe('family-guitar');
    expect(instrumentIcon('Fingered Bass')).toBe('family-guitar');
    expect(instrumentIcon('String Ensemble')).toBe('family-strings');
    expect(instrumentIcon('Tenor Sax')).toBe('family-winds');
    expect(instrumentIcon('Trumpet')).toBe('family-winds');
    expect(instrumentIcon('Pan Flute')).toBe('family-winds');
    expect(instrumentIcon('Synth Voice')).toBe('singalong');
    expect(instrumentIcon('Standard Kit')).toBe('family-fun');
    expect(instrumentIcon('Saw Lead')).toBe('family-synths');
    expect(instrumentIcon('Erhu')).toBe('family-world');
    expect(instrumentIcon('Sitar')).toBe('family-world');
  });

  it('matches "bass" as a whole word, so Contrabass and Bassoon keep their own families', () => {
    expect(instrumentIcon('Contrabass')).toBe('family-strings');
    expect(instrumentIcon('Bassoon')).toBe('family-winds');
    expect(instrumentIcon('Acoustic Bass')).toBe('family-guitar');
    expect(instrumentIcon('Synth Bass 1')).toBe('family-guitar');
  });

  it('falls back to the music note for unknown / empty names', () => {
    expect(instrumentIcon('Whatchamacallit')).toBe('music');
    expect(instrumentIcon('')).toBe('music');
    expect(instrumentIcon(null)).toBe('music');
  });

  // The name-based icon and the program-based family agree for every device
  // voice except these, where the name is the better cue for the ear.
  const INTENTIONAL = {
    'Orchestra Hit': 'family-strings', // lives in Drums & Fun by program; sounds like a string stab
    'Voice Lead': 'singalong',
    'Choir Pad': 'singalong',
    'Bass + Lead': 'family-guitar',
    'Banjo': 'family-guitar',
    'Fiddle': 'family-strings',
    'Tinkle Bell': 'family-keys',
    'Guitar Fret Noise': 'family-guitar',
  };

  it('agrees with the voice family icon for every device voice, bar the documented exceptions', () => {
    const iconOf = Object.fromEntries(FAMILIES.map((f) => [f.id, f.icon]));
    const mismatches = [];
    for (const voice of ALL_VOICES) {
      const expected = INTENTIONAL[voice.name] ?? iconOf[familyOf(voice)];
      const actual = instrumentIcon(voice.name);
      if (actual !== expected) mismatches.push(`${voice.name}: ${actual} (wanted ${expected})`);
    }
    expect(mismatches).toEqual([]);
    for (const name of Object.keys(INTENTIONAL)) expect(ALL_VOICES.some((v) => v.name === name), `${name} is in the catalog`).toBe(true);
  });
});
