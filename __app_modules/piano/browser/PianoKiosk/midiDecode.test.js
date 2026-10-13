import { describe, it, expect } from 'vitest';
import { decodeMidi, noteName } from './midiDecode.js';

describe('noteName', () => {
  it('maps middle C and accidentals', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C#4');
    expect(noteName(69)).toBe('A4');
    expect(noteName(21)).toBe('A0');
  });
});

describe('decodeMidi', () => {
  it('decodes note on with velocity', () => {
    const d = decodeMidi([0x90, 60, 90]);
    expect(d.kind).toBe('note-on');
    expect(d.channel).toBe(1);
    expect(d.detail).toContain('C4');
    expect(d.detail).toContain('v90');
  });
  it('treats note-on velocity 0 as note off', () => {
    expect(decodeMidi([0x90, 60, 0]).kind).toBe('note-off');
  });
  it('decodes note off', () => {
    expect(decodeMidi([0x82, 64, 0]).kind).toBe('note-off');
    expect(decodeMidi([0x82, 64, 0]).channel).toBe(3);
  });
  it('names common control changes', () => {
    const d = decodeMidi([0xb0, 64, 127]);
    expect(d.kind).toBe('cc');
    expect(d.detail).toContain('Sustain');
    expect(d.detail).toContain('127');
  });
  it('decodes program change', () => {
    const d = decodeMidi([0xc0, 5]);
    expect(d.kind).toBe('program');
    expect(d.detail).toBe('#5');
  });
  it('decodes pitch bend as a signed value', () => {
    expect(decodeMidi([0xe0, 0, 64]).detail).toBe('0'); // center
  });
});
