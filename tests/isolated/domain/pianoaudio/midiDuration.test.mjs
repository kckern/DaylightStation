import { describe, it, expect } from 'vitest';
import { estimateMidiDurationSeconds } from '#domains/pianoaudio/midiDuration.mjs';

// Build a minimal format-0 SMF: division=480 PPQ, one track with a set-tempo
// (500000 us/qn = 120 BPM) and a note that ends at absolute tick 960 (= 2 quarter
// notes = 1.0s at 120 BPM), then end-of-track.
function tinyMidi() {
  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // header length 6
    0x00, 0x00,             // format 0
    0x00, 0x01,             // 1 track
    0x01, 0xe0,             // division = 480 PPQ
  ];
  const track = [
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // delta 0, set-tempo 500000
    0x00, 0x90, 0x3c, 0x40,                   // delta 0, note-on ch0 note60 vel64
    0x87, 0x40, 0x80, 0x3c, 0x40,             // delta 960 (VLQ 87 40), note-off note60
    0x00, 0xff, 0x2f, 0x00,                   // delta 0, end-of-track
  ];
  const trackHeader = [0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, track.length]; // "MTrk" + len
  return Buffer.from([...header, ...trackHeader, ...track]);
}

describe('estimateMidiDurationSeconds', () => {
  it('estimates duration from ticks + tempo (960 ticks @ 480 PPQ, 120 BPM = 1.0s)', () => {
    expect(estimateMidiDurationSeconds(tinyMidi())).toBeCloseTo(1.0, 3);
  });

  it('halves the duration when the tempo doubles to 240 BPM (250000 us/qn)', () => {
    const buf = tinyMidi();
    // rewrite the set-tempo payload bytes (offset: 14-byte header + 8-byte MTrk + [00 FF 51 03] = +4)
    const tempoAt = 14 + 8 + 4;
    buf[tempoAt] = 0x03; buf[tempoAt + 1] = 0xd0; buf[tempoAt + 2] = 0x90; // 250000 us
    expect(estimateMidiDurationSeconds(buf)).toBeCloseTo(0.5, 3);
  });

  it('throws on a non-MIDI buffer', () => {
    expect(() => estimateMidiDurationSeconds(Buffer.from('not a midi file at all'))).toThrow();
  });

  it('throws on a too-short buffer', () => {
    expect(() => estimateMidiDurationSeconds(Buffer.from([0x4d, 0x54]))).toThrow();
  });
});
