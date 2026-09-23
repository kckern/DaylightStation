import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentInput, keyLabel, noteInput, noteKeyEvent, resetInput } from './inputVia.js';

describe('inputVia — how the child did the last thing', () => {
  afterEach(() => { resetInput(); vi.useRealTimers(); });

  it('names a key by its physical code, the way the on-screen hints do', () => {
    expect(keyLabel({ code: 'Space', key: ' ' })).toBe('Space');
    expect(keyLabel({ code: 'Enter', key: 'Enter' })).toBe('Enter');
    expect(keyLabel({ code: 'NumpadEnter', key: 'Enter' })).toBe('Enter');
    expect(keyLabel({ code: 'Tab', key: 'Tab' })).toBe('Tab');
    expect(keyLabel({ code: 'Backslash', key: '\\' })).toBe('Backslash');
    expect(keyLabel({ code: 'ArrowLeft', key: 'ArrowLeft' })).toBe('ArrowLeft');
    expect(keyLabel({ code: 'KeyH', key: 'ㅗ' })).toBe('H');
    expect(keyLabel({ code: 'Digit2', key: '2' })).toBe('2');
    expect(keyLabel({ key: ' ' })).toBe('Space');
  });

  it('remembers the last input for a short window, then forgets it', () => {
    vi.useFakeTimers();
    expect(currentInput()).toBeNull();
    noteInput('touch');
    expect(currentInput()).toBe('touch');
    noteKeyEvent({ code: 'Space', key: ' ' });
    expect(currentInput()).toBe('key:Space');
    vi.advanceTimersByTime(5000);
    expect(currentInput()).toBeNull();
  });
});
