// __app_modules/media/media/cli/concert-index.cli.test.mjs
//
// Indexing a concert video into sections. Every function here is pure; the
// ffmpeg and network I/O live in the CLI shell, so none of this needs a video.

import { describe, it, expect } from 'vitest';
import { parseTrackListing, stripWiki, mmss, parseSrt, srtTime } from './concert-index.cli.mjs';

const WIKITEXT = `==Track listing==
{{Track listing
| headline        = CD
| extra_column    = Performer(s)
| title1          = Processional on "God Rest Ye Merry, Gentlemen"
| length1         = 5:31
| extra1          = Choir, Orchestra, and Bells
| title2          = Through Heaven's Eyes, from ''[[The Prince of Egypt]]''
| length2         = 3:52
| extra2          = [[Brian Stokes Mitchell]] with Choir<ref>liner notes</ref>
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
    expect(stripWiki("from ''[[Messiah (Handel)|Messiah]]''{{sfn|x}}<ref>a</ref>")).toBe('from Messiah');
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
      title: "Through Heaven's Eyes, from The Prince of Egypt",
      length: 232,
      performers: 'Brian Stokes Mitchell with Choir',
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
