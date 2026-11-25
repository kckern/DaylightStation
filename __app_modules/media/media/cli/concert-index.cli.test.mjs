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
import { parseSrt, srtTime, parseChapters, chapterList, MUSIC_CLASSES, labelSeconds, runsFrom, refineChapter, words, lyricOverlap, clipArgs, numberFlag, parseAt, runCliEntry } from './concert-index.cli.mjs';

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
describe('parseChapters', () => {
  const PROBE = {
    chapters: [
      { id: 1, time_base: '1/1000', start: 360093, start_time: '360.093000', end_time: '656.890000' },
      { id: 0, time_base: '1/1000', start: 0, start_time: '0.000000', end_time: '360.093000', tags: { title: 'Opening' } },
    ],
  };

  it('reads ffprobe chapters into seconds, in time order, numbered from 1', () => {
    expect(parseChapters(PROBE)).toEqual([
      { index: 1, start: 0, end: 360.093, title: 'Opening' },
      { index: 2, start: 360.093, end: 656.89, title: null },
    ]);
  });
  it('accepts the JSON text as ffprobe prints it', () => {
    expect(parseChapters(JSON.stringify(PROBE))).toHaveLength(2);
  });
  it('is empty for a file without chapters', () => {
    expect(parseChapters({})).toEqual([]);
    expect(parseChapters('{"chapters": []}')).toEqual([]);
  });
});

describe('chapterList', () => {
  it('takes a caller-built list of titled chapters, numbering any without an index', () => {
    expect(chapterList([{ title: 'Carol', start: 0, end: 60 }, { index: 7, title: 'Reading', start: 60, end: 90 }])).toEqual([
      { index: 1, title: 'Carol', start: 0, end: 60 },
      { index: 7, title: 'Reading', start: 60, end: 90 },
    ]);
  });
  it('also takes raw ffprobe output', () => {
    expect(chapterList({ chapters: [{ start_time: '0', end_time: '5', tags: { title: 'A' } }] })).toEqual([
      { index: 1, start: 0, end: 5, title: 'A' },
    ]);
  });
  it('rejects a chapter without a usable start and end', () => {
    expect(() => chapterList([{ title: 'Broken', start: 10 }])).toThrow(/chapter 1 \("Broken"\) needs numeric start < end/);
    expect(() => chapterList([{ title: 'Backwards', start: 10, end: 5 }])).toThrow(/chapter 1/);
  });
});

describe('labelSeconds', () => {
  it('labels music, narration over music, speech and gaps', () => {
    const classes = {
      Music: [0.9, 0.9, 0.9, 0.1, 0.1],
      Speech: [0.0, 0.2, 0.0, 0.5, 0.0],
    };
    expect(labelSeconds(classes, { smoothS: 1 })).toEqual(['music', 'narration', 'music', 'speech', 'gap']);
  });
  it('counts any present music class, so bells alone are music', () => {
    expect(MUSIC_CLASSES).toEqual(['Music', 'Singing', 'Choir', 'Bell', 'Church bell', 'Jingle bell', 'Orchestra']);
    expect(labelSeconds({ Music: [0.05, 0.05], 'Church bell': [0.8, 0.02] }, { smoothS: 1 })).toEqual(['music', 'gap']);
  });
  it('reads applause as a gap', () => {
    expect(labelSeconds({ Music: [0.1, 0.1], Speech: [0.05, 0.05], Applause: [0.9, 0.9] }, { smoothS: 1 })).toEqual(['gap', 'gap']);
  });
  it('smooths both signals with a centred median, so a one-second blip does not count', () => {
    const Music = [0.9, 0.9, 0.9, 0.0, 0.9, 0.9, 0.9];
    const Speech = [0, 0, 0, 0.9, 0, 0, 0];
    expect(labelSeconds({ Music, Speech })).toEqual(Array(7).fill('music'));
  });
  it('honours its thresholds', () => {
    expect(labelSeconds({ Music: [0.5], Speech: [0.2] }, { smoothS: 1, music: 0.6, speech: 0.15 })).toEqual(['speech']);
  });
});

describe('runsFrom', () => {
  it('merges equal neighbours into runs in seconds', () => {
    expect(runsFrom(['gap', 'gap', 'gap', 'gap', 'music', 'music', 'music', 'music', 'music'])).toEqual([
      { label: 'gap', start: 0, end: 4 },
      { label: 'music', start: 4, end: 9 },
    ]);
  });
  it('absorbs a short run into the one before it, then merges again', () => {
    const labels = [...Array(10).fill('music'), 'speech', 'speech', ...Array(10).fill('music')];
    expect(runsFrom(labels)).toEqual([{ label: 'music', start: 0, end: 22 }]);
  });
  it('folds a short opening run into the next one', () => {
    expect(runsFrom(['gap', ...Array(6).fill('music')])).toEqual([{ label: 'music', start: 0, end: 7 }]);
  });
  it('is empty for no labels', () => {
    expect(runsFrom([])).toEqual([]);
  });
});

describe('refineChapter', () => {
  const run = (label, start, end) => ({ label, start, end });

  it('finds the music, the applause after it and the introduction to the next piece', () => {
    // A chapter shaped like the pilot's fourth: music, ~28 s of applause, then talk.
    const runs = [run('gap', 0, 2), run('music', 2, 400), run('gap', 400, 428), run('speech', 428, 484), run('gap', 484, 492)];
    expect(refineChapter({ start: 0, end: 492 }, runs)).toEqual({
      performances: [{ start: 2, end: 400, narrationShare: 0 }],
      speech: [{ start: 428, end: 484, position: 'after' }],
      gaps: [{ start: 400, end: 428 }],
      music: [2, 400],
    });
  });
  it('bridges gaps shorter than gapMergeS and keeps longer ones as separate performances', () => {
    const runs = [run('music', 0, 100), run('gap', 100, 110), run('music', 110, 200), run('gap', 200, 230), run('music', 230, 300)];
    const r = refineChapter({ start: 0, end: 300 }, runs);
    expect(r.performances.map((p) => [p.start, p.end])).toEqual([[0, 200], [230, 300]]);
    expect(r.gaps).toEqual([{ start: 200, end: 230 }]);
    expect(r.music).toEqual([0, 300]);
  });
  it('keeps music and narration in one performance and measures narration against sound, not gaps', () => {
    const runs = [run('music', 0, 30), run('narration', 30, 90), run('gap', 90, 100), run('music', 100, 120)];
    expect(refineChapter({ start: 0, end: 120 }, runs).performances).toEqual([{ start: 0, end: 120, narrationShare: 0.545 }]);
  });
  it('places speech before, between and after the performances', () => {
    const runs = [run('speech', 0, 20), run('music', 20, 100), run('speech', 100, 110), run('music', 110, 200), run('speech', 200, 230)];
    expect(refineChapter({ start: 0, end: 230 }, runs).speech.map((s) => s.position)).toEqual(['before', 'between', 'after']);
  });
  it('clips runs to the chapter and drops slivers under two seconds left by the cut', () => {
    const runs = [run('speech', 0, 100.5), run('music', 100.5, 300), run('gap', 300, 330), run('speech', 330, 400)];
    expect(refineChapter({ start: 99.7, end: 331.2 }, runs)).toEqual({
      performances: [{ start: 100.5, end: 300, narrationShare: 0 }],
      speech: [],
      gaps: [{ start: 300, end: 330 }],
      music: [100.5, 300],
    });
  });
  it('gives a chapter with no music a null music span', () => {
    const r = refineChapter({ start: 0, end: 60 }, [run('speech', 0, 60)]);
    expect(r.music).toBeNull();
    expect(r.performances).toEqual([]);
    expect(r.speech).toEqual([{ start: 0, end: 60, position: 'before' }]);
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
  it('words() treats a curly apostrophe like a straight one', () => {
    expect(words('David\u2019s City')).toEqual(['davids', 'city']);
    expect(words('Man\u2018s')).toEqual(['mans']);
    expect(lyricOverlap("ONCE IN ROYAL DAVID\u2019S CITY", "Once in Royal David's City")).toBe(1);
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
