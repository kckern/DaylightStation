import { describe, it, expect } from 'vitest';
import { parseLyrics, levelsFromDecibels, audioQuality } from './trackExtras.mjs';

describe('levelsFromDecibels', () => {
  it('maps -40..0 dB onto 0..1 and clamps', () => {
    expect(levelsFromDecibels([-40, -20, 0, -60, 3, 'x', '-10'])).toEqual([0, 0.5, 1, 0, 1, 0, 0.75]);
    expect(levelsFromDecibels(undefined)).toEqual([]);
  });
});

describe('parseLyrics', () => {
  it('reads LyricFind LRC: drops header tags, keeps gap lines', () => {
    const lrc = '[au:Someone]\n[by:Lyrics © Publisher]\n\n[00:01.00]first line\n[00:07.69]second line\n[00:14.71]\n[00:14.71]third\n[00:20]fourth';
    expect(parseLyrics(lrc, 'lrc')).toEqual({
      synced: true,
      lines: [
        { ms: 1000, text: 'first line' },
        { ms: 7690, text: 'second line' },
        { ms: 14710, text: '' },
        { ms: 14710, text: 'third' },
        { ms: 20000, text: 'fourth' },
      ],
    });
  });

  it('expands a line with several time tags and sorts by time', () => {
    const out = parseLyrics('[00:30.5]b\n[00:10.123][00:50.00]chorus', 'lrc');
    expect(out.lines).toEqual([
      { ms: 10123, text: 'chorus' },
      { ms: 30500, text: 'b' },
      { ms: 50000, text: 'chorus' },
    ]);
  });

  it('applies an [offset:] header and strips word-level tags', () => {
    const out = parseLyrics('[offset:500]\n[00:02.00]<00:02.00>hi <00:02.50>there', 'lrc');
    expect(out.lines).toEqual([{ ms: 1500, text: 'hi there' }]);
  });

  it('treats text with time tags as LRC whatever the hint says', () => {
    expect(parseLyrics('[01:00.00]x', 'txt').synced).toBe(true);
  });

  it('reads plain text as unsynced lines, blank runs collapsed', () => {
    expect(parseLyrics('\n\nOne love, one heart\n\n\n\nLet us get together\n\n', 'txt')).toEqual({
      synced: false,
      lines: [
        { ms: null, text: 'One love, one heart' },
        { ms: null, text: '' },
        { ms: null, text: 'Let us get together' },
      ],
    });
  });

  it('is null for nothing to show', () => {
    expect(parseLyrics('', 'lrc')).toBeNull();
    expect(parseLyrics('   \n ', 'txt')).toBeNull();
    expect(parseLyrics('[ar:Only]\n[ti:Headers]', 'lrc')).toBeNull();
    expect(parseLyrics('[00:01.00]\n[00:02.00]', 'lrc')).toBeNull();
  });
});

describe('audioQuality', () => {
  it('prefers the stream, falls back to the media, omits unknowns', () => {
    expect(audioQuality({ audioCodec: 'mp3', bitrate: 256 }, { codec: 'MP3', bitrate: 256, samplingRate: 44100, bitDepth: null }))
      .toEqual({ codec: 'mp3', bitrate: 256, sampleRate: 44100 });
    expect(audioQuality({ audioCodec: 'flac', bitrate: 1411 }, { samplingRate: 96000, bitDepth: 24 }))
      .toEqual({ codec: 'flac', bitrate: 1411, sampleRate: 96000, bitDepth: 24 });
    expect(audioQuality({}, {})).toBeNull();
  });
});
