import { describe, expect, it } from 'vitest';
import { keyboardAction } from './usePresentationInput.js';

describe('presentation input vocabulary', () => {
  it('maps keyboard layouts to device-neutral actions', () => {
    expect(keyboardAction('ArrowLeft')).toBe('move.west');
    expect(keyboardAction('KeyW')).toBe('move.north');
    expect(keyboardAction('Space')).toBe('action.primary');
    expect(keyboardAction('KeyZ')).toBeNull();
  });
});
