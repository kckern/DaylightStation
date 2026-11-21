import { describe, it, expect } from 'vitest';
import { gameKeySet, keyName, normalizeKey, testVerdict } from './keyTestModel.js';

const KEYMAP = { up: 'ArrowUp', start: 'Enter', select: 'Space', a: 'x' };

describe('keyTestModel', () => {
  it('normalizes keys the way input.yml names them', () => {
    expect([' ', 'X', 'ArrowUp', 'AudioVolumeUp'].map(normalizeKey)).toEqual(['Space', 'x', 'ArrowUp', 'AudioVolumeUp']);
    expect([...gameKeySet(KEYMAP)].sort()).toEqual(['ArrowUp', 'Enter', 'Space', 'x']);
  });
  it('names keys in short plain words', () => {
    expect(['x', 'AudioVolumeUp', 'MediaPlayPause', 'ButtonA', 'StickLeft', 'F13'].map(keyName))
      .toEqual(['X', 'Volume up', 'Play/pause', 'A button', 'Stick left', 'F13']);
  });
  it('verdict', () => {
    const keys = gameKeySet(KEYMAP);
    expect(testVerdict({ padInputs: 1, keys: [], gameKeys: keys }).id).toBe('controller');
    expect(testVerdict({ keys: ['AudioVolumeUp', 'x'], gameKeys: keys }).text).toBe('Games can use these keys: X.');
    expect(testVerdict({ keys: ['AudioVolumeUp'], gameKeys: keys }).text).toBe("Games can't use these keys yet.");
    expect(testVerdict({ keys: [], gameKeys: keys }).id).toBe('nothing');
  });
});
