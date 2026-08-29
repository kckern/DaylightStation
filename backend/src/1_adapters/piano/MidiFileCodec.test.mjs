// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { encodeMidiFile } from './MidiFileCodec.mjs';

const events = [
  { t: 0, type: 'note_on', note: 60, velocity: 100 },
  { t: 500, type: 'note_off', note: 60, velocity: 0 },
];

describe('encodeMidiFile', () => {
  it('preserves the format-0 SMF byte contract', () => {
    const bytes = encodeMidiFile(events, { ppq: 480, bpm: 120 });
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.slice(0, 4).toString('ascii')).toBe('MThd');
    expect(bytes.readUInt32BE(4)).toBe(6);
    expect(bytes.readUInt16BE(8)).toBe(0);
    expect(bytes.readUInt16BE(10)).toBe(1);
    expect(bytes.readUInt16BE(12)).toBe(480);
    expect(bytes.includes(Buffer.from([0x90, 60, 100]))).toBe(true);
    expect(bytes.includes(Buffer.from([0x80, 60, 0]))).toBe(true);
    expect(bytes.slice(-3).equals(Buffer.from([0xff, 0x2f, 0x00]))).toBe(true);
  });

  it('preserves a valid silent track', () => {
    const bytes = encodeMidiFile([]);
    expect(bytes.slice(0, 4).toString('ascii')).toBe('MThd');
    expect(bytes.slice(-3).equals(Buffer.from([0xff, 0x2f, 0x00]))).toBe(true);
  });
});
