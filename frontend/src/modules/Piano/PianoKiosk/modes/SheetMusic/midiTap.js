import { KIND } from '../../../../../lib/logging/inputRecorder.js';

const SUSTAIN_CC = 64;

/**
 * midiToRecord — pure classifier from a raw MIDI byte array to a recorder tuple
 * ({ kind, a, b }) or null for messages the input recorder ignores (clock,
 * active-sensing, system realtime, malformed). Kept side-effect free so it can be
 * unit-tested; ScorePlayer wires it to the raw MIDI stream and pushes the result
 * into the zero-alloc ring buffer.
 */
export function midiToRecord(bytes) {
  if (!bytes || bytes.length < 2) return null;
  const status = bytes[0] & 0xf0;
  if (status === 0x90) {
    const vel = bytes[2] | 0;
    return vel > 0 ? { kind: KIND.MIDI_ON, a: bytes[1], b: vel } : { kind: KIND.MIDI_OFF, a: bytes[1], b: 0 };
  }
  if (status === 0x80) return { kind: KIND.MIDI_OFF, a: bytes[1], b: 0 };
  if (status === 0xB0) {
    if (bytes[1] === SUSTAIN_CC) return { kind: KIND.SUSTAIN, a: bytes[2] >= 64 ? 1 : 0, b: 0 };
    return { kind: KIND.CC, a: bytes[1], b: bytes[2] | 0 };
  }
  return null;
}
