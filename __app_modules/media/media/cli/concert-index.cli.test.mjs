// __app_modules/media/media/cli/concert-index.cli.test.mjs
//
// Indexing a concert video into sections. Every function here is pure; the
// ffmpeg and network I/O live in the CLI shell, so none of this needs a video.

import { describe, it, expect } from 'vitest';
import { parseTrackListing, stripWiki, mmss } from './concert-index.cli.mjs';

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
