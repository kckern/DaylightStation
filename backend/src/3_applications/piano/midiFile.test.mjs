// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { encodeMidiFile } from './midiFile.mjs';

const events = [
  { t: 0,   type: 'note_on',  note: 60, velocity: 100 },
  { t: 500, type: 'note_off', note: 60, velocity: 0 },
];

describe('encodeMidiFile', () => {
  it('produces a valid format-0 SMF (MThd + MTrk)', () => {
    const buf = encodeMidiFile(events, { ppq: 480, bpm: 120 });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 4).toString('ascii')).toBe('MThd');
    expect(buf.readUInt32BE(4)).toBe(6);           // header length
    expect(buf.readUInt16BE(8)).toBe(0);           // format 0
    expect(buf.readUInt16BE(10)).toBe(1);          // 1 track
    expect(buf.readUInt16BE(12)).toBe(480);        // division (ppq)
    const mtrkAt = buf.indexOf(Buffer.from('MTrk', 'ascii'));
    expect(mtrkAt).toBeGreaterThan(0);
  });
  it('emits note-on (0x90) and note-off (0x80) for the channel', () => {
    const buf = encodeMidiFile(events, { ppq: 480, bpm: 120 });
    expect(buf.includes(Buffer.from([0x90, 60, 100]))).toBe(true);  // note on C4
    expect(buf.includes(Buffer.from([0x80, 60, 0]))).toBe(true);    // note off C4
  });
  it('ends with the End-of-Track meta (FF 2F 00)', () => {
    const buf = encodeMidiFile(events, {});
    expect(buf.slice(-3).equals(Buffer.from([0xff, 0x2f, 0x00]))).toBe(true);
  });
  it('an empty event list still yields a valid (silent) track', () => {
    const buf = encodeMidiFile([], {});
    expect(buf.slice(0, 4).toString('ascii')).toBe('MThd');
    expect(buf.slice(-3).equals(Buffer.from([0xff, 0x2f, 0x00]))).toBe(true);
  });
});
