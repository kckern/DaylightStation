import { describe, it, expect } from 'vitest';
import { LESSONS, computeCharStatuses, computeStats, applyKey } from './typingEngine.js';

describe('LESSONS', () => {
  it('ships an ordered, non-empty barebones lesson set with ids and text', () => {
    expect(LESSONS.length).toBeGreaterThan(0);
    for (const l of LESSONS) {
      expect(l.id).toBeTruthy();
      expect(l.text.length).toBeGreaterThan(0);
    }
    expect(LESSONS[0].id).toBe('home-row'); // home row first
  });
});

describe('computeCharStatuses', () => {
  it('marks correct, incorrect, and pending per character with a caret at the typed length', () => {
    const { statuses, caret } = computeCharStatuses('asdf', 'asx');
    expect(statuses).toEqual(['correct', 'correct', 'incorrect', 'pending']);
    expect(caret).toBe(3);
  });

  it('caps the caret at the target length when overtyped input is somehow present', () => {
    const { caret } = computeCharStatuses('ab', 'abcd');
    expect(caret).toBe(2);
  });

  it('an empty attempt is all pending, caret 0', () => {
    const { statuses, caret } = computeCharStatuses('ab', '');
    expect(statuses).toEqual(['pending', 'pending']);
    expect(caret).toBe(0);
  });
});

describe('computeStats', () => {
  it('WPM counts only correct chars over 5-char words per minute', () => {
    // 10 correct chars in 60s -> (10/5)/1 = 2 wpm
    const s = computeStats('aaaaaaaaaa', 'aaaaaaaaaa', 60000);
    expect(s.wpm).toBe(2);
    expect(s.accuracy).toBe(100);
    expect(s.done).toBe(true);
  });

  it('errors lower accuracy and are excluded from WPM', () => {
    const s = computeStats('aaaa', 'aaxx', 60000); // 2 correct of 4 typed
    expect(s.accuracy).toBe(50);
    expect(s.correct).toBe(2);
  });

  it('zero elapsed or empty typed never yields Infinity/NaN', () => {
    expect(computeStats('abc', 'abc', 0).wpm).toBe(0);
    expect(computeStats('abc', '', 1000).wpm).toBe(0);
    expect(computeStats('abc', '', 1000).accuracy).toBe(100);
  });

  it('done is true only when the full target has been typed', () => {
    expect(computeStats('abc', 'ab', 1000).done).toBe(false);
    expect(computeStats('abc', 'abc', 1000).done).toBe(true);
  });
});

describe('applyKey', () => {
  it('appends a printable character', () => {
    expect(applyKey('as', 'd', 'asdf')).toBe('asd');
  });

  it('Backspace deletes the last character', () => {
    expect(applyKey('asd', 'Backspace', 'asdf')).toBe('as');
    expect(applyKey('', 'Backspace', 'asdf')).toBe('');
  });

  it('never grows past the target length', () => {
    expect(applyKey('asdf', 'x', 'asdf')).toBe('asdf');
  });

  it('ignores non-printable keys (arrows, modifiers, Enter, Tab)', () => {
    for (const k of ['ArrowLeft', 'Shift', 'Enter', 'Tab', 'Control']) {
      expect(applyKey('as', k, 'asdf')).toBe('as');
    }
  });
});
