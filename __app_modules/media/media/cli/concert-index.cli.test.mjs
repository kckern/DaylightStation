// __app_modules/media/media/cli/concert-index.cli.test.mjs
//
// Indexing a concert video into sections. Every function here is pure; the
// ffmpeg and network I/O live in the CLI shell, so none of this needs a video.

import { describe, it, expect } from 'vitest';
import { rejectApplauseCandidates } from './segment-timings.cli.mjs';
import { parseTrackListing, stripWiki, mmss, parseSrt, srtTime, sectionsFrom, attachCues, words, lyricOverlap, rankTracks, buildEvidence, measureGraph, clipArgs } from './concert-index.cli.mjs';

const WIKITEXT = `==Track listing==
{{Track listing
| headline        = CD
| extra_column    = Performer(s)
| title1          = Processional on "Deck the Hall"
| length1         = 5:31
| extra1          = Choir, Orchestra, and Bells
| title2          = Snowfall Song, from ''[[The Winter Garden]]''
| length2         = 3:52
| extra2          = [[Jane Carroll]] with Choir<ref>liner notes</ref>
}}
{{Track listing
| headline = DVD
| title1 = Once in Royal David's City
| length1 = 4:38
}}`;

describe('mmss', () => {
  it('reads m:ss and h:mm:ss', () => {
    expect(mmss('5:31')).toBe(331);
    expect(mmss('1:02:03')).toBe(3723);
  });
  it('is null for blank or junk', () => {
    expect(mmss('')).toBeNull();
    expect(mmss(undefined)).toBeNull();
    expect(mmss('abc')).toBeNull();
  });
});

describe('stripWiki', () => {
  it('drops links, italics, refs and templates', () => {
    expect(stripWiki("from ''[[Winter Cantata (Smith)|Winter Cantata]]''{{sfn|x}}<ref>a</ref>")).toBe('from Winter Cantata');
  });
});

describe('parseTrackListing', () => {
  const tracks = parseTrackListing(WIKITEXT);

  it('reads every track of every listing, numbered within its listing', () => {
    expect(tracks.map((t) => [t.listing, t.n])).toEqual([['CD', 1], ['CD', 2], ['DVD', 1]]);
  });
  it('cleans titles and performers and converts lengths to seconds', () => {
    expect(tracks[1]).toEqual({
      listing: 'CD', n: 2,
      title: 'Snowfall Song, from The Winter Garden',
      length: 232,
      performers: 'Jane Carroll with Choir',
    });
  });
  it('leaves performers null when the listing has no extra column', () => {
    expect(tracks[2].performers).toBeNull();
  });
  it('returns an empty list for an article without the template', () => {
    expect(parseTrackListing('==Track listing==\n# a list')).toEqual([]);
  });
});

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

describe('sectionsFrom', () => {
  it('starts at zero, ends each section at the applause that follows it, else at the next start', () => {
    expect(sectionsFrom({
      candidates: [0, 120, 300],
      applause: [{ start: 280, end: 300 }],
      durationS: 400,
    })).toEqual([
      { start: 0, end: 120, applauseAfter: false },
      { start: 120, end: 280, applauseAfter: true },
      { start: 300, end: 400, applauseAfter: false },
    ]);
  });
  it('ignores candidates outside the file and duplicates', () => {
    expect(sectionsFrom({ candidates: [50, 50, 900], durationS: 100 })).toEqual([
      { start: 0, end: 50, applauseAfter: false },
      { start: 50, end: 100, applauseAfter: false },
    ]);
  });
  it('starts a section where each applause run ends, even when the candidates there were rejected', () => {
    const applause = [{ start: 100, end: 110 }, { start: 250, end: 260 }];
    // The silences bracketing applause sit within padS of it, so every one is rejected.
    const candidates = rejectApplauseCandidates([98.5, 111.5, 262], applause);
    expect(candidates).toEqual([]);
    expect(sectionsFrom({ candidates, applause, durationS: 400 })).toEqual([
      { start: 0, end: 100, applauseAfter: true },
      { start: 110, end: 250, applauseAfter: true },
      { start: 260, end: 400, applauseAfter: false },
    ]);
  });
  it('moves a start that falls inside applause to where the applause ends', () => {
    expect(sectionsFrom({ candidates: [50, 60], applause: [{ start: 0, end: 8 }, { start: 55, end: 65 }], durationS: 100 })).toEqual([
      { start: 8, end: 50, applauseAfter: false },
      { start: 50, end: 55, applauseAfter: true },
      { start: 65, end: 100, applauseAfter: false },
    ]);
  });
});

describe('attachCues', () => {
  it('gives each cue to the section holding its midpoint; a cue in the gap introduces the next section', () => {
    const sections = [{ start: 0, end: 100 }, { start: 120, end: 200 }];
    const cues = [
      { i: 1, start: 10, end: 12, text: 'one' },
      { i: 2, start: 104, end: 110, text: 'in the applause gap' },
      { i: 3, start: 150, end: 152, text: 'two' },
    ];
    expect(attachCues(sections, cues)).toEqual([
      { start: 0, end: 100, cues: [1], text: 'one', introCues: [], intro: '' },
      { start: 120, end: 200, cues: [3], text: 'two', introCues: [2], intro: 'in the applause gap' },
    ]);
  });
  it("gives the first section's intro any cues before it starts", () => {
    const [first] = attachCues([{ start: 8, end: 50 }], [{ i: 1, start: 2, end: 4, text: 'welcome' }]);
    expect(first).toMatchObject({ cues: [], text: '', introCues: [1], intro: 'welcome' });
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

describe('rankTracks', () => {
  it('puts the lyric match first and reports the duration ratio', () => {
    const section = { start: 0, end: 330, text: 'born on Christmas Day tidings astray' };
    const tracks = [
      { n: 1, title: 'Silent Night', length: 240, incipit: 'Silent night holy night' },
      { n: 2, title: 'God Rest Ye Merry, Gentlemen', length: 331, incipit: 'born on Christmas Day when we were gone astray tidings of comfort and joy' },
      { n: 3, title: 'Organ Voluntary', length: 300 },
    ];
    const ranked = rankTracks(section, tracks);
    expect(ranked[0]).toMatchObject({ n: 2, durationRatio: 1 });
    expect(ranked[0].lyric).toBeGreaterThan(0.3);
    expect(ranked.find((r) => r.n === 3).lyric).toBeNull();
  });
  it('matches titles against the spoken intro, lyrics against the section only', () => {
    const section = { start: 0, end: 200, intro: 'and now, silent night', text: '' };
    const [row] = rankTracks(section, [{ n: 1, title: 'Silent Night', length: 200, incipit: 'Silent night holy night' }]);
    expect(row).toMatchObject({ lyric: 0, titleHit: 1 });
  });
  it('ranks on the best evidence, so an announced instrumental beats a lyric miss', () => {
    const section = { start: 0, end: 200, intro: 'and now, sleigh ride', text: 'la la la' };
    const ranked = rankTracks(section, [
      { listing: 'CD', n: 1, title: 'Silent Night', length: 240, incipit: 'Silent night holy night' },
      { listing: 'CD', n: 2, title: 'Sleigh Ride', length: 200 },
    ]);
    expect(ranked.map((r) => r.n)).toEqual([2, 1]);
    expect(ranked[0]).toMatchObject({ listing: 'CD', lyric: null, titleHit: 1, score: 1 });
    expect(ranked[1]).toMatchObject({ listing: 'CD', lyric: 0, titleHit: 0, score: 0 });
  });
  it('breaks score ties by lyric evidence, then album order', () => {
    const section = { start: 0, end: 100, text: '' };
    const ranked = rankTracks(section, [
      { n: 1, title: 'Bells A', length: 100 },
      { n: 2, title: 'Bells B', length: 100 },
      { n: 3, title: 'Carol C', length: 100, incipit: 'unheard words' },
    ]);
    expect(ranked.map((r) => r.n)).toEqual([3, 1, 2]);
    expect(ranked[1].listing).toBeNull();
  });
});

describe('buildEvidence', () => {
  it('turns a silence log, subtitles and tracks into ranked sections', () => {
    const silenceLog = [
      '[silencedetect @ 0x1] silence_start: 118',
      '[silencedetect @ 0x1] silence_end: 120 | silence_duration: 2',
    ].join('\n');
    const ev = buildEvidence({
      durationS: 300,
      silenceLog,
      rmsText: '',
      hfText: '',
      cues: [{ i: 1, start: 30, end: 34, text: 'silent night holy night' }],
      tracks: [{ n: 1, title: 'Silent Night', length: 118, incipit: 'Silent night holy night' }],
      minGapS: 20,
    });
    expect(ev.sections.map((s) => [s.n, s.start, s.end])).toEqual([[1, 0, 120], [2, 120, 300]]);
    expect(ev.sections[0].ranks[0]).toMatchObject({ n: 1, lyric: 1 });
    expect(ev.applause).toEqual([]);
  });
});

describe('measureGraph', () => {
  it('runs both level passes and silencedetect from one decode', () => {
    const g = measureGraph('/tmp/out', { noiseDb: -40, minSilenceS: 0.8 });
    expect(g).toContain('asplit=3');
    expect(g).toContain('file=/tmp/out/rms.txt');
    expect(g).toContain('highpass=f=9000');
    expect(g).toContain('file=/tmp/out/hf.txt');
    expect(g).toContain('silencedetect=noise=-40dB:d=0.8[out]');
  });
  it('refuses an output dir the filtergraph cannot quote', () => {
    expect(() => measureGraph('/tmp/a,b')).toThrow(/filtergraph/);
    expect(() => measureGraph('/tmp/a:b')).toThrow(/filtergraph/);
  });
});

describe('clipArgs', () => {
  it('cuts a small review clip centred on a boundary', () => {
    expect(clipArgs('/m/v.mp4', 120, 6, '/o')).toEqual([
      '-v', 'error', '-y', '-ss', '114', '-i', '/m/v.mp4', '-t', '12',
      '-vf', 'scale=-2:360', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
      '-c:a', 'aac', '-b:a', '128k', '/o/clip-0120.mp4',
    ]);
  });
  it('never seeks before zero', () => {
    expect(clipArgs('/m/v.mp4', 2, 6, '/o').slice(3, 5)).toEqual(['-ss', '0']);
  });
});
