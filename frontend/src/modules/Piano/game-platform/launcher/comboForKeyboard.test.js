import { describe, it, expect } from 'vitest';
import { comboNotesForKeyboard, DEFAULT_COMBO_NOTES } from './comboForKeyboard.js';

describe('comboNotesForKeyboard', () => {
  it('gives the office 76-key board its real extremes (E1..G7)', () => {
    // The exact notes played at the office 2026-08-18 09:05, ~30 times, that
    // could never match the hardcoded 88-key combo.
    expect(comboNotesForKeyboard({ startNote: 28, endNote: 103 })).toEqual([28, 103]);
  });

  it('leaves the yellow-room 88-key board on A0..C8', () => {
    expect(comboNotesForKeyboard({ startNote: 21, endNote: 108 })).toEqual([21, 108]);
  });

  it('falls back to the 88-key extremes when nothing is configured', () => {
    for (const input of [undefined, null, {}, { startNote: 28 }, { endNote: 103 }]) {
      expect(comboNotesForKeyboard(input)).toEqual(DEFAULT_COMBO_NOTES);
    }
  });

  it('rejects a collapsed range rather than emitting one key twice', () => {
    // isComboHeld looks each note up in a Map, so [60,60] would be satisfied by
    // a single finger — an accidental launcher on any middle-C press.
    expect(comboNotesForKeyboard({ startNote: 60, endNote: 60 })).toEqual(DEFAULT_COMBO_NOTES);
    expect(comboNotesForKeyboard({ startNote: 103, endNote: 28 })).toEqual(DEFAULT_COMBO_NOTES);
  });

  it('rejects values outside the MIDI range or of the wrong type', () => {
    for (const bad of [{ startNote: -1, endNote: 103 }, { startNote: 28, endNote: 128 },
                       { startNote: 28.5, endNote: 103 }, { startNote: '28', endNote: '103' }]) {
      expect(comboNotesForKeyboard(bad)).toEqual(DEFAULT_COMBO_NOTES);
    }
  });

  it('returns a frozen pair so a consumer cannot mutate the shared default', () => {
    const combo = comboNotesForKeyboard({ startNote: 28, endNote: 103 });
    expect(Object.isFrozen(combo)).toBe(true);
    expect(Object.isFrozen(DEFAULT_COMBO_NOTES)).toBe(true);
  });
});
