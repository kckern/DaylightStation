// __app_modules/media/media/cli/concert-index.cli.test.mjs
//
// Finding the music and the talk inside a concert video. Every function here
// is pure; the ffmpeg and model I/O live in the CLI shell, so none of this
// needs a video.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, srtTime, words, lyricOverlap, clipArgs, numberFlag, parseAt, runCliEntry } from './concert-index.cli.mjs';

describe('parseSrt', () => {
  const SRT = '1\r\n00:01:03,160 --> 00:01:11,560\r\nTo buy the table\r\n\r\n'
    + '2\n00:01:45,439 --> 00:01:52,960\nI\'ll see very gentle\nand let\'s not be you dismay.\n\n'
    + 'garbage block with no timing\n\n'
    + '3\n01:00:00.000 --> 01:00:02.500\nSpoken line.\n';

  it('reads timed cues, joins wrapped lines, skips blocks without timing', () => {
    expect(parseSrt(SRT)).toEqual([
      { i: 1, start: 63.16, end: 71.56, text: 'To buy the table' },
      { i: 2, start: 105.439, end: 112.96, text: "I'll see very gentle and let's not be you dismay." },
      { i: 3, start: 3600, end: 3602.5, text: 'Spoken line.' },
    ]);
  });
  it('srtTime accepts comma or dot milliseconds', () => {
    expect(srtTime('00:00:01,500')).toBe(1.5);
    expect(srtTime('00:00:01.500')).toBe(1.5);
    expect(srtTime('nope')).toBeNull();
  });
});
describe('lyricOverlap', () => {
  const HEARD = 'Was born on Christmas Day to save us all from savers all when we were gone astray. Oh tidings are';
  const GOD_REST = "God rest ye merry, gentlemen, let nothing you dismay, remember Christ our Saviour was born on Christmas Day to save us all from Satan's power when we were gone astray. O tidings of comfort and joy";

  it('scores a mangled transcription against the right carol', () => {
    expect(lyricOverlap(HEARD, GOD_REST)).toBeGreaterThan(0.3);
  });
  it('scores zero against an unrelated carol', () => {
    expect(lyricOverlap(HEARD, 'Silent night, holy night, all is calm, all is bright')).toBe(0);
  });
  it('is zero when either side is empty', () => {
    expect(lyricOverlap('', GOD_REST)).toBe(0);
    expect(lyricOverlap(HEARD, '')).toBe(0);
  });
  it('words() drops stop words, short words, accents and apostrophes', () => {
    expect(words("O Holy Night, Noël — Satan's")).toEqual(['holy', 'night', 'noel', 'satans']);
  });
});
describe('clipArgs', () => {
  it('cuts a small review clip centred on a boundary', () => {
    expect(clipArgs('/m/v.mp4', 120, 6, '/o')).toEqual([
      '-v', 'error', '-y', '-ss', '114', '-i', '/m/v.mp4', '-t', '12',
      '-vf', 'scale=-2:360', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
      '-c:a', 'aac', '-b:a', '128k', '/o/clip-0120.0.mp4',
    ]);
  });
  it('never seeks before zero', () => {
    expect(clipArgs('/m/v.mp4', 2, 6, '/o').slice(3, 5)).toEqual(['-ss', '0']);
  });
  it('keeps a fractional boundary centred and names clips to a tenth of a second', () => {
    const a = clipArgs('/m/v.mp4', 120.2, 6, '/o');
    expect(a.slice(3, 5)).toEqual(['-ss', '114.2']);
    expect(a.at(-1)).toBe('/o/clip-0120.2.mp4');
    expect(clipArgs('/m/v.mp4', 120.3, 6, '/o').at(-1)).toBe('/o/clip-0120.3.mp4');
  });
});

describe('flag parsing', () => {
  it('numberFlag reads numbers, falls back when absent, and names the flag when it is not a number', () => {
    expect(numberFlag('noise', '-40', -30)).toBe(-40);
    expect(numberFlag('noise', undefined, -30)).toBe(-30);
    expect(() => numberFlag('noise', 'loud', -30)).toThrow('--noise must be a number, got "loud"');
    expect(() => numberFlag('pad', '', 6)).toThrow(/--pad must be a number/);
  });
  it('parseAt reads a comma list and rejects empty or non-numeric entries', () => {
    expect(parseAt('120, 305.5')).toEqual([120, 305.5]);
    expect(() => parseAt('1,,2')).toThrow(/--at entry 2/);
    expect(() => parseAt('1,x')).toThrow(/--at entry 2 is not a number: "x"/);
  });
});

describe('runCliEntry errors', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); process.exitCode = undefined; });

  it('reports an unknown subcommand with a hint, and fails the exit code', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runCliEntry(['bogus']);
    expect(process.exitCode).toBe(1);
    expect(err.mock.calls.flat().join('\n')).toMatch(/unknown subcommand: bogus[\s\S]*--help/);
  });
});

describe('entry points', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  const cli = (args) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });

  it('the shim and the module both run from a relative path', () => {
    for (const entry of ['cli/concert-index.cli.mjs', '__app_modules/media/media/cli/concert-index.cli.mjs']) {
      const r = cli([entry, '--help']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('clips <media>');
    }
  });
  it('a bad --at fails with a message and exit 1, before creating anything', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'concert-index-'));
    try {
      const out = path.join(tmp, 'clips');
      const r = cli(['cli/concert-index.cli.mjs', 'clips', path.join(tmp, 'none.mp4'), '--at', '1,,2', '--out', out]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/--at entry 2[\s\S]*--help/);
      expect(existsSync(out)).toBe(false);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
  it('a non-numeric --pad fails before ffmpeg runs', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'concert-index-'));
    try {
      const out = path.join(tmp, 'c');
      const r = cli(['cli/concert-index.cli.mjs', 'clips', path.join(tmp, 'none.mp4'), '--at', '5', '--out', out, '--pad', 'wide']);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('--pad must be a number');
      expect(existsSync(out)).toBe(false);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});
