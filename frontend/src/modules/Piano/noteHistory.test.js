import { describe, it, expect } from 'vitest';
import {
  handleNoteOn,
  handleNoteOff,
  findLastActive,
  trimHistory,
  parseMidiMessage,
  isSustainDown,
} from './noteHistory.js';

describe('handleNoteOn / handleNoteOff', () => {
  it('appends an active note on note-on', () => {
    const h = handleNoteOn([], 60, 80, 1000);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ note: 60, velocity: 80, endTime: null });
  });
  it('closes the active note on note-off', () => {
    let h = handleNoteOn([], 60, 80, 1000);
    h = handleNoteOff(h, 60, 1500);
    expect(h[0].endTime).toBe(1500);
  });
  it('retrigger closes the prior active entry and adds a new one', () => {
    let h = handleNoteOn([], 60, 80, 1000);
    h = handleNoteOn(h, 60, 90, 1200); // retrigger before release
    expect(h).toHaveLength(2);
    expect(h[0].endTime).toBe(1200); // prior closed at retrigger time
    expect(h[1].endTime).toBe(null);
  });
  it('note-off with no matching active note is a no-op', () => {
    const h = handleNoteOff([], 60, 1500);
    expect(h).toEqual([]);
  });
});

describe('findLastActive', () => {
  it('returns the index of the most recent unclosed note', () => {
    const h = handleNoteOn(handleNoteOn([], 60, 80, 1000), 64, 80, 1100);
    expect(findLastActive(h, 64)).toBe(1);
    expect(findLastActive(h, 67)).toBe(-1);
  });
});

describe('trimHistory', () => {
  it('drops completed notes older than the display window', () => {
    const old = [{ note: 60, velocity: 80, startTime: 0, endTime: 1 }];
    expect(trimHistory(old, 1_000_000)).toHaveLength(0);
  });
  it('keeps active notes regardless of age', () => {
    const h = [{ note: 60, velocity: 80, startTime: 0, endTime: null }];
    expect(trimHistory(h, 1_000_000)).toHaveLength(1);
  });
});

describe('parseMidiMessage', () => {
  it('parses note-on', () => {
    expect(parseMidiMessage([0x90, 60, 100])).toEqual({
      type: 'note_on', channel: 0, note: 60, velocity: 100,
    });
  });
  it('treats note-on with velocity 0 as note-off', () => {
    expect(parseMidiMessage([0x90, 60, 0])).toMatchObject({ type: 'note_off', note: 60 });
  });
  it('parses note-off', () => {
    expect(parseMidiMessage([0x80, 60, 0])).toMatchObject({ type: 'note_off', note: 60 });
  });
  it('parses sustain control change', () => {
    expect(parseMidiMessage([0xb0, 64, 127])).toEqual({
      type: 'control', channel: 0, controller: 64, value: 127,
    });
  });
  it('parses program change', () => {
    expect(parseMidiMessage([0xc0, 5])).toEqual({ type: 'program', channel: 0, program: 5 });
  });
  it('keeps the channel nibble', () => {
    expect(parseMidiMessage([0x93, 60, 100]).channel).toBe(3);
  });
  it('returns null for unmodeled / empty messages', () => {
    expect(parseMidiMessage([0xf8])).toBeNull();
    expect(parseMidiMessage([])).toBeNull();
  });
});

describe('isSustainDown', () => {
  it('is down at 64+, up below', () => {
    expect(isSustainDown(64)).toBe(true);
    expect(isSustainDown(63)).toBe(false);
  });
});
