import { describe, it, expect } from 'vitest';
import {
  SEMANTIC_INDEX,
  GAMEPAD_DEFAULT,
  normalizeKeyName,
  buildEjsControls,
} from './buildEjsControls.js';

// The seed keyboard map (media/emulation/input.yml `keyboard:`).
const seedKeyboard = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  start: 'Enter',
  select: 'Space',
  a: 'x',
  b: 'z',
  y: 'a',
  x: 's',
  l: 'd',
  r: 'c',
};

describe('normalizeKeyName', () => {
  it('maps arrow friendly names to EmulatorJS arrow names', () => {
    expect(normalizeKeyName('ArrowUp')).toBe('up arrow');
    expect(normalizeKeyName('ArrowDown')).toBe('down arrow');
    expect(normalizeKeyName('ArrowLeft')).toBe('left arrow');
    expect(normalizeKeyName('ArrowRight')).toBe('right arrow');
  });

  it('maps named keys to lowercase EmulatorJS names', () => {
    expect(normalizeKeyName('Enter')).toBe('enter');
    expect(normalizeKeyName('Space')).toBe('space');
    expect(normalizeKeyName('Tab')).toBe('tab');
    expect(normalizeKeyName('Shift')).toBe('shift');
  });

  it('lowercases single-letter keys', () => {
    expect(normalizeKeyName('x')).toBe('x');
    expect(normalizeKeyName('Z')).toBe('z');
    expect(normalizeKeyName('A')).toBe('a');
  });

  it('returns empty string for empty/nullish input', () => {
    expect(normalizeKeyName('')).toBe('');
    expect(normalizeKeyName(undefined)).toBe('');
    expect(normalizeKeyName(null)).toBe('');
  });
});

describe('buildEjsControls', () => {
  it('produces players 0-3 with only player 0 populated', () => {
    const controls = buildEjsControls(seedKeyboard);
    expect(Object.keys(controls).sort()).toEqual(['0', '1', '2', '3']);
    expect(controls[1]).toEqual({});
    expect(controls[2]).toEqual({});
    expect(controls[3]).toEqual({});
  });

  it('places mapped keys at their semantic control indices', () => {
    const c = buildEjsControls(seedKeyboard)[0];
    expect(c[4].value).toBe('up arrow'); // up -> index 4
    expect(c[3].value).toBe('enter'); // start -> index 3
    expect(c[2].value).toBe('space'); // select -> index 2
    expect(c[8].value).toBe('x'); // a -> index 8
    expect(c[0].value).toBe('z'); // b -> index 0
    expect(c[9].value).toBe('s'); // x semantic -> 's' -> index 9
    expect(c[1].value).toBe('a'); // y semantic -> 'a' -> index 1
  });

  it('keeps every index its value2 gamepad default', () => {
    const c = buildEjsControls(seedKeyboard)[0];
    for (const index of Object.keys(GAMEPAD_DEFAULT)) {
      expect(c[index].value2).toBe(GAMEPAD_DEFAULT[index]);
    }
    expect(c[4].value2).toBe('DPAD_UP');
    expect(c[8].value2).toBe('BUTTON_1'); // A
    expect(c[0].value2).toBe('BUTTON_2'); // B
  });

  it('includes a default entry for indices not in the keyboard map (gamepad still works)', () => {
    // l/r are mapped in the seed, but build with a sparse map to prove unmapped fill.
    const c = buildEjsControls({ a: 'x' })[0];
    // index 10 (L) and 11 (R) unmapped by keyboard -> present with empty value + default gamepad.
    expect(c[10]).toEqual({ value: '', value2: 'LEFT_TOP_SHOULDER' });
    expect(c[11]).toEqual({ value: '', value2: 'RIGHT_TOP_SHOULDER' });
    // mapped one still set
    expect(c[8].value).toBe('x');
  });

  it('only emits indices 0-11 (skips 12/13 not in the default gamepad map)', () => {
    const c = buildEjsControls(seedKeyboard)[0];
    expect(12 in c).toBe(false);
    expect(13 in c).toBe(false);
    expect(Object.keys(c).map(Number).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('ignores unknown semantic keys in the keyboard map', () => {
    const c = buildEjsControls({ a: 'x', bogus: 'q' })[0];
    expect(c[8].value).toBe('x');
    // no index should carry the bogus 'q'
    expect(Object.values(c).some((e) => e.value === 'q')).toBe(false);
  });

  it('SEMANTIC_INDEX matches the verified EmulatorJS control scheme', () => {
    expect(SEMANTIC_INDEX).toEqual({
      b: 0, y: 1, select: 2, start: 3,
      up: 4, down: 5, left: 6, right: 7,
      a: 8, x: 9, l: 10, r: 11,
    });
  });
});
