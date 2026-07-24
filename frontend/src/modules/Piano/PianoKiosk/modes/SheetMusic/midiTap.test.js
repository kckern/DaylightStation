import { describe, it, expect } from 'vitest';
import { midiToRecord } from './midiTap.js';
import { KIND } from '../../../../../lib/logging/inputRecorder.js';

describe('midiToRecord', () => {
  it('maps note-on with velocity', () => { expect(midiToRecord([0x90, 72, 88])).toEqual({ kind: KIND.MIDI_ON, a: 72, b: 88 }); });
  it('treats note-on velocity 0 as note-off', () => { expect(midiToRecord([0x90, 72, 0])).toEqual({ kind: KIND.MIDI_OFF, a: 72, b: 0 }); });
  it('maps note-off', () => { expect(midiToRecord([0x80, 72, 40])).toEqual({ kind: KIND.MIDI_OFF, a: 72, b: 0 }); });
  it('maps sustain CC (64) to on/off by threshold', () => {
    expect(midiToRecord([0xB0, 64, 127])).toEqual({ kind: KIND.SUSTAIN, a: 1, b: 0 });
    expect(midiToRecord([0xB0, 64, 0])).toEqual({ kind: KIND.SUSTAIN, a: 0, b: 0 });
  });
  it('maps other CC generically', () => { expect(midiToRecord([0xB0, 7, 100])).toEqual({ kind: KIND.CC, a: 7, b: 100 }); });
  it('ignores clock/active-sensing/unknown', () => { expect(midiToRecord([0xF8])).toBeNull(); expect(midiToRecord([])).toBeNull(); });
});
