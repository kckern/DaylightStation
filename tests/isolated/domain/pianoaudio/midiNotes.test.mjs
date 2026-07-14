import { describe, it, expect } from 'vitest';
import { parseMidiNotes } from '#domains/pianoaudio/midiNotes.mjs';

// format-0 SMF, 480 PPQ, tempo 500000 (120 BPM → 0.5s/quarter, 480 ticks/quarter):
//   note C4(60) vel64  on@0    off@480  → start 0.0s, dur 0.5s
//   note E4(64) vel100 on@480  off@1440 → start 0.5s, dur 1.0s
function twoNoteMidi() {
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const track = [
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // tempo 500000
    0x00, 0x90, 60, 64,                        // note-on 60 vel64 @0
    0x83, 0x60, 0x80, 60, 64,                  // delta 480 → note-off 60
    0x00, 0x90, 64, 100,                       // note-on 64 vel100 @480
    0x87, 0x40, 0x80, 64, 64,                  // delta 960 → note-off 64 @1440
    0x00, 0xff, 0x2f, 0x00,                    // end of track
  ];
  const th = [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length];
  return Buffer.from([...header, ...th, ...track]);
}

describe('parseMidiNotes', () => {
  it('extracts timed notes with pitch/start/duration/velocity', () => {
    const { notes, durationSeconds, noteCount } = parseMidiNotes(twoNoteMidi());
    expect(noteCount).toBe(2);
    expect(durationSeconds).toBeCloseTo(1.5, 3);
    expect(notes).toHaveLength(2);

    expect(notes[0].pitch).toBe(60);
    expect(notes[0].startSec).toBeCloseTo(0.0, 3);
    expect(notes[0].durSec).toBeCloseTo(0.5, 3);
    expect(notes[0].velocity).toBe(64);

    expect(notes[1].pitch).toBe(64);
    expect(notes[1].startSec).toBeCloseTo(0.5, 3);
    expect(notes[1].durSec).toBeCloseTo(1.0, 3);
    expect(notes[1].velocity).toBe(100);
  });

  it('treats a note-on with velocity 0 as a note-off', () => {
    // C4 on@0, then C4 vel0 @480 (= off)
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
    const track = [
      0x00, 0x90, 60, 64,
      0x83, 0x60, 0x90, 60, 0, // delta 480, note-on 60 vel0 → off
      0x00, 0xff, 0x2f, 0x00,
    ];
    const th = [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length];
    const { notes } = parseMidiNotes(Buffer.from([...header, ...th, ...track]));
    expect(notes).toHaveLength(1);
    expect(notes[0].durSec).toBeCloseTo(0.5, 3);
  });

  it('throws on a non-MIDI buffer', () => {
    expect(() => parseMidiNotes(Buffer.from('nope'))).toThrow();
  });
});
