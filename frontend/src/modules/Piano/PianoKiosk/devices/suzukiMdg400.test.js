import { describe, it, expect } from 'vitest';
import { ALL_VOICES, VOICE_GROUPS, EFFECTS, getDeviceProfile } from './suzukiMdg400.js';

describe('Suzuki MDG-400 profile', () => {
  it('has 138 voices (128 GM + 10 folk) numbered 1–138', () => {
    expect(ALL_VOICES).toHaveLength(138);
    expect(ALL_VOICES[0]).toMatchObject({ no: 1, name: 'Acoustic Grand', pc: 0, bank: 0 });
    expect(ALL_VOICES[127]).toMatchObject({ no: 128, name: 'Gunshot', pc: 127, bank: 0 });
  });

  it('maps display No. to MIDI program one less (GM voices)', () => {
    const gm = ALL_VOICES.slice(0, 128);
    gm.forEach((v) => expect(v.pc).toBe(v.no - 1));
  });

  it('reaches Asian-folk voices via bank 1 + their program', () => {
    const yangqin = ALL_VOICES.find((v) => v.name === 'Yangqin');
    expect(yangqin).toMatchObject({ no: 129, pc: 15, bank: 1 });
    const folk = ALL_VOICES.slice(128);
    expect(folk).toHaveLength(10);
    folk.forEach((v) => expect(v.bank).toBe(1));
  });

  it('groups by the 16 GM families plus Asian Folk', () => {
    expect(VOICE_GROUPS).toHaveLength(17);
    expect(VOICE_GROUPS[0].group).toBe('Piano');
    expect(VOICE_GROUPS.at(-1).group).toBe('Asian Folk');
  });

  it('maps reverb/chorus to the recognised CCs from the manual', () => {
    expect(EFFECTS.reverb.typeCC).toBe(80);
    expect(EFFECTS.reverb.levelCC).toBe(91);
    expect(EFFECTS.chorus.typeCC).toBe(81);
  });

  it('resolves by id', () => {
    expect(getDeviceProfile('suzuki-mdg-400')?.name).toBe('Suzuki MDG-400');
    expect(getDeviceProfile('nope')).toBeNull();
    expect(getDeviceProfile(undefined)).toBeNull();
  });
});
