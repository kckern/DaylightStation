import { describe, expect, it } from 'vitest';
import { menuAction } from './menuKeys.js';

describe('menuAction', () => {
  it('maps the arrows to directions', () => {
    expect(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].map((key) => menuAction({ key }))).toEqual(['left', 'right', 'up', 'down']);
  });
  it('accepts with Enter, Space and any letter the foot pad sends', () => {
    expect(['Enter', ' ', 'm', 'n', 'l'].map((key) => menuAction({ key }))).toEqual(['accept', 'accept', 'accept', 'accept', 'accept']);
  });
  it('goes back with Escape and Backspace', () => {
    expect(menuAction({ key: 'Escape' })).toBe('back');
    expect(menuAction({ key: 'Backspace' })).toBe('back');
  });
  it('never acts on the digits the garage box binds to the OS, in either key row', () => {
    for (const digit of ['1', '2', '3', '4', '5', '6']) {
      expect(menuAction({ key: digit, code: `Digit${digit}` })).toBeNull();
      expect(menuAction({ key: digit, code: `Numpad${digit}` })).toBeNull();
    }
  });
  it('ignores modifiers, shortcuts, function keys, Tab and auto-repeat', () => {
    expect(menuAction({ key: 'Shift' })).toBeNull();
    expect(menuAction({ key: 'r', ctrlKey: true })).toBeNull();
    expect(menuAction({ key: 'F5' })).toBeNull();
    expect(menuAction({ key: 'Tab' })).toBeNull();
    expect(menuAction({ key: 'Enter', repeat: true })).toBeNull();
  });
});
