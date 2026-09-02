import { describe, expect, it } from 'vitest';
import { VOICE_GROUPS, ALL_VOICES } from './devices/suzukiMdg400.js';
import { FAMILIES, familyOf, partitionVoices } from './voiceFamilies.js';

describe('voiceFamilies', () => {
  it('has nine families with ids, labels and icons', () => {
    expect(FAMILIES.map((f) => f.id)).toEqual(['pianos', 'keys', 'guitars', 'strings', 'voices', 'winds', 'synths', 'world', 'fun']);
    for (const family of FAMILIES) { expect(family.label).toBeTruthy(); expect(family.icon).toBeTruthy(); }
    expect(FAMILIES.find((f) => f.id === 'pianos').icon).toBe('piano');
    expect(FAMILIES.find((f) => f.id === 'voices').icon).toBe('singalong'); // the mic — studio.svg is a grand piano
  });

  it('places every device voice in exactly one family', () => {
    const families = partitionVoices(VOICE_GROUPS);
    const placed = Object.values(families).flat();
    expect(placed).toHaveLength(ALL_VOICES.length);
    const keys = new Set(placed.map((v) => `${v.pc}:${v.bank || 0}`));
    expect(keys.size).toBe(ALL_VOICES.length);
  });

  it('sizes the families per the spec table', () => {
    const families = partitionVoices(VOICE_GROUPS);
    expect(Object.fromEntries(Object.entries(families).map(([id, voices]) => [id, voices.length]))).toEqual({
      pianos: 8, keys: 16, guitars: 16, strings: 12, voices: 3, winds: 24, synths: 24, world: 18, fun: 17,
    });
  });

  it('follows the ear, not the GM spec, at the edges', () => {
    expect(familyOf({ pc: 47 })).toBe('strings');           // Timpani stays with the orchestra
    expect(familyOf({ pc: 55 })).toBe('fun');               // Orchestra Hit is a toy
    expect(familyOf({ pc: 52 })).toBe('voices');            // Choir Aahs
    expect(familyOf({ pc: 15, bank: 1 })).toBe('world');    // Yangqin (bank 1 folk voice)
    expect(familyOf({ pc: 15 })).toBe('keys');              // Dulcimer (bank 0)
    expect(familyOf({ pc: 0 })).toBe('pianos');
    expect(familyOf(null)).toBeNull();
    expect(familyOf({})).toBeNull();
  });

  it('keeps every family under the 24-tile grid ceiling', () => {
    const families = partitionVoices(VOICE_GROUPS);
    for (const voices of Object.values(families)) expect(voices.length).toBeLessThanOrEqual(24);
  });
});
